use std::fs::{read, write};
use std::path::Path;

use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{Key, XChaCha20Poly1305, XNonce};
use rusqlite::Connection;
use sha2::{Digest, Sha256};

use crate::recovery::{base64url_encode, canonical_codec, validate_encrypted_backup_manifest};

// --- SealKeyProvider trait ---

/// Provides encryption keys for backup sealing. Production implementations
/// are NOT wired to keychain `LocalStorageMaster` (U5 upgrade item).
pub trait SealKeyProvider {
    /// Derive a 256-bit key for the given key ID under the seal domain.
    fn derive_key(&self, key_id: &str, seal_domain: &str) -> [u8; 32];
}

/// Test-only KDF under domain "gd.backup-seal.v1".
/// Derives keys as `SHA-256(seal_domain || key_id || test_root)`.
pub struct TestSealKeyProvider {
    test_root: [u8; 32],
}

impl TestSealKeyProvider {
    pub fn new(test_root: [u8; 32]) -> Self {
        Self { test_root }
    }
}

impl SealKeyProvider for TestSealKeyProvider {
    fn derive_key(&self, key_id: &str, seal_domain: &str) -> [u8; 32] {
        let mut hasher = Sha256::new();
        hasher.update(seal_domain.as_bytes());
        hasher.update(key_id.as_bytes());
        hasher.update(self.test_root);
        hasher.finalize().into()
    }
}

// --- Backup state machine ---

const BACKUP_CANARY: &str = "GOODDEALER_BACKUP_CANARY_DO_NOT_PERSIST_IN_PLAINTEXT";
const SQLITE_HEADER: &[u8] = b"SQLite format 3\0";
const FIXTURE_DB_KEY: [u8; 32] = [0x42; 32];

fn contains(haystack: &[u8], needle: &[u8]) -> bool {
    haystack
        .windows(needle.len())
        .any(|window| window == needle)
}

fn sha256_base64url(data: &[u8]) -> String {
    base64url_encode(&Sha256::digest(data))
}

fn create_fixture_db(path: &Path) {
    let connection = Connection::open(path).expect("open fixture DB");
    let raw_key = FIXTURE_DB_KEY
        .iter()
        .fold(String::with_capacity(64), |mut output, byte| {
            use std::fmt::Write;
            write!(output, "{byte:02x}").expect("write hex");
            output
        });
    connection
        .execute_batch(&format!(
            "PRAGMA key = \"x'{raw_key}'\"; PRAGMA cipher_memory_security = ON;"
        ))
        .expect("key fixture DB");
    connection
        .execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA wal_autocheckpoint = 0;
             CREATE TABLE fixture (value TEXT NOT NULL);",
        )
        .expect("create fixture schema");
    connection
        .execute(
            "INSERT INTO fixture(value) VALUES (?1)",
            [BACKUP_CANARY],
        )
        .expect("insert canary");
    connection
        .execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")
        .expect("checkpoint");
    drop(connection);
}

/// Export result from the backup state machine.
pub struct BackupExportResult {
    pub envelope_bytes: Vec<u8>,
    pub manifest_json: serde_json::Value,
}

/// Export a backup from a frozen fixture DB.
///
/// Construction order (breaks the manifest/envelope circular dependency):
/// 1. Seal plaintext with a placeholder AAD to obtain the `XChaCha20` ciphertext.
///    In XChaCha20-Poly1305, the stream cipher portion (ciphertext) depends only
///    on (key, nonce, plaintext) and is AAD-independent.
/// 2. Compute `envelopeDigest = SHA-256(ciphertext_bytes)` (raw AEAD ciphertext,
///    excluding the Poly1305 auth tag).
/// 3. Build manifest fields including `envelopeDigest`, compute `manifestDigest`.
/// 4. Re-seal with `aad = manifestDigest` to get the correct Poly1305 auth tag.
/// 5. Assemble the final envelope and manifest.
#[allow(clippy::too_many_arguments)]
pub fn export_backup(
    db_path: &Path,
    backup_id: &str,
    workspace_id: &str,
    source_device_id: &str,
    active_lease_epoch: u64,
    through_revision: u64,
    proof_id: &str,
    proof_digest: &str,
    key_id: &str,
    key_provider: &dyn SealKeyProvider,
) -> BackupExportResult {
    // INV-P025-01: Read from a single frozen boundary
    let plaintext = read(db_path).expect("read fixture DB for export");

    let seal_domain = "gd.backup-seal.v1";
    let key = key_provider.derive_key(key_id, seal_domain);

    // Deterministic nonce for test: SHA-256(backup_id) truncated to 24 bytes
    let nonce_material = Sha256::digest(format!("nonce:{backup_id}").as_bytes());
    let nonce: [u8; 24] = nonce_material[..24].try_into().expect("nonce slice");

    let cipher = XChaCha20Poly1305::new(&Key::from(key));
    let aead_nonce = XNonce::from(nonce);

    // Step 1: Seal with placeholder AAD to get deterministic ciphertext.
    let placeholder_sealed = cipher
        .encrypt(&aead_nonce, Payload { msg: &plaintext, aad: b"" })
        .expect("AEAD seal (placeholder)");

    // XChaCha20-Poly1305: last 16 bytes are the auth tag.
    let tag_size = 16;
    let ciphertext_bytes = &placeholder_sealed[..placeholder_sealed.len() - tag_size];

    // Step 2: envelopeDigest over raw ciphertext (AAD-independent)
    let envelope_digest = sha256_base64url(ciphertext_bytes);

    // Step 3: Build manifest fields, compute manifestDigest
    let manifest_fields = serde_json::json!({
        "schemaVersion": 1,
        "backupClass": "synchronized",
        "backupId": backup_id,
        "workspaceId": workspace_id,
        "workspaceSchemaVersion": 1,
        "sourceDeviceId": source_device_id,
        "activeLeaseEpoch": active_lease_epoch,
        "throughRevision": through_revision,
        "cryptoProfile": "gd.backup.aead.v1",
        "keyId": key_id,
        "envelopeDigest": envelope_digest,
        "proofId": proof_id,
        "proofDigest": proof_digest,
    });

    let encoded = canonical_codec::encode_domain_separated_wire_value(
        "GOODDEALER-RECOVERY-BACKUP-MANIFEST-V1",
        &manifest_fields,
    );
    let manifest_digest = sha256_base64url(&encoded);

    // Step 4: Re-seal with correct AAD = manifestDigest
    let final_sealed = cipher
        .encrypt(
            &aead_nonce,
            Payload {
                msg: &plaintext,
                aad: manifest_digest.as_bytes(),
            },
        )
        .expect("AEAD seal (final)");

    let final_ciphertext = &final_sealed[..final_sealed.len() - tag_size];
    let final_auth_tag = &final_sealed[final_sealed.len() - tag_size..];

    // Verify: XChaCha20 ciphertext is AAD-independent
    assert_eq!(
        ciphertext_bytes, final_ciphertext,
        "ciphertext must be identical regardless of AAD"
    );

    let nonce_b64 = base64url_encode(&nonce);
    let ciphertext_b64 = base64url_encode(final_ciphertext);
    let auth_tag_b64 = base64url_encode(final_auth_tag);

    // Step 5: Assemble envelope and manifest
    let envelope = serde_json::json!({
        "schemaVersion": 1,
        "cryptoProfile": "gd.backup.aead.v1",
        "sealDomain": seal_domain,
        "keyId": key_id,
        "nonce": nonce_b64,
        "aad": manifest_digest,
        "ciphertext": ciphertext_b64,
        "authTag": auth_tag_b64,
    });
    let envelope_bytes = serde_json::to_vec(&envelope).expect("serialize envelope");

    let manifest = serde_json::json!({
        "schemaVersion": 1,
        "backupClass": "synchronized",
        "backupId": backup_id,
        "manifestDigest": manifest_digest,
        "workspaceId": workspace_id,
        "workspaceSchemaVersion": 1,
        "sourceDeviceId": source_device_id,
        "activeLeaseEpoch": active_lease_epoch,
        "throughRevision": through_revision,
        "cryptoProfile": "gd.backup.aead.v1",
        "keyId": key_id,
        "envelopeDigest": envelope_digest,
        "proofId": proof_id,
        "proofDigest": proof_digest,
    });

    BackupExportResult {
        envelope_bytes,
        manifest_json: manifest,
    }
}

/// INV-P025-07: Verify recomputes `envelopeDigest` over sealed bytes; swapped package fails.
pub fn verify_backup(
    envelope_bytes: &[u8],
    manifest: &serde_json::Value,
) -> Result<(), String> {
    // Validate manifest structure and digest (INV-P025-02)
    validate_encrypted_backup_manifest(manifest)
        .map_err(|error| format!("manifest validation failed: {error}"))?;

    // INV-P025-07: verify envelopeDigest over raw ciphertext bytes
    let envelope: serde_json::Value = serde_json::from_slice(envelope_bytes)
        .map_err(|error| format!("parse envelope: {error}"))?;

    let ciphertext_b64 = envelope["ciphertext"]
        .as_str()
        .ok_or("missing ciphertext")?;
    let ciphertext_bytes = base64url_decode(ciphertext_b64)
        .map_err(|error| format!("decode ciphertext: {error}"))?;

    let expected_envelope_digest = manifest["envelopeDigest"]
        .as_str()
        .ok_or("missing envelopeDigest")?;
    let actual_envelope_digest = sha256_base64url(&ciphertext_bytes);
    if actual_envelope_digest != expected_envelope_digest {
        return Err("envelope digest mismatch: swapped package detected".into());
    }

    Ok(())
}

/// INV-P025-08: Restore only in Staging; emits only `RestoreCandidate`.
/// Apply stays statically unreachable (no `apply_allowed` variant).
pub fn restore_candidate_from_backup(
    envelope_bytes: &[u8],
    manifest: &serde_json::Value,
    key_provider: &dyn SealKeyProvider,
    staging_path: &Path,
) -> Result<serde_json::Value, String> {
    verify_backup(envelope_bytes, manifest)?;

    let envelope: serde_json::Value = serde_json::from_slice(envelope_bytes)
        .map_err(|error| format!("parse envelope: {error}"))?;

    let key_id = envelope["keyId"].as_str().ok_or("missing keyId")?;
    let seal_domain = envelope["sealDomain"]
        .as_str()
        .ok_or("missing sealDomain")?;
    let nonce_b64 = envelope["nonce"].as_str().ok_or("missing nonce")?;
    let ciphertext_b64 = envelope["ciphertext"]
        .as_str()
        .ok_or("missing ciphertext")?;
    let auth_tag_b64 = envelope["authTag"].as_str().ok_or("missing authTag")?;
    let aad_str = envelope["aad"].as_str().ok_or("missing aad")?;

    let nonce_bytes = base64url_decode(nonce_b64)
        .map_err(|error| format!("decode nonce: {error}"))?;
    let ciphertext_bytes = base64url_decode(ciphertext_b64)
        .map_err(|error| format!("decode ciphertext: {error}"))?;
    let auth_tag_bytes = base64url_decode(auth_tag_b64)
        .map_err(|error| format!("decode authTag: {error}"))?;

    if nonce_bytes.len() != 24 {
        return Err(format!(
            "nonce must be 24 bytes, got {}",
            nonce_bytes.len()
        ));
    }

    let key = key_provider.derive_key(key_id, seal_domain);

    // INV-P025-06: AEAD binds manifestDigest as associated data
    let cipher = XChaCha20Poly1305::new(&Key::from(key));
    let nonce_arr: [u8; 24] = nonce_bytes.try_into().expect("nonce already validated");
    let aead_nonce = XNonce::from(nonce_arr);

    // Reassemble sealed bytes: ciphertext || authTag
    let mut sealed = ciphertext_bytes;
    sealed.extend_from_slice(&auth_tag_bytes);

    let plaintext = cipher
        .decrypt(
            &aead_nonce,
            Payload {
                msg: &sealed,
                aad: aad_str.as_bytes(),
            },
        )
        .map_err(|_| "AEAD authentication failed: tampered or truncated backup")?;

    // INV-P025-05: verify no plaintext leak in envelope
    assert!(
        !contains(envelope_bytes, BACKUP_CANARY.as_bytes()),
        "canary found in envelope bytes"
    );
    assert!(
        !contains(envelope_bytes, SQLITE_HEADER),
        "SQLite header found in envelope bytes"
    );

    // INV-P025-08: write to staging (disposable)
    write(staging_path, &plaintext).map_err(|error| format!("write staging: {error}"))?;

    // Short-write gate
    let written = read(staging_path).map_err(|error| format!("read staging: {error}"))?;
    if written.len() != plaintext.len() {
        return Err("short write detected: staging file size mismatch".into());
    }

    // INV-P025-08/09/10: emit only RestoreCandidate (Cloud-derived fields)
    let backup_id = manifest["backupId"]
        .as_str()
        .ok_or("missing backupId")?;
    let workspace_id = manifest["workspaceId"]
        .as_str()
        .ok_or("missing workspaceId")?;
    let manifest_digest = manifest["manifestDigest"]
        .as_str()
        .ok_or("missing manifestDigest")?;

    let candidate = serde_json::json!({
        "status": "rebase_required",
        "candidateId": format!("candidate-{backup_id}"),
        "backupId": backup_id,
        "workspaceId": workspace_id,
        "compareRevision": 0,
        "manifestDigest": manifest_digest,
        "cloudDerivedAt": 0,
    });

    Ok(candidate)
}

fn base64url_decode(input: &str) -> Result<Vec<u8>, String> {
    let mut output = Vec::with_capacity(input.len() * 3 / 4);
    let chars: Vec<u8> = input
        .bytes()
        .map(|b| match b {
            b'A'..=b'Z' => Ok(b - b'A'),
            b'a'..=b'z' => Ok(b - b'a' + 26),
            b'0'..=b'9' => Ok(b - b'0' + 52),
            b'-' => Ok(62),
            b'_' => Ok(63),
            _ => Err(format!("invalid base64url character: {}", b as char)),
        })
        .collect::<Result<_, _>>()?;

    for chunk in chars.chunks(4) {
        match chunk.len() {
            4 => {
                output.push((chunk[0] << 2) | (chunk[1] >> 4));
                output.push((chunk[1] << 4) | (chunk[2] >> 2));
                output.push((chunk[2] << 6) | chunk[3]);
            }
            3 => {
                output.push((chunk[0] << 2) | (chunk[1] >> 4));
                output.push((chunk[1] << 4) | (chunk[2] >> 2));
            }
            2 => {
                output.push((chunk[0] << 2) | (chunk[1] >> 4));
            }
            _ => {}
        }
    }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::recovery::validate_restore_candidate;

    #[test]
    fn export_verify_restore_roundtrip() {
        let directory = tempfile::tempdir().expect("tempdir");
        let db_path = directory.path().join("fixture.db");
        let staging_path = directory.path().join("restored.db");

        create_fixture_db(&db_path);
        let key_provider = TestSealKeyProvider::new([0xAB; 32]);

        let result = export_backup(
            &db_path,
            "backup-test-001",
            "workspace-test-001",
            "device-test-001",
            1,
            42,
            "proof-test-001",
            "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
            "key-test-001",
            &key_provider,
        );

        // INV-P025-05: No plaintext, no Canary, no SQLite header in envelope
        assert!(!contains(&result.envelope_bytes, BACKUP_CANARY.as_bytes()));
        assert!(!contains(&result.envelope_bytes, SQLITE_HEADER));

        // Verify
        assert!(verify_backup(&result.envelope_bytes, &result.manifest_json).is_ok());

        // INV-P025-02: manifest validates (digest recompute passes)
        assert!(validate_encrypted_backup_manifest(&result.manifest_json).is_ok());

        // Restore
        let candidate = restore_candidate_from_backup(
            &result.envelope_bytes,
            &result.manifest_json,
            &key_provider,
            &staging_path,
        )
        .expect("restore should succeed");

        // Validate restore candidate
        assert!(validate_restore_candidate(&candidate).is_ok());
        assert_eq!(candidate["status"], "rebase_required");

        // Verify restored DB size matches original
        let restored_bytes = read(&staging_path).expect("read restored");
        let original_bytes = read(&db_path).expect("read original");
        assert_eq!(restored_bytes.len(), original_bytes.len());
    }

    #[test]
    fn tampered_ciphertext_rejected() {
        let directory = tempfile::tempdir().expect("tempdir");
        let db_path = directory.path().join("fixture.db");
        let staging_path = directory.path().join("restored.db");

        create_fixture_db(&db_path);
        let key_provider = TestSealKeyProvider::new([0xAB; 32]);

        let result = export_backup(
            &db_path, "backup-tamper-001", "ws-001", "dev-001", 1, 10,
            "proof-001", "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
            "key-001", &key_provider,
        );

        // T1: Tamper with ciphertext in envelope JSON
        let mut tampered_envelope: serde_json::Value =
            serde_json::from_slice(&result.envelope_bytes).expect("parse envelope");
        let ct = tampered_envelope["ciphertext"].as_str().expect("ct");
        let mut ct_chars: Vec<char> = ct.chars().collect();
        if let Some(c) = ct_chars.get_mut(5) {
            *c = if *c == 'A' { 'B' } else { 'A' };
        }
        tampered_envelope["ciphertext"] =
            serde_json::Value::String(ct_chars.into_iter().collect());
        let tampered_bytes = serde_json::to_vec(&tampered_envelope).expect("serialize");

        let restore_result = restore_candidate_from_backup(
            &tampered_bytes, &result.manifest_json, &key_provider, &staging_path,
        );
        assert!(restore_result.is_err(), "tampered ciphertext should be rejected");
    }

    #[test]
    fn truncated_envelope_rejected() {
        let directory = tempfile::tempdir().expect("tempdir");
        let db_path = directory.path().join("fixture.db");
        let staging_path = directory.path().join("restored.db");

        create_fixture_db(&db_path);
        let key_provider = TestSealKeyProvider::new([0xAB; 32]);

        let result = export_backup(
            &db_path, "backup-trunc-001", "ws-001", "dev-001", 1, 10,
            "proof-001", "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
            "key-001", &key_provider,
        );

        // T2: Truncate envelope
        let truncated = &result.envelope_bytes[..result.envelope_bytes.len() / 2];
        let restore_result = restore_candidate_from_backup(
            truncated, &result.manifest_json, &key_provider, &staging_path,
        );
        assert!(restore_result.is_err(), "truncated envelope should be rejected");
    }

    #[test]
    fn swapped_package_rejected() {
        let directory = tempfile::tempdir().expect("tempdir");
        let db_path = directory.path().join("fixture.db");

        create_fixture_db(&db_path);
        let key_provider = TestSealKeyProvider::new([0xAB; 32]);

        let result_a = export_backup(
            &db_path, "backup-A", "ws-001", "dev-001", 1, 10,
            "proof-001", "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
            "key-001", &key_provider,
        );
        let result_b = export_backup(
            &db_path, "backup-B", "ws-001", "dev-001", 1, 20,
            "proof-002", "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
            "key-001", &key_provider,
        );

        // T3: Pair manifest A with envelope B
        let verify_result = verify_backup(&result_b.envelope_bytes, &result_a.manifest_json);
        assert!(verify_result.is_err(), "swapped package should be rejected");
    }

    #[test]
    fn plaintext_leak_absent_in_envelope() {
        let directory = tempfile::tempdir().expect("tempdir");
        let db_path = directory.path().join("fixture.db");

        create_fixture_db(&db_path);
        let key_provider = TestSealKeyProvider::new([0xAB; 32]);

        let result = export_backup(
            &db_path, "backup-scan-001", "ws-001", "dev-001", 1, 10,
            "proof-001", "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
            "key-001", &key_provider,
        );

        // T4: Canary absent + SQLite header absent
        assert!(!contains(&result.envelope_bytes, BACKUP_CANARY.as_bytes()));
        assert!(!contains(&result.envelope_bytes, SQLITE_HEADER));
    }

    #[test]
    fn test_seal_key_provider_domain_separation() {
        let provider = TestSealKeyProvider::new([0xAB; 32]);
        let key_a = provider.derive_key("key-001", "gd.backup-seal.v1");
        let key_b = provider.derive_key("key-001", "gd.other-domain.v1");
        let key_c = provider.derive_key("key-002", "gd.backup-seal.v1");

        assert_ne!(key_a, key_b);
        assert_ne!(key_a, key_c);
        assert_ne!(key_b, key_c);

        let key_a2 = provider.derive_key("key-001", "gd.backup-seal.v1");
        assert_eq!(key_a, key_a2);
    }
}
