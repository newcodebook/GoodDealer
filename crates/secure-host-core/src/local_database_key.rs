//! Purpose-isolated `SQLCipher` key lifecycle backed by the native OS credential store.

use std::fmt::{Debug, Display, Formatter};

use zeroize::Zeroizing;

const DATABASE_KEY_BYTES: usize = 32;
const KEYCHAIN_SERVICE: &str = "com.gooddealer.desktop.local-database";
const KEYCHAIN_ACCOUNT: &str = "active-workspace-sqlcipher-v1";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LocalDatabaseKeyError {
    Unavailable,
    Rejected,
    RandomUnavailable,
}

impl Display for LocalDatabaseKeyError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::Unavailable => "LOCAL_KEYCHAIN_UNAVAILABLE",
            Self::Rejected => "LOCAL_DATABASE_KEY_REJECTED",
            Self::RandomUnavailable => "LOCAL_RANDOM_UNAVAILABLE",
        })
    }
}

impl std::error::Error for LocalDatabaseKeyError {}

pub struct LocalDatabaseKeyMaterial(Zeroizing<[u8; DATABASE_KEY_BYTES]>);

impl LocalDatabaseKeyMaterial {
    /// Copies key bytes into the local `SQLCipher` adapter at the final native composition boundary.
    #[must_use]
    pub fn copy_for_sqlcipher(&self) -> [u8; DATABASE_KEY_BYTES] {
        *self.0
    }

    fn from_stored(mut stored: Vec<u8>) -> Result<Self, LocalDatabaseKeyError> {
        let bytes = stored
            .as_slice()
            .try_into()
            .map_err(|_| LocalDatabaseKeyError::Rejected)?;
        stored.fill(0);
        Ok(Self(Zeroizing::new(bytes)))
    }
}

impl Debug for LocalDatabaseKeyMaterial {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("LocalDatabaseKeyMaterial([REDACTED])")
    }
}

/// Loads the fixed-purpose Desktop `SQLCipher` key from the OS credential store.
///
/// # Errors
///
/// Returns a stable error when the credential store is unavailable or contains malformed material.
pub fn load_local_database_key() -> Result<Option<LocalDatabaseKeyMaterial>, LocalDatabaseKeyError>
{
    load_native_key()?
        .map(LocalDatabaseKeyMaterial::from_stored)
        .transpose()
}

/// Generates, stores, re-reads, and returns the fixed-purpose Desktop `SQLCipher` key.
///
/// # Errors
///
/// Returns a stable error when secure randomness or the OS credential store is unavailable.
pub fn generate_local_database_key() -> Result<LocalDatabaseKeyMaterial, LocalDatabaseKeyError> {
    let mut generated = Zeroizing::new([0_u8; DATABASE_KEY_BYTES]);
    getrandom::fill(&mut *generated).map_err(|_| LocalDatabaseKeyError::RandomUnavailable)?;
    store_native_key(&generated[..])?;
    load_local_database_key()?.ok_or(LocalDatabaseKeyError::Unavailable)
}

#[cfg(target_os = "macos")]
fn load_native_key() -> Result<Option<Vec<u8>>, LocalDatabaseKeyError> {
    const ITEM_NOT_FOUND: i32 = -25_300;
    match security_framework::passwords::get_generic_password(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT) {
        Ok(value) => Ok(Some(value)),
        Err(error) if error.code() == ITEM_NOT_FOUND => Ok(None),
        Err(_) => Err(LocalDatabaseKeyError::Unavailable),
    }
}

#[cfg(target_os = "macos")]
fn store_native_key(key: &[u8]) -> Result<(), LocalDatabaseKeyError> {
    security_framework::passwords::set_generic_password(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT, key)
        .map_err(|_| LocalDatabaseKeyError::Unavailable)
}

#[cfg(not(target_os = "macos"))]
fn load_native_key() -> Result<Option<Vec<u8>>, LocalDatabaseKeyError> {
    let _ = (KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT);
    Err(LocalDatabaseKeyError::Unavailable)
}

#[cfg(not(target_os = "macos"))]
fn store_native_key(_key: &[u8]) -> Result<(), LocalDatabaseKeyError> {
    Err(LocalDatabaseKeyError::Unavailable)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_material_rejects_wrong_lengths_and_redacts_debug_output() {
        assert_eq!(
            LocalDatabaseKeyMaterial::from_stored(vec![0x51; DATABASE_KEY_BYTES - 1])
                .err()
                .unwrap(),
            LocalDatabaseKeyError::Rejected
        );
        let material =
            LocalDatabaseKeyMaterial::from_stored(vec![0x51; DATABASE_KEY_BYTES]).unwrap();
        assert_eq!(
            format!("{material:?}"),
            "LocalDatabaseKeyMaterial([REDACTED])"
        );
        assert!(!format!("{material:?}").contains("51"));
    }
}
