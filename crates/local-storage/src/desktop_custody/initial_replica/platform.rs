//! Fixed installation-state files and OS records; no caller-controlled path or key selector.
use super::{DesktopProductionCustody, Error, failed, rejected, validate_name};
use std::fs::File;
use zeroize::Zeroizing;
#[cfg(not(all(test, unix)))]
const SERVICE: &str = "com.gooddealer.desktop.initial-replica";
#[cfg(not(all(test, unix)))]
const HEAD: &str = "installation-head-v1";
#[cfg(not(all(test, unix)))]
const MARKER: &str = "installation-established-v1";
const ESTABLISHED: &[u8] = b"GOODDEALER/INITIAL-REPLICA-ESTABLISHED-V1";
#[cfg_attr(
    unix,
    expect(
        clippy::used_underscore_binding,
        reason = "retained directory pins are also the fixed relative-I/O capability"
    )
)]
impl DesktopProductionCustody {
    #[cfg_attr(
        not(all(test, unix)),
        expect(
            clippy::unused_self,
            reason = "production fixed purpose and isolated test custody share one owner"
        )
    )]
    pub(super) fn load_initial_head_bytes(&self) -> Result<Option<Vec<u8>>, Error> {
        #[cfg(all(test, unix))]
        {
            Ok(self
                .rebootstrap_test_store
                .initial_replica_head
                .lock()
                .map_err(|_| failed())?
                .clone())
        }
        #[cfg(all(unix, not(test)))]
        {
            super::super::load_native(SERVICE, HEAD)
        }
        #[cfg(windows)]
        {
            super::super::load(SERVICE, HEAD)
        }
    }
    #[cfg_attr(
        not(all(test, unix)),
        expect(
            clippy::unused_self,
            reason = "production fixed purpose and isolated test custody share one owner"
        )
    )]
    pub(super) fn store_initial_head_bytes(&self, bytes: &[u8]) -> Result<(), Error> {
        #[cfg(all(test, unix))]
        {
            *self
                .rebootstrap_test_store
                .initial_replica_head
                .lock()
                .map_err(|_| failed())? = Some(bytes.to_vec());
            Ok(())
        }
        #[cfg(all(unix, not(test)))]
        {
            super::super::store_native(SERVICE, HEAD, bytes)
        }
        #[cfg(windows)]
        {
            super::super::store(SERVICE, HEAD, bytes)
        }
    }
    #[cfg_attr(
        not(all(test, unix)),
        expect(
            clippy::unused_self,
            reason = "production fixed purpose and isolated test custody share one owner"
        )
    )]
    pub(super) fn initial_head_established(&self) -> Result<bool, Error> {
        #[cfg(all(test, unix))]
        let marker = self
            .rebootstrap_test_store
            .initial_replica_marker
            .lock()
            .map_err(|_| failed())?
            .clone();
        #[cfg(all(unix, not(test)))]
        let marker = super::super::load_native(SERVICE, MARKER)?;
        #[cfg(windows)]
        let marker = super::super::load(SERVICE, MARKER)?;
        match marker {
            None => Ok(false),
            Some(bytes) if bytes == ESTABLISHED => Ok(true),
            Some(_) => Err(rejected()),
        }
    }
    pub(super) fn mark_initial_head_established(&self) -> Result<(), Error> {
        #[cfg(all(test, unix))]
        {
            *self
                .rebootstrap_test_store
                .initial_replica_marker
                .lock()
                .map_err(|_| failed())? = Some(ESTABLISHED.to_vec());
        }
        #[cfg(all(unix, not(test)))]
        super::super::store_native(SERVICE, MARKER, ESTABLISHED)?;
        #[cfg(windows)]
        super::super::store(SERVICE, MARKER, ESTABLISHED)?;
        if !self.initial_head_established()? {
            return Err(failed());
        }
        Ok(())
    }
    pub(super) fn initial_database_identity(&self) -> Result<[u64; 2], Error> {
        #[cfg(unix)]
        {
            let active = self.active_database.lock().map_err(|_| failed())?;
            super::super::ensure_file_identity(&active.file, active.identity)?;
            super::super::ensure_directory_file_identity(
                &self._active_workspace,
                self.active_workspace_identity,
            )?;
            super::super::ensure_directory_path_identity(
                self.database_path.parent().ok_or_else(rejected)?,
                self.active_workspace_identity,
            )?;
            super::super::ensure_path_identity(&self.database_path, active.identity)?;
            Ok([active.identity.dev, active.identity.ino])
        }
        #[cfg(windows)]
        {
            self.verify()?;
            Ok([self.identity.volume, self.identity.index])
        }
    }
    pub(super) fn initial_database_is_empty(&self) -> Result<bool, Error> {
        #[cfg(unix)]
        {
            let active = self.active_database.lock().map_err(|_| failed())?;
            super::super::ensure_file_identity(&active.file, active.identity)?;
            Ok(active.file.metadata().map_err(|_| failed())?.len() == 0)
        }
        #[cfg(windows)]
        {
            self.verify()?;
            Ok(self.database.metadata().map_err(|_| failed())?.len() == 0)
        }
    }
    pub(super) fn initial_database_has_no_sidecars(&self) -> Result<bool, Error> {
        for name in ["business.db-wal", "business.db-shm", "business.db-journal"] {
            #[cfg(unix)]
            match rustix::fs::statat(
                &self._active_workspace,
                name,
                rustix::fs::AtFlags::SYMLINK_NOFOLLOW,
            ) {
                Err(rustix::io::Errno::NOENT) => {}
                Ok(_) => return Ok(false),
                Err(_) => return Err(rejected()),
            }
            #[cfg(windows)]
            match self.active.file(name, false, true) {
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Ok(_) => return Ok(false),
                Err(_) => return Err(rejected()),
            }
        }
        Ok(true)
    }
    pub(super) fn initial_state_key(
        &self,
        database: &[u64; 2],
    ) -> Result<Zeroizing<[u8; 32]>, Error> {
        let mut binding = Vec::with_capacity(16);
        binding.extend_from_slice(&database[0].to_be_bytes());
        binding.extend_from_slice(&database[1].to_be_bytes());
        #[cfg(unix)]
        {
            self.active_database
                .lock()
                .map_err(|_| failed())?
                .key
                .derive_initial_replica_journal_key(&binding)
                .map_err(|_| failed())
        }
        #[cfg(windows)]
        {
            self.key
                .derive_initial_replica_journal_key(&binding)
                .map_err(|_| failed())
        }
    }
    pub(super) fn initial_state_file(&self, name: &str, create: bool) -> Result<File, Error> {
        validate_name(name)?;
        #[cfg(unix)]
        {
            super::super::ensure_directory_file_identity(
                &self._active_workspace,
                self.active_workspace_identity,
            )?;
            let mut flags = rustix::fs::OFlags::RDWR
                | rustix::fs::OFlags::NOFOLLOW
                | rustix::fs::OFlags::CLOEXEC;
            if create {
                flags |= rustix::fs::OFlags::CREATE | rustix::fs::OFlags::EXCL;
            }
            let descriptor = rustix::fs::openat(
                &self._active_workspace,
                name,
                flags,
                rustix::fs::Mode::RUSR | rustix::fs::Mode::WUSR,
            )
            .map_err(|_| failed())?;
            let file = File::from(descriptor);
            super::super::validate_file_metadata(&file.metadata().map_err(|_| failed())?)?;
            super::super::ensure_named_file_identity(&self._active_workspace, name, &file)?;
            Ok(file)
        }
        #[cfg(windows)]
        {
            self.active.file(name, create, true).map_err(|_| failed())
        }
    }
    pub(super) fn initial_state_file_optional(&self, name: &str) -> Result<Option<File>, Error> {
        validate_name(name)?;
        #[cfg(unix)]
        {
            match rustix::fs::statat(
                &self._active_workspace,
                name,
                rustix::fs::AtFlags::SYMLINK_NOFOLLOW,
            ) {
                Ok(_) => self.initial_state_file(name, false).map(Some),
                Err(rustix::io::Errno::NOENT) => Ok(None),
                Err(_) => Err(rejected()),
            }
        }
        #[cfg(windows)]
        {
            match self.active.file(name, false, true) {
                Ok(file) => Ok(Some(file)),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
                Err(_) => Err(rejected()),
            }
        }
    }
    #[expect(
        clippy::unused_self,
        reason = "platform implementations share the fixed custody file-identity interface"
    )]
    pub(super) fn initial_file_identity(&self, file: &File) -> Result<[u64; 2], Error> {
        #[cfg(unix)]
        {
            let identity = super::super::file_identity(file)?;
            Ok([identity.dev, identity.ino])
        }
        #[cfg(windows)]
        {
            let identity =
                crate::windows_private_files::file_identity(file).map_err(|_| rejected())?;
            Ok([identity.volume, identity.index])
        }
    }
    pub(super) fn verify_initial_named_file(
        &self,
        name: &str,
        file: &File,
        identity: [u64; 2],
    ) -> Result<(), Error> {
        if self.initial_file_identity(file)? != identity {
            return Err(rejected());
        }
        #[cfg(unix)]
        {
            super::super::ensure_named_file_identity(&self._active_workspace, name, file)
        }
        #[cfg(windows)]
        {
            self.active.verify().map_err(|_| rejected())?;
            let current = self
                .active
                .file(name, false, true)
                .map_err(|_| rejected())?;
            if self.initial_file_identity(&current)? != identity {
                return Err(rejected());
            }
            Ok(())
        }
    }
    pub(super) fn sync_initial_directory(&self) -> Result<(), Error> {
        #[cfg(unix)]
        {
            self._active_workspace.sync_all().map_err(|_| failed())
        }
        #[cfg(windows)]
        {
            self.active.verify().map_err(|_| rejected())
        }
    }
    pub(super) fn remove_initial_file_exact(
        &self,
        name: &str,
        identity: [u64; 2],
    ) -> Result<(), Error> {
        let Some(file) = self.initial_state_file_optional(name)? else {
            return Ok(());
        };
        self.verify_initial_named_file(name, &file, identity)?;
        drop(file);
        #[cfg(unix)]
        rustix::fs::unlinkat(&self._active_workspace, name, rustix::fs::AtFlags::empty())
            .map_err(|_| failed())?;
        #[cfg(windows)]
        std::fs::remove_file(self.active.path().join(name)).map_err(|_| failed())?;
        self.sync_initial_directory()?;
        if self.initial_state_file_optional(name)?.is_some() {
            return Err(failed());
        }
        Ok(())
    }
}
