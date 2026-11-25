//! ADR-0006's fixed continuous-clock and read-only boot UUID exception.
#![allow(unsafe_code)]

use super::{
    NativeContinuousClockError, NativeContinuousClockKind, NativeContinuousClockSample,
    checked_macos_boot_identity, checked_sample, nanoseconds,
};

fn boot_id() -> Result<[u8; 16], NativeContinuousClockError> {
    let mut bytes = [0_u8; 37];
    let mut length = bytes.len();
    // SAFETY: the name is a fixed terminated string; output points to this live, fixed buffer
    // with its actual size. A null new value and zero length make this query read-only.
    let status = unsafe {
        libc::sysctlbyname(
            c"kern.bootsessionuuid".as_ptr(),
            bytes.as_mut_ptr().cast(),
            &raw mut length,
            std::ptr::null_mut(),
            0,
        )
    };
    checked_macos_boot_identity(status, length, &bytes)
}

pub(super) fn capture() -> Result<NativeContinuousClockSample, NativeContinuousClockError> {
    let before = boot_id()?;
    let mut time = libc::timespec {
        tv_sec: 0,
        tv_nsec: 0,
    };
    // SAFETY: only the fixed macOS continuous clock is queried; time is an initialized, live
    // timespec. Apple Libc maps CLOCK_MONOTONIC_RAW to suspend-inclusive mach_continuous_time.
    if unsafe { libc::clock_gettime(libc::CLOCK_MONOTONIC_RAW, &raw mut time) } != 0 {
        return Err(NativeContinuousClockError::Unavailable);
    }
    let ticks = nanoseconds(time.tv_sec, time.tv_nsec)?;
    checked_sample(
        NativeContinuousClockKind::MacosContinuousNanoseconds,
        before,
        ticks,
        boot_id()?,
    )
}
