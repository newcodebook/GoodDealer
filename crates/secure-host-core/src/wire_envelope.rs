use serde::Deserialize;
use serde_json::Value;

const WIRE_SCHEMA_VERSION: u16 = 1;

#[derive(Debug, PartialEq, Eq)]
pub enum WireValidationError {
    InvalidJson,
    UnsupportedVersion,
    EmptyMessageId,
    EmptyOperation,
    EmptyErrorMessage,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WireEnvelope {
    schema_version: u16,
    message_id: String,
    body: WireBody,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", content = "data", rename_all = "snake_case")]
enum WireBody {
    Request(RequestData),
    Success(SuccessData),
    Error(ErrorData),
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RequestData {
    operation: String,
    payload: Value,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct SuccessData {
    payload: Value,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ErrorData {
    code: ErrorCode,
    message: String,
    retryable: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
enum ErrorCode {
    InvalidRequest,
    UnsupportedVersion,
    Internal,
}

/// Validates a JSON envelope against the private Rust mirror of the shared wire contract.
///
/// # Errors
///
/// Returns [`WireValidationError`] when JSON is malformed, the schema version is unsupported,
/// or a required semantic value is empty.
pub fn validate_wire_envelope_json(source: &str) -> Result<(), WireValidationError> {
    let envelope: WireEnvelope =
        serde_json::from_str(source).map_err(|_| WireValidationError::InvalidJson)?;

    if envelope.schema_version != WIRE_SCHEMA_VERSION {
        return Err(WireValidationError::UnsupportedVersion);
    }
    if envelope.message_id.is_empty() {
        return Err(WireValidationError::EmptyMessageId);
    }

    match envelope.body {
        WireBody::Request(request) => {
            if request.operation.is_empty() {
                return Err(WireValidationError::EmptyOperation);
            }
            drop(request.payload);
        }
        WireBody::Success(success) => drop(success.payload),
        WireBody::Error(error) => {
            if error.message.is_empty() {
                return Err(WireValidationError::EmptyErrorMessage);
            }
            let _ = (error.code, error.retryable);
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::validate_wire_envelope_json;

    const VALID: [&str; 2] = [
        include_str!("../../../packages/protocol/test-vectors/wire-envelope/valid/request.json"),
        include_str!("../../../packages/protocol/test-vectors/wire-envelope/valid/error.json"),
    ];
    const INVALID: [&str; 4] = [
        include_str!(
            "../../../packages/protocol/test-vectors/wire-envelope/invalid/unknown-field.json"
        ),
        include_str!(
            "../../../packages/protocol/test-vectors/wire-envelope/invalid/missing-field.json"
        ),
        include_str!(
            "../../../packages/protocol/test-vectors/wire-envelope/invalid/unknown-version.json"
        ),
        include_str!(
            "../../../packages/protocol/test-vectors/wire-envelope/invalid/unknown-enum.json"
        ),
    ];

    #[test]
    fn accepts_valid_golden_vectors() {
        for vector in VALID {
            assert!(validate_wire_envelope_json(vector).is_ok());
        }
    }

    #[test]
    fn rejects_invalid_golden_vectors() {
        for vector in INVALID {
            assert!(validate_wire_envelope_json(vector).is_err());
        }
    }
}
