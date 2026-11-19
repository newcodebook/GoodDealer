//! ADR-0006's fixed interrupt-clock and private class-90 boot identity query exception.
#![allow(unsafe_code)]

use super::{
    NativeContinuousClockError, NativeContinuousClockKind, NativeContinuousClockSample,
    checked_sample, checked_windows_boot_identity,
};
use windows::{
    Wdk::System::SystemInformation::{NtQuerySystemInformation, SYSTEM_INFORMATION_CLASS},
    Win32::System::WindowsProgramming::QueryInterruptTimePrecise,
    core::GUID,
};

// This is a PRIVATE ABI, not a documented Microsoft SDK boot-identity contract.
// Evidence: winsiderss/systeminformer phnt/include/ntexapi.h, retrieved 2026-11-19,
// SHA256 e635dd2f390b43eba3a4664a2d36f429edcbd4ec18991b83de1280ba8a0020a0.
// The only accepted query is SystemBootEnvironmentInformation (90). Firmware/boot flags
// are not interpreted; no arbitrary class, output buffer or OS handle leaves this module.
#[repr(C)]
struct BootEnvironmentInformation {
    boot_identifier: GUID,
    firmware_type: u32,
    padding: u32,
    boot_flags: u64,
}

const _: () = {
    assert!(std::mem::size_of::<BootEnvironmentInformation>() == 32);
    assert!(std::mem::align_of::<BootEnvironmentInformation>() == 8);
    assert!(std::mem::offset_of!(BootEnvironmentInformation, boot_identifier) == 0);
    assert!(std::mem::offset_of!(BootEnvironmentInformation, firmware_type) == 16);
    assert!(std::mem::offset_of!(BootEnvironmentInformation, boot_flags) == 24);
};

fn boot_id() -> Result<[u8; 16], NativeContinuousClockError> {
    let mut information = BootEnvironmentInformation {
        boot_identifier: GUID::zeroed(),
        firmware_type: 0,
        padding: 0,
        boot_flags: 0,
    };
    let mut returned_length = 0;
    // SAFETY: the fixed class writes at most the supplied 32-byte initialized repr(C) object;
    // the separate return-length pointer is live. The ABI's exact size/alignment/offsets are
    // asserted above and status/returned length are checked before interpreting the GUID.
    let status = unsafe {
        NtQuerySystemInformation(
            SYSTEM_INFORMATION_CLASS(90),
            std::ptr::from_mut(&mut information).cast(),
            32,
            &raw mut returned_length,
        )
    };
    checked_windows_boot_identity(
        status.0,
        returned_length,
        information.boot_identifier.to_u128().to_be_bytes(),
    )
}

pub(super) fn capture() -> Result<NativeContinuousClockSample, NativeContinuousClockError> {
    let before = boot_id()?;
    // SAFETY: this fixed no-argument OS API returns a scalar; the windows binding owns its
    // initialized output buffer. Biased interrupt time includes sleep and hibernation.
    let ticks = unsafe { QueryInterruptTimePrecise() };
    checked_sample(
        NativeContinuousClockKind::WindowsInterrupt100ns,
        before,
        ticks,
        boot_id()?,
    )
}
