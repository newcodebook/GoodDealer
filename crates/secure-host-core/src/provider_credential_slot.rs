//! OS storage for fixed immutable Provider slots. The owning service validates the envelope
//! and performs its Host-fenced create/read/delete protocol around these private operations.
use zeroize::Zeroizing;

#[derive(Clone, Copy)]
pub(super) enum Service {
    Afternic,
    Spaceship,
    Aliyun,
    Atom,
    CloudflareRegistrar,
    GoDaddy,
}

#[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
impl Service {
    const fn name(self) -> &'static str {
        match self {
            Self::Afternic => "com.gooddealer.desktop.afternic.listing.v1",
            Self::Spaceship => "com.gooddealer.desktop.spaceship.registrar.v1",
            Self::Aliyun => "com.gooddealer.desktop.aliyun.registrar.v1",
            Self::Atom => "com.gooddealer.desktop.atom.marketplace.v1",
            Self::CloudflareRegistrar => "com.gooddealer.desktop.cloudflare.registrar.v1",
            Self::GoDaddy => "com.gooddealer.desktop.godaddy.registrar.v3",
        }
    }
}

#[derive(Debug)]
pub(super) struct CustodyUnavailable;

pub(super) fn purge_cloudflare_registrar(account: &str) -> Result<(), CustodyUnavailable> {
    purge_exact(Service::CloudflareRegistrar, account)
}

/// Retires a fixed Registrar account slot and confirms absence without reading its value.
#[cfg(target_os = "linux")]
pub(super) fn purge_exact(service: Service, account: &str) -> Result<(), CustodyUnavailable> {
    crate::secret_service_custody::delete_exact_items(service.name(), account)
        .map(|_| ())
        .map_err(|_| CustodyUnavailable)
}

#[cfg(target_os = "macos")]
pub(super) fn purge_exact(service: Service, account: &str) -> Result<(), CustodyUnavailable> {
    use security_framework::item::{CloudSync, ItemClass, ItemSearchOptions};
    delete(service, account)?;
    let mut query = ItemSearchOptions::new();
    query
        .class(ItemClass::generic_password())
        .service(service.name())
        .account(account)
        .cloud_sync(CloudSync::MatchSyncNo)
        .ignore_legacy_keychains()
        .load_attributes(true)
        .limit(1);
    match query.search() {
        Ok(items) if items.is_empty() => Ok(()),
        Err(error) if error.code() == -25300 => Ok(()),
        _ => Err(CustodyUnavailable),
    }
}

#[cfg(target_os = "windows")]
pub(super) fn purge_exact(service: Service, account: &str) -> Result<(), CustodyUnavailable> {
    delete(service, account)?;
    match crate::windows_custody::exists(service.name(), account) {
        Ok(false) => Ok(()),
        _ => Err(CustodyUnavailable),
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
pub(super) const fn purge_exact(_: Service, _: &str) -> Result<(), CustodyUnavailable> {
    Err(CustodyUnavailable)
}

#[cfg(target_os = "linux")]
pub(super) fn load(
    service: Service,
    account: &str,
) -> Result<Option<Zeroizing<Vec<u8>>>, CustodyUnavailable> {
    crate::secret_service_custody::load(service.name(), account).map_err(|_| CustodyUnavailable)
}
#[cfg(target_os = "linux")]
pub(super) fn store(
    service: Service,
    account: &str,
    bytes: &[u8],
) -> Result<(), CustodyUnavailable> {
    crate::secret_service_custody::store(service.name(), account, bytes)
        .map_err(|_| CustodyUnavailable)
}
#[cfg(target_os = "linux")]
pub(super) fn delete(service: Service, account: &str) -> Result<(), CustodyUnavailable> {
    crate::secret_service_custody::delete(service.name(), account).map_err(|_| CustodyUnavailable)
}
#[cfg(target_os = "macos")]
fn keychain_options(
    service: Service,
    account: &str,
    protect: bool,
) -> Result<security_framework::passwords::PasswordOptions, CustodyUnavailable> {
    use security_framework::{
        access_control::{ProtectionMode, SecAccessControl},
        passwords::{AccessControlOptions, PasswordOptions},
    };
    let mut options = PasswordOptions::new_generic_password(service.name(), account);
    options.use_protected_keychain();
    options.set_access_synchronized(Some(false));
    if protect {
        options.set_access_control(
            SecAccessControl::create_with_protection(
                Some(ProtectionMode::AccessibleWhenUnlockedThisDeviceOnly),
                AccessControlOptions::empty().bits(),
            )
            .map_err(|_| CustodyUnavailable)?,
        );
    }
    Ok(options)
}
#[cfg(target_os = "macos")]
pub(super) fn load(
    service: Service,
    account: &str,
) -> Result<Option<Zeroizing<Vec<u8>>>, CustodyUnavailable> {
    match security_framework::passwords::generic_password(keychain_options(
        service, account, false,
    )?) {
        Ok(bytes) => Ok(Some(Zeroizing::new(bytes))),
        Err(error) if error.code() == -25300 => Ok(None),
        Err(_) => Err(CustodyUnavailable),
    }
}
#[cfg(target_os = "macos")]
pub(super) fn store(
    service: Service,
    account: &str,
    bytes: &[u8],
) -> Result<(), CustodyUnavailable> {
    security_framework::passwords::set_generic_password_options(
        bytes,
        keychain_options(service, account, true)?,
    )
    .map_err(|_| CustodyUnavailable)
}
#[cfg(target_os = "macos")]
pub(super) fn delete(service: Service, account: &str) -> Result<(), CustodyUnavailable> {
    match security_framework::passwords::delete_generic_password_options(keychain_options(
        service, account, false,
    )?) {
        Ok(()) => Ok(()),
        Err(error) if error.code() == -25300 => Ok(()),
        Err(_) => Err(CustodyUnavailable),
    }
}
#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
pub(super) fn load(_: Service, _: &str) -> Result<Option<Zeroizing<Vec<u8>>>, CustodyUnavailable> {
    Err(CustodyUnavailable)
}
#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
pub(super) fn store(_: Service, _: &str, _: &[u8]) -> Result<(), CustodyUnavailable> {
    Err(CustodyUnavailable)
}
#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
pub(super) fn delete(_: Service, _: &str) -> Result<(), CustodyUnavailable> {
    Err(CustodyUnavailable)
}

#[cfg(windows)]
pub(super) fn load(
    service: Service,
    account: &str,
) -> Result<Option<Zeroizing<Vec<u8>>>, CustodyUnavailable> {
    crate::windows_custody::load(service.name(), account)
        .map(|value| value.map(Zeroizing::new))
        .map_err(|_| CustodyUnavailable)
}
#[cfg(windows)]
pub(super) fn store(
    service: Service,
    account: &str,
    bytes: &[u8],
) -> Result<(), CustodyUnavailable> {
    crate::windows_custody::store(service.name(), account, bytes).map_err(|_| CustodyUnavailable)
}
#[cfg(windows)]
pub(super) fn delete(service: Service, account: &str) -> Result<(), CustodyUnavailable> {
    crate::windows_custody::delete(service.name(), account).map_err(|_| CustodyUnavailable)
}
