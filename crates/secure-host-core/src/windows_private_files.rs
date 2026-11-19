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
