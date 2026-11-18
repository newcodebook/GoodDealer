use std::fs;
use std::io;
use std::path::Path;

const UNAVAILABLE_BACKUP_REPORT: &str = r#"{"schemaVersion":1,"scope":"p0-25-backup-foundation","status":"unavailable","reason":"sealed Host backup admission and reviewed safe SQLite handle/VFS identity are not composed","artifactExported":false,"recoveryOpenAvailable":false,"resourceWork":{"filesystem":false,"database":false,"transaction":false,"crypto":false},"productionComposition":false,"signedApplication":false,"nativeEvidenceClaimed":false,"closesGate":false,"signedNativeQualification":{"status":"pending","platforms":[{"platform":"windows-11-24h2-x64","status":"pending","signedArtifact":null,"report":null},{"platform":"macos-15-arm64","status":"pending","signedArtifact":null,"report":null},{"platform":"macos-15-x64","status":"pending","signedArtifact":null,"report":null}]}}"#;

/// Writes the fixed repository-only unavailable evidence report.
///
/// This writer does not inspect, open, create, or export a backup artifact. The report file is
/// the caller-selected evidence destination, not a backup resource or an admission substitute.
///
/// # Errors
///
/// Returns an I/O error when the caller-provided report destination cannot be written.
pub fn write_backup_evidence_report(report_path: &Path) -> io::Result<()> {
    fs::write(report_path, UNAVAILABLE_BACKUP_REPORT)
}

#[cfg(test)]
mod tests {
    use super::UNAVAILABLE_BACKUP_REPORT;

    #[test]
    fn report_is_the_frozen_unavailable_backup_schema() {
        assert_eq!(
            UNAVAILABLE_BACKUP_REPORT,
            r#"{"schemaVersion":1,"scope":"p0-25-backup-foundation","status":"unavailable","reason":"sealed Host backup admission and reviewed safe SQLite handle/VFS identity are not composed","artifactExported":false,"recoveryOpenAvailable":false,"resourceWork":{"filesystem":false,"database":false,"transaction":false,"crypto":false},"productionComposition":false,"signedApplication":false,"nativeEvidenceClaimed":false,"closesGate":false,"signedNativeQualification":{"status":"pending","platforms":[{"platform":"windows-11-24h2-x64","status":"pending","signedArtifact":null,"report":null},{"platform":"macos-15-arm64","status":"pending","signedArtifact":null,"report":null},{"platform":"macos-15-x64","status":"pending","signedArtifact":null,"report":null}]}}"#,
        );
    }
}
