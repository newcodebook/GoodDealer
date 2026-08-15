use std::fmt;

use serde::Deserialize;

use crate::account_status::{AuthRevocationReason, AuthSessionStatus};
use crate::secret::SecretMaterial;
use crate::wire_scalar::{
    SafeUnsignedInteger, is_base64_url, is_canonical_utc_timestamp, is_identifier,
};

const AUTH_ENVELOPE_SCHEMA_VERSION: u64 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AuthEnvelopeValidationError;

impl fmt::Display for AuthEnvelopeValidationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("invalid auth credential envelope")
    }
}

#[derive(Deserialize)]
enum AccountsIssuer {
    #[serde(rename = "https://accounts.gooddealer.com")]
    Accounts,
}

#[derive(Deserialize)]
enum AuthAccessType {
    #[serde(rename = "gd.auth-access.v1")]
    AuthAccess,
}

#[derive(Deserialize)]
enum AuthAccessAudience {
    #[serde(rename = "gooddealer-cloud/account-api")]
    AccountApi,
}

#[derive(Deserialize)]
enum AuthAccessKeyPurpose {
    #[serde(rename = "gooddealer.identity.auth-access.v1")]
    AuthAccess,
}

#[derive(Deserialize)]
enum AuthRefreshType {
    #[serde(rename = "gd.auth-refresh.v1")]
    AuthRefresh,
}

#[derive(Deserialize)]
enum AuthRefreshAudience {
    #[serde(rename = "gooddealer-accounts/session-refresh")]
    SessionRefresh,
}

#[derive(Deserialize)]
enum AuthRefreshKeyPurpose {
    #[serde(rename = "gooddealer.identity.auth-refresh.v1")]
    AuthRefresh,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AuthAccessEnvelope {
    schema_version: SafeUnsignedInteger,
    typ: AuthAccessType,
    iss: AccountsIssuer,
    aud: AuthAccessAudience,
    kid: String,
    key_purpose: AuthAccessKeyPurpose,
    account_id: String,
    device_id: String,
    account_security_epoch: SafeUnsignedInteger,
    jti: String,
    issued_at: String,
    expires_at: String,
    payload: AuthAccessPayload,
    signature: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AuthAccessPayload {
    session_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AuthRefreshEnvelope {
    schema_version: SafeUnsignedInteger,
    typ: AuthRefreshType,
    iss: AccountsIssuer,
    aud: AuthRefreshAudience,
    kid: String,
    key_purpose: AuthRefreshKeyPurpose,
    account_id: String,
    device_id: String,
    account_security_epoch: SafeUnsignedInteger,
    jti: String,
    issued_at: String,
    expires_at: String,
    payload: AuthRefreshPayload,
    signature: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AuthRefreshPayload {
    session_id: String,
    family_id: String,
    rotation_generation: SafeUnsignedInteger,
    remember_device: bool,
}

struct AuthAccessClaims {
    account_id: String,
    device_id: String,
    account_security_epoch: u64,
    session_id: String,
    expires_at: String,
}

struct AuthRefreshClaims {
    account_id: String,
    device_id: String,
    account_security_epoch: u64,
    session_id: String,
    family_id: String,
    rotation_generation: u64,
    remember_device: bool,
}

fn common_fields_are_valid(
    schema_version: SafeUnsignedInteger,
    identifiers: [&str; 4],
    account_security_epoch: SafeUnsignedInteger,
    issued_at: &str,
    expires_at: &str,
    signature: &str,
) -> bool {
    schema_version.get() == AUTH_ENVELOPE_SCHEMA_VERSION
        && identifiers.into_iter().all(is_identifier)
        && account_security_epoch.get() > 0
        && is_canonical_utc_timestamp(issued_at)
        && is_canonical_utc_timestamp(expires_at)
        && issued_at < expires_at
        && is_base64_url(signature)
}

fn parse_auth_access_envelope(
    source: &str,
) -> Result<AuthAccessClaims, AuthEnvelopeValidationError> {
    let envelope: AuthAccessEnvelope =
        serde_json::from_str(source).map_err(|_| AuthEnvelopeValidationError)?;
    if !common_fields_are_valid(
        envelope.schema_version,
        [
            &envelope.kid,
            &envelope.account_id,
            &envelope.device_id,
            &envelope.jti,
        ],
        envelope.account_security_epoch,
        &envelope.issued_at,
        &envelope.expires_at,
        &envelope.signature,
    ) || !is_identifier(&envelope.payload.session_id)
    {
        return Err(AuthEnvelopeValidationError);
    }
    let _ = (
        envelope.typ,
        envelope.iss,
        envelope.aud,
        envelope.key_purpose,
    );
    Ok(AuthAccessClaims {
        account_id: envelope.account_id,
        device_id: envelope.device_id,
        account_security_epoch: envelope.account_security_epoch.get(),
        session_id: envelope.payload.session_id,
        expires_at: envelope.expires_at,
    })
}

fn parse_auth_refresh_envelope(
    source: &str,
) -> Result<AuthRefreshClaims, AuthEnvelopeValidationError> {
    let envelope: AuthRefreshEnvelope =
        serde_json::from_str(source).map_err(|_| AuthEnvelopeValidationError)?;
    if !common_fields_are_valid(
        envelope.schema_version,
        [
            &envelope.kid,
            &envelope.account_id,
            &envelope.device_id,
            &envelope.jti,
        ],
        envelope.account_security_epoch,
        &envelope.issued_at,
        &envelope.expires_at,
        &envelope.signature,
    ) || !is_identifier(&envelope.payload.session_id)
        || !is_identifier(&envelope.payload.family_id)
    {
        return Err(AuthEnvelopeValidationError);
    }
    let _ = (
        envelope.typ,
        envelope.iss,
        envelope.aud,
        envelope.key_purpose,
    );
    Ok(AuthRefreshClaims {
        account_id: envelope.account_id,
        device_id: envelope.device_id,
        account_security_epoch: envelope.account_security_epoch.get(),
        session_id: envelope.payload.session_id,
        family_id: envelope.payload.family_id,
        rotation_generation: envelope.payload.rotation_generation.get(),
        remember_device: envelope.payload.remember_device,
    })
}

/// Validates the strict Rust mirror of the TypeScript `authAccessEnvelopeSchema`.
/// Cryptographic signature verification remains the responsibility of the audited verifier.
///
/// # Errors
///
/// Rejects malformed JSON, unknown fields, invalid scalar values, and any other credential type.
pub fn validate_auth_access_envelope_json(source: &str) -> Result<(), AuthEnvelopeValidationError> {
    parse_auth_access_envelope(source).map(|_| ())
}

/// Validates the strict Rust mirror of the TypeScript `authRefreshEnvelopeSchema`.
/// Cryptographic signature verification remains the responsibility of the audited verifier.
///
/// # Errors
///
/// Rejects malformed JSON, unknown fields, invalid scalar values, and any other credential type.
pub fn validate_auth_refresh_envelope_json(
    source: &str,
) -> Result<(), AuthEnvelopeValidationError> {
    parse_auth_refresh_envelope(source).map(|_| ())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AccountSessionKeychainScope<'a> {
    pub account_id: &'a str,
    pub device_id: &'a str,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct KeychainWriteReceipt(());

impl KeychainWriteReceipt {
    /// Constructs a receipt only after the requested mutation has been durably committed.
    #[must_use]
    pub const fn committed() -> Self {
        Self(())
    }
}

pub struct RefreshTokenMaterial(SecretMaterial);

impl RefreshTokenMaterial {
    /// Validates bytes read from the OS credential store before they can re-enter the session
    /// path. This constructor cannot create an access-token value because the refresh parser is
    /// type, audience, key-purpose, and payload isolated.
    ///
    /// # Errors
    ///
    /// Rejects malformed bytes and every non-refresh credential envelope.
    pub fn try_from_keychain_bytes(bytes: Vec<u8>) -> Result<Self, AuthEnvelopeValidationError> {
        let material = SecretMaterial::new(bytes);
        let source = std::str::from_utf8(material.expose_secret())
            .map_err(|_| AuthEnvelopeValidationError)?;
        parse_auth_refresh_envelope(source)?;
        Ok(Self(material))
    }

    #[must_use]
    pub fn expose_for_keychain_or_refresh_transport(&self) -> &[u8] {
        self.0.expose_secret()
    }

    fn from_validated_secret(material: SecretMaterial) -> Self {
        Self(material)
    }
}

impl fmt::Debug for RefreshTokenMaterial {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("RefreshTokenMaterial([REDACTED])")
    }
}

pub trait KeychainPort {
    type Error;

    /// Atomically replaces the account-scoped refresh credential. An error means the previous
    /// value, if any, remains unchanged.
    ///
    /// # Errors
    ///
    /// Returns a platform-specific failure. Callers discard its detail at the Host boundary.
    fn replace_refresh_token(
        &mut self,
        scope: AccountSessionKeychainScope<'_>,
        refresh_token: &RefreshTokenMaterial,
    ) -> Result<KeychainWriteReceipt, Self::Error>;

    /// Loads the account-scoped refresh credential without exposing a Keychain reference.
    ///
    /// # Errors
    ///
    /// Returns a platform-specific failure. Callers discard its detail at the Host boundary.
    fn load_refresh_token(
        &mut self,
        scope: AccountSessionKeychainScope<'_>,
    ) -> Result<Option<RefreshTokenMaterial>, Self::Error>;

    /// Deletes the account-scoped refresh credential. Missing credentials count as success.
    ///
    /// # Errors
    ///
    /// Returns a platform-specific failure. Callers discard its detail at the Host boundary.
    fn delete_refresh_token(
        &mut self,
        scope: AccountSessionKeychainScope<'_>,
    ) -> Result<KeychainWriteReceipt, Self::Error>;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionStoreError {
    InvalidEnvelope,
    EnvelopeMismatch,
    InvalidTrustedTime,
    KeychainUnavailable,
}

impl fmt::Display for SessionStoreError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let message = match self {
            Self::InvalidEnvelope => "invalid auth credential envelope",
            Self::EnvelopeMismatch => "auth credential envelopes do not describe one session",
            Self::InvalidTrustedTime => "invalid trusted-time metadata",
            Self::KeychainUnavailable => "account credential storage is unavailable",
        };
        formatter.write_str(message)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SilentRecoveryRejection {
    UserSignedOut,
    RemoteSignOut,
    RefreshReuseDetected,
    AccountSecurityEpochAdvanced,
    DeviceRemoved,
    AccountRecoveryPending,
    RecoveryPending,
}

impl SilentRecoveryRejection {
    #[must_use]
    pub const fn from_revocation_reason(reason: AuthRevocationReason) -> Self {
        match reason {
            AuthRevocationReason::UserSignedOut => Self::UserSignedOut,
            AuthRevocationReason::RemoteSignOut => Self::RemoteSignOut,
            AuthRevocationReason::RefreshReuseDetected => Self::RefreshReuseDetected,
            AuthRevocationReason::AccountSecurityEpochAdvanced => {
                Self::AccountSecurityEpochAdvanced
            }
            AuthRevocationReason::DeviceRemoved => Self::DeviceRemoved,
            AuthRevocationReason::AccountRecoveryPending => Self::AccountRecoveryPending,
        }
    }
}

pub struct StartupRefreshCredential {
    material: RefreshTokenMaterial,
    account_id: String,
    device_id: String,
    session_id: String,
    family_id: String,
    rotation_generation: u64,
}

impl StartupRefreshCredential {
    #[must_use]
    pub fn expose_for_refresh_transport(&self) -> &[u8] {
        self.material.expose_for_keychain_or_refresh_transport()
    }

    #[must_use]
    pub fn account_id(&self) -> &str {
        &self.account_id
    }

    #[must_use]
    pub fn device_id(&self) -> &str {
        &self.device_id
    }

    #[must_use]
    pub fn session_id(&self) -> &str {
        &self.session_id
    }

    #[must_use]
    pub fn family_id(&self) -> &str {
        &self.family_id
    }

    #[must_use]
    pub const fn rotation_generation(&self) -> u64 {
        self.rotation_generation
    }
}

impl fmt::Debug for StartupRefreshCredential {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("StartupRefreshCredential([REDACTED])")
    }
}

struct InMemorySession {
    access_token: Option<SecretMaterial>,
    ephemeral_refresh_token: Option<RefreshTokenMaterial>,
    account_id: String,
    device_id: String,
    account_security_epoch: u64,
    session_id: String,
    access_token_expires_at: String,
    refresh_rotation_generation: u64,
    last_trusted_time_at: String,
    remember_device: bool,
}

pub struct HostSessionStore<K> {
    keychain: K,
    session: Option<InMemorySession>,
}

impl<K> HostSessionStore<K> {
    #[must_use]
    pub const fn new(keychain: K) -> Self {
        Self {
            keychain,
            session: None,
        }
    }

    #[must_use]
    pub fn status(&self) -> AuthSessionStatus {
        self.session
            .as_ref()
            .map_or_else(AuthSessionStatus::signed_out, |session| {
                AuthSessionStatus::from_host_session(
                    &session.account_id,
                    &session.device_id,
                    session.account_security_epoch,
                    &session.session_id,
                    &session.access_token_expires_at,
                    session.refresh_rotation_generation,
                    &session.last_trusted_time_at,
                    session.access_token.is_some(),
                )
            })
    }

    /// Drops an expired access credential while retaining the refresh path. Access-token expiry is
    /// projected as `refresh_required`; it never creates a locked session.
    pub fn mark_access_token_expired(&mut self) -> AuthSessionStatus {
        if let Some(session) = &mut self.session {
            session.access_token = None;
        }
        self.status()
    }

    /// A retryable transport failure does not mutate session state or credentials.
    #[must_use]
    pub fn note_retryable_refresh_failure(&self) -> AuthSessionStatus {
        self.status()
    }

    /// Borrows the process-only refresh credential used when `rememberDevice` is false. The
    /// returned secret remains Host-owned and has no serialization or display implementation.
    #[must_use]
    pub fn ephemeral_refresh_for_transport(&self) -> Option<&RefreshTokenMaterial> {
        self.session
            .as_ref()
            .and_then(|session| session.ephemeral_refresh_token.as_ref())
    }
}

impl<K: KeychainPort> HostSessionStore<K> {
    /// Installs a structurally validated pair of credentials from the trusted Host transport.
    /// Durable refresh replacement completes before the access credential becomes reachable.
    ///
    /// This method validates the signed-envelope wire contract but does not verify its signature;
    /// callers must obtain the pair from the audited account transport/verifier.
    ///
    /// # Errors
    ///
    /// Fails closed for malformed or mismatched envelopes, invalid trusted-time metadata, and
    /// Keychain mutations. Platform error detail is discarded before crossing this boundary.
    pub fn install_session(
        &mut self,
        access_token: SecretMaterial,
        refresh_token: SecretMaterial,
        last_trusted_time_at: &str,
    ) -> Result<AuthSessionStatus, SessionStoreError> {
        let access = match parse_secret_access_token(&access_token) {
            Ok(access) => access,
            Err(error) => {
                self.session = None;
                return Err(error);
            }
        };
        let refresh = match parse_raw_refresh_token(&refresh_token) {
            Ok(refresh) => refresh,
            Err(error) => {
                self.session = None;
                return Err(error);
            }
        };
        if !is_canonical_utc_timestamp(last_trusted_time_at) {
            self.session = None;
            return Err(SessionStoreError::InvalidTrustedTime);
        }
        if access.account_id != refresh.account_id
            || access.device_id != refresh.device_id
            || access.account_security_epoch != refresh.account_security_epoch
            || access.session_id != refresh.session_id
        {
            self.session = None;
            return Err(SessionStoreError::EnvelopeMismatch);
        }

        let scope = AccountSessionKeychainScope {
            account_id: &refresh.account_id,
            device_id: &refresh.device_id,
        };
        let refresh_token = RefreshTokenMaterial::from_validated_secret(refresh_token);
        let ephemeral_refresh_token = if refresh.remember_device {
            if self
                .keychain
                .replace_refresh_token(scope, &refresh_token)
                .is_err()
            {
                self.session = None;
                return Err(SessionStoreError::KeychainUnavailable);
            }
            None
        } else {
            if self.keychain.delete_refresh_token(scope).is_err() {
                self.session = None;
                return Err(SessionStoreError::KeychainUnavailable);
            }
            Some(refresh_token)
        };

        self.session = Some(InMemorySession {
            access_token: Some(access_token),
            ephemeral_refresh_token,
            account_id: access.account_id,
            device_id: access.device_id,
            account_security_epoch: access.account_security_epoch,
            session_id: access.session_id,
            access_token_expires_at: access.expires_at,
            refresh_rotation_generation: refresh.rotation_generation,
            last_trusted_time_at: last_trusted_time_at.to_owned(),
            remember_device: refresh.remember_device,
        });
        Ok(self.status())
    }

    /// Loads a remembered refresh credential for a startup refresh. Invalid stored material is
    /// deleted best-effort and is never returned to the caller.
    ///
    /// # Errors
    ///
    /// Returns a redacted storage error when the Keychain cannot be read.
    pub fn load_startup_refresh(
        &mut self,
        scope: AccountSessionKeychainScope<'_>,
    ) -> Result<Option<StartupRefreshCredential>, SessionStoreError> {
        if !is_identifier(scope.account_id) || !is_identifier(scope.device_id) {
            return Err(SessionStoreError::InvalidEnvelope);
        }
        let Some(material) = self
            .keychain
            .load_refresh_token(scope)
            .map_err(|_| SessionStoreError::KeychainUnavailable)?
        else {
            return Ok(None);
        };
        let Ok(claims) = parse_secret_refresh_token(&material) else {
            let _ = self.keychain.delete_refresh_token(scope);
            return Ok(None);
        };
        if !claims.remember_device
            || claims.account_id != scope.account_id
            || claims.device_id != scope.device_id
        {
            let _ = self.keychain.delete_refresh_token(scope);
            return Ok(None);
        }
        Ok(Some(StartupRefreshCredential {
            material,
            account_id: claims.account_id,
            device_id: claims.device_id,
            session_id: claims.session_id,
            family_id: claims.family_id,
            rotation_generation: claims.rotation_generation,
        }))
    }

    /// Applies the complete authoritative silent-recovery rejection set. Every member clears the
    /// in-memory session and best-effort deletes the durable refresh credential, projecting only
    /// `signed_out` to TypeScript.
    pub fn reject_silent_recovery(
        &mut self,
        scope: AccountSessionKeychainScope<'_>,
        _rejection: SilentRecoveryRejection,
    ) -> AuthSessionStatus {
        self.session = None;
        let _ = self.keychain.delete_refresh_token(scope);
        self.status()
    }

    /// Signs out locally only after a remembered refresh credential is durably deleted.
    ///
    /// # Errors
    ///
    /// Returns a redacted storage error and retains the current session when deletion cannot be
    /// confirmed. Cloud-authoritative rejection uses [`Self::reject_silent_recovery`] instead.
    pub fn sign_out(&mut self) -> Result<AuthSessionStatus, SessionStoreError> {
        let durable_scope = self.session.as_ref().and_then(|session| {
            session
                .remember_device
                .then(|| (session.account_id.clone(), session.device_id.clone()))
        });
        if let Some((account_id, device_id)) = durable_scope {
            self.keychain
                .delete_refresh_token(AccountSessionKeychainScope {
                    account_id: &account_id,
                    device_id: &device_id,
                })
                .map_err(|_| SessionStoreError::KeychainUnavailable)?;
        }
        self.session = None;
        Ok(self.status())
    }
}

impl<K> fmt::Debug for HostSessionStore<K> {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("HostSessionStore([REDACTED])")
    }
}

fn parse_secret_access_token(
    material: &SecretMaterial,
) -> Result<AuthAccessClaims, SessionStoreError> {
    let source = std::str::from_utf8(material.expose_secret())
        .map_err(|_| SessionStoreError::InvalidEnvelope)?;
    parse_auth_access_envelope(source).map_err(|_| SessionStoreError::InvalidEnvelope)
}

fn parse_secret_refresh_token(
    material: &RefreshTokenMaterial,
) -> Result<AuthRefreshClaims, SessionStoreError> {
    let source = std::str::from_utf8(material.expose_for_keychain_or_refresh_transport())
        .map_err(|_| SessionStoreError::InvalidEnvelope)?;
    parse_auth_refresh_envelope(source).map_err(|_| SessionStoreError::InvalidEnvelope)
}

fn parse_raw_refresh_token(
    material: &SecretMaterial,
) -> Result<AuthRefreshClaims, SessionStoreError> {
    let source = std::str::from_utf8(material.expose_secret())
        .map_err(|_| SessionStoreError::InvalidEnvelope)?;
    parse_auth_refresh_envelope(source).map_err(|_| SessionStoreError::InvalidEnvelope)
}

#[cfg(test)]
mod tests {
    use super::{
        AccountSessionKeychainScope, HostSessionStore, KeychainPort, KeychainWriteReceipt,
        RefreshTokenMaterial, SessionStoreError, SilentRecoveryRejection,
        validate_auth_access_envelope_json, validate_auth_refresh_envelope_json,
    };
    use crate::account_status::{AuthSessionState, AuthSessionStatus};
    use crate::secret::SecretMaterial;

    const VALID_ACCESS: &str = include_str!(
        "../../../packages/protocol/test-vectors/account/valid/auth-access-envelope.json"
    );
    const VALID_REFRESH: &str = include_str!(
        "../../../packages/protocol/test-vectors/account/valid/auth-refresh-envelope.json"
    );

    #[test]
    fn refresh_token_debug_output_is_always_redacted() {
        let material = super::super::secret::SecretMaterial::new(b"super-secret-token-value".to_vec());
        let token = RefreshTokenMaterial::from_validated_secret(material);
        let rendered = format!("{token:?}");
        assert_eq!(rendered, "RefreshTokenMaterial([REDACTED])");
        assert!(!rendered.contains("super-secret-token-value"));
    }
    const INVALID_AUTH_VECTORS: [&str; 8] = [
        include_str!(
            "../../../packages/protocol/test-vectors/account/invalid/auth-access-with-mutate-scope.json"
        ),
        include_str!(
            "../../../packages/protocol/test-vectors/account/invalid/auth-access-with-platform-scope.json"
        ),
        include_str!(
            "../../../packages/protocol/test-vectors/account/invalid/auth-refresh-cross-typ-as-access.json"
        ),
        include_str!(
            "../../../packages/protocol/test-vectors/account/invalid/auth-access-cross-typ-as-refresh.json"
        ),
        include_str!(
            "../../../packages/protocol/test-vectors/account/invalid/auth-refresh-snake-case-wire.json"
        ),
        include_str!(
            "../../../packages/protocol/test-vectors/account/invalid/auth-refresh-unsafe-generation.json"
        ),
        include_str!(
            "../../../packages/protocol/test-vectors/account/invalid/auth-access-wrong-key-purpose.json"
        ),
        include_str!(
            "../../../packages/protocol/test-vectors/account/invalid/auth-refresh-wrong-audience.json"
        ),
    ];
    const CANARY: &str = "GOODDEALER_AUTH_TOKEN_CANARY_7c19";

    #[derive(Default)]
    struct FakeKeychain {
        stored: Option<Vec<u8>>,
        writes: Vec<Vec<u8>>,
        deletes: usize,
        fail: bool,
    }

    struct LeakyKeychainError(&'static str);

    impl std::fmt::Debug for LeakyKeychainError {
        fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            formatter.write_str(self.0)
        }
    }

    impl std::fmt::Display for LeakyKeychainError {
        fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            formatter.write_str(self.0)
        }
    }

    impl std::error::Error for LeakyKeychainError {}

    impl KeychainPort for FakeKeychain {
        type Error = LeakyKeychainError;

        fn replace_refresh_token(
            &mut self,
            _scope: AccountSessionKeychainScope<'_>,
            refresh_token: &RefreshTokenMaterial,
        ) -> Result<KeychainWriteReceipt, Self::Error> {
            if self.fail {
                return Err(LeakyKeychainError(CANARY));
            }
            let bytes = refresh_token
                .expose_for_keychain_or_refresh_transport()
                .to_vec();
            self.stored = Some(bytes.clone());
            self.writes.push(bytes);
            Ok(KeychainWriteReceipt::committed())
        }

        fn load_refresh_token(
            &mut self,
            _scope: AccountSessionKeychainScope<'_>,
        ) -> Result<Option<RefreshTokenMaterial>, Self::Error> {
            if self.fail {
                return Err(LeakyKeychainError(CANARY));
            }
            self.stored
                .clone()
                .map(RefreshTokenMaterial::try_from_keychain_bytes)
                .transpose()
                .map_err(|_| LeakyKeychainError(CANARY))
        }

        fn delete_refresh_token(
            &mut self,
            _scope: AccountSessionKeychainScope<'_>,
        ) -> Result<KeychainWriteReceipt, Self::Error> {
            if self.fail {
                return Err(LeakyKeychainError(CANARY));
            }
            self.deletes += 1;
            self.stored = None;
            Ok(KeychainWriteReceipt::committed())
        }
    }

    fn material(source: &str) -> SecretMaterial {
        SecretMaterial::new(source.as_bytes().to_vec())
    }

    fn install(store: &mut HostSessionStore<FakeKeychain>) -> AuthSessionStatus {
        store
            .install_session(
                material(VALID_ACCESS),
                material(VALID_REFRESH),
                "2026-08-15T04:01:00Z",
            )
            .expect("shared auth envelopes should install")
    }

    const fn scope() -> AccountSessionKeychainScope<'static> {
        AccountSessionKeychainScope {
            account_id: "account-01",
            device_id: "device-01",
        }
    }

    #[test]
    fn mirrors_every_auth_envelope_vector_and_mutually_rejects_token_types() {
        assert!(validate_auth_access_envelope_json(VALID_ACCESS).is_ok());
        assert!(validate_auth_refresh_envelope_json(VALID_REFRESH).is_ok());
        assert!(validate_auth_access_envelope_json(VALID_REFRESH).is_err());
        assert!(validate_auth_refresh_envelope_json(VALID_ACCESS).is_err());
        for vector in INVALID_AUTH_VECTORS {
            assert!(validate_auth_access_envelope_json(vector).is_err());
            assert!(validate_auth_refresh_envelope_json(vector).is_err());
        }
    }

    #[test]
    fn persists_only_refresh_and_returns_only_redacted_status() {
        let mut store = HostSessionStore::new(FakeKeychain::default());
        let status = install(&mut store);
        let status_json = serde_json::to_string(&status).expect("status serializes");

        assert_eq!(status.state(), AuthSessionState::Authenticated);
        assert_eq!(store.keychain.writes, [VALID_REFRESH.as_bytes()]);
        assert!(
            !store.keychain.writes[0]
                .windows(CANARY.len())
                .any(|window| window == CANARY.as_bytes())
        );
        assert!(!status_json.contains("signature"));
        assert!(!status_json.contains("jti"));
        assert!(!status_json.contains("token"));
        assert!(!format!("{store:?}").contains("auth-access-jti-01"));
        assert!(format!("{store:?}").contains("REDACTED"));
    }

    #[test]
    fn access_token_canary_never_reaches_keychain_debug_status_or_errors() {
        let canary_access = VALID_ACCESS.replace("auth-access-jti-01", CANARY);
        let mut store = HostSessionStore::new(FakeKeychain::default());
        let status = store
            .install_session(
                material(&canary_access),
                material(VALID_REFRESH),
                "2026-08-15T04:01:00Z",
            )
            .expect("valid canary access token");

        let surfaces = [
            format!("{store:?}"),
            format!("{status:?}"),
            serde_json::to_string(&status).expect("status serializes"),
        ];
        assert!(surfaces.iter().all(|surface| !surface.contains(CANARY)));
        assert!(
            store
                .keychain
                .writes
                .iter()
                .flatten()
                .copied()
                .collect::<Vec<_>>()
                .windows(CANARY.len())
                .all(|window| window != CANARY.as_bytes())
        );

        store.keychain.fail = true;
        let error = store
            .install_session(
                material(&canary_access),
                material(VALID_REFRESH),
                "2026-08-15T04:01:00Z",
            )
            .expect_err("keychain failure must fail closed");
        assert_eq!(error, SessionStoreError::KeychainUnavailable);
        assert!(!format!("{error:?}").contains(CANARY));
        assert!(!error.to_string().contains(CANARY));
        assert_eq!(store.status().state(), AuthSessionState::SignedOut);
    }

    #[test]
    fn non_remembered_refresh_is_memory_only_and_process_exit_requires_login() {
        let ephemeral_refresh = VALID_REFRESH.replace("true", "false");
        let mut store = HostSessionStore::new(FakeKeychain::default());
        let status = store
            .install_session(
                material(VALID_ACCESS),
                material(&ephemeral_refresh),
                "2026-08-15T04:01:00Z",
            )
            .expect("ephemeral session installs");

        assert_eq!(status.state(), AuthSessionState::Authenticated);
        assert!(store.keychain.writes.is_empty());
        assert!(store.ephemeral_refresh_for_transport().is_some());
        drop(store);

        let mut restarted = HostSessionStore::new(FakeKeychain::default());
        assert!(
            restarted
                .load_startup_refresh(scope())
                .expect("keychain read")
                .is_none()
        );
        assert_eq!(restarted.status().state(), AuthSessionState::SignedOut);
    }

    #[test]
    fn access_expiry_projects_refresh_required_and_retryable_failure_preserves_it() {
        let mut store = HostSessionStore::new(FakeKeychain::default());
        install(&mut store);
        assert_eq!(
            store.mark_access_token_expired().state(),
            AuthSessionState::RefreshRequired
        );
        assert_eq!(
            store.note_retryable_refresh_failure().state(),
            AuthSessionState::RefreshRequired
        );
    }

    #[test]
    fn startup_load_returns_a_redacted_host_only_refresh_credential() {
        let keychain = FakeKeychain {
            stored: Some(VALID_REFRESH.as_bytes().to_vec()),
            ..FakeKeychain::default()
        };
        let mut store = HostSessionStore::new(keychain);
        let credential = store
            .load_startup_refresh(scope())
            .expect("keychain read")
            .expect("remembered credential");

        assert_eq!(credential.account_id(), "account-01");
        assert_eq!(credential.device_id(), "device-01");
        assert_eq!(credential.session_id(), "session-01");
        assert_eq!(credential.family_id(), "family-01");
        assert_eq!(credential.rotation_generation(), 0);
        assert_eq!(
            credential.expose_for_refresh_transport(),
            VALID_REFRESH.as_bytes()
        );
        assert_eq!(
            format!("{credential:?}"),
            "StartupRefreshCredential([REDACTED])"
        );
        assert!(!format!("{credential:?}").contains("auth-refresh-jti-01"));
    }

    #[test]
    fn invalid_stored_refresh_fails_closed_without_exposing_keychain_error_detail() {
        let keychain = FakeKeychain {
            stored: Some(CANARY.as_bytes().to_vec()),
            ..FakeKeychain::default()
        };
        let mut store = HostSessionStore::new(keychain);

        let error = store
            .load_startup_refresh(scope())
            .expect_err("invalid stored material must fail closed");
        assert_eq!(error, SessionStoreError::KeychainUnavailable);
        assert!(!format!("{error:?}").contains(CANARY));
        assert!(!error.to_string().contains(CANARY));
        assert_eq!(store.status().state(), AuthSessionState::SignedOut);
    }

    #[test]
    fn explicit_sign_out_requires_confirmed_keychain_deletion() {
        let mut store = HostSessionStore::new(FakeKeychain::default());
        install(&mut store);
        store.keychain.fail = true;

        let error = store
            .sign_out()
            .expect_err("durable deletion failure must retain the session");
        assert_eq!(error, SessionStoreError::KeychainUnavailable);
        assert_eq!(store.status().state(), AuthSessionState::Authenticated);
        assert!(!format!("{error:?}").contains(CANARY));
        assert!(!error.to_string().contains(CANARY));

        store.keychain.fail = false;
        assert_eq!(
            store.sign_out().expect("durable deletion").state(),
            AuthSessionState::SignedOut
        );
        assert!(store.keychain.stored.is_none());
    }

    #[test]
    fn every_authoritative_silent_recovery_rejection_fails_to_signed_out() {
        let rejections = [
            SilentRecoveryRejection::UserSignedOut,
            SilentRecoveryRejection::RemoteSignOut,
            SilentRecoveryRejection::RefreshReuseDetected,
            SilentRecoveryRejection::AccountSecurityEpochAdvanced,
            SilentRecoveryRejection::DeviceRemoved,
            SilentRecoveryRejection::AccountRecoveryPending,
            SilentRecoveryRejection::RecoveryPending,
        ];
        for rejection in rejections {
            let mut store = HostSessionStore::new(FakeKeychain::default());
            install(&mut store);
            let status = store.reject_silent_recovery(scope(), rejection);
            assert_eq!(status.state(), AuthSessionState::SignedOut);
            assert_eq!(store.keychain.deletes, 1);
            assert!(store.session.is_none());
        }
    }

    #[test]
    fn mismatched_pair_and_malformed_input_fail_without_leaking_material() {
        let mismatched_refresh = VALID_REFRESH.replace("account-01", "account-02");
        let mut store = HostSessionStore::new(FakeKeychain::default());
        assert_eq!(
            store.install_session(
                material(VALID_ACCESS),
                material(&mismatched_refresh),
                "2026-08-15T04:01:00Z",
            ),
            Err(SessionStoreError::EnvelopeMismatch)
        );
        let malformed = format!("{{\"token\":\"{CANARY}\"}}");
        let error = store
            .install_session(
                material(&malformed),
                material(VALID_REFRESH),
                "2026-08-15T04:01:00Z",
            )
            .expect_err("malformed token must fail closed");
        assert_eq!(error, SessionStoreError::InvalidEnvelope);
        assert!(!format!("{error:?}").contains(CANARY));
        assert!(!error.to_string().contains(CANARY));
        assert!(store.keychain.writes.is_empty());
    }

    #[test]
    fn malformed_rotation_response_clears_an_existing_in_memory_session() {
        let mut store = HostSessionStore::new(FakeKeychain::default());
        install(&mut store);
        assert_eq!(store.status().state(), AuthSessionState::Authenticated);

        assert_eq!(
            store.install_session(
                material(CANARY),
                material(VALID_REFRESH),
                "2026-08-15T04:01:00Z",
            ),
            Err(SessionStoreError::InvalidEnvelope)
        );
        assert_eq!(store.status().state(), AuthSessionState::SignedOut);
    }
}
