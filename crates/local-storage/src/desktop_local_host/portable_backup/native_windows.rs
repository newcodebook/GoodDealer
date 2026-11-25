//! Windows admission for user-selected portable backup files.
use std::fs::{File, OpenOptions};
use std::io::{Read, Write};
use std::os::windows::fs::{MetadataExt, OpenOptionsExt};
use std::path::{Component, Path, PathBuf, Prefix};

use zeroize::Zeroizing;

use super::codec::{MAX_PROJECTION_LEN, PortableArtifactRejected, artifact_len};
use crate::windows_private_files::{
    admit_portable_file, create_portable_file, file_identity, pin_portable_parent,
};

#[derive(Debug, PartialEq, Eq)]
pub(super) enum Publication {
    Durable,
    OutcomeUnknown,
}

pub(super) struct SelectedPath {
    path: PathBuf,
    ancestors: Vec<File>,
}

impl SelectedPath {
    pub(super) fn admit(path: &Path) -> Result<Self, PortableArtifactRejected> {
        if !path.is_absolute()
            || !matches!(path.components().next(),Some(Component::Prefix(p)) if matches!(p.kind(),Prefix::Disk(_)))
            || path.components().any(|component| match component {
                Component::Normal(name) => name
                    .to_str()
                    .is_none_or(|value| value.contains([':', '\0']) || value.ends_with(['.', ' '])),
                Component::ParentDir | Component::CurDir => true,
                _ => false,
            })
            || path.file_name().is_none()
        {
            return Err(PortableArtifactRejected);
        }
        let parent = path.parent().ok_or(PortableArtifactRejected)?;
        let ancestors = pin_portable_parent(parent).map_err(|_| PortableArtifactRejected)?;
        Ok(Self {
            path: path.to_owned(),
            ancestors,
        })
    }

    pub(super) fn same_destination(&self, other: &Self) -> Result<bool, PortableArtifactRejected> {
        let identity = |selection: &Self| {
            file_identity(selection.ancestors.last().ok_or(PortableArtifactRejected)?)
                .map_err(|_| PortableArtifactRejected)
        };
        let name = |selection: &Self| {
            selection
                .path
                .file_name()
                .and_then(|name| name.to_str())
                .map(str::to_lowercase)
                .ok_or(PortableArtifactRejected)
        };
        Ok(identity(self)? == identity(other)? && name(self)? == name(other)?)
    }

    pub(super) fn read_artifact(&self) -> Result<Zeroizing<Vec<u8>>, PortableArtifactRejected> {
        self.read_bounded(artifact_len(MAX_PROJECTION_LEN))
    }

    pub(super) fn read_bounded(
        &self,
        max: usize,
    ) -> Result<Zeroizing<Vec<u8>>, PortableArtifactRejected> {
        // Sharing read only pins the selected name and denies writes while consuming it.
        let mut file = OpenOptions::new()
            .read(true)
            .share_mode(1)
            .custom_flags(0x0020_0000)
            .open(&self.path)
            .map_err(|_| PortableArtifactRejected)?;
        admit_portable_file(&file).map_err(|_| PortableArtifactRejected)?;
        let before = file.metadata().map_err(|_| PortableArtifactRejected)?;
        let len = usize::try_from(before.len()).map_err(|_| PortableArtifactRejected)?;
        if !(1..=max).contains(&len) {
            return Err(PortableArtifactRejected);
        }
        let mut bytes = Zeroizing::new(vec![0; len]);
        file.read_exact(&mut bytes)
            .map_err(|_| PortableArtifactRejected)?;
        let mut extra = Zeroizing::new([0]);
        let after = file.metadata().map_err(|_| PortableArtifactRejected)?;
        if file
            .read(extra.as_mut())
            .map_err(|_| PortableArtifactRejected)?
            != 0
            || before.len() != after.len()
            || before.last_write_time() != after.last_write_time()
        {
            return Err(PortableArtifactRejected);
        }
        admit_portable_file(&file).map_err(|_| PortableArtifactRejected)?;
        Ok(bytes)
    }

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
        let mut random = [0; 16];
        getrandom::fill(&mut random).map_err(|_| PortableArtifactRejected)?;
        let mut name = String::from(".gooddealer-backup-");
        for byte in random {
            use std::fmt::Write as _;
            write!(name, "{byte:02x}").map_err(|_| PortableArtifactRejected)?;
        }
        let temporary = self.path.with_file_name(name);
        let source = temporary.to_str().ok_or(PortableArtifactRejected)?;
        let destination = self.path.to_str().ok_or(PortableArtifactRejected)?;
        let mut file = create_portable_file(&temporary).map_err(|_| PortableArtifactRejected)?;
        let staged = (|| {
            let mut bounded = super::BoundedOutput::new(&mut file);
            write(&mut bounded)?;
            let written = bounded.written() as u64;
            file.sync_all().map_err(|_| PortableArtifactRejected)?;
            admit_portable_file(&file).map_err(|_| PortableArtifactRejected)?;
            if written == 0
                || file.metadata().map_err(|_| PortableArtifactRejected)?.len() != written
            {
                return Err(PortableArtifactRejected);
            }
            let identity = file_identity(&file).map_err(|_| PortableArtifactRejected)?;
            final_check()?;
            winsafe::MoveFileEx(
                source,
                Some(destination),
                winsafe::co::MOVEFILE::WRITE_THROUGH,
            )
            .map_err(|_| PortableArtifactRejected)?;
            Ok(identity)
        })();
        drop(file);
        let Ok(identity) = staged else {
            let _ = std::fs::remove_file(temporary);
            return Err(PortableArtifactRejected);
        };
        let verified = OpenOptions::new()
            .read(true)
            .share_mode(1)
            .custom_flags(0x0020_0000)
            .open(&self.path)
            .and_then(|published| {
                admit_portable_file(&published)?;
                file_identity(&published)
            })
            .is_ok_and(|published| published == identity);
        Ok(if verified {
            Publication::Durable
        } else {
            Publication::OutcomeUnknown
        })
    }
}
