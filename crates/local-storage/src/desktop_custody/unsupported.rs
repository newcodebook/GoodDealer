//! Private unsupported custody for local database keys, continuity receipts and device binding.

use super::DesktopCustodyError;

#[cfg(all(not(any(target_os = "macos", target_os = "linux")), not(test)))]
pub(super) fn load_device_binding_native() -> Result<Option<Vec<u8>>, DesktopCustodyError> {
    Err(DesktopCustodyError::Unavailable)
}

#[cfg(all(not(any(target_os = "macos", target_os = "linux")), not(test)))]
pub(super) fn load_native(
    _service: &str,
    _account: &str,
) -> Result<Option<Vec<u8>>, DesktopCustodyError> {
    Err(DesktopCustodyError::Unavailable)
}

#[cfg(all(not(any(target_os = "macos", target_os = "linux")), not(test)))]
pub(super) fn store_native(
    _service: &str,
    _account: &str,
    _value: &[u8],
) -> Result<(), DesktopCustodyError> {
    Err(DesktopCustodyError::Unavailable)
}
