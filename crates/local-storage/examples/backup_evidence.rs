use std::env;
use std::fs;
use std::process::ExitCode;

const UNAVAILABLE_BACKUP_REPORT: &str = r#"{"schemaVersion":1,"scope":"p0-25-backup-foundation","status":"unavailable","reason":"sealed Host backup admission and reviewed safe SQLite handle/VFS identity are not composed","artifactExported":false,"recoveryOpenAvailable":false,"resourceWork":{"filesystem":false,"database":false,"transaction":false,"crypto":false},"productionComposition":false,"signedApplication":false,"nativeEvidenceClaimed":false,"closesGate":false,"signedNativeQualification":{"status":"pending","platforms":[{"platform":"windows-11-24h2-x64","status":"pending","signedArtifact":null,"report":null},{"platform":"macos-15-arm64","status":"pending","signedArtifact":null,"report":null},{"platform":"macos-15-x64","status":"pending","signedArtifact":null,"report":null}]}}"#;

fn main() -> ExitCode {
    let Some(report_path) = env::args_os().nth(1) else {
        eprintln!("usage: backup_evidence <report-path>");
        return ExitCode::FAILURE;
    };
    if fs::write(report_path, UNAVAILABLE_BACKUP_REPORT).is_err() {
        eprintln!("unavailable backup evidence report could not be written");
        return ExitCode::FAILURE;
    }

    ExitCode::SUCCESS
}
