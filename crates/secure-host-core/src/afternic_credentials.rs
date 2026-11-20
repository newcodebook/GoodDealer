//! Afternic-only native capture and immutable generation slots. Host custody and the single
//! workspace process lock own connection generation and retirement; no credential crosses IPC.
use crate::afternic_provider::{AfternicError, AfternicGuard};
use serde::{Deserialize, Serialize};
use std::{fmt, sync::Mutex};
use zeroize::{Zeroize, Zeroizing};

#[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
const SERVICE: &str = "com.gooddealer.desktop.afternic.listing.v1";
const MAX_ENVELOPE: usize = 4096;
static CUSTODY: Mutex<()> = Mutex::new(());

pub struct AfternicCredential {
    key: Zeroizing<String>,
    secret: Zeroizing<String>,
}
impl fmt::Debug for AfternicCredential {
    fn fmt(&self, out: &mut fmt::Formatter<'_>) -> fmt::Result {
        out.write_str("AfternicCredential([REDACTED])")
    }
}
impl AfternicCredential {
    pub(super) fn authorization(&self) -> Zeroizing<String> {
        Zeroizing::new(format!("sso-key {}:{}", *self.key, *self.secret))
    }
}
/// The Host supplies only its committed Afternic slot identity, never Provider account data.
pub trait AfternicCredentialPlan {
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
impl Envelope {
    fn matches(&self, plan: &(impl AfternicCredentialPlan + ?Sized)) -> bool {
        self.schema_version == 1
            && self.connection_incarnation == plan.connection_incarnation()
            && self.connection_digest == plan.connection_digest()
            && self.generation == plan.generation()
            && self.public_proof == plan.public_proof()
            && valid_secret(&self.key)
            && valid_secret(&self.secret)
    }
}
fn slot(plan: &(impl AfternicCredentialPlan + ?Sized)) -> Result<String, AfternicError> {
    if plan.connection_incarnation().is_empty()
        || plan.connection_incarnation().len() > 160
        || !plan
            .connection_incarnation()
            .bytes()
            .all(|b| b.is_ascii_graphic())
        || plan.connection_digest().len() != 64
        || !plan
            .connection_digest()
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        || !(1..=9_007_199_254_740_991).contains(&plan.generation())
        || plan.public_proof().len() < 32
        || plan.public_proof().len() > 160
        || !plan
            .public_proof()
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return Err(AfternicError::InputRejected);
    }
    Ok(format!(
        "{}:{}",
        plan.connection_digest(),
        plan.generation()
    ))
}
/// Publishes an immutable slot only after the Host has durably staged this generation. A failed
/// completion must be reconciled with load; it must never cause a blind credential overwrite.
/// # Errors
/// Refuses stale authority, mismatched existing slots or unavailable platform custody.
pub fn publish_afternic_credential_guarded(
    plan: &(impl AfternicCredentialPlan + ?Sized),
    credential: &AfternicCredential,
    guard: &mut AfternicGuard<'_>,
) -> Result<(), AfternicError> {
    let account = slot(plan)?;
    guard()?;
    let _lock = CUSTODY
        .lock()
        .map_err(|_| AfternicError::CustodyUnavailable)?;
    guard()?;
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
        Zeroizing::new(serde_json::to_vec(&envelope).map_err(|_| AfternicError::InputRejected)?);
    if let Some(old) = native_load(&account)? {
        if old.as_slice() != bytes.as_slice() {
            return Err(AfternicError::CustodyMismatch);
        }
        return guard();
    }
    guard()?;
    native_store(&account, &bytes)?;
    guard()?;
    let read = native_load(&account)?.ok_or(AfternicError::OutcomeUnknown)?;
    if read.as_slice() != bytes.as_slice() {
        return Err(AfternicError::OutcomeUnknown);
    }
    guard()
}
/// Loads only the exact Host-admitted incarnation, generation and proof.
/// # Errors
/// Refuses missing, ambiguous, malformed, replaced or stale credential slots.
pub fn load_afternic_credential_guarded(
    plan: &(impl AfternicCredentialPlan + ?Sized),
    guard: &mut AfternicGuard<'_>,
) -> Result<AfternicCredential, AfternicError> {
    let account = slot(plan)?;
    guard()?;
    let _lock = CUSTODY
        .lock()
        .map_err(|_| AfternicError::CustodyUnavailable)?;
    // Custody serialization can outlive an authority or power epoch. Do not read the
    // slot until the caller has rechecked after acquiring that potentially contended lock.
    guard()?;
    let bytes = native_load(&account)?.ok_or(AfternicError::CustodyMismatch)?;
    let credential = decode(&bytes, plan)?;
    guard()?;
    Ok(credential)
}
fn decode(
    bytes: &[u8],
    plan: &(impl AfternicCredentialPlan + ?Sized),
) -> Result<AfternicCredential, AfternicError> {
    if bytes.is_empty() || bytes.len() > MAX_ENVELOPE {
        return Err(AfternicError::CustodyMismatch);
    }
    let mut envelope: Envelope =
        serde_json::from_slice(bytes).map_err(|_| AfternicError::CustodyMismatch)?;
    if !envelope.matches(plan) {
        return Err(AfternicError::CustodyMismatch);
    }
    Ok(AfternicCredential {
        key: Zeroizing::new(std::mem::take(&mut envelope.key)),
        secret: Zeroizing::new(std::mem::take(&mut envelope.secret)),
    })
}
/// Removes only the exact slot after the Host has committed irreversible retirement.
/// # Errors
/// Refuses stale authority, a mismatched slot, or an unconfirmed delete.
pub fn purge_afternic_credential_guarded(
    plan: &(impl AfternicCredentialPlan + ?Sized),
    guard: &mut AfternicGuard<'_>,
) -> Result<(), AfternicError> {
    let account = slot(plan)?;
    guard()?;
    let _lock = CUSTODY
        .lock()
        .map_err(|_| AfternicError::CustodyUnavailable)?;
    if let Some(bytes) = native_load(&account)? {
        decode(&bytes, plan)?;
    }
    guard()?;
    native_delete(&account)?;
    guard()?;
    if native_load(&account)?.is_some() {
        return Err(AfternicError::OutcomeUnknown);
    }
    guard()
}

pub struct AfternicCapture;
impl AfternicCapture {
    /// Native masked-input adapters are composed for Linux, Windows and macOS. Real OS and custody
    /// qualification is recorded separately from this source capability.
    #[must_use]
    pub const fn supported() -> bool {
        cfg!(any(
            target_os = "linux",
            target_os = "macos",
            target_os = "windows"
        ))
    }
    /// Captures API key and secret in native masked dialogs; never accepts them through IPC.
    /// # Errors
    /// Fails closed on cancellation, timeout, invalid output or a Host authority transition.
    pub fn capture_guarded(
        guard: &mut AfternicGuard<'_>,
    ) -> Result<AfternicCredential, AfternicError> {
        guard()?;
        #[cfg(windows)]
        {
            use crate::windows_credential_capture::{CaptureError, Purpose, capture};
            let mut guard_error = None;
            let captured = capture(Purpose::Afternic, &mut || match guard() {
                Ok(()) => true,
                Err(error) => {
                    guard_error = Some(error);
                    false
                }
            });
            if let Some(error) = guard_error {
                return Err(error);
            }
            let bytes = captured.map_err(|error| match error {
                CaptureError::Cancelled => AfternicError::CaptureCancelled,
                CaptureError::AuthorityStale | CaptureError::Timeout => {
                    AfternicError::AuthorityStale
                }
                CaptureError::Unavailable => AfternicError::CustodyUnavailable,
            })?;
            guard()?;
            parse_capture(&bytes)
        }
        #[cfg(target_os = "macos")]
        {
            capture_macos(guard)
        }
        #[cfg(target_os = "linux")]
        {
            let bytes = crate::linux_afternic_capture::capture(guard)?;
            guard()?;
            parse_capture(&bytes)
        }
        #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
        {
            Err(AfternicError::CustodyUnavailable)
        }
    }
}
fn valid_secret(value: &str) -> bool {
    (16..=512).contains(&value.len())
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}
#[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows", test))]
pub(super) fn parse_capture(bytes: &[u8]) -> Result<AfternicCredential, AfternicError> {
    if bytes.len() > 1026 {
        return Err(AfternicError::InputRejected);
    }
    let text = std::str::from_utf8(bytes).map_err(|_| AfternicError::InputRejected)?;
    let text = text.strip_suffix('\n').unwrap_or(text);
    let (key, secret) = text.split_once('\n').ok_or(AfternicError::InputRejected)?;
    if !valid_secret(key) || !valid_secret(secret) {
        return Err(AfternicError::InputRejected);
    }
    Ok(AfternicCredential {
        key: Zeroizing::new(key.to_owned()),
        secret: Zeroizing::new(secret.to_owned()),
    })
}
#[cfg(target_os = "macos")]
fn capture_macos(guard: &mut AfternicGuard<'_>) -> Result<AfternicCredential, AfternicError> {
    use std::{
        io::Read,
        process::{Command, Stdio},
        time::{Duration, Instant},
    };
    const SCRIPT: &str = r#"set apiKey to text returned of (display dialog "Afternic API key" default answer "" with hidden answer)
set apiSecret to text returned of (display dialog "Afternic API secret" default answer "" with hidden answer)
return apiKey & linefeed & apiSecret"#;
    let mut child = Command::new("/usr/bin/osascript")
        .args(["-e", SCRIPT])
        .env_clear()
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .stdout(Stdio::piped())
        .spawn()
        .map_err(|_| AfternicError::CustodyUnavailable)?;
    let stdout = child
        .stdout
        .take()
        .ok_or(AfternicError::CustodyUnavailable)?;
    let reader = std::thread::spawn(move || {
        let mut bytes = Zeroizing::new(Vec::new());
        stdout.take(1027).read_to_end(&mut bytes).map(|_| bytes)
    });
    let deadline = Instant::now() + Duration::from_secs(120);
    let status = loop {
        if guard().is_err() || Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            let _ = reader.join();
            return Err(AfternicError::AuthorityStale);
        }
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => std::thread::sleep(Duration::from_millis(10)),
            Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = reader.join();
                return Err(AfternicError::CustodyUnavailable);
            }
        }
    };
    let bytes = reader
        .join()
        .map_err(|_| AfternicError::CustodyUnavailable)?
        .map_err(|_| AfternicError::CustodyUnavailable)?;
    guard()?;
    if !status.success() {
        return Err(AfternicError::CaptureCancelled);
    }
    parse_capture(&bytes)
}

#[cfg(target_os = "linux")]
fn native_load(account: &str) -> Result<Option<Zeroizing<Vec<u8>>>, AfternicError> {
    crate::secret_service_custody::load(SERVICE, account)
        .map_err(|_| AfternicError::CustodyUnavailable)
}
#[cfg(target_os = "linux")]
fn native_store(account: &str, bytes: &[u8]) -> Result<(), AfternicError> {
    crate::secret_service_custody::store(SERVICE, account, bytes)
        .map_err(|_| AfternicError::CustodyUnavailable)
}
#[cfg(target_os = "linux")]
fn native_delete(account: &str) -> Result<(), AfternicError> {
    crate::secret_service_custody::delete(SERVICE, account)
        .map_err(|_| AfternicError::CustodyUnavailable)
}
#[cfg(target_os = "macos")]
fn keychain_options(
    account: &str,
    protect: bool,
) -> Result<security_framework::passwords::PasswordOptions, AfternicError> {
    use security_framework::{
        access_control::{ProtectionMode, SecAccessControl},
        passwords::{AccessControlOptions, PasswordOptions},
    };
    let mut options = PasswordOptions::new_generic_password(SERVICE, account);
    options.use_protected_keychain();
    options.set_access_synchronized(Some(false));
    if protect {
        options.set_access_control(
            SecAccessControl::create_with_protection(
                Some(ProtectionMode::AccessibleWhenUnlockedThisDeviceOnly),
                AccessControlOptions::empty().bits(),
            )
            .map_err(|_| AfternicError::CustodyUnavailable)?,
        );
    }
    Ok(options)
}
#[cfg(target_os = "macos")]
fn native_load(account: &str) -> Result<Option<Zeroizing<Vec<u8>>>, AfternicError> {
    match security_framework::passwords::generic_password(keychain_options(account, false)?) {
        Ok(bytes) => Ok(Some(Zeroizing::new(bytes))),
        Err(error) if error.code() == -25300 => Ok(None),
        Err(_) => Err(AfternicError::CustodyUnavailable),
    }
}
#[cfg(target_os = "macos")]
fn native_store(account: &str, bytes: &[u8]) -> Result<(), AfternicError> {
    security_framework::passwords::set_generic_password_options(
        bytes,
        keychain_options(account, true)?,
    )
    .map_err(|_| AfternicError::CustodyUnavailable)
}
#[cfg(target_os = "macos")]
fn native_delete(account: &str) -> Result<(), AfternicError> {
    match security_framework::passwords::delete_generic_password_options(keychain_options(
        account, false,
    )?) {
        Ok(()) => Ok(()),
        Err(error) if error.code() == -25300 => Ok(()),
        Err(_) => Err(AfternicError::CustodyUnavailable),
    }
}
#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
fn native_load(_: &str) -> Result<Option<Zeroizing<Vec<u8>>>, AfternicError> {
    Err(AfternicError::CustodyUnavailable)
}
#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
fn native_store(_: &str, _: &[u8]) -> Result<(), AfternicError> {
    Err(AfternicError::CustodyUnavailable)
}
#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
fn native_delete(_: &str) -> Result<(), AfternicError> {
    Err(AfternicError::CustodyUnavailable)
}

#[cfg(windows)]
fn native_load(account: &str) -> Result<Option<Zeroizing<Vec<u8>>>, AfternicError> {
    crate::windows_custody::load(SERVICE, account)
        .map(|value| value.map(Zeroizing::new))
        .map_err(|_| AfternicError::CustodyUnavailable)
}
#[cfg(windows)]
fn native_store(account: &str, bytes: &[u8]) -> Result<(), AfternicError> {
    crate::windows_custody::store(SERVICE, account, bytes)
        .map_err(|_| AfternicError::CustodyUnavailable)
}
#[cfg(windows)]
fn native_delete(account: &str) -> Result<(), AfternicError> {
    crate::windows_custody::delete(SERVICE, account).map_err(|_| AfternicError::CustodyUnavailable)
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Plan {
        digest: String,
        generation: u64,
        proof: String,
    }
    impl AfternicCredentialPlan for Plan {
        fn connection_incarnation(&self) -> &'static str {
            "incarnation-a"
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
    fn plan() -> Plan {
        Plan {
            digest: "ab".repeat(32),
            generation: 1,
            proof: "p".repeat(43),
        }
    }
    fn envelope(plan: &Plan) -> Envelope {
        Envelope {
            schema_version: 1,
            connection_incarnation: plan.connection_incarnation().into(),
            connection_digest: plan.digest.clone(),
            generation: plan.generation,
            public_proof: plan.proof.clone(),
            key: "fake-key-for-unit-tests".into(),
            secret: "fake-secret-for-unit-tests".into(),
        }
    }
    #[test]
    fn capture_is_bounded_secret_only_and_redacted() {
        let candidate =
            parse_capture(b"fake-key-for-unit-tests\nfake-secret-for-unit-tests\n").unwrap();
        assert_eq!(format!("{candidate:?}"), "AfternicCredential([REDACTED])");
        for wire in [
            b"small\nsmall".as_slice(),
            b"fake-key-for-unit-tests\nfake-secret-for-unit-tests\nextra",
            b"fake-key-for-unit-tests:injection\nfake-secret-for-unit-tests",
            b"fake-key-for-unit-tests\nfake-secret-for-unit-tests\r\n",
        ] {
            assert_eq!(
                parse_capture(wire).unwrap_err(),
                AfternicError::InputRejected
            );
        }
        assert!(parse_capture(&vec![b'a'; 1027]).is_err());
    }
    #[test]
    fn exact_credential_envelope_rejects_wrong_generation_connection_and_proof() {
        let plan = plan();
        let original = envelope(&plan);
        let bytes = serde_json::to_vec(&original).unwrap();
        assert!(decode(&bytes, &plan).is_ok());
        for (field, value) in [
            ("connectionIncarnation", serde_json::json!("other")),
            ("connectionDigest", serde_json::json!("cd".repeat(32))),
            ("generation", serde_json::json!(2)),
            ("publicProof", serde_json::json!("q".repeat(43))),
            ("extra", serde_json::json!(true)),
        ] {
            let mut wire = serde_json::to_value(&original).unwrap();
            wire[field] = value;
            assert_eq!(
                decode(&serde_json::to_vec(&wire).unwrap(), &plan).unwrap_err(),
                AfternicError::CustodyMismatch,
                "{field}"
            );
        }
        let duplicate = String::from_utf8(bytes)
            .unwrap()
            .replacen('{', "{\"generation\":2,", 1);
        assert!(decode(duplicate.as_bytes(), &plan).is_err());
    }
    #[test]
    fn load_rechecks_authority_after_custody_lock_before_reading_native_slot() {
        let mut checks = 0;
        let error = load_afternic_credential_guarded(&plan(), &mut || {
            checks += 1;
            if checks == 1 {
                Ok(())
            } else {
                Err(AfternicError::AuthorityStale)
            }
        })
        .unwrap_err();
        assert_eq!(checks, 2);
        assert_eq!(error, AfternicError::AuthorityStale);
    }
    #[test]
    fn authority_and_invalid_plans_fail_before_any_native_custody_access() {
        let candidate =
            parse_capture(b"fake-key-for-unit-tests\nfake-secret-for-unit-tests\n").unwrap();
        let mut plan = plan();
        assert_eq!(
            publish_afternic_credential_guarded(&plan, &candidate, &mut || Err(
                AfternicError::AuthorityStale
            )),
            Err(AfternicError::AuthorityStale)
        );
        assert_eq!(
            load_afternic_credential_guarded(&plan, &mut || Err(AfternicError::AuthorityStale))
                .unwrap_err(),
            AfternicError::AuthorityStale
        );
        plan.generation = 0;
        assert_eq!(
            purge_afternic_credential_guarded(&plan, &mut || panic!("invalid plan reached guard")),
            Err(AfternicError::InputRejected)
        );
    }
}
