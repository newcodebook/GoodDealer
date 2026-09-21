//! Native-only user-triggered Cloudflare Provider lane core.

use std::{
    collections::{HashMap, VecDeque},
    future::Future,
    sync::{Arc, Mutex},
    time::Duration,
};

use tokio::{
    sync::{mpsc, watch},
    time::Instant,
};

const ACTIVATION_WINDOW: Duration = Duration::from_mins(1);
const OBSERVATION_WINDOW: Duration = Duration::from_mins(1);
const OBSERVATION_MINIMUM_SPACING: Duration = Duration::from_secs(15);
const OBSERVATION_LIMIT: usize = 4;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum ProviderOperation {
    Activate {
        connection_id: String,
    },
    Observe {
        connection_id: String,
        entity_id: String,
    },
}

impl ProviderOperation {
    fn connection_id(&self) -> &str {
        match self {
            Self::Activate { connection_id } | Self::Observe { connection_id, .. } => connection_id,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ProviderSubmission {
    Accepted,
    Busy,
    RateLimited,
    Unavailable,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ProviderStatus {
    Recovering,
    Ready,
    Busy,
    Blocked,
}

#[derive(Default)]
struct ConnectionRateState {
    last_activation: Option<Instant>,
    observations: VecDeque<Instant>,
}

struct ProviderAdmissionState {
    recovering: bool,
    recovery_generation: Option<u64>,
    in_flight: Option<ProviderOperation>,
    rates: HashMap<String, ConnectionRateState>,
}

impl Default for ProviderAdmissionState {
    fn default() -> Self {
        Self {
            recovering: true,
            recovery_generation: Some(0),
            in_flight: None,
            rates: HashMap::new(),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ProviderAdmission {
    Enqueue,
    Coalesced,
    Busy,
    RateLimited,
}

impl ProviderAdmissionState {
    fn admit(&mut self, operation: &ProviderOperation, now: Instant) -> ProviderAdmission {
        if self.recovering {
            return ProviderAdmission::Busy;
        }
        if let Some(in_flight) = self.in_flight.as_ref() {
            return if matches!(operation, ProviderOperation::Observe { .. })
                && in_flight == operation
            {
                ProviderAdmission::Coalesced
            } else {
                ProviderAdmission::Busy
            };
        }
        let rate = self
            .rates
            .entry(operation.connection_id().to_owned())
            .or_default();
        match operation {
            ProviderOperation::Activate { .. } => {
                if rate
                    .last_activation
                    .is_some_and(|last| now.duration_since(last) < ACTIVATION_WINDOW)
                {
                    return ProviderAdmission::RateLimited;
                }
                rate.last_activation = Some(now);
            }
            ProviderOperation::Observe { .. } => {
                while rate
                    .observations
                    .front()
                    .is_some_and(|accepted| now.duration_since(*accepted) >= OBSERVATION_WINDOW)
                {
                    rate.observations.pop_front();
                }
                if rate.observations.len() >= OBSERVATION_LIMIT
                    || rate
                        .observations
                        .back()
                        .is_some_and(|last| now.duration_since(*last) < OBSERVATION_MINIMUM_SPACING)
                {
                    return ProviderAdmission::RateLimited;
                }
                rate.observations.push_back(now);
            }
        }
        self.in_flight = Some(operation.clone());
        ProviderAdmission::Enqueue
    }

    fn complete(&mut self, operation: &ProviderOperation) {
        if self.in_flight.as_ref() == Some(operation) {
            self.in_flight = None;
        }
    }

    fn begin_recovery(&mut self) {
        self.recovering = true;
        self.recovery_generation = self
            .recovery_generation
            .and_then(|generation| generation.checked_add(1));
    }

    const fn recovery_generation(&self) -> Option<u64> {
        self.recovery_generation
    }

    fn finish_recovery(&mut self, generation: Option<u64>, complete: bool) {
        if complete && generation.is_some() && self.recovery_generation == generation {
            self.recovering = false;
        }
    }
}

#[derive(Clone)]
pub(crate) struct ProviderLaneHandle {
    commands: mpsc::Sender<ProviderOperation>,
    recovery: mpsc::Sender<()>,
    cancel: watch::Sender<bool>,
    admission: Arc<Mutex<ProviderAdmissionState>>,
}

impl ProviderLaneHandle {
    pub(crate) fn status(&self) -> ProviderStatus {
        let Ok(admission) = self.admission.lock() else {
            return ProviderStatus::Blocked;
        };
        if admission.recovery_generation.is_none() {
            ProviderStatus::Blocked
        } else if admission.recovering {
            ProviderStatus::Recovering
        } else if admission.in_flight.is_some() {
            ProviderStatus::Busy
        } else {
            ProviderStatus::Ready
        }
    }
    pub(crate) fn submit(&self, operation: &ProviderOperation) -> ProviderSubmission {
        self.submit_at(operation, Instant::now())
    }

    fn submit_at(&self, operation: &ProviderOperation, now: Instant) -> ProviderSubmission {
        let Ok(mut admission) = self.admission.lock() else {
            return ProviderSubmission::Unavailable;
        };
        match admission.admit(operation, now) {
            ProviderAdmission::Coalesced => return ProviderSubmission::Accepted,
            ProviderAdmission::Busy => return ProviderSubmission::Busy,
            ProviderAdmission::RateLimited => return ProviderSubmission::RateLimited,
            ProviderAdmission::Enqueue => {}
        }
        if self.commands.try_send(operation.clone()).is_err() {
            admission.complete(operation);
            return ProviderSubmission::Unavailable;
        }
        ProviderSubmission::Accepted
    }

    pub(crate) fn cancel(&self) {
        let _ = self.cancel.send(true);
    }

    pub(crate) fn recover(&self) {
        let Ok(mut admission) = self.admission.lock() else {
            return;
        };
        admission.begin_recovery();
        let _ = self.recovery.try_send(());
    }
}

pub(crate) struct ProviderLane {
    commands: mpsc::Receiver<ProviderOperation>,
    recovery: mpsc::Receiver<()>,
    cancel: watch::Receiver<bool>,
    admission: Arc<Mutex<ProviderAdmissionState>>,
}

impl ProviderLane {
    pub(crate) fn new() -> (ProviderLaneHandle, Self) {
        let (command_tx, command_rx) = mpsc::channel(1);
        let (recovery_tx, recovery_rx) = mpsc::channel(1);
        let (cancel_tx, cancel_rx) = watch::channel(false);
        let admission = Arc::new(Mutex::new(ProviderAdmissionState::default()));
        (
            ProviderLaneHandle {
                commands: command_tx,
                recovery: recovery_tx,
                cancel: cancel_tx,
                admission: Arc::clone(&admission),
            },
            Self {
                commands: command_rx,
                recovery: recovery_rx,
                cancel: cancel_rx,
                admission,
            },
        )
    }

    pub(crate) async fn run<R, Recover, E, Execute>(mut self, mut recover: R, mut execute: E)
    where
        R: FnMut() -> Recover,
        Recover: Future<Output = bool>,
        E: FnMut(ProviderOperation) -> Execute,
        Execute: Future<Output = ()>,
    {
        loop {
            enum Work {
                Recover,
                Operation(ProviderOperation),
            }
            let work = tokio::select! {
                biased;
                changed = self.cancel.changed() => {
                    if changed.is_err() || *self.cancel.borrow() {
                        return;
                    }
                    continue;
                }
                recovery = self.recovery.recv() => {
                    if recovery.is_none() {
                        return;
                    }
                    Work::Recover
                }
                operation = self.commands.recv() => {
                    let Some(operation) = operation else {
                        return;
                    };
                    Work::Operation(operation)
                }
            };
            match work {
                Work::Recover => {
                    let generation = self.recovery_generation();
                    let complete = recover().await;
                    self.finish_recovery(generation, complete);
                }
                Work::Operation(operation) => {
                    // Provider custody work may own a child process or Keychain CAS. Drain the
                    // admitted operation before join so no effect can escape the lane lifetime.
                    execute(operation.clone()).await;
                    self.complete(&operation);
                }
            }
            if *self.cancel.borrow() {
                return;
            }
        }
    }

    fn recovery_generation(&self) -> Option<u64> {
        self.admission
            .lock()
            .ok()
            .and_then(|admission| admission.recovery_generation())
    }

    fn finish_recovery(&self, generation: Option<u64>, complete: bool) {
        if let Ok(mut admission) = self.admission.lock() {
            admission.finish_recovery(generation, complete);
        }
    }

    fn complete(&self, operation: &ProviderOperation) {
        if let Ok(mut admission) = self.admission.lock() {
            admission.complete(operation);
        }
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

    fn observe(connection: &str, entity: &str) -> ProviderOperation {
        ProviderOperation::Observe {
            connection_id: connection.to_owned(),
            entity_id: entity.to_owned(),
        }
    }

    #[test]
    fn provider_stays_busy_until_recovery_completes() {
        let (handle, lane) = ProviderLane::new();
        let operation = observe("connection-a", "example.com");

        assert_eq!(handle.submit(&operation), ProviderSubmission::Busy);
        lane.finish_recovery(Some(0), false);
        assert_eq!(handle.submit(&operation), ProviderSubmission::Busy);
        lane.finish_recovery(Some(0), true);
        assert_eq!(handle.submit(&operation), ProviderSubmission::Accepted);
    }

    #[test]
    fn recovery_generation_prevents_a_concurrent_wake_from_clearing_the_gate() {
        let (handle, lane) = ProviderLane::new();
        let operation = observe("connection-a", "example.com");

        handle.recover();
        let first = lane.recovery_generation().unwrap();
        handle.recover();
        let second = lane.recovery_generation().unwrap();
        assert!(second > first);

        lane.finish_recovery(Some(first), true);
        assert_eq!(handle.submit(&operation), ProviderSubmission::Busy);
        lane.finish_recovery(Some(second), true);
        assert_eq!(handle.submit(&operation), ProviderSubmission::Accepted);
    }

    #[tokio::test]
    async fn failed_recovery_keeps_every_provider_operation_denied_until_a_fresh_scan_succeeds() {
        let (handle, lane) = ProviderLane::new();
        let attempts = Arc::new(AtomicUsize::new(0));
        let completed = Arc::new(Notify::new());
        let recovery_attempts = Arc::clone(&attempts);
        let recovery_completed = Arc::clone(&completed);
        handle.recover();
        let task = tokio::spawn(lane.run(
            move || {
                let attempt = recovery_attempts.fetch_add(1, Ordering::SeqCst);
                let completed = Arc::clone(&recovery_completed);
                async move {
                    completed.notify_one();
                    attempt > 0
                }
            },
            |_| async {},
        ));

        completed.notified().await;
        tokio::task::yield_now().await;
        let operation = observe("connection-a", "example.com");
        assert_eq!(handle.submit(&operation), ProviderSubmission::Busy);

        handle.recover();
        completed.notified().await;
        tokio::task::yield_now().await;
        assert_eq!(handle.submit(&operation), ProviderSubmission::Accepted);

        handle.cancel();
        task.await.unwrap();
    }

    #[test]
    fn provider_is_process_serial_identical_observation_coalesces_and_activation_never_does() {
        let (handle, mut lane) = ProviderLane::new();
        lane.finish_recovery(Some(0), true);
        let now = Instant::now();
        assert_eq!(
            handle.submit_at(&observe("connection-a", "example.com"), now),
            ProviderSubmission::Accepted
        );
        assert_eq!(
            handle.submit_at(&observe("connection-a", "example.com"), now),
            ProviderSubmission::Accepted
        );
        assert_eq!(
            handle.submit_at(&observe("connection-a", "other.example"), now),
            ProviderSubmission::Busy
        );
        let operation = lane.commands.try_recv().unwrap();
        lane.complete(&operation);
        let activation = ProviderOperation::Activate {
            connection_id: "connection-b".to_owned(),
        };
        assert_eq!(
            handle.submit_at(&activation, now),
            ProviderSubmission::Accepted
        );
        assert_eq!(handle.submit_at(&activation, now), ProviderSubmission::Busy);
    }

    #[test]
    fn provider_rate_windows_are_per_connection_and_have_no_timer_retry() {
        let (handle, mut lane) = ProviderLane::new();
        lane.finish_recovery(Some(0), true);
        let now = Instant::now();
        for step in 0..OBSERVATION_LIMIT {
            let accepted_at = now + OBSERVATION_MINIMUM_SPACING * u32::try_from(step).unwrap();
            let operation = observe("connection-a", "example.com");
            assert_eq!(
                handle.submit_at(&operation, accepted_at),
                ProviderSubmission::Accepted
            );
            assert_eq!(lane.commands.try_recv(), Ok(operation.clone()));
            lane.complete(&operation);
        }
        assert_eq!(
            handle.submit_at(
                &observe("connection-a", "example.com"),
                now + Duration::from_secs(59)
            ),
            ProviderSubmission::RateLimited
        );
        assert_eq!(
            handle.submit_at(&observe("connection-b", "example.com"), now),
            ProviderSubmission::Accepted
        );
    }

    #[tokio::test]
    async fn admitted_operation_drains_and_join_prevents_later_operations() {
        let (handle, lane) = ProviderLane::new();
        let admitted = Arc::new(Notify::new());
        let release = Arc::new(Notify::new());
        let operations = Arc::new(AtomicUsize::new(0));
        let recovered = Arc::new(Notify::new());
        let recovery_completed = Arc::clone(&recovered);
        let operation_admitted = Arc::clone(&admitted);
        let operation_release = Arc::clone(&release);
        let operation_count = Arc::clone(&operations);
        handle.recover();
        let task = tokio::spawn(lane.run(
            move || {
                let recovered = Arc::clone(&recovery_completed);
                async move {
                    recovered.notify_one();
                    true
                }
            },
            move |_| {
                let admitted = Arc::clone(&operation_admitted);
                let release = Arc::clone(&operation_release);
                let operations = Arc::clone(&operation_count);
                async move {
                    operations.fetch_add(1, Ordering::SeqCst);
                    admitted.notify_one();
                    release.notified().await;
                }
            },
        ));
        recovered.notified().await;
        assert_eq!(
            handle.submit(&observe("connection-a", "example.com")),
            ProviderSubmission::Accepted
        );
        admitted.notified().await;

        handle.cancel();
        release.notify_one();
        task.await.unwrap();

        assert_eq!(
            handle.submit(&observe("connection-b", "other.example")),
            ProviderSubmission::Unavailable
        );
        assert_eq!(operations.load(Ordering::SeqCst), 1);
    }
}
