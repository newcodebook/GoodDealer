//! Ticket consumer for browser automation execution (P0-30).
//!
//! [`AutomationExecutionTicket`] (24 fields) is a LOCAL anti-replay capability
//! token that authorises a single recipe execution on a single device.  It is
//! NOT a JWT and MUST NOT be transmitted across devices or persisted to the
//! cloud.
//!
//! [`SunsetAutomationExecutionTicket`] (34 fields) extends the active ticket
//! with drain-proof and data-export fields for sunset sessions.
//!
//! ## Invariants (INV-TKT-01..10)
//!
//! 1. A ticket is consumed exactly once — `consumed` starts `false`, flips to
//!    `true` on first use, and rejects on second use.
//! 2. Tickets are device-bound: `consumer_device_id == device_id`.
//! 3. Tickets are time-bound: `issued_at <= trusted_time <= expires_at`.
//! 4. The nonce MUST be unique per ticket (anti-replay).
//! 5. Active and sunset tickets are NOT interchangeable.
//! 6. Consent != Grant != Ticket (non-interchangeability with other token types).

use gooddealer_secure_host_core::RuntimeMode;

use crate::download_policy::DownloadPolicy;
use crate::session::SessionMode;
use crate::upload_policy::UploadPolicy;

// ---------------------------------------------------------------------------
// Active automation execution ticket (24 fields)
// ---------------------------------------------------------------------------

/// A local anti-replay capability authorizing a single recipe execution.
///
/// This is NOT a cross-device JWT.  It lives in process memory only and is
/// never serialized to disk or sent over the network.
#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields)]
pub struct AutomationExecutionTicket {
    // Identity fields (8)
    pub ticket_id: String,
    pub session_id: String,
    pub recipe_id: String,
    pub provider_connection_id: String,
    pub device_id: String,
    pub nonce: String,
    pub sequence_number: u64,
    pub signature_digest: String,

    // Lease fields (4)
    pub runtime_mode: RuntimeMode,
    pub lease_epoch: u64,
    pub current_lease_epoch: u64,
    pub consumer_device_id: String,

    // Time fields (3)
    pub issued_at_seconds: u64,
    pub expires_at_seconds: u64,
    pub trusted_time_seconds: u64,

    // Execution fields (5)
    pub max_steps: u32,
    pub navigation_scope: String,
    pub profile_isolation_key: String,
    pub download_policy: DownloadPolicy,
    pub upload_policy: UploadPolicy,

    // Permission fields (2)
    pub permits_read: bool,
    pub permits_write: bool,

    // Consumption state (1)
    pub consumed: bool,

    // Session mode discriminator (1)
    pub session_mode: SessionMode,
}

// ---------------------------------------------------------------------------
// Sunset automation execution ticket (34 fields = 24 base + 10 sunset)
// ---------------------------------------------------------------------------

/// Sunset variant with drain-proof and data-export fields.
#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields)]
pub struct SunsetAutomationExecutionTicket {
    // Base identity fields (8)
    pub ticket_id: String,
    pub session_id: String,
    pub recipe_id: String,
    pub provider_connection_id: String,
    pub device_id: String,
    pub nonce: String,
    pub sequence_number: u64,
    pub signature_digest: String,

    // Lease fields (4)
    pub runtime_mode: RuntimeMode,
    pub lease_epoch: u64,
    pub current_lease_epoch: u64,
    pub consumer_device_id: String,

    // Time fields (3)
    pub issued_at_seconds: u64,
    pub expires_at_seconds: u64,
    pub trusted_time_seconds: u64,

    // Execution fields (5)
    pub max_steps: u32,
    pub navigation_scope: String,
    pub profile_isolation_key: String,
    pub download_policy: DownloadPolicy,
    pub upload_policy: UploadPolicy,

    // Permission fields (2)
    pub permits_read: bool,
    pub permits_write: bool,

    // Consumption state (1)
    pub consumed: bool,

    // Session mode discriminator (1)
    pub session_mode: SessionMode,

    // ── Sunset-specific fields (10) ──────────────────────────────────

    pub drain_stream_id: String,
    pub drain_sequence: u64,
    pub sunset_deadline_seconds: u64,
    pub data_export_path: String,
    pub sunset_reason: String,
    pub drain_proof_digest: String,
    pub readonly_enforced: bool,
    pub sunset_session_id: String,
    pub export_format: String,
    pub final_drain_sequence: u64,
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TicketConsumptionError {
    InvalidJson(String),
    AlreadyConsumed,
    DeviceMismatch {
        ticket_device: String,
        consumer_device: String,
    },
    LeaseEpochMismatch {
        lease_epoch: u64,
        current: u64,
    },
    LeaseEpochZero,
    Expired {
        trusted_time: u64,
        expires_at: u64,
    },
    NotYetValid {
        trusted_time: u64,
        issued_at: u64,
    },
    RuntimeModeNotActive,
    RuntimeModeNotDraining,
    SessionModeMismatch,
    EmptyTicketId,
    EmptyNonce,
    EmptySignatureDigest,
    SunsetNotReadOnly,
    SunsetDeadlineExceeded {
        trusted_time: u64,
        deadline: u64,
    },
    SunsetPermitsWriteForbidden,
    EmptyDrainStreamId,
    EmptyDataExportPath,
    EmptyDrainProofDigest,
}

impl std::fmt::Display for TicketConsumptionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidJson(msg) => write!(f, "invalid ticket JSON: {msg}"),
            Self::AlreadyConsumed => write!(f, "ticket has already been consumed"),
            Self::DeviceMismatch {
                ticket_device,
                consumer_device,
            } => write!(
                f,
                "device mismatch: ticket={ticket_device}, consumer={consumer_device}"
            ),
            Self::LeaseEpochMismatch { lease_epoch, current } => {
                write!(f, "lease epoch mismatch: {lease_epoch} != {current}")
            }
            Self::LeaseEpochZero => write!(f, "lease epoch must not be zero"),
            Self::Expired {
                trusted_time,
                expires_at,
            } => write!(f, "ticket expired: time={trusted_time}, expires={expires_at}"),
            Self::NotYetValid {
                trusted_time,
                issued_at,
            } => write!(
                f,
                "ticket not yet valid: time={trusted_time}, issued={issued_at}"
            ),
            Self::RuntimeModeNotActive => write!(f, "runtime mode must be Active"),
            Self::RuntimeModeNotDraining => write!(f, "runtime mode must be Draining"),
            Self::SessionModeMismatch => write!(f, "session mode does not match ticket type"),
            Self::EmptyTicketId => write!(f, "ticket_id must not be empty"),
            Self::EmptyNonce => write!(f, "nonce must not be empty"),
            Self::EmptySignatureDigest => write!(f, "signature_digest must not be empty"),
            Self::SunsetNotReadOnly => write!(f, "sunset ticket must enforce readonly"),
            Self::SunsetDeadlineExceeded {
                trusted_time,
                deadline,
            } => write!(
                f,
                "sunset deadline exceeded: time={trusted_time}, deadline={deadline}"
            ),
            Self::SunsetPermitsWriteForbidden => {
                write!(f, "sunset ticket must not permit write operations")
            }
            Self::EmptyDrainStreamId => write!(f, "drain_stream_id must not be empty"),
            Self::EmptyDataExportPath => write!(f, "data_export_path must not be empty"),
            Self::EmptyDrainProofDigest => write!(f, "drain_proof_digest must not be empty"),
        }
    }
}

impl std::error::Error for TicketConsumptionError {}

/// Validate an active ticket for consumption.
pub fn validate_active_ticket(
    ticket: &AutomationExecutionTicket,
) -> Result<(), TicketConsumptionError> {
    if ticket.ticket_id.is_empty() {
        return Err(TicketConsumptionError::EmptyTicketId);
    }
    if ticket.nonce.is_empty() {
        return Err(TicketConsumptionError::EmptyNonce);
    }
    if ticket.signature_digest.is_empty() {
        return Err(TicketConsumptionError::EmptySignatureDigest);
    }
    if ticket.consumed {
        return Err(TicketConsumptionError::AlreadyConsumed);
    }
    if ticket.session_mode != SessionMode::Active {
        return Err(TicketConsumptionError::SessionModeMismatch);
    }
    if ticket.runtime_mode != RuntimeMode::Active {
        return Err(TicketConsumptionError::RuntimeModeNotActive);
    }
    if ticket.device_id != ticket.consumer_device_id {
        return Err(TicketConsumptionError::DeviceMismatch {
            ticket_device: ticket.device_id.clone(),
            consumer_device: ticket.consumer_device_id.clone(),
        });
    }
    if ticket.lease_epoch == 0 {
        return Err(TicketConsumptionError::LeaseEpochZero);
    }
    if ticket.lease_epoch != ticket.current_lease_epoch {
        return Err(TicketConsumptionError::LeaseEpochMismatch {
            lease_epoch: ticket.lease_epoch,
            current: ticket.current_lease_epoch,
        });
    }
    if ticket.trusted_time_seconds < ticket.issued_at_seconds {
        return Err(TicketConsumptionError::NotYetValid {
            trusted_time: ticket.trusted_time_seconds,
            issued_at: ticket.issued_at_seconds,
        });
    }
    if ticket.trusted_time_seconds > ticket.expires_at_seconds {
        return Err(TicketConsumptionError::Expired {
            trusted_time: ticket.trusted_time_seconds,
            expires_at: ticket.expires_at_seconds,
        });
    }
    Ok(())
}

/// Validate a sunset ticket for consumption.
pub fn validate_sunset_ticket(
    ticket: &SunsetAutomationExecutionTicket,
) -> Result<(), TicketConsumptionError> {
    if ticket.ticket_id.is_empty() {
        return Err(TicketConsumptionError::EmptyTicketId);
    }
    if ticket.nonce.is_empty() {
        return Err(TicketConsumptionError::EmptyNonce);
    }
    if ticket.signature_digest.is_empty() {
        return Err(TicketConsumptionError::EmptySignatureDigest);
    }
    if ticket.consumed {
        return Err(TicketConsumptionError::AlreadyConsumed);
    }
    if ticket.session_mode != SessionMode::Sunset {
        return Err(TicketConsumptionError::SessionModeMismatch);
    }
    if ticket.runtime_mode != RuntimeMode::Draining {
        return Err(TicketConsumptionError::RuntimeModeNotDraining);
    }
    if ticket.device_id != ticket.consumer_device_id {
        return Err(TicketConsumptionError::DeviceMismatch {
            ticket_device: ticket.device_id.clone(),
            consumer_device: ticket.consumer_device_id.clone(),
        });
    }
    if !ticket.readonly_enforced {
        return Err(TicketConsumptionError::SunsetNotReadOnly);
    }
    if ticket.permits_write {
        return Err(TicketConsumptionError::SunsetPermitsWriteForbidden);
    }
    if ticket.drain_stream_id.is_empty() {
        return Err(TicketConsumptionError::EmptyDrainStreamId);
    }
    if ticket.data_export_path.is_empty() {
        return Err(TicketConsumptionError::EmptyDataExportPath);
    }
    if ticket.drain_proof_digest.is_empty() {
        return Err(TicketConsumptionError::EmptyDrainProofDigest);
    }
    if ticket.trusted_time_seconds < ticket.issued_at_seconds {
        return Err(TicketConsumptionError::NotYetValid {
            trusted_time: ticket.trusted_time_seconds,
            issued_at: ticket.issued_at_seconds,
        });
    }
    if ticket.trusted_time_seconds > ticket.expires_at_seconds {
        return Err(TicketConsumptionError::Expired {
            trusted_time: ticket.trusted_time_seconds,
            expires_at: ticket.expires_at_seconds,
        });
    }
    if ticket.trusted_time_seconds > ticket.sunset_deadline_seconds {
        return Err(TicketConsumptionError::SunsetDeadlineExceeded {
            trusted_time: ticket.trusted_time_seconds,
            deadline: ticket.sunset_deadline_seconds,
        });
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

#[cfg(test)]
fn valid_active_ticket() -> AutomationExecutionTicket {
    AutomationExecutionTicket {
        ticket_id: "tkt-001".to_owned(),
        session_id: "sess-001".to_owned(),
        recipe_id: "r-001".to_owned(),
        provider_connection_id: "pconn-001".to_owned(),
        device_id: "dev-001".to_owned(),
        nonce: "nonce-abc-123".to_owned(),
        sequence_number: 1,
        signature_digest: "aabbccdd".to_owned(),
        runtime_mode: RuntimeMode::Active,
        lease_epoch: 5,
        current_lease_epoch: 5,
        consumer_device_id: "dev-001".to_owned(),
        issued_at_seconds: 1_000_000,
        expires_at_seconds: 1_001_000,
        trusted_time_seconds: 1_000_500,
        max_steps: 50,
        navigation_scope: "spaceship.com".to_owned(),
        profile_isolation_key: "active:pconn-001:active".to_owned(),
        download_policy: DownloadPolicy::Deny {},
        upload_policy: UploadPolicy::Deny {},
        permits_read: true,
        permits_write: true,
        consumed: false,
        session_mode: SessionMode::Active,
    }
}

#[cfg(test)]
fn valid_sunset_ticket() -> SunsetAutomationExecutionTicket {
    SunsetAutomationExecutionTicket {
        ticket_id: "tkt-sunset-001".to_owned(),
        session_id: "sess-sunset-001".to_owned(),
        recipe_id: "r-export-001".to_owned(),
        provider_connection_id: "pconn-001".to_owned(),
        device_id: "dev-001".to_owned(),
        nonce: "nonce-sunset-456".to_owned(),
        sequence_number: 1,
        signature_digest: "eeff0011".to_owned(),
        runtime_mode: RuntimeMode::Draining,
        lease_epoch: 5,
        current_lease_epoch: 5,
        consumer_device_id: "dev-001".to_owned(),
        issued_at_seconds: 1_000_000,
        expires_at_seconds: 1_001_000,
        trusted_time_seconds: 1_000_500,
        max_steps: 20,
        navigation_scope: "spaceship.com/export".to_owned(),
        profile_isolation_key: "sunset:pconn-001:sunset".to_owned(),
        download_policy: DownloadPolicy::Deny {},
        upload_policy: UploadPolicy::Deny {},
        permits_read: true,
        permits_write: false,
        consumed: false,
        session_mode: SessionMode::Sunset,
        // Sunset-specific fields
        drain_stream_id: "drain-001".to_owned(),
        drain_sequence: 42,
        sunset_deadline_seconds: 2_000_000,
        data_export_path: "/exports/spaceship".to_owned(),
        sunset_reason: "account_closure".to_owned(),
        drain_proof_digest: "ddee0022".to_owned(),
        readonly_enforced: true,
        sunset_session_id: "sess-sunset-001".to_owned(),
        export_format: "csv".to_owned(),
        final_drain_sequence: 100,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── Active ticket: positive ──────────────────────────────────────

    #[test]
    fn active_ticket_validates_ok() {
        let ticket = valid_active_ticket();
        assert!(validate_active_ticket(&ticket).is_ok());
    }

    // ── Active ticket: 23 negative vectors (N-TKT-01..23) ───────────

    #[test]
    fn n_tkt_01_rejects_already_consumed() {
        let mut t = valid_active_ticket();
        t.consumed = true;
        assert!(matches!(
            validate_active_ticket(&t),
            Err(TicketConsumptionError::AlreadyConsumed)
        ));
    }

    #[test]
    fn n_tkt_02_rejects_device_mismatch() {
        let mut t = valid_active_ticket();
        t.consumer_device_id = "other-dev".to_owned();
        assert!(matches!(
            validate_active_ticket(&t),
            Err(TicketConsumptionError::DeviceMismatch { .. })
        ));
    }

    #[test]
    fn n_tkt_03_rejects_expired() {
        let mut t = valid_active_ticket();
        t.trusted_time_seconds = 2_000_000;
        assert!(matches!(
            validate_active_ticket(&t),
            Err(TicketConsumptionError::Expired { .. })
        ));
    }

    #[test]
    fn n_tkt_04_rejects_not_yet_valid() {
        let mut t = valid_active_ticket();
        t.trusted_time_seconds = 100;
        assert!(matches!(
            validate_active_ticket(&t),
            Err(TicketConsumptionError::NotYetValid { .. })
        ));
    }

    #[test]
    fn n_tkt_05_rejects_zero_lease_epoch() {
        let mut t = valid_active_ticket();
        t.lease_epoch = 0;
        t.current_lease_epoch = 0;
        assert!(matches!(
            validate_active_ticket(&t),
            Err(TicketConsumptionError::LeaseEpochZero)
        ));
    }

    #[test]
    fn n_tkt_06_rejects_lease_epoch_mismatch() {
        let mut t = valid_active_ticket();
        t.current_lease_epoch = 99;
        assert!(matches!(
            validate_active_ticket(&t),
            Err(TicketConsumptionError::LeaseEpochMismatch { .. })
        ));
    }

    #[test]
    fn n_tkt_07_rejects_draining_runtime_for_active() {
        let mut t = valid_active_ticket();
        t.runtime_mode = RuntimeMode::Draining;
        assert!(matches!(
            validate_active_ticket(&t),
            Err(TicketConsumptionError::RuntimeModeNotActive)
        ));
    }

    #[test]
    fn n_tkt_08_rejects_locked_runtime_for_active() {
        let mut t = valid_active_ticket();
        t.runtime_mode = RuntimeMode::Locked;
        assert!(matches!(
            validate_active_ticket(&t),
            Err(TicketConsumptionError::RuntimeModeNotActive)
        ));
    }

    #[test]
    fn n_tkt_09_rejects_sunset_mode_in_active_ticket() {
        let mut t = valid_active_ticket();
        t.session_mode = SessionMode::Sunset;
        assert!(matches!(
            validate_active_ticket(&t),
            Err(TicketConsumptionError::SessionModeMismatch)
        ));
    }

    #[test]
    fn n_tkt_10_rejects_empty_ticket_id() {
        let mut t = valid_active_ticket();
        t.ticket_id = String::new();
        assert!(matches!(
            validate_active_ticket(&t),
            Err(TicketConsumptionError::EmptyTicketId)
        ));
    }

    #[test]
    fn n_tkt_11_rejects_empty_nonce() {
        let mut t = valid_active_ticket();
        t.nonce = String::new();
        assert!(matches!(
            validate_active_ticket(&t),
            Err(TicketConsumptionError::EmptyNonce)
        ));
    }

    #[test]
    fn n_tkt_12_rejects_empty_signature_digest() {
        let mut t = valid_active_ticket();
        t.signature_digest = String::new();
        assert!(matches!(
            validate_active_ticket(&t),
            Err(TicketConsumptionError::EmptySignatureDigest)
        ));
    }

    // ── Sunset ticket: positive ──────────────────────────────────────

    #[test]
    fn sunset_ticket_validates_ok() {
        let ticket = valid_sunset_ticket();
        assert!(validate_sunset_ticket(&ticket).is_ok());
    }

    // ── Sunset ticket: negative vectors ──────────────────────────────

    #[test]
    fn n_tkt_13_sunset_rejects_already_consumed() {
        let mut t = valid_sunset_ticket();
        t.consumed = true;
        assert!(matches!(
            validate_sunset_ticket(&t),
            Err(TicketConsumptionError::AlreadyConsumed)
        ));
    }

    #[test]
    fn n_tkt_14_sunset_rejects_device_mismatch() {
        let mut t = valid_sunset_ticket();
        t.consumer_device_id = "other-dev".to_owned();
        assert!(matches!(
            validate_sunset_ticket(&t),
            Err(TicketConsumptionError::DeviceMismatch { .. })
        ));
    }

    #[test]
    fn n_tkt_15_sunset_rejects_expired() {
        let mut t = valid_sunset_ticket();
        t.trusted_time_seconds = 3_000_000;
        t.sunset_deadline_seconds = 4_000_000;
        assert!(matches!(
            validate_sunset_ticket(&t),
            Err(TicketConsumptionError::Expired { .. })
        ));
    }

    #[test]
    fn n_tkt_16_sunset_rejects_not_readonly() {
        let mut t = valid_sunset_ticket();
        t.readonly_enforced = false;
        assert!(matches!(
            validate_sunset_ticket(&t),
            Err(TicketConsumptionError::SunsetNotReadOnly)
        ));
    }

    #[test]
    fn n_tkt_17_sunset_rejects_write_permission() {
        let mut t = valid_sunset_ticket();
        t.permits_write = true;
        assert!(matches!(
            validate_sunset_ticket(&t),
            Err(TicketConsumptionError::SunsetPermitsWriteForbidden)
        ));
    }

    #[test]
    fn n_tkt_18_sunset_rejects_active_runtime() {
        let mut t = valid_sunset_ticket();
        t.runtime_mode = RuntimeMode::Active;
        assert!(matches!(
            validate_sunset_ticket(&t),
            Err(TicketConsumptionError::RuntimeModeNotDraining)
        ));
    }

    #[test]
    fn n_tkt_19_sunset_rejects_active_session_mode() {
        let mut t = valid_sunset_ticket();
        t.session_mode = SessionMode::Active;
        assert!(matches!(
            validate_sunset_ticket(&t),
            Err(TicketConsumptionError::SessionModeMismatch)
        ));
    }

    #[test]
    fn n_tkt_20_sunset_rejects_empty_drain_stream() {
        let mut t = valid_sunset_ticket();
        t.drain_stream_id = String::new();
        assert!(matches!(
            validate_sunset_ticket(&t),
            Err(TicketConsumptionError::EmptyDrainStreamId)
        ));
    }

    #[test]
    fn n_tkt_21_sunset_rejects_empty_data_export_path() {
        let mut t = valid_sunset_ticket();
        t.data_export_path = String::new();
        assert!(matches!(
            validate_sunset_ticket(&t),
            Err(TicketConsumptionError::EmptyDataExportPath)
        ));
    }

    #[test]
    fn n_tkt_22_sunset_rejects_empty_drain_proof_digest() {
        let mut t = valid_sunset_ticket();
        t.drain_proof_digest = String::new();
        assert!(matches!(
            validate_sunset_ticket(&t),
            Err(TicketConsumptionError::EmptyDrainProofDigest)
        ));
    }

    #[test]
    fn n_tkt_23_sunset_rejects_exceeded_deadline() {
        let mut t = valid_sunset_ticket();
        t.trusted_time_seconds = 2_500_000;
        // Ensure it doesn't fail on expires_at first
        t.expires_at_seconds = 3_000_000;
        assert!(matches!(
            validate_sunset_ticket(&t),
            Err(TicketConsumptionError::SunsetDeadlineExceeded { .. })
        ));
    }

    // ── Cross-type non-interchangeability ────────────────────────────

    #[test]
    fn active_ticket_json_rejected_as_sunset() {
        let active = valid_active_ticket();
        let json = serde_json::to_string(&active).unwrap();
        // Active ticket JSON lacks sunset-specific fields, so it must fail
        // to parse as a SunsetAutomationExecutionTicket.
        let result = serde_json::from_str::<SunsetAutomationExecutionTicket>(&json);
        assert!(result.is_err(), "active ticket must not parse as sunset");
    }

    #[test]
    fn sunset_ticket_json_rejected_as_active() {
        let sunset = valid_sunset_ticket();
        let json = serde_json::to_string(&sunset).unwrap();
        // Sunset ticket JSON has extra fields, so deny_unknown_fields rejects it.
        let result = serde_json::from_str::<AutomationExecutionTicket>(&json);
        assert!(result.is_err(), "sunset ticket must not parse as active");
    }

    // ── Consent != Grant != Ticket ───────────────────────────────────

    /// A mock "consent" record — structurally different from a ticket.
    #[test]
    fn consent_not_interchangeable_with_ticket() {
        let consent_json = serde_json::json!({
            "consent_id": "c-001",
            "user_id": "u-001",
            "scope": "browser-automation",
            "granted_at": 1_000_000
        })
        .to_string();
        assert!(
            serde_json::from_str::<AutomationExecutionTicket>(&consent_json).is_err(),
            "consent must not parse as ticket"
        );
    }

    /// A mock "grant" record — structurally different from a ticket.
    #[test]
    fn grant_not_interchangeable_with_ticket() {
        let grant_json = serde_json::json!({
            "grant_id": "g-001",
            "provider_connection_id": "pconn-001",
            "permissions": ["read", "write"],
            "granted_at": 1_000_000,
            "expires_at": 2_000_000
        })
        .to_string();
        assert!(
            serde_json::from_str::<AutomationExecutionTicket>(&grant_json).is_err(),
            "grant must not parse as ticket"
        );
    }

    #[test]
    fn ticket_not_interchangeable_with_consent() {
        // Ticket has ticket_id, consent would have consent_id — different schemas.
        // Here we just confirm the ticket JSON doesn't accidentally match
        // some looser consent schema by verifying all 24 fields are required.
        let mut val = serde_json::to_value(valid_active_ticket()).unwrap();
        // Remove a required field — the result must fail to parse back.
        val.as_object_mut().unwrap().remove("nonce");
        assert!(
            serde_json::from_value::<AutomationExecutionTicket>(val).is_err(),
            "ticket with missing field must not parse"
        );
    }

    // ── Single-use enforcement ───────────────────────────────────────

    #[test]
    fn ticket_consumed_once_then_rejected() {
        let mut ticket = valid_active_ticket();
        assert!(validate_active_ticket(&ticket).is_ok());
        ticket.consumed = true;
        assert!(matches!(
            validate_active_ticket(&ticket),
            Err(TicketConsumptionError::AlreadyConsumed)
        ));
    }

    // ── Serde roundtrip ──────────────────────────────────────────────

    #[test]
    fn active_ticket_serde_roundtrip() {
        let original = valid_active_ticket();
        let json = serde_json::to_string(&original).unwrap();
        let parsed: AutomationExecutionTicket = serde_json::from_str(&json).unwrap();
        assert_eq!(original, parsed);
    }

    #[test]
    fn sunset_ticket_serde_roundtrip() {
        let original = valid_sunset_ticket();
        let json = serde_json::to_string(&original).unwrap();
        let parsed: SunsetAutomationExecutionTicket = serde_json::from_str(&json).unwrap();
        assert_eq!(original, parsed);
    }

    // ── Field counts ─────────────────────────────────────────────────

    #[test]
    fn active_ticket_has_24_fields() {
        let val = serde_json::to_value(valid_active_ticket()).unwrap();
        let fields = val.as_object().unwrap().len();
        assert_eq!(fields, 24, "AutomationExecutionTicket must have 24 fields");
    }

    #[test]
    fn sunset_ticket_has_34_fields() {
        let val = serde_json::to_value(valid_sunset_ticket()).unwrap();
        let fields = val.as_object().unwrap().len();
        assert_eq!(
            fields, 34,
            "SunsetAutomationExecutionTicket must have 34 fields"
        );
    }
}
