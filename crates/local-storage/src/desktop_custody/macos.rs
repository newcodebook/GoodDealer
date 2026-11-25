//! Private macos custody for local database keys, continuity receipts and device binding.

use super::{DEVICE_IDENTITY_ACCOUNT, DEVICE_IDENTITY_SERVICE, DesktopCustodyError};

#[cfg(all(target_os = "macos", not(test)))]
pub(super) fn load_device_binding_native() -> Result<Option<Vec<u8>>, DesktopCustodyError> {
    use security_framework::passwords::PasswordOptions;
    const ITEM_NOT_FOUND: i32 = -25_300;
    verify_binding_attributes()?;
    let mut options =
        PasswordOptions::new_generic_password(DEVICE_IDENTITY_SERVICE, DEVICE_IDENTITY_ACCOUNT);
    options.use_protected_keychain();
    options.set_access_synchronized(Some(false));
    match security_framework::passwords::generic_password(options) {
        Ok(value) => Ok(Some(value)),
        Err(error) if error.code() == ITEM_NOT_FOUND => Ok(None),
        Err(_) => Err(DesktopCustodyError::Unavailable),
    }
}

#[cfg(all(target_os = "macos", not(test)))]
fn verify_binding_attributes() -> Result<(), DesktopCustodyError> {
    use security_framework::item::{CloudSync, ItemClass, ItemSearchOptions, SearchResult};
    const ITEM_NOT_FOUND: i32 = -25_300;
    let mut query = ItemSearchOptions::new();
    query
        .class(ItemClass::generic_password())
        .service(DEVICE_IDENTITY_SERVICE)
        .account(DEVICE_IDENTITY_ACCOUNT)
        .cloud_sync(CloudSync::MatchSyncNo)
        .ignore_legacy_keychains()
        .load_attributes(true)
        .limit(1);
    let results = query
        .search()
        .map_err(|_| DesktopCustodyError::Unavailable)?;
    let Some(result @ SearchResult::Dict(_)) = results.first() else {
        return Err(DesktopCustodyError::Rejected);
    };
    let values = result
        .simplify_dict()
        .ok_or(DesktopCustodyError::Rejected)?;
    let valid_group = values.get("agrp").is_some_and(|value| {
        value == "app.gooddealer.desktop"
            || value
                .strip_suffix("app.gooddealer.desktop")
                .is_some_and(|prefix| {
                    let team = prefix.strip_suffix('.').unwrap_or_default();
                    team.len() == 10
                        && team
                            .bytes()
                            .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit())
                })
    });
    if values
        .get("svce")
        .is_none_or(|value| value != DEVICE_IDENTITY_SERVICE)
        || values
            .get("acct")
            .is_none_or(|value| value != DEVICE_IDENTITY_ACCOUNT)
        || values.get("pdmn").is_none_or(|value| value != "aku")
        || !values.contains_key("accc")
        || !valid_group
    {
        return Err(DesktopCustodyError::Rejected);
    }
    let mut synchronized = ItemSearchOptions::new();
    synchronized
        .class(ItemClass::generic_password())
        .service(DEVICE_IDENTITY_SERVICE)
        .account(DEVICE_IDENTITY_ACCOUNT)
        .cloud_sync(CloudSync::MatchSyncYes)
        .ignore_legacy_keychains()
        .load_attributes(true)
        .limit(1);
    match synchronized.search() {
        Err(error) if error.code() == ITEM_NOT_FOUND => Ok(()),
        Ok(results) if results.is_empty() => Ok(()),
        Ok(_) => Err(DesktopCustodyError::Rejected),
        Err(_) => Err(DesktopCustodyError::Unavailable),
    }
}

#[cfg(all(target_os = "macos", not(test)))]
fn secret_keychain_options(
    service: &str,
    account: &str,
    include_access_control: bool,
) -> security_framework::passwords::PasswordOptions {
    use security_framework::access_control::{ProtectionMode, SecAccessControl};
    use security_framework::passwords::{AccessControlOptions, PasswordOptions};

    let mut options = PasswordOptions::new_generic_password(service, account);
    options.use_protected_keychain();
    options.set_access_synchronized(Some(false));
    if include_access_control {
        options.set_access_control(
            SecAccessControl::create_with_protection(
                Some(ProtectionMode::AccessibleWhenUnlockedThisDeviceOnly),
                AccessControlOptions::empty().bits(),
            )
            .expect("fixed keychain access control flags are valid"),
        );
    }
    options
}

#[cfg(all(target_os = "macos", not(test)))]
pub(super) fn load_native(
    service: &str,
    account: &str,
) -> Result<Option<Vec<u8>>, DesktopCustodyError> {
    const ITEM_NOT_FOUND: i32 = -25_300;
    match security_framework::passwords::generic_password(secret_keychain_options(
        service, account, false,
    )) {
        Ok(value) => {
            verify_secret_attributes(service, account)?;
            Ok(Some(value))
        }
        Err(error) if error.code() == ITEM_NOT_FOUND => Ok(None),
        Err(_) => Err(DesktopCustodyError::Unavailable),
    }
}

#[cfg(all(target_os = "macos", not(test)))]
pub(super) fn store_native(
    service: &str,
    account: &str,
    value: &[u8],
) -> Result<(), DesktopCustodyError> {
    security_framework::passwords::set_generic_password_options(
        value,
        secret_keychain_options(service, account, true),
    )
    .map_err(|_| DesktopCustodyError::Unavailable)?;
    verify_secret_attributes(service, account)?;
    match load_native(service, account)? {
        Some(readback) if readback == value => Ok(()),
        _ => Err(DesktopCustodyError::Rejected),
    }
}

#[cfg(all(target_os = "macos", not(test)))]
pub(super) fn delete_native(service: &str, account: &str) -> Result<(), DesktopCustodyError> {
    verify_secret_attributes(service, account)?;
    security_framework::passwords::delete_generic_password_options(secret_keychain_options(
        service, account, false,
    ))
    .map_err(|_| DesktopCustodyError::Unavailable)
}

#[cfg(all(target_os = "macos", not(test)))]
fn verify_secret_attributes(service: &str, account: &str) -> Result<(), DesktopCustodyError> {
    use security_framework::item::{CloudSync, ItemClass, ItemSearchOptions, SearchResult};

    let mut query = ItemSearchOptions::new();
    query
        .class(ItemClass::generic_password())
        .service(service)
        .account(account)
        .cloud_sync(CloudSync::MatchSyncNo)
        .ignore_legacy_keychains()
        .load_attributes(true)
        .limit(1);
    let results = query
        .search()
        .map_err(|_| DesktopCustodyError::Unavailable)?;
    let Some(result @ SearchResult::Dict(_)) = results.first() else {
        return Err(DesktopCustodyError::Rejected);
    };
    let values = result
        .simplify_dict()
        .ok_or(DesktopCustodyError::Rejected)?;
    let valid_group = values.get("agrp").is_some_and(|value| {
        value == "app.gooddealer.desktop"
            || value
                .strip_suffix("app.gooddealer.desktop")
                .is_some_and(|prefix| {
                    let team = prefix.strip_suffix('.').unwrap_or_default();
                    team.len() == 10
                        && team
                            .bytes()
                            .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit())
                })
    });
    if values.get("svce").is_none_or(|value| value != service)
        || values.get("acct").is_none_or(|value| value != account)
        || values.get("pdmn").is_none_or(|value| value != "aku")
        || !values.contains_key("accc")
        || !valid_group
    {
        return Err(DesktopCustodyError::Rejected);
    }
    Ok(())
}
