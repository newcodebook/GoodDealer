//! Validated native application root for the Desktop local host.

use std::fmt;
use std::fs::File;
use std::path::{Component, Path, PathBuf};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DesktopApplicationRootError {
    Rejected,
    StorageRejected,
}

impl fmt::Display for DesktopApplicationRootError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Rejected => "DESKTOP_APPLICATION_ROOT_REJECTED",
            Self::StorageRejected => "DESKTOP_APPLICATION_ROOT_STORAGE_REJECTED",
        })
    }
}

impl std::error::Error for DesktopApplicationRootError {}

/// Absolute, owned native application directory validated once during trusted startup.
///
/// The inner path is intentionally inaccessible outside this crate. Backup and database paths
/// are fixed descendants derived only by the local host; Renderer requests cannot select them.
#[allow(
    dead_code,
    reason = "private derived paths are consumed by the whole-runtime aggregate integration"
)]
pub struct DesktopApplicationRoot {
    path: PathBuf,
    directory: File,
    identity: DirectoryIdentity,
}

impl DesktopApplicationRoot {
    /// Validates or creates the trusted native application root.
    ///
    /// # Errors
    ///
    /// Rejects relative paths, symlinks in the existing path, non-directories, a final directory
    /// not owned by this process user, or group/world-writable final permissions.
    pub fn validate(path: &Path) -> Result<Self, DesktopApplicationRootError> {
        if !path.is_absolute()
            || path
                .components()
                .any(|part| matches!(part, Component::ParentDir))
        {
            return Err(DesktopApplicationRootError::Rejected);
        }
        reject_existing_symlink_components(path)?;
        create_private_directory_all(path)?;
        reject_existing_symlink_components(path)?;
        let metadata = std::fs::symlink_metadata(path)
            .map_err(|_| DesktopApplicationRootError::StorageRejected)?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err(DesktopApplicationRootError::Rejected);
        }
        validate_owner_and_mode(&metadata)?;
        #[cfg(unix)]
        {
            let directory = File::from(
                rustix::fs::openat(
                    rustix::fs::CWD,
                    path,
                    rustix::fs::OFlags::RDONLY
                        | rustix::fs::OFlags::DIRECTORY
                        | rustix::fs::OFlags::NOFOLLOW
                        | rustix::fs::OFlags::CLOEXEC,
                    rustix::fs::Mode::empty(),
                )
                .map_err(|_| DesktopApplicationRootError::StorageRejected)?,
            );
            let identity = directory_identity(&directory)?;
            let root = Self {
                path: path.to_path_buf(),
                directory,
                identity,
            };
            root.verify_identity()?;
            Ok(root)
        }
        #[cfg(not(unix))]
        {
            Err(DesktopApplicationRootError::Rejected)
        }
    }

    #[allow(
        dead_code,
        reason = "consumed by the whole-runtime aggregate integration"
    )]
    pub(crate) fn business_database_path(&self) -> PathBuf {
        self.path.join("active-workspace").join("business.db")
    }

    #[allow(
        dead_code,
        reason = "consumed by the whole-runtime aggregate integration"
    )]
    pub(crate) fn authorization_lock_path(&self) -> PathBuf {
        self.path
            .join("active-workspace")
            .join("authorization.lock")
    }

    #[allow(
        dead_code,
        reason = "consumed by the whole-runtime aggregate integration"
    )]
    pub(crate) fn rebootstrap_journal_path(&self) -> PathBuf {
        self.path
            .join("active-workspace")
            .join("rebootstrap.journal")
    }

    pub(crate) fn runtime_lock_path(&self) -> PathBuf {
        self.path.join(".desktop-local-host.lock")
    }

    pub(crate) fn directory(&self) -> &File {
        &self.directory
    }

    pub(crate) fn verify_identity(&self) -> Result<(), DesktopApplicationRootError> {
        if directory_identity(&self.directory)? != self.identity {
            return Err(DesktopApplicationRootError::Rejected);
        }
        let metadata = std::fs::symlink_metadata(&self.path)
            .map_err(|_| DesktopApplicationRootError::StorageRejected)?;
        validate_owner_and_mode(&metadata)?;
        let path_identity = metadata_identity(&metadata)?;
        if path_identity != self.identity {
            return Err(DesktopApplicationRootError::Rejected);
        }
        Ok(())
    }
}

impl fmt::Debug for DesktopApplicationRoot {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("DesktopApplicationRoot([REDACTED])")
    }
}

fn reject_existing_symlink_components(path: &Path) -> Result<(), DesktopApplicationRootError> {
    let mut current = PathBuf::new();
    for component in path.components() {
        current.push(component.as_os_str());
        match std::fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err(DesktopApplicationRootError::Rejected);
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => break,
            Err(_) => return Err(DesktopApplicationRootError::StorageRejected),
        }
    }
    Ok(())
}

/// Creates missing components owner-only so the root does not inherit a permissive umask.
///
/// Desktop distributions commonly default to umask 002; creating with the process umask would
/// make a fresh root group-writable and fail the mode check below on first launch. An existing
/// directory is never re-permissioned: a root that was already exposed stays rejected.
#[cfg(unix)]
fn create_private_directory_all(path: &Path) -> Result<(), DesktopApplicationRootError> {
    use std::os::unix::fs::DirBuilderExt as _;

    std::fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(path)
        .map_err(|_| DesktopApplicationRootError::StorageRejected)
}

#[cfg(not(unix))]
fn create_private_directory_all(path: &Path) -> Result<(), DesktopApplicationRootError> {
    std::fs::create_dir_all(path).map_err(|_| DesktopApplicationRootError::StorageRejected)
}

#[cfg(unix)]
fn validate_owner_and_mode(
    metadata: &std::fs::Metadata,
) -> Result<(), DesktopApplicationRootError> {
    use std::os::unix::fs::MetadataExt as _;

    if metadata.uid() != rustix::process::geteuid().as_raw() || metadata.mode() & 0o022 != 0 {
        return Err(DesktopApplicationRootError::Rejected);
    }
    Ok(())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct DirectoryIdentity {
    dev: u64,
    ino: u64,
}

#[cfg(unix)]
fn metadata_identity(
    metadata: &std::fs::Metadata,
) -> Result<DirectoryIdentity, DesktopApplicationRootError> {
    use std::os::unix::fs::MetadataExt as _;

    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(DesktopApplicationRootError::Rejected);
    }
    Ok(DirectoryIdentity {
        dev: metadata.dev(),
        ino: metadata.ino(),
    })
}

#[cfg(not(unix))]
fn metadata_identity(
    _metadata: &std::fs::Metadata,
) -> Result<DirectoryIdentity, DesktopApplicationRootError> {
    Err(DesktopApplicationRootError::Rejected)
}

fn directory_identity(file: &File) -> Result<DirectoryIdentity, DesktopApplicationRootError> {
    let metadata = file
        .metadata()
        .map_err(|_| DesktopApplicationRootError::StorageRejected)?;
    validate_owner_and_mode(&metadata)?;
    metadata_identity(&metadata)
}

#[cfg(not(unix))]
fn validate_owner_and_mode(
    _metadata: &std::fs::Metadata,
) -> Result<(), DesktopApplicationRootError> {
    // Production remains unavailable on targets without an implemented native ownership check.
    Err(DesktopApplicationRootError::Rejected)
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use tempfile::tempdir;

    use super::*;

    #[test]
    fn validates_absolute_owned_directory_and_derives_only_fixed_private_children() {
        let parent = tempdir().unwrap();
        let path = parent.path().canonicalize().unwrap().join("GoodDealer");
        let root = DesktopApplicationRoot::validate(&path).unwrap();
        assert_eq!(format!("{root:?}"), "DesktopApplicationRoot([REDACTED])");
        assert_eq!(
            root.business_database_path(),
            path.join("active-workspace/business.db")
        );
        assert_eq!(
            root.authorization_lock_path(),
            path.join("active-workspace/authorization.lock")
        );
        assert_eq!(
            root.rebootstrap_journal_path(),
            path.join("active-workspace/rebootstrap.journal")
        );
    }

    #[test]
    fn rejects_relative_path_and_non_directory() {
        assert_eq!(
            DesktopApplicationRoot::validate(Path::new("relative/app-root")).unwrap_err(),
            DesktopApplicationRootError::Rejected
        );
        let parent = tempdir().unwrap();
        let file = parent.path().join("file");
        std::fs::write(&file, b"not a directory").unwrap();
        assert!(DesktopApplicationRoot::validate(&file).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn creates_missing_components_owner_only_regardless_of_umask() {
        use std::os::unix::fs::PermissionsExt as _;

        let parent = tempdir().unwrap();
        let path = parent.path().canonicalize().unwrap().join("share").join("GoodDealer");
        DesktopApplicationRoot::validate(&path).unwrap();
        // Any group/other bit would come from the process umask, not the requested mode.
        for created in [path.parent().unwrap(), path.as_path()] {
            let mode = std::fs::metadata(created).unwrap().permissions().mode();
            assert_eq!(mode & 0o077, 0, "{created:?} has mode {mode:o}");
        }
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlink_and_insecure_final_permissions() {
        use std::os::unix::fs::{PermissionsExt as _, symlink};

        let parent = tempdir().unwrap();
        let target = parent.path().join("target");
        std::fs::create_dir(&target).unwrap();
        let link = parent.path().join("link");
        symlink(&target, &link).unwrap();
        assert_eq!(
            DesktopApplicationRoot::validate(&link).unwrap_err(),
            DesktopApplicationRootError::Rejected
        );

        let insecure = parent.path().join("insecure");
        std::fs::create_dir(&insecure).unwrap();
        std::fs::set_permissions(&insecure, std::fs::Permissions::from_mode(0o777)).unwrap();
        assert_eq!(
            DesktopApplicationRoot::validate(&insecure).unwrap_err(),
            DesktopApplicationRootError::Rejected
        );
    }
}
