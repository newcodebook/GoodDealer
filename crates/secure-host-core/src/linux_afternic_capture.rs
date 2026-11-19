//! Fixed Afternic capture on the already running desktop GTK main loop. No subprocess,
//! Renderer, or caller-selected secret purpose participates in this boundary.
use crate::afternic_provider::{AfternicError, AfternicGuard};
use gtk::{glib, prelude::*};
use std::{
    cell::Cell,
    rc::Rc,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Receiver, RecvTimeoutError, SyncSender},
    },
    time::{Duration, Instant},
};
use zeroize::Zeroizing;

const POLL: Duration = Duration::from_millis(50);
const START_TIMEOUT: Duration = Duration::from_secs(3);
const INPUT_TIMEOUT: Duration = Duration::from_secs(120);

enum Event {
    Opened,
    Completed(Result<Zeroizing<Vec<u8>>, AfternicError>),
}

struct Cancellation(Arc<AtomicBool>);
impl Drop for Cancellation {
    fn drop(&mut self) {
        // Invalidates any late callback before the waiting worker returns. GTK widgets are
        // cleared/closed on the next main-loop pass, never accessed from this worker.
        self.0.store(true, Ordering::SeqCst);
    }
}

pub(super) fn capture(guard: &mut AfternicGuard<'_>) -> Result<Zeroizing<Vec<u8>>, AfternicError> {
    guard()?;
    if !gtk::is_initialized() || gtk::is_initialized_main_thread() {
        return Err(AfternicError::CustodyUnavailable);
    }
    let cancelled = Cancellation(Arc::new(AtomicBool::new(false)));
    let pending = Arc::clone(&cancelled.0);
    let (sender, receiver) = mpsc::sync_channel(2);
    // Unlike MainContext::invoke, idle_add_once cannot run GUI work inline on a worker
    // when the context temporarily has no owner. Still verify the servicing thread.
    glib::idle_add_once(move || {
        if pending.load(Ordering::SeqCst) {
            return;
        }
        if !gtk::is_initialized_main_thread() {
            let _ = sender.try_send(Event::Completed(Err(AfternicError::CustodyUnavailable)));
            return;
        }
        open_capture(sender, pending);
    });
    wait_for_capture(&receiver, guard, START_TIMEOUT, INPUT_TIMEOUT)
}

fn wait_for_capture(
    receiver: &Receiver<Event>,
    guard: &mut AfternicGuard<'_>,
    startup: Duration,
    input: Duration,
) -> Result<Zeroizing<Vec<u8>>, AfternicError> {
    let mut deadline = Instant::now() + startup;
    let mut opened = false;
    loop {
        guard()?;
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err(if opened {
                AfternicError::CaptureCancelled
            } else {
                AfternicError::CustodyUnavailable
            });
        }
        match receiver.recv_timeout(POLL.min(remaining)) {
            Ok(Event::Opened) if !opened => {
                opened = true;
                deadline = Instant::now() + input;
            }
            Ok(Event::Completed(result)) => {
                guard()?;
                return result;
            }
            Ok(Event::Opened) | Err(RecvTimeoutError::Disconnected) => {
                return Err(AfternicError::CustodyUnavailable);
            }
            Err(RecvTimeoutError::Timeout) => {}
        }
    }
}

struct Form {
    key: gtk::Entry,
    secret: gtk::Entry,
    sender: SyncSender<Event>,
    cancelled: Arc<AtomicBool>,
    completed: Cell<bool>,
}
impl Form {
    fn finish(&self, result: Result<Zeroizing<Vec<u8>>, AfternicError>) {
        self.key.set_text("");
        self.secret.set_text("");
        if !self.completed.replace(true) {
            let result = if self.cancelled.load(Ordering::SeqCst) {
                Err(AfternicError::CaptureCancelled)
            } else {
                result
            };
            let _ = self.sender.try_send(Event::Completed(result));
        }
    }
}

fn masked_entry() -> gtk::Entry {
    let entry = gtk::Entry::new();
    entry.set_visibility(false);
    entry.set_max_length(512);
    entry.set_input_purpose(gtk::InputPurpose::Password);
    entry.set_input_hints(gtk::InputHints::NO_SPELLCHECK);
    entry
}

fn open_capture(sender: SyncSender<Event>, cancelled: Arc<AtomicBool>) {
    let window = gtk::Window::new(gtk::WindowType::Toplevel);
    window.set_title("GoodDealer — Connect Afternic");
    window.set_modal(true);
    window.set_resizable(false);
    window.set_position(gtk::WindowPosition::Center);
    window.set_border_width(20);
    let form = Rc::new(Form {
        key: masked_entry(),
        secret: masked_entry(),
        sender,
        cancelled,
        completed: Cell::new(false),
    });
    let grid = gtk::Grid::new();
    grid.set_row_spacing(12);
    grid.set_column_spacing(12);
    let key_label = gtk::Label::new(Some("Afternic API _key"));
    key_label.set_use_underline(true);
    key_label.set_mnemonic_widget(Some(&form.key));
    let secret_label = gtk::Label::new(Some("Afternic API _secret"));
    secret_label.set_use_underline(true);
    secret_label.set_mnemonic_widget(Some(&form.secret));
    grid.attach(&key_label, 0, 0, 1, 1);
    grid.attach(&form.key, 1, 0, 1, 1);
    grid.attach(&secret_label, 0, 1, 1, 1);
    grid.attach(&form.secret, 1, 1, 1, 1);
    let cancel = gtk::Button::with_label("Cancel");
    let connect = gtk::Button::with_label("Connect Afternic");
    grid.attach(&cancel, 0, 2, 1, 1);
    grid.attach(&connect, 1, 2, 1, 1);
    window.add(&grid);
    let weak = window.downgrade();
    let submitted = Rc::clone(&form);
    connect.connect_clicked(move |_| {
        if submitted.completed.get() {
            return;
        }
        // Use the full string slice: glib 0.18 GString::into_bytes truncates the last
        // byte of foreign storage. Credential bytes must be preserved exactly.
        let mut bytes = Zeroizing::new(submitted.key.text().as_bytes().to_vec());
        let secret = Zeroizing::new(submitted.secret.text().as_bytes().to_vec());
        bytes.push(b'\n');
        bytes.extend_from_slice(&secret);
        submitted.finish(Ok(bytes));
        if let Some(window) = weak.upgrade() {
            window.close();
        }
    });
    let weak = window.downgrade();
    let dismissed = Rc::clone(&form);
    cancel.connect_clicked(move |_| {
        dismissed.finish(Err(AfternicError::CaptureCancelled));
        if let Some(window) = weak.upgrade() {
            window.close();
        }
    });
    let dismissed = Rc::clone(&form);
    window.connect_delete_event(move |_, _| {
        dismissed.finish(Err(AfternicError::CaptureCancelled));
        glib::Propagation::Proceed
    });
    let dismissed = Rc::clone(&form);
    window.connect_destroy(move |_| {
        dismissed.finish(Err(AfternicError::CaptureCancelled));
    });
    let weak = window.downgrade();
    let opened = Instant::now();
    let watched = Rc::clone(&form);
    glib::timeout_add_local(POLL, move || {
        let Some(window) = weak.upgrade() else {
            return glib::ControlFlow::Break;
        };
        if watched.completed.get() {
            return glib::ControlFlow::Break;
        }
        if watched.cancelled.load(Ordering::SeqCst) || opened.elapsed() >= INPUT_TIMEOUT {
            watched.finish(Err(AfternicError::CaptureCancelled));
            window.close();
            return glib::ControlFlow::Break;
        }
        glib::ControlFlow::Continue
    });
    if form.cancelled.load(Ordering::SeqCst) || form.sender.try_send(Event::Opened).is_err() {
        form.finish(Err(AfternicError::CaptureCancelled));
        window.close();
        return;
    }
    window.show_all();
    form.key.grab_focus();
}

#[cfg(test)]
mod tests {
    use super::*;
    const SHORT: Duration = Duration::from_millis(1);

    #[test]
    fn missing_main_loop_and_abandoned_capture_return_boundedly() {
        let (_sender, receiver) = mpsc::sync_channel(2);
        assert_eq!(
            wait_for_capture(&receiver, &mut || Ok(()), SHORT, SHORT),
            Err(AfternicError::CustodyUnavailable)
        );
        let cancelled = Arc::new(AtomicBool::new(false));
        drop(Cancellation(Arc::clone(&cancelled)));
        assert!(cancelled.load(Ordering::SeqCst));
    }

    #[test]
    fn input_timeout_and_native_window_close_are_cancellation() {
        let (sender, receiver) = mpsc::sync_channel(2);
        assert!(sender.send(Event::Opened).is_ok());
        assert_eq!(
            wait_for_capture(&receiver, &mut || Ok(()), SHORT, SHORT),
            Err(AfternicError::CaptureCancelled)
        );
        assert!(
            sender
                .send(Event::Completed(Err(AfternicError::CaptureCancelled)))
                .is_ok()
        );
        assert_eq!(
            wait_for_capture(&receiver, &mut || Ok(()), SHORT, SHORT),
            Err(AfternicError::CaptureCancelled)
        );
    }

    #[test]
    fn authority_is_rechecked_after_result_and_before_every_wait() {
        let (sender, receiver) = mpsc::sync_channel(2);
        assert!(
            sender
                .send(Event::Completed(Ok(Zeroizing::new(vec![1]))))
                .is_ok()
        );
        let mut calls = 0;
        let mut guard = || {
            calls += 1;
            if calls == 1 {
                Ok(())
            } else {
                Err(AfternicError::AuthorityStale)
            }
        };
        assert_eq!(
            wait_for_capture(&receiver, &mut guard, SHORT, SHORT),
            Err(AfternicError::AuthorityStale)
        );
        assert_eq!(
            wait_for_capture(
                &receiver,
                &mut || Err(AfternicError::AuthorityStale),
                SHORT,
                SHORT
            ),
            Err(AfternicError::AuthorityStale)
        );
    }

    #[test]
    fn duplicate_open_and_channel_loss_fail_closed() {
        let (sender, receiver) = mpsc::sync_channel(2);
        assert!(sender.send(Event::Opened).is_ok());
        assert!(sender.send(Event::Opened).is_ok());
        assert_eq!(
            wait_for_capture(&receiver, &mut || Ok(()), SHORT, SHORT),
            Err(AfternicError::CustodyUnavailable)
        );
        drop(sender);
        assert_eq!(
            wait_for_capture(&receiver, &mut || Ok(()), SHORT, SHORT),
            Err(AfternicError::CustodyUnavailable)
        );
    }

    #[derive(Clone, Copy, Debug)]
    enum NativeCase {
        Submit,
        Cancel,
        Revoke,
    }

    fn perform_native_input(
        case: NativeCase,
        revoked: &AtomicBool,
    ) -> Option<(gtk::Entry, gtk::Entry)> {
        for widget in gtk::Window::list_toplevels() {
            let Ok(window) = widget.downcast::<gtk::Window>() else {
                continue;
            };
            if window.title().as_deref() != Some("GoodDealer — Connect Afternic") {
                continue;
            }
            let grid = window
                .child()
                .and_then(|child| child.downcast::<gtk::Grid>().ok())
                .expect("fixed capture grid");
            let key = grid
                .child_at(1, 0)
                .and_then(|child| child.downcast::<gtk::Entry>().ok())
                .expect("masked key entry");
            let secret = grid
                .child_at(1, 1)
                .and_then(|child| child.downcast::<gtk::Entry>().ok())
                .expect("masked secret entry");
            assert!(
                !gtk::prelude::EntryExt::is_visible(&key)
                    && !gtk::prelude::EntryExt::is_visible(&secret)
            );
            let key_label = grid
                .child_at(0, 0)
                .and_then(|child| child.downcast::<gtk::Label>().ok())
                .expect("key label");
            let secret_label = grid
                .child_at(0, 1)
                .and_then(|child| child.downcast::<gtk::Label>().ok())
                .expect("secret label");
            assert_eq!(key_label.mnemonic_widget(), Some(key.clone().upcast()));
            assert_eq!(
                secret_label.mnemonic_widget(),
                Some(secret.clone().upcast())
            );
            assert_eq!(key.input_purpose(), gtk::InputPurpose::Password);
            assert_eq!(secret.input_purpose(), gtk::InputPurpose::Password);
            key.set_text("native_canary_key_1234");
            secret.set_text("native_canary_secret_1234");

            match case {
                NativeCase::Submit => {
                    let button = grid
                        .child_at(1, 2)
                        .and_then(|child| child.downcast::<gtk::Button>().ok())
                        .expect("fixed submit button");
                    button.emit_clicked();
                }
                NativeCase::Cancel => window.close(),
                NativeCase::Revoke => revoked.store(true, Ordering::SeqCst),
            }
            return Some((key, secret));
        }
        None
    }

    fn run_native_case(case: NativeCase) {
        let revoked = Arc::new(AtomicBool::new(false));
        let worker_revoked = Arc::clone(&revoked);
        let (sender, receiver) = mpsc::sync_channel(1);
        let worker = std::thread::spawn(move || {
            let result = capture(&mut || {
                if worker_revoked.load(Ordering::SeqCst) {
                    Err(AfternicError::AuthorityStale)
                } else {
                    Ok(())
                }
            });
            eprintln!(
                "native capture case {case:?}: {}",
                result
                    .as_ref()
                    .map_or_else(ToString::to_string, |_| "captured".to_owned())
            );
            let accepted = match case {
                NativeCase::Submit => result.is_ok_and(|bytes| {
                    // Canary comparison stays native and never becomes diagnostic output.
                    bytes.as_slice() == b"native_canary_key_1234\nnative_canary_secret_1234"
                        && crate::afternic_credentials::parse_capture(&bytes).is_ok()
                }),
                NativeCase::Cancel => matches!(result, Err(AfternicError::CaptureCancelled)),
                NativeCase::Revoke => matches!(result, Err(AfternicError::AuthorityStale)),
            };
            assert!(sender.send(accepted).is_ok());
        });
        let event_loop = glib::MainLoop::new(None, false);
        let exit_loop = event_loop.clone();
        let inspected = Rc::new(Cell::new(false));
        let accepted = Rc::new(Cell::new(false));
        let inspected_result = Rc::clone(&inspected);
        let accepted_result = Rc::clone(&accepted);
        let started = Instant::now();
        let mut entries: Option<(gtk::Entry, gtk::Entry)> = None;
        glib::timeout_add_local(Duration::from_millis(10), move || {
            if entries.is_none() {
                entries = perform_native_input(case, &revoked);
            }
            if let Ok(result) = receiver.try_recv() {
                accepted_result.set(result);
            }
            // Revocation returns on the worker before the next GTK clearing tick. Inspect
            // the retained real entries only after that tick has actually cleared them.
            if accepted_result.get()
                && entries
                    .as_ref()
                    .is_some_and(|(key, secret)| key.text().is_empty() && secret.text().is_empty())
            {
                inspected_result.set(true);
                exit_loop.quit();
                return glib::ControlFlow::Break;
            }
            if started.elapsed() > Duration::from_secs(5) {
                revoked.store(true, Ordering::SeqCst);
                exit_loop.quit();
                return glib::ControlFlow::Break;
            }
            glib::ControlFlow::Continue
        });
        event_loop.run();
        assert!(worker.join().is_ok());
        assert!(
            accepted.get() && inspected.get(),
            "native capture lifecycle was not confirmed: {case:?}; accepted={}, cleared={}",
            accepted.get(),
            inspected.get()
        );
    }

    #[test]
    #[ignore = "requires a real GTK display; native canaries only, no account credentials"]
    fn actual_gtk_capture_submission_cancellation_revocation_and_late_dispatch() {
        assert!(gtk::init().is_ok(), "GTK display unavailable");
        assert!(matches!(
            capture(&mut || Ok(())),
            Err(AfternicError::CustodyUnavailable)
        ));
        for case in [NativeCase::Submit, NativeCase::Cancel, NativeCase::Revoke] {
            run_native_case(case);
        }
        // The initialized GTK thread deliberately does not service its loop while this
        // worker waits. Returning must invalidate the still-queued window creation.
        let worker = std::thread::spawn(|| capture(&mut || Ok(())));
        assert!(matches!(
            worker.join(),
            Ok(Err(AfternicError::CustodyUnavailable))
        ));
        while glib::MainContext::default().pending() {
            glib::MainContext::default().iteration(false);
        }
        assert!(
            !gtk::Window::list_toplevels().into_iter().any(|widget| {
                widget.downcast::<gtk::Window>().is_ok_and(|window| {
                    window.title().as_deref() == Some("GoodDealer — Connect Afternic")
                })
            }),
            "late capture dispatch opened a window"
        );
    }
}
