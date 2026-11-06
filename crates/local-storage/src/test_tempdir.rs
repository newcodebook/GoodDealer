//! Owner-only temporary directories for this crate's tests.
//!
//! `tempfile::tempdir()` creates directories with the process umask. Desktop distributions commonly
//! default to umask 002, which yields a group-writable directory that the custody, journal, and
//! application-root checks correctly reject. Tests must exercise those checks against the same
//! owner-only layout production creates (`application_root::create_private_directory_all`), not
//! against whatever umask the developer's shell happens to use.

use tempfile::TempDir;

/// Drop-in replacement for `tempfile::tempdir()` that always creates the directory as `0700`.
pub(crate) fn tempdir() -> std::io::Result<TempDir> {
    let mut builder = tempfile::Builder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        builder.permissions(std::fs::Permissions::from_mode(0o700));
    }
    builder.tempdir()
}
