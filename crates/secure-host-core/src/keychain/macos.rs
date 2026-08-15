use security_framework::item::{ItemClass, ItemSearchOptions, SearchResult};
use security_framework::os::macos::keychain::SecKeychain;

use super::{OsKeychainError, PlatformTarget};

// Security.framework's stable status for an absent item. We inspect only the numeric status and
// deliberately discard the framework error text so it cannot become an accidental log surface.
const ERR_SEC_ITEM_NOT_FOUND: i32 = -25_300;

pub(super) fn replace(target: &PlatformTarget, secret: &[u8]) -> Result<(), OsKeychainError> {
    // `set_generic_password` performs one mutating operation: an in-place item update when the
    // item exists, or an add when it does not. Any transient item/password wrappers remain inside
    // security-framework and are dropped before this function returns.
    let keychain = SecKeychain::default().map_err(|_| OsKeychainError::platform_failure())?;
    replace_in(&keychain, target, secret)
}

pub(super) fn load(target: &PlatformTarget) -> Result<Option<Vec<u8>>, OsKeychainError> {
    let keychain = SecKeychain::default().map_err(|_| OsKeychainError::platform_failure())?;
    load_in(&keychain, target)
}

pub(super) fn delete(target: &PlatformTarget) -> Result<(), OsKeychainError> {
    let keychain = SecKeychain::default().map_err(|_| OsKeychainError::platform_failure())?;
    delete_in(&keychain, target)
}

fn replace_in(
    keychain: &SecKeychain,
    target: &PlatformTarget,
    secret: &[u8],
) -> Result<(), OsKeychainError> {
    keychain
        .set_generic_password(&target.service, &target.macos_account, secret)
        .map_err(|_| OsKeychainError::platform_failure())
}

fn load_in(
    keychain: &SecKeychain,
    target: &PlatformTarget,
) -> Result<Option<Vec<u8>>, OsKeychainError> {
    let mut search = search_options(keychain, target);
    search.load_data(true);
    match search.search() {
        Ok(mut results) => match (results.pop(), results.is_empty()) {
            (Some(SearchResult::Data(bytes)), true) => Ok(Some(bytes)),
            _ => Err(OsKeychainError::platform_failure()),
        },
        Err(error) if error.code() == ERR_SEC_ITEM_NOT_FOUND => Ok(None),
        Err(_) => Err(OsKeychainError::platform_failure()),
    }
}

fn delete_in(keychain: &SecKeychain, target: &PlatformTarget) -> Result<(), OsKeychainError> {
    match search_options(keychain, target).delete() {
        Ok(()) => Ok(()),
        Err(error) if error.code() == ERR_SEC_ITEM_NOT_FOUND => Ok(()),
        Err(_) => Err(OsKeychainError::platform_failure()),
    }
}

fn search_options(keychain: &SecKeychain, target: &PlatformTarget) -> ItemSearchOptions {
    let mut search = ItemSearchOptions::new();
    search
        .keychains(std::slice::from_ref(keychain))
        .class(ItemClass::generic_password())
        .service(&target.service)
        .account(&target.macos_account)
        .limit(1);
    search
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    use security_framework::os::macos::keychain::{CreateOptions, SecKeychain};

    use super::{delete_in, load_in, replace_in};
    use crate::AccountSessionKeychainScope;
    use crate::keychain::{KeychainNamespaceClass, derive_target};

    struct DisposableKeychain {
        keychain: Option<SecKeychain>,
        directory: PathBuf,
    }

    impl DisposableKeychain {
        fn create() -> Self {
            let nonce = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock after epoch")
                .as_nanos();
            let directory = std::env::temp_dir().join(format!(
                "gooddealer-keychain-test-{}-{nonce}",
                std::process::id()
            ));
            std::fs::create_dir(&directory).expect("create disposable keychain directory");
            let keychain = CreateOptions::new()
                .password("gooddealer-disposable-test-keychain")
                .create(directory.join("test.keychain"))
                .expect("create disposable keychain");
            Self {
                keychain: Some(keychain),
                directory,
            }
        }

        fn keychain(&self) -> &SecKeychain {
            self.keychain.as_ref().expect("keychain remains available")
        }
    }

    impl Drop for DisposableKeychain {
        fn drop(&mut self) {
            drop(self.keychain.take());
            let _ = std::fs::remove_dir_all(&self.directory);
        }
    }

    fn assert_loaded(
        keychain: &SecKeychain,
        target: &super::PlatformTarget,
        expected: Option<&[u8]>,
    ) {
        let loaded = load_in(keychain, target).expect("keychain load succeeds");
        assert!(loaded.as_deref() == expected, "loaded secret state differs");
    }

    #[test]
    #[ignore = "requires a macOS keychain service that permits disposable keychain creation"]
    fn disposable_native_keychain_obeys_replace_load_delete_and_namespace_contract() {
        let disposable = DisposableKeychain::create();
        let scope = AccountSessionKeychainScope {
            account_id: "account-native-test",
            device_id: "device-native-test",
        };
        let account_target = derive_target(KeychainNamespaceClass::AccountSession, scope)
            .expect("valid account target");
        let provider_target = derive_target(KeychainNamespaceClass::ProviderConnection, scope)
            .expect("valid provider target");

        assert_loaded(disposable.keychain(), &account_target, None);
        delete_in(disposable.keychain(), &account_target).expect("missing delete succeeds");

        replace_in(disposable.keychain(), &account_target, b"first-secret")
            .expect("first atomic write");
        assert_loaded(
            disposable.keychain(),
            &account_target,
            Some(b"first-secret"),
        );
        assert_loaded(disposable.keychain(), &provider_target, None);

        replace_in(disposable.keychain(), &account_target, b"rotated-secret")
            .expect("atomic replacement");
        assert_loaded(
            disposable.keychain(),
            &account_target,
            Some(b"rotated-secret"),
        );

        delete_in(disposable.keychain(), &account_target).expect("first delete");
        delete_in(disposable.keychain(), &account_target).expect("idempotent delete");
        assert_loaded(disposable.keychain(), &account_target, None);
    }
}
