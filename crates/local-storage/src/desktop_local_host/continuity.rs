//! Private authority-continuity receipt and monotonic-anchor protocol.
//!
//! This module intentionally has no public exports.  A receipt is evidence for the owning
//! `DesktopLocalHost`, never an authorization token and never a substitute for a live Grant.
//! The production anchor adapter remains unavailable until an independently qualified
//! anti-rollback primitive is available; a normal Keychain blob is not monotonic custody.

use std::fmt;
use std::sync::Arc;
#[cfg(test)]
use std::sync::Mutex;

use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{Key, XChaCha20Poly1305, XNonce};
use sha2::{Digest, Sha256};
use zeroize::{Zeroize, Zeroizing};

#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "qualified production continuity is capability-gated"
    )
)]
const MAGIC: &[u8; 8] = b"GDCA\0V1\0";
#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "qualified production continuity is capability-gated"
    )
)]
const SCHEMA_VERSION: u8 = 1;
#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "qualified production continuity is capability-gated"
    )
)]
const AD_DOMAIN: &[u8] = b"GOODDEALER/BACKUP-AUTHORITY-CONTINUITY-V1\0";
#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "qualified production continuity is capability-gated"
    )
)]
pub(crate) const MAX_RECEIPT_BYTES: usize = 4096;
const DIGEST_BYTES: usize = 32;
#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "qualified production continuity is capability-gated"
    )
)]
const NONCE_BYTES: usize = 24;
const KEY_BYTES: usize = 32;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "qualified production continuity is capability-gated"
    )
)]
pub(crate) enum ContinuityError {
    Malformed,
    AuthenticationFailed,
    BindingRejected,
    RollbackRejected,
    StorageRejected,
    Unavailable,
}

impl fmt::Display for ContinuityError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Malformed => "BACKUP_CONTINUITY_MALFORMED",
            Self::AuthenticationFailed => "BACKUP_CONTINUITY_AUTHENTICATION_FAILED",
            Self::BindingRejected => "BACKUP_CONTINUITY_BINDING_REJECTED",
            Self::RollbackRejected => "BACKUP_CONTINUITY_ROLLBACK_REJECTED",
            Self::StorageRejected => "BACKUP_CONTINUITY_STORAGE_REJECTED",
            Self::Unavailable => "BACKUP_CONTINUITY_UNAVAILABLE",
        })
    }
}

impl std::error::Error for ContinuityError {}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "qualified production continuity is capability-gated"
    )
)]
pub(super) enum ReceiptState {
    Continuation,
    Closed,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum BarrierReason {
    ReplacementPending,
    Security,
    Retryable,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "qualified production continuity is capability-gated"
    )
)]
pub(super) enum AnchorState {
    Committed {
        slot: u8,
        sequence: u64,
        receipt_digest: [u8; DIGEST_BYTES],
    },
    Barrier {
        reason: BarrierReason,
        sequence: u64,
    },
}

#[derive(Clone, PartialEq, Eq)]
pub(super) struct ContinuityReceiptV1 {
    pub(super) sequence: u64,
    pub(super) state: ReceiptState,
    pub(super) installation_digest: [u8; DIGEST_BYTES],
    pub(super) account_digest: [u8; DIGEST_BYTES],
    pub(super) workspace_digest: [u8; DIGEST_BYTES],
    pub(super) device_digest: [u8; DIGEST_BYTES],
    pub(super) account_security_epoch: u64,
    pub(super) lease_epoch: u64,
    pub(super) entitlement_revision: u64,
    pub(super) entitlement_projection_digest: [u8; DIGEST_BYTES],
    pub(super) commercial_expires_at: i64,
    pub(super) trusted_time_floor: i64,
    pub(super) execute_before: i64,
    pub(super) authority_generation: u64,
    pub(super) database_lineage_digest: [u8; DIGEST_BYTES],
    pub(super) database_publication_generation: u64,
}

impl fmt::Debug for ContinuityReceiptV1 {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("ContinuityReceiptV1([REDACTED])")
    }
}

#[derive(Clone, PartialEq, Eq)]
pub(super) struct ContinuityAnchorV1 {
    pub(super) monotonic_counter: u64,
    pub(super) state: AnchorState,
    pub(super) installation_digest: [u8; DIGEST_BYTES],
    pub(super) maximum_account_security_epoch: u64,
    pub(super) maximum_lease_epoch: u64,
    pub(super) maximum_entitlement_revision: u64,
    pub(super) maximum_trusted_time_floor: i64,
    pub(super) maximum_authority_generation: u64,
    pub(super) database_lineage_digest: [u8; DIGEST_BYTES],
    pub(super) database_publication_generation: u64,
}

impl fmt::Debug for ContinuityAnchorV1 {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("ContinuityAnchorV1([REDACTED])")
    }
}

#[derive(Clone, Copy)]
#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "qualified production continuity is capability-gated"
    )
)]
pub(super) struct ContinuityBinding {
    pub(super) installation_digest: [u8; DIGEST_BYTES],
    pub(super) account_digest: [u8; DIGEST_BYTES],
    pub(super) workspace_digest: [u8; DIGEST_BYTES],
    pub(super) device_digest: [u8; DIGEST_BYTES],
    pub(super) minimum_account_security_epoch: u64,
    pub(super) minimum_lease_epoch: u64,
    pub(super) minimum_entitlement_revision: u64,
    pub(super) database_lineage_digest: [u8; DIGEST_BYTES],
    pub(super) database_publication_generation: u64,
}

#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "qualified production continuity is capability-gated"
    )
)]
pub(super) trait ContinuityAnchorStore: Send + Sync {
    fn load(&self) -> Result<Option<ContinuityAnchorV1>, ContinuityError>;
    fn commit_barrier(
        &self,
        expected_counter: u64,
        next: &ContinuityAnchorV1,
    ) -> Result<(), ContinuityError>;
    fn commit_receipt(
        &self,
        expected_counter: u64,
        next: &ContinuityAnchorV1,
    ) -> Result<(), ContinuityError>;
}

#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "qualified production continuity is capability-gated"
    )
)]
pub(crate) trait ContinuityReceiptStore: Send + Sync {
    fn load(&self, slot: u8) -> Result<Option<Zeroizing<Vec<u8>>>, ContinuityError>;
    fn store(&self, slot: u8, sealed: &[u8]) -> Result<(), ContinuityError>;
    fn any_receipt(&self) -> Result<bool, ContinuityError>;
}

/// Production deliberately remains closed.  Keychain persistence alone is rollbackable and is
/// therefore not accepted as an anchor implementation.
pub(super) struct ProductionContinuityAnchor;

impl ContinuityAnchorStore for ProductionContinuityAnchor {
    fn load(&self) -> Result<Option<ContinuityAnchorV1>, ContinuityError> {
        Err(ContinuityError::Unavailable)
    }
    fn commit_barrier(&self, _: u64, _: &ContinuityAnchorV1) -> Result<(), ContinuityError> {
        Err(ContinuityError::Unavailable)
    }
    fn commit_receipt(&self, _: u64, _: &ContinuityAnchorV1) -> Result<(), ContinuityError> {
        Err(ContinuityError::Unavailable)
    }
}

#[cfg(test)]
#[derive(Default)]
pub(super) struct DevelopmentContinuityAnchor {
    state: Mutex<Option<ContinuityAnchorV1>>,
    fail_next: Mutex<bool>,
}

#[cfg(test)]
impl DevelopmentContinuityAnchor {
    fn fail_next_commit(&self) {
        *self.fail_next.lock().expect("test mutex") = true;
    }
}

#[cfg(test)]
impl ContinuityAnchorStore for DevelopmentContinuityAnchor {
    fn load(&self) -> Result<Option<ContinuityAnchorV1>, ContinuityError> {
        Ok(self.state.lock().expect("anchor mutex").clone())
    }

    fn commit_barrier(
        &self,
        expected_counter: u64,
        next: &ContinuityAnchorV1,
    ) -> Result<(), ContinuityError> {
        self.commit(expected_counter, next, false)
    }

    fn commit_receipt(
        &self,
        expected_counter: u64,
        next: &ContinuityAnchorV1,
    ) -> Result<(), ContinuityError> {
        self.commit(expected_counter, next, true)
    }
}

#[cfg(test)]
impl DevelopmentContinuityAnchor {
    fn commit(
        &self,
        expected_counter: u64,
        next: &ContinuityAnchorV1,
        require_replacement_barrier: bool,
    ) -> Result<(), ContinuityError> {
        if *self.fail_next.lock().expect("fault mutex") {
            *self.fail_next.lock().expect("fault mutex") = false;
            return Err(ContinuityError::StorageRejected);
        }
        validate_anchor(next)?;
        let mut state = self.state.lock().expect("anchor mutex");
        if require_replacement_barrier
            && !matches!(
                state.as_ref().map(|value| value.state),
                Some(AnchorState::Barrier {
                    reason: BarrierReason::ReplacementPending,
                    ..
                })
            )
        {
            return Err(ContinuityError::RollbackRejected);
        }
        let actual = state.as_ref().map_or(0, |a| a.monotonic_counter);
        if actual != expected_counter
            || next.monotonic_counter != expected_counter.saturating_add(1)
        {
            return Err(ContinuityError::RollbackRejected);
        }
        *state = Some(next.clone());
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "qualified production continuity is capability-gated"
    )
)]
pub(super) enum StartupContinuity {
    ActivationRequired,
    SecurityLocked,
    RetryableLocked,
    VerifiedLocalContinuation,
}

#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "qualified production continuity is capability-gated"
    )
)]
fn put_u64(out: &mut Vec<u8>, value: u64) {
    out.extend_from_slice(&value.to_be_bytes());
}
#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "qualified production continuity is capability-gated"
    )
)]
fn put_i64(out: &mut Vec<u8>, value: i64) {
    out.extend_from_slice(&value.to_be_bytes());
}

#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "qualified production continuity is capability-gated"
    )
)]
fn read_u64(input: &[u8], at: &mut usize) -> Result<u64, ContinuityError> {
    let end = at.checked_add(8).ok_or(ContinuityError::Malformed)?;
    let bytes: [u8; 8] = input
        .get(*at..end)
        .ok_or(ContinuityError::Malformed)?
        .try_into()
        .unwrap();
    *at = end;
    Ok(u64::from_be_bytes(bytes))
}
#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "qualified production continuity is capability-gated"
    )
)]
fn read_i64(input: &[u8], at: &mut usize) -> Result<i64, ContinuityError> {
    let end = at.checked_add(8).ok_or(ContinuityError::Malformed)?;
    let bytes: [u8; 8] = input
        .get(*at..end)
        .ok_or(ContinuityError::Malformed)?
        .try_into()
        .unwrap();
    *at = end;
    Ok(i64::from_be_bytes(bytes))
}
#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "qualified production continuity is capability-gated"
    )
)]
fn read_digest(input: &[u8], at: &mut usize) -> Result<[u8; DIGEST_BYTES], ContinuityError> {
    let end = at
        .checked_add(DIGEST_BYTES)
        .ok_or(ContinuityError::Malformed)?;
    let value = input
        .get(*at..end)
        .ok_or(ContinuityError::Malformed)?
        .try_into()
        .unwrap();
    *at = end;
    Ok(value)
}

#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "qualified production continuity is capability-gated"
    )
)]
fn receipt_plaintext(receipt: &ContinuityReceiptV1) -> Result<Vec<u8>, ContinuityError> {
    if receipt.sequence == 0
        || receipt.account_security_epoch == 0
        || receipt.lease_epoch == 0
        || receipt.entitlement_revision == 0
        || receipt.authority_generation == 0
        || receipt.database_publication_generation == 0
        || receipt.sequence > MAX_SAFE_INTEGER
        || receipt.account_security_epoch > MAX_SAFE_INTEGER
        || receipt.lease_epoch > MAX_SAFE_INTEGER
        || receipt.entitlement_revision > MAX_SAFE_INTEGER
        || receipt.authority_generation > MAX_SAFE_INTEGER
        || receipt.database_publication_generation > MAX_SAFE_INTEGER
        || receipt.trusted_time_floor <= 0
        || receipt.execute_before <= receipt.trusted_time_floor
        || receipt.commercial_expires_at <= receipt.trusted_time_floor
    {
        return Err(ContinuityError::Malformed);
    }
    let mut out = Vec::with_capacity(256);
    out.extend_from_slice(MAGIC);
    out.push(SCHEMA_VERSION);
    out.push(match receipt.state {
        ReceiptState::Continuation => 1,
        ReceiptState::Closed => 2,
    });
    put_u64(&mut out, receipt.sequence);
    for digest in [
        receipt.installation_digest,
        receipt.account_digest,
        receipt.workspace_digest,
        receipt.device_digest,
    ] {
        out.extend_from_slice(&digest);
    }
    put_u64(&mut out, receipt.account_security_epoch);
    put_u64(&mut out, receipt.lease_epoch);
    put_u64(&mut out, receipt.entitlement_revision);
    out.extend_from_slice(&receipt.entitlement_projection_digest);
    put_i64(&mut out, receipt.commercial_expires_at);
    put_i64(&mut out, receipt.trusted_time_floor);
    put_i64(&mut out, receipt.execute_before);
    put_u64(&mut out, receipt.authority_generation);
    out.extend_from_slice(&receipt.database_lineage_digest);
    put_u64(&mut out, receipt.database_publication_generation);
    let digest: [u8; 32] = Sha256::digest(&out).into();
    out.extend_from_slice(&digest);
    Ok(out)
}

#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "qualified production continuity is capability-gated"
    )
)]
fn parse_receipt_plaintext(input: &[u8]) -> Result<ContinuityReceiptV1, ContinuityError> {
    if input.len() < 8 + 2 + 8 + 4 * 32 + 3 * 8 + 32 + 3 * 8 + 8 + 32 + 8 + 32 {
        return Err(ContinuityError::Malformed);
    }
    let mut at = 0;
    if input.get(..8) != Some(MAGIC) {
        return Err(ContinuityError::Malformed);
    }
    at += 8;
    if input.get(at) != Some(&SCHEMA_VERSION) {
        return Err(ContinuityError::Malformed);
    }
    at += 1;
    let state = match input.get(at) {
        Some(1) => ReceiptState::Continuation,
        Some(2) => ReceiptState::Closed,
        _ => return Err(ContinuityError::Malformed),
    };
    at += 1;
    let sequence = read_u64(input, &mut at)?;
    let installation_digest = read_digest(input, &mut at)?;
    let account_digest = read_digest(input, &mut at)?;
    let workspace_digest = read_digest(input, &mut at)?;
    let device_digest = read_digest(input, &mut at)?;
    let account_security_epoch = read_u64(input, &mut at)?;
    let lease_epoch = read_u64(input, &mut at)?;
    let entitlement_revision = read_u64(input, &mut at)?;
    let entitlement_projection_digest = read_digest(input, &mut at)?;
    let commercial_expires_at = read_i64(input, &mut at)?;
    let trusted_time_floor = read_i64(input, &mut at)?;
    let execute_before = read_i64(input, &mut at)?;
    let authority_generation = read_u64(input, &mut at)?;
    let database_lineage_digest = read_digest(input, &mut at)?;
    let database_publication_generation = read_u64(input, &mut at)?;
    let expected_digest = read_digest(input, &mut at)?;
    if at != input.len() || Sha256::digest(&input[..at - 32]).as_slice() != expected_digest {
        return Err(ContinuityError::AuthenticationFailed);
    }
    let receipt = ContinuityReceiptV1 {
        sequence,
        state,
        installation_digest,
        account_digest,
        workspace_digest,
        device_digest,
        account_security_epoch,
        lease_epoch,
        entitlement_revision,
        entitlement_projection_digest,
        commercial_expires_at,
        trusted_time_floor,
        execute_before,
        authority_generation,
        database_lineage_digest,
        database_publication_generation,
    };
    receipt_plaintext(&receipt).map(|_| receipt)
}

#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "qualified production continuity is capability-gated"
    )
)]
fn associated_data(installation: &[u8; 32], slot: u8, sequence: u64) -> Vec<u8> {
    let mut ad = Vec::with_capacity(AD_DOMAIN.len() + 41);
    ad.extend_from_slice(AD_DOMAIN);
    ad.extend_from_slice(installation);
    ad.push(slot);
    ad.extend_from_slice(&sequence.to_be_bytes());
    ad
}

#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "qualified production continuity is capability-gated"
    )
)]
fn seal_receipt(
    key: &[u8; KEY_BYTES],
    slot: u8,
    receipt: &ContinuityReceiptV1,
) -> Result<Zeroizing<Vec<u8>>, ContinuityError> {
    if slot > 1 {
        return Err(ContinuityError::Malformed);
    }
    let plaintext = Zeroizing::new(receipt_plaintext(receipt)?);
    let mut nonce = [0_u8; NONCE_BYTES];
    getrandom::fill(&mut nonce).map_err(|_| ContinuityError::Unavailable)?;
    let cipher = XChaCha20Poly1305::new(&Key::from(*key));
    let ciphertext = cipher
        .encrypt(
            &XNonce::from(nonce),
            Payload {
                msg: &plaintext,
                aad: &associated_data(&receipt.installation_digest, slot, receipt.sequence),
            },
        )
        .map_err(|_| ContinuityError::AuthenticationFailed)?;
    // The non-secret binding fields needed to reconstruct AD are duplicated in the envelope and
    // authenticated by AEAD.  The decrypted copies must match exactly.
    let mut sealed = Vec::with_capacity(1 + 8 + DIGEST_BYTES + NONCE_BYTES + ciphertext.len());
    sealed.push(slot);
    sealed.extend_from_slice(&receipt.sequence.to_be_bytes());
    sealed.extend_from_slice(&receipt.installation_digest);
    sealed.extend_from_slice(&nonce);
    sealed.extend_from_slice(&ciphertext);
    if sealed.len() > MAX_RECEIPT_BYTES {
        return Err(ContinuityError::Malformed);
    }
    nonce.zeroize();
    Ok(Zeroizing::new(sealed))
}

#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "qualified production continuity is capability-gated"
    )
)]
fn open_receipt(
    key: &[u8; KEY_BYTES],
    expected_slot: u8,
    sealed: &[u8],
) -> Result<ContinuityReceiptV1, ContinuityError> {
    const ENVELOPE_BYTES: usize = 1 + 8 + DIGEST_BYTES + NONCE_BYTES;
    if expected_slot > 1
        || sealed.len() > MAX_RECEIPT_BYTES
        || sealed.len() <= ENVELOPE_BYTES + 16
        || sealed[0] != expected_slot
    {
        return Err(ContinuityError::Malformed);
    }
    let sequence = u64::from_be_bytes(
        sealed[1..9]
            .try_into()
            .map_err(|_| ContinuityError::Malformed)?,
    );
    let installation: [u8; DIGEST_BYTES] = sealed[9..9 + DIGEST_BYTES]
        .try_into()
        .map_err(|_| ContinuityError::Malformed)?;
    let nonce_start = 9 + DIGEST_BYTES;
    let nonce: [u8; NONCE_BYTES] = sealed[nonce_start..ENVELOPE_BYTES]
        .try_into()
        .map_err(|_| ContinuityError::Malformed)?;
    let cipher = XChaCha20Poly1305::new(&Key::from(*key));
    let mut plaintext = Zeroizing::new(
        cipher
            .decrypt(
                &XNonce::from(nonce),
                Payload {
                    msg: &sealed[ENVELOPE_BYTES..],
                    aad: &associated_data(&installation, expected_slot, sequence),
                },
            )
            .map_err(|_| ContinuityError::AuthenticationFailed)?,
    );
    let receipt = parse_receipt_plaintext(&plaintext)?;
    if receipt.sequence != sequence || receipt.installation_digest != installation {
        return Err(ContinuityError::AuthenticationFailed);
    }
    plaintext.zeroize();
    Ok(receipt)
}

#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "qualified production continuity is capability-gated"
    )
)]
fn validate_anchor(anchor: &ContinuityAnchorV1) -> Result<(), ContinuityError> {
    if anchor.monotonic_counter == 0
        || anchor.monotonic_counter > MAX_SAFE_INTEGER
        || anchor.maximum_account_security_epoch == 0
        || anchor.maximum_account_security_epoch > MAX_SAFE_INTEGER
        || anchor.maximum_lease_epoch == 0
        || anchor.maximum_lease_epoch > MAX_SAFE_INTEGER
        || anchor.maximum_entitlement_revision == 0
        || anchor.maximum_entitlement_revision > MAX_SAFE_INTEGER
        || anchor.maximum_trusted_time_floor <= 0
        || anchor.maximum_authority_generation == 0
        || anchor.maximum_authority_generation > MAX_SAFE_INTEGER
        || anchor.database_publication_generation == 0
        || anchor.database_publication_generation > MAX_SAFE_INTEGER
    {
        return Err(ContinuityError::Malformed);
    }
    match anchor.state {
        AnchorState::Committed { slot, sequence, .. } if slot <= 1 && sequence > 0 => Ok(()),
        AnchorState::Barrier { sequence, .. } if sequence > 0 => Ok(()),
        _ => Err(ContinuityError::Malformed),
    }
}

fn anchor_for_receipt(
    receipt: &ContinuityReceiptV1,
    counter: u64,
    state: AnchorState,
) -> ContinuityAnchorV1 {
    ContinuityAnchorV1 {
        monotonic_counter: counter,
        state,
        installation_digest: receipt.installation_digest,
        maximum_account_security_epoch: receipt.account_security_epoch,
        maximum_lease_epoch: receipt.lease_epoch,
        maximum_entitlement_revision: receipt.entitlement_revision,
        maximum_trusted_time_floor: receipt.trusted_time_floor,
        maximum_authority_generation: receipt.authority_generation,
        database_lineage_digest: receipt.database_lineage_digest,
        database_publication_generation: receipt.database_publication_generation,
    }
}

#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "qualified production continuity is capability-gated"
    )
)]
fn verify_receipt(
    receipt: &ContinuityReceiptV1,
    sealed: &[u8],
    loaded_slot: u8,
    anchor: &ContinuityAnchorV1,
    binding: &ContinuityBinding,
    now: i64,
) -> Result<(), ContinuityError> {
    if receipt.state != ReceiptState::Continuation
        || anchor.installation_digest != binding.installation_digest
        || receipt.installation_digest != binding.installation_digest
        || receipt.account_digest != binding.account_digest
        || receipt.workspace_digest != binding.workspace_digest
        || receipt.device_digest != binding.device_digest
        || receipt.database_lineage_digest != binding.database_lineage_digest
        || receipt.database_publication_generation != binding.database_publication_generation
        || receipt.account_security_epoch < binding.minimum_account_security_epoch
        || receipt.lease_epoch < binding.minimum_lease_epoch
        || receipt.entitlement_revision < binding.minimum_entitlement_revision
        || receipt.trusted_time_floor > now
        || now >= receipt.execute_before
        || receipt.commercial_expires_at <= now
    {
        return Err(ContinuityError::BindingRejected);
    }
    if anchor.maximum_account_security_epoch != receipt.account_security_epoch
        || anchor.maximum_lease_epoch != receipt.lease_epoch
        || anchor.maximum_entitlement_revision != receipt.entitlement_revision
        || anchor.maximum_trusted_time_floor != receipt.trusted_time_floor
        || anchor.maximum_authority_generation != receipt.authority_generation
        || anchor.database_lineage_digest != receipt.database_lineage_digest
        || anchor.database_publication_generation != receipt.database_publication_generation
    {
        return Err(ContinuityError::RollbackRejected);
    }
    let sealed_digest: [u8; DIGEST_BYTES] = Sha256::digest(sealed).into();
    match anchor.state {
        AnchorState::Committed {
            slot,
            sequence,
            receipt_digest,
        } if slot == loaded_slot
            && sequence == receipt.sequence
            && receipt_digest == sealed_digest =>
        {
            Ok(())
        }
        _ => Err(ContinuityError::AuthenticationFailed),
    }
}

#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "qualified production continuity is capability-gated"
    )
)]
fn startup_decision(
    receipt: Option<&ContinuityReceiptV1>,
    sealed: Option<&[u8]>,
    loaded_slot: Option<u8>,
    anchor: Option<&ContinuityAnchorV1>,
    binding: &ContinuityBinding,
    now: i64,
    database_exists: bool,
) -> StartupContinuity {
    if receipt.is_none() && anchor.is_none() && !database_exists {
        return StartupContinuity::ActivationRequired;
    }
    let (Some(receipt), Some(sealed), Some(loaded_slot), Some(anchor)) =
        (receipt, sealed, loaded_slot, anchor)
    else {
        return StartupContinuity::SecurityLocked;
    };
    if let AnchorState::Barrier { reason, .. } = anchor.state {
        return match reason {
            BarrierReason::Retryable => StartupContinuity::RetryableLocked,
            BarrierReason::Security | BarrierReason::ReplacementPending => {
                StartupContinuity::SecurityLocked
            }
        };
    }
    verify_receipt(receipt, sealed, loaded_slot, anchor, binding, now)
        .map_or(StartupContinuity::SecurityLocked, |()| {
            StartupContinuity::VerifiedLocalContinuation
        })
}

#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "qualified production continuity is capability-gated"
    )
)]
fn begin_verified_replacement(
    old_anchor: Option<&ContinuityAnchorV1>,
    replacement: &ContinuityReceiptV1,
    binding: &ContinuityBinding,
    now: i64,
    store: &dyn ContinuityAnchorStore,
) -> Result<u64, ContinuityError> {
    if replacement.state != ReceiptState::Continuation
        || replacement.installation_digest != binding.installation_digest
    {
        return Err(ContinuityError::BindingRejected);
    }
    if replacement.trusted_time_floor > now || now >= replacement.execute_before {
        return Err(ContinuityError::BindingRejected);
    }
    let current = old_anchor.map_or(0, |a| a.monotonic_counter);
    let next_counter = current
        .checked_add(1)
        .ok_or(ContinuityError::RollbackRejected)?;
    let barrier = anchor_for_receipt(
        replacement,
        next_counter,
        AnchorState::Barrier {
            reason: BarrierReason::ReplacementPending,
            sequence: replacement.sequence,
        },
    );
    store.commit_barrier(current, &barrier)?;
    Ok(next_counter)
}

#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "qualified production continuity is capability-gated"
    )
)]
fn commit_verified_replacement(
    expected_counter: u64,
    slot: u8,
    receipt: &ContinuityReceiptV1,
    sealed: &[u8],
    store: &dyn ContinuityAnchorStore,
) -> Result<(), ContinuityError> {
    if slot > 1 || sealed.is_empty() {
        return Err(ContinuityError::Malformed);
    }
    let digest: [u8; DIGEST_BYTES] = Sha256::digest(sealed).into();
    let anchor = anchor_for_receipt(
        receipt,
        expected_counter
            .checked_add(1)
            .ok_or(ContinuityError::RollbackRejected)?,
        AnchorState::Committed {
            slot,
            sequence: receipt.sequence,
            receipt_digest: digest,
        },
    );
    store.commit_receipt(expected_counter, &anchor)
}

pub(super) struct VerifiedLocalContinuation {
    receipt: ContinuityReceiptV1,
}

impl fmt::Debug for VerifiedLocalContinuation {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("VerifiedLocalContinuation([REDACTED])")
    }
}

impl VerifiedLocalContinuation {
    pub(super) fn is_current_at(&self, now: i64) -> bool {
        now >= self.receipt.trusted_time_floor
            && now < self.receipt.execute_before
            && now < self.receipt.commercial_expires_at
    }

    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "qualified production continuity is capability-gated"
        )
    )]
    pub(super) fn binding(&self) -> ContinuityBinding {
        ContinuityBinding {
            installation_digest: self.receipt.installation_digest,
            account_digest: self.receipt.account_digest,
            workspace_digest: self.receipt.workspace_digest,
            device_digest: self.receipt.device_digest,
            minimum_account_security_epoch: self.receipt.account_security_epoch,
            minimum_lease_epoch: self.receipt.lease_epoch,
            minimum_entitlement_revision: self.receipt.entitlement_revision,
            database_lineage_digest: self.receipt.database_lineage_digest,
            database_publication_generation: self.receipt.database_publication_generation,
        }
    }
}

#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "qualified production continuity is capability-gated"
    )
)]
pub(super) struct StartupLoad {
    pub(super) decision: StartupContinuity,
    pub(super) continuation: Option<VerifiedLocalContinuation>,
}

#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "qualified production continuity is capability-gated"
    )
)]
pub(super) struct PendingReplacement {
    receipt: ContinuityReceiptV1,
    slot: u8,
    barrier_counter: u64,
}

impl fmt::Debug for PendingReplacement {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("PendingReplacement([REDACTED])")
    }
}

#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "qualified production continuity is capability-gated"
    )
)]
pub(super) struct ContinuityManager {
    key: Option<Zeroizing<[u8; KEY_BYTES]>>,
    anchors: Arc<dyn ContinuityAnchorStore>,
    receipts: Arc<dyn ContinuityReceiptStore>,
}

impl fmt::Debug for ContinuityManager {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("ContinuityManager([REDACTED])")
    }
}

impl ContinuityManager {
    #[expect(
        dead_code,
        reason = "production continuity composition remains unavailable pending anchor qualification"
    )]
    pub(super) fn production(receipts: Arc<dyn ContinuityReceiptStore>) -> Self {
        Self {
            key: None,
            anchors: Arc::new(ProductionContinuityAnchor),
            receipts,
        }
    }

    #[cfg(test)]
    pub(super) fn for_test(
        key: [u8; KEY_BYTES],
        anchors: Arc<dyn ContinuityAnchorStore>,
        receipts: Arc<dyn ContinuityReceiptStore>,
    ) -> Self {
        Self {
            key: Some(Zeroizing::new(key)),
            anchors,
            receipts,
        }
    }

    #[cfg(test)]
    pub(super) fn development_for_test() -> Self {
        Self::for_test(
            [7; KEY_BYTES],
            Arc::new(DevelopmentContinuityAnchor::default()),
            Arc::new(MemoryReceiptStore::default()),
        )
    }

    #[cfg(test)]
    pub(super) fn tamper_committed_receipt_for_test(&self) -> Result<(), ContinuityError> {
        let anchor = self
            .anchors
            .load()?
            .ok_or(ContinuityError::StorageRejected)?;
        let AnchorState::Committed { slot, .. } = anchor.state else {
            return Err(ContinuityError::StorageRejected);
        };
        let mut sealed = self
            .receipts
            .load(slot)?
            .ok_or(ContinuityError::StorageRejected)?;
        let last = sealed.last_mut().ok_or(ContinuityError::StorageRejected)?;
        *last ^= 1;
        self.receipts.store(slot, &sealed)
    }

    /// Startup follows the anchor-selected slot only.  It never scans or falls back to the other
    /// slot, and a valid continuation is intentionally not an Active/write authority.
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "qualified production continuity is capability-gated"
        )
    )]
    pub(super) fn load_startup(
        &self,
        binding: &ContinuityBinding,
        now: i64,
        database_exists: bool,
        key_preexisted: bool,
    ) -> Result<StartupLoad, ContinuityError> {
        let anchor = self.anchors.load()?;
        let Some(anchor) = anchor else {
            let clean = !database_exists && !key_preexisted && !self.receipts.any_receipt()?;
            return Ok(StartupLoad {
                decision: if clean {
                    StartupContinuity::ActivationRequired
                } else {
                    StartupContinuity::SecurityLocked
                },
                continuation: None,
            });
        };
        validate_anchor(&anchor)?;
        if anchor.installation_digest != binding.installation_digest
            || anchor.database_lineage_digest != binding.database_lineage_digest
            || anchor.database_publication_generation != binding.database_publication_generation
            || anchor.maximum_account_security_epoch < binding.minimum_account_security_epoch
            || anchor.maximum_lease_epoch < binding.minimum_lease_epoch
            || anchor.maximum_entitlement_revision < binding.minimum_entitlement_revision
        {
            return Ok(StartupLoad {
                decision: StartupContinuity::SecurityLocked,
                continuation: None,
            });
        }
        let AnchorState::Committed {
            slot,
            receipt_digest,
            ..
        } = anchor.state
        else {
            let decision = match anchor.state {
                AnchorState::Barrier {
                    reason: BarrierReason::Retryable,
                    ..
                } => StartupContinuity::RetryableLocked,
                AnchorState::Barrier {
                    reason: BarrierReason::ReplacementPending | BarrierReason::Security,
                    ..
                } => StartupContinuity::SecurityLocked,
                AnchorState::Committed { .. } => unreachable!(),
            };
            return Ok(StartupLoad {
                decision,
                continuation: None,
            });
        };
        let Some(sealed) = self.receipts.load(slot)? else {
            return Ok(StartupLoad {
                decision: StartupContinuity::SecurityLocked,
                continuation: None,
            });
        };
        if <[u8; DIGEST_BYTES]>::from(Sha256::digest(&sealed)) != receipt_digest {
            return Ok(StartupLoad {
                decision: StartupContinuity::SecurityLocked,
                continuation: None,
            });
        }
        let key = self.key.as_ref().ok_or(ContinuityError::Unavailable)?;
        let Ok(receipt) = open_receipt(key, slot, &sealed) else {
            return Ok(StartupLoad {
                decision: StartupContinuity::SecurityLocked,
                continuation: None,
            });
        };
        let decision = startup_decision(
            Some(&receipt),
            Some(&sealed),
            Some(slot),
            Some(&anchor),
            binding,
            now,
            database_exists,
        );
        let continuation = (decision == StartupContinuity::VerifiedLocalContinuation)
            .then_some(VerifiedLocalContinuation { receipt });
        Ok(StartupLoad {
            decision,
            continuation,
        })
    }

    /// Called only after signed-wire verification has completed.  The durable barrier is the
    /// point after which every failure must finalize the aggregate as `SecurityLocked`.
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "qualified production continuity is capability-gated"
        )
    )]
    pub(super) fn begin_verified_replacement(
        &self,
        receipt: ContinuityReceiptV1,
        binding: &ContinuityBinding,
        now: i64,
    ) -> Result<PendingReplacement, ContinuityError> {
        receipt_plaintext(&receipt)?;
        if receipt.sequence != receipt.authority_generation
            || receipt.installation_digest != binding.installation_digest
            || receipt.account_digest != binding.account_digest
            || receipt.workspace_digest != binding.workspace_digest
            || receipt.device_digest != binding.device_digest
            || receipt.database_lineage_digest != binding.database_lineage_digest
            || receipt.database_publication_generation != binding.database_publication_generation
            || receipt.account_security_epoch < binding.minimum_account_security_epoch
            || receipt.lease_epoch < binding.minimum_lease_epoch
            || receipt.entitlement_revision < binding.minimum_entitlement_revision
            || receipt.trusted_time_floor > now
            || now >= receipt.execute_before
            || now >= receipt.commercial_expires_at
        {
            return Err(ContinuityError::BindingRejected);
        }
        let old = self.anchors.load()?;
        if let Some(old) = old.as_ref() {
            validate_anchor(old)?;
            if receipt.account_security_epoch < old.maximum_account_security_epoch
                || receipt.lease_epoch < old.maximum_lease_epoch
                || receipt.entitlement_revision < old.maximum_entitlement_revision
                || receipt.trusted_time_floor < old.maximum_trusted_time_floor
                || receipt.authority_generation <= old.maximum_authority_generation
                || receipt.database_publication_generation < old.database_publication_generation
                || receipt.database_lineage_digest != old.database_lineage_digest
            {
                return Err(ContinuityError::RollbackRejected);
            }
        }
        let slot = match old.as_ref().map(|value| value.state) {
            Some(AnchorState::Committed { slot, .. }) => slot ^ 1,
            _ => 0,
        };
        let barrier_counter = begin_verified_replacement(
            old.as_ref(),
            &receipt,
            binding,
            now,
            self.anchors.as_ref(),
        )?;
        let exact = self
            .anchors
            .load()?
            .ok_or(ContinuityError::StorageRejected)?;
        if exact.monotonic_counter != barrier_counter
            || !matches!(exact.state, AnchorState::Barrier { reason: BarrierReason::ReplacementPending, sequence } if sequence == receipt.sequence)
        {
            return Err(ContinuityError::StorageRejected);
        }
        Ok(PendingReplacement {
            receipt,
            slot,
            barrier_counter,
        })
    }

    /// Writes and reads back the inactive receipt before advancing the monotonic anchor.  Once the
    /// anchor readback succeeds, the caller may atomically install the already-built runtime.
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "qualified production continuity is capability-gated"
        )
    )]
    pub(super) fn commit_receipt(
        &self,
        pending: PendingReplacement,
    ) -> Result<VerifiedLocalContinuation, ContinuityError> {
        let key = self.key.as_ref().ok_or(ContinuityError::Unavailable)?;
        let sealed = seal_receipt(key, pending.slot, &pending.receipt)?;
        self.receipts.store(pending.slot, &sealed)?;
        let readback = self
            .receipts
            .load(pending.slot)?
            .ok_or(ContinuityError::StorageRejected)?;
        if readback.as_slice() != sealed.as_slice()
            || open_receipt(key, pending.slot, &readback)? != pending.receipt
        {
            return Err(ContinuityError::StorageRejected);
        }
        commit_verified_replacement(
            pending.barrier_counter,
            pending.slot,
            &pending.receipt,
            &readback,
            self.anchors.as_ref(),
        )?;
        let committed = self
            .anchors
            .load()?
            .ok_or(ContinuityError::StorageRejected)?;
        verify_receipt(
            &pending.receipt,
            &readback,
            pending.slot,
            &committed,
            &ContinuityBinding {
                installation_digest: pending.receipt.installation_digest,
                account_digest: pending.receipt.account_digest,
                workspace_digest: pending.receipt.workspace_digest,
                device_digest: pending.receipt.device_digest,
                minimum_account_security_epoch: pending.receipt.account_security_epoch,
                minimum_lease_epoch: pending.receipt.lease_epoch,
                minimum_entitlement_revision: pending.receipt.entitlement_revision,
                database_lineage_digest: pending.receipt.database_lineage_digest,
                database_publication_generation: pending.receipt.database_publication_generation,
            },
            pending.receipt.trusted_time_floor,
        )?;
        Ok(VerifiedLocalContinuation {
            receipt: pending.receipt,
        })
    }

    pub(super) fn barrier_restriction(
        &self,
        basis: &ContinuityReceiptV1,
        reason: BarrierReason,
    ) -> Result<(), ContinuityError> {
        let old = self.anchors.load()?;
        let current = old.as_ref().map_or(0, |value| value.monotonic_counter);
        if old.as_ref().is_some_and(|value| {
            value.installation_digest != basis.installation_digest
                || value.maximum_account_security_epoch != basis.account_security_epoch
                || value.maximum_lease_epoch != basis.lease_epoch
                || value.maximum_entitlement_revision != basis.entitlement_revision
                || value.maximum_trusted_time_floor != basis.trusted_time_floor
                || value.maximum_authority_generation != basis.authority_generation
                || value.database_lineage_digest != basis.database_lineage_digest
                || value.database_publication_generation != basis.database_publication_generation
        }) {
            return Err(ContinuityError::RollbackRejected);
        }
        let next = current
            .checked_add(1)
            .filter(|value| *value <= MAX_SAFE_INTEGER)
            .ok_or(ContinuityError::RollbackRejected)?;
        let barrier = anchor_for_receipt(
            basis,
            next,
            AnchorState::Barrier {
                reason,
                sequence: basis.sequence,
            },
        );
        self.anchors.commit_barrier(current, &barrier)?;
        if self.anchors.load()?.as_ref() != Some(&barrier) {
            return Err(ContinuityError::StorageRejected);
        }
        Ok(())
    }

    pub(super) fn barrier_continuation(
        &self,
        continuation: &VerifiedLocalContinuation,
        reason: BarrierReason,
    ) -> Result<(), ContinuityError> {
        self.barrier_restriction(&continuation.receipt, reason)
    }
}

impl ContinuityReceiptStore for crate::desktop_custody::DesktopContinuityReceiptStore {
    fn load(&self, slot: u8) -> Result<Option<Zeroizing<Vec<u8>>>, ContinuityError> {
        crate::desktop_custody::DesktopContinuityReceiptStore::load(self, slot)
            .map_err(map_custody_error)
    }

    fn store(&self, slot: u8, sealed: &[u8]) -> Result<(), ContinuityError> {
        crate::desktop_custody::DesktopContinuityReceiptStore::store(self, slot, sealed)
            .map_err(map_custody_error)
    }

    fn any_receipt(&self) -> Result<bool, ContinuityError> {
        crate::desktop_custody::DesktopContinuityReceiptStore::any_receipt(self)
            .map_err(map_custody_error)
    }
}

#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "qualified production continuity is capability-gated"
    )
)]
fn map_custody_error(error: crate::desktop_custody::DesktopCustodyError) -> ContinuityError {
    match error {
        crate::desktop_custody::DesktopCustodyError::Unavailable
        | crate::desktop_custody::DesktopCustodyError::RandomUnavailable => {
            ContinuityError::Unavailable
        }
        crate::desktop_custody::DesktopCustodyError::Rejected
        | crate::desktop_custody::DesktopCustodyError::StorageRejected => {
            ContinuityError::StorageRejected
        }
    }
}

#[cfg(test)]
#[derive(Default)]
struct MemoryReceiptStore {
    slots: Mutex<[Option<Vec<u8>>; 2]>,
}

#[cfg(test)]
impl ContinuityReceiptStore for MemoryReceiptStore {
    fn load(&self, slot: u8) -> Result<Option<Zeroizing<Vec<u8>>>, ContinuityError> {
        let value = self
            .slots
            .lock()
            .expect("receipt mutex")
            .get(usize::from(slot))
            .ok_or(ContinuityError::Malformed)?
            .clone();
        Ok(value.map(Zeroizing::new))
    }
    fn store(&self, slot: u8, sealed: &[u8]) -> Result<(), ContinuityError> {
        if sealed.is_empty() || sealed.len() > MAX_RECEIPT_BYTES {
            return Err(ContinuityError::Malformed);
        }
        let mut slots = self.slots.lock().expect("receipt mutex");
        *slots
            .get_mut(usize::from(slot))
            .ok_or(ContinuityError::Malformed)? = Some(sealed.to_vec());
        Ok(())
    }
    fn any_receipt(&self) -> Result<bool, ContinuityError> {
        Ok(self
            .slots
            .lock()
            .expect("receipt mutex")
            .iter()
            .any(Option::is_some))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn digest(seed: u8) -> [u8; 32] {
        [seed; 32]
    }
    fn binding() -> ContinuityBinding {
        ContinuityBinding {
            installation_digest: digest(1),
            account_digest: digest(2),
            workspace_digest: digest(3),
            device_digest: digest(4),
            minimum_account_security_epoch: 1,
            minimum_lease_epoch: 1,
            minimum_entitlement_revision: 1,
            database_lineage_digest: digest(5),
            database_publication_generation: 1,
        }
    }
    fn receipt() -> ContinuityReceiptV1 {
        ContinuityReceiptV1 {
            sequence: 1,
            state: ReceiptState::Continuation,
            installation_digest: digest(1),
            account_digest: digest(2),
            workspace_digest: digest(3),
            device_digest: digest(4),
            account_security_epoch: 1,
            lease_epoch: 1,
            entitlement_revision: 1,
            entitlement_projection_digest: digest(6),
            commercial_expires_at: 2_000,
            trusted_time_floor: 1_000,
            execute_before: 1_900,
            authority_generation: 1,
            database_lineage_digest: digest(5),
            database_publication_generation: 1,
        }
    }

    #[test]
    fn receipt_round_trip_and_tamper_rejected() {
        let key = [7_u8; 32];
        let value = seal_receipt(&key, 0, &receipt()).unwrap();
        let opened = open_receipt(&key, 0, &value).unwrap();
        assert_eq!(opened, receipt());
        let mut tampered = value.to_vec();
        tampered[10] ^= 1;
        assert!(open_receipt(&key, 0, &tampered).is_err());
        assert!(format!("{opened:?}").contains("REDACTED"));
    }

    #[test]
    fn startup_requires_exact_pair_and_is_continuation_only() {
        let anchor_store = DevelopmentContinuityAnchor::default();
        let r = receipt();
        assert_eq!(
            startup_decision(None, None, None, None, &binding(), 1_100, false),
            StartupContinuity::ActivationRequired
        );
        assert_eq!(
            startup_decision(Some(&r), None, None, None, &binding(), 1_100, true),
            StartupContinuity::SecurityLocked
        );
        let a = anchor_for_receipt(
            &r,
            1,
            AnchorState::Committed {
                slot: 0,
                sequence: 1,
                receipt_digest: digest(8),
            },
        );
        let sealed = seal_receipt(&[7_u8; 32], 0, &r).unwrap();
        let mut a = a;
        a.state = AnchorState::Committed {
            slot: 0,
            sequence: 1,
            receipt_digest: Sha256::digest(&sealed).into(),
        };
        assert_eq!(
            startup_decision(
                Some(&r),
                Some(&sealed),
                Some(0),
                Some(&a),
                &binding(),
                1_100,
                true
            ),
            StartupContinuity::VerifiedLocalContinuation
        );
        let barrier = anchor_for_receipt(
            &r,
            1,
            AnchorState::Barrier {
                reason: BarrierReason::ReplacementPending,
                sequence: 1,
            },
        );
        assert_eq!(
            startup_decision(
                Some(&r),
                None,
                None,
                Some(&barrier),
                &binding(),
                1_100,
                true
            ),
            StartupContinuity::SecurityLocked
        );
        assert!(anchor_store.load().unwrap().is_none());
    }

    #[test]
    fn replacement_barrier_then_commit_is_monotonic_and_rollback_safe() {
        let store = DevelopmentContinuityAnchor::default();
        let r = receipt();
        let next = begin_verified_replacement(None, &r, &binding(), 1_100, &store).unwrap();
        assert_eq!(next, 1);
        let barrier = store.load().unwrap().unwrap();
        assert!(matches!(barrier.state, AnchorState::Barrier { .. }));
        let sealed = seal_receipt(&[7_u8; 32], 1, &r).unwrap();
        commit_verified_replacement(1, 1, &r, &sealed, &store).unwrap();
        let committed = store.load().unwrap().unwrap();
        assert!(matches!(committed.state, AnchorState::Committed { .. }));
        assert_eq!(committed.monotonic_counter, 2);
        assert!(commit_verified_replacement(1, 0, &r, &sealed, &store).is_err());
    }

    #[test]
    fn binding_and_time_floor_fail_closed() {
        let r = receipt();
        let sealed = seal_receipt(&[7_u8; 32], 0, &r).unwrap();
        let a = anchor_for_receipt(
            &r,
            1,
            AnchorState::Committed {
                slot: 0,
                sequence: 1,
                receipt_digest: Sha256::digest(&sealed).into(),
            },
        );
        assert!(verify_receipt(&r, &sealed, 0, &a, &binding(), 2_000).is_err());
        let mut wrong = binding();
        wrong.workspace_digest = digest(9);
        assert!(verify_receipt(&r, &sealed, 0, &a, &wrong, 1_100).is_err());
        let mut rollback = a.clone();
        rollback.maximum_lease_epoch = 2;
        assert!(matches!(
            verify_receipt(&r, &sealed, 0, &rollback, &binding(), 1_100),
            Err(ContinuityError::RollbackRejected)
        ));
        assert!(verify_receipt(&r, &sealed, 1, &a, &binding(), 1_100).is_err());
    }

    #[test]
    fn production_anchor_is_honestly_unavailable() {
        assert!(matches!(
            ProductionContinuityAnchor.load(),
            Err(ContinuityError::Unavailable)
        ));
    }

    #[test]
    fn failed_barrier_does_not_publish_state() {
        let store = DevelopmentContinuityAnchor::default();
        store.fail_next_commit();
        let r = receipt();
        assert!(begin_verified_replacement(None, &r, &binding(), 1_100, &store).is_err());
        assert!(store.load().unwrap().is_none());
    }

    #[test]
    fn manager_restart_loads_only_exact_anchor_selected_receipt() {
        let anchors = Arc::new(DevelopmentContinuityAnchor::default());
        let receipts = Arc::new(MemoryReceiptStore::default());
        let manager = ContinuityManager::for_test([7; 32], anchors.clone(), receipts.clone());
        let pending = manager
            .begin_verified_replacement(receipt(), &binding(), 1_100)
            .unwrap();
        let continuation = manager.commit_receipt(pending).unwrap();
        assert_eq!(continuation.receipt.sequence, 1);
        let restarted = ContinuityManager::for_test([7; 32], anchors, receipts.clone());
        let loaded = restarted
            .load_startup(&binding(), 1_100, true, true)
            .unwrap();
        assert_eq!(
            loaded.decision,
            StartupContinuity::VerifiedLocalContinuation
        );
        assert!(loaded.continuation.is_some());

        receipts.slots.lock().unwrap()[0].as_mut().unwrap()[20] ^= 1;
        let loaded = restarted
            .load_startup(&binding(), 1_100, true, true)
            .unwrap();
        assert_eq!(loaded.decision, StartupContinuity::SecurityLocked);
        assert!(loaded.continuation.is_none());
    }

    #[test]
    fn crash_after_barrier_or_receipt_write_never_revives_old_continuation() {
        let anchors = Arc::new(DevelopmentContinuityAnchor::default());
        let receipts = Arc::new(MemoryReceiptStore::default());
        let manager = ContinuityManager::for_test([7; 32], anchors.clone(), receipts.clone());
        let pending = manager
            .begin_verified_replacement(receipt(), &binding(), 1_100)
            .unwrap();

        let restarted = ContinuityManager::for_test([7; 32], anchors.clone(), receipts.clone());
        assert_eq!(
            restarted
                .load_startup(&binding(), 1_100, true, true)
                .unwrap()
                .decision,
            StartupContinuity::SecurityLocked
        );

        let sealed = seal_receipt(&[7; 32], pending.slot, &pending.receipt).unwrap();
        receipts.store(pending.slot, &sealed).unwrap();
        assert_eq!(
            restarted
                .load_startup(&binding(), 1_100, true, true)
                .unwrap()
                .decision,
            StartupContinuity::SecurityLocked
        );
    }

    #[test]
    fn malformed_replacement_never_writes_a_barrier() {
        let anchors = Arc::new(DevelopmentContinuityAnchor::default());
        let manager = ContinuityManager::for_test(
            [7; 32],
            anchors.clone(),
            Arc::new(MemoryReceiptStore::default()),
        );
        let mut malformed = receipt();
        malformed.sequence = 0;
        assert!(
            manager
                .begin_verified_replacement(malformed, &binding(), 1_100)
                .is_err()
        );
        assert!(anchors.load().unwrap().is_none());

        let mut wrong_binding = receipt();
        wrong_binding.account_digest = digest(99);
        assert!(
            manager
                .begin_verified_replacement(wrong_binding, &binding(), 1_100)
                .is_err()
        );
        assert!(anchors.load().unwrap().is_none());
    }

    #[test]
    fn parser_is_strict_bounded_and_wrong_key_is_rejected() {
        let sealed = seal_receipt(&[7; 32], 0, &receipt()).unwrap();
        assert!(open_receipt(&[8; 32], 0, &sealed).is_err());
        assert!(open_receipt(&[7; 32], 1, &sealed).is_err());
        assert!(open_receipt(&[7; 32], 0, &vec![0; MAX_RECEIPT_BYTES + 1]).is_err());

        let mut plaintext = receipt_plaintext(&receipt()).unwrap();
        plaintext.push(0);
        assert!(parse_receipt_plaintext(&plaintext).is_err());
    }

    #[test]
    fn explicit_retryable_and_security_barriers_survive_restart() {
        for (reason, expected) in [
            (BarrierReason::Retryable, StartupContinuity::RetryableLocked),
            (BarrierReason::Security, StartupContinuity::SecurityLocked),
        ] {
            let anchors = Arc::new(DevelopmentContinuityAnchor::default());
            let receipts = Arc::new(MemoryReceiptStore::default());
            let manager = ContinuityManager::for_test([7; 32], anchors.clone(), receipts);
            manager.barrier_restriction(&receipt(), reason).unwrap();
            let restarted = ContinuityManager::for_test(
                [7; 32],
                anchors,
                Arc::new(MemoryReceiptStore::default()),
            );
            assert_eq!(
                restarted
                    .load_startup(&binding(), 1_100, true, true)
                    .unwrap()
                    .decision,
                expected
            );
        }
    }
}
