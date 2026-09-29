#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod backup_ipc;
mod command_handlers;
mod native_cloud_runtime;
mod native_cloud_session;
mod oauth_runtime;
mod projection_lane;
mod provider_credential_orchestrator;
mod provider_ipc;
mod provider_lane;
mod sync_lane;

use gooddealer_local_storage::{DesktopApplicationRoot, DesktopLocalHost};
use gooddealer_secure_host_core::load_or_create_desktop_device_identity;
use std::collections::VecDeque;
use std::future::Future;
use std::sync::{Arc, Mutex};
use tauri::{Emitter as _, Manager};
use tauri_plugin_deep_link::DeepLinkExt as _;
use tauri_plugin_opener::OpenerExt as _;
use url::Url;

const MAX_BUFFERED_STARTUP_OAUTH_CALLBACKS: usize = 8;
const MAX_OAUTH_CALLBACK_ARGUMENT_BYTES: usize = 2_048;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ExitShutdownDecision {
    Begin { exit_code: i32 },
    Wait,
    Allow,
    RestartWithoutDrain,
}

#[derive(Default)]
struct ExitShutdownState {
    phase: Mutex<ExitShutdownPhase>,
}

#[derive(Default)]
enum ExitShutdownPhase {
    #[default]
    Running,
    Draining,
    Drained,
}

impl ExitShutdownState {
    fn request(&self, code: Option<i32>) -> ExitShutdownDecision {
        if code == Some(tauri::RESTART_EXIT_CODE) {
            return ExitShutdownDecision::RestartWithoutDrain;
        }
        let Ok(mut phase) = self.phase.lock() else {
            return ExitShutdownDecision::Wait;
        };
        match *phase {
            ExitShutdownPhase::Running => {
                *phase = ExitShutdownPhase::Draining;
                ExitShutdownDecision::Begin {
                    exit_code: code.unwrap_or(0),
                }
            }
            ExitShutdownPhase::Draining => ExitShutdownDecision::Wait,
            ExitShutdownPhase::Drained => ExitShutdownDecision::Allow,
        }
    }

    fn mark_drained(&self) {
        if let Ok(mut phase) = self.phase.lock() {
            *phase = ExitShutdownPhase::Drained;
        }
    }
}

async fn complete_exit_shutdown<E>(
    state: Arc<ExitShutdownState>,
    exit_code: i32,
    shutdown: impl Future<Output = Result<(), E>>,
    exit: impl FnOnce(i32),
) {
    let _ = shutdown.await;
    state.mark_drained();
    exit(exit_code);
}

fn run_app(app: tauri::App) {
    let exit_shutdown = Arc::new(ExitShutdownState::default());
    app.run(move |app_handle, event| {
        let tauri::RunEvent::ExitRequested { code, api, .. } = event else {
            return;
        };
        let Some(cloud) =
            app_handle.try_state::<Arc<native_cloud_runtime::NativeCloudCoordinator>>()
        else {
            return;
        };
        match exit_shutdown.request(code) {
            ExitShutdownDecision::Begin { exit_code } => {
                api.prevent_exit();
                cloud.cancel();
                let cloud = Arc::clone(cloud.inner());
                let state = Arc::clone(&exit_shutdown);
                let app_handle = app_handle.clone();
                tauri::async_runtime::spawn(complete_exit_shutdown(
                    state,
                    exit_code,
                    async move {
                        cloud.join().await;
                        Ok::<(), ()>(())
                    },
                    move |exit_code| app_handle.exit(exit_code),
                ));
            }
            ExitShutdownDecision::Wait => api.prevent_exit(),
            ExitShutdownDecision::Allow => {}
            ExitShutdownDecision::RestartWithoutDrain => {
                // Tauri ignores `prevent_exit` for restart. This repository has no explicit
                // restart entrypoint that can await the drain, so restart only closes the commit
                // fence synchronously and makes no graceful-drain claim.
                cloud.cancel();
            }
        }
    });
}

#[derive(Default)]
struct StartupOAuthCallbackBuffer {
    state: Mutex<StartupOAuthCallbackState>,
}

#[derive(Default)]
struct StartupOAuthCallbackState {
    installed: bool,
    callbacks: VecDeque<Url>,
}

impl StartupOAuthCallbackBuffer {
    fn enqueue_or_ready(&self, callback: Url) -> Option<Url> {
        let Ok(mut state) = self.state.lock() else {
            return None;
        };
        if state.installed {
            return Some(callback);
        }
        if state.callbacks.len() < MAX_BUFFERED_STARTUP_OAUTH_CALLBACKS {
            state.callbacks.push_back(callback);
        }
        None
    }

    fn install_and_drain(&self) -> Vec<Url> {
        let Ok(mut state) = self.state.lock() else {
            return Vec::new();
        };
        state.installed = true;
        state.callbacks.drain(..).collect()
    }
}

fn oauth_callback_argument(argument: &str) -> Option<Url> {
    if argument.len() > MAX_OAUTH_CALLBACK_ARGUMENT_BYTES {
        return None;
    }
    let callback = Url::parse(argument).ok()?;
    (callback.scheme() == "gooddealer"
        && callback.host_str() == Some("oauth")
        && callback.path() == "/callback"
        && callback.username().is_empty()
        && callback.password().is_none()
        && callback.port().is_none()
        && callback.fragment().is_none())
    .then_some(callback)
}

fn dispatch_oauth_callback(
    app_handle: tauri::AppHandle,
    oauth: Arc<oauth_runtime::DesktopOAuthRuntime>,
    callback: Url,
) {
    tauri::async_runtime::spawn(async move {
        if let Ok(Some(authorization_url)) = oauth.handle_callback(callback).await
            && app_handle
                .opener()
                .open_url(authorization_url, None::<&str>)
                .is_err()
        {
            oauth.cancel_pending();
        }
        let _ = app_handle.emit("desktop-authentication-status", oauth.status());
    });
}

fn main() {
    let startup_callbacks = Arc::new(StartupOAuthCallbackBuffer::default());
    let single_instance_callbacks = Arc::clone(&startup_callbacks);
    let app = tauri::Builder::default()
        // Must be first: later plugin/setup work must never run in a competing refresh process.
        .plugin(tauri_plugin_single_instance::init(
            move |app, arguments, _cwd| {
                for argument in arguments {
                    if let Some(callback) = oauth_callback_argument(&argument)
                        && let Some(callback) = single_instance_callbacks.enqueue_or_ready(callback)
                        && let Some(oauth) =
                            app.try_state::<Arc<oauth_runtime::DesktopOAuthRuntime>>()
                    {
                        dispatch_oauth_callback(app.clone(), Arc::clone(oauth.inner()), callback);
                    }
                }
            },
        ))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .setup(move |app| {
            let app_data_root = app.path().app_data_dir()?;
            let application_root = DesktopApplicationRoot::validate(&app_data_root)?;
            let local_host = Arc::new(DesktopLocalHost::production(application_root)?);
            app.manage(Arc::clone(&local_host));
            let identity = load_or_create_desktop_device_identity().ok();
            let oauth = Arc::new(oauth_runtime::DesktopOAuthRuntime::new(
                Some(native_cloud_session::PRODUCTION_CLOUD_ORIGIN),
                identity,
                Arc::clone(&local_host),
            ));
            let session = Arc::clone(oauth.session());
            app.manage(Arc::clone(&session));
            app.manage(Arc::clone(&oauth));
            let cloud = native_cloud_runtime::NativeCloudCoordinator::start(&local_host, &session);
            app.manage(cloud);
            for callback in startup_callbacks.install_and_drain() {
                dispatch_oauth_callback(app.handle().clone(), Arc::clone(&oauth), callback);
            }
            let maintenance = Arc::clone(&oauth);
            let maintenance_app = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                maintenance.maintain_authentication(maintenance_app).await;
            });
            let app_handle = app.handle().clone();
            let callback_oauth = Arc::clone(&oauth);
            app.deep_link().on_open_url(move |event| {
                for callback in event.urls() {
                    if oauth_callback_argument(callback.as_str()).is_some() {
                        let oauth = Arc::clone(&callback_oauth);
                        let app_handle = app_handle.clone();
                        dispatch_oauth_callback(app_handle, oauth, callback);
                    }
                }
            });
            if let Some(callbacks) = app.deep_link().get_current()? {
                for callback in callbacks {
                    if oauth_callback_argument(callback.as_str()).is_some() {
                        let oauth = Arc::clone(&oauth);
                        let app_handle = app.handle().clone();
                        dispatch_oauth_callback(app_handle, oauth, callback);
                    }
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            command_handlers::local_business_status,
            command_handlers::local_asset_library_read,
            command_handlers::local_domain_detail_read,
            command_handlers::local_domain_asset_edit,
            command_handlers::local_domain_asset_delete,
            command_handlers::local_domain_asset_provider_bind,
            command_handlers::local_conflict_center_read,
            command_handlers::local_conflict_resolve,
            command_handlers::local_sync_status,
            command_handlers::local_backup_restore_status,
            command_handlers::local_backup_export,
            command_handlers::local_backup_artifact_select,
            command_handlers::local_backup_restore_begin,
            oauth_runtime::desktop_authentication_status,
            oauth_runtime::desktop_authentication_begin,
            oauth_runtime::desktop_authentication_refresh,
            command_handlers::cloudflare_connection_activate,
            command_handlers::cloudflare_zone_observe,
            command_handlers::cloudflare_connection_status,
            command_handlers::cloudflare_observation_read,
        ])
        .build(tauri::generate_context!())
        .expect("failed to build the GoodDealer desktop host");
    run_app(app);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn startup_callback_is_buffered_until_install_and_drained_once() {
        let buffer = StartupOAuthCallbackBuffer::default();
        let callback =
            oauth_callback_argument("gooddealer://oauth/callback?code=once&state=bound").unwrap();

        assert!(buffer.enqueue_or_ready(callback.clone()).is_none());
        assert_eq!(buffer.install_and_drain(), vec![callback]);
        assert!(buffer.install_and_drain().is_empty());

        let later =
            oauth_callback_argument("gooddealer://oauth/callback?code=later&state=bound").unwrap();
        assert_eq!(buffer.enqueue_or_ready(later.clone()), Some(later));
    }

    #[test]
    fn startup_buffer_accepts_only_the_exact_bounded_oauth_callback_route() {
        assert!(oauth_callback_argument("https://oauth/callback?code=x").is_none());
        assert!(oauth_callback_argument("gooddealer://other/callback?code=x").is_none());
        assert!(oauth_callback_argument("gooddealer://oauth/other?code=x").is_none());
        assert!(oauth_callback_argument("gooddealer://oauth/callback#fragment").is_none());
        assert!(
            oauth_callback_argument(&format!(
                "gooddealer://oauth/callback?code={}",
                "x".repeat(MAX_OAUTH_CALLBACK_ARGUMENT_BYTES)
            ))
            .is_none()
        );
    }

    #[test]
    fn exit_shutdown_is_one_shot_and_preserves_the_original_code() {
        let state = ExitShutdownState::default();
        assert_eq!(
            state.request(Some(37)),
            ExitShutdownDecision::Begin { exit_code: 37 }
        );
        assert_eq!(state.request(Some(9)), ExitShutdownDecision::Wait);
        state.mark_drained();
        assert_eq!(state.request(Some(37)), ExitShutdownDecision::Allow);
    }

    #[test]
    fn restart_is_not_reported_as_a_drained_exit() {
        let state = ExitShutdownState::default();
        assert_eq!(
            state.request(Some(tauri::RESTART_EXIT_CODE)),
            ExitShutdownDecision::RestartWithoutDrain
        );
        assert_eq!(
            state.request(None),
            ExitShutdownDecision::Begin { exit_code: 0 }
        );
    }

    #[tokio::test]
    async fn shutdown_failure_still_releases_the_prevented_exit_without_blocking() {
        let state = Arc::new(ExitShutdownState::default());
        assert_eq!(
            state.request(Some(23)),
            ExitShutdownDecision::Begin { exit_code: 23 }
        );
        let observed = Arc::new(Mutex::new(None));
        let observed_exit = Arc::clone(&observed);
        complete_exit_shutdown(
            Arc::clone(&state),
            23,
            async { Err::<(), _>("lane join failed") },
            move |code| *observed_exit.lock().unwrap() = Some(code),
        )
        .await;
        assert_eq!(*observed.lock().unwrap(), Some(23));
        assert_eq!(state.request(Some(23)), ExitShutdownDecision::Allow);
    }
}
