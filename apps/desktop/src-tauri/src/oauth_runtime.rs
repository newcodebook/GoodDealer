//! PKCE/browser and authentication-status facade. Bearer and refresh custody belongs exclusively
//! to `NativeCloudSession`.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use gooddealer_local_storage::DesktopLocalHost;
use gooddealer_secure_host_core::{
    DesktopDeviceIdentity, DesktopOAuthAttempt, DesktopOAuthContinuation,
};
use tauri::{AppHandle, Emitter as _, State};
use tauri_plugin_opener::OpenerExt as _;
use url::Url;

use crate::native_cloud_session::{NativeCloudSession, NativeOAuthError, NativeOAuthStatus};

/// Browser-facing origin of the authorize page. Account Web signs the user in on this host and
/// proxies `/v1/*` to Cloud, so its host-only session cookie reaches authorize; the API origin
/// never receives that cookie. Token, Grant, and sync calls stay on the API origin.
pub(crate) const PRODUCTION_ACCOUNT_ORIGIN: &str = "https://account.gooddealer.com/";

const SIGNED_OUT_REFRESH_POLL: Duration = Duration::from_mins(5);
const MINIMUM_REFRESH_RETRY: Duration = Duration::from_secs(1);
const MAXIMUM_REFRESH_RETRY: Duration = Duration::from_mins(1);

pub(crate) struct DesktopOAuthRuntime {
    authorization_origin: Option<String>,
    identity: Option<DesktopDeviceIdentity>,
    pending: Mutex<Option<DesktopOAuthAttempt>>,
    session: Arc<NativeCloudSession>,
}

impl DesktopOAuthRuntime {
    pub(crate) fn new(
        cloud_origin: Option<&str>,
        authorization_origin: Option<&str>,
        identity: Option<DesktopDeviceIdentity>,
        local_host: Arc<DesktopLocalHost>,
    ) -> Self {
        let device_id = identity
            .as_ref()
            .map(DesktopDeviceIdentity::device_id)
            .map(str::to_owned);
        let session = Arc::new(NativeCloudSession::new(cloud_origin, device_id, local_host));
        Self {
            authorization_origin: authorization_origin
                .filter(|origin| valid_authorization_origin(origin))
                .map(str::to_owned),
            identity,
            pending: Mutex::new(None),
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
        if self.pending.lock().is_ok_and(|pending| pending.is_some()) {
            NativeOAuthStatus::Pending
        } else {
            self.session.status()
        }
    }

    pub(crate) fn begin(&self) -> Result<String, NativeOAuthError> {
        let _attempt = self.session.begin_attempt()?;
        let origin = self
            .authorization_origin
            .as_deref()
            .ok_or(NativeOAuthError::Unavailable)?;
        let identity = self
            .identity
            .as_ref()
            .ok_or(NativeOAuthError::Unavailable)?;
        self.session.prepare_authorization_recovery()?;
        let attempt = DesktopOAuthAttempt::begin(origin, identity)
            .map_err(|_| NativeOAuthError::Unavailable)?;
        let authorization_url = attempt.authorization_url().to_string();
        let mut pending = self
            .pending
            .lock()
            .map_err(|_| NativeOAuthError::Unavailable)?;
        if pending.is_some() {
            return Err(NativeOAuthError::Busy);
        }
        *pending = Some(attempt);
        Ok(authorization_url)
    }

    pub(crate) fn cancel_pending(&self) {
        if let Ok(mut pending) = self.pending.lock() {
            *pending = None;
        }
    }

    pub(crate) async fn handle_callback(
        &self,
        callback: Url,
    ) -> Result<Option<Url>, NativeOAuthError> {
        let _attempt_guard = self.session.begin_attempt()?;
        let attempt = self
            .pending
            .lock()
            .map_err(|_| NativeOAuthError::Unavailable)?
            .take()
            .ok_or(NativeOAuthError::CallbackRejected)?;
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
                *self
                    .pending
                    .lock()
                    .map_err(|_| NativeOAuthError::Unavailable)? = Some(*attempt);
                Ok(Some(authorization_url))
            }
            DesktopOAuthContinuation::Exchange(exchange) => {
                self.session.exchange_authorization_code(exchange).await?;
                Ok(None)
            }
        }
    }

    pub(crate) async fn refresh(&self) -> Result<(), NativeOAuthError> {
        if self.pending.lock().is_ok_and(|pending| pending.is_some()) {
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
    let authorization_url = runtime.begin().map_err(|error| error.to_string())?;
    if app
        .opener()
        .open_url(authorization_url, None::<&str>)
        .is_err()
    {
        runtime.cancel_pending();
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
        );
        assert_eq!(runtime.status(), NativeOAuthStatus::Unavailable);
        assert_eq!(runtime.begin(), Err(NativeOAuthError::Unavailable));
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
    fn facade_source_has_no_bearer_exposure_method() {
        let source = include_str!("oauth_runtime.rs");
        assert!(!source.contains(&["expose", "access"].join("_")));
        assert!(!source.contains(&["Desktop", "Access", "Token"].join("")));
        assert!(!source.contains(&["Desktop", "Refresh", "Token"].join("")));
    }
}
