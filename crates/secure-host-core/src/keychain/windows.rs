#![allow(unsafe_code)]

use std::ffi::c_void;
use std::ptr;

use windows::Win32::Foundation::ERROR_NOT_FOUND;
use windows::Win32::Security::Credentials::{
    CRED_MAX_CREDENTIAL_BLOB_SIZE, CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC, CREDENTIALW,
    CredDeleteW, CredFree, CredReadW, CredWriteW,
};
use windows::core::{Error as WindowsError, PCWSTR, PWSTR};

use super::{OsKeychainError, PlatformTarget};

pub(super) fn replace(target: &PlatformTarget, secret: &[u8]) -> Result<(), OsKeychainError> {
    let blob_size = u32::try_from(secret.len())
        .ok()
        .filter(|size| *size <= CRED_MAX_CREDENTIAL_BLOB_SIZE)
        .ok_or_else(OsKeychainError::platform_failure)?;
    let mut target_name = nul_terminated_utf16(&target.windows_target);
    let credential = CREDENTIALW {
        Type: CRED_TYPE_GENERIC,
        TargetName: PWSTR(target_name.as_mut_ptr()),
        CredentialBlobSize: blob_size,
        CredentialBlob: secret.as_ptr().cast_mut(),
        Persist: CRED_PERSIST_LOCAL_MACHINE,
        ..Default::default()
    };

    // SAFETY: `credential` and all pointers it contains remain alive for the whole call.
    // `TargetName` is NUL-terminated, `CredentialBlobSize` is bounded by the Windows API limit,
    // and `CredWriteW` only reads the borrowed blob while atomically creating or replacing the
    // generic credential. No pointer or secret is retained by this adapter after the call.
    unsafe { CredWriteW(&credential, 0) }.map_err(|_| OsKeychainError::platform_failure())
}

pub(super) fn load(target: &PlatformTarget) -> Result<Option<Vec<u8>>, OsKeychainError> {
    let target_name = nul_terminated_utf16(&target.windows_target);
    let mut buffer = CredentialBuffer::new();

    // SAFETY: `target_name` is NUL-terminated and remains alive for the call. `buffer.out_ptr()`
    // names an initialized, writable out-pointer slot that is owned exclusively by `buffer`.
    // Any allocation written to that slot is subsequently released by `CredFree` in `Drop`.
    let read_result = unsafe {
        CredReadW(
            PCWSTR(target_name.as_ptr()),
            CRED_TYPE_GENERIC,
            None,
            buffer.out_ptr(),
        )
    };

    let result = match read_result {
        Ok(()) if buffer.pointer().is_null() => Err(OsKeychainError::platform_failure()),
        Ok(()) => {
            // SAFETY: a successful `CredReadW` returned this non-null pointer. Windows owns one
            // live `CREDENTIALW` allocation until `CredFree`; `buffer` keeps it live and uniquely
            // owned while the fixed-size fields are inspected.
            let credential = unsafe { &*buffer.pointer() };
            let blob_size = credential.CredentialBlobSize as usize;
            if credential.Type != CRED_TYPE_GENERIC
                || credential.CredentialBlobSize > CRED_MAX_CREDENTIAL_BLOB_SIZE
                || (blob_size != 0 && credential.CredentialBlob.is_null())
            {
                Err(OsKeychainError::platform_failure())
            } else if blob_size == 0 {
                Ok(Some(Vec::new()))
            } else {
                // SAFETY: the successful `CredReadW` allocation remains live in `buffer`; Windows
                // reports a non-null blob pointer with `blob_size` bytes inside that allocation.
                // The bytes are copied before the explicit `drop(buffer)` calls `CredFree`.
                let blob = unsafe {
                    std::slice::from_raw_parts(credential.CredentialBlob.cast_const(), blob_size)
                };
                Ok(Some(blob.to_vec()))
            }
        }
        Err(error) if is_not_found(&error) => Ok(None),
        Err(_) => Err(OsKeychainError::platform_failure()),
    };

    // This explicit drop is the single exit gate: `CredFree` runs before every success, not-found,
    // malformed-buffer, and platform-error return, including an unexpected error with a pointer.
    drop(buffer);
    result
}

pub(super) fn delete(target: &PlatformTarget) -> Result<(), OsKeychainError> {
    let target_name = nul_terminated_utf16(&target.windows_target);

    // SAFETY: `target_name` is a valid NUL-terminated UTF-16 string that remains alive for the
    // call. The generic credential target is the only object named, and the API returns no owned
    // allocation. A missing credential is normalized to the port's idempotent-delete semantics.
    match unsafe { CredDeleteW(PCWSTR(target_name.as_ptr()), CRED_TYPE_GENERIC, None) } {
        Ok(()) => Ok(()),
        Err(error) if is_not_found(&error) => Ok(()),
        Err(_) => Err(OsKeychainError::platform_failure()),
    }
}

fn nul_terminated_utf16(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

fn is_not_found(error: &WindowsError) -> bool {
    error.code() == ERROR_NOT_FOUND.to_hresult()
}

struct CredentialBuffer {
    pointer: *mut CREDENTIALW,
}

impl CredentialBuffer {
    const fn new() -> Self {
        Self {
            pointer: ptr::null_mut(),
        }
    }

    fn out_ptr(&mut self) -> *mut *mut CREDENTIALW {
        &mut self.pointer
    }

    const fn pointer(&self) -> *mut CREDENTIALW {
        self.pointer
    }
}

impl Drop for CredentialBuffer {
    fn drop(&mut self) {
        if !self.pointer.is_null() {
            // SAFETY: only `CredReadW` can populate `pointer`; `CredentialBuffer` uniquely owns
            // that returned allocation, never exposes ownership, and calls `CredFree` exactly once.
            unsafe { CredFree(self.pointer.cast::<c_void>()) };
            self.pointer = ptr::null_mut();
        }
    }
}

#[cfg(test)]
mod tests {
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::{delete, load, replace};
    use crate::AccountSessionKeychainScope;
    use crate::keychain::{KeychainNamespaceClass, PlatformTarget, derive_target};

    struct DisposableCredential {
        target: PlatformTarget,
    }

    impl DisposableCredential {
        fn new(target: PlatformTarget) -> Self {
            let _ = delete(&target);
            Self { target }
        }
    }

    impl Drop for DisposableCredential {
        fn drop(&mut self) {
            let _ = delete(&self.target);
        }
    }

    #[test]
    fn native_credential_obeys_replace_load_delete_and_namespace_contract() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock after epoch")
            .as_nanos();
        let account_id = format!("account-native-{}-{nonce}", std::process::id());
        let scope = AccountSessionKeychainScope {
            account_id: &account_id,
            device_id: "device-native-test",
        };
        let account_target =
            derive_target(KeychainNamespaceClass::AccountSession, scope).expect("valid target");
        let provider_target = derive_target(KeychainNamespaceClass::ProviderConnection, scope)
            .expect("valid provider target");
        let disposable = DisposableCredential::new(account_target);

        assert!(load(&disposable.target).expect("initial load").is_none());
        delete(&disposable.target).expect("missing delete succeeds");

        replace(&disposable.target, b"first-secret").expect("first atomic write");
        assert_eq!(
            load(&disposable.target).expect("load first secret"),
            Some(b"first-secret".to_vec())
        );
        assert!(load(&provider_target).expect("isolated load").is_none());

        replace(&disposable.target, b"rotated-secret").expect("atomic replacement");
        assert_eq!(
            load(&disposable.target).expect("load rotated secret"),
            Some(b"rotated-secret".to_vec())
        );

        delete(&disposable.target).expect("first delete");
        delete(&disposable.target).expect("idempotent delete");
        assert!(load(&disposable.target).expect("deleted load").is_none());
    }
}
