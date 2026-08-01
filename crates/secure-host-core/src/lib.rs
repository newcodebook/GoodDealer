mod wire_envelope;

pub use wire_envelope::{WireValidationError, validate_wire_envelope_json};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuntimeMode {
    Locked,
    Standby,
    Activating,
    Active,
    Draining,
    LocalContinuation,
}
