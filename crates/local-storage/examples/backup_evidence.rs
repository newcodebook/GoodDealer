use std::env;
use std::path::Path;
use std::process::ExitCode;

use gooddealer_local_storage::backup::write_backup_evidence_report;

fn main() -> ExitCode {
    let Some(report_path) = env::args_os().nth(1) else {
        eprintln!("usage: backup_evidence <report-path>");
        return ExitCode::FAILURE;
    };
    if write_backup_evidence_report(Path::new(&report_path)).is_err() {
        eprintln!("unavailable backup evidence report could not be written");
        return ExitCode::FAILURE;
    }

    ExitCode::SUCCESS
}
