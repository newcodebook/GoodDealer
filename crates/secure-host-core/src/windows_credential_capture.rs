//! Fixed Native Windows password dialogs. No script host, IPC secret, or caller-selected UI.

use std::cell::RefCell;
use std::rc::Rc;
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
    mpsc,
};
use std::time::{Duration, Instant};
use winsafe::{co, gui, prelude::*};
use zeroize::Zeroizing;

static CAPTURE: Mutex<()> = Mutex::new(());
const MAX_CHARACTERS: usize = 512;
#[derive(Clone, Copy)]
pub(crate) enum Purpose {
    Cloudflare,
    Afternic,
    Spaceship,
}
#[derive(Clone, Copy, Debug)]
pub(crate) enum CaptureError {
    Unavailable,
    Cancelled,
    Timeout,
    AuthorityStale,
}
struct Pair {
    first: Zeroizing<String>,
    second: Zeroizing<String>,
}

pub(crate) fn capture(
    purpose: Purpose,
    guard: &mut dyn FnMut() -> bool,
) -> Result<Zeroizing<Vec<u8>>, CaptureError> {
    let _capture = CAPTURE.try_lock().map_err(|_| CaptureError::Unavailable)?;
    if !guard() {
        return Err(CaptureError::AuthorityStale);
    }
    let cancelled = Arc::new(AtomicBool::new(false));
    let ui_cancelled = Arc::clone(&cancelled);
    let (sender, receiver) = mpsc::sync_channel(1);
    let thread = std::thread::Builder::new()
        .name("gooddealer-credential-input".into())
        .spawn(move || {
            let result = run_dialog(purpose, ui_cancelled);
            let _ = sender.send(result);
        })
        .map_err(|_| CaptureError::Unavailable)?;
    let deadline = Instant::now() + Duration::from_secs(120);
    let result = loop {
        if !guard() {
            break Err(CaptureError::AuthorityStale);
        }
        if Instant::now() >= deadline {
            break Err(CaptureError::Timeout);
        }
        match receiver.recv_timeout(Duration::from_millis(10)) {
            Ok(result) => break result,
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => break Err(CaptureError::Unavailable),
        }
    };
    cancelled.store(true, Ordering::Release);
    // A fixed Native timer observes cancellation without waiting for user input.
    // Joining destroys every HWND before the authority guard can return.
    thread.join().map_err(|_| CaptureError::Unavailable)?;
    if !guard() {
        return Err(CaptureError::AuthorityStale);
    }
    let pair = result?;
    if pair.first.is_empty()
        || pair.second.is_empty()
        || pair.first.len() > MAX_CHARACTERS
        || pair.second.len() > MAX_CHARACTERS
        || !pair.first.is_ascii()
        || !pair.second.is_ascii()
        || pair.first.contains(['\r', '\n'])
        || pair.second.contains(['\r', '\n'])
    {
        return Err(CaptureError::Cancelled);
    }
    let mut bytes = Zeroizing::new(Vec::with_capacity(pair.first.len() + pair.second.len() + 1));
    bytes.extend_from_slice(pair.first.as_bytes());
    bytes.push(b'\n');
    bytes.extend_from_slice(pair.second.as_bytes());
    Ok(bytes)
}

struct Dialog {
    window: gui::WindowMain,
    first: gui::Edit,
    second: gui::Edit,
    confirm: gui::Button,
    cancel: gui::Button,
}
impl Dialog {
    fn build(purpose: Purpose) -> Self {
        let (title, first_label, second_label, mask_first) = match purpose {
            Purpose::Cloudflare => (
                "Connect Cloudflare - GoodDealer",
                "Zone ID",
                "API token",
                false,
            ),
            Purpose::Afternic => (
                "Connect Afternic - GoodDealer",
                "API key",
                "API secret",
                true,
            ),
            Purpose::Spaceship => (
                "Connect Spaceship - GoodDealer",
                "Spaceship API key",
                "Spaceship API secret",
                true,
            ),
        };
        let window = gui::WindowMain::new(gui::WindowMainOpts {
            class_name: "GoodDealer.NativeCredentialCapture.V1",
            title,
            size: gui::dpi(420, 240),
            style: co::WS::CAPTION | co::WS::SYSMENU,
            ..Default::default()
        });
        // Explicit IDs avoid the GUI library's process-global auto-ID allocator.
        let _ = gui::Label::new(
            &window,
            gui::LabelOpts {
                text: first_label,
                position: gui::dpi(20, 20),
                size: gui::dpi(380, 22),
                ctrl_id: 101,
                ..Default::default()
            },
        );
        let _ = gui::Label::new(
            &window,
            gui::LabelOpts {
                text: second_label,
                position: gui::dpi(20, 88),
                size: gui::dpi(380, 22),
                ctrl_id: 102,
                ..Default::default()
            },
        );
        let mut first_style = co::ES::AUTOHSCROLL;
        if mask_first {
            first_style |= co::ES::PASSWORD;
        }
        let first = gui::Edit::new(
            &window,
            gui::EditOpts {
                position: gui::dpi(20, 46),
                width: gui::dpi_x(380),
                control_style: first_style,
                ctrl_id: 103,
                ..Default::default()
            },
        );
        let second = gui::Edit::new(
            &window,
            gui::EditOpts {
                position: gui::dpi(20, 114),
                width: gui::dpi_x(380),
                control_style: co::ES::AUTOHSCROLL | co::ES::PASSWORD,
                ctrl_id: 104,
                ..Default::default()
            },
        );
        let confirm = gui::Button::new(
            &window,
            gui::ButtonOpts {
                text: "Connect",
                position: gui::dpi(190, 174),
                width: gui::dpi_x(100),
                height: gui::dpi_y(32),
                ctrl_id: 105,
                ..Default::default()
            },
        );
        let cancel = gui::Button::new(
            &window,
            gui::ButtonOpts {
                text: "Cancel",
                position: gui::dpi(300, 174),
                width: gui::dpi_x(100),
                height: gui::dpi_y(32),
                ctrl_id: 106,
                ..Default::default()
            },
        );
        Self {
            window,
            first,
            second,
            confirm,
            cancel,
        }
    }
}
impl Drop for Dialog {
    fn drop(&mut self) {
        // Also cover message-loop error exits. Normal WM_CLOSE destroys the child controls
        // and clears the library's event closures before run_main returns.
        if self.window.hwnd().IsWindow() {
            let _ = self.first.set_text("");
            let _ = self.second.set_text("");
            let _ = self.window.hwnd().DestroyWindow();
        }
    }
}

fn run_dialog(purpose: Purpose, cancelled: Arc<AtomicBool>) -> Result<Pair, CaptureError> {
    // No COM/OLE initialization is needed for these ordinary Win32 controls. All library
    // GUI state is serialized by CAPTURE and every HWND remains on this one input thread.
    let ui = Dialog::build(purpose);
    let result = Rc::new(RefCell::new(None));
    let first = ui.first.clone();
    let second = ui.second.clone();
    let window = ui.window.clone();
    ui.window.on().wm_create(move |_| {
        first.limit_text(Some(512));
        second.limit_text(Some(512));
        window.hwnd().SetTimer(1, 10, None)?;
        Ok(0)
    });
    let first = ui.first.clone();
    let second = ui.second.clone();
    ui.window.on().wm_destroy(move || {
        // Clear while the child controls still exist; WM_NCDESTROY then releases callbacks.
        let _ = first.set_text("");
        let _ = second.set_text("");
        Ok(())
    });
    let window = ui.window.clone();
    ui.window.on().wm_timer(1, move || {
        if cancelled.load(Ordering::Acquire) {
            window.close();
        }
        Ok(())
    });
    let first = ui.first.clone();
    let second = ui.second.clone();
    let window = ui.window.clone();
    let callback_result = Rc::clone(&result);
    ui.confirm.on().bn_clicked(move || {
        // Never return platform error strings or retain non-zeroizing copies of captured text.
        let first_value = first.text().map(Zeroizing::new);
        let second_value = second.text().map(Zeroizing::new);
        if let (Ok(first), Ok(second)) = (first_value, second_value) {
            *callback_result.borrow_mut() = Some(Pair { first, second });
        }
        let _ = first.set_text("");
        let _ = second.set_text("");
        window.close();
        Ok(())
    });
    let window = ui.window.clone();
    ui.cancel.on().bn_clicked(move || {
        window.close();
        Ok(())
    });
    ui.window
        .run_main(None)
        .map_err(|_| CaptureError::Unavailable)?;
    let captured = result.borrow_mut().take().ok_or(CaptureError::Cancelled);
    drop(ui);
    captured
}
