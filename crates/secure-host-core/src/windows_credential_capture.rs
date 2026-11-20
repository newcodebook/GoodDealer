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
    CloudflareRegistrar,
    Afternic,
    Spaceship,
    Aliyun,
    Atom,
    GoDaddy,
}
impl Purpose {
    const fn dialog_labels(self) -> (&'static str, &'static str, &'static str, bool) {
        match self {
            Self::Cloudflare => (
                "Connect Cloudflare - GoodDealer",
                "Zone ID",
                "API token",
                false,
            ),
            Self::CloudflareRegistrar => (
                "Connect Cloudflare Registrar - GoodDealer",
                "Cloudflare Account ID",
                "Cloudflare user API token",
                true,
            ),
            Self::Afternic => (
                "Connect Afternic - GoodDealer",
                "API key",
                "API secret",
                true,
            ),
            Self::Spaceship => (
                "Connect Spaceship - GoodDealer",
                "Spaceship API key",
                "Spaceship API secret",
                true,
            ),
            Self::Aliyun => (
                "Connect Alibaba Cloud - GoodDealer",
                "Alibaba Cloud AccessKey ID",
                "Alibaba Cloud AccessKey secret",
                true,
            ),
            Self::Atom => (
                "Connect Atom - GoodDealer",
                "Atom seller user ID",
                "Atom Seller API token",
                true,
            ),
            Self::GoDaddy => (
                "Connect GoDaddy Registrar - GoodDealer",
                "",
                "GoDaddy Personal Access Token",
                true,
            ),
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub(crate) enum CaptureError {
    Unavailable,
    Cancelled,
    Timeout,
    AuthorityStale,
}
struct Pair {
    first: Option<Zeroizing<String>>,
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
    if pair
        .first
        .as_ref()
        .is_some_and(|value| !valid_capture_field(value, MAX_CHARACTERS))
        || !valid_capture_field(&pair.second, second_field_limit(pair.first.is_none()))
    {
        return Err(CaptureError::Cancelled);
    }
    let mut bytes = Zeroizing::new(Vec::new());
    if let Some(first) = pair.first {
        bytes.extend_from_slice(first.as_bytes());
        bytes.push(b'\n');
    }
    bytes.extend_from_slice(pair.second.as_bytes());
    Ok(bytes)
}

fn valid_capture_field(value: &str, limit: usize) -> bool {
    (1..=limit).contains(&value.len()) && value.is_ascii() && !value.contains(['\r', '\n'])
}

fn second_field_limit(single: bool) -> usize {
    if single {
        crate::godaddy::MAX_GODADDY_PAT_BYTES
    } else {
        MAX_CHARACTERS
    }
}

struct Dialog {
    window: gui::WindowMain,
    first: Option<gui::Edit>,
    second: gui::Edit,
    confirm: gui::Button,
    cancel: gui::Button,
}
impl Dialog {
    fn build(purpose: Purpose) -> Self {
        let (title, first_label, second_label, mask_first) = purpose.dialog_labels();
        let paired = !first_label.is_empty();
        let second_offset = if paired { 68 } else { 0 };
        let window = gui::WindowMain::new(gui::WindowMainOpts {
            class_name: "GoodDealer.NativeCredentialCapture.V1",
            title,
            size: gui::dpi(420, 172 + second_offset),
            style: co::WS::CAPTION | co::WS::SYSMENU,
            ..Default::default()
        });
        // Explicit IDs avoid the GUI library's process-global auto-ID allocator.
        let first = paired.then(|| {
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
            let mut style = co::ES::AUTOHSCROLL;
            if mask_first {
                style |= co::ES::PASSWORD;
            }
            gui::Edit::new(
                &window,
                gui::EditOpts {
                    position: gui::dpi(20, 46),
                    width: gui::dpi_x(380),
                    control_style: style,
                    ctrl_id: 103,
                    ..Default::default()
                },
            )
        });
        let _ = gui::Label::new(
            &window,
            gui::LabelOpts {
                text: second_label,
                position: gui::dpi(20, 20 + second_offset),
                size: gui::dpi(380, 22),
                ctrl_id: 102,
                ..Default::default()
            },
        );
        let second = gui::Edit::new(
            &window,
            gui::EditOpts {
                position: gui::dpi(20, 46 + second_offset),
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
                position: gui::dpi(190, 106 + second_offset),
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
                position: gui::dpi(300, 106 + second_offset),
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
            if let Some(first) = &self.first {
                let _ = first.set_text("");
            }
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
        if let Some(first) = &first {
            first.limit_text(Some(512));
        }
        second.limit_text(Some(
            u32::try_from(second_field_limit(first.is_none())).expect("fixed credential bound"),
        ));
        window.hwnd().SetTimer(1, 10, None)?;
        Ok(0)
    });
    let first = ui.first.clone();
    let second = ui.second.clone();
    ui.window.on().wm_destroy(move || {
        // Clear while the child controls still exist; WM_NCDESTROY then releases callbacks.
        if let Some(first) = &first {
            let _ = first.set_text("");
        }
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
        let first_value = first
            .as_ref()
            .map(|field| field.text().map(Zeroizing::new))
            .transpose();
        let second_value = second.text().map(Zeroizing::new);
        if let (Ok(first), Ok(second)) = (first_value, second_value) {
            *callback_result.borrow_mut() = Some(Pair { first, second });
        }
        if let Some(first) = &first {
            let _ = first.set_text("");
        }
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
