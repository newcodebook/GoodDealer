use serde::Deserialize;
use sha2::{Digest, Sha256};

/// Canonical wire encoding matching the TypeScript `encodeCanonicalWireValue`
/// and `encodeDomainSeparatedWireValue` from `packages/protocol/src/wire/canonical-codec.ts`.
pub(crate) mod canonical_codec {
    fn frame(tag: &str, payload: &[u8]) -> Vec<u8> {
        let header = format!("{tag}{}:", payload.len());
        let mut output = Vec::with_capacity(header.len() + payload.len());
        output.extend_from_slice(header.as_bytes());
        output.extend_from_slice(payload);
        output
    }

    pub fn encode_canonical_wire_value(value: &serde_json::Value) -> Vec<u8> {
        match value {
            serde_json::Value::Null => b"z0:".to_vec(),
            serde_json::Value::Bool(true) => b"b1:1".to_vec(),
            serde_json::Value::Bool(false) => b"b1:0".to_vec(),
            serde_json::Value::Number(number) => {
                let s = if number.as_f64().is_some_and(|n| n == 0.0) {
                    "0".to_string()
                } else {
                    // Safe integers in JSON: serde_json preserves integer representation
                    number.to_string()
                };
                frame("n", s.as_bytes())
            }
            serde_json::Value::String(s) => frame("s", s.as_bytes()),
            serde_json::Value::Array(entries) => {
                let mut parts = Vec::new();
                for entry in entries {
                    parts.extend(frame("e", &encode_canonical_wire_value(entry)));
                }
                frame("a", &parts)
            }
            serde_json::Value::Object(map) => {
                // Keys must be sorted (serde_json::Map preserves insertion order; sort explicitly)
                let mut keys: Vec<&String> = map.keys().collect();
                keys.sort();
                let mut parts = Vec::new();
                for key in keys {
                    let value = &map[key];
                    let k = frame("k", key.as_bytes());
                    let v = frame("v", &encode_canonical_wire_value(value));
                    let mut entry = Vec::with_capacity(k.len() + v.len());
                    entry.extend(k);
                    entry.extend(v);
                    parts.extend(frame("e", &entry));
                }
                frame("o", &parts)
            }
        }
    }

    pub fn encode_domain_separated_wire_value(domain: &str, value: &serde_json::Value) -> Vec<u8> {
        let d = frame("d", domain.as_bytes());
        let v = frame("v", &encode_canonical_wire_value(value));
        let mut output = Vec::with_capacity(d.len() + v.len());
        output.extend(d);
        output.extend(v);
        output
    }
}

// --- Validation helpers ---

const RECOVERY_BACKUP_SCHEMA_VERSION: u64 = 1;
const BASE64URL_CHARS: &str = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";

fn is_base64url(s: &str) -> bool {
    !s.is_empty() && s.chars().all(|c| BASE64URL_CHARS.contains(c))
}

fn is_identifier(s: &str) -> bool {
    let len = s.len();
    (1..=160).contains(&len) && s.bytes().all(|b| (0x21..=0x7E).contains(&b))
}

fn is_sha256_digest(s: &str) -> bool {
    s.len() == 43 && s.chars().all(|c| BASE64URL_CHARS.contains(c))
}

fn is_safe_positive_integer(n: u64) -> bool {
    (1..=9_007_199_254_740_991).contains(&n)
}

fn is_safe_unsigned_integer(n: u64) -> bool {
    n <= 9_007_199_254_740_991
}

// --- Contract types ---

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
pub enum BackupClass {
    #[serde(rename = "synchronized")]
    Synchronized,
    #[serde(rename = "emergency")]
    Emergency,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
pub enum CryptoProfile {
    #[serde(rename = "gd.backup.aead.v1")]
    GdBackupAeadV1,
}

// RestoreCandidateStatus is validated by string match (discriminatedUnion pattern)
// rather than serde deserialization, matching how the TS discriminatedUnion works.

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
pub enum ApplyBlockedReason {
    #[serde(rename = "baseline_ahead")]
    BaselineAhead,
    #[serde(rename = "identity_mismatch")]
    IdentityMismatch,
    #[serde(rename = "proof_stale")]
    ProofStale,
}

/// Validation error for recovery contracts.
#[derive(Debug)]
pub enum RecoveryValidationError {
    /// JSON structure does not match the expected schema.
    Shape(String),
    /// A field value does not pass format/range validation.
    Field { field: &'static str, message: String },
    /// An unknown field was present in a strict object.
    UnknownField(String),
    /// The manifest digest does not match the recomputed value.
    ManifestDigestMismatch,
}

impl std::fmt::Display for RecoveryValidationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Shape(message) => write!(f, "shape error: {message}"),
            Self::Field { field, message } => write!(f, "field {field}: {message}"),
            Self::UnknownField(field) => write!(f, "unknown field: {field}"),
            Self::ManifestDigestMismatch => write!(f, "manifest digest does not match recomputed domain-separated digest"),
        }
    }
}

impl std::error::Error for RecoveryValidationError {}

// --- Strict validation using serde_json::Value ---

/// `BackupExportDescriptor` (§5.2)
pub fn validate_backup_export_descriptor(
    value: &serde_json::Value,
) -> Result<(), RecoveryValidationError> {
    let object = value
        .as_object()
        .ok_or_else(|| RecoveryValidationError::Shape("expected object".into()))?;

    let expected_fields = [
        "schemaVersion",
        "backupClass",
        "backupId",
        "workspaceId",
        "sourceDeviceId",
        "activeLeaseEpoch",
        "throughRevision",
        "proofId",
        "proofDigest",
    ];

    // Strict: reject unknown fields
    for key in object.keys() {
        if !expected_fields.contains(&key.as_str()) {
            return Err(RecoveryValidationError::UnknownField(key.clone()));
        }
    }

    // Required fields
    require_literal_u64(object, "schemaVersion", RECOVERY_BACKUP_SCHEMA_VERSION)?;
    require_enum::<BackupClass>(object, "backupClass")?;
    require_identifier(object, "backupId")?;
    require_identifier(object, "workspaceId")?;
    require_identifier(object, "sourceDeviceId")?;
    require_safe_positive_integer(object, "activeLeaseEpoch")?;
    require_safe_unsigned_integer(object, "throughRevision")?;
    require_identifier(object, "proofId")?;
    require_sha256_digest(object, "proofDigest")?;

    Ok(())
}

/// `SealedBackupEnvelope` (§5.1)
pub fn validate_sealed_backup_envelope(
    value: &serde_json::Value,
) -> Result<(), RecoveryValidationError> {
    let object = value
        .as_object()
        .ok_or_else(|| RecoveryValidationError::Shape("expected object".into()))?;

    let expected_fields = [
        "schemaVersion",
        "cryptoProfile",
        "sealDomain",
        "keyId",
        "nonce",
        "aad",
        "ciphertext",
        "authTag",
    ];

    for key in object.keys() {
        if !expected_fields.contains(&key.as_str()) {
            return Err(RecoveryValidationError::UnknownField(key.clone()));
        }
    }

    require_literal_u64(object, "schemaVersion", RECOVERY_BACKUP_SCHEMA_VERSION)?;
    require_enum::<CryptoProfile>(object, "cryptoProfile")?;
    require_literal_string(object, "sealDomain", "gd.backup-seal.v1")?;
    require_identifier(object, "keyId")?;
    require_base64url_length(object, "nonce", 32)?;
    require_sha256_digest(object, "aad")?;
    require_base64url(object, "ciphertext")?;
    require_base64url_length(object, "authTag", 22)?;

    Ok(())
}

/// `EncryptedBackupManifest` (§5.3) with `superRefine` digest recompute.
pub fn validate_encrypted_backup_manifest(
    value: &serde_json::Value,
) -> Result<(), RecoveryValidationError> {
    let object = value
        .as_object()
        .ok_or_else(|| RecoveryValidationError::Shape("expected object".into()))?;

    let expected_fields = [
        "schemaVersion",
        "backupClass",
        "backupId",
        "manifestDigest",
        "workspaceId",
        "workspaceSchemaVersion",
        "sourceDeviceId",
        "activeLeaseEpoch",
        "throughRevision",
        "cryptoProfile",
        "keyId",
        "envelopeDigest",
        "proofId",
        "proofDigest",
    ];

    for key in object.keys() {
        if !expected_fields.contains(&key.as_str()) {
            return Err(RecoveryValidationError::UnknownField(key.clone()));
        }
    }

    require_literal_u64(object, "schemaVersion", RECOVERY_BACKUP_SCHEMA_VERSION)?;
    require_enum::<BackupClass>(object, "backupClass")?;
    require_identifier(object, "backupId")?;
    let manifest_digest = require_sha256_digest(object, "manifestDigest")?;
    require_identifier(object, "workspaceId")?;
    require_safe_positive_integer(object, "workspaceSchemaVersion")?;
    require_identifier(object, "sourceDeviceId")?;
    require_safe_positive_integer(object, "activeLeaseEpoch")?;
    require_safe_unsigned_integer(object, "throughRevision")?;
    require_enum::<CryptoProfile>(object, "cryptoProfile")?;
    require_identifier(object, "keyId")?;
    require_sha256_digest(object, "envelopeDigest")?;
    require_identifier(object, "proofId")?;
    require_sha256_digest(object, "proofDigest")?;

    // superRefine: recompute manifest digest
    let mut digest_input = object.clone();
    digest_input.remove("manifestDigest");
    let encoded = canonical_codec::encode_domain_separated_wire_value(
        "GOODDEALER-RECOVERY-BACKUP-MANIFEST-V1",
        &serde_json::Value::Object(digest_input),
    );
    let recomputed = base64url_encode(&Sha256::digest(&encoded));
    if recomputed != manifest_digest {
        return Err(RecoveryValidationError::ManifestDigestMismatch);
    }

    Ok(())
}

/// `RestoreCandidate` (§5.4) discriminated union on `status`.
pub fn validate_restore_candidate(
    value: &serde_json::Value,
) -> Result<(), RecoveryValidationError> {
    let object = value
        .as_object()
        .ok_or_else(|| RecoveryValidationError::Shape("expected object".into()))?;

    let status_str = object
        .get("status")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| RecoveryValidationError::Field {
            field: "status",
            message: "required string".into(),
        })?;

    match status_str {
        "rebase_required" => {
            let expected_fields = [
                "status",
                "candidateId",
                "backupId",
                "workspaceId",
                "compareRevision",
                "manifestDigest",
                "cloudDerivedAt",
            ];
            for key in object.keys() {
                if !expected_fields.contains(&key.as_str()) {
                    return Err(RecoveryValidationError::UnknownField(key.clone()));
                }
            }
            require_identifier(object, "candidateId")?;
            require_identifier(object, "backupId")?;
            require_identifier(object, "workspaceId")?;
            require_safe_unsigned_integer(object, "compareRevision")?;
            require_sha256_digest(object, "manifestDigest")?;
            require_safe_unsigned_integer(object, "cloudDerivedAt")?;
        }
        "apply_blocked" => {
            let expected_fields = [
                "status",
                "candidateId",
                "backupId",
                "workspaceId",
                "compareRevision",
                "manifestDigest",
                "cloudDerivedAt",
                "currentValueHash",
                "reason",
            ];
            for key in object.keys() {
                if !expected_fields.contains(&key.as_str()) {
                    return Err(RecoveryValidationError::UnknownField(key.clone()));
                }
            }
            require_identifier(object, "candidateId")?;
            require_identifier(object, "backupId")?;
            require_identifier(object, "workspaceId")?;
            require_safe_unsigned_integer(object, "compareRevision")?;
            require_sha256_digest(object, "manifestDigest")?;
            require_safe_unsigned_integer(object, "cloudDerivedAt")?;
            require_sha256_digest(object, "currentValueHash")?;
            require_enum::<ApplyBlockedReason>(object, "reason")?;
        }
        _ => {
            return Err(RecoveryValidationError::Field {
                field: "status",
                message: format!("unknown status: {status_str}"),
            });
        }
    }

    Ok(())
}

// --- Field validation helpers ---

fn require_literal_u64(
    object: &serde_json::Map<String, serde_json::Value>,
    field: &'static str,
    expected: u64,
) -> Result<(), RecoveryValidationError> {
    let value = object
        .get(field)
        .ok_or_else(|| RecoveryValidationError::Field {
            field,
            message: "required".into(),
        })?;
    let number = value.as_u64().ok_or_else(|| RecoveryValidationError::Field {
        field,
        message: "expected unsigned integer".into(),
    })?;
    if number != expected {
        return Err(RecoveryValidationError::Field {
            field,
            message: format!("expected {expected}, got {number}"),
        });
    }
    Ok(())
}

fn require_literal_string(
    object: &serde_json::Map<String, serde_json::Value>,
    field: &'static str,
    expected: &str,
) -> Result<(), RecoveryValidationError> {
    let value = object
        .get(field)
        .ok_or_else(|| RecoveryValidationError::Field {
            field,
            message: "required".into(),
        })?;
    let string = value.as_str().ok_or_else(|| RecoveryValidationError::Field {
        field,
        message: "expected string".into(),
    })?;
    if string != expected {
        return Err(RecoveryValidationError::Field {
            field,
            message: format!("expected \"{expected}\", got \"{string}\""),
        });
    }
    Ok(())
}

fn require_identifier(
    object: &serde_json::Map<String, serde_json::Value>,
    field: &'static str,
) -> Result<String, RecoveryValidationError> {
    let value = object
        .get(field)
        .ok_or_else(|| RecoveryValidationError::Field {
            field,
            message: "required".into(),
        })?;
    let string = value.as_str().ok_or_else(|| RecoveryValidationError::Field {
        field,
        message: "expected string".into(),
    })?;
    if !is_identifier(string) {
        return Err(RecoveryValidationError::Field {
            field,
            message: "invalid identifier".into(),
        });
    }
    Ok(string.to_owned())
}

fn require_sha256_digest(
    object: &serde_json::Map<String, serde_json::Value>,
    field: &'static str,
) -> Result<String, RecoveryValidationError> {
    let value = object
        .get(field)
        .ok_or_else(|| RecoveryValidationError::Field {
            field,
            message: "required".into(),
        })?;
    let string = value.as_str().ok_or_else(|| RecoveryValidationError::Field {
        field,
        message: "expected string".into(),
    })?;
    if !is_sha256_digest(string) {
        return Err(RecoveryValidationError::Field {
            field,
            message: "invalid sha256 digest".into(),
        });
    }
    Ok(string.to_owned())
}

fn require_safe_positive_integer(
    object: &serde_json::Map<String, serde_json::Value>,
    field: &'static str,
) -> Result<u64, RecoveryValidationError> {
    let value = object
        .get(field)
        .ok_or_else(|| RecoveryValidationError::Field {
            field,
            message: "required".into(),
        })?;
    let number = value.as_u64().ok_or_else(|| RecoveryValidationError::Field {
        field,
        message: "expected unsigned integer".into(),
    })?;
    if !is_safe_positive_integer(number) {
        return Err(RecoveryValidationError::Field {
            field,
            message: "must be a safe positive integer".into(),
        });
    }
    Ok(number)
}

fn require_safe_unsigned_integer(
    object: &serde_json::Map<String, serde_json::Value>,
    field: &'static str,
) -> Result<u64, RecoveryValidationError> {
    let value = object
        .get(field)
        .ok_or_else(|| RecoveryValidationError::Field {
            field,
            message: "required".into(),
        })?;
    let number = value.as_u64().ok_or_else(|| RecoveryValidationError::Field {
        field,
        message: "expected unsigned integer".into(),
    })?;
    if !is_safe_unsigned_integer(number) {
        return Err(RecoveryValidationError::Field {
            field,
            message: "must be a safe unsigned integer".into(),
        });
    }
    Ok(number)
}

fn require_base64url(
    object: &serde_json::Map<String, serde_json::Value>,
    field: &'static str,
) -> Result<String, RecoveryValidationError> {
    let value = object
        .get(field)
        .ok_or_else(|| RecoveryValidationError::Field {
            field,
            message: "required".into(),
        })?;
    let string = value.as_str().ok_or_else(|| RecoveryValidationError::Field {
        field,
        message: "expected string".into(),
    })?;
    if !is_base64url(string) {
        return Err(RecoveryValidationError::Field {
            field,
            message: "invalid base64url".into(),
        });
    }
    Ok(string.to_owned())
}

fn require_base64url_length(
    object: &serde_json::Map<String, serde_json::Value>,
    field: &'static str,
    length: usize,
) -> Result<String, RecoveryValidationError> {
    let string = require_base64url(object, field)?;
    if string.len() != length {
        return Err(RecoveryValidationError::Field {
            field,
            message: format!("expected length {length}, got {}", string.len()),
        });
    }
    Ok(string)
}

fn require_enum<T: serde::de::DeserializeOwned>(
    object: &serde_json::Map<String, serde_json::Value>,
    field: &'static str,
) -> Result<(), RecoveryValidationError> {
    let value = object
        .get(field)
        .ok_or_else(|| RecoveryValidationError::Field {
            field,
            message: "required".into(),
        })?;
    serde_json::from_value::<T>(value.clone()).map_err(|error| RecoveryValidationError::Field {
        field,
        message: format!("invalid enum variant: {error}"),
    })?;
    Ok(())
}

pub(crate) fn base64url_encode(bytes: &[u8]) -> String {
    use base64url_alphabet::*;
    let mut output = String::with_capacity((bytes.len() * 4).div_ceil(3));
    let chunks = bytes.chunks(3);
    for chunk in chunks {
        match chunk.len() {
            3 => {
                let b0 = chunk[0];
                let b1 = chunk[1];
                let b2 = chunk[2];
                output.push(ALPHABET[(b0 >> 2) as usize]);
                output.push(ALPHABET[((b0 & 0x03) << 4 | b1 >> 4) as usize]);
                output.push(ALPHABET[((b1 & 0x0F) << 2 | b2 >> 6) as usize]);
                output.push(ALPHABET[(b2 & 0x3F) as usize]);
            }
            2 => {
                let b0 = chunk[0];
                let b1 = chunk[1];
                output.push(ALPHABET[(b0 >> 2) as usize]);
                output.push(ALPHABET[((b0 & 0x03) << 4 | b1 >> 4) as usize]);
                output.push(ALPHABET[((b1 & 0x0F) << 2) as usize]);
            }
            1 => {
                let b0 = chunk[0];
                output.push(ALPHABET[(b0 >> 2) as usize]);
                output.push(ALPHABET[((b0 & 0x03) << 4) as usize]);
            }
            _ => unreachable!(),
        }
    }
    output
}

mod base64url_alphabet {
    pub const ALPHABET: [char; 64] = [
        'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q',
        'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h',
        'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y',
        'z', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '-', '_',
    ];
}

// --- Dispatch for Wire Corpus testing ---

/// Validates a JSON value against the named schema, returning Ok(()) on valid, Err on invalid.
/// Schema names match the Wire Corpus: "backupExportDescriptor", "sealedBackupEnvelope",
/// "encryptedBackupManifest", "restoreCandidate".
pub fn validate_by_schema_name(
    schema: &str,
    value: &serde_json::Value,
) -> Result<(), RecoveryValidationError> {
    match schema {
        "backupExportDescriptor" => validate_backup_export_descriptor(value),
        "sealedBackupEnvelope" => validate_sealed_backup_envelope(value),
        "encryptedBackupManifest" => validate_encrypted_backup_manifest(value),
        "restoreCandidate" => validate_restore_candidate(value),
        _ => Err(RecoveryValidationError::Shape(format!(
            "unknown schema: {schema}"
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const WIRE_CORPUS_PATH: &str = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/protocol/test-vectors/recovery/wire-corpus.json"
    );

    #[derive(Deserialize)]
    struct WireCorpus {
        valid: Vec<WireCorpusEntry>,
        invalid: Vec<WireCorpusEntry>,
    }

    #[derive(Deserialize)]
    struct WireCorpusEntry {
        file: String,
        schema: String,
    }

    fn load_vector(file: &str) -> serde_json::Value {
        let path = format!(
            "{}/../../packages/protocol/test-vectors/recovery/{file}",
            env!("CARGO_MANIFEST_DIR")
        );
        let content = std::fs::read_to_string(&path)
            .unwrap_or_else(|error| panic!("read {path}: {error}"));
        serde_json::from_str(&content)
            .unwrap_or_else(|error| panic!("parse {path}: {error}"))
    }

    #[test]
    fn shared_wire_corpus_valid_vectors_pass() {
        let corpus: WireCorpus = serde_json::from_str(
            &std::fs::read_to_string(WIRE_CORPUS_PATH).expect("read wire corpus"),
        )
        .expect("parse wire corpus");

        for entry in &corpus.valid {
            let value = load_vector(&entry.file);
            let result = validate_by_schema_name(&entry.schema, &value);
            assert!(
                result.is_ok(),
                "expected valid/{} ({}) to pass, got: {:?}",
                entry.file,
                entry.schema,
                result.unwrap_err()
            );
        }
    }

    #[test]
    fn shared_wire_corpus_invalid_vectors_fail() {
        let corpus: WireCorpus = serde_json::from_str(
            &std::fs::read_to_string(WIRE_CORPUS_PATH).expect("read wire corpus"),
        )
        .expect("parse wire corpus");

        for entry in &corpus.invalid {
            let value = load_vector(&entry.file);
            let result = validate_by_schema_name(&entry.schema, &value);
            assert!(
                result.is_err(),
                "expected invalid/{} ({}) to fail, but it passed",
                entry.file,
                entry.schema
            );
        }
    }

    #[test]
    fn manifest_digest_recompute_matches_typescript() {
        let value = load_vector("valid/encrypted-backup-manifest.json");
        assert!(validate_encrypted_backup_manifest(&value).is_ok());

        // Tamper with a field and verify the digest fails
        let mut tampered = value;
        tampered["backupId"] = serde_json::Value::String("tampered-id".into());
        assert!(validate_encrypted_backup_manifest(&tampered).is_err());
    }

    #[test]
    fn base64url_encode_roundtrip() {
        // SHA-256 of empty input
        let hash = Sha256::digest(b"");
        let encoded = base64url_encode(&hash);
        assert_eq!(encoded.len(), 43);
        assert_eq!(
            encoded,
            "47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU"
        );
    }
}
