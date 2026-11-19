//! PKCE/browser and authentication-status facade. Bearer and refresh custody belongs exclusively
//! to `NativeCloudSession`.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use gooddealer_local_storage::DesktopLocalHost;
use gooddealer_secure_host_core::{
    DesktopDeviceIdentity, DesktopOAuthAttempt, DesktopOAuthContinuation,
};
use tauri::{AppHandle, Emitter as _, State};
use tauri_plugin_opener::OpenerExt as _;
use tokio::sync::Notify;
use url::Url;

use crate::native_cloud_session::{NativeCloudSession, NativeOAuthError, NativeOAuthStatus};
use crate::oauth_loopback::{self, LoopbackRequest, ResultPage};

/// Browser-facing origin of the authorize page. Account Web signs the user in on this host and
/// proxies `/v1/*` to Cloud, so its host-only session cookie reaches authorize; the API origin
/// never receives that cookie. Token, Grant, and sync calls stay on the API origin.
pub(crate) const PRODUCTION_ACCOUNT_ORIGIN: &str = "https://account.gooddealer.com/";

const SIGNED_OUT_REFRESH_POLL: Duration = Duration::from_mins(5);
const MINIMUM_REFRESH_RETRY: Duration = Duration::from_secs(1);
const MAXIMUM_REFRESH_RETRY: Duration = Duration::from_mins(1);
/// Covers the five-minute enrollment re-authentication window plus the two-minute challenge with
/// room for a slow sign-in; after it the loopback server closes and Desktop returns to signed out.
const LOGIN_TIMEOUT: Duration = Duration::from_mins(10);

/// The one browser login in flight. `generation` fences a superseded server so it can neither
/// consume nor clear a newer attempt; `attempt` is `None` only while a callback is advancing it.
struct ActiveLogin {
    generation: u64,
    purpose: LoginPurpose,
    attempt: Option<DesktopOAuthAttempt>,
    cancel: Arc<Notify>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum LoginPurpose {
    SignIn,
    ForcedTakeover,
}

#[derive(Clone, Copy)]
struct CompletedReauthentication {
    generation: u64,
    credential: u64,
}

/// A bound loopback listener waiting for the browser, owned by its serving task.
pub(crate) struct LoopbackLogin {
    listener: std::net::TcpListener,
    port: u16,
    generation: u64,
    cancel: Arc<Notify>,
}

enum CallbackOutcome {
    /// Not this attempt's state; the login keeps waiting.
    Ignored,
    Continue(Url),
    Completed,
}

pub(crate) struct DesktopOAuthRuntime {
    authorization_origin: Option<String>,
    identity: Option<Arc<DesktopDeviceIdentity>>,
    active: Mutex<Option<ActiveLogin>>,
    reauthenticated: Mutex<Option<CompletedReauthentication>>,
    generations: AtomicU64,
    session: Arc<NativeCloudSession>,
}

/// ADR-0032 S2d3: the device key signs only a drain proof transcript that names this device and
/// key; any other transcript is refused inside `secure-host-core`, and no refusal text escapes.
impl crate::device_switch_drain::DrainProofSigner for DesktopOAuthRuntime {
    fn signing_key_id(&self) -> Option<&str> {
        self.identity.as_deref().map(DesktopDeviceIdentity::key_id)
    }

    fn sign_drain_proof(&self, transcript: &[u8]) -> Option<String> {
        self.identity
            .as_ref()?
            .sign_drain_proof_transcript(transcript)
            .ok()
    }
}

impl DesktopOAuthRuntime {
    pub(crate) fn new(
        cloud_origin: Option<&str>,
        authorization_origin: Option<&str>,
        identity: Option<Arc<DesktopDeviceIdentity>>,
        local_host: Arc<DesktopLocalHost>,
        power: Option<gooddealer_secure_host_core::NativePowerGate>,
    ) -> Self {
        let device_id = identity
            .as_deref()
            .map(DesktopDeviceIdentity::device_id)
            .map(str::to_owned);
        let session = Arc::new(NativeCloudSession::new(
            cloud_origin,
            device_id,
            local_host,
            power,
        ));
        Self {
            authorization_origin: authorization_origin
                .filter(|origin| valid_authorization_origin(origin))
                .map(str::to_owned),
            identity,
            active: Mutex::new(None),
            reauthenticated: Mutex::new(None),
            generations: AtomicU64::new(0),
            session,
        }
    }

    pub(crate) fn session(&self) -> &Arc<NativeCloudSession> {
        &self.session
    }

    pub(crate) fn status(&self) -> NativeOAuthStatus {
        if !self.session.is_available()
            || self.identity.is_none()
            || self.authorization_origin.is_none()
        {
            return NativeOAuthStatus::Unavailable;
        }
        if self.active.lock().is_ok_and(|active| active.is_some()) {
            NativeOAuthStatus::Pending
        } else {
            self.session.status()
        }
    }

    /// Binds a fresh loopback listener and creates the attempt that names it. A login that is
    /// still waiting is superseded rather than reported as busy, so a closed tab never strands
    /// the user.
    pub(crate) fn begin(&self) -> Result<(String, LoopbackLogin), NativeOAuthError> {
        self.begin_purpose(LoginPurpose::SignIn)
    }

    pub(crate) fn begin_forced_takeover_reauthentication(
        self: &Arc<Self>,
        app: AppHandle,
    ) -> Result<(), NativeOAuthError> {
        let (authorization_url, login) = self.begin_purpose(LoginPurpose::ForcedTakeover)?;
        let generation = login.generation;
        let browser_app = app.clone();
        tauri::async_runtime::spawn(Arc::clone(self).serve(app, login));
        if browser_app
            .opener()
            .open_url(authorization_url, None::<&str>)
            .is_err()
        {
            self.cancel(generation);
            return Err(NativeOAuthError::TransportRejected);
        }
        let _ = browser_app.emit("desktop-authentication-status", self.status());
        Ok(())
    }

    /// A local flow association, never a reauthentication proof. Cloud still validates its
    /// one-use window. Refresh, superseding login and restart invalidate this exact fence.
    pub(crate) fn forced_takeover_credential(&self) -> Result<u64, NativeOAuthError> {
        let active = self
            .active
            .lock()
            .map_err(|_| NativeOAuthError::Unavailable)?;
        if active.is_some() {
            return Err(NativeOAuthError::Busy);
        }
        let completed = self
            .reauthenticated
            .lock()
            .map_err(|_| NativeOAuthError::Unavailable)?
            .filter(|completed| completed.generation == self.generations.load(Ordering::Relaxed))
            .ok_or(NativeOAuthError::CredentialRejected)?;
        self.session
            .with_target_bootstrap_session(Some(completed.credential), || Ok(()))
            .map_err(|_| NativeOAuthError::CredentialRejected)?;
        Ok(completed.credential)
    }

    fn begin_purpose(
        &self,
        purpose: LoginPurpose,
    ) -> Result<(String, LoopbackLogin), NativeOAuthError> {
        let _attempt = self.session.begin_attempt()?;
        *self
            .reauthenticated
            .lock()
            .map_err(|_| NativeOAuthError::Unavailable)? = None;
        let origin = self
            .authorization_origin
            .as_deref()
            .ok_or(NativeOAuthError::Unavailable)?;
        let identity = self
            .identity
            .as_ref()
            .ok_or(NativeOAuthError::Unavailable)?;
        self.session.prepare_authorization_recovery()?;
        let (listener, port) = oauth_loopback::bind().map_err(|_| NativeOAuthError::Unavailable)?;
        let attempt = match purpose {
            LoginPurpose::SignIn => DesktopOAuthAttempt::begin(origin, identity, port),
            LoginPurpose::ForcedTakeover => {
                DesktopOAuthAttempt::begin_forced_takeover_reauthentication(origin, identity, port)
            }
        }
        .map_err(|_| NativeOAuthError::Unavailable)?;
        let authorization_url = attempt.authorization_url().to_string();
        let generation = self.generations.fetch_add(1, Ordering::Relaxed) + 1;
        let cancel = Arc::new(Notify::new());
        let mut active = self
            .active
            .lock()
            .map_err(|_| NativeOAuthError::Unavailable)?;
        if let Some(previous) = active.replace(ActiveLogin {
            generation,
            purpose,
            attempt: Some(attempt),
            cancel: Arc::clone(&cancel),
        }) {
            previous.cancel.notify_one();
        }
        Ok((
            authorization_url,
            LoopbackLogin {
                listener,
                port,
                generation,
                cancel,
            },
        ))
    }

    /// Stops the given login's server and ends it if it is still the current one.
    fn cancel(&self, generation: u64) {
        if let Ok(mut active) = self.active.lock()
            && active
                .as_ref()
                .is_some_and(|login| login.generation == generation)
            && let Some(login) = active.take()
        {
            login.cancel.notify_one();
        }
    }

    /// Ends the given login if it is still the current one.
    fn finish(&self, generation: u64) {
        if let Ok(mut active) = self.active.lock()
            && active
                .as_ref()
                .is_some_and(|login| login.generation == generation)
        {
            *active = None;
        }
    }

    async fn handle_callback(
        &self,
        generation: u64,
        callback: Url,
    ) -> Result<CallbackOutcome, NativeOAuthError> {
        let _attempt_guard = self.session.begin_attempt()?;
        let attempt = {
            let mut active = self
                .active
                .lock()
                .map_err(|_| NativeOAuthError::Unavailable)?;
            let Some(login) = active
                .as_mut()
                .filter(|login| login.generation == generation)
            else {
                return Err(NativeOAuthError::CallbackRejected);
            };
            if !login
                .attempt
                .as_ref()
                .is_some_and(|attempt| attempt.callback_state_matches(&callback))
            {
                return Ok(CallbackOutcome::Ignored);
            }
            login
                .attempt
                .take()
                .ok_or(NativeOAuthError::CallbackRejected)?
        };
        let identity = self
            .identity
            .as_ref()
            .ok_or(NativeOAuthError::Unavailable)?;
        match attempt
            .advance(&callback, identity)
            .map_err(|_| NativeOAuthError::CallbackRejected)?
        {
            DesktopOAuthContinuation::Authorize {
                attempt,
                authorization_url,
            } => {
                let mut active = self
                    .active
                    .lock()
                    .map_err(|_| NativeOAuthError::Unavailable)?;
                let login = active
                    .as_mut()
                    .filter(|login| login.generation == generation)
                    .ok_or(NativeOAuthError::CallbackRejected)?;
                login.attempt = Some(*attempt);
                Ok(CallbackOutcome::Continue(authorization_url))
            }
            DesktopOAuthContinuation::Exchange(exchange) => {
                let credential = self.session.exchange_authorization_code(exchange).await?;
                self.associate_reauthentication(generation, credential)?;
                Ok(CallbackOutcome::Completed)
            }
        }
    }

    fn associate_reauthentication(
        &self,
        generation: u64,
        credential: u64,
    ) -> Result<(), NativeOAuthError> {
        let active = self
            .active
            .lock()
            .map_err(|_| NativeOAuthError::Unavailable)?;
        let login = active
            .as_ref()
            .filter(|login| login.generation == generation)
            .ok_or(NativeOAuthError::CallbackRejected)?;
        if login.purpose == LoginPurpose::ForcedTakeover {
            *self
                .reauthenticated
                .lock()
                .map_err(|_| NativeOAuthError::Unavailable)? = Some(CompletedReauthentication {
                generation,
                credential,
            });
        }
        Ok(())
    }

    /// Answers browser requests on one attempt's listener until the attempt completes, fails,
    /// is superseded, or times out. Requests are served one at a time.
    async fn serve(self: Arc<Self>, app: AppHandle, login: LoopbackLogin) {
        let LoopbackLogin {
            listener,
            port,
            generation,
            cancel,
        } = login;
        if let Ok(listener) = tokio::net::TcpListener::from_std(listener) {
            let deadline = tokio::time::sleep(LOGIN_TIMEOUT);
            tokio::pin!(deadline);
            loop {
                let mut stream = tokio::select! {
                    () = cancel.notified() => return,
                    () = &mut deadline => break,
                    accepted = listener.accept() => match accepted {
                        Ok((stream, _)) => stream,
                        Err(_) => continue,
                    },
                };
                let callback = match oauth_loopback::read_request(&mut stream, port).await {
                    LoopbackRequest::Callback(callback) => callback,
                    LoopbackRequest::Unrelated => {
                        oauth_loopback::respond(&mut stream, ResultPage::NotFound).await;
                        continue;
                    }
                    LoopbackRequest::Rejected => {
                        oauth_loopback::respond(&mut stream, ResultPage::BadRequest).await;
                        continue;
                    }
                };
                match self.handle_callback(generation, callback).await {
                    Ok(CallbackOutcome::Ignored) => {
                        oauth_loopback::respond(&mut stream, ResultPage::BadRequest).await;
                    }
                    Ok(CallbackOutcome::Continue(next)) => {
                        oauth_loopback::redirect(&mut stream, &next).await;
                    }
                    Ok(CallbackOutcome::Completed) => {
                        self.finish(generation);
                        let _ = app.emit("desktop-authentication-status", self.status());
                        oauth_loopback::respond(&mut stream, ResultPage::SignedIn).await;
                        return;
                    }
                    Err(NativeOAuthError::Busy) => {
                        oauth_loopback::respond(&mut stream, ResultPage::Retry).await;
                    }
                    Err(_) => {
                        self.finish(generation);
                        let _ = app.emit("desktop-authentication-status", self.status());
                        oauth_loopback::respond(&mut stream, ResultPage::Failed).await;
                        return;
                    }
                }
            }
        }
        self.finish(generation);
        let _ = app.emit("desktop-authentication-status", self.status());
    }

    pub(crate) async fn refresh(&self) -> Result<(), NativeOAuthError> {
        if self.active.lock().is_ok_and(|active| active.is_some()) {
            return Err(NativeOAuthError::Busy);
        }
        self.session.refresh().await
    }

    pub(crate) async fn maintain_authentication(self: Arc<Self>, app: AppHandle) {
        if self.status() == NativeOAuthStatus::Unavailable {
            return;
        }
        let mut retry = MINIMUM_REFRESH_RETRY;
        loop {
            let result = self.refresh().await;
            let _ = app.emit("desktop-authentication-status", self.status());
            let delay = match result {
                Ok(()) => {
                    retry = MINIMUM_REFRESH_RETRY;
                    self.session
                        .next_access_refresh_delay()
                        .unwrap_or(SIGNED_OUT_REFRESH_POLL)
                }
                Err(NativeOAuthError::CredentialRejected) => SIGNED_OUT_REFRESH_POLL,
                Err(NativeOAuthError::Busy) => MINIMUM_REFRESH_RETRY,
                Err(NativeOAuthError::TransportRejected | NativeOAuthError::CallbackRejected) => {
                    let current = retry;
                    retry = retry.saturating_mul(2).min(MAXIMUM_REFRESH_RETRY);
                    current
                }
                Err(NativeOAuthError::Unavailable) => return,
            };
            tokio::time::sleep(delay).await;
        }
    }
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub(crate) fn desktop_authentication_status(
    runtime: State<'_, Arc<DesktopOAuthRuntime>>,
) -> NativeOAuthStatus {
    runtime.status()
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub(crate) fn desktop_authentication_begin(
    app: AppHandle,
    runtime: State<'_, Arc<DesktopOAuthRuntime>>,
) -> Result<(), String> {
    let (authorization_url, login) = runtime.begin().map_err(|error| error.to_string())?;
    let generation = login.generation;
    tauri::async_runtime::spawn(Arc::clone(runtime.inner()).serve(app.clone(), login));
    if app
        .opener()
        .open_url(authorization_url, None::<&str>)
        .is_err()
    {
        runtime.cancel(generation);
        return Err(NativeOAuthError::TransportRejected.to_string());
    }
    let _ = app.emit("desktop-authentication-status", runtime.status());
    Ok(())
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub(crate) async fn desktop_authentication_refresh(
    app: AppHandle,
    runtime: State<'_, Arc<DesktopOAuthRuntime>>,
) -> Result<(), String> {
    let result = runtime.refresh().await.map_err(|error| error.to_string());
    let _ = app.emit("desktop-authentication-status", runtime.status());
    result
}

/// The authorize page may open only on the pinned Account Web origin, never a caller-chosen host.
fn valid_authorization_origin(value: &str) -> bool {
    Url::parse(value).is_ok_and(|parsed| {
        parsed.scheme() == "https"
            && parsed.host_str() == Some("account.gooddealer.com")
            && parsed.username().is_empty()
            && parsed.password().is_none()
            && parsed.port().is_none()
            && parsed.path() == "/"
            && parsed.query().is_none()
            && parsed.fragment().is_none()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn invalid_cloud_origin_and_missing_identity_fail_closed() {
        let runtime = DesktopOAuthRuntime::new(
            Some("http://cloud.example/"),
            Some(PRODUCTION_ACCOUNT_ORIGIN),
            None,
            Arc::new(DesktopLocalHost::default()),
            None,
        );
        assert_eq!(runtime.status(), NativeOAuthStatus::Unavailable);
        assert_eq!(runtime.begin().err(), Some(NativeOAuthError::Unavailable));
    }

    #[test]
    fn authorization_origin_is_pinned_to_account_web() {
        assert!(valid_authorization_origin(PRODUCTION_ACCOUNT_ORIGIN));
        for invalid in [
            "https://api.gooddealer.com/",
            "http://account.gooddealer.com/",
            "https://account.gooddealer.com:8443/",
            "https://user@account.gooddealer.com/",
            "https://account.gooddealer.com/v1/",
            "https://account.gooddealer.com/?next=1",
            "https://account.gooddealer.com.evil.example/",
            "not a url",
        ] {
            assert!(!valid_authorization_origin(invalid), "{invalid}");
        }
    }

    #[test]
    fn only_current_dedicated_completion_records_reauthentication() {
        let runtime = DesktopOAuthRuntime::new(
            None,
            None,
            None,
            Arc::new(DesktopLocalHost::default()),
            None,
        );
        for (purpose, expected) in [
            (LoginPurpose::SignIn, false),
            (LoginPurpose::ForcedTakeover, true),
        ] {
            *runtime.active.lock().unwrap() = Some(ActiveLogin {
                generation: 2,
                purpose,
                attempt: None,
                cancel: Arc::new(Notify::new()),
            });
            *runtime.reauthenticated.lock().unwrap() = None;
            assert_eq!(
                runtime.associate_reauthentication(1, 9),
                Err(NativeOAuthError::CallbackRejected)
            );
            assert!(runtime.reauthenticated.lock().unwrap().is_none());
            runtime.associate_reauthentication(2, 9).unwrap();
            assert_eq!(runtime.reauthenticated.lock().unwrap().is_some(), expected);
            if let Some(completed) = *runtime.reauthenticated.lock().unwrap() {
                assert_eq!((completed.generation, completed.credential), (2, 9));
            }
        }
    }

    #[test]
    fn cancelled_or_failed_reauthentication_never_inherits_a_previous_login() {
        let runtime = DesktopOAuthRuntime::new(
            None,
            None,
            None,
            Arc::new(DesktopLocalHost::default()),
            None,
        );
        for cancel in [true, false] {
            *runtime.active.lock().unwrap() = Some(ActiveLogin {
                generation: 2,
                purpose: LoginPurpose::ForcedTakeover,
                attempt: None,
                cancel: Arc::new(Notify::new()),
            });
            if cancel {
                runtime.cancel(2);
            } else {
                runtime.finish(2);
            }
            assert_eq!(
                runtime.forced_takeover_credential(),
                Err(NativeOAuthError::CredentialRejected)
            );
        }
        *runtime.reauthenticated.lock().unwrap() = Some(CompletedReauthentication {
            generation: 1,
            credential: 9,
        });
        runtime.generations.store(2, Ordering::Relaxed);
        assert_eq!(
            runtime.forced_takeover_credential(),
            Err(NativeOAuthError::CredentialRejected)
        );
    }

    #[test]
    fn facade_source_has_no_bearer_exposure_method() {
        let source = include_str!("oauth_runtime.rs");
        assert!(!source.contains(&["expose", "access"].join("_")));
        assert!(!source.contains(&["Desktop", "Access", "Token"].join("")));
        assert!(!source.contains(&["Desktop", "Refresh", "Token"].join("")));
    }
}
