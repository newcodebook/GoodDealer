//! ADR-0006's fixed NSWorkspace power-notification exception, with retained callback lifetime.
#![allow(unsafe_code)]

use super::State;
use block2::RcBlock;
use objc2::{
    MainThreadMarker,
    rc::Retained,
    runtime::{AnyObject, ProtocolObject},
};
use objc2_app_kit::{
    NSWorkspace, NSWorkspaceDidWakeNotification, NSWorkspaceWillSleepNotification,
};
use objc2_foundation::{NSNotification, NSNotificationCenter, NSObjectProtocol};
use std::{ptr::NonNull, sync::Arc};

pub(super) struct Registration {
    center: Retained<NSNotificationCenter>,
    sleep: Retained<ProtocolObject<dyn NSObjectProtocol>>,
    wake: Retained<ProtocolObject<dyn NSObjectProtocol>>,
}
impl Registration {
    pub(super) fn start(state: Arc<State>) -> Option<Self> {
        let _main_thread = MainThreadMarker::new()?;
        let center = NSWorkspace::sharedWorkspace().notificationCenter();
        let sleep_state = Arc::clone(&state);
        let sleep = RcBlock::new(move |_: NonNull<NSNotification>| publish(&sleep_state, true));
        let wake = RcBlock::new(move |_: NonNull<NSNotification>| publish(&state, false));
        // SAFETY: fixed exported notification names; nil object admits no borrowed receiver.
        // nil queue delivers synchronously. Both copied blocks capture only thread-safe Arc
        // state, ignore foreign notification pointers and never call user code or the Host.
        let sleep = unsafe {
            center.addObserverForName_object_queue_usingBlock(
                Some(NSWorkspaceWillSleepNotification),
                None,
                None,
                &sleep,
            )
        };
        let wake = unsafe {
            center.addObserverForName_object_queue_usingBlock(
                Some(NSWorkspaceDidWakeNotification),
                None,
                None,
                &wake,
            )
        };
        Some(Self {
            center,
            sleep,
            wake,
        })
    }
}
impl Drop for Registration {
    fn drop(&mut self) {
        // SAFETY: these retained tokens came from this exact center, and owner Drop is main
        // thread confined. Monitor closes admission first. In-flight copied blocks retain
        // their own Arc, so removal cannot free state still used by a callback.
        unsafe {
            self.center
                .removeObserver(AsRef::<AnyObject>::as_ref(&*self.sleep));
            self.center
                .removeObserver(AsRef::<AnyObject>::as_ref(&*self.wake));
        }
    }
}
fn publish(state: &State, paused: bool) {
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| state.event(paused)));
    if result.is_err() {
        state.close();
    }
}
