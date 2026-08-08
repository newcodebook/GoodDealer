use std::fs::read;
use std::path::Path;

use rusqlite::{Connection, Result as SqlResult};

const EXPECTED_SQLCIPHER_VERSION: &str = "4.17.0 community";
const EXPECTED_SQLITE_VERSION: &str = "3.53.3";
const FIXTURE_KEY: [u8; 32] = [0x42; 32];
const WRONG_KEY: [u8; 32] = [0x24; 32];
const CANARY: &str = "GOODDEALER_SQLCIPHER_CANARY_DO_NOT_PERSIST_IN_PLAINTEXT";

fn key_database(connection: &Connection, key: &[u8; 32]) -> SqlResult<()> {
    let raw_key = key
        .iter()
        .fold(String::with_capacity(67), |mut output, byte| {
            use std::fmt::Write;
            write!(output, "{byte:02x}").expect("writing into a String cannot fail");
            output
        });
    connection.execute_batch(&format!(
        "PRAGMA key = \"x'{raw_key}'\"; PRAGMA cipher_memory_security = ON;"
    ))?;
    Ok(())
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

#[test]
fn bundled_sqlcipher_encrypts_fixture_database_and_wal() {
    let directory = tempfile::tempdir().expect("temporary fixture directory");
    let database_path = directory.path().join("fixture.db");
    let wal_path = directory.path().join("fixture.db-wal");

    let connection = open_keyed(&database_path, &FIXTURE_KEY).expect("open keyed fixture");
    let cipher_version: String = connection
        .query_row("PRAGMA cipher_version", [], |row| row.get(0))
        .expect("read SQLCipher version");
    let sqlite_version: String = connection
        .query_row("SELECT sqlite_version()", [], |row| row.get(0))
        .expect("read SQLite version");
    assert_eq!(cipher_version, EXPECTED_SQLCIPHER_VERSION);
    assert_eq!(sqlite_version, EXPECTED_SQLITE_VERSION);

    connection
        .pragma_update(None, "journal_mode", "WAL")
        .expect("enable WAL");
    connection
        .pragma_update(None, "wal_autocheckpoint", 0)
        .expect("disable automatic checkpoint for the fixture scan");
    connection
        .execute_batch("CREATE TABLE fixture (value TEXT NOT NULL);")
        .expect("create fixture schema");
    connection
        .execute("INSERT INTO fixture(value) VALUES (?1)", [CANARY])
        .expect("write fixture canary");

    let database_bytes = read(&database_path).expect("read encrypted fixture database");
    let wal_bytes = read(&wal_path).expect("read encrypted fixture WAL");
    for bytes in [&database_bytes, &wal_bytes] {
        assert!(!contains(bytes, CANARY.as_bytes()));
        assert!(!contains(bytes, b"SQLite format 3\0"));
    }
    drop(connection);

    let wrong_connection = open_keyed(&database_path, &WRONG_KEY).expect("open wrong-key handle");
    assert!(
        wrong_connection
            .query_row("SELECT count(*) FROM fixture", [], |row| row
                .get::<_, i64>(0))
            .is_err()
    );
    drop(wrong_connection);

    let correct_connection =
        open_keyed(&database_path, &FIXTURE_KEY).expect("reopen keyed fixture");
    let value: String = correct_connection
        .query_row("SELECT value FROM fixture", [], |row| row.get(0))
        .expect("read fixture with the correct key");
    assert_eq!(value, CANARY);
}
