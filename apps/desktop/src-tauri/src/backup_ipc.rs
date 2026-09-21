use tauri::ipc::{InvokeBody, Request};

const MAX_BACKUP_REQUEST_WIRE_BYTES: usize = 4_096;

/// Admits the already-owned Tauri request body without JSON deserialization.
///
/// The length check happens against the borrowed raw body before the only application-level
/// copy. The resulting bounded buffer is the sole request value allowed to cross into the one
/// `spawn_blocking` aggregate call.
pub(crate) fn bounded_request_wire(request: &Request<'_>) -> Result<Vec<u8>, String> {
    bounded_raw_body(request.body())
}

fn bounded_raw_body(body: &InvokeBody) -> Result<Vec<u8>, String> {
    let InvokeBody::Raw(wire) = body else {
        return Err(backup_operation_rejected());
    };
    if !(1..=MAX_BACKUP_REQUEST_WIRE_BYTES).contains(&wire.len()) {
        return Err(backup_operation_rejected());
    }
    Ok(wire.clone())
}

fn backup_operation_rejected() -> String {
    "BACKUP_OPERATION_REJECTED".to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn raw_body_is_bounded_before_the_only_application_copy() {
        for size in [1, MAX_BACKUP_REQUEST_WIRE_BYTES] {
            let input = vec![0x5a; size];
            let output = bounded_raw_body(&InvokeBody::Raw(input.clone())).unwrap();
            assert_eq!(output, input);
        }
        for size in [0, MAX_BACKUP_REQUEST_WIRE_BYTES + 1, 1_000_000] {
            assert_eq!(
                bounded_raw_body(&InvokeBody::Raw(vec![0; size])),
                Err("BACKUP_OPERATION_REJECTED".to_owned())
            );
        }
    }

    #[test]
    fn json_body_is_rejected_without_parsing_or_echoing_it() {
        for body in [
            InvokeBody::Json(serde_json::Value::Null),
            InvokeBody::Json(serde_json::json!({
                "operationId": "hostile-operation-id",
                "path": "/private/secret"
            })),
        ] {
            assert_eq!(
                bounded_raw_body(&body),
                Err("BACKUP_OPERATION_REJECTED".to_owned())
            );
        }
    }
}
