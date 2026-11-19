//! Bounded upload of the Host's immutable execution evidence in the existing synchronization lane.

use std::future::Future;
use std::sync::Arc;

use gooddealer_local_storage::{
    DesktopExecutionEvidenceDeliveryOutcome, DesktopExecutionEvidenceStream,
    DesktopExecutionEvidenceUpload, DesktopLocalHost, DesktopLocalHostError,
    DesktopNativeCloudAdmission,
};

use super::{NativeCloudCancelFence, stage_from_host_error, stage_from_request_error};
use crate::native_cloud_session::{NativeCloudRequestError, NativeCloudSession};
use crate::sync_lane::SyncStageOutcome;

const MAX_UPLOADS_PER_CYCLE: usize = 32;

pub(super) struct EvidenceCycleResult {
    pub(super) outcome: SyncStageOutcome,
    pub(super) more: bool,
}
impl EvidenceCycleResult {
    pub(super) const fn stopped(outcome: SyncStageOutcome) -> Self {
        Self {
            outcome,
            more: false,
        }
    }
}

// Narrow internal seams let cancellation, unknown replies and commit races be exercised without
// a real Cloud account. Production can only select Host-owned events and these two fixed streams.
type PreparedEvidence<A, U> = Result<Option<(A, U)>, DesktopLocalHostError>;

trait EvidenceHost: Send + Sync + 'static {
    type Admission: Send + 'static;
    type Upload: Send + 'static;
    fn prepare(&self) -> PreparedEvidence<Self::Admission, Self::Upload>;
    fn request(upload: &Self::Upload) -> (DesktopExecutionEvidenceStream, Vec<u8>);
    fn complete(
        &self,
        admission: &Self::Admission,
        upload: &Self::Upload,
        body: &[u8],
    ) -> Result<DesktopExecutionEvidenceDeliveryOutcome, DesktopLocalHostError>;
}
trait EvidenceCloud<A>: Send + Sync + 'static {
    fn send(
        self: &Arc<Self>,
        admission: A,
        stream: DesktopExecutionEvidenceStream,
        body: Vec<u8>,
    ) -> impl Future<Output = Result<(A, Vec<u8>, u64), NativeCloudRequestError>> + Send;
    fn commit<T>(
        &self,
        credential: u64,
        commit: impl FnOnce() -> Result<T, DesktopLocalHostError>,
    ) -> Result<T, NativeCloudRequestError>;
}

pub(super) async fn run(
    host: Arc<DesktopLocalHost>,
    session: Arc<NativeCloudSession>,
    cancel: Arc<NativeCloudCancelFence>,
) -> EvidenceCycleResult {
    upload_cycle(host, session, cancel).await
}

async fn upload_cycle<H: EvidenceHost, C: EvidenceCloud<H::Admission>>(
    host: Arc<H>,
    session: Arc<C>,
    cancel: Arc<NativeCloudCancelFence>,
) -> EvidenceCycleResult {
    let mut outcome = SyncStageOutcome::NotAttempted;
    for _ in 0..MAX_UPLOADS_PER_CYCLE {
        if cancel.is_cancelled() {
            return EvidenceCycleResult::stopped(SyncStageOutcome::NotAttempted);
        }
        let prepare_host = Arc::clone(&host);
        let work = tokio::task::spawn_blocking(move || prepare_host.prepare()).await;
        let (admission, upload) = match work {
            Ok(Ok(Some(work))) => work,
            Ok(Ok(None)) => return EvidenceCycleResult::stopped(outcome),
            Ok(Err(error)) => return EvidenceCycleResult::stopped(stage_from_host_error(error)),
            Err(_) => return EvidenceCycleResult::stopped(SyncStageOutcome::Retryable),
        };
        if cancel.is_cancelled() {
            return EvidenceCycleResult::stopped(SyncStageOutcome::NotAttempted);
        }
        let (stream, bytes) = H::request(&upload);
        let (response_admission, body, credential) =
            match session.send(admission, stream, bytes).await {
                Ok(response) => response,
                Err(error) => return EvidenceCycleResult::stopped(stage_from_request_error(error)),
            };
        let commit_host = Arc::clone(&host);
        let commit_session = Arc::clone(&session);
        let commit_cancel = Arc::clone(&cancel);
        // Await the blocking commit even during shutdown: joining this lane must mean no detached
        // database writer remains. Both the session and Host recheck their final fences.
        let committed = tokio::task::spawn_blocking(move || {
            commit_cancel.commit(|| {
                commit_session.commit(credential, || {
                    commit_host.complete(&response_admission, &upload, &body)
                })
            })
        })
        .await;
        match committed {
            Ok(Some(Ok(DesktopExecutionEvidenceDeliveryOutcome::Accepted))) => {
                outcome = SyncStageOutcome::Valid;
            }
            Ok(Some(Ok(DesktopExecutionEvidenceDeliveryOutcome::Pending))) | Err(_) => {
                return EvidenceCycleResult::stopped(SyncStageOutcome::Retryable);
            }
            Ok(Some(Ok(DesktopExecutionEvidenceDeliveryOutcome::Quarantined))) => {
                return EvidenceCycleResult::stopped(SyncStageOutcome::SecurityBlocked);
            }
            Ok(Some(Err(error))) => {
                return EvidenceCycleResult::stopped(stage_from_request_error(error));
            }
            Ok(None) => return EvidenceCycleResult::stopped(SyncStageOutcome::NotAttempted),
        }
    }
    // Yield to mutation/pull/checkpoint work, then continue promptly without misreporting a
    // successful bounded batch as a network failure or creating an unbounded hot loop.
    EvidenceCycleResult {
        outcome,
        more: true,
    }
}

impl EvidenceHost for DesktopLocalHost {
    type Admission = DesktopNativeCloudAdmission;
    type Upload = DesktopExecutionEvidenceUpload;
    fn prepare(&self) -> PreparedEvidence<Self::Admission, Self::Upload> {
        let admission = self.begin_native_cloud_run()?;
        let Some(upload) = self.next_execution_evidence_upload(admission)? else {
            return Ok(None);
        };
        // The opaque upload owns its source admission. A separate current admission guards the
        // transport; either changing before completion invalidates the final Host commit.
        Ok(Some((self.begin_native_cloud_run()?, upload)))
    }
    fn request(upload: &Self::Upload) -> (DesktopExecutionEvidenceStream, Vec<u8>) {
        (upload.stream(), upload.request_bytes().to_vec())
    }
    fn complete(
        &self,
        admission: &Self::Admission,
        upload: &Self::Upload,
        body: &[u8],
    ) -> Result<DesktopExecutionEvidenceDeliveryOutcome, DesktopLocalHostError> {
        self.recheck_native_cloud(admission)?;
        self.record_execution_evidence_response(upload, body)
    }
}
impl EvidenceCloud<DesktopNativeCloudAdmission> for NativeCloudSession {
    async fn send(
        self: &Arc<Self>,
        admission: DesktopNativeCloudAdmission,
        stream: DesktopExecutionEvidenceStream,
        body: Vec<u8>,
    ) -> Result<(DesktopNativeCloudAdmission, Vec<u8>, u64), NativeCloudRequestError> {
        Ok(self
            .send_execution_evidence(admission, stream, body)
            .await?
            .into_parts())
    }
    fn commit<T>(
        &self,
        credential: u64,
        commit: impl FnOnce() -> Result<T, DesktopLocalHostError>,
    ) -> Result<T, NativeCloudRequestError> {
        self.commit_response(credential, commit)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;
    use std::sync::{
        Mutex,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    };

    struct TestHost {
        queue: Mutex<VecDeque<Vec<u8>>>,
        delivered: Mutex<Vec<Vec<u8>>>,
        outcome: DesktopExecutionEvidenceDeliveryOutcome,
        quarantined: AtomicBool,
    }
    impl TestHost {
        fn new(count: usize, outcome: DesktopExecutionEvidenceDeliveryOutcome) -> Arc<Self> {
            Arc::new(Self {
                queue: Mutex::new((0..count).map(|n| n.to_be_bytes().to_vec()).collect()),
                delivered: Mutex::new(Vec::new()),
                outcome,
                quarantined: AtomicBool::new(false),
            })
        }
    }
    impl EvidenceHost for TestHost {
        type Admission = ();
        type Upload = Vec<u8>;
        fn prepare(&self) -> Result<Option<((), Vec<u8>)>, DesktopLocalHostError> {
            if self.quarantined.load(Ordering::SeqCst) {
                return Err(DesktopLocalHostError::CloudProtocolRejected);
            }
            Ok(self
                .queue
                .lock()
                .unwrap()
                .front()
                .cloned()
                .map(|bytes| ((), bytes)))
        }
        fn request(bytes: &Vec<u8>) -> (DesktopExecutionEvidenceStream, Vec<u8>) {
            (DesktopExecutionEvidenceStream::DeviceAudit, bytes.clone())
        }
        fn complete(
            &self,
            (): &(),
            upload: &Vec<u8>,
            body: &[u8],
        ) -> Result<DesktopExecutionEvidenceDeliveryOutcome, DesktopLocalHostError> {
            if body != b"exact-receipt" {
                return Err(DesktopLocalHostError::CloudProtocolRejected);
            }
            self.delivered.lock().unwrap().push(upload.clone());
            match self.outcome {
                DesktopExecutionEvidenceDeliveryOutcome::Accepted => {
                    assert_eq!(
                        self.queue.lock().unwrap().pop_front().as_ref(),
                        Some(upload)
                    );
                }
                DesktopExecutionEvidenceDeliveryOutcome::Quarantined => {
                    self.quarantined.store(true, Ordering::SeqCst);
                }
                DesktopExecutionEvidenceDeliveryOutcome::Pending => {}
            }
            Ok(self.outcome)
        }
    }
    #[derive(Default)]
    struct TestCloud {
        sent: Mutex<Vec<Vec<u8>>>,
        failures: AtomicUsize,
        stale: AtomicBool,
        cancel_after_send: Option<Arc<NativeCloudCancelFence>>,
    }
    impl EvidenceCloud<()> for TestCloud {
        fn send(
            self: &Arc<Self>,
            (): (),
            _: DesktopExecutionEvidenceStream,
            body: Vec<u8>,
        ) -> impl Future<Output = Result<((), Vec<u8>, u64), NativeCloudRequestError>> + Send
        {
            self.sent.lock().unwrap().push(body);
            if let Some(cancel) = &self.cancel_after_send {
                cancel.cancel();
            }
            if self
                .failures
                .try_update(Ordering::SeqCst, Ordering::SeqCst, |n| n.checked_sub(1))
                .is_ok()
            {
                return std::future::ready(Err(NativeCloudRequestError::OutcomeUnknown));
            }
            std::future::ready(Ok(((), b"exact-receipt".to_vec(), 1)))
        }
        fn commit<T>(
            &self,
            _: u64,
            commit: impl FnOnce() -> Result<T, DesktopLocalHostError>,
        ) -> Result<T, NativeCloudRequestError> {
            if self.stale.load(Ordering::SeqCst) {
                return Err(NativeCloudRequestError::AuthorityStale);
            }
            commit().map_err(|_| NativeCloudRequestError::ProtocolBlocked)
        }
    }

    #[tokio::test]
    async fn lost_reply_reselects_identical_bytes_and_only_exact_commit_advances() {
        let host = TestHost::new(2, DesktopExecutionEvidenceDeliveryOutcome::Accepted);
        let cloud = Arc::new(TestCloud {
            failures: AtomicUsize::new(1),
            ..TestCloud::default()
        });
        let fence = Arc::new(NativeCloudCancelFence::default());
        let first = upload_cycle(Arc::clone(&host), Arc::clone(&cloud), Arc::clone(&fence)).await;
        assert_eq!(first.outcome, SyncStageOutcome::Retryable);
        assert!(host.delivered.lock().unwrap().is_empty());
        let resumed = upload_cycle(Arc::clone(&host), Arc::clone(&cloud), fence).await;
        assert_eq!(resumed.outcome, SyncStageOutcome::Valid);
        assert!(!resumed.more);
        let sent = cloud.sent.lock().unwrap();
        assert_eq!(sent.len(), 3);
        assert_eq!(sent[0], sent[1]);
        assert_ne!(sent[1], sent[2]);
        assert_eq!(host.delivered.lock().unwrap().len(), 2);
    }

    #[tokio::test]
    async fn pending_backs_off_without_consuming_and_quarantine_stops_all_later_uploads() {
        for (delivery, expected) in [
            (
                DesktopExecutionEvidenceDeliveryOutcome::Pending,
                SyncStageOutcome::Retryable,
            ),
            (
                DesktopExecutionEvidenceDeliveryOutcome::Quarantined,
                SyncStageOutcome::SecurityBlocked,
            ),
        ] {
            let host = TestHost::new(2, delivery);
            let cloud = Arc::new(TestCloud::default());
            let fence = Arc::new(NativeCloudCancelFence::default());
            let result =
                upload_cycle(Arc::clone(&host), Arc::clone(&cloud), Arc::clone(&fence)).await;
            assert_eq!(result.outcome, expected);
            assert!(!result.more);
            assert_eq!(host.queue.lock().unwrap().len(), 2);
            assert_eq!(cloud.sent.lock().unwrap().len(), 1);
            if delivery == DesktopExecutionEvidenceDeliveryOutcome::Quarantined {
                let retry = upload_cycle(host, Arc::clone(&cloud), fence).await;
                assert_eq!(retry.outcome, SyncStageOutcome::SecurityBlocked);
                assert_eq!(cloud.sent.lock().unwrap().len(), 1);
            }
        }
    }

    #[tokio::test]
    async fn shutdown_or_credential_change_after_http_cannot_record_a_late_receipt() {
        for stale in [false, true] {
            let host = TestHost::new(1, DesktopExecutionEvidenceDeliveryOutcome::Accepted);
            let fence = Arc::new(NativeCloudCancelFence::default());
            let cloud = Arc::new(TestCloud {
                stale: AtomicBool::new(stale),
                cancel_after_send: (!stale).then(|| Arc::clone(&fence)),
                ..TestCloud::default()
            });
            let result = upload_cycle(Arc::clone(&host), Arc::clone(&cloud), fence).await;
            assert_eq!(result.outcome, SyncStageOutcome::NotAttempted);
            assert!(!result.more);
            assert_eq!(cloud.sent.lock().unwrap().len(), 1);
            assert!(host.delivered.lock().unwrap().is_empty());
            assert_eq!(host.queue.lock().unwrap().len(), 1);
        }
    }

    #[tokio::test]
    async fn canceled_cycle_does_not_send_and_successful_backlog_yields_after_bound() {
        let host = TestHost::new(
            MAX_UPLOADS_PER_CYCLE + 1,
            DesktopExecutionEvidenceDeliveryOutcome::Accepted,
        );
        let cloud = Arc::new(TestCloud::default());
        let canceled = Arc::new(NativeCloudCancelFence::default());
        canceled.cancel();
        assert_eq!(
            upload_cycle(Arc::clone(&host), Arc::clone(&cloud), canceled)
                .await
                .outcome,
            SyncStageOutcome::NotAttempted
        );
        assert!(cloud.sent.lock().unwrap().is_empty());
        let result = upload_cycle(
            Arc::clone(&host),
            Arc::clone(&cloud),
            Arc::new(NativeCloudCancelFence::default()),
        )
        .await;
        assert_eq!(result.outcome, SyncStageOutcome::Valid);
        assert!(result.more);
        assert_eq!(cloud.sent.lock().unwrap().len(), MAX_UPLOADS_PER_CYCLE);
        assert_eq!(host.queue.lock().unwrap().len(), 1);
    }
}
