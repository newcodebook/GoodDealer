mod authority;
mod container;
pub(crate) mod continuity;
mod desktop_local_host;

#[allow(
    dead_code,
    reason = "private implementation retained until backup SQL and Host crypto move into the frozen closed crate owner"
)]
mod restore;
#[allow(
    dead_code,
    reason = "private implementation retained until backup SQL and Host crypto move into the frozen closed crate owner"
)]
mod source;

pub use desktop_local_host::{
    DesktopBackupError, DesktopBackupExportStatus, DesktopBackupRestoreStatus,
    DesktopHostAuthorizationStatus, DesktopLocalBusinessState, DesktopLocalBusinessStatus,
    DesktopLocalHost, DesktopLocalHostError, DesktopVerifiedBackupArtifact,
};
