use serde::{Deserialize, Serialize};

use crate::{ActivationPurpose, RuntimeMode};

pub const RUNTIME_STATUS_SCHEMA_VERSION: u8 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeStatusSnapshot {
    schema_version: u8,
    mode: RuntimeMode,
    activation_purpose: Option<ActivationPurpose>,
}

impl RuntimeStatusSnapshot {
    #[must_use]
    pub const fn mode(self) -> RuntimeMode {
        self.mode
    }

    #[must_use]
    pub const fn activation_purpose(self) -> Option<ActivationPurpose> {
        self.activation_purpose
    }

    fn is_valid(self) -> bool {
        self.schema_version == RUNTIME_STATUS_SCHEMA_VERSION
            && matches!(
                (self.mode, self.activation_purpose),
                (RuntimeMode::Activating, Some(_))
                    | (
                        RuntimeMode::Locked
                            | RuntimeMode::Standby
                            | RuntimeMode::Active
                            | RuntimeMode::Draining
                            | RuntimeMode::LocalContinuation,
                        None
                    )
            )
    }
}

/// Host-owned runtime authority. Phase 0 exposes only a read-only Locked snapshot; transitions are
/// added only with the R0-16 authoritative-state and resource-admission evidence.
#[derive(Debug)]
pub struct RuntimeGate {
    mode: RuntimeMode,
    activation_purpose: Option<ActivationPurpose>,
}

impl Default for RuntimeGate {
    fn default() -> Self {
        Self {
            mode: RuntimeMode::Locked,
            activation_purpose: None,
        }
    }
}

impl RuntimeGate {
    #[must_use]
    pub const fn snapshot(&self) -> RuntimeStatusSnapshot {
        RuntimeStatusSnapshot {
            schema_version: RUNTIME_STATUS_SCHEMA_VERSION,
            mode: self.mode,
            activation_purpose: self.activation_purpose,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuntimeStatusValidationError {
    InvalidJson,
    InvalidStatus,
}

/// Parses a strict runtime-status snapshot shared with the TypeScript protocol corpus.
///
/// # Errors
///
/// Returns [`RuntimeStatusValidationError::InvalidJson`] when the wire payload cannot be
/// decoded, or [`RuntimeStatusValidationError::InvalidStatus`] when its mode and activation
/// purpose violate the closed runtime-state contract.
pub fn validate_runtime_status_json(
    source: &str,
) -> Result<RuntimeStatusSnapshot, RuntimeStatusValidationError> {
    let snapshot: RuntimeStatusSnapshot =
        serde_json::from_str(source).map_err(|_| RuntimeStatusValidationError::InvalidJson)?;
    if snapshot.is_valid() {
        Ok(snapshot)
    } else {
        Err(RuntimeStatusValidationError::InvalidStatus)
    }
}

#[cfg(test)]
mod tests {
    use super::{RuntimeStatusValidationError, validate_runtime_status_json};
    use crate::{ActivationPurpose, RuntimeMode};

    const LOCKED: &str =
        include_str!("../../../packages/protocol/test-vectors/runtime-status/valid/locked.json");
    const ACTIVATING: &str = include_str!(
        "../../../packages/protocol/test-vectors/runtime-status/valid/activating-bootstrap.json"
    );
    const ACTIVATING_WITHOUT_PURPOSE: &str = include_str!(
        "../../../packages/protocol/test-vectors/runtime-status/invalid/activating-without-purpose.json"
    );
    const LOCKED_WITH_PURPOSE: &str = include_str!(
        "../../../packages/protocol/test-vectors/runtime-status/invalid/locked-with-purpose.json"
    );
    const UNKNOWN_FIELD: &str = include_str!(
        "../../../packages/protocol/test-vectors/runtime-status/invalid/unknown-field.json"
    );

    #[test]
    fn accepts_shared_valid_corpus() {
        let locked = validate_runtime_status_json(LOCKED).expect("locked status should parse");
        assert_eq!(locked.mode(), RuntimeMode::Locked);
        assert_eq!(locked.activation_purpose(), None);

        let activating =
            validate_runtime_status_json(ACTIVATING).expect("activating status should parse");
        assert_eq!(activating.mode(), RuntimeMode::Activating);
        assert_eq!(
            activating.activation_purpose(),
            Some(ActivationPurpose::Bootstrap)
        );
    }

    #[test]
    fn rejects_shared_invalid_corpus() {
        assert_eq!(
            validate_runtime_status_json(ACTIVATING_WITHOUT_PURPOSE),
            Err(RuntimeStatusValidationError::InvalidStatus)
        );
        assert_eq!(
            validate_runtime_status_json(LOCKED_WITH_PURPOSE),
            Err(RuntimeStatusValidationError::InvalidStatus)
        );
        assert_eq!(
            validate_runtime_status_json(UNKNOWN_FIELD),
            Err(RuntimeStatusValidationError::InvalidJson)
        );
    }
}
