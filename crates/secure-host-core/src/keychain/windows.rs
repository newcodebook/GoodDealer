use super::{OsKeychainError, PlatformTarget};

// The generated windows 0.61 Credential Manager entry points are all `unsafe fn`. This crate's
// `#![forbid(unsafe_code)]` is a security boundary, so Windows remains fail-closed until the
// orchestrator authorizes a vetted safe wrapper. Keeping this target module explicit prevents a
// Linux/macOS build from accidentally implying that the Windows backend is live.
pub(super) fn replace(_target: &PlatformTarget, _secret: &[u8]) -> Result<(), OsKeychainError> {
    Err(OsKeychainError::unsupported_platform())
}

pub(super) fn load(_target: &PlatformTarget) -> Result<Option<Vec<u8>>, OsKeychainError> {
    Err(OsKeychainError::unsupported_platform())
}

pub(super) fn delete(_target: &PlatformTarget) -> Result<(), OsKeychainError> {
    Err(OsKeychainError::unsupported_platform())
}
