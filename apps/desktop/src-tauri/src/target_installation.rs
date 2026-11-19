//! Fixed target-device first installation. Host owns durable operations and all database work;
//! Native runs one bounded exchange at a time under the shared install/cancel admission.

use std::future::Future;
use std::sync::Arc;

use gooddealer_local_storage::{
    DesktopLocalHost, DesktopLocalHostError, DesktopNativeCloudAdmission,
    DesktopTargetInstallationExchange, DesktopTargetInstallationExchangeKind,
    DesktopTargetInstallationStage, DesktopTargetInstallationView, DesktopTargetInstallationWork,
};
use gooddealer_secure_host_core::NativePowerGate;
use tokio::sync::Mutex;
use zeroize::Zeroizing;

use crate::native_cloud_runtime::NativeCloudCancelFence;
use crate::native_cloud_session::{
    BootstrapInstallationExchange, NativeCloudRequestError, NativeCloudSession, NativeOAuthError,
};
use crate::target_bootstrap_termination::{TargetBootstrapError, TargetBootstrapPower};

pub(crate) struct TargetInstallationAdvance {
    #[cfg(test)]
    pub(crate) view: DesktopTargetInstallationView,
    pub(crate) more: bool,
}

pub(crate) enum InstallationWork<E> {
    Exchange(E),
    Install,
    RefreshAuthorization,
    Settled(DesktopTargetInstallationView),
}

// These narrow seams test the actual Native coordinator. They do not select production stores
// or expose a key, path, credential, authority constructor, or arbitrary request to the caller.
pub(crate) trait InstallationHost: Send + Sync + 'static {
    type Admission: Send + 'static;
    type Exchange: Send + 'static;
    type Stage: Send + 'static;
    fn admit(&self) -> Result<Self::Admission, DesktopLocalHostError>;
    fn recheck(&self, admission: &Self::Admission) -> Result<(), DesktopLocalHostError>;
    fn status(
        &self,
        admission: &Self::Admission,
    ) -> Result<DesktopTargetInstallationView, DesktopLocalHostError>;
    fn start(
        &self,
        admission: &Self::Admission,
        preview_id: &str,
    ) -> Result<DesktopTargetInstallationView, DesktopLocalHostError>;
    fn prepare(
        &self,
        admission: &Self::Admission,
    ) -> Result<InstallationWork<Self::Exchange>, DesktopLocalHostError>;
    fn exchange_kind(exchange: &Self::Exchange) -> BootstrapInstallationExchange;
    fn exchange_body(exchange: &Self::Exchange) -> Zeroizing<Vec<u8>>;
    fn complete(
        &self,
        admission: &Self::Admission,
        exchange: &Self::Exchange,
        wire: &[u8],
    ) -> Result<DesktopTargetInstallationView, DesktopLocalHostError>;
    fn install(&self, admission: &Self::Admission) -> Result<Self::Stage, DesktopLocalHostError>;
    fn publish(
        &self,
        admission: &Self::Admission,
        stage: Self::Stage,
    ) -> Result<DesktopTargetInstallationView, DesktopLocalHostError>;
}

pub(crate) trait InstallationCloud<A>: Send + Sync + 'static {
    fn send(
        &self,
        admission: A,
        kind: BootstrapInstallationExchange,
        body: Zeroizing<Vec<u8>>,
        credential: u64,
    ) -> impl Future<Output = Result<(A, Zeroizing<Vec<u8>>, u64), NativeCloudRequestError>> + Send;
    fn session<T>(
        &self,
        expected: Option<u64>,
        work: impl FnOnce() -> Result<T, DesktopLocalHostError>,
    ) -> Result<(T, u64), NativeCloudRequestError>;
    fn refresh(self: &Arc<Self>) -> impl Future<Output = Result<(), NativeOAuthError>> + Send;
}

pub(crate) type DesktopTargetInstallation =
    TargetInstallation<DesktopLocalHost, NativeCloudSession, NativePowerGate>;

pub(crate) struct TargetInstallation<H, C, P> {
    host: Arc<H>,
    cloud: Arc<C>,
    fence: Arc<NativeCloudCancelFence>,
    power: Arc<P>,
    wake: Arc<dyn Fn() + Send + Sync>,
    serialized: Arc<Mutex<()>>,
}

impl<H, C, P> TargetInstallation<H, C, P>
where
    H: InstallationHost,
    C: InstallationCloud<H::Admission>,
    P: TargetBootstrapPower,
{
    pub(crate) fn new(
        host: Arc<H>,
        cloud: Arc<C>,
        fence: Arc<NativeCloudCancelFence>,
        power: Arc<P>,
        wake: Arc<dyn Fn() + Send + Sync>,
        serialized: Arc<Mutex<()>>,
    ) -> Self {
        Self {
            host,
            cloud,
            fence,
            power,
            wake,
            serialized,
        }
    }

    pub(crate) async fn status(
        &self,
    ) -> Result<DesktopTargetInstallationView, TargetBootstrapError> {
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

    pub(crate) async fn start(
        &self,
        preview_id: &str,
    ) -> Result<DesktopTargetInstallationView, TargetBootstrapError> {
        if preview_id.is_empty()
            || preview_id.len() > 160
            || !preview_id.bytes().all(|byte| (0x21..=0x7e).contains(&byte))
        {
            return Err(TargetBootstrapError::Blocked);
        }
        let _serial = self.serialized.lock().await;
        let epoch = self.power.epoch()?;
        let preview_id = preview_id.to_owned();
        let (admission, view) = self
            .local_stage(move |host| {
                let admission = host.admit()?;
                let view = host.start(&admission, &preview_id)?;
                Ok((admission, view))
            })
            .await?;
        self.local_check(epoch, &admission)?;
        (self.wake)();
        Ok(view)
    }

    pub(crate) async fn advance_background(
        &self,
    ) -> Result<TargetInstallationAdvance, TargetBootstrapError> {
        let _serial = self.serialized.lock().await;
        let epoch = self.power.epoch()?;
        let ((admission, work), credential) = self
            .stage(None, |host| {
                let admission = host.admit()?;
                let work = host.prepare(&admission)?;
                Ok((admission, work))
            })
            .await?;
        self.check(epoch, credential, &admission)?;
        let settled = matches!(&work, InstallationWork::Settled(_));
        let view = match work {
            InstallationWork::Settled(view) => view,
            InstallationWork::Exchange(exchange) => {
                self.exchange(epoch, credential, admission, exchange)
                    .await?
            }
            InstallationWork::Install => {
                let ((admission, stage), credential) = self
                    .stage(Some(credential), move |host| {
                        let stage = host.install(&admission)?;
                        Ok((admission, stage))
                    })
                    .await?;
                // The opaque stage has no database handle. Only the Host's bounded memory
                // publication runs under power; SQLite/keyring work has already completed.
                self.power
                    .publish(epoch, || {
                        self.fence.commit(|| {
                            self.cloud
                                .session(Some(credential), || self.host.publish(&admission, stage))
                        })
                    })?
                    .ok_or(TargetBootstrapError::Cancelled)?
                    .map(|(view, _)| view)
                    .map_err(request_error)?
            }
            InstallationWork::RefreshAuthorization => {
                // Only Host's verified, durable activation receipt permits this role refresh.
                // Await the tracked refresh; never leave a detached installation custody stage.
                self.cloud.refresh().await.map_err(oauth_error)?;
                // Refresh changes credentials and Host generation. Acquire both anew instead
                // of accepting the old stage's admission or reviving an earlier authority.
                self.finish_after_refresh(epoch).await?
            }
        };
        Ok(TargetInstallationAdvance {
            more: !settled && matches!(view, DesktopTargetInstallationView::Running { .. }),
            #[cfg(test)]
            view,
        })
    }

    async fn finish_after_refresh(
        &self,
        epoch: u64,
    ) -> Result<DesktopTargetInstallationView, TargetBootstrapError> {
        let ((admission, view), credential) = self
            .stage(None, |host| {
                let admission = host.admit()?;
                // This background stage lets Host persist completion only after the fresh
                // Active epoch and execution context match its durable activation receipt.
                // Renderer status remains read-only and can never open the business gate.
                let work = host.prepare(&admission)?;
                Ok((admission, work))
            })
            .await?;
        self.check(epoch, credential, &admission)?;
        match view {
            InstallationWork::Settled(view @ DesktopTargetInstallationView::Completed { .. }) => {
                Ok(view)
            }
            // A valid refresh may still leave Host waiting for matching authority. Retain
            // the durable receipt and back off without sending any newly selected operation.
            _ => Err(TargetBootstrapError::Retryable),
        }
    }

    async fn exchange(
        &self,
        epoch: u64,
        credential: u64,
        admission: H::Admission,
        exchange: H::Exchange,
    ) -> Result<DesktopTargetInstallationView, TargetBootstrapError> {
        let kind = H::exchange_kind(&exchange);
        let body = H::exchange_body(&exchange);
        self.check(epoch, credential, &admission)?;
        let (admission, wire, credential) = tokio::select! {
            biased;
            () = self.power.changed(epoch) => return Err(TargetBootstrapError::Paused),
            response = self.cloud.send(admission, kind, body, credential) => response.map_err(request_error)?,
        };
        let ((admission, view), credential) = self
            .stage(Some(credential), move |host| {
                let view = host.complete(&admission, &exchange, &wire)?;
                Ok((admission, view))
            })
            .await?;
        self.check(epoch, credential, &admission)?;
        Ok(view)
    }

    async fn local_stage<T: Send + 'static>(
        &self,
        work: impl FnOnce(&H) -> Result<T, DesktopLocalHostError> + Send + 'static,
    ) -> Result<T, TargetBootstrapError> {
        let host = Arc::clone(&self.host);
        let fence = Arc::clone(&self.fence);
        // Reading progress and confirming an already previewed workflow need current Host
        // authorization, not an online bearer. They cannot cause network or install work.
        match tokio::task::spawn_blocking(move || fence.commit(|| work(&host))).await {
            Ok(Some(result)) => result.map_err(host_error),
            Ok(None) => Err(TargetBootstrapError::Cancelled),
            Err(_) => Err(TargetBootstrapError::Retryable),
        }
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

    async fn stage<T: Send + 'static>(
        &self,
        credential: Option<u64>,
        work: impl FnOnce(&H) -> Result<T, DesktopLocalHostError> + Send + 'static,
    ) -> Result<(T, u64), TargetBootstrapError> {
        let host = Arc::clone(&self.host);
        let cloud = Arc::clone(&self.cloud);
        let fence = Arc::clone(&self.fence);
        // Shutdown joins each blocking operation; there is no power mutex during Native I/O.
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
        NativeCloudRequestError::AuthorizationRequired
        | NativeCloudRequestError::AuthorizationDenied
        | NativeCloudRequestError::AuthorityStale => TargetBootstrapError::AuthorizationRequired,
        NativeCloudRequestError::ProtocolBlocked
        | NativeCloudRequestError::ConfigurationBlocked => TargetBootstrapError::Blocked,
    }
}
const fn oauth_error(error: NativeOAuthError) -> TargetBootstrapError {
    match error {
        NativeOAuthError::Unavailable
        | NativeOAuthError::Busy
        | NativeOAuthError::TransportRejected => TargetBootstrapError::Retryable,
        NativeOAuthError::CredentialRejected | NativeOAuthError::CallbackRejected => {
            TargetBootstrapError::AuthorizationRequired
        }
    }
}

impl InstallationHost for DesktopLocalHost {
    type Admission = DesktopNativeCloudAdmission;
    type Exchange = DesktopTargetInstallationExchange;
    type Stage = DesktopTargetInstallationStage;
    fn admit(&self) -> Result<Self::Admission, DesktopLocalHostError> {
        self.begin_target_installation_control_run()
    }
    fn recheck(&self, admission: &Self::Admission) -> Result<(), DesktopLocalHostError> {
        self.fast_recheck_native_cloud(admission)
    }
    fn status(
        &self,
        admission: &Self::Admission,
    ) -> Result<DesktopTargetInstallationView, DesktopLocalHostError> {
        self.target_installation_status(admission)
    }
    fn start(
        &self,
        admission: &Self::Admission,
        preview_id: &str,
    ) -> Result<DesktopTargetInstallationView, DesktopLocalHostError> {
        self.start_target_installation(admission, preview_id)
    }
    fn prepare(
        &self,
        admission: &Self::Admission,
    ) -> Result<InstallationWork<Self::Exchange>, DesktopLocalHostError> {
        self.prepare_target_installation_work(admission)
            .map(|work| match work {
                DesktopTargetInstallationWork::Exchange(exchange) => {
                    InstallationWork::Exchange(exchange)
                }
                DesktopTargetInstallationWork::Install => InstallationWork::Install,
                DesktopTargetInstallationWork::RefreshAuthorization => {
                    InstallationWork::RefreshAuthorization
                }
                DesktopTargetInstallationWork::Settled(view) => InstallationWork::Settled(view),
            })
    }
    fn exchange_kind(exchange: &Self::Exchange) -> BootstrapInstallationExchange {
        match exchange.kind() {
            DesktopTargetInstallationExchangeKind::Claim => BootstrapInstallationExchange::Claim,
            DesktopTargetInstallationExchangeKind::Step => BootstrapInstallationExchange::Step,
            DesktopTargetInstallationExchangeKind::Checkpoint => {
                BootstrapInstallationExchange::Checkpoint
            }
            DesktopTargetInstallationExchangeKind::Receipt => {
                BootstrapInstallationExchange::Receipt
            }
            DesktopTargetInstallationExchangeKind::Activate => {
                BootstrapInstallationExchange::Activate
            }
        }
    }
    fn exchange_body(exchange: &Self::Exchange) -> Zeroizing<Vec<u8>> {
        Zeroizing::new(exchange.request_bytes().to_vec())
    }
    fn complete(
        &self,
        admission: &Self::Admission,
        exchange: &Self::Exchange,
        wire: &[u8],
    ) -> Result<DesktopTargetInstallationView, DesktopLocalHostError> {
        self.complete_target_installation_exchange(admission, exchange, wire)
    }
    fn install(&self, admission: &Self::Admission) -> Result<Self::Stage, DesktopLocalHostError> {
        self.stage_target_installation(admission)
    }
    fn publish(
        &self,
        admission: &Self::Admission,
        stage: Self::Stage,
    ) -> Result<DesktopTargetInstallationView, DesktopLocalHostError> {
        self.publish_target_installation(admission, stage)
    }
}
impl InstallationCloud<DesktopNativeCloudAdmission> for NativeCloudSession {
    async fn send(
        &self,
        admission: DesktopNativeCloudAdmission,
        kind: BootstrapInstallationExchange,
        body: Zeroizing<Vec<u8>>,
        credential: u64,
    ) -> Result<(DesktopNativeCloudAdmission, Zeroizing<Vec<u8>>, u64), NativeCloudRequestError>
    {
        self.send_bootstrap_installation(admission, kind, body, credential)
            .await
    }
    fn session<T>(
        &self,
        expected: Option<u64>,
        work: impl FnOnce() -> Result<T, DesktopLocalHostError>,
    ) -> Result<(T, u64), NativeCloudRequestError> {
        self.with_target_bootstrap_session(expected, work)
    }
    async fn refresh(self: &Arc<Self>) -> Result<(), NativeOAuthError> {
        NativeCloudSession::refresh(self).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use gooddealer_local_storage::{
        DesktopTargetBootstrapTerminalStatus, DesktopTargetInstallationPhase,
    };
    use std::collections::VecDeque;
    use std::sync::{
        Mutex as StdMutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
    };
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
    #[derive(Clone)]
    struct Exchange {
        kind: BootstrapInstallationExchange,
        body: Vec<u8>,
        phase: u8,
    }
    #[derive(Default)]
    #[allow(
        clippy::struct_excessive_bools,
        reason = "fixture independently observes durable intent, installation, publication and authorization fences"
    )]
    struct State {
        started: bool,
        phase: u8,
        pending: Option<Exchange>,
        replay_ready: bool,
        installed: bool,
        published: bool,
        activated: bool,
        authorized: bool,
        stopped: bool,
        waiting_for_cancel: bool,
        starts: u64,
        completions: u64,
        refreshes: u64,
        finalizations: u64,
    }
    impl State {
        fn view(&self) -> DesktopTargetInstallationView {
            if !self.started {
                return DesktopTargetInstallationView::Idle;
            }
            if self.stopped {
                return DesktopTargetInstallationView::Stopped {
                    request_id: "original".into(),
                    status: DesktopTargetBootstrapTerminalStatus::Cancelled,
                };
            }
            if self.authorized {
                return DesktopTargetInstallationView::Completed {
                    request_id: "original".into(),
                };
            }
            let phase = match self.phase {
                0 => DesktopTargetInstallationPhase::Claiming,
                1 | 2 => DesktopTargetInstallationPhase::Downloading,
                3 => DesktopTargetInstallationPhase::Installing,
                4 => DesktopTargetInstallationPhase::Verifying,
                5 => DesktopTargetInstallationPhase::Activating,
                _ => DesktopTargetInstallationPhase::Authorizing,
            };
            DesktopTargetInstallationView::Running {
                request_id: "original".into(),
                phase,
            }
        }
        fn commit(&mut self, phase: u8) {
            assert_eq!(self.phase, phase);
            if phase == 5 {
                assert!(self.installed && self.published);
                self.activated = true;
            }
            self.phase += 1;
            self.pending = None;
            self.completions += 1;
        }
    }
    struct Host {
        state: StdMutex<State>,
        power: Arc<Power>,
        generation: AtomicU64,
        power_after_prepare: AtomicBool,
        power_after_complete: AtomicBool,
        power_after_install: AtomicBool,
    }
    impl Host {
        fn custody(&self) {
            assert!(
                !self.power.publishing.load(Ordering::SeqCst),
                "custody under power mutex"
            );
        }
    }
    impl InstallationHost for Host {
        type Admission = u64;
        type Exchange = Exchange;
        type Stage = u64;
        fn admit(&self) -> Result<u64, DesktopLocalHostError> {
            Ok(self.generation.load(Ordering::SeqCst))
        }
        fn recheck(&self, admission: &u64) -> Result<(), DesktopLocalHostError> {
            if *admission == self.generation.load(Ordering::SeqCst) {
                Ok(())
            } else {
                Err(DesktopLocalHostError::AuthorityRejected)
            }
        }
        fn status(
            &self,
            admission: &u64,
        ) -> Result<DesktopTargetInstallationView, DesktopLocalHostError> {
            self.custody();
            self.recheck(admission)?;
            Ok(self.state.lock().unwrap().view())
        }
        fn start(
            &self,
            admission: &u64,
            preview: &str,
        ) -> Result<DesktopTargetInstallationView, DesktopLocalHostError> {
            self.custody();
            self.recheck(admission)?;
            if preview != "original" {
                return Err(DesktopLocalHostError::CloudProtocolRejected);
            }
            let mut state = self.state.lock().unwrap();
            if !state.started {
                state.started = true;
                state.starts += 1;
            }
            Ok(state.view())
        }
        fn prepare(
            &self,
            admission: &u64,
        ) -> Result<InstallationWork<Exchange>, DesktopLocalHostError> {
            self.custody();
            self.recheck(admission)?;
            let mut state = self.state.lock().unwrap();
            if state.authorized {
                state.finalizations += 1;
                return Ok(InstallationWork::Settled(state.view()));
            }
            if !state.started || state.stopped || state.waiting_for_cancel {
                return Ok(InstallationWork::Settled(state.view()));
            }
            if state.phase == 3 {
                return Ok(InstallationWork::Install);
            }
            if state.phase == 6 {
                assert!(state.activated);
                return Ok(InstallationWork::RefreshAuthorization);
            }
            if let Some(pending) = state.pending.clone() {
                if state.replay_ready {
                    state.replay_ready = false;
                    return Ok(InstallationWork::Exchange(pending));
                }
                return Ok(InstallationWork::Exchange(Exchange {
                    kind: BootstrapInstallationExchange::Receipt,
                    body: [b"receipt:".as_slice(), &pending.body].concat(),
                    phase: pending.phase,
                }));
            }
            let kind = match state.phase {
                0 => BootstrapInstallationExchange::Claim,
                1 | 4 => BootstrapInstallationExchange::Step,
                2 => BootstrapInstallationExchange::Checkpoint,
                5 => BootstrapInstallationExchange::Activate,
                _ => panic!("unexpected phase"),
            };
            let exchange = Exchange {
                kind,
                body: format!("original:phase-{}:fixed-nonce", state.phase).into_bytes(),
                phase: state.phase,
            };
            state.pending = Some(exchange.clone());
            if self.power_after_prepare.swap(false, Ordering::SeqCst) {
                self.power.change();
            }
            Ok(InstallationWork::Exchange(exchange))
        }
        fn exchange_kind(exchange: &Exchange) -> BootstrapInstallationExchange {
            exchange.kind
        }
        fn exchange_body(exchange: &Exchange) -> Zeroizing<Vec<u8>> {
            Zeroizing::new(exchange.body.clone())
        }
        fn complete(
            &self,
            admission: &u64,
            exchange: &Exchange,
            wire: &[u8],
        ) -> Result<DesktopTargetInstallationView, DesktopLocalHostError> {
            self.custody();
            self.recheck(admission)?;
            let mut state = self.state.lock().unwrap();
            assert_eq!(state.pending.as_ref().unwrap().phase, exchange.phase);
            match wire {
                b"ack" | b"committed" => state.commit(exchange.phase),
                b"uncommitted" if exchange.kind == BootstrapInstallationExchange::Receipt => {
                    state.replay_ready = true;
                }
                b"terminal" => {
                    state.stopped = true;
                }
                _ => return Err(DesktopLocalHostError::CloudProtocolRejected),
            }
            if self.power_after_complete.swap(false, Ordering::SeqCst) {
                self.power.change();
            }
            Ok(state.view())
        }
        fn install(&self, admission: &u64) -> Result<u64, DesktopLocalHostError> {
            self.custody();
            self.recheck(admission)?;
            let mut state = self.state.lock().unwrap();
            assert_eq!(state.phase, 3);
            state.installed = true;
            if self.power_after_install.swap(false, Ordering::SeqCst) {
                self.power.change();
            }
            Ok(*admission)
        }
        fn publish(
            &self,
            admission: &u64,
            prepared_generation: u64,
        ) -> Result<DesktopTargetInstallationView, DesktopLocalHostError> {
            assert!(self.power.publishing.load(Ordering::SeqCst));
            self.recheck(admission)?;
            assert_eq!(*admission, prepared_generation);
            let mut state = self.state.lock().unwrap();
            assert!(state.installed);
            state.published = true;
            state.phase = 4;
            Ok(state.view())
        }
    }
    enum Reply {
        Body(&'static [u8]),
        Unknown,
        CredentialChanged,
        GenerationChanged,
        Shutdown,
        Sleep,
    }
    struct Cloud {
        host: Arc<Host>,
        fence: Arc<NativeCloudCancelFence>,
        credential: AtomicU64,
        replies: StdMutex<VecDeque<Reply>>,
        calls: StdMutex<Vec<(BootstrapInstallationExchange, Vec<u8>)>>,
        refresh_stays_pending: AtomicBool,
        offline: AtomicBool,
    }
    impl InstallationCloud<u64> for Cloud {
        async fn send(
            &self,
            admission: u64,
            kind: BootstrapInstallationExchange,
            body: Zeroizing<Vec<u8>>,
            credential: u64,
        ) -> Result<(u64, Zeroizing<Vec<u8>>, u64), NativeCloudRequestError> {
            assert!(!self.host.power.publishing.load(Ordering::SeqCst));
            assert_eq!(credential, self.credential.load(Ordering::SeqCst));
            assert!(
                self.host.state.lock().unwrap().pending.is_some(),
                "send before durable operation"
            );
            self.calls.lock().unwrap().push((kind, body.to_vec()));
            let reply = self
                .replies
                .lock()
                .unwrap()
                .pop_front()
                .unwrap_or(Reply::Body(b"ack"));
            match reply {
                Reply::Body(body) => Ok((admission, Zeroizing::new(body.to_vec()), credential)),
                Reply::Unknown => Err(NativeCloudRequestError::OutcomeUnknown),
                Reply::CredentialChanged => {
                    self.credential.fetch_add(1, Ordering::SeqCst);
                    Ok((admission, Zeroizing::new(b"ack".to_vec()), credential))
                }
                Reply::GenerationChanged => {
                    self.host.generation.fetch_add(1, Ordering::SeqCst);
                    Ok((admission, Zeroizing::new(b"ack".to_vec()), credential))
                }
                Reply::Shutdown => {
                    self.fence.cancel();
                    Ok((admission, Zeroizing::new(b"ack".to_vec()), credential))
                }
                Reply::Sleep => {
                    self.host.power.change();
                    std::future::pending().await
                }
            }
        }
        fn session<T>(
            &self,
            expected: Option<u64>,
            work: impl FnOnce() -> Result<T, DesktopLocalHostError>,
        ) -> Result<(T, u64), NativeCloudRequestError> {
            if self.offline.load(Ordering::SeqCst) {
                return Err(NativeCloudRequestError::AuthorizationRequired);
            }
            let credential = self.credential.load(Ordering::SeqCst);
            if expected.is_some_and(|expected| expected != credential) {
                return Err(NativeCloudRequestError::AuthorizationRequired);
            }
            work()
                .map(|value| (value, credential))
                .map_err(|error| match error {
                    DesktopLocalHostError::AuthorityRejected => {
                        NativeCloudRequestError::AuthorityStale
                    }
                    _ => NativeCloudRequestError::ProtocolBlocked,
                })
        }
        fn refresh(self: &Arc<Self>) -> impl Future<Output = Result<(), NativeOAuthError>> {
            assert!(!self.host.power.publishing.load(Ordering::SeqCst));
            let mut state = self.host.state.lock().unwrap();
            assert!(
                state.activated && state.installed && state.published,
                "refresh before exact installation/activation receipts"
            );
            state.refreshes += 1;
            if !self.refresh_stays_pending.load(Ordering::SeqCst) {
                state.authorized = true;
            }
            self.credential.fetch_add(1, Ordering::SeqCst);
            self.host.generation.fetch_add(1, Ordering::SeqCst);
            std::future::ready(Ok(()))
        }
    }
    type Coordinator = TargetInstallation<Host, Cloud, Power>;
    fn setup() -> (Arc<Host>, Arc<Cloud>, Arc<AtomicU64>, Coordinator) {
        let power = Arc::new(Power::default());
        let host = Arc::new(Host {
            state: StdMutex::new(State::default()),
            power: Arc::clone(&power),
            generation: AtomicU64::new(1),
            power_after_prepare: AtomicBool::new(false),
            power_after_complete: AtomicBool::new(false),
            power_after_install: AtomicBool::new(false),
        });
        let fence = Arc::new(NativeCloudCancelFence::default());
        let cloud = Arc::new(Cloud {
            host: Arc::clone(&host),
            fence: Arc::clone(&fence),
            credential: AtomicU64::new(1),
            replies: StdMutex::new(VecDeque::new()),
            calls: StdMutex::new(Vec::new()),
            refresh_stays_pending: AtomicBool::new(false),
            offline: AtomicBool::new(false),
        });
        let wakes = Arc::new(AtomicU64::new(0));
        let counted = Arc::clone(&wakes);
        let coordinator = Coordinator::new(
            Arc::clone(&host),
            Arc::clone(&cloud),
            fence,
            power,
            Arc::new(move || {
                counted.fetch_add(1, Ordering::SeqCst);
            }),
            Arc::new(Mutex::new(())),
        );
        (host, cloud, wakes, coordinator)
    }
    fn restart(host: &Arc<Host>, cloud: &Arc<Cloud>) -> Coordinator {
        Coordinator::new(
            Arc::clone(host),
            Arc::clone(cloud),
            Arc::clone(&cloud.fence),
            Arc::clone(&host.power),
            Arc::new(|| {}),
            Arc::new(Mutex::new(())),
        )
    }
    async fn reach_phase(coordinator: &Coordinator, host: &Host, phase: u8) {
        coordinator.start("original").await.unwrap();
        while host.state.lock().unwrap().phase < phase {
            assert!(coordinator.advance_background().await.unwrap().more);
        }
    }

    #[tokio::test]
    async fn status_is_read_only_and_confirmation_only_persists_one_original_intent() {
        let (host, cloud, wakes, coordinator) = setup();
        assert_eq!(
            coordinator.status().await.unwrap(),
            DesktopTargetInstallationView::Idle
        );
        assert!(!coordinator.advance_background().await.unwrap().more);
        assert!(coordinator.start("different").await.is_err());
        coordinator.start("original").await.unwrap();
        coordinator.start("original").await.unwrap();
        coordinator.status().await.unwrap();
        assert!(cloud.calls.lock().unwrap().is_empty());
        assert_eq!(host.state.lock().unwrap().starts, 1);
        assert_eq!(wakes.load(Ordering::SeqCst), 2);
    }
    #[tokio::test]
    async fn offline_progress_and_confirmation_use_host_authority_without_cloud_session() {
        let (host, cloud, _, coordinator) = setup();
        cloud.offline.store(true, Ordering::SeqCst);
        assert_eq!(
            coordinator.status().await.unwrap(),
            DesktopTargetInstallationView::Idle
        );
        coordinator.start("original").await.unwrap();
        assert!(matches!(
            coordinator.status().await.unwrap(),
            DesktopTargetInstallationView::Running { .. }
        ));
        assert!(matches!(
            coordinator.advance_background().await,
            Err(TargetBootstrapError::AuthorizationRequired)
        ));
        assert!(cloud.calls.lock().unwrap().is_empty());
        assert!(host.state.lock().unwrap().pending.is_none());
    }

    #[tokio::test]
    async fn full_installation_runs_one_work_per_pass_and_refreshes_only_after_activation_receipt()
    {
        let (host, cloud, wakes, coordinator) = setup();
        coordinator.start("original").await.unwrap();
        for _ in 0..6 {
            assert!(coordinator.advance_background().await.unwrap().more);
        }
        let done = coordinator.advance_background().await.unwrap();
        assert!(!done.more);
        assert_eq!(
            done.view,
            DesktopTargetInstallationView::Completed {
                request_id: "original".into()
            }
        );
        assert_eq!(host.state.lock().unwrap().refreshes, 1);
        assert_eq!(host.state.lock().unwrap().finalizations, 1);
        assert_eq!(cloud.calls.lock().unwrap().len(), 5);
        assert_eq!(
            wakes.load(Ordering::SeqCst),
            1,
            "background must not self-wake"
        );
    }
    #[tokio::test]
    async fn every_lost_mutation_ack_restarts_with_exact_receipt_before_replaying_original_bytes() {
        for phase in [0, 1, 4, 5] {
            let (host, cloud, _, coordinator) = setup();
            reach_phase(&coordinator, &host, phase).await;
            cloud.replies.lock().unwrap().push_back(Reply::Unknown);
            assert!(matches!(
                coordinator.advance_background().await,
                Err(TargetBootstrapError::Retryable)
            ));
            let original = cloud.calls.lock().unwrap().last().unwrap().clone();
            drop(coordinator);
            let resumed = restart(&host, &cloud);
            cloud
                .replies
                .lock()
                .unwrap()
                .push_back(Reply::Body(b"uncommitted"));
            resumed.advance_background().await.unwrap();
            assert_eq!(
                cloud.calls.lock().unwrap().last().unwrap().0,
                BootstrapInstallationExchange::Receipt
            );
            resumed.advance_background().await.unwrap();
            assert_eq!(cloud.calls.lock().unwrap().last().unwrap(), &original);
            assert_eq!(host.state.lock().unwrap().phase, phase + 1);
        }
    }
    #[tokio::test]
    async fn committed_activation_receipt_is_not_resent_and_terminal_receipt_never_refreshes() {
        for committed in [true, false] {
            let (host, cloud, _, coordinator) = setup();
            reach_phase(&coordinator, &host, 5).await;
            cloud.replies.lock().unwrap().push_back(Reply::Unknown);
            assert!(coordinator.advance_background().await.is_err());
            let resumed = restart(&host, &cloud);
            cloud
                .replies
                .lock()
                .unwrap()
                .push_back(Reply::Body(if committed {
                    b"committed"
                } else {
                    b"terminal"
                }));
            let outcome = resumed.advance_background().await.unwrap();
            assert_eq!(outcome.more, committed);
            resumed.advance_background().await.unwrap();
            assert_eq!(host.state.lock().unwrap().refreshes, u64::from(committed));
            assert_eq!(
                cloud
                    .calls
                    .lock()
                    .unwrap()
                    .iter()
                    .filter(|(kind, _)| *kind == BootstrapInstallationExchange::Activate)
                    .count(),
                1
            );
        }
    }
    #[tokio::test]
    async fn power_change_after_durable_prepare_sends_nothing_and_restart_queries_receipt() {
        let (host, cloud, _, coordinator) = setup();
        coordinator.start("original").await.unwrap();
        host.power_after_prepare.store(true, Ordering::SeqCst);
        assert!(matches!(
            coordinator.advance_background().await,
            Err(TargetBootstrapError::Paused)
        ));
        assert!(cloud.calls.lock().unwrap().is_empty());
        assert!(host.state.lock().unwrap().pending.is_some());
        cloud
            .replies
            .lock()
            .unwrap()
            .push_back(Reply::Body(b"uncommitted"));
        restart(&host, &cloud).advance_background().await.unwrap();
        assert_eq!(
            cloud.calls.lock().unwrap()[0].0,
            BootstrapInstallationExchange::Receipt
        );
    }
    #[tokio::test]
    async fn response_custody_may_survive_sleep_but_cannot_publish_the_old_power_epoch() {
        let (host, cloud, _, coordinator) = setup();
        coordinator.start("original").await.unwrap();
        host.power_after_complete.store(true, Ordering::SeqCst);
        assert!(matches!(
            coordinator.advance_background().await,
            Err(TargetBootstrapError::Paused)
        ));
        assert_eq!(host.state.lock().unwrap().phase, 1);
        assert_eq!(cloud.calls.lock().unwrap().len(), 1);
    }
    #[tokio::test]
    async fn staged_database_survives_sleep_without_publishing_or_refreshing() {
        let (host, _, _, coordinator) = setup();
        reach_phase(&coordinator, &host, 3).await;
        host.power_after_install.store(true, Ordering::SeqCst);
        assert!(matches!(
            coordinator.advance_background().await,
            Err(TargetBootstrapError::Paused)
        ));
        {
            let state = host.state.lock().unwrap();
            assert!(state.installed);
            assert!(!state.published);
            assert_eq!(state.refreshes, 0);
        }
        assert!(coordinator.advance_background().await.unwrap().more);
        assert!(host.state.lock().unwrap().published);
    }
    #[tokio::test]
    async fn late_responses_fail_credential_role_shutdown_and_sleep_fences() {
        for (reply, error) in [
            (
                Reply::CredentialChanged,
                TargetBootstrapError::AuthorizationRequired,
            ),
            (
                Reply::GenerationChanged,
                TargetBootstrapError::AuthorizationRequired,
            ),
            (Reply::Shutdown, TargetBootstrapError::Cancelled),
            (Reply::Sleep, TargetBootstrapError::Paused),
        ] {
            let (host, cloud, _, coordinator) = setup();
            coordinator.start("original").await.unwrap();
            cloud.replies.lock().unwrap().push_back(reply);
            assert!(
                matches!(coordinator.advance_background().await, Err(actual) if actual == error)
            );
            assert_eq!(host.state.lock().unwrap().completions, 0);
        }
    }
    #[tokio::test]
    async fn shared_cancellation_mutex_blocks_installation_admission_until_released() {
        let (host, _, _, coordinator) = setup();
        let lock = Arc::clone(&coordinator.serialized);
        let held_by_cancel = lock.lock().await;
        let mut start = std::pin::pin!(coordinator.start("original"));
        assert!(
            tokio::time::timeout(std::time::Duration::from_millis(10), &mut start)
                .await
                .is_err()
        );
        assert!(!host.state.lock().unwrap().started);
        drop(held_by_cancel);
        start.await.unwrap();
        assert!(host.state.lock().unwrap().started);
    }
    #[tokio::test]
    async fn settled_running_view_does_not_create_a_busy_installation_deadline() {
        let (host, cloud, _, coordinator) = setup();
        coordinator.start("original").await.unwrap();
        host.state.lock().unwrap().waiting_for_cancel = true;
        let waiting = coordinator.advance_background().await.unwrap();
        assert!(matches!(
            waiting.view,
            DesktopTargetInstallationView::Running { .. }
        ));
        assert!(!waiting.more);
        assert!(cloud.calls.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn refresh_without_matching_authority_backs_off_instead_of_hot_looping() {
        let (host, cloud, _, coordinator) = setup();
        reach_phase(&coordinator, &host, 6).await;
        cloud.refresh_stays_pending.store(true, Ordering::SeqCst);
        assert!(matches!(
            coordinator.advance_background().await,
            Err(TargetBootstrapError::Retryable)
        ));
        assert_eq!(host.state.lock().unwrap().refreshes, 1);
    }
}
