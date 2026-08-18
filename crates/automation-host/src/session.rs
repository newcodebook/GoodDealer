//! Browser session access contexts (P0-27).
//!
//! Two mutually-exclusive context types gate browser automation:
//!
//! * [`BrowserSessionAccessContext`] — active sessions where the device holds a
//!   current lease.  Healthy credentials are **not** a precondition; the session
//!   can start before credential health is confirmed.
//!
//! * [`SunsetBrowserSessionAccessContext`] — draining/sunset sessions that allow
//!   only read-only data-export operations under a drain proof.
//!
//! The two parsers intentionally reject each other's JSON: an active context
//! must have `"context_type": "active"` and a sunset context must have
//! `"context_type": "sunset"`.

use gooddealer_secure_host_core::RuntimeMode;

// ---------------------------------------------------------------------------
// Session mode
// ---------------------------------------------------------------------------

/// The operational mode of a browser automation session.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionMode {
    /// Normal active automation.
    Active,
    /// Read-only sunset/drain data export.
    Sunset,
}

// ---------------------------------------------------------------------------
// Credential health (contract-level; not a gate for active context)
// ---------------------------------------------------------------------------

/// Credential health as observed at session-creation time.
///
/// Active contexts accept any variant — healthy credentials are **not**
/// required to start a browser session (INV-BSC-03).
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum BrowserCredentialHealth {
    /// Credentials have not been verified yet.
    Unknown,
    /// Credentials were verified and are healthy.
    Healthy,
    /// Credentials are known to be invalid or expired.
    Invalid,
    /// Credentials are being refreshed.
    Refreshing,
}

// ---------------------------------------------------------------------------
// Active browser session access context
// ---------------------------------------------------------------------------

/// Access context for an active browser automation session (INV-BSC-01..03).
///
/// This context proves that the device holds a current active lease and the
/// runtime is in `Active` mode.  It does **not** require healthy credentials —
/// the credential health is recorded but not enforced as a precondition.
#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields)]
pub struct BrowserSessionAccessContext {
    /// Discriminator — must be `"active"`.
    context_type: ActiveContextType,
    /// Unique session identifier (UUID).
    session_id: String,
    /// Provider connection this session operates against.
    provider_connection_id: String,
    /// Must be `Active`.
    runtime_mode: RuntimeMode,
    /// Current device identifier.
    device_id: String,
    /// Device that holds the lease.
    lease_device_id: String,
    /// Epoch of the active lease.
    lease_epoch: u64,
    /// Current lease epoch (must equal `lease_epoch`).
    current_lease_epoch: u64,
    /// Trusted monotonic time in seconds since epoch.
    trusted_time_seconds: u64,
    /// Offline execution deadline in seconds since epoch.
    offline_execute_until_seconds: u64,
    /// When this session was started (seconds since epoch).
    session_started_at_seconds: u64,
    /// Credential health — recorded but NOT a gate (INV-BSC-03).
    credential_health: BrowserCredentialHealth,
    /// Allowed navigation scope (domain-level constraint).
    navigation_scope: String,
}

/// Type-level discriminator ensuring `context_type` is always `"active"`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
enum ActiveContextType {
    #[serde(rename = "active")]
    Active,
}

/// Validation errors for [`BrowserSessionAccessContext`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BrowserSessionContextError {
    /// JSON parsing or schema mismatch.
    InvalidJson(String),
    /// `runtime_mode` is not `Active`.
    RuntimeModeNotActive(RuntimeMode),
    /// Device IDs do not match.
    DeviceMismatch {
        device_id: String,
        lease_device_id: String,
    },
    /// Lease epochs do not match.
    LeaseEpochMismatch { lease_epoch: u64, current: u64 },
    /// Lease epoch is zero.
    LeaseEpochZero,
    /// Trusted time is beyond the offline deadline.
    OfflineDeadlineExceeded {
        trusted_time: u64,
        deadline: u64,
    },
    /// Session ID is empty.
    EmptySessionId,
    /// Provider connection ID is empty.
    EmptyProviderConnectionId,
    /// Navigation scope is empty.
    EmptyNavigationScope,
}

impl std::fmt::Display for BrowserSessionContextError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidJson(msg) => write!(f, "invalid session context JSON: {msg}"),
            Self::RuntimeModeNotActive(mode) => {
                write!(f, "runtime mode must be Active, got {mode:?}")
            }
            Self::DeviceMismatch {
                device_id,
                lease_device_id,
            } => write!(
                f,
                "device mismatch: device={device_id}, lease={lease_device_id}"
            ),
            Self::LeaseEpochMismatch { lease_epoch, current } => {
                write!(f, "lease epoch mismatch: {lease_epoch} != {current}")
            }
            Self::LeaseEpochZero => write!(f, "lease epoch must not be zero"),
            Self::OfflineDeadlineExceeded {
                trusted_time,
                deadline,
            } => write!(
                f,
                "offline deadline exceeded: time={trusted_time}, deadline={deadline}"
            ),
            Self::EmptySessionId => write!(f, "session_id must not be empty"),
            Self::EmptyProviderConnectionId => {
                write!(f, "provider_connection_id must not be empty")
            }
            Self::EmptyNavigationScope => write!(f, "navigation_scope must not be empty"),
        }
    }
}

impl std::error::Error for BrowserSessionContextError {}

impl BrowserSessionAccessContext {
    /// Parse and validate a `BrowserSessionAccessContext` from JSON.
    pub fn from_json(json: &str) -> Result<Self, BrowserSessionContextError> {
        let ctx: Self = serde_json::from_str(json)
            .map_err(|e| BrowserSessionContextError::InvalidJson(e.to_string()))?;
        ctx.validate()?;
        Ok(ctx)
    }

    fn validate(&self) -> Result<(), BrowserSessionContextError> {
        if self.runtime_mode != RuntimeMode::Active {
            return Err(BrowserSessionContextError::RuntimeModeNotActive(
                self.runtime_mode,
            ));
        }
        if self.session_id.is_empty() {
            return Err(BrowserSessionContextError::EmptySessionId);
        }
        if self.provider_connection_id.is_empty() {
            return Err(BrowserSessionContextError::EmptyProviderConnectionId);
        }
        if self.navigation_scope.is_empty() {
            return Err(BrowserSessionContextError::EmptyNavigationScope);
        }
        if self.device_id != self.lease_device_id {
            return Err(BrowserSessionContextError::DeviceMismatch {
                device_id: self.device_id.clone(),
                lease_device_id: self.lease_device_id.clone(),
            });
        }
        if self.lease_epoch == 0 {
            return Err(BrowserSessionContextError::LeaseEpochZero);
        }
        if self.lease_epoch != self.current_lease_epoch {
            return Err(BrowserSessionContextError::LeaseEpochMismatch {
                lease_epoch: self.lease_epoch,
                current: self.current_lease_epoch,
            });
        }
        if self.trusted_time_seconds > self.offline_execute_until_seconds {
            return Err(BrowserSessionContextError::OfflineDeadlineExceeded {
                trusted_time: self.trusted_time_seconds,
                deadline: self.offline_execute_until_seconds,
            });
        }
        Ok(())
    }

    #[must_use]
    pub fn session_id(&self) -> &str {
        &self.session_id
    }

    #[must_use]
    pub fn provider_connection_id(&self) -> &str {
        &self.provider_connection_id
    }

    #[must_use]
    pub fn runtime_mode(&self) -> RuntimeMode {
        self.runtime_mode
    }

    #[must_use]
    pub fn device_id(&self) -> &str {
        &self.device_id
    }

    #[must_use]
    pub fn credential_health(&self) -> BrowserCredentialHealth {
        self.credential_health
    }

    #[must_use]
    pub fn navigation_scope(&self) -> &str {
        &self.navigation_scope
    }

    #[must_use]
    pub fn session_mode(&self) -> SessionMode {
        SessionMode::Active
    }

    #[must_use]
    pub fn trusted_time_seconds(&self) -> u64 {
        self.trusted_time_seconds
    }

    #[must_use]
    pub fn offline_execute_until_seconds(&self) -> u64 {
        self.offline_execute_until_seconds
    }
}

// ---------------------------------------------------------------------------
// Sunset browser session access context
// ---------------------------------------------------------------------------

/// Access context for a sunset/draining browser session (INV-BSC-04..07).
///
/// Sunset contexts are restricted to read-only data-export operations.  They
/// require `RuntimeMode::Draining` and carry drain-proof metadata.
#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields)]
pub struct SunsetBrowserSessionAccessContext {
    /// Discriminator — must be `"sunset"`.
    context_type: SunsetContextType,
    /// Unique session identifier (UUID).
    session_id: String,
    /// Provider connection this session operates against.
    provider_connection_id: String,
    /// Must be `Draining`.
    runtime_mode: RuntimeMode,
    /// Current device identifier.
    device_id: String,
    /// Trusted monotonic time in seconds since epoch.
    trusted_time_seconds: u64,
    /// When this session was started (seconds since epoch).
    session_started_at_seconds: u64,
    /// Drain stream identifier.
    drain_stream_id: String,
    /// Current drain sequence number.
    drain_sequence: u64,
    /// Sunset deadline in seconds since epoch.
    sunset_deadline_seconds: u64,
    /// Path for data export output.
    data_export_path: String,
    /// Always true — sunset sessions are read-only.
    readonly: bool,
}

/// Type-level discriminator ensuring `context_type` is always `"sunset"`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
enum SunsetContextType {
    #[serde(rename = "sunset")]
    Sunset,
}

/// Validation errors for [`SunsetBrowserSessionAccessContext`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SunsetBrowserSessionContextError {
    /// JSON parsing or schema mismatch.
    InvalidJson(String),
    /// `runtime_mode` is not `Draining`.
    RuntimeModeNotDraining(RuntimeMode),
    /// Session ID is empty.
    EmptySessionId,
    /// Provider connection ID is empty.
    EmptyProviderConnectionId,
    /// Drain stream ID is empty.
    EmptyDrainStreamId,
    /// Data export path is empty.
    EmptyDataExportPath,
    /// The `readonly` field is not true.
    NotReadOnly,
    /// Trusted time is beyond the sunset deadline.
    SunsetDeadlineExceeded {
        trusted_time: u64,
        deadline: u64,
    },
}

impl std::fmt::Display for SunsetBrowserSessionContextError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidJson(msg) => write!(f, "invalid sunset context JSON: {msg}"),
            Self::RuntimeModeNotDraining(mode) => {
                write!(f, "runtime mode must be Draining, got {mode:?}")
            }
            Self::EmptySessionId => write!(f, "session_id must not be empty"),
            Self::EmptyProviderConnectionId => {
                write!(f, "provider_connection_id must not be empty")
            }
            Self::EmptyDrainStreamId => write!(f, "drain_stream_id must not be empty"),
            Self::EmptyDataExportPath => write!(f, "data_export_path must not be empty"),
            Self::NotReadOnly => write!(f, "sunset session must be readonly"),
            Self::SunsetDeadlineExceeded {
                trusted_time,
                deadline,
            } => write!(
                f,
                "sunset deadline exceeded: time={trusted_time}, deadline={deadline}"
            ),
        }
    }
}

impl std::error::Error for SunsetBrowserSessionContextError {}

impl SunsetBrowserSessionAccessContext {
    /// Parse and validate a `SunsetBrowserSessionAccessContext` from JSON.
    pub fn from_json(json: &str) -> Result<Self, SunsetBrowserSessionContextError> {
        let ctx: Self = serde_json::from_str(json)
            .map_err(|e| SunsetBrowserSessionContextError::InvalidJson(e.to_string()))?;
        ctx.validate()?;
        Ok(ctx)
    }

    fn validate(&self) -> Result<(), SunsetBrowserSessionContextError> {
        if self.runtime_mode != RuntimeMode::Draining {
            return Err(SunsetBrowserSessionContextError::RuntimeModeNotDraining(
                self.runtime_mode,
            ));
        }
        if self.session_id.is_empty() {
            return Err(SunsetBrowserSessionContextError::EmptySessionId);
        }
        if self.provider_connection_id.is_empty() {
            return Err(SunsetBrowserSessionContextError::EmptyProviderConnectionId);
        }
        if self.drain_stream_id.is_empty() {
            return Err(SunsetBrowserSessionContextError::EmptyDrainStreamId);
        }
        if self.data_export_path.is_empty() {
            return Err(SunsetBrowserSessionContextError::EmptyDataExportPath);
        }
        if !self.readonly {
            return Err(SunsetBrowserSessionContextError::NotReadOnly);
        }
        if self.trusted_time_seconds > self.sunset_deadline_seconds {
            return Err(SunsetBrowserSessionContextError::SunsetDeadlineExceeded {
                trusted_time: self.trusted_time_seconds,
                deadline: self.sunset_deadline_seconds,
            });
        }
        Ok(())
    }

    #[must_use]
    pub fn session_id(&self) -> &str {
        &self.session_id
    }

    #[must_use]
    pub fn provider_connection_id(&self) -> &str {
        &self.provider_connection_id
    }

    #[must_use]
    pub fn runtime_mode(&self) -> RuntimeMode {
        self.runtime_mode
    }

    #[must_use]
    pub fn device_id(&self) -> &str {
        &self.device_id
    }

    #[must_use]
    pub fn session_mode(&self) -> SessionMode {
        SessionMode::Sunset
    }

    #[must_use]
    pub fn drain_stream_id(&self) -> &str {
        &self.drain_stream_id
    }

    #[must_use]
    pub fn drain_sequence(&self) -> u64 {
        self.drain_sequence
    }

    #[must_use]
    pub fn data_export_path(&self) -> &str {
        &self.data_export_path
    }

    #[must_use]
    pub fn is_readonly(&self) -> bool {
        self.readonly
    }

    #[must_use]
    pub fn sunset_deadline_seconds(&self) -> u64 {
        self.sunset_deadline_seconds
    }
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

#[cfg(test)]
pub(crate) fn valid_active_context_json() -> String {
    serde_json::json!({
        "context_type": "active",
        "session_id": "sess-001",
        "provider_connection_id": "pconn-spaceship-001",
        "runtime_mode": "active",
        "device_id": "dev-001",
        "lease_device_id": "dev-001",
        "lease_epoch": 1,
        "current_lease_epoch": 1,
        "trusted_time_seconds": 1_000_000,
        "offline_execute_until_seconds": 2_000_000,
        "session_started_at_seconds": 999_000,
        "credential_health": "unknown",
        "navigation_scope": "spaceship.com"
    })
    .to_string()
}

#[cfg(test)]
pub(crate) fn valid_sunset_context_json() -> String {
    serde_json::json!({
        "context_type": "sunset",
        "session_id": "sess-sunset-001",
        "provider_connection_id": "pconn-spaceship-001",
        "runtime_mode": "draining",
        "device_id": "dev-001",
        "trusted_time_seconds": 1_000_000,
        "session_started_at_seconds": 999_000,
        "drain_stream_id": "drain-001",
        "drain_sequence": 42,
        "sunset_deadline_seconds": 2_000_000,
        "data_export_path": "/exports/spaceship",
        "readonly": true
    })
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── Active context ───────────────────────────────────────────────

    #[test]
    fn active_context_parses_valid_json() {
        let ctx = BrowserSessionAccessContext::from_json(&valid_active_context_json()).unwrap();
        assert_eq!(ctx.session_id(), "sess-001");
        assert_eq!(ctx.provider_connection_id(), "pconn-spaceship-001");
        assert_eq!(ctx.runtime_mode(), RuntimeMode::Active);
        assert_eq!(ctx.device_id(), "dev-001");
        assert_eq!(ctx.credential_health(), BrowserCredentialHealth::Unknown);
        assert_eq!(ctx.session_mode(), SessionMode::Active);
    }

    #[test]
    fn active_context_accepts_any_credential_health() {
        // INV-BSC-03: healthy credentials are NOT required.
        for health in ["unknown", "healthy", "invalid", "refreshing"] {
            let json = valid_active_context_json().replace("\"unknown\"", &format!("\"{health}\""));
            let ctx = BrowserSessionAccessContext::from_json(&json).unwrap();
            assert_eq!(ctx.session_id(), "sess-001");
        }
    }

    #[test]
    fn active_context_rejects_non_active_runtime_mode() {
        let json = valid_active_context_json().replace("\"active\"", "\"draining\"");
        // This replaces context_type too, so it will fail parsing as active context
        let result = BrowserSessionAccessContext::from_json(&json);
        assert!(result.is_err());
    }

    #[test]
    fn active_context_rejects_locked_runtime() {
        let mut val: serde_json::Value =
            serde_json::from_str(&valid_active_context_json()).unwrap();
        val["runtime_mode"] = serde_json::json!("locked");
        let result = BrowserSessionAccessContext::from_json(&val.to_string());
        assert!(matches!(
            result,
            Err(BrowserSessionContextError::RuntimeModeNotActive(
                RuntimeMode::Locked
            ))
        ));
    }

    #[test]
    fn active_context_rejects_device_mismatch() {
        let mut val: serde_json::Value =
            serde_json::from_str(&valid_active_context_json()).unwrap();
        val["lease_device_id"] = serde_json::json!("other-device");
        let result = BrowserSessionAccessContext::from_json(&val.to_string());
        assert!(matches!(
            result,
            Err(BrowserSessionContextError::DeviceMismatch { .. })
        ));
    }

    #[test]
    fn active_context_rejects_zero_lease_epoch() {
        let mut val: serde_json::Value =
            serde_json::from_str(&valid_active_context_json()).unwrap();
        val["lease_epoch"] = serde_json::json!(0);
        val["current_lease_epoch"] = serde_json::json!(0);
        let result = BrowserSessionAccessContext::from_json(&val.to_string());
        assert!(matches!(
            result,
            Err(BrowserSessionContextError::LeaseEpochZero)
        ));
    }

    #[test]
    fn active_context_rejects_epoch_mismatch() {
        let mut val: serde_json::Value =
            serde_json::from_str(&valid_active_context_json()).unwrap();
        val["current_lease_epoch"] = serde_json::json!(99);
        let result = BrowserSessionAccessContext::from_json(&val.to_string());
        assert!(matches!(
            result,
            Err(BrowserSessionContextError::LeaseEpochMismatch { .. })
        ));
    }

    #[test]
    fn active_context_rejects_expired_offline_deadline() {
        let mut val: serde_json::Value =
            serde_json::from_str(&valid_active_context_json()).unwrap();
        val["trusted_time_seconds"] = serde_json::json!(3_000_000);
        let result = BrowserSessionAccessContext::from_json(&val.to_string());
        assert!(matches!(
            result,
            Err(BrowserSessionContextError::OfflineDeadlineExceeded { .. })
        ));
    }

    #[test]
    fn active_context_rejects_empty_session_id() {
        let mut val: serde_json::Value =
            serde_json::from_str(&valid_active_context_json()).unwrap();
        val["session_id"] = serde_json::json!("");
        let result = BrowserSessionAccessContext::from_json(&val.to_string());
        assert!(matches!(
            result,
            Err(BrowserSessionContextError::EmptySessionId)
        ));
    }

    // ── Sunset context ───────────────────────────────────────────────

    #[test]
    fn sunset_context_parses_valid_json() {
        let ctx =
            SunsetBrowserSessionAccessContext::from_json(&valid_sunset_context_json()).unwrap();
        assert_eq!(ctx.session_id(), "sess-sunset-001");
        assert_eq!(ctx.runtime_mode(), RuntimeMode::Draining);
        assert_eq!(ctx.session_mode(), SessionMode::Sunset);
        assert!(ctx.is_readonly());
        assert_eq!(ctx.drain_stream_id(), "drain-001");
        assert_eq!(ctx.drain_sequence(), 42);
    }

    #[test]
    fn sunset_context_rejects_active_runtime_mode() {
        let mut val: serde_json::Value =
            serde_json::from_str(&valid_sunset_context_json()).unwrap();
        val["runtime_mode"] = serde_json::json!("active");
        let result = SunsetBrowserSessionAccessContext::from_json(&val.to_string());
        assert!(matches!(
            result,
            Err(SunsetBrowserSessionContextError::RuntimeModeNotDraining(
                RuntimeMode::Active
            ))
        ));
    }

    #[test]
    fn sunset_context_rejects_non_readonly() {
        let mut val: serde_json::Value =
            serde_json::from_str(&valid_sunset_context_json()).unwrap();
        val["readonly"] = serde_json::json!(false);
        let result = SunsetBrowserSessionAccessContext::from_json(&val.to_string());
        assert!(matches!(
            result,
            Err(SunsetBrowserSessionContextError::NotReadOnly)
        ));
    }

    #[test]
    fn sunset_context_rejects_exceeded_deadline() {
        let mut val: serde_json::Value =
            serde_json::from_str(&valid_sunset_context_json()).unwrap();
        val["trusted_time_seconds"] = serde_json::json!(3_000_000);
        let result = SunsetBrowserSessionAccessContext::from_json(&val.to_string());
        assert!(matches!(
            result,
            Err(SunsetBrowserSessionContextError::SunsetDeadlineExceeded {
                ..
            })
        ));
    }

    // ── Mutual rejection (INV-BSC-05..06) ────────────────────────────

    #[test]
    fn active_parser_rejects_sunset_json() {
        let result = BrowserSessionAccessContext::from_json(&valid_sunset_context_json());
        assert!(result.is_err(), "active parser must reject sunset JSON");
    }

    #[test]
    fn sunset_parser_rejects_active_json() {
        let result =
            SunsetBrowserSessionAccessContext::from_json(&valid_active_context_json());
        assert!(result.is_err(), "sunset parser must reject active JSON");
    }

    #[test]
    fn active_context_rejects_unknown_fields() {
        let mut val: serde_json::Value =
            serde_json::from_str(&valid_active_context_json()).unwrap();
        val["rogue_field"] = serde_json::json!("surprise");
        let result = BrowserSessionAccessContext::from_json(&val.to_string());
        assert!(result.is_err());
    }

    #[test]
    fn sunset_context_rejects_unknown_fields() {
        let mut val: serde_json::Value =
            serde_json::from_str(&valid_sunset_context_json()).unwrap();
        val["rogue_field"] = serde_json::json!("surprise");
        let result = SunsetBrowserSessionAccessContext::from_json(&val.to_string());
        assert!(result.is_err());
    }
}
