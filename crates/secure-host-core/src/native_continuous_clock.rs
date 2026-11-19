//! Native-only, suspend-inclusive samples. A sample is not a time anchor or execution authority.

use std::fmt::{Debug, Display, Formatter};

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
mod windows;

/// Counter units are part of persisted anchor identity and must never be interchanged.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NativeContinuousClockKind {
    WindowsInterrupt100ns,
    MacosContinuousNanoseconds,
    LinuxBootNanoseconds,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub struct NativeContinuousClockSample {
    clock_kind: NativeContinuousClockKind,
    boot_id: [u8; 16],
    ticks: u64,
}

impl NativeContinuousClockSample {
    #[must_use]
    pub fn clock_kind(&self) -> NativeContinuousClockKind {
        self.clock_kind
    }

    #[must_use]
    pub fn boot_id(&self) -> [u8; 16] {
        self.boot_id
    }

    #[must_use]
    pub fn ticks(&self) -> u64 {
        self.ticks
    }
}

impl Debug for NativeContinuousClockSample {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("NativeContinuousClockSample")
            .field("clock_kind", &self.clock_kind)
            .field("boot_id", &"[REDACTED]")
            .field("ticks", &"[REDACTED]")
            .finish()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NativeContinuousClockError {
    Unavailable,
    InvalidBootIdentity,
    InvalidCounter,
    BootChanged,
}

impl Display for NativeContinuousClockError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::Unavailable => "NATIVE_CONTINUOUS_CLOCK_UNAVAILABLE",
            Self::InvalidBootIdentity => "NATIVE_CONTINUOUS_CLOCK_BOOT_REJECTED",
            Self::InvalidCounter => "NATIVE_CONTINUOUS_CLOCK_COUNTER_REJECTED",
            Self::BootChanged => "NATIVE_CONTINUOUS_CLOCK_BOOT_CHANGED",
        })
    }
}

impl std::error::Error for NativeContinuousClockError {}

/// Captures the OS counter between two reads of its boot identity.
///
/// The caller must preserve the original request samples when retaining a signed time anchor.
/// This function neither establishes wall time nor proves continuity with a previous sample.
///
/// # Errors
///
/// Rejects unavailable APIs, malformed OS data, a zero counter, or changing boot identity.
pub fn capture_native_continuous_clock()
-> Result<NativeContinuousClockSample, NativeContinuousClockError> {
    #[cfg(target_os = "windows")]
    return windows::capture();
    #[cfg(target_os = "macos")]
    return macos::capture();
    #[cfg(target_os = "linux")]
    return capture_linux();
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    Err(NativeContinuousClockError::Unavailable)
}

fn checked_sample(
    clock_kind: NativeContinuousClockKind,
    before: [u8; 16],
    ticks: u64,
    after: [u8; 16],
) -> Result<NativeContinuousClockSample, NativeContinuousClockError> {
    if before == [0; 16] || after == [0; 16] {
        return Err(NativeContinuousClockError::InvalidBootIdentity);
    }
    if before != after {
        return Err(NativeContinuousClockError::BootChanged);
    }
    if ticks == 0 {
        return Err(NativeContinuousClockError::InvalidCounter);
    }
    Ok(NativeContinuousClockSample {
        clock_kind,
        boot_id: before,
        ticks,
    })
}

#[cfg(any(target_os = "macos", target_os = "linux", test))]
fn parse_boot_uuid(bytes: &[u8]) -> Result<[u8; 16], NativeContinuousClockError> {
    let rejected = NativeContinuousClockError::InvalidBootIdentity;
    if bytes.len() != 36 {
        return Err(rejected);
    }
    let mut result = [0; 16];
    let mut nibble_index = 0;
    for (index, byte) in bytes.iter().copied().enumerate() {
        if matches!(index, 8 | 13 | 18 | 23) {
            if byte != b'-' {
                return Err(rejected);
            }
            continue;
        }
        let nibble = match byte {
            b'0'..=b'9' => byte - b'0',
            b'a'..=b'f' => byte - b'a' + 10,
            b'A'..=b'F' => byte - b'A' + 10,
            _ => return Err(rejected),
        };
        result[nibble_index / 2] = (result[nibble_index / 2] << 4) | nibble;
        nibble_index += 1;
    }
    if result == [0; 16] {
        return Err(rejected);
    }
    Ok(result)
}

#[cfg(any(target_os = "macos", target_os = "linux", test))]
fn nanoseconds(seconds: i64, nanos: i64) -> Result<u64, NativeContinuousClockError> {
    if !(0..1_000_000_000).contains(&nanos) {
        return Err(NativeContinuousClockError::InvalidCounter);
    }
    u64::try_from(seconds)
        .ok()
        .and_then(|seconds| seconds.checked_mul(1_000_000_000))
        .and_then(|base| base.checked_add(u64::try_from(nanos).ok()?))
        .ok_or(NativeContinuousClockError::InvalidCounter)
}

#[cfg(any(target_os = "windows", test))]
fn checked_windows_boot_identity(
    status: i32,
    returned_length: u32,
    boot_id: [u8; 16],
) -> Result<[u8; 16], NativeContinuousClockError> {
    // Class 90 is a private ABI: success with any other layout is uncertainty, not continuity.
    if status != 0 || returned_length != 32 {
        return Err(NativeContinuousClockError::Unavailable);
    }
    if boot_id == [0; 16] {
        return Err(NativeContinuousClockError::InvalidBootIdentity);
    }
    Ok(boot_id)
}

#[cfg(any(target_os = "macos", test))]
fn checked_macos_boot_identity(
    status: i32,
    returned_length: usize,
    bytes: &[u8; 37],
) -> Result<[u8; 16], NativeContinuousClockError> {
    if status != 0 {
        return Err(NativeContinuousClockError::Unavailable);
    }
    if returned_length != bytes.len() || bytes[36] != 0 {
        return Err(NativeContinuousClockError::InvalidBootIdentity);
    }
    parse_boot_uuid(&bytes[..36])
}

#[cfg(target_os = "linux")]
fn linux_boot_id() -> Result<[u8; 16], NativeContinuousClockError> {
    use std::io::Read as _;
    let file = std::fs::File::open("/proc/sys/kernel/random/boot_id")
        .map_err(|_| NativeContinuousClockError::Unavailable)?;
    let mut bytes = Vec::with_capacity(38);
    file.take(38)
        .read_to_end(&mut bytes)
        .map_err(|_| NativeContinuousClockError::Unavailable)?;
    if bytes.len() != 37 || bytes[36] != b'\n' {
        return Err(NativeContinuousClockError::InvalidBootIdentity);
    }
    parse_boot_uuid(&bytes[..36])
}

#[cfg(target_os = "linux")]
fn capture_linux() -> Result<NativeContinuousClockSample, NativeContinuousClockError> {
    let before = linux_boot_id()?;
    let time = rustix::time::clock_gettime_dynamic(rustix::time::DynamicClockId::Boottime)
        .map_err(|_| NativeContinuousClockError::Unavailable)?;
    let ticks = nanoseconds(time.tv_sec, time.tv_nsec)?;
    checked_sample(
        NativeContinuousClockKind::LinuxBootNanoseconds,
        before,
        ticks,
        linux_boot_id()?,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn boot_uuid_rejects_noncanonical_shape_and_zero() {
        let valid = b"01234567-89ab-cdef-0123-456789abcdef";
        assert_eq!(
            parse_boot_uuid(valid).unwrap(),
            [
                1, 35, 69, 103, 137, 171, 205, 239, 1, 35, 69, 103, 137, 171, 205, 239
            ]
        );
        assert_eq!(
            parse_boot_uuid(valid),
            parse_boot_uuid(&valid.to_ascii_uppercase())
        );
        for bad in [
            b"00000000-0000-0000-0000-000000000000".as_slice(),
            b"01234567_89ab-cdef-0123-456789abcdef",
            b"01234567-89ab-cdef-0123-456789abcdeg",
            b"01234567-89ab-cdef-0123-456789abcdef\0",
            b"01234567-89ab-cdef-0123-456789abcde",
        ] {
            assert!(parse_boot_uuid(bad).is_err());
        }
    }

    #[test]
    fn identity_must_agree_around_counter() {
        let kind = NativeContinuousClockKind::WindowsInterrupt100ns;
        assert_eq!(
            checked_sample(kind, [1; 16], 10, [2; 16]),
            Err(NativeContinuousClockError::BootChanged)
        );
        assert_eq!(
            checked_sample(kind, [0; 16], 10, [0; 16]),
            Err(NativeContinuousClockError::InvalidBootIdentity)
        );
        assert_eq!(
            checked_sample(kind, [1; 16], 0, [1; 16]),
            Err(NativeContinuousClockError::InvalidCounter)
        );
        let sample = checked_sample(kind, [1; 16], u64::MAX, [1; 16]).unwrap();
        assert_eq!(sample.ticks(), u64::MAX);
        assert_eq!(sample.clock_kind(), kind);
        assert_eq!(sample.boot_id(), [1; 16]);
        let debug = format!("{sample:?}");
        assert!(debug.contains("[REDACTED]"));
        assert!(!debug.contains(&u64::MAX.to_string()));
        assert!(!debug.contains("1, 1"));
    }

    #[test]
    fn private_windows_abi_requires_exact_success_and_layout() {
        for (status, length) in [(1, 32), (-1, 32), (0, 0), (0, 24), (0, 33)] {
            assert_eq!(
                checked_windows_boot_identity(status, length, [1; 16]),
                Err(NativeContinuousClockError::Unavailable)
            );
        }
        assert_eq!(
            checked_windows_boot_identity(0, 32, [0; 16]),
            Err(NativeContinuousClockError::InvalidBootIdentity)
        );
        assert_eq!(checked_windows_boot_identity(0, 32, [1; 16]), Ok([1; 16]));
    }

    #[test]
    fn macos_boot_query_requires_exact_terminated_uuid() {
        let mut bytes = *b"01234567-89ab-cdef-0123-456789abcdef\0";
        assert!(checked_macos_boot_identity(0, 37, &bytes).is_ok());
        assert_eq!(
            checked_macos_boot_identity(-1, 37, &bytes),
            Err(NativeContinuousClockError::Unavailable)
        );
        for length in [0, 36, 38, usize::MAX] {
            assert_eq!(
                checked_macos_boot_identity(0, length, &bytes),
                Err(NativeContinuousClockError::InvalidBootIdentity)
            );
        }
        bytes[36] = b'!';
        assert!(checked_macos_boot_identity(0, 37, &bytes).is_err());
        bytes[36] = 0;
        bytes[12] = 0;
        assert!(checked_macos_boot_identity(0, 37, &bytes).is_err());
    }

    #[test]
    fn nanoseconds_rejects_invalid_ranges_and_overflow() {
        for (seconds, nanos) in [
            (-1, 0),
            (0, -1),
            (0, 1_000_000_000),
            (i64::MAX, 0),
            (18_446_744_073, 709_551_616),
        ] {
            assert_eq!(
                nanoseconds(seconds, nanos),
                Err(NativeContinuousClockError::InvalidCounter)
            );
        }
        assert_eq!(nanoseconds(18_446_744_073, 709_551_615), Ok(u64::MAX));
        assert_eq!(nanoseconds(2, 3), Ok(2_000_000_003));
    }

    #[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
    #[test]
    fn actual_os_samples_have_same_boot_and_nondecreasing_ticks() {
        let first = capture_native_continuous_clock().unwrap();
        let second = capture_native_continuous_clock().unwrap();
        assert_eq!(first.clock_kind(), second.clock_kind());
        assert_eq!(first.boot_id(), second.boot_id());
        assert!(second.ticks() >= first.ticks());
    }
}
