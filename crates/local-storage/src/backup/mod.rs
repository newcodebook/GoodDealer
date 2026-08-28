#[cfg(feature = "backup-foundation-evidence")]
mod evidence;

#[cfg(feature = "backup-foundation-evidence")]
pub use evidence::write_backup_evidence_report;
