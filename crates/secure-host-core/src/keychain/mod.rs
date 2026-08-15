mod denying;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
mod windows;

use std::fmt;

pub use denying::{DenyingKeychainError, DenyingKeychainPort};

use crate::{
    AccountSessionKeychainScope, KeychainPort, KeychainWriteReceipt, RefreshTokenMaterial,
};

const SERVICE_PREFIX: &str = "com.gooddealer.secure-host";
const MACOS_SCOPE_SEPARATOR: char = '\u{1f}';

/// The four disjoint OS-credential namespace classes reserved by the Host.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeychainNamespaceClass {
    AccountSession,
    ProviderConnection,
    DeviceIdentity,
    LocalStorageMaster,
}

impl KeychainNamespaceClass {
    const fn suffix(self) -> &'static str {
        match self {
            Self::AccountSession => "account-session",
            Self::ProviderConnection => "provider-connection",
            Self::DeviceIdentity => "device-identity",
            Self::LocalStorageMaster => "local-storage-master",
        }
    }
}

/// The only OS-backed account-session adapter construction seam.
///
/// The production composition root intentionally does not use this type while the P0-08 fallback
/// remains in force. Native handles and returned platform buffers are confined to private,
/// target-gated modules.
///
/// ```compile_fail
/// use gooddealer_secure_host_core::OsKeychainAdapter;
/// let adapter = OsKeychainAdapter::for_account_session_namespace();
/// let _copy = adapter.clone();
/// ```
pub struct OsKeychainAdapter {
    _private: (),
}

/// Opaque, input-free failure from the OS credential store.
pub struct OsKeychainError {
    kind: OsKeychainErrorKind,
}

#[derive(Clone, Copy)]
enum OsKeychainErrorKind {
    InvalidScope,
    PlatformFailure,
    InvalidStoredCredential,
    #[cfg(not(target_os = "macos"))]
    UnsupportedPlatform,
}

/// The structural production default while real credential persistence is forbidden.
pub type DefaultKeychainPort = DenyingKeychainPort;

impl OsKeychainAdapter {
    #[must_use]
    pub const fn for_account_session_namespace() -> Self {
        Self { _private: () }
    }
}

impl OsKeychainError {
    const fn invalid_scope() -> Self {
        Self {
            kind: OsKeychainErrorKind::InvalidScope,
        }
    }

    const fn platform_failure() -> Self {
        Self {
            kind: OsKeychainErrorKind::PlatformFailure,
        }
    }

    const fn invalid_stored_credential() -> Self {
        Self {
            kind: OsKeychainErrorKind::InvalidStoredCredential,
        }
    }

    #[cfg(not(target_os = "macos"))]
    const fn unsupported_platform() -> Self {
        Self {
            kind: OsKeychainErrorKind::UnsupportedPlatform,
        }
    }
}

impl fmt::Debug for OsKeychainAdapter {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("OsKeychainAdapter([REDACTED])")
    }
}

impl fmt::Debug for OsKeychainError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let _ = self.kind;
        formatter.write_str("OsKeychainError([REDACTED])")
    }
}

impl fmt::Display for OsKeychainError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let _ = self.kind;
        formatter.write_str("operating system credential storage failed")
    }
}

impl KeychainPort for OsKeychainAdapter {
    type Error = OsKeychainError;

    fn replace_refresh_token(
        &mut self,
        scope: AccountSessionKeychainScope<'_>,
        refresh_token: &RefreshTokenMaterial,
    ) -> Result<KeychainWriteReceipt, Self::Error> {
        let target = derive_target(KeychainNamespaceClass::AccountSession, scope)?;
        platform_replace(
            &target,
            refresh_token.expose_for_keychain_or_refresh_transport(),
        )?;
        Ok(KeychainWriteReceipt::committed())
    }

    fn load_refresh_token(
        &mut self,
        scope: AccountSessionKeychainScope<'_>,
    ) -> Result<Option<RefreshTokenMaterial>, Self::Error> {
        let target = derive_target(KeychainNamespaceClass::AccountSession, scope)?;
        platform_load(&target)?
            .map(RefreshTokenMaterial::try_from_keychain_bytes)
            .transpose()
            .map_err(|_| OsKeychainError::invalid_stored_credential())
    }

    fn delete_refresh_token(
        &mut self,
        scope: AccountSessionKeychainScope<'_>,
    ) -> Result<KeychainWriteReceipt, Self::Error> {
        let target = derive_target(KeychainNamespaceClass::AccountSession, scope)?;
        platform_delete(&target)?;
        Ok(KeychainWriteReceipt::committed())
    }
}

struct PlatformTarget {
    service: String,
    macos_account: String,
    #[cfg(any(target_os = "windows", test))]
    windows_target: String,
}

fn derive_target(
    class: KeychainNamespaceClass,
    scope: AccountSessionKeychainScope<'_>,
) -> Result<PlatformTarget, OsKeychainError> {
    if !scope_component_is_safe(scope.account_id) || !scope_component_is_safe(scope.device_id) {
        return Err(OsKeychainError::invalid_scope());
    }
    let service = format!("{SERVICE_PREFIX}.{}", class.suffix());
    Ok(PlatformTarget {
        macos_account: format!(
            "{}{MACOS_SCOPE_SEPARATOR}{}",
            scope.account_id, scope.device_id
        ),
        #[cfg(any(target_os = "windows", test))]
        windows_target: format!("{service}/{}/{}", scope.account_id, scope.device_id),
        service,
    })
}

fn scope_component_is_safe(component: &str) -> bool {
    !component.is_empty()
        && component.len() <= 160
        && component.bytes().all(|byte| byte.is_ascii_graphic())
        && !component.contains('/')
        && !component.contains(MACOS_SCOPE_SEPARATOR)
}

#[cfg(target_os = "macos")]
fn platform_replace(target: &PlatformTarget, secret: &[u8]) -> Result<(), OsKeychainError> {
    macos::replace(target, secret)
}

#[cfg(target_os = "windows")]
fn platform_replace(target: &PlatformTarget, secret: &[u8]) -> Result<(), OsKeychainError> {
    windows::replace(target, secret)
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn platform_replace(_target: &PlatformTarget, _secret: &[u8]) -> Result<(), OsKeychainError> {
    Err(OsKeychainError::unsupported_platform())
}

#[cfg(target_os = "macos")]
fn platform_load(target: &PlatformTarget) -> Result<Option<Vec<u8>>, OsKeychainError> {
    macos::load(target)
}

#[cfg(target_os = "windows")]
fn platform_load(target: &PlatformTarget) -> Result<Option<Vec<u8>>, OsKeychainError> {
    windows::load(target)
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn platform_load(_target: &PlatformTarget) -> Result<Option<Vec<u8>>, OsKeychainError> {
    Err(OsKeychainError::unsupported_platform())
}

#[cfg(target_os = "macos")]
fn platform_delete(target: &PlatformTarget) -> Result<(), OsKeychainError> {
    macos::delete(target)
}

#[cfg(target_os = "windows")]
fn platform_delete(target: &PlatformTarget) -> Result<(), OsKeychainError> {
    windows::delete(target)
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn platform_delete(_target: &PlatformTarget) -> Result<(), OsKeychainError> {
    Err(OsKeychainError::unsupported_platform())
}

#[cfg(test)]
mod tests {
    use super::{
        DefaultKeychainPort, DenyingKeychainError, DenyingKeychainPort, KeychainNamespaceClass,
        OsKeychainAdapter, OsKeychainError, derive_target,
    };
    use crate::secret::SecretMaterial;
    use crate::{
        AccountSessionKeychainScope, HostSessionStore, KeychainPort, RefreshTokenMaterial,
        SessionStoreError,
    };

    const VALID_ACCESS: &str = include_str!(
        "../../../../packages/protocol/test-vectors/account/valid/auth-access-envelope.json"
    );
    const VALID_REFRESH: &str = include_str!(
        "../../../../packages/protocol/test-vectors/account/valid/auth-refresh-envelope.json"
    );
    const SCOPE: AccountSessionKeychainScope<'static> = AccountSessionKeychainScope {
        account_id: "account-01",
        device_id: "device-01",
    };

    #[test]
    fn adapters_implement_the_committed_port_and_denying_is_the_default() {
        fn assert_keychain_port<T: KeychainPort>() {}
        fn compiled_default() -> DefaultKeychainPort {
            DenyingKeychainPort
        }

        assert_keychain_port::<OsKeychainAdapter>();
        assert_keychain_port::<DenyingKeychainPort>();
        assert_eq!(
            format!("{:?}", compiled_default()),
            "DenyingKeychainPort([REDACTED])"
        );
    }

    #[test]
    fn denying_replace_is_err_and_install_fails_closed() {
        let mut direct = DenyingKeychainPort;
        let refresh =
            RefreshTokenMaterial::try_from_keychain_bytes(VALID_REFRESH.as_bytes().to_vec())
                .expect("valid refresh fixture");
        assert_eq!(
            direct.replace_refresh_token(SCOPE, &refresh),
            Err(DenyingKeychainError::RealCredentialFlowDisabled)
        );

        let mut store = HostSessionStore::new(DenyingKeychainPort);
        let initially_signed_out = store.status();
        assert_eq!(
            store.install_session(
                SecretMaterial::new(VALID_ACCESS.as_bytes().to_vec()),
                SecretMaterial::new(VALID_REFRESH.as_bytes().to_vec()),
                "2026-03-06T12:03:00Z",
            ),
            Err(SessionStoreError::KeychainUnavailable)
        );
        assert_eq!(store.status(), initially_signed_out);
    }

    #[test]
    fn denying_load_is_none_and_delete_is_committed() {
        let mut port = DenyingKeychainPort;
        assert!(
            port.load_refresh_token(SCOPE)
                .expect("load cannot fail")
                .is_none()
        );
        let first = port
            .delete_refresh_token(SCOPE)
            .expect("delete cannot fail");
        let second = port
            .delete_refresh_token(SCOPE)
            .expect("delete is idempotent");
        assert_eq!(first, second);
    }

    #[test]
    fn adapter_debug_and_errors_are_fixed_and_redacted() {
        const CANARY: &str = "GOODDEALER_KEYCHAIN_SECRET_CANARY";
        let rendered = [
            format!("{:?}", OsKeychainAdapter::for_account_session_namespace()),
            format!("{:?}", OsKeychainError::platform_failure()),
            OsKeychainError::platform_failure().to_string(),
            format!("{DenyingKeychainPort:?}"),
            format!("{:?}", DenyingKeychainError::RealCredentialFlowDisabled),
            DenyingKeychainError::RealCredentialFlowDisabled.to_string(),
        ];
        assert!(rendered.iter().all(|value| !value.contains(CANARY)));
        assert_eq!(rendered[0], "OsKeychainAdapter([REDACTED])");
        assert_eq!(rendered[1], "OsKeychainError([REDACTED])");
    }

    #[test]
    fn namespace_classes_and_scopes_cannot_collide() {
        let classes = [
            KeychainNamespaceClass::AccountSession,
            KeychainNamespaceClass::ProviderConnection,
            KeychainNamespaceClass::DeviceIdentity,
            KeychainNamespaceClass::LocalStorageMaster,
        ];
        let targets = classes.map(|class| derive_target(class, SCOPE).expect("valid scope"));
        for (index, target) in targets.iter().enumerate() {
            for other in &targets[index + 1..] {
                assert_ne!(target.service, other.service);
                assert_ne!(target.windows_target, other.windows_target);
            }
        }
        assert!(
            derive_target(
                KeychainNamespaceClass::AccountSession,
                AccountSessionKeychainScope {
                    account_id: "account/ambiguous",
                    device_id: "device-01",
                },
            )
            .is_err()
        );
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    #[test]
    fn unsupported_platform_is_fail_closed() {
        let mut adapter = OsKeychainAdapter::for_account_session_namespace();
        let refresh =
            RefreshTokenMaterial::try_from_keychain_bytes(VALID_REFRESH.as_bytes().to_vec())
                .expect("valid refresh fixture");
        assert!(adapter.replace_refresh_token(SCOPE, &refresh).is_err());
        assert!(adapter.load_refresh_token(SCOPE).is_err());
        assert!(adapter.delete_refresh_token(SCOPE).is_err());
    }
}
