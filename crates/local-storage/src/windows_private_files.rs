//! Handle-pinned Windows files for Native custody. No caller-selected public file API.

use std::fs::{File, OpenOptions};
use std::io;
use std::os::windows::fs::{MetadataExt as _, OpenOptionsExt as _};
use std::path::{Component, Path, PathBuf, Prefix};

use windows_permissions::constants::{SeObjectType, SecurityInformation};
use windows_permissions::{LocalBox, SecurityDescriptor, wrappers};

const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
const READ_CONTROL: u32 = 0x0002_0000;
const FILE_READ_ATTRIBUTES: u32 = 0x80;
const SHARE_READ_WRITE: u32 = 3;

use crate::windows_custody::format::FileIdentity;
#[path = "windows_private_files/protected_acl.rs"]
mod protected_acl;
#[path = "windows_private_files/sidecar_acl.rs"]
mod sidecar_acl;

pub(crate) struct PinnedDirectory {
    path: PathBuf,
    // No FILE_SHARE_DELETE: neither this directory nor an ancestor can be replaced while live.
    ancestors: Vec<File>,
    identity: FileIdentity,
}

fn rejected() -> io::Error {
    io::Error::from(io::ErrorKind::PermissionDenied)
}

impl PinnedDirectory {
    pub(crate) fn native_custody() -> io::Result<Self> {
        let local = dirs::data_local_dir().ok_or_else(rejected)?;
        Self::open(&local.join("GoodDealer").join("native-custody-v1"))
    }

    pub(crate) fn open(path: &Path) -> io::Result<Self> {
        let local = dirs::data_local_dir().ok_or_else(rejected)?;
        if path == local
            || !path.starts_with(&local)
            || !path.is_absolute()
            || path
                .components()
                .any(|p| matches!(p, Component::ParentDir | Component::CurDir))
            || !matches!(path.components().next(),Some(Component::Prefix(p)) if matches!(p.kind(),Prefix::Disk(_)))
        {
            return Err(rejected());
        }
        let mut current = PathBuf::new();
        let mut ancestors = Vec::new();
        for component in path.components() {
            current.push(component.as_os_str());
            if matches!(component, Component::Prefix(_)) {
                continue;
            }
            if !current.exists() {
                let parent = ancestors.last().ok_or_else(rejected)?;
                // Creation is allowed only below the known folder, whose inherited ACL is checked
                // before creating any object. Every new object is protected in its creation syscall.
                if !current.starts_with(&local) || current == local {
                    return Err(rejected());
                }
                validate_parent(parent)?;
                create_private_object(&current, true)?;
            }
            let handle = open_directory(&current)?;
            validate_kind(&handle, true)?;
            if current.starts_with(&local) {
                validate_parent(&handle)?;
            }
            ancestors.push(handle);
        }
        let final_handle = ancestors.last().ok_or_else(rejected)?;
        validate_private(final_handle, true)?;
        let identity = file_identity(final_handle)?;
        let result = Self {
            path: path.to_owned(),
            ancestors,
            identity,
        };
        result.verify()?;
        Ok(result)
    }

    pub(crate) fn verify_business_sidecars(&self) -> io::Result<()> {
        self.verify_sqlite_files(&["business.db-wal", "business.db-shm", "business.db-journal"])
    }
    fn verify_sqlite_files(&self, names: &[&str]) -> io::Result<()> {
        self.verify()?;
        for name in names {
            // SQLite owns creation/deletion. A temporary share-delete handle inspects each
            // existing sidecar without blocking checkpoint/close or pre-creating empty WALs.
            let file = match OpenOptions::new()
                .read(true)
                .share_mode(7)
                .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
                .open(self.path.join(name))
            {
                Ok(file) => file,
                Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
                Err(error) => return Err(error),
            };
            validate_kind(&file, false)?;
            let owner = windows_permissions::utilities::current_process_sid()?;
            let actual = descriptor(&file)?;
            if actual.owner() != Some(&*owner)
                || !sidecar_acl::is_private_inherited_file(
                    &dacl_string(&actual)?,
                    &owner.to_string(),
                )
            {
                return Err(rejected());
            }
        }
        self.verify()
    }

    pub(crate) fn directory(&self) -> io::Result<File> {
        self.verify()?;
        self.ancestors.last().ok_or_else(rejected)?.try_clone()
    }
    pub(crate) fn path(&self) -> &Path {
        &self.path
    }
    pub(crate) fn identity(&self) -> FileIdentity {
        self.identity
    }
    pub(crate) fn verify(&self) -> io::Result<()> {
        let directory = self.ancestors.last().ok_or_else(rejected)?;
        validate_kind(directory, true)?;
        validate_private(directory, true)?;
        if file_identity(directory)? != self.identity {
            return Err(rejected());
        }
        let current = open_directory(&self.path)?;
        if file_identity(&current)? != self.identity {
            return Err(rejected());
        }
        Ok(())
    }
    pub(crate) fn file(&self, name: &str, create_new: bool, write: bool) -> io::Result<File> {
        if matches!(name, "." | "..")
            || name.is_empty()
            || name.len() > 100
            || !name
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.'))
        {
            return Err(rejected());
        }
        self.verify()?;
        let created = if create_new {
            create_private_object(&self.path.join(name), false)?
        } else {
            None
        };
        let mut options = OpenOptions::new();
        options
            .read(true)
            .write(write)
            .share_mode(SHARE_READ_WRITE)
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
        let file = options.open(self.path.join(name))?;
        validate_kind(&file, false)?;
        validate_private(&file, false)?;
        if let Some(created) = created {
            let info = created
                .GetFileInformationByHandle()
                .map_err(windows_error)?;
            let expected = FileIdentity {
                volume: u64::from(info.dwVolumeSerialNumber),
                index: info.nFileIndex(),
            };
            if file_identity(&file)? != expected {
                return Err(rejected());
            }
        }
        self.verify()?;
        Ok(file)
    }
}

pub(crate) struct PrivateSnapshotDirectory {
    pin: Option<PinnedDirectory>,
    path: PathBuf,
}
impl PrivateSnapshotDirectory {
    pub(crate) fn create() -> io::Result<Self> {
        use std::fmt::Write as _;
        let local = dirs::data_local_dir().ok_or_else(rejected)?;
        let parent = PinnedDirectory::open(&local.join("GoodDealer").join("private-snapshots-v1"))?;
        let mut random = [0_u8; 16];
        getrandom::fill(&mut random).map_err(|_| rejected())?;
        let mut name = String::with_capacity(32);
        for byte in random {
            write!(&mut name, "{byte:02x}").map_err(|_| rejected())?;
        }
        let path = parent.path().join(name);
        // No user-selected path and no reusing a prior snapshot incarnation.
        create_private_object(&path, true)?;
        let pin = PinnedDirectory::open(&path)?;
        Ok(Self {
            pin: Some(pin),
            path,
        })
    }
    pub(crate) fn path(&self) -> &Path {
        &self.path
    }
    pub(crate) fn verify(&self) -> io::Result<()> {
        self.pin
            .as_ref()
            .ok_or_else(rejected)?
            .verify_sqlite_files(&[
                "active-workspace.snapshot.db",
                "active-workspace.snapshot.db-wal",
                "active-workspace.snapshot.db-shm",
                "active-workspace.snapshot.db-journal",
            ])
    }
    pub(crate) fn close(mut self) -> io::Result<()> {
        self.verify()?;
        self.pin.take();
        std::fs::remove_dir_all(&self.path)?;
        if self.path.try_exists()? {
            return Err(rejected());
        }
        Ok(())
    }
}
impl Drop for PrivateSnapshotDirectory {
    fn drop(&mut self) {
        self.pin.take();
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

fn windows_error(error: winsafe::co::ERROR) -> io::Error {
    io::Error::from_raw_os_error(i32::try_from(error.raw()).unwrap_or(5))
}
fn create_private_object(
    path: &Path,
    directory: bool,
) -> io::Result<Option<winsafe::guard::CloseHandleGuard<winsafe::HFILE>>> {
    use winsafe::{HFILE, SECURITY_ATTRIBUTES, SECURITY_DESCRIPTOR, co};
    let owner = windows_permissions::utilities::current_process_sid()?;
    let descriptor = desired(directory)?;
    let acl = descriptor.dacl().ok_or_else(rejected)?;
    // Both libraries represent the OS SID/ACL layout. These pointers are borrowed only for
    // synchronous Create* calls: the LocalBoxes remain live, Windows copies the descriptor,
    // and no raw reference is dereferenced, returned, stored or sent to another thread.
    // This is an absolute descriptor; SELF_RELATIVE must never be set.
    let mut security = SECURITY_DESCRIPTOR {
        Revision: 1,
        Sbz1: 0,
        Control: co::SE::DACL_PRESENT | co::SE::DACL_PROTECTED,
        Owner: std::ptr::from_ref(&*owner).cast_mut().cast(),
        Group: std::ptr::null_mut(),
        Sacl: std::ptr::null_mut(),
        Dacl: std::ptr::from_ref(acl).cast_mut().cast(),
    };
    let mut attributes = SECURITY_ATTRIBUTES::default();
    attributes.set_lpSecurityDescriptor(Some(&mut security));
    let path = path.to_str().ok_or_else(rejected)?;
    if directory {
        winsafe::CreateDirectory(path, Some(&attributes)).map_err(windows_error)?;
        Ok(None)
    } else {
        let (handle, _) = HFILE::CreateFile(
            path,
            co::GENERIC::READ | co::GENERIC::WRITE,
            Some(co::FILE_SHARE::READ | co::FILE_SHARE::WRITE),
            Some(&attributes),
            co::DISPOSITION::CREATE_NEW,
            co::FILE_ATTRIBUTE::NORMAL,
            Some(co::FILE_FLAG::OPEN_REPARSE_POINT),
            None,
            None,
        )
        .map_err(windows_error)?;
        Ok(Some(handle))
    }
}

fn open_directory(path: &Path) -> io::Result<File> {
    OpenOptions::new()
        .access_mode(FILE_READ_ATTRIBUTES | READ_CONTROL)
        .share_mode(SHARE_READ_WRITE)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS)
        .open(path)
}

pub(crate) fn file_identity(file: &File) -> io::Result<FileIdentity> {
    let info = winapi_util::file::information(file)?;
    if info.file_index() == 0 || info.volume_serial_number() == 0 {
        return Err(rejected());
    }
    Ok(FileIdentity {
        volume: info.volume_serial_number(),
        index: info.file_index(),
    })
}
fn validate_kind(file: &File, directory: bool) -> io::Result<()> {
    let metadata = file.metadata()?;
    if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
        || metadata.is_dir() != directory
        || (!directory
            && (!metadata.is_file()
                || winapi_util::file::information(file)?.number_of_links() != 1))
    {
        return Err(rejected());
    }
    Ok(())
}
fn descriptor(file: &File) -> io::Result<LocalBox<SecurityDescriptor>> {
    wrappers::GetSecurityInfo(
        file,
        SeObjectType::SE_FILE_OBJECT,
        SecurityInformation::Owner | SecurityInformation::Dacl,
    )
}
fn dacl_string(descriptor: &SecurityDescriptor) -> io::Result<String> {
    wrappers::ConvertSecurityDescriptorToStringSecurityDescriptor(
        descriptor,
        SecurityInformation::Dacl,
    )?
    .into_string()
    .map_err(|_| rejected())
}
fn desired(directory: bool) -> io::Result<LocalBox<SecurityDescriptor>> {
    let owner = windows_permissions::utilities::current_process_sid()?;
    let inheritance = if directory { "OICI" } else { "" };
    format!("D:P(A;{inheritance};FA;;;{owner})").parse()
}
fn validate_private(file: &File, directory: bool) -> io::Result<()> {
    let owner = windows_permissions::utilities::current_process_sid()?;
    let actual = descriptor(file)?;
    // Compare OS-normalized, closed SDDL. This rejects NULL/unprotected ACLs, unknown ACE kinds,
    // inherited entries and additional principals without invoking unsafe raw ACE inspection.
    if actual.owner() != Some(&*owner)
        || !protected_acl::is_private_protected_acl(
            &dacl_string(&actual)?,
            &owner.to_string(),
            directory,
        )
    {
        return Err(rejected());
    }
    Ok(())
}
fn validate_parent(file: &File) -> io::Result<()> {
    let owner = windows_permissions::utilities::current_process_sid()?;
    let actual = descriptor(file)?;
    if actual.owner() != Some(&*owner) {
        return Err(rejected());
    }
    let dacl = dacl_string(&actual)?;
    let (_, entries) = dacl.split_once('(').ok_or_else(rejected)?;
    let own = owner.to_string();
    for entry in entries.trim_end_matches(')').split(")(") {
        let fields = entry.split(';').collect::<Vec<_>>();
        // OS/system administrators already control this trust domain. No other principal may
        // receive access to the parent where the private directory is established.
        if fields.len() != 6
            || fields[0] != "A"
            || !fields[3].is_empty()
            || !fields[4].is_empty()
            || !matches!(fields[5], "SY" | "BA") && fields[5] != own
        {
            return Err(rejected());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fmt::Write as _;
    #[test]
    fn atomic_private_creation_survives_restart_before_any_content_write() {
        let snapshot = PrivateSnapshotDirectory::create().unwrap();
        let directory_path = snapshot.path().join("initializing");
        create_private_object(&directory_path, true).unwrap();
        // Simulate a crash immediately after the OS has created the object. No subsequent
        // SetSecurityInfo/protection step exists or is necessary for restart admission.
        let directory = PinnedDirectory::open(&directory_path).unwrap();
        let file_path = directory_path.join("initializing.marker");
        drop(create_private_object(&file_path, false).unwrap());
        let file = directory.file("initializing.marker", false, true).unwrap();
        assert_eq!(file.metadata().unwrap().len(), 0);
        drop(file);
        drop(directory);
        snapshot.close().unwrap();
    }
    #[test]
    fn private_snapshot_keeps_sqlite_files_admitted_until_explicit_cleanup() {
        let snapshot = PrivateSnapshotDirectory::create().unwrap();
        let path = snapshot.path().to_owned();
        std::fs::write(
            path.join("active-workspace.snapshot.db"),
            b"encrypted-fixture",
        )
        .unwrap();
        std::fs::write(
            path.join("active-workspace.snapshot.db-journal"),
            b"encrypted-journal",
        )
        .unwrap();
        snapshot.verify().unwrap();
        snapshot.close().unwrap();
        assert!(!path.exists());
    }
    #[test]
    fn sqlite_created_sidecar_inherits_private_acl_and_rejects_hardlinks_or_extra_principals() {
        let mut nonce = [0_u8; 16];
        getrandom::fill(&mut nonce).unwrap();
        let mut name = String::with_capacity(32);
        for byte in nonce {
            write!(&mut name, "{byte:02x}").unwrap();
        }
        let path = dirs::data_local_dir()
            .unwrap()
            .join("GoodDealer")
            .join(format!("custody-sidecar-test-{name}"));
        let root = PinnedDirectory::open(&path).unwrap();
        let wal = path.join("business.db-wal");
        // Use normal OS creation exactly as SQLite does; Native does not pre-protect a sidecar.
        std::fs::write(&wal, [1_u8; 16]).unwrap();
        root.verify_business_sidecars().unwrap();
        let link = path.join("unexpected-hardlink");
        std::fs::hard_link(&wal, &link).unwrap();
        assert!(root.verify_business_sidecars().is_err());
        std::fs::remove_file(&link).unwrap();
        root.verify_business_sidecars().unwrap();
        let owner = windows_permissions::utilities::current_process_sid().unwrap();
        let changed: LocalBox<SecurityDescriptor> =
            format!("D:P(A;;FA;;;{owner})(A;;FA;;;SY)").parse().unwrap();
        let mut file = OpenOptions::new()
            .access_mode(READ_CONTROL | 0x0004_0000)
            .share_mode(7)
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
            .open(&wal)
            .unwrap();
        wrappers::SetSecurityInfo(
            &mut file,
            SeObjectType::SE_FILE_OBJECT,
            SecurityInformation::Dacl | SecurityInformation::ProtectedDacl,
            None,
            None,
            changed.dacl(),
            None,
        )
        .unwrap();
        assert!(root.verify_business_sidecars().is_err());
        drop(file);
        drop(root);
        std::fs::remove_dir_all(path).unwrap();
    }
}
