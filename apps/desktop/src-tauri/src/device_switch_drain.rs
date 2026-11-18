//! ADR-0032 S2d3: the source Desktop's coordination of a normal device switch.
//!
//! One coordinator serializes every exchange of this device's switch. It asks Cloud for the switch
//! and closes local writes only behind the id Cloud returned, lets the sync lane drain the Outbox,
//! reads Cloud's receipts for legacy rows, and signs and submits the drain proof only when the
//! Host reports the mutation stream fully confirmed. It reopens writes only when Cloud reports the
//! switch cancelled or failed. Every Cloud answer is decoded by the Host; this module holds no
//! wire format, credential or private key, and signs only the transcript the Host built.

use std::future::Future;
use std::sync::Arc;

use gooddealer_local_storage::{
    DesktopDeviceSwitchOutcome, DesktopDeviceSwitchRejection, DesktopDeviceSwitchRequestExchange,
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
    /// Cloud reports the switch cancelled or failed, and this device reopened its writes.
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

/// The Host operations the coordinator needs. Every method may block on local storage.
pub(crate) trait SwitchHost: Send + Sync + 'static {
    type Admission: Send + 'static;
    type Exchange: Clone + Send + Sync + 'static;
    type ReceiptQuery: Send + 'static;
    type Draft: Send + 'static;

    fn admit(&self) -> Result<Self::Admission, DesktopLocalHostError>;
    fn prepare_request(target_device_id: &str) -> Result<Self::Exchange, DesktopLocalHostError>;
    fn exchange_body(exchange: &Self::Exchange) -> Vec<u8>;
    fn complete_request(
        &self,
        admission: &Self::Admission,
        exchange: &Self::Exchange,
        wire: &[u8],
    ) -> Result<DesktopDeviceSwitchStart, DesktopLocalHostError>;
    fn begin_drain(
        &self,
        admission: &Self::Admission,
        id: &str,
    ) -> Result<(), DesktopLocalHostError>;
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
    /// Serializes switch calls. Holds the request still unanswered after a failed exchange, so a
    /// retry to the same target reuses its idempotency key and Cloud returns its first outcome.
    unanswered: Mutex<Option<H::Exchange>>,
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
            unanswered: Mutex::new(None),
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
        let mut unanswered = self.unanswered.lock().await;
        let admission = self.admit().await?;
        // A barrier from an earlier Lease epoch would refuse the new switch's barrier only after
        // Cloud accepted it; clear it before asking.
        let (admission, _) = self.run(admission, H::clear_left_over).await?;
        let (admission, open) = self.run(admission, H::in_progress).await?;
        if let Some(id) = open {
            return self.advance_locked(admission, id).await;
        }
        let exchange = match unanswered.take() {
            Some(exchange) => exchange,
            None => H::prepare_request(target_device_id).map_err(host_error)?,
        };
        let body = H::exchange_body(&exchange);
        let committed = exchange.clone();
        let started = self
            .exchange(
                admission,
                SwitchCloudExchange::Switch(DeviceSwitchExchange::Request),
                body,
                move |host, admission, wire| {
                    let start = host.complete_request(admission, &committed, wire)?;
                    // Writes close in the same commit that accepts Cloud's id for the switch.
                    if let DesktopDeviceSwitchStart::Accepted {
                        device_switch_request_id,
                        status: DesktopDeviceSwitchStatus::Requested | DesktopDeviceSwitchStatus::Draining,
                    } = &start
                    {
                        host.begin_drain(admission, device_switch_request_id)?;
                    }
                    Ok(start)
                },
            )
            .await;
        match started {
            Err(error) => {
                *unanswered = Some(exchange);
                Err(error)
            }
            Ok(DesktopDeviceSwitchStart::Rejected(code)) => Ok(DeviceSwitchStep::Rejected(code)),
            Ok(DesktopDeviceSwitchStart::Accepted {
                device_switch_request_id,
                status: DesktopDeviceSwitchStatus::Requested | DesktopDeviceSwitchStatus::Draining,
            }) => {
                let admission = self.admit().await?;
                self.advance_locked(admission, device_switch_request_id)
                    .await
            }
            // A retry answered with a switch that already moved on: nothing was closed here.
            Ok(DesktopDeviceSwitchStart::Accepted { status, .. }) => {
                Ok(DeviceSwitchStep::Switch(status))
            }
        }
    }

    /// Moves this device's open switch forward: waits for sync, reads receipts, then signs and
    /// submits the drain proof.
    pub(crate) async fn advance(&self) -> Result<DeviceSwitchStep, DeviceSwitchError> {
        let _serialized = self.unanswered.lock().await;
        let admission = self.admit().await?;
        let (admission, open) = self.run(admission, H::in_progress).await?;
        match open {
            Some(id) => self.advance_locked(admission, id).await,
            None => Ok(DeviceSwitchStep::Idle),
        }
    }

    /// Asks Cloud to cancel this device's open switch; writes reopen only once Cloud confirms.
    pub(crate) async fn cancel(&self) -> Result<DeviceSwitchStep, DeviceSwitchError> {
        self.lookup(DeviceSwitchExchange::Cancel).await
    }

    /// Reads Cloud's state of this device's open switch, reopening writes if Cloud ended it.
    pub(crate) async fn status(&self) -> Result<DeviceSwitchStep, DeviceSwitchError> {
        self.lookup(DeviceSwitchExchange::Status).await
    }

    async fn lookup(
        &self,
        exchange: DeviceSwitchExchange,
    ) -> Result<DeviceSwitchStep, DeviceSwitchError> {
        let _serialized = self.unanswered.lock().await;
        let admission = self.admit().await?;
        let (admission, open) = self.run(admission, H::in_progress).await?;
        let Some(id) = open else {
            return Ok(DeviceSwitchStep::Idle);
        };
        let body = H::lookup(&id).map_err(host_error)?;
        self.settle(admission, SwitchCloudExchange::Switch(exchange), body, id)
            .await
    }

    async fn advance_locked(
        &self,
        mut admission: H::Admission,
        id: String,
    ) -> Result<DeviceSwitchStep, DeviceSwitchError> {
        let mut previous_query: Option<Vec<u8>> = None;
        let mut rounds = 0;
        loop {
            let (current, progress) = self.run(admission, H::progress).await?;
            match progress {
                DesktopDrainProgress::Waiting { unconfirmed } => {
                    (self.wake_sync)();
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
        self.settle(
            admission,
            SwitchCloudExchange::Switch(DeviceSwitchExchange::Drain),
            body,
            id,
        )
        .await
    }

    /// Sends one exchange about switch `id` and commits Cloud's outcome. Writes reopen in the
    /// same commit only when Cloud reports the switch cancelled or failed.
    async fn settle(
        &self,
        admission: H::Admission,
        exchange: SwitchCloudExchange,
        body: Vec<u8>,
        id: String,
    ) -> Result<DeviceSwitchStep, DeviceSwitchError> {
        self.exchange(admission, exchange, body, move |host, admission, wire| {
            Ok(match host.complete_switch(admission, &id, wire)? {
                DesktopDeviceSwitchOutcome::Accepted(
                    DesktopDeviceSwitchStatus::Cancelled | DesktopDeviceSwitchStatus::Failed,
                ) => {
                    host.clear_barrier(admission, &id)?;
                    DeviceSwitchStep::WritesReopened
                }
                DesktopDeviceSwitchOutcome::Accepted(status) => DeviceSwitchStep::Switch(status),
                DesktopDeviceSwitchOutcome::Rejected(code) => DeviceSwitchStep::Rejected(code),
            })
        })
        .await
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
    type ReceiptQuery = DesktopDrainReceiptQuery;
    type Draft = DesktopDrainProofDraft;

    fn admit(&self) -> Result<Self::Admission, DesktopLocalHostError> {
        self.begin_native_cloud_run()
    }

    fn prepare_request(target_device_id: &str) -> Result<Self::Exchange, DesktopLocalHostError> {
        Self::prepare_native_device_switch_request(target_device_id)
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

    fn begin_drain(
        &self,
        admission: &Self::Admission,
        id: &str,
    ) -> Result<(), DesktopLocalHostError> {
        self.begin_native_device_switch_drain(admission, id)
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

    struct FakeAdmission;

    #[derive(Default)]
    struct HostState {
        barrier: Option<String>,
        /// A barrier from an earlier Lease epoch: invisible to `in_progress`, but it refuses a new one.
        left_over: Option<String>,
        progress: VecDeque<DesktopDrainProgress>,
        receipt_queries: VecDeque<Vec<u8>>,
        recorded_receipts: Vec<Vec<u8>>,
        prepared_proofs: Vec<(String, String)>,
        submissions: Vec<String>,
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
            ["accepted", status, id] => {
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
        type ReceiptQuery = Vec<u8>;
        type Draft = Vec<u8>;

        fn admit(&self) -> Result<FakeAdmission, DesktopLocalHostError> {
            Ok(FakeAdmission)
        }

        fn prepare_request(target: &str) -> Result<Self::Exchange, DesktopLocalHostError> {
            let key = NEXT_KEY.fetch_add(1, Ordering::Relaxed);
            Ok((
                target.to_owned(),
                format!("request:{target}:key-{key}").into_bytes(),
            ))
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
            Ok(match decode(wire)? {
                (Some((status, id)), None) => DesktopDeviceSwitchStart::Accepted {
                    device_switch_request_id: id,
                    status,
                },
                (None, Some(code)) => DesktopDeviceSwitchStart::Rejected(code),
                _ => return Err(DesktopLocalHostError::CloudProtocolRejected),
            })
        }

        fn begin_drain(&self, _: &FakeAdmission, id: &str) -> Result<(), DesktopLocalHostError> {
            let mut state = self.state.lock().unwrap();
            if state.left_over.is_some() || state.barrier.as_deref().is_some_and(|open| open != id)
            {
                return Err(DesktopLocalHostError::StorageRejected);
            }
            state.barrier = Some(id.to_owned());
            Ok(())
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
                    DesktopDeviceSwitchOutcome::Accepted(status)
                }
                (None, Some(code)) => DesktopDeviceSwitchOutcome::Rejected(code),
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
            admission: FakeAdmission,
            exchange: SwitchCloudExchange,
            body: Vec<u8>,
        ) -> impl Future<Output = Result<(FakeAdmission, Vec<u8>, u64), NativeCloudRequestError>> + Send
        {
            self.sent.lock().unwrap().push((exchange, body));
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
    const DRAIN: SwitchCloudExchange = SwitchCloudExchange::Switch(DeviceSwitchExchange::Drain);
    const CANCEL: SwitchCloudExchange = SwitchCloudExchange::Switch(DeviceSwitchExchange::Cancel);
    const STATUS: SwitchCloudExchange = SwitchCloudExchange::Switch(DeviceSwitchExchange::Status);

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
        assert_eq!(sent.len(), 3);
        assert_eq!(sent[0].0, REQUEST);
        assert!(sent[0].1.starts_with("request:device-target:"));
        assert_eq!(
            sent[1],
            (SwitchCloudExchange::Receipts, "receipts-for-a-b".to_owned())
        );
        assert_eq!(
            sent[2],
            (DRAIN, "transcript:switch-cloud|signature".to_owned())
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
    async fn an_unanswered_request_is_retried_under_its_key_and_a_refusal_closes_nothing() {
        let harness = harness(FakeSigner::default());
        harness
            .cloud
            .answer(Err(NativeCloudRequestError::OutcomeUnknown));
        assert_eq!(
            harness.coordinator.request("device-target").await,
            Err(DeviceSwitchError::Retryable)
        );
        harness.cloud.answer(Ok(b"rejected:TARGET_REMOVED"));
        assert_eq!(
            harness.coordinator.request("device-target").await,
            Ok(DeviceSwitchStep::Rejected(
                DesktopDeviceSwitchRejection::TargetRemoved
            ))
        );
        harness.cloud.answer(Ok(b"rejected:TARGET_REMOVED"));
        harness.coordinator.request("device-target").await.unwrap();
        let sent = harness.cloud.sent();
        assert_eq!(
            sent[0], sent[1],
            "a retry reuses the unanswered request's idempotency key"
        );
        assert_ne!(sent[1], sent[2], "an answered request is never reused");
        assert_eq!(harness.host.state.lock().unwrap().barrier, None);
        // An unanswered request is settled under its own key before any other target is asked:
        // Cloud may already hold it open.
        harness
            .cloud
            .answer(Err(NativeCloudRequestError::Retryable));
        let _ = harness.coordinator.request("device-target").await;
        harness.cloud.answer(Ok(b"rejected:TARGET_REMOVED"));
        harness.coordinator.request("device-other").await.unwrap();
        harness.cloud.answer(Ok(b"rejected:TARGET_REMOVED"));
        harness.coordinator.request("device-other").await.unwrap();
        let sent = harness.cloud.sent();
        assert_eq!(sent[3], sent[4]);
        assert!(sent[5].1.starts_with("request:device-other:"));
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
