use super::{AtomCredential, AtomError, AtomGuard};
use crate::provider_credential_slot::{self as slots, Service};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use zeroize::{Zeroize, Zeroizing};

const SERVICE: Service = Service::Atom;
const MAX_FIELD: usize = 512;
const MAX_ENVELOPE: usize = 4096;
static CUSTODY: Mutex<()> = Mutex::new(());

/// The local Host supplies the prepared or committed slot in its exclusively held workspace.
/// These identifiers are issued by the Host and contain no Provider account data.
pub trait AtomCredentialPlan {
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
    user_id: String,
    token: String,
}

impl Drop for Envelope {
    fn drop(&mut self) {
        self.user_id.zeroize();
        self.token.zeroize();
    }
}

fn slot(plan: &(impl AtomCredentialPlan + ?Sized)) -> Result<String, AtomError> {
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
        return Err(AtomError::InputRejected);
    }
    Ok(format!("{digest}:{}", plan.generation()))
}

fn valid_user_id(value: &str) -> bool {
    !value.starts_with('0')
        && value.bytes().all(|byte| byte.is_ascii_digit())
        && value.parse::<i64>().is_ok()
}

fn valid_token(value: &str) -> bool {
    (1..=MAX_FIELD).contains(&value.len()) && value.bytes().all(|byte| byte.is_ascii_graphic())
}

fn decode(
    bytes: &[u8],
    plan: &(impl AtomCredentialPlan + ?Sized),
) -> Result<AtomCredential, AtomError> {
    let rejected = AtomError::CustodyMismatch;
    if bytes.len() > MAX_ENVELOPE {
        return Err(rejected);
    }
    let mut envelope: Envelope = serde_json::from_slice(bytes).map_err(|_| rejected)?;
    if envelope.schema_version != 1
        || envelope.connection_incarnation != plan.connection_incarnation()
        || envelope.connection_digest != plan.connection_digest()
        || envelope.generation != plan.generation()
        || envelope.public_proof != plan.public_proof()
        || !valid_user_id(&envelope.user_id)
        || !valid_token(&envelope.token)
    {
        return Err(rejected);
    }
    Ok(AtomCredential {
        user_id: Zeroizing::new(std::mem::take(&mut envelope.user_id)),
        token: Zeroizing::new(std::mem::take(&mut envelope.token)),
    })
}

/// Stores a newly prepared immutable generation. A retry must find the exact same envelope.
///
/// # Errors
/// Rejects stale authority, an occupied mismatched slot, or unconfirmed custody.
pub fn publish_atom_credential_guarded(
    plan: &(impl AtomCredentialPlan + ?Sized),
    credential: &AtomCredential,
    guard: &mut AtomGuard<'_>,
) -> Result<(), AtomError> {
    let account = slot(plan)?;
    let envelope = Envelope {
        schema_version: 1,
        connection_incarnation: plan.connection_incarnation().to_owned(),
        connection_digest: plan.connection_digest().to_owned(),
        generation: plan.generation(),
        public_proof: plan.public_proof().to_owned(),
        user_id: credential.user_id.to_string(),
        token: credential.token.to_string(),
    };
    let bytes =
        Zeroizing::new(serde_json::to_vec(&envelope).map_err(|_| AtomError::InputRejected)?);
    guard()?;
    let _lock = CUSTODY.lock().map_err(|_| AtomError::CustodyUnavailable)?;
    guard()?;
    if let Some(existing) =
        slots::load(SERVICE, &account).map_err(|_| AtomError::CustodyUnavailable)?
    {
        if existing.as_slice() != bytes.as_slice() {
            return Err(AtomError::CustodyMismatch);
        }
        return guard();
    }
    guard()?;
    let unknown = AtomError::CustodyOutcomeUnknown;
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
pub fn load_atom_credential_guarded(
    plan: &(impl AtomCredentialPlan + ?Sized),
    guard: &mut AtomGuard<'_>,
) -> Result<Option<AtomCredential>, AtomError> {
    let account = slot(plan)?;
    guard()?;
    let _lock = CUSTODY.lock().map_err(|_| AtomError::CustodyUnavailable)?;
    guard()?;
    let encoded = slots::load(SERVICE, &account).map_err(|_| AtomError::CustodyUnavailable)?;
    let credential = encoded.map(|bytes| decode(&bytes, plan)).transpose()?;
    guard()?;
    Ok(credential)
}

/// Removes the exact immutable slot after durable retirement denies use.
///
/// # Errors
/// Refuses mismatched identity, stale authority or an unconfirmed delete.
pub fn purge_atom_credential_guarded(
    plan: &(impl AtomCredentialPlan + ?Sized),
    guard: &mut AtomGuard<'_>,
) -> Result<(), AtomError> {
    let account = slot(plan)?;
    guard()?;
    let _lock = CUSTODY.lock().map_err(|_| AtomError::CustodyUnavailable)?;
    guard()?;
    if let Some(bytes) =
        slots::load(SERVICE, &account).map_err(|_| AtomError::CustodyUnavailable)?
    {
        decode(&bytes, plan)?;
        guard()?;
        let unknown = AtomError::CustodyOutcomeUnknown;
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

pub struct AtomCapture;

impl AtomCapture {
    #[must_use]
    pub const fn supported() -> bool {
        cfg!(any(
            target_os = "linux",
            target_os = "macos",
            target_os = "windows"
        ))
    }

    /// Captures a masked seller user ID and API token in a purpose-specific Native dialog.
    ///
    /// # Errors
    /// Refuses stale authority, invalid input or a cancelled or unavailable dialog.
    pub fn capture_guarded(guard: &mut AtomGuard<'_>) -> Result<AtomCredential, AtomError> {
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
            let result = capture(Purpose::Atom, &mut || match guard() {
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
                CaptureError::Unavailable => AtomError::CustodyUnavailable,
                CaptureError::Cancelled => AtomError::CaptureCancelled,
                CaptureError::AuthorityStale => AtomError::AuthorityStale,
                #[cfg(any(target_os = "linux", target_os = "windows"))]
                CaptureError::Timeout => AtomError::CaptureCancelled,
            })?;
            guard()?;
            parse_capture(&bytes)
        }
        #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
        Err(AtomError::CustodyUnavailable)
    }
}

#[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows", test))]
fn parse_capture(bytes: &[u8]) -> Result<AtomCredential, AtomError> {
    let invalid = AtomError::InputRejected;
    if bytes.len() > 2 * MAX_FIELD + 2 {
        return Err(invalid);
    }
    let text = std::str::from_utf8(bytes).map_err(|_| invalid)?;
    let text = text.strip_suffix('\n').unwrap_or(text);
    let (user_id, token) = text.split_once('\n').ok_or(invalid)?;
    if !valid_user_id(user_id) || !valid_token(token) {
        return Err(invalid);
    }
    Ok(AtomCredential {
        user_id: Zeroizing::new(user_id.to_owned()),
        token: Zeroizing::new(token.to_owned()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capture_refuses_noncanonical_user_ids_and_multiline_tokens() {
        assert!(parse_capture(b"123\nsynthetic&user_id=999\n").is_ok());
        for invalid in [
            b"0\nsynthetic".as_slice(),
            b"+1\nsynthetic",
            b"001\nsynthetic",
            b"9223372036854775808\nsynthetic",
            b"1\nsynthetic\nextra",
            b"1\r\nsynthetic",
            b"1\n",
        ] {
            assert!(matches!(
                parse_capture(invalid),
                Err(AtomError::InputRejected)
            ));
        }
    }

    #[cfg(target_os = "linux")]
    #[test]
    #[ignore = "requires an isolated unlocked Secret Service session"]
    fn atom_slot_round_trip_and_revocation_keep_seller_credentials_in_native() {
        struct Plan(String);
        impl AtomCredentialPlan for Plan {
            fn connection_incarnation(&self) -> &'static str {
                "atom-native-canary"
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
        let mut digest = String::with_capacity(64);
        for byte in random {
            use std::fmt::Write as _;
            write!(digest, "{byte:02x}").unwrap();
        }
        let plan = Plan(digest);
        let credential = parse_capture(b"4321\nSyntheticSellerToken").unwrap();
        let guard = &mut || Ok(());
        publish_atom_credential_guarded(&plan, &credential, guard).unwrap();
        let loaded = load_atom_credential_guarded(&plan, guard).unwrap().unwrap();
        assert!(loaded.token == credential.token && loaded.user_id == credential.user_id);
        assert!(matches!(
            slots::load(Service::Afternic, &slot(&plan).unwrap()),
            Ok(None)
        ));
        let stale = &mut || Err(AtomError::AuthorityStale);
        assert!(matches!(
            load_atom_credential_guarded(&plan, stale),
            Err(AtomError::AuthorityStale)
        ));
        purge_atom_credential_guarded(&plan, guard).unwrap();
        assert!(
            load_atom_credential_guarded(&plan, guard)
                .unwrap()
                .is_none()
        );
    }
}
