//! Fixed Cloudflare and Afternic capture on the running desktop GTK main loop.
//! Provider-owned adapters select one closed purpose; no Renderer input or caller-selected
//! labels, fields, commands, or secret destinations participate in this boundary.
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Purpose {
    Cloudflare,
    Afternic,
}
impl Purpose {
    const fn title(self) -> &'static str {
        match self {
            Self::Cloudflare => "GoodDealer — Connect Cloudflare",
            Self::Afternic => "GoodDealer — Connect Afternic",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum CaptureError {
    Unavailable,
    Cancelled,
    Timeout,
    AuthorityStale,
}

enum Event {
    Opened,
    Completed(Result<Zeroizing<Vec<u8>>, CaptureError>),
}

struct Cancellation(Arc<AtomicBool>);
impl Drop for Cancellation {
    fn drop(&mut self) {
        // Invalidates any late callback before the waiting worker returns. GTK widgets are
        // cleared/closed on the next main-loop pass, never accessed from this worker.
        self.0.store(true, Ordering::SeqCst);
    }
}

pub(super) fn capture(
    purpose: Purpose,
    guard: &mut dyn FnMut() -> bool,
) -> Result<Zeroizing<Vec<u8>>, CaptureError> {
    if !guard() {
        return Err(CaptureError::AuthorityStale);
    }
    if !gtk::is_initialized() || gtk::is_initialized_main_thread() {
        return Err(CaptureError::Unavailable);
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
            let _ = sender.try_send(Event::Completed(Err(CaptureError::Unavailable)));
            return;
        }
        open_capture(purpose, sender, pending);
    });
    wait_for_capture(&receiver, guard, START_TIMEOUT, INPUT_TIMEOUT)
}

fn wait_for_capture(
    receiver: &Receiver<Event>,
    guard: &mut dyn FnMut() -> bool,
    startup: Duration,
    input: Duration,
) -> Result<Zeroizing<Vec<u8>>, CaptureError> {
    let mut deadline = Instant::now() + startup;
    let mut opened = false;
    loop {
        if !guard() {
            return Err(CaptureError::AuthorityStale);
        }
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err(if opened {
                CaptureError::Timeout
            } else {
                CaptureError::Unavailable
            });
        }
        match receiver.recv_timeout(POLL.min(remaining)) {
            Ok(Event::Opened) if !opened => {
                opened = true;
                deadline = Instant::now() + input;
            }
            Ok(Event::Completed(result)) => {
                if !guard() {
                    return Err(CaptureError::AuthorityStale);
                }
                return result;
            }
            Ok(Event::Opened) | Err(RecvTimeoutError::Disconnected) => {
                return Err(CaptureError::Unavailable);
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
    fn finish(&self, result: Result<Zeroizing<Vec<u8>>, CaptureError>) {
        self.key.set_text("");
        self.secret.set_text("");
        if !self.completed.replace(true) {
            let result = if self.cancelled.load(Ordering::SeqCst) {
                Err(CaptureError::Cancelled)
            } else {
                result
            };
            let _ = self.sender.try_send(Event::Completed(result));
        }
    }
}

fn entry(masked: bool, maximum: i32) -> gtk::Entry {
    let entry = gtk::Entry::new();
    entry.set_visibility(!masked);
    entry.set_max_length(maximum);
    entry.set_input_purpose(if masked {
        gtk::InputPurpose::Password
    } else {
        gtk::InputPurpose::FreeForm
    });
    entry.set_input_hints(gtk::InputHints::NO_SPELLCHECK);
    entry
}

fn capture_controls(purpose: Purpose, form: &Form) -> (gtk::Grid, gtk::Button, gtk::Button) {
    let grid = gtk::Grid::new();
    grid.set_row_spacing(12);
    grid.set_column_spacing(12);
    let (first_label, second_label, submit_label) = match purpose {
        Purpose::Afternic => (
            "Afternic API _key",
            "Afternic API _secret",
            "Connect Afternic",
        ),
        Purpose::Cloudflare => (
            "Cloudflare _Zone ID",
            "Cloudflare API _token",
            "Connect Cloudflare",
        ),
    };
    let key_label = gtk::Label::new(Some(first_label));
    key_label.set_use_underline(true);
    key_label.set_mnemonic_widget(Some(&form.key));
    let secret_label = gtk::Label::new(Some(second_label));
    secret_label.set_use_underline(true);
    secret_label.set_mnemonic_widget(Some(&form.secret));
    grid.attach(&key_label, 0, 0, 1, 1);
    grid.attach(&form.key, 1, 0, 1, 1);
    grid.attach(&secret_label, 0, 1, 1, 1);
    grid.attach(&form.secret, 1, 1, 1, 1);
    let cancel = gtk::Button::with_label("Cancel");
    let connect = gtk::Button::with_label(submit_label);
    grid.attach(&cancel, 0, 2, 1, 1);
    grid.attach(&connect, 1, 2, 1, 1);
    (grid, cancel, connect)
}

fn open_capture(purpose: Purpose, sender: SyncSender<Event>, cancelled: Arc<AtomicBool>) {
    let window = gtk::Window::new(gtk::WindowType::Toplevel);
    window.set_title(purpose.title());
    window.set_modal(true);
    window.set_resizable(false);
    window.set_position(gtk::WindowPosition::Center);
    window.set_border_width(20);
    let form = Rc::new(Form {
        key: entry(
            purpose == Purpose::Afternic,
            if purpose == Purpose::Cloudflare {
                32
            } else {
                512
            },
        ),
        secret: entry(true, 512),
        sender,
        cancelled,
        completed: Cell::new(false),
    });
    let (grid, cancel, connect) = capture_controls(purpose, &form);
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
        dismissed.finish(Err(CaptureError::Cancelled));
        if let Some(window) = weak.upgrade() {
            window.close();
        }
    });
    let dismissed = Rc::clone(&form);
    window.connect_delete_event(move |_, _| {
        dismissed.finish(Err(CaptureError::Cancelled));
        glib::Propagation::Proceed
    });
    let dismissed = Rc::clone(&form);
    window.connect_destroy(move |_| {
        dismissed.finish(Err(CaptureError::Cancelled));
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
            watched.finish(Err(if watched.cancelled.load(Ordering::SeqCst) {
                CaptureError::Cancelled
            } else {
                CaptureError::Timeout
            }));
            window.close();
            return glib::ControlFlow::Break;
        }
        glib::ControlFlow::Continue
    });
    if form.cancelled.load(Ordering::SeqCst) || form.sender.try_send(Event::Opened).is_err() {
        form.finish(Err(CaptureError::Cancelled));
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
            wait_for_capture(&receiver, &mut || true, SHORT, SHORT),
            Err(CaptureError::Unavailable)
        );
        let cancelled = Arc::new(AtomicBool::new(false));
        drop(Cancellation(Arc::clone(&cancelled)));
        assert!(cancelled.load(Ordering::SeqCst));
    }

    #[test]
    fn input_timeout_and_native_window_close_remain_distinct() {
        let (sender, receiver) = mpsc::sync_channel(2);
        assert!(sender.send(Event::Opened).is_ok());
        assert_eq!(
            wait_for_capture(&receiver, &mut || true, SHORT, SHORT),
            Err(CaptureError::Timeout)
        );
        assert!(
            sender
                .send(Event::Completed(Err(CaptureError::Cancelled)))
                .is_ok()
        );
        assert_eq!(
            wait_for_capture(&receiver, &mut || true, SHORT, SHORT),
            Err(CaptureError::Cancelled)
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
            calls == 1
        };
        assert_eq!(
            wait_for_capture(&receiver, &mut guard, SHORT, SHORT),
            Err(CaptureError::AuthorityStale)
        );
        assert_eq!(
            wait_for_capture(&receiver, &mut || false, SHORT, SHORT),
            Err(CaptureError::AuthorityStale)
        );
    }

    #[test]
    fn duplicate_open_and_channel_loss_fail_closed() {
        let (sender, receiver) = mpsc::sync_channel(2);
        assert!(sender.send(Event::Opened).is_ok());
        assert!(sender.send(Event::Opened).is_ok());
        assert_eq!(
            wait_for_capture(&receiver, &mut || true, SHORT, SHORT),
            Err(CaptureError::Unavailable)
        );
        drop(sender);
        assert_eq!(
            wait_for_capture(&receiver, &mut || true, SHORT, SHORT),
            Err(CaptureError::Unavailable)
        );
    }

    #[derive(Clone, Copy, Debug)]
    enum NativeCase {
        Submit,
        Cancel,
        Revoke,
        Invalid,
    }

    fn perform_native_input(
        purpose: Purpose,
        case: NativeCase,
        revoked: &AtomicBool,
    ) -> Option<(gtk::Entry, gtk::Entry)> {
        for widget in gtk::Window::list_toplevels() {
            let Ok(window) = widget.downcast::<gtk::Window>() else {
                continue;
            };
            if window.title().as_deref() != Some(purpose.title()) {
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
            assert_eq!(
                gtk::prelude::EntryExt::is_visible(&key),
                purpose == Purpose::Cloudflare
            );
            assert!(!gtk::prelude::EntryExt::is_visible(&secret));
            assert_eq!(
                key.max_length(),
                if purpose == Purpose::Cloudflare {
                    32
                } else {
                    512
                }
            );
            assert_eq!(secret.max_length(), 512);
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
            assert_eq!(
                key.input_purpose(),
                if purpose == Purpose::Cloudflare {
                    gtk::InputPurpose::FreeForm
                } else {
                    gtk::InputPurpose::Password
                }
            );
            assert_eq!(secret.input_purpose(), gtk::InputPurpose::Password);
            let (first, second) = match purpose {
                Purpose::Afternic => ("native_canary_key_1234", "native_canary_secret_1234"),
                Purpose::Cloudflare => (
                    "0123456789abcdef0123456789abcdef",
                    "native_canary_token_1234",
                ),
            };
            key.set_text(first);
            secret.set_text(if matches!(case, NativeCase::Invalid) {
                "invalid secret with spaces"
            } else {
                second
            });

            match case {
                NativeCase::Submit | NativeCase::Invalid => {
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

    fn run_native_case(purpose: Purpose, case: NativeCase) {
        let revoked = Arc::new(AtomicBool::new(false));
        let worker_revoked = Arc::clone(&revoked);
        let (sender, receiver) = mpsc::sync_channel(1);
        let worker = std::thread::spawn(move || {
            // Exercise each public Provider adapter as well as GTK, preserving its exact
            // error classification and full credential bytes without printing the canary.
            let accepted = match purpose {
                Purpose::Afternic => {
                    use crate::afternic_provider::AfternicError;
                    let result = crate::AfternicCapture::capture_guarded(&mut || {
                        if worker_revoked.load(Ordering::SeqCst) {
                            Err(AfternicError::AuthorityStale)
                        } else {
                            Ok(())
                        }
                    });
                    match case {
                        NativeCase::Submit => result.is_ok_and(|credential| {
                            credential.authorization().as_str()
                                == "sso-key native_canary_key_1234:native_canary_secret_1234"
                        }),
                        NativeCase::Cancel => {
                            matches!(result, Err(AfternicError::CaptureCancelled))
                        }
                        NativeCase::Revoke => matches!(result, Err(AfternicError::AuthorityStale)),
                        NativeCase::Invalid => matches!(result, Err(AfternicError::InputRejected)),
                    }
                }
                Purpose::Cloudflare => {
                    use crate::CloudflareCaptureError;
                    let result = crate::CloudflareCapture::capture_guarded(&mut || {
                        if worker_revoked.load(Ordering::SeqCst) {
                            Err(CloudflareCaptureError::AuthorityStale)
                        } else {
                            Ok(())
                        }
                    });
                    match case {
                        NativeCase::Submit => result.is_ok_and(|candidate| {
                            let (zone, token) = candidate.into_parts();
                            zone == "0123456789abcdef0123456789abcdef"
                                && token.as_str() == "native_canary_token_1234"
                        }),
                        NativeCase::Cancel => {
                            matches!(result, Err(CloudflareCaptureError::Cancelled))
                        }
                        NativeCase::Revoke => {
                            matches!(result, Err(CloudflareCaptureError::AuthorityStale))
                        }
                        NativeCase::Invalid => {
                            matches!(result, Err(CloudflareCaptureError::OutputInvalid))
                        }
                    }
                }
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
                entries = perform_native_input(purpose, case, &revoked);
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
            "native capture lifecycle was not confirmed: {purpose:?}/{case:?}; accepted={}, cleared={}",
            accepted.get(),
            inspected.get()
        );
    }

    #[test]
    #[ignore = "requires a real GTK display; native canaries only, no account credentials"]
    fn actual_gtk_capture_submission_cancellation_revocation_and_late_dispatch() {
        assert!(gtk::init().is_ok(), "GTK display unavailable");
        for purpose in [Purpose::Afternic, Purpose::Cloudflare] {
            assert!(matches!(
                capture(purpose, &mut || true),
                Err(CaptureError::Unavailable)
            ));
            for case in [
                NativeCase::Submit,
                NativeCase::Cancel,
                NativeCase::Revoke,
                NativeCase::Invalid,
            ] {
                run_native_case(purpose, case);
            }
            // The initialized GTK thread deliberately does not service its loop while this
            // worker waits. Returning must invalidate the still-queued window creation.
            let worker = std::thread::spawn(move || capture(purpose, &mut || true));
            assert!(matches!(worker.join(), Ok(Err(CaptureError::Unavailable))));
            while glib::MainContext::default().pending() {
                glib::MainContext::default().iteration(false);
            }
            assert!(
                !gtk::Window::list_toplevels().into_iter().any(|widget| {
                    widget
                        .downcast::<gtk::Window>()
                        .is_ok_and(|window| window.title().as_deref() == Some(purpose.title()))
                }),
                "late capture dispatch opened a window"
            );
        }
    }
}
