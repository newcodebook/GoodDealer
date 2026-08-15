#![deny(unsafe_code)]

mod account_status;
mod active_device_lease_status;
mod bootstrap_steps;
pub mod device_identity;
mod drain;
pub mod endpoint_capability;
mod generated;
#[cfg(test)]
mod http_executor;
mod keychain;
mod runtime_gate;
pub mod secret;
mod session_store;
mod wire_envelope;
mod wire_scalar;

pub use account_status::{
    AccountGateCheck, AccountGateOutcome, AccountGateStatus, AccountLockReason,
    AccountSecurityState, AccountStatusValidationError, AuthRevocationReason, AuthSessionState,
    AuthSessionStatus, TrustedTimeState, validate_account_gate_status_json,
    validate_auth_session_status_json,
};
pub use active_device_lease_status::{
    ActiveDeviceLeaseStatus, ActiveDeviceLeaseStatusValidationError, LeaseRenewalState,
    validate_active_device_lease_status_json,
};
pub use bootstrap_steps::{
    BOOTSTRAP_STEP_SCHEMA_VERSION, BootstrapStepKind, BootstrapStepRequest, BootstrapStepResult,
    BootstrapStepValidationError, validate_bootstrap_step_request_json,
    validate_bootstrap_step_result_json,
};
pub use drain::{
    DRAIN_PROOF_SCHEMA_VERSION, DRAIN_STREAM_GENESIS_DIGEST, DRAIN_STREAM_GENESIS_DOMAIN,
    DrainManifest, DrainProof, DrainSequenceDomain, DrainStream, DrainValidationError,
    SynchronizedBackupDrainProof, advance_drain_chain_digest, drain_stream_genesis_digest,
    encode_account_device_audit_chain_domain, encode_device_audit_drain_envelope_json,
    encode_drain_chain_step_input, encode_drain_proof_digest_input,
    encode_drain_proof_signature_transcript, encode_drain_sequence_domain,
    encode_execution_fact_drain_envelope_json, encode_mutation_drain_envelope_json,
    encode_workspace_device_audit_chain_domain, validate_drain_manifest_json,
    validate_drain_proof_json,
};
pub use keychain::{
    DefaultKeychainPort, DenyingKeychainError, DenyingKeychainPort, KeychainNamespaceClass,
    OsKeychainAdapter, OsKeychainError,
};

pub use runtime_gate::{
    RuntimeGate, RuntimeStatusSnapshot, RuntimeStatusValidationError, validate_runtime_status_json,
};
pub use session_store::{
    AccountSessionKeychainScope, AuthEnvelopeValidationError, HostSessionStore, KeychainPort,
    KeychainWriteReceipt, RefreshTokenMaterial, SessionStoreError, SilentRecoveryRejection,
    StartupRefreshCredential, validate_auth_access_envelope_json,
    validate_auth_refresh_envelope_json,
};
pub use wire_envelope::{WireValidationError, validate_wire_envelope_json};

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeMode {
    Locked,
    Standby,
    Activating,
    Active,
    Draining,
    LocalContinuation,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ActivationPurpose {
    Bootstrap,
    LocalRecovery,
}

#[cfg(test)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CredentialHealth {
    RetainedUnverified,
    Healthy,
    Invalid,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlatformAction {
    Read,
    Write,
}

/// Test-only snapshot used by the Phase 0 executor fixture. It is intentionally neither `Clone`
/// nor public-constructible, but it does not yet model the production authoritative-state and
/// trusted-time revalidation required at consumption; therefore it cannot close R0-16.
#[cfg(test)]
pub struct PlatformAccessContext {
    runtime_mode: RuntimeMode,
    current_device_id: String,
    lease_device_id: String,
    lease_epoch: u64,
    current_lease_epoch: u64,
    trusted_time_seconds: u64,
    offline_execute_until_seconds: u64,
    permits_read: bool,
    permits_write: bool,
    credential_provider_connection_id: String,
}

#[cfg(test)]
impl PlatformAccessContext {
    /// Runtime-gate constructor. The caller must first verify the `ActiveDeviceLease` signature and
    /// derive trusted time; keeping this crate-private prevents IPC callers from minting authority.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn from_verified_active_lease(
        current_device_id: &str,
        lease_device_id: &str,
        lease_epoch: u64,
        current_lease_epoch: u64,
        trusted_time_seconds: u64,
        offline_execute_until_seconds: u64,
        permits_read: bool,
        permits_write: bool,
        credential_provider_connection_id: &str,
    ) -> Self {
        Self {
            runtime_mode: RuntimeMode::Active,
            current_device_id: current_device_id.to_owned(),
            lease_device_id: lease_device_id.to_owned(),
            lease_epoch,
            current_lease_epoch,
            trusted_time_seconds,
            offline_execute_until_seconds,
            permits_read,
            permits_write,
            credential_provider_connection_id: credential_provider_connection_id.to_owned(),
        }
    }

    #[cfg(test)]
    pub(crate) fn with_runtime_mode_for_test(mut self, runtime_mode: RuntimeMode) -> Self {
        self.runtime_mode = runtime_mode;
        self
    }

    #[must_use]
    pub(crate) fn current_device_id(&self) -> &str {
        &self.current_device_id
    }

    #[must_use]
    pub(crate) fn is_current_active_lease(&self) -> bool {
        self.runtime_mode == RuntimeMode::Active
            && self.current_device_id == self.lease_device_id
            && self.lease_epoch != 0
            && self.lease_epoch == self.current_lease_epoch
            && self.trusted_time_seconds <= self.offline_execute_until_seconds
    }

    #[must_use]
    pub(crate) fn can_resolve_endpoint(&self, provider_connection_id: &str) -> bool {
        self.is_current_active_lease()
            && self.credential_provider_connection_id == provider_connection_id
    }

    #[must_use]
    pub(crate) fn allows(&self, provider_connection_id: &str, action: PlatformAction) -> bool {
        self.is_current_active_lease()
            && self.credential_provider_connection_id == provider_connection_id
            && match action {
                PlatformAction::Read => self.permits_read,
                PlatformAction::Write => self.permits_write,
            }
    }
}
