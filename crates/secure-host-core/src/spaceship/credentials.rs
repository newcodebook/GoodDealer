use super::{SpaceshipCredential, SpaceshipError, SpaceshipGuard};
use crate::provider_credential_slot::{self as slots, Service};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use zeroize::{Zeroize, Zeroizing};

const SERVICE: Service = Service::Spaceship;
const MAX_FIELD: usize = 512;
const MAX_ENVELOPE: usize = 4096;
static CUSTODY: Mutex<()> = Mutex::new(());

/// The local Host supplies the prepared or committed slot in its exclusively held workspace.
/// These identifiers are issued by the Host and contain no Provider account data.
pub trait SpaceshipCredentialPlan {
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
    key: String,
    secret: String,
}

impl Drop for Envelope {
    fn drop(&mut self) {
        self.key.zeroize();
        self.secret.zeroize();
    }
}

fn slot(plan: &(impl SpaceshipCredentialPlan + ?Sized)) -> Result<String, SpaceshipError> {
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
        return Err(SpaceshipError::InputRejected);
    }
    Ok(format!("{digest}:{}", plan.generation()))
}

fn valid_field(value: &str) -> bool {
    (1..=MAX_FIELD).contains(&value.len()) && value.bytes().all(|byte| byte.is_ascii_graphic())
}

fn decode(
    bytes: &[u8],
    plan: &(impl SpaceshipCredentialPlan + ?Sized),
) -> Result<SpaceshipCredential, SpaceshipError> {
    let rejected = SpaceshipError::CustodyMismatch;
    if bytes.len() > MAX_ENVELOPE {
        return Err(rejected);
    }
    let mut envelope: Envelope = serde_json::from_slice(bytes).map_err(|_| rejected)?;
    if envelope.schema_version != 1
        || envelope.connection_incarnation != plan.connection_incarnation()
        || envelope.connection_digest != plan.connection_digest()
        || envelope.generation != plan.generation()
        || envelope.public_proof != plan.public_proof()
        || !valid_field(&envelope.key)
        || !valid_field(&envelope.secret)
    {
        return Err(rejected);
    }
    Ok(SpaceshipCredential {
        key: Zeroizing::new(std::mem::take(&mut envelope.key)),
        secret: Zeroizing::new(std::mem::take(&mut envelope.secret)),
    })
}

/// Stores a newly prepared immutable generation. A retry must find the exact same envelope.
///
/// # Errors
/// Rejects stale authority, an occupied mismatched slot, or unconfirmed custody.
pub fn publish_spaceship_credential_guarded(
    plan: &(impl SpaceshipCredentialPlan + ?Sized),
    credential: &SpaceshipCredential,
    guard: &mut SpaceshipGuard<'_>,
) -> Result<(), SpaceshipError> {
    let account = slot(plan)?;
    let envelope = Envelope {
        schema_version: 1,
        connection_incarnation: plan.connection_incarnation().to_owned(),
        connection_digest: plan.connection_digest().to_owned(),
        generation: plan.generation(),
        public_proof: plan.public_proof().to_owned(),
        key: credential.key.to_string(),
        secret: credential.secret.to_string(),
    };
    let bytes =
        Zeroizing::new(serde_json::to_vec(&envelope).map_err(|_| SpaceshipError::InputRejected)?);
    guard()?;
    let _lock = CUSTODY
        .lock()
        .map_err(|_| SpaceshipError::CustodyUnavailable)?;
    guard()?;
    if let Some(existing) =
        slots::load(SERVICE, &account).map_err(|_| SpaceshipError::CustodyUnavailable)?
    {
        if existing.as_slice() != bytes.as_slice() {
            return Err(SpaceshipError::CustodyMismatch);
        }
        return guard();
    }
    guard()?;
    let unknown = SpaceshipError::CustodyOutcomeUnknown;
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
pub fn load_spaceship_credential_guarded(
    plan: &(impl SpaceshipCredentialPlan + ?Sized),
    guard: &mut SpaceshipGuard<'_>,
) -> Result<Option<SpaceshipCredential>, SpaceshipError> {
    let account = slot(plan)?;
    guard()?;
    let _lock = CUSTODY
        .lock()
        .map_err(|_| SpaceshipError::CustodyUnavailable)?;
    guard()?;
    let encoded = slots::load(SERVICE, &account).map_err(|_| SpaceshipError::CustodyUnavailable)?;
    let credential = encoded.map(|bytes| decode(&bytes, plan)).transpose()?;
    guard()?;
    Ok(credential)
}

/// Removes the exact immutable slot after durable retirement denies use.
///
/// # Errors
/// Refuses mismatched identity, stale authority or an unconfirmed delete.
pub fn purge_spaceship_credential_guarded(
    plan: &(impl SpaceshipCredentialPlan + ?Sized),
    guard: &mut SpaceshipGuard<'_>,
) -> Result<(), SpaceshipError> {
    let account = slot(plan)?;
    guard()?;
    let _lock = CUSTODY
        .lock()
        .map_err(|_| SpaceshipError::CustodyUnavailable)?;
    guard()?;
    if let Some(bytes) =
        slots::load(SERVICE, &account).map_err(|_| SpaceshipError::CustodyUnavailable)?
    {
        decode(&bytes, plan)?;
        guard()?;
        let unknown = SpaceshipError::CustodyOutcomeUnknown;
        slots::delete(SERVICE, &account).map_err(|_| unknown)?;
        guard()?;
        if slots::load(SERVICE, &account)
            .map_err(|_| unknown)?
            .is_some()
        {
            return Err(unknown);
        }
    }
    guard()
}

pub struct SpaceshipCapture;

impl SpaceshipCapture {
    #[must_use]
    pub const fn supported() -> bool {
        cfg!(any(
            target_os = "linux",
            target_os = "macos",
            target_os = "windows"
        ))
    }

    /// Captures a masked key and secret in a purpose-specific Native dialog.
    ///
    /// # Errors
    /// Refuses stale authority, invalid input or a cancelled or unavailable dialog.
    pub fn capture_guarded(
        guard: &mut SpaceshipGuard<'_>,
    ) -> Result<SpaceshipCredential, SpaceshipError> {
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
            let result = capture(Purpose::Spaceship, &mut || match guard() {
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
                CaptureError::Unavailable => SpaceshipError::CustodyUnavailable,
                CaptureError::Cancelled => SpaceshipError::CaptureCancelled,
                CaptureError::AuthorityStale => SpaceshipError::AuthorityStale,
                #[cfg(any(target_os = "linux", target_os = "windows"))]
                CaptureError::Timeout => SpaceshipError::CaptureCancelled,
            })?;
            guard()?;
            parse_capture(&bytes)
        }
        #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
        Err(SpaceshipError::CustodyUnavailable)
    }
}

#[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows", test))]
fn parse_capture(bytes: &[u8]) -> Result<SpaceshipCredential, SpaceshipError> {
    let invalid = SpaceshipError::InputRejected;
    if bytes.len() > 2 * MAX_FIELD + 2 {
        return Err(invalid);
    }
    let text = std::str::from_utf8(bytes).map_err(|_| invalid)?;
    let text = text.strip_suffix('\n').unwrap_or(text);
    let (key, secret) = text.split_once('\n').ok_or(invalid)?;
    if !valid_field(key) || !valid_field(secret) {
        return Err(invalid);
    }
    Ok(SpaceshipCredential {
        key: Zeroizing::new(key.to_owned()),
        secret: Zeroizing::new(secret.to_owned()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Plan {
        digest: String,
        generation: u64,
        proof: String,
    }
    impl SpaceshipCredentialPlan for Plan {
        fn connection_incarnation(&self) -> &'static str {
            "spaceship-incarnation"
        }
        fn connection_digest(&self) -> &str {
            &self.digest
        }
        fn generation(&self) -> u64 {
            self.generation
        }
        fn public_proof(&self) -> &str {
            &self.proof
        }
    }

    #[test]
    fn exact_slot_rejects_cross_scope_generation_and_proof() {
        let plan = Plan {
            digest: "a".repeat(64),
            generation: 2,
            proof: "proof".repeat(8),
        };
        let envelope = Envelope {
            schema_version: 1,
            connection_incarnation: plan.connection_incarnation().to_owned(),
            connection_digest: plan.digest.clone(),
            generation: plan.generation,
            public_proof: plan.proof.clone(),
            key: "synthetic-key".to_owned(),
            secret: "synthetic-secret".to_owned(),
        };
        let value = Zeroizing::new(serde_json::to_vec(&envelope).unwrap());
        assert!(decode(&value, &plan).is_ok());
        for wrong in [
            Plan {
                digest: "b".repeat(64),
                generation: 2,
                proof: plan.proof.clone(),
            },
            Plan {
                digest: plan.digest.clone(),
                generation: 3,
                proof: plan.proof.clone(),
            },
            Plan {
                digest: plan.digest.clone(),
                generation: 2,
                proof: "other".repeat(8),
            },
        ] {
            assert_eq!(
                decode(&value, &wrong).unwrap_err(),
                SpaceshipError::CustodyMismatch
            );
        }
    }

    #[test]
    fn masked_pair_refuses_empty_or_header_unsafe_input() {
        assert!(parse_capture(b"one-secret\nanother-secret\n").is_ok());
        for bytes in [
            b"one\n".as_slice(),
            b"one\nwith spaces",
            b"one\nother\r\n",
            b"one\nother\nthird",
        ] {
            assert_eq!(
                parse_capture(bytes).unwrap_err(),
                SpaceshipError::InputRejected
            );
        }
    }

    #[cfg(target_os = "linux")]
    #[test]
    #[ignore = "requires an isolated unlocked Secret Service session"]
    fn linux_spaceship_exact_immutable_slot_canary() {
        use std::fmt::Write as _;
        let mut nonce = [0u8; 32];
        getrandom::fill(&mut nonce).unwrap();
        let digest = nonce
            .iter()
            .fold(String::with_capacity(64), |mut value, byte| {
                write!(&mut value, "{byte:02x}").unwrap();
                value
            });
        let plan = Plan {
            digest,
            generation: 1,
            proof: "test-canary".repeat(4),
        };
        let credential = parse_capture(b"synthetic-key\nsynthetic-secret").unwrap();
        let mut guard = || Ok(());
        publish_spaceship_credential_guarded(&plan, &credential, &mut guard).unwrap();
        let loaded = load_spaceship_credential_guarded(&plan, &mut guard)
            .unwrap()
            .unwrap();
        assert!(
            loaded.key.as_str() == credential.key.as_str()
                && loaded.secret.as_str() == credential.secret.as_str()
        );
        let replacement = parse_capture(b"synthetic-key\nother-secret").unwrap();
        assert_eq!(
            publish_spaceship_credential_guarded(&plan, &replacement, &mut guard),
            Err(SpaceshipError::CustodyMismatch)
        );
        assert!(
            slots::load(Service::Afternic, &slot(&plan).unwrap())
                .ok()
                .flatten()
                .is_none()
        );
        purge_spaceship_credential_guarded(&plan, &mut guard).unwrap();
        assert!(
            load_spaceship_credential_guarded(&plan, &mut guard)
                .unwrap()
                .is_none()
        );
    }
}
