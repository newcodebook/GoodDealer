//! Native lifecycle and cycle composition for the `GoodDealer` Cloud data plane.

use std::sync::{Arc, Mutex};

use gooddealer_local_storage::{
    DesktopCloudflareProjectionWork, DesktopLocalHost, DesktopSyncCheckpointDisposition,
    DesktopSyncPullDisposition, DesktopSyncPushClaim, DesktopSyncPushDisposition,
    DesktopSyncPushWork, DesktopSyncTransportState,
};
use tauri::async_runtime::JoinHandle;

use crate::native_cloud_session::{NativeCloudRequestError, NativeCloudSession};
use crate::projection_lane::{ProjectionCycleResult, ProjectionLane, ProjectionLaneHandle};
use crate::provider_lane::{
    ProviderLane, ProviderLaneHandle, ProviderOperation, ProviderStatus, ProviderSubmission,
};
use crate::sync_lane::{
    SyncCyclePlan, SyncCycleResult, SyncLane, SyncLaneHandle, SyncStageOutcome,
};

#[derive(Default)]
pub(crate) struct NativeCloudCancelFence {
    cancelled: Mutex<bool>,
}

impl NativeCloudCancelFence {
    fn cancel(&self) {
        if let Ok(mut cancelled) = self.cancelled.lock() {
            *cancelled = true;
        }
    }

    pub(crate) fn is_cancelled(&self) -> bool {
        self.cancelled.lock().map_or(true, |cancelled| *cancelled)
    }

    /// Serializes cancellation against the final Host commit. If a commit acquires the fence
    /// first, cancellation waits for it; if cancellation wins, no later commit can start.
    pub(crate) fn commit<T>(&self, commit: impl FnOnce() -> T) -> Option<T> {
        let cancelled = self.cancelled.lock().ok()?;
        if *cancelled {
            return None;
        }
        Some(commit())
    }
}

pub(crate) struct NativeCloudCoordinator {
    sync: SyncLaneHandle,
    projection: ProjectionLaneHandle,
    provider: ProviderLaneHandle,
    cancel_fence: Arc<NativeCloudCancelFence>,
    session: Arc<NativeCloudSession>,
    tasks: Mutex<Option<[JoinHandle<()>; 3]>>,
    transport: Arc<Mutex<TransportObservation>>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct TransportObservation {
    pub(crate) state: DesktopSyncTransportState,
    pub(crate) syncing: bool,
    pub(crate) observed_at_unix_seconds: Option<u64>,
}

impl Default for TransportObservation {
    fn default() -> Self {
        Self {
            state: DesktopSyncTransportState::Checking,
            syncing: false,
            observed_at_unix_seconds: None,
        }
    }
}

impl NativeCloudCoordinator {
    #[allow(
        clippy::too_many_lines,
        reason = "startup composes the three native lanes and their shared fences"
    )]
    pub(crate) fn start(
        host: &Arc<DesktopLocalHost>,
        session: &Arc<NativeCloudSession>,
    ) -> Arc<Self> {
        let (sync_handle, sync_lane) = SyncLane::production();
        let (projection_handle, projection_lane) = ProjectionLane::new();
        let (provider_handle, provider_lane) = ProviderLane::new();
        let session_sync = sync_handle.clone();
        let session_projection = projection_handle.clone();
        let session_provider = provider_handle.clone();
        let _ = session.subscribe_successful_publication(Arc::new(move || {
            session_sync.wake();
            session_projection.wake();
            session_provider.recover();
        }));
        let cancel_fence = Arc::new(NativeCloudCancelFence::default());
        let sync_host = Arc::clone(host);
        let sync_session = Arc::clone(session);
        let sync_cancel_fence = Arc::clone(&cancel_fence);
        let transport = Arc::new(Mutex::new(TransportObservation::default()));
        let sync_transport = Arc::clone(&transport);
        let sync_task = tauri::async_runtime::spawn(async move {
            sync_lane
                .run(move |plan| {
                    let host = Arc::clone(&sync_host);
                    let session = Arc::clone(&sync_session);
                    let fence = Arc::clone(&sync_cancel_fence);
                    let observation = Arc::clone(&sync_transport);
                    async move {
                        if let Ok(mut current) = observation.lock() {
                            current.syncing = true;
                        }
                        let result = run_sync_cycle(host, session, Arc::clone(&fence), plan).await;
                        publish_sync_cycle_observation(
                            &fence,
                            &observation,
                            result,
                            std::time::SystemTime::now()
                                .duration_since(std::time::UNIX_EPOCH)
                                .ok()
                                .map(|duration| duration.as_secs()),
                        );
                        result
                    }
                })
                .await;
        });
        let projection_host = Arc::clone(host);
        let projection_session = Arc::clone(session);
        let projection_cancel_fence = Arc::clone(&cancel_fence);
        let provider_projection = projection_handle.clone();
        let projection_task = tauri::async_runtime::spawn(async move {
            projection_lane
                .run(move || {
                    run_projection_cycle(
                        Arc::clone(&projection_host),
                        Arc::clone(&projection_session),
                        Arc::clone(&projection_cancel_fence),
                    )
                })
                .await;
        });
        let provider_host = Arc::clone(host);
        let provider_recovery_host = Arc::clone(host);
        let provider_cancel_fence = Arc::clone(&cancel_fence);
        let provider_task = tauri::async_runtime::spawn(async move {
            provider_lane
                .run(
                    move || {
                        let host = Arc::clone(&provider_recovery_host);
                        async move {
                            crate::provider_credential_orchestrator::recover(host)
                                .await
                                .is_ok()
                        }
                    },
                    move |operation| {
                        run_provider_operation(
                            Arc::clone(&provider_host),
                            Arc::clone(&provider_cancel_fence),
                            provider_projection.clone(),
                            operation,
                        )
                    },
                )
                .await;
        });
        let coordinator = Arc::new(Self {
            sync: sync_handle,
            projection: projection_handle,
            provider: provider_handle,
            cancel_fence,
            session: Arc::clone(session),
            tasks: Mutex::new(Some([sync_task, projection_task, provider_task])),
            transport,
        });
        coordinator.wake();
        coordinator
    }

    pub(crate) fn wake(&self) {
        self.sync.wake();
        self.projection.wake();
        self.provider.recover();
    }

    pub(crate) fn wake_sync(&self) {
        self.sync.wake();
    }

    pub(crate) fn cancel(&self) {
        self.session.close_mutation_admission();
        self.cancel_fence.cancel();
        self.sync.cancel();
        self.projection.cancel();
        self.provider.cancel();
    }

    pub(crate) fn submit_provider(&self, operation: &ProviderOperation) -> ProviderSubmission {
        if self.cancel_fence.is_cancelled() {
            return ProviderSubmission::Unavailable;
        }
        self.provider.submit(operation)
    }

    pub(crate) fn provider_status(&self) -> ProviderStatus {
        self.provider.status()
    }

    pub(crate) fn transport_observation(&self) -> Option<TransportObservation> {
        if self.cancel_fence.is_cancelled() {
            return None;
        }
        self.transport.lock().ok().map(|value| *value)
    }

    pub(crate) async fn join(&self) {
        let tasks = self.tasks.lock().ok().and_then(|mut tasks| tasks.take());
        if let Some(tasks) = tasks {
            for task in tasks {
                let _ = task.await;
            }
        }
        self.session.join_mutations().await;
    }
}

impl Drop for NativeCloudCoordinator {
    fn drop(&mut self) {
        self.session.close_mutation_admission();
        self.cancel_fence.cancel();
        self.sync.cancel();
        self.projection.cancel();
        self.provider.cancel();
    }
}

fn aggregate_transport_state(outcomes: [SyncStageOutcome; 3]) -> Option<DesktopSyncTransportState> {
    match SyncStageOutcome::aggregate(outcomes) {
        SyncStageOutcome::RecoveryRequired | SyncStageOutcome::SecurityBlocked => {
            Some(DesktopSyncTransportState::SecurityBlocked)
        }
        SyncStageOutcome::AuthorizationBlocked => {
            Some(DesktopSyncTransportState::AuthorizationBlocked)
        }
        SyncStageOutcome::Retryable => Some(DesktopSyncTransportState::Offline),
        SyncStageOutcome::Valid => Some(DesktopSyncTransportState::Reachable),
        SyncStageOutcome::NotAttempted => None,
    }
}

fn publish_sync_cycle_observation(
    cancel_fence: &NativeCloudCancelFence,
    observation: &Mutex<TransportObservation>,
    result: SyncCycleResult,
    observed_at_unix_seconds: Option<u64>,
) {
    let _ = cancel_fence.commit(|| {
        let Ok(mut current) = observation.lock() else {
            return;
        };
        current.syncing = false;
        if let Some(state) =
            aggregate_transport_state([result.push, result.pull, result.checkpoint])
        {
            current.state = state;
            current.observed_at_unix_seconds = observed_at_unix_seconds;
        }
    });
}

async fn run_provider_operation(
    host: Arc<DesktopLocalHost>,
    cancel_fence: Arc<NativeCloudCancelFence>,
    projection: ProjectionLaneHandle,
    operation: ProviderOperation,
) {
    let result = match operation {
        ProviderOperation::Activate { connection_id } => {
            crate::provider_credential_orchestrator::activate(host, connection_id, cancel_fence)
                .await
        }
        ProviderOperation::Observe {
            connection_id,
            entity_id,
        } => {
            crate::provider_credential_orchestrator::observe(
                host,
                connection_id,
                entity_id,
                cancel_fence,
            )
            .await
        }
    };
    if matches!(result, Ok(true)) {
        projection.wake();
    }
}

async fn run_sync_cycle(
    host: Arc<DesktopLocalHost>,
    session: Arc<NativeCloudSession>,
    cancel_fence: Arc<NativeCloudCancelFence>,
    plan: SyncCyclePlan,
) -> SyncCycleResult {
    let push = run_push(
        Arc::clone(&host),
        Arc::clone(&session),
        Arc::clone(&cancel_fence),
    )
    .await;
    let pull = if plan.pull_due && !cancel_fence.is_cancelled() {
        run_pull(
            Arc::clone(&host),
            Arc::clone(&session),
            Arc::clone(&cancel_fence),
        )
        .await
    } else {
        SyncStageOutcome::NotAttempted
    };
    let checkpoint = if plan.checkpoint_due && !cancel_fence.is_cancelled() {
        run_checkpoint(host, session, cancel_fence).await
    } else {
        SyncStageOutcome::NotAttempted
    };
    SyncCycleResult {
        push: push.outcome,
        pull,
        checkpoint,
        durable_push_wake: push.durable_wake,
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct PushCycleResult {
    outcome: SyncStageOutcome,
    durable_wake: Option<tokio::time::Instant>,
}

impl PushCycleResult {
    const fn new(outcome: SyncStageOutcome, durable_wake: Option<tokio::time::Instant>) -> Self {
        Self {
            outcome,
            durable_wake,
        }
    }
}

#[allow(
    clippy::too_many_lines,
    reason = "one Push claim must retain its admission, split, lease, and durable retry invariants"
)]
async fn run_push(
    host: Arc<DesktopLocalHost>,
    session: Arc<NativeCloudSession>,
    cancel_fence: Arc<NativeCloudCancelFence>,
) -> PushCycleResult {
    if cancel_fence.is_cancelled() {
        return PushCycleResult::new(SyncStageOutcome::NotAttempted, None);
    }
    let prepared_host = Arc::clone(&host);
    let prepared = tokio::task::spawn_blocking(move || {
        let admission = prepared_host.begin_native_cloud_run()?;
        let claim = prepared_host.claim_native_sync_push(&admission)?;
        Ok::<_, gooddealer_local_storage::DesktopLocalHostError>((admission, claim))
    })
    .await;
    let (mut admission, claim) = match prepared {
        Ok(Ok((_, DesktopSyncPushWork::NotDue(retry_after)))) => {
            return PushCycleResult::new(
                SyncStageOutcome::NotAttempted,
                Some(tokio::time::Instant::now() + retry_after),
            );
        }
        Ok(Ok((_, DesktopSyncPushWork::Empty))) => {
            return PushCycleResult::new(SyncStageOutcome::NotAttempted, None);
        }
        Ok(Err(error)) => return PushCycleResult::new(stage_from_host_error(error), None),
        Err(_) => return PushCycleResult::new(SyncStageOutcome::Retryable, None),
        Ok(Ok((admission, DesktopSyncPushWork::Ready(claim)))) => (Some(admission), claim),
    };
    // A stack preserves canonical left-first traversal while isolating at most eight times.
    let retained_until = tokio::time::Instant::now() + claim.retry_after();
    let mut unresolved = vec![claim];
    let mut requests = 0_u8;
    while let Some(claim) = unresolved.pop() {
        if requests >= 9 || cancel_fence.is_cancelled() {
            unresolved.push(claim);
            let cancelled = cancel_fence.is_cancelled();
            let wake = defer_push_claims(host, cancel_fence, unresolved)
                .await
                .or(Some(retained_until));
            return PushCycleResult::new(
                if cancelled {
                    SyncStageOutcome::NotAttempted
                } else {
                    SyncStageOutcome::Retryable
                },
                wake,
            );
        }
        let request_admission = if let Some(admission) = admission.take() {
            admission
        } else {
            let admission_host = Arc::clone(&host);
            match tokio::task::spawn_blocking(move || admission_host.begin_native_cloud_run()).await
            {
                Ok(Ok(admission)) => admission,
                Ok(Err(error)) => {
                    return PushCycleResult::new(stage_from_host_error(error), None);
                }
                Err(_) => {
                    return PushCycleResult::new(SyncStageOutcome::Retryable, None);
                }
            }
        };
        requests = requests.saturating_add(1);
        let request_body = claim.request_body().to_vec();
        let response = match session
            .send_sync_push(request_admission, request_body)
            .await
        {
            Ok(response) => response,
            Err(error) => match durable_wake_from_request_error(error) {
                DurableWakeDisposition::Defer => {
                    let wake =
                        defer_push_claim(host, cancel_fence, unresolved, claim, retained_until)
                            .await;
                    return PushCycleResult::new(push_stage_from_request_error(error), wake);
                }
                DurableWakeDisposition::RetainLease => {
                    return PushCycleResult::new(
                        push_stage_from_request_error(error),
                        Some(retained_until),
                    );
                }
                DurableWakeDisposition::None => {
                    return PushCycleResult::new(push_stage_from_request_error(error), None);
                }
            },
        };
        let (response_admission, body, credential_instance) = response.into_parts();
        let commit_host = Arc::clone(&host);
        let commit_session = Arc::clone(&session);
        let commit_fence = Arc::clone(&cancel_fence);
        let completion = tokio::task::spawn_blocking(move || {
            commit_fence.commit(|| {
                let result = commit_session.commit_response(credential_instance, || {
                    commit_host.complete_native_sync_push(&response_admission, &claim, &body)
                });
                (claim, result)
            })
        })
        .await;
        let (claim, result) = match resolve_push_completion_join(completion, retained_until) {
            Ok(completion) => completion,
            Err(wake) => {
                return PushCycleResult::new(
                    if wake.is_some() {
                        SyncStageOutcome::Retryable
                    } else {
                        SyncStageOutcome::NotAttempted
                    },
                    wake,
                );
            }
        };
        match result {
            Ok(
                DesktopSyncPushDisposition::Completed
                | DesktopSyncPushDisposition::DeterministicRejected,
            ) => {}
            Ok(DesktopSyncPushDisposition::IsolationRequired) => {
                let Ok((left, right)) = host.split_native_sync_push(claim) else {
                    return PushCycleResult::new(SyncStageOutcome::SecurityBlocked, None);
                };
                unresolved.push(right);
                unresolved.push(left);
            }
            Ok(DesktopSyncPushDisposition::Retryable) => {
                let wake =
                    defer_push_claim(host, cancel_fence, unresolved, claim, retained_until).await;
                return PushCycleResult::new(SyncStageOutcome::Retryable, wake);
            }
            Ok(DesktopSyncPushDisposition::AuthorizationBlocked) => {
                return PushCycleResult::new(SyncStageOutcome::AuthorizationBlocked, None);
            }
            Ok(DesktopSyncPushDisposition::SecurityBlocked) => {
                return PushCycleResult::new(SyncStageOutcome::SecurityBlocked, None);
            }
            Err(error) => match durable_wake_from_completion_error(error) {
                DurableWakeDisposition::Defer | DurableWakeDisposition::None => {
                    return PushCycleResult::new(push_stage_from_request_error(error), None);
                }
                DurableWakeDisposition::RetainLease => {
                    return PushCycleResult::new(
                        push_stage_from_request_error(error),
                        Some(retained_until),
                    );
                }
            },
        }
    }
    PushCycleResult::new(SyncStageOutcome::Valid, None)
}

fn resolve_push_completion_join<T>(
    completion: Result<Option<T>, tokio::task::JoinError>,
    retained_until: tokio::time::Instant,
) -> Result<T, Option<tokio::time::Instant>> {
    match completion {
        Ok(Some(completion)) => Ok(completion),
        Ok(None) => Err(None),
        Err(_) => Err(Some(retained_until)),
    }
}

async fn defer_push_claims(
    host: Arc<DesktopLocalHost>,
    cancel_fence: Arc<NativeCloudCancelFence>,
    claims: Vec<DesktopSyncPushClaim>,
) -> Option<tokio::time::Instant> {
    let deferred = tokio::task::spawn_blocking(move || {
        let admission = host.begin_native_cloud_run()?;
        cancel_fence
            .commit(|| host.defer_native_sync_push(&admission, claims))
            .ok_or(gooddealer_local_storage::DesktopLocalHostError::AuthorityRejected)?
    })
    .await;
    match deferred {
        Ok(Ok(retry_after)) => Some(tokio::time::Instant::now() + retry_after),
        Ok(Err(_)) | Err(_) => None,
    }
}

async fn defer_push_claim(
    host: Arc<DesktopLocalHost>,
    cancel_fence: Arc<NativeCloudCancelFence>,
    mut unresolved: Vec<DesktopSyncPushClaim>,
    claim: DesktopSyncPushClaim,
    retained_until: tokio::time::Instant,
) -> Option<tokio::time::Instant> {
    unresolved.push(claim);
    defer_push_claims(host, cancel_fence, unresolved)
        .await
        .or(Some(retained_until))
}

async fn run_pull(
    host: Arc<DesktopLocalHost>,
    session: Arc<NativeCloudSession>,
    cancel_fence: Arc<NativeCloudCancelFence>,
) -> SyncStageOutcome {
    if cancel_fence.is_cancelled() {
        return SyncStageOutcome::NotAttempted;
    }
    let prepared_host = Arc::clone(&host);
    let prepared = tokio::task::spawn_blocking(move || {
        let admission = prepared_host.begin_native_cloud_run()?;
        let exchange = prepared_host.prepare_native_sync_pull(&admission)?;
        Ok::<_, gooddealer_local_storage::DesktopLocalHostError>((admission, exchange))
    })
    .await;
    let (admission, exchange) = match prepared {
        Ok(Ok(prepared)) => prepared,
        Ok(Err(error)) => return stage_from_host_error(error),
        Err(_) => return SyncStageOutcome::Retryable,
    };
    let request_body = exchange.request_body().to_vec();
    let response = match session.send_sync_pull(admission, request_body).await {
        Ok(response) => response,
        Err(error) => return stage_from_request_error(error),
    };
    let (admission, body, credential_instance) = response.into_parts();
    let commit_session = Arc::clone(&session);
    match tokio::task::spawn_blocking(move || {
        cancel_fence.commit(|| {
            commit_session.commit_response(credential_instance, || {
                host.complete_native_sync_pull(&admission, &exchange, &body)
            })
        })
    })
    .await
    {
        Ok(Some(Ok(DesktopSyncPullDisposition::Completed))) => SyncStageOutcome::Valid,
        Ok(Some(
            Ok(DesktopSyncPullDisposition::Retryable) | Err(NativeCloudRequestError::Retryable),
        ))
        | Err(_) => SyncStageOutcome::Retryable,
        Ok(Some(Ok(DesktopSyncPullDisposition::AuthorizationBlocked))) => {
            SyncStageOutcome::AuthorizationBlocked
        }
        Ok(Some(Ok(DesktopSyncPullDisposition::SecurityBlocked))) => {
            SyncStageOutcome::SecurityBlocked
        }
        Ok(Some(Err(error))) => stage_from_request_error(error),
        Ok(None) => SyncStageOutcome::NotAttempted,
        Ok(Some(Ok(DesktopSyncPullDisposition::RebootstrapRequired))) => {
            SyncStageOutcome::RecoveryRequired
        }
    }
}

async fn run_checkpoint(
    host: Arc<DesktopLocalHost>,
    session: Arc<NativeCloudSession>,
    cancel_fence: Arc<NativeCloudCancelFence>,
) -> SyncStageOutcome {
    if cancel_fence.is_cancelled() {
        return SyncStageOutcome::NotAttempted;
    }
    let prepared_host = Arc::clone(&host);
    let prepared = tokio::task::spawn_blocking(move || {
        let admission = prepared_host.begin_native_cloud_run()?;
        if !prepared_host.native_checkpoint_due(&admission)? {
            return Ok(None);
        }
        Ok::<_, gooddealer_local_storage::DesktopLocalHostError>(Some((
            admission,
            DesktopLocalHost::prepare_native_checkpoint(),
        )))
    })
    .await;
    let (admission, exchange) = match prepared {
        Ok(Ok(Some(prepared))) => prepared,
        Ok(Ok(None)) => return SyncStageOutcome::NotAttempted,
        Ok(Err(error)) => return stage_from_host_error(error),
        Err(_) => return SyncStageOutcome::Retryable,
    };
    let request_body = exchange.request_body().to_vec();
    let response = match session.send_sync_checkpoint(admission, request_body).await {
        Ok(response) => response,
        Err(error) => return stage_from_request_error(error),
    };
    let (admission, body, credential_instance) = response.into_parts();
    let commit_session = Arc::clone(&session);
    match tokio::task::spawn_blocking(move || {
        cancel_fence.commit(|| {
            commit_session.commit_response(credential_instance, || {
                host.complete_native_checkpoint(&admission, &exchange, &body)
            })
        })
    })
    .await
    {
        Ok(Some(Ok(DesktopSyncCheckpointDisposition::Completed))) => SyncStageOutcome::Valid,
        Ok(Some(Err(error))) => stage_from_request_error(error),
        Ok(None) => SyncStageOutcome::NotAttempted,
        Err(_) => SyncStageOutcome::Retryable,
    }
}

async fn run_projection_cycle(
    host: Arc<DesktopLocalHost>,
    session: Arc<NativeCloudSession>,
    cancel_fence: Arc<NativeCloudCancelFence>,
) -> ProjectionCycleResult {
    if cancel_fence.is_cancelled() {
        return ProjectionCycleResult {
            next_durable_attempt: None,
        };
    }
    let prepared_host = Arc::clone(&host);
    let prepared = tokio::task::spawn_blocking(move || {
        let admission = prepared_host.begin_native_cloud_run()?;
        let claim = prepared_host.claim_native_cloudflare_projection(&admission)?;
        Ok::<_, gooddealer_local_storage::DesktopLocalHostError>((admission, claim))
    })
    .await;
    let claim = match prepared {
        Ok(Ok((_, DesktopCloudflareProjectionWork::Deferred(retry_after)))) => {
            return ProjectionCycleResult {
                next_durable_attempt: Some(tokio::time::Instant::now() + retry_after),
            };
        }
        Ok(Ok((_, DesktopCloudflareProjectionWork::Empty)) | Err(_)) | Err(_) => {
            return ProjectionCycleResult {
                next_durable_attempt: None,
            };
        }
        Ok(Ok((admission, DesktopCloudflareProjectionWork::Ready(claim)))) => (admission, claim),
    };
    let (admission, claim) = claim;
    let retry_at = tokio::time::Instant::now() + claim.retry_after();
    let request_body = claim.request_body().to_vec();
    let response = match session
        .send_cloudflare_projection(admission, request_body)
        .await
    {
        Ok(response) => response,
        Err(error) => match durable_wake_from_request_error(error) {
            DurableWakeDisposition::Defer => {
                let deferred_host = Arc::clone(&host);
                let deferred_fence = Arc::clone(&cancel_fence);
                let deferred = tokio::task::spawn_blocking(move || {
                    let admission = deferred_host.begin_native_cloud_run()?;
                    deferred_fence
                        .commit(|| {
                            deferred_host.defer_native_cloudflare_projection(&admission, &claim)
                        })
                        .ok_or(gooddealer_local_storage::DesktopLocalHostError::AuthorityRejected)?
                })
                .await;
                return ProjectionCycleResult {
                    next_durable_attempt: match deferred {
                        Ok(Ok(retry_after)) => Some(tokio::time::Instant::now() + retry_after),
                        Ok(Err(_)) | Err(_) => Some(retry_at),
                    },
                };
            }
            DurableWakeDisposition::RetainLease => {
                return ProjectionCycleResult {
                    next_durable_attempt: Some(retry_at),
                };
            }
            DurableWakeDisposition::None => {
                return ProjectionCycleResult {
                    next_durable_attempt: None,
                };
            }
        },
    };
    let (admission, body, credential_instance) = response.into_parts();
    let commit_session = Arc::clone(&session);
    let completion = tokio::task::spawn_blocking(move || {
        cancel_fence.commit(|| {
            commit_session.commit_response(credential_instance, || {
                host.complete_native_cloudflare_projection(&admission, &claim, &body)
            })
        })
    })
    .await;
    ProjectionCycleResult {
        next_durable_attempt: match completion {
            Ok(Some(Err(error))) => match durable_wake_from_completion_error(error) {
                DurableWakeDisposition::RetainLease => Some(retry_at),
                DurableWakeDisposition::Defer | DurableWakeDisposition::None => None,
            },
            Err(_) => Some(retry_at),
            Ok(Some(Ok(_)) | None) => None,
        },
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum DurableWakeDisposition {
    Defer,
    RetainLease,
    None,
}

const fn durable_wake_from_request_error(error: NativeCloudRequestError) -> DurableWakeDisposition {
    match error {
        NativeCloudRequestError::Retryable => DurableWakeDisposition::Defer,
        NativeCloudRequestError::OutcomeUnknown | NativeCloudRequestError::Unavailable => {
            DurableWakeDisposition::RetainLease
        }
        NativeCloudRequestError::AuthorityStale
        | NativeCloudRequestError::AuthorizationRequired
        | NativeCloudRequestError::AuthorizationDenied
        | NativeCloudRequestError::ProtocolBlocked
        | NativeCloudRequestError::ConfigurationBlocked => DurableWakeDisposition::None,
    }
}

const fn durable_wake_from_completion_error(
    error: NativeCloudRequestError,
) -> DurableWakeDisposition {
    match error {
        NativeCloudRequestError::Unavailable => DurableWakeDisposition::RetainLease,
        NativeCloudRequestError::Retryable
        | NativeCloudRequestError::OutcomeUnknown
        | NativeCloudRequestError::AuthorityStale
        | NativeCloudRequestError::AuthorizationRequired
        | NativeCloudRequestError::AuthorizationDenied
        | NativeCloudRequestError::ProtocolBlocked
        | NativeCloudRequestError::ConfigurationBlocked => DurableWakeDisposition::None,
    }
}

const fn stage_from_request_error(error: NativeCloudRequestError) -> SyncStageOutcome {
    match error {
        NativeCloudRequestError::Retryable
        | NativeCloudRequestError::Unavailable
        | NativeCloudRequestError::OutcomeUnknown => SyncStageOutcome::Retryable,
        NativeCloudRequestError::AuthorizationRequired
        | NativeCloudRequestError::AuthorizationDenied => SyncStageOutcome::AuthorizationBlocked,
        NativeCloudRequestError::ProtocolBlocked
        | NativeCloudRequestError::ConfigurationBlocked => SyncStageOutcome::SecurityBlocked,
        NativeCloudRequestError::AuthorityStale => SyncStageOutcome::NotAttempted,
    }
}

const fn push_stage_from_request_error(error: NativeCloudRequestError) -> SyncStageOutcome {
    match error {
        NativeCloudRequestError::Retryable
        | NativeCloudRequestError::Unavailable
        | NativeCloudRequestError::OutcomeUnknown => SyncStageOutcome::Retryable,
        NativeCloudRequestError::AuthorizationRequired
        | NativeCloudRequestError::AuthorizationDenied => SyncStageOutcome::AuthorizationBlocked,
        NativeCloudRequestError::ProtocolBlocked
        | NativeCloudRequestError::ConfigurationBlocked => SyncStageOutcome::SecurityBlocked,
        NativeCloudRequestError::AuthorityStale => SyncStageOutcome::NotAttempted,
    }
}

const fn stage_from_host_error(
    error: gooddealer_local_storage::DesktopLocalHostError,
) -> SyncStageOutcome {
    match error {
        gooddealer_local_storage::DesktopLocalHostError::AuthorityRejected => {
            SyncStageOutcome::NotAttempted
        }
        gooddealer_local_storage::DesktopLocalHostError::CloudProtocolRejected
        | gooddealer_local_storage::DesktopLocalHostError::ApplicationRootRejected => {
            SyncStageOutcome::SecurityBlocked
        }
        gooddealer_local_storage::DesktopLocalHostError::StorageRejected
        | gooddealer_local_storage::DesktopLocalHostError::Unavailable => {
            SyncStageOutcome::Retryable
        }
    }
}

#[cfg(test)]
mod tests {
    use std::{
        sync::{
            Arc, Mutex,
            atomic::{AtomicBool, Ordering},
            mpsc,
        },
        thread,
        time::Duration,
    };

    use tokio::sync::Notify;

    use super::{
        DurableWakeDisposition, NativeCloudCancelFence, TransportObservation,
        aggregate_transport_state, durable_wake_from_completion_error,
        durable_wake_from_request_error, publish_sync_cycle_observation,
        resolve_push_completion_join,
    };

    #[test]
    fn coordinator_transport_starts_checking_without_reusing_last_success() {
        let observation = TransportObservation::default();
        assert_eq!(observation.state, DesktopSyncTransportState::Checking);
        assert!(!observation.syncing);
        assert_eq!(observation.observed_at_unix_seconds, None);
    }

    #[test]
    fn transport_precedence_includes_push_without_success_masking() {
        use DesktopSyncTransportState::{
            AuthorizationBlocked, Offline, Reachable, SecurityBlocked,
        };
        use SyncStageOutcome::{
            AuthorizationBlocked as Auth, NotAttempted, RecoveryRequired, Retryable,
            SecurityBlocked as Security, Valid,
        };

        assert_eq!(
            aggregate_transport_state([Retryable, Valid, Valid]),
            Some(Offline)
        );
        assert_eq!(
            aggregate_transport_state([Auth, Valid, Valid]),
            Some(AuthorizationBlocked)
        );
        assert_eq!(
            aggregate_transport_state([Security, Valid, Valid]),
            Some(SecurityBlocked)
        );
        assert_eq!(
            aggregate_transport_state([Valid, RecoveryRequired, Valid]),
            Some(SecurityBlocked)
        );
        assert_eq!(
            aggregate_transport_state([NotAttempted, Valid, NotAttempted]),
            Some(Reachable)
        );
        assert_eq!(
            aggregate_transport_state([NotAttempted, NotAttempted, NotAttempted]),
            None
        );
    }

    #[test]
    fn transport_publication_preserves_empty_cycles_and_recovers_from_security() {
        let fence = NativeCloudCancelFence::default();
        let observation = Mutex::new(TransportObservation::default());
        let result = |push, pull, checkpoint| SyncCycleResult {
            push,
            pull,
            checkpoint,
            durable_push_wake: None,
        };

        publish_sync_cycle_observation(
            &fence,
            &observation,
            result(
                SyncStageOutcome::SecurityBlocked,
                SyncStageOutcome::Valid,
                SyncStageOutcome::Valid,
            ),
            Some(11),
        );
        assert_eq!(
            *observation.lock().unwrap(),
            TransportObservation {
                state: DesktopSyncTransportState::SecurityBlocked,
                syncing: false,
                observed_at_unix_seconds: Some(11),
            }
        );

        publish_sync_cycle_observation(
            &fence,
            &observation,
            result(
                SyncStageOutcome::NotAttempted,
                SyncStageOutcome::NotAttempted,
                SyncStageOutcome::NotAttempted,
            ),
            Some(12),
        );
        assert_eq!(
            observation.lock().unwrap().observed_at_unix_seconds,
            Some(11)
        );

        publish_sync_cycle_observation(
            &fence,
            &observation,
            result(
                SyncStageOutcome::NotAttempted,
                SyncStageOutcome::Valid,
                SyncStageOutcome::NotAttempted,
            ),
            Some(13),
        );
        assert_eq!(
            *observation.lock().unwrap(),
            TransportObservation {
                state: DesktopSyncTransportState::Reachable,
                syncing: false,
                observed_at_unix_seconds: Some(13),
            }
        );
    }

    #[test]
    fn restart_empty_cycle_stays_checking_without_observation_time() {
        let fence = NativeCloudCancelFence::default();
        let observation = Mutex::new(TransportObservation::default());
        publish_sync_cycle_observation(
            &fence,
            &observation,
            SyncCycleResult {
                push: SyncStageOutcome::NotAttempted,
                pull: SyncStageOutcome::NotAttempted,
                checkpoint: SyncStageOutcome::NotAttempted,
                durable_push_wake: None,
            },
            Some(22),
        );

        assert_eq!(
            *observation.lock().unwrap(),
            TransportObservation::default()
        );
    }

    #[test]
    fn cancellation_prevents_drained_cycle_from_publishing_late_success() {
        let fence = NativeCloudCancelFence::default();
        let observation = Mutex::new(TransportObservation {
            syncing: true,
            ..TransportObservation::default()
        });
        fence.cancel();

        publish_sync_cycle_observation(
            &fence,
            &observation,
            SyncCycleResult {
                push: SyncStageOutcome::Valid,
                pull: SyncStageOutcome::Valid,
                checkpoint: SyncStageOutcome::Valid,
                durable_push_wake: None,
            },
            Some(33),
        );

        assert_eq!(
            *observation.lock().unwrap(),
            TransportObservation {
                state: DesktopSyncTransportState::Checking,
                syncing: true,
                observed_at_unix_seconds: None,
            }
        );
    }

    #[test]
    fn outcome_unknown_is_retryable_but_pre_request_stale_is_not_attempted() {
        assert_eq!(
            super::stage_from_request_error(NativeCloudRequestError::OutcomeUnknown),
            SyncStageOutcome::Retryable
        );
        assert_eq!(
            super::stage_from_request_error(NativeCloudRequestError::AuthorityStale),
            SyncStageOutcome::NotAttempted
        );
    }
    use crate::{
        native_cloud_session::NativeCloudRequestError,
        projection_lane::{ProjectionCycleResult, ProjectionLane},
        provider_lane::{ProviderLane, ProviderOperation, ProviderSubmission},
        sync_lane::{SyncCycleResult, SyncLane, SyncStageOutcome},
    };
    use gooddealer_local_storage::DesktopSyncTransportState;

    #[test]
    fn durable_request_failures_schedule_only_the_exact_retry_contract() {
        let cases = [
            (
                NativeCloudRequestError::Retryable,
                DurableWakeDisposition::Defer,
            ),
            (
                NativeCloudRequestError::OutcomeUnknown,
                DurableWakeDisposition::RetainLease,
            ),
            (
                NativeCloudRequestError::Unavailable,
                DurableWakeDisposition::RetainLease,
            ),
            (
                NativeCloudRequestError::AuthorityStale,
                DurableWakeDisposition::None,
            ),
            (
                NativeCloudRequestError::AuthorizationRequired,
                DurableWakeDisposition::None,
            ),
            (
                NativeCloudRequestError::AuthorizationDenied,
                DurableWakeDisposition::None,
            ),
            (
                NativeCloudRequestError::ProtocolBlocked,
                DurableWakeDisposition::None,
            ),
            (
                NativeCloudRequestError::ConfigurationBlocked,
                DurableWakeDisposition::None,
            ),
        ];
        for (error, expected) in cases {
            assert_eq!(
                durable_wake_from_request_error(error),
                expected,
                "{error:?}"
            );
        }
    }

    #[test]
    fn durable_completion_failures_schedule_only_retained_unavailable_leases() {
        let cases = [
            (
                NativeCloudRequestError::Unavailable,
                DurableWakeDisposition::RetainLease,
            ),
            (
                NativeCloudRequestError::Retryable,
                DurableWakeDisposition::None,
            ),
            (
                NativeCloudRequestError::OutcomeUnknown,
                DurableWakeDisposition::None,
            ),
            (
                NativeCloudRequestError::AuthorityStale,
                DurableWakeDisposition::None,
            ),
            (
                NativeCloudRequestError::AuthorizationRequired,
                DurableWakeDisposition::None,
            ),
            (
                NativeCloudRequestError::AuthorizationDenied,
                DurableWakeDisposition::None,
            ),
            (
                NativeCloudRequestError::ProtocolBlocked,
                DurableWakeDisposition::None,
            ),
            (
                NativeCloudRequestError::ConfigurationBlocked,
                DurableWakeDisposition::None,
            ),
        ];
        for (error, expected) in cases {
            assert_eq!(
                durable_wake_from_completion_error(error),
                expected,
                "{error:?}"
            );
        }
    }

    #[tokio::test]
    async fn push_completion_join_failure_retains_the_lease_but_cancellation_does_not() {
        let retained_until = tokio::time::Instant::now() + Duration::from_secs(30);
        let join_error = tokio::task::spawn_blocking(|| panic!("completion task failed"))
            .await
            .unwrap_err();

        assert_eq!(
            resolve_push_completion_join::<()>(Err(join_error), retained_until),
            Err(Some(retained_until))
        );
        assert_eq!(
            resolve_push_completion_join::<()>(Ok(None), retained_until),
            Err(None)
        );
    }

    #[test]
    fn cancellation_that_wins_the_fence_prevents_later_commits() {
        let fence = NativeCloudCancelFence::default();
        let committed = AtomicBool::new(false);

        fence.cancel();

        assert_eq!(
            fence.commit(|| committed.store(true, Ordering::SeqCst)),
            None
        );
        assert!(!committed.load(Ordering::SeqCst));
    }

    #[test]
    fn admitted_commit_drains_before_cancellation_returns() {
        let fence = Arc::new(NativeCloudCancelFence::default());
        let (entered_tx, entered_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let (cancelled_tx, cancelled_rx) = mpsc::channel();
        let commit_fence = Arc::clone(&fence);
        let commit = thread::spawn(move || {
            commit_fence.commit(|| {
                entered_tx.send(()).unwrap();
                release_rx.recv().unwrap();
            })
        });
        entered_rx.recv().unwrap();

        let cancel_fence = Arc::clone(&fence);
        let cancel = thread::spawn(move || {
            cancel_fence.cancel();
            cancelled_tx.send(()).unwrap();
        });
        assert!(
            cancelled_rx
                .recv_timeout(Duration::from_millis(25))
                .is_err()
        );

        release_tx.send(()).unwrap();
        assert_eq!(commit.join().unwrap(), Some(()));
        cancelled_rx.recv().unwrap();
        cancel.join().unwrap();
        assert_eq!(fence.commit(|| ()), None);
    }

    #[tokio::test]
    async fn blocked_sync_does_not_block_projection_or_provider_lanes() {
        let (sync_handle, sync_lane) = SyncLane::production();
        let (projection_handle, projection_lane) = ProjectionLane::new();
        let (provider_handle, provider_lane) = ProviderLane::new();
        let sync_admitted = Arc::new(Notify::new());
        let sync_release = Arc::new(Notify::new());
        let projection_completed = Arc::new(Notify::new());
        let provider_completed = Arc::new(Notify::new());

        let sync_admitted_for_cycle = Arc::clone(&sync_admitted);
        let sync_release_for_cycle = Arc::clone(&sync_release);
        let sync_task = tokio::spawn(sync_lane.run(move |_| {
            let admitted = Arc::clone(&sync_admitted_for_cycle);
            let release = Arc::clone(&sync_release_for_cycle);
            async move {
                admitted.notify_one();
                release.notified().await;
                SyncCycleResult {
                    push: SyncStageOutcome::Valid,
                    pull: SyncStageOutcome::Valid,
                    checkpoint: SyncStageOutcome::Valid,
                    durable_push_wake: None,
                }
            }
        }));
        let projection_completed_for_cycle = Arc::clone(&projection_completed);
        let projection_task = tokio::spawn(projection_lane.run(move || {
            let completed = Arc::clone(&projection_completed_for_cycle);
            async move {
                completed.notify_one();
                ProjectionCycleResult {
                    next_durable_attempt: None,
                }
            }
        }));
        let provider_completed_for_operation = Arc::clone(&provider_completed);
        let provider_recovered = Arc::new(Notify::new());
        let provider_recovered_for_cycle = Arc::clone(&provider_recovered);
        provider_handle.recover();
        let provider_task = tokio::spawn(provider_lane.run(
            move || {
                let recovered = Arc::clone(&provider_recovered_for_cycle);
                async move {
                    recovered.notify_one();
                    true
                }
            },
            move |_| {
                let completed = Arc::clone(&provider_completed_for_operation);
                async move { completed.notify_one() }
            },
        ));

        sync_handle.wake();
        projection_handle.wake();
        provider_recovered.notified().await;
        sync_admitted.notified().await;
        assert_eq!(
            provider_handle.submit(&ProviderOperation::Observe {
                connection_id: "connection-a".to_owned(),
                entity_id: "example.com".to_owned(),
            }),
            ProviderSubmission::Accepted
        );
        tokio::time::timeout(Duration::from_millis(250), projection_completed.notified())
            .await
            .unwrap();
        tokio::time::timeout(Duration::from_millis(250), provider_completed.notified())
            .await
            .unwrap();

        sync_handle.cancel();
        projection_handle.cancel();
        provider_handle.cancel();
        sync_release.notify_one();
        sync_task.await.unwrap();
        projection_task.await.unwrap();
        provider_task.await.unwrap();
    }
}
