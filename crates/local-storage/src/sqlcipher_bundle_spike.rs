use std::fs::{create_dir_all, read, remove_file, write};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{Connection, Result as SqlResult};
use serde::Serialize;

const EXPECTED_SQLCIPHER_VERSION: &str = "4.17.0 community";
const EXPECTED_SQLITE_VERSION: &str = "3.53.3";
const FIXTURE_KEY: [u8; 32] = [0x42; 32];
const WRONG_KEY: [u8; 32] = [0x24; 32];
const CANARY: &str = "GOODDEALER_SQLCIPHER_BUNDLE_SPIKE_CANARY";
const SQLITE_HEADER: &[u8] = b"SQLite format 3\0";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
#[allow(clippy::struct_excessive_bools)]
struct BundleRuntimeProbe {
    schema_version: u8,
    scope: &'static str,
    sqlcipher_version: String,
    sqlite_version: String,
    database_encrypted: bool,
    correct_key_readable: bool,
    wrong_key_rejected: bool,
    temporary_database_removed: bool,
}

fn key_database(connection: &Connection, key: &[u8; 32]) -> SqlResult<()> {
    let raw_key = key
        .iter()
        .fold(String::with_capacity(64), |mut output, byte| {
            use std::fmt::Write;
            write!(output, "{byte:02x}").expect("writing into a String cannot fail");
            output
        });
    connection.execute_batch(&format!(
        "PRAGMA key = \"x'{raw_key}'\"; PRAGMA cipher_memory_security = ON;"
    ))
}

fn open_keyed(path: &Path, key: &[u8; 32]) -> SqlResult<Connection> {
    let connection = Connection::open(path)?;
    key_database(&connection, key)?;
    Ok(connection)
}

fn contains(haystack: &[u8], needle: &[u8]) -> bool {
    haystack
        .windows(needle.len())
        .any(|window| window == needle)
}

/// Runs only from the explicitly feature-gated disposable Tauri bundle spike. It proves that the
/// executable copied into the native bundle can load the pinned `SQLCipher` engine and use a
/// temporary encrypted database. It never opens a production path or receives a real key.
///
/// # Errors
///
/// Returns an error if the pinned engine cannot be loaded, any encryption assertion fails, the
/// temporary database cannot be removed, or the report cannot be written.
pub fn write_sqlcipher_bundle_spike_report(output_path: &Path) -> Result<(), String> {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("read system time: {error}"))?
        .as_nanos();
    let database_path = std::env::temp_dir().join(format!(
        "gooddealer-sqlcipher-bundle-spike-{}-{nonce}.db",
        std::process::id()
    ));

    let probe_result = (|| -> Result<BundleRuntimeProbe, String> {
        let connection = open_keyed(&database_path, &FIXTURE_KEY)
            .map_err(|error| format!("open keyed bundle fixture: {error}"))?;
        let sqlcipher_version: String = connection
            .query_row("PRAGMA cipher_version", [], |row| row.get(0))
            .map_err(|error| format!("read SQLCipher version: {error}"))?;
        let sqlite_version: String = connection
            .query_row("SELECT sqlite_version()", [], |row| row.get(0))
            .map_err(|error| format!("read SQLite version: {error}"))?;
        if sqlcipher_version != EXPECTED_SQLCIPHER_VERSION {
            return Err(format!("unexpected SQLCipher version: {sqlcipher_version}"));
        }
        if sqlite_version != EXPECTED_SQLITE_VERSION {
            return Err(format!("unexpected SQLite version: {sqlite_version}"));
        }
        connection
            .execute_batch("CREATE TABLE fixture (value TEXT NOT NULL);")
            .map_err(|error| format!("create bundle fixture: {error}"))?;
        connection
            .execute("INSERT INTO fixture(value) VALUES (?1)", [CANARY])
            .map_err(|error| format!("write bundle fixture: {error}"))?;
        drop(connection);

        let database_bytes = read(&database_path)
            .map_err(|error| format!("read encrypted bundle fixture: {error}"))?;
        let database_encrypted = !contains(&database_bytes, CANARY.as_bytes())
            && !contains(&database_bytes, SQLITE_HEADER);

        let correct_connection = open_keyed(&database_path, &FIXTURE_KEY)
            .map_err(|error| format!("reopen correct-key bundle fixture: {error}"))?;
        let value: String = correct_connection
            .query_row("SELECT value FROM fixture", [], |row| row.get(0))
            .map_err(|error| format!("read correct-key bundle fixture: {error}"))?;
        let correct_key_readable = value == CANARY;
        drop(correct_connection);

        let wrong_connection = open_keyed(&database_path, &WRONG_KEY)
            .map_err(|error| format!("open wrong-key bundle fixture handle: {error}"))?;
        let wrong_key_rejected = wrong_connection
            .query_row("SELECT value FROM fixture", [], |row| {
                row.get::<_, String>(0)
            })
            .is_err();
        drop(wrong_connection);

        remove_file(&database_path)
            .map_err(|error| format!("remove temporary bundle fixture: {error}"))?;
        let temporary_database_removed = !database_path.exists();

        Ok(BundleRuntimeProbe {
            schema_version: 1,
            scope: "temporary SQLCipher Tauri bundle spike only; no production storage, key, IPC, or user data",
            sqlcipher_version,
            sqlite_version,
            database_encrypted,
            correct_key_readable,
            wrong_key_rejected,
            temporary_database_removed,
        })
    })();

    if database_path.exists() {
        let _ = remove_file(&database_path);
    }
    let report = probe_result?;
    if !(report.database_encrypted
        && report.correct_key_readable
        && report.wrong_key_rejected
        && report.temporary_database_removed)
    {
        return Err("SQLCipher bundle runtime probe failed".to_owned());
    }

    create_dir_all(
        output_path
            .parent()
            .ok_or_else(|| "bundle report path has no parent".to_owned())?,
    )
    .map_err(|error| format!("create bundle report directory: {error}"))?;
    let serialized = serde_json::to_vec_pretty(&report)
        .map_err(|error| format!("serialize bundle runtime report: {error}"))?;
    write(output_path, serialized).map_err(|error| format!("write bundle runtime report: {error}"))
}

#[cfg(test)]
mod tests {
    use std::fs::read_to_string;

    use super::write_sqlcipher_bundle_spike_report;

    #[test]
    fn disposable_probe_uses_the_pinned_encrypted_engine() {
        let output = std::env::temp_dir().join(format!(
            "gooddealer-sqlcipher-bundle-report-{}.json",
            std::process::id()
        ));
        write_sqlcipher_bundle_spike_report(&output).expect("run bundle spike probe");
        let report = read_to_string(&output).expect("read bundle spike report");
        assert!(report.contains("4.17.0 community"));
        assert!(report.contains("\"databaseEncrypted\": true"));
        std::fs::remove_file(output).expect("remove bundle spike report");
    }
}
