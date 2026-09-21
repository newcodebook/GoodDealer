//! Native-only scheduling core for the `GoodDealer` synchronization lane.

use std::{future::Future, time::Duration};

use tokio::{
    sync::{mpsc, watch},
    time::{Instant, MissedTickBehavior},
};

const PRODUCTION_CADENCE: Duration = Duration::from_secs(30);
const MAX_TRANSIENT_BACKOFF: Duration = Duration::from_mins(5);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum SyncStageOutcome {
    NotAttempted,
    Valid,
    Retryable,
    AuthorizationBlocked,
    SecurityBlocked,
    RecoveryRequired,
}

impl SyncStageOutcome {
    const fn precedence(self) -> u8 {
        match self {
            Self::NotAttempted => 0,
            Self::Valid => 1,
            Self::Retryable => 2,
            Self::AuthorizationBlocked => 3,
            Self::SecurityBlocked => 4,
            Self::RecoveryRequired => 5,
        }
    }

    /// Reduces one cycle's independent stages without allowing a later success to mask an
    /// earlier, higher-severity outcome.
    pub(crate) fn aggregate(outcomes: [Self; 3]) -> Self {
        outcomes
            .into_iter()
            .max_by_key(|outcome| outcome.precedence())
            .unwrap_or(Self::NotAttempted)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct SyncCyclePlan {
    pub(crate) pull_due: bool,
    pub(crate) checkpoint_due: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct SyncCycleResult {
    pub(crate) push: SyncStageOutcome,
    pub(crate) pull: SyncStageOutcome,
    pub(crate) checkpoint: SyncStageOutcome,
    /// Exact Host-owned durable Push retry/lease deadline. This is scheduling information, not an
    /// actor-side Push retry counter.
    pub(crate) durable_push_wake: Option<Instant>,
}

#[derive(Debug)]
struct TransientDeadline {
    failures: u16,
    retry_at: Option<Instant>,
}

impl TransientDeadline {
    const fn new() -> Self {
        Self {
            failures: 0,
            retry_at: None,
        }
    }

    fn is_due(&self, now: Instant) -> bool {
        self.retry_at.is_none_or(|deadline| deadline <= now)
    }

    fn apply(&mut self, outcome: SyncStageOutcome, now: Instant) {
        match outcome {
            SyncStageOutcome::NotAttempted => {}
            SyncStageOutcome::Valid
            | SyncStageOutcome::AuthorizationBlocked
            | SyncStageOutcome::SecurityBlocked
            | SyncStageOutcome::RecoveryRequired => {
                self.failures = 0;
                self.retry_at = None;
            }
            SyncStageOutcome::Retryable => {
                let exponent = self.failures.min(8);
                let delay = Duration::from_secs(1_u64 << exponent).min(MAX_TRANSIENT_BACKOFF);
                self.failures = self.failures.saturating_add(1);
                self.retry_at = Some(now + delay);
            }
        }
    }

    fn retry_at(&self) -> Option<Instant> {
        self.retry_at
    }
}

#[derive(Debug)]
struct SyncLaneState {
    pull: TransientDeadline,
    checkpoint: TransientDeadline,
    durable_push_wake: Option<Instant>,
}

impl SyncLaneState {
    const fn new() -> Self {
        Self {
            pull: TransientDeadline::new(),
            checkpoint: TransientDeadline::new(),
            durable_push_wake: None,
        }
    }

    fn plan(&self, now: Instant) -> SyncCyclePlan {
        SyncCyclePlan {
            pull_due: self.pull.is_due(now),
            checkpoint_due: self.checkpoint.is_due(now),
        }
    }

    fn apply(&mut self, result: SyncCycleResult, now: Instant) {
        self.pull.apply(result.pull, now);
        self.checkpoint.apply(result.checkpoint, now);
        self.durable_push_wake = result.durable_push_wake;
    }

    fn earliest_deadline(&self) -> Option<Instant> {
        [
            self.durable_push_wake,
            self.pull.retry_at(),
            self.checkpoint.retry_at(),
        ]
        .into_iter()
        .flatten()
        .min()
    }
}

#[derive(Clone)]
pub(crate) struct SyncLaneHandle {
    wake: mpsc::Sender<()>,
    cancel: watch::Sender<bool>,
}

impl SyncLaneHandle {
    /// Coalesces any number of scheduler or authority wakes into one pending wake.
    pub(crate) fn wake(&self) {
        let _ = self.wake.try_send(());
    }

    /// Cancels the current lane instance. A later authority/session must create a fresh instance.
    pub(crate) fn cancel(&self) {
        let _ = self.cancel.send(true);
    }
}

pub(crate) struct SyncLane {
    wake: mpsc::Receiver<()>,
    cancel: watch::Receiver<bool>,
    state: SyncLaneState,
    cadence: Duration,
}

impl SyncLane {
    pub(crate) fn production() -> (SyncLaneHandle, Self) {
        Self::with_cadence(PRODUCTION_CADENCE)
    }

    fn with_cadence(cadence: Duration) -> (SyncLaneHandle, Self) {
        let (wake_tx, wake_rx) = mpsc::channel(1);
        let (cancel_tx, cancel_rx) = watch::channel(false);
        (
            SyncLaneHandle {
                wake: wake_tx,
                cancel: cancel_tx,
            },
            Self {
                wake: wake_rx,
                cancel: cancel_rx,
                state: SyncLaneState::new(),
                cadence,
            },
        )
    }

    pub(crate) async fn run<C, Cycle>(mut self, mut cycle: C)
    where
        C: FnMut(SyncCyclePlan) -> Cycle,
        Cycle: Future<Output = SyncCycleResult>,
    {
        let mut interval = tokio::time::interval_at(Instant::now() + self.cadence, self.cadence);
        interval.set_missed_tick_behavior(MissedTickBehavior::Skip);
        loop {
            let deadline = self.state.earliest_deadline();
            tokio::select! {
                biased;
                changed = self.cancel.changed() => {
                    if changed.is_err() || *self.cancel.borrow() {
                        return;
                    }
                }
                wake = self.wake.recv() => {
                    if wake.is_none() {
                        return;
                    }
                }
                _ = interval.tick() => {}
                () = wait_for_optional_deadline(deadline) => {}
            }
            if *self.cancel.borrow() {
                return;
            }
            let started_at = Instant::now();
            // Once a cycle has crossed its admission boundary it drains before shutdown. This
            // makes the lane task itself the join fence: no detached blocking Host commit can
            // outlive a completed lane join.
            let result = cycle(self.state.plan(started_at)).await;
            if *self.cancel.borrow() {
                return;
            }
            self.state.apply(result, Instant::now());
        }
    }
}

async fn wait_for_optional_deadline(deadline: Option<Instant>) {
    match deadline {
        Some(deadline) => tokio::time::sleep_until(deadline).await,
        None => std::future::pending().await,
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };

    use tokio::sync::Notify;

    use super::*;

    #[test]
    fn stage_aggregation_uses_fixed_fail_closed_precedence() {
        use SyncStageOutcome::{
            AuthorizationBlocked, NotAttempted, RecoveryRequired, Retryable, SecurityBlocked, Valid,
        };

        assert_eq!(
            SyncStageOutcome::aggregate([AuthorizationBlocked, Valid, Valid]),
            AuthorizationBlocked
        );
        assert_eq!(
            SyncStageOutcome::aggregate([Retryable, Valid, Valid]),
            Retryable
        );
        assert_eq!(
            SyncStageOutcome::aggregate([SecurityBlocked, Valid, RecoveryRequired]),
            RecoveryRequired
        );
        assert_eq!(
            SyncStageOutcome::aggregate([NotAttempted, Valid, NotAttempted]),
            Valid
        );
        assert_eq!(
            SyncStageOutcome::aggregate([NotAttempted, NotAttempted, NotAttempted]),
            NotAttempted
        );
    }

    #[test]
    fn pull_and_checkpoint_backoff_are_independent_and_push_has_no_shadow_counter() {
        let now = Instant::now();
        let durable_push_wake = now + Duration::from_secs(41);
        let mut state = SyncLaneState::new();
        state.apply(
            SyncCycleResult {
                push: SyncStageOutcome::Valid,
                pull: SyncStageOutcome::Retryable,
                checkpoint: SyncStageOutcome::Valid,
                durable_push_wake: Some(durable_push_wake),
            },
            now,
        );
        assert_eq!(state.pull.retry_at(), Some(now + Duration::from_secs(1)));
        assert_eq!(state.checkpoint.retry_at(), None);
        assert_eq!(state.durable_push_wake, Some(durable_push_wake));

        state.apply(
            SyncCycleResult {
                push: SyncStageOutcome::NotAttempted,
                pull: SyncStageOutcome::NotAttempted,
                checkpoint: SyncStageOutcome::Retryable,
                durable_push_wake: None,
            },
            now,
        );
        assert_eq!(state.pull.retry_at(), Some(now + Duration::from_secs(1)));
        assert_eq!(
            state.checkpoint.retry_at(),
            Some(now + Duration::from_secs(1))
        );
        assert_eq!(state.durable_push_wake, None);
    }

    #[test]
    fn wakes_coalesce_at_capacity_one_and_cancellation_is_lane_local() {
        let (handle, mut lane) = SyncLane::with_cadence(PRODUCTION_CADENCE);
        handle.wake();
        handle.wake();
        assert_eq!(lane.wake.try_recv(), Ok(()));
        assert!(matches!(
            lane.wake.try_recv(),
            Err(mpsc::error::TryRecvError::Empty)
        ));
        assert!(!*lane.cancel.borrow());
        handle.cancel();
        assert!(*lane.cancel.borrow_and_update());
    }

    #[tokio::test]
    async fn admitted_cycle_drains_and_join_prevents_later_cycles() {
        let (handle, lane) = SyncLane::with_cadence(Duration::from_hours(1));
        let admitted = Arc::new(Notify::new());
        let release = Arc::new(Notify::new());
        let cycles = Arc::new(AtomicUsize::new(0));
        let cycle_admitted = Arc::clone(&admitted);
        let cycle_release = Arc::clone(&release);
        let cycle_count = Arc::clone(&cycles);
        let task = tokio::spawn(lane.run(move |_| {
            let admitted = Arc::clone(&cycle_admitted);
            let release = Arc::clone(&cycle_release);
            let cycles = Arc::clone(&cycle_count);
            async move {
                cycles.fetch_add(1, Ordering::SeqCst);
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
        handle.wake();
        admitted.notified().await;

        handle.cancel();
        handle.wake();
        release.notify_one();
        task.await.unwrap();

        handle.wake();
        tokio::task::yield_now().await;
        assert_eq!(cycles.load(Ordering::SeqCst), 1);
    }
}
