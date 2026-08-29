use std::fmt::{Display, Formatter};
use std::fs;
use std::path::{Component, Path, PathBuf};

use gooddealer_local_storage::{BusinessDatabase, BusinessDatabaseError, LocalDatabaseKey};
use gooddealer_secure_host_core::{
    LocalDatabaseKeyError, generate_local_database_key, load_local_database_key,
};

const BUSINESS_DIRECTORY_NAME: &str = "active-workspace";
const BUSINESS_DATABASE_NAME: &str = "business.db";
const DATABASE_KEY_BYTES: usize = 32;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum HostStorageError {
    InvalidPath,
    KeychainUnavailable,
    KeyMissing,
    KeyRejected,
    RandomUnavailable,
    StorageRejected,
}

impl Display for HostStorageError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::InvalidPath => "LOCAL_DATABASE_PATH_REJECTED",
            Self::KeychainUnavailable => "LOCAL_KEYCHAIN_UNAVAILABLE",
            Self::KeyMissing => "LOCAL_DATABASE_KEY_MISSING",
            Self::KeyRejected => "LOCAL_DATABASE_KEY_REJECTED",
            Self::RandomUnavailable => "LOCAL_RANDOM_UNAVAILABLE",
            Self::StorageRejected => "LOCAL_STORAGE_REJECTED",
        })
    }
}

impl std::error::Error for HostStorageError {}

impl From<BusinessDatabaseError> for HostStorageError {
    fn from(_value: BusinessDatabaseError) -> Self {
        Self::StorageRejected
    }
}

pub(crate) trait DatabaseKeyStore {
    fn load(&self) -> Result<Option<[u8; DATABASE_KEY_BYTES]>, HostStorageError>;
    fn generate_and_store(&self) -> Result<[u8; DATABASE_KEY_BYTES], HostStorageError>;
}

/// Host-only database identity. Its fixed path and key never cross the Tauri command boundary.
pub(crate) struct HostStorageBootstrap {
    database_path: PathBuf,
    database_key: LocalDatabaseKey,
}

impl HostStorageBootstrap {
    pub(crate) fn initialize(
        app_data_root: &Path,
        key_store: &impl DatabaseKeyStore,
    ) -> Result<Self, HostStorageError> {
        let database_path = prepare_database_path(app_data_root)?;
        let database_exists = database_path
            .try_exists()
            .map_err(|_| HostStorageError::InvalidPath)?;
        if database_exists {
            reject_non_file_or_symlink(&database_path)?;
        }

        let mut key_bytes = match key_store.load()? {
            Some(value) => value,
            None if database_exists => return Err(HostStorageError::KeyMissing),
            None => key_store.generate_and_store()?,
        };
        let database_key = LocalDatabaseKey::from_bytes(key_bytes);
        key_bytes.fill(0);

        Ok(Self {
            database_path,
            database_key,
        })
    }

    pub(crate) fn open_workspace(
        &self,
        workspace_id: &str,
    ) -> Result<BusinessDatabase, BusinessDatabaseError> {
        BusinessDatabase::open(&self.database_path, &self.database_key, workspace_id)
    }
}

#[derive(Debug, Default, Clone, Copy)]
pub(crate) struct NativeDatabaseKeyStore;

impl DatabaseKeyStore for NativeDatabaseKeyStore {
    fn load(&self) -> Result<Option<[u8; DATABASE_KEY_BYTES]>, HostStorageError> {
        load_local_database_key()
            .map(|value| value.map(|material| material.copy_for_sqlcipher()))
            .map_err(map_key_error)
    }

    fn generate_and_store(&self) -> Result<[u8; DATABASE_KEY_BYTES], HostStorageError> {
        generate_local_database_key()
            .map(|material| material.copy_for_sqlcipher())
            .map_err(map_key_error)
    }
}

fn map_key_error(error: LocalDatabaseKeyError) -> HostStorageError {
    match error {
        LocalDatabaseKeyError::Unavailable => HostStorageError::KeychainUnavailable,
        LocalDatabaseKeyError::Rejected => HostStorageError::KeyRejected,
        LocalDatabaseKeyError::RandomUnavailable => HostStorageError::RandomUnavailable,
    }
}

fn prepare_database_path(app_data_root: &Path) -> Result<PathBuf, HostStorageError> {
    if !app_data_root.is_absolute()
        || app_data_root
            .components()
            .any(|component| matches!(component, Component::ParentDir))
    {
        return Err(HostStorageError::InvalidPath);
    }
    fs::create_dir_all(app_data_root).map_err(|_| HostStorageError::InvalidPath)?;
    reject_directory_symlink(app_data_root)?;
    let canonical_root = app_data_root
        .canonicalize()
        .map_err(|_| HostStorageError::InvalidPath)?;

    let business_directory = canonical_root.join(BUSINESS_DIRECTORY_NAME);
    fs::create_dir_all(&business_directory).map_err(|_| HostStorageError::InvalidPath)?;
    reject_directory_symlink(&business_directory)?;
    let canonical_business_directory = business_directory
        .canonicalize()
        .map_err(|_| HostStorageError::InvalidPath)?;
    if canonical_business_directory.parent() != Some(canonical_root.as_path()) {
        return Err(HostStorageError::InvalidPath);
    }
    harden_directory_permissions(&canonical_business_directory)?;
    Ok(canonical_business_directory.join(BUSINESS_DATABASE_NAME))
}

fn reject_directory_symlink(path: &Path) -> Result<(), HostStorageError> {
    let metadata = fs::symlink_metadata(path).map_err(|_| HostStorageError::InvalidPath)?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(HostStorageError::InvalidPath);
    }
    Ok(())
}

fn reject_non_file_or_symlink(path: &Path) -> Result<(), HostStorageError> {
    let metadata = fs::symlink_metadata(path).map_err(|_| HostStorageError::InvalidPath)?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(HostStorageError::InvalidPath);
    }
    Ok(())
}

#[cfg(unix)]
fn harden_directory_permissions(path: &Path) -> Result<(), HostStorageError> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))
        .map_err(|_| HostStorageError::InvalidPath)
}

#[cfg(not(unix))]
fn harden_directory_permissions(_path: &Path) -> Result<(), HostStorageError> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;

    use tempfile::tempdir;

    use super::*;

    #[derive(Default)]
    struct MemoryKeyStore {
        value: RefCell<Option<[u8; DATABASE_KEY_BYTES]>>,
        unavailable: bool,
        rejected: bool,
    }

    impl MemoryKeyStore {
        fn with_key(key: [u8; DATABASE_KEY_BYTES]) -> Self {
            Self {
                value: RefCell::new(Some(key)),
                unavailable: false,
                rejected: false,
            }
        }
    }

    impl DatabaseKeyStore for MemoryKeyStore {
        fn load(&self) -> Result<Option<[u8; DATABASE_KEY_BYTES]>, HostStorageError> {
            if self.unavailable {
                return Err(HostStorageError::KeychainUnavailable);
            }
            if self.rejected {
                return Err(HostStorageError::KeyRejected);
            }
            Ok(*self.value.borrow())
        }

        fn generate_and_store(&self) -> Result<[u8; DATABASE_KEY_BYTES], HostStorageError> {
            if self.unavailable {
                return Err(HostStorageError::KeychainUnavailable);
            }
            let key = [0x73; DATABASE_KEY_BYTES];
            *self.value.borrow_mut() = Some(key);
            Ok(key)
        }
    }

    #[test]
    fn first_start_generates_key_and_restart_reuses_the_same_secure_identity() {
        let directory = tempdir().unwrap();
        let key_store = MemoryKeyStore::default();
        let first = HostStorageBootstrap::initialize(directory.path(), &key_store).unwrap();
        let mut database = first.open_workspace("workspace-local").unwrap();
        database
            .upsert_domain_asset(
                "mutation-local",
                "2026-08-29T00:00:00Z",
                &gooddealer_local_storage::DomainAssetWrite {
                    entity_id: "offline.test".to_owned(),
                    note: None,
                    portfolio_id: None,
                    tags: vec![],
                    target_price: None,
                },
            )
            .unwrap();
        drop(database);
        drop(first);

        let restarted = HostStorageBootstrap::initialize(directory.path(), &key_store).unwrap();
        let database = restarted.open_workspace("workspace-local").unwrap();
        assert_eq!(database.read_portfolio().unwrap().domains.len(), 1);
    }

    #[test]
    fn existing_database_with_missing_or_wrong_key_fails_closed() {
        let directory = tempdir().unwrap();
        let key_store = MemoryKeyStore::with_key([0x31; DATABASE_KEY_BYTES]);
        let first = HostStorageBootstrap::initialize(directory.path(), &key_store).unwrap();
        drop(first.open_workspace("workspace-local").unwrap());
        drop(first);

        *key_store.value.borrow_mut() = None;
        assert_eq!(
            HostStorageBootstrap::initialize(directory.path(), &key_store)
                .err()
                .unwrap(),
            HostStorageError::KeyMissing
        );

        *key_store.value.borrow_mut() = Some([0x41; DATABASE_KEY_BYTES]);
        let wrong = HostStorageBootstrap::initialize(directory.path(), &key_store).unwrap();
        assert_eq!(
            wrong.open_workspace("workspace-local").err().unwrap(),
            BusinessDatabaseError::StorageRejected
        );
    }

    #[test]
    fn keychain_failure_and_malformed_key_are_rejected_without_secret_diagnostics() {
        let directory = tempdir().unwrap();
        let unavailable = MemoryKeyStore {
            value: RefCell::new(None),
            unavailable: true,
            rejected: false,
        };
        let error = HostStorageBootstrap::initialize(directory.path(), &unavailable)
            .err()
            .unwrap();
        assert_eq!(error, HostStorageError::KeychainUnavailable);
        assert_eq!(error.to_string(), "LOCAL_KEYCHAIN_UNAVAILABLE");

        let malformed = MemoryKeyStore {
            value: RefCell::new(None),
            unavailable: false,
            rejected: true,
        };
        assert_eq!(
            HostStorageBootstrap::initialize(directory.path(), &malformed)
                .err()
                .unwrap(),
            HostStorageError::KeyRejected
        );
    }

    #[test]
    fn relative_and_symlinked_database_roots_are_rejected() {
        assert_eq!(
            HostStorageBootstrap::initialize(Path::new("relative"), &MemoryKeyStore::default())
                .err()
                .unwrap(),
            HostStorageError::InvalidPath
        );

        let directory = tempdir().unwrap();
        let target = directory.path().join("target");
        fs::create_dir(&target).unwrap();
        let link = directory.path().join("link");
        #[cfg(unix)]
        std::os::unix::fs::symlink(&target, &link).unwrap();
        #[cfg(windows)]
        std::os::windows::fs::symlink_dir(&target, &link).unwrap();
        assert_eq!(
            HostStorageBootstrap::initialize(&link, &MemoryKeyStore::default())
                .err()
                .unwrap(),
            HostStorageError::InvalidPath
        );
    }

    #[test]
    fn symlinked_and_non_file_database_targets_are_rejected() {
        let directory = tempdir().unwrap();
        let storage_directory = directory.path().join(BUSINESS_DIRECTORY_NAME);
        fs::create_dir(&storage_directory).unwrap();
        let database_path = storage_directory.join(BUSINESS_DATABASE_NAME);
        let target = directory.path().join("outside.db");
        fs::write(&target, b"outside").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(&target, &database_path).unwrap();
        #[cfg(windows)]
        std::os::windows::fs::symlink_file(&target, &database_path).unwrap();
        assert_eq!(
            HostStorageBootstrap::initialize(directory.path(), &MemoryKeyStore::default())
                .err()
                .unwrap(),
            HostStorageError::InvalidPath
        );

        fs::remove_file(&database_path).unwrap();
        fs::create_dir(&database_path).unwrap();
        assert_eq!(
            HostStorageBootstrap::initialize(directory.path(), &MemoryKeyStore::default())
                .err()
                .unwrap(),
            HostStorageError::InvalidPath
        );
    }
}
