//! Deterministic sync encoding and validation.
//! Transactions remain owned by the single `BusinessDatabase`; splitting capabilities adds no writer.

#[cfg(test)]
use super::*;
#[cfg(not(test))]
use super::{
    BusinessDatabaseError, Digest, FORBIDDEN_SYNC_KEYS, MAX_SYNC_PUSH_REQUEST_BYTES,
    SYNC_MUTATION_WIRE_SCHEMA_VERSION, Serialize, Sha256, SyncMutationV2, Transaction, params,
};

pub(crate) fn serialize_sync_push_request(
    wire_mutations: &[String],
) -> Result<Vec<u8>, BusinessDatabaseError> {
    let mutations = wire_mutations
        .iter()
        .map(|mutation| serde_json::from_str::<serde_json::Value>(mutation))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    let request = serde_json::to_vec(&serde_json::json!({
        "schemaVersion": SYNC_MUTATION_WIRE_SCHEMA_VERSION,
        "mutations": mutations,
    }))
    .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    if request.is_empty() || request.len() > MAX_SYNC_PUSH_REQUEST_BYTES {
        return Err(BusinessDatabaseError::StorageRejected);
    }
    Ok(request)
}

pub(crate) fn sync_payload(value: &impl Serialize) -> Result<String, BusinessDatabaseError> {
    let payload = serde_json::to_string(value).map_err(|_| BusinessDatabaseError::InvalidInput)?;
    reject_secret_keys(&payload)?;
    Ok(payload)
}

pub(super) fn hex_digest(value: &[u8]) -> String {
    Sha256::digest(value)
        .iter()
        .fold(String::with_capacity(64), |mut output, byte| {
            use std::fmt::Write;
            write!(output, "{byte:02x}").expect("writing into a String cannot fail");
            output
        })
}

#[allow(clippy::too_many_arguments)]
pub(super) fn reconstruct_sync_mutation_v2(
    transaction: &Transaction<'_>,
    workspace_id: &str,
    mutation_id: &str,
    entity_id: &str,
    operation_kind: &str,
    base_server_revision: i64,
    workspace_schema_version: i64,
    source_device_id: &str,
    active_lease_epoch: i64,
    device_mutation_sequence: i64,
    created_at: &str,
) -> Result<serde_json::Value, BusinessDatabaseError> {
    if operation_kind != "upsert" && operation_kind != "delete" {
        return Err(BusinessDatabaseError::StorageRejected);
    }
    // ADR-0029 C1c1: the generation is frozen on the outbox row when the mutation is enqueued,
    // so a retry re-derives the same envelope even after the asset moves to a later generation.
    let (entity_generation, re_adds_deleted_revision): (i64, Option<i64>) = transaction
        .query_row(
            "SELECT entity_generation, re_adds_deleted_revision FROM sync_outbox
             WHERE workspace_id=?1 AND mutation_id=?2",
            params![workspace_id, mutation_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    let fields = {
        let mut statement = transaction
            .prepare(
                "SELECT field_path, field_value_json, field_value_sha256
                 FROM sync_outbox_fields
                 WHERE workspace_id=?1 AND mutation_id=?2
                 ORDER BY ordinal",
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let rows = statement
            .query_map(params![workspace_id, mutation_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|_| BusinessDatabaseError::StorageRejected)?
    };
    if (operation_kind == "upsert" && fields.is_empty())
        || (operation_kind == "delete" && !fields.is_empty())
    {
        return Err(BusinessDatabaseError::StorageRejected);
    }
    let mut previous: Option<&str> = None;
    let mut changed_fields = Vec::with_capacity(fields.len());
    for (field_path, value_json, value_digest) in &fields {
        if !matches!(
            field_path.as_str(),
            "note" | "portfolioId" | "tags" | "targetPrice"
        ) || previous.is_some_and(|value| value >= field_path.as_str())
        {
            return Err(BusinessDatabaseError::StorageRejected);
        }
        if hex_digest(value_json.as_bytes()) != *value_digest {
            return Err(BusinessDatabaseError::StorageRejected);
        }
        previous = Some(field_path);
        let value: serde_json::Value =
            serde_json::from_str(value_json).map_err(|_| BusinessDatabaseError::StorageRejected)?;
        changed_fields.push(serde_json::json!({ "fieldPath": field_path, "value": value }));
    }
    let mut mutation = serde_json::json!({
        "schemaVersion": SYNC_MUTATION_WIRE_SCHEMA_VERSION,
        "mutationId": mutation_id,
        "workspaceSchemaVersion": workspace_schema_version,
        "entityType": "domain_asset",
        "entityId": entity_id,
        "entityGeneration": entity_generation,
        "operationKind": operation_kind,
        "baseServerRevision": base_server_revision,
        "changedFields": changed_fields,
        "sourceDeviceId": source_device_id,
        "activeLeaseEpoch": active_lease_epoch,
        "deviceMutationSequence": device_mutation_sequence,
    });
    // A re-add carries the deletion revision it supersedes; any other mutation omits the field.
    if let Some(revision) = re_adds_deleted_revision {
        mutation
            .as_object_mut()
            .ok_or(BusinessDatabaseError::StorageRejected)?
            .insert(
                "reAddsDeletedRevision".to_owned(),
                serde_json::json!(revision),
            );
    }
    if operation_kind == "delete" {
        mutation
            .as_object_mut()
            .ok_or(BusinessDatabaseError::StorageRejected)?
            .insert(
                "deletedAt".to_owned(),
                serde_json::Value::String(created_at.to_owned()),
            );
    }
    Ok(mutation)
}

pub(super) fn validate_cursor_token(token: Option<&str>) -> Result<(), BusinessDatabaseError> {
    if token.is_some_and(|value| {
        value.is_empty()
            || value.len() > 512
            || value
                .bytes()
                .any(|byte| !byte.is_ascii_alphanumeric() && byte != b'_' && byte != b'-')
    }) {
        return Err(BusinessDatabaseError::InvalidInput);
    }
    Ok(())
}

pub(super) fn validate_digest(value: &str) -> Result<(), BusinessDatabaseError> {
    if value.len() != 43
        || value
            .bytes()
            .any(|byte| !byte.is_ascii_alphanumeric() && byte != b'_' && byte != b'-')
    {
        return Err(BusinessDatabaseError::InvalidInput);
    }
    Ok(())
}

pub(crate) fn canonical_page_digest(
    value: &serde_json::Value,
) -> Result<String, BusinessDatabaseError> {
    let mut digest_input = value
        .as_object()
        .cloned()
        .ok_or(BusinessDatabaseError::InvalidInput)?;
    digest_input.remove("pageDigest");
    let mut encoded = Vec::new();
    append_frame(&mut encoded, b'd', b"GOODDEALER-WORKSPACE-MUTATION-PAGE-V2");
    append_frame(
        &mut encoded,
        b'v',
        &canonical_wire_value(&serde_json::Value::Object(digest_input))?,
    );
    Ok(base64url(&Sha256::digest(encoded)))
}

/// Verifies the protocol-owned pinned rebootstrap plan digest with the canonical wire codec.
///
/// # Errors
///
/// Returns an input error for malformed objects or a digest mismatch.
#[cfg(all(test, unix))]
pub fn verify_rebootstrap_plan_digest(
    value: &serde_json::Value,
) -> Result<(), BusinessDatabaseError> {
    let mut input = value
        .as_object()
        .cloned()
        .ok_or(BusinessDatabaseError::InvalidInput)?;
    let advertised = input
        .remove("pinnedHeadDigest")
        .and_then(|value| value.as_str().map(str::to_owned))
        .ok_or(BusinessDatabaseError::InvalidInput)?;
    validate_digest(&advertised)?;
    let mut encoded = Vec::new();
    append_frame(
        &mut encoded,
        b'd',
        b"GOODDEALER-WORKSPACE-REBOOTSTRAP-PLAN-V3",
    );
    append_frame(
        &mut encoded,
        b'v',
        &canonical_wire_value(&serde_json::Value::Object(input))?,
    );
    if base64url(&Sha256::digest(encoded)) != advertised {
        return Err(BusinessDatabaseError::InvalidInput);
    }
    Ok(())
}

/// Verifies that a complete version 3 checkpoint state matches its advertised aggregate digest.
///
/// The computation mirrors the protocol (ADR-0029): live assets, each carrying its entity
/// generation, in bounded 512-row partitions `p0000…` (or the single `empty` partition), then
/// tombstones in partitions `t0000…`, each under its own domain, aggregated under the checkpoint
/// entity-digest domain. `state` is the strictly deserialized wire object, so its canonical
/// encoding is exactly what the Cloud digested; `rows` are its live assets, validated here with the
/// local business rules. Callers must perform this check before creating a candidate key or
/// touching staged storage.
///
/// # Errors
///
/// Returns an input error for a malformed projection, malformed digest, or digest mismatch.
#[cfg(all(test, unix))]
pub fn verify_rebootstrap_checkpoint_digest(
    rows: &[DomainAssetProjectionRow],
    state: &serde_json::Value,
    advertised: &str,
) -> Result<(), BusinessDatabaseError> {
    validate_projection(rows).map_err(|_| BusinessDatabaseError::InvalidInput)?;
    validate_digest(advertised)?;
    let section = |key: &str| {
        state
            .get(key)
            .and_then(serde_json::Value::as_array)
            .ok_or(BusinessDatabaseError::InvalidInput)
    };
    let assets = section("assets")?;
    let tombstones = section("tombstones")?;
    if assets.len() != rows.len() {
        return Err(BusinessDatabaseError::InvalidInput);
    }
    let mut partitions: Vec<(&str, String, &[serde_json::Value])> = Vec::new();
    if assets.is_empty() {
        partitions.push(("domain_asset", "empty".to_owned(), assets));
    }
    for (index, partition) in assets.chunks(512).enumerate() {
        partitions.push(("domain_asset", format!("p{index:04}"), partition));
    }
    for (index, partition) in tombstones.chunks(512).enumerate() {
        partitions.push(("domain_asset_tombstone", format!("t{index:04}"), partition));
    }
    if partitions.len() > 4_096 {
        return Err(BusinessDatabaseError::InvalidInput);
    }
    let mut entity_digests = Vec::with_capacity(partitions.len());
    for (entity_type, partition_id, partition) in partitions {
        let domain: &[u8] = if entity_type == "domain_asset" {
            b"GOODDEALER-WORKSPACE-CHECKPOINT-DOMAIN-ASSET-V3"
        } else {
            b"GOODDEALER-WORKSPACE-CHECKPOINT-DOMAIN-ASSET-TOMBSTONE-V3"
        };
        let mut encoded = Vec::new();
        append_frame(&mut encoded, b'd', domain);
        append_frame(
            &mut encoded,
            b'v',
            &canonical_wire_value(&serde_json::Value::Array(partition.to_vec()))?,
        );
        entity_digests.push(serde_json::json!({
            "entityType": entity_type,
            "partitionId": partition_id,
            "digest": base64url(&Sha256::digest(encoded)),
        }));
    }
    let mut aggregate = Vec::new();
    append_frame(
        &mut aggregate,
        b'd',
        b"GOODDEALER-WORKSPACE-CHECKPOINT-ENTITY-DIGESTS-V3",
    );
    append_frame(
        &mut aggregate,
        b'v',
        &canonical_wire_value(&serde_json::Value::Array(entity_digests))?,
    );
    if base64url(&Sha256::digest(aggregate)) != advertised {
        return Err(BusinessDatabaseError::InvalidInput);
    }
    Ok(())
}

/// Validates one recovery projection row with the same rules used by local business writes.
///
/// # Errors
///
/// Returns an input error when the row is not a canonical domain-asset projection.
#[cfg(all(test, unix))]
pub fn validate_rebootstrap_asset(asset: &DomainAssetWrite) -> Result<(), BusinessDatabaseError> {
    validate_domain_asset(asset)
}

/// Validates a canonical UTC-second timestamp from a recovery wire value.
///
/// # Errors
///
/// Returns an input error when the timestamp is not canonical or is not a real date.
#[cfg(test)]
pub fn validate_rebootstrap_timestamp(value: &str) -> Result<(), BusinessDatabaseError> {
    validate_timestamp(Some(value.to_owned()))
        .map(|_| ())
        .map_err(|_| BusinessDatabaseError::InvalidInput)
}

/// Verifies a mutation page digest before staged storage is touched.
///
/// # Errors
///
/// Returns an input error for malformed objects or a digest mismatch.
#[cfg(all(test, unix))]
pub fn verify_rebootstrap_page_digest(
    value: &serde_json::Value,
) -> Result<(), BusinessDatabaseError> {
    let advertised = value
        .get("pageDigest")
        .and_then(serde_json::Value::as_str)
        .ok_or(BusinessDatabaseError::InvalidInput)?;
    validate_digest(advertised)?;
    if canonical_page_digest(value)? != advertised {
        return Err(BusinessDatabaseError::InvalidInput);
    }
    Ok(())
}

pub(super) fn canonical_mutation_digest(
    mutation: &SyncMutationV2,
    wire_version: i64,
) -> Result<String, BusinessDatabaseError> {
    let mut value =
        serde_json::to_value(mutation).map_err(|_| BusinessDatabaseError::StorageRejected)?;
    if let Some(object) = value.as_object_mut() {
        object.remove("workspaceId");
        object.remove("serverRevision");
    }
    local_wire_digest(&value, wire_version)
}

/// The digest recorded in the local `wire_mutation_digest` columns under the row's
/// `wire_schema_version`. Version 3 digests the mutation as sent. Version 2 remains only for rows
/// recorded before ADR-0029 C1c2b: the v2 encoding of a first-generation mutation, re-derived from
/// its v3 form by dropping `entityGeneration`. For generation 1 both encodings carry the same
/// content, so those rows keep matching; any other generation has no v2 encoding and is refused.
pub(super) fn local_wire_digest(
    value: &serde_json::Value,
    wire_version: i64,
) -> Result<String, BusinessDatabaseError> {
    let mut object = value
        .as_object()
        .cloned()
        .ok_or(BusinessDatabaseError::StorageRejected)?;
    if object.get("schemaVersion") != Some(&serde_json::json!(SYNC_MUTATION_WIRE_SCHEMA_VERSION)) {
        return Err(BusinessDatabaseError::StorageRejected);
    }
    match wire_version {
        3 => canonical_sync_digest(&serde_json::Value::Object(object)),
        2 => {
            if object.remove("entityGeneration") != Some(serde_json::json!(1))
                || object.contains_key("reAddsDeletedRevision")
            {
                return Err(BusinessDatabaseError::StorageRejected);
            }
            object.insert("schemaVersion".to_owned(), serde_json::json!(2));
            canonical_sync_digest(&serde_json::Value::Object(object))
        }
        _ => Err(BusinessDatabaseError::StorageRejected),
    }
}

pub(super) fn validate_sync_mutation_fields(
    mutation: &SyncMutationV2,
) -> Result<(), BusinessDatabaseError> {
    let mut previous: Option<&str> = None;
    for field in &mutation.changed_fields {
        if previous.is_some_and(|prior| prior >= field.field_path.as_str()) {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        previous = Some(&field.field_path);
        match field.field_path.as_str() {
            "note" | "portfolioId" if field.value.is_null() || field.value.is_string() => {}
            "tags" => {
                let tags: Vec<String> = serde_json::from_value(field.value.clone())
                    .map_err(|_| BusinessDatabaseError::InvalidInput)?;
                if tags.len() > 64 || tags.iter().any(|tag| tag.is_empty() || tag.len() > 64) {
                    return Err(BusinessDatabaseError::InvalidInput);
                }
            }
            "targetPrice" if field.value.is_null() => {}
            "targetPrice" => {
                let object = field
                    .value
                    .as_object()
                    .ok_or(BusinessDatabaseError::InvalidInput)?;
                if object.len() != 2
                    || object
                        .get("currency")
                        .and_then(|value| value.as_str())
                        .is_none()
                    || object
                        .get("amount")
                        .and_then(|value| value.as_str())
                        .is_none()
                {
                    return Err(BusinessDatabaseError::InvalidInput);
                }
            }
            _ => return Err(BusinessDatabaseError::InvalidInput),
        }
    }
    Ok(())
}

pub(super) fn canonical_sync_digest(
    value: &serde_json::Value,
) -> Result<String, BusinessDatabaseError> {
    let mut encoded = Vec::new();
    append_frame(&mut encoded, b'd', b"GOODDEALER-WORKSPACE-MUTATION-V2");
    let canonical = canonical_wire_value(value)?;
    append_frame(&mut encoded, b'v', &canonical);
    Ok(base64url(&Sha256::digest(encoded)))
}

pub(super) fn canonical_wire_value(
    value: &serde_json::Value,
) -> Result<Vec<u8>, BusinessDatabaseError> {
    let mut output = Vec::new();
    match value {
        serde_json::Value::Null => output.extend_from_slice(b"z0:"),
        serde_json::Value::Bool(value) => {
            output.extend_from_slice(if *value { b"b1:1" } else { b"b1:0" });
        }
        serde_json::Value::Number(value) => {
            let number = value
                .as_i64()
                .ok_or(BusinessDatabaseError::StorageRejected)?;
            append_frame(&mut output, b'n', number.to_string().as_bytes());
        }
        serde_json::Value::String(value) => append_frame(&mut output, b's', value.as_bytes()),
        serde_json::Value::Array(values) => {
            let mut entries = Vec::new();
            for value in values {
                append_frame(&mut entries, b'e', &canonical_wire_value(value)?);
            }
            append_frame(&mut output, b'a', &entries);
        }
        serde_json::Value::Object(values) => {
            let mut keys = values.keys().collect::<Vec<_>>();
            keys.sort_unstable();
            let mut entries = Vec::new();
            for key in keys {
                let mut entry = Vec::new();
                append_frame(&mut entry, b'k', key.as_bytes());
                append_frame(&mut entry, b'v', &canonical_wire_value(&values[key])?);
                append_frame(&mut entries, b'e', &entry);
            }
            append_frame(&mut output, b'o', &entries);
        }
    }
    Ok(output)
}

pub(super) fn append_frame(output: &mut Vec<u8>, tag: u8, payload: &[u8]) {
    output.push(tag);
    output.extend_from_slice(payload.len().to_string().as_bytes());
    output.push(b':');
    output.extend_from_slice(payload);
}

fn base64url(value: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut output = String::with_capacity(value.len().div_ceil(3) * 4);
    for chunk in value.chunks(3) {
        let bits = (u32::from(chunk[0]) << 16)
            | (u32::from(*chunk.get(1).unwrap_or(&0)) << 8)
            | u32::from(*chunk.get(2).unwrap_or(&0));
        output.push(char::from(ALPHABET[((bits >> 18) & 63) as usize]));
        output.push(char::from(ALPHABET[((bits >> 12) & 63) as usize]));
        if chunk.len() > 1 {
            output.push(char::from(ALPHABET[((bits >> 6) & 63) as usize]));
        }
        if chunk.len() > 2 {
            output.push(char::from(ALPHABET[(bits & 63) as usize]));
        }
    }
    output
}

fn reject_secret_keys(payload: &str) -> Result<(), BusinessDatabaseError> {
    if payload.len() > 1_048_576 {
        return Err(BusinessDatabaseError::InvalidInput);
    }
    let value: serde_json::Value =
        serde_json::from_str(payload).map_err(|_| BusinessDatabaseError::InvalidInput)?;
    if !value.is_object() {
        return Err(BusinessDatabaseError::InvalidInput);
    }
    if contains_forbidden_sync_key(&value) {
        return Err(BusinessDatabaseError::SecretInSyncPayload);
    }
    Ok(())
}

fn contains_forbidden_sync_key(value: &serde_json::Value) -> bool {
    match value {
        serde_json::Value::Object(object) => object.iter().any(|(key, value)| {
            let normalized: String = key
                .chars()
                .filter(char::is_ascii_alphanumeric)
                .flat_map(char::to_lowercase)
                .collect();
            FORBIDDEN_SYNC_KEYS.iter().any(|forbidden| {
                let forbidden: String = forbidden
                    .chars()
                    .filter(char::is_ascii_alphanumeric)
                    .flat_map(char::to_lowercase)
                    .collect();
                normalized.contains(&forbidden)
            }) || contains_forbidden_sync_key(value)
        }),
        serde_json::Value::Array(values) => values.iter().any(contains_forbidden_sync_key),
        _ => false,
    }
}
