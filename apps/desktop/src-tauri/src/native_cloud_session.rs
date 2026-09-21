//! Sole Native owner of `GoodDealer` Cloud bearer custody and fixed-origin authentication traffic.

use std::fmt::{Display, Formatter};
use std::sync::{Arc, Mutex, OnceLock, Weak};
use std::time::{Duration, Instant};

use gooddealer_local_storage::{
    DesktopHostAuthorizationStatus, DesktopLocalHost, DesktopLocalHostError,
    DesktopNativeCloudAdmission,
};
use gooddealer_secure_host_core::{
    DesktopAccessToken, DesktopAuthorizationCodeExchange, DesktopRefreshRequestId,
    DesktopRefreshToken, clear_desktop_refresh_request_id, clear_desktop_refresh_token,
    load_desktop_refresh_request_id, load_desktop_refresh_token, store_desktop_refresh_request_id,
    store_desktop_refresh_token,
};
use reqwest::{Client, StatusCode, header};
use serde::Deserialize;
use tokio::sync::{Notify, watch};
use url::Url;
use zeroize::Zeroizing;

type SessionPublicationSubscriber = Arc<dyn Fn() + Send + Sync>;

const TOKEN_PATH: &str = "/v1/desktop-oauth/token";
const CLIENT_ID: &str = "gooddealer-desktop";
const REDIRECT_URI: &str = "gooddealer://oauth/callback";
const MAX_TOKEN_RESPONSE_BYTES: usize = 4_096;
const ACCESS_EXPIRY_SKEW: Duration = Duration::from_secs(30);
const AUTHORIZATION_GRANT_PATH: &str = "/v1/devices/authorization-grant";
const AUTHORIZATION_GRANT_REQUEST_BODY: &str = include_str!(
    "../../../../packages/protocol/test-vectors/device-identity/valid/desktop-authorization-request.json"
);
const MAX_GRANT_RESPONSE_BYTES: usize = 16_384;
const SYNC_PUSH_PATH: &str = "/v1/workspace-sync/mutations/push";
const SYNC_PULL_PATH: &str = "/v1/workspace-sync/mutations/pull";
const SYNC_CHECKPOINT_PATH: &str = "/v1/workspace-sync/checkpoint";
const CLOUDFLARE_PROJECTION_PATH: &str = "/v1/workspace-observations/cloudflare-dns";
pub(crate) const PRODUCTION_CLOUD_ORIGIN: &str = "https://api.gooddealer.com/";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DataPlaneSuspension {
    None,
    RefreshRequired,
    AuthorizationDenied,
    ProtocolBlocked,
    ConfigurationBlocked,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum NativeCloudRequestError {
    AuthorityStale,
    Unavailable,
    OutcomeUnknown,
    Retryable,
    AuthorizationRequired,
    AuthorizationDenied,
    ProtocolBlocked,
    ConfigurationBlocked,
}

pub(crate) struct NativeCloudJsonResponse {
    admission: DesktopNativeCloudAdmission,
    body: Vec<u8>,
    credential_instance: u64,
}

enum DataPlaneAttemptError {
    Request(NativeCloudRequestError),
    AuthorizationRejected(CredentialRequestHandle),
}

impl From<NativeCloudRequestError> for DataPlaneAttemptError {
    fn from(error: NativeCloudRequestError) -> Self {
        Self::Request(error)
    }
}

impl NativeCloudJsonResponse {
    pub(crate) fn into_parts(self) -> (DesktopNativeCloudAdmission, Vec<u8>, u64) {
        (self.admission, self.body, self.credential_instance)
    }
}

#[derive(Clone, Copy)]
enum DataPlaneRoute {
    SyncPush,
    SyncPull,
    SyncCheckpoint,
    CloudflareProjection,
}

impl DataPlaneRoute {
    const fn path(self) -> &'static str {
        match self {
            Self::SyncPush => SYNC_PUSH_PATH,
            Self::SyncPull => SYNC_PULL_PATH,
            Self::SyncCheckpoint => SYNC_CHECKPOINT_PATH,
            Self::CloudflareProjection => CLOUDFLARE_PROJECTION_PATH,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum NativeOAuthError {
    Unavailable,
    Busy,
    CallbackRejected,
    TransportRejected,
    CredentialRejected,
}

impl Display for NativeOAuthError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::Unavailable => "DESKTOP_AUTHENTICATION_UNAVAILABLE",
            Self::Busy => "DESKTOP_AUTHENTICATION_IN_PROGRESS",
            Self::CallbackRejected => "DESKTOP_AUTHENTICATION_CALLBACK_REJECTED",
            Self::TransportRejected => "DESKTOP_AUTHENTICATION_TRANSPORT_REJECTED",
            Self::CredentialRejected => "DESKTOP_AUTHENTICATION_CREDENTIAL_REJECTED",
        })
    }
}

impl std::error::Error for NativeOAuthError {}

#[derive(Debug, Clone, Copy, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum NativeOAuthStatus {
    Unavailable,
    SignedOut,
    Pending,
    AuthorizationFailed,
    AuthorizationRetryable,
    Authenticated,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum AuthorizationFailure {
    ReauthenticationRequired,
    RefreshRetryable,
}

pub(crate) enum RefreshWork {
    Blocked,
    RetryGrant(AccessCredential),
    RotateRefresh,
}

pub(crate) struct AccessCredential {
    pub(crate) token: DesktopAccessToken,
    pub(crate) usable_until: Instant,
}

pub(crate) struct NativeCloudSessionState {
    pub(crate) access: Option<AccessCredential>,
    pub(crate) authorization_failure: Option<AuthorizationFailure>,
    credential_instance: u64,
    revalidated_credential_instance: Option<u64>,
    data_plane_suspension: DataPlaneSuspension,
    request_cohort: Arc<()>,
    completed_refresh: Option<CompletedRefresh>,
}

struct CompletedRefresh {
    source_instance: u64,
    target_instance: u64,
    source_cohort: Weak<()>,
}

#[derive(Clone)]
struct CredentialRequestHandle {
    credential_instance: u64,
    cohort: Arc<()>,
}

struct RefreshFlight {
    source_instance: u64,
    result: watch::Sender<Option<Result<u64, NativeOAuthError>>>,
}

enum RefreshRole {
    Published(u64),
    Follow(Arc<RefreshFlight>),
    Lead {
        flight: Arc<RefreshFlight>,
        attempt: SessionAttempt,
        expected_instance: u64,
    },
}

pub(crate) struct PreparedCredentials {
    pub(crate) access: AccessCredential,
    pub(crate) refresh: DesktopRefreshToken,
}

pub(crate) trait RefreshCredentialStore: Send + Sync {
    fn load(&self) -> Result<Option<DesktopRefreshToken>, NativeOAuthError>;
    fn store(&self, token: &DesktopRefreshToken) -> Result<(), NativeOAuthError>;
    fn clear(&self) -> Result<(), NativeOAuthError>;
    fn load_request_id(&self) -> Result<Option<DesktopRefreshRequestId>, NativeOAuthError> {
        Ok(None)
    }
    fn store_request_id(
        &self,
        _request_id: &DesktopRefreshRequestId,
    ) -> Result<(), NativeOAuthError> {
        Ok(())
    }
    fn clear_request_id(&self) -> Result<(), NativeOAuthError> {
        Ok(())
    }
    fn publish_rotation(&self, token: &DesktopRefreshToken) -> Result<(), NativeOAuthError>;
}

struct SystemRefreshCredentialStore;

impl RefreshCredentialStore for SystemRefreshCredentialStore {
    fn load(&self) -> Result<Option<DesktopRefreshToken>, NativeOAuthError> {
        load_desktop_refresh_token().map_err(|_| NativeOAuthError::CredentialRejected)
    }

    fn store(&self, token: &DesktopRefreshToken) -> Result<(), NativeOAuthError> {
        store_desktop_refresh_token(token).map_err(|_| NativeOAuthError::CredentialRejected)
    }

    fn clear(&self) -> Result<(), NativeOAuthError> {
        clear_desktop_refresh_token().map_err(|_| NativeOAuthError::CredentialRejected)
    }

    fn load_request_id(&self) -> Result<Option<DesktopRefreshRequestId>, NativeOAuthError> {
        load_desktop_refresh_request_id().map_err(|_| NativeOAuthError::CredentialRejected)
    }

    fn store_request_id(
        &self,
        request_id: &DesktopRefreshRequestId,
    ) -> Result<(), NativeOAuthError> {
        store_desktop_refresh_request_id(request_id)
            .map_err(|_| NativeOAuthError::CredentialRejected)
    }

    fn clear_request_id(&self) -> Result<(), NativeOAuthError> {
        clear_desktop_refresh_request_id().map_err(|_| NativeOAuthError::CredentialRejected)
    }

    fn publish_rotation(&self, token: &DesktopRefreshToken) -> Result<(), NativeOAuthError> {
        // The Secure Host record write installs the rotated token and removes its paired request
        // identity in one Keychain replacement.
        store_desktop_refresh_token(token).map_err(|_| NativeOAuthError::CredentialRejected)
    }
}

/// One short-lived claim on the refresh/authorization single-flight.
#[derive(Default)]
struct SessionMutationState {
    closed: bool,
    active: bool,
}

#[derive(Default)]
struct SessionMutationAdmission {
    state: Mutex<SessionMutationState>,
    completed: Notify,
}

pub(crate) struct SessionAttempt(Arc<SessionMutationAdmission>);

impl Drop for SessionAttempt {
    fn drop(&mut self) {
        if let Ok(mut state) = self.0.state.lock() {
            state.active = false;
        }
        self.0.completed.notify_waiters();
    }
}

pub(crate) struct NativeCloudSession {
    cloud_origin: Option<Url>,
    device_id: Option<String>,
    local_host: Arc<DesktopLocalHost>,
    client: Client,
    pub(crate) refresh_credentials: Arc<dyn RefreshCredentialStore>,
    pub(crate) state: Mutex<NativeCloudSessionState>,
    mutation_admission: Arc<SessionMutationAdmission>,
    refresh_flight: Mutex<Option<Arc<RefreshFlight>>>,
    refresh_task: Mutex<Option<tokio::task::JoinHandle<()>>>,
    publication_subscriber: OnceLock<SessionPublicationSubscriber>,
}

impl NativeCloudSession {
    pub(crate) fn new(
        cloud_origin: Option<&str>,
        device_id: Option<String>,
        local_host: Arc<DesktopLocalHost>,
    ) -> Self {
        let cloud_origin = cloud_origin.and_then(valid_cloud_origin);
        let client = Client::builder()
            .https_only(true)
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .retry(reqwest::retry::never())
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(10))
            .build()
            .expect("fixed Native Cloud HTTP client configuration must be valid");
        let authorization_failure =
            startup_authorization_failure(local_host.authorization_status());
        Self {
            cloud_origin,
            device_id,
            local_host,
            client,
            refresh_credentials: Arc::new(SystemRefreshCredentialStore),
            state: Mutex::new(NativeCloudSessionState {
                access: None,
                authorization_failure,
                credential_instance: 0,
                revalidated_credential_instance: None,
                data_plane_suspension: DataPlaneSuspension::None,
                request_cohort: Arc::new(()),
                completed_refresh: None,
            }),
            mutation_admission: Arc::new(SessionMutationAdmission::default()),
            refresh_flight: Mutex::new(None),
            refresh_task: Mutex::new(None),
            publication_subscriber: OnceLock::new(),
        }
    }

    pub(crate) fn is_available(&self) -> bool {
        self.cloud_origin.is_some() && self.device_id.is_some()
    }

    pub(crate) fn subscribe_successful_publication(
        &self,
        subscriber: SessionPublicationSubscriber,
    ) -> bool {
        self.publication_subscriber.set(subscriber).is_ok()
    }

    pub(crate) fn begin_attempt(&self) -> Result<SessionAttempt, NativeOAuthError> {
        let mut state = self
            .mutation_admission
            .state
            .lock()
            .map_err(|_| NativeOAuthError::Unavailable)?;
        if state.closed {
            return Err(NativeOAuthError::Unavailable);
        }
        if state.active {
            return Err(NativeOAuthError::Busy);
        }
        state.active = true;
        Ok(SessionAttempt(Arc::clone(&self.mutation_admission)))
    }

    pub(crate) fn status(&self) -> NativeOAuthStatus {
        if !self.is_available() {
            return NativeOAuthStatus::Unavailable;
        }
        let Ok(mut state) = self.state.lock() else {
            return NativeOAuthStatus::Unavailable;
        };
        authentication_status(&mut state, Instant::now())
    }

    pub(crate) fn prepare_authorization_recovery(&self) -> Result<(), NativeOAuthError> {
        let recovering = self
            .state
            .lock()
            .map_err(|_| NativeOAuthError::Unavailable)?
            .authorization_failure
            .is_some();
        if !recovering {
            return Ok(());
        }
        self.refresh_credentials.clear()?;
        self.refresh_credentials.clear_request_id()?;
        self.clear_access()
    }

    pub(crate) async fn exchange_authorization_code(
        &self,
        exchange: DesktopAuthorizationCodeExchange,
    ) -> Result<(), NativeOAuthError> {
        let endpoint = self.token_endpoint()?;
        let request = exchange.expose(|code, verifier| {
            self.client
                .post(endpoint)
                .header(header::ACCEPT, "application/json")
                .form(&[
                    ("grant_type", "authorization_code"),
                    ("code", code),
                    ("code_verifier", verifier),
                    ("client_id", CLIENT_ID),
                    ("redirect_uri", REDIRECT_URI),
                ])
        });
        let credentials = Self::prepare(self.send_token_request(request).await?)?;
        let authorization_result = self
            .fetch_and_activate_authorization(&credentials.access.token)
            .await;
        self.complete_authorization_code_exchange(credentials, authorization_result)
    }

    pub(crate) fn complete_authorization_code_exchange(
        &self,
        credentials: PreparedCredentials,
        authorization_result: Result<(), NativeOAuthError>,
    ) -> Result<(), NativeOAuthError> {
        if let Err(error) = authorization_result {
            self.mark_authorization_failed(refresh_authorization_failure(error), None)?;
            return Err(error);
        }
        if self
            .refresh_credentials
            .store(&credentials.refresh)
            .is_err()
        {
            self.mark_authorization_failed(AuthorizationFailure::ReauthenticationRequired, None)?;
            return Err(NativeOAuthError::CredentialRejected);
        }
        self.commit_access(credentials.access, false)
    }

    pub(crate) async fn refresh(self: &Arc<Self>) -> Result<(), NativeOAuthError> {
        let source = {
            let state = self
                .state
                .lock()
                .map_err(|_| NativeOAuthError::Unavailable)?;
            CredentialRequestHandle {
                credential_instance: state.credential_instance,
                cohort: Arc::clone(&state.request_cohort),
            }
        };
        self.refresh_for_source(source, false).await.map(|_| ())
    }

    async fn refresh_for_source(
        self: &Arc<Self>,
        source: CredentialRequestHandle,
        rejected: bool,
    ) -> Result<u64, NativeOAuthError> {
        let role = self.select_refresh_role(&source, rejected)?;
        match role {
            RefreshRole::Published(instance) => Ok(instance),
            RefreshRole::Follow(flight) => wait_for_refresh_flight(&flight).await,
            RefreshRole::Lead {
                flight,
                attempt,
                expected_instance,
            } => {
                let session = Arc::clone(self);
                let task_flight = Arc::clone(&flight);
                let task = tokio::spawn(async move {
                    let result = session.perform_refresh(&source, expected_instance).await;
                    session.publish_refresh_result(&task_flight, result);
                    if let Ok(mut active) = session.refresh_flight.lock()
                        && active
                            .as_ref()
                            .is_some_and(|current| Arc::ptr_eq(current, &task_flight))
                    {
                        *active = None;
                    }
                    drop(attempt);
                });
                self.refresh_task
                    .lock()
                    .map_err(|_| NativeOAuthError::Unavailable)?
                    .replace(task);
                wait_for_refresh_flight(&flight).await
            }
        }
    }

    fn publish_refresh_result(
        &self,
        flight: &RefreshFlight,
        result: Result<u64, NativeOAuthError>,
    ) {
        match self.mutation_admission.state.lock() {
            Ok(state) => {
                let public_result = if state.closed {
                    Err(NativeOAuthError::Unavailable)
                } else {
                    result
                };
                // Closing admission and publishing the terminal flight result share this lock.
                // Keeping it through the watch update makes closure monotonic: shutdown can
                // overwrite an earlier success, but success can never overwrite shutdown.
                flight.result.send_replace(Some(public_result));
            }
            Err(_) => {
                flight
                    .result
                    .send_replace(Some(Err(NativeOAuthError::Unavailable)));
            }
        }
    }

    fn select_refresh_role(
        &self,
        source: &CredentialRequestHandle,
        rejected: bool,
    ) -> Result<RefreshRole, NativeOAuthError> {
        let mut mutation = self
            .mutation_admission
            .state
            .lock()
            .map_err(|_| NativeOAuthError::Unavailable)?;
        if mutation.closed {
            return Err(NativeOAuthError::Unavailable);
        }
        let mut active = self
            .refresh_flight
            .lock()
            .map_err(|_| NativeOAuthError::Unavailable)?;
        if let Some(flight) = active.as_ref() {
            return if flight.source_instance == source.credential_instance {
                Ok(RefreshRole::Follow(Arc::clone(flight)))
            } else {
                Err(NativeOAuthError::Busy)
            };
        }
        if mutation.active {
            return Err(NativeOAuthError::Busy);
        }
        // Leadership is admitted under the same close mutex before any credential-instance or
        // suspension mutation. Shutdown therefore either wins without mutation or drains the
        // complete refresh/Grant publication.
        mutation.active = true;
        let attempt = SessionAttempt(Arc::clone(&self.mutation_admission));
        drop(mutation);
        let mut state = self
            .state
            .lock()
            .map_err(|_| NativeOAuthError::Unavailable)?;
        if rejected {
            let completed_target = state.completed_refresh.as_ref().and_then(|completed| {
                (completed.source_instance == source.credential_instance
                    && completed.target_instance == state.credential_instance
                    && completed.source_cohort.upgrade().is_some()
                    && Weak::ptr_eq(&completed.source_cohort, &Arc::downgrade(&source.cohort)))
                .then_some(completed.target_instance)
            });
            if let Some(target) = completed_target {
                return Ok(RefreshRole::Published(target));
            }
            if state
                .completed_refresh
                .as_ref()
                .is_some_and(|completed| completed.source_cohort.upgrade().is_none())
            {
                state.completed_refresh = None;
            }
            if state.credential_instance != source.credential_instance {
                return Err(
                    if state.data_plane_suspension == DataPlaneSuspension::AuthorizationDenied {
                        NativeOAuthError::CredentialRejected
                    } else {
                        NativeOAuthError::Busy
                    },
                );
            }
            if state.revalidated_credential_instance == Some(source.credential_instance) {
                state.credential_instance = state
                    .credential_instance
                    .checked_add(1)
                    .ok_or(NativeOAuthError::Unavailable)?;
                state.access = None;
                state.completed_refresh = None;
                state.data_plane_suspension = DataPlaneSuspension::AuthorizationDenied;
                return Err(NativeOAuthError::CredentialRejected);
            }
            state.credential_instance = state
                .credential_instance
                .checked_add(1)
                .ok_or(NativeOAuthError::Unavailable)?;
            state.access = None;
            state.data_plane_suspension = DataPlaneSuspension::RefreshRequired;
        } else if state.credential_instance != source.credential_instance {
            return Err(NativeOAuthError::Busy);
        }
        let expected_instance = state.credential_instance;
        drop(state);
        let (result, _) = watch::channel(None);
        let flight = Arc::new(RefreshFlight {
            source_instance: source.credential_instance,
            result,
        });
        *active = Some(Arc::clone(&flight));
        Ok(RefreshRole::Lead {
            flight,
            attempt,
            expected_instance,
        })
    }

    async fn perform_refresh(
        &self,
        source: &CredentialRequestHandle,
        expected_instance: u64,
    ) -> Result<u64, NativeOAuthError> {
        let work = {
            let mut state = self
                .state
                .lock()
                .map_err(|_| NativeOAuthError::Unavailable)?;
            select_refresh_work(&mut state, Instant::now())
        };
        match work {
            RefreshWork::Blocked => return Err(NativeOAuthError::CredentialRejected),
            RefreshWork::RetryGrant(access) => {
                return self
                    .retry_authorization(access, source, expected_instance)
                    .await;
            }
            RefreshWork::RotateRefresh => {}
        }
        let refresh = self
            .refresh_credentials
            .load()?
            .ok_or(NativeOAuthError::CredentialRejected)?;
        let request_id = if let Some(request_id) = self.refresh_credentials.load_request_id()? {
            request_id
        } else {
            let request_id =
                DesktopRefreshRequestId::generate().map_err(|_| NativeOAuthError::Unavailable)?;
            self.refresh_credentials.store_request_id(&request_id)?;
            request_id
        };
        let device_id = self
            .device_id
            .as_deref()
            .ok_or(NativeOAuthError::Unavailable)?;
        let endpoint = self.token_endpoint()?;
        let request = refresh.expose(|token| {
            request_id.expose(|request_id| {
                self.client
                    .post(endpoint)
                    .header(header::ACCEPT, "application/json")
                    .form(&[
                        ("grant_type", "refresh_token"),
                        ("refresh_token", token),
                        ("device_id", device_id),
                        ("request_id", request_id),
                    ])
            })
        });
        match self.send_token_request(request).await {
            Ok(response) => {
                let credentials = match Self::prepare_refresh(response) {
                    Ok(credentials) => credentials,
                    Err(error) => {
                        self.mark_authorization_failed(refresh_authorization_failure(error), None)?;
                        return Err(error);
                    }
                };
                // Rotation persistence intentionally precedes Grant fetch/activation.
                if self
                    .refresh_credentials
                    .publish_rotation(&credentials.refresh)
                    .is_err()
                {
                    self.mark_authorization_failed(
                        AuthorizationFailure::ReauthenticationRequired,
                        None,
                    )?;
                    return Err(NativeOAuthError::CredentialRejected);
                }
                if let Err(error) = self
                    .fetch_and_activate_authorization(&credentials.access.token)
                    .await
                {
                    let failure = refresh_authorization_failure(error);
                    let retry_access = (failure == AuthorizationFailure::RefreshRetryable)
                        .then_some(credentials.access);
                    self.mark_authorization_failed(failure, retry_access)?;
                    return Err(error);
                }
                self.commit_refreshed_access(credentials.access, source, expected_instance)
            }
            Err(NativeOAuthError::CredentialRejected) => {
                self.mark_authorization_failed(
                    AuthorizationFailure::ReauthenticationRequired,
                    None,
                )?;
                Err(NativeOAuthError::CredentialRejected)
            }
            Err(error) => Err(error),
        }
    }

    async fn retry_authorization(
        &self,
        access: AccessCredential,
        source: &CredentialRequestHandle,
        expected_instance: u64,
    ) -> Result<u64, NativeOAuthError> {
        match self.fetch_and_activate_authorization(&access.token).await {
            Ok(()) => self.commit_refreshed_access(access, source, expected_instance),
            Err(error) => {
                let failure = refresh_authorization_failure(error);
                let retry_access =
                    (failure == AuthorizationFailure::RefreshRetryable).then_some(access);
                self.mark_authorization_failed(failure, retry_access)?;
                Err(error)
            }
        }
    }

    pub(crate) async fn send_sync_push(
        self: &Arc<Self>,
        admission: DesktopNativeCloudAdmission,
        request_body: Vec<u8>,
    ) -> Result<NativeCloudJsonResponse, NativeCloudRequestError> {
        self.send_data_plane(
            admission,
            request_body,
            DataPlaneRoute::SyncPush,
            1024 * 1024,
            256 * 1024,
        )
        .await
    }

    pub(crate) async fn send_sync_pull(
        self: &Arc<Self>,
        admission: DesktopNativeCloudAdmission,
        request_body: Vec<u8>,
    ) -> Result<NativeCloudJsonResponse, NativeCloudRequestError> {
        self.send_data_plane(
            admission,
            request_body,
            DataPlaneRoute::SyncPull,
            2 * 1024,
            1024 * 1024,
        )
        .await
    }

    pub(crate) async fn send_sync_checkpoint(
        self: &Arc<Self>,
        admission: DesktopNativeCloudAdmission,
        request_body: Vec<u8>,
    ) -> Result<NativeCloudJsonResponse, NativeCloudRequestError> {
        self.send_data_plane(
            admission,
            request_body,
            DataPlaneRoute::SyncCheckpoint,
            256,
            16 * 1024,
        )
        .await
    }

    pub(crate) async fn send_cloudflare_projection(
        self: &Arc<Self>,
        admission: DesktopNativeCloudAdmission,
        request_body: Vec<u8>,
    ) -> Result<NativeCloudJsonResponse, NativeCloudRequestError> {
        self.send_data_plane(
            admission,
            request_body,
            DataPlaneRoute::CloudflareProjection,
            64 * 1024,
            16 * 1024,
        )
        .await
    }

    async fn send_data_plane(
        self: &Arc<Self>,
        admission: DesktopNativeCloudAdmission,
        request_body: Vec<u8>,
        route: DataPlaneRoute,
        maximum_request_bytes: usize,
        maximum_response_bytes: usize,
    ) -> Result<NativeCloudJsonResponse, NativeCloudRequestError> {
        if request_body.is_empty() || request_body.len() > maximum_request_bytes {
            return Err(NativeCloudRequestError::ConfigurationBlocked);
        }
        match self
            .send_data_plane_attempt(
                admission,
                &request_body,
                route,
                maximum_response_bytes,
                None,
            )
            .await
        {
            Ok(response) => Ok(response),
            Err(DataPlaneAttemptError::Request(error)) => Err(error),
            Err(DataPlaneAttemptError::AuthorizationRejected(source)) => {
                let refreshed_instance = self
                    .refresh_for_source(source, true)
                    .await
                    .map_err(map_refresh_request_error)?;
                let host = Arc::clone(&self.local_host);
                let fresh_admission =
                    tokio::task::spawn_blocking(move || host.begin_native_cloud_run())
                        .await
                        .map_err(|_| NativeCloudRequestError::Unavailable)?
                        .map_err(|_| NativeCloudRequestError::AuthorityStale)?;
                match self
                    .send_data_plane_attempt(
                        fresh_admission,
                        &request_body,
                        route,
                        maximum_response_bytes,
                        Some(refreshed_instance),
                    )
                    .await
                {
                    Ok(response) => Ok(response),
                    Err(DataPlaneAttemptError::Request(error)) => Err(error),
                    Err(DataPlaneAttemptError::AuthorizationRejected(replayed)) => {
                        Err(self.invalidate_for_authorization(replayed.credential_instance))
                    }
                }
            }
        }
    }

    async fn send_data_plane_attempt(
        &self,
        admission: DesktopNativeCloudAdmission,
        request_body: &[u8],
        route: DataPlaneRoute,
        maximum_response_bytes: usize,
        expected_credential_instance: Option<u64>,
    ) -> Result<NativeCloudJsonResponse, DataPlaneAttemptError> {
        let (credential, request) =
            self.prepare_data_plane_request(request_body, route, expected_credential_instance)?;
        self.local_host
            .fast_recheck_native_cloud(&admission)
            .map_err(|_| NativeCloudRequestError::AuthorityStale)?;
        let mut response = self
            .client
            .execute(request)
            .await
            .map_err(|_| NativeCloudRequestError::OutcomeUnknown)?;
        let status = response.status();
        if matches!(status, StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN) {
            return Err(DataPlaneAttemptError::AuthorizationRejected(credential));
        }
        self.local_host
            .fast_recheck_native_cloud(&admission)
            .map_err(|_| NativeCloudRequestError::AuthorityStale)?;
        self.require_credential_instance(credential.credential_instance)?;
        if status != StatusCode::OK {
            let error = classify_non_success_status(status);
            match error {
                NativeCloudRequestError::ProtocolBlocked => {
                    self.block_protocol(credential.credential_instance)?;
                }
                NativeCloudRequestError::ConfigurationBlocked => {
                    self.block_configuration(credential.credential_instance)?;
                }
                _ => {}
            }
            return Err(DataPlaneAttemptError::Request(error));
        }
        if !response
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .is_some_and(is_json_content_type)
            || response
                .content_length()
                .is_some_and(|length| length > maximum_response_bytes as u64)
        {
            self.block_protocol(credential.credential_instance)?;
            return Err(NativeCloudRequestError::ProtocolBlocked.into());
        }
        let mut body = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| NativeCloudRequestError::OutcomeUnknown)?
        {
            self.local_host
                .fast_recheck_native_cloud(&admission)
                .map_err(|_| NativeCloudRequestError::AuthorityStale)?;
            self.require_credential_instance(credential.credential_instance)?;
            if body.len().saturating_add(chunk.len()) > maximum_response_bytes {
                self.block_protocol(credential.credential_instance)?;
                return Err(NativeCloudRequestError::ProtocolBlocked.into());
            }
            body.extend_from_slice(&chunk);
        }
        if body.is_empty() {
            self.block_protocol(credential.credential_instance)?;
            return Err(NativeCloudRequestError::ProtocolBlocked.into());
        }
        self.require_credential_instance(credential.credential_instance)?;
        self.local_host
            .fast_recheck_native_cloud(&admission)
            .map_err(|_| NativeCloudRequestError::AuthorityStale)?;
        let host = Arc::clone(&self.local_host);
        let admission = tokio::task::spawn_blocking(move || {
            host.recheck_native_cloud(&admission).map(|()| admission)
        })
        .await
        .map_err(|_| NativeCloudRequestError::Unavailable)?
        .map_err(|_| NativeCloudRequestError::AuthorityStale)?;
        Ok(NativeCloudJsonResponse {
            admission,
            body,
            credential_instance: credential.credential_instance,
        })
    }

    fn prepare_data_plane_request(
        &self,
        request_body: &[u8],
        route: DataPlaneRoute,
        expected_credential_instance: Option<u64>,
    ) -> Result<(CredentialRequestHandle, reqwest::Request), NativeCloudRequestError> {
        if self
            .mutation_admission
            .state
            .lock()
            .map_err(|_| NativeCloudRequestError::Unavailable)?
            .closed
        {
            return Err(NativeCloudRequestError::Unavailable);
        }
        let endpoint = fixed_endpoint(self.cloud_origin.as_ref(), route.path())
            .map_err(|_| NativeCloudRequestError::Unavailable)?;
        let mut state = self
            .state
            .lock()
            .map_err(|_| NativeCloudRequestError::Unavailable)?;
        if expected_credential_instance
            .is_some_and(|expected| expected != state.credential_instance)
        {
            return Err(NativeCloudRequestError::AuthorizationRequired);
        }
        match state.data_plane_suspension {
            DataPlaneSuspension::None => {}
            DataPlaneSuspension::RefreshRequired => {
                return Err(NativeCloudRequestError::AuthorizationRequired);
            }
            DataPlaneSuspension::AuthorizationDenied => {
                return Err(NativeCloudRequestError::AuthorizationDenied);
            }
            DataPlaneSuspension::ProtocolBlocked => {
                return Err(NativeCloudRequestError::ProtocolBlocked);
            }
            DataPlaneSuspension::ConfigurationBlocked => {
                return Err(NativeCloudRequestError::ConfigurationBlocked);
            }
        }
        let Some(access) = state.access.as_ref() else {
            return Err(NativeCloudRequestError::AuthorizationRequired);
        };
        if Instant::now() >= access.usable_until {
            state.access = None;
            state.data_plane_suspension = DataPlaneSuspension::RefreshRequired;
            return Err(NativeCloudRequestError::AuthorizationRequired);
        }
        let credential_instance = state.credential_instance;
        let credential = CredentialRequestHandle {
            credential_instance,
            cohort: Arc::clone(&state.request_cohort),
        };
        let request = access.token.expose(|token| {
            let authorization_value = Zeroizing::new(format!("Bearer {token}"));
            let mut authorization = header::HeaderValue::from_str(&authorization_value)
                .map_err(|_| NativeCloudRequestError::ConfigurationBlocked)?;
            authorization.set_sensitive(true);
            self.client
                .post(endpoint)
                .header(header::ACCEPT, "application/json")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::AUTHORIZATION, authorization)
                .body(request_body.to_vec())
                .build()
                .map_err(|_| NativeCloudRequestError::ConfigurationBlocked)
        })?;
        Ok((credential, request))
    }

    /// Holds the credential-instance fence across Host parsing and its final durable commit.
    /// A protocol-invalid response blocks only the matching data-plane credential instance.
    pub(crate) fn commit_response<T>(
        &self,
        credential_instance: u64,
        commit: impl FnOnce() -> Result<T, DesktopLocalHostError>,
    ) -> Result<T, NativeCloudRequestError> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| NativeCloudRequestError::Unavailable)?;
        if state.credential_instance != credential_instance
            || state.access.is_none()
            || state.data_plane_suspension != DataPlaneSuspension::None
        {
            return Err(NativeCloudRequestError::AuthorizationRequired);
        }
        match commit() {
            Ok(value) => Ok(value),
            Err(DesktopLocalHostError::CloudProtocolRejected) => {
                state.data_plane_suspension = DataPlaneSuspension::ProtocolBlocked;
                Err(NativeCloudRequestError::ProtocolBlocked)
            }
            Err(DesktopLocalHostError::AuthorityRejected) => {
                Err(NativeCloudRequestError::AuthorityStale)
            }
            Err(
                DesktopLocalHostError::ApplicationRootRejected
                | DesktopLocalHostError::StorageRejected
                | DesktopLocalHostError::Unavailable,
            ) => Err(NativeCloudRequestError::Unavailable),
        }
    }

    fn require_credential_instance(
        &self,
        credential_instance: u64,
    ) -> Result<(), NativeCloudRequestError> {
        let state = self
            .state
            .lock()
            .map_err(|_| NativeCloudRequestError::Unavailable)?;
        if state.credential_instance != credential_instance
            || state.access.is_none()
            || state.data_plane_suspension != DataPlaneSuspension::None
        {
            return Err(NativeCloudRequestError::AuthorizationRequired);
        }
        Ok(())
    }

    fn invalidate_for_authorization(&self, credential_instance: u64) -> NativeCloudRequestError {
        let Ok(mut state) = self.state.lock() else {
            return NativeCloudRequestError::Unavailable;
        };
        if state.credential_instance != credential_instance {
            return if state.data_plane_suspension == DataPlaneSuspension::AuthorizationDenied {
                NativeCloudRequestError::AuthorizationDenied
            } else {
                NativeCloudRequestError::AuthorizationRequired
            };
        }
        let repeated = state.revalidated_credential_instance == Some(credential_instance);
        state.credential_instance = state.credential_instance.saturating_add(1);
        state.access = None;
        state.data_plane_suspension = if repeated {
            DataPlaneSuspension::AuthorizationDenied
        } else {
            DataPlaneSuspension::RefreshRequired
        };
        if repeated {
            NativeCloudRequestError::AuthorizationDenied
        } else {
            NativeCloudRequestError::AuthorizationRequired
        }
    }

    fn block_protocol(&self, credential_instance: u64) -> Result<(), NativeCloudRequestError> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| NativeCloudRequestError::Unavailable)?;
        if state.credential_instance == credential_instance {
            state.data_plane_suspension = DataPlaneSuspension::ProtocolBlocked;
        }
        Ok(())
    }

    fn block_configuration(&self, credential_instance: u64) -> Result<(), NativeCloudRequestError> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| NativeCloudRequestError::Unavailable)?;
        if state.credential_instance == credential_instance {
            state.data_plane_suspension = DataPlaneSuspension::ConfigurationBlocked;
        }
        Ok(())
    }

    fn token_endpoint(&self) -> Result<Url, NativeOAuthError> {
        fixed_endpoint(self.cloud_origin.as_ref(), TOKEN_PATH)
    }

    fn authorization_grant_endpoint(&self) -> Result<Url, NativeOAuthError> {
        fixed_endpoint(self.cloud_origin.as_ref(), AUTHORIZATION_GRANT_PATH)
    }

    async fn fetch_and_activate_authorization(
        &self,
        access: &DesktopAccessToken,
    ) -> Result<(), NativeOAuthError> {
        let endpoint = self.authorization_grant_endpoint()?;
        let request = access.expose(|token| {
            let authorization_value = Zeroizing::new(format!("Bearer {token}"));
            let mut authorization = header::HeaderValue::from_str(&authorization_value)
                .map_err(|_| NativeOAuthError::CredentialRejected)?;
            authorization.set_sensitive(true);
            Ok::<_, NativeOAuthError>(
                self.client
                    .post(endpoint)
                    .header(header::ACCEPT, "application/json")
                    .header(header::CONTENT_TYPE, "application/json")
                    .header(header::AUTHORIZATION, authorization)
                    .body(AUTHORIZATION_GRANT_REQUEST_BODY),
            )
        })?;
        let mut response = request
            .send()
            .await
            .map_err(|_| NativeOAuthError::TransportRejected)?;
        if response.status() != StatusCode::OK {
            return Err(authorization_grant_response_error(response.status()));
        }
        if !response
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .is_some_and(is_json_content_type)
        {
            return Err(NativeOAuthError::CredentialRejected);
        }
        let bytes = read_bounded_response(&mut response, MAX_GRANT_RESPONSE_BYTES).await?;
        self.local_host
            .activate_authorization_grant(&bytes)
            .map_err(|_| NativeOAuthError::CredentialRejected)
    }

    async fn send_token_request(
        &self,
        request: reqwest::RequestBuilder,
    ) -> Result<TokenResponse, NativeOAuthError> {
        let mut response = request
            .send()
            .await
            .map_err(|_| NativeOAuthError::TransportRejected)?;
        if response.status() == StatusCode::BAD_REQUEST {
            if !response
                .headers()
                .get(header::CONTENT_TYPE)
                .and_then(|value| value.to_str().ok())
                .is_some_and(is_json_content_type)
            {
                return Err(NativeOAuthError::TransportRejected);
            }
            let bytes = read_bounded_response(&mut response, 512).await?;
            let error: OAuthErrorResponse =
                serde_json::from_slice(&bytes).map_err(|_| NativeOAuthError::TransportRejected)?;
            return if error.error == "invalid_grant" {
                Err(NativeOAuthError::CredentialRejected)
            } else {
                Err(NativeOAuthError::TransportRejected)
            };
        }
        if response.status() != StatusCode::OK
            || !response
                .headers()
                .get(header::CONTENT_TYPE)
                .and_then(|value| value.to_str().ok())
                .is_some_and(is_json_content_type)
        {
            return Err(NativeOAuthError::TransportRejected);
        }
        let bytes = read_bounded_response(&mut response, MAX_TOKEN_RESPONSE_BYTES).await?;
        serde_json::from_slice(&bytes).map_err(|_| NativeOAuthError::CredentialRejected)
    }

    pub(crate) fn prepare(
        response: TokenResponse,
    ) -> Result<PreparedCredentials, NativeOAuthError> {
        if response.token_type != "Bearer"
            || !(1..=900).contains(&response.expires_in)
            || !(1..=2_592_000).contains(&response.refresh_expires_in)
        {
            return Err(NativeOAuthError::CredentialRejected);
        }
        let access = DesktopAccessToken::new(response.access_token)
            .map_err(|_| NativeOAuthError::CredentialRejected)?;
        let refresh = DesktopRefreshToken::new(response.refresh_token)
            .map_err(|_| NativeOAuthError::CredentialRejected)?;
        let lifetime = Duration::from_secs(response.expires_in).saturating_sub(ACCESS_EXPIRY_SKEW);
        Ok(PreparedCredentials {
            access: AccessCredential {
                token: access,
                usable_until: Instant::now() + lifetime,
            },
            refresh,
        })
    }

    pub(crate) fn prepare_refresh(
        response: TokenResponse,
    ) -> Result<PreparedCredentials, NativeOAuthError> {
        if response
            .rotation_generation
            .is_none_or(|generation| generation == 0)
        {
            return Err(NativeOAuthError::TransportRejected);
        }
        Self::prepare(response)
    }

    fn commit_access(
        &self,
        credential: AccessCredential,
        revalidated: bool,
    ) -> Result<(), NativeOAuthError> {
        {
            let mut state = self
                .state
                .lock()
                .map_err(|_| NativeOAuthError::Unavailable)?;
            state.credential_instance = state
                .credential_instance
                .checked_add(1)
                .ok_or(NativeOAuthError::Unavailable)?;
            state.revalidated_credential_instance =
                revalidated.then_some(state.credential_instance);
            state.data_plane_suspension = DataPlaneSuspension::None;
            state.request_cohort = Arc::new(());
            state.completed_refresh = None;
            state.access = Some(credential);
            state.authorization_failure = None;
        }
        self.notify_successful_publication();
        Ok(())
    }

    fn commit_refreshed_access(
        &self,
        credential: AccessCredential,
        source: &CredentialRequestHandle,
        expected_instance: u64,
    ) -> Result<u64, NativeOAuthError> {
        let target_instance = {
            let mut state = self
                .state
                .lock()
                .map_err(|_| NativeOAuthError::Unavailable)?;
            if state.credential_instance != expected_instance {
                return Err(NativeOAuthError::Busy);
            }
            state.credential_instance = state
                .credential_instance
                .checked_add(1)
                .ok_or(NativeOAuthError::Unavailable)?;
            let target_instance = state.credential_instance;
            state.revalidated_credential_instance = Some(target_instance);
            state.data_plane_suspension = DataPlaneSuspension::None;
            state.request_cohort = Arc::new(());
            state.completed_refresh = Some(CompletedRefresh {
                source_instance: source.credential_instance,
                target_instance,
                source_cohort: Arc::downgrade(&source.cohort),
            });
            state.access = Some(credential);
            state.authorization_failure = None;
            target_instance
        };
        self.notify_successful_publication();
        Ok(target_instance)
    }

    fn notify_successful_publication(&self) {
        if let Some(subscriber) = self.publication_subscriber.get() {
            subscriber();
        }
    }

    pub(crate) fn mark_authorization_failed(
        &self,
        failure: AuthorizationFailure,
        retry_access: Option<AccessCredential>,
    ) -> Result<(), NativeOAuthError> {
        let state_result = self
            .state
            .lock()
            .map_err(|_| NativeOAuthError::Unavailable)
            .and_then(|mut state| {
                state.credential_instance = state
                    .credential_instance
                    .checked_add(1)
                    .ok_or(NativeOAuthError::Unavailable)?;
                state.access = retry_access;
                state.request_cohort = Arc::new(());
                state.completed_refresh = None;
                state.authorization_failure = Some(failure);
                state.data_plane_suspension = match failure {
                    AuthorizationFailure::ReauthenticationRequired => {
                        DataPlaneSuspension::AuthorizationDenied
                    }
                    AuthorizationFailure::RefreshRetryable => DataPlaneSuspension::RefreshRequired,
                };
                Ok(())
            });
        let refresh_result = if failure == AuthorizationFailure::ReauthenticationRequired {
            self.refresh_credentials
                .clear()
                .and_then(|()| self.refresh_credentials.clear_request_id())
        } else {
            Ok(())
        };
        let business_result = if failure == AuthorizationFailure::ReauthenticationRequired {
            self.local_host
                .enter_security_lock()
                .map_err(|_| NativeOAuthError::Unavailable)
        } else {
            // A transport failure is not signed evidence that local authority changed. Only the
            // GoodDealer data plane is suspended; SQLCipher and authorized local business stay
            // available.
            Ok(())
        };
        state_result?;
        refresh_result?;
        business_result?;
        Ok(())
    }

    fn clear_access(&self) -> Result<(), NativeOAuthError> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| NativeOAuthError::Unavailable)?;
        state.credential_instance = state
            .credential_instance
            .checked_add(1)
            .ok_or(NativeOAuthError::Unavailable)?;
        state.revalidated_credential_instance = None;
        state.data_plane_suspension = DataPlaneSuspension::RefreshRequired;
        state.request_cohort = Arc::new(());
        state.completed_refresh = None;
        state.access = None;
        Ok(())
    }

    pub(crate) fn next_access_refresh_delay(&self) -> Option<Duration> {
        let state = self.state.lock().ok()?;
        let usable_until = state.access.as_ref()?.usable_until;
        Some(
            usable_until
                .saturating_duration_since(Instant::now())
                .max(Duration::from_secs(1)),
        )
    }

    pub(crate) fn close_mutation_admission(&self) {
        if let Ok(mut state) = self.mutation_admission.state.lock() {
            state.closed = true;
        }
        if let Ok(active) = self.refresh_flight.lock()
            && let Some(flight) = active.as_ref()
        {
            flight
                .result
                .send_replace(Some(Err(NativeOAuthError::Unavailable)));
        }
    }

    pub(crate) async fn join_mutations(&self) {
        loop {
            let completed = self.mutation_admission.completed.notified();
            let active = self
                .mutation_admission
                .state
                .lock()
                .map_or(true, |state| state.active);
            if !active {
                break;
            }
            completed.await;
        }
        let refresh_task = self
            .refresh_task
            .lock()
            .ok()
            .and_then(|mut task| task.take());
        if let Some(refresh_task) = refresh_task {
            let _ = refresh_task.await;
        }
        if let Ok(mut state) = self.state.lock() {
            state.access = None;
            state.completed_refresh = None;
            state.revalidated_credential_instance = None;
            state.data_plane_suspension = DataPlaneSuspension::AuthorizationDenied;
        }
    }
}

async fn wait_for_refresh_flight(flight: &RefreshFlight) -> Result<u64, NativeOAuthError> {
    let mut result = flight.result.subscribe();
    loop {
        if let Some(outcome) = *result.borrow() {
            return outcome;
        }
        result
            .changed()
            .await
            .map_err(|_| NativeOAuthError::Unavailable)?;
    }
}

pub(crate) fn startup_authorization_failure(
    status: DesktopHostAuthorizationStatus,
) -> Option<AuthorizationFailure> {
    match status {
        DesktopHostAuthorizationStatus::SecurityLocked => {
            Some(AuthorizationFailure::ReauthenticationRequired)
        }
        DesktopHostAuthorizationStatus::RetryableLocked => {
            Some(AuthorizationFailure::RefreshRetryable)
        }
        DesktopHostAuthorizationStatus::ActivationRequired
        | DesktopHostAuthorizationStatus::Authorized
        | DesktopHostAuthorizationStatus::Continuation => None,
    }
}

pub(crate) fn authentication_status(
    state: &mut NativeCloudSessionState,
    now: Instant,
) -> NativeOAuthStatus {
    if state.authorization_failure.is_none()
        && state
            .access
            .as_ref()
            .is_some_and(|access| now < access.usable_until)
    {
        return NativeOAuthStatus::Authenticated;
    }
    match state.authorization_failure {
        Some(AuthorizationFailure::ReauthenticationRequired) => {
            state.access = None;
            NativeOAuthStatus::AuthorizationFailed
        }
        Some(AuthorizationFailure::RefreshRetryable) => NativeOAuthStatus::AuthorizationRetryable,
        None => {
            state.access = None;
            NativeOAuthStatus::SignedOut
        }
    }
}

pub(crate) fn select_refresh_work(
    state: &mut NativeCloudSessionState,
    now: Instant,
) -> RefreshWork {
    match state.authorization_failure {
        Some(AuthorizationFailure::ReauthenticationRequired) => RefreshWork::Blocked,
        Some(AuthorizationFailure::RefreshRetryable) => match state.access.take() {
            Some(access) if now < access.usable_until => RefreshWork::RetryGrant(access),
            Some(_) | None => RefreshWork::RotateRefresh,
        },
        None => RefreshWork::RotateRefresh,
    }
}

pub(crate) fn authorization_grant_response_error(status: StatusCode) -> NativeOAuthError {
    if status == StatusCode::REQUEST_TIMEOUT
        || status == StatusCode::TOO_EARLY
        || status == StatusCode::TOO_MANY_REQUESTS
        || status.is_server_error()
    {
        NativeOAuthError::TransportRejected
    } else {
        NativeOAuthError::CredentialRejected
    }
}

fn classify_non_success_status(status: StatusCode) -> NativeCloudRequestError {
    match status {
        StatusCode::REQUEST_TIMEOUT | StatusCode::TOO_EARLY | StatusCode::TOO_MANY_REQUESTS => {
            NativeCloudRequestError::Retryable
        }
        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => {
            NativeCloudRequestError::AuthorizationRequired
        }
        value if value.is_server_error() => NativeCloudRequestError::Retryable,
        value if value.is_client_error() => NativeCloudRequestError::ConfigurationBlocked,
        _ => NativeCloudRequestError::ProtocolBlocked,
    }
}

pub(crate) fn refresh_authorization_failure(error: NativeOAuthError) -> AuthorizationFailure {
    if error == NativeOAuthError::TransportRejected {
        AuthorizationFailure::RefreshRetryable
    } else {
        AuthorizationFailure::ReauthenticationRequired
    }
}

const fn map_refresh_request_error(error: NativeOAuthError) -> NativeCloudRequestError {
    match error {
        NativeOAuthError::CredentialRejected => NativeCloudRequestError::AuthorizationDenied,
        NativeOAuthError::TransportRejected => NativeCloudRequestError::Retryable,
        NativeOAuthError::Unavailable => NativeCloudRequestError::Unavailable,
        NativeOAuthError::Busy | NativeOAuthError::CallbackRejected => {
            NativeCloudRequestError::AuthorizationRequired
        }
    }
}

pub(crate) async fn read_bounded_response(
    response: &mut reqwest::Response,
    maximum_bytes: usize,
) -> Result<Vec<u8>, NativeOAuthError> {
    let declared = response.content_length();
    if declared.is_some_and(|length| length > maximum_bytes as u64) {
        return Err(NativeOAuthError::CredentialRejected);
    }
    let capacity = declared
        .and_then(|length| usize::try_from(length).ok())
        .unwrap_or(512);
    let mut bytes = Vec::with_capacity(capacity);
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| NativeOAuthError::TransportRejected)?
    {
        if bytes.len().saturating_add(chunk.len()) > maximum_bytes {
            return Err(NativeOAuthError::CredentialRejected);
        }
        bytes.extend_from_slice(&chunk);
    }
    if bytes.is_empty() || bytes.len() > maximum_bytes {
        return Err(NativeOAuthError::CredentialRejected);
    }
    Ok(bytes)
}

fn fixed_endpoint(origin: Option<&Url>, path: &str) -> Result<Url, NativeOAuthError> {
    let mut endpoint = origin.cloned().ok_or(NativeOAuthError::Unavailable)?;
    endpoint.set_path(path);
    Ok(endpoint)
}

fn is_json_content_type(value: &str) -> bool {
    let mut parts = value.split(';').map(str::trim);
    if !parts
        .next()
        .is_some_and(|media| media.eq_ignore_ascii_case("application/json"))
    {
        return false;
    }
    match (parts.next(), parts.next()) {
        (None, None) => true,
        (Some(parameter), None) => parameter.eq_ignore_ascii_case("charset=utf-8"),
        _ => false,
    }
}

fn valid_cloud_origin(value: &str) -> Option<Url> {
    let parsed = Url::parse(value).ok()?;
    (parsed.scheme() == "https"
        && parsed.host_str() == Some("api.gooddealer.com")
        && parsed.username().is_empty()
        && parsed.password().is_none()
        && parsed.port().is_none()
        && parsed.path() == "/"
        && parsed.query().is_none()
        && parsed.fragment().is_none())
    .then_some(parsed)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct TokenResponse {
    token_type: String,
    access_token: String,
    expires_in: u64,
    refresh_token: String,
    refresh_expires_in: u64,
    #[serde(default)]
    rotation_generation: Option<u64>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct OAuthErrorResponse {
    error: String,
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::*;

    struct ScriptedRefreshCredentialStore {
        events: Arc<Mutex<Vec<&'static str>>>,
        reject_store: bool,
    }

    impl RefreshCredentialStore for ScriptedRefreshCredentialStore {
        fn load(&self) -> Result<Option<DesktopRefreshToken>, NativeOAuthError> {
            panic!("test does not permit refresh credential loads")
        }

        fn store(&self, _token: &DesktopRefreshToken) -> Result<(), NativeOAuthError> {
            self.events.lock().unwrap().push("store");
            if self.reject_store {
                Err(NativeOAuthError::CredentialRejected)
            } else {
                Ok(())
            }
        }

        fn clear(&self) -> Result<(), NativeOAuthError> {
            self.events.lock().unwrap().push("clear");
            Ok(())
        }

        fn publish_rotation(&self, _token: &DesktopRefreshToken) -> Result<(), NativeOAuthError> {
            self.events.lock().unwrap().push("publish_rotation");
            if self.reject_store {
                Err(NativeOAuthError::CredentialRejected)
            } else {
                Ok(())
            }
        }
    }

    fn session() -> NativeCloudSession {
        NativeCloudSession::new(None, None, Arc::new(DesktopLocalHost::default()))
    }

    fn prepared_credentials() -> PreparedCredentials {
        PreparedCredentials {
            access: AccessCredential {
                token: DesktopAccessToken::new(format!("gd_at1.YQ.{}", "A".repeat(43))).unwrap(),
                usable_until: Instant::now() + Duration::from_mins(1),
            },
            refresh: DesktopRefreshToken::new(format!("gd_rt1.YQ.{}", "R".repeat(43))).unwrap(),
        }
    }

    fn request_handle(session: &NativeCloudSession) -> CredentialRequestHandle {
        let state = session.state.lock().unwrap();
        CredentialRequestHandle {
            credential_instance: state.credential_instance,
            cohort: Arc::clone(&state.request_cohort),
        }
    }

    #[test]
    fn token_response_shape_and_rotation_generation_are_exact() {
        let valid = format!(
            r#"{{"token_type":"Bearer","access_token":"gd_at1.YQ.{}","expires_in":900,"refresh_token":"gd_rt1.YQ.{}","refresh_expires_in":2592000}}"#,
            "A".repeat(43),
            "R".repeat(43)
        );
        assert!(serde_json::from_str::<TokenResponse>(&valid).is_ok());
        let with_extra = valid.replace('}', ",\"extra\":true}");
        assert!(serde_json::from_str::<TokenResponse>(&with_extra).is_err());
        assert_eq!(
            NativeCloudSession::prepare_refresh(
                serde_json::from_str::<TokenResponse>(&valid).unwrap()
            )
            .err()
            .unwrap(),
            NativeOAuthError::TransportRejected
        );
        let rotated = valid.replace('}', ",\"rotation_generation\":2}");
        assert!(
            NativeCloudSession::prepare_refresh(
                serde_json::from_str::<TokenResponse>(&rotated).unwrap()
            )
            .is_ok()
        );
    }

    #[test]
    fn initial_exchange_publishes_access_only_after_grant_and_refresh_persistence() {
        let events = Arc::new(Mutex::new(Vec::new()));
        let mut session = session();
        session.refresh_credentials = Arc::new(ScriptedRefreshCredentialStore {
            events: Arc::clone(&events),
            reject_store: false,
        });
        session
            .complete_authorization_code_exchange(prepared_credentials(), Ok(()))
            .unwrap();
        assert_eq!(*events.lock().unwrap(), vec!["store"]);
        assert!(session.state.lock().unwrap().access.is_some());
    }

    #[test]
    fn failed_grant_or_refresh_persistence_never_exposes_access() {
        for (authorization, reject_store, expected_events) in [
            (Err(NativeOAuthError::TransportRejected), false, vec![]),
            (Ok(()), true, vec!["store", "clear"]),
        ] {
            let events = Arc::new(Mutex::new(Vec::new()));
            let mut session = session();
            session.refresh_credentials = Arc::new(ScriptedRefreshCredentialStore {
                events: Arc::clone(&events),
                reject_store,
            });
            assert!(
                session
                    .complete_authorization_code_exchange(prepared_credentials(), authorization)
                    .is_err()
            );
            assert_eq!(*events.lock().unwrap(), expected_events);
            assert!(session.state.lock().unwrap().access.is_none());
        }
    }

    #[test]
    fn refresh_and_authorization_exchange_share_one_single_flight() {
        let session = session();
        let attempt = session.begin_attempt().unwrap();
        assert_eq!(session.begin_attempt().err(), Some(NativeOAuthError::Busy));
        drop(attempt);
        assert!(session.begin_attempt().is_ok());
    }

    #[test]
    fn rotated_refresh_publication_is_one_store_operation_that_consumes_request_identity() {
        let events = Arc::new(Mutex::new(Vec::new()));
        let store = ScriptedRefreshCredentialStore {
            events: Arc::clone(&events),
            reject_store: false,
        };
        store
            .publish_rotation(&prepared_credentials().refresh)
            .unwrap();
        assert_eq!(*events.lock().unwrap(), vec!["publish_rotation"]);
    }

    #[tokio::test]
    async fn same_cohort_joins_one_refresh_and_late_rejection_reuses_only_its_publication() {
        let session = Arc::new(session());
        session
            .commit_access(prepared_credentials().access, false)
            .unwrap();
        let first = request_handle(&session);
        let concurrent = first.clone();
        let late = first.clone();
        let source_instance = first.credential_instance;
        let publications = Arc::new(AtomicUsize::new(0));
        let publication_count = Arc::clone(&publications);
        assert!(session.subscribe_successful_publication(Arc::new(move || {
            publication_count.fetch_add(1, Ordering::SeqCst);
        })));

        let expected_instance = {
            let mut state = session.state.lock().unwrap();
            state.credential_instance += 1;
            state.access = None;
            state.data_plane_suspension = DataPlaneSuspension::RefreshRequired;
            state.credential_instance
        };
        let (result, _) = watch::channel(None);
        let flight = Arc::new(RefreshFlight {
            source_instance,
            result,
        });
        *session.refresh_flight.lock().unwrap() = Some(Arc::clone(&flight));

        let first_session = Arc::clone(&session);
        let first_waiter =
            tokio::spawn(async move { first_session.refresh_for_source(first, true).await });
        let concurrent_session = Arc::clone(&session);
        let concurrent_waiter = tokio::spawn(async move {
            concurrent_session
                .refresh_for_source(concurrent, true)
                .await
        });
        tokio::task::yield_now().await;

        let target = session
            .commit_refreshed_access(prepared_credentials().access, &late, expected_instance)
            .unwrap();
        flight.result.send_replace(Some(Ok(target)));
        *session.refresh_flight.lock().unwrap() = None;

        assert_eq!(first_waiter.await.unwrap(), Ok(target));
        assert_eq!(concurrent_waiter.await.unwrap(), Ok(target));
        assert_eq!(session.refresh_for_source(late, true).await, Ok(target));
        assert_eq!(publications.load(Ordering::SeqCst), 1);
        assert_eq!(session.state.lock().unwrap().credential_instance, target);

        let replay = request_handle(&session);
        assert_eq!(
            session.refresh_for_source(replay, true).await,
            Err(NativeOAuthError::CredentialRejected)
        );
        assert_eq!(
            session.state.lock().unwrap().data_plane_suspension,
            DataPlaneSuspension::AuthorizationDenied
        );
        session
            .commit_access(prepared_credentials().access, false)
            .unwrap();
        assert!(session.state.lock().unwrap().credential_instance > target);
    }

    #[tokio::test]
    async fn shutdown_closes_all_mutation_admission_releases_followers_and_drains_active_work() {
        let session = Arc::new(session());
        let admitted = session.begin_attempt().unwrap();
        let (result, _) = watch::channel(None);
        let flight = Arc::new(RefreshFlight {
            source_instance: 7,
            result,
        });
        *session.refresh_flight.lock().unwrap() = Some(Arc::clone(&flight));
        let follower = tokio::spawn({
            let flight = Arc::clone(&flight);
            async move { wait_for_refresh_flight(&flight).await }
        });

        session.close_mutation_admission();
        assert_eq!(
            session.begin_attempt().err(),
            Some(NativeOAuthError::Unavailable)
        );
        assert_eq!(follower.await.unwrap(), Err(NativeOAuthError::Unavailable));
        session.publish_refresh_result(&flight, Ok(8));
        assert_eq!(
            wait_for_refresh_flight(&flight).await,
            Err(NativeOAuthError::Unavailable)
        );
        assert!(matches!(
            session.select_refresh_role(
                &CredentialRequestHandle {
                    credential_instance: 7,
                    cohort: Arc::new(()),
                },
                true,
            ),
            Err(NativeOAuthError::Unavailable)
        ));

        let drain = tokio::spawn({
            let session = Arc::clone(&session);
            async move { session.join_mutations().await }
        });
        tokio::time::sleep(Duration::from_millis(1)).await;
        assert!(!drain.is_finished());
        drop(admitted);
        tokio::time::timeout(Duration::from_secs(1), drain)
            .await
            .unwrap()
            .unwrap();
        assert!(session.state.lock().unwrap().access.is_none());
    }

    #[tokio::test]
    async fn shutdown_overwrites_a_refresh_result_published_before_close() {
        let session = session();
        let (result, _) = watch::channel(None);
        let flight = Arc::new(RefreshFlight {
            source_instance: 7,
            result,
        });
        *session.refresh_flight.lock().unwrap() = Some(Arc::clone(&flight));

        session.publish_refresh_result(&flight, Ok(8));
        session.close_mutation_admission();

        assert_eq!(
            wait_for_refresh_flight(&flight).await,
            Err(NativeOAuthError::Unavailable)
        );
    }

    #[tokio::test]
    async fn shutdown_close_wins_before_any_rejection_state_mutation() {
        let session = Arc::new(session());
        session
            .commit_access(prepared_credentials().access, false)
            .unwrap();
        let rejected = request_handle(&session);
        let before = {
            let state = session.state.lock().unwrap();
            (
                state.credential_instance,
                state.access.is_some(),
                state.data_plane_suspension,
            )
        };
        session.close_mutation_admission();
        assert!(matches!(
            session.select_refresh_role(&rejected, true),
            Err(NativeOAuthError::Unavailable)
        ));
        let after = {
            let state = session.state.lock().unwrap();
            (
                state.credential_instance,
                state.access.is_some(),
                state.data_plane_suspension,
            )
        };
        assert_eq!(after, before);
    }

    #[test]
    fn refresh_leader_early_return_releases_admission_without_reentrant_deadlock() {
        let session = Arc::new(session());
        session
            .commit_access(prepared_credentials().access, false)
            .unwrap();
        let stale = request_handle(&session);
        session
            .commit_access(prepared_credentials().access, false)
            .unwrap();
        let (result_tx, result_rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let result = session.select_refresh_role(&stale, false);
            result_tx.send(result.err()).unwrap();
        });
        assert_eq!(
            result_rx.recv_timeout(Duration::from_secs(1)).unwrap(),
            Some(NativeOAuthError::Busy)
        );
    }

    #[test]
    fn authorization_status_precedes_old_admission_and_instance_fences_and_replay_is_once() {
        let source = include_str!("native_cloud_session.rs");
        let send_start = source.find("    async fn send_data_plane(").unwrap();
        let attempt_start = source
            .find("    async fn send_data_plane_attempt(")
            .unwrap();
        let send = &source[send_start..attempt_start];
        assert_eq!(send.matches(".send_data_plane_attempt(").count(), 2);
        assert_eq!(send.matches("begin_native_cloud_run()").count(), 1);
        assert_eq!(send.matches("&request_body").count(), 2);

        let prepare_start = source.find("    fn prepare_data_plane_request(").unwrap();
        let attempt = &source[attempt_start..prepare_start];
        let execute = attempt
            .find(".client\n            .execute(request)")
            .unwrap();
        let post_response = &attempt[execute..];
        let status = post_response
            .find("let status = response.status()")
            .unwrap();
        let authorization = post_response
            .find("StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN")
            .unwrap();
        let host_fence = post_response
            .find(".fast_recheck_native_cloud(&admission)")
            .unwrap();
        let credential_fence = post_response
            .find("self.require_credential_instance(")
            .unwrap();
        assert!(status < authorization);
        assert!(authorization < host_fence);
        assert!(host_fence < credential_fence);
    }

    #[test]
    fn replay_request_never_borrows_a_later_credential_generation() {
        let session = NativeCloudSession::new(
            Some("https://api.gooddealer.com/"),
            None,
            Arc::new(DesktopLocalHost::default()),
        );
        session
            .commit_access(prepared_credentials().access, false)
            .unwrap();
        let source = request_handle(&session);
        let expected_instance = source.credential_instance;
        let refreshed = session
            .commit_refreshed_access(prepared_credentials().access, &source, expected_instance)
            .unwrap();
        session
            .commit_access(prepared_credentials().access, true)
            .unwrap();

        assert!(matches!(
            session.prepare_data_plane_request(
                br#"{"schemaVersion":2}"#,
                DataPlaneRoute::SyncPush,
                Some(refreshed),
            ),
            Err(NativeCloudRequestError::AuthorizationRequired)
        ));
    }

    #[test]
    fn fixed_origin_and_json_content_type_are_closed() {
        assert!(valid_cloud_origin(PRODUCTION_CLOUD_ORIGIN).is_some());
        for invalid in [
            "http://api.gooddealer.com/",
            "https://user@api.gooddealer.com/",
            "https://api.gooddealer.com:8443/",
            "https://api.gooddealer.com/path",
            "https://api.gooddealer.com/?query=1",
            "https://api.gooddealer.com/#fragment",
            "https://api.gooddealer.com.evil.example/",
            "https://xn--api-gooddealer-9za.com/",
            "https://127.0.0.1/",
        ] {
            assert!(valid_cloud_origin(invalid).is_none(), "{invalid}");
        }
        for valid in ["application/json", "application/json; charset=utf-8"] {
            assert!(is_json_content_type(valid));
        }
        for invalid in [
            "text/json",
            "application/json; charset=utf-16",
            "application/json; charset=utf-8; q=1",
        ] {
            assert!(!is_json_content_type(invalid));
        }
    }

    #[test]
    fn data_plane_routes_statuses_and_caps_are_fixed() {
        assert_eq!(DataPlaneRoute::SyncPush.path(), SYNC_PUSH_PATH);
        assert_eq!(DataPlaneRoute::SyncPull.path(), SYNC_PULL_PATH);
        assert_eq!(DataPlaneRoute::SyncCheckpoint.path(), SYNC_CHECKPOINT_PATH);
        assert_eq!(
            DataPlaneRoute::CloudflareProjection.path(),
            CLOUDFLARE_PROJECTION_PATH
        );
        for status in [
            StatusCode::REQUEST_TIMEOUT,
            StatusCode::TOO_EARLY,
            StatusCode::TOO_MANY_REQUESTS,
            StatusCode::INTERNAL_SERVER_ERROR,
        ] {
            assert_eq!(
                classify_non_success_status(status),
                NativeCloudRequestError::Retryable
            );
        }
        for status in [StatusCode::UNAUTHORIZED, StatusCode::FORBIDDEN] {
            assert_eq!(
                classify_non_success_status(status),
                NativeCloudRequestError::AuthorizationRequired
            );
        }
        assert_eq!(
            classify_non_success_status(StatusCode::UNPROCESSABLE_ENTITY),
            NativeCloudRequestError::ConfigurationBlocked
        );
        assert_eq!(
            classify_non_success_status(StatusCode::NO_CONTENT),
            NativeCloudRequestError::ProtocolBlocked
        );
    }

    #[test]
    fn authorization_and_protocol_blocks_are_credential_instance_fenced() {
        let session = session();
        session
            .commit_access(prepared_credentials().access, false)
            .unwrap();
        let first = session.state.lock().unwrap().credential_instance;
        assert_eq!(
            session.invalidate_for_authorization(first),
            NativeCloudRequestError::AuthorizationRequired
        );
        assert_eq!(
            session.state.lock().unwrap().data_plane_suspension,
            DataPlaneSuspension::RefreshRequired
        );

        session
            .commit_access(prepared_credentials().access, true)
            .unwrap();
        let revalidated = session.state.lock().unwrap().credential_instance;
        assert_eq!(
            session.invalidate_for_authorization(revalidated),
            NativeCloudRequestError::AuthorizationDenied
        );
        assert_eq!(
            session.state.lock().unwrap().data_plane_suspension,
            DataPlaneSuspension::AuthorizationDenied
        );

        session
            .commit_access(prepared_credentials().access, false)
            .unwrap();
        let current = session.state.lock().unwrap().credential_instance;
        session.block_protocol(current).unwrap();
        assert_eq!(
            session.state.lock().unwrap().data_plane_suspension,
            DataPlaneSuspension::ProtocolBlocked
        );
        session
            .commit_access(prepared_credentials().access, false)
            .unwrap();
        assert_eq!(
            session.state.lock().unwrap().data_plane_suspension,
            DataPlaneSuspension::None
        );
    }

    #[test]
    fn stale_parser_failure_cannot_block_a_newer_credential_instance() {
        let session = session();
        session
            .commit_access(prepared_credentials().access, false)
            .unwrap();
        let stale = session.state.lock().unwrap().credential_instance;
        session
            .commit_access(prepared_credentials().access, false)
            .unwrap();
        let current = session.state.lock().unwrap().credential_instance;
        assert_ne!(stale, current);

        assert_eq!(
            session.commit_response::<()>(stale, || {
                Err(DesktopLocalHostError::CloudProtocolRejected)
            }),
            Err(NativeCloudRequestError::AuthorizationRequired)
        );
        assert_eq!(
            session.state.lock().unwrap().data_plane_suspension,
            DataPlaneSuspension::None
        );

        assert_eq!(
            session.commit_response::<()>(current, || {
                Err(DesktopLocalHostError::CloudProtocolRejected)
            }),
            Err(NativeCloudRequestError::ProtocolBlocked)
        );
        assert_eq!(
            session.state.lock().unwrap().data_plane_suspension,
            DataPlaneSuspension::ProtocolBlocked
        );
    }

    #[test]
    fn stale_host_authority_rejects_commit_without_blocking_the_data_plane() {
        let session = session();
        session
            .commit_access(prepared_credentials().access, false)
            .unwrap();
        let current = session.state.lock().unwrap().credential_instance;

        assert_eq!(
            session.commit_response::<()>(current, || {
                Err(DesktopLocalHostError::AuthorityRejected)
            }),
            Err(NativeCloudRequestError::AuthorityStale)
        );
        assert_eq!(
            session.state.lock().unwrap().data_plane_suspension,
            DataPlaneSuspension::None
        );
    }
}
