use super::{AliyunCredential, AliyunError, AliyunGuard};
use crate::provider_credential_slot::{self as slots, Service};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use zeroize::{Zeroize, Zeroizing};

const SERVICE: Service = Service::Aliyun;
const MAX_FIELD: usize = 512;
const MAX_ENVELOPE: usize = 4096;
static CUSTODY: Mutex<()> = Mutex::new(());

/// The local Host supplies the prepared or committed slot in its exclusively held workspace.
/// These identifiers are issued by the Host and contain no Provider account data.
pub trait AliyunCredentialPlan {
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

fn slot(plan: &(impl AliyunCredentialPlan + ?Sized)) -> Result<String, AliyunError> {
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
        return Err(AliyunError::InputRejected);
    }
    Ok(format!("{digest}:{}", plan.generation()))
}

fn valid_access_key_id(value: &str) -> bool {
    (1..=128).contains(&value.len()) && value.bytes().all(|byte| byte.is_ascii_alphanumeric())
}

fn valid_field(value: &str) -> bool {
    (1..=MAX_FIELD).contains(&value.len()) && value.bytes().all(|byte| byte.is_ascii_graphic())
}

fn decode(
    bytes: &[u8],
    plan: &(impl AliyunCredentialPlan + ?Sized),
) -> Result<AliyunCredential, AliyunError> {
    let rejected = AliyunError::CustodyMismatch;
    if bytes.len() > MAX_ENVELOPE {
        return Err(rejected);
    }
    let mut envelope: Envelope = serde_json::from_slice(bytes).map_err(|_| rejected)?;
    if envelope.schema_version != 1
        || envelope.connection_incarnation != plan.connection_incarnation()
        || envelope.connection_digest != plan.connection_digest()
        || envelope.generation != plan.generation()
        || envelope.public_proof != plan.public_proof()
        || !valid_access_key_id(&envelope.key)
        || !valid_field(&envelope.secret)
    {
        return Err(rejected);
    }
    Ok(AliyunCredential {
        key: Zeroizing::new(std::mem::take(&mut envelope.key)),
        secret: Zeroizing::new(std::mem::take(&mut envelope.secret)),
    })
}

/// Stores a newly prepared immutable generation. A retry must find the exact same envelope.
///
/// # Errors
/// Rejects stale authority, an occupied mismatched slot, or unconfirmed custody.
pub fn publish_aliyun_credential_guarded(
    plan: &(impl AliyunCredentialPlan + ?Sized),
    credential: &AliyunCredential,
    guard: &mut AliyunGuard<'_>,
) -> Result<(), AliyunError> {
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
        Zeroizing::new(serde_json::to_vec(&envelope).map_err(|_| AliyunError::InputRejected)?);
    guard()?;
    let _lock = CUSTODY
        .lock()
        .map_err(|_| AliyunError::CustodyUnavailable)?;
    guard()?;
    if let Some(existing) =
        slots::load(SERVICE, &account).map_err(|_| AliyunError::CustodyUnavailable)?
    {
        if existing.as_slice() != bytes.as_slice() {
            return Err(AliyunError::CustodyMismatch);
        }
        return guard();
    }
    guard()?;
    let unknown = AliyunError::CustodyOutcomeUnknown;
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
pub fn load_aliyun_credential_guarded(
    plan: &(impl AliyunCredentialPlan + ?Sized),
    guard: &mut AliyunGuard<'_>,
) -> Result<Option<AliyunCredential>, AliyunError> {
    let account = slot(plan)?;
    guard()?;
    let _lock = CUSTODY
        .lock()
        .map_err(|_| AliyunError::CustodyUnavailable)?;
    guard()?;
    let encoded = slots::load(SERVICE, &account).map_err(|_| AliyunError::CustodyUnavailable)?;
    let credential = encoded.map(|bytes| decode(&bytes, plan)).transpose()?;
    guard()?;
    Ok(credential)
}

/// Removes the exact immutable slot after durable retirement denies use.
///
/// # Errors
/// Refuses mismatched identity, stale authority or an unconfirmed delete.
pub fn purge_aliyun_credential_guarded(
    plan: &(impl AliyunCredentialPlan + ?Sized),
    guard: &mut AliyunGuard<'_>,
) -> Result<(), AliyunError> {
    let account = slot(plan)?;
    guard()?;
    let _lock = CUSTODY
        .lock()
        .map_err(|_| AliyunError::CustodyUnavailable)?;
    guard()?;
    if let Some(bytes) =
        slots::load(SERVICE, &account).map_err(|_| AliyunError::CustodyUnavailable)?
    {
        decode(&bytes, plan)?;
        guard()?;
        let unknown = AliyunError::CustodyOutcomeUnknown;
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

pub struct AliyunCapture;

impl AliyunCapture {
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
    pub fn capture_guarded(guard: &mut AliyunGuard<'_>) -> Result<AliyunCredential, AliyunError> {
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
            let result = capture(Purpose::Aliyun, &mut || match guard() {
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
                CaptureError::Unavailable => AliyunError::CustodyUnavailable,
                CaptureError::Cancelled => AliyunError::CaptureCancelled,
                CaptureError::AuthorityStale => AliyunError::AuthorityStale,
                #[cfg(any(target_os = "linux", target_os = "windows"))]
                CaptureError::Timeout => AliyunError::CaptureCancelled,
            })?;
            guard()?;
            parse_capture(&bytes)
        }
        #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
        Err(AliyunError::CustodyUnavailable)
    }
}

#[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows", test))]
fn parse_capture(bytes: &[u8]) -> Result<AliyunCredential, AliyunError> {
    let invalid = AliyunError::InputRejected;
    if bytes.len() > 2 * MAX_FIELD + 2 {
        return Err(invalid);
    }
    let text = std::str::from_utf8(bytes).map_err(|_| invalid)?;
    let text = text.strip_suffix('\n').unwrap_or(text);
    let (key, secret) = text.split_once('\n').ok_or(invalid)?;
    if !valid_access_key_id(key) || !valid_field(secret) {
        return Err(invalid);
    }
    Ok(AliyunCredential {
        key: Zeroizing::new(key.to_owned()),
        secret: Zeroizing::new(secret.to_owned()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capture_refuses_access_key_delimiters_control_bytes_and_extra_fields() {
        assert!(parse_capture(b"SyntheticAccessKey\nSyntheticSecret\n").is_ok());
        for invalid in [
            b"key,Signature=spoof\nSyntheticSecret".as_slice(),
            b"id\nsecret\nextra",
            b"id\r\nsecret",
            b"id\n",
        ] {
            assert!(matches!(
                parse_capture(invalid),
                Err(AliyunError::InputRejected)
            ));
        }
    }

    #[cfg(target_os = "linux")]
    #[test]
    #[ignore = "requires an isolated unlocked Secret Service session"]
    fn linux_aliyun_slot_round_trip_isolated_from_spaceship() {
        struct Plan(String);
        impl AliyunCredentialPlan for Plan {
            fn connection_incarnation(&self) -> &'static str {
                "aliyun-native-canary"
            }
            fn connection_digest(&self) -> &str {
                &self.0
            }
            fn generation(&self) -> u64 {
                1
            }
            fn public_proof(&self) -> &'static str {
                "syntheticproofsyntheticproofsyntheticproof"
            }
        }
        let mut random = [0; 32];
        getrandom::fill(&mut random).unwrap();
        let plan = Plan(crate::aliyun::signing::lower_hex(&random));
        let credential = parse_capture(b"SyntheticAccessKey\nSyntheticSecret").unwrap();
        let guard = &mut || Ok(());
        publish_aliyun_credential_guarded(&plan, &credential, guard).unwrap();
        let loaded = load_aliyun_credential_guarded(&plan, guard)
            .unwrap()
            .unwrap();
        assert!(
            loaded.key.as_str() == credential.key.as_str()
                && loaded.secret.as_str() == credential.secret.as_str()
        );
        assert!(matches!(
            slots::load(Service::Spaceship, &slot(&plan).unwrap()),
            Ok(None)
        ));
        let mismatch = parse_capture(b"SyntheticAccessKey\nDifferentSyntheticSecret").unwrap();
        assert_eq!(
            publish_aliyun_credential_guarded(&plan, &mismatch, guard),
            Err(AliyunError::CustodyMismatch)
        );
        purge_aliyun_credential_guarded(&plan, guard).unwrap();
        assert!(
            load_aliyun_credential_guarded(&plan, guard)
                .unwrap()
                .is_none()
        );
    }
}
