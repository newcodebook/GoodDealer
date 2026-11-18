//! Private, purpose-separated backup authority verification and monotonic state.

use std::collections::BTreeMap;
use std::fmt;
use std::time::{Duration, Instant};

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use ring::signature::{ED25519, UnparsedPublicKey};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use zeroize::Zeroize;

const EXPECTED_ISSUER: &str = "https://accounts.gooddealer.com";
const EXPECTED_LEASE_TYPE: &str = "gd.active-device-lease.v1";
const EXPECTED_LEASE_AUDIENCE: &str = "gooddealer-desktop/active-device-lease";
const LEASE_SIGNATURE_DOMAIN: &str = "GOODDEALER-ACTIVE-DEVICE-LEASE-V1";
const EXPECTED_GRANT_TYPE: &str = "gd.desktop-authorization-grant.v3";
const EXPECTED_GRANT_AUDIENCE: &str = "gooddealer-desktop/local-business";
const GRANT_SIGNATURE_DOMAIN: &str = "GOODDEALER-DESKTOP-AUTHORIZATION-GRANT-V3";
const MAX_OFFLINE_WINDOW_SECONDS: i64 = 86_400;
pub(super) const MAX_SIGNED_WIRE_BYTES: usize = 16_384;
const MAX_REGISTRY_BYTES: usize = 16_384;
const MAX_REGISTRY_KEYS: usize = 16;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
const ED25519_PUBLIC_KEY_BYTES: usize = 32;
const ED25519_SIGNATURE_BYTES: usize = 64;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum BackupAuthorityError {
    Malformed,
    SignatureRejected,
    ScopeRejected,
    Expired,
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "rollback classification is exercised by the private monotonic-authority protocol"
        )
    )]
    RollbackRejected,
    Unavailable,
}

impl fmt::Display for BackupAuthorityError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Malformed => "BACKUP_AUTHORITY_MALFORMED",
            Self::SignatureRejected => "BACKUP_AUTHORITY_SIGNATURE_REJECTED",
            Self::ScopeRejected => "BACKUP_AUTHORITY_SCOPE_REJECTED",
            Self::Expired => "BACKUP_AUTHORITY_EXPIRED",
            Self::RollbackRejected => "BACKUP_AUTHORITY_ROLLBACK_REJECTED",
            Self::Unavailable => "BACKUP_AUTHORITY_UNAVAILABLE",
        })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum CredentialPurpose {
    GrantV3,
    ActiveDeviceLeaseV1,
}

struct VerificationKey {
    purpose: CredentialPurpose,
    key_id: String,
    public_key: [u8; ED25519_PUBLIC_KEY_BYTES],
}

impl VerificationKey {
    fn new(
        purpose: CredentialPurpose,
        key_id: &str,
        public_key: &[u8],
    ) -> Result<Self, BackupAuthorityError> {
        if !valid_identifier(key_id) {
            return Err(BackupAuthorityError::Malformed);
        }
        Ok(Self {
            purpose,
            key_id: key_id.to_owned(),
            public_key: public_key
                .try_into()
                .map_err(|_| BackupAuthorityError::Malformed)?,
        })
    }
}

/// Immutable build-pinned verifier. It is private so callers cannot substitute trust roots.
pub(super) struct BackupAuthorityVerifier {
    keys: BTreeMap<(CredentialPurpose, String), [u8; ED25519_PUBLIC_KEY_BYTES]>,
}

impl BackupAuthorityVerifier {
    pub(super) fn production() -> Result<Self, BackupAuthorityError> {
        let registry = option_env!("GOODDEALER_DESKTOP_AUTHORIZATION_KEYS_JSON")
            .ok_or(BackupAuthorityError::Unavailable)?;
        Self::parse_registry(registry)
    }

    fn parse_registry(value: &str) -> Result<Self, BackupAuthorityError> {
        if value.is_empty() || value.len() > MAX_REGISTRY_BYTES {
            return Err(BackupAuthorityError::Malformed);
        }
        let registry: VerificationRegistryWire =
            serde_json::from_str(value).map_err(|_| BackupAuthorityError::Malformed)?;
        if registry.schema_version != 1
            || registry.keys.is_empty()
            || registry.keys.len() > MAX_REGISTRY_KEYS
        {
            return Err(BackupAuthorityError::Malformed);
        }
        let mut has_grant = false;
        let mut has_lease = false;
        let mut keys = Vec::with_capacity(registry.keys.len());
        for wire in registry.keys {
            let purpose = match wire.purpose {
                VerificationPurposeWire::GrantV3 => {
                    has_grant = true;
                    CredentialPurpose::GrantV3
                }
                VerificationPurposeWire::ActiveDeviceLeaseV1 => {
                    has_lease = true;
                    CredentialPurpose::ActiveDeviceLeaseV1
                }
            };
            let decoded = URL_SAFE_NO_PAD
                .decode(wire.public_key.as_bytes())
                .map_err(|_| BackupAuthorityError::Malformed)?;
            if URL_SAFE_NO_PAD.encode(&decoded) != wire.public_key {
                return Err(BackupAuthorityError::Malformed);
            }
            keys.push(VerificationKey::new(purpose, &wire.key_id, &decoded)?);
        }
        if !has_grant || !has_lease {
            return Err(BackupAuthorityError::Malformed);
        }
        Self::from_keys(keys)
    }

    fn from_keys(
        keys: impl IntoIterator<Item = VerificationKey>,
    ) -> Result<Self, BackupAuthorityError> {
        let mut registry = BTreeMap::new();
        for key in keys {
            if registry.keys().any(|(_, key_id)| key_id == &key.key_id)
                || registry
                    .values()
                    .any(|material| material == &key.public_key)
                || registry
                    .insert((key.purpose, key.key_id), key.public_key)
                    .is_some()
            {
                return Err(BackupAuthorityError::Malformed);
            }
        }
        Ok(Self { keys: registry })
    }

    fn verify(
        &self,
        purpose: CredentialPurpose,
        key_id: &str,
        transcript: &[u8],
        signature: &str,
    ) -> bool {
        let Some(public_key) = self.keys.get(&(purpose, key_id.to_owned())) else {
            return false;
        };
        let Ok(signature) = URL_SAFE_NO_PAD.decode(signature) else {
            return false;
        };
        signature.len() == ED25519_SIGNATURE_BYTES
            && UnparsedPublicKey::new(&ED25519, public_key)
                .verify(transcript, &signature)
                .is_ok()
    }

    #[cfg(test)]
    pub(super) fn for_test(
        grant_key_id: &str,
        grant_public_key: &[u8],
        lease_key_id: &str,
        lease_public_key: &[u8],
    ) -> Result<Self, BackupAuthorityError> {
        Self::from_keys([
            VerificationKey::new(CredentialPurpose::GrantV3, grant_key_id, grant_public_key)?,
            VerificationKey::new(
                CredentialPurpose::ActiveDeviceLeaseV1,
                lease_key_id,
                lease_public_key,
            )?,
        ])
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct VerificationRegistryWire {
    schema_version: u8,
    keys: Vec<VerificationKeyWire>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct VerificationKeyWire {
    purpose: VerificationPurposeWire,
    key_id: String,
    public_key: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
enum VerificationPurposeWire {
    GrantV3,
    ActiveDeviceLeaseV1,
}

/// Host-owned binding and monotonic floors used during signed-wire verification.
pub(super) struct TrustedBackupBinding<'a> {
    pub(super) account_id: Option<&'a str>,
    pub(super) device_id: &'a str,
    pub(super) minimum_account_security_epoch: u64,
    pub(super) minimum_lease_epoch: u64,
}

/// Fully verified backup authority. Every identity and deadline remains crate-private.
pub(super) struct VerifiedBackupAuthority {
    workspace_id: String,
    account_id: String,
    device_id: String,
    account_security_epoch: u64,
    lease_epoch: u64,
    execute_before: i64,
    admitted_not_before: i64,
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "the standalone monotonic deadline check is retained for private authority protocol tests"
        )
    )]
    monotonic_deadline: Instant,
    entitlement_revision: u64,
    entitlement_projection_digest: String,
    commercial_expires_at: String,
    capability: String,
}

/// Borrowed monotonic floor for comparing a verified replacement with the authority already
/// published by another private aggregate representation. Keeping the comparison here prevents
/// the signed-authority and `LocalHost` snapshots from drifting on commercial payload semantics.
pub(super) struct BackupAuthorityReplacementFloor<'a> {
    pub(super) workspace_id: &'a str,
    pub(super) account_id: &'a str,
    pub(super) device_id: &'a str,
    pub(super) account_security_epoch: u64,
    pub(super) lease_epoch: u64,
    pub(super) entitlement_revision: u64,
    pub(super) entitlement_projection_digest: &'a str,
    pub(super) commercial_expires_at: &'a str,
    pub(super) capability: &'a str,
}

impl VerifiedBackupAuthority {
    pub(super) fn verify(
        wire: &[u8],
        binding: &TrustedBackupBinding<'_>,
        now: i64,
        verifier: &BackupAuthorityVerifier,
    ) -> Result<Self, BackupAuthorityError> {
        if wire.is_empty() || wire.len() > MAX_SIGNED_WIRE_BYTES {
            return Err(BackupAuthorityError::Malformed);
        }
        let mut deserializer = serde_json::Deserializer::from_slice(wire);
        let grant = DesktopAuthorizationGrant::deserialize(&mut deserializer)
            .map_err(|_| BackupAuthorityError::Malformed)?;
        deserializer
            .end()
            .map_err(|_| BackupAuthorityError::Malformed)?;
        grant.validate_shape()?;
        if !verifier.verify(
            CredentialPurpose::GrantV3,
            &grant.kid,
            &grant.signature_transcript(),
            &grant.signature,
        ) || !verifier.verify(
            CredentialPurpose::ActiveDeviceLeaseV1,
            &grant.active_device_lease.kid,
            &grant.active_device_lease.signature_transcript(),
            &grant.active_device_lease.signature,
        ) {
            return Err(BackupAuthorityError::SignatureRejected);
        }
        let DesktopAuthorizationGrant {
            workspace,
            active_device_lease: lease,
            commercial_authority,
            ..
        } = grant;
        if binding
            .account_id
            .is_some_and(|value| lease.account_id != value)
            || lease.device_id != binding.device_id
            || lease.account_security_epoch < binding.minimum_account_security_epoch
            || lease.payload.lease_epoch < binding.minimum_lease_epoch
        {
            return Err(BackupAuthorityError::ScopeRejected);
        }
        let issued_at = parse_canonical_utc(&lease.issued_at)?;
        let execute_before = parse_canonical_utc(&lease.payload.offline_execute_until)?;
        let commercial_deadline = parse_canonical_utc(&commercial_authority.commercial_expires_at)?;
        let effective_deadline = execute_before.min(commercial_deadline);
        if now < issued_at || now >= effective_deadline {
            return Err(BackupAuthorityError::Expired);
        }
        let remaining =
            u64::try_from(effective_deadline - now).map_err(|_| BackupAuthorityError::Expired)?;
        Ok(Self {
            workspace_id: workspace.workspace_id,
            account_id: lease.account_id,
            device_id: lease.device_id,
            account_security_epoch: lease.account_security_epoch,
            lease_epoch: lease.payload.lease_epoch,
            execute_before: effective_deadline,
            admitted_not_before: now,
            monotonic_deadline: Instant::now()
                .checked_add(Duration::from_secs(remaining))
                .ok_or(BackupAuthorityError::Expired)?,
            entitlement_revision: commercial_authority.entitlement_revision,
            entitlement_projection_digest: commercial_authority.entitlement_projection_digest,
            commercial_expires_at: commercial_authority.commercial_expires_at,
            capability: commercial_authority.capability,
        })
    }

    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "the Local Host performs the production time fence on its published authority snapshot"
        )
    )]
    pub(super) fn allows_at(&self, now: i64) -> bool {
        now >= self.admitted_not_before
            && now < self.execute_before
            && Instant::now() < self.monotonic_deadline
    }

    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "the Local Host compares replacements through the shared floor representation"
        )
    )]
    pub(super) fn can_replace_with(&self, other: &Self) -> bool {
        other.can_replace_floor(&self.replacement_floor())
    }

    pub(super) fn can_replace_floor(&self, current: &BackupAuthorityReplacementFloor<'_>) -> bool {
        let commercial_payload_advances =
            if current.entitlement_revision == self.entitlement_revision {
                current.entitlement_projection_digest == self.entitlement_projection_digest
                    && current.commercial_expires_at == self.commercial_expires_at
            } else if current.entitlement_projection_digest == self.entitlement_projection_digest {
                current.commercial_expires_at == self.commercial_expires_at
            } else {
                true
            };
        current.workspace_id == self.workspace_id
            && current.account_id == self.account_id
            && current.device_id == self.device_id
            && current.account_security_epoch <= self.account_security_epoch
            && current.lease_epoch <= self.lease_epoch
            && current.entitlement_revision <= self.entitlement_revision
            && current.capability == self.capability
            && commercial_payload_advances
    }

    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "the owned-to-borrowed floor adapter is retained for monotonic protocol tests"
        )
    )]
    fn replacement_floor(&self) -> BackupAuthorityReplacementFloor<'_> {
        BackupAuthorityReplacementFloor {
            workspace_id: &self.workspace_id,
            account_id: &self.account_id,
            device_id: &self.device_id,
            account_security_epoch: self.account_security_epoch,
            lease_epoch: self.lease_epoch,
            entitlement_revision: self.entitlement_revision,
            entitlement_projection_digest: &self.entitlement_projection_digest,
            commercial_expires_at: &self.commercial_expires_at,
            capability: &self.capability,
        }
    }

    pub(super) fn workspace_id(&self) -> &str {
        &self.workspace_id
    }

    pub(super) fn account_id(&self) -> &str {
        &self.account_id
    }

    pub(super) fn device_id(&self) -> &str {
        &self.device_id
    }

    pub(super) const fn account_security_epoch(&self) -> u64 {
        self.account_security_epoch
    }

    pub(super) const fn lease_epoch(&self) -> u64 {
        self.lease_epoch
    }

    pub(super) const fn execute_before(&self) -> i64 {
        self.execute_before
    }

    pub(super) const fn trusted_time_floor(&self) -> i64 {
        self.admitted_not_before
    }

    pub(super) const fn entitlement_revision(&self) -> u64 {
        self.entitlement_revision
    }

    pub(super) fn entitlement_projection_digest(&self) -> &str {
        &self.entitlement_projection_digest
    }

    pub(super) fn commercial_expires_at(&self) -> &str {
        &self.commercial_expires_at
    }

    pub(super) fn capability(&self) -> &str {
        &self.capability
    }

    #[expect(
        dead_code,
        reason = "raw binding digest tuples stay private to authority protocol verification"
    )]
    pub(super) fn binding_digests(&self) -> ([u8; 32], [u8; 32], [u8; 32], [u8; 32]) {
        let account = digest_domain(
            b"GOODDEALER/BACKUP-ACCOUNT-V1\0",
            self.account_id.as_bytes(),
        );
        let device = digest_domain(b"GOODDEALER/BACKUP-DEVICE-V1\0", self.device_id.as_bytes());
        let workspace = digest_domain(
            b"GOODDEALER/BACKUP-WORKSPACE-V1\0",
            self.workspace_id.as_bytes(),
        );
        let mut binding = Sha256::new();
        binding.update(b"GOODDEALER/BACKUP-BINDING-V1\0");
        binding.update(account);
        binding.update(device);
        binding.update(workspace);
        (account, device, workspace, binding.finalize().into())
    }

    pub(super) fn authority_floor_digest(&self) -> [u8; 32] {
        let mut digest = Sha256::new();
        digest.update(b"GOODDEALER/BACKUP-AUTHORITY-FLOOR-V1\0");
        digest.update(self.account_security_epoch.to_be_bytes());
        digest.update(self.lease_epoch.to_be_bytes());
        digest.update(self.entitlement_revision.to_be_bytes());
        digest.update(self.entitlement_projection_digest.as_bytes());
        digest.update(self.commercial_expires_at.as_bytes());
        digest.finalize().into()
    }

    pub(super) fn snapshot_digest_hex(&self) -> String {
        let mut digest = Sha256::new();
        digest.update(b"GOODDEALER/BACKUP-AUTHORITY-SNAPSHOT-V1\0");
        digest.update(self.authority_floor_digest());
        digest.update(self.execute_before.to_be_bytes());
        digest.update(self.capability.as_bytes());
        digest
            .finalize()
            .iter()
            .fold(String::with_capacity(64), |mut value, byte| {
                use std::fmt::Write as _;
                write!(value, "{byte:02x}").expect("writing a digest into String cannot fail");
                value
            })
    }
}

impl Drop for VerifiedBackupAuthority {
    fn drop(&mut self) {
        self.workspace_id.zeroize();
        self.account_id.zeroize();
        self.device_id.zeroize();
        self.entitlement_projection_digest.zeroize();
        self.commercial_expires_at.zeroize();
        self.capability.zeroize();
    }
}

/// Authority state updated only after the aggregate publishes a transition intent.
#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "the standalone monotonic state machine is retained as private protocol evidence"
    )
)]
pub(super) struct MonotonicBackupAuthority {
    current: Option<VerifiedBackupAuthority>,
    applied_epoch: u64,
    exhausted: bool,
}

#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "the standalone monotonic state machine is retained as private protocol evidence"
    )
)]
impl MonotonicBackupAuthority {
    pub(super) const fn unavailable() -> Self {
        Self {
            current: None,
            applied_epoch: 0,
            exhausted: false,
        }
    }

    pub(super) fn apply_replacement(
        &mut self,
        requested_epoch: u64,
        replacement: VerifiedBackupAuthority,
    ) -> Result<(), BackupAuthorityError> {
        if self.exhausted
            || requested_epoch == 0
            || requested_epoch != self.applied_epoch.checked_add(1).unwrap_or(0)
            || self
                .current
                .as_ref()
                .is_some_and(|current| !current.can_replace_with(&replacement))
        {
            self.current = None;
            if self.applied_epoch == u64::MAX {
                self.exhausted = true;
            }
            return Err(BackupAuthorityError::RollbackRejected);
        }
        self.current = Some(replacement);
        self.applied_epoch = requested_epoch;
        Ok(())
    }

    #[expect(
        dead_code,
        reason = "the standalone restriction transition remains private protocol evidence"
    )]
    pub(super) fn apply_restriction(
        &mut self,
        requested_epoch: u64,
    ) -> Result<(), BackupAuthorityError> {
        if self.exhausted
            || requested_epoch == 0
            || requested_epoch != self.applied_epoch.checked_add(1).unwrap_or(0)
        {
            self.current = None;
            if self.applied_epoch == u64::MAX {
                self.exhausted = true;
            }
            return Err(BackupAuthorityError::RollbackRejected);
        }
        self.current = None;
        self.applied_epoch = requested_epoch;
        Ok(())
    }

    pub(super) const fn applied_epoch(&self) -> u64 {
        self.applied_epoch
    }

    pub(super) fn current_at(
        &self,
        requested_epoch: u64,
        now: i64,
    ) -> Result<&VerifiedBackupAuthority, BackupAuthorityError> {
        if self.exhausted || requested_epoch != self.applied_epoch {
            return Err(BackupAuthorityError::RollbackRejected);
        }
        self.current
            .as_ref()
            .filter(|authority| authority.allows_at(now))
            .ok_or(BackupAuthorityError::Expired)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DesktopAuthorizationGrant {
    schema_version: u8,
    typ: String,
    iss: String,
    aud: String,
    kid: String,
    issued_at: String,
    expires_at: String,
    workspace: AuthorizedWorkspaceWire,
    active_device_lease: ActiveDeviceLeaseEnvelope,
    scopes: [String; 2],
    commercial_authority: CommercialAuthority,
    signature: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AuthorizedWorkspaceWire {
    workspace_id: String,
    kind: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CommercialAuthority {
    schema_version: u8,
    entitlement_revision: u64,
    entitlement_projection_digest: String,
    state: String,
    commercial_expires_at: String,
    capability: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ActiveDeviceLeaseEnvelope {
    schema_version: u8,
    typ: String,
    iss: String,
    aud: String,
    kid: String,
    account_id: String,
    device_id: String,
    account_security_epoch: u64,
    jti: String,
    issued_at: String,
    expires_at: String,
    payload: ActiveDeviceLeasePayload,
    signature: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ActiveDeviceLeasePayload {
    lease_epoch: u64,
    renew_after: String,
    online_expires_at: String,
    offline_execute_until: String,
}

impl DesktopAuthorizationGrant {
    fn validate_shape(&self) -> Result<(), BackupAuthorityError> {
        if self.schema_version != 3
            || self.typ != EXPECTED_GRANT_TYPE
            || self.iss != EXPECTED_ISSUER
            || self.aud != EXPECTED_GRANT_AUDIENCE
            || !valid_identifier(&self.kid)
            || !valid_base64_url(&self.signature)
            || self.workspace.kind != "personal_default"
            || !valid_identifier(&self.workspace.workspace_id)
            || self.scopes != ["workspace:mutate", "workspace:read"]
            || self.commercial_authority.schema_version != 1
            || self.commercial_authority.entitlement_revision == 0
            || self.commercial_authority.entitlement_revision > MAX_SAFE_INTEGER
            || self
                .commercial_authority
                .entitlement_projection_digest
                .len()
                != 64
            || !self
                .commercial_authority
                .entitlement_projection_digest
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
            || self.commercial_authority.state != "active"
            || self.commercial_authority.capability != "cloudflare:dns:observe"
            || self.issued_at != self.active_device_lease.issued_at
            || self.expires_at != self.active_device_lease.expires_at
        {
            return Err(BackupAuthorityError::Malformed);
        }
        self.active_device_lease.validate_shape()
    }

    fn signature_transcript(&self) -> Vec<u8> {
        let envelope = canonical_object([
            (
                "activeDeviceLease",
                self.active_device_lease.signed_envelope(),
            ),
            ("aud", canonical_string(&self.aud)),
            ("expiresAt", canonical_string(&self.expires_at)),
            ("iss", canonical_string(&self.iss)),
            ("issuedAt", canonical_string(&self.issued_at)),
            ("kid", canonical_string(&self.kid)),
            (
                "schemaVersion",
                canonical_number(u64::from(self.schema_version)),
            ),
            (
                "scopes",
                canonical_array([
                    canonical_string(&self.scopes[0]),
                    canonical_string(&self.scopes[1]),
                ]),
            ),
            ("typ", canonical_string(&self.typ)),
            (
                "commercialAuthority",
                canonical_object([
                    (
                        "capability",
                        canonical_string(&self.commercial_authority.capability),
                    ),
                    (
                        "commercialExpiresAt",
                        canonical_string(&self.commercial_authority.commercial_expires_at),
                    ),
                    (
                        "entitlementProjectionDigest",
                        canonical_string(&self.commercial_authority.entitlement_projection_digest),
                    ),
                    (
                        "entitlementRevision",
                        canonical_number(self.commercial_authority.entitlement_revision),
                    ),
                    (
                        "schemaVersion",
                        canonical_number(u64::from(self.commercial_authority.schema_version)),
                    ),
                    ("state", canonical_string(&self.commercial_authority.state)),
                ]),
            ),
            (
                "workspace",
                canonical_object([
                    ("kind", canonical_string(&self.workspace.kind)),
                    (
                        "workspaceId",
                        canonical_string(&self.workspace.workspace_id),
                    ),
                ]),
            ),
        ]);
        [
            frame(b'd', GRANT_SIGNATURE_DOMAIN.as_bytes()),
            frame(b'v', &envelope),
        ]
        .concat()
    }
}

impl ActiveDeviceLeaseEnvelope {
    fn validate_shape(&self) -> Result<(), BackupAuthorityError> {
        let issued = parse_canonical_utc(&self.issued_at)?;
        let expires = parse_canonical_utc(&self.expires_at)?;
        let renew = parse_canonical_utc(&self.payload.renew_after)?;
        let online = parse_canonical_utc(&self.payload.online_expires_at)?;
        let offline = parse_canonical_utc(&self.payload.offline_execute_until)?;
        if self.schema_version != 1
            || self.typ != EXPECTED_LEASE_TYPE
            || self.iss != EXPECTED_ISSUER
            || self.aud != EXPECTED_LEASE_AUDIENCE
            || !valid_identifier(&self.kid)
            || !valid_identifier(&self.account_id)
            || !valid_identifier(&self.device_id)
            || self.account_security_epoch == 0
            || self.account_security_epoch > MAX_SAFE_INTEGER
            || !valid_identifier(&self.jti)
            || self.payload.lease_epoch == 0
            || self.payload.lease_epoch > MAX_SAFE_INTEGER
            || !valid_base64_url(&self.signature)
            || issued >= expires
            || renew <= issued
            || online <= renew
            || offline < online
            || offline != expires
            || offline - issued > MAX_OFFLINE_WINDOW_SECONDS
        {
            return Err(BackupAuthorityError::Malformed);
        }
        Ok(())
    }

    fn signature_transcript(&self) -> Vec<u8> {
        let envelope = self.unsigned_envelope();
        [
            frame(b'd', LEASE_SIGNATURE_DOMAIN.as_bytes()),
            frame(b'v', &envelope),
        ]
        .concat()
    }

    fn unsigned_envelope(&self) -> Vec<u8> {
        canonical_object([
            ("accountId", canonical_string(&self.account_id)),
            (
                "accountSecurityEpoch",
                canonical_number(self.account_security_epoch),
            ),
            ("aud", canonical_string(&self.aud)),
            ("deviceId", canonical_string(&self.device_id)),
            ("expiresAt", canonical_string(&self.expires_at)),
            ("iss", canonical_string(&self.iss)),
            ("issuedAt", canonical_string(&self.issued_at)),
            ("jti", canonical_string(&self.jti)),
            ("kid", canonical_string(&self.kid)),
            (
                "payload",
                canonical_object([
                    ("leaseEpoch", canonical_number(self.payload.lease_epoch)),
                    (
                        "offlineExecuteUntil",
                        canonical_string(&self.payload.offline_execute_until),
                    ),
                    (
                        "onlineExpiresAt",
                        canonical_string(&self.payload.online_expires_at),
                    ),
                    ("renewAfter", canonical_string(&self.payload.renew_after)),
                ]),
            ),
            (
                "schemaVersion",
                canonical_number(u64::from(self.schema_version)),
            ),
            ("typ", canonical_string(&self.typ)),
        ])
    }

    fn signed_envelope(&self) -> Vec<u8> {
        canonical_object([
            ("accountId", canonical_string(&self.account_id)),
            (
                "accountSecurityEpoch",
                canonical_number(self.account_security_epoch),
            ),
            ("aud", canonical_string(&self.aud)),
            ("deviceId", canonical_string(&self.device_id)),
            ("expiresAt", canonical_string(&self.expires_at)),
            ("iss", canonical_string(&self.iss)),
            ("issuedAt", canonical_string(&self.issued_at)),
            ("jti", canonical_string(&self.jti)),
            ("kid", canonical_string(&self.kid)),
            (
                "payload",
                canonical_object([
                    ("leaseEpoch", canonical_number(self.payload.lease_epoch)),
                    (
                        "offlineExecuteUntil",
                        canonical_string(&self.payload.offline_execute_until),
                    ),
                    (
                        "onlineExpiresAt",
                        canonical_string(&self.payload.online_expires_at),
                    ),
                    ("renewAfter", canonical_string(&self.payload.renew_after)),
                ]),
            ),
            (
                "schemaVersion",
                canonical_number(u64::from(self.schema_version)),
            ),
            ("signature", canonical_string(&self.signature)),
            ("typ", canonical_string(&self.typ)),
        ])
    }
}

fn valid_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 160
        && value.bytes().all(|byte| (0x21..=0x7e).contains(&byte))
}

fn valid_base64_url(value: &str) -> bool {
    !value.is_empty()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
}

#[expect(
    dead_code,
    reason = "domain digesting is retained for private binding-digest protocol verification"
)]
fn digest_domain(domain: &[u8], value: &[u8]) -> [u8; 32] {
    let mut digest = Sha256::new();
    digest.update(domain);
    digest.update(value.len().to_be_bytes());
    digest.update(value);
    digest.finalize().into()
}

fn canonical_string(value: &str) -> Vec<u8> {
    frame(b's', value.as_bytes())
}
fn canonical_number(value: u64) -> Vec<u8> {
    frame(b'n', value.to_string().as_bytes())
}

fn canonical_array<const N: usize>(entries: [Vec<u8>; N]) -> Vec<u8> {
    let entries = entries
        .into_iter()
        .flat_map(|value| frame(b'e', &value))
        .collect::<Vec<_>>();
    frame(b'a', &entries)
}

fn canonical_object<const N: usize>(mut fields: [(&str, Vec<u8>); N]) -> Vec<u8> {
    fields.sort_unstable_by_key(|(key, _)| *key);
    let entries = fields
        .into_iter()
        .flat_map(|(key, value)| {
            frame(
                b'e',
                &[frame(b'k', key.as_bytes()), frame(b'v', &value)].concat(),
            )
        })
        .collect::<Vec<_>>();
    frame(b'o', &entries)
}

fn frame(tag: u8, payload: &[u8]) -> Vec<u8> {
    let mut value = Vec::with_capacity(1 + 20 + payload.len());
    value.push(tag);
    value.extend_from_slice(payload.len().to_string().as_bytes());
    value.push(b':');
    value.extend_from_slice(payload);
    value
}

fn parse_canonical_utc(value: &str) -> Result<i64, BackupAuthorityError> {
    let bytes = value.as_bytes();
    if bytes.len() != 20
        || bytes[4] != b'-'
        || bytes[7] != b'-'
        || bytes[10] != b'T'
        || bytes[13] != b':'
        || bytes[16] != b':'
        || bytes[19] != b'Z'
    {
        return Err(BackupAuthorityError::Malformed);
    }
    let year = decimal(bytes, 0, 4)?;
    let month = decimal(bytes, 5, 2)?;
    let day = decimal(bytes, 8, 2)?;
    let hour = decimal(bytes, 11, 2)?;
    let minute = decimal(bytes, 14, 2)?;
    let second = decimal(bytes, 17, 2)?;
    if !(1970..=9999).contains(&year)
        || !(1..=12).contains(&month)
        || day == 0
        || day > days_in_month(year, month)
        || hour > 23
        || minute > 59
        || second > 59
    {
        return Err(BackupAuthorityError::Malformed);
    }
    let days = days_before_year(year) + days_before_month(year, month) + i64::from(day - 1);
    Ok(days * 86_400 + i64::from(hour * 3_600 + minute * 60 + second))
}

fn decimal(bytes: &[u8], start: usize, length: usize) -> Result<u32, BackupAuthorityError> {
    bytes[start..start + length]
        .iter()
        .try_fold(0_u32, |value, byte| {
            byte.is_ascii_digit()
                .then(|| value * 10 + u32::from(byte - b'0'))
                .ok_or(BackupAuthorityError::Malformed)
        })
}

fn is_leap_year(year: u32) -> bool {
    year.is_multiple_of(4) && (!year.is_multiple_of(100) || year.is_multiple_of(400))
}
fn days_in_month(year: u32, month: u32) -> u32 {
    match month {
        2 if is_leap_year(year) => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}
fn days_before_year(year: u32) -> i64 {
    let previous = i64::from(year - 1);
    let baseline = 1969_i64;
    (previous - baseline) * 365 + (previous / 4 - baseline / 4) - (previous / 100 - baseline / 100)
        + (previous / 400 - baseline / 400)
}
fn days_before_month(year: u32, month: u32) -> i64 {
    (1..month)
        .map(|value| i64::from(days_in_month(year, value)))
        .sum()
}

#[cfg(test)]
pub(crate) mod tests {
    use ring::signature::{Ed25519KeyPair, KeyPair as _};
    use serde_json::json;

    use super::*;

    fn signed_grant(grant_pair: &Ed25519KeyPair, lease_pair: &Ed25519KeyPair) -> Vec<u8> {
        let mut value = json!({
            "schemaVersion":3,"typ":EXPECTED_GRANT_TYPE,"iss":EXPECTED_ISSUER,
            "aud":EXPECTED_GRANT_AUDIENCE,"kid":"grant-key-1",
            "issuedAt":"2026-08-29T00:00:00Z","expiresAt":"2026-08-30T00:00:00Z",
            "workspace":{"workspaceId":"workspace-local","kind":"personal_default"},
            "activeDeviceLease":{"schemaVersion":1,"typ":EXPECTED_LEASE_TYPE,"iss":EXPECTED_ISSUER,
                "aud":EXPECTED_LEASE_AUDIENCE,"kid":"lease-key-1","accountId":"account-local",
                "deviceId":"device-local","accountSecurityEpoch":4,"jti":"lease-local",
                "issuedAt":"2026-08-29T00:00:00Z","expiresAt":"2026-08-30T00:00:00Z",
                "payload":{"leaseEpoch":7,"renewAfter":"2026-08-29T06:00:00Z",
                    "onlineExpiresAt":"2026-08-29T12:00:00Z","offlineExecuteUntil":"2026-08-30T00:00:00Z"},
                "signature":"placeholder"},
            "scopes":["workspace:mutate","workspace:read"],
            "commercialAuthority":{"schemaVersion":1,"entitlementRevision":9,
                "entitlementProjectionDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                "state":"active","commercialExpiresAt":"2026-08-29T23:00:00Z",
                "capability":"cloudflare:dns:observe"},"signature":"placeholder"
        });
        let parsed: DesktopAuthorizationGrant = serde_json::from_value(value.clone()).unwrap();
        value["activeDeviceLease"]["signature"] = json!(
            URL_SAFE_NO_PAD.encode(
                lease_pair
                    .sign(&parsed.active_device_lease.signature_transcript())
                    .as_ref()
            )
        );
        let parsed: DesktopAuthorizationGrant = serde_json::from_value(value.clone()).unwrap();
        value["signature"] =
            json!(URL_SAFE_NO_PAD.encode(grant_pair.sign(&parsed.signature_transcript()).as_ref()));
        serde_json::to_vec(&value).unwrap()
    }

    pub(crate) fn long_lived_signed_grant(
        entitlement_revision: u64,
        entitlement_projection_digest: &str,
        commercial_expires_at: &str,
    ) -> (BackupAuthorityVerifier, Vec<u8>) {
        let now = i64::try_from(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("test clock must be after the Unix epoch")
                .as_secs(),
        )
        .expect("test clock must fit the signed timestamp representation");
        let issued_at = test_timestamp(now - 60);
        let renew_after = test_timestamp(now + 3_600);
        let online_expires_at = test_timestamp(now + 43_200);
        let offline_execute_until = test_timestamp(now + 82_800);
        let grant_pair = Ed25519KeyPair::from_seed_unchecked(&[0x51; 32]).unwrap();
        let lease_pair = Ed25519KeyPair::from_seed_unchecked(&[0x52; 32]).unwrap();
        let verifier = BackupAuthorityVerifier::for_test(
            "grant-key-host-test",
            grant_pair.public_key().as_ref(),
            "lease-key-host-test",
            lease_pair.public_key().as_ref(),
        )
        .unwrap();
        let mut value = json!({
            "schemaVersion":3,"typ":EXPECTED_GRANT_TYPE,"iss":EXPECTED_ISSUER,
            "aud":EXPECTED_GRANT_AUDIENCE,"kid":"grant-key-host-test",
            "issuedAt":issued_at,"expiresAt":offline_execute_until,
            "workspace":{"workspaceId":"workspace-local","kind":"personal_default"},
            "activeDeviceLease":{"schemaVersion":1,"typ":EXPECTED_LEASE_TYPE,"iss":EXPECTED_ISSUER,
                "aud":EXPECTED_LEASE_AUDIENCE,"kid":"lease-key-host-test","accountId":"account-local",
                "deviceId":"device-local","accountSecurityEpoch":2,"jti":"lease-host-test",
                "issuedAt":issued_at,"expiresAt":offline_execute_until,
                "payload":{"leaseEpoch":2,"renewAfter":renew_after,
                    "onlineExpiresAt":online_expires_at,"offlineExecuteUntil":offline_execute_until},
                "signature":"placeholder"},
            "scopes":["workspace:mutate","workspace:read"],
            "commercialAuthority":{"schemaVersion":1,"entitlementRevision":entitlement_revision,
                "entitlementProjectionDigest":entitlement_projection_digest,
                "state":"active","commercialExpiresAt":commercial_expires_at,
                "capability":"cloudflare:dns:observe"},"signature":"placeholder"
        });
        let parsed: DesktopAuthorizationGrant = serde_json::from_value(value.clone()).unwrap();
        value["activeDeviceLease"]["signature"] = json!(
            URL_SAFE_NO_PAD.encode(
                lease_pair
                    .sign(&parsed.active_device_lease.signature_transcript())
                    .as_ref()
            )
        );
        let parsed: DesktopAuthorizationGrant = serde_json::from_value(value.clone()).unwrap();
        value["signature"] =
            json!(URL_SAFE_NO_PAD.encode(grant_pair.sign(&parsed.signature_transcript()).as_ref()));
        (verifier, serde_json::to_vec(&value).unwrap())
    }

    fn test_timestamp(seconds: i64) -> String {
        let days = seconds.div_euclid(86_400);
        let day_seconds = seconds.rem_euclid(86_400);
        let z = days + 719_468;
        let era = (if z >= 0 { z } else { z - 146_096 }) / 146_097;
        let doe = z - era * 146_097;
        let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
        let year_base = yoe + era * 400;
        let day_of_year = doe - (365 * yoe + yoe / 4 - yoe / 100);
        let month_prime = (5 * day_of_year + 2) / 153;
        let day = day_of_year - (153 * month_prime + 2) / 5 + 1;
        let month = month_prime + if month_prime < 10 { 3 } else { -9 };
        let year = year_base + i64::from(month <= 2);
        let hour = day_seconds / 3_600;
        let minute = (day_seconds % 3_600) / 60;
        let second = day_seconds % 60;
        format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}Z")
    }

    fn verified() -> (VerifiedBackupAuthority, Vec<u8>) {
        let grant_pair = Ed25519KeyPair::from_seed_unchecked(&[0x41; 32]).unwrap();
        let lease_pair = Ed25519KeyPair::from_seed_unchecked(&[0x42; 32]).unwrap();
        let verifier = BackupAuthorityVerifier::for_test(
            "grant-key-1",
            grant_pair.public_key().as_ref(),
            "lease-key-1",
            lease_pair.public_key().as_ref(),
        )
        .unwrap();
        let wire = signed_grant(&grant_pair, &lease_pair);
        let authority = VerifiedBackupAuthority::verify(
            &wire,
            &TrustedBackupBinding {
                account_id: Some("account-local"),
                device_id: "device-local",
                minimum_account_security_epoch: 4,
                minimum_lease_epoch: 7,
            },
            parse_canonical_utc("2026-08-29T18:00:00Z").unwrap(),
            &verifier,
        )
        .unwrap();
        (authority, wire)
    }

    #[test]
    fn signed_grant_requires_both_purpose_separated_signatures_and_binding() {
        let (authority, wire) = verified();
        assert_eq!(authority.workspace_id(), "workspace-local");
        let grant_pair = Ed25519KeyPair::from_seed_unchecked(&[0x41; 32]).unwrap();
        let lease_pair = Ed25519KeyPair::from_seed_unchecked(&[0x42; 32]).unwrap();
        let verifier = BackupAuthorityVerifier::for_test(
            "grant-key-1",
            grant_pair.public_key().as_ref(),
            "lease-key-1",
            lease_pair.public_key().as_ref(),
        )
        .unwrap();
        let mut tampered = wire.clone();
        let position = tampered.iter().position(|byte| *byte == b'a').unwrap();
        tampered[position] = b'b';
        assert!(
            VerifiedBackupAuthority::verify(
                &tampered,
                &TrustedBackupBinding {
                    account_id: Some("account-local"),
                    device_id: "device-local",
                    minimum_account_security_epoch: 4,
                    minimum_lease_epoch: 7
                },
                parse_canonical_utc("2026-08-29T18:00:00Z").unwrap(),
                &verifier,
            )
            .is_err()
        );
    }

    #[test]
    fn monotonic_state_rejects_epoch_and_authority_rollback() {
        let (authority, _) = verified();
        let mut state = MonotonicBackupAuthority::unavailable();
        state.apply_replacement(1, authority).unwrap();
        assert_eq!(state.applied_epoch(), 1);
        let (replayed, _) = verified();
        assert_eq!(
            state.apply_replacement(1, replayed),
            Err(BackupAuthorityError::RollbackRejected)
        );
        assert!(
            state
                .current_at(1, parse_canonical_utc("2026-08-29T18:00:00Z").unwrap())
                .is_err()
        );
    }

    #[test]
    fn replacement_floor_rejects_changed_deadline_when_projection_digest_is_unchanged() {
        let (replacement, _) = verified();
        let current = BackupAuthorityReplacementFloor {
            workspace_id: "workspace-local",
            account_id: "account-local",
            device_id: "device-local",
            account_security_epoch: 4,
            lease_epoch: 6,
            entitlement_revision: 8,
            entitlement_projection_digest: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            commercial_expires_at: "2026-08-29T22:00:00Z",
            capability: "cloudflare:dns:observe",
        };

        assert!(!replacement.can_replace_floor(&current));
    }

    #[test]
    fn registry_and_signed_wire_are_strictly_bounded() {
        assert!(BackupAuthorityVerifier::parse_registry("{}").is_err());
        let oversized = vec![b' '; MAX_SIGNED_WIRE_BYTES + 1];
        let grant_pair = Ed25519KeyPair::from_seed_unchecked(&[0x41; 32]).unwrap();
        let lease_pair = Ed25519KeyPair::from_seed_unchecked(&[0x42; 32]).unwrap();
        let verifier = BackupAuthorityVerifier::for_test(
            "grant-key-1",
            grant_pair.public_key().as_ref(),
            "lease-key-1",
            lease_pair.public_key().as_ref(),
        )
        .unwrap();
        assert!(matches!(
            VerifiedBackupAuthority::verify(
                &oversized,
                &TrustedBackupBinding {
                    account_id: None,
                    device_id: "device-local",
                    minimum_account_security_epoch: 0,
                    minimum_lease_epoch: 0
                },
                0,
                &verifier,
            ),
            Err(BackupAuthorityError::Malformed)
        ));
    }
}
