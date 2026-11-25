//! Account-scoped Cloudflare Registrar credentials. Cloudflare account identifiers stay in Native.

use super::is_lower_hex_id;
use crate::provider_credential_slot::{self as slots, Service};
use serde::{Deserialize, Serialize};
use std::{fmt, sync::Mutex};
use zeroize::{Zeroize, Zeroizing};

const SERVICE: Service = Service::CloudflareRegistrar;
const MAX_TOKEN_BYTES: usize = 512;
static CUSTODY: Mutex<()> = Mutex::new(());

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CloudflareRegistrarCredentialError {
    AuthorityStale,
    InputRejected,
    CaptureCancelled,
    CustodyUnavailable,
    CustodyMismatch,
    CustodyOutcomeUnknown,
}

impl fmt::Display for CloudflareRegistrarCredentialError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("Cloudflare Registrar credential request failed")
    }
}

impl std::error::Error for CloudflareRegistrarCredentialError {}

pub type CloudflareRegistrarCredentialGuard<'a> =
    dyn FnMut() -> Result<(), CloudflareRegistrarCredentialError> + Send + 'a;

/// Identifies a single immutable workspace-owned slot without Provider account data.
pub trait CloudflareRegistrarCredentialPlan {
    fn connection_incarnation(&self) -> &str;
    fn connection_digest(&self) -> &str;
    fn public_proof(&self) -> &str;
}

pub struct CloudflareRegistrarCredential {
    account_id: Zeroizing<String>,
    token: Zeroizing<String>,
}

impl fmt::Debug for CloudflareRegistrarCredential {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("CloudflareRegistrarCredential([REDACTED])")
    }
}

impl CloudflareRegistrarCredential {
    pub(super) fn account_id(&self) -> &str {
        &self.account_id
    }

    pub(super) fn token(&self) -> &str {
        &self.token
    }

    /// Whether this target has a fixed Native prompt for this credential's purpose.
    #[must_use]
    pub const fn capture_supported() -> bool {
        cfg!(any(
            target_os = "linux",
            target_os = "macos",
            target_os = "windows"
        ))
    }

    /// Captures account identity and a user API token through a fixed-prompt Native flow.
    ///
    /// # Errors
    /// Refuses invalid input, an unavailable or cancelled prompt, or stale admission.
    pub fn capture_guarded(
        guard: &mut CloudflareRegistrarCredentialGuard<'_>,
    ) -> Result<Self, CloudflareRegistrarCredentialError> {
        use CloudflareRegistrarCredentialError as Fault;
        guard()?;
        #[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
        {
            #[cfg(target_os = "linux")]
            use crate::linux_credential_capture::{CaptureError, Purpose, capture};
            #[cfg(target_os = "macos")]
            use crate::macos_pair_capture::{CaptureError, Purpose, capture};
            #[cfg(target_os = "windows")]
            use crate::windows_credential_capture::{CaptureError, Purpose, capture};
            let mut invalidated = None;
            let bytes = capture(Purpose::CloudflareRegistrar, &mut || match guard() {
                Ok(()) => true,
                Err(error) => {
                    invalidated = Some(error);
                    false
                }
            });
            if let Some(error) = invalidated {
                return Err(error);
            }
            let bytes = bytes.map_err(|error| match error {
                CaptureError::Unavailable => Fault::CustodyUnavailable,
                CaptureError::Cancelled => Fault::CaptureCancelled,
                CaptureError::AuthorityStale => Fault::AuthorityStale,
                #[cfg(any(target_os = "linux", target_os = "windows"))]
                CaptureError::Timeout => Fault::CaptureCancelled,
            })?;
            guard()?;
            Self::decode_capture(&bytes)
        }
        #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
        Err(Fault::CustodyUnavailable)
    }

    #[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows", test))]
    pub(super) fn decode_capture(bytes: &[u8]) -> Result<Self, CloudflareRegistrarCredentialError> {
        let rejected = CloudflareRegistrarCredentialError::InputRejected;
        if bytes.len() > 32 + MAX_TOKEN_BYTES + 2 {
            return Err(rejected);
        }
        let text = std::str::from_utf8(bytes).map_err(|_| rejected)?;
        let text = text.strip_suffix('\n').unwrap_or(text);
        let (account_id, token) = text.split_once('\n').ok_or(rejected)?;
        if !is_lower_hex_id(account_id) || !valid_token(token) {
            return Err(rejected);
        }
        Ok(Self {
            account_id: Zeroizing::new(account_id.to_owned()),
            token: Zeroizing::new(token.to_owned()),
        })
    }
}

fn valid_token(value: &str) -> bool {
    if value.len() > MAX_TOKEN_BYTES {
        return false;
    }
    let body = value.trim_end_matches('=');
    !body.is_empty()
        && body
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-._~+/".contains(&byte))
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Envelope<'a> {
    schema_version: u8,
    connection_incarnation: &'a str,
    connection_digest: &'a str,
    public_proof: &'a str,
    account_id: &'a str,
    token: &'a str,
}

fn slot(
    plan: &(impl CloudflareRegistrarCredentialPlan + ?Sized),
) -> Result<&str, CloudflareRegistrarCredentialError> {
    let incarnation = plan.connection_incarnation();
    let digest = plan.connection_digest();
    let proof = plan.public_proof();
    let hex_byte = |b: u8| b.is_ascii_digit() || (b'a'..=b'f').contains(&b);
    let positions = [8, 13, 18, 23];
    if incarnation.len() != 36
        || !incarnation.bytes().enumerate().all(|(index, byte)| {
            if positions.contains(&index) {
                byte == b'-'
            } else {
                hex_byte(byte)
            }
        })
        || incarnation.as_bytes()[14] != b'4'
        || !b"89ab".contains(&incarnation.as_bytes()[19])
        || digest.len() != 64
        || !digest.bytes().all(hex_byte)
        || proof.len() != 64
        || !proof.bytes().all(hex_byte)
    {
        return Err(CloudflareRegistrarCredentialError::InputRejected);
    }
    Ok(digest)
}

fn decode(
    bytes: &[u8],
    plan: &(impl CloudflareRegistrarCredentialPlan + ?Sized),
) -> Result<CloudflareRegistrarCredential, CloudflareRegistrarCredentialError> {
    let rejected = CloudflareRegistrarCredentialError::CustodyMismatch;
    if bytes.len() > 2048 {
        return Err(rejected);
    }
    let envelope: Envelope<'_> = serde_json::from_slice(bytes).map_err(|_| rejected)?;
    if envelope.schema_version != 1
        || envelope.connection_incarnation != plan.connection_incarnation()
        || envelope.connection_digest != plan.connection_digest()
        || envelope.public_proof != plan.public_proof()
        || !is_lower_hex_id(envelope.account_id)
        || !valid_token(envelope.token)
    {
        return Err(rejected);
    }
    Ok(CloudflareRegistrarCredential {
        account_id: Zeroizing::new(envelope.account_id.to_owned()),
        token: Zeroizing::new(envelope.token.to_owned()),
    })
}

/// Publishes a prepared slot once and confirms its bytes before the Host commits inventory.
///
/// # Errors
/// Refuses stale admission, conflicting custody, or a write whose outcome cannot be verified.
pub fn publish_cloudflare_registrar_credential(
    plan: &(impl CloudflareRegistrarCredentialPlan + ?Sized),
    credential: &CloudflareRegistrarCredential,
    guard: &mut CloudflareRegistrarCredentialGuard<'_>,
) -> Result<(), CloudflareRegistrarCredentialError> {
    use CloudflareRegistrarCredentialError as Fault;
    let slot = slot(plan)?;
    let wire = Envelope {
        schema_version: 1,
        connection_incarnation: plan.connection_incarnation(),
        connection_digest: plan.connection_digest(),
        public_proof: plan.public_proof(),
        account_id: credential.account_id(),
        token: credential.token(),
    };
    let mut bytes = Zeroizing::new(Vec::with_capacity(2048));
    serde_json::to_writer(&mut *bytes, &wire).map_err(|_| Fault::InputRejected)?;
    guard()?;
    let _lock = CUSTODY.lock().map_err(|_| Fault::CustodyUnavailable)?;
    guard()?;
    if let Some(current) = slots::load(SERVICE, slot).map_err(|_| Fault::CustodyUnavailable)? {
        if current.as_slice() != bytes.as_slice() {
            return Err(Fault::CustodyMismatch);
        }
        return guard();
    }
    guard()?;
    slots::store(SERVICE, slot, &bytes).map_err(|_| Fault::CustodyOutcomeUnknown)?;
    guard()?;
    let readback = slots::load(SERVICE, slot)
        .map_err(|_| Fault::CustodyOutcomeUnknown)?
        .ok_or(Fault::CustodyOutcomeUnknown)?;
    if readback.as_slice() != bytes.as_slice() {
        return Err(Fault::CustodyOutcomeUnknown);
    }
    bytes.zeroize();
    guard()
}

/// Reads the exact admitted slot. A prepared slot can be absent if capture never finished.
///
/// # Errors
/// Refuses conflicting custody, an unavailable keyring, or stale admission.
pub fn load_cloudflare_registrar_credential(
    plan: &(impl CloudflareRegistrarCredentialPlan + ?Sized),
    guard: &mut CloudflareRegistrarCredentialGuard<'_>,
) -> Result<Option<CloudflareRegistrarCredential>, CloudflareRegistrarCredentialError> {
    use CloudflareRegistrarCredentialError as Fault;
    let slot = slot(plan)?;
    guard()?;
    let _lock = CUSTODY.lock().map_err(|_| Fault::CustodyUnavailable)?;
    guard()?;
    let bytes = slots::load(SERVICE, slot).map_err(|_| Fault::CustodyUnavailable)?;
    let credential = bytes.map(|bytes| decode(&bytes, plan)).transpose()?;
    guard()?;
    Ok(credential)
}

/// Checks identity and removes a slot that the Host has already retired.
///
/// # Errors
/// Refuses stale admission or an unconfirmed deletion.
pub fn purge_cloudflare_registrar_credential(
    plan: &(impl CloudflareRegistrarCredentialPlan + ?Sized),
    guard: &mut CloudflareRegistrarCredentialGuard<'_>,
) -> Result<(), CloudflareRegistrarCredentialError> {
    use CloudflareRegistrarCredentialError as Fault;
    let slot = slot(plan)?;
    guard()?;
    let _lock = CUSTODY.lock().map_err(|_| Fault::CustodyUnavailable)?;
    guard()?;
    slots::purge_cloudflare_registrar(slot).map_err(|_| Fault::CustodyOutcomeUnknown)?;
    guard()
}

#[cfg(test)]
mod tests {
    use super::*;

    const ACCOUNT: &str = "0123456789abcdef0123456789abcdef";

    struct Plan<'a>(&'a str);

    impl CloudflareRegistrarCredentialPlan for Plan<'_> {
        fn connection_incarnation(&self) -> &'static str {
            "11111111-1111-4111-a111-111111111111"
        }
        fn connection_digest(&self) -> &str {
            self.0
        }
        fn public_proof(&self) -> &'static str {
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        }
    }

    #[test]
    fn capture_accepts_exact_masked_pair_and_rejects_header_and_path_data() {
        let raw = format!("{ACCOUNT}\nsynthetic_token-123\n");
        let credential = CloudflareRegistrarCredential::decode_capture(raw.as_bytes()).unwrap();
        assert_eq!(credential.account_id(), ACCOUNT);
        assert_eq!(credential.token(), "synthetic_token-123");
        assert_eq!(
            format!("{credential:?}"),
            "CloudflareRegistrarCredential([REDACTED])"
        );
        for invalid in [
            format!("{ACCOUNT}/zones\ntoken"),
            format!("{ACCOUNT}\ntoken\r\nX-Injection: no"),
            format!("{ACCOUNT}\ntok=en"),
            format!("{ACCOUNT}\n"),
            format!("{ACCOUNT}\n{}", "x".repeat(513)),
        ] {
            assert!(matches!(
                CloudflareRegistrarCredential::decode_capture(invalid.as_bytes()),
                Err(CloudflareRegistrarCredentialError::InputRejected)
            ));
        }
    }

    #[test]
    fn custody_envelope_is_exact_to_the_connection_and_rejects_unknown_fields() {
        let digest = "1".repeat(64);
        let plan = Plan(&digest);
        let wire = Envelope {
            schema_version: 1,
            connection_incarnation: plan.connection_incarnation(),
            connection_digest: &digest,
            public_proof: plan.public_proof(),
            account_id: ACCOUNT,
            token: "fixture-token",
        };
        let json = serde_json::to_string(&wire).unwrap();
        assert!(slot(&plan).is_ok());
        assert!(decode(json.as_bytes(), &plan).is_ok());
        assert!(decode(json.as_bytes(), &Plan(&"2".repeat(64))).is_err());
        let unknown = format!(r#"{},"generation":1}}"#, json.trim_end_matches('}'));
        assert!(decode(unknown.as_bytes(), &plan).is_err());
    }

    #[cfg(target_os = "linux")]
    #[test]
    #[ignore = "requires an unlocked Native Secret Service test session"]
    fn linux_purge_retired_registrar_does_not_load_damaged_duplicate_slots() {
        use std::fmt::Write as _;
        struct Cleanup<'a>(&'a str, &'a str);
        impl Drop for Cleanup<'_> {
            fn drop(&mut self) {
                let _ = crate::secret_service_custody::delete(self.0, self.1);
            }
        }
        let mut random = [0; 32];
        getrandom::fill(&mut random).unwrap();
        let mut slot = String::with_capacity(64);
        for byte in random {
            write!(slot, "{byte:02x}").unwrap();
        }
        let plan = Plan(&slot);
        let service = "com.gooddealer.desktop.cloudflare.registrar.v1";
        let neighboring_service = "com.gooddealer.desktop.cloudflare.registrar.canary";
        let _cleanup = Cleanup(service, &slot);
        let _neighbor = Cleanup(neighboring_service, &slot);
        crate::secret_service_custody::store(neighboring_service, &slot, b"untouched").unwrap();
        slots::store(SERVICE, &slot, b"damaged envelope")
            .ok()
            .unwrap();
        crate::secret_service_custody::create_duplicate_canary(service, &slot).unwrap();
        assert!(load_cloudflare_registrar_credential(&plan, &mut || Ok(())).is_err());
        assert_eq!(
            purge_cloudflare_registrar_credential(&plan, &mut || Err(
                CloudflareRegistrarCredentialError::AuthorityStale
            )),
            Err(CloudflareRegistrarCredentialError::AuthorityStale)
        );
        assert!(crate::secret_service_custody::exists(service, &slot).unwrap());
        purge_cloudflare_registrar_credential(&plan, &mut || Ok(())).unwrap();
        purge_cloudflare_registrar_credential(&plan, &mut || Ok(())).unwrap();
        assert!(!crate::secret_service_custody::exists(service, &slot).unwrap());
        assert!(crate::secret_service_custody::exists(neighboring_service, &slot).unwrap());
    }
}
