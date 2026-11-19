//! ADR-0006's fixed OS power-notification exception; no credential or caller callback FFI.
#![allow(unsafe_code)]

use super::State;
use std::{
    ffi::c_void,
    sync::{Arc, OnceLock},
};
use windows::Win32::{
    Foundation::{ERROR_SUCCESS, HANDLE},
    System::Power::{
        DEVICE_NOTIFY_SUBSCRIBE_PARAMETERS, HPOWERNOTIFY, PowerRegisterSuspendResumeNotification,
        PowerUnregisterSuspendResumeNotification,
    },
    UI::WindowsAndMessaging::{DEVICE_NOTIFY_CALLBACK, PBT_APMRESUMEAUTOMATIC, PBT_APMSUSPEND},
};

// One tiny nonsecret allocation deliberately has process lifetime. A late callback never
// dereferences a dropped context; a second registration cannot replace the original state.
static CALLBACK_STATE: OnceLock<Arc<State>> = OnceLock::new();

pub(super) struct Registration {
    handle: HPOWERNOTIFY,
    parameters: Option<Box<DEVICE_NOTIFY_SUBSCRIBE_PARAMETERS>>,
}
impl Registration {
    pub(super) fn start(state: Arc<State>) -> Option<Self> {
        CALLBACK_STATE.set(state).ok()?;
        let mut parameters = Box::new(DEVICE_NOTIFY_SUBSCRIBE_PARAMETERS {
            Callback: Some(power_callback),
            Context: std::ptr::null_mut(),
        });
        let recipient = HANDLE(std::ptr::from_mut(parameters.as_mut()).cast());
        let mut handle = std::ptr::null_mut();
        // SAFETY: recipient points to a stable Box retained for the registration. The callback
        // is fixed, ignores both raw payload pointers, and has process-lifetime Arc state.
        let result = unsafe {
            PowerRegisterSuspendResumeNotification(
                DEVICE_NOTIFY_CALLBACK,
                recipient,
                &raw mut handle,
            )
        };
        if result != ERROR_SUCCESS || handle.is_null() {
            // Even a malformed/partial OS failure cannot leave a retained recipient pointing
            // at freed Rust memory. This singleton retains at most one tiny nonsecret Box.
            let _retained_until_exit = Box::leak(parameters);
            return None;
        }
        Some(Self {
            handle: HPOWERNOTIFY(handle as isize),
            parameters: Some(parameters),
        })
    }
}
impl Drop for Registration {
    fn drop(&mut self) {
        // Monitor Drop closes its gate before reaching this owner. Late callbacks therefore
        // cannot reopen admission, even if the OS fails to remove the subscription.
        // SAFETY: this is precisely the successful registration handle, consumed once.
        let result = unsafe { PowerUnregisterSuspendResumeNotification(self.handle) };
        if result != ERROR_SUCCESS
            && let Some(parameters) = self.parameters.take()
        {
            // Retain the bounded nonsecret registration parameters if the OS may still
            // reference them; the process-lifetime callback state is already closed.
            let _retained_until_exit = Box::leak(parameters);
        }
    }
}

unsafe extern "system" fn power_callback(
    _context: *const c_void,
    event: u32,
    _setting: *const c_void,
) -> u32 {
    // Never dereference foreign pointers or unwind through the C ABI.
    if let Some(state) = CALLBACK_STATE.get() {
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| match event {
            PBT_APMSUSPEND => state.event(true),
            PBT_APMRESUMEAUTOMATIC => state.event(false),
            _ => {}
        }));
        if result.is_err() {
            state.close();
        }
    }
    ERROR_SUCCESS.0
}
