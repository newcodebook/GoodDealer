use std::fmt::{Display, Formatter};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Deserialize;

const EXPECTED_ISSUER: &str = "https://accounts.gooddealer.com";
const EXPECTED_TYPE: &str = "gd.active-device-lease.v1";
const EXPECTED_AUDIENCE: &str = "gooddealer-desktop/active-device-lease";
const SIGNATURE_DOMAIN: &str = "GOODDEALER-ACTIVE-DEVICE-LEASE-V1";
const MAX_OFFLINE_WINDOW_SECONDS: i64 = 86_400;
const MAX_GRANT_BYTES: usize = 16_384;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum AuthorizationError {
    Malformed,
    SignatureRejected,
    ScopeRejected,
    Expired,
}

impl Display for AuthorizationError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::Malformed => "LOCAL_AUTHORIZATION_MALFORMED",
            Self::SignatureRejected => "LOCAL_AUTHORIZATION_SIGNATURE_REJECTED",
            Self::ScopeRejected => "LOCAL_AUTHORIZATION_SCOPE_REJECTED",
            Self::Expired => "LOCAL_AUTHORIZATION_EXPIRED",
        })
    }
}

impl std::error::Error for AuthorizationError {}

pub(crate) trait TrustedClock: Send + Sync {
    fn unix_seconds(&self) -> Result<i64, AuthorizationError>;
}

#[derive(Debug, Default)]
pub(crate) struct SystemClock;

impl TrustedClock for SystemClock {
    fn unix_seconds(&self) -> Result<i64, AuthorizationError> {
        let seconds = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| AuthorizationError::Expired)?
            .as_secs();
        i64::try_from(seconds).map_err(|_| AuthorizationError::Expired)
    }
}

/// Purpose-specific signature authority. Shape parsing alone can never implement this port.
pub(crate) trait ActiveDeviceLeaseVerifier {
    fn verify(&self, key_id: &str, transcript: &[u8], signature: &str) -> bool;
}

pub(crate) struct TrustedDeviceBinding<'a> {
    pub(crate) account_id: &'a str,
    pub(crate) device_id: &'a str,
    pub(crate) account_security_epoch: u64,
    pub(crate) lease_epoch: u64,
}

pub(crate) struct AuthorizedWorkspace {
    workspace_id: String,
    account_id: String,
    device_id: String,
    account_security_epoch: u64,
    lease_epoch: u64,
    execute_before: i64,
}

impl AuthorizedWorkspace {
    pub(crate) fn workspace_id(&self) -> &str {
        &self.workspace_id
    }

    pub(crate) fn allows_at(&self, now: i64) -> bool {
        now < self.execute_before
    }

    pub(crate) fn can_replace_with(&self, other: &Self) -> bool {
        self.workspace_id == other.workspace_id
            && self.account_id == other.account_id
            && self.device_id == other.device_id
            && self.account_security_epoch <= other.account_security_epoch
            && self.lease_epoch <= other.lease_epoch
    }
}

/// Consumes bytes returned by the authenticated native Cloud transport. The outer Workspace is
/// authenticated by that channel; this function additionally proves the signed Lease and binds
/// its authority to Host-owned device state before any local Repository can be opened.
pub(crate) fn verify_desktop_authorization_grant(
    wire: &[u8],
    binding: &TrustedDeviceBinding<'_>,
    now: i64,
    verifier: &impl ActiveDeviceLeaseVerifier,
) -> Result<AuthorizedWorkspace, AuthorizationError> {
    if wire.len() > MAX_GRANT_BYTES {
        return Err(AuthorizationError::Malformed);
    }
    let grant: DesktopAuthorizationGrant =
        serde_json::from_slice(wire).map_err(|_| AuthorizationError::Malformed)?;
    grant.validate_shape()?;
    if !verifier.verify(
        &grant.active_device_lease.kid,
        &grant.active_device_lease.signature_transcript(),
        &grant.active_device_lease.signature,
    ) {
        return Err(AuthorizationError::SignatureRejected);
    }
    let lease = grant.active_device_lease;
    if lease.account_id != binding.account_id
        || lease.device_id != binding.device_id
        || lease.account_security_epoch != binding.account_security_epoch
        || lease.payload.lease_epoch != binding.lease_epoch
    {
        return Err(AuthorizationError::ScopeRejected);
    }
    let issued_at = parse_canonical_utc(&lease.issued_at)?;
    let execute_before = parse_canonical_utc(&lease.payload.offline_execute_until)?;
    if now < issued_at || now >= execute_before {
        return Err(AuthorizationError::Expired);
    }
    Ok(AuthorizedWorkspace {
        workspace_id: grant.workspace.workspace_id,
        account_id: lease.account_id,
        device_id: lease.device_id,
        account_security_epoch: lease.account_security_epoch,
        lease_epoch: lease.payload.lease_epoch,
        execute_before,
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DesktopAuthorizationGrant {
    schema_version: u8,
    workspace: AuthorizedWorkspaceWire,
    active_device_lease: ActiveDeviceLeaseEnvelope,
    scopes: [String; 2],
}

impl DesktopAuthorizationGrant {
    fn validate_shape(&self) -> Result<(), AuthorizationError> {
        if self.schema_version != 1
            || self.workspace.kind != "personal_default"
            || !valid_identifier(&self.workspace.workspace_id)
            || self.scopes != ["workspace:mutate", "workspace:read"]
        {
            return Err(AuthorizationError::Malformed);
        }
        self.active_device_lease.validate_shape()
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AuthorizedWorkspaceWire {
    workspace_id: String,
    kind: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ActiveDeviceLeaseEnvelope {
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

impl ActiveDeviceLeaseEnvelope {
    fn validate_shape(&self) -> Result<(), AuthorizationError> {
        let issued_at = parse_canonical_utc(&self.issued_at)?;
        let expires_at = parse_canonical_utc(&self.expires_at)?;
        let renew_after = parse_canonical_utc(&self.payload.renew_after)?;
        let online_expires_at = parse_canonical_utc(&self.payload.online_expires_at)?;
        let offline_execute_until = parse_canonical_utc(&self.payload.offline_execute_until)?;
        if self.schema_version != 1
            || self.typ != EXPECTED_TYPE
            || self.iss != EXPECTED_ISSUER
            || self.aud != EXPECTED_AUDIENCE
            || !valid_identifier(&self.kid)
            || !valid_identifier(&self.account_id)
            || !valid_identifier(&self.device_id)
            || self.account_security_epoch == 0
            || self.account_security_epoch > MAX_SAFE_INTEGER
            || !valid_identifier(&self.jti)
            || self.payload.lease_epoch == 0
            || self.payload.lease_epoch > MAX_SAFE_INTEGER
            || !valid_base64_url(&self.signature)
            || issued_at >= expires_at
            || renew_after <= issued_at
            || online_expires_at <= renew_after
            || offline_execute_until < online_expires_at
            || offline_execute_until != expires_at
            || offline_execute_until - issued_at > MAX_OFFLINE_WINDOW_SECONDS
        {
            return Err(AuthorizationError::Malformed);
        }
        Ok(())
    }

    /// Matches `encodeActiveDeviceLeaseSignatureTranscript`; the signature is deliberately absent.
    fn signature_transcript(&self) -> Vec<u8> {
        let payload = canonical_object([
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
        ]);
        let envelope = canonical_object([
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
            ("payload", payload),
            (
                "schemaVersion",
                canonical_number(u64::from(self.schema_version)),
            ),
            ("typ", canonical_string(&self.typ)),
        ]);
        [
            frame(b'd', SIGNATURE_DOMAIN.as_bytes()),
            frame(b'v', &envelope),
        ]
        .concat()
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ActiveDeviceLeasePayload {
    lease_epoch: u64,
    renew_after: String,
    online_expires_at: String,
    offline_execute_until: String,
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
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

fn canonical_string(value: &str) -> Vec<u8> {
    frame(b's', value.as_bytes())
}

fn canonical_number(value: u64) -> Vec<u8> {
    frame(b'n', value.to_string().as_bytes())
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
    let mut framed = Vec::with_capacity(1 + 20 + payload.len());
    framed.push(tag);
    framed.extend_from_slice(payload.len().to_string().as_bytes());
    framed.push(b':');
    framed.extend_from_slice(payload);
    framed
}

pub(crate) fn parse_canonical_utc(value: &str) -> Result<i64, AuthorizationError> {
    let bytes = value.as_bytes();
    if bytes.len() != 20
        || bytes[4] != b'-'
        || bytes[7] != b'-'
        || bytes[10] != b'T'
        || bytes[13] != b':'
        || bytes[16] != b':'
        || bytes[19] != b'Z'
    {
        return Err(AuthorizationError::Malformed);
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
        return Err(AuthorizationError::Malformed);
    }
    let days = days_before_year(year) + days_before_month(year, month) + i64::from(day - 1);
    Ok(days * 86_400 + i64::from(hour * 3_600 + minute * 60 + second))
}

fn decimal(bytes: &[u8], start: usize, length: usize) -> Result<u32, AuthorizationError> {
    bytes[start..start + length]
        .iter()
        .try_fold(0_u32, |value, byte| {
            byte.is_ascii_digit()
                .then(|| value * 10 + u32::from(byte - b'0'))
                .ok_or(AuthorizationError::Malformed)
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
        .map(|candidate| i64::from(days_in_month(year, candidate)))
        .sum()
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub(crate) struct AcceptingVerifier;

    impl ActiveDeviceLeaseVerifier for AcceptingVerifier {
        fn verify(&self, _key_id: &str, _transcript: &[u8], _signature: &str) -> bool {
            true
        }
    }

    struct RejectingVerifier;

    impl ActiveDeviceLeaseVerifier for RejectingVerifier {
        fn verify(&self, _key_id: &str, _transcript: &[u8], _signature: &str) -> bool {
            false
        }
    }

    pub(crate) fn grant(overrides: serde_json::Value) -> Vec<u8> {
        let mut value = serde_json::json!({
            "schemaVersion": 1,
            "workspace": { "workspaceId": "workspace-local", "kind": "personal_default" },
            "activeDeviceLease": {
                "schemaVersion": 1,
                "typ": "gd.active-device-lease.v1",
                "iss": "https://accounts.gooddealer.com",
                "aud": "gooddealer-desktop/active-device-lease",
                "kid": "lease-key-1",
                "accountId": "account-local",
                "deviceId": "device-local",
                "accountSecurityEpoch": 4,
                "jti": "lease-local",
                "issuedAt": "2026-08-29T00:00:00Z",
                "expiresAt": "2026-08-30T00:00:00Z",
                "payload": {
                    "leaseEpoch": 7,
                    "renewAfter": "2026-08-29T06:00:00Z",
                    "onlineExpiresAt": "2026-08-29T12:00:00Z",
                    "offlineExecuteUntil": "2026-08-30T00:00:00Z"
                },
                "signature": "fixture-signature"
            },
            "scopes": ["workspace:mutate", "workspace:read"]
        });
        merge(&mut value, overrides);
        serde_json::to_vec(&value).unwrap()
    }

    fn binding<'a>() -> TrustedDeviceBinding<'a> {
        TrustedDeviceBinding {
            account_id: "account-local",
            device_id: "device-local",
            account_security_epoch: 4,
            lease_epoch: 7,
        }
    }

    #[test]
    fn frozen_grant_requires_signature_and_exact_host_binding() {
        let now = parse_canonical_utc("2026-08-29T18:00:00Z").unwrap();
        assert_eq!(now, 1_788_026_400);
        assert!(
            verify_desktop_authorization_grant(
                &grant(serde_json::json!({})),
                &binding(),
                now,
                &AcceptingVerifier,
            )
            .is_ok()
        );
        assert_eq!(
            verify_desktop_authorization_grant(
                &grant(serde_json::json!({})),
                &binding(),
                now,
                &RejectingVerifier,
            )
            .err()
            .unwrap(),
            AuthorizationError::SignatureRejected
        );
        for mismatch in [
            serde_json::json!({"activeDeviceLease": {"accountId": "other-account"}}),
            serde_json::json!({"activeDeviceLease": {"deviceId": "other-device"}}),
            serde_json::json!({"activeDeviceLease": {"accountSecurityEpoch": 5}}),
            serde_json::json!({"activeDeviceLease": {"payload": {"leaseEpoch": 8}}}),
        ] {
            assert_eq!(
                verify_desktop_authorization_grant(
                    &grant(mismatch),
                    &binding(),
                    now,
                    &AcceptingVerifier,
                )
                .err()
                .unwrap(),
                AuthorizationError::ScopeRejected
            );
        }
    }

    #[test]
    fn grant_rejects_expiry_unknown_fields_wrong_scope_and_invalid_calendar_time() {
        let expiry = parse_canonical_utc("2026-08-30T00:00:00Z").unwrap();
        assert_eq!(
            verify_desktop_authorization_grant(
                &grant(serde_json::json!({})),
                &binding(),
                expiry,
                &AcceptingVerifier,
            )
            .err()
            .unwrap(),
            AuthorizationError::Expired
        );
        for malformed in [
            serde_json::json!({"unknown": true}),
            serde_json::json!({"scopes": ["workspace:read", "workspace:mutate"]}),
            serde_json::json!({"workspace": {"kind": "shared"}}),
            serde_json::json!({"activeDeviceLease": {"issuedAt": "2026-02-30T00:00:00Z"}}),
            serde_json::json!({"activeDeviceLease": {"payload": {"offlineExecuteUntil": "2026-08-31T00:00:01Z"}}}),
            serde_json::json!({"activeDeviceLease": {"signature": "A".repeat(MAX_GRANT_BYTES)}}),
            serde_json::json!({"activeDeviceLease": {"accountSecurityEpoch": MAX_SAFE_INTEGER + 1}}),
            serde_json::json!({"activeDeviceLease": {"payload": {"leaseEpoch": MAX_SAFE_INTEGER + 1}}}),
        ] {
            assert_eq!(
                verify_desktop_authorization_grant(
                    &grant(malformed),
                    &binding(),
                    expiry - 1,
                    &AcceptingVerifier,
                )
                .err()
                .unwrap(),
                AuthorizationError::Malformed
            );
        }
    }

    #[test]
    fn signature_transcript_is_purpose_separated_and_excludes_only_the_signature() {
        let first: DesktopAuthorizationGrant =
            serde_json::from_slice(&grant(serde_json::json!({}))).unwrap();
        let changed: DesktopAuthorizationGrant = serde_json::from_slice(&grant(
            serde_json::json!({"activeDeviceLease": {"jti": "lease-other"}}),
        ))
        .unwrap();
        let transcript = first.active_device_lease.signature_transcript();
        assert!(transcript.starts_with(b"d33:GOODDEALER-ACTIVE-DEVICE-LEASE-V1v"));
        assert_eq!(transcript.len(), 677);
        assert_eq!(
            transcript
                .iter()
                .fold(0xcbf2_9ce4_8422_2325_u64, |hash, byte| {
                    (hash ^ u64::from(*byte)).wrapping_mul(0x0000_0100_0000_01b3)
                }),
            0x987e_8376_18d8_7513
        );
        assert!(
            !transcript
                .windows(b"fixture-signature".len())
                .any(|window| { window == b"fixture-signature" })
        );
        assert_ne!(
            transcript,
            changed.active_device_lease.signature_transcript()
        );
    }

    fn merge(target: &mut serde_json::Value, patch: serde_json::Value) {
        if let (Some(target), Some(patch)) = (target.as_object_mut(), patch.as_object()) {
            for (key, value) in patch {
                if let Some(existing) = target.get_mut(key) {
                    merge(existing, value.clone());
                } else {
                    target.insert(key.clone(), value.clone());
                }
            }
        } else {
            *target = patch;
        }
    }
}
