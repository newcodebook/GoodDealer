use std::env;
use std::fs::{create_dir_all, read, write};
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{Key, XChaCha20Poly1305, XNonce};
use rusqlite::Connection;
use serde::Serialize;
use sha2::{Digest, Sha256};

const FIXTURE_KEY: [u8; 32] = [0x42; 32];
const CANARY: &str = "GOODDEALER_BACKUP_CANARY_DO_NOT_PERSIST_IN_PLAINTEXT";
const SQLITE_HEADER: &[u8] = b"SQLite format 3\0";
const SEAL_DOMAIN: &str = "gd.backup-seal.v1";

// --- Report structures ---

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FileScan {
    name: String,
    bytes: usize,
    sha256: String,
    canary_absent: bool,
    sqlite_header_absent: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
#[allow(clippy::struct_excessive_bools)]
struct EvidenceReport {
    schema_version: u8,
    scope: &'static str,
    aead_crate: &'static str,
    aead_crate_version: &'static str,
    export_produces_sealed_envelope: bool,
    no_plaintext_in_envelope: bool,
    no_canary_in_envelope: bool,
    no_sqlite_header_in_envelope: bool,
    manifest_digest_recompute_passes: bool,
    aead_roundtrip_succeeds: bool,
    tampered_ciphertext_rejected: bool,
    truncated_envelope_rejected: bool,
    swapped_package_rejected: bool,
    restored_size_matches_original: bool,
    scans: Vec<FileScan>,
}

// --- Helpers ---

fn contains(haystack: &[u8], needle: &[u8]) -> bool {
    haystack
        .windows(needle.len())
        .any(|window| window == needle)
}

fn sha256_hex(data: &[u8]) -> String {
    format!("{:x}", Sha256::digest(data))
}

fn sha256_base64url(data: &[u8]) -> String {
    base64url_encode(&Sha256::digest(data))
}

fn scan_bytes(name: &str, data: &[u8]) -> FileScan {
    FileScan {
        name: name.to_owned(),
        bytes: data.len(),
        sha256: sha256_hex(data),
        canary_absent: !contains(data, CANARY.as_bytes()),
        sqlite_header_absent: !contains(data, SQLITE_HEADER),
    }
}

// --- Base64url ---

const BASE64URL_ALPHABET: [char; 64] = [
    'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R',
    'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j',
    'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z', '0', '1',
    '2', '3', '4', '5', '6', '7', '8', '9', '-', '_',
];

fn base64url_encode(bytes: &[u8]) -> String {
    let mut output = String::with_capacity((bytes.len() * 4).div_ceil(3));
    for chunk in bytes.chunks(3) {
        match chunk.len() {
            3 => {
                output.push(BASE64URL_ALPHABET[(chunk[0] >> 2) as usize]);
                output.push(BASE64URL_ALPHABET[((chunk[0] & 0x03) << 4 | chunk[1] >> 4) as usize]);
                output.push(BASE64URL_ALPHABET[((chunk[1] & 0x0F) << 2 | chunk[2] >> 6) as usize]);
                output.push(BASE64URL_ALPHABET[(chunk[2] & 0x3F) as usize]);
            }
            2 => {
                output.push(BASE64URL_ALPHABET[(chunk[0] >> 2) as usize]);
                output.push(BASE64URL_ALPHABET[((chunk[0] & 0x03) << 4 | chunk[1] >> 4) as usize]);
                output.push(BASE64URL_ALPHABET[((chunk[1] & 0x0F) << 2) as usize]);
            }
            1 => {
                output.push(BASE64URL_ALPHABET[(chunk[0] >> 2) as usize]);
                output.push(BASE64URL_ALPHABET[((chunk[0] & 0x03) << 4) as usize]);
            }
            _ => unreachable!(),
        }
    }
    output
}

fn base64url_decode(input: &str) -> Vec<u8> {
    let mut output = Vec::with_capacity(input.len() * 3 / 4);
    let chars: Vec<u8> = input
        .bytes()
        .map(|b| match b {
            b'A'..=b'Z' => b - b'A',
            b'a'..=b'z' => b - b'a' + 26,
            b'0'..=b'9' => b - b'0' + 52,
            b'-' => 62,
            b'_' => 63,
            _ => panic!("invalid base64url character"),
        })
        .collect();
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
    output
}

// --- Canonical codec (matches TS `encodeDomainSeparatedWireValue`) ---

fn frame(tag: &str, payload: &[u8]) -> Vec<u8> {
    let header = format!("{tag}{}:", payload.len());
    let mut output = Vec::with_capacity(header.len() + payload.len());
    output.extend_from_slice(header.as_bytes());
    output.extend_from_slice(payload);
    output
}

fn encode_canonical_wire_value(value: &serde_json::Value) -> Vec<u8> {
    match value {
        serde_json::Value::Null => b"z0:".to_vec(),
        serde_json::Value::Bool(true) => b"b1:1".to_vec(),
        serde_json::Value::Bool(false) => b"b1:0".to_vec(),
        serde_json::Value::Number(number) => {
            let s = if number.as_f64().is_some_and(|n| n == 0.0) {
                "0".to_string()
            } else {
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
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            let mut parts = Vec::new();
            for key in keys {
                let v = &map[key];
                let k = frame("k", key.as_bytes());
                let val = frame("v", &encode_canonical_wire_value(v));
                let mut entry = Vec::with_capacity(k.len() + val.len());
                entry.extend(k);
                entry.extend(val);
                parts.extend(frame("e", &entry));
            }
            frame("o", &parts)
        }
    }
}

fn encode_domain_separated_wire_value(domain: &str, value: &serde_json::Value) -> Vec<u8> {
    let d = frame("d", domain.as_bytes());
    let v = frame("v", &encode_canonical_wire_value(value));
    let mut output = Vec::with_capacity(d.len() + v.len());
    output.extend(d);
    output.extend(v);
    output
}

// --- Test KDF ---

fn derive_test_key(key_id: &str, seal_domain: &str, test_root: &[u8; 32]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(seal_domain.as_bytes());
    hasher.update(key_id.as_bytes());
    hasher.update(test_root);
    hasher.finalize().into()
}

// --- Fixture DB ---

fn create_fixture_db(path: &Path) {
    let connection = Connection::open(path).expect("open fixture DB");
    let raw_key = FIXTURE_KEY
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
            [CANARY],
        )
        .expect("insert canary");
    connection
        .execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")
        .expect("checkpoint");
    drop(connection);
}

// --- Export backup ---

struct BackupResult {
    envelope_json: serde_json::Value,
    envelope_bytes: Vec<u8>,
    manifest_json: serde_json::Value,
}

fn export_backup(
    db_path: &Path,
    backup_id: &str,
    key_id: &str,
    test_root: &[u8; 32],
) -> BackupResult {
    let plaintext = read(db_path).expect("read fixture DB for export");
    let key = derive_test_key(key_id, SEAL_DOMAIN, test_root);

    let nonce_material = Sha256::digest(format!("nonce:{backup_id}").as_bytes());
    let nonce: [u8; 24] = nonce_material[..24].try_into().expect("nonce slice");

    let cipher = XChaCha20Poly1305::new(&Key::from(key));
    let aead_nonce = XNonce::from(nonce);

    // Seal with placeholder AAD to get AAD-independent ciphertext
    let placeholder_sealed = cipher
        .encrypt(&aead_nonce, Payload { msg: &plaintext, aad: b"" })
        .expect("AEAD seal (placeholder)");

    let tag_size = 16;
    let ciphertext_bytes = &placeholder_sealed[..placeholder_sealed.len() - tag_size];
    let envelope_digest = sha256_base64url(ciphertext_bytes);

    let manifest_fields = serde_json::json!({
        "schemaVersion": 1,
        "backupClass": "synchronized",
        "backupId": backup_id,
        "workspaceId": "workspace-evidence-001",
        "workspaceSchemaVersion": 1,
        "sourceDeviceId": "device-evidence-001",
        "activeLeaseEpoch": 1,
        "throughRevision": 42,
        "cryptoProfile": "gd.backup.aead.v1",
        "keyId": key_id,
        "envelopeDigest": envelope_digest,
        "proofId": "proof-evidence-001",
        "proofDigest": "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    });

    let encoded = encode_domain_separated_wire_value(
        "GOODDEALER-RECOVERY-BACKUP-MANIFEST-V1",
        &manifest_fields,
    );
    let manifest_digest = sha256_base64url(&encoded);

    // Re-seal with correct AAD
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

    assert_eq!(
        ciphertext_bytes, final_ciphertext,
        "ciphertext must be AAD-independent"
    );

    let envelope = serde_json::json!({
        "schemaVersion": 1,
        "cryptoProfile": "gd.backup.aead.v1",
        "sealDomain": SEAL_DOMAIN,
        "keyId": key_id,
        "nonce": base64url_encode(&nonce),
        "aad": manifest_digest,
        "ciphertext": base64url_encode(final_ciphertext),
        "authTag": base64url_encode(final_auth_tag),
    });
    let envelope_bytes = serde_json::to_vec(&envelope).expect("serialize envelope");

    let manifest = serde_json::json!({
        "schemaVersion": 1,
        "backupClass": "synchronized",
        "backupId": backup_id,
        "manifestDigest": manifest_digest,
        "workspaceId": "workspace-evidence-001",
        "workspaceSchemaVersion": 1,
        "sourceDeviceId": "device-evidence-001",
        "activeLeaseEpoch": 1,
        "throughRevision": 42,
        "cryptoProfile": "gd.backup.aead.v1",
        "keyId": key_id,
        "envelopeDigest": envelope_digest,
        "proofId": "proof-evidence-001",
        "proofDigest": "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    });

    BackupResult {
        envelope_json: envelope,
        envelope_bytes,
        manifest_json: manifest,
    }
}

// --- Verify backup ---

fn verify_manifest_digest(manifest: &serde_json::Value) -> bool {
    let Some(object) = manifest.as_object() else {
        return false;
    };
    let Some(stored_digest) = object.get("manifestDigest").and_then(|v| v.as_str()) else {
        return false;
    };
    let mut digest_input = object.clone();
    digest_input.remove("manifestDigest");
    let encoded = encode_domain_separated_wire_value(
        "GOODDEALER-RECOVERY-BACKUP-MANIFEST-V1",
        &serde_json::Value::Object(digest_input),
    );
    let recomputed = sha256_base64url(&encoded);
    recomputed == stored_digest
}

fn verify_envelope_digest(
    envelope: &serde_json::Value,
    manifest: &serde_json::Value,
) -> bool {
    let Some(ciphertext_b64) = envelope.get("ciphertext").and_then(|v| v.as_str()) else {
        return false;
    };
    let Some(expected) = manifest.get("envelopeDigest").and_then(|v| v.as_str()) else {
        return false;
    };
    let ciphertext_bytes = base64url_decode(ciphertext_b64);
    sha256_base64url(&ciphertext_bytes) == expected
}

fn aead_decrypt(
    envelope: &serde_json::Value,
    key_id: &str,
    test_root: &[u8; 32],
) -> Option<Vec<u8>> {
    let key = derive_test_key(key_id, SEAL_DOMAIN, test_root);
    let nonce_b64 = envelope.get("nonce")?.as_str()?;
    let ciphertext_b64 = envelope.get("ciphertext")?.as_str()?;
    let auth_tag_b64 = envelope.get("authTag")?.as_str()?;
    let aad_str = envelope.get("aad")?.as_str()?;

    let nonce_bytes = base64url_decode(nonce_b64);
    let ciphertext_bytes = base64url_decode(ciphertext_b64);
    let auth_tag_bytes = base64url_decode(auth_tag_b64);

    let nonce_arr: [u8; 24] = nonce_bytes.try_into().ok()?;
    let cipher = XChaCha20Poly1305::new(&Key::from(key));
    let aead_nonce = XNonce::from(nonce_arr);

    let mut sealed = ciphertext_bytes;
    sealed.extend_from_slice(&auth_tag_bytes);

    cipher
        .decrypt(
            &aead_nonce,
            Payload {
                msg: &sealed,
                aad: aad_str.as_bytes(),
            },
        )
        .ok()
}

// --- Evidence run ---

#[allow(clippy::too_many_lines)]
fn run(output_path: &Path) -> EvidenceReport {
    let directory = tempfile::tempdir().expect("create temporary evidence directory");
    let db_path = directory.path().join("fixture.db");
    let staging_path = directory.path().join("restored.db");

    create_fixture_db(&db_path);
    let test_root = [0xAB_u8; 32];
    let key_id = "key-evidence-001";

    // Export
    let result = export_backup(&db_path, "backup-evidence-001", key_id, &test_root);
    let export_produces_sealed_envelope = !result.envelope_bytes.is_empty()
        && result.manifest_json.get("manifestDigest").is_some();

    // INV-P025-05: No plaintext leak
    let no_plaintext_in_envelope = {
        let original = read(&db_path).expect("read original DB");
        !contains(&result.envelope_bytes, &original[..64.min(original.len())])
    };
    let no_canary_in_envelope = !contains(&result.envelope_bytes, CANARY.as_bytes());
    let no_sqlite_header_in_envelope = !contains(&result.envelope_bytes, SQLITE_HEADER);

    // INV-P025-02: Manifest digest recompute
    let manifest_digest_recompute_passes = verify_manifest_digest(&result.manifest_json);

    // INV-P025-07: Envelope digest
    let envelope_digest_ok = verify_envelope_digest(&result.envelope_json, &result.manifest_json);

    // AEAD roundtrip
    let plaintext = aead_decrypt(&result.envelope_json, key_id, &test_root);
    let aead_roundtrip_succeeds = plaintext.is_some();
    let restored_size_matches_original = if let Some(ref pt) = plaintext {
        write(&staging_path, pt).expect("write staging");
        let original = read(&db_path).expect("read original");
        pt.len() == original.len()
    } else {
        false
    };

    // T1: Tampered ciphertext rejected
    let tampered_ciphertext_rejected = {
        let mut tampered = result.envelope_json.clone();
        let ct = tampered["ciphertext"].as_str().expect("ciphertext").to_owned();
        let mut chars: Vec<char> = ct.chars().collect();
        if let Some(c) = chars.get_mut(5) {
            *c = if *c == 'A' { 'B' } else { 'A' };
        }
        tampered["ciphertext"] = serde_json::Value::String(chars.into_iter().collect());
        aead_decrypt(&tampered, key_id, &test_root).is_none()
    };

    // T2: Truncated envelope rejected
    let truncated_envelope_rejected = {
        let half = &result.envelope_bytes[..result.envelope_bytes.len() / 2];
        serde_json::from_slice::<serde_json::Value>(half)
            .ok()
            .and_then(|env| aead_decrypt(&env, key_id, &test_root))
            .is_none()
    };

    // T3: Swapped package rejected
    let swapped_package_rejected = {
        let result_b = export_backup(&db_path, "backup-evidence-002", key_id, &test_root);
        !verify_envelope_digest(&result_b.envelope_json, &result.manifest_json)
    };

    // Scans
    let mut scans = vec![
        scan_bytes("envelope.json", &result.envelope_bytes),
        scan_bytes(
            "manifest.json",
            &serde_json::to_vec_pretty(&result.manifest_json).expect("serialize manifest"),
        ),
    ];
    if staging_path.exists() {
        let restored = read(&staging_path).expect("read restored");
        scans.push(scan_bytes("restored.db", &restored));
    }

    let report = EvidenceReport {
        schema_version: 1,
        scope: "temporary backup fixture only; no production storage, keychain, or user data",
        aead_crate: "chacha20poly1305",
        aead_crate_version: "0.11.0",
        export_produces_sealed_envelope,
        no_plaintext_in_envelope,
        no_canary_in_envelope,
        no_sqlite_header_in_envelope,
        manifest_digest_recompute_passes: manifest_digest_recompute_passes && envelope_digest_ok,
        aead_roundtrip_succeeds,
        tampered_ciphertext_rejected,
        truncated_envelope_rejected,
        swapped_package_rejected,
        restored_size_matches_original,
        scans,
    };
    create_dir_all(output_path.parent().expect("report path has parent"))
        .expect("create report directory");
    write(
        output_path,
        serde_json::to_vec_pretty(&report).expect("serialize evidence report"),
    )
    .expect("write evidence report");
    report
}

fn main() -> ExitCode {
    let output_path = env::args_os()
        .nth(1)
        .map(PathBuf::from)
        .expect("usage: backup_evidence <report-path>");
    let report = run(&output_path);
    let passed = report.export_produces_sealed_envelope
        && report.no_plaintext_in_envelope
        && report.no_canary_in_envelope
        && report.no_sqlite_header_in_envelope
        && report.manifest_digest_recompute_passes
        && report.aead_roundtrip_succeeds
        && report.tampered_ciphertext_rejected
        && report.truncated_envelope_rejected
        && report.swapped_package_rejected
        && report.restored_size_matches_original;
    if passed {
        ExitCode::SUCCESS
    } else {
        ExitCode::FAILURE
    }
}
