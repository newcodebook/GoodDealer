//! Fixed logind notifications on a dedicated native main context, independent of GTK rendering.
//! Holding the returned `UnixFDList` keeps the delay inhibitor alive without exposing raw handles.
use super::State;
use gio::{glib, prelude::*};
use std::{cell::RefCell, rc::Rc, sync::Arc, thread::JoinHandle, time::Duration};

const SERVICE: &str = "org.freedesktop.login1";
const PATH: &str = "/org/freedesktop/login1";
const MANAGER: &str = "org.freedesktop.login1.Manager";
const TIMEOUT_MS: i32 = 3_000;

pub(super) struct Registration {
    cancel: gio::Cancellable,
    worker: Option<JoinHandle<()>>,
}
impl Registration {
    pub(super) fn start(state: Arc<State>) -> Option<Self> {
        let cancel = gio::Cancellable::new();
        let worker_cancel = cancel.clone();
        let worker = std::thread::Builder::new()
            .name("gooddealer-logind".to_owned())
            .spawn(move || {
                let context = glib::MainContext::new();
                let result = context.with_thread_default(|| run(&context, &state, &worker_cancel));
                if !matches!(result, Ok(Some(()))) {
                    state.registration_failed();
                }
            })
            .ok()?;
        Some(Self {
            cancel,
            worker: Some(worker),
        })
    }
}
impl Drop for Registration {
    fn drop(&mut self) {
        self.cancel.cancel();
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

fn call(
    connection: &gio::DBusConnection,
    destination: &str,
    path: &str,
    interface: &str,
    method: &str,
    parameters: &glib::Variant,
    cancel: &gio::Cancellable,
) -> Option<glib::Variant> {
    connection
        .call_sync(
            Some(destination),
            path,
            interface,
            method,
            Some(parameters),
            None,
            gio::DBusCallFlags::NO_AUTO_START,
            TIMEOUT_MS,
            Some(cancel),
        )
        .ok()
}

fn owner(connection: &gio::DBusConnection, cancel: &gio::Cancellable) -> Option<String> {
    let reply = call(
        connection,
        "org.freedesktop.DBus",
        "/org/freedesktop/DBus",
        "org.freedesktop.DBus",
        "GetNameOwner",
        &(SERVICE,).to_variant(),
        cancel,
    )?;
    let (owner,) = exact::<(String,)>(&reply)?;
    (owner.starts_with(':') && owner.len() <= 255).then_some(owner)
}

fn inhibitor(
    connection: &gio::DBusConnection,
    owner: &str,
    cancel: &gio::Cancellable,
) -> Option<gio::UnixFDList> {
    let (reply, handles) = connection
        .call_with_unix_fd_list_sync(
            Some(owner),
            PATH,
            MANAGER,
            "Inhibit",
            Some(
                &(
                    "sleep",
                    "GoodDealer",
                    "Pause local provider work before sleep",
                    "delay",
                )
                    .to_variant(),
            ),
            None,
            gio::DBusCallFlags::NO_AUTO_START,
            TIMEOUT_MS,
            gio::UnixFDList::NONE,
            Some(cancel),
        )
        .ok()?;
    let (index,) = exact::<(glib::variant::Handle,)>(&reply)?;
    // Only the documented single inhibitor handle is admitted. Retaining this owning object
    // retains the descriptor; dropping it releases the inhibitor after commit drainage.
    (index.0 == 0 && handles.length() == 1).then_some(handles)
}

fn preparing(
    connection: &gio::DBusConnection,
    owner: &str,
    cancel: &gio::Cancellable,
) -> Option<bool> {
    let reply = call(
        connection,
        owner,
        PATH,
        "org.freedesktop.DBus.Properties",
        "Get",
        &(MANAGER, "PreparingForSleep").to_variant(),
        cancel,
    )?;
    let (value,) = exact::<(glib::Variant,)>(&reply)?;
    exact::<bool>(&value)
}

// GLib tuple extraction alone accepts trailing members; require the exact wire signature.
fn exact<T: glib::variant::FromVariant>(value: &glib::Variant) -> Option<T> {
    value.is::<T>().then(|| value.get::<T>()).flatten()
}

fn sleep_signal(parameters: &glib::Variant) -> Option<bool> {
    exact::<(bool,)>(parameters).map(|(paused,)| paused)
}
fn unchanged_owner(parameters: &glib::Variant, expected: &str) -> bool {
    exact::<(String, String, String)>(parameters)
        .is_some_and(|(name, old, new)| name == SERVICE && old == expected && new == expected)
}

struct SleepAdmission {
    state: Arc<State>,
    inhibitor: Option<gio::UnixFDList>,
}
impl SleepAdmission {
    fn event(&mut self, paused: bool, acquire: impl FnOnce() -> Option<gio::UnixFDList>) -> bool {
        if paused {
            // Intent invalidates HTTP/commit guards before waiting on a final transaction.
            // Only then may logind proceed past our delay inhibitor.
            self.state.event(true);
            self.inhibitor.take();
            true
        } else {
            let Some(inhibitor) = acquire() else {
                self.state.close();
                return false;
            };
            self.inhibitor = Some(inhibitor);
            self.state.event(false);
            true
        }
    }
}

fn run(context: &glib::MainContext, state: &Arc<State>, cancel: &gio::Cancellable) -> Option<()> {
    let connection = gio::bus_get_sync(gio::BusType::System, Some(cancel)).ok()?;
    connection.set_exit_on_close(false);
    let owner = owner(&connection, cancel)?;
    let event_loop = glib::MainLoop::new(Some(context), false);
    let admission = Rc::new(RefCell::new(SleepAdmission {
        state: Arc::clone(state),
        inhibitor: None,
    }));
    let closed_state = Arc::clone(state);
    let closed_loop = event_loop.clone();
    let closed = connection.connect_closed(move |_, _, _| {
        closed_state.close();
        closed_loop.quit();
    });
    let watched_state = Arc::clone(state);
    let watched_loop = event_loop.clone();
    let expected = owner.clone();
    let owner_watch = connection.signal_subscribe(
        Some("org.freedesktop.DBus"),
        Some("org.freedesktop.DBus"),
        Some("NameOwnerChanged"),
        Some("/org/freedesktop/DBus"),
        Some(SERVICE),
        gio::DBusSignalFlags::NONE,
        move |_, _, _, _, _, parameters| {
            if !unchanged_owner(parameters, &expected) {
                watched_state.close();
                watched_loop.quit();
            }
        },
    );
    let sleeping = Rc::clone(&admission);
    let signal_loop = event_loop.clone();
    let signal_cancel = cancel.clone();
    let expected = owner.clone();
    let sleep_watch = connection.signal_subscribe(
        Some(&owner),
        Some(MANAGER),
        Some("PrepareForSleep"),
        Some(PATH),
        None,
        gio::DBusSignalFlags::NONE,
        move |connection, sender, _, _, _, parameters| {
            let mut admission = sleeping.borrow_mut();
            let Some(paused) = sleep_signal(parameters).filter(|_| sender == expected) else {
                admission.state.close();
                signal_loop.quit();
                return;
            };
            if !admission.event(paused, || inhibitor(connection, &expected, &signal_cancel)) {
                signal_loop.quit();
            }
        },
    );
    let initialized = (|| {
        let held = inhibitor(&connection, &owner, cancel)?;
        let paused = preparing(&connection, &owner, cancel)?;
        // Recheck ownership after subscription and initial reads; replacement never inherits
        // the old service's registration. A queued sleep event is protected by the inhibitor.
        if self::owner(&connection, cancel)? != owner
            || connection.is_closed()
            || cancel.is_cancelled()
        {
            return None;
        }
        admission.borrow_mut().inhibitor = Some(held);
        if paused {
            admission.borrow_mut().event(true, || None);
        }
        state.registered();
        Some(())
    })();
    if initialized.is_some() {
        let stop_loop = event_loop.clone();
        let stop_cancel = cancel.clone();
        let stop_state = Arc::clone(state);
        let stop = glib::timeout_source_new(
            Duration::from_millis(50),
            None,
            glib::Priority::DEFAULT,
            move || {
                if stop_cancel.is_cancelled()
                    || stop_state.closed.load(std::sync::atomic::Ordering::SeqCst)
                {
                    stop_loop.quit();
                    glib::ControlFlow::Break
                } else {
                    glib::ControlFlow::Continue
                }
            },
        );
        stop.attach(Some(context));
        event_loop.run();
        stop.destroy();
    }
    state.registration_failed();
    connection.signal_unsubscribe(sleep_watch);
    connection.signal_unsubscribe(owner_watch);
    connection.disconnect(closed);
    admission.borrow_mut().inhibitor.take();
    initialized
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn signal_and_owner_boundaries_reject_wrong_wire_shapes() {
        assert_eq!(sleep_signal(&(true,).to_variant()), Some(true));
        assert_eq!(sleep_signal(&(false,).to_variant()), Some(false));
        assert_eq!(sleep_signal(&true.to_variant()), None);
        assert_eq!(sleep_signal(&(1_u8,).to_variant()), None);
        assert_eq!(sleep_signal(&(true, false).to_variant()), None);
        assert!(!unchanged_owner(
            &(SERVICE, ":1.42", ":1.43").to_variant(),
            ":1.42"
        ));
        assert!(!unchanged_owner(
            &(SERVICE, ":1.42", "").to_variant(),
            ":1.42"
        ));
        assert!(!unchanged_owner(
            &("other", ":1.42", ":1.42").to_variant(),
            ":1.42"
        ));
    }
    #[test]
    fn sleep_invalidates_epoch_and_failed_resume_never_reopens_admission() {
        let state = State::new();
        state.registered();
        let epoch = state.snapshot().epoch;
        let mut admission = SleepAdmission {
            state: Arc::clone(&state),
            inhibitor: None,
        };
        assert!(admission.event(true, || panic!("sleep cannot acquire")));
        assert!(state.snapshot().paused && state.snapshot().epoch > epoch);
        assert!(!admission.event(false, || None));
        assert!(!state.snapshot().ready && state.snapshot().paused);
        state.registered();
        assert!(!state.snapshot().ready);
    }
    #[test]
    #[ignore = "requires actual system logind and permission for a sleep delay inhibitor"]
    fn actual_logind_registration_and_shutdown() {
        let state = State::new();
        let registration = Registration::start(Arc::clone(&state)).expect("native logind worker");
        let started = std::time::Instant::now();
        while !state.snapshot().ready && started.elapsed() < Duration::from_secs(5) {
            std::thread::sleep(Duration::from_millis(10));
        }
        assert!(state.snapshot().ready, "logind registration unavailable");
        state.close();
        drop(registration);
        assert!(!state.snapshot().ready && state.snapshot().paused);
    }
}
