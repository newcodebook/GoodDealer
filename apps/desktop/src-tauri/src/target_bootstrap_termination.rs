//! Target-only bootstrap termination. Durable intent and receipt stages stay in the Host;
//! this coordinator owns bounded fixed exchanges and the final Native publication fences.

use std::future::Future;
use std::sync::Arc;

use gooddealer_local_storage::{
    DesktopLocalHost, DesktopLocalHostError, DesktopNativeCloudAdmission,
    DesktopTargetBootstrapCancelExchange, DesktopTargetBootstrapStatusExchange,
    DesktopTargetBootstrapView,
};
use gooddealer_secure_host_core::NativePowerGate;
use tokio::sync::Mutex;

use crate::native_cloud_runtime::NativeCloudCancelFence;
use crate::native_cloud_session::{
    BootstrapTerminationExchange, NativeCloudRequestError, NativeCloudSession,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum TargetBootstrapError {
    Retryable,
    AuthorizationRequired,
    Blocked,
    Paused,
    Cancelled,
}

// These seams exercise ordering/crash/late-response behavior without selecting an alternate
// production backend. Neither trait transports a credential, filesystem handle or authority grant.
pub(crate) trait TargetBootstrapHost: Send + Sync + 'static {
    type Admission: Send + 'static;
    type StatusExchange: Send + 'static;
    type CancelExchange: Send + 'static;
    fn admit(&self) -> Result<Self::Admission, DesktopLocalHostError>;
    fn fast_recheck(&self, admission: &Self::Admission) -> Result<(), DesktopLocalHostError>;
    fn prepare_status(
        &self,
        admission: &Self::Admission,
    ) -> Result<Self::StatusExchange, DesktopLocalHostError>;
    fn status_body(exchange: &Self::StatusExchange) -> Vec<u8>;
    fn complete_status(
        &self,
        admission: &Self::Admission,
        exchange: &Self::StatusExchange,
        body: &[u8],
    ) -> Result<(DesktopTargetBootstrapView, Option<Self::CancelExchange>), DesktopLocalHostError>;
    fn prepare_cancel(
        &self,
        admission: &Self::Admission,
        preview_id: &str,
    ) -> Result<Self::CancelExchange, DesktopLocalHostError>;
    fn cancel_body(exchange: &Self::CancelExchange) -> Vec<u8>;
    fn complete_cancel(
        &self,
        admission: &Self::Admission,
        exchange: &Self::CancelExchange,
        body: &[u8],
    ) -> Result<DesktopTargetBootstrapView, DesktopLocalHostError>;
}
pub(crate) trait TargetBootstrapCloud<A>: Send + Sync + 'static {
    fn send(
        &self,
        admission: A,
        exchange: BootstrapTerminationExchange,
        body: Vec<u8>,
        credential: u64,
    ) -> impl Future<Output = Result<(A, Vec<u8>, u64), NativeCloudRequestError>> + Send;
    fn session<T>(
        &self,
        credential: Option<u64>,
        work: impl FnOnce() -> Result<T, DesktopLocalHostError>,
    ) -> Result<(T, u64), NativeCloudRequestError>;
}
pub(crate) trait TargetBootstrapPower: Send + Sync + 'static {
    fn epoch(&self) -> Result<u64, TargetBootstrapError>;
    fn changed(&self, epoch: u64) -> impl Future<Output = ()> + Send;
    fn publish<T>(&self, epoch: u64, work: impl FnOnce() -> T) -> Result<T, TargetBootstrapError>;
}

pub(crate) type DesktopTargetBootstrapTermination =
    TargetBootstrapTermination<DesktopLocalHost, NativeCloudSession, NativePowerGate>;

pub(crate) struct TargetBootstrapTermination<H: TargetBootstrapHost, C, P> {
    host: Arc<H>,
    cloud: Arc<C>,
    power: Arc<P>,
    fence: Arc<NativeCloudCancelFence>,
    wake: Arc<dyn Fn() + Send + Sync>,
    serialized: Arc<Mutex<()>>,
}
impl<H, C, P> TargetBootstrapTermination<H, C, P>
where
    H: TargetBootstrapHost,
    C: TargetBootstrapCloud<H::Admission>,
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
            power,
            fence,
            wake,
            serialized,
        }
    }
    pub(crate) async fn status(&self) -> Result<DesktopTargetBootstrapView, TargetBootstrapError> {
        let _serialized = self.serialized.lock().await;
        let epoch = self.power.epoch()?;
        self.advance(epoch).await
    }
    pub(crate) async fn advance_background(
        &self,
    ) -> Result<DesktopTargetBootstrapView, TargetBootstrapError> {
        // Background reconciliation never wakes itself; the owning lane applies bounded backoff.
        self.status().await
    }
    pub(crate) async fn cancel(
        &self,
        preview_id: &str,
    ) -> Result<DesktopTargetBootstrapView, TargetBootstrapError> {
        if preview_id.is_empty() || preview_id.len() > 160 {
            return Err(TargetBootstrapError::Blocked);
        }
        let _serialized = self.serialized.lock().await;
        let epoch = self.power.epoch()?;
        let preview_id = preview_id.to_owned();
        let ((admission, ()), credential) = self
            .stage(None, move |host| {
                let admission = host.admit()?;
                host.prepare_cancel(&admission, &preview_id)?;
                Ok((admission, ()))
            })
            .await?;
        // The intent may survive a power/session change here, but it grants no permission to
        // send. The next current-authority cycle queries that exact persisted ID before replay.
        self.final_check(epoch, credential, &admission)?;
        (self.wake)();
        // Also reconcile before the first POST: duplicate confirmations cannot blindly resend
        // an earlier unknown cancellation or accidentally target a newly discovered workflow.
        self.advance(epoch).await
    }
    async fn advance(
        &self,
        epoch: u64,
    ) -> Result<DesktopTargetBootstrapView, TargetBootstrapError> {
        let ((admission, exchange), credential) = self
            .stage(None, |host| {
                let admission = host.admit()?;
                let exchange = host.prepare_status(&admission)?;
                Ok((admission, exchange))
            })
            .await?;
        let body = H::status_body(&exchange);
        let (admission, wire, credential) = self
            .send(
                epoch,
                credential,
                admission,
                BootstrapTerminationExchange::Status,
                body,
            )
            .await?;
        let ((admission, (view, retry)), credential) = self
            .stage(Some(credential), move |host| {
                let result = host.complete_status(&admission, &exchange, &wire)?;
                Ok((admission, result))
            })
            .await?;
        self.final_check(epoch, credential, &admission)?;
        let Some(cancel) = retry else {
            return Ok(view);
        };
        let body = H::cancel_body(&cancel);
        let (admission, wire, credential) = self
            .send(
                epoch,
                credential,
                admission,
                BootstrapTerminationExchange::Cancel,
                body,
            )
            .await?;
        let ((admission, view), credential) = self
            .stage(Some(credential), move |host| {
                let view = host.complete_cancel(&admission, &cancel, &wire)?;
                Ok((admission, view))
            })
            .await?;
        self.final_check(epoch, credential, &admission)?;
        Ok(view)
    }
    async fn stage<T: Send + 'static>(
        &self,
        credential: Option<u64>,
        work: impl FnOnce(&H) -> Result<T, DesktopLocalHostError> + Send + 'static,
    ) -> Result<(T, u64), TargetBootstrapError> {
        let host = Arc::clone(&self.host);
        let cloud = Arc::clone(&self.cloud);
        let fence = Arc::clone(&self.fence);
        // Await every blocking stage through shutdown. No detached custody writer remains.
        // This scope deliberately has no power guard: keyring/file I/O belongs outside it.
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
    fn final_check(
        &self,
        epoch: u64,
        credential: u64,
        admission: &H::Admission,
    ) -> Result<(), TargetBootstrapError> {
        // Only pure identity/generation checks run under power -> cancel -> session -> Host.
        self.power
            .publish(epoch, || {
                self.fence.commit(|| {
                    self.cloud
                        .session(Some(credential), || self.host.fast_recheck(admission))
                })
            })?
            .ok_or(TargetBootstrapError::Cancelled)?
            .map(|_| ())
            .map_err(request_error)
    }
    async fn send(
        &self,
        epoch: u64,
        credential: u64,
        admission: H::Admission,
        exchange: BootstrapTerminationExchange,
        body: Vec<u8>,
    ) -> Result<(H::Admission, Vec<u8>, u64), TargetBootstrapError> {
        self.final_check(epoch, credential, &admission)?;
        tokio::select! {
            biased;
            () = self.power.changed(epoch) => Err(TargetBootstrapError::Paused),
            response = self.cloud.send(admission, exchange, body, credential) => response.map_err(request_error),
        }
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

impl TargetBootstrapHost for DesktopLocalHost {
    type Admission = DesktopNativeCloudAdmission;
    type StatusExchange = DesktopTargetBootstrapStatusExchange;
    type CancelExchange = DesktopTargetBootstrapCancelExchange;
    fn admit(&self) -> Result<Self::Admission, DesktopLocalHostError> {
        self.begin_target_installation_control_run()
    }
    fn fast_recheck(&self, admission: &Self::Admission) -> Result<(), DesktopLocalHostError> {
        self.fast_recheck_native_cloud(admission)
    }
    fn prepare_status(
        &self,
        admission: &Self::Admission,
    ) -> Result<Self::StatusExchange, DesktopLocalHostError> {
        self.prepare_target_bootstrap_status(admission)
    }
    fn status_body(exchange: &Self::StatusExchange) -> Vec<u8> {
        exchange.request_bytes().to_vec()
    }
    fn complete_status(
        &self,
        admission: &Self::Admission,
        exchange: &Self::StatusExchange,
        body: &[u8],
    ) -> Result<(DesktopTargetBootstrapView, Option<Self::CancelExchange>), DesktopLocalHostError>
    {
        self.complete_target_bootstrap_status(admission, exchange, body)
            .map(gooddealer_local_storage::DesktopTargetBootstrapStatusOutcome::into_parts)
    }
    fn prepare_cancel(
        &self,
        admission: &Self::Admission,
        preview_id: &str,
    ) -> Result<Self::CancelExchange, DesktopLocalHostError> {
        self.prepare_target_bootstrap_cancel(admission, preview_id)
    }
    fn cancel_body(exchange: &Self::CancelExchange) -> Vec<u8> {
        exchange.request_bytes().to_vec()
    }
    fn complete_cancel(
        &self,
        admission: &Self::Admission,
        exchange: &Self::CancelExchange,
        body: &[u8],
    ) -> Result<DesktopTargetBootstrapView, DesktopLocalHostError> {
        self.complete_target_bootstrap_cancel(admission, exchange, body)
    }
}
impl TargetBootstrapCloud<DesktopNativeCloudAdmission> for NativeCloudSession {
    async fn send(
        &self,
        admission: DesktopNativeCloudAdmission,
        exchange: BootstrapTerminationExchange,
        body: Vec<u8>,
        credential: u64,
    ) -> Result<(DesktopNativeCloudAdmission, Vec<u8>, u64), NativeCloudRequestError> {
        self.send_bootstrap_termination(admission, exchange, body, credential)
            .await
            .map(crate::native_cloud_session::NativeCloudJsonResponse::into_parts)
    }
    fn session<T>(
        &self,
        credential: Option<u64>,
        work: impl FnOnce() -> Result<T, DesktopLocalHostError>,
    ) -> Result<(T, u64), NativeCloudRequestError> {
        self.with_target_bootstrap_session(credential, work)
    }
}
impl TargetBootstrapPower for NativePowerGate {
    fn epoch(&self) -> Result<u64, TargetBootstrapError> {
        let epoch = self.snapshot().epoch;
        let _guard = self
            .hold_reconciliation_epoch(epoch)
            .map_err(|_| TargetBootstrapError::Paused)?;
        Ok(epoch)
    }
    async fn changed(&self, epoch: u64) {
        self.wait_for_epoch_change(epoch).await;
    }
    fn publish<T>(&self, epoch: u64, work: impl FnOnce() -> T) -> Result<T, TargetBootstrapError> {
        let _guard = self
            .hold_reconciliation_epoch(epoch)
            .map_err(|_| TargetBootstrapError::Paused)?;
        Ok(work())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use gooddealer_local_storage::DesktopTargetBootstrapTerminalStatus;
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
                let notify = self.changed.notified();
                tokio::pin!(notify);
                notify.as_mut().enable();
                if self.epoch.load(Ordering::SeqCst) != epoch {
                    return;
                }
                notify.await;
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
    #[derive(Default)]
    struct State {
        available: bool,
        pending: bool,
        terminal: Option<DesktopTargetBootstrapTerminalStatus>,
        persist_count: usize,
        response_count: usize,
    }
    struct Host {
        state: StdMutex<State>,
        power: Arc<Power>,
        generation: AtomicU64,
        bump_after_intent: AtomicBool,
        bump_after_status: AtomicBool,
        bump_after_receipt: AtomicBool,
    }
    impl Host {
        fn assert_custody_stage(&self) {
            assert!(
                !self.power.publishing.load(Ordering::SeqCst),
                "custody under power mutex"
            );
        }
        fn pending_view() -> DesktopTargetBootstrapView {
            DesktopTargetBootstrapView::Pending {
                request_id: "original".into(),
            }
        }
        fn terminal_view(
            status: DesktopTargetBootstrapTerminalStatus,
        ) -> DesktopTargetBootstrapView {
            DesktopTargetBootstrapView::Finished {
                request_id: "original".into(),
                status,
            }
        }
    }
    impl TargetBootstrapHost for Host {
        type Admission = u64;
        type StatusExchange = bool;
        type CancelExchange = Vec<u8>;
        fn admit(&self) -> Result<u64, DesktopLocalHostError> {
            Ok(self.generation.load(Ordering::SeqCst))
        }
        fn fast_recheck(&self, admission: &u64) -> Result<(), DesktopLocalHostError> {
            if *admission != self.generation.load(Ordering::SeqCst) {
                return Err(DesktopLocalHostError::AuthorityRejected);
            }
            Ok(())
        }
        fn prepare_status(&self, admission: &u64) -> Result<bool, DesktopLocalHostError> {
            self.assert_custody_stage();
            self.fast_recheck(admission)?;
            let state = self.state.lock().unwrap();
            Ok(state.pending || state.terminal.is_some())
        }
        fn status_body(exact: &bool) -> Vec<u8> {
            if *exact {
                b"status:original".to_vec()
            } else {
                b"discover".to_vec()
            }
        }
        fn complete_status(
            &self,
            admission: &u64,
            _: &bool,
            body: &[u8],
        ) -> Result<(DesktopTargetBootstrapView, Option<Vec<u8>>), DesktopLocalHostError> {
            self.assert_custody_stage();
            self.fast_recheck(admission)?;
            let mut state = self.state.lock().unwrap();
            state.response_count += 1;
            let result = match body {
                b"bootstrapping:original" if state.pending => {
                    (Self::pending_view(), Some(b"cancel:original".to_vec()))
                }
                b"bootstrapping:original" => {
                    state.available = true;
                    (
                        DesktopTargetBootstrapView::Available {
                            request_id: "original".into(),
                            bootstrap_expires_at: "2030-01-01T00:00:00.000Z".into(),
                        },
                        None,
                    )
                }
                b"cancelled:original" | b"completed:original" | b"failed:original" => {
                    let terminal = match body {
                        b"cancelled:original" => DesktopTargetBootstrapTerminalStatus::Cancelled,
                        b"completed:original" => DesktopTargetBootstrapTerminalStatus::Completed,
                        _ => DesktopTargetBootstrapTerminalStatus::Failed,
                    };
                    state.pending = false;
                    state.terminal = Some(terminal.clone());
                    (Self::terminal_view(terminal), None)
                }
                b"missing" => (DesktopTargetBootstrapView::Idle, None),
                _ => return Err(DesktopLocalHostError::CloudProtocolRejected),
            };
            if self.bump_after_status.swap(false, Ordering::SeqCst) {
                self.power.change();
            }
            Ok(result)
        }
        fn prepare_cancel(
            &self,
            admission: &u64,
            preview: &str,
        ) -> Result<Vec<u8>, DesktopLocalHostError> {
            self.assert_custody_stage();
            self.fast_recheck(admission)?;
            let mut state = self.state.lock().unwrap();
            if preview != "original"
                || !state.available
                || state.pending
                || state.terminal.is_some()
            {
                return Err(DesktopLocalHostError::CloudProtocolRejected);
            }
            state.pending = true;
            state.persist_count += 1;
            if self.bump_after_intent.swap(false, Ordering::SeqCst) {
                self.power.change();
            }
            Ok(b"cancel:original".to_vec())
        }
        fn cancel_body(exchange: &Vec<u8>) -> Vec<u8> {
            exchange.clone()
        }
        fn complete_cancel(
            &self,
            admission: &u64,
            exchange: &Vec<u8>,
            body: &[u8],
        ) -> Result<DesktopTargetBootstrapView, DesktopLocalHostError> {
            self.assert_custody_stage();
            self.fast_recheck(admission)?;
            assert_eq!(exchange, b"cancel:original");
            let mut state = self.state.lock().unwrap();
            state.response_count += 1;
            if body == b"rejected" {
                return Ok(Self::pending_view());
            }
            if body != b"cancelled:original" {
                return Err(DesktopLocalHostError::CloudProtocolRejected);
            }
            state.pending = false;
            state.terminal = Some(DesktopTargetBootstrapTerminalStatus::Cancelled);
            if self.bump_after_receipt.swap(false, Ordering::SeqCst) {
                self.power.change();
            }
            Ok(Self::terminal_view(
                DesktopTargetBootstrapTerminalStatus::Cancelled,
            ))
        }
    }
    enum Reply {
        Body(&'static [u8]),
        Unknown,
        ChangeCredential,
        ChangeGeneration,
        Shutdown,
        Sleep,
    }
    struct Cloud {
        replies: StdMutex<VecDeque<Reply>>,
        calls: StdMutex<Vec<(BootstrapTerminationExchange, Vec<u8>)>>,
        credential: AtomicU64,
        closed: AtomicBool,
        host: Arc<Host>,
        fence: Arc<NativeCloudCancelFence>,
    }
    impl TargetBootstrapCloud<u64> for Cloud {
        async fn send(
            &self,
            admission: u64,
            exchange: BootstrapTerminationExchange,
            body: Vec<u8>,
            credential: u64,
        ) -> Result<(u64, Vec<u8>, u64), NativeCloudRequestError> {
            assert!(!self.host.power.publishing.load(Ordering::SeqCst));
            assert_eq!(credential, self.credential.load(Ordering::SeqCst));
            if exchange == BootstrapTerminationExchange::Cancel {
                assert!(
                    self.host.state.lock().unwrap().pending,
                    "HTTP before persisted intent"
                );
            }
            self.calls.lock().unwrap().push((exchange, body));
            let reply = self
                .replies
                .lock()
                .unwrap()
                .pop_front()
                .expect("unexpected network request");
            match reply {
                Reply::Body(body) => Ok((admission, body.to_vec(), credential)),
                Reply::Unknown => Err(NativeCloudRequestError::OutcomeUnknown),
                Reply::ChangeCredential => {
                    self.credential.fetch_add(1, Ordering::SeqCst);
                    Ok((admission, b"cancelled:original".to_vec(), credential))
                }
                Reply::ChangeGeneration => {
                    self.host.generation.fetch_add(1, Ordering::SeqCst);
                    Ok((admission, b"cancelled:original".to_vec(), credential))
                }
                Reply::Shutdown => {
                    self.closed.store(true, Ordering::SeqCst);
                    self.fence.cancel();
                    Ok((admission, b"cancelled:original".to_vec(), credential))
                }
                Reply::Sleep => {
                    self.host.power.change();
                    std::future::pending().await
                }
            }
        }
        fn session<T>(
            &self,
            credential: Option<u64>,
            work: impl FnOnce() -> Result<T, DesktopLocalHostError>,
        ) -> Result<(T, u64), NativeCloudRequestError> {
            let current = self.credential.load(Ordering::SeqCst);
            if self.closed.load(Ordering::SeqCst)
                || credential.is_some_and(|expected| expected != current)
            {
                return Err(NativeCloudRequestError::AuthorizationRequired);
            }
            work()
                .map(|value| (value, current))
                .map_err(|error| match error {
                    DesktopLocalHostError::AuthorityRejected => {
                        NativeCloudRequestError::AuthorityStale
                    }
                    _ => NativeCloudRequestError::ProtocolBlocked,
                })
        }
    }
    type Coordinator = TargetBootstrapTermination<Host, Cloud, Power>;
    fn setup(replies: Vec<Reply>) -> (Arc<Host>, Arc<Cloud>, Coordinator) {
        let power = Arc::new(Power::default());
        let host = Arc::new(Host {
            state: StdMutex::new(State {
                available: true,
                ..State::default()
            }),
            power: Arc::clone(&power),
            generation: AtomicU64::new(1),
            bump_after_intent: AtomicBool::new(false),
            bump_after_status: AtomicBool::new(false),
            bump_after_receipt: AtomicBool::new(false),
        });
        let fence = Arc::new(NativeCloudCancelFence::default());
        let cloud = Arc::new(Cloud {
            replies: StdMutex::new(replies.into()),
            calls: StdMutex::new(Vec::new()),
            credential: AtomicU64::new(1),
            closed: AtomicBool::new(false),
            host: Arc::clone(&host),
            fence: Arc::clone(&fence),
        });
        let coordinator = Coordinator::new(
            Arc::clone(&host),
            Arc::clone(&cloud),
            fence,
            power,
            Arc::new(|| {}),
            Arc::new(Mutex::new(())),
        );
        (host, cloud, coordinator)
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
    #[tokio::test]
    async fn discovery_never_cancels_without_confirmation() {
        let (host, cloud, coordinator) = setup(vec![Reply::Body(b"bootstrapping:original")]);
        assert!(matches!(
            coordinator.status().await.unwrap(),
            DesktopTargetBootstrapView::Available { .. }
        ));
        assert_eq!(host.state.lock().unwrap().persist_count, 0);
        assert_eq!(
            cloud.calls.lock().unwrap().as_slice(),
            &[(BootstrapTerminationExchange::Status, b"discover".to_vec())]
        );
    }
    #[tokio::test]
    async fn unknown_ack_then_restart_queries_original_id_and_does_not_resend_terminal() {
        let (host, cloud, coordinator) = setup(vec![
            Reply::Body(b"bootstrapping:original"),
            Reply::Unknown,
            Reply::Body(b"cancelled:original"),
        ]);
        assert_eq!(
            coordinator.cancel("original").await,
            Err(TargetBootstrapError::Retryable)
        );
        assert!(host.state.lock().unwrap().pending);
        drop(coordinator);
        assert_eq!(
            restart(&host, &cloud).advance_background().await.unwrap(),
            Host::terminal_view(DesktopTargetBootstrapTerminalStatus::Cancelled)
        );
        assert_eq!(
            cloud.calls.lock().unwrap().as_slice(),
            &[
                (
                    BootstrapTerminationExchange::Status,
                    b"status:original".to_vec()
                ),
                (
                    BootstrapTerminationExchange::Cancel,
                    b"cancel:original".to_vec()
                ),
                (
                    BootstrapTerminationExchange::Status,
                    b"status:original".to_vec()
                ),
            ]
        );
    }
    #[tokio::test]
    async fn unknown_ack_replays_only_after_exact_pending_status() {
        let (host, cloud, coordinator) = setup(vec![
            Reply::Body(b"bootstrapping:original"),
            Reply::Unknown,
            Reply::Body(b"bootstrapping:original"),
            Reply::Body(b"cancelled:original"),
        ]);
        assert_eq!(
            coordinator.cancel("original").await,
            Err(TargetBootstrapError::Retryable)
        );
        restart(&host, &cloud).advance_background().await.unwrap();
        let calls = cloud.calls.lock().unwrap();
        assert_eq!(calls[0], calls[2]);
        assert_eq!(calls[1], calls[3]);
    }
    #[tokio::test]
    async fn stale_preview_or_different_workflow_never_sends_cancel() {
        let (_, cloud, coordinator) = setup(vec![]);
        assert_eq!(
            coordinator.cancel("new-workflow").await,
            Err(TargetBootstrapError::Blocked)
        );
        assert!(cloud.calls.lock().unwrap().is_empty());
        let (host, cloud, coordinator) = setup(vec![Reply::Body(b"bootstrapping:new-workflow")]);
        assert_eq!(
            coordinator.cancel("original").await,
            Err(TargetBootstrapError::Blocked)
        );
        assert!(host.state.lock().unwrap().pending);
        assert_eq!(cloud.calls.lock().unwrap().len(), 1);
    }
    #[tokio::test]
    async fn terminal_activation_or_expiry_win_without_cancellation() {
        for (body, terminal) in [
            (
                b"completed:original".as_slice(),
                DesktopTargetBootstrapTerminalStatus::Completed,
            ),
            (
                b"failed:original".as_slice(),
                DesktopTargetBootstrapTerminalStatus::Failed,
            ),
        ] {
            let (_, cloud, coordinator) = setup(vec![Reply::Body(body)]);
            assert_eq!(
                coordinator.cancel("original").await.unwrap(),
                Host::terminal_view(terminal)
            );
            assert_eq!(cloud.calls.lock().unwrap().len(), 1);
        }
    }
    #[tokio::test]
    async fn power_change_after_intent_keeps_durable_original_without_network() {
        let (host, cloud, coordinator) = setup(vec![
            Reply::Body(b"bootstrapping:original"),
            Reply::Body(b"cancelled:original"),
        ]);
        host.bump_after_intent.store(true, Ordering::SeqCst);
        assert_eq!(
            coordinator.cancel("original").await,
            Err(TargetBootstrapError::Paused)
        );
        assert!(host.state.lock().unwrap().pending);
        assert!(cloud.calls.lock().unwrap().is_empty());
        restart(&host, &cloud).advance_background().await.unwrap();
    }
    #[tokio::test]
    async fn power_change_after_status_stage_prevents_cancel_dispatch() {
        let (host, cloud, coordinator) = setup(vec![
            Reply::Body(b"bootstrapping:original"),
            Reply::Body(b"bootstrapping:original"),
            Reply::Body(b"cancelled:original"),
        ]);
        host.bump_after_status.store(true, Ordering::SeqCst);
        assert_eq!(
            coordinator.cancel("original").await,
            Err(TargetBootstrapError::Paused)
        );
        assert!(host.state.lock().unwrap().pending);
        assert_eq!(cloud.calls.lock().unwrap().len(), 1);
        restart(&host, &cloud).advance_background().await.unwrap();
        let calls = cloud.calls.lock().unwrap();
        assert_eq!(calls[0], calls[1]);
        assert_eq!(calls[2].0, BootstrapTerminationExchange::Cancel);
    }

    #[tokio::test]
    async fn response_stage_persists_without_publishing_across_power_change() {
        let (host, cloud, coordinator) = setup(vec![
            Reply::Body(b"bootstrapping:original"),
            Reply::Body(b"cancelled:original"),
            Reply::Body(b"cancelled:original"),
        ]);
        host.bump_after_receipt.store(true, Ordering::SeqCst);
        assert_eq!(
            coordinator.cancel("original").await,
            Err(TargetBootstrapError::Paused)
        );
        assert_eq!(
            host.state.lock().unwrap().terminal,
            Some(DesktopTargetBootstrapTerminalStatus::Cancelled)
        );
        assert_eq!(
            restart(&host, &cloud).advance_background().await.unwrap(),
            Host::terminal_view(DesktopTargetBootstrapTerminalStatus::Cancelled)
        );
    }
    #[tokio::test]
    async fn credential_role_shutdown_or_sleep_changes_reject_late_response() {
        for (reply, error) in [
            (
                Reply::ChangeCredential,
                TargetBootstrapError::AuthorizationRequired,
            ),
            (
                Reply::ChangeGeneration,
                TargetBootstrapError::AuthorizationRequired,
            ),
            (Reply::Shutdown, TargetBootstrapError::Cancelled),
            (Reply::Sleep, TargetBootstrapError::Paused),
        ] {
            let (host, _, coordinator) = setup(vec![Reply::Body(b"bootstrapping:original"), reply]);
            assert_eq!(coordinator.cancel("original").await, Err(error));
            let state = host.state.lock().unwrap();
            assert!(state.pending);
            assert!(state.terminal.is_none());
        }
    }
    #[tokio::test]
    async fn concurrent_confirmations_serialize_and_cannot_cancel_twice() {
        let (host, cloud, coordinator) = setup(vec![
            Reply::Body(b"bootstrapping:original"),
            Reply::Body(b"cancelled:original"),
        ]);
        let (first, second) = tokio::join!(
            coordinator.cancel("original"),
            coordinator.cancel("original")
        );
        assert_eq!(
            first.unwrap(),
            Host::terminal_view(DesktopTargetBootstrapTerminalStatus::Cancelled)
        );
        assert_eq!(second, Err(TargetBootstrapError::Blocked));
        assert_eq!(host.state.lock().unwrap().persist_count, 1);
        assert_eq!(cloud.calls.lock().unwrap().len(), 2);
    }
}
