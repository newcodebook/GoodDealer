//! Closed OS power notifications. No credentials, business operations or OS handles cross this facade.
#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
mod windows;

use std::{
    marker::PhantomData,
    rc::Rc,
    sync::{
        Arc, Mutex, MutexGuard,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
};
use tokio::sync::Notify;

const INITIAL_REQUEST: u64 = 3; // Epoch 1, initially paused until registration succeeds.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct NativePowerSnapshot {
    pub ready: bool,
    pub paused: bool,
    pub epoch: u64,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct NativePowerUnavailable;
impl std::fmt::Display for NativePowerUnavailable {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("NATIVE_POWER_UNAVAILABLE")
    }
}
impl std::error::Error for NativePowerUnavailable {}

struct State {
    /// Event intent changes before callbacks wait for an already-admitted final commit.
    requested: AtomicU64,
    ready: AtomicBool,
    closed: AtomicBool,
    commit: Mutex<()>,
    changed: Notify,
}
impl State {
    fn new() -> Arc<Self> {
        Arc::new(Self {
            requested: AtomicU64::new(INITIAL_REQUEST),
            ready: AtomicBool::new(false),
            closed: AtomicBool::new(false),
            commit: Mutex::new(()),
            changed: Notify::new(),
        })
    }
    fn snapshot(&self) -> NativePowerSnapshot {
        let requested = self.requested.load(Ordering::SeqCst);
        let closed = self.closed.load(Ordering::SeqCst);
        NativePowerSnapshot {
            ready: !closed && self.ready.load(Ordering::SeqCst),
            paused: closed || requested & 1 != 0,
            epoch: requested >> 1,
        }
    }
    fn request(&self, paused: Option<bool>) {
        if self
            .requested
            .try_update(Ordering::SeqCst, Ordering::SeqCst, |old| {
                let epoch = (old >> 1).checked_add(1)?;
                if epoch >= u64::MAX >> 1 {
                    return None;
                }
                Some((epoch << 1) | u64::from(paused.unwrap_or(old & 1 != 0)))
            })
            .is_err()
        {
            self.closed.store(true, Ordering::SeqCst);
            self.ready.store(false, Ordering::SeqCst);
            // Reserve the final epoch for terminal closure, so overflow still invalidates
            // every epoch that could previously have admitted a request.
            self.requested.store(u64::MAX, Ordering::SeqCst);
        }
        self.changed.notify_waiters();
    }
    #[cfg(any(target_os = "linux", target_os = "windows", target_os = "macos", test))]
    fn registered(&self) {
        let Ok(_commit) = self.commit.lock() else {
            self.close();
            return;
        };
        if self.closed.load(Ordering::SeqCst) {
            return;
        }
        self.ready.store(true, Ordering::SeqCst);
        // Preserve a suspend event that raced OS registration. Only the untouched initial
        // request can become unpaused; CAS retries never overwrite a newer event.
        if self
            .requested
            .compare_exchange(INITIAL_REQUEST, 4, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            self.request(None);
        } else {
            self.changed.notify_waiters();
        }
    }
    fn registration_failed(&self) {
        self.ready.store(false, Ordering::SeqCst);
        self.request(Some(true));
    }
    #[cfg(any(target_os = "linux", target_os = "windows", target_os = "macos", test))]
    fn event(&self, paused: bool) {
        if self.closed.load(Ordering::SeqCst) {
            return;
        }
        self.request(Some(paused));
        // Intent above invalidates HTTP guards immediately. Callback completion is ordered
        // after an existing short final transaction, without ever entering the Host.
        if self.commit.lock().is_err() {
            self.close();
        }
    }
    fn close(&self) {
        self.closed.store(true, Ordering::SeqCst);
        self.ready.store(false, Ordering::SeqCst);
        self.request(Some(true));
    }
}

/// Main-thread owner. Its private native tokens must outlive all associated callbacks.
pub struct NativePowerMonitor {
    state: Arc<State>,
    #[cfg(target_os = "linux")]
    registration: Option<linux::Registration>,
    #[cfg(target_os = "macos")]
    registration: Option<macos::Registration>,
    #[cfg(target_os = "windows")]
    registration: Option<windows::Registration>,
    _main_thread: PhantomData<Rc<()>>,
}
impl NativePowerMonitor {
    /// Registers fixed OS events. Failure leaves writes unavailable while permitting existing
    /// dispatched work's read-only reconciliation under current Host authority.
    #[must_use]
    pub fn start() -> Self {
        let state = State::new();
        #[cfg(target_os = "linux")]
        let registration = linux::Registration::start(Arc::clone(&state));
        #[cfg(target_os = "linux")]
        if registration.is_none() {
            state.registration_failed();
        }
        #[cfg(target_os = "macos")]
        let registration = macos::Registration::start(Arc::clone(&state));
        #[cfg(target_os = "windows")]
        let registration = windows::Registration::start(Arc::clone(&state));
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        if registration.is_some() {
            state.registered();
        } else {
            state.registration_failed();
        }
        #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
        state.registration_failed();
        Self {
            state,
            #[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
            registration,
            _main_thread: PhantomData,
        }
    }
    /// Closes admission before unregistering observers; call on the owning main thread at exit.
    pub fn stop(&mut self) {
        self.state.close();
        #[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
        drop(self.registration.take());
    }
    #[must_use]
    pub fn gate(&self) -> NativePowerGate {
        NativePowerGate {
            state: Arc::clone(&self.state),
        }
    }
}
impl Drop for NativePowerMonitor {
    fn drop(&mut self) {
        self.stop();
    }
}

#[derive(Clone)]
pub struct NativePowerGate {
    state: Arc<State>,
}
/// Lock order: power, Native cancellation, Host publication/runtime, SQLite. No await/custody/HTTP
/// may occur while held; a Host closure must never re-enter this gate's commit methods.
pub struct NativePowerCommitGuard<'a> {
    _commit: MutexGuard<'a, ()>,
}
impl NativePowerGate {
    #[must_use]
    pub fn snapshot(&self) -> NativePowerSnapshot {
        self.state.snapshot()
    }
    pub async fn wait_for_epoch_change(&self, epoch: u64) -> NativePowerSnapshot {
        loop {
            let notified = self.state.changed.notified();
            tokio::pin!(notified);
            // Register before reading atomics so an event cannot fall between check and wait.
            notified.as_mut().enable();
            let snapshot = self.snapshot();
            if snapshot.epoch != epoch {
                return snapshot;
            }
            notified.await;
        }
    }
    /// # Errors
    /// Refuses stale epoch, suspension, shutdown or unavailable monitoring.
    pub fn hold_write_epoch(
        &self,
        epoch: u64,
    ) -> Result<NativePowerCommitGuard<'_>, NativePowerUnavailable> {
        self.hold_epoch(epoch, true)
    }
    /// # Errors
    /// Refuses stale epoch, known suspension, shutdown or poisoned commit fencing.
    pub fn hold_reconciliation_epoch(
        &self,
        epoch: u64,
    ) -> Result<NativePowerCommitGuard<'_>, NativePowerUnavailable> {
        self.hold_epoch(epoch, false)
    }
    fn hold_epoch(
        &self,
        epoch: u64,
        write: bool,
    ) -> Result<NativePowerCommitGuard<'_>, NativePowerUnavailable> {
        let commit = self
            .state
            .commit
            .lock()
            .map_err(|_| NativePowerUnavailable)?;
        let current = self.snapshot();
        if self.state.closed.load(Ordering::SeqCst)
            || current.epoch != epoch
            || (current.ready && current.paused)
            || (write && !current.ready)
        {
            return Err(NativePowerUnavailable);
        }
        Ok(NativePowerCommitGuard { _commit: commit })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn gate(state: &Arc<State>) -> NativePowerGate {
        NativePowerGate {
            state: Arc::clone(state),
        }
    }
    #[test]
    fn unavailable_monitor_allows_only_reconciliation_and_closed_allows_neither() {
        let state = State::new();
        state.registration_failed();
        let gate = gate(&state);
        let epoch = gate.snapshot().epoch;
        assert!(gate.hold_write_epoch(epoch).is_err());
        assert!(gate.hold_reconciliation_epoch(epoch).is_ok());
        state.close();
        state.event(false);
        assert!(
            gate.hold_reconciliation_epoch(gate.snapshot().epoch)
                .is_err()
        );
        assert!(!gate.snapshot().ready);
    }
    #[test]
    fn suspend_during_registration_is_not_cleared_and_epochs_never_reauthorize_old_work() {
        let state = State::new();
        state.event(true);
        state.registered();
        let gate = gate(&state);
        assert!(gate.snapshot().ready && gate.snapshot().paused);
        let epoch = gate.snapshot().epoch;
        state.event(false);
        assert!(gate.hold_write_epoch(epoch).is_err());
        assert!(gate.hold_write_epoch(gate.snapshot().epoch).is_ok());
        state.requested.store(u64::MAX, Ordering::SeqCst);
        state.event(false);
        assert!(!gate.snapshot().ready);
        assert!(
            gate.hold_reconciliation_epoch(gate.snapshot().epoch)
                .is_err()
        );
    }
    #[tokio::test]
    async fn closed_notification_invalidates_once_without_a_ready_loop() {
        let state = State::new();
        state.registered();
        let gate = gate(&state);
        let previous = gate.snapshot().epoch;
        state.close();
        let closed = gate.wait_for_epoch_change(previous).await;
        assert!(!closed.ready && closed.paused);
        assert!(
            tokio::time::timeout(
                std::time::Duration::from_millis(20),
                gate.wait_for_epoch_change(closed.epoch)
            )
            .await
            .is_err()
        );
    }

    #[tokio::test]
    async fn suspend_intent_invalidates_sends_before_waiting_for_a_final_commit() {
        let state = State::new();
        state.registered();
        let gate = gate(&state);
        let epoch = gate.snapshot().epoch;
        let commit = gate.hold_write_epoch(epoch).unwrap();
        let callback_state = Arc::clone(&state);
        let callback = std::thread::spawn(move || callback_state.event(true));
        let changed = tokio::time::timeout(
            std::time::Duration::from_secs(2),
            gate.wait_for_epoch_change(epoch),
        )
        .await
        .unwrap();
        assert!(changed.paused);
        assert_ne!(changed.epoch, epoch);
        assert!(!callback.is_finished());
        // A wake can publish before the sleep callback obtains the commit mutex. Neither
        // callback may restore the old permission or overwrite a newer request word.
        let wake_state = Arc::clone(&state);
        let wake = std::thread::spawn(move || wake_state.event(false));
        let resumed = tokio::time::timeout(
            std::time::Duration::from_secs(2),
            gate.wait_for_epoch_change(changed.epoch),
        )
        .await
        .unwrap();
        assert!(!resumed.paused);
        drop(commit);
        callback.join().unwrap();
        wake.join().unwrap();
        assert_eq!(gate.snapshot(), resumed);
        assert!(gate.hold_write_epoch(epoch).is_err());
        assert!(gate.hold_write_epoch(resumed.epoch).is_ok());
    }
}
