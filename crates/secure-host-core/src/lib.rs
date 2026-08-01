pub mod device_identity;
pub mod endpoint_capability;
mod generated;
#[cfg(test)]
mod http_executor;
pub mod secret;
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
