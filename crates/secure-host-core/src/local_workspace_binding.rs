//! OS-protected identity of the last server-verified local workspace.

use std::fmt::{Debug, Display, Formatter};

use serde::{Deserialize, Serialize};

const KEYCHAIN_SERVICE: &str = "com.gooddealer.desktop.local-workspace-binding";
const KEYCHAIN_ACCOUNT: &str = "verified-personal-workspace-v3";
const MAX_BINDING_BYTES: usize = 1_024;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
const CLOUDFLARE_CAPABILITY: &str = "cloudflare:dns:observe";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LocalWorkspaceBindingError {
    Unavailable,
    Rejected,
}

impl Display for LocalWorkspaceBindingError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::Unavailable => "LOCAL_WORKSPACE_BINDING_UNAVAILABLE",
            Self::Rejected => "LOCAL_WORKSPACE_BINDING_REJECTED",
        })
    }
}

impl std::error::Error for LocalWorkspaceBindingError {}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VerifiedLocalWorkspaceBinding {
    schema_version: u8,
    account_id: String,
    workspace_id: String,
    device_id: String,
    account_security_epoch: u64,
    lease_epoch: u64,
    trusted_time_floor: i64,
    entitlement_revision: u64,
    entitlement_projection_digest: String,
    commercial_expires_at: String,
    capability: String,
    access_state: LocalWorkspaceAccessState,
}

/// Inputs for constructing a server-verified local workspace binding.
///
/// All string fields are non-secret identity or signed-authority metadata. The constructor
/// validates every field before it can be persisted or used for local admission.
#[derive(Clone, Copy)]
pub struct VerifiedLocalWorkspaceBindingParams<'a> {
    pub account_id: &'a str,
    pub workspace_id: &'a str,
    pub device_id: &'a str,
    pub account_security_epoch: u64,
    pub lease_epoch: u64,
    pub trusted_time_floor: i64,
    pub entitlement_revision: u64,
    pub entitlement_projection_digest: &'a str,
    pub commercial_expires_at: &'a str,
}

#[derive(Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum LocalWorkspaceAccessState {
    Readable,
    RetryableLocked,
    SecurityLocked,
}

impl VerifiedLocalWorkspaceBinding {
    /// Constructs identity previously proven by a complete signed Desktop authorization Grant.
    ///
    /// # Errors
    ///
    /// Rejects malformed identities and unsafe epochs.
    pub fn new(
        params: VerifiedLocalWorkspaceBindingParams<'_>,
    ) -> Result<Self, LocalWorkspaceBindingError> {
        let binding = Self {
            schema_version: 3,
            account_id: params.account_id.to_owned(),
            workspace_id: params.workspace_id.to_owned(),
            device_id: params.device_id.to_owned(),
            account_security_epoch: params.account_security_epoch,
            lease_epoch: params.lease_epoch,
            trusted_time_floor: params.trusted_time_floor,
            entitlement_revision: params.entitlement_revision,
            entitlement_projection_digest: params.entitlement_projection_digest.to_owned(),
            commercial_expires_at: params.commercial_expires_at.to_owned(),
            capability: CLOUDFLARE_CAPABILITY.to_owned(),
            access_state: LocalWorkspaceAccessState::Readable,
        };
        binding.validate()?;
        Ok(binding)
    }

    #[must_use]
    pub fn account_id(&self) -> &str {
        &self.account_id
    }

    #[must_use]
    pub fn workspace_id(&self) -> &str {
        &self.workspace_id
    }

    #[must_use]
    pub fn device_id(&self) -> &str {
        &self.device_id
    }

    #[must_use]
    pub const fn account_security_epoch(&self) -> u64 {
        self.account_security_epoch
    }

    #[must_use]
    pub const fn lease_epoch(&self) -> u64 {
        self.lease_epoch
    }

    #[must_use]
    pub const fn trusted_time_floor(&self) -> i64 {
        self.trusted_time_floor
    }

    #[must_use]
    pub const fn entitlement_revision(&self) -> u64 {
        self.entitlement_revision
    }
    #[must_use]
    pub fn entitlement_projection_digest(&self) -> &str {
        &self.entitlement_projection_digest
    }
    #[must_use]
    pub fn commercial_expires_at(&self) -> &str {
        &self.commercial_expires_at
    }
    #[must_use]
    pub fn capability(&self) -> &str {
        &self.capability
    }

    #[must_use]
    pub const fn allows_local_read(&self) -> bool {
        matches!(self.access_state, LocalWorkspaceAccessState::Readable)
    }

    #[must_use]
    pub const fn allows_refresh_retry(&self) -> bool {
        matches!(
            self.access_state,
            LocalWorkspaceAccessState::RetryableLocked
        )
    }

    #[must_use]
    pub fn retryable_locked(&self) -> Self {
        let mut locked = self.clone();
        locked.access_state = LocalWorkspaceAccessState::RetryableLocked;
        locked
    }

    #[must_use]
    pub fn security_locked(&self) -> Self {
        let mut locked = self.clone();
        locked.access_state = LocalWorkspaceAccessState::SecurityLocked;
        locked
    }

    /// Advances the rollback-detection floor without changing workspace authority.
    ///
    /// # Errors
    ///
    /// Rejects a lower or otherwise invalid trusted timestamp.
    pub fn with_trusted_time_floor(
        &self,
        trusted_time_floor: i64,
    ) -> Result<Self, LocalWorkspaceBindingError> {
        if trusted_time_floor < self.trusted_time_floor {
            return Err(LocalWorkspaceBindingError::Rejected);
        }
        let mut advanced = self.clone();
        advanced.trusted_time_floor = trusted_time_floor;
        advanced.validate()?;
        Ok(advanced)
    }

    fn validate(&self) -> Result<(), LocalWorkspaceBindingError> {
        if self.schema_version != 3
            || !valid_identifier(&self.account_id)
            || !valid_identifier(&self.workspace_id)
            || !valid_identifier(&self.device_id)
            || self.account_security_epoch == 0
            || self.account_security_epoch > MAX_SAFE_INTEGER
            || self.lease_epoch == 0
            || self.lease_epoch > MAX_SAFE_INTEGER
            || self.trusted_time_floor < 0
            || self.entitlement_revision == 0
            || self.entitlement_revision > MAX_SAFE_INTEGER
            || !is_sha256_digest(&self.entitlement_projection_digest)
            || !is_canonical_timestamp(&self.commercial_expires_at)
            || self.capability != CLOUDFLARE_CAPABILITY
        {
            return Err(LocalWorkspaceBindingError::Rejected);
        }
        Ok(())
    }
}

impl Debug for VerifiedLocalWorkspaceBinding {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("VerifiedLocalWorkspaceBinding([REDACTED])")
    }
}

/// Loads the last server-verified binding. This grants only local read/export admission.
///
/// # Errors
///
/// Fails closed when the OS credential store or exact stored record is unavailable.
pub fn load_verified_local_workspace_binding()
-> Result<Option<VerifiedLocalWorkspaceBinding>, LocalWorkspaceBindingError> {
    let Some(stored) = load_native_binding()? else {
        return Ok(None);
    };
    if stored.len() > MAX_BINDING_BYTES {
        return Err(LocalWorkspaceBindingError::Rejected);
    }
    let binding: VerifiedLocalWorkspaceBinding =
        serde_json::from_slice(&stored).map_err(|_| LocalWorkspaceBindingError::Rejected)?;
    binding.validate()?;
    Ok(Some(binding))
}

/// Stores a binding only after native code verifies the signed Grant and Host device scope.
///
/// # Errors
///
/// Fails closed when serialization or the credential store is unavailable.
pub fn store_verified_local_workspace_binding(
    binding: &VerifiedLocalWorkspaceBinding,
) -> Result<(), LocalWorkspaceBindingError> {
    binding.validate()?;
    let encoded = serde_json::to_vec(binding).map_err(|_| LocalWorkspaceBindingError::Rejected)?;
    if encoded.len() > MAX_BINDING_BYTES {
        return Err(LocalWorkspaceBindingError::Rejected);
    }
    store_native_binding(&encoded)
}

/// Removes local read admission after an observed device or account-security revocation.
///
/// # Errors
///
/// Fails closed when the credential store cannot confirm removal.
pub fn clear_verified_local_workspace_binding() -> Result<(), LocalWorkspaceBindingError> {
    clear_native_binding()
}

#[cfg(target_os = "macos")]
fn load_native_binding() -> Result<Option<Vec<u8>>, LocalWorkspaceBindingError> {
    const ITEM_NOT_FOUND: i32 = -25_300;
    match security_framework::passwords::get_generic_password(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT) {
        Ok(value) => Ok(Some(value)),
        Err(error) if error.code() == ITEM_NOT_FOUND => Ok(None),
        Err(_) => Err(LocalWorkspaceBindingError::Unavailable),
    }
}

#[cfg(target_os = "macos")]
fn store_native_binding(value: &[u8]) -> Result<(), LocalWorkspaceBindingError> {
    security_framework::passwords::set_generic_password(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT, value)
        .map_err(|_| LocalWorkspaceBindingError::Unavailable)
}

#[cfg(target_os = "macos")]
fn clear_native_binding() -> Result<(), LocalWorkspaceBindingError> {
    const ITEM_NOT_FOUND: i32 = -25_300;
    match security_framework::passwords::delete_generic_password(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)
    {
        Ok(()) => Ok(()),
        Err(error) if error.code() == ITEM_NOT_FOUND => Ok(()),
        Err(_) => Err(LocalWorkspaceBindingError::Unavailable),
    }
}

#[cfg(target_os = "linux")]
fn secret_service_error(
    error: crate::secret_service_custody::SecretServiceError,
) -> LocalWorkspaceBindingError {
    match error {
        crate::secret_service_custody::SecretServiceError::Unavailable
        | crate::secret_service_custody::SecretServiceError::Rejected => LocalWorkspaceBindingError::Unavailable,
    }
}

#[cfg(target_os = "linux")]
fn load_native_binding() -> Result<Option<Vec<u8>>, LocalWorkspaceBindingError> {
    crate::secret_service_custody::load(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)
        .map(|value| value.map(|secret| secret.to_vec()))
        .map_err(secret_service_error)
}

#[cfg(target_os = "linux")]
fn store_native_binding(value: &[u8]) -> Result<(), LocalWorkspaceBindingError> {
    crate::secret_service_custody::store(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT, value)
        .map_err(secret_service_error)
}

#[cfg(target_os = "linux")]
fn clear_native_binding() -> Result<(), LocalWorkspaceBindingError> {
    crate::secret_service_custody::delete(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)
        .map_err(secret_service_error)
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn load_native_binding() -> Result<Option<Vec<u8>>, LocalWorkspaceBindingError> {
    let _ = (KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT);
    Err(LocalWorkspaceBindingError::Unavailable)
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn store_native_binding(_value: &[u8]) -> Result<(), LocalWorkspaceBindingError> {
    Err(LocalWorkspaceBindingError::Unavailable)
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn clear_native_binding() -> Result<(), LocalWorkspaceBindingError> {
    Err(LocalWorkspaceBindingError::Unavailable)
}

fn valid_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 160
        && value.bytes().all(|byte| (0x21..=0x7e).contains(&byte))
}

fn is_sha256_digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

fn is_canonical_timestamp(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 20
        || bytes[19] != b'Z'
        || bytes[4] != b'-'
        || bytes[7] != b'-'
        || bytes[10] != b'T'
        || bytes[13] != b':'
        || bytes[16] != b':'
        || !bytes[..19]
            .iter()
            .enumerate()
            .all(|(index, byte)| matches!(index, 4 | 7 | 10 | 13 | 16) || byte.is_ascii_digit())
    {
        return false;
    }
    let parse = |start: usize, end: usize| {
        std::str::from_utf8(&bytes[start..end])
            .ok()?
            .parse::<u32>()
            .ok()
    };
    let (Some(year), Some(month), Some(day), Some(hour), Some(minute), Some(second)) = (
        parse(0, 4),
        parse(5, 7),
        parse(8, 10),
        parse(11, 13),
        parse(14, 16),
        parse(17, 19),
    ) else {
        return false;
    };
    let leap_year =
        year.is_multiple_of(4) && (!year.is_multiple_of(100) || year.is_multiple_of(400));
    let last_day = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap_year => 29,
        2 => 28,
        _ => return false,
    };
    (1..=last_day).contains(&day) && hour < 24 && minute < 60 && second < 60
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_binding_round_trips_and_redacts_diagnostics() {
        let binding = VerifiedLocalWorkspaceBinding::new(
            VerifiedLocalWorkspaceBindingParams {
                account_id: "account-a",
                workspace_id: "workspace-a",
                device_id: "device-a",
                account_security_epoch: 3,
                lease_epoch: 7,
                trusted_time_floor: 1_788_192_000,
                entitlement_revision: 1,
                entitlement_projection_digest:
                    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                commercial_expires_at: "2026-08-30T00:00:00Z",
            },
        )
        .unwrap();
        let encoded = serde_json::to_vec(&binding).unwrap();
        let decoded: VerifiedLocalWorkspaceBinding = serde_json::from_slice(&encoded).unwrap();
        decoded.validate().unwrap();
        assert_eq!(decoded.workspace_id(), "workspace-a");
        assert_eq!(decoded.lease_epoch(), 7);
        assert_eq!(
            format!("{decoded:?}"),
            "VerifiedLocalWorkspaceBinding([REDACTED])"
        );
        assert!(!format!("{decoded:?}").contains("workspace-a"));
    }

    #[test]
    fn malformed_or_unknown_binding_data_is_rejected() {
        assert_eq!(
            VerifiedLocalWorkspaceBinding::new(
                VerifiedLocalWorkspaceBindingParams {
                    account_id: "",
                    workspace_id: "workspace-a",
                    device_id: "device-a",
                    account_security_epoch: 1,
                    lease_epoch: 1,
                    trusted_time_floor: 0,
                    entitlement_revision: 1,
                    entitlement_projection_digest:
                        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                    commercial_expires_at: "2026-08-30T00:00:00Z",
                }
            )
            .err()
            .unwrap(),
            LocalWorkspaceBindingError::Rejected
        );
        let unknown = br#"{"schemaVersion":3,"accountId":"account-a","workspaceId":"workspace-a","deviceId":"device-a","accountSecurityEpoch":1,"leaseEpoch":1,"trustedTimeFloor":1788192000,"accessState":"readable","extra":true}"#;
        assert!(serde_json::from_slice::<VerifiedLocalWorkspaceBinding>(unknown).is_err());
    }

    #[test]
    fn commercial_deadline_rejects_impossible_calendar_values() {
        for invalid in [
            "2026-00-01T00:00:00Z",
            "2026-02-29T00:00:00Z",
            "2026-04-31T00:00:00Z",
            "2026-12-01T24:00:00Z",
            "2026-12-01T23:60:00Z",
            "2026-12-01T23:59:60Z",
        ] {
            assert!(!is_canonical_timestamp(invalid), "accepted {invalid}");
        }
        assert!(is_canonical_timestamp("2028-02-29T23:59:59Z"));
    }
}
