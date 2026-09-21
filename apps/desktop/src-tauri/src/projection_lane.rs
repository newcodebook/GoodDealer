//! Native-only scheduling core for count-only Cloudflare projection publication.

use std::future::Future;

use tokio::{
    sync::{mpsc, watch},
    time::Instant,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct ProjectionCycleResult {
    /// Exact Host-owned durable retry/lease deadline. The lane owns no retry exponent.
    pub(crate) next_durable_attempt: Option<Instant>,
}

#[derive(Clone)]
pub(crate) struct ProjectionLaneHandle {
    wake: mpsc::Sender<()>,
    cancel: watch::Sender<bool>,
}

impl ProjectionLaneHandle {
    pub(crate) fn wake(&self) {
        let _ = self.wake.try_send(());
    }

    pub(crate) fn cancel(&self) {
        let _ = self.cancel.send(true);
    }
}

pub(crate) struct ProjectionLane {
    wake: mpsc::Receiver<()>,
    cancel: watch::Receiver<bool>,
    next_durable_attempt: Option<Instant>,
}

impl ProjectionLane {
    pub(crate) fn new() -> (ProjectionLaneHandle, Self) {
        let (wake_tx, wake_rx) = mpsc::channel(1);
        let (cancel_tx, cancel_rx) = watch::channel(false);
        (
            ProjectionLaneHandle {
                wake: wake_tx,
                cancel: cancel_tx,
            },
            Self {
                wake: wake_rx,
                cancel: cancel_rx,
                next_durable_attempt: None,
            },
        )
    }

    pub(crate) async fn run<C, Cycle>(mut self, mut cycle: C)
    where
        C: FnMut() -> Cycle,
        Cycle: Future<Output = ProjectionCycleResult>,
    {
        loop {
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
                () = wait_for_optional_deadline(self.next_durable_attempt) => {}
            }
            if *self.cancel.borrow() {
                return;
            }
            // Drain an admitted cycle so joining the lane is a complete side-effect fence.
            let result = cycle().await;
            if *self.cancel.borrow() {
                return;
            }
            self.next_durable_attempt = result.next_durable_attempt;
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
    fn projection_wakes_coalesce_and_carries_only_durable_deadline() {
        let (handle, mut lane) = ProjectionLane::new();
        handle.wake();
        handle.wake();
        assert_eq!(lane.wake.try_recv(), Ok(()));
        assert!(matches!(
            lane.wake.try_recv(),
            Err(mpsc::error::TryRecvError::Empty)
        ));
        let deadline = Instant::now();
        lane.next_durable_attempt = Some(deadline);
        assert_eq!(lane.next_durable_attempt, Some(deadline));
    }

    #[tokio::test]
    async fn admitted_projection_drains_and_join_prevents_later_cycles() {
        let (handle, lane) = ProjectionLane::new();
        let admitted = Arc::new(Notify::new());
        let release = Arc::new(Notify::new());
        let cycles = Arc::new(AtomicUsize::new(0));
        let cycle_admitted = Arc::clone(&admitted);
        let cycle_release = Arc::clone(&release);
        let cycle_count = Arc::clone(&cycles);
        let task = tokio::spawn(lane.run(move || {
            let admitted = Arc::clone(&cycle_admitted);
            let release = Arc::clone(&cycle_release);
            let cycles = Arc::clone(&cycle_count);
            async move {
                cycles.fetch_add(1, Ordering::SeqCst);
                admitted.notify_one();
                release.notified().await;
                ProjectionCycleResult {
                    next_durable_attempt: None,
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
