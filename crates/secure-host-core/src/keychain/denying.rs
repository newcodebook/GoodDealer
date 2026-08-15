use std::fmt;

use crate::{
    AccountSessionKeychainScope, KeychainPort, KeychainWriteReceipt, RefreshTokenMaterial,
};

/// The compiled-in keychain default while the real-credential fallback remains in force.
///
/// No flag, environment variable, or fixture can make this type commit a credential write.
/// Its asymmetric load/delete behavior keeps memory-only sessions and sign-out usable.
///
/// ```compile_fail
/// use gooddealer_secure_host_core::DenyingKeychainPort;
/// let port = DenyingKeychainPort;
/// let _copy = port.clone();
/// ```
pub struct DenyingKeychainPort;

/// Fixed, input-free failure returned when durable credential writes are disabled.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum DenyingKeychainError {
    RealCredentialFlowDisabled,
}

impl Default for DenyingKeychainPort {
    fn default() -> Self {
        Self
    }
}

impl fmt::Debug for DenyingKeychainPort {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("DenyingKeychainPort([REDACTED])")
    }
}

impl fmt::Debug for DenyingKeychainError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("DenyingKeychainError::RealCredentialFlowDisabled")
    }
}

impl fmt::Display for DenyingKeychainError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("real credential persistence is disabled")
    }
}

impl KeychainPort for DenyingKeychainPort {
    type Error = DenyingKeychainError;

    fn replace_refresh_token(
        &mut self,
        _scope: AccountSessionKeychainScope<'_>,
        _refresh_token: &RefreshTokenMaterial,
    ) -> Result<KeychainWriteReceipt, Self::Error> {
        Err(DenyingKeychainError::RealCredentialFlowDisabled)
    }

    fn load_refresh_token(
        &mut self,
        _scope: AccountSessionKeychainScope<'_>,
    ) -> Result<Option<RefreshTokenMaterial>, Self::Error> {
        Ok(None)
    }

    fn delete_refresh_token(
        &mut self,
        _scope: AccountSessionKeychainScope<'_>,
    ) -> Result<KeychainWriteReceipt, Self::Error> {
        Ok(KeychainWriteReceipt::committed())
    }
}
