//! Evidence types for browser automation (P0-29).
//!
//! Captures structured evidence of automation execution for audit and
//! compliance purposes.  Evidence records are append-only and never modified
//! after creation.

use crate::session::SessionMode;

/// A single evidence entry produced during recipe execution.
#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields)]
pub struct AutomationEvidenceEntry {
    /// Unique evidence identifier.
    pub evidence_id: String,
    /// Session that produced this evidence.
    pub session_id: String,
    /// Recipe that was executing.
    pub recipe_id: String,
    /// Provider connection identifier.
    pub provider_connection_id: String,
    /// Device identifier.
    pub device_id: String,
    /// Session mode at the time of recording.
    pub session_mode: SessionMode,
    /// Step index in the recipe (if applicable).
    pub step_index: Option<u32>,
    /// Type of evidence.
    pub evidence_type: EvidenceType,
    /// Timestamp in seconds since epoch.
    pub recorded_at_seconds: u64,
    /// Free-form evidence payload (step result, screenshot ref, etc.).
    pub payload: serde_json::Value,
}

/// The type of evidence recorded.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceType {
    /// A recipe step completed.
    StepCompleted,
    /// A recipe finished (success or failure).
    RecipeCompleted,
    /// A navigation event was observed.
    NavigationEvent,
    /// A policy violation was detected (navigation blocked, download denied, etc.).
    PolicyViolation,
    /// A screenshot was captured.
    ScreenshotCaptured,
    /// A fatal error terminated the session.
    FatalError,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EvidenceError {
    InvalidJson(String),
    EmptyEvidenceId,
    EmptySessionId,
    EmptyRecipeId,
}

impl std::fmt::Display for EvidenceError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidJson(msg) => write!(f, "invalid evidence JSON: {msg}"),
            Self::EmptyEvidenceId => write!(f, "evidence_id must not be empty"),
            Self::EmptySessionId => write!(f, "session_id must not be empty"),
            Self::EmptyRecipeId => write!(f, "recipe_id must not be empty"),
        }
    }
}

impl std::error::Error for EvidenceError {}

impl AutomationEvidenceEntry {
    /// Parse and validate from JSON.
    pub fn from_json(json: &str) -> Result<Self, EvidenceError> {
        let entry: Self =
            serde_json::from_str(json).map_err(|e| EvidenceError::InvalidJson(e.to_string()))?;
        entry.validate()?;
        Ok(entry)
    }

    fn validate(&self) -> Result<(), EvidenceError> {
        if self.evidence_id.is_empty() {
            return Err(EvidenceError::EmptyEvidenceId);
        }
        if self.session_id.is_empty() {
            return Err(EvidenceError::EmptySessionId);
        }
        if self.recipe_id.is_empty() {
            return Err(EvidenceError::EmptyRecipeId);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn evidence_entry_parses_valid() {
        let json = serde_json::json!({
            "evidence_id": "ev-001",
            "session_id": "sess-001",
            "recipe_id": "r-001",
            "provider_connection_id": "pconn-001",
            "device_id": "dev-001",
            "session_mode": "active",
            "step_index": 0,
            "evidence_type": "step_completed",
            "recorded_at_seconds": 1_000_000,
            "payload": {"status": "ok"}
        })
        .to_string();
        let entry = AutomationEvidenceEntry::from_json(&json).unwrap();
        assert_eq!(entry.evidence_id, "ev-001");
        assert_eq!(entry.evidence_type, EvidenceType::StepCompleted);
    }

    #[test]
    fn rejects_empty_evidence_id() {
        let json = serde_json::json!({
            "evidence_id": "",
            "session_id": "sess-001",
            "recipe_id": "r-001",
            "provider_connection_id": "pconn-001",
            "device_id": "dev-001",
            "session_mode": "active",
            "step_index": null,
            "evidence_type": "recipe_completed",
            "recorded_at_seconds": 1_000_000,
            "payload": {}
        })
        .to_string();
        assert!(matches!(
            AutomationEvidenceEntry::from_json(&json),
            Err(EvidenceError::EmptyEvidenceId)
        ));
    }

    #[test]
    fn rejects_unknown_evidence_type() {
        let json = serde_json::json!({
            "evidence_id": "ev-001",
            "session_id": "sess-001",
            "recipe_id": "r-001",
            "provider_connection_id": "pconn-001",
            "device_id": "dev-001",
            "session_mode": "active",
            "step_index": null,
            "evidence_type": "steal_data",
            "recorded_at_seconds": 1_000_000,
            "payload": {}
        })
        .to_string();
        assert!(AutomationEvidenceEntry::from_json(&json).is_err());
    }

    #[test]
    fn rejects_unknown_fields() {
        let json = serde_json::json!({
            "evidence_id": "ev-001",
            "session_id": "sess-001",
            "recipe_id": "r-001",
            "provider_connection_id": "pconn-001",
            "device_id": "dev-001",
            "session_mode": "active",
            "step_index": null,
            "evidence_type": "step_completed",
            "recorded_at_seconds": 1_000_000,
            "payload": {},
            "rogue": true
        })
        .to_string();
        assert!(AutomationEvidenceEntry::from_json(&json).is_err());
    }
}
