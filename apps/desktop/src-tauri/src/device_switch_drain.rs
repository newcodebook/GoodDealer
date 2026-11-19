//! ADR-0032 S2d3: the source Desktop's coordination of a normal device switch.
//!
//! One coordinator serializes every exchange of this device's switch. It asks Cloud for the switch
//! and closes local writes only behind the id Cloud returned, lets the sync lane drain the Outbox,
//! reads Cloud's receipts for legacy rows, and signs and submits the drain proof only when the
//! Host reports the mutation stream fully confirmed. It records the signed attempt before sending
//! and reconciles any interrupted submission by status. It reopens writes only when Cloud reports
//! the switch cancelled or failed without an accepted handoff receipt. Every Cloud answer is
//! decoded by the Host; this module holds no wire format, credential or private key, and signs
//! only the transcript the Host built.

use std::future::Future;
use std::sync::Arc;

use gooddealer_local_storage::{
    DesktopDeviceSwitchOutcome, DesktopDeviceSwitchRejection, DesktopDeviceSwitchRequestExchange,
    DesktopDeviceSwitchRequestResolution, DesktopDeviceSwitchRequestResolutionOutcome,
    DesktopDeviceSwitchStart, DesktopDeviceSwitchStatus, DesktopDrainProgress,
    DesktopDrainProofDraft, DesktopDrainReceiptQuery, DesktopLocalHost, DesktopLocalHostError,
    DesktopNativeCloudAdmission,
};
use tokio::sync::Mutex;

use crate::native_cloud_runtime::NativeCloudCancelFence;
use crate::native_cloud_session::{
    DeviceSwitchExchange, NativeCloudRequestError, NativeCloudSession,
};

/// Receipt reads one advance may make: 64 reads of at most 256 legacy rows each.
const MAX_RECEIPT_ROUNDS: usize = 64;

/// Where this device's switch stands after one coordinator call.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum DeviceSwitchStep {
    /// No switch holds this device's writes closed under its current Lease.
    Idle,
    /// A durable initial request still needs its original Cloud outcome reconciled.
    RequestPending,
    /// Cloud refused; local writes are as they were.
    Rejected(DesktopDeviceSwitchRejection),
    /// Writes are closed and Outbox rows still wait for a durable Cloud result; sync was woken.
    WaitingForSync { unconfirmed: u64 },
    /// A row can never reach a result that permits a proof; only cancelling reopens writes.
    Blocked,
    /// Cloud returned no receipt for a legacy row, so no proof is signed (fail closed).
    ReceiptsMissing,
    /// Cloud's state of the switch; writes stay closed.
    Switch(DesktopDeviceSwitchStatus),
    /// Cloud ended the switch before releasing this source, and this device reopened its writes.
    WritesReopened,
}

/// Why a coordinator call stopped without a step. None carries Cloud, Host or key text.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum DeviceSwitchError {
    /// Nothing changed that the next call cannot repeat.
    Retryable,
    /// The session or the Lease authority must be renewed first.
    AuthorizationRequired,
    /// A protocol, signing or storage refusal.
    Blocked,
    /// The native session is shutting down.
    Cancelled,
}

/// The Cloud exchanges of a switch.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum SwitchCloudExchange {
    Receipts,
    Switch(DeviceSwitchExchange),
}

struct SubmissionStatus {
    stopped: Option<DeviceSwitchStep>,
    target: Option<String>,
    replay: Option<Vec<u8>>,
}

/// The Host operations the coordinator needs. Every method may block on local storage.
pub(crate) trait SwitchHost: Send + Sync + 'static {
    type Admission: Send + 'static;
    type Exchange: Clone + Send + Sync + 'static;
    type Resolution: Send + 'static;
    type ReceiptQuery: Send + 'static;
    type Draft: Send + 'static;

    fn admit(&self) -> Result<Self::Admission, DesktopLocalHostError>;
    fn admit_read(&self) -> Result<Self::Admission, DesktopLocalHostError>;
    fn is_active(admission: &Self::Admission) -> bool;
    fn prepare_request(
        &self,
        admission: &Self::Admission,
        target_device_id: &str,
    ) -> Result<Self::Exchange, DesktopLocalHostError>;
    fn pending_request(
        &self,
        admission: &Self::Admission,
    ) -> Result<Option<Self::Exchange>, DesktopLocalHostError>;
    fn prepare_resolution(
        &self,
        admission: &Self::Admission,
    ) -> Result<Option<Self::Resolution>, DesktopLocalHostError>;
    fn resolution_body(resolution: &Self::Resolution) -> Vec<u8>;
    fn complete_resolution(
        &self,
        admission: &Self::Admission,
        resolution: &Self::Resolution,
        wire: &[u8],
    ) -> Result<DesktopDeviceSwitchRequestResolutionOutcome, DesktopLocalHostError>;
    fn exchange_body(exchange: &Self::Exchange) -> Vec<u8>;
    fn complete_request(
        &self,
        admission: &Self::Admission,
        exchange: &Self::Exchange,
        wire: &[u8],
    ) -> Result<DesktopDeviceSwitchStart, DesktopLocalHostError>;
    fn clear_left_over(&self, admission: &Self::Admission) -> Result<bool, DesktopLocalHostError>;
    fn in_progress(
        &self,
        admission: &Self::Admission,
    ) -> Result<Option<String>, DesktopLocalHostError>;
    fn progress(
        &self,
        admission: &Self::Admission,
    ) -> Result<DesktopDrainProgress, DesktopLocalHostError>;
    fn receipt_query(
        &self,
        admission: &Self::Admission,
    ) -> Result<Option<Self::ReceiptQuery>, DesktopLocalHostError>;
    fn receipt_body(query: &Self::ReceiptQuery) -> Vec<u8>;
    fn complete_receipts(
        &self,
        admission: &Self::Admission,
        query: &Self::ReceiptQuery,
        wire: &[u8],
    ) -> Result<(), DesktopLocalHostError>;
    fn prepare_proof(
        &self,
        admission: &Self::Admission,
        id: &str,
        signing_key_id: &str,
    ) -> Result<Self::Draft, DesktopLocalHostError>;
    fn transcript(draft: &Self::Draft) -> &[u8];
    fn persist_attempt(
        &self,
        admission: &Self::Admission,
        draft: &Self::Draft,
        device_signature: &str,
        target_device_id: &str,
    ) -> Result<(), DesktopLocalHostError>;
    fn attempt_pending(
        &self,
        admission: &Self::Admission,
        id: &str,
    ) -> Result<bool, DesktopLocalHostError>;
    fn attempt_succeeded(
        &self,
        admission: &Self::Admission,
        id: &str,
    ) -> Result<bool, DesktopLocalHostError>;
    fn pending_submission(
        &self,
        admission: &Self::Admission,
        id: &str,
        status_wire: &[u8],
    ) -> Result<Option<Vec<u8>>, DesktopLocalHostError>;
    fn response_target(
        &self,
        admission: &Self::Admission,
        id: &str,
        wire: &[u8],
    ) -> Result<Option<String>, DesktopLocalHostError>;
    fn submission(
        &self,
        draft: &Self::Draft,
        signature: &str,
    ) -> Result<Vec<u8>, DesktopLocalHostError>;
    fn lookup(id: &str) -> Result<Vec<u8>, DesktopLocalHostError>;
    fn complete_switch(
        &self,
        admission: &Self::Admission,
        id: &str,
        wire: &[u8],
    ) -> Result<DesktopDeviceSwitchOutcome, DesktopLocalHostError>;
    fn clear_barrier(
        &self,
        admission: &Self::Admission,
        id: &str,
    ) -> Result<(), DesktopLocalHostError>;
}

/// The authenticated Cloud data plane: one bounded exchange, and the credential-instance fence
/// held across the Host's commit of its answer.
pub(crate) trait SwitchCloud<A>: Send + Sync + 'static {
    fn send(
        self: &Arc<Self>,
        admission: A,
        exchange: SwitchCloudExchange,
        body: Vec<u8>,
    ) -> impl Future<Output = Result<(A, Vec<u8>, u64), NativeCloudRequestError>> + Send;

    fn commit<T>(
        &self,
        credential_instance: u64,
        commit: impl FnOnce() -> Result<T, DesktopLocalHostError>,
    ) -> Result<T, NativeCloudRequestError>;
}

/// The device key, which signs only a Host-built drain proof transcript naming this device.
pub(crate) trait DrainProofSigner: Send + Sync + 'static {
    fn signing_key_id(&self) -> Option<&str>;
    fn sign_drain_proof(&self, transcript: &[u8]) -> Option<String>;
}

/// The production coordinator: the Desktop Host, the native Cloud session and the device key.
pub(crate) type DesktopDeviceSwitch = DeviceSwitchCoordinator<
    DesktopLocalHost,
    NativeCloudSession,
    crate::oauth_runtime::DesktopOAuthRuntime,
>;

pub(crate) struct DeviceSwitchCoordinator<H: SwitchHost, C, S> {
    host: Arc<H>,
    cloud: Arc<C>,
    signer: Arc<S>,
    fence: Arc<NativeCloudCancelFence>,
    wake_sync: Arc<dyn Fn() + Send + Sync>,
    /// Serializes calls; request identity and state are persisted by the Host before HTTP.
    serialized: Mutex<()>,
}

impl<H, C, S> DeviceSwitchCoordinator<H, C, S>
where
    H: SwitchHost,
    C: SwitchCloud<H::Admission>,
    S: DrainProofSigner,
{
    pub(crate) fn new(
        host: Arc<H>,
        cloud: Arc<C>,
        signer: Arc<S>,
        fence: Arc<NativeCloudCancelFence>,
        wake_sync: Arc<dyn Fn() + Send + Sync>,
    ) -> Self {
        Self {
            host,
            cloud,
            signer,
            fence,
            wake_sync,
            serialized: Mutex::new(()),
        }
    }

    /// Asks Cloud for a normal switch to `target_device_id` and starts this device's drain. A
    /// switch already holding this device's writes closed is resumed instead, whatever its target:
    /// only one switch can be open, and its id came from Cloud. Likewise a request still
    /// unanswered is settled first under its own key and target, since Cloud may already hold it
    /// open; only an answered request lets a new one, with a new key, be prepared.
    pub(crate) async fn request(
        &self,
        target_device_id: &str,
    ) -> Result<DeviceSwitchStep, DeviceSwitchError> {
        let _serialized = self.serialized.lock().await;
        let admission = self.admit().await?;
        let (admission, _) = self.run(admission, H::clear_left_over).await?;
        let (admission, open) = self.run(admission, H::in_progress).await?;
        if let Some(id) = open {
            return self.advance_locked(admission, id, true).await;
        }
        let (admission, pending) = self.run(admission, H::prepare_resolution).await?;
        if let Some(resolution) = pending {
            // Never turn a user retry or a new target selection into a second initial request.
            return self.resolve_request(admission, resolution, true).await;
        }
        let target = target_device_id.to_owned();
        let (admission, exchange) = self
            .run(admission, move |host, admission| {
                host.prepare_request(admission, &target)
            })
            .await?;
        self.submit_request(admission, exchange, true).await
    }

    async fn submit_request(
        &self,
        admission: H::Admission,
        exchange: H::Exchange,
        wake_sync: bool,
    ) -> Result<DeviceSwitchStep, DeviceSwitchError> {
        let body = H::exchange_body(&exchange);
        let committed = exchange.clone();
        let started = self
            .exchange(
                admission,
                SwitchCloudExchange::Switch(DeviceSwitchExchange::Request),
                body,
                move |host, admission, wire| {
                    let start = host.complete_request(admission, &committed, wire)?;
                    Ok(start)
                },
            )
            .await;
        self.resume_start(started?, wake_sync).await
    }

    async fn resume_start(
        &self,
        start: DesktopDeviceSwitchStart,
        wake_sync: bool,
    ) -> Result<DeviceSwitchStep, DeviceSwitchError> {
        match start {
            DesktopDeviceSwitchStart::Rejected(code) => Ok(DeviceSwitchStep::Rejected(code)),
            DesktopDeviceSwitchStart::Accepted {
                device_switch_request_id,
                status: DesktopDeviceSwitchStatus::Requested | DesktopDeviceSwitchStatus::Draining,
            } => {
                let admission = self.admit().await?;
                self.advance_locked(admission, device_switch_request_id, wake_sync)
                    .await
            }
            DesktopDeviceSwitchStart::Accepted { status, .. } => {
                Ok(DeviceSwitchStep::Switch(status))
            }
        }
    }

    async fn resolve_request(
        &self,
        admission: H::Admission,
        resolution: H::Resolution,
        wake_sync: bool,
    ) -> Result<DeviceSwitchStep, DeviceSwitchError> {
        let body = H::resolution_body(&resolution);
        let outcome = self
            .exchange(
                admission,
                SwitchCloudExchange::Switch(DeviceSwitchExchange::Resolve),
                body,
                move |host, admission, wire| host.complete_resolution(admission, &resolution, wire),
            )
            .await?;
        match outcome {
            DesktopDeviceSwitchRequestResolutionOutcome::Resolved(start) => {
                self.resume_start(start, wake_sync).await
            }
            // A higher verified epoch consumes the old intent; a fresh preview is required to
            // start another handoff. It must never become an automatic new POST.
            DesktopDeviceSwitchRequestResolutionOutcome::Superseded => Ok(DeviceSwitchStep::Idle),
            DesktopDeviceSwitchRequestResolutionOutcome::RetryCurrentRequest => {
                let admission = self.admit().await?;
                let (admission, pending) = self.run(admission, H::pending_request).await?;
                let exchange = pending.ok_or(DeviceSwitchError::Blocked)?;
                self.submit_request(admission, exchange, wake_sync).await
            }
        }
    }

    /// Moves this device's open switch forward: waits for sync, reads receipts, then signs and
    /// submits the drain proof.
    pub(crate) async fn advance(&self) -> Result<DeviceSwitchStep, DeviceSwitchError> {
        self.advance_with_wake(true).await
    }

    pub(crate) async fn advance_background(&self) -> Result<DeviceSwitchStep, DeviceSwitchError> {
        self.advance_with_wake(false).await
    }

    async fn advance_with_wake(
        &self,
        wake_sync: bool,
    ) -> Result<DeviceSwitchStep, DeviceSwitchError> {
        let _serialized = self.serialized.lock().await;
        let admission = self.admit().await?;
        let (admission, open) = self.run(admission, H::in_progress).await?;
        if let Some(id) = open {
            self.advance_locked(admission, id, wake_sync).await
        } else {
            let (admission, pending) = self.run(admission, H::prepare_resolution).await?;
            match pending {
                Some(resolution) => self.resolve_request(admission, resolution, wake_sync).await,
                None => Ok(DeviceSwitchStep::Idle),
            }
        }
    }

    /// Asks Cloud to cancel this device's open switch; writes reopen only once Cloud confirms.
    pub(crate) async fn cancel(&self) -> Result<DeviceSwitchStep, DeviceSwitchError> {
        self.lookup(DeviceSwitchExchange::Cancel).await
    }

    /// Reads the open switch; only an Active device may reopen writes when Cloud ends it.
    pub(crate) async fn status(&self) -> Result<DeviceSwitchStep, DeviceSwitchError> {
        self.lookup(DeviceSwitchExchange::Status).await
    }

    async fn lookup(
        &self,
        exchange: DeviceSwitchExchange,
    ) -> Result<DeviceSwitchStep, DeviceSwitchError> {
        let _serialized = self.serialized.lock().await;
        let admission = if exchange == DeviceSwitchExchange::Status {
            self.admit_read().await?
        } else {
            self.admit().await?
        };
        let (admission, open) = self.run(admission, H::in_progress).await?;
        let Some(id) = open else {
            let (_, pending) = self
                .run(admission, |host, admission| {
                    if H::is_active(admission) {
                        host.prepare_resolution(admission)
                            .map(|pending| pending.is_some())
                    } else {
                        host.pending_request(admission)
                            .map(|pending| pending.is_some())
                    }
                })
                .await?;
            return Ok(if pending {
                DeviceSwitchStep::RequestPending
            } else {
                DeviceSwitchStep::Idle
            });
        };
        let body = H::lookup(&id).map_err(host_error)?;
        self.settle(admission, SwitchCloudExchange::Switch(exchange), body, id)
            .await
    }

    async fn advance_locked(
        &self,
        mut admission: H::Admission,
        id: String,
        wake_sync: bool,
    ) -> Result<DeviceSwitchStep, DeviceSwitchError> {
        let pending_id = id.clone();
        let (current, pending) = self
            .run(admission, move |host, admission| {
                host.attempt_pending(admission, &pending_id)
            })
            .await?;
        admission = current;
        if pending {
            return self.resume_proof(admission, id).await;
        }
        let mut previous_query: Option<Vec<u8>> = None;
        let mut rounds = 0;
        loop {
            let (current, progress) = self.run(admission, H::progress).await?;
            match progress {
                DesktopDrainProgress::Waiting { unconfirmed } => {
                    if wake_sync {
                        (self.wake_sync)();
                    }
                    return Ok(DeviceSwitchStep::WaitingForSync { unconfirmed });
                }
                DesktopDrainProgress::Blocked => return Ok(DeviceSwitchStep::Blocked),
                DesktopDrainProgress::Ready => return self.submit_proof(current, id).await,
                DesktopDrainProgress::ReceiptsRequired => {
                    if rounds == MAX_RECEIPT_ROUNDS {
                        return Ok(DeviceSwitchStep::ReceiptsMissing);
                    }
                    let (current, query) = self.run(current, H::receipt_query).await?;
                    // Progress and the query read the same rows; disagreement is a Host fault.
                    let query = query.ok_or(DeviceSwitchError::Blocked)?;
                    let body = H::receipt_body(&query);
                    // Cloud answered the same rows before without a receipt for every one.
                    if previous_query.as_ref() == Some(&body) {
                        return Ok(DeviceSwitchStep::ReceiptsMissing);
                    }
                    previous_query = Some(body.clone());
                    rounds += 1;
                    self.exchange(
                        current,
                        SwitchCloudExchange::Receipts,
                        body,
                        move |host, admission, wire| {
                            host.complete_receipts(admission, &query, wire)
                        },
                    )
                    .await?;
                    admission = self.admit().await?;
                }
            }
        }
    }

    async fn resume_proof(
        &self,
        admission: H::Admission,
        id: String,
    ) -> Result<DeviceSwitchStep, DeviceSwitchError> {
        let status = self.status_before_submission(admission, &id, true).await?;
        if let Some(step) = status.stopped {
            return Ok(step);
        }
        let Some(body) = status.replay else {
            return Ok(DeviceSwitchStep::Blocked);
        };
        let admission = self.admit().await?;
        self.settle(
            admission,
            SwitchCloudExchange::Switch(DeviceSwitchExchange::Drain),
            body,
            id,
        )
        .await
    }

    async fn status_before_submission(
        &self,
        admission: H::Admission,
        id: &str,
        resume: bool,
    ) -> Result<SubmissionStatus, DeviceSwitchError> {
        // A restarted coordinator has no trusted target in memory. Only a strictly decoded,
        // authenticated status response may supply the target recorded beside this proof.
        let lookup_id = id.to_owned();
        let body = H::lookup(id).map_err(host_error)?;
        self.exchange(
            admission,
            SwitchCloudExchange::Switch(DeviceSwitchExchange::Status),
            body,
            move |host, admission, wire| {
                let outcome = host.complete_switch(admission, &lookup_id, wire)?;
                let target = host.response_target(admission, &lookup_id, wire)?;
                let succeeded = host.attempt_succeeded(admission, &lookup_id)?;
                let cleared = matches!(
                    outcome,
                    DesktopDeviceSwitchOutcome::Accepted(
                        DesktopDeviceSwitchStatus::Cancelled | DesktopDeviceSwitchStatus::Failed
                    )
                ) && H::is_active(admission)
                    && !succeeded;
                if cleared {
                    host.clear_barrier(admission, &lookup_id)?;
                }
                let stopped = match outcome {
                    DesktopDeviceSwitchOutcome::Rejected(code) => {
                        Some(DeviceSwitchStep::Rejected(code))
                    }
                    DesktopDeviceSwitchOutcome::Accepted(_) if cleared => {
                        Some(DeviceSwitchStep::WritesReopened)
                    }
                    DesktopDeviceSwitchOutcome::Accepted(
                        DesktopDeviceSwitchStatus::Requested | DesktopDeviceSwitchStatus::Draining,
                    ) if H::is_active(admission) && !succeeded => None,
                    DesktopDeviceSwitchOutcome::Accepted(status) => {
                        Some(DeviceSwitchStep::Switch(status))
                    }
                };
                let replay = if resume && stopped.is_none() {
                    host.pending_submission(admission, &lookup_id, wire)?
                } else {
                    None
                };
                Ok(SubmissionStatus {
                    stopped,
                    target,
                    replay,
                })
            },
        )
        .await
    }

    async fn submit_proof(
        &self,
        admission: H::Admission,
        id: String,
    ) -> Result<DeviceSwitchStep, DeviceSwitchError> {
        let signing_key_id = self
            .signer
            .signing_key_id()
            .ok_or(DeviceSwitchError::Blocked)?
            .to_owned();
        let status = self.status_before_submission(admission, &id, false).await?;
        if let Some(step) = status.stopped {
            return Ok(step);
        }
        let target = status.target.ok_or(DeviceSwitchError::Blocked)?;
        let admission = self.admit().await?;
        let proof_id = id.clone();
        let (admission, draft) = self
            .run(admission, move |host, admission| {
                host.prepare_proof(admission, &proof_id, &signing_key_id)
            })
            .await?;
        let signature = self
            .signer
            .sign_drain_proof(H::transcript(&draft))
            .ok_or(DeviceSwitchError::Blocked)?;
        let body = self
            .host
            .submission(&draft, &signature)
            .map_err(host_error)?;
        // Once this durable intent exists, any interruption is reconciled by status. A second
        // proof must never replace an attempt whose first submission may have reached Cloud.
        let (admission, ()) = self
            .run(admission, move |host, admission| {
                host.persist_attempt(admission, &draft, &signature, &target)
            })
            .await?;
        self.settle(
            admission,
            SwitchCloudExchange::Switch(DeviceSwitchExchange::Drain),
            body,
            id,
        )
        .await
    }

    /// Sends one exchange about switch `id` and commits Cloud's outcome. A failed target
    /// bootstrap cannot undo an already accepted source release.
    async fn settle(
        &self,
        admission: H::Admission,
        exchange: SwitchCloudExchange,
        body: Vec<u8>,
        id: String,
    ) -> Result<DeviceSwitchStep, DeviceSwitchError> {
        let step = self
            .exchange(admission, exchange, body, move |host, admission, wire| {
                Ok(match host.complete_switch(admission, &id, wire)? {
                    DesktopDeviceSwitchOutcome::Accepted(
                        DesktopDeviceSwitchStatus::Cancelled | DesktopDeviceSwitchStatus::Failed,
                    ) if H::is_active(admission) && !host.attempt_succeeded(admission, &id)? => {
                        host.clear_barrier(admission, &id)?;
                        DeviceSwitchStep::WritesReopened
                    }
                    DesktopDeviceSwitchOutcome::Accepted(status) => {
                        DeviceSwitchStep::Switch(status)
                    }
                    DesktopDeviceSwitchOutcome::Rejected(
                        DesktopDeviceSwitchRejection::DrainProofInvalid
                        | DesktopDeviceSwitchRejection::DrainProofExpired,
                    ) => DeviceSwitchStep::Blocked,
                    DesktopDeviceSwitchOutcome::Rejected(code) => DeviceSwitchStep::Rejected(code),
                })
            })
            .await?;
        (self.wake_sync)();
        Ok(step)
    }

    async fn admit(&self) -> Result<H::Admission, DeviceSwitchError> {
        if self.fence.is_cancelled() {
            return Err(DeviceSwitchError::Cancelled);
        }
        let host = Arc::clone(&self.host);
        tokio::task::spawn_blocking(move || host.admit())
            .await
            .map_err(|_| DeviceSwitchError::Retryable)?
            .map_err(host_error)
    }

    async fn admit_read(&self) -> Result<H::Admission, DeviceSwitchError> {
        if self.fence.is_cancelled() {
            return Err(DeviceSwitchError::Cancelled);
        }
        let host = Arc::clone(&self.host);
        tokio::task::spawn_blocking(move || host.admit_read())
            .await
            .map_err(|_| DeviceSwitchError::Retryable)?
            .map_err(host_error)
    }

    async fn run<T: Send + 'static>(
        &self,
        admission: H::Admission,
        work: impl FnOnce(&H, &H::Admission) -> Result<T, DesktopLocalHostError> + Send + 'static,
    ) -> Result<(H::Admission, T), DeviceSwitchError> {
        let host = Arc::clone(&self.host);
        let (admission, result) = tokio::task::spawn_blocking(move || {
            let result = work(&host, &admission);
            (admission, result)
        })
        .await
        .map_err(|_| DeviceSwitchError::Retryable)?;
        Ok((admission, result.map_err(host_error)?))
    }

    async fn exchange<T: Send + 'static>(
        &self,
        admission: H::Admission,
        exchange: SwitchCloudExchange,
        body: Vec<u8>,
        complete: impl FnOnce(&H, &H::Admission, &[u8]) -> Result<T, DesktopLocalHostError>
        + Send
        + 'static,
    ) -> Result<T, DeviceSwitchError> {
        let (admission, wire, credential_instance) = self
            .cloud
            .send(admission, exchange, body)
            .await
            .map_err(request_error)?;
        let host = Arc::clone(&self.host);
        let cloud = Arc::clone(&self.cloud);
        let fence = Arc::clone(&self.fence);
        match tokio::task::spawn_blocking(move || {
            fence
                .commit(|| cloud.commit(credential_instance, || complete(&host, &admission, &wire)))
        })
        .await
        {
            Ok(Some(Ok(value))) => Ok(value),
            Ok(Some(Err(error))) => Err(request_error(error)),
            Ok(None) => Err(DeviceSwitchError::Cancelled),
            Err(_) => Err(DeviceSwitchError::Retryable),
        }
    }
}

const fn host_error(error: DesktopLocalHostError) -> DeviceSwitchError {
    match error {
        DesktopLocalHostError::AuthorityRejected => DeviceSwitchError::AuthorizationRequired,
        DesktopLocalHostError::StorageRejected | DesktopLocalHostError::Unavailable => {
            DeviceSwitchError::Retryable
        }
        _ => DeviceSwitchError::Blocked,
    }
}

const fn request_error(error: NativeCloudRequestError) -> DeviceSwitchError {
    match error {
        NativeCloudRequestError::Retryable
        | NativeCloudRequestError::Unavailable
        | NativeCloudRequestError::OutcomeUnknown => DeviceSwitchError::Retryable,
        NativeCloudRequestError::AuthorizationRequired
        | NativeCloudRequestError::AuthorizationDenied
        | NativeCloudRequestError::AuthorityStale => DeviceSwitchError::AuthorizationRequired,
        NativeCloudRequestError::ProtocolBlocked
        | NativeCloudRequestError::ConfigurationBlocked => DeviceSwitchError::Blocked,
    }
}

impl SwitchHost for DesktopLocalHost {
    type Admission = DesktopNativeCloudAdmission;
    type Exchange = DesktopDeviceSwitchRequestExchange;
    type Resolution = DesktopDeviceSwitchRequestResolution;
    type ReceiptQuery = DesktopDrainReceiptQuery;
    type Draft = DesktopDrainProofDraft;

    fn admit(&self) -> Result<Self::Admission, DesktopLocalHostError> {
        self.begin_native_cloud_run()
    }

    fn admit_read(&self) -> Result<Self::Admission, DesktopLocalHostError> {
        self.begin_native_cloud_read_run()
    }

    fn is_active(admission: &Self::Admission) -> bool {
        admission.is_active()
    }

    fn prepare_request(
        &self,
        admission: &Self::Admission,
        target_device_id: &str,
    ) -> Result<Self::Exchange, DesktopLocalHostError> {
        self.prepare_native_device_switch_request(admission, target_device_id)
    }
    fn pending_request(
        &self,
        admission: &Self::Admission,
    ) -> Result<Option<Self::Exchange>, DesktopLocalHostError> {
        self.pending_native_device_switch_request(admission)
    }

    fn prepare_resolution(
        &self,
        admission: &Self::Admission,
    ) -> Result<Option<Self::Resolution>, DesktopLocalHostError> {
        self.prepare_native_device_switch_request_resolution(admission)
    }
    fn resolution_body(resolution: &Self::Resolution) -> Vec<u8> {
        resolution.request_body().to_vec()
    }
    fn complete_resolution(
        &self,
        admission: &Self::Admission,
        resolution: &Self::Resolution,
        wire: &[u8],
    ) -> Result<DesktopDeviceSwitchRequestResolutionOutcome, DesktopLocalHostError> {
        self.complete_native_device_switch_request_resolution(admission, resolution, wire)
    }

    fn exchange_body(exchange: &Self::Exchange) -> Vec<u8> {
        exchange.request_body().to_vec()
    }

    fn complete_request(
        &self,
        admission: &Self::Admission,
        exchange: &Self::Exchange,
        wire: &[u8],
    ) -> Result<DesktopDeviceSwitchStart, DesktopLocalHostError> {
        self.complete_native_device_switch_request(admission, exchange, wire)
    }

    fn clear_left_over(&self, admission: &Self::Admission) -> Result<bool, DesktopLocalHostError> {
        self.clear_left_over_device_switch_barrier(admission)
    }

    fn in_progress(
        &self,
        admission: &Self::Admission,
    ) -> Result<Option<String>, DesktopLocalHostError> {
        self.native_device_switch_in_progress(admission)
    }

    fn progress(
        &self,
        admission: &Self::Admission,
    ) -> Result<DesktopDrainProgress, DesktopLocalHostError> {
        self.native_device_switch_drain_progress(admission)
    }

    fn receipt_query(
        &self,
        admission: &Self::Admission,
    ) -> Result<Option<Self::ReceiptQuery>, DesktopLocalHostError> {
        self.native_drain_receipt_query(admission)
    }

    fn receipt_body(query: &Self::ReceiptQuery) -> Vec<u8> {
        query.request_body().to_vec()
    }

    fn complete_receipts(
        &self,
        admission: &Self::Admission,
        query: &Self::ReceiptQuery,
        wire: &[u8],
    ) -> Result<(), DesktopLocalHostError> {
        self.complete_native_drain_receipts(admission, query, wire)
    }

    fn prepare_proof(
        &self,
        admission: &Self::Admission,
        id: &str,
        signing_key_id: &str,
    ) -> Result<Self::Draft, DesktopLocalHostError> {
        self.prepare_native_drain_proof(admission, id, signing_key_id)
    }

    fn transcript(draft: &Self::Draft) -> &[u8] {
        draft.signature_transcript()
    }

    fn persist_attempt(
        &self,
        admission: &Self::Admission,
        draft: &Self::Draft,
        device_signature: &str,
        target_device_id: &str,
    ) -> Result<(), DesktopLocalHostError> {
        self.persist_native_drain_attempt(admission, draft, device_signature, target_device_id)
    }

    fn attempt_pending(
        &self,
        admission: &Self::Admission,
        id: &str,
    ) -> Result<bool, DesktopLocalHostError> {
        self.native_drain_attempt_pending(admission, id)
    }

    fn attempt_succeeded(
        &self,
        admission: &Self::Admission,
        id: &str,
    ) -> Result<bool, DesktopLocalHostError> {
        self.native_drain_attempt_succeeded(admission, id)
    }

    fn response_target(
        &self,
        admission: &Self::Admission,
        id: &str,
        wire: &[u8],
    ) -> Result<Option<String>, DesktopLocalHostError> {
        self.native_device_switch_response_target(admission, id, wire)
    }

    fn pending_submission(
        &self,
        admission: &Self::Admission,
        id: &str,
        status_wire: &[u8],
    ) -> Result<Option<Vec<u8>>, DesktopLocalHostError> {
        self.native_pending_drain_submission(admission, id, status_wire)
    }

    fn submission(
        &self,
        draft: &Self::Draft,
        signature: &str,
    ) -> Result<Vec<u8>, DesktopLocalHostError> {
        self.native_drain_submission(draft, signature)
    }

    fn lookup(id: &str) -> Result<Vec<u8>, DesktopLocalHostError> {
        Self::native_device_switch_lookup(id)
    }

    fn complete_switch(
        &self,
        admission: &Self::Admission,
        id: &str,
        wire: &[u8],
    ) -> Result<DesktopDeviceSwitchOutcome, DesktopLocalHostError> {
        self.complete_native_device_switch_response(admission, id, wire)
    }

    fn clear_barrier(
        &self,
        admission: &Self::Admission,
        id: &str,
    ) -> Result<(), DesktopLocalHostError> {
        self.clear_native_device_switch_barrier(admission, id)
    }
}

impl SwitchCloud<DesktopNativeCloudAdmission> for NativeCloudSession {
    async fn send(
        self: &Arc<Self>,
        admission: DesktopNativeCloudAdmission,
        exchange: SwitchCloudExchange,
        body: Vec<u8>,
    ) -> Result<(DesktopNativeCloudAdmission, Vec<u8>, u64), NativeCloudRequestError> {
        let response = match exchange {
            SwitchCloudExchange::Receipts => self.send_sync_receipts(admission, body).await?,
            SwitchCloudExchange::Switch(exchange) => {
                self.send_device_switch(admission, exchange, body).await?
            }
        };
        Ok(response.into_parts())
    }

    fn commit<T>(
        &self,
        credential_instance: u64,
        commit: impl FnOnce() -> Result<T, DesktopLocalHostError>,
    ) -> Result<T, NativeCloudRequestError> {
        self.commit_response(credential_instance, commit)
    }
}

#[cfg(test)]
mod tests {
    use std::collections::VecDeque;
    use std::sync::Mutex as StdMutex;
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::*;

    struct FakeAdmission {
        active: bool,
    }

    #[derive(Default)]
    struct HostState {
        standby: bool,
        request_pending: Option<(String, Vec<u8>)>,
        barrier: Option<String>,
        /// A barrier from an earlier Lease epoch: invisible to `in_progress`, but it refuses a new one.
        left_over: Option<String>,
        progress: VecDeque<DesktopDrainProgress>,
        receipt_queries: VecDeque<Vec<u8>>,
        recorded_receipts: Vec<Vec<u8>>,
        prepared_proofs: Vec<(String, String)>,
        submissions: Vec<String>,
        attempts: Vec<(String, String)>,
        pending_body: Option<Vec<u8>>,
        succeeded: bool,
        reject_persistence: bool,
        cleared: Vec<String>,
    }

    #[derive(Default)]
    struct FakeHost {
        state: StdMutex<HostState>,
    }

    type Decoded = (
        Option<(DesktopDeviceSwitchStatus, String)>,
        Option<DesktopDeviceSwitchRejection>,
    );

    static NEXT_KEY: AtomicUsize = AtomicUsize::new(0);

    /// Cloud's answers are `accepted:<status>:<id>`, `rejected:<code>` or `receipts`; the real
    /// decoders and their refusals are tested in `gooddealer-local-storage`.
    fn decode(wire: &[u8]) -> Result<Decoded, DesktopLocalHostError> {
        let text =
            std::str::from_utf8(wire).map_err(|_| DesktopLocalHostError::CloudProtocolRejected)?;
        let parts: Vec<&str> = text.split(':').collect();
        match parts.as_slice() {
            ["accepted" | "receipt", status, id] => {
                let status = match *status {
                    "draining" => DesktopDeviceSwitchStatus::Draining,
                    "bootstrapping" => DesktopDeviceSwitchStatus::Bootstrapping,
                    "cancelled" => DesktopDeviceSwitchStatus::Cancelled,
                    "failed" => DesktopDeviceSwitchStatus::Failed,
                    "completed" => DesktopDeviceSwitchStatus::Completed,
                    _ => return Err(DesktopLocalHostError::CloudProtocolRejected),
                };
                Ok((Some((status, (*id).to_owned())), None))
            }
            ["rejected", "TARGET_REMOVED"] => {
                Ok((None, Some(DesktopDeviceSwitchRejection::TargetRemoved)))
            }
            ["rejected", "DRAIN_PROOF_EXPIRED"] => {
                Ok((None, Some(DesktopDeviceSwitchRejection::DrainProofExpired)))
            }
            ["rejected", "DRAIN_PROOF_INVALID"] => {
                Ok((None, Some(DesktopDeviceSwitchRejection::DrainProofInvalid)))
            }
            ["rejected", "SWITCH_NOT_CANCELLABLE"] => Ok((
                None,
                Some(DesktopDeviceSwitchRejection::SwitchNotCancellable),
            )),
            _ => Err(DesktopLocalHostError::CloudProtocolRejected),
        }
    }

    impl SwitchHost for FakeHost {
        type Admission = FakeAdmission;
        type Exchange = (String, Vec<u8>);
        type Resolution = (String, Vec<u8>);
        type ReceiptQuery = Vec<u8>;
        type Draft = Vec<u8>;

        fn admit(&self) -> Result<FakeAdmission, DesktopLocalHostError> {
            if self.state.lock().unwrap().standby {
                return Err(DesktopLocalHostError::AuthorityRejected);
            }
            Ok(FakeAdmission { active: true })
        }

        fn admit_read(&self) -> Result<FakeAdmission, DesktopLocalHostError> {
            Ok(FakeAdmission {
                active: !self.state.lock().unwrap().standby,
            })
        }

        fn is_active(admission: &FakeAdmission) -> bool {
            admission.active
        }

        fn prepare_request(
            &self,
            _: &FakeAdmission,
            target: &str,
        ) -> Result<Self::Exchange, DesktopLocalHostError> {
            let mut state = self.state.lock().unwrap();
            if let Some(pending) = &state.request_pending {
                return Ok(pending.clone());
            }
            let key = NEXT_KEY.fetch_add(1, Ordering::Relaxed);
            let pending = (
                target.to_owned(),
                format!("request:{target}:key-{key}").into_bytes(),
            );
            state.request_pending = Some(pending.clone());
            Ok(pending)
        }
        fn pending_request(
            &self,
            _: &FakeAdmission,
        ) -> Result<Option<Self::Exchange>, DesktopLocalHostError> {
            Ok(self.state.lock().unwrap().request_pending.clone())
        }

        fn prepare_resolution(
            &self,
            _: &FakeAdmission,
        ) -> Result<Option<Self::Resolution>, DesktopLocalHostError> {
            Ok(self.state.lock().unwrap().request_pending.clone())
        }
        fn resolution_body(resolution: &Self::Resolution) -> Vec<u8> {
            [b"resolve:".as_slice(), resolution.1.as_slice()].concat()
        }
        fn complete_resolution(
            &self,
            admission: &FakeAdmission,
            resolution: &Self::Resolution,
            wire: &[u8],
        ) -> Result<DesktopDeviceSwitchRequestResolutionOutcome, DesktopLocalHostError> {
            match wire {
                b"not_found" => {
                    Ok(DesktopDeviceSwitchRequestResolutionOutcome::RetryCurrentRequest)
                }
                b"superseded" => {
                    self.state.lock().unwrap().request_pending = None;
                    Ok(DesktopDeviceSwitchRequestResolutionOutcome::Superseded)
                }
                _ => self
                    .complete_request(admission, resolution, wire)
                    .map(DesktopDeviceSwitchRequestResolutionOutcome::Resolved),
            }
        }

        fn exchange_body(exchange: &Self::Exchange) -> Vec<u8> {
            exchange.1.clone()
        }

        fn complete_request(
            &self,
            _: &FakeAdmission,
            _: &Self::Exchange,
            wire: &[u8],
        ) -> Result<DesktopDeviceSwitchStart, DesktopLocalHostError> {
            let decoded = decode(wire)?;
            let mut state = self.state.lock().unwrap();
            let start = match decoded {
                (Some((status, id)), None) => {
                    if status == DesktopDeviceSwitchStatus::Draining {
                        if state.left_over.is_some()
                            || state.barrier.as_deref().is_some_and(|open| open != id)
                        {
                            return Err(DesktopLocalHostError::StorageRejected);
                        }
                        state.barrier = Some(id.clone());
                    }
                    DesktopDeviceSwitchStart::Accepted {
                        device_switch_request_id: id,
                        status,
                    }
                }
                (None, Some(code)) => DesktopDeviceSwitchStart::Rejected(code),
                _ => return Err(DesktopLocalHostError::CloudProtocolRejected),
            };
            state.request_pending = None;
            Ok(start)
        }

        fn clear_left_over(&self, _: &FakeAdmission) -> Result<bool, DesktopLocalHostError> {
            Ok(self.state.lock().unwrap().left_over.take().is_some())
        }

        fn in_progress(&self, _: &FakeAdmission) -> Result<Option<String>, DesktopLocalHostError> {
            Ok(self.state.lock().unwrap().barrier.clone())
        }

        fn progress(
            &self,
            _: &FakeAdmission,
        ) -> Result<DesktopDrainProgress, DesktopLocalHostError> {
            let mut state = self.state.lock().unwrap();
            assert!(
                state.barrier.is_some(),
                "progress is read only behind a barrier"
            );
            Ok(state.progress.pop_front().expect("scripted progress"))
        }

        fn receipt_query(
            &self,
            _: &FakeAdmission,
        ) -> Result<Option<Vec<u8>>, DesktopLocalHostError> {
            Ok(self.state.lock().unwrap().receipt_queries.pop_front())
        }

        fn receipt_body(query: &Vec<u8>) -> Vec<u8> {
            query.clone()
        }

        fn complete_receipts(
            &self,
            _: &FakeAdmission,
            query: &Vec<u8>,
            wire: &[u8],
        ) -> Result<(), DesktopLocalHostError> {
            if wire != b"receipts" {
                return Err(DesktopLocalHostError::CloudProtocolRejected);
            }
            self.state
                .lock()
                .unwrap()
                .recorded_receipts
                .push(query.clone());
            Ok(())
        }

        fn prepare_proof(
            &self,
            _: &FakeAdmission,
            id: &str,
            signing_key_id: &str,
        ) -> Result<Vec<u8>, DesktopLocalHostError> {
            let mut state = self.state.lock().unwrap();
            if state.barrier.as_deref() != Some(id) {
                return Err(DesktopLocalHostError::StorageRejected);
            }
            state
                .prepared_proofs
                .push((id.to_owned(), signing_key_id.to_owned()));
            Ok(format!("transcript:{id}").into_bytes())
        }

        fn transcript(draft: &Vec<u8>) -> &[u8] {
            draft
        }

        fn persist_attempt(
            &self,
            _: &FakeAdmission,
            draft: &Vec<u8>,
            signature: &str,
            target: &str,
        ) -> Result<(), DesktopLocalHostError> {
            let mut state = self.state.lock().unwrap();
            if state.reject_persistence || !state.attempts.is_empty() {
                return Err(DesktopLocalHostError::StorageRejected);
            }
            state
                .attempts
                .push((String::from_utf8(draft.clone()).unwrap(), target.to_owned()));
            state.pending_body = Some([draft.as_slice(), b"|", signature.as_bytes()].concat());
            Ok(())
        }

        fn pending_submission(
            &self,
            _: &FakeAdmission,
            _: &str,
            _: &[u8],
        ) -> Result<Option<Vec<u8>>, DesktopLocalHostError> {
            Ok(self.state.lock().unwrap().pending_body.clone())
        }

        fn attempt_pending(
            &self,
            _: &FakeAdmission,
            _: &str,
        ) -> Result<bool, DesktopLocalHostError> {
            Ok(!self.state.lock().unwrap().attempts.is_empty())
        }

        fn attempt_succeeded(
            &self,
            _: &FakeAdmission,
            _: &str,
        ) -> Result<bool, DesktopLocalHostError> {
            Ok(self.state.lock().unwrap().succeeded)
        }

        fn response_target(
            &self,
            _: &FakeAdmission,
            id: &str,
            wire: &[u8],
        ) -> Result<Option<String>, DesktopLocalHostError> {
            match decode(wire)? {
                (Some((_, answered)), None) if answered == id => {
                    Ok(Some("device-target".to_owned()))
                }
                (None, Some(_)) => Ok(None),
                _ => Err(DesktopLocalHostError::CloudProtocolRejected),
            }
        }

        fn submission(
            &self,
            draft: &Vec<u8>,
            signature: &str,
        ) -> Result<Vec<u8>, DesktopLocalHostError> {
            self.state
                .lock()
                .unwrap()
                .submissions
                .push(signature.to_owned());
            Ok([draft.as_slice(), b"|", signature.as_bytes()].concat())
        }

        fn lookup(id: &str) -> Result<Vec<u8>, DesktopLocalHostError> {
            Ok(format!("lookup:{id}").into_bytes())
        }

        fn complete_switch(
            &self,
            _: &FakeAdmission,
            id: &str,
            wire: &[u8],
        ) -> Result<DesktopDeviceSwitchOutcome, DesktopLocalHostError> {
            Ok(match decode(wire)? {
                (Some((status, answered)), None) if answered == id => {
                    if wire.starts_with(b"receipt:") {
                        self.state.lock().unwrap().succeeded = true;
                    }
                    DesktopDeviceSwitchOutcome::Accepted(status)
                }
                (None, Some(code)) => {
                    if matches!(
                        code,
                        DesktopDeviceSwitchRejection::DrainProofInvalid
                            | DesktopDeviceSwitchRejection::DrainProofExpired
                    ) {
                        self.state.lock().unwrap().pending_body = None;
                    }
                    DesktopDeviceSwitchOutcome::Rejected(code)
                }
                _ => return Err(DesktopLocalHostError::CloudProtocolRejected),
            })
        }

        fn clear_barrier(&self, _: &FakeAdmission, id: &str) -> Result<(), DesktopLocalHostError> {
            let mut state = self.state.lock().unwrap();
            assert_eq!(state.barrier.as_deref(), Some(id));
            state.barrier = None;
            state.cleared.push(id.to_owned());
            Ok(())
        }
    }

    #[derive(Default)]
    struct FakeCloud {
        answers: StdMutex<VecDeque<Result<Vec<u8>, NativeCloudRequestError>>>,
        sent: StdMutex<Vec<(SwitchCloudExchange, Vec<u8>)>>,
        cancel_on_send: StdMutex<Option<Arc<NativeCloudCancelFence>>>,
        downgrade_on_status: StdMutex<bool>,
    }

    impl FakeCloud {
        fn answer(&self, answer: Result<&[u8], NativeCloudRequestError>) {
            self.answers
                .lock()
                .unwrap()
                .push_back(answer.map(<[u8]>::to_vec));
        }

        fn sent(&self) -> Vec<(SwitchCloudExchange, String)> {
            self.sent
                .lock()
                .unwrap()
                .iter()
                .map(|(exchange, body)| (*exchange, String::from_utf8(body.clone()).unwrap()))
                .collect()
        }
    }

    impl SwitchCloud<FakeAdmission> for FakeCloud {
        fn send(
            self: &Arc<Self>,
            mut admission: FakeAdmission,
            exchange: SwitchCloudExchange,
            body: Vec<u8>,
        ) -> impl Future<Output = Result<(FakeAdmission, Vec<u8>, u64), NativeCloudRequestError>> + Send
        {
            self.sent.lock().unwrap().push((exchange, body));
            if exchange == STATUS && *self.downgrade_on_status.lock().unwrap() {
                admission.active = false;
            }
            if let Some(fence) = self.cancel_on_send.lock().unwrap().as_ref() {
                fence.cancel();
            }
            let answer = self
                .answers
                .lock()
                .unwrap()
                .pop_front()
                .expect("scripted answer")
                .map(|answer| (admission, answer, 1));
            std::future::ready(answer)
        }

        fn commit<T>(
            &self,
            _: u64,
            commit: impl FnOnce() -> Result<T, DesktopLocalHostError>,
        ) -> Result<T, NativeCloudRequestError> {
            commit().map_err(|error| match error {
                DesktopLocalHostError::CloudProtocolRejected => {
                    NativeCloudRequestError::ProtocolBlocked
                }
                _ => NativeCloudRequestError::Unavailable,
            })
        }
    }

    #[derive(Default)]
    struct FakeSigner {
        unavailable: bool,
        signed: StdMutex<Vec<Vec<u8>>>,
    }

    impl DrainProofSigner for FakeSigner {
        fn signing_key_id(&self) -> Option<&str> {
            (!self.unavailable).then_some("device-key-1")
        }

        fn sign_drain_proof(&self, transcript: &[u8]) -> Option<String> {
            self.signed.lock().unwrap().push(transcript.to_vec());
            Some("signature".to_owned())
        }
    }

    struct Harness {
        host: Arc<FakeHost>,
        cloud: Arc<FakeCloud>,
        signer: Arc<FakeSigner>,
        fence: Arc<NativeCloudCancelFence>,
        wakes: Arc<AtomicUsize>,
        coordinator: DeviceSwitchCoordinator<FakeHost, FakeCloud, FakeSigner>,
    }

    fn harness(signer: FakeSigner) -> Harness {
        let host = Arc::new(FakeHost::default());
        let cloud = Arc::new(FakeCloud::default());
        let signer = Arc::new(signer);
        let fence = Arc::new(NativeCloudCancelFence::default());
        let wakes = Arc::new(AtomicUsize::new(0));
        let counter = Arc::clone(&wakes);
        let coordinator = DeviceSwitchCoordinator::new(
            Arc::clone(&host),
            Arc::clone(&cloud),
            Arc::clone(&signer),
            Arc::clone(&fence),
            Arc::new(move || {
                counter.fetch_add(1, Ordering::Relaxed);
            }),
        );
        Harness {
            host,
            cloud,
            signer,
            fence,
            wakes,
            coordinator,
        }
    }

    fn script(harness: &Harness, progress: &[DesktopDrainProgress], queries: &[&[u8]]) {
        let mut state = harness.host.state.lock().unwrap();
        state.progress.extend(progress.iter().copied());
        state
            .receipt_queries
            .extend(queries.iter().map(|query| query.to_vec()));
    }

    const REQUEST: SwitchCloudExchange = SwitchCloudExchange::Switch(DeviceSwitchExchange::Request);
    const RESOLVE: SwitchCloudExchange = SwitchCloudExchange::Switch(DeviceSwitchExchange::Resolve);
    const DRAIN: SwitchCloudExchange = SwitchCloudExchange::Switch(DeviceSwitchExchange::Drain);
    const CANCEL: SwitchCloudExchange = SwitchCloudExchange::Switch(DeviceSwitchExchange::Cancel);
    const STATUS: SwitchCloudExchange = SwitchCloudExchange::Switch(DeviceSwitchExchange::Status);

    #[tokio::test]
    async fn standby_reads_handoff_status_without_reopening_writes_or_mutating_cloud() {
        for (wire, status) in [
            (
                "accepted:bootstrapping:switch-1",
                DesktopDeviceSwitchStatus::Bootstrapping,
            ),
            (
                "accepted:completed:switch-1",
                DesktopDeviceSwitchStatus::Completed,
            ),
            (
                "accepted:failed:switch-1",
                DesktopDeviceSwitchStatus::Failed,
            ),
            (
                "accepted:cancelled:switch-1",
                DesktopDeviceSwitchStatus::Cancelled,
            ),
        ] {
            let harness = harness(FakeSigner::default());
            {
                let mut state = harness.host.state.lock().unwrap();
                state.standby = true;
                state.barrier = Some("switch-1".to_owned());
            }
            harness.cloud.answer(Ok(wire.as_bytes()));
            assert_eq!(
                harness.coordinator.status().await,
                Ok(DeviceSwitchStep::Switch(status))
            );
            assert_eq!(
                harness.coordinator.cancel().await,
                Err(DeviceSwitchError::AuthorizationRequired)
            );
            assert_eq!(
                harness.coordinator.advance().await,
                Err(DeviceSwitchError::AuthorizationRequired)
            );
            assert_eq!(
                harness.coordinator.request("device-target").await,
                Err(DeviceSwitchError::AuthorizationRequired)
            );
            let state = harness.host.state.lock().unwrap();
            assert_eq!(state.barrier.as_deref(), Some("switch-1"));
            assert!(state.cleared.is_empty());
            assert!(state.prepared_proofs.is_empty());
            assert!(harness.signer.signed.lock().unwrap().is_empty());
            assert_eq!(
                harness.cloud.sent(),
                vec![(STATUS, "lookup:switch-1".to_owned())]
            );
        }
    }

    #[tokio::test]
    async fn a_switch_closes_writes_behind_cloud_s_id_and_signs_only_once_confirmed() {
        let harness = harness(FakeSigner::default());
        harness.cloud.answer(Ok(b"accepted:draining:switch-cloud"));
        script(
            &harness,
            &[DesktopDrainProgress::Waiting { unconfirmed: 3 }],
            &[],
        );
        assert_eq!(
            harness.coordinator.request("device-target").await,
            Ok(DeviceSwitchStep::WaitingForSync { unconfirmed: 3 })
        );
        assert_eq!(
            harness.host.state.lock().unwrap().barrier.as_deref(),
            Some("switch-cloud")
        );
        assert_eq!(harness.wakes.load(Ordering::Relaxed), 1);
        assert!(harness.signer.signed.lock().unwrap().is_empty());

        // Legacy rows need Cloud's receipts before the fold; then the proof is signed and sent.
        harness.cloud.answer(Ok(b"receipts"));
        harness.cloud.answer(Ok(b"accepted:draining:switch-cloud"));
        harness
            .cloud
            .answer(Ok(b"accepted:bootstrapping:switch-cloud"));
        script(
            &harness,
            &[
                DesktopDrainProgress::ReceiptsRequired,
                DesktopDrainProgress::Ready,
            ],
            &[b"receipts-for-a-b"],
        );
        assert_eq!(
            harness.coordinator.advance().await,
            Ok(DeviceSwitchStep::Switch(
                DesktopDeviceSwitchStatus::Bootstrapping
            ))
        );
        let state = harness.host.state.lock().unwrap();
        assert_eq!(state.recorded_receipts, vec![b"receipts-for-a-b".to_vec()]);
        assert_eq!(
            state.prepared_proofs,
            vec![("switch-cloud".to_owned(), "device-key-1".to_owned())]
        );
        assert_eq!(
            *harness.signer.signed.lock().unwrap(),
            vec![b"transcript:switch-cloud".to_vec()]
        );
        // A handed-off switch keeps writes closed: this device is no longer Active.
        assert_eq!(state.barrier.as_deref(), Some("switch-cloud"));
        let sent = harness.cloud.sent();
        assert_eq!(sent.len(), 4);
        assert_eq!(sent[0].0, REQUEST);
        assert!(sent[0].1.starts_with("request:device-target:"));
        assert_eq!(
            sent[1],
            (SwitchCloudExchange::Receipts, "receipts-for-a-b".to_owned())
        );
        assert_eq!(
            sent[3],
            (DRAIN, "transcript:switch-cloud|signature".to_owned())
        );
        assert_eq!(sent[2], (STATUS, "lookup:switch-cloud".to_owned()));
        assert_eq!(
            state.attempts,
            vec![(
                "transcript:switch-cloud".to_owned(),
                "device-target".to_owned()
            )]
        );
    }

    #[tokio::test]
    async fn unknown_drain_reconciles_before_replaying_exact_bytes_without_resigning() {
        let harness = harness(FakeSigner::default());
        harness.host.state.lock().unwrap().barrier = Some("switch-1".to_owned());
        harness.cloud.answer(Ok(b"accepted:draining:switch-1"));
        harness
            .cloud
            .answer(Err(NativeCloudRequestError::OutcomeUnknown));
        script(&harness, &[DesktopDrainProgress::Ready], &[]);
        assert_eq!(
            harness.coordinator.advance().await,
            Err(DeviceSwitchError::Retryable)
        );
        assert_eq!(harness.host.state.lock().unwrap().attempts.len(), 1);

        let restarted = DeviceSwitchCoordinator::new(
            Arc::clone(&harness.host),
            Arc::clone(&harness.cloud),
            Arc::clone(&harness.signer),
            Arc::clone(&harness.fence),
            Arc::new(|| {}),
        );
        harness.cloud.answer(Ok(b"accepted:draining:switch-1"));
        harness.cloud.answer(Ok(b"receipt:bootstrapping:switch-1"));
        assert_eq!(
            restarted.advance().await,
            Ok(DeviceSwitchStep::Switch(
                DesktopDeviceSwitchStatus::Bootstrapping
            ))
        );
        assert_eq!(
            harness
                .cloud
                .sent()
                .iter()
                .filter(|(kind, _)| *kind == DRAIN)
                .count(),
            2
        );
        assert_eq!(harness.signer.signed.lock().unwrap().len(), 1);
        let sent = harness.cloud.sent();
        assert_eq!(sent[1], sent[3]);
        assert_eq!(sent[2].0, STATUS);
        harness.cloud.answer(Ok(b"receipt:completed:switch-1"));
        assert_eq!(
            restarted.advance().await,
            Ok(DeviceSwitchStep::Switch(
                DesktopDeviceSwitchStatus::Completed
            ))
        );
        assert_eq!(harness.cloud.sent().last().unwrap().0, STATUS);
    }

    #[tokio::test]
    async fn persistence_failure_prevents_drain_submission() {
        let harness = harness(FakeSigner::default());
        {
            let mut state = harness.host.state.lock().unwrap();
            state.barrier = Some("switch-1".to_owned());
            state.reject_persistence = true;
        }
        harness.cloud.answer(Ok(b"accepted:draining:switch-1"));
        script(&harness, &[DesktopDrainProgress::Ready], &[]);
        assert_eq!(
            harness.coordinator.advance().await,
            Err(DeviceSwitchError::Retryable)
        );
        assert_eq!(
            harness.cloud.sent(),
            vec![(STATUS, "lookup:switch-1".to_owned())]
        );
    }

    #[tokio::test]
    async fn concurrent_advances_cannot_create_a_second_drain_attempt() {
        let harness = harness(FakeSigner::default());
        harness.host.state.lock().unwrap().barrier = Some("switch-1".to_owned());
        harness.cloud.answer(Ok(b"accepted:draining:switch-1"));
        harness
            .cloud
            .answer(Err(NativeCloudRequestError::OutcomeUnknown));
        harness.cloud.answer(Ok(b"receipt:bootstrapping:switch-1"));
        script(&harness, &[DesktopDrainProgress::Ready], &[]);
        let (first, second) =
            tokio::join!(harness.coordinator.advance(), harness.coordinator.advance());
        let outcomes = [first, second];
        assert!(outcomes.contains(&Err(DeviceSwitchError::Retryable)));
        assert!(outcomes.contains(&Ok(DeviceSwitchStep::Switch(
            DesktopDeviceSwitchStatus::Bootstrapping
        ))));
        assert_eq!(harness.host.state.lock().unwrap().attempts.len(), 1);
        assert_eq!(
            harness
                .cloud
                .sent()
                .iter()
                .filter(|(kind, _)| *kind == DRAIN)
                .count(),
            1
        );
    }

    #[tokio::test]
    async fn failed_target_bootstrap_never_reopens_a_successfully_released_source() {
        let harness = harness(FakeSigner::default());
        {
            let mut state = harness.host.state.lock().unwrap();
            state.barrier = Some("switch-1".to_owned());
        }
        harness.cloud.answer(Ok(b"receipt:failed:switch-1"));
        assert_eq!(
            harness.coordinator.status().await,
            Ok(DeviceSwitchStep::Switch(DesktopDeviceSwitchStatus::Failed))
        );
        assert!(harness.host.state.lock().unwrap().cleared.is_empty());
        assert_eq!(
            harness.host.state.lock().unwrap().barrier.as_deref(),
            Some("switch-1")
        );
    }

    #[tokio::test]
    async fn status_refresh_to_standby_never_reports_reopened_writes() {
        for status in ["cancelled", "failed", "draining"] {
            let harness = harness(FakeSigner::default());
            harness.host.state.lock().unwrap().barrier = Some("switch-1".to_owned());
            *harness.cloud.downgrade_on_status.lock().unwrap() = true;
            harness
                .cloud
                .answer(Ok(format!("accepted:{status}:switch-1").as_bytes()));
            script(&harness, &[DesktopDrainProgress::Ready], &[]);
            assert!(matches!(
                harness.coordinator.advance().await,
                Ok(DeviceSwitchStep::Switch(_))
            ));
            assert!(harness.host.state.lock().unwrap().cleared.is_empty());
            assert!(harness.signer.signed.lock().unwrap().is_empty());
            assert_eq!(harness.cloud.sent().len(), 1);
        }
    }

    #[tokio::test]
    async fn definitive_proof_rejection_blocks_until_cancelled_and_never_replays() {
        for rejection in ["DRAIN_PROOF_INVALID", "DRAIN_PROOF_EXPIRED"] {
            let harness = harness(FakeSigner::default());
            harness.host.state.lock().unwrap().barrier = Some("switch-1".to_owned());
            harness.cloud.answer(Ok(b"accepted:draining:switch-1"));
            harness
                .cloud
                .answer(Ok(format!("rejected:{rejection}").as_bytes()));
            script(&harness, &[DesktopDrainProgress::Ready], &[]);
            assert_eq!(
                harness.coordinator.advance().await,
                Ok(DeviceSwitchStep::Blocked)
            );
            harness.cloud.answer(Ok(b"accepted:draining:switch-1"));
            assert_eq!(
                harness.coordinator.advance().await,
                Ok(DeviceSwitchStep::Blocked)
            );
            assert_eq!(harness.signer.signed.lock().unwrap().len(), 1);
            assert_eq!(harness.cloud.sent().len(), 3);
            assert_eq!(harness.cloud.sent().last().unwrap().0, STATUS);
            harness.cloud.answer(Ok(b"accepted:cancelled:switch-1"));
            assert_eq!(
                harness.coordinator.cancel().await,
                Ok(DeviceSwitchStep::WritesReopened)
            );
        }
    }

    #[tokio::test]
    async fn restart_after_durable_intent_before_send_resumes_only_after_status() {
        let harness = harness(FakeSigner::default());
        {
            let mut state = harness.host.state.lock().unwrap();
            state.barrier = Some("switch-1".to_owned());
            state
                .attempts
                .push(("transcript:switch-1".to_owned(), "device-target".to_owned()));
            state.pending_body = Some(b"transcript:switch-1|signature".to_vec());
        }
        harness.cloud.answer(Ok(b"accepted:draining:switch-1"));
        harness.cloud.answer(Ok(b"receipt:bootstrapping:switch-1"));
        assert_eq!(
            harness.coordinator.advance().await,
            Ok(DeviceSwitchStep::Switch(
                DesktopDeviceSwitchStatus::Bootstrapping
            ))
        );
        assert!(harness.signer.signed.lock().unwrap().is_empty());
        assert_eq!(
            harness.cloud.sent(),
            vec![
                (STATUS, "lookup:switch-1".to_owned()),
                (DRAIN, "transcript:switch-1|signature".to_owned())
            ]
        );
    }

    #[tokio::test]
    async fn a_left_over_barrier_is_cleared_before_cloud_is_asked() {
        let harness = harness(FakeSigner::default());
        harness.host.state.lock().unwrap().left_over = Some("switch-old".to_owned());
        harness.cloud.answer(Ok(b"accepted:draining:switch-cloud"));
        script(
            &harness,
            &[DesktopDrainProgress::Waiting { unconfirmed: 1 }],
            &[],
        );
        assert_eq!(
            harness.coordinator.request("device-target").await,
            Ok(DeviceSwitchStep::WaitingForSync { unconfirmed: 1 })
        );
        let state = harness.host.state.lock().unwrap();
        assert_eq!(state.left_over, None);
        assert_eq!(state.barrier.as_deref(), Some("switch-cloud"));
    }

    #[tokio::test]
    async fn missing_receipts_or_blocked_rows_never_reach_the_signer() {
        let harness = harness(FakeSigner::default());
        harness.host.state.lock().unwrap().barrier = Some("switch-1".to_owned());
        // Cloud answers but omits a row: the next read asks for the same rows again.
        harness.cloud.answer(Ok(b"receipts"));
        script(
            &harness,
            &[
                DesktopDrainProgress::ReceiptsRequired,
                DesktopDrainProgress::ReceiptsRequired,
            ],
            &[b"same-rows", b"same-rows"],
        );
        assert_eq!(
            harness.coordinator.advance().await,
            Ok(DeviceSwitchStep::ReceiptsMissing)
        );
        script(&harness, &[DesktopDrainProgress::Blocked], &[]);
        assert_eq!(
            harness.coordinator.advance().await,
            Ok(DeviceSwitchStep::Blocked)
        );
        // A receipt read the Host cannot answer while progress needs one is a Host fault.
        script(&harness, &[DesktopDrainProgress::ReceiptsRequired], &[]);
        assert_eq!(
            harness.coordinator.advance().await,
            Err(DeviceSwitchError::Blocked)
        );
        assert!(harness.signer.signed.lock().unwrap().is_empty());
        assert!(
            !harness
                .cloud
                .sent()
                .iter()
                .any(|(exchange, _)| *exchange == DRAIN)
        );
        assert_eq!(
            harness.host.state.lock().unwrap().barrier.as_deref(),
            Some("switch-1")
        );
    }

    #[tokio::test]
    async fn an_unanswered_request_resolves_before_exact_retry_and_never_changes_target() {
        let harness = harness(FakeSigner::default());
        harness
            .cloud
            .answer(Err(NativeCloudRequestError::OutcomeUnknown));
        assert_eq!(
            harness.coordinator.request("device-target").await,
            Err(DeviceSwitchError::Retryable)
        );
        assert_eq!(
            harness.coordinator.status().await,
            Ok(DeviceSwitchStep::RequestPending)
        );
        harness.cloud.answer(Ok(b"not_found"));
        harness.cloud.answer(Ok(b"rejected:TARGET_REMOVED"));
        assert_eq!(
            harness.coordinator.request("device-other").await,
            Ok(DeviceSwitchStep::Rejected(
                DesktopDeviceSwitchRejection::TargetRemoved
            ))
        );
        let sent = harness.cloud.sent();
        assert_eq!(sent[1].0, RESOLVE);
        assert_eq!(
            sent[0], sent[2],
            "same-epoch not-found permits only original bytes and target"
        );
        harness.cloud.answer(Ok(b"rejected:TARGET_REMOVED"));
        harness.coordinator.request("device-other").await.unwrap();
        let sent = harness.cloud.sent();
        assert!(sent[3].1.starts_with("request:device-other:"));
        assert_ne!(sent[0], sent[3]);
        assert_eq!(harness.host.state.lock().unwrap().barrier, None);
    }

    #[tokio::test]
    async fn recreated_driver_resolves_a_lost_initial_response_without_another_post() {
        let harness = harness(FakeSigner::default());
        harness
            .cloud
            .answer(Err(NativeCloudRequestError::OutcomeUnknown));
        assert_eq!(
            harness.coordinator.request("device-target").await,
            Err(DeviceSwitchError::Retryable)
        );
        let restarted = DeviceSwitchCoordinator::new(
            Arc::clone(&harness.host),
            Arc::clone(&harness.cloud),
            Arc::clone(&harness.signer),
            Arc::clone(&harness.fence),
            Arc::new(|| panic!("background must not self-wake")),
        );
        harness
            .cloud
            .answer(Ok(b"accepted:draining:switch-original"));
        script(
            &harness,
            &[DesktopDrainProgress::Waiting { unconfirmed: 2 }],
            &[],
        );
        assert_eq!(
            restarted.advance_background().await,
            Ok(DeviceSwitchStep::WaitingForSync { unconfirmed: 2 })
        );
        assert_eq!(
            harness
                .cloud
                .sent()
                .iter()
                .map(|(route, _)| *route)
                .collect::<Vec<_>>(),
            vec![REQUEST, RESOLVE]
        );
        assert_eq!(
            harness.host.state.lock().unwrap().barrier.as_deref(),
            Some("switch-original")
        );
        assert!(harness.signer.signed.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn a_superseded_initial_request_is_consumed_without_automatic_new_intent() {
        let harness = harness(FakeSigner::default());
        harness
            .cloud
            .answer(Err(NativeCloudRequestError::OutcomeUnknown));
        let _ = harness.coordinator.request("device-target").await;
        harness.cloud.answer(Ok(b"superseded"));
        assert_eq!(
            harness.coordinator.request("device-other").await,
            Ok(DeviceSwitchStep::Idle)
        );
        assert_eq!(
            harness.coordinator.advance_background().await,
            Ok(DeviceSwitchStep::Idle)
        );
        assert_eq!(
            harness
                .cloud
                .sent()
                .iter()
                .map(|(route, _)| *route)
                .collect::<Vec<_>>(),
            vec![REQUEST, RESOLVE]
        );
        assert!(harness.host.state.lock().unwrap().request_pending.is_none());
        assert!(harness.host.state.lock().unwrap().barrier.is_none());
    }

    #[tokio::test]
    async fn unknown_resolution_remains_pending_and_cannot_create_another_request() {
        let harness = harness(FakeSigner::default());
        harness
            .cloud
            .answer(Err(NativeCloudRequestError::OutcomeUnknown));
        let _ = harness.coordinator.request("device-target").await;
        for _ in 0..2 {
            harness
                .cloud
                .answer(Err(NativeCloudRequestError::OutcomeUnknown));
            assert_eq!(
                harness.coordinator.advance_background().await,
                Err(DeviceSwitchError::Retryable)
            );
        }
        let sent = harness.cloud.sent();
        assert_eq!(sent[1], sent[2]);
        assert_eq!(sent[1].0, RESOLVE);
        assert!(harness.host.state.lock().unwrap().request_pending.is_some());
    }

    #[tokio::test]
    async fn an_open_switch_is_resumed_and_writes_reopen_only_when_cloud_ends_it() {
        let harness = harness(FakeSigner::default());
        assert_eq!(
            harness.coordinator.cancel().await,
            Ok(DeviceSwitchStep::Idle)
        );
        assert_eq!(
            harness.coordinator.advance().await,
            Ok(DeviceSwitchStep::Idle)
        );
        harness.host.state.lock().unwrap().barrier = Some("switch-1".to_owned());

        // A new request resumes the open switch instead of asking Cloud for another.
        script(
            &harness,
            &[DesktopDrainProgress::Waiting { unconfirmed: 1 }],
            &[],
        );
        assert_eq!(
            harness.coordinator.request("device-other").await,
            Ok(DeviceSwitchStep::WaitingForSync { unconfirmed: 1 })
        );
        assert!(harness.cloud.sent().is_empty());

        harness.cloud.answer(Ok(b"rejected:SWITCH_NOT_CANCELLABLE"));
        assert_eq!(
            harness.coordinator.cancel().await,
            Ok(DeviceSwitchStep::Rejected(
                DesktopDeviceSwitchRejection::SwitchNotCancellable
            ))
        );
        harness
            .cloud
            .answer(Err(NativeCloudRequestError::Retryable));
        assert_eq!(
            harness.coordinator.cancel().await,
            Err(DeviceSwitchError::Retryable)
        );
        harness.cloud.answer(Ok(b"accepted:draining:switch-1"));
        assert_eq!(
            harness.coordinator.status().await,
            Ok(DeviceSwitchStep::Switch(
                DesktopDeviceSwitchStatus::Draining
            ))
        );
        assert_eq!(
            harness.host.state.lock().unwrap().barrier.as_deref(),
            Some("switch-1")
        );

        harness.cloud.answer(Ok(b"accepted:cancelled:switch-1"));
        assert_eq!(
            harness.coordinator.cancel().await,
            Ok(DeviceSwitchStep::WritesReopened)
        );
        assert_eq!(
            harness.host.state.lock().unwrap().cleared,
            vec!["switch-1".to_owned()]
        );
        let sent = harness.cloud.sent();
        assert_eq!(sent[0], (CANCEL, "lookup:switch-1".to_owned()));
        assert_eq!(sent[2], (STATUS, "lookup:switch-1".to_owned()));
    }

    #[tokio::test]
    async fn a_failed_drain_reopens_writes_and_a_foreign_answer_blocks() {
        let harness = harness(FakeSigner::default());
        harness.host.state.lock().unwrap().barrier = Some("switch-1".to_owned());
        harness.cloud.answer(Ok(b"accepted:failed:switch-1"));
        script(&harness, &[DesktopDrainProgress::Ready], &[]);
        assert_eq!(
            harness.coordinator.advance().await,
            Ok(DeviceSwitchStep::WritesReopened)
        );
        assert_eq!(harness.host.state.lock().unwrap().barrier, None);

        harness.host.state.lock().unwrap().barrier = Some("switch-2".to_owned());
        harness
            .cloud
            .answer(Ok(b"accepted:bootstrapping:switch-other"));
        script(&harness, &[DesktopDrainProgress::Ready], &[]);
        assert_eq!(
            harness.coordinator.advance().await,
            Err(DeviceSwitchError::Blocked)
        );
        assert_eq!(
            harness.host.state.lock().unwrap().barrier.as_deref(),
            Some("switch-2")
        );
    }

    #[tokio::test]
    async fn without_a_device_key_or_after_shutdown_nothing_is_signed_or_committed() {
        let harness = harness(FakeSigner {
            unavailable: true,
            ..FakeSigner::default()
        });
        harness.host.state.lock().unwrap().barrier = Some("switch-1".to_owned());
        script(&harness, &[DesktopDrainProgress::Ready], &[]);
        assert_eq!(
            harness.coordinator.advance().await,
            Err(DeviceSwitchError::Blocked)
        );
        assert!(harness.cloud.sent().is_empty());
        assert!(
            harness
                .host
                .state
                .lock()
                .unwrap()
                .prepared_proofs
                .is_empty()
        );

        // Shutdown between Cloud's answer and its commit: the switch exists in Cloud, but this
        // device never closes its writes behind it.
        let harness = self::harness(FakeSigner::default());
        harness.cloud.answer(Ok(b"accepted:draining:switch-cloud"));
        *harness.cloud.cancel_on_send.lock().unwrap() = Some(Arc::clone(&harness.fence));
        assert_eq!(
            harness.coordinator.request("device-target").await,
            Err(DeviceSwitchError::Cancelled)
        );
        assert_eq!(harness.cloud.sent().len(), 1);
        assert_eq!(harness.host.state.lock().unwrap().barrier, None);
        // After shutdown no call is admitted at all.
        assert_eq!(
            harness.coordinator.advance().await,
            Err(DeviceSwitchError::Cancelled)
        );
        assert_eq!(harness.cloud.sent().len(), 1);
    }
}
