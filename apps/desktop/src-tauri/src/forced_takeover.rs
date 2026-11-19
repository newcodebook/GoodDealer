//! Target forced takeover control. Host owns approved scope, durable intent and reconciliation;
//! Native binds unconfirmed previews to this process's completed browser reauthentication.

use std::future::Future;
use std::sync::{Arc, Mutex as StdMutex};

use gooddealer_local_storage::{
    DesktopForcedTakeoverExchange, DesktopForcedTakeoverExchangeKind, DesktopForcedTakeoverPreview,
    DesktopForcedTakeoverView, DesktopForcedTakeoverWork, DesktopLocalHost, DesktopLocalHostError,
    DesktopNativeCloudAdmission,
};
use gooddealer_secure_host_core::NativePowerGate;
use tokio::sync::Mutex;
use zeroize::Zeroizing;

use crate::native_cloud_runtime::NativeCloudCancelFence;
use crate::native_cloud_session::{NativeCloudRequestError, NativeCloudSession};
use crate::oauth_runtime::DesktopOAuthRuntime;
use crate::target_bootstrap_termination::{TargetBootstrapError, TargetBootstrapPower};

pub(crate) struct ForcedTakeoverAdvance {
    pub(crate) more: bool,
}

pub(crate) enum ForcedWork<E> {
    Exchange(E),
    ResumeInstallation,
    Settled(DesktopForcedTakeoverView),
}

// These seams retain the real coordinator's ordering in crash/concurrency tests. They expose
// neither alternate production backends nor any authority/secret constructor to Renderer.
pub(crate) trait ForcedHost: Send + Sync + 'static {
    type Admission: Send + 'static;
    type Exchange: Send + Sync + 'static;
    fn admit(&self) -> Result<Self::Admission, DesktopLocalHostError>;
    fn recheck(&self, admission: &Self::Admission) -> Result<(), DesktopLocalHostError>;
    fn preview(&self, admission: &Self::Admission)
    -> Result<Self::Exchange, DesktopLocalHostError>;
    fn complete_preview(
        &self,
        admission: &Self::Admission,
        exchange: &Self::Exchange,
        wire: &[u8],
    ) -> Result<DesktopForcedTakeoverPreview, DesktopLocalHostError>;
    fn confirm(
        &self,
        admission: &Self::Admission,
        preview: &str,
    ) -> Result<DesktopForcedTakeoverView, DesktopLocalHostError>;
    fn status(
        &self,
        admission: &Self::Admission,
    ) -> Result<DesktopForcedTakeoverView, DesktopLocalHostError>;
    fn cancel(
        &self,
        admission: &Self::Admission,
        intent: &str,
    ) -> Result<DesktopForcedTakeoverView, DesktopLocalHostError>;
    fn prepare(
        &self,
        admission: &Self::Admission,
    ) -> Result<ForcedWork<Self::Exchange>, DesktopLocalHostError>;
    fn kind(exchange: &Self::Exchange) -> DesktopForcedTakeoverExchangeKind;
    fn body(exchange: &Self::Exchange) -> Zeroizing<Vec<u8>>;
    fn complete(
        &self,
        admission: &Self::Admission,
        exchange: &Self::Exchange,
        wire: &[u8],
    ) -> Result<DesktopForcedTakeoverView, DesktopLocalHostError>;
}

pub(crate) trait ForcedCloud<A>: Send + Sync + 'static {
    fn session<T>(
        &self,
        credential: Option<u64>,
        work: impl FnOnce() -> Result<T, DesktopLocalHostError>,
    ) -> Result<(T, u64), NativeCloudRequestError>;
    fn send(
        &self,
        admission: A,
        kind: DesktopForcedTakeoverExchangeKind,
        body: Zeroizing<Vec<u8>>,
        credential: u64,
    ) -> impl Future<Output = Result<(A, Zeroizing<Vec<u8>>, u64), NativeCloudRequestError>> + Send;
}

pub(crate) type DesktopForcedTakeover =
    ForcedTakeover<DesktopLocalHost, NativeCloudSession, NativePowerGate>;

pub(crate) struct ForcedTakeover<H, C, P> {
    host: Arc<H>,
    cloud: Arc<C>,
    fence: Arc<NativeCloudCancelFence>,
    power: Arc<P>,
    wake: Arc<dyn Fn() + Send + Sync>,
    wake_installation: Arc<dyn Fn() + Send + Sync>,
    serialized: Arc<Mutex<()>>,
    preview_credential: StdMutex<Option<(String, u64)>>,
}

impl<H, C, P> ForcedTakeover<H, C, P>
where
    H: ForcedHost,
    C: ForcedCloud<H::Admission>,
    P: TargetBootstrapPower,
{
    pub(crate) fn new(
        host: Arc<H>,
        cloud: Arc<C>,
        fence: Arc<NativeCloudCancelFence>,
        power: Arc<P>,
        wake: Arc<dyn Fn() + Send + Sync>,
        wake_installation: Arc<dyn Fn() + Send + Sync>,
        serialized: Arc<Mutex<()>>,
    ) -> Self {
        Self {
            host,
            cloud,
            fence,
            power,
            wake,
            wake_installation,
            serialized,
            preview_credential: StdMutex::new(None),
        }
    }

    pub(crate) async fn preview(
        &self,
        oauth: &DesktopOAuthRuntime,
    ) -> Result<DesktopForcedTakeoverPreview, TargetBootstrapError> {
        let credential = oauth
            .forced_takeover_credential()
            .map_err(|_| TargetBootstrapError::AuthorizationRequired)?;
        self.preview_authenticated(credential).await
    }

    async fn preview_authenticated(
        &self,
        credential: u64,
    ) -> Result<DesktopForcedTakeoverPreview, TargetBootstrapError> {
        let _serial = self.serialized.lock().await;
        *self
            .preview_credential
            .lock()
            .map_err(|_| TargetBootstrapError::Blocked)? = None;
        let epoch = self.power.epoch()?;
        let ((admission, exchange), credential) = self
            .stage(Some(credential), |host| {
                let admission = host.admit()?;
                let exchange = host.preview(&admission)?;
                Ok((admission, exchange))
            })
            .await?;
        let (admission, wire, credential) =
            self.send(epoch, credential, admission, &exchange).await?;
        let ((admission, preview), credential) = self
            .stage(Some(credential), move |host| {
                let preview = host.complete_preview(&admission, &exchange, &wire)?;
                Ok((admission, preview))
            })
            .await?;
        self.check(epoch, credential, &admission)?;
        if let DesktopForcedTakeoverPreview::Available { preview_id, .. } = &preview {
            *self
                .preview_credential
                .lock()
                .map_err(|_| TargetBootstrapError::Blocked)? =
                Some((preview_id.clone(), credential));
        }
        Ok(preview)
    }

    pub(crate) async fn confirm(
        &self,
        oauth: &DesktopOAuthRuntime,
        preview_id: &str,
    ) -> Result<DesktopForcedTakeoverView, TargetBootstrapError> {
        let credential = oauth
            .forced_takeover_credential()
            .map_err(|_| TargetBootstrapError::AuthorizationRequired)?;
        self.confirm_authenticated(credential, preview_id).await
    }

    async fn confirm_authenticated(
        &self,
        credential: u64,
        preview_id: &str,
    ) -> Result<DesktopForcedTakeoverView, TargetBootstrapError> {
        validate_id(preview_id)?;
        let _serial = self.serialized.lock().await;
        let matches = self
            .preview_credential
            .lock()
            .map_err(|_| TargetBootstrapError::Blocked)?
            .as_ref()
            .is_some_and(|(approved, instance)| approved == preview_id && *instance == credential);
        if !matches {
            return Err(TargetBootstrapError::AuthorizationRequired);
        }
        let epoch = self.power.epoch()?;
        let preview_id = preview_id.to_owned();
        let ((admission, view), credential) = self
            .stage(Some(credential), move |host| {
                let admission = host.admit()?;
                let view = host.confirm(&admission, &preview_id)?;
                Ok((admission, view))
            })
            .await?;
        *self
            .preview_credential
            .lock()
            .map_err(|_| TargetBootstrapError::Blocked)? = None;
        self.check(epoch, credential, &admission)?;
        (self.wake)();
        Ok(view)
    }

    pub(crate) async fn status(&self) -> Result<DesktopForcedTakeoverView, TargetBootstrapError> {
        let _serial = self.serialized.lock().await;
        let epoch = self.power.epoch()?;
        let (admission, view) = self
            .local_stage(|host| {
                let admission = host.admit()?;
                let view = host.status(&admission)?;
                Ok((admission, view))
            })
            .await?;
        self.local_check(epoch, &admission)?;
        Ok(view)
    }

    pub(crate) async fn cancel(
        &self,
        intent_id: &str,
    ) -> Result<DesktopForcedTakeoverView, TargetBootstrapError> {
        validate_id(intent_id)?;
        let _serial = self.serialized.lock().await;
        let epoch = self.power.epoch()?;
        let intent_id = intent_id.to_owned();
        let (admission, view) = self
            .local_stage(move |host| {
                let admission = host.admit()?;
                let view = host.cancel(&admission, &intent_id)?;
                Ok((admission, view))
            })
            .await?;
        self.local_check(epoch, &admission)?;
        (self.wake)();
        Ok(view)
    }

    pub(crate) async fn advance_background(
        &self,
    ) -> Result<ForcedTakeoverAdvance, TargetBootstrapError> {
        let serial = self.serialized.lock().await;
        let epoch = self.power.epoch()?;
        let ((admission, work), credential) = self
            .stage(None, |host| {
                let admission = host.admit()?;
                let work = host.prepare(&admission)?;
                Ok((admission, work))
            })
            .await?;
        self.check(epoch, credential, &admission)?;
        match work {
            ForcedWork::ResumeInstallation => {
                // Installation takes this same lock. Drop it before notifying its owning lane;
                // no synchronous recursion and no second claim loop in this coordinator.
                drop(serial);
                (self.wake_installation)();
                Ok(ForcedTakeoverAdvance { more: false })
            }
            ForcedWork::Settled(_view) => Ok(ForcedTakeoverAdvance { more: false }),
            ForcedWork::Exchange(exchange) => {
                let kind = H::kind(&exchange);
                let (admission, wire, credential) =
                    self.send(epoch, credential, admission, &exchange).await?;
                let ((admission, view), credential) = self
                    .stage(Some(credential), move |host| {
                        let view = host.complete(&admission, &exchange, &wire)?;
                        Ok((admission, view))
                    })
                    .await?;
                self.check(epoch, credential, &admission)?;
                // Waiting has an external deadline and can be pushed by source renewal. It uses
                // ordinary lane polling; never hot-loop on a cached claimable observation.
                // An unresolved original POST can still arrive after a not-found lookup, so
                // its preserved intent also waits for the normal polling interval.
                Ok(ForcedTakeoverAdvance {
                    more: match view {
                        DesktopForcedTakeoverView::Requesting { .. } => {
                            kind == DesktopForcedTakeoverExchangeKind::Request
                        }
                        DesktopForcedTakeoverView::Cancelling { .. } => {
                            kind == DesktopForcedTakeoverExchangeKind::CancelIntent
                        }
                        DesktopForcedTakeoverView::Installing { .. } => {
                            kind != DesktopForcedTakeoverExchangeKind::Resolve
                        }
                        _ => false,
                    },
                })
            }
        }
    }

    async fn send(
        &self,
        epoch: u64,
        credential: u64,
        admission: H::Admission,
        exchange: &H::Exchange,
    ) -> Result<(H::Admission, Zeroizing<Vec<u8>>, u64), TargetBootstrapError> {
        self.check(epoch, credential, &admission)?;
        let kind = H::kind(exchange);
        let body = H::body(exchange);
        tokio::select! {
            biased;
            () = self.power.changed(epoch) => Err(TargetBootstrapError::Paused),
            response = self.cloud.send(admission, kind, body, credential) => response.map_err(request_error),
        }
    }

    async fn stage<T: Send + 'static>(
        &self,
        credential: Option<u64>,
        work: impl FnOnce(&H) -> Result<T, DesktopLocalHostError> + Send + 'static,
    ) -> Result<(T, u64), TargetBootstrapError> {
        let host = Arc::clone(&self.host);
        let cloud = Arc::clone(&self.cloud);
        let fence = Arc::clone(&self.fence);
        match tokio::task::spawn_blocking(move || {
            fence.commit(|| cloud.session(credential, || work(&host)))
        })
        .await
        {
            Ok(Some(result)) => result.map_err(request_error),
            Ok(None) => Err(TargetBootstrapError::Cancelled),
            Err(_) => Err(TargetBootstrapError::Retryable),
        }
    }
    async fn local_stage<T: Send + 'static>(
        &self,
        work: impl FnOnce(&H) -> Result<T, DesktopLocalHostError> + Send + 'static,
    ) -> Result<T, TargetBootstrapError> {
        let host = Arc::clone(&self.host);
        let fence = Arc::clone(&self.fence);
        match tokio::task::spawn_blocking(move || fence.commit(|| work(&host))).await {
            Ok(Some(result)) => result.map_err(host_error),
            Ok(None) => Err(TargetBootstrapError::Cancelled),
            Err(_) => Err(TargetBootstrapError::Retryable),
        }
    }
    fn check(
        &self,
        epoch: u64,
        credential: u64,
        admission: &H::Admission,
    ) -> Result<(), TargetBootstrapError> {
        self.power
            .publish(epoch, || {
                self.fence.commit(|| {
                    self.cloud
                        .session(Some(credential), || self.host.recheck(admission))
                })
            })?
            .ok_or(TargetBootstrapError::Cancelled)?
            .map(|_| ())
            .map_err(request_error)
    }
    fn local_check(
        &self,
        epoch: u64,
        admission: &H::Admission,
    ) -> Result<(), TargetBootstrapError> {
        self.power
            .publish(epoch, || self.fence.commit(|| self.host.recheck(admission)))?
            .ok_or(TargetBootstrapError::Cancelled)?
            .map_err(host_error)
    }
}

fn validate_id(id: &str) -> Result<(), TargetBootstrapError> {
    if id.is_empty() || id.len() > 160 || !id.bytes().all(|byte| (0x21..=0x7e).contains(&byte)) {
        Err(TargetBootstrapError::Blocked)
    } else {
        Ok(())
    }
}
const fn host_error(error: DesktopLocalHostError) -> TargetBootstrapError {
    match error {
        DesktopLocalHostError::AuthorityRejected => TargetBootstrapError::AuthorizationRequired,
        DesktopLocalHostError::CloudProtocolRejected => TargetBootstrapError::Blocked,
        _ => TargetBootstrapError::Retryable,
    }
}
const fn request_error(error: NativeCloudRequestError) -> TargetBootstrapError {
    match error {
        NativeCloudRequestError::Retryable
        | NativeCloudRequestError::Unavailable
        | NativeCloudRequestError::OutcomeUnknown => TargetBootstrapError::Retryable,
        NativeCloudRequestError::AuthorityStale
        | NativeCloudRequestError::AuthorizationRequired
        | NativeCloudRequestError::AuthorizationDenied => {
            TargetBootstrapError::AuthorizationRequired
        }
        NativeCloudRequestError::ProtocolBlocked
        | NativeCloudRequestError::ConfigurationBlocked => TargetBootstrapError::Blocked,
    }
}

impl ForcedHost for DesktopLocalHost {
    type Admission = DesktopNativeCloudAdmission;
    type Exchange = DesktopForcedTakeoverExchange;
    fn admit(&self) -> Result<Self::Admission, DesktopLocalHostError> {
        self.begin_target_installation_control_run()
    }
    fn recheck(&self, admission: &Self::Admission) -> Result<(), DesktopLocalHostError> {
        self.fast_recheck_native_cloud(admission)
    }
    fn preview(
        &self,
        admission: &Self::Admission,
    ) -> Result<Self::Exchange, DesktopLocalHostError> {
        self.prepare_forced_takeover_preview(admission)
    }
    fn complete_preview(
        &self,
        admission: &Self::Admission,
        exchange: &Self::Exchange,
        wire: &[u8],
    ) -> Result<DesktopForcedTakeoverPreview, DesktopLocalHostError> {
        self.complete_forced_takeover_preview(admission, exchange, wire)
    }
    fn confirm(
        &self,
        admission: &Self::Admission,
        preview: &str,
    ) -> Result<DesktopForcedTakeoverView, DesktopLocalHostError> {
        self.confirm_forced_takeover(admission, preview)
    }
    fn status(
        &self,
        admission: &Self::Admission,
    ) -> Result<DesktopForcedTakeoverView, DesktopLocalHostError> {
        self.forced_takeover_status(admission)
    }
    fn cancel(
        &self,
        admission: &Self::Admission,
        intent: &str,
    ) -> Result<DesktopForcedTakeoverView, DesktopLocalHostError> {
        self.cancel_forced_takeover(admission, intent)
    }
    fn prepare(
        &self,
        admission: &Self::Admission,
    ) -> Result<ForcedWork<Self::Exchange>, DesktopLocalHostError> {
        self.prepare_forced_takeover_work(admission)
            .map(|work| match work {
                DesktopForcedTakeoverWork::Exchange(exchange) => ForcedWork::Exchange(exchange),
                DesktopForcedTakeoverWork::ResumeInstallation => ForcedWork::ResumeInstallation,
                DesktopForcedTakeoverWork::Settled(view) => ForcedWork::Settled(view),
            })
    }
    fn kind(exchange: &Self::Exchange) -> DesktopForcedTakeoverExchangeKind {
        exchange.kind()
    }
    fn body(exchange: &Self::Exchange) -> Zeroizing<Vec<u8>> {
        Zeroizing::new(exchange.request_bytes().to_vec())
    }
    fn complete(
        &self,
        admission: &Self::Admission,
        exchange: &Self::Exchange,
        wire: &[u8],
    ) -> Result<DesktopForcedTakeoverView, DesktopLocalHostError> {
        self.complete_forced_takeover_work(admission, exchange, wire)
    }
}
impl ForcedCloud<DesktopNativeCloudAdmission> for NativeCloudSession {
    fn session<T>(
        &self,
        credential: Option<u64>,
        work: impl FnOnce() -> Result<T, DesktopLocalHostError>,
    ) -> Result<(T, u64), NativeCloudRequestError> {
        self.with_target_bootstrap_session(credential, work)
    }
    async fn send(
        &self,
        admission: DesktopNativeCloudAdmission,
        kind: DesktopForcedTakeoverExchangeKind,
        body: Zeroizing<Vec<u8>>,
        credential: u64,
    ) -> Result<(DesktopNativeCloudAdmission, Zeroizing<Vec<u8>>, u64), NativeCloudRequestError>
    {
        self.send_forced_takeover(admission, kind, body, credential)
            .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;
    use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
    use tokio::sync::Notify;

    #[derive(Default)]
    struct Power {
        epoch: AtomicU64,
        publishing: AtomicBool,
        changed: Notify,
    }
    impl Power {
        fn change(&self) {
            self.epoch.fetch_add(1, Ordering::SeqCst);
            self.changed.notify_waiters();
        }
    }
    impl TargetBootstrapPower for Power {
        fn epoch(&self) -> Result<u64, TargetBootstrapError> {
            Ok(self.epoch.load(Ordering::SeqCst))
        }
        async fn changed(&self, epoch: u64) {
            loop {
                let changed = self.changed.notified();
                tokio::pin!(changed);
                changed.as_mut().enable();
                if self.epoch.load(Ordering::SeqCst) != epoch {
                    return;
                }
                changed.await;
            }
        }
        fn publish<T>(
            &self,
            epoch: u64,
            work: impl FnOnce() -> T,
        ) -> Result<T, TargetBootstrapError> {
            if self.epoch.load(Ordering::SeqCst) != epoch {
                return Err(TargetBootstrapError::Paused);
            }
            assert!(!self.publishing.swap(true, Ordering::SeqCst));
            let result = work();
            self.publishing.store(false, Ordering::SeqCst);
            Ok(result)
        }
    }
    struct Host {
        power: Arc<Power>,
        view: StdMutex<DesktopForcedTakeoverView>,
        work: StdMutex<VecDeque<ForcedWork<DesktopForcedTakeoverExchangeKind>>>,
        confirms: AtomicUsize,
        completions: AtomicUsize,
        generation: AtomicU64,
        pause_after_confirm: AtomicBool,
    }
    fn waiting() -> DesktopForcedTakeoverView {
        DesktopForcedTakeoverView::Waiting {
            intent_id: "intent".into(),
            request_id: "request".into(),
            source_device_id: "source".into(),
            earliest_takeover_at: "2026-11-20T00:00:00Z".into(),
            evaluated_at: "2026-11-19T00:00:00Z".into(),
        }
    }
    impl Host {
        fn custody(&self) {
            assert!(!self.power.publishing.load(Ordering::SeqCst));
        }
    }
    impl ForcedHost for Host {
        type Admission = u64;
        type Exchange = DesktopForcedTakeoverExchangeKind;
        fn admit(&self) -> Result<u64, DesktopLocalHostError> {
            self.custody();
            Ok(self.generation.load(Ordering::SeqCst))
        }
        fn recheck(&self, admission: &u64) -> Result<(), DesktopLocalHostError> {
            if *admission == self.generation.load(Ordering::SeqCst) {
                Ok(())
            } else {
                Err(DesktopLocalHostError::AuthorityRejected)
            }
        }
        fn preview(&self, _: &u64) -> Result<Self::Exchange, DesktopLocalHostError> {
            self.custody();
            Ok(DesktopForcedTakeoverExchangeKind::Preview)
        }
        fn complete_preview(
            &self,
            _: &u64,
            _: &Self::Exchange,
            _: &[u8],
        ) -> Result<DesktopForcedTakeoverPreview, DesktopLocalHostError> {
            self.custody();
            Ok(DesktopForcedTakeoverPreview::Available {
                preview_id: "preview".into(),
                source_device_id: "source".into(),
                source_lease_epoch: 4,
                earliest_takeover_at: "2026-11-20T00:00:00Z".into(),
                evaluated_at: "2026-11-19T00:00:00Z".into(),
            })
        }
        fn confirm(
            &self,
            _: &u64,
            preview: &str,
        ) -> Result<DesktopForcedTakeoverView, DesktopLocalHostError> {
            self.custody();
            assert_eq!(preview, "preview");
            self.confirms.fetch_add(1, Ordering::SeqCst);
            let view = DesktopForcedTakeoverView::Requesting {
                intent_id: "intent".into(),
            };
            *self.view.lock().unwrap() = view.clone();
            if self.pause_after_confirm.load(Ordering::SeqCst) {
                self.power.change();
            }
            Ok(view)
        }
        fn status(&self, _: &u64) -> Result<DesktopForcedTakeoverView, DesktopLocalHostError> {
            self.custody();
            Ok(self.view.lock().unwrap().clone())
        }
        fn cancel(
            &self,
            _: &u64,
            intent: &str,
        ) -> Result<DesktopForcedTakeoverView, DesktopLocalHostError> {
            self.custody();
            assert_eq!(intent, "intent");
            let view = DesktopForcedTakeoverView::Cancelling {
                intent_id: intent.into(),
                request_id: Some("request".into()),
            };
            *self.view.lock().unwrap() = view.clone();
            Ok(view)
        }
        fn prepare(&self, _: &u64) -> Result<ForcedWork<Self::Exchange>, DesktopLocalHostError> {
            self.custody();
            Ok(self
                .work
                .lock()
                .unwrap()
                .pop_front()
                .unwrap_or_else(|| ForcedWork::Settled(self.view.lock().unwrap().clone())))
        }
        fn kind(exchange: &Self::Exchange) -> DesktopForcedTakeoverExchangeKind {
            *exchange
        }
        fn body(_: &Self::Exchange) -> Zeroizing<Vec<u8>> {
            Zeroizing::new(b"fixed original request".to_vec())
        }
        fn complete(
            &self,
            _: &u64,
            _: &Self::Exchange,
            _: &[u8],
        ) -> Result<DesktopForcedTakeoverView, DesktopLocalHostError> {
            self.custody();
            self.completions.fetch_add(1, Ordering::SeqCst);
            Ok(self.view.lock().unwrap().clone())
        }
    }
    struct Cloud {
        credential: AtomicU64,
        sent: StdMutex<Vec<DesktopForcedTakeoverExchangeKind>>,
        next_error: StdMutex<Option<NativeCloudRequestError>>,
        change_after_send: AtomicBool,
    }
    impl ForcedCloud<u64> for Cloud {
        fn session<T>(
            &self,
            expected: Option<u64>,
            work: impl FnOnce() -> Result<T, DesktopLocalHostError>,
        ) -> Result<(T, u64), NativeCloudRequestError> {
            let credential = self.credential.load(Ordering::SeqCst);
            if expected.is_some_and(|value| value != credential) {
                return Err(NativeCloudRequestError::AuthorizationRequired);
            }
            work()
                .map(|result| (result, credential))
                .map_err(|_| NativeCloudRequestError::AuthorityStale)
        }
        async fn send(
            &self,
            admission: u64,
            kind: DesktopForcedTakeoverExchangeKind,
            body: Zeroizing<Vec<u8>>,
            credential: u64,
        ) -> Result<(u64, Zeroizing<Vec<u8>>, u64), NativeCloudRequestError> {
            tokio::task::yield_now().await;
            assert_eq!(body.as_slice(), b"fixed original request");
            self.sent.lock().unwrap().push(kind);
            if self.change_after_send.load(Ordering::SeqCst) {
                self.credential.fetch_add(1, Ordering::SeqCst);
            }
            if let Some(error) = self.next_error.lock().unwrap().take() {
                return Err(error);
            }
            Ok((admission, Zeroizing::new(b"response".to_vec()), credential))
        }
    }
    struct Fixture {
        coordinator: ForcedTakeover<Host, Cloud, Power>,
        wake: Arc<AtomicUsize>,
        install_wake: Arc<AtomicUsize>,
    }
    fn fixture() -> Fixture {
        let power = Arc::new(Power::default());
        let host = Arc::new(Host {
            power: Arc::clone(&power),
            view: StdMutex::new(DesktopForcedTakeoverView::Idle),
            work: StdMutex::new(VecDeque::new()),
            confirms: AtomicUsize::new(0),
            completions: AtomicUsize::new(0),
            generation: AtomicU64::new(1),
            pause_after_confirm: AtomicBool::new(false),
        });
        let cloud = Arc::new(Cloud {
            credential: AtomicU64::new(8),
            sent: StdMutex::new(Vec::new()),
            next_error: StdMutex::new(None),
            change_after_send: AtomicBool::new(false),
        });
        let wake = Arc::new(AtomicUsize::new(0));
        let install_wake = Arc::new(AtomicUsize::new(0));
        let serial = Arc::new(Mutex::new(()));
        let wake_count = Arc::clone(&wake);
        let install_count = Arc::clone(&install_wake);
        let install_serial = Arc::clone(&serial);
        let coordinator = ForcedTakeover::new(
            host,
            cloud,
            Arc::new(NativeCloudCancelFence::default()),
            power,
            Arc::new(move || {
                wake_count.fetch_add(1, Ordering::SeqCst);
            }),
            Arc::new(move || {
                assert!(
                    install_serial.try_lock().is_ok(),
                    "installer woken while target lock held"
                );
                install_count.fetch_add(1, Ordering::SeqCst);
            }),
            serial,
        );
        Fixture {
            coordinator,
            wake,
            install_wake,
        }
    }

    #[tokio::test]
    async fn preview_never_creates_intent_and_confirmation_is_one_use() {
        let f = fixture();
        let c = &f.coordinator;
        c.preview_authenticated(8).await.unwrap();
        assert_eq!(c.host.confirms.load(Ordering::SeqCst), 0);
        assert_eq!(f.wake.load(Ordering::SeqCst), 0);
        assert!(c.confirm_authenticated(9, "preview").await.is_err());
        assert!(c.confirm_authenticated(8, "other").await.is_err());
        let (first, duplicate) = tokio::join!(
            c.confirm_authenticated(8, "preview"),
            c.confirm_authenticated(8, "preview")
        );
        assert!(first.is_ok() ^ duplicate.is_ok());
        assert_eq!(c.host.confirms.load(Ordering::SeqCst), 1);
        assert_eq!(f.wake.load(Ordering::SeqCst), 1);
        assert_eq!(
            *c.cloud.sent.lock().unwrap(),
            [DesktopForcedTakeoverExchangeKind::Preview]
        );
    }
    #[tokio::test]
    async fn restart_drops_unconfirmed_approval_and_old_session_cannot_confirm() {
        let f = fixture();
        let c = &f.coordinator;
        assert!(c.confirm_authenticated(8, "preview").await.is_err());
        c.preview_authenticated(8).await.unwrap();
        c.cloud.credential.store(9, Ordering::SeqCst);
        assert!(c.confirm_authenticated(8, "preview").await.is_err());
        assert!(c.confirm_authenticated(9, "preview").await.is_err());
        assert_eq!(c.host.confirms.load(Ordering::SeqCst), 0);
    }
    #[tokio::test]
    async fn late_reply_after_session_change_is_not_published() {
        let f = fixture();
        let c = &f.coordinator;
        c.cloud.change_after_send.store(true, Ordering::SeqCst);
        assert!(matches!(
            c.preview_authenticated(8).await,
            Err(TargetBootstrapError::AuthorizationRequired)
        ));
        assert!(c.preview_credential.lock().unwrap().is_none());
        c.host.work.lock().unwrap().push_back(ForcedWork::Exchange(
            DesktopForcedTakeoverExchangeKind::Status,
        ));
        assert!(matches!(
            c.advance_background().await,
            Err(TargetBootstrapError::AuthorizationRequired)
        ));
        assert_eq!(c.host.completions.load(Ordering::SeqCst), 0);
    }
    #[tokio::test]
    async fn power_change_after_durable_confirmation_does_not_send_or_wake() {
        let f = fixture();
        let c = &f.coordinator;
        c.preview_authenticated(8).await.unwrap();
        c.host.pause_after_confirm.store(true, Ordering::SeqCst);
        assert!(matches!(
            c.confirm_authenticated(8, "preview").await,
            Err(TargetBootstrapError::Paused)
        ));
        assert_eq!(c.host.confirms.load(Ordering::SeqCst), 1);
        assert_eq!(f.wake.load(Ordering::SeqCst), 0);
        assert_eq!(c.cloud.sent.lock().unwrap().len(), 1);
    }
    #[tokio::test]
    async fn waiting_and_settled_never_hot_loop_and_install_wake_releases_lock() {
        let f = fixture();
        let c = &f.coordinator;
        *c.host.view.lock().unwrap() = waiting();
        c.host.work.lock().unwrap().extend([
            ForcedWork::Exchange(DesktopForcedTakeoverExchangeKind::Status),
            ForcedWork::Settled(waiting()),
            ForcedWork::ResumeInstallation,
        ]);
        for _ in 0..3 {
            assert!(!c.advance_background().await.unwrap().more);
        }
        assert_eq!(f.wake.load(Ordering::SeqCst), 0);
        assert_eq!(f.install_wake.load(Ordering::SeqCst), 1);
        assert_eq!(
            *c.cloud.sent.lock().unwrap(),
            [DesktopForcedTakeoverExchangeKind::Status]
        );
    }
    #[tokio::test]
    async fn unknown_mutation_returns_before_host_selected_resolution() {
        let f = fixture();
        let c = &f.coordinator;
        *c.host.view.lock().unwrap() = waiting();
        c.host.work.lock().unwrap().extend([
            ForcedWork::Exchange(DesktopForcedTakeoverExchangeKind::Request),
            ForcedWork::Exchange(DesktopForcedTakeoverExchangeKind::Resolve),
        ]);
        *c.cloud.next_error.lock().unwrap() = Some(NativeCloudRequestError::OutcomeUnknown);
        assert!(matches!(
            c.advance_background().await,
            Err(TargetBootstrapError::Retryable)
        ));
        assert_eq!(c.host.completions.load(Ordering::SeqCst), 0);
        assert_eq!(
            *c.cloud.sent.lock().unwrap(),
            [DesktopForcedTakeoverExchangeKind::Request]
        );
        assert!(!c.advance_background().await.unwrap().more);
        assert_eq!(
            *c.cloud.sent.lock().unwrap(),
            [
                DesktopForcedTakeoverExchangeKind::Request,
                DesktopForcedTakeoverExchangeKind::Resolve
            ]
        );
    }
    #[tokio::test]
    async fn local_status_and_cancel_need_no_online_credentials() {
        let f = fixture();
        let c = &f.coordinator;
        *c.host.view.lock().unwrap() = waiting();
        c.cloud.credential.store(900, Ordering::SeqCst);
        assert!(matches!(
            c.status().await.unwrap(),
            DesktopForcedTakeoverView::Waiting { .. }
        ));
        assert!(matches!(
            c.cancel("intent").await.unwrap(),
            DesktopForcedTakeoverView::Cancelling { .. }
        ));
        assert!(c.cloud.sent.lock().unwrap().is_empty());
        assert_eq!(f.wake.load(Ordering::SeqCst), 1);
        c.fence.cancel();
        assert!(matches!(
            c.status().await,
            Err(TargetBootstrapError::Cancelled)
        ));
    }

    #[tokio::test]
    async fn unresolved_late_request_keeps_its_intent_without_hot_loop() {
        let f = fixture();
        let c = &f.coordinator;
        for view in [
            DesktopForcedTakeoverView::Requesting {
                intent_id: "intent".into(),
            },
            DesktopForcedTakeoverView::Cancelling {
                intent_id: "intent".into(),
                request_id: None,
            },
        ] {
            *c.host.view.lock().unwrap() = view;
            c.host.work.lock().unwrap().push_back(ForcedWork::Exchange(
                DesktopForcedTakeoverExchangeKind::Resolve,
            ));
            assert!(!c.advance_background().await.unwrap().more);
        }
        assert_eq!(
            *c.cloud.sent.lock().unwrap(),
            [DesktopForcedTakeoverExchangeKind::Resolve; 2]
        );
        assert_eq!(f.wake.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn inconclusive_status_and_refused_cancel_wait_for_normal_polling() {
        let f = fixture();
        let c = &f.coordinator;
        for view in [
            DesktopForcedTakeoverView::Requesting {
                intent_id: "intent".into(),
            },
            DesktopForcedTakeoverView::Cancelling {
                intent_id: "intent".into(),
                request_id: Some("request".into()),
            },
        ] {
            for kind in [
                DesktopForcedTakeoverExchangeKind::Status,
                DesktopForcedTakeoverExchangeKind::Cancel,
            ] {
                *c.host.view.lock().unwrap() = view.clone();
                c.host
                    .work
                    .lock()
                    .unwrap()
                    .push_back(ForcedWork::Exchange(kind));
                assert!(!c.advance_background().await.unwrap().more);
            }
        }
        assert_eq!(f.wake.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn unknown_intent_cancellation_replays_only_the_host_selected_tombstone() {
        let f = fixture();
        let c = &f.coordinator;
        *c.host.view.lock().unwrap() = DesktopForcedTakeoverView::Requesting {
            intent_id: "intent".into(),
        };
        c.cancel("intent").await.unwrap();
        assert!(c.cloud.sent.lock().unwrap().is_empty());
        c.host.work.lock().unwrap().extend([
            ForcedWork::Exchange(DesktopForcedTakeoverExchangeKind::CancelIntent),
            ForcedWork::Exchange(DesktopForcedTakeoverExchangeKind::CancelIntent),
        ]);
        *c.cloud.next_error.lock().unwrap() = Some(NativeCloudRequestError::OutcomeUnknown);
        assert!(matches!(
            c.advance_background().await,
            Err(TargetBootstrapError::Retryable)
        ));
        assert_eq!(c.cloud.sent.lock().unwrap().len(), 1);
        assert_eq!(c.host.completions.load(Ordering::SeqCst), 0);
        *c.host.view.lock().unwrap() = DesktopForcedTakeoverView::CancelledBeforeRequest {
            intent_id: "intent".into(),
        };
        assert!(!c.advance_background().await.unwrap().more);
        assert_eq!(
            *c.cloud.sent.lock().unwrap(),
            [DesktopForcedTakeoverExchangeKind::CancelIntent; 2]
        );
    }
}
