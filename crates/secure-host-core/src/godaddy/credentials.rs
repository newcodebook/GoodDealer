use super::{GoDaddyCredential, GoDaddyError, GoDaddyGuard};
use crate::provider_credential_slot::{self as slots, Service};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use zeroize::{Zeroize, Zeroizing};

const SERVICE: Service = Service::GoDaddy;
pub(crate) const MAX_GODADDY_PAT_BYTES: usize = 4096;
const MAX_ENVELOPE: usize = 12 * 1024;
static CUSTODY: Mutex<()> = Mutex::new(());

/// The local Host supplies the prepared or committed slot in its exclusively held workspace.
/// These identifiers are issued by the Host and contain no Provider account data.
pub trait GoDaddyCredentialPlan {
    fn connection_incarnation(&self) -> &str;
    fn connection_digest(&self) -> &str;
    fn generation(&self) -> u64;
    fn public_proof(&self) -> &str;
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Envelope {
    schema_version: u8,
    connection_incarnation: String,
    connection_digest: String,
    generation: u64,
    public_proof: String,
    pat: String,
}

impl Drop for Envelope {
    fn drop(&mut self) {
        self.pat.zeroize();
    }
}

fn slot(plan: &(impl GoDaddyCredentialPlan + ?Sized)) -> Result<String, GoDaddyError> {
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
        return Err(GoDaddyError::InputRejected);
    }
    Ok(format!("{digest}:{}", plan.generation()))
}

fn valid_field(value: &str) -> bool {
    (1..=MAX_GODADDY_PAT_BYTES).contains(&value.len())
        && value.bytes().all(|byte| byte.is_ascii_graphic())
}

fn decode(
    bytes: &[u8],
    plan: &(impl GoDaddyCredentialPlan + ?Sized),
) -> Result<GoDaddyCredential, GoDaddyError> {
    let rejected = GoDaddyError::CustodyMismatch;
    if bytes.len() > MAX_ENVELOPE {
        return Err(rejected);
    }
    let mut envelope: Envelope = serde_json::from_slice(bytes).map_err(|_| rejected)?;
    if envelope.schema_version != 1
        || envelope.connection_incarnation != plan.connection_incarnation()
        || envelope.connection_digest != plan.connection_digest()
        || envelope.generation != plan.generation()
        || envelope.public_proof != plan.public_proof()
        || !valid_field(&envelope.pat)
    {
        return Err(rejected);
    }
    Ok(GoDaddyCredential(Zeroizing::new(std::mem::take(
        &mut envelope.pat,
    ))))
}

/// Stores a newly prepared immutable generation. A retry must find the exact same envelope.
///
/// # Errors
/// Rejects stale authority, an occupied mismatched slot, or unconfirmed custody.
pub fn publish_godaddy_credential_guarded(
    plan: &(impl GoDaddyCredentialPlan + ?Sized),
    credential: &GoDaddyCredential,
    guard: &mut GoDaddyGuard<'_>,
) -> Result<(), GoDaddyError> {
    let account = slot(plan)?;
    let envelope = Envelope {
        schema_version: 1,
        connection_incarnation: plan.connection_incarnation().to_owned(),
        connection_digest: plan.connection_digest().to_owned(),
        generation: plan.generation(),
        public_proof: plan.public_proof().to_owned(),
        pat: credential.0.to_string(),
    };
    let bytes =
        Zeroizing::new(serde_json::to_vec(&envelope).map_err(|_| GoDaddyError::InputRejected)?);
    guard()?;
    let _lock = CUSTODY
        .lock()
        .map_err(|_| GoDaddyError::CustodyUnavailable)?;
    guard()?;
    if let Some(existing) =
        slots::load(SERVICE, &account).map_err(|_| GoDaddyError::CustodyUnavailable)?
    {
        if existing.as_slice() != bytes.as_slice() {
            return Err(GoDaddyError::CustodyMismatch);
        }
        return guard();
    }
    guard()?;
    let unknown = GoDaddyError::CustodyOutcomeUnknown;
    slots::store(SERVICE, &account, &bytes).map_err(|_| unknown)?;
    guard()?;
    let read = slots::load(SERVICE, &account)
        .map_err(|_| unknown)?
        .ok_or(unknown)?;
    if read.as_slice() != bytes.as_slice() {
        return Err(unknown);
    }
    guard()
}

/// Reads only the admitted exact generation. Absence allows preparation recovery to distinguish
/// a canceled capture from a completed slot write whose Host publication was interrupted.
///
/// # Errors
/// Refuses stale authority, wrong slot identity or unavailable custody.
pub fn load_godaddy_credential_guarded(
    plan: &(impl GoDaddyCredentialPlan + ?Sized),
    guard: &mut GoDaddyGuard<'_>,
) -> Result<Option<GoDaddyCredential>, GoDaddyError> {
    let account = slot(plan)?;
    guard()?;
    let _lock = CUSTODY
        .lock()
        .map_err(|_| GoDaddyError::CustodyUnavailable)?;
    guard()?;
    let encoded = slots::load(SERVICE, &account).map_err(|_| GoDaddyError::CustodyUnavailable)?;
    let credential = encoded.map(|bytes| decode(&bytes, plan)).transpose()?;
    guard()?;
    Ok(credential)
}

/// Removes the exact immutable slot after durable retirement denies use.
///
/// # Errors
/// Refuses mismatched identity, stale authority or an unconfirmed delete.
pub fn purge_godaddy_credential_guarded(
    plan: &(impl GoDaddyCredentialPlan + ?Sized),
    guard: &mut GoDaddyGuard<'_>,
) -> Result<(), GoDaddyError> {
    let account = slot(plan)?;
    guard()?;
    let _lock = CUSTODY
        .lock()
        .map_err(|_| GoDaddyError::CustodyUnavailable)?;
    guard()?;
    // This slot has already been durably retired by the Host. Allow erasure by its exact
    // immutable scope even if the old envelope is malformed or the OS reports duplicates.
    slots::purge_exact(SERVICE, &account).map_err(|_| GoDaddyError::CustodyOutcomeUnknown)?;
    guard()
}

pub struct GoDaddyCapture;

impl GoDaddyCapture {
    #[must_use]
    pub const fn supported() -> bool {
        cfg!(any(
            target_os = "linux",
            target_os = "macos",
            target_os = "windows"
        ))
    }

    /// Captures a masked `GoDaddy` Personal Access Token in a purpose-specific Native dialog.
    ///
    /// # Errors
    /// Refuses stale authority, invalid input or a cancelled or unavailable dialog.
    pub fn capture_guarded(
        guard: &mut GoDaddyGuard<'_>,
    ) -> Result<GoDaddyCredential, GoDaddyError> {
        guard()?;
        #[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
        {
            #[cfg(target_os = "linux")]
            use crate::linux_credential_capture::{CaptureError, Purpose, capture};
            #[cfg(target_os = "macos")]
            use crate::macos_pair_capture::{CaptureError, Purpose, capture};
            #[cfg(target_os = "windows")]
            use crate::windows_credential_capture::{CaptureError, Purpose, capture};
            let mut stale = None;
            let result = capture(Purpose::GoDaddy, &mut || match guard() {
                Ok(()) => true,
                Err(error) => {
                    stale = Some(error);
                    false
                }
            });
            if let Some(error) = stale {
                return Err(error);
            }
            let bytes = result.map_err(|error| match error {
                CaptureError::Unavailable => GoDaddyError::CustodyUnavailable,
                CaptureError::Cancelled => GoDaddyError::CaptureCancelled,
                CaptureError::AuthorityStale => GoDaddyError::AuthorityStale,
                #[cfg(any(target_os = "linux", target_os = "windows"))]
                CaptureError::Timeout => GoDaddyError::CaptureCancelled,
            })?;
            guard()?;
            parse_capture(&bytes)
        }
        #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
        Err(GoDaddyError::CustodyUnavailable)
    }
}

#[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows", test))]
fn parse_capture(bytes: &[u8]) -> Result<GoDaddyCredential, GoDaddyError> {
    let invalid = GoDaddyError::InputRejected;
    if bytes.len() > MAX_GODADDY_PAT_BYTES + 1 {
        return Err(invalid);
    }
    let text = std::str::from_utf8(bytes).map_err(|_| invalid)?;
    let pat = text.strip_suffix('\n').unwrap_or(text);
    if !valid_field(pat) {
        return Err(invalid);
    }
    Ok(GoDaddyCredential(Zeroizing::new(pat.to_owned())))
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Plan;
    impl GoDaddyCredentialPlan for Plan {
        fn connection_incarnation(&self) -> &'static str {
            "test-incarnation"
        }
        fn connection_digest(&self) -> &'static str {
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        }
        fn generation(&self) -> u64 {
            1
        }
        fn public_proof(&self) -> &'static str {
            "test-proof-for-this-purpose-only"
        }
    }

    #[test]
    fn takes_one_exact_masked_token_and_denies_another_slot_or_wire_shape() {
        assert_eq!(
            parse_capture(b"synthetic-PAT\n").unwrap().0.as_str(),
            "synthetic-PAT"
        );
        for bad in [
            b"".as_slice(),
            b"extra\nfield",
            b"two values",
            b"x\r\n",
            b"x\n\n",
        ] {
            assert_eq!(parse_capture(bad).unwrap_err(), GoDaddyError::InputRejected);
        }
        let plan = Plan;
        let envelope = Envelope {
            schema_version: 1,
            connection_incarnation: plan.connection_incarnation().to_owned(),
            connection_digest: plan.connection_digest().to_owned(),
            generation: plan.generation(),
            public_proof: plan.public_proof().to_owned(),
            pat: "synthetic-PAT".to_owned(),
        };
        let bytes = Zeroizing::new(serde_json::to_vec(&envelope).unwrap());
        assert_eq!(decode(&bytes, &plan).unwrap().0.as_str(), "synthetic-PAT");
        let mut changed: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        changed["connectionIncarnation"] = serde_json::json!("some-other-incarnation");
        assert_eq!(
            decode(&serde_json::to_vec(&changed).unwrap(), &plan).unwrap_err(),
            GoDaddyError::CustodyMismatch
        );
    }

    #[test]
    #[cfg(target_os = "linux")]
    #[ignore = "requires an isolated Secret Service and synthetic slots"]
    fn retired_slot_purges_malformed_duplicates_without_touching_another_purpose() {
        use crate::secret_service_custody::create_duplicate_canary;
        let account = slot(&Plan).unwrap();
        let adjacent = Service::CloudflareRegistrar;
        slots::store(SERVICE, &account, b"malformed-GoDaddy-canary").unwrap();
        slots::store(adjacent, &account, b"separate-Cloudflare-canary").unwrap();
        create_duplicate_canary("com.gooddealer.desktop.godaddy.registrar.v3", &account).unwrap();
        assert_eq!(
            purge_godaddy_credential_guarded(&Plan, &mut || Err(GoDaddyError::AuthorityStale)),
            Err(GoDaddyError::AuthorityStale)
        );
        purge_godaddy_credential_guarded(&Plan, &mut || Ok(())).unwrap();
        assert!(slots::load(SERVICE, &account).unwrap().is_none());
        assert_eq!(
            slots::load(adjacent, &account).unwrap().unwrap().as_slice(),
            b"separate-Cloudflare-canary"
        );
        slots::purge_exact(adjacent, &account).unwrap();
    }
}
