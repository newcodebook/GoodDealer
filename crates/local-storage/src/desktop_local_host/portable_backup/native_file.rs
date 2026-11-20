//! Unix admission for an already selected native path. A retained parent descriptor anchors
//! every operation. The UI receives neither the path nor an artifact handle.
use std::{
    ffi::{OsStr, OsString},
    fs::File,
    io::{Read, Write},
    os::unix::fs::MetadataExt,
    path::{Component, Path},
};

use rustix::fs::{self, AtFlags, Mode, OFlags, RenameFlags};

use super::codec::{MAX_PROJECTION_LEN, PortableArtifactRejected, artifact_len};
use zeroize::Zeroizing;

#[derive(Debug, PartialEq, Eq)]
pub(super) enum Publication {
    Durable,
    OutcomeUnknown,
}

pub(super) struct SelectedPath {
    parent: File,
    name: OsString,
}

impl SelectedPath {
    pub(super) fn admit(absolute: &Path) -> Result<Self, PortableArtifactRejected> {
        let mut parts = absolute.components().peekable();
        if parts.next() != Some(Component::RootDir) {
            return Err(PortableArtifactRejected);
        }
        let flags = OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC;
        let mut parent =
            File::from(fs::open("/", flags, Mode::empty()).map_err(|_| PortableArtifactRejected)?);
        while let Some(part) = parts.next() {
            let Component::Normal(name) = part else {
                return Err(PortableArtifactRejected);
            };
            if parts.peek().is_none() {
                return Ok(Self {
                    parent,
                    name: name.to_owned(),
                });
            }
            parent = File::from(
                fs::openat(&parent, name, flags, Mode::empty())
                    .map_err(|_| PortableArtifactRejected)?,
            );
        }
        Err(PortableArtifactRejected)
    }

    pub(super) fn same_destination(&self, other: &Self) -> Result<bool, PortableArtifactRejected> {
        let a = self
            .parent
            .metadata()
            .map_err(|_| PortableArtifactRejected)?;
        let b = other
            .parent
            .metadata()
            .map_err(|_| PortableArtifactRejected)?;
        Ok(self.name == other.name && a.dev() == b.dev() && a.ino() == b.ino())
    }

    pub(super) fn read_artifact(&self) -> Result<Zeroizing<Vec<u8>>, PortableArtifactRejected> {
        self.read_bounded(artifact_len(MAX_PROJECTION_LEN))
    }

    pub(super) fn read_bounded(
        &self,
        max: usize,
    ) -> Result<Zeroizing<Vec<u8>>, PortableArtifactRejected> {
        let flags = OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC;
        let file = File::from(
            fs::openat(&self.parent, &self.name, flags, Mode::empty())
                .map_err(|_| PortableArtifactRejected)?,
        );
        let before = Identity::read(&file)?;
        if before.len == 0 || before.len > max as u64 {
            return Err(PortableArtifactRejected);
        }
        self.check_entry(&self.name, before)?;
        let len = usize::try_from(before.len).map_err(|_| PortableArtifactRejected)?;
        let mut bytes = Zeroizing::new(vec![0; len]);
        let mut stream = &file;
        stream
            .read_exact(&mut bytes)
            .map_err(|_| PortableArtifactRejected)?;
        let mut extra = Zeroizing::new([0]);
        if stream
            .read(extra.as_mut())
            .map_err(|_| PortableArtifactRejected)?
            != 0
            || Identity::read(&file)? != before
        {
            return Err(PortableArtifactRejected);
        }
        self.check_entry(&self.name, before)?;
        Ok(bytes)
    }

    // Output ciphertext can reach the requested name only after a complete file sync and a
    // final authority check. RENAME_NOREPLACE preserves existing files on collision.
    pub(super) fn publish(
        &self,
        bytes: &[u8],
        final_check: impl FnOnce() -> Result<(), PortableArtifactRejected>,
    ) -> Result<Publication, PortableArtifactRejected> {
        self.publish_with(
            |writer| {
                writer
                    .write_all(bytes)
                    .map_err(|_| PortableArtifactRejected)
            },
            final_check,
        )
    }

    pub(super) fn publish_with(
        &self,
        write: impl FnOnce(&mut dyn Write) -> Result<(), PortableArtifactRejected>,
        final_check: impl FnOnce() -> Result<(), PortableArtifactRejected>,
    ) -> Result<Publication, PortableArtifactRejected> {
        let parent = self
            .parent
            .metadata()
            .map_err(|_| PortableArtifactRejected)?;
        if parent.uid() != rustix::process::geteuid().as_raw() || parent.mode() & 0o022 != 0 {
            return Err(PortableArtifactRejected);
        }
        let mut random = [0; 16];
        getrandom::fill(&mut random).map_err(|_| PortableArtifactRejected)?;
        let mut temp_name = String::from(".gooddealer-backup-");
        for byte in random {
            use std::fmt::Write as _;
            write!(temp_name, "{byte:02x}").map_err(|_| PortableArtifactRejected)?;
        }
        let temporary = OsStr::new(&temp_name);
        let flags =
            OFlags::WRONLY | OFlags::CREATE | OFlags::EXCL | OFlags::NOFOLLOW | OFlags::CLOEXEC;
        let mut file = File::from(
            fs::openat(&self.parent, temporary, flags, Mode::RUSR | Mode::WUSR)
                .map_err(|_| PortableArtifactRejected)?,
        );
        let result = (|| {
            let mut bounded = super::BoundedOutput::new(&mut file);
            write(&mut bounded)?;
            let written = bounded.written();
            file.sync_all().map_err(|_| PortableArtifactRejected)?;
            let staged = Identity::read(&file)?;
            if staged.len == 0 || staged.len != written as u64 {
                return Err(PortableArtifactRejected);
            }
            self.check_entry(temporary, staged)?;
            final_check()?;
            fs::renameat_with(
                &self.parent,
                temporary,
                &self.parent,
                &self.name,
                RenameFlags::NOREPLACE,
            )
            .map_err(|_| PortableArtifactRejected)?;
            Ok(())
        })();
        if result.is_err() {
            let _ = fs::unlinkat(&self.parent, temporary, AtFlags::empty());
            return Err(PortableArtifactRejected);
        }
        // The final name already exists. A later error can leave a complete file on disk;
        // surface uncertainty and keep it available for independent authentication.
        if Identity::read(&file)
            .and_then(|identity| self.check_entry(&self.name, identity))
            .is_err()
            || self.parent.sync_all().is_err()
        {
            return Ok(Publication::OutcomeUnknown);
        }
        Ok(Publication::Durable)
    }

    fn check_entry(
        &self,
        name: &OsStr,
        expected: Identity,
    ) -> Result<(), PortableArtifactRejected> {
        let named = fs::statat(&self.parent, name, AtFlags::SYMLINK_NOFOLLOW)
            .map_err(|_| PortableArtifactRejected)?;
        #[cfg(target_os = "linux")]
        let (device, mode) = (named.st_dev, named.st_mode);
        #[cfg(target_os = "macos")]
        let (device, mode) = (
            u64::try_from(named.st_dev).map_err(|_| PortableArtifactRejected)?,
            u32::from(named.st_mode),
        );
        if device == expected.device
            && named.st_ino == expected.inode
            && named.st_nlink == 1
            && mode == expected.mode
            && named.st_uid == expected.uid
            && u64::try_from(named.st_size).ok() == Some(expected.len)
        {
            return Ok(());
        }
        Err(PortableArtifactRejected)
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
struct Identity {
    device: u64,
    inode: u64,
    mode: u32,
    uid: u32,
    len: u64,
    modified: (i64, i64),
    changed: (i64, i64),
}

impl Identity {
    fn read(file: &File) -> Result<Self, PortableArtifactRejected> {
        let metadata = file.metadata().map_err(|_| PortableArtifactRejected)?;
        if !metadata.is_file()
            || metadata.nlink() != 1
            || metadata.uid() != rustix::process::geteuid().as_raw()
            || metadata.mode() & 0o022 != 0
        {
            return Err(PortableArtifactRejected);
        }
        Ok(Self {
            device: metadata.dev(),
            inode: metadata.ino(),
            mode: metadata.mode(),
            uid: metadata.uid(),
            len: metadata.len(),
            modified: (metadata.mtime(), metadata.mtime_nsec()),
            changed: (metadata.ctime(), metadata.ctime_nsec()),
        })
    }
}

#[cfg(test)]
mod tests {
    use std::os::unix::fs::symlink;

    use super::*;

    #[test]
    fn rejects_symlinks_and_hard_links_and_never_overwrites_existing_file() {
        let directory = crate::test_tempdir::tempdir().unwrap();
        let first = directory.path().join("selected.gdbk");
        let selected = SelectedPath::admit(&first).unwrap();
        assert_eq!(
            selected.publish(b"ciphertext", || Ok(())),
            Ok(Publication::Durable),
        );
        assert_eq!(selected.read_artifact().unwrap().as_slice(), b"ciphertext");
        assert!(selected.publish(b"other", || Ok(())).is_err());
        assert_eq!(selected.read_artifact().unwrap().as_slice(), b"ciphertext");
        let alias = directory.path().join("alias");
        symlink(&first, &alias).unwrap();
        assert!(
            SelectedPath::admit(&alias)
                .unwrap()
                .read_artifact()
                .is_err()
        );
        std::fs::remove_file(&alias).unwrap();
        std::fs::hard_link(&first, &alias).unwrap();
        assert!(selected.read_artifact().is_err());
    }

    #[test]
    fn final_authority_failure_removes_staged_artifact() {
        let directory = crate::test_tempdir::tempdir().unwrap();
        let selected = SelectedPath::admit(&directory.path().join("selected.gdbk")).unwrap();
        assert!(
            selected
                .publish(b"ciphertext", || Err(PortableArtifactRejected))
                .is_err()
        );
        assert_eq!(directory.path().read_dir().unwrap().count(), 0);
    }
}
