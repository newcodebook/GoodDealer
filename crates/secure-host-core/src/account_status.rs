use serde::{Deserialize, Deserializer, Serialize};

use crate::wire_scalar::{
    SafeUnsignedInteger, deserialize_required_option, is_canonical_utc_timestamp, is_identifier,
};

pub const AUTH_SESSION_SCHEMA_VERSION: u64 = 1;
pub const ACCOUNT_GATE_SCHEMA_VERSION: u64 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuthSessionState {
    SignedOut,
    Authenticated,
    RefreshRequired,
    ReauthRequired,
    Revoked,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuthRevocationReason {
    UserSignedOut,
    RemoteSignOut,
    RefreshReuseDetected,
    AccountSecurityEpochAdvanced,
    DeviceRemoved,
    AccountRecoveryPending,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthSessionStatus {
    schema_version: u64,
    state: AuthSessionState,
    account_id: Option<String>,
    device_id: Option<String>,
    account_security_epoch: Option<u64>,
    session_id: Option<String>,
    access_token_expires_at: Option<String>,
    refresh_rotation_generation: Option<u64>,
    last_trusted_time_at: Option<String>,
    revocation_reason: Option<AuthRevocationReason>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawAuthSessionStatus {
    schema_version: SafeUnsignedInteger,
    state: AuthSessionState,
    #[serde(deserialize_with = "deserialize_required_option")]
    account_id: Option<String>,
    #[serde(deserialize_with = "deserialize_required_option")]
    device_id: Option<String>,
    #[serde(deserialize_with = "deserialize_required_option")]
    account_security_epoch: Option<SafeUnsignedInteger>,
    #[serde(deserialize_with = "deserialize_required_option")]
    session_id: Option<String>,
    #[serde(deserialize_with = "deserialize_required_option")]
    access_token_expires_at: Option<String>,
    #[serde(deserialize_with = "deserialize_required_option")]
    refresh_rotation_generation: Option<SafeUnsignedInteger>,
    #[serde(deserialize_with = "deserialize_required_option")]
    last_trusted_time_at: Option<String>,
    #[serde(deserialize_with = "deserialize_required_option")]
    revocation_reason: Option<AuthRevocationReason>,
}

impl TryFrom<RawAuthSessionStatus> for AuthSessionStatus {
    type Error = ();

    fn try_from(raw: RawAuthSessionStatus) -> Result<Self, Self::Error> {
        let identifiers_are_valid = [&raw.account_id, &raw.device_id, &raw.session_id]
            .into_iter()
            .all(|value| value.as_deref().is_none_or(is_identifier));
        let timestamps_are_valid = [&raw.access_token_expires_at, &raw.last_trusted_time_at]
            .into_iter()
            .all(|value| value.as_deref().is_none_or(is_canonical_utc_timestamp));
        let positive_security_epoch = raw
            .account_security_epoch
            .is_none_or(|epoch| epoch.get() > 0);
        let signed_out_fields_are_null = raw.account_id.is_none()
            && raw.device_id.is_none()
            && raw.account_security_epoch.is_none()
            && raw.session_id.is_none()
            && raw.access_token_expires_at.is_none()
            && raw.refresh_rotation_generation.is_none()
            && raw.last_trusted_time_at.is_none()
            && raw.revocation_reason.is_none();
        let signed_in_identity_is_complete = raw.account_id.is_some()
            && raw.device_id.is_some()
            && raw.account_security_epoch.is_some()
            && raw.session_id.is_some()
            && raw.last_trusted_time_at.is_some();
        let state_fields_are_valid = if raw.state == AuthSessionState::SignedOut {
            signed_out_fields_are_null
        } else {
            signed_in_identity_is_complete
        };
        let revocation_reason_agrees =
            raw.revocation_reason.is_some() == (raw.state == AuthSessionState::Revoked);
        let token_expiry_is_present = !matches!(
            raw.state,
            AuthSessionState::Authenticated | AuthSessionState::RefreshRequired
        ) || raw.access_token_expires_at.is_some();

        if raw.schema_version.get() != AUTH_SESSION_SCHEMA_VERSION
            || !identifiers_are_valid
            || !timestamps_are_valid
            || !positive_security_epoch
            || !state_fields_are_valid
            || !revocation_reason_agrees
            || !token_expiry_is_present
        {
            return Err(());
        }

        Ok(Self {
            schema_version: raw.schema_version.get(),
            state: raw.state,
            account_id: raw.account_id,
            device_id: raw.device_id,
            account_security_epoch: raw.account_security_epoch.map(SafeUnsignedInteger::get),
            session_id: raw.session_id,
            access_token_expires_at: raw.access_token_expires_at,
            refresh_rotation_generation: raw
                .refresh_rotation_generation
                .map(SafeUnsignedInteger::get),
            last_trusted_time_at: raw.last_trusted_time_at,
            revocation_reason: raw.revocation_reason,
        })
    }
}

impl<'de> Deserialize<'de> for AuthSessionStatus {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        Self::try_from(RawAuthSessionStatus::deserialize(deserializer)?)
            .map_err(|()| serde::de::Error::custom("invalid auth session status"))
    }
}

impl AuthSessionStatus {
    #[must_use]
    pub const fn state(&self) -> AuthSessionState {
        self.state
    }

    #[must_use]
    pub fn account_id(&self) -> Option<&str> {
        self.account_id.as_deref()
    }

    #[must_use]
    pub fn device_id(&self) -> Option<&str> {
        self.device_id.as_deref()
    }

    #[must_use]
    pub const fn account_security_epoch(&self) -> Option<u64> {
        self.account_security_epoch
    }

    #[must_use]
    pub fn session_id(&self) -> Option<&str> {
        self.session_id.as_deref()
    }

    #[must_use]
    pub fn access_token_expires_at(&self) -> Option<&str> {
        self.access_token_expires_at.as_deref()
    }

    #[must_use]
    pub const fn refresh_rotation_generation(&self) -> Option<u64> {
        self.refresh_rotation_generation
    }

    #[must_use]
    pub fn last_trusted_time_at(&self) -> Option<&str> {
        self.last_trusted_time_at.as_deref()
    }

    #[must_use]
    pub const fn revocation_reason(&self) -> Option<AuthRevocationReason> {
        self.revocation_reason
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AccountGateOutcome {
    Locked,
    StandbyEligible,
    ActiveEligible,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AccountLockReason {
    EntitlementExpired,
    DeviceRemoved,
    OfflineLeaseExpired,
    LocalIntegrityFailure,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AccountGateCheck {
    Pass,
    Fail,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AccountSecurityState {
    Normal,
    RecoveryPending,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TrustedTimeState {
    Trusted,
    ClockRollbackSuspected,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountGateStatus {
    schema_version: u64,
    outcome: AccountGateOutcome,
    lock_reason: Option<AccountLockReason>,
    account_check: AccountGateCheck,
    device_binding_check: AccountGateCheck,
    entitlement_check: AccountGateCheck,
    active_lease_check: AccountGateCheck,
    account_security_state: AccountSecurityState,
    trusted_time_state: TrustedTimeState,
    evaluated_at: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawAccountGateStatus {
    schema_version: SafeUnsignedInteger,
    outcome: AccountGateOutcome,
    #[serde(deserialize_with = "deserialize_required_option")]
    lock_reason: Option<AccountLockReason>,
    account_check: AccountGateCheck,
    device_binding_check: AccountGateCheck,
    entitlement_check: AccountGateCheck,
    active_lease_check: AccountGateCheck,
    account_security_state: AccountSecurityState,
    trusted_time_state: TrustedTimeState,
    evaluated_at: String,
}

impl TryFrom<RawAccountGateStatus> for AccountGateStatus {
    type Error = ();

    fn try_from(raw: RawAccountGateStatus) -> Result<Self, Self::Error> {
        let primary_checks = [
            raw.account_check,
            raw.device_binding_check,
            raw.entitlement_check,
        ];
        let outcome_is_valid = match raw.outcome {
            AccountGateOutcome::ActiveEligible => primary_checks
                .into_iter()
                .chain([raw.active_lease_check])
                .all(|check| check == AccountGateCheck::Pass),
            AccountGateOutcome::StandbyEligible => {
                primary_checks
                    .into_iter()
                    .all(|check| check == AccountGateCheck::Pass)
                    && raw.active_lease_check == AccountGateCheck::Fail
            }
            AccountGateOutcome::Locked => {
                !primary_checks
                    .into_iter()
                    .all(|check| check == AccountGateCheck::Pass)
                    || raw.lock_reason == Some(AccountLockReason::LocalIntegrityFailure)
            }
        };
        let lock_reason_agrees =
            raw.lock_reason.is_some() == (raw.outcome == AccountGateOutcome::Locked);

        if raw.schema_version.get() != ACCOUNT_GATE_SCHEMA_VERSION
            || !is_canonical_utc_timestamp(&raw.evaluated_at)
            || !outcome_is_valid
            || !lock_reason_agrees
        {
            return Err(());
        }

        Ok(Self {
            schema_version: raw.schema_version.get(),
            outcome: raw.outcome,
            lock_reason: raw.lock_reason,
            account_check: raw.account_check,
            device_binding_check: raw.device_binding_check,
            entitlement_check: raw.entitlement_check,
            active_lease_check: raw.active_lease_check,
            account_security_state: raw.account_security_state,
            trusted_time_state: raw.trusted_time_state,
            evaluated_at: raw.evaluated_at,
        })
    }
}

impl<'de> Deserialize<'de> for AccountGateStatus {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        Self::try_from(RawAccountGateStatus::deserialize(deserializer)?)
            .map_err(|()| serde::de::Error::custom("invalid account gate status"))
    }
}

impl AccountGateStatus {
    #[must_use]
    pub const fn outcome(&self) -> AccountGateOutcome {
        self.outcome
    }

    #[must_use]
    pub const fn lock_reason(&self) -> Option<AccountLockReason> {
        self.lock_reason
    }

    #[must_use]
    pub const fn account_check(&self) -> AccountGateCheck {
        self.account_check
    }

    #[must_use]
    pub const fn device_binding_check(&self) -> AccountGateCheck {
        self.device_binding_check
    }

    #[must_use]
    pub const fn entitlement_check(&self) -> AccountGateCheck {
        self.entitlement_check
    }

    #[must_use]
    pub const fn active_lease_check(&self) -> AccountGateCheck {
        self.active_lease_check
    }

    #[must_use]
    pub const fn account_security_state(&self) -> AccountSecurityState {
        self.account_security_state
    }

    #[must_use]
    pub const fn trusted_time_state(&self) -> TrustedTimeState {
        self.trusted_time_state
    }

    #[must_use]
    pub fn evaluated_at(&self) -> &str {
        &self.evaluated_at
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AccountStatusValidationError {
    InvalidJson,
    InvalidStatus,
}

/// Parses and semantically validates the strict Rust mirror of `AuthSessionStatus`.
///
/// # Errors
///
/// Returns [`AccountStatusValidationError::InvalidJson`] for malformed or structurally invalid
/// wire data, and [`AccountStatusValidationError::InvalidStatus`] when a cross-field invariant
/// from the frozen TypeScript contract is violated.
pub fn validate_auth_session_status_json(
    source: &str,
) -> Result<AuthSessionStatus, AccountStatusValidationError> {
    let raw: RawAuthSessionStatus =
        serde_json::from_str(source).map_err(|_| AccountStatusValidationError::InvalidJson)?;
    AuthSessionStatus::try_from(raw).map_err(|()| AccountStatusValidationError::InvalidStatus)
}

/// Parses and semantically validates the strict Rust mirror of `AccountGateStatus`.
///
/// # Errors
///
/// Returns [`AccountStatusValidationError::InvalidJson`] for malformed or structurally invalid
/// wire data, and [`AccountStatusValidationError::InvalidStatus`] when a cross-field invariant
/// from the frozen TypeScript contract is violated.
pub fn validate_account_gate_status_json(
    source: &str,
) -> Result<AccountGateStatus, AccountStatusValidationError> {
    let raw: RawAccountGateStatus =
        serde_json::from_str(source).map_err(|_| AccountStatusValidationError::InvalidJson)?;
    AccountGateStatus::try_from(raw).map_err(|()| AccountStatusValidationError::InvalidStatus)
}

#[cfg(test)]
mod tests {
    use super::{
        AccountGateStatus, AuthSessionStatus, validate_account_gate_status_json,
        validate_auth_session_status_json,
    };

    const VALID_AUTH_SESSION_VECTORS: [(&str, &str); 4] = [
        (
            "auth-session-authenticated.json",
            include_str!(
                "../../../packages/protocol/test-vectors/account/valid/auth-session-authenticated.json"
            ),
        ),
        (
            "auth-session-signed-out.json",
            include_str!(
                "../../../packages/protocol/test-vectors/account/valid/auth-session-signed-out.json"
            ),
        ),
        (
            "auth-session-revoked.json",
            include_str!(
                "../../../packages/protocol/test-vectors/account/valid/auth-session-revoked.json"
            ),
        ),
        (
            "auth-session-refresh-required.json",
            include_str!(
                "../../../packages/protocol/test-vectors/account/valid/auth-session-refresh-required.json"
            ),
        ),
    ];
    const INVALID_AUTH_SESSION_VECTORS: [(&str, &str); 8] = [
        (
            "auth-session-signed-out-with-account.json",
            include_str!(
                "../../../packages/protocol/test-vectors/account/invalid/auth-session-signed-out-with-account.json"
            ),
        ),
        (
            "auth-session-authenticated-missing-epoch.json",
            include_str!(
                "../../../packages/protocol/test-vectors/account/invalid/auth-session-authenticated-missing-epoch.json"
            ),
        ),
        (
            "auth-session-revocation-reason-without-revoked.json",
            include_str!(
                "../../../packages/protocol/test-vectors/account/invalid/auth-session-revocation-reason-without-revoked.json"
            ),
        ),
        (
            "auth-session-authenticated-without-expiry.json",
            include_str!(
                "../../../packages/protocol/test-vectors/account/invalid/auth-session-authenticated-without-expiry.json"
            ),
        ),
        (
            "auth-session-unknown-field.json",
            include_str!(
                "../../../packages/protocol/test-vectors/account/invalid/auth-session-unknown-field.json"
            ),
        ),
        (
            "auth-session-unknown-version.json",
            include_str!(
                "../../../packages/protocol/test-vectors/account/invalid/auth-session-unknown-version.json"
            ),
        ),
        (
            "auth-session-snake-case-wire.json",
            include_str!(
                "../../../packages/protocol/test-vectors/account/invalid/auth-session-snake-case-wire.json"
            ),
        ),
        (
            "auth-session-unsafe-epoch.json",
            include_str!(
                "../../../packages/protocol/test-vectors/account/invalid/auth-session-unsafe-epoch.json"
            ),
        ),
    ];
    const VALID_ACCOUNT_GATE_VECTORS: [(&str, &str); 3] = [
        (
            "gate-active-eligible.json",
            include_str!(
                "../../../packages/protocol/test-vectors/account/valid/gate-active-eligible.json"
            ),
        ),
        (
            "gate-standby-eligible.json",
            include_str!(
                "../../../packages/protocol/test-vectors/account/valid/gate-standby-eligible.json"
            ),
        ),
        (
            "gate-locked.json",
            include_str!("../../../packages/protocol/test-vectors/account/valid/gate-locked.json"),
        ),
    ];
    const INVALID_ACCOUNT_GATE_VECTORS: [(&str, &str); 5] = [
        (
            "gate-active-with-failed-check.json",
            include_str!(
                "../../../packages/protocol/test-vectors/account/invalid/gate-active-with-failed-check.json"
            ),
        ),
        (
            "gate-standby-with-active-lease-pass.json",
            include_str!(
                "../../../packages/protocol/test-vectors/account/invalid/gate-standby-with-active-lease-pass.json"
            ),
        ),
        (
            "gate-locked-without-reason.json",
            include_str!(
                "../../../packages/protocol/test-vectors/account/invalid/gate-locked-without-reason.json"
            ),
        ),
        (
            "gate-reason-without-locked.json",
            include_str!(
                "../../../packages/protocol/test-vectors/account/invalid/gate-reason-without-locked.json"
            ),
        ),
        (
            "gate-locked-all-checks-pass.json",
            include_str!(
                "../../../packages/protocol/test-vectors/account/invalid/gate-locked-all-checks-pass.json"
            ),
        ),
    ];

    #[test]
    fn mirrors_auth_session_status_typescript_verdicts_per_vector() {
        for (name, vector) in VALID_AUTH_SESSION_VECTORS {
            assert!(
                validate_auth_session_status_json(vector).is_ok(),
                "TypeScript accepts valid/{name}"
            );
            assert!(
                serde_json::from_str::<AuthSessionStatus>(vector).is_ok(),
                "Serde must preserve the fail-closed verdict for valid/{name}"
            );
        }
        for (name, vector) in INVALID_AUTH_SESSION_VECTORS {
            assert!(
                validate_auth_session_status_json(vector).is_err(),
                "TypeScript rejects invalid/{name}"
            );
            assert!(
                serde_json::from_str::<AuthSessionStatus>(vector).is_err(),
                "Serde must preserve the fail-closed verdict for invalid/{name}"
            );
        }
    }

    #[test]
    fn mirrors_account_gate_status_typescript_verdicts_per_vector() {
        for (name, vector) in VALID_ACCOUNT_GATE_VECTORS {
            assert!(
                validate_account_gate_status_json(vector).is_ok(),
                "TypeScript accepts valid/{name}"
            );
            assert!(
                serde_json::from_str::<AccountGateStatus>(vector).is_ok(),
                "Serde must preserve the fail-closed verdict for valid/{name}"
            );
        }
        for (name, vector) in INVALID_ACCOUNT_GATE_VECTORS {
            assert!(
                validate_account_gate_status_json(vector).is_err(),
                "TypeScript rejects invalid/{name}"
            );
            assert!(
                serde_json::from_str::<AccountGateStatus>(vector).is_err(),
                "Serde must preserve the fail-closed verdict for invalid/{name}"
            );
        }
    }

    #[test]
    fn rejects_missing_required_nullable_fields() {
        let mut auth: serde_json::Value = serde_json::from_str(VALID_AUTH_SESSION_VECTORS[0].1)
            .expect("shared vector is valid JSON");
        auth.as_object_mut()
            .expect("shared vector is an object")
            .remove("revocationReason");
        assert!(serde_json::from_value::<AuthSessionStatus>(auth).is_err());

        let mut gate: serde_json::Value = serde_json::from_str(VALID_ACCOUNT_GATE_VECTORS[0].1)
            .expect("shared vector is valid JSON");
        gate.as_object_mut()
            .expect("shared vector is an object")
            .remove("lockReason");
        assert!(serde_json::from_value::<AccountGateStatus>(gate).is_err());
    }

    #[test]
    fn rejects_mutated_literal_enum_and_scalar_boundaries() {
        let mut auth: serde_json::Value = serde_json::from_str(VALID_AUTH_SESSION_VECTORS[0].1)
            .expect("shared vector is valid JSON");
        auth["state"] = serde_json::Value::String("unknown".to_owned());
        assert!(serde_json::from_value::<AuthSessionStatus>(auth).is_err());

        let mut gate: serde_json::Value = serde_json::from_str(VALID_ACCOUNT_GATE_VECTORS[0].1)
            .expect("shared vector is valid JSON");
        gate["schemaVersion"] = serde_json::Value::from(2);
        assert!(serde_json::from_value::<AccountGateStatus>(gate).is_err());

        let mut gate: serde_json::Value = serde_json::from_str(VALID_ACCOUNT_GATE_VECTORS[0].1)
            .expect("shared vector is valid JSON");
        gate["evaluatedAt"] = serde_json::Value::String("2026-02-30T11:00:00Z".to_owned());
        assert!(serde_json::from_value::<AccountGateStatus>(gate).is_err());
    }
}
