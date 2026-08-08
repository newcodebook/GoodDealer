use std::env;
use std::fs::{copy, create_dir_all, read, read_dir, write};
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode};

use rusqlite::{Connection, Result as SqlResult};
use serde::Serialize;
use sha2::{Digest, Sha256};

const EXPECTED_SQLCIPHER_VERSION: &str = "4.17.0 community";
const EXPECTED_SQLITE_VERSION: &str = "3.53.3";
const FIXTURE_KEY: [u8; 32] = [0x42; 32];
const WRONG_KEY: [u8; 32] = [0x24; 32];
const CANARY: &str = "GOODDEALER_SQLCIPHER_CANARY_DO_NOT_PERSIST_IN_PLAINTEXT";
const SQLITE_HEADER: &[u8] = b"SQLite format 3\0";

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
    sqlcipher_version: String,
    sqlite_version: String,
    database_and_wal_encrypted: bool,
    rollback_journal_encrypted: bool,
    wrong_key_rejected: bool,
    truncated_database_rejected: bool,
    tampered_database_rejected: bool,
    crash_reopen_recovered: bool,
    unexpected_temporary_files_absent: bool,
    scans: Vec<FileScan>,
}

fn contains(haystack: &[u8], needle: &[u8]) -> bool {
    haystack
        .windows(needle.len())
        .any(|window| window == needle)
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

fn scan_file(path: &Path) -> FileScan {
    let bytes = read(path).unwrap_or_else(|error| panic!("read {}: {error}", path.display()));
    FileScan {
        name: path
            .file_name()
            .expect("fixture file has a name")
            .to_string_lossy()
            .into_owned(),
        bytes: bytes.len(),
        sha256: format!("{:x}", Sha256::digest(&bytes)),
        canary_absent: !contains(&bytes, CANARY.as_bytes()),
        sqlite_header_absent: !contains(&bytes, SQLITE_HEADER),
    }
}

fn database_read_fails(path: &Path, key: &[u8; 32]) -> bool {
    open_keyed(path, key).is_ok_and(|connection| {
        connection
            .query_row(
                "SELECT count(*), sum(length(value)) FROM fixture",
                [],
                |_| Ok(()),
            )
            .is_err()
    })
}

fn write_crash_fixture(path: &Path) -> ! {
    let connection = open_keyed(path, &FIXTURE_KEY).expect("open crash fixture");
    connection
        .execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA wal_autocheckpoint = 0;
             CREATE TABLE fixture (value TEXT NOT NULL);",
        )
        .expect("create crash fixture");
    connection
        .execute("INSERT INTO fixture(value) VALUES (?1)", [CANARY])
        .expect("commit crash fixture row");
    // Intentionally bypass destructors to model a process ending after a committed WAL write.
    std::process::exit(0)
}

#[allow(clippy::too_many_lines)]
fn run(output_path: &Path) -> EvidenceReport {
    let directory = tempfile::tempdir().expect("create temporary evidence directory");
    let database_path = directory.path().join("fixture.db");
    let wal_path = directory.path().join("fixture.db-wal");

    let connection = open_keyed(&database_path, &FIXTURE_KEY).expect("open keyed fixture");
    let sqlcipher_version: String = connection
        .query_row("PRAGMA cipher_version", [], |row| row.get(0))
        .expect("read SQLCipher version");
    let sqlite_version: String = connection
        .query_row("SELECT sqlite_version()", [], |row| row.get(0))
        .expect("read SQLite version");
    assert_eq!(sqlcipher_version, EXPECTED_SQLCIPHER_VERSION);
    assert_eq!(sqlite_version, EXPECTED_SQLITE_VERSION);
    connection
        .execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA wal_autocheckpoint = 0;
             CREATE TABLE fixture (value TEXT NOT NULL);",
        )
        .expect("create WAL fixture");
    for _ in 0..256 {
        connection
            .execute("INSERT INTO fixture(value) VALUES (?1)", [CANARY])
            .expect("insert encrypted fixture row");
    }

    let mut scans = vec![scan_file(&database_path), scan_file(&wal_path)];
    let database_and_wal_encrypted = scans
        .iter()
        .all(|scan| scan.canary_absent && scan.sqlite_header_absent);
    drop(connection);

    let wrong_key_rejected = database_read_fails(&database_path, &WRONG_KEY);

    let truncated_path = directory.path().join("truncated.db");
    let database_bytes = read(&database_path).expect("read database for truncation");
    write(&truncated_path, &database_bytes[..database_bytes.len() / 2])
        .expect("write truncated fixture");
    let truncated_database_rejected = database_read_fails(&truncated_path, &FIXTURE_KEY);

    let tampered_path = directory.path().join("tampered.db");
    let mut tampered_bytes = database_bytes;
    let tamper_offset = tampered_bytes.len() / 2;
    tampered_bytes[tamper_offset] ^= 0x80;
    write(&tampered_path, tampered_bytes).expect("write tampered fixture");
    let tampered_database_rejected = database_read_fails(&tampered_path, &FIXTURE_KEY);

    let journal_path = directory.path().join("journal.db");
    copy(&database_path, &journal_path).expect("copy rollback-journal fixture");
    let journal_connection = open_keyed(&journal_path, &FIXTURE_KEY).expect("open journal fixture");
    journal_connection
        .execute_batch("PRAGMA journal_mode = DELETE; BEGIN IMMEDIATE;")
        .expect("begin rollback-journal transaction");
    journal_connection
        .execute(
            "UPDATE fixture SET value = ?1 WHERE rowid = 1",
            [format!("{CANARY}_UPDATED")],
        )
        .expect("write rollback-journal fixture");
    let rollback_path = directory.path().join("journal.db-journal");
    scans.push(scan_file(&rollback_path));
    let rollback_journal_encrypted = scans
        .last()
        .is_some_and(|scan| scan.canary_absent && scan.sqlite_header_absent && scan.bytes > 0);
    journal_connection
        .execute_batch("ROLLBACK")
        .expect("rollback journal fixture");
    drop(journal_connection);

    let crash_path = directory.path().join("crash.db");
    let status = Command::new(env::current_exe().expect("resolve evidence executable"))
        .arg("--crash-child")
        .arg(&crash_path)
        .status()
        .expect("run crash child");
    assert!(status.success());
    let crash_wal_path = directory.path().join("crash.db-wal");
    scans.push(scan_file(&crash_path));
    scans.push(scan_file(&crash_wal_path));
    let crash_connection = open_keyed(&crash_path, &FIXTURE_KEY).expect("reopen crash fixture");
    let recovered_value: String = crash_connection
        .query_row("SELECT value FROM fixture", [], |row| row.get(0))
        .expect("recover committed WAL row");
    let crash_reopen_recovered = recovered_value == CANARY;
    drop(crash_connection);

    scans.push(scan_file(&truncated_path));
    scans.push(scan_file(&tampered_path));
    let known_files = [
        "fixture.db",
        "truncated.db",
        "tampered.db",
        "journal.db",
        "crash.db",
    ];
    let unexpected_temporary_files_absent = read_dir(directory.path())
        .expect("list fixture directory")
        .filter_map(Result::ok)
        .all(|entry| {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            known_files.contains(&name.as_ref())
        });

    let report = EvidenceReport {
        schema_version: 1,
        scope: "temporary SQLCipher fixture only; no production storage or user data",
        sqlcipher_version,
        sqlite_version,
        database_and_wal_encrypted,
        rollback_journal_encrypted,
        wrong_key_rejected,
        truncated_database_rejected,
        tampered_database_rejected,
        crash_reopen_recovered,
        unexpected_temporary_files_absent,
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
    let args: Vec<_> = env::args_os().skip(1).collect();
    if args
        .first()
        .is_some_and(|argument| argument == "--crash-child")
    {
        let path = args.get(1).expect("crash child requires database path");
        write_crash_fixture(Path::new(path));
    }
    let output_path = args
        .first()
        .map(PathBuf::from)
        .expect("usage: sqlcipher_evidence <report-path>");
    let report = run(&output_path);
    let passed = report.database_and_wal_encrypted
        && report.rollback_journal_encrypted
        && report.wrong_key_rejected
        && report.truncated_database_rejected
        && report.tampered_database_rejected
        && report.crash_reopen_recovered
        && report.unexpected_temporary_files_absent;
    if passed {
        ExitCode::SUCCESS
    } else {
        ExitCode::FAILURE
    }
}
