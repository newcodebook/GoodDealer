//! Native backup admission and publication; test filesystem custody is not a production adapter.

#[cfg(all(test, unix))]
use super::{Digest, Sha256, valid_opaque_identifier};

use super::{DesktopBackupError, fmt};

#[cfg_attr(
    not(all(test, unix)),
    allow(
        dead_code,
        reason = "read only by the private development native composition"
    )
)]
pub(super) struct AdmittedBackupHandle {
    token: String,
    identity: NativeFileIdentity,
    size: u64,
    digest: [u8; 32],
    #[cfg_attr(not(unix), cfg(any()))]
    #[cfg(test)]
    file: std::fs::File,
}

impl fmt::Debug for AdmittedBackupHandle {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("AdmittedBackupHandle([OPAQUE])")
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct NativeFileIdentity {
    len: u64,
    #[cfg(unix)]
    device: u64,
    #[cfg(unix)]
    inode: u64,
    #[cfg(unix)]
    uid: u32,
    #[cfg(unix)]
    mode: u32,
    #[cfg(unix)]
    nlink: u64,
}

pub(super) enum NativeBackupComposition {
    Unavailable,
    #[cfg_attr(not(unix), cfg(any()))]
    #[cfg(test)]
    Development(DevelopmentNativeBackup),
}

impl NativeBackupComposition {
    pub(super) const fn is_qualified(&self) -> bool {
        match self {
            Self::Unavailable => false,
            #[cfg_attr(not(unix), cfg(any()))]
            #[cfg(test)]
            Self::Development(_) => true,
        }
    }

    pub(super) fn stage_publication(
        &mut self,
        operation_id: &str,
        artifact: &[u8],
    ) -> Result<StagedPublication, DesktopBackupError> {
        match self {
            Self::Unavailable => {
                let _ = (operation_id, artifact);
                Err(DesktopBackupError::StorageRejected)
            }
            #[cfg_attr(not(unix), cfg(any()))]
            #[cfg(test)]
            Self::Development(native) => native.stage_publication(operation_id, artifact),
        }
    }

    pub(super) fn mark_available(
        &mut self,
        staged: &StagedPublication,
    ) -> Result<(), DesktopBackupError> {
        match self {
            Self::Unavailable => {
                let _ = staged;
                Err(DesktopBackupError::StorageRejected)
            }
            #[cfg_attr(not(unix), cfg(any()))]
            #[cfg(test)]
            Self::Development(native) => native.mark_available(staged),
        }
    }

    pub(super) fn select(&self) -> Result<AdmittedBackupHandle, DesktopBackupError> {
        match self {
            Self::Unavailable => Err(DesktopBackupError::StorageRejected),
            #[cfg_attr(not(unix), cfg(any()))]
            #[cfg(test)]
            Self::Development(native) => native.select(),
        }
    }

    pub(super) fn read(
        &self,
        handle: &AdmittedBackupHandle,
    ) -> Result<Vec<u8>, DesktopBackupError> {
        match self {
            Self::Unavailable => {
                let _ = handle;
                Err(DesktopBackupError::StorageRejected)
            }
            #[cfg_attr(not(unix), cfg(any()))]
            #[cfg(test)]
            Self::Development(native) => native.read(handle),
        }
    }

    pub(super) fn quarantine(&mut self, staged: &StagedPublication) {
        match self {
            Self::Unavailable => {
                let _ = staged;
            }
            #[cfg_attr(not(unix), cfg(any()))]
            #[cfg(test)]
            Self::Development(native) => native.quarantine(staged),
        }
    }
}

#[cfg_attr(
    not(all(test, unix)),
    allow(dead_code, reason = "read only by the private development journal")
)]
pub(super) struct StagedPublication {
    token: String,
}

#[cfg_attr(not(unix), cfg(any()))]
#[cfg(test)]
pub(super) struct DevelopmentNativeBackup {
    root: std::path::PathBuf,
    pub(super) available: Vec<String>,
}

#[cfg_attr(not(unix), cfg(any()))]
#[cfg(test)]
impl DevelopmentNativeBackup {
    pub(super) fn new(root: std::path::PathBuf) -> Result<Self, DesktopBackupError> {
        std::fs::create_dir_all(&root).map_err(|_| DesktopBackupError::StorageRejected)?;
        let mut native = Self {
            root,
            available: Vec::new(),
        };
        native.recover()?;
        Ok(native)
    }

    pub(super) fn stage_publication(
        &mut self,
        operation_id: &str,
        artifact: &[u8],
    ) -> Result<StagedPublication, DesktopBackupError> {
        use std::fs::OpenOptions;
        use std::io::Write as _;
        #[cfg(unix)]
        use std::os::unix::fs::OpenOptionsExt as _;

        if artifact.len() > crate::desktop_local_host::container::ARTIFACT_BYTE_LIMIT {
            return Err(DesktopBackupError::ArtifactRejected);
        }
        let temporary_name = format!(".{operation_id}.writing");
        let available_name = format!("{operation_id}.gdbk");
        let temporary_path = self.root.join(&temporary_name);
        let available_path = self.root.join(&available_name);
        self.persist_journal(operation_id, "reserved")?;
        let mut options = OpenOptions::new();
        options.create_new(true).write(true);
        #[cfg(unix)]
        options
            .mode(0o600)
            .custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW);
        let mut file = options
            .open(&temporary_path)
            .map_err(|_| DesktopBackupError::StorageRejected)?;
        self.persist_journal(operation_id, "writing")?;
        let result = (|| {
            file.write_all(artifact)
                .map_err(|_| DesktopBackupError::StorageRejected)?;
            file.sync_all()
                .map_err(|_| DesktopBackupError::StorageRejected)?;
            self.persist_journal(operation_id, "fsynced")?;
            // Creating the final link is atomic and fails if the destination already exists.
            // Removing the staging name immediately restores the admitted link count to one.
            std::fs::hard_link(&temporary_path, &available_path)
                .map_err(|_| DesktopBackupError::StorageRejected)?;
            std::fs::remove_file(&temporary_path)
                .map_err(|_| DesktopBackupError::StorageRejected)?;
            std::fs::File::open(&self.root)
                .and_then(|directory| directory.sync_all())
                .map_err(|_| DesktopBackupError::StorageRejected)?;
            self.persist_journal(operation_id, "renamed")?;
            Ok(())
        })();
        if let Err(error) = result {
            let _ = std::fs::remove_file(&temporary_path);
            let _ = std::fs::remove_file(&available_path);
            let _ = self.persist_journal(operation_id, "quarantined");
            return Err(error);
        }
        Ok(StagedPublication {
            token: operation_id.to_owned(),
        })
    }

    pub(super) fn mark_available(
        &mut self,
        staged: &StagedPublication,
    ) -> Result<(), DesktopBackupError> {
        self.persist_journal(&staged.token, "catalog_available")?;
        self.available.push(format!("{}.gdbk", staged.token));
        Ok(())
    }

    pub(super) fn select(&self) -> Result<AdmittedBackupHandle, DesktopBackupError> {
        self.select_with_hooks(|_| {}, |_, _| {})
    }

    #[cfg_attr(not(unix), cfg(any()))]
    #[cfg(test)]
    pub(super) fn select_with_hooks<Before, After>(
        &self,
        before_open: Before,
        after_open: After,
    ) -> Result<AdmittedBackupHandle, DesktopBackupError>
    where
        Before: FnOnce(&std::path::Path),
        After: FnOnce(&std::fs::File, &std::path::Path),
    {
        let token = self
            .available
            .last()
            .ok_or(DesktopBackupError::StorageRejected)?
            .clone();
        let path = self.root.join(&token);
        let metadata =
            std::fs::symlink_metadata(&path).map_err(|_| DesktopBackupError::ArtifactRejected)?;
        validate_native_metadata(&metadata)?;
        let size = metadata.len();
        if size > crate::desktop_local_host::container::ARTIFACT_BYTE_LIMIT as u64 {
            return Err(DesktopBackupError::ArtifactRejected);
        }
        before_open(&path);
        let file = open_native_read(&path)?;
        // Path admission and the opened handle must describe the same inode.  This closes the
        // stat/open replacement window; the handle, not a later path lookup, is authoritative.
        let opened_metadata = file
            .metadata()
            .map_err(|_| DesktopBackupError::ArtifactRejected)?;
        after_open(&file, &path);
        validate_native_metadata(&opened_metadata)?;
        if native_file_identity(&opened_metadata) != native_file_identity(&metadata)
            || opened_metadata.len() != size
        {
            return Err(DesktopBackupError::ArtifactRejected);
        }
        let bytes = read_native_file(&file, size)?;
        if bytes.len() as u64 != size {
            return Err(DesktopBackupError::ArtifactRejected);
        }
        Ok(AdmittedBackupHandle {
            token,
            identity: native_file_identity(&opened_metadata),
            size,
            digest: Sha256::digest(&bytes).into(),
            file,
        })
    }

    pub(super) fn read(
        &self,
        handle: &AdmittedBackupHandle,
    ) -> Result<Vec<u8>, DesktopBackupError> {
        let path = self.root.join(&handle.token);
        let before =
            std::fs::symlink_metadata(&path).map_err(|_| DesktopBackupError::ArtifactRejected)?;
        validate_native_metadata(&before)?;
        if native_file_identity(&before) != handle.identity
            || before.len() != handle.size
            || before.len() > crate::desktop_local_host::container::ARTIFACT_BYTE_LIMIT as u64
        {
            return Err(DesktopBackupError::ArtifactRejected);
        }
        let retained_before = handle
            .file
            .metadata()
            .map_err(|_| DesktopBackupError::ArtifactRejected)?;
        validate_native_metadata(&retained_before)?;
        if native_file_identity(&retained_before) != handle.identity
            || retained_before.len() != handle.size
        {
            return Err(DesktopBackupError::ArtifactRejected);
        }
        let bytes = read_native_file(&handle.file, handle.size)?;
        let retained_after = handle
            .file
            .metadata()
            .map_err(|_| DesktopBackupError::ArtifactRejected)?;
        validate_native_metadata(&retained_after)?;
        if native_file_identity(&retained_after) != handle.identity
            || retained_after.len() != handle.size
        {
            return Err(DesktopBackupError::ArtifactRejected);
        }
        let after =
            std::fs::symlink_metadata(&path).map_err(|_| DesktopBackupError::ArtifactRejected)?;
        validate_native_metadata(&after)?;
        if native_file_identity(&after) != handle.identity
            || after.len() != handle.size
            || bytes.len() as u64 != handle.size
            || <[u8; 32]>::from(Sha256::digest(&bytes)) != handle.digest
        {
            return Err(DesktopBackupError::ArtifactRejected);
        }
        Ok(bytes)
    }

    pub(super) fn quarantine(&mut self, staged: &StagedPublication) {
        let available_name = format!("{}.gdbk", staged.token);
        self.available.retain(|value| value != &available_name);
        let _ = std::fs::remove_file(self.root.join(available_name));
        let _ = std::fs::remove_file(self.root.join(format!(".{}.writing", staged.token)));
        let _ = self.persist_journal(&staged.token, "quarantined");
    }

    pub(super) fn persist_journal(
        &self,
        token: &str,
        state: &str,
    ) -> Result<(), DesktopBackupError> {
        use std::io::Write as _;

        if !valid_opaque_identifier(token)
            || !matches!(
                state,
                "reserved"
                    | "writing"
                    | "fsynced"
                    | "renamed"
                    | "catalog_available"
                    | "quarantined"
            )
        {
            return Err(DesktopBackupError::StorageRejected);
        }
        // Replace through a private, create-new staging file.  `rename` replaces a malicious
        // symlink itself rather than following it, while the no-follow open protects the staging
        // handle.  The directory fsync below makes the replacement durable.
        let path = self.root.join(format!("{token}.journal"));
        let temporary_path = self.root.join(format!(".{token}.journal.tmp"));
        let mut options = std::fs::OpenOptions::new();
        options.create_new(true).write(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt as _;
            options
                .mode(0o600)
                .custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW);
        }
        let result = (|| {
            let mut file = options
                .open(&temporary_path)
                .map_err(|_| DesktopBackupError::StorageRejected)?;
            file.write_all(state.as_bytes())
                .map_err(|_| DesktopBackupError::StorageRejected)?;
            file.sync_all()
                .map_err(|_| DesktopBackupError::StorageRejected)?;
            let metadata = file
                .metadata()
                .map_err(|_| DesktopBackupError::StorageRejected)?;
            validate_native_metadata(&metadata).map_err(|_| DesktopBackupError::StorageRejected)?;
            if metadata.len() != state.len() as u64 {
                return Err(DesktopBackupError::StorageRejected);
            }
            let staged_path_metadata = std::fs::symlink_metadata(&temporary_path)
                .map_err(|_| DesktopBackupError::StorageRejected)?;
            validate_native_metadata(&staged_path_metadata)
                .map_err(|_| DesktopBackupError::StorageRejected)?;
            if native_file_identity(&staged_path_metadata) != native_file_identity(&metadata) {
                return Err(DesktopBackupError::StorageRejected);
            }
            std::fs::rename(&temporary_path, &path)
                .map_err(|_| DesktopBackupError::StorageRejected)?;
            let published_path_metadata = std::fs::symlink_metadata(&path)
                .map_err(|_| DesktopBackupError::StorageRejected)?;
            validate_native_metadata(&published_path_metadata)
                .map_err(|_| DesktopBackupError::StorageRejected)?;
            if native_file_identity(&published_path_metadata) != native_file_identity(&metadata) {
                return Err(DesktopBackupError::StorageRejected);
            }
            std::fs::File::open(&self.root)
                .and_then(|directory| directory.sync_all())
                .map_err(|_| DesktopBackupError::StorageRejected)
        })();
        if result.is_err() {
            let _ = std::fs::remove_file(&temporary_path);
        }
        result
    }

    fn recover(&mut self) -> Result<(), DesktopBackupError> {
        for entry in
            std::fs::read_dir(&self.root).map_err(|_| DesktopBackupError::StorageRejected)?
        {
            let entry = entry.map_err(|_| DesktopBackupError::StorageRejected)?;
            let name = entry.file_name();
            let Some(name) = name.to_str() else {
                continue;
            };
            if let Some(token) = name
                .strip_prefix('.')
                .and_then(|value| value.strip_suffix(".journal.tmp"))
            {
                if valid_opaque_identifier(token) {
                    // An interrupted atomic replacement leaves only this private staging name.
                    // It contains no trusted state and is safe to unlink without following it.
                    let _ = std::fs::remove_file(entry.path());
                }
                continue;
            }
            let Some(token) = name.strip_suffix(".journal") else {
                continue;
            };
            if !valid_opaque_identifier(token) {
                continue;
            }
            let journal_path = entry.path();
            let journal_metadata = std::fs::symlink_metadata(&journal_path)
                .map_err(|_| DesktopBackupError::StorageRejected)?;
            validate_native_metadata(&journal_metadata)
                .map_err(|_| DesktopBackupError::StorageRejected)?;
            if journal_metadata.len() > 64 {
                return Err(DesktopBackupError::StorageRejected);
            }
            let journal_file =
                open_native_read(&journal_path).map_err(|_| DesktopBackupError::StorageRejected)?;
            let opened_metadata = journal_file
                .metadata()
                .map_err(|_| DesktopBackupError::StorageRejected)?;
            validate_native_metadata(&opened_metadata)
                .map_err(|_| DesktopBackupError::StorageRejected)?;
            if native_file_identity(&opened_metadata) != native_file_identity(&journal_metadata)
                || opened_metadata.len() != journal_metadata.len()
            {
                return Err(DesktopBackupError::StorageRejected);
            }
            let state_bytes = read_bounded_journal(&journal_file, journal_metadata.len())
                .map_err(|_| DesktopBackupError::StorageRejected)?;
            let retained_after = journal_file
                .metadata()
                .map_err(|_| DesktopBackupError::StorageRejected)?;
            validate_native_metadata(&retained_after)
                .map_err(|_| DesktopBackupError::StorageRejected)?;
            let path_after = std::fs::symlink_metadata(&journal_path)
                .map_err(|_| DesktopBackupError::StorageRejected)?;
            validate_native_metadata(&path_after)
                .map_err(|_| DesktopBackupError::StorageRejected)?;
            if native_file_identity(&retained_after) != native_file_identity(&opened_metadata)
                || native_file_identity(&path_after) != native_file_identity(&opened_metadata)
            {
                return Err(DesktopBackupError::StorageRejected);
            }
            let state = std::str::from_utf8(&state_bytes)
                .map_err(|_| DesktopBackupError::StorageRejected)?;
            let available_name = format!("{token}.gdbk");
            if state == "catalog_available" {
                let metadata = std::fs::symlink_metadata(self.root.join(&available_name))
                    .map_err(|_| DesktopBackupError::StorageRejected)?;
                validate_native_metadata(&metadata)?;
                self.available.push(available_name);
            } else {
                let _ = std::fs::remove_file(self.root.join(&available_name));
                let _ = std::fs::remove_file(self.root.join(format!(".{token}.writing")));
                self.persist_journal(token, "quarantined")?;
            }
        }
        self.available.sort();
        Ok(())
    }
}

#[cfg_attr(not(unix), cfg(any()))]
#[cfg(test)]
fn open_native_read(path: &std::path::Path) -> Result<std::fs::File, DesktopBackupError> {
    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt as _;
        options.custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW);
    }
    options
        .open(path)
        .map_err(|_| DesktopBackupError::ArtifactRejected)
}

#[cfg_attr(not(unix), cfg(any()))]
#[cfg(test)]
fn read_native_file(
    file: &std::fs::File,
    expected_size: u64,
) -> Result<Vec<u8>, DesktopBackupError> {
    use std::io::{Read as _, Seek as _, SeekFrom};

    if expected_size > crate::desktop_local_host::container::ARTIFACT_BYTE_LIMIT as u64 {
        return Err(DesktopBackupError::ArtifactRejected);
    }
    let length =
        usize::try_from(expected_size).map_err(|_| DesktopBackupError::ArtifactRejected)?;
    let mut reader = file
        .try_clone()
        .map_err(|_| DesktopBackupError::ArtifactRejected)?;
    reader
        .seek(SeekFrom::Start(0))
        .map_err(|_| DesktopBackupError::ArtifactRejected)?;
    let mut bytes = Vec::with_capacity(length);
    reader
        .take(expected_size.saturating_add(1))
        .read_to_end(&mut bytes)
        .map_err(|_| DesktopBackupError::ArtifactRejected)?;
    if bytes.len() != length {
        return Err(DesktopBackupError::ArtifactRejected);
    }
    Ok(bytes)
}

#[cfg_attr(not(unix), cfg(any()))]
#[cfg(test)]
fn read_bounded_journal(
    file: &std::fs::File,
    expected_size: u64,
) -> Result<Vec<u8>, DesktopBackupError> {
    const JOURNAL_BYTE_LIMIT: u64 = 64;
    if expected_size > JOURNAL_BYTE_LIMIT {
        return Err(DesktopBackupError::StorageRejected);
    }
    read_native_file(file, expected_size)
}

#[cfg_attr(not(unix), cfg(any()))]
#[cfg(test)]
fn validate_native_metadata(metadata: &std::fs::Metadata) -> Result<(), DesktopBackupError> {
    if !metadata.file_type().is_file() {
        return Err(DesktopBackupError::ArtifactRejected);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt as _;
        if metadata.nlink() != 1
            || metadata.mode() & 0o7777 != 0o600
            || metadata.uid() != rustix::process::geteuid().as_raw()
        {
            return Err(DesktopBackupError::ArtifactRejected);
        }
    }
    Ok(())
}

#[cfg_attr(not(unix), cfg(any()))]
#[cfg(test)]
fn native_file_identity(metadata: &std::fs::Metadata) -> NativeFileIdentity {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt as _;
        NativeFileIdentity {
            len: metadata.len(),
            device: metadata.dev(),
            inode: metadata.ino(),
            uid: metadata.uid(),
            mode: metadata.mode() & 0o777,
            nlink: metadata.nlink(),
        }
    }
    #[cfg(not(unix))]
    {
        let _ = metadata;
        NativeFileIdentity {
            len: metadata.len(),
        }
    }
}
