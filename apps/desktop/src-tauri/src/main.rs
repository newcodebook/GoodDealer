#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod backup_ipc;
mod command_handlers;
mod native_cloud_runtime;
mod native_cloud_session;
mod oauth_loopback;
mod oauth_runtime;
mod projection_lane;
mod provider_credential_orchestrator;
mod provider_ipc;
mod provider_lane;
mod sync_lane;

use gooddealer_local_storage::{DesktopApplicationRoot, DesktopLocalHost};
use gooddealer_secure_host_core::load_or_create_desktop_device_identity;
use std::future::Future;
use std::sync::{Arc, Mutex};
use tauri::Manager;

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

fn main() {
    let app = tauri::Builder::default()
        // Must be first: later plugin/setup work must never run in a competing refresh process.
        // Browser sign-in returns over loopback (ADR-0026), so a second launch carries nothing.
        .plugin(tauri_plugin_single_instance::init(
            |_app, _arguments, _cwd| {},
        ))
        .plugin(tauri_plugin_opener::init())
        .setup(move |app| {
            // The Host owns a dedicated child: WebKitGTK creates the app data directory itself
            // (media keys) before setup runs, under the user's umask, so that directory can be
            // group-writable on stock Linux desktops. The child is created owner-only by the root
            // validator and holds nothing the webview writes.
            let app_data_root = app.path().app_data_dir()?.join("local-host");
            let application_root = DesktopApplicationRoot::validate(&app_data_root)?;
            let local_host = Arc::new(DesktopLocalHost::production(application_root)?);
            app.manage(Arc::clone(&local_host));
            let identity = load_or_create_desktop_device_identity().ok();
            let oauth = Arc::new(oauth_runtime::DesktopOAuthRuntime::new(
                Some(native_cloud_session::PRODUCTION_CLOUD_ORIGIN),
                Some(oauth_runtime::PRODUCTION_ACCOUNT_ORIGIN),
                identity,
                Arc::clone(&local_host),
            ));
            let session = Arc::clone(oauth.session());
            app.manage(Arc::clone(&session));
            app.manage(Arc::clone(&oauth));
            let cloud = native_cloud_runtime::NativeCloudCoordinator::start(&local_host, &session);
            app.manage(cloud);
            let maintenance = Arc::clone(&oauth);
            let maintenance_app = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                maintenance.maintain_authentication(maintenance_app).await;
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            command_handlers::local_business_status,
            command_handlers::local_device_lease_read,
            command_handlers::local_asset_library_read,
            command_handlers::local_domain_detail_read,
            command_handlers::local_dns_health_read,
            command_handlers::local_settings_read,
            command_handlers::local_sales_read,
            command_handlers::local_renewals_read,
            command_handlers::local_batch_operations_read,
            command_handlers::local_history_read,
            command_handlers::local_manual_tasks_read,
            command_handlers::local_domain_asset_edit,
            command_handlers::local_domain_asset_create,
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
            command_handlers::cloudflare_connection_revoke,
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
