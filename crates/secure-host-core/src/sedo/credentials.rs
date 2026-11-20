//! Sedo-owned credential capture and exact Native seller slot.
use super::{SedoCredential, SedoError, SedoGuard};
use crate::provider_credential_slot::{self as slots, Service};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use zeroize::Zeroizing;

const SERVICE: Service = Service::Sedo;
const MAX_ENVELOPE: usize = 4096;
const MAX_CAPTURE: usize = 2048;
static CUSTODY: Mutex<()> = Mutex::new(());

/// Slot identity supplied by the Host while it owns the workspace publication.
pub trait SedoCredentialPlan {
    fn connection_incarnation(&self) -> &str;
    fn connection_digest(&self) -> &str;
    fn generation(&self) -> u64;
    fn public_proof(&self) -> &str;
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Envelope {
    schema_version: u8,
    connection_incarnation: String,
    connection_digest: String,
    generation: u64,
    public_proof: String,
    #[serde(deserialize_with = "decode_secret")]
    partner_id: Zeroizing<String>,
    #[serde(deserialize_with = "decode_secret")]
    username: Zeroizing<String>,
    #[serde(deserialize_with = "decode_secret")]
    sign_key: Zeroizing<String>,
    #[serde(deserialize_with = "decode_secret")]
    password: Zeroizing<String>,
}

fn decode_secret<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Zeroizing<String>, D::Error> {
    String::deserialize(deserializer).map(Zeroizing::new)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EnvelopeRef<'a> {
    schema_version: u8,
    connection_incarnation: &'a str,
    connection_digest: &'a str,
    generation: u64,
    public_proof: &'a str,
    partner_id: &'a str,
    username: &'a str,
    sign_key: &'a str,
    password: &'a str,
}

fn account(plan: &dyn SedoCredentialPlan) -> Result<String, SedoError> {
    let incarnation = plan.connection_incarnation();
    let digest = plan.connection_digest();
    let proof = plan.public_proof();
    if !(1..=160).contains(&incarnation.len())
        || !incarnation.bytes().all(|byte| byte.is_ascii_graphic())
        || digest.len() != 64
        || !digest
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        || !(1..=9_007_199_254_740_991).contains(&plan.generation())
        || !(32..=160).contains(&proof.len())
        || !proof
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(SedoError::InputRejected);
    }
    Ok(format!("{digest}:{}", plan.generation()))
}

fn encode(
    plan: &dyn SedoCredentialPlan,
    credential: &SedoCredential,
) -> Result<Zeroizing<Vec<u8>>, SedoError> {
    let raw = serde_json::to_vec(&EnvelopeRef {
        schema_version: 1,
        connection_incarnation: plan.connection_incarnation(),
        connection_digest: plan.connection_digest(),
        generation: plan.generation(),
        public_proof: plan.public_proof(),
        partner_id: &credential.partner_id,
        username: &credential.username,
        sign_key: &credential.sign_key,
        password: &credential.password,
    })
    .map(Zeroizing::new)
    .map_err(|_| SedoError::InputRejected)?;
    if raw.len() > MAX_ENVELOPE {
        return Err(SedoError::InputRejected);
    }
    Ok(raw)
}

fn decode(raw: &[u8], plan: &dyn SedoCredentialPlan) -> Result<SedoCredential, SedoError> {
    let mismatch = SedoError::CustodyMismatch;
    if raw.len() > MAX_ENVELOPE {
        return Err(mismatch);
    }
    let envelope: Envelope = serde_json::from_slice(raw).map_err(|_| mismatch)?;
    if envelope.schema_version != 1
        || envelope.connection_incarnation != plan.connection_incarnation()
        || envelope.connection_digest != plan.connection_digest()
        || envelope.generation != plan.generation()
        || envelope.public_proof != plan.public_proof()
    {
        return Err(mismatch);
    }
    SedoCredential::from_native_fields(
        envelope.partner_id,
        envelope.sign_key,
        envelope.username,
        envelope.password,
    )
    .map_err(|_| mismatch)
}

/// Publishes the exact prepared account slot after a complete authenticated preflight.
/// # Errors
/// Refuses a stale authorization, an occupied different slot, or unconfirmed custody.
pub fn publish_sedo_credential_guarded(
    plan: &dyn SedoCredentialPlan,
    credential: &SedoCredential,
    guard: &mut SedoGuard<'_>,
) -> Result<(), SedoError> {
    let id = account(plan)?;
    let bytes = encode(plan, credential)?;
    guard()?;
    let _lock = CUSTODY.lock().map_err(|_| SedoError::CustodyUnavailable)?;
    guard()?;
    if let Some(current) = slots::load(SERVICE, &id).map_err(|_| SedoError::CustodyUnavailable)? {
        if current.as_slice() != bytes.as_slice() {
            return Err(SedoError::CustodyMismatch);
        }
        return guard();
    }
    guard()?;
    let unconfirmed = SedoError::CustodyOutcomeUnknown;
    slots::store(SERVICE, &id, &bytes).map_err(|_| unconfirmed)?;
    guard()?;
    let stored = slots::load(SERVICE, &id)
        .map_err(|_| unconfirmed)?
        .ok_or(unconfirmed)?;
    if stored.as_slice() != bytes.as_slice() {
        return Err(unconfirmed);
    }
    guard()
}

/// Loads the exact admitted seller slot.
/// # Errors
/// Refuses stale authority, a mismatched or invalid slot, and unconfirmed custody.
pub fn load_sedo_credential_guarded(
    plan: &dyn SedoCredentialPlan,
    guard: &mut SedoGuard<'_>,
) -> Result<Option<SedoCredential>, SedoError> {
    let id = account(plan)?;
    guard()?;
    let _lock = CUSTODY.lock().map_err(|_| SedoError::CustodyUnavailable)?;
    guard()?;
    let raw = slots::load(SERVICE, &id).map_err(|_| SedoError::CustodyUnavailable)?;
    let credential = raw.map(|bytes| decode(&bytes, plan)).transpose()?;
    guard()?;
    Ok(credential)
}

/// Purges an exact revoked slot and verifies its absence by metadata.
/// # Errors
/// Refuses stale retirement authority or an unconfirmed removal.
pub fn purge_sedo_credential_guarded(
    plan: &dyn SedoCredentialPlan,
    guard: &mut SedoGuard<'_>,
) -> Result<(), SedoError> {
    let id = account(plan)?;
    guard()?;
    let _lock = CUSTODY.lock().map_err(|_| SedoError::CustodyUnavailable)?;
    guard()?;
    slots::purge_exact(SERVICE, &id).map_err(|_| SedoError::CustodyOutcomeUnknown)?;
    guard()
}

pub struct SedoCapture;

impl SedoCapture {
    #[must_use]
    pub const fn supported() -> bool {
        cfg!(any(
            target_os = "linux",
            target_os = "macos",
            target_os = "windows"
        ))
    }

    /// Captures the four official API fields in fixed Native prompts under one preparation.
    /// # Errors
    /// Refuses stale authority, invalid or cancelled input, and unavailable Native capture.
    pub fn capture_guarded(guard: &mut SedoGuard<'_>) -> Result<SedoCredential, SedoError> {
        guard()?;
        #[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
        {
            #[cfg(target_os = "linux")]
            use crate::linux_credential_capture::{CaptureError, Purpose, capture};
            #[cfg(target_os = "macos")]
            use crate::macos_pair_capture::{CaptureError, Purpose, capture};
            #[cfg(target_os = "windows")]
            use crate::windows_credential_capture::{CaptureError, Purpose, capture};

            let mut read_pair = |purpose| {
                let result = capture(purpose, &mut || guard().is_ok());
                guard()?;
                result.map_err(|error| match error {
                    CaptureError::Unavailable => SedoError::CustodyUnavailable,
                    CaptureError::Cancelled => SedoError::CaptureCancelled,
                    CaptureError::AuthorityStale => SedoError::AuthorityStale,
                    #[cfg(any(target_os = "linux", target_os = "windows"))]
                    CaptureError::Timeout => SedoError::CaptureCancelled,
                })
            };
            let identity = read_pair(Purpose::SedoIdentity)?;
            let access = read_pair(Purpose::SedoAccess)?;
            parse_capture(&identity, &access)
        }
        #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
        Err(SedoError::CustodyUnavailable)
    }
}

fn parse_capture(identity: &[u8], access: &[u8]) -> Result<SedoCredential, SedoError> {
    fn pair(bytes: &[u8]) -> Result<(&str, &str), SedoError> {
        let error = SedoError::InputRejected;
        if bytes.len() > MAX_CAPTURE {
            return Err(error);
        }
        let text = std::str::from_utf8(bytes).map_err(|_| error)?;
        let text = text.strip_suffix('\n').unwrap_or(text);
        let (first, second) = text.split_once('\n').ok_or(error)?;
        if second.contains('\n') {
            return Err(error);
        }
        Ok((first, second))
    }
    let (partner_id, username) = pair(identity)?;
    let (sign_key, password) = pair(access)?;
    SedoCredential::from_native_fields(
        Zeroizing::new(partner_id.to_owned()),
        Zeroizing::new(sign_key.to_owned()),
        Zeroizing::new(username.to_owned()),
        Zeroizing::new(password.to_owned()),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Slot {
        generation: u64,
        digest: &'static str,
    }
    impl SedoCredentialPlan for Slot {
        fn connection_incarnation(&self) -> &'static str {
            "fixture-incarnation"
        }
        fn connection_digest(&self) -> &str {
            self.digest
        }
        fn generation(&self) -> u64 {
            self.generation
        }
        fn public_proof(&self) -> &'static str {
            "fixture-proof-kept-in-exact-slot"
        }
    }

    #[test]
    fn scope_and_secret_envelope_reject_mismatch_or_unknown_fields() {
        let slot = Slot {
            generation: 1,
            digest: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        };
        let credential =
            parse_capture(b"1234\nfixture-user", b"fixture-key\nfixture-pass").unwrap();
        let raw = encode(&slot, &credential).unwrap();
        assert!(decode(&raw, &slot).is_ok());
        let newer = Slot {
            generation: 2,
            ..slot
        };
        assert!(matches!(
            decode(&raw, &newer),
            Err(SedoError::CustodyMismatch)
        ));
        let foreign = Slot {
            digest: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            ..slot
        };
        assert!(matches!(
            decode(&raw, &foreign),
            Err(SedoError::CustodyMismatch)
        ));
        let mut additional: serde_json::Value = serde_json::from_slice(&raw).unwrap();
        additional["role"] = serde_json::json!("other");
        assert!(matches!(
            decode(&serde_json::to_vec(&additional).unwrap(), &slot),
            Err(SedoError::CustodyMismatch)
        ));
    }

    #[test]
    fn capture_cannot_smuggle_additional_fields_and_preserves_the_four_values() {
        let credential = parse_capture(b"1234\nfixture-user\n", b"a+b\np&=?\n").unwrap();
        assert_eq!(*credential.partner_id, "1234");
        assert_eq!(*credential.username, "fixture-user");
        assert_eq!(*credential.sign_key, "a+b");
        assert_eq!(*credential.password, "p&=?");
        assert!(matches!(
            parse_capture(b"1234\nfixture-user\nmalicious", b"a+b\np&=?"),
            Err(SedoError::InputRejected)
        ));
        assert!(matches!(
            parse_capture(b"0000\nfixture-user", b"a+b\np&=?"),
            Err(SedoError::InputRejected)
        ));
    }
}
