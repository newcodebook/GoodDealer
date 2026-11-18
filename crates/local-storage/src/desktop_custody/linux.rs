//! Private linux custody for local database keys, continuity receipts and device binding.

#[cfg(test)]
use super::*;
#[cfg(not(test))]
use super::{DEVICE_IDENTITY_ACCOUNT, DEVICE_IDENTITY_SERVICE, DesktopCustodyError};

#[cfg(all(target_os = "linux", not(test)))]
pub(super) fn load_device_binding_native() -> Result<Option<Vec<u8>>, DesktopCustodyError> {
    load_native(DEVICE_IDENTITY_SERVICE, DEVICE_IDENTITY_ACCOUNT)
}

#[cfg(all(target_os = "linux", not(test)))]
fn secret_service_error(
    error: crate::secret_service_custody::SecretServiceError,
) -> DesktopCustodyError {
    match error {
        crate::secret_service_custody::SecretServiceError::Unavailable => {
            DesktopCustodyError::Unavailable
        }
        crate::secret_service_custody::SecretServiceError::Rejected => {
            DesktopCustodyError::Rejected
        }
    }
}

#[cfg(all(target_os = "linux", not(test)))]
pub(super) fn load_native(
    service: &str,
    account: &str,
) -> Result<Option<Vec<u8>>, DesktopCustodyError> {
    // Callers own zeroization of the returned bytes, matching the macOS adapter's contract.
    crate::secret_service_custody::load(service, account)
        .map(|value| value.map(|secret| secret.to_vec()))
        .map_err(secret_service_error)
}

#[cfg(all(target_os = "linux", not(test)))]
pub(super) fn store_native(
    service: &str,
    account: &str,
    value: &[u8],
) -> Result<(), DesktopCustodyError> {
    crate::secret_service_custody::store(service, account, value).map_err(secret_service_error)
}
