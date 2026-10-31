//! Private production custody needed by the Desktop local-host aggregate.

use std::fmt;
use std::fs::File;
#[cfg(test)]
use std::io::Seek;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
#[cfg(test)]
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use serde::Deserialize;
#[cfg(test)]
use sha2::{Digest as _, Sha256};
use zeroize::{Zeroize as _, Zeroizing};

#[cfg(test)]
use crate::rebootstrap_runtime::{
    CandidateReservedRebootstrap, DiscardPhase, DiscardRebootstrap, PreparedRebootstrap,
    PublishRebootstrap, RebootstrapReservation, RebootstrapSlot, RecoveryDisposition,
    RecoveryPhase, RecoveryRebootstrap, TerminalPhase, TerminalRebootstrap,
};
use crate::{DesktopApplicationRoot, LocalDatabaseKey};

const DATABASE_KEY_BYTES: usize = 32;
#[cfg_attr(
    test,
    expect(dead_code, reason = "native production Keychain identifier")
)]
const DATABASE_KEY_SERVICE: &str = "com.gooddealer.desktop.local-database";
#[cfg_attr(
    test,
    expect(dead_code, reason = "native production Keychain identifier")
)]
const DATABASE_KEY_ACCOUNT: &str = "active-workspace-sqlcipher-v1";
#[cfg_attr(
    test,
    expect(dead_code, reason = "native production residue account service")
)]
const REBOOTSTRAP_KEY_SERVICE: &str = "com.gooddealer.desktop.rebootstrap";
#[allow(dead_code, reason = "native production Keychain identifier")]
const DEVICE_IDENTITY_SERVICE: &str = "com.gooddealer.desktop.local-host-binding";
#[allow(dead_code, reason = "native production Keychain identifier")]
const DEVICE_IDENTITY_ACCOUNT: &str = "local-host-binding-v1";
const MAX_DEVICE_IDENTITY_BYTES: usize = 512;
#[cfg(test)]
const MAX_REBOOTSTRAP_JOURNAL_BYTES: usize = 1_048_576;
#[cfg(test)]
const MAX_REBOOTSTRAP_RECORD_BYTES: usize = 16_384;
#[cfg(test)]
const MAX_REBOOTSTRAP_JOURNAL_RECORDS: usize = 4_096;
const MAX_CONTINUITY_RECEIPT_BYTES: usize = 4_096;
#[cfg(test)]
const REBOOTSTRAP_SLOT_RECORD_PREFIX: &[u8] = b"GOODDEALER/REBOOTSTRAP-SLOT-KEY\0";
#[cfg(test)]
const REBOOTSTRAP_SLOT_RECORD_VERSION: u8 = 1;
const REBOOTSTRAP_DATABASE_NAMES: [&str; 2] = ["rebootstrap-a.db", "rebootstrap-b.db"];
#[cfg_attr(
    test,
    expect(dead_code, reason = "native production residue account names")
)]
const REBOOTSTRAP_SLOT_ACCOUNTS: [&str; 2] = ["slot-a-sqlcipher-v1", "slot-b-sqlcipher-v1"];

#[cfg(test)]
static TEST_LOCK_INSPECTION_ATTEMPTS: AtomicU64 = AtomicU64::new(0);
#[cfg(test)]
static TEST_LOCK_INSPECTION_ACQUIRED: AtomicU64 = AtomicU64::new(0);
#[cfg(test)]
static TEST_JOURNAL_INSPECTIONS: AtomicU64 = AtomicU64::new(0);
#[cfg(test)]
static TEST_SLOT_INSPECTIONS: AtomicU64 = AtomicU64::new(0);
#[cfg(test)]
static TEST_ALIAS_INSPECTIONS: AtomicU64 = AtomicU64::new(0);
#[cfg(test)]
static TEST_DATABASE_INSPECTIONS: AtomicU64 = AtomicU64::new(0);

#[cfg(test)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct TestRebootstrapInspectionSnapshot {
    lock_attempts: u64,
    lock_acquired: u64,
    journal_inspections: u64,
    slot_inspections: u64,
    alias_inspections: u64,
    database_inspections: u64,
}

#[cfg(test)]
impl TestRebootstrapInspectionSnapshot {
    pub(crate) const fn lock_attempts(self) -> u64 {
        self.lock_attempts
    }

    pub(crate) const fn lock_acquired(self) -> u64 {
        self.lock_acquired
    }

    pub(crate) const fn journal_inspections(self) -> u64 {
        self.journal_inspections
    }

    pub(crate) const fn slot_inspections(self) -> u64 {
        self.slot_inspections
    }

    pub(crate) const fn alias_inspections(self) -> u64 {
        self.alias_inspections
    }

    pub(crate) const fn database_inspections(self) -> u64 {
        self.database_inspections
    }
}

#[cfg(test)]
pub(crate) fn reset_rebootstrap_inspection_for_test() {
    for counter in [
        &TEST_LOCK_INSPECTION_ATTEMPTS,
        &TEST_LOCK_INSPECTION_ACQUIRED,
        &TEST_JOURNAL_INSPECTIONS,
        &TEST_SLOT_INSPECTIONS,
        &TEST_ALIAS_INSPECTIONS,
        &TEST_DATABASE_INSPECTIONS,
    ] {
        counter.store(0, Ordering::SeqCst);
    }
}

#[cfg(test)]
pub(crate) fn rebootstrap_inspection_snapshot_for_test() -> TestRebootstrapInspectionSnapshot {
    TestRebootstrapInspectionSnapshot {
        lock_attempts: TEST_LOCK_INSPECTION_ATTEMPTS.load(Ordering::SeqCst),
        lock_acquired: TEST_LOCK_INSPECTION_ACQUIRED.load(Ordering::SeqCst),
        journal_inspections: TEST_JOURNAL_INSPECTIONS.load(Ordering::SeqCst),
        slot_inspections: TEST_SLOT_INSPECTIONS.load(Ordering::SeqCst),
        alias_inspections: TEST_ALIAS_INSPECTIONS.load(Ordering::SeqCst),
        database_inspections: TEST_DATABASE_INSPECTIONS.load(Ordering::SeqCst),
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum DesktopCustodyError {
    Unavailable,
    Rejected,
    RandomUnavailable,
    StorageRejected,
}

impl fmt::Display for DesktopCustodyError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Unavailable => "DESKTOP_CUSTODY_UNAVAILABLE",
            Self::Rejected => "DESKTOP_CUSTODY_REJECTED",
            Self::RandomUnavailable => "DESKTOP_CUSTODY_RANDOM_UNAVAILABLE",
            Self::StorageRejected => "DESKTOP_CUSTODY_STORAGE_REJECTED",
        })
    }
}

pub(crate) struct DesktopProductionCustody {
    _process_lock: File,
    _active_workspace: File,
    active_workspace_identity: FileIdentity,
    active_database: Mutex<ActiveDatabaseCustody>,
    database_path: PathBuf,
    #[cfg(test)]
    rebootstrap_capability: RebootstrapCapability,
    #[cfg(test)]
    rebootstrap_test_store: TestRebootstrapKeyStore,
}

#[cfg(test)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum RebootstrapCapability {
    Unavailable,
    #[cfg(test)]
    TestCreateOnly,
}

#[cfg(test)]
#[derive(Clone)]
pub(crate) struct TestRebootstrapKeyStore {
    records: Arc<Mutex<std::collections::BTreeMap<u8, Vec<u8>>>>,
    active_alias: Arc<Mutex<Option<Vec<u8>>>>,
    device_identity: Arc<Mutex<LoadedDeviceIdentity>>,
}

#[cfg(test)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum TestRebootstrapStoreHostileCase {
    RemoveSlot(RebootstrapSlot),
    MalformSlot(RebootstrapSlot),
    ReplaceSlotKey(RebootstrapSlot),
    ReplaceSlotOrigin(RebootstrapSlot),
    SwapSlots,
    RemoveActiveAlias,
    ReplaceActiveAliasKey,
    MalformActiveAliasShort,
    MalformActiveAliasLong,
    RandomActiveAlias,
}

#[cfg(test)]
impl Default for TestRebootstrapKeyStore {
    fn default() -> Self {
        Self {
            records: Arc::default(),
            active_alias: Arc::default(),
            device_identity: Arc::new(Mutex::new(LoadedDeviceIdentity {
                device_id: "device-local".to_owned(),
                installation_binding_digest: [0x6d; 32],
            })),
        }
    }
}

#[cfg(test)]
impl fmt::Debug for TestRebootstrapKeyStore {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("TestRebootstrapKeyStore([REDACTED])")
    }
}

#[cfg(test)]
impl TestRebootstrapKeyStore {
    #[expect(
        clippy::too_many_lines,
        reason = "the private hostile-store matrix keeps every supported corruption case explicit"
    )]
    pub(crate) fn apply_hostile_case_for_test(
        &self,
        hostile: TestRebootstrapStoreHostileCase,
    ) -> Result<(), DesktopCustodyError> {
        match hostile {
            TestRebootstrapStoreHostileCase::RemoveSlot(slot) => {
                self.records
                    .lock()
                    .map_err(|_| DesktopCustodyError::StorageRejected)?
                    .remove(&slot_byte(slot));
            }
            TestRebootstrapStoreHostileCase::MalformSlot(slot) => {
                let mut records = self
                    .records
                    .lock()
                    .map_err(|_| DesktopCustodyError::StorageRejected)?;
                if !records.contains_key(&slot_byte(slot)) {
                    return Err(DesktopCustodyError::Rejected);
                }
                records.insert(slot_byte(slot), b"malformed-slot-envelope".to_vec());
            }
            TestRebootstrapStoreHostileCase::ReplaceSlotKey(slot) => {
                let mut records = self
                    .records
                    .lock()
                    .map_err(|_| DesktopCustodyError::StorageRejected)?;
                let current = records
                    .get(&slot_byte(slot))
                    .ok_or(DesktopCustodyError::Rejected)?;
                let decoded = decode_rebootstrap_slot_record(current, slot)?;
                let mut replacement = *decoded.key.custody_bytes();
                replacement[0] ^= 0xff;
                records.insert(
                    slot_byte(slot),
                    rebootstrap_slot_record(
                        slot,
                        decoded.operation_id,
                        decoded.sequence,
                        &LocalDatabaseKey::from_bytes(replacement),
                    )
                    .to_vec(),
                );
            }
            TestRebootstrapStoreHostileCase::ReplaceSlotOrigin(slot) => {
                let mut records = self
                    .records
                    .lock()
                    .map_err(|_| DesktopCustodyError::StorageRejected)?;
                let current = records
                    .get(&slot_byte(slot))
                    .ok_or(DesktopCustodyError::Rejected)?;
                let decoded = decode_rebootstrap_slot_record(current, slot)?;
                let operation_id = decoded
                    .operation_id
                    .checked_add(1)
                    .ok_or(DesktopCustodyError::Rejected)?;
                records.insert(
                    slot_byte(slot),
                    rebootstrap_slot_record(slot, operation_id, decoded.sequence, &decoded.key)
                        .to_vec(),
                );
            }
            TestRebootstrapStoreHostileCase::SwapSlots => {
                let mut records = self
                    .records
                    .lock()
                    .map_err(|_| DesktopCustodyError::StorageRejected)?;
                let a = records
                    .remove(&slot_byte(RebootstrapSlot::A))
                    .ok_or(DesktopCustodyError::Rejected)?;
                let b = records
                    .remove(&slot_byte(RebootstrapSlot::B))
                    .ok_or(DesktopCustodyError::Rejected)?;
                records.insert(slot_byte(RebootstrapSlot::A), b);
                records.insert(slot_byte(RebootstrapSlot::B), a);
            }
            TestRebootstrapStoreHostileCase::RemoveActiveAlias => {
                *self
                    .active_alias
                    .lock()
                    .map_err(|_| DesktopCustodyError::StorageRejected)? = None;
            }
            TestRebootstrapStoreHostileCase::ReplaceActiveAliasKey => {
                let mut alias = self
                    .active_alias
                    .lock()
                    .map_err(|_| DesktopCustodyError::StorageRejected)?;
                let value = alias.as_mut().ok_or(DesktopCustodyError::Rejected)?;
                let first = value.first_mut().ok_or(DesktopCustodyError::Rejected)?;
                *first ^= 0xff;
            }
            TestRebootstrapStoreHostileCase::MalformActiveAliasShort => {
                *self
                    .active_alias
                    .lock()
                    .map_err(|_| DesktopCustodyError::StorageRejected)? =
                    Some(vec![0x31; DATABASE_KEY_BYTES - 1]);
            }
            TestRebootstrapStoreHostileCase::MalformActiveAliasLong => {
                *self
                    .active_alias
                    .lock()
                    .map_err(|_| DesktopCustodyError::StorageRejected)? =
                    Some(vec![0x33; DATABASE_KEY_BYTES + 1]);
            }
            TestRebootstrapStoreHostileCase::RandomActiveAlias => {
                *self
                    .active_alias
                    .lock()
                    .map_err(|_| DesktopCustodyError::StorageRejected)? =
                    Some(vec![0xa7; DATABASE_KEY_BYTES]);
            }
        }
        Ok(())
    }
}

struct ActiveDatabaseCustody {
    file: File,
    identity: FileIdentity,
    key: LocalDatabaseKey,
}

/// Opaque, custody-owned append-only journal primitive. Callers receive bytes only; the
/// directory descriptor, fixed filename, admission and recovery limits remain private here.
#[cfg(test)]
pub(crate) struct DesktopJournalStore {
    directory: Arc<File>,
    directory_identity: FileIdentity,
    journal_name: String,
    journal: Mutex<Option<File>>,
}

pub(crate) struct DesktopContinuityReceiptStore {
    directory: Arc<File>,
    directory_identity: FileIdentity,
}

/// Opaque candidate database held only for the duration of a rebootstrap operation.
/// The path and encryption key never cross the custody boundary.
#[cfg(test)]
pub(crate) struct RebootstrapCandidate {
    operation_id: u64,
    sequence: u64,
    old_slot: RebootstrapSlot,
    slot: RebootstrapSlot,
    path: PathBuf,
    file: File,
    identity: FileIdentity,
    key: LocalDatabaseKey,
    old_slot_record: Zeroizing<Vec<u8>>,
    candidate_slot_record: Zeroizing<Vec<u8>>,
    old_slot_created: bool,
    prepared_digest: String,
    candidate_reserved_digest: String,
}

/// One-shot key reservation established before the runtime persists `Prepared`. Both slot keys
/// are read back from protected native storage; only their domain-separated digests escape.
#[cfg(test)]
pub(crate) struct CandidateReservation {
    operation_id: u64,
    sequence: u64,
    old_slot: RebootstrapSlot,
    candidate_slot: RebootstrapSlot,
    candidate_key: LocalDatabaseKey,
    old_slot_record: Zeroizing<Vec<u8>>,
    candidate_slot_record: Zeroizing<Vec<u8>>,
    old_slot_created: bool,
    prepared_digest: String,
}

#[cfg(test)]
impl fmt::Debug for CandidateReservation {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("CandidateReservation([REDACTED])")
    }
}

#[cfg(test)]
pub(crate) struct PreparedEvidence {
    operation_id: u64,
    sequence: u64,
    old_slot: RebootstrapSlot,
    candidate_slot: RebootstrapSlot,
    directory_identity: FileIdentity,
    old: FileCustodyEvidence,
    workspace_id_digest: String,
    old_slot_record_digest: String,
    candidate_slot_record_digest: String,
    digest: String,
    candidate_key_digest: String,
    old_slot_origin_operation_id: u64,
    old_slot_origin_publication_sequence: u64,
    candidate_slot_origin_operation_id: u64,
    candidate_slot_origin_publication_sequence: u64,
    old_slot_created_by_operation: bool,
}

#[cfg(test)]
impl PreparedEvidence {
    pub(crate) fn digest(&self) -> &str {
        &self.digest
    }

    pub(crate) fn candidate_key_digest(&self) -> &str {
        &self.candidate_key_digest
    }

    pub(crate) fn workspace_id_digest(&self) -> &str {
        &self.workspace_id_digest
    }

    pub(crate) const fn directory_dev(&self) -> u64 {
        self.directory_identity.dev
    }

    pub(crate) const fn directory_ino(&self) -> u64 {
        self.directory_identity.ino
    }

    pub(crate) const fn old_file_dev(&self) -> u64 {
        self.old.identity.dev
    }

    pub(crate) const fn old_file_ino(&self) -> u64 {
        self.old.identity.ino
    }

    pub(crate) const fn old_file_size(&self) -> u64 {
        self.old.size
    }

    pub(crate) fn old_file_ciphertext_digest(&self) -> &str {
        &self.old.ciphertext_digest
    }

    pub(crate) fn old_key_digest(&self) -> &str {
        &self.old.key_digest
    }

    pub(crate) fn old_slot_record_digest(&self) -> &str {
        &self.old_slot_record_digest
    }

    pub(crate) fn candidate_slot_record_digest(&self) -> &str {
        &self.candidate_slot_record_digest
    }

    pub(crate) const fn old_slot_created_by_operation(&self) -> bool {
        self.old_slot_created_by_operation
    }

    pub(crate) const fn old_slot_origin_operation_id(&self) -> u64 {
        self.old_slot_origin_operation_id
    }

    pub(crate) const fn old_slot_origin_publication_sequence(&self) -> u64 {
        self.old_slot_origin_publication_sequence
    }

    pub(crate) const fn candidate_slot_origin_operation_id(&self) -> u64 {
        self.candidate_slot_origin_operation_id
    }

    pub(crate) const fn candidate_slot_origin_publication_sequence(&self) -> u64 {
        self.candidate_slot_origin_publication_sequence
    }

    pub(crate) fn matches(&self, reservation: &RebootstrapReservation) -> bool {
        self.operation_id == reservation.operation_id()
            && self.sequence == reservation.publication_sequence()
            && self.old_slot == reservation.old_slot()
            && self.candidate_slot == reservation.candidate_slot()
    }

    #[cfg(test)]
    #[expect(
        clippy::needless_pass_by_value,
        reason = "the fixture constructor preserves the opaque evidence API's owned digest contract"
    )]
    pub(crate) fn for_test_for(
        reservation: &RebootstrapReservation,
        digest: String,
        candidate_key_digest: String,
    ) -> Self {
        let slot_digest = |slot| match slot {
            RebootstrapSlot::A => "f".repeat(64),
            RebootstrapSlot::B => "0".repeat(64),
        };
        let (old_origin_operation_id, old_origin_sequence, old_slot_created_by_operation) =
            if reservation.old_slot() == RebootstrapSlot::B
                && reservation.publication_sequence() > 1
            {
                (
                    reservation.operation_id() - 1,
                    reservation.publication_sequence() - 1,
                    false,
                )
            } else {
                (
                    reservation.operation_id(),
                    reservation.publication_sequence(),
                    true,
                )
            };
        Self {
            operation_id: reservation.operation_id(),
            sequence: reservation.publication_sequence(),
            old_slot: reservation.old_slot(),
            candidate_slot: reservation.candidate_slot(),
            directory_identity: FileIdentity { dev: 1, ino: 1 },
            old: FileCustodyEvidence::for_test(),
            workspace_id_digest: "e".repeat(64),
            old_slot_record_digest: slot_digest(reservation.old_slot()),
            candidate_slot_record_digest: slot_digest(reservation.candidate_slot()),
            digest: digest.clone(),
            candidate_key_digest,
            old_slot_origin_operation_id: old_origin_operation_id,
            old_slot_origin_publication_sequence: old_origin_sequence,
            candidate_slot_origin_operation_id: reservation.operation_id(),
            candidate_slot_origin_publication_sequence: reservation.publication_sequence(),
            old_slot_created_by_operation,
        }
    }
}

#[cfg(test)]
impl fmt::Debug for PreparedEvidence {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("PreparedEvidence([REDACTED])")
    }
}

#[cfg(test)]
pub(crate) struct CandidateReservedEvidence {
    operation_id: u64,
    sequence: u64,
    old_slot: RebootstrapSlot,
    candidate_slot: RebootstrapSlot,
    digest: String,
}

#[cfg(test)]
impl CandidateReservedEvidence {
    pub(crate) fn digest(&self) -> &str {
        &self.digest
    }

    pub(crate) fn matches(&self, prepared: &PreparedRebootstrap) -> bool {
        self.operation_id == prepared.operation_id()
            && self.sequence == prepared.publication_sequence()
            && self.old_slot == prepared.old_slot()
            && self.candidate_slot == prepared.candidate_slot()
    }

    #[cfg(test)]
    #[expect(
        clippy::needless_pass_by_value,
        reason = "the fixture constructor preserves the opaque evidence API's owned digest contract"
    )]
    pub(crate) fn for_test_for(prepared: &PreparedRebootstrap, digest: String) -> Self {
        Self {
            operation_id: prepared.operation_id(),
            sequence: prepared.publication_sequence(),
            old_slot: prepared.old_slot(),
            candidate_slot: prepared.candidate_slot(),
            digest: digest.clone(),
        }
    }
}

#[cfg(test)]
impl fmt::Debug for CandidateReservedEvidence {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("CandidateReservedEvidence([REDACTED])")
    }
}

/// File-and-key evidence produced only after the candidate has left WAL mode, closed its `SQLite`
/// connection, synced its admitted descriptor and parent directory, and passed identity checks.
/// The aggregate may persist the digest but cannot inspect or manufacture the underlying facts.
#[cfg(test)]
pub(crate) struct VerifiedCustodyEvidence {
    operation_id: u64,
    sequence: u64,
    old_slot: RebootstrapSlot,
    candidate_slot: RebootstrapSlot,
    proof_digest: [u8; 32],
    journal_link_digest: [u8; 32],
    directory_identity: FileIdentity,
    old: FileCustodyEvidence,
    candidate: FileCustodyEvidence,
    digest: String,
}

#[cfg(test)]
impl VerifiedCustodyEvidence {
    pub(crate) fn digest(&self) -> &str {
        &self.digest
    }

    pub(crate) fn matches(
        &self,
        reserved: &CandidateReservedRebootstrap,
        proof: &crate::DatabaseRecoveryProof,
        journal_link: &crate::RebootstrapJournalLink,
    ) -> bool {
        self.operation_id == reserved.operation_id()
            && self.sequence == reserved.publication_sequence()
            && self.old_slot == reserved.old_slot()
            && self.candidate_slot == reserved.candidate_slot()
            && recovery_proof_digest(proof).is_ok_and(|digest| digest == self.proof_digest)
            && journal_link_digest(journal_link)
                .is_ok_and(|digest| digest == self.journal_link_digest)
    }

    #[cfg(test)]
    pub(crate) fn for_test_for(
        reserved: &CandidateReservedRebootstrap,
        proof: &crate::DatabaseRecoveryProof,
        journal_link: &crate::RebootstrapJournalLink,
        digest: String,
    ) -> Self {
        Self {
            operation_id: reserved.operation_id(),
            sequence: reserved.publication_sequence(),
            old_slot: reserved.old_slot(),
            candidate_slot: reserved.candidate_slot(),
            proof_digest: recovery_proof_digest(proof).expect("test proof is serializable"),
            journal_link_digest: journal_link_digest(journal_link)
                .expect("test journal link is canonical"),
            directory_identity: FileIdentity { dev: 1, ino: 1 },
            old: FileCustodyEvidence::for_test(),
            candidate: FileCustodyEvidence::for_test(),
            digest,
        }
    }
}

#[cfg(test)]
impl fmt::Debug for VerifiedCustodyEvidence {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("VerifiedCustodyEvidence([REDACTED])")
    }
}

#[cfg(test)]
pub(crate) struct CandidateFinalEvidence {
    candidate: FileCustodyEvidence,
}

#[cfg(test)]
impl fmt::Debug for CandidateFinalEvidence {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("CandidateFinalEvidence([REDACTED])")
    }
}

#[cfg(test)]
pub(crate) struct VerifiedCandidate {
    candidate: RebootstrapCandidate,
    evidence: VerifiedCustodyEvidence,
}

#[cfg(test)]
impl VerifiedCandidate {
    pub(crate) fn evidence(&self) -> &VerifiedCustodyEvidence {
        &self.evidence
    }
}

#[cfg(test)]
impl fmt::Debug for VerifiedCandidate {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("VerifiedCandidate([REDACTED])")
    }
}

#[cfg(test)]
pub(crate) struct PublishedRebootstrap {
    operation_id: u64,
    sequence: u64,
    old_slot: RebootstrapSlot,
    candidate_slot: RebootstrapSlot,
    new_file: File,
    new_identity: FileIdentity,
    old_file: File,
    old_identity: FileIdentity,
    old_key: LocalDatabaseKey,
    old_slot_record: Zeroizing<Vec<u8>>,
    candidate_slot_record: Zeroizing<Vec<u8>>,
    evidence: VerifiedCustodyEvidence,
}

#[cfg(test)]
struct ValidatedRetirement(PublishedRebootstrap);
#[cfg(test)]
struct UnlinkedRetirement(PublishedRebootstrap);
#[cfg(test)]
struct DeletedRetirement;

#[cfg(test)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum TestRebootstrapCrashBoundary {
    AfterExchangeBeforeDirectoryFsync,
    AfterAliasRepairBeforePublished,
    ReopenProofFailure,
    AfterOldFileUnlinkAndDirectoryFsync,
    AfterOldSlotDeleteAndAbsentReadback,
    AfterCancelCandidateFileUnlinkAndDirectoryFsync,
    AfterCancelCandidateSlotDeleteAndAbsentReadback,
    AfterCancelAliasRepairAndReadback,
    AfterCancelOldSlotDeleteAndAbsentReadback,
}

#[cfg(test)]
pub(crate) struct TestRebootstrapRecoveryCustody {
    process_lock: File,
    active_workspace: File,
    active_workspace_identity: FileIdentity,
    database_path: PathBuf,
    store: TestRebootstrapKeyStore,
}

/// Retains only the process/directory custody needed to keep a quarantined workspace exclusive.
/// It intentionally carries no database descriptor, key, or business authority.
#[cfg(test)]
pub(crate) struct TestRebootstrapQuarantineCustody {
    _process_lock: File,
    active_workspace: File,
    active_workspace_identity: FileIdentity,
}

#[cfg(test)]
#[derive(PartialEq, Eq)]
pub(crate) struct TestRebootstrapStateDigest([u8; 32]);

#[cfg(test)]
impl fmt::Debug for TestRebootstrapStateDigest {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("TestRebootstrapStateDigest([REDACTED])")
    }
}

#[cfg(test)]
struct TestRecoveryFiles {
    operation_id: u64,
    sequence: u64,
    old_slot: RebootstrapSlot,
    candidate_slot: RebootstrapSlot,
    old_file: File,
    old_identity: FileIdentity,
    old_key: LocalDatabaseKey,
    old_slot_record: Zeroizing<Vec<u8>>,
    candidate_file: Option<File>,
    candidate_identity: Option<FileIdentity>,
    candidate_key: LocalDatabaseKey,
    candidate_slot_record: Zeroizing<Vec<u8>>,
    old_slot_origin_operation_id: u64,
    old_slot_origin_publication_sequence: u64,
    old_slot_created_by_operation: bool,
}

#[cfg(test)]
pub(crate) struct TestDiscardRecovery {
    bootstrap: TestRebootstrapRecoveryCustody,
    files: TestDiscardFiles,
}

#[cfg(test)]
struct TestDiscardFiles {
    operation_id: u64,
    sequence: u64,
    old_slot: RebootstrapSlot,
    candidate_slot: RebootstrapSlot,
    old_file: File,
    old_identity: FileIdentity,
    old_key: LocalDatabaseKey,
    old_slot_record: Option<Zeroizing<Vec<u8>>>,
    candidate_file: Option<File>,
    candidate_identity: Option<FileIdentity>,
    candidate_key: Option<LocalDatabaseKey>,
    candidate_slot_record: Option<Zeroizing<Vec<u8>>>,
    old_slot_created_by_operation: bool,
}

#[cfg(test)]
impl From<TestRecoveryFiles> for TestDiscardFiles {
    fn from(files: TestRecoveryFiles) -> Self {
        Self {
            operation_id: files.operation_id,
            sequence: files.sequence,
            old_slot: files.old_slot,
            candidate_slot: files.candidate_slot,
            old_file: files.old_file,
            old_identity: files.old_identity,
            old_key: files.old_key,
            old_slot_record: Some(files.old_slot_record),
            candidate_file: files.candidate_file,
            candidate_identity: files.candidate_identity,
            candidate_key: Some(files.candidate_key),
            candidate_slot_record: Some(files.candidate_slot_record),
            old_slot_created_by_operation: files.old_slot_created_by_operation,
        }
    }
}

#[cfg(test)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum TestPublicationTopology {
    PreExchange,
    PostExchange,
    RetirementFileUnlinked,
    RetirementSlotDeleted,
}

#[cfg(test)]
pub(crate) struct TestPublicationRecovery {
    bootstrap: TestRebootstrapRecoveryCustody,
    files: Option<TestRecoveryFiles>,
    discard: Option<TestDiscardFiles>,
    retirement: Option<TestRetirementRecoveryFiles>,
    topology: TestPublicationTopology,
    evidence: Option<VerifiedCustodyEvidence>,
    logical: Option<TestRecoveryLogicalEvidence>,
}

#[cfg(test)]
pub(crate) struct TestVerifiedPublicationRecovery(TestPublicationRecovery);

#[cfg(test)]
struct TestRetirementRecoveryFiles {
    active_file: File,
    active_identity: FileIdentity,
    active_key: LocalDatabaseKey,
    old_slot: RebootstrapSlot,
    old_slot_record: Option<Zeroizing<Vec<u8>>>,
}

#[cfg(test)]
pub(crate) struct TestTerminalRecovery {
    bootstrap: TestRebootstrapRecoveryCustody,
    active_file: File,
    active_identity: FileIdentity,
    active_key: LocalDatabaseKey,
    repair_alias: bool,
}

#[cfg(test)]
pub(crate) struct TestCleanRecovery {
    bootstrap: TestRebootstrapRecoveryCustody,
    active_file: File,
    active_identity: FileIdentity,
    active_key: LocalDatabaseKey,
}

#[cfg(test)]
struct TestRecoveryLogicalEvidence {
    expected_workspace_id: String,
    expected_proof_digest: String,
    expected_logical_digest: String,
    journal_link: crate::RebootstrapJournalLink,
}

#[cfg(test)]
#[derive(Clone, Copy)]
struct TestRecordedPreparedComponents<'a> {
    workspace_id_digest: &'a str,
    directory_dev: u64,
    directory_ino: u64,
    old_file_dev: u64,
    old_file_ino: u64,
    old_file_size: u64,
    old_file_ciphertext_digest: &'a str,
    old_key_digest: &'a str,
    old_slot_record_digest: &'a str,
    candidate_slot_record_digest: &'a str,
}

#[cfg(test)]
macro_rules! recorded_prepared_components {
    ($action:expr) => {{
        TestRecordedPreparedComponents {
            workspace_id_digest: $action.workspace_id_digest(),
            directory_dev: $action.directory_dev(),
            directory_ino: $action.directory_ino(),
            old_file_dev: $action.old_file_dev(),
            old_file_ino: $action.old_file_ino(),
            old_file_size: $action.old_file_size(),
            old_file_ciphertext_digest: $action.old_file_ciphertext_digest(),
            old_key_digest: $action.old_key_digest(),
            old_slot_record_digest: $action.old_slot_record_digest(),
            candidate_slot_record_digest: $action.candidate_slot_record_digest(),
        }
    }};
}

#[cfg(test)]
fn slot_record_digest(record: &[u8]) -> String {
    lower_hex(Sha256::digest(record).as_slice())
}

#[cfg(test)]
impl fmt::Debug for TestRebootstrapRecoveryCustody {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("TestRebootstrapRecoveryCustody([REDACTED])")
    }
}

#[cfg(test)]
impl fmt::Debug for TestRebootstrapQuarantineCustody {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("TestRebootstrapQuarantineCustody([REDACTED])")
    }
}

#[cfg(test)]
impl fmt::Debug for TestDiscardRecovery {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("TestDiscardRecovery([REDACTED])")
    }
}

#[cfg(test)]
impl fmt::Debug for TestPublicationRecovery {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("TestPublicationRecovery([REDACTED])")
    }
}

#[cfg(test)]
impl fmt::Debug for TestVerifiedPublicationRecovery {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("TestVerifiedPublicationRecovery([REDACTED])")
    }
}

#[cfg(test)]
impl fmt::Debug for TestTerminalRecovery {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("TestTerminalRecovery([REDACTED])")
    }
}

#[cfg(test)]
impl fmt::Debug for TestCleanRecovery {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("TestCleanRecovery([REDACTED])")
    }
}

impl fmt::Debug for DesktopContinuityReceiptStore {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("DesktopContinuityReceiptStore([REDACTED])")
    }
}

#[cfg(test)]
fn rebootstrap_slot_file_name(slot: RebootstrapSlot) -> &'static str {
    match slot {
        RebootstrapSlot::A => "rebootstrap-a.db",
        RebootstrapSlot::B => "rebootstrap-b.db",
    }
}

#[cfg(test)]
fn rebootstrap_slot_record(
    slot: RebootstrapSlot,
    operation_id: u64,
    sequence: u64,
    key: &LocalDatabaseKey,
) -> Zeroizing<Vec<u8>> {
    let mut record = Zeroizing::new(Vec::with_capacity(
        REBOOTSTRAP_SLOT_RECORD_PREFIX.len() + 1 + 1 + 8 + 8 + DATABASE_KEY_BYTES,
    ));
    record.extend_from_slice(REBOOTSTRAP_SLOT_RECORD_PREFIX);
    record.push(REBOOTSTRAP_SLOT_RECORD_VERSION);
    record.push(slot_byte(slot));
    record.extend_from_slice(&operation_id.to_be_bytes());
    record.extend_from_slice(&sequence.to_be_bytes());
    record.extend_from_slice(key.custody_bytes());
    record
}

#[cfg(test)]
fn validate_rebootstrap_slot_record(
    record: &[u8],
    expected_slot: RebootstrapSlot,
    expected_key: &LocalDatabaseKey,
) -> Result<(u64, u64), DesktopCustodyError> {
    let decoded = decode_rebootstrap_slot_record(record, expected_slot)?;
    if decoded.key.custody_bytes() != expected_key.custody_bytes() {
        return Err(DesktopCustodyError::Rejected);
    }
    Ok((decoded.operation_id, decoded.sequence))
}

#[cfg(test)]
struct DecodedRebootstrapSlotRecord {
    operation_id: u64,
    sequence: u64,
    key: LocalDatabaseKey,
}

#[cfg(test)]
fn decode_rebootstrap_slot_record(
    record: &[u8],
    expected_slot: RebootstrapSlot,
) -> Result<DecodedRebootstrapSlotRecord, DesktopCustodyError> {
    let header = REBOOTSTRAP_SLOT_RECORD_PREFIX.len();
    let expected_len = header + 1 + 1 + 8 + 8 + DATABASE_KEY_BYTES;
    if record.len() != expected_len
        || &record[..header] != REBOOTSTRAP_SLOT_RECORD_PREFIX
        || record[header] != REBOOTSTRAP_SLOT_RECORD_VERSION
        || record[header + 1] != slot_byte(expected_slot)
    {
        return Err(DesktopCustodyError::Rejected);
    }
    let operation_id = u64::from_be_bytes(
        record[header + 2..header + 10]
            .try_into()
            .map_err(|_| DesktopCustodyError::Rejected)?,
    );
    let sequence = u64::from_be_bytes(
        record[header + 10..header + 18]
            .try_into()
            .map_err(|_| DesktopCustodyError::Rejected)?,
    );
    if operation_id == 0 || sequence == 0 {
        return Err(DesktopCustodyError::Rejected);
    }
    let key: [u8; DATABASE_KEY_BYTES] = record[header + 18..]
        .try_into()
        .map_err(|_| DesktopCustodyError::Rejected)?;
    Ok(DecodedRebootstrapSlotRecord {
        operation_id,
        sequence,
        key: LocalDatabaseKey::from_bytes(key),
    })
}

#[cfg(test)]
impl fmt::Debug for DesktopJournalStore {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("DesktopJournalStore([REDACTED])")
    }
}

#[expect(
    clippy::used_underscore_binding,
    reason = "the retained directory descriptor is both a lifetime guard and an identity source"
)]
impl DesktopProductionCustody {
    #[cfg(test)]
    fn load_active_alias(&self) -> Result<Option<Vec<u8>>, DesktopCustodyError> {
        load_active_alias_for_test(&self.rebootstrap_test_store)
    }

    #[cfg(test)]
    fn store_active_alias(&self, value: &[u8]) -> Result<(), DesktopCustodyError> {
        store_active_alias_for_test(&self.rebootstrap_test_store, value)
    }

    #[cfg(test)]
    fn ensure_active_alias_exact(&self, expected: &[u8]) -> Result<(), DesktopCustodyError> {
        match self.load_active_alias()? {
            Some(existing) if existing == expected => Ok(()),
            Some(_) | None => Err(DesktopCustodyError::Rejected),
        }
    }

    #[cfg(test)]
    fn load_rebootstrap_slot_record(
        &self,
        slot: RebootstrapSlot,
    ) -> Result<Option<Vec<u8>>, DesktopCustodyError> {
        load_slot_native(&self.rebootstrap_test_store, slot)
    }

    #[cfg(test)]
    fn create_rebootstrap_slot_record(
        &self,
        slot: RebootstrapSlot,
        value: &[u8],
    ) -> Result<(), DesktopCustodyError> {
        create_slot_native(&self.rebootstrap_test_store, slot, value)
    }

    #[cfg(test)]
    fn ensure_rebootstrap_slot_record_exact(
        &self,
        slot: RebootstrapSlot,
        expected: &[u8],
    ) -> Result<(), DesktopCustodyError> {
        match self.load_rebootstrap_slot_record(slot)? {
            Some(existing) if existing == expected => Ok(()),
            Some(_) | None => Err(DesktopCustodyError::Rejected),
        }
    }

    #[cfg(test)]
    fn delete_rebootstrap_slot_record_exact(
        &self,
        slot: RebootstrapSlot,
        expected: &[u8],
    ) -> Result<(), DesktopCustodyError> {
        delete_slot_native_exact(&self.rebootstrap_test_store, slot, expected)
    }

    #[cfg(test)]
    pub(crate) fn require_rebootstrap_reservation_capability(
        &self,
    ) -> Result<(), DesktopCustodyError> {
        match self.rebootstrap_capability {
            RebootstrapCapability::Unavailable => Err(DesktopCustodyError::Unavailable),
            #[cfg(test)]
            RebootstrapCapability::TestCreateOnly => ensure_directory_file_identity(
                &self._active_workspace,
                self.active_workspace_identity,
            ),
        }
    }

    #[cfg(test)]
    pub(crate) fn rebootstrap_state_digest_for_test(&self) -> Result<String, DesktopCustodyError> {
        ensure_directory_file_identity(&self._active_workspace, self.active_workspace_identity)?;
        let mut digest = Sha256::new();
        digest.update(b"GOODDEALER/REBOOTSTRAP-STATE-SNAPSHOT-V1\0");
        for name in [
            "rebootstrap.journal",
            "rebootstrap-a.db",
            "rebootstrap-a.db-wal",
            "rebootstrap-a.db-shm",
            "rebootstrap-a.db-journal",
            "rebootstrap-b.db",
            "rebootstrap-b.db-wal",
            "rebootstrap-b.db-shm",
            "rebootstrap-b.db-journal",
            "business.db",
            "business.db-wal",
            "business.db-shm",
            "business.db-journal",
        ] {
            add_named_entry_snapshot(&mut digest, &self._active_workspace, name)?;
        }
        for slot in [RebootstrapSlot::A, RebootstrapSlot::B] {
            digest.update([slot_byte(slot)]);
            match self.load_rebootstrap_slot_record(slot)? {
                Some(record) => {
                    digest.update([1]);
                    digest.update(Sha256::digest(record));
                }
                None => digest.update([0]),
            }
        }
        match self.load_active_alias()? {
            Some(alias) => {
                digest.update([1]);
                digest.update(Sha256::digest(alias));
            }
            None => digest.update([0]),
        }
        Ok(lower_hex(digest.finalize().as_slice()))
    }

    #[cfg(test)]
    pub(crate) fn opaque_rebootstrap_state_digest_for_test(
        &self,
    ) -> Result<TestRebootstrapStateDigest, DesktopCustodyError> {
        test_rebootstrap_state_digest(&self._active_workspace, &self.rebootstrap_test_store)
    }

    #[cfg(test)]
    #[expect(
        clippy::too_many_lines,
        reason = "the private custody reservation keeps its ordered fail-closed protocol visible"
    )]
    pub(crate) fn reserve_rebootstrap(
        &self,
        reservation: &RebootstrapReservation,
        current: &mut crate::BusinessDatabase,
    ) -> Result<(CandidateReservation, PreparedEvidence), DesktopCustodyError> {
        self.require_rebootstrap_reservation_capability()?;
        current
            .prepare_rebootstrap_publication()
            .map_err(|_| DesktopCustodyError::StorageRejected)?;
        reject_database_sidecars(&self._active_workspace, "business.db")?;
        let old_slot = reservation.old_slot();
        let candidate_slot = reservation.candidate_slot();
        if old_slot == candidate_slot {
            return Err(DesktopCustodyError::Rejected);
        }
        let workspace_id_digest = workspace_id_digest(current.workspace_id());
        let active = self
            .active_database
            .lock()
            .map_err(|_| DesktopCustodyError::StorageRejected)?;
        ensure_directory_file_identity(&self._active_workspace, self.active_workspace_identity)?;
        ensure_file_identity(&active.file, active.identity)?;
        ensure_path_identity(&self.database_path, active.identity)?;
        let old = file_custody_evidence(&active.file, active.identity, &active.key)?;
        require_absent_workspace_entry(
            &self._active_workspace,
            rebootstrap_slot_file_name(old_slot),
        )?;
        require_absent_workspace_entry(
            &self._active_workspace,
            rebootstrap_slot_file_name(candidate_slot),
        )?;
        let (old_slot_record, old_slot_created, old_origin_operation, old_origin_sequence) =
            if let Some(existing) = self.load_rebootstrap_slot_record(old_slot)? {
                let existing = Zeroizing::new(existing);
                let (origin_operation, origin_sequence) =
                    validate_rebootstrap_slot_record(&existing, old_slot, &active.key)?;
                if origin_sequence > reservation.publication_sequence() {
                    return Err(DesktopCustodyError::Rejected);
                }
                (existing, false, origin_operation, origin_sequence)
            } else {
                let record = rebootstrap_slot_record(
                    old_slot,
                    reservation.operation_id(),
                    reservation.publication_sequence(),
                    &active.key,
                );
                self.create_rebootstrap_slot_record(old_slot, &record)?;
                self.ensure_rebootstrap_slot_record_exact(old_slot, &record)?;
                (
                    record,
                    true,
                    reservation.operation_id(),
                    reservation.publication_sequence(),
                )
            };
        if self.load_rebootstrap_slot_record(candidate_slot)?.is_some() {
            return Err(DesktopCustodyError::Rejected);
        }
        let mut bytes = Zeroizing::new([0_u8; DATABASE_KEY_BYTES]);
        getrandom::fill(&mut *bytes).map_err(|_| DesktopCustodyError::RandomUnavailable)?;
        let candidate_key = LocalDatabaseKey::from_bytes(*bytes);
        let candidate_slot_record = rebootstrap_slot_record(
            candidate_slot,
            reservation.operation_id(),
            reservation.publication_sequence(),
            &candidate_key,
        );
        if let Err(error) =
            self.create_rebootstrap_slot_record(candidate_slot, &candidate_slot_record)
        {
            if old_slot_created {
                let _ = self.delete_rebootstrap_slot_record_exact(old_slot, &old_slot_record);
            }
            return Err(error);
        }
        self.ensure_rebootstrap_slot_record_exact(candidate_slot, &candidate_slot_record)?;
        let candidate_key_digest = key_digest(&candidate_key);
        let digest = prepared_evidence_digest(
            reservation.operation_id(),
            reservation.publication_sequence(),
            old_slot,
            candidate_slot,
            self.active_workspace_identity,
            &workspace_id_digest,
            &old,
            &active.key,
            &candidate_key,
            &old_slot_record,
            &candidate_slot_record,
            old_slot_created,
        );
        let prepared = PreparedEvidence {
            operation_id: reservation.operation_id(),
            sequence: reservation.publication_sequence(),
            old_slot,
            candidate_slot,
            directory_identity: self.active_workspace_identity,
            old,
            workspace_id_digest,
            old_slot_record_digest: lower_hex(Sha256::digest(&old_slot_record).as_slice()),
            candidate_slot_record_digest: lower_hex(
                Sha256::digest(&candidate_slot_record).as_slice(),
            ),
            digest: digest.clone(),
            candidate_key_digest,
            old_slot_origin_operation_id: old_origin_operation,
            old_slot_origin_publication_sequence: old_origin_sequence,
            candidate_slot_origin_operation_id: reservation.operation_id(),
            candidate_slot_origin_publication_sequence: reservation.publication_sequence(),
            old_slot_created_by_operation: old_slot_created,
        };
        Ok((
            CandidateReservation {
                operation_id: reservation.operation_id(),
                sequence: reservation.publication_sequence(),
                old_slot,
                candidate_slot,
                candidate_key,
                old_slot_record,
                candidate_slot_record,
                old_slot_created,
                prepared_digest: digest,
            },
            prepared,
        ))
    }

    #[cfg(test)]
    #[expect(
        clippy::too_many_lines,
        reason = "the private materialization protocol keeps cleanup for every failure edge adjacent"
    )]
    pub(crate) fn materialize_candidate(
        &self,
        reservation: CandidateReservation,
        current: &mut crate::BusinessDatabase,
    ) -> Result<(RebootstrapCandidate, CandidateReservedEvidence), DesktopCustodyError> {
        let active = self
            .active_database
            .lock()
            .map_err(|_| DesktopCustodyError::StorageRejected)?;
        ensure_file_identity(&active.file, active.identity)?;
        ensure_directory_file_identity(&self._active_workspace, self.active_workspace_identity)?;
        let path = self
            .database_path
            .parent()
            .ok_or(DesktopCustodyError::StorageRejected)?
            .join(rebootstrap_slot_file_name(reservation.candidate_slot));
        if reservation.old_slot == reservation.candidate_slot {
            return Err(DesktopCustodyError::Rejected);
        }
        self.ensure_rebootstrap_slot_record_exact(
            reservation.old_slot,
            &reservation.old_slot_record,
        )?;
        self.ensure_rebootstrap_slot_record_exact(
            reservation.candidate_slot,
            &reservation.candidate_slot_record,
        )?;
        let file = match create_named_database(
            &self._active_workspace,
            rebootstrap_slot_file_name(reservation.candidate_slot),
        ) {
            Ok(file) => file,
            Err(error) => {
                let _ = self.delete_rebootstrap_slot_record_exact(
                    reservation.candidate_slot,
                    &reservation.candidate_slot_record,
                );
                if reservation.old_slot_created {
                    let _ = self.delete_rebootstrap_slot_record_exact(
                        reservation.old_slot,
                        &reservation.old_slot_record,
                    );
                }
                return Err(error);
            }
        };
        let identity = file_identity(&file)?;
        ensure_path_identity(&path, identity)?;
        if current
            .clone_encrypted_to_file(&file, &reservation.candidate_key)
            .is_err()
        {
            ensure_file_identity(&file, identity)?;
            ensure_named_identity(
                &self._active_workspace,
                rebootstrap_slot_file_name(reservation.candidate_slot),
                identity,
            )?;
            unlink_named_file(
                &self._active_workspace,
                rebootstrap_slot_file_name(reservation.candidate_slot),
            )?;
            self.delete_rebootstrap_slot_record_exact(
                reservation.candidate_slot,
                &reservation.candidate_slot_record,
            )?;
            if reservation.old_slot_created {
                self.delete_rebootstrap_slot_record_exact(
                    reservation.old_slot,
                    &reservation.old_slot_record,
                )?;
            }
            return Err(DesktopCustodyError::StorageRejected);
        }
        ensure_file_identity(&file, identity)?;
        ensure_path_identity(&path, identity)?;
        reject_database_sidecars(
            &self._active_workspace,
            rebootstrap_slot_file_name(reservation.candidate_slot),
        )?;
        file.sync_all()
            .map_err(|_| DesktopCustodyError::StorageRejected)?;
        self._active_workspace
            .sync_all()
            .map_err(|_| DesktopCustodyError::StorageRejected)?;
        drop(active);
        let candidate = RebootstrapCandidate {
            operation_id: reservation.operation_id,
            sequence: reservation.sequence,
            old_slot: reservation.old_slot,
            slot: reservation.candidate_slot,
            path,
            file,
            identity,
            key: reservation.candidate_key,
            old_slot_record: reservation.old_slot_record,
            candidate_slot_record: reservation.candidate_slot_record,
            old_slot_created: reservation.old_slot_created,
            prepared_digest: reservation.prepared_digest,
            candidate_reserved_digest: String::new(),
        };
        let candidate_file_evidence = candidate_custody_evidence(&candidate)?;
        let digest = candidate_reserved_evidence_digest(
            candidate.operation_id,
            candidate.sequence,
            candidate.old_slot,
            candidate.slot,
            self.active_workspace_identity,
            &candidate_file_evidence,
            &candidate.prepared_digest,
        );
        let mut candidate = candidate;
        candidate.candidate_reserved_digest.clone_from(&digest);
        let evidence = CandidateReservedEvidence {
            operation_id: candidate.operation_id,
            sequence: candidate.sequence,
            old_slot: candidate.old_slot,
            candidate_slot: candidate.slot,
            digest,
        };
        Ok((candidate, evidence))
    }

    #[cfg(test)]
    pub(crate) fn with_rebootstrap_candidate<T>(
        &self,
        candidate: &RebootstrapCandidate,
        workspace_id: &str,
        operation: impl FnOnce(&mut crate::BusinessDatabase) -> Result<T, crate::BusinessDatabaseError>,
    ) -> Result<(T, CandidateFinalEvidence), DesktopCustodyError> {
        ensure_directory_file_identity(&self._active_workspace, self.active_workspace_identity)?;
        ensure_file_identity(&candidate.file, candidate.identity)?;
        ensure_path_identity(&candidate.path, candidate.identity)?;
        let mut database =
            crate::BusinessDatabase::open(&candidate.path, &candidate.key, workspace_id)
                .map_err(|_| DesktopCustodyError::StorageRejected)?;
        let result = operation(&mut database).map_err(|_| DesktopCustodyError::StorageRejected)?;
        database
            .prepare_rebootstrap_publication()
            .map_err(|_| DesktopCustodyError::StorageRejected)?;
        drop(database);
        reject_database_sidecars(
            &self._active_workspace,
            rebootstrap_slot_file_name(candidate.slot),
        )?;
        candidate
            .file
            .sync_all()
            .map_err(|_| DesktopCustodyError::StorageRejected)?;
        self._active_workspace
            .sync_all()
            .map_err(|_| DesktopCustodyError::StorageRejected)?;
        ensure_directory_file_identity(&self._active_workspace, self.active_workspace_identity)?;
        ensure_file_identity(&candidate.file, candidate.identity)?;
        ensure_path_identity(&candidate.path, candidate.identity)?;
        let evidence = CandidateFinalEvidence {
            candidate: candidate_custody_evidence(candidate)?,
        };
        Ok((result, evidence))
    }

    #[cfg(test)]
    #[expect(
        clippy::needless_pass_by_value,
        reason = "consuming the final evidence enforces the private typestate transition"
    )]
    pub(crate) fn verify_candidate(
        &self,
        candidate: RebootstrapCandidate,
        candidate_final: CandidateFinalEvidence,
        mut current: crate::BusinessDatabase,
        proof: &crate::DatabaseRecoveryProof,
        journal_link: &crate::RebootstrapJournalLink,
    ) -> Result<VerifiedCandidate, DesktopCustodyError> {
        current
            .prepare_rebootstrap_publication()
            .map_err(|_| DesktopCustodyError::StorageRejected)?;
        drop(current);
        reject_database_sidecars(&self._active_workspace, "business.db")?;
        reject_database_sidecars(
            &self._active_workspace,
            rebootstrap_slot_file_name(candidate.slot),
        )?;
        let active = self
            .active_database
            .lock()
            .map_err(|_| DesktopCustodyError::StorageRejected)?;
        ensure_directory_file_identity(&self._active_workspace, self.active_workspace_identity)?;
        ensure_file_identity(&active.file, active.identity)?;
        ensure_path_identity(&self.database_path, active.identity)?;
        ensure_file_identity(&candidate.file, candidate.identity)?;
        ensure_path_identity(&candidate.path, candidate.identity)?;
        active
            .file
            .sync_all()
            .map_err(|_| DesktopCustodyError::StorageRejected)?;
        candidate
            .file
            .sync_all()
            .map_err(|_| DesktopCustodyError::StorageRejected)?;
        self._active_workspace
            .sync_all()
            .map_err(|_| DesktopCustodyError::StorageRejected)?;
        let old = file_custody_evidence(&active.file, active.identity, &active.key)?;
        let candidate_evidence = candidate_custody_evidence(&candidate)?;
        if candidate_evidence != candidate_final.candidate {
            return Err(DesktopCustodyError::Rejected);
        }
        let proof_digest = recovery_proof_digest(proof)?;
        let journal_link_digest = journal_link_digest(journal_link)?;
        let digest = verified_evidence_digest(
            candidate.operation_id,
            candidate.sequence,
            candidate.old_slot,
            candidate.slot,
            self.active_workspace_identity,
            &old,
            &candidate_evidence,
            proof_digest,
            journal_link_digest,
            &candidate.prepared_digest,
            &candidate.candidate_reserved_digest,
        );
        let evidence = VerifiedCustodyEvidence {
            operation_id: candidate.operation_id,
            sequence: candidate.sequence,
            old_slot: candidate.old_slot,
            candidate_slot: candidate.slot,
            proof_digest,
            journal_link_digest,
            directory_identity: self.active_workspace_identity,
            old,
            candidate: candidate_evidence,
            digest,
        };
        drop(active);
        Ok(VerifiedCandidate {
            candidate,
            evidence,
        })
    }

    #[cfg(test)]
    #[expect(
        clippy::needless_pass_by_value,
        reason = "cleanup consumes the candidate handle so it cannot be reused after deletion"
    )]
    pub(crate) fn discard_rebootstrap_candidate_handle(
        &self,
        candidate: RebootstrapCandidate,
    ) -> Result<(), DesktopCustodyError> {
        ensure_file_identity(&candidate.file, candidate.identity)?;
        ensure_named_identity(
            &self._active_workspace,
            rebootstrap_slot_file_name(candidate.slot),
            candidate.identity,
        )?;
        unlink_named_file(
            &self._active_workspace,
            rebootstrap_slot_file_name(candidate.slot),
        )?;
        self.delete_rebootstrap_slot_record_exact(
            candidate.slot,
            &candidate.candidate_slot_record,
        )?;
        if candidate.old_slot_created {
            self.delete_rebootstrap_slot_record_exact(
                candidate.old_slot,
                &candidate.old_slot_record,
            )?;
        }
        Ok(())
    }

    #[cfg(test)]
    pub(crate) fn publish(
        &self,
        verified: VerifiedCandidate,
        intent: &PublishRebootstrap,
    ) -> Result<PublishedRebootstrap, DesktopCustodyError> {
        self.publish_internal(
            verified,
            intent,
            #[cfg(test)]
            None,
        )
    }

    #[cfg(test)]
    pub(crate) fn publish_with_crash_for_test(
        &self,
        verified: VerifiedCandidate,
        intent: &PublishRebootstrap,
        boundary: TestRebootstrapCrashBoundary,
    ) -> Result<PublishedRebootstrap, DesktopCustodyError> {
        self.publish_internal(verified, intent, Some(boundary))
    }

    #[cfg(test)]
    fn publish_internal(
        &self,
        verified: VerifiedCandidate,
        intent: &PublishRebootstrap,
        #[cfg(test)] boundary: Option<TestRebootstrapCrashBoundary>,
    ) -> Result<PublishedRebootstrap, DesktopCustodyError> {
        let candidate = verified.candidate;
        if candidate.operation_id != intent.operation_id()
            || candidate.sequence != intent.publication_sequence()
            || candidate.old_slot != intent.old_slot()
            || candidate.slot != intent.candidate_slot()
        {
            return Err(DesktopCustodyError::Rejected);
        }
        let mut active = self
            .active_database
            .lock()
            .map_err(|_| DesktopCustodyError::StorageRejected)?;
        ensure_file_identity(&active.file, active.identity)?;
        ensure_file_identity(&candidate.file, candidate.identity)?;
        ensure_path_identity(&candidate.path, candidate.identity)?;
        ensure_directory_file_identity(&self._active_workspace, self.active_workspace_identity)?;
        if verified.evidence.directory_identity != self.active_workspace_identity
            || file_custody_evidence(&active.file, active.identity, &active.key)?
                != verified.evidence.old
            || candidate_custody_evidence(&candidate)? != verified.evidence.candidate
        {
            return Err(DesktopCustodyError::Rejected);
        }
        self.ensure_rebootstrap_slot_record_exact(candidate.old_slot, &candidate.old_slot_record)?;
        self.ensure_rebootstrap_slot_record_exact(
            candidate.slot,
            &candidate.candidate_slot_record,
        )?;
        let candidate_name = rebootstrap_slot_file_name(candidate.slot);
        if candidate.slot == candidate.old_slot {
            return Err(DesktopCustodyError::Rejected);
        }
        require_absent_workspace_entry(
            &self._active_workspace,
            rebootstrap_slot_file_name(candidate.old_slot),
        )?;
        exchange_workspace_files(&self._active_workspace, "business.db", candidate_name)?;
        #[cfg(test)]
        if boundary == Some(TestRebootstrapCrashBoundary::AfterExchangeBeforeDirectoryFsync) {
            return Err(DesktopCustodyError::StorageRejected);
        }
        self._active_workspace
            .sync_all()
            .map_err(|_| DesktopCustodyError::StorageRejected)?;
        let old_file = std::mem::replace(&mut active.file, candidate.file);
        let old_identity = std::mem::replace(&mut active.identity, candidate.identity);
        let old_key = std::mem::replace(&mut active.key, candidate.key);
        ensure_path_identity(&self.database_path, active.identity)?;
        ensure_named_identity(&self._active_workspace, candidate_name, old_identity)?;
        self.store_active_alias(active.key.custody_bytes())?;
        #[cfg(test)]
        if boundary == Some(TestRebootstrapCrashBoundary::AfterAliasRepairBeforePublished) {
            return Err(DesktopCustodyError::StorageRejected);
        }
        let new_file = active
            .file
            .try_clone()
            .map_err(|_| DesktopCustodyError::StorageRejected)?;
        Ok(PublishedRebootstrap {
            operation_id: candidate.operation_id,
            sequence: candidate.sequence,
            old_slot: candidate.old_slot,
            candidate_slot: candidate.slot,
            new_file,
            new_identity: active.identity,
            old_file,
            old_identity,
            old_key,
            old_slot_record: candidate.old_slot_record,
            candidate_slot_record: candidate.candidate_slot_record,
            evidence: verified.evidence,
        })
    }

    /// Verifies the published candidate without creating a writable `SQLite` connection. The
    /// runtime must durably confirm `ReopenedVerified` before it may establish ordinary business
    /// authority, so a crash between proof and confirmation leaves the V3 ciphertext evidence
    /// byte-for-byte restart-stable.
    #[cfg(all(test, unix))]
    #[cfg(test)]
    pub(crate) fn verify_published_read_only(
        &self,
        publication: &PublishedRebootstrap,
        workspace_id: &str,
        journal_link: &crate::RebootstrapJournalLink,
    ) -> Result<(), DesktopCustodyError> {
        ensure_directory_file_identity(&self._active_workspace, self.active_workspace_identity)?;
        if publication.evidence.directory_identity != self.active_workspace_identity
            || journal_link_digest(journal_link)? != publication.evidence.journal_link_digest
        {
            return Err(DesktopCustodyError::Rejected);
        }
        let active = self
            .active_database
            .lock()
            .map_err(|_| DesktopCustodyError::StorageRejected)?;
        if active.identity != publication.new_identity
            || file_identity(&publication.new_file)? != publication.new_identity
            || file_custody_evidence(&publication.new_file, publication.new_identity, &active.key)?
                != publication.evidence.candidate
            || file_custody_evidence(
                &publication.old_file,
                publication.old_identity,
                &publication.old_key,
            )? != publication.evidence.old
        {
            return Err(DesktopCustodyError::Rejected);
        }
        ensure_file_identity(&active.file, publication.new_identity)?;
        ensure_path_identity(&self.database_path, publication.new_identity)?;
        let parked_name = rebootstrap_slot_file_name(publication.candidate_slot);
        ensure_named_identity(
            &self._active_workspace,
            parked_name,
            publication.old_identity,
        )?;
        reject_database_sidecars(&self._active_workspace, "business.db")?;
        reject_database_sidecars(&self._active_workspace, parked_name)?;
        self.ensure_rebootstrap_slot_record_exact(
            publication.old_slot,
            &publication.old_slot_record,
        )?;
        self.ensure_rebootstrap_slot_record_exact(
            publication.candidate_slot,
            &publication.candidate_slot_record,
        )?;
        self.ensure_active_alias_exact(active.key.custody_bytes())?;
        let (origin_operation, origin_sequence) = validate_rebootstrap_slot_record(
            &publication.candidate_slot_record,
            publication.candidate_slot,
            &active.key,
        )?;
        if origin_operation != publication.operation_id || origin_sequence != publication.sequence {
            return Err(DesktopCustodyError::Rejected);
        }
        let proof = crate::active_workspace::business::verify_rebootstrap_recovery_read_only(
            &publication.new_file,
            &active.key,
            workspace_id,
            journal_link,
        )
        .map_err(|_| DesktopCustodyError::StorageRejected)?;
        if recovery_proof_digest(&proof)? != publication.evidence.proof_digest {
            return Err(DesktopCustodyError::Rejected);
        }
        ensure_directory_file_identity(&self._active_workspace, self.active_workspace_identity)?;
        if file_custody_evidence(&publication.new_file, publication.new_identity, &active.key)?
            != publication.evidence.candidate
            || file_custody_evidence(
                &publication.old_file,
                publication.old_identity,
                &publication.old_key,
            )? != publication.evidence.old
        {
            return Err(DesktopCustodyError::Rejected);
        }
        ensure_file_identity(&active.file, publication.new_identity)?;
        ensure_path_identity(&self.database_path, publication.new_identity)?;
        ensure_named_identity(
            &self._active_workspace,
            parked_name,
            publication.old_identity,
        )?;
        reject_database_sidecars(&self._active_workspace, "business.db")?;
        reject_database_sidecars(&self._active_workspace, parked_name)?;
        self.ensure_rebootstrap_slot_record_exact(
            publication.old_slot,
            &publication.old_slot_record,
        )?;
        self.ensure_rebootstrap_slot_record_exact(
            publication.candidate_slot,
            &publication.candidate_slot_record,
        )?;
        self.ensure_active_alias_exact(active.key.custody_bytes())
    }

    #[cfg(test)]
    pub(crate) fn reopen_published_with_crash_for_test(
        &self,
        publication: &PublishedRebootstrap,
        workspace_id: &str,
        journal_link: &crate::RebootstrapJournalLink,
        boundary: TestRebootstrapCrashBoundary,
    ) -> Result<(), DesktopCustodyError> {
        if boundary != TestRebootstrapCrashBoundary::ReopenProofFailure {
            return Err(DesktopCustodyError::Rejected);
        }
        self.verify_published_read_only(publication, workspace_id, journal_link)?;
        Err(DesktopCustodyError::StorageRejected)
    }

    #[cfg(test)]
    pub(crate) fn retire_rebootstrap_old(
        &self,
        publication: PublishedRebootstrap,
    ) -> Result<(), DesktopCustodyError> {
        let validated = self.validate_rebootstrap_retirement(publication)?;
        let unlinked = self.unlink_rebootstrap_old(validated)?;
        self.delete_rebootstrap_old_slot(unlinked)?;
        Ok(())
    }

    #[cfg(test)]
    pub(crate) fn retire_rebootstrap_old_with_crash_for_test(
        &self,
        publication: PublishedRebootstrap,
        boundary: TestRebootstrapCrashBoundary,
    ) -> Result<(), DesktopCustodyError> {
        if !matches!(
            boundary,
            TestRebootstrapCrashBoundary::AfterOldFileUnlinkAndDirectoryFsync
                | TestRebootstrapCrashBoundary::AfterOldSlotDeleteAndAbsentReadback
        ) {
            return Err(DesktopCustodyError::Rejected);
        }
        let validated = self.validate_rebootstrap_retirement(publication)?;
        let unlinked = self.unlink_rebootstrap_old(validated)?;
        if boundary == TestRebootstrapCrashBoundary::AfterOldFileUnlinkAndDirectoryFsync {
            return Err(DesktopCustodyError::StorageRejected);
        }
        let deleted = self.delete_rebootstrap_old_slot(unlinked)?;
        if boundary == TestRebootstrapCrashBoundary::AfterOldSlotDeleteAndAbsentReadback {
            return Err(DesktopCustodyError::StorageRejected);
        }
        let DeletedRetirement = deleted;
        Err(DesktopCustodyError::Rejected)
    }

    #[cfg(test)]
    fn validate_rebootstrap_retirement(
        &self,
        publication: PublishedRebootstrap,
    ) -> Result<ValidatedRetirement, DesktopCustodyError> {
        ensure_directory_file_identity(&self._active_workspace, self.active_workspace_identity)?;
        ensure_file_identity(&publication.new_file, publication.new_identity)?;
        ensure_path_identity(&self.database_path, publication.new_identity)?;
        ensure_file_identity(&publication.old_file, publication.old_identity)?;
        let name = rebootstrap_slot_file_name(publication.candidate_slot);
        ensure_named_identity(&self._active_workspace, name, publication.old_identity)?;
        if file_custody_evidence(
            &publication.old_file,
            publication.old_identity,
            &publication.old_key,
        )? != publication.evidence.old
        {
            return Err(DesktopCustodyError::Rejected);
        }
        self.ensure_rebootstrap_slot_record_exact(
            publication.old_slot,
            &publication.old_slot_record,
        )?;
        self.ensure_rebootstrap_slot_record_exact(
            publication.candidate_slot,
            &publication.candidate_slot_record,
        )?;
        let active = self
            .active_database
            .lock()
            .map_err(|_| DesktopCustodyError::StorageRejected)?;
        if active.identity != publication.new_identity
            || file_custody_evidence(&active.file, active.identity, &active.key)?
                != publication.evidence.candidate
        {
            return Err(DesktopCustodyError::Rejected);
        }
        self.ensure_active_alias_exact(active.key.custody_bytes())?;
        drop(active);
        Ok(ValidatedRetirement(publication))
    }

    #[cfg(test)]
    fn unlink_rebootstrap_old(
        &self,
        validated: ValidatedRetirement,
    ) -> Result<UnlinkedRetirement, DesktopCustodyError> {
        let publication = validated.0;
        let name = rebootstrap_slot_file_name(publication.candidate_slot);
        ensure_file_identity(&publication.old_file, publication.old_identity)?;
        ensure_named_identity(&self._active_workspace, name, publication.old_identity)?;
        unlink_named_file(&self._active_workspace, name)?;
        require_absent_workspace_entry(&self._active_workspace, name)?;
        Ok(UnlinkedRetirement(publication))
    }

    #[cfg(test)]
    fn delete_rebootstrap_old_slot(
        &self,
        unlinked: UnlinkedRetirement,
    ) -> Result<DeletedRetirement, DesktopCustodyError> {
        let publication = unlinked.0;
        require_absent_workspace_entry(
            &self._active_workspace,
            rebootstrap_slot_file_name(publication.candidate_slot),
        )?;
        self.ensure_rebootstrap_slot_record_exact(
            publication.old_slot,
            &publication.old_slot_record,
        )?;
        self.delete_rebootstrap_slot_record_exact(
            publication.old_slot,
            &publication.old_slot_record,
        )?;
        if self
            .load_rebootstrap_slot_record(publication.old_slot)?
            .is_some()
        {
            return Err(DesktopCustodyError::Rejected);
        }
        Ok(DeletedRetirement)
    }

    #[cfg(test)]
    pub(crate) fn rebootstrap_journal_store(
        &self,
    ) -> Result<DesktopJournalStore, DesktopCustodyError> {
        ensure_directory_file_identity(&self._active_workspace, self.active_workspace_identity)?;
        let directory = Arc::new(
            self._active_workspace
                .try_clone()
                .map_err(|_| DesktopCustodyError::StorageRejected)?,
        );
        let journal_name = "rebootstrap.journal".to_owned();
        let journal = open_journal_optional(&directory, journal_name.as_str())?;
        Ok(DesktopJournalStore {
            directory,
            directory_identity: self.active_workspace_identity,
            journal_name,
            journal: Mutex::new(journal),
        })
    }

    #[expect(
        dead_code,
        reason = "production continuity composition consumes this narrow custody seam in the next integration stage"
    )]
    pub(crate) fn continuity_receipt_store(
        &self,
    ) -> Result<DesktopContinuityReceiptStore, DesktopCustodyError> {
        ensure_directory_file_identity(&self._active_workspace, self.active_workspace_identity)?;
        let directory = match rustix::fs::openat(
            &self._active_workspace,
            ".backup-continuity",
            rustix::fs::OFlags::RDONLY
                | rustix::fs::OFlags::DIRECTORY
                | rustix::fs::OFlags::NOFOLLOW
                | rustix::fs::OFlags::CLOEXEC,
            rustix::fs::Mode::empty(),
        ) {
            Ok(fd) => File::from(fd),
            Err(rustix::io::Errno::NOENT) => {
                rustix::fs::mkdirat(
                    &self._active_workspace,
                    ".backup-continuity",
                    rustix::fs::Mode::RUSR | rustix::fs::Mode::WUSR | rustix::fs::Mode::XUSR,
                )
                .map_err(|_| DesktopCustodyError::StorageRejected)?;
                File::from(
                    rustix::fs::openat(
                        &self._active_workspace,
                        ".backup-continuity",
                        rustix::fs::OFlags::RDONLY
                            | rustix::fs::OFlags::DIRECTORY
                            | rustix::fs::OFlags::NOFOLLOW
                            | rustix::fs::OFlags::CLOEXEC,
                        rustix::fs::Mode::empty(),
                    )
                    .map_err(|_| DesktopCustodyError::StorageRejected)?,
                )
            }
            Err(_) => return Err(DesktopCustodyError::Rejected),
        };
        let directory_identity = directory_file_identity(&directory)?;
        Ok(DesktopContinuityReceiptStore {
            directory: Arc::new(directory),
            directory_identity,
        })
    }
}

#[cfg(test)]
impl TestRebootstrapRecoveryCustody {
    fn store_active_alias(&self, value: &[u8]) -> Result<(), DesktopCustodyError> {
        store_active_alias_for_test(&self.store, value)
    }

    pub(crate) fn open(
        root: &DesktopApplicationRoot,
        store: TestRebootstrapKeyStore,
    ) -> Result<Self, DesktopCustodyError> {
        root.verify_identity()
            .map_err(|_| DesktopCustodyError::Rejected)?;
        let process_lock = acquire_process_lock(root)?;
        let active_workspace = open_active_workspace_existing(root)?;
        let active_workspace_identity = directory_file_identity(&active_workspace)?;
        let database_path = root.business_database_path();
        ensure_directory_path_identity(
            database_path
                .parent()
                .ok_or(DesktopCustodyError::StorageRejected)?,
            active_workspace_identity,
        )?;
        Ok(Self {
            process_lock,
            active_workspace,
            active_workspace_identity,
            database_path,
            store,
        })
    }

    pub(crate) fn journal_store(&self) -> Result<DesktopJournalStore, DesktopCustodyError> {
        TEST_JOURNAL_INSPECTIONS.fetch_add(1, Ordering::SeqCst);
        ensure_directory_file_identity(&self.active_workspace, self.active_workspace_identity)?;
        let directory = Arc::new(
            self.active_workspace
                .try_clone()
                .map_err(|_| DesktopCustodyError::StorageRejected)?,
        );
        let journal_name = "rebootstrap.journal".to_owned();
        let journal = open_journal_optional(&directory, &journal_name)?;
        Ok(DesktopJournalStore {
            directory,
            directory_identity: self.active_workspace_identity,
            journal_name,
            journal: Mutex::new(journal),
        })
    }

    pub(crate) fn state_digest(&self) -> Result<TestRebootstrapStateDigest, DesktopCustodyError> {
        self.require_test_recovery_mode()?;
        test_rebootstrap_state_digest(&self.active_workspace, &self.store)
    }

    pub(crate) fn quarantine_custody(
        &self,
    ) -> Result<TestRebootstrapQuarantineCustody, DesktopCustodyError> {
        self.require_test_recovery_mode()?;
        Ok(TestRebootstrapQuarantineCustody {
            _process_lock: self
                .process_lock
                .try_clone()
                .map_err(|_| DesktopCustodyError::StorageRejected)?,
            active_workspace: self
                .active_workspace
                .try_clone()
                .map_err(|_| DesktopCustodyError::StorageRejected)?,
            active_workspace_identity: self.active_workspace_identity,
        })
    }

    #[expect(
        clippy::too_many_arguments,
        reason = "the recovery proof binds each journal component to one retained custody topology"
    )]
    fn verify_prepared_components(
        &self,
        recorded: TestRecordedPreparedComponents<'_>,
        workspace_id: &str,
        old_database_name: &str,
        old_file: &File,
        old_identity: FileIdentity,
        old_key: &LocalDatabaseKey,
        old_slot: RebootstrapSlot,
        old_slot_record: Option<&[u8]>,
        candidate_slot: RebootstrapSlot,
        candidate_slot_record: Option<&[u8]>,
    ) -> Result<FileCustodyEvidence, DesktopCustodyError> {
        self.verify_prepared_component_shape(&recorded, workspace_id)?;
        ensure_named_identity(&self.active_workspace, old_database_name, old_identity)?;

        let before = file_custody_evidence(old_file, old_identity, old_key)?;
        if before.identity.dev != recorded.old_file_dev
            || before.identity.ino != recorded.old_file_ino
            || before.size != recorded.old_file_size
            || before.ciphertext_digest != recorded.old_file_ciphertext_digest
            || before.key_digest != recorded.old_key_digest
            || old_slot_record
                .is_some_and(|record| slot_record_digest(record) != recorded.old_slot_record_digest)
            || candidate_slot_record.is_some_and(|record| {
                slot_record_digest(record) != recorded.candidate_slot_record_digest
            })
        {
            return Err(DesktopCustodyError::Rejected);
        }

        // The proof is descriptor-bound and immutable. Rechecking every opaque component after it
        // returns prevents a successful SQLCipher open from becoming a TOCTOU admission seam.
        crate::active_workspace::business::verify_clean_start_database_read_only(
            old_file,
            old_key,
            workspace_id,
            1,
        )
        .map_err(|_| DesktopCustodyError::Rejected)?;
        ensure_directory_file_identity(&self.active_workspace, self.active_workspace_identity)?;
        ensure_named_identity(&self.active_workspace, old_database_name, old_identity)?;
        if file_custody_evidence(old_file, old_identity, old_key)? != before
            || load_slot_native(&self.store, old_slot)?.as_deref() != old_slot_record
            || load_slot_native(&self.store, candidate_slot)?.as_deref() != candidate_slot_record
        {
            return Err(DesktopCustodyError::Rejected);
        }
        if old_slot_record.is_none()
            && load_active_alias_for_test(&self.store)?.as_deref() != Some(old_key.custody_bytes())
        {
            return Err(DesktopCustodyError::Rejected);
        }
        Ok(before)
    }

    #[expect(
        clippy::too_many_arguments,
        reason = "terminal validation binds current custody while allowing post-cancellation business writes"
    )]
    fn verify_cancelled_terminal_components(
        &self,
        recorded: TestRecordedPreparedComponents<'_>,
        workspace_id: &str,
        active_publication_link: Option<&crate::RebootstrapJournalLink>,
        active_file: &File,
        active_identity: FileIdentity,
        old_key: &LocalDatabaseKey,
        old_slot: RebootstrapSlot,
        old_slot_record: Option<&[u8]>,
        candidate_slot: RebootstrapSlot,
    ) -> Result<(), DesktopCustodyError> {
        self.verify_prepared_component_shape(&recorded, workspace_id)?;
        ensure_named_identity(&self.active_workspace, "business.db", active_identity)?;
        let before = file_custody_evidence(active_file, active_identity, old_key)?;
        if before.key_digest != recorded.old_key_digest
            || old_slot_record
                .is_some_and(|record| slot_record_digest(record) != recorded.old_slot_record_digest)
        {
            return Err(DesktopCustodyError::Rejected);
        }
        crate::active_workspace::business::verify_terminal_publication_database_read_only(
            active_file,
            old_key,
            workspace_id,
            1,
            active_publication_link,
        )
        .map_err(|_| DesktopCustodyError::Rejected)?;
        ensure_directory_file_identity(&self.active_workspace, self.active_workspace_identity)?;
        ensure_named_identity(&self.active_workspace, "business.db", active_identity)?;
        if file_custody_evidence(active_file, active_identity, old_key)? != before
            || load_slot_native(&self.store, old_slot)?.as_deref() != old_slot_record
            || load_slot_native(&self.store, candidate_slot)?.is_some()
        {
            return Err(DesktopCustodyError::Rejected);
        }
        if old_slot_record.is_none()
            && load_active_alias_for_test(&self.store)?.as_deref() != Some(old_key.custody_bytes())
        {
            return Err(DesktopCustodyError::Rejected);
        }
        Ok(())
    }

    fn verify_prepared_component_shape(
        &self,
        recorded: &TestRecordedPreparedComponents<'_>,
        workspace_id: &str,
    ) -> Result<(), DesktopCustodyError> {
        for digest in [
            recorded.workspace_id_digest,
            recorded.old_file_ciphertext_digest,
            recorded.old_key_digest,
            recorded.old_slot_record_digest,
            recorded.candidate_slot_record_digest,
        ] {
            if !valid_lower_hex_digest(digest) {
                return Err(DesktopCustodyError::Rejected);
            }
        }
        if workspace_id_digest(workspace_id) != recorded.workspace_id_digest
            || self.active_workspace_identity.dev != recorded.directory_dev
            || self.active_workspace_identity.ino != recorded.directory_ino
        {
            return Err(DesktopCustodyError::Rejected);
        }
        ensure_directory_file_identity(&self.active_workspace, self.active_workspace_identity)?;
        Ok(())
    }

    pub(crate) fn classify_clean(
        self,
        workspace_id: &str,
    ) -> Result<TestCleanRecovery, DesktopCustodyError> {
        self.require_test_recovery_mode()?;

        // The alias is only a recoverable key cache. Establish the complete no-journal,
        // no-slot topology before consulting it so an attacker-controlled alias cannot vote on
        // which recovery state exists.
        require_absent_workspace_entry(&self.active_workspace, "rebootstrap.journal")?;
        reject_database_sidecars(&self.active_workspace, "business.db")?;
        for slot in [RebootstrapSlot::A, RebootstrapSlot::B] {
            let slot_name = rebootstrap_slot_file_name(slot);
            require_absent_workspace_entry(&self.active_workspace, slot_name)?;
            reject_database_sidecars(&self.active_workspace, slot_name)?;
            if load_slot_native(&self.store, slot)?.is_some() {
                return Err(DesktopCustodyError::Rejected);
            }
        }
        let active_file =
            open_existing_database(&self.active_workspace)?.ok_or(DesktopCustodyError::Rejected)?;
        let active_identity = file_identity(&active_file)?;
        ensure_path_identity(&self.database_path, active_identity)?;
        let alias =
            load_active_alias_for_test(&self.store)?.ok_or(DesktopCustodyError::Rejected)?;
        let key: [u8; DATABASE_KEY_BYTES] = alias
            .as_slice()
            .try_into()
            .map_err(|_| DesktopCustodyError::Rejected)?;
        let active_key = LocalDatabaseKey::from_bytes(key);
        crate::active_workspace::business::verify_clean_start_database_read_only(
            &active_file,
            &active_key,
            workspace_id,
            1,
        )
        .map_err(|_| DesktopCustodyError::Rejected)?;
        ensure_file_identity(&active_file, active_identity)?;
        ensure_path_identity(&self.database_path, active_identity)?;
        Ok(TestCleanRecovery {
            bootstrap: self,
            active_file,
            active_identity,
            active_key,
        })
    }

    #[expect(
        clippy::too_many_lines,
        reason = "the private recovery classifier validates the complete journal and custody cross-product"
    )]
    pub(crate) fn classify_discard(
        self,
        action: &DiscardRebootstrap,
        workspace_id: &str,
    ) -> Result<TestDiscardRecovery, DesktopCustodyError> {
        self.require_test_recovery_mode()?;
        let files = self.load_discard_files(action)?;
        // The exact file/envelope topology is fixed by `load_discard_files` before it may load
        // an alias for an operation-created old slot that cleanup already removed. Proving that
        // recovered key against the retained old database keeps the alias a cache, never a vote
        // for topology or authority.
        let old = self.verify_prepared_components(
            recorded_prepared_components!(action),
            workspace_id,
            "business.db",
            &files.old_file,
            files.old_identity,
            &files.old_key,
            files.old_slot,
            files
                .old_slot_record
                .as_ref()
                .map(|record| record.as_slice()),
            files.candidate_slot,
            files
                .candidate_slot_record
                .as_ref()
                .map(|record| record.as_slice()),
        )?;
        let prepared_recorded = action
            .prepared_evidence_digest()
            .filter(|value| valid_lower_hex_digest(value))
            .ok_or(DesktopCustodyError::Rejected)?;
        let candidate_key_digest = action
            .candidate_key_digest()
            .filter(|value| valid_lower_hex_digest(value))
            .ok_or(DesktopCustodyError::Rejected)?;
        if files
            .candidate_key
            .as_ref()
            .is_some_and(|key| key_digest(key) != candidate_key_digest)
        {
            return Err(DesktopCustodyError::Rejected);
        }
        if let (Some(candidate_key), Some(candidate_record)) =
            (&files.candidate_key, &files.candidate_slot_record)
        {
            let old_record = files.old_slot_record.clone().unwrap_or_else(|| {
                rebootstrap_slot_record(
                    files.old_slot,
                    action.old_slot_origin_operation_id(),
                    action.old_slot_origin_publication_sequence(),
                    &files.old_key,
                )
            });
            let prepared = prepared_evidence_digest(
                files.operation_id,
                files.sequence,
                files.old_slot,
                files.candidate_slot,
                self.active_workspace_identity,
                &workspace_id_digest(workspace_id),
                &old,
                &files.old_key,
                candidate_key,
                &old_record,
                candidate_record,
                files.old_slot_created_by_operation,
            );
            if action.phase() != DiscardPhase::Verified && prepared_recorded != prepared {
                return Err(DesktopCustodyError::Rejected);
            }
        }
        let logical = match action.phase() {
            DiscardPhase::Prepared => {
                if files.candidate_file.is_some()
                    || action.candidate_reserved_evidence_digest().is_some()
                    || action.verified_evidence_digest().is_some()
                {
                    return Err(DesktopCustodyError::Rejected);
                }
                None
            }
            DiscardPhase::CandidateReserved => {
                let reserved_recorded = action
                    .candidate_reserved_evidence_digest()
                    .filter(|value| valid_lower_hex_digest(value))
                    .ok_or(DesktopCustodyError::Rejected)?;
                if action.verified_evidence_digest().is_some() {
                    return Err(DesktopCustodyError::Rejected);
                }
                if let (Some(candidate_file), Some(candidate_identity), Some(candidate_key)) = (
                    files.candidate_file.as_ref(),
                    files.candidate_identity,
                    files.candidate_key.as_ref(),
                ) {
                    let candidate =
                        file_custody_evidence(candidate_file, candidate_identity, candidate_key)?;
                    let reserved = candidate_reserved_evidence_digest(
                        files.operation_id,
                        files.sequence,
                        files.old_slot,
                        files.candidate_slot,
                        self.active_workspace_identity,
                        &candidate,
                        prepared_recorded,
                    );
                    if reserved_recorded != reserved {
                        return Err(DesktopCustodyError::Rejected);
                    }
                }
                None
            }
            DiscardPhase::Verified => {
                let reserved = action
                    .candidate_reserved_evidence_digest()
                    .filter(|value| valid_lower_hex_digest(value))
                    .ok_or(DesktopCustodyError::Rejected)?;
                let proof = action
                    .recovery_proof_digest()
                    .and_then(decode_lower_hex_digest)
                    .ok_or(DesktopCustodyError::Rejected)?;
                let link = action
                    .journal_link()
                    .map_err(|_| DesktopCustodyError::Rejected)?;
                let link_digest = journal_link_digest(&link)?;
                let verified_recorded = action
                    .verified_evidence_digest()
                    .filter(|value| valid_lower_hex_digest(value))
                    .ok_or(DesktopCustodyError::Rejected)?;
                if action.logical_evidence_digest().is_none()
                    || action.publication_evidence_digest().is_some()
                {
                    return Err(DesktopCustodyError::Rejected);
                }
                if let (Some(candidate_file), Some(candidate_identity), Some(candidate_key)) = (
                    files.candidate_file.as_ref(),
                    files.candidate_identity,
                    files.candidate_key.as_ref(),
                ) {
                    let candidate =
                        file_custody_evidence(candidate_file, candidate_identity, candidate_key)?;
                    let verified = verified_evidence_digest(
                        files.operation_id,
                        files.sequence,
                        files.old_slot,
                        files.candidate_slot,
                        self.active_workspace_identity,
                        &old,
                        &candidate,
                        proof,
                        link_digest,
                        prepared_recorded,
                        reserved,
                    );
                    if verified_recorded != verified {
                        return Err(DesktopCustodyError::Rejected);
                    }
                }
                Some(TestRecoveryLogicalEvidence {
                    expected_workspace_id: workspace_id.to_owned(),
                    expected_proof_digest: action
                        .recovery_proof_digest()
                        .ok_or(DesktopCustodyError::Rejected)?
                        .to_owned(),
                    expected_logical_digest: action
                        .logical_evidence_digest()
                        .ok_or(DesktopCustodyError::Rejected)?
                        .to_owned(),
                    journal_link: link,
                })
            }
        };
        if let (Some(logical), Some(candidate), Some(candidate_key)) = (
            &logical,
            files.candidate_file.as_ref(),
            files.candidate_key.as_ref(),
        ) {
            verify_recovery_logical(candidate, candidate_key, logical)?;
        }
        Ok(TestDiscardRecovery {
            bootstrap: self,
            files,
        })
    }

    #[expect(
        clippy::too_many_lines,
        reason = "the private recovery classifier keeps phase topology and proof checks in one audit surface"
    )]
    pub(crate) fn classify_recovery(
        self,
        action: &RecoveryRebootstrap,
        workspace_id: &str,
    ) -> Result<TestPublicationRecovery, DesktopCustodyError> {
        self.require_test_recovery_mode()?;
        if action.phase() == RecoveryPhase::PublishIntent
            && open_named_database_optional(
                &self.active_workspace,
                rebootstrap_slot_file_name(action.candidate_slot()),
            )?
            .is_none()
        {
            return self.classify_publish_intent_cleanup_prefix(action, workspace_id);
        }
        if action.phase() == RecoveryPhase::ReopenedVerified
            && open_named_database_optional(
                &self.active_workspace,
                rebootstrap_slot_file_name(action.candidate_slot()),
            )?
            .is_none()
        {
            return self.classify_retirement_prefix(action, workspace_id);
        }
        let mut files = self.load_recovery_files(
            action.operation_id(),
            action.publication_sequence(),
            action.old_slot(),
            action.candidate_slot(),
        )?;
        if files.old_slot_origin_operation_id != action.old_slot_origin_operation_id()
            || files.old_slot_origin_publication_sequence
                != action.old_slot_origin_publication_sequence()
            || action.candidate_slot_origin_operation_id() != files.operation_id
            || action.candidate_slot_origin_publication_sequence() != files.sequence
            || files.old_slot_created_by_operation != action.old_slot_created_by_operation()
        {
            return Err(DesktopCustodyError::Rejected);
        }
        let parked = files
            .candidate_file
            .as_ref()
            .ok_or(DesktopCustodyError::Rejected)?;
        let parked_identity = files
            .candidate_identity
            .ok_or(DesktopCustodyError::Rejected)?;
        let business = &files.old_file;
        let business_identity = files.old_identity;
        let prepared_expected = action
            .prepared_evidence_digest()
            .filter(|value| valid_lower_hex_digest(value))
            .ok_or(DesktopCustodyError::Rejected)?;
        let reserved_expected = action
            .candidate_reserved_evidence_digest()
            .filter(|value| valid_lower_hex_digest(value))
            .ok_or(DesktopCustodyError::Rejected)?;
        let verified_expected = action
            .verified_evidence_digest()
            .filter(|value| valid_lower_hex_digest(value))
            .ok_or(DesktopCustodyError::Rejected)?;
        if action.publication_evidence_digest() != Some(verified_expected)
            || action.candidate_key_digest() != Some(key_digest(&files.candidate_key).as_str())
        {
            return Err(DesktopCustodyError::Rejected);
        }
        let proof_digest_text = action
            .recovery_proof_digest()
            .filter(|value| valid_lower_hex_digest(value))
            .ok_or(DesktopCustodyError::Rejected)?;
        let proof_digest =
            decode_lower_hex_digest(proof_digest_text).ok_or(DesktopCustodyError::Rejected)?;
        let link = action
            .journal_link()
            .map_err(|_| DesktopCustodyError::Rejected)?;
        let link_digest = journal_link_digest(&link)?;

        let pre = recovery_evidence_for_topology(
            &files,
            self.active_workspace_identity,
            business,
            business_identity,
            parked,
            parked_identity,
            proof_digest,
            link_digest,
            prepared_expected,
            reserved_expected,
        )?;
        let post = recovery_evidence_for_topology(
            &files,
            self.active_workspace_identity,
            parked,
            parked_identity,
            business,
            business_identity,
            proof_digest,
            link_digest,
            prepared_expected,
            reserved_expected,
        )?;
        let pre_matches = pre.digest == verified_expected;
        let post_matches = post.digest == verified_expected;
        let topology = match (action.phase(), pre_matches, post_matches) {
            (RecoveryPhase::PublishIntent, true, false) => TestPublicationTopology::PreExchange,
            (
                RecoveryPhase::PublishIntent
                | RecoveryPhase::Published
                | RecoveryPhase::ReopenedVerified,
                false,
                true,
            ) => TestPublicationTopology::PostExchange,
            _ => return Err(DesktopCustodyError::Rejected),
        };
        let evidence = match topology {
            TestPublicationTopology::PreExchange => pre,
            TestPublicationTopology::PostExchange => post,
            TestPublicationTopology::RetirementFileUnlinked
            | TestPublicationTopology::RetirementSlotDeleted => {
                return Err(DesktopCustodyError::Rejected);
            }
        };
        let (prepared_old_file, prepared_old_identity, prepared_old_name) = match topology {
            TestPublicationTopology::PreExchange => (business, business_identity, "business.db"),
            TestPublicationTopology::PostExchange => (
                parked,
                parked_identity,
                rebootstrap_slot_file_name(files.candidate_slot),
            ),
            TestPublicationTopology::RetirementFileUnlinked
            | TestPublicationTopology::RetirementSlotDeleted => {
                return Err(DesktopCustodyError::Rejected);
            }
        };
        self.verify_prepared_components(
            recorded_prepared_components!(action),
            workspace_id,
            prepared_old_name,
            prepared_old_file,
            prepared_old_identity,
            &files.old_key,
            files.old_slot,
            Some(files.old_slot_record.as_slice()),
            files.candidate_slot,
            Some(files.candidate_slot_record.as_slice()),
        )?;
        let logical = TestRecoveryLogicalEvidence {
            expected_workspace_id: workspace_id.to_owned(),
            expected_proof_digest: proof_digest_text.to_owned(),
            expected_logical_digest: action
                .logical_evidence_digest()
                .ok_or(DesktopCustodyError::Rejected)?
                .to_owned(),
            journal_link: link,
        };
        let logical_candidate = match topology {
            TestPublicationTopology::PreExchange => parked,
            TestPublicationTopology::PostExchange => business,
            TestPublicationTopology::RetirementFileUnlinked
            | TestPublicationTopology::RetirementSlotDeleted => {
                return Err(DesktopCustodyError::Rejected);
            }
        };
        verify_recovery_logical(logical_candidate, &files.candidate_key, &logical)?;
        if topology == TestPublicationTopology::PostExchange {
            let parked_old = files
                .candidate_file
                .take()
                .ok_or(DesktopCustodyError::Rejected)?;
            let parked_old_identity = files
                .candidate_identity
                .take()
                .ok_or(DesktopCustodyError::Rejected)?;
            let active_candidate = std::mem::replace(&mut files.old_file, parked_old);
            let active_candidate_identity =
                std::mem::replace(&mut files.old_identity, parked_old_identity);
            files.candidate_file = Some(active_candidate);
            files.candidate_identity = Some(active_candidate_identity);
        }
        Ok(TestPublicationRecovery {
            bootstrap: self,
            files: Some(files),
            discard: None,
            retirement: None,
            topology,
            evidence: Some(evidence),
            logical: Some(logical),
        })
    }

    #[expect(
        clippy::too_many_lines,
        reason = "the private cleanup classifier keeps every crash-prefix custody check explicit"
    )]
    fn classify_publish_intent_cleanup_prefix(
        self,
        action: &RecoveryRebootstrap,
        workspace_id: &str,
    ) -> Result<TestPublicationRecovery, DesktopCustodyError> {
        if action.phase() != RecoveryPhase::PublishIntent
            || action.old_slot() == action.candidate_slot()
            || action.candidate_slot_origin_operation_id() != action.operation_id()
            || action.candidate_slot_origin_publication_sequence() != action.publication_sequence()
            || action.old_slot_created_by_operation()
                != (action.old_slot_origin_operation_id() == action.operation_id()
                    && action.old_slot_origin_publication_sequence()
                        == action.publication_sequence())
        {
            return Err(DesktopCustodyError::Rejected);
        }
        for digest in [
            action.prepared_evidence_digest(),
            action.candidate_reserved_evidence_digest(),
            action.verified_evidence_digest(),
            action.logical_evidence_digest(),
            action.publication_evidence_digest(),
            action.recovery_proof_digest(),
            action.candidate_key_digest(),
        ] {
            if digest.is_none_or(|value| !valid_lower_hex_digest(value)) {
                return Err(DesktopCustodyError::Rejected);
            }
        }
        if action.publication_evidence_digest() != action.verified_evidence_digest() {
            return Err(DesktopCustodyError::Rejected);
        }
        action
            .journal_link()
            .map_err(|_| DesktopCustodyError::Rejected)?;

        require_absent_workspace_entry(
            &self.active_workspace,
            rebootstrap_slot_file_name(action.old_slot()),
        )?;
        require_absent_workspace_entry(
            &self.active_workspace,
            rebootstrap_slot_file_name(action.candidate_slot()),
        )?;
        reject_database_sidecars(&self.active_workspace, "business.db")?;
        reject_database_sidecars(
            &self.active_workspace,
            rebootstrap_slot_file_name(action.old_slot()),
        )?;
        reject_database_sidecars(
            &self.active_workspace,
            rebootstrap_slot_file_name(action.candidate_slot()),
        )?;

        let old_file =
            open_existing_database(&self.active_workspace)?.ok_or(DesktopCustodyError::Rejected)?;
        let old_identity = file_identity(&old_file)?;
        ensure_path_identity(&self.database_path, old_identity)?;
        let old_slot_record = load_slot_native(&self.store, action.old_slot())?.map(Zeroizing::new);
        let candidate_slot_record =
            load_slot_native(&self.store, action.candidate_slot())?.map(Zeroizing::new);
        let old_key = match old_slot_record.as_ref() {
            Some(record) => {
                let decoded = decode_rebootstrap_slot_record(record, action.old_slot())?;
                if decoded.operation_id != action.old_slot_origin_operation_id()
                    || decoded.sequence != action.old_slot_origin_publication_sequence()
                {
                    return Err(DesktopCustodyError::Rejected);
                }
                decoded.key
            }
            None if action.old_slot_created_by_operation() && candidate_slot_record.is_none() => {
                let alias = load_active_alias_for_test(&self.store)?
                    .ok_or(DesktopCustodyError::Rejected)?;
                let bytes: [u8; DATABASE_KEY_BYTES] = alias
                    .as_slice()
                    .try_into()
                    .map_err(|_| DesktopCustodyError::Rejected)?;
                LocalDatabaseKey::from_bytes(bytes)
            }
            None => return Err(DesktopCustodyError::Rejected),
        };
        let candidate_key = match candidate_slot_record.as_ref() {
            Some(record) => {
                let decoded = decode_rebootstrap_slot_record(record, action.candidate_slot())?;
                if decoded.operation_id != action.candidate_slot_origin_operation_id()
                    || decoded.sequence != action.candidate_slot_origin_publication_sequence()
                    || action.candidate_key_digest() != Some(key_digest(&decoded.key).as_str())
                {
                    return Err(DesktopCustodyError::Rejected);
                }
                Some(decoded.key)
            }
            None => None,
        };
        let old = self.verify_prepared_components(
            recorded_prepared_components!(action),
            workspace_id,
            "business.db",
            &old_file,
            old_identity,
            &old_key,
            action.old_slot(),
            old_slot_record.as_ref().map(|record| record.as_slice()),
            action.candidate_slot(),
            candidate_slot_record
                .as_ref()
                .map(|record| record.as_slice()),
        )?;
        if let (Some(candidate_key), Some(candidate_record)) =
            (&candidate_key, &candidate_slot_record)
        {
            let old_record = old_slot_record.clone().unwrap_or_else(|| {
                rebootstrap_slot_record(
                    action.old_slot(),
                    action.old_slot_origin_operation_id(),
                    action.old_slot_origin_publication_sequence(),
                    &old_key,
                )
            });
            let prepared = prepared_evidence_digest(
                action.operation_id(),
                action.publication_sequence(),
                action.old_slot(),
                action.candidate_slot(),
                self.active_workspace_identity,
                &workspace_id_digest(workspace_id),
                &old,
                &old_key,
                candidate_key,
                &old_record,
                candidate_record,
                action.old_slot_created_by_operation(),
            );
            if action.prepared_evidence_digest() != Some(prepared.as_str()) {
                return Err(DesktopCustodyError::Rejected);
            }
        }
        ensure_file_identity(&old_file, old_identity)?;
        ensure_path_identity(&self.database_path, old_identity)?;
        Ok(TestPublicationRecovery {
            bootstrap: self,
            files: None,
            discard: Some(TestDiscardFiles {
                operation_id: action.operation_id(),
                sequence: action.publication_sequence(),
                old_slot: action.old_slot(),
                candidate_slot: action.candidate_slot(),
                old_file,
                old_identity,
                old_key,
                old_slot_record,
                candidate_file: None,
                candidate_identity: None,
                candidate_key,
                candidate_slot_record,
                old_slot_created_by_operation: action.old_slot_created_by_operation(),
            }),
            retirement: None,
            topology: TestPublicationTopology::PreExchange,
            evidence: None,
            logical: None,
        })
    }

    fn classify_retirement_prefix(
        self,
        action: &RecoveryRebootstrap,
        workspace_id: &str,
    ) -> Result<TestPublicationRecovery, DesktopCustodyError> {
        if action.old_slot() == action.candidate_slot()
            || action.candidate_slot_origin_operation_id() != action.operation_id()
            || action.candidate_slot_origin_publication_sequence() != action.publication_sequence()
            || action.old_slot_created_by_operation()
                != (action.old_slot_origin_operation_id() == action.operation_id()
                    && action.old_slot_origin_publication_sequence()
                        == action.publication_sequence())
            || action.publication_evidence_digest() != action.verified_evidence_digest()
        {
            return Err(DesktopCustodyError::Rejected);
        }
        require_absent_workspace_entry(
            &self.active_workspace,
            rebootstrap_slot_file_name(action.old_slot()),
        )?;
        reject_database_sidecars(&self.active_workspace, "business.db")?;
        reject_database_sidecars(
            &self.active_workspace,
            rebootstrap_slot_file_name(action.candidate_slot()),
        )?;
        let active_file =
            open_existing_database(&self.active_workspace)?.ok_or(DesktopCustodyError::Rejected)?;
        let active_identity = file_identity(&active_file)?;
        ensure_path_identity(&self.database_path, active_identity)?;
        let candidate_record = Zeroizing::new(
            load_slot_native(&self.store, action.candidate_slot())?
                .ok_or(DesktopCustodyError::Rejected)?,
        );
        let candidate = decode_rebootstrap_slot_record(&candidate_record, action.candidate_slot())?;
        let prepared_components = recorded_prepared_components!(action);
        self.verify_prepared_component_shape(&prepared_components, workspace_id)?;
        if candidate.operation_id != action.candidate_slot_origin_operation_id()
            || candidate.sequence != action.candidate_slot_origin_publication_sequence()
            || action.candidate_key_digest() != Some(key_digest(&candidate.key).as_str())
            || slot_record_digest(&candidate_record)
                != prepared_components.candidate_slot_record_digest
        {
            return Err(DesktopCustodyError::Rejected);
        }
        let old_slot_record = load_slot_native(&self.store, action.old_slot())?.map(Zeroizing::new);
        if let Some(record) = old_slot_record.as_ref() {
            let old = decode_rebootstrap_slot_record(record, action.old_slot())?;
            if old.operation_id != action.old_slot_origin_operation_id()
                || old.sequence != action.old_slot_origin_publication_sequence()
            {
                return Err(DesktopCustodyError::Rejected);
            }
        }
        let link = action
            .journal_link()
            .map_err(|_| DesktopCustodyError::Rejected)?;
        let proof = crate::active_workspace::business::verify_rebootstrap_recovery_read_only(
            &active_file,
            &candidate.key,
            workspace_id,
            &link,
        )
        .map_err(|_| DesktopCustodyError::Rejected)?;
        if action.recovery_proof_digest()
            != Some(lower_hex(&recovery_proof_digest(&proof)?).as_str())
        {
            return Err(DesktopCustodyError::Rejected);
        }
        let topology = if old_slot_record.is_some() {
            TestPublicationTopology::RetirementFileUnlinked
        } else {
            TestPublicationTopology::RetirementSlotDeleted
        };
        Ok(TestPublicationRecovery {
            bootstrap: self,
            files: None,
            discard: None,
            retirement: Some(TestRetirementRecoveryFiles {
                active_file,
                active_identity,
                active_key: candidate.key,
                old_slot: action.old_slot(),
                old_slot_record,
            }),
            topology,
            evidence: None,
            logical: None,
        })
    }

    #[expect(
        clippy::too_many_lines,
        reason = "the private terminal classifier binds the full terminal journal and custody proof"
    )]
    pub(crate) fn classify_terminal(
        self,
        action: &TerminalRebootstrap,
        workspace_id: &str,
    ) -> Result<TestTerminalRecovery, DesktopCustodyError> {
        self.require_test_recovery_mode()?;
        if action.old_slot() == action.candidate_slot()
            || action.candidate_slot_origin_operation_id() != action.operation_id()
            || action.candidate_slot_origin_publication_sequence() != action.publication_sequence()
            || action.old_slot_created_by_operation()
                != (action.old_slot_origin_operation_id() == action.operation_id()
                    && action.old_slot_origin_publication_sequence()
                        == action.publication_sequence())
            || action
                .prepared_evidence_digest()
                .is_none_or(|value| !valid_lower_hex_digest(value))
            || action
                .candidate_key_digest()
                .is_none_or(|value| !valid_lower_hex_digest(value))
        {
            return Err(DesktopCustodyError::Rejected);
        }
        require_absent_workspace_entry(
            &self.active_workspace,
            rebootstrap_slot_file_name(action.old_slot()),
        )?;
        require_absent_workspace_entry(
            &self.active_workspace,
            rebootstrap_slot_file_name(action.candidate_slot()),
        )?;
        reject_database_sidecars(&self.active_workspace, "business.db")?;
        reject_database_sidecars(
            &self.active_workspace,
            rebootstrap_slot_file_name(action.old_slot()),
        )?;
        reject_database_sidecars(
            &self.active_workspace,
            rebootstrap_slot_file_name(action.candidate_slot()),
        )?;
        let active_file =
            open_existing_database(&self.active_workspace)?.ok_or(DesktopCustodyError::Rejected)?;
        let active_identity = file_identity(&active_file)?;
        ensure_path_identity(&self.database_path, active_identity)?;

        let active_key = match action.phase() {
            TerminalPhase::RetiredOld => {
                if load_slot_native(&self.store, action.old_slot())?.is_some() {
                    return Err(DesktopCustodyError::Rejected);
                }
                let candidate_record = Zeroizing::new(
                    load_slot_native(&self.store, action.candidate_slot())?
                        .ok_or(DesktopCustodyError::Rejected)?,
                );
                let candidate =
                    decode_rebootstrap_slot_record(&candidate_record, action.candidate_slot())?;
                let prepared_components = recorded_prepared_components!(action);
                self.verify_prepared_component_shape(&prepared_components, workspace_id)?;
                if candidate.operation_id != action.candidate_slot_origin_operation_id()
                    || candidate.sequence != action.candidate_slot_origin_publication_sequence()
                    || action.candidate_key_digest() != Some(key_digest(&candidate.key).as_str())
                    || slot_record_digest(&candidate_record)
                        != prepared_components.candidate_slot_record_digest
                    || action
                        .candidate_reserved_evidence_digest()
                        .is_none_or(|value| !valid_lower_hex_digest(value))
                    || action
                        .verified_evidence_digest()
                        .is_none_or(|value| !valid_lower_hex_digest(value))
                    || action.publication_evidence_digest() != action.verified_evidence_digest()
                    || action
                        .logical_evidence_digest()
                        .is_none_or(|value| !valid_lower_hex_digest(value))
                    || action
                        .recovery_proof_digest()
                        .is_none_or(|value| !valid_lower_hex_digest(value))
                {
                    return Err(DesktopCustodyError::Rejected);
                }
                let before = file_custody_evidence(&active_file, active_identity, &candidate.key)?;
                let link = action
                    .active_publication_link()
                    .ok_or(DesktopCustodyError::Rejected)?;
                crate::active_workspace::business::verify_terminal_publication_database_read_only(
                    &active_file,
                    &candidate.key,
                    workspace_id,
                    1,
                    Some(link),
                )
                .map_err(|_| DesktopCustodyError::Rejected)?;
                if file_custody_evidence(&active_file, active_identity, &candidate.key)? != before
                    || load_slot_native(&self.store, action.old_slot())?.is_some()
                    || load_slot_native(&self.store, action.candidate_slot())?.as_deref()
                        != Some(candidate_record.as_slice())
                {
                    return Err(DesktopCustodyError::Rejected);
                }
                candidate.key
            }
            TerminalPhase::Cancelled => {
                if load_slot_native(&self.store, action.candidate_slot())?.is_some() {
                    return Err(DesktopCustodyError::Rejected);
                }
                let old_slot_record =
                    load_slot_native(&self.store, action.old_slot())?.map(Zeroizing::new);
                let old_key = match old_slot_record.as_ref() {
                    Some(record) if !action.old_slot_created_by_operation() => {
                        let decoded = decode_rebootstrap_slot_record(record, action.old_slot())?;
                        if decoded.operation_id != action.old_slot_origin_operation_id()
                            || decoded.sequence != action.old_slot_origin_publication_sequence()
                        {
                            return Err(DesktopCustodyError::Rejected);
                        }
                        decoded.key
                    }
                    None if action.old_slot_created_by_operation() => {
                        let alias = load_active_alias_for_test(&self.store)?
                            .ok_or(DesktopCustodyError::Rejected)?;
                        let key: [u8; DATABASE_KEY_BYTES] = alias
                            .as_slice()
                            .try_into()
                            .map_err(|_| DesktopCustodyError::Rejected)?;
                        LocalDatabaseKey::from_bytes(key)
                    }
                    Some(_) | None => return Err(DesktopCustodyError::Rejected),
                };
                self.verify_cancelled_terminal_components(
                    recorded_prepared_components!(action),
                    workspace_id,
                    action.active_publication_link(),
                    &active_file,
                    active_identity,
                    &old_key,
                    action.old_slot(),
                    old_slot_record.as_ref().map(|record| record.as_slice()),
                    action.candidate_slot(),
                )?;
                old_key
            }
        };
        let repair_alias =
            load_active_alias_for_test(&self.store)?.as_deref() != Some(active_key.custody_bytes());
        Ok(TestTerminalRecovery {
            bootstrap: self,
            active_file,
            active_identity,
            active_key,
            repair_alias,
        })
    }

    fn require_test_recovery_mode(&self) -> Result<(), DesktopCustodyError> {
        ensure_directory_file_identity(&self.active_workspace, self.active_workspace_identity)
    }

    fn load_discard_files(
        &self,
        action: &DiscardRebootstrap,
    ) -> Result<TestDiscardFiles, DesktopCustodyError> {
        let operation_id = action.operation_id();
        let sequence = action.publication_sequence();
        let old_slot = action.old_slot();
        let candidate_slot = action.candidate_slot();
        if old_slot == candidate_slot
            || action.candidate_slot_origin_operation_id() != operation_id
            || action.candidate_slot_origin_publication_sequence() != sequence
            || action.old_slot_created_by_operation()
                != (action.old_slot_origin_operation_id() == operation_id
                    && action.old_slot_origin_publication_sequence() == sequence)
        {
            return Err(DesktopCustodyError::Rejected);
        }
        require_absent_workspace_entry(
            &self.active_workspace,
            rebootstrap_slot_file_name(old_slot),
        )?;
        reject_database_sidecars(&self.active_workspace, "business.db")?;
        reject_database_sidecars(
            &self.active_workspace,
            rebootstrap_slot_file_name(candidate_slot),
        )?;
        let old_file =
            open_existing_database(&self.active_workspace)?.ok_or(DesktopCustodyError::Rejected)?;
        let old_identity = file_identity(&old_file)?;
        ensure_path_identity(&self.database_path, old_identity)?;
        let candidate_file = open_named_database_optional(
            &self.active_workspace,
            rebootstrap_slot_file_name(candidate_slot),
        )?;
        let candidate_identity = candidate_file.as_ref().map(file_identity).transpose()?;

        // Complete the file/envelope presence topology before consulting the alias. In the one
        // allowed missing-old-envelope prefix, the alias is merely a candidate credential that
        // later must match journal evidence and prove the already-selected old database.
        let old_slot_record = load_slot_native(&self.store, old_slot)?.map(Zeroizing::new);
        let candidate_slot_record =
            load_slot_native(&self.store, candidate_slot)?.map(Zeroizing::new);
        let candidate_key = match candidate_slot_record.as_ref() {
            Some(record) => {
                let decoded = decode_rebootstrap_slot_record(record, candidate_slot)?;
                if decoded.operation_id != action.candidate_slot_origin_operation_id()
                    || decoded.sequence != action.candidate_slot_origin_publication_sequence()
                    || action.candidate_key_digest() != Some(key_digest(&decoded.key).as_str())
                {
                    return Err(DesktopCustodyError::Rejected);
                }
                Some(decoded.key)
            }
            None if candidate_file.is_none() => None,
            None => return Err(DesktopCustodyError::Rejected),
        };
        let old_key = match old_slot_record.as_ref() {
            Some(record) => {
                let decoded = decode_rebootstrap_slot_record(record, old_slot)?;
                if decoded.operation_id != action.old_slot_origin_operation_id()
                    || decoded.sequence != action.old_slot_origin_publication_sequence()
                {
                    return Err(DesktopCustodyError::Rejected);
                }
                decoded.key
            }
            None if action.old_slot_created_by_operation()
                && candidate_file.is_none()
                && candidate_slot_record.is_none() =>
            {
                let alias = load_active_alias_for_test(&self.store)?
                    .ok_or(DesktopCustodyError::Rejected)?;
                let bytes: [u8; DATABASE_KEY_BYTES] = alias
                    .as_slice()
                    .try_into()
                    .map_err(|_| DesktopCustodyError::Rejected)?;
                LocalDatabaseKey::from_bytes(bytes)
            }
            None => return Err(DesktopCustodyError::Rejected),
        };
        if action.phase() == DiscardPhase::Prepared && candidate_file.is_some() {
            return Err(DesktopCustodyError::Rejected);
        }
        Ok(TestDiscardFiles {
            operation_id,
            sequence,
            old_slot,
            candidate_slot,
            old_file,
            old_identity,
            old_key,
            old_slot_record,
            candidate_file,
            candidate_identity,
            candidate_key,
            candidate_slot_record,
            old_slot_created_by_operation: action.old_slot_created_by_operation(),
        })
    }

    fn load_recovery_files(
        &self,
        operation_id: u64,
        sequence: u64,
        old_slot: RebootstrapSlot,
        candidate_slot: RebootstrapSlot,
    ) -> Result<TestRecoveryFiles, DesktopCustodyError> {
        if old_slot == candidate_slot {
            return Err(DesktopCustodyError::Rejected);
        }
        require_absent_workspace_entry(
            &self.active_workspace,
            rebootstrap_slot_file_name(old_slot),
        )?;
        reject_database_sidecars(&self.active_workspace, "business.db")?;
        reject_database_sidecars(
            &self.active_workspace,
            rebootstrap_slot_file_name(candidate_slot),
        )?;
        let old_slot_record = Zeroizing::new(
            load_slot_native(&self.store, old_slot)?.ok_or(DesktopCustodyError::Rejected)?,
        );
        let candidate_slot_record = Zeroizing::new(
            load_slot_native(&self.store, candidate_slot)?.ok_or(DesktopCustodyError::Rejected)?,
        );
        let old = decode_rebootstrap_slot_record(&old_slot_record, old_slot)?;
        let candidate = decode_rebootstrap_slot_record(&candidate_slot_record, candidate_slot)?;
        if candidate.operation_id != operation_id
            || candidate.sequence != sequence
            || old.sequence > sequence
        {
            return Err(DesktopCustodyError::Rejected);
        }
        let old_file =
            open_existing_database(&self.active_workspace)?.ok_or(DesktopCustodyError::Rejected)?;
        let old_identity = file_identity(&old_file)?;
        ensure_path_identity(&self.database_path, old_identity)?;
        let candidate_file = open_named_database_optional(
            &self.active_workspace,
            rebootstrap_slot_file_name(candidate_slot),
        )?;
        let candidate_identity = candidate_file.as_ref().map(file_identity).transpose()?;
        Ok(TestRecoveryFiles {
            operation_id,
            sequence,
            old_slot,
            candidate_slot,
            old_file,
            old_identity,
            old_key: old.key,
            old_slot_record,
            candidate_file,
            candidate_identity,
            candidate_key: candidate.key,
            candidate_slot_record,
            old_slot_origin_operation_id: old.operation_id,
            old_slot_origin_publication_sequence: old.sequence,
            old_slot_created_by_operation: old.operation_id == operation_id
                && old.sequence == sequence,
        })
    }
}

#[cfg(test)]
impl TestRebootstrapQuarantineCustody {
    pub(crate) fn state_digest(
        &self,
        store: &TestRebootstrapKeyStore,
    ) -> Result<TestRebootstrapStateDigest, DesktopCustodyError> {
        ensure_directory_file_identity(&self.active_workspace, self.active_workspace_identity)?;
        test_rebootstrap_state_digest(&self.active_workspace, store)
    }
}

#[cfg(test)]
impl TestDiscardRecovery {
    pub(crate) fn state_digest(&self) -> Result<TestRebootstrapStateDigest, DesktopCustodyError> {
        test_rebootstrap_state_digest(&self.bootstrap.active_workspace, &self.bootstrap.store)
    }

    pub(crate) fn discard(self) -> Result<DesktopProductionCustody, DesktopCustodyError> {
        self.discard_internal(None)
    }

    pub(crate) fn discard_with_crash_for_test(
        self,
        boundary: TestRebootstrapCrashBoundary,
    ) -> Result<DesktopProductionCustody, DesktopCustodyError> {
        if !matches!(
            boundary,
            TestRebootstrapCrashBoundary::AfterCancelCandidateFileUnlinkAndDirectoryFsync
                | TestRebootstrapCrashBoundary::AfterCancelCandidateSlotDeleteAndAbsentReadback
                | TestRebootstrapCrashBoundary::AfterCancelAliasRepairAndReadback
                | TestRebootstrapCrashBoundary::AfterCancelOldSlotDeleteAndAbsentReadback
        ) {
            return Err(DesktopCustodyError::Rejected);
        }
        self.discard_internal(Some(boundary))
    }

    fn discard_internal(
        self,
        boundary: Option<TestRebootstrapCrashBoundary>,
    ) -> Result<DesktopProductionCustody, DesktopCustodyError> {
        let Self { bootstrap, files } = self;
        if let (Some(file), Some(identity)) = (&files.candidate_file, files.candidate_identity) {
            ensure_file_identity(file, identity)?;
            ensure_named_identity(
                &bootstrap.active_workspace,
                rebootstrap_slot_file_name(files.candidate_slot),
                identity,
            )?;
            unlink_named_file(
                &bootstrap.active_workspace,
                rebootstrap_slot_file_name(files.candidate_slot),
            )?;
            require_absent_workspace_entry(
                &bootstrap.active_workspace,
                rebootstrap_slot_file_name(files.candidate_slot),
            )?;
        }
        if boundary
            == Some(TestRebootstrapCrashBoundary::AfterCancelCandidateFileUnlinkAndDirectoryFsync)
        {
            return Err(DesktopCustodyError::StorageRejected);
        }
        if let Some(candidate_slot_record) = files.candidate_slot_record.as_ref() {
            delete_slot_native_exact(
                &bootstrap.store,
                files.candidate_slot,
                candidate_slot_record,
            )?;
        }
        if load_slot_native(&bootstrap.store, files.candidate_slot)?.is_some() {
            return Err(DesktopCustodyError::Rejected);
        }
        if boundary
            == Some(TestRebootstrapCrashBoundary::AfterCancelCandidateSlotDeleteAndAbsentReadback)
        {
            return Err(DesktopCustodyError::StorageRejected);
        }

        // The old credential is repaired and read back while its authenticated envelope still
        // exists. Only after this fence may an operation-created old envelope be retired, leaving
        // the exact alias as the sole restart credential until the Cancelled record is durable.
        bootstrap.store_active_alias(files.old_key.custody_bytes())?;
        if load_active_alias_for_test(&bootstrap.store)?.as_deref()
            != Some(files.old_key.custody_bytes())
        {
            return Err(DesktopCustodyError::Rejected);
        }
        if boundary == Some(TestRebootstrapCrashBoundary::AfterCancelAliasRepairAndReadback) {
            return Err(DesktopCustodyError::StorageRejected);
        }
        if files.old_slot_created_by_operation {
            if let Some(old_slot_record) = files.old_slot_record.as_ref() {
                delete_slot_native_exact(&bootstrap.store, files.old_slot, old_slot_record)?;
            }
            if load_slot_native(&bootstrap.store, files.old_slot)?.is_some() {
                return Err(DesktopCustodyError::Rejected);
            }
        }
        if boundary == Some(TestRebootstrapCrashBoundary::AfterCancelOldSlotDeleteAndAbsentReadback)
        {
            if !files.old_slot_created_by_operation {
                return Err(DesktopCustodyError::Rejected);
            }
            return Err(DesktopCustodyError::StorageRejected);
        }
        bootstrap.into_active(files.old_file, files.old_identity, files.old_key)
    }
}

#[cfg(test)]
impl TestPublicationRecovery {
    pub(crate) fn state_digest(&self) -> Result<TestRebootstrapStateDigest, DesktopCustodyError> {
        test_rebootstrap_state_digest(&self.bootstrap.active_workspace, &self.bootstrap.store)
    }

    pub(crate) const fn disposition(&self) -> RecoveryDisposition {
        match self.topology {
            TestPublicationTopology::PreExchange => RecoveryDisposition::CancelUnpublishedCandidate,
            TestPublicationTopology::PostExchange
            | TestPublicationTopology::RetirementFileUnlinked
            | TestPublicationTopology::RetirementSlotDeleted => {
                RecoveryDisposition::ResumeCandidate
            }
        }
    }

    pub(crate) const fn is_retirement_prefix(&self) -> bool {
        matches!(
            self.topology,
            TestPublicationTopology::RetirementFileUnlinked
                | TestPublicationTopology::RetirementSlotDeleted
        )
    }

    pub(crate) fn cancel_unpublished(
        self,
    ) -> Result<DesktopProductionCustody, DesktopCustodyError> {
        self.cancel_unpublished_internal(None)
    }

    pub(crate) fn cancel_unpublished_with_crash_for_test(
        self,
        boundary: TestRebootstrapCrashBoundary,
    ) -> Result<DesktopProductionCustody, DesktopCustodyError> {
        self.cancel_unpublished_internal(Some(boundary))
    }

    fn cancel_unpublished_internal(
        self,
        boundary: Option<TestRebootstrapCrashBoundary>,
    ) -> Result<DesktopProductionCustody, DesktopCustodyError> {
        if self.topology != TestPublicationTopology::PreExchange {
            return Err(DesktopCustodyError::Rejected);
        }
        let Self {
            bootstrap,
            files,
            discard,
            ..
        } = self;
        let files = match (files, discard) {
            (Some(files), None) => files.into(),
            (None, Some(files)) => files,
            _ => return Err(DesktopCustodyError::Rejected),
        };
        TestDiscardRecovery { bootstrap, files }.discard_internal(boundary)
    }

    pub(crate) fn verify_post_exchange(
        self,
    ) -> Result<TestVerifiedPublicationRecovery, DesktopCustodyError> {
        if self.topology != TestPublicationTopology::PostExchange {
            return Err(DesktopCustodyError::Rejected);
        }
        let before = self.state_digest()?;
        let files = self.files.as_ref().ok_or(DesktopCustodyError::Rejected)?;
        let evidence = self
            .evidence
            .as_ref()
            .ok_or(DesktopCustodyError::Rejected)?;
        let logical = self.logical.as_ref().ok_or(DesktopCustodyError::Rejected)?;
        let candidate_file = files
            .candidate_file
            .as_ref()
            .ok_or(DesktopCustodyError::Rejected)?;
        let candidate_identity = files
            .candidate_identity
            .ok_or(DesktopCustodyError::Rejected)?;
        ensure_directory_file_identity(
            &self.bootstrap.active_workspace,
            self.bootstrap.active_workspace_identity,
        )?;
        if file_custody_evidence(candidate_file, candidate_identity, &files.candidate_key)?
            != evidence.candidate
            || file_custody_evidence(&files.old_file, files.old_identity, &files.old_key)?
                != evidence.old
        {
            return Err(DesktopCustodyError::Rejected);
        }
        ensure_path_identity(&self.bootstrap.database_path, candidate_identity)?;
        ensure_named_identity(
            &self.bootstrap.active_workspace,
            rebootstrap_slot_file_name(files.candidate_slot),
            files.old_identity,
        )?;
        require_absent_workspace_entry(
            &self.bootstrap.active_workspace,
            rebootstrap_slot_file_name(files.old_slot),
        )?;
        reject_database_sidecars(&self.bootstrap.active_workspace, "business.db")?;
        reject_database_sidecars(
            &self.bootstrap.active_workspace,
            rebootstrap_slot_file_name(files.candidate_slot),
        )?;
        if load_slot_native(&self.bootstrap.store, files.old_slot)?.as_deref()
            != Some(files.old_slot_record.as_slice())
            || load_slot_native(&self.bootstrap.store, files.candidate_slot)?.as_deref()
                != Some(files.candidate_slot_record.as_slice())
        {
            return Err(DesktopCustodyError::Rejected);
        }
        // This is the restart proof fence. It deliberately does not read or repair the active
        // alias; post-EXCHANGE crash prefixes may retain either the old or candidate cache value.
        verify_recovery_logical(candidate_file, &files.candidate_key, logical)?;
        if self.state_digest()? != before {
            return Err(DesktopCustodyError::Rejected);
        }
        Ok(TestVerifiedPublicationRecovery(self))
    }

    pub(crate) fn resume_retirement_prefix(
        self,
    ) -> Result<DesktopProductionCustody, DesktopCustodyError> {
        if !self.is_retirement_prefix() {
            return Err(DesktopCustodyError::Rejected);
        }
        let Self {
            bootstrap,
            files: _,
            discard: _,
            retirement,
            topology: _,
            evidence: _,
            logical: _,
        } = self;
        let retirement = retirement.ok_or(DesktopCustodyError::Rejected)?;
        if let Some(old_slot_record) = retirement.old_slot_record.as_ref() {
            delete_slot_native_exact(&bootstrap.store, retirement.old_slot, old_slot_record)?;
        } else if load_slot_native(&bootstrap.store, retirement.old_slot)?.is_some() {
            return Err(DesktopCustodyError::Rejected);
        }
        bootstrap.store_active_alias(retirement.active_key.custody_bytes())?;
        bootstrap.into_active(
            retirement.active_file,
            retirement.active_identity,
            retirement.active_key,
        )
    }
}

#[cfg(test)]
impl TestVerifiedPublicationRecovery {
    pub(crate) fn state_digest(&self) -> Result<TestRebootstrapStateDigest, DesktopCustodyError> {
        self.0.state_digest()
    }

    pub(crate) fn admit(
        self,
    ) -> Result<(DesktopProductionCustody, PublishedRebootstrap), DesktopCustodyError> {
        let TestPublicationRecovery {
            bootstrap,
            files,
            discard: _,
            retirement: _,
            topology,
            evidence,
            logical,
        } = self.0;
        if topology != TestPublicationTopology::PostExchange || logical.is_none() {
            return Err(DesktopCustodyError::Rejected);
        }
        let mut files = files.ok_or(DesktopCustodyError::Rejected)?;
        let evidence = evidence.ok_or(DesktopCustodyError::Rejected)?;
        let candidate_file = files
            .candidate_file
            .take()
            .ok_or(DesktopCustodyError::Rejected)?;
        let candidate_identity = files
            .candidate_identity
            .take()
            .ok_or(DesktopCustodyError::Rejected)?;
        ensure_path_identity(&bootstrap.database_path, candidate_identity)?;
        ensure_named_identity(
            &bootstrap.active_workspace,
            rebootstrap_slot_file_name(files.candidate_slot),
            files.old_identity,
        )?;
        bootstrap.store_active_alias(files.candidate_key.custody_bytes())?;
        let new_file = candidate_file
            .try_clone()
            .map_err(|_| DesktopCustodyError::StorageRejected)?;
        let publication = PublishedRebootstrap {
            operation_id: files.operation_id,
            sequence: files.sequence,
            old_slot: files.old_slot,
            candidate_slot: files.candidate_slot,
            new_file,
            new_identity: candidate_identity,
            old_file: files.old_file,
            old_identity: files.old_identity,
            old_key: files.old_key,
            old_slot_record: files.old_slot_record,
            candidate_slot_record: files.candidate_slot_record,
            evidence,
        };
        let custody =
            bootstrap.into_active(candidate_file, candidate_identity, files.candidate_key)?;
        Ok((custody, publication))
    }
}

#[cfg(test)]
impl TestTerminalRecovery {
    pub(crate) fn state_digest(&self) -> Result<TestRebootstrapStateDigest, DesktopCustodyError> {
        test_rebootstrap_state_digest(&self.bootstrap.active_workspace, &self.bootstrap.store)
    }

    pub(crate) fn admit(self) -> Result<DesktopProductionCustody, DesktopCustodyError> {
        let Self {
            bootstrap,
            active_file,
            active_identity,
            active_key,
            repair_alias,
        } = self;
        if repair_alias {
            bootstrap.store_active_alias(active_key.custody_bytes())?;
            if load_active_alias_for_test(&bootstrap.store)?.as_deref()
                != Some(active_key.custody_bytes())
            {
                return Err(DesktopCustodyError::Rejected);
            }
        }
        bootstrap.into_active(active_file, active_identity, active_key)
    }
}

#[cfg(test)]
impl TestCleanRecovery {
    pub(crate) fn state_digest(&self) -> Result<TestRebootstrapStateDigest, DesktopCustodyError> {
        test_rebootstrap_state_digest(&self.bootstrap.active_workspace, &self.bootstrap.store)
    }

    pub(crate) fn admit(self) -> Result<DesktopProductionCustody, DesktopCustodyError> {
        let Self {
            bootstrap,
            active_file,
            active_identity,
            active_key,
        } = self;
        bootstrap.into_active(active_file, active_identity, active_key)
    }
}

#[cfg(test)]
impl TestRebootstrapRecoveryCustody {
    fn into_active(
        self,
        file: File,
        identity: FileIdentity,
        key: LocalDatabaseKey,
    ) -> Result<DesktopProductionCustody, DesktopCustodyError> {
        ensure_file_identity(&file, identity)?;
        ensure_path_identity(&self.database_path, identity)?;
        Ok(DesktopProductionCustody {
            _process_lock: self.process_lock,
            _active_workspace: self.active_workspace,
            active_workspace_identity: self.active_workspace_identity,
            active_database: Mutex::new(ActiveDatabaseCustody {
                file,
                identity,
                key,
            }),
            database_path: self.database_path,
            rebootstrap_capability: RebootstrapCapability::TestCreateOnly,
            rebootstrap_test_store: self.store,
        })
    }
}

impl DesktopContinuityReceiptStore {
    #[cfg(test)]
    fn for_test(path: &Path) -> Result<Self, DesktopCustodyError> {
        std::fs::create_dir(path).map_err(|_| DesktopCustodyError::StorageRejected)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))
                .map_err(|_| DesktopCustodyError::StorageRejected)?;
        }
        let directory = File::open(path).map_err(|_| DesktopCustodyError::StorageRejected)?;
        let directory_identity = directory_file_identity(&directory)?;
        Ok(Self {
            directory: Arc::new(directory),
            directory_identity,
        })
    }

    fn slot_name(slot: u8) -> Result<&'static str, DesktopCustodyError> {
        match slot {
            0 => Ok("receipt-a.bin"),
            1 => Ok("receipt-b.bin"),
            _ => Err(DesktopCustodyError::Rejected),
        }
    }

    pub(crate) fn load(&self, slot: u8) -> Result<Option<Zeroizing<Vec<u8>>>, DesktopCustodyError> {
        let name = Self::slot_name(slot)?;
        ensure_directory_file_identity(&self.directory, self.directory_identity)?;
        let descriptor = match rustix::fs::openat(
            &self.directory,
            name,
            rustix::fs::OFlags::RDONLY | rustix::fs::OFlags::NOFOLLOW | rustix::fs::OFlags::CLOEXEC,
            rustix::fs::Mode::empty(),
        ) {
            Ok(fd) => fd,
            Err(rustix::io::Errno::NOENT) => return Ok(None),
            Err(_) => return Err(DesktopCustodyError::Rejected),
        };
        let file = File::from(descriptor);
        validate_file_metadata(
            &file
                .metadata()
                .map_err(|_| DesktopCustodyError::StorageRejected)?,
        )?;
        ensure_named_file_identity(&self.directory, name, &file)?;
        let mut bytes = Vec::new();
        Read::by_ref(&mut &file)
            .take((MAX_CONTINUITY_RECEIPT_BYTES + 1) as u64)
            .read_to_end(&mut bytes)
            .map_err(|_| DesktopCustodyError::StorageRejected)?;
        if bytes.is_empty() || bytes.len() > MAX_CONTINUITY_RECEIPT_BYTES {
            return Err(DesktopCustodyError::Rejected);
        }
        ensure_named_file_identity(&self.directory, name, &file)?;
        Ok(Some(Zeroizing::new(bytes)))
    }

    pub(crate) fn store(&self, slot: u8, sealed: &[u8]) -> Result<(), DesktopCustodyError> {
        let name = Self::slot_name(slot)?;
        if sealed.is_empty() || sealed.len() > MAX_CONTINUITY_RECEIPT_BYTES {
            return Err(DesktopCustodyError::Rejected);
        }
        ensure_directory_file_identity(&self.directory, self.directory_identity)?;
        match rustix::fs::statat(&self.directory, name, rustix::fs::AtFlags::SYMLINK_NOFOLLOW) {
            Ok(metadata) => {
                #[cfg(unix)]
                if !rustix::fs::FileType::from_raw_mode(metadata.st_mode as _).is_file()
                    || metadata.st_nlink != 1
                    || metadata.st_uid != rustix::process::geteuid().as_raw()
                    || metadata.st_mode & 0o077 != 0
                {
                    return Err(DesktopCustodyError::Rejected);
                }
            }
            Err(rustix::io::Errno::NOENT) => {}
            Err(_) => return Err(DesktopCustodyError::StorageRejected),
        }
        let tmp = format!(".{name}.tmp-{}", std::process::id());
        let descriptor = rustix::fs::openat(
            &self.directory,
            tmp.as_str(),
            rustix::fs::OFlags::RDWR
                | rustix::fs::OFlags::CREATE
                | rustix::fs::OFlags::EXCL
                | rustix::fs::OFlags::NOFOLLOW
                | rustix::fs::OFlags::CLOEXEC,
            rustix::fs::Mode::RUSR | rustix::fs::Mode::WUSR,
        )
        .map_err(|_| DesktopCustodyError::StorageRejected)?;
        let mut file = File::from(descriptor);
        file.write_all(sealed)
            .map_err(|_| DesktopCustodyError::StorageRejected)?;
        file.sync_all()
            .map_err(|_| DesktopCustodyError::StorageRejected)?;
        rustix::fs::renameat(&self.directory, tmp.as_str(), &self.directory, name)
            .map_err(|_| DesktopCustodyError::StorageRejected)?;
        self.directory
            .sync_all()
            .map_err(|_| DesktopCustodyError::StorageRejected)?;
        let readback = self
            .load(slot)?
            .ok_or(DesktopCustodyError::StorageRejected)?;
        if readback.as_slice() != sealed {
            return Err(DesktopCustodyError::StorageRejected);
        }
        Ok(())
    }

    pub(crate) fn any_receipt(&self) -> Result<bool, DesktopCustodyError> {
        Ok(self.load(0)?.is_some() || self.load(1)?.is_some())
    }
}

#[cfg(test)]
fn create_named_database(directory: &File, name: &str) -> Result<File, DesktopCustodyError> {
    let descriptor = rustix::fs::openat(
        directory,
        name,
        rustix::fs::OFlags::RDWR
            | rustix::fs::OFlags::CREATE
            | rustix::fs::OFlags::EXCL
            | rustix::fs::OFlags::NOFOLLOW
            | rustix::fs::OFlags::CLOEXEC,
        rustix::fs::Mode::RUSR | rustix::fs::Mode::WUSR,
    )
    .map_err(|_| DesktopCustodyError::StorageRejected)?;
    let file = File::from(descriptor);
    validate_file_metadata(
        &file
            .metadata()
            .map_err(|_| DesktopCustodyError::StorageRejected)?,
    )?;
    Ok(file)
}

#[cfg(test)]
fn open_named_database_optional(
    directory: &File,
    name: &str,
) -> Result<Option<File>, DesktopCustodyError> {
    let descriptor = match rustix::fs::openat(
        directory,
        name,
        rustix::fs::OFlags::RDWR | rustix::fs::OFlags::NOFOLLOW | rustix::fs::OFlags::CLOEXEC,
        rustix::fs::Mode::empty(),
    ) {
        Ok(descriptor) => descriptor,
        Err(rustix::io::Errno::NOENT) => return Ok(None),
        Err(_) => return Err(DesktopCustodyError::Rejected),
    };
    let file = File::from(descriptor);
    validate_file_metadata(
        &file
            .metadata()
            .map_err(|_| DesktopCustodyError::StorageRejected)?,
    )?;
    Ok(Some(file))
}

fn reject_database_sidecars(
    directory: &File,
    database_name: &str,
) -> Result<(), DesktopCustodyError> {
    for suffix in ["-wal", "-shm", "-journal"] {
        let name = format!("{database_name}{suffix}");
        match rustix::fs::statat(
            directory,
            name.as_str(),
            rustix::fs::AtFlags::SYMLINK_NOFOLLOW,
        ) {
            Err(rustix::io::Errno::NOENT) => {}
            Ok(_) => return Err(DesktopCustodyError::Rejected),
            Err(_) => return Err(DesktopCustodyError::StorageRejected),
        }
    }
    Ok(())
}

fn assert_rebootstrap_files_pristine(directory: &File) -> Result<(), DesktopCustodyError> {
    require_absent_workspace_entry(directory, "rebootstrap.journal")?;
    for database_name in REBOOTSTRAP_DATABASE_NAMES {
        require_absent_workspace_entry(directory, database_name)?;
        reject_database_sidecars(directory, database_name)?;
    }
    Ok(())
}

#[cfg(test)]
fn add_named_entry_snapshot(
    digest: &mut Sha256,
    directory: &File,
    name: &str,
) -> Result<(), DesktopCustodyError> {
    add_len_prefixed(digest, name.as_bytes())?;
    let descriptor = match rustix::fs::openat(
        directory,
        name,
        rustix::fs::OFlags::RDONLY | rustix::fs::OFlags::NOFOLLOW | rustix::fs::OFlags::CLOEXEC,
        rustix::fs::Mode::empty(),
    ) {
        Ok(descriptor) => descriptor,
        Err(rustix::io::Errno::NOENT) => {
            digest.update([0]);
            return Ok(());
        }
        Err(_) => return Err(DesktopCustodyError::Rejected),
    };
    let mut file = File::from(descriptor);
    let metadata = file
        .metadata()
        .map_err(|_| DesktopCustodyError::StorageRejected)?;
    validate_file_metadata(&metadata)?;
    let identity = metadata_identity(&metadata)?;
    digest.update([1]);
    digest.update(identity.dev.to_be_bytes());
    digest.update(identity.ino.to_be_bytes());
    digest.update(metadata.len().to_be_bytes());
    let mut content = Sha256::new();
    let mut buffer = vec![0_u8; 64 * 1024];
    loop {
        let count = file
            .read(&mut buffer)
            .map_err(|_| DesktopCustodyError::StorageRejected)?;
        if count == 0 {
            break;
        }
        content.update(&buffer[..count]);
    }
    digest.update(content.finalize());
    Ok(())
}

#[cfg(test)]
fn test_rebootstrap_state_digest(
    directory: &File,
    store: &TestRebootstrapKeyStore,
) -> Result<TestRebootstrapStateDigest, DesktopCustodyError> {
    ensure_directory_file_identity(directory, directory_file_identity(directory)?)?;
    let mut digest = Sha256::new();
    digest.update(b"GOODDEALER/REBOOTSTRAP-OPAQUE-STATE-V1\0");
    for name in [
        "rebootstrap.journal",
        "rebootstrap-a.db",
        "rebootstrap-a.db-wal",
        "rebootstrap-a.db-shm",
        "rebootstrap-a.db-journal",
        "rebootstrap-b.db",
        "rebootstrap-b.db-wal",
        "rebootstrap-b.db-shm",
        "rebootstrap-b.db-journal",
        "business.db",
        "business.db-wal",
        "business.db-shm",
        "business.db-journal",
    ] {
        add_untrusted_named_entry_snapshot(&mut digest, directory, name)?;
    }
    for slot in [RebootstrapSlot::A, RebootstrapSlot::B] {
        digest.update([slot_byte(slot)]);
        match load_slot_native(store, slot)? {
            Some(record) => {
                digest.update([1]);
                digest.update((record.len() as u64).to_be_bytes());
                digest.update(Sha256::digest(record));
            }
            None => digest.update([0]),
        }
    }
    match load_active_alias_for_test(store)? {
        Some(alias) => {
            digest.update([1]);
            digest.update((alias.len() as u64).to_be_bytes());
            digest.update(Sha256::digest(alias));
        }
        None => digest.update([0]),
    }
    Ok(TestRebootstrapStateDigest(digest.finalize().into()))
}

#[cfg(test)]
fn add_untrusted_named_entry_snapshot(
    digest: &mut Sha256,
    directory: &File,
    name: &str,
) -> Result<(), DesktopCustodyError> {
    add_len_prefixed(digest, name.as_bytes())?;
    let metadata = match rustix::fs::statat(directory, name, rustix::fs::AtFlags::SYMLINK_NOFOLLOW)
    {
        Ok(metadata) => metadata,
        Err(rustix::io::Errno::NOENT) => {
            digest.update([0]);
            return Ok(());
        }
        Err(_) => return Err(DesktopCustodyError::StorageRejected),
    };
    digest.update([1]);
    digest.update(u64::from(metadata.st_mode).to_be_bytes());
    #[cfg(target_os = "linux")]
    digest.update(metadata.st_dev.to_be_bytes());
    #[cfg(target_os = "macos")]
    digest.update(
        u64::try_from(metadata.st_dev)
            .map_err(|_| DesktopCustodyError::Rejected)?
            .to_be_bytes(),
    );
    digest.update(metadata.st_ino.to_be_bytes());
    digest.update(metadata.st_nlink.to_be_bytes());
    digest.update(u64::from(metadata.st_uid).to_be_bytes());
    digest.update((metadata.st_size as i64).to_be_bytes());
    #[cfg(unix)]
    if rustix::fs::FileType::from_raw_mode(metadata.st_mode as _).is_file() {
        let descriptor = rustix::fs::openat(
            directory,
            name,
            rustix::fs::OFlags::RDONLY | rustix::fs::OFlags::NOFOLLOW | rustix::fs::OFlags::CLOEXEC,
            rustix::fs::Mode::empty(),
        )
        .map_err(|_| DesktopCustodyError::StorageRejected)?;
        let mut file = File::from(descriptor);
        let mut content = Sha256::new();
        let mut buffer = vec![0_u8; 64 * 1024];
        loop {
            let count = file
                .read(&mut buffer)
                .map_err(|_| DesktopCustodyError::StorageRejected)?;
            if count == 0 {
                break;
            }
            content.update(&buffer[..count]);
        }
        digest.update(content.finalize());
    }
    Ok(())
}

#[cfg(test)]
fn candidate_custody_evidence(
    candidate: &RebootstrapCandidate,
) -> Result<FileCustodyEvidence, DesktopCustodyError> {
    file_custody_evidence(&candidate.file, candidate.identity, &candidate.key)
}

#[cfg(test)]
#[expect(
    clippy::too_many_arguments,
    reason = "recovery evidence is intentionally bound to every admitted custody fact"
)]
fn recovery_evidence_for_topology(
    files: &TestRecoveryFiles,
    directory_identity: FileIdentity,
    old_file: &File,
    old_identity: FileIdentity,
    candidate_file: &File,
    candidate_identity: FileIdentity,
    proof_digest: [u8; 32],
    link_digest: [u8; 32],
    prepared_expected: &str,
    reserved_expected: &str,
) -> Result<VerifiedCustodyEvidence, DesktopCustodyError> {
    let old = file_custody_evidence(old_file, old_identity, &files.old_key)?;
    let candidate =
        file_custody_evidence(candidate_file, candidate_identity, &files.candidate_key)?;
    if !valid_lower_hex_digest(prepared_expected) {
        return Err(DesktopCustodyError::Rejected);
    }
    let digest = verified_evidence_digest(
        files.operation_id,
        files.sequence,
        files.old_slot,
        files.candidate_slot,
        directory_identity,
        &old,
        &candidate,
        proof_digest,
        link_digest,
        prepared_expected,
        reserved_expected,
    );
    Ok(VerifiedCustodyEvidence {
        operation_id: files.operation_id,
        sequence: files.sequence,
        old_slot: files.old_slot,
        candidate_slot: files.candidate_slot,
        proof_digest,
        journal_link_digest: link_digest,
        directory_identity,
        old,
        candidate,
        digest,
    })
}

#[cfg(test)]
fn verify_recovery_logical(
    file: &File,
    key: &LocalDatabaseKey,
    expected: &TestRecoveryLogicalEvidence,
) -> Result<(), DesktopCustodyError> {
    let proof = crate::active_workspace::business::verify_rebootstrap_recovery_read_only(
        file,
        key,
        &expected.expected_workspace_id,
        &expected.journal_link,
    )
    .map_err(|_| DesktopCustodyError::Rejected)?;
    if recovery_proof_digest(&proof)?
        != decode_lower_hex_digest(&expected.expected_proof_digest)
            .ok_or(DesktopCustodyError::Rejected)?
        || proof.row_digest != expected.expected_logical_digest
    {
        return Err(DesktopCustodyError::Rejected);
    }
    Ok(())
}

#[cfg(test)]
fn file_custody_evidence(
    file: &File,
    identity: FileIdentity,
    key: &LocalDatabaseKey,
) -> Result<FileCustodyEvidence, DesktopCustodyError> {
    ensure_file_identity(file, identity)?;
    let metadata = file
        .metadata()
        .map_err(|_| DesktopCustodyError::StorageRejected)?;
    if metadata.len() == 0 {
        return Err(DesktopCustodyError::Rejected);
    }
    let mut reader = file
        .try_clone()
        .map_err(|_| DesktopCustodyError::StorageRejected)?;
    reader
        .seek(std::io::SeekFrom::Start(0))
        .map_err(|_| DesktopCustodyError::StorageRejected)?;
    let mut ciphertext = Sha256::new();
    let mut buffer = vec![0_u8; 64 * 1024];
    loop {
        let count = reader
            .read(&mut buffer)
            .map_err(|_| DesktopCustodyError::StorageRejected)?;
        if count == 0 {
            break;
        }
        ciphertext.update(&buffer[..count]);
    }
    let ciphertext_digest = ciphertext.finalize();
    Ok(FileCustodyEvidence {
        identity,
        size: metadata.len(),
        ciphertext_digest: lower_hex(ciphertext_digest.as_slice()),
        key_digest: key_digest(key),
    })
}

#[cfg(test)]
fn add_file_evidence(digest: &mut Sha256, evidence: &FileCustodyEvidence) {
    digest.update(evidence.identity.dev.to_be_bytes());
    digest.update(evidence.identity.ino.to_be_bytes());
    digest.update(evidence.size.to_be_bytes());
    digest.update(evidence.ciphertext_digest.as_bytes());
    digest.update(evidence.key_digest.as_bytes());
}

#[cfg(test)]
#[expect(
    clippy::too_many_arguments,
    reason = "the digest transcript intentionally enumerates every prepared custody fact"
)]
fn prepared_evidence_digest(
    operation_id: u64,
    sequence: u64,
    old_slot: RebootstrapSlot,
    candidate_slot: RebootstrapSlot,
    directory_identity: FileIdentity,
    workspace_id_digest: &str,
    old: &FileCustodyEvidence,
    old_key: &LocalDatabaseKey,
    candidate_key: &LocalDatabaseKey,
    old_slot_record: &[u8],
    candidate_slot_record: &[u8],
    old_slot_created: bool,
) -> String {
    let mut digest = Sha256::new();
    digest.update(b"GOODDEALER/REBOOTSTRAP-PREPARED-EVIDENCE-V3\0");
    digest.update(operation_id.to_be_bytes());
    digest.update(sequence.to_be_bytes());
    digest.update([slot_byte(old_slot), slot_byte(candidate_slot)]);
    digest.update(directory_identity.dev.to_be_bytes());
    digest.update(directory_identity.ino.to_be_bytes());
    digest.update(workspace_id_digest.as_bytes());
    add_file_evidence(&mut digest, old);
    digest.update(key_digest(old_key).as_bytes());
    digest.update(key_digest(candidate_key).as_bytes());
    digest.update(Sha256::digest(old_slot_record));
    digest.update(Sha256::digest(candidate_slot_record));
    digest.update([u8::from(old_slot_created)]);
    lower_hex(digest.finalize().as_slice())
}

#[cfg(test)]
fn candidate_reserved_evidence_digest(
    operation_id: u64,
    sequence: u64,
    old_slot: RebootstrapSlot,
    candidate_slot: RebootstrapSlot,
    directory_identity: FileIdentity,
    candidate: &FileCustodyEvidence,
    prepared_digest: &str,
) -> String {
    let mut digest = Sha256::new();
    digest.update(b"GOODDEALER/REBOOTSTRAP-CANDIDATE-RESERVED-EVIDENCE-V3\0");
    digest.update(operation_id.to_be_bytes());
    digest.update(sequence.to_be_bytes());
    digest.update([slot_byte(old_slot), slot_byte(candidate_slot)]);
    digest.update(directory_identity.dev.to_be_bytes());
    digest.update(directory_identity.ino.to_be_bytes());
    digest.update(prepared_digest.as_bytes());
    add_file_evidence(&mut digest, candidate);
    lower_hex(digest.finalize().as_slice())
}

#[cfg(test)]
#[expect(
    clippy::too_many_arguments,
    reason = "the digest transcript intentionally enumerates every verified custody fact"
)]
fn verified_evidence_digest(
    operation_id: u64,
    sequence: u64,
    old_slot: RebootstrapSlot,
    candidate_slot: RebootstrapSlot,
    directory_identity: FileIdentity,
    old: &FileCustodyEvidence,
    candidate: &FileCustodyEvidence,
    proof_digest: [u8; 32],
    journal_link_digest: [u8; 32],
    prepared_digest: &str,
    candidate_reserved_digest: &str,
) -> String {
    let mut digest = Sha256::new();
    digest.update(b"GOODDEALER/REBOOTSTRAP-VERIFIED-CUSTODY-EVIDENCE-V3\0");
    digest.update(operation_id.to_be_bytes());
    digest.update(sequence.to_be_bytes());
    digest.update([slot_byte(old_slot), slot_byte(candidate_slot)]);
    digest.update(directory_identity.dev.to_be_bytes());
    digest.update(directory_identity.ino.to_be_bytes());
    digest.update(prepared_digest.as_bytes());
    digest.update(candidate_reserved_digest.as_bytes());
    add_file_evidence(&mut digest, old);
    add_file_evidence(&mut digest, candidate);
    digest.update(proof_digest);
    digest.update(journal_link_digest);
    lower_hex(digest.finalize().as_slice())
}

#[cfg(test)]
fn add_journal_link(
    digest: &mut Sha256,
    link: &crate::RebootstrapJournalLink,
) -> Result<(), DesktopCustodyError> {
    digest.update(b"GOODDEALER/REBOOTSTRAP-JOURNAL-LINK-V1\0");
    add_len_prefixed(digest, link.journal_id.as_bytes())?;
    digest.update([match link.slot_id {
        crate::RebootstrapSlotId::A => 0,
        crate::RebootstrapSlotId::B => 1,
    }]);
    digest.update(link.publication_sequence.to_be_bytes());
    add_len_prefixed(digest, link.manifest_digest.as_bytes())?;
    add_len_prefixed(digest, link.authority_digest.as_bytes())?;
    add_len_prefixed(digest, link.floor_digest.as_bytes())?;
    add_len_prefixed(digest, link.binding_digest.as_bytes())?;
    Ok(())
}

#[cfg(test)]
fn recovery_proof_digest(
    proof: &crate::DatabaseRecoveryProof,
) -> Result<[u8; 32], DesktopCustodyError> {
    let wire = serde_json::to_vec(proof).map_err(|_| DesktopCustodyError::Rejected)?;
    Ok(Sha256::digest(wire).into())
}

#[cfg(test)]
fn journal_link_digest(
    link: &crate::RebootstrapJournalLink,
) -> Result<[u8; 32], DesktopCustodyError> {
    let mut digest = Sha256::new();
    add_journal_link(&mut digest, link)?;
    Ok(digest.finalize().into())
}

#[cfg(test)]
fn add_len_prefixed(digest: &mut Sha256, value: &[u8]) -> Result<(), DesktopCustodyError> {
    let length = u64::try_from(value.len()).map_err(|_| DesktopCustodyError::Rejected)?;
    digest.update(length.to_be_bytes());
    digest.update(value);
    Ok(())
}

#[cfg(test)]
fn slot_byte(slot: RebootstrapSlot) -> u8 {
    match slot {
        RebootstrapSlot::A => 0,
        RebootstrapSlot::B => 1,
    }
}

#[cfg(test)]
fn key_digest(key: &LocalDatabaseKey) -> String {
    let mut digest = Sha256::new();
    digest.update(b"GOODDEALER/REBOOTSTRAP-SLOT-KEY-V1\0");
    digest.update(key.custody_bytes());
    lower_hex(digest.finalize().as_slice())
}

#[cfg(test)]
fn workspace_id_digest(workspace_id: &str) -> String {
    let mut digest = Sha256::new();
    digest.update(b"GOODDEALER/REBOOTSTRAP-WORKSPACE-ID-V1\0");
    digest.update(workspace_id.as_bytes());
    lower_hex(digest.finalize().as_slice())
}

#[cfg(test)]
fn lower_hex(bytes: &[u8]) -> String {
    bytes.iter().fold(
        String::with_capacity(bytes.len() * 2),
        |mut output, byte| {
            use std::fmt::Write as _;
            write!(output, "{byte:02x}").expect("writing into a String cannot fail");
            output
        },
    )
}

#[cfg(test)]
fn valid_lower_hex_digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

#[cfg(test)]
fn decode_lower_hex_digest(value: &str) -> Option<[u8; 32]> {
    if !valid_lower_hex_digest(value) {
        return None;
    }
    let mut output = [0_u8; 32];
    for (index, pair) in value.as_bytes().chunks_exact(2).enumerate() {
        let high = u8::try_from((pair[0] as char).to_digit(16)?).ok()?;
        let low = u8::try_from((pair[1] as char).to_digit(16)?).ok()?;
        output[index] = (high << 4) | low;
    }
    Some(output)
}

fn require_absent_workspace_entry(directory: &File, name: &str) -> Result<(), DesktopCustodyError> {
    match rustix::fs::statat(directory, name, rustix::fs::AtFlags::SYMLINK_NOFOLLOW) {
        Err(rustix::io::Errno::NOENT) => Ok(()),
        Ok(_) => Err(DesktopCustodyError::Rejected),
        Err(_) => Err(DesktopCustodyError::StorageRejected),
    }
}

#[cfg(test)]
fn ensure_named_identity(
    directory: &File,
    name: &str,
    expected: FileIdentity,
) -> Result<(), DesktopCustodyError> {
    let metadata = rustix::fs::statat(directory, name, rustix::fs::AtFlags::SYMLINK_NOFOLLOW)
        .map_err(|_| DesktopCustodyError::StorageRejected)?;
    #[cfg(unix)]
    #[cfg(target_os = "linux")]
    let actual_dev = metadata.st_dev;
    #[cfg(target_os = "macos")]
    let actual_dev = u64::try_from(metadata.st_dev).map_err(|_| DesktopCustodyError::Rejected)?;
    if !rustix::fs::FileType::from_raw_mode(metadata.st_mode as _).is_file()
        || actual_dev != expected.dev
        || metadata.st_ino as u64 != expected.ino
        || metadata.st_nlink != 1
        || metadata.st_uid != rustix::process::geteuid().as_raw()
        || metadata.st_mode & 0o077 != 0
    {
        return Err(DesktopCustodyError::Rejected);
    }
    Ok(())
}

#[cfg(test)]
fn unlink_named_file(directory: &File, name: &str) -> Result<(), DesktopCustodyError> {
    rustix::fs::unlinkat(directory, name, rustix::fs::AtFlags::empty())
        .map_err(|_| DesktopCustodyError::StorageRejected)?;
    directory
        .sync_all()
        .map_err(|_| DesktopCustodyError::StorageRejected)
}

#[cfg(any(
    target_os = "linux",
    target_os = "android",
    target_os = "macos",
    target_os = "ios"
))]
#[cfg(test)]
fn exchange_workspace_files(
    directory: &File,
    left: &str,
    right: &str,
) -> Result<(), DesktopCustodyError> {
    rustix::fs::renameat_with(
        directory,
        left,
        directory,
        right,
        rustix::fs::RenameFlags::EXCHANGE,
    )
    .map_err(|_| DesktopCustodyError::StorageRejected)
}

#[cfg(not(any(
    target_os = "linux",
    target_os = "android",
    target_os = "macos",
    target_os = "ios"
)))]
#[cfg(test)]
fn exchange_workspace_files(
    _directory: &File,
    _left: &str,
    _right: &str,
) -> Result<(), DesktopCustodyError> {
    Err(DesktopCustodyError::Unavailable)
}

#[cfg(test)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct StableJournalMetadata {
    dev: u64,
    ino: u64,
    size: u64,
    mode: u32,
    nlink: u64,
    uid: u32,
    modified_seconds: i64,
    modified_nanoseconds: i64,
    changed_seconds: i64,
    changed_nanoseconds: i64,
}

#[cfg(unix)]
#[cfg(test)]
fn stable_journal_metadata(file: &File) -> Result<StableJournalMetadata, DesktopCustodyError> {
    use std::os::unix::fs::MetadataExt as _;

    let metadata = file
        .metadata()
        .map_err(|_| DesktopCustodyError::StorageRejected)?;
    validate_file_metadata(&metadata)?;
    Ok(StableJournalMetadata {
        dev: metadata.dev(),
        ino: metadata.ino(),
        size: metadata.len(),
        mode: metadata.mode(),
        nlink: metadata.nlink(),
        uid: metadata.uid(),
        modified_seconds: metadata.mtime(),
        modified_nanoseconds: metadata.mtime_nsec(),
        changed_seconds: metadata.ctime(),
        changed_nanoseconds: metadata.ctime_nsec(),
    })
}

#[cfg(not(unix))]
#[cfg(test)]
fn stable_journal_metadata(_file: &File) -> Result<StableJournalMetadata, DesktopCustodyError> {
    Err(DesktopCustodyError::Unavailable)
}

#[cfg(unix)]
#[cfg(test)]
fn read_journal_exact_at(file: &File, size: u64) -> Result<Vec<u8>, DesktopCustodyError> {
    use std::os::unix::fs::FileExt as _;

    let size = usize::try_from(size).map_err(|_| DesktopCustodyError::Rejected)?;
    let mut bytes = vec![0_u8; size];
    let mut offset = 0_usize;
    while offset < bytes.len() {
        let count = file
            .read_at(&mut bytes[offset..], offset as u64)
            .map_err(|_| DesktopCustodyError::StorageRejected)?;
        if count == 0 {
            return Err(DesktopCustodyError::Rejected);
        }
        offset = offset
            .checked_add(count)
            .ok_or(DesktopCustodyError::Rejected)?;
    }
    let mut extra = [0_u8; 1];
    if file
        .read_at(&mut extra, size as u64)
        .map_err(|_| DesktopCustodyError::StorageRejected)?
        != 0
    {
        return Err(DesktopCustodyError::Rejected);
    }
    Ok(bytes)
}

#[cfg(not(unix))]
#[cfg(test)]
fn read_journal_exact_at(_file: &File, _size: u64) -> Result<Vec<u8>, DesktopCustodyError> {
    Err(DesktopCustodyError::Unavailable)
}

#[cfg(test)]
impl DesktopJournalStore {
    #[cfg(test)]
    #[expect(
        clippy::needless_pass_by_value,
        reason = "the test store constructor accepts owned paths to match temporary-directory call sites"
    )]
    pub(crate) fn for_test(path: PathBuf) -> Result<Self, DesktopCustodyError> {
        let journal_name = path
            .file_name()
            .and_then(|value| value.to_str())
            .filter(|value| !value.is_empty() && *value != "." && *value != "..")
            .ok_or(DesktopCustodyError::Rejected)?
            .to_owned();
        let parent = path.parent().ok_or(DesktopCustodyError::Rejected)?;
        let directory =
            Arc::new(File::open(parent).map_err(|_| DesktopCustodyError::StorageRejected)?);
        let directory_identity = directory_file_identity(&directory)?;
        let journal = open_journal_optional(&directory, journal_name.as_str())?;
        Ok(Self {
            directory,
            directory_identity,
            journal_name,
            journal: Mutex::new(journal),
        })
    }

    pub(crate) fn append(&self, record: &[u8]) -> Result<(), DesktopCustodyError> {
        if record.is_empty() || record.len() > MAX_REBOOTSTRAP_RECORD_BYTES {
            return Err(DesktopCustodyError::Rejected);
        }
        ensure_directory_file_identity(&self.directory, self.directory_identity)?;
        let mut bytes = Vec::with_capacity(record.len() + 1);
        bytes.extend_from_slice(record);
        bytes.push(b'\n');
        let mut journal = self
            .journal
            .lock()
            .map_err(|_| DesktopCustodyError::StorageRejected)?;
        if journal.is_none() {
            *journal = Some(open_journal(
                &self.directory,
                self.journal_name.as_str(),
                true,
            )?);
        }
        let file = journal
            .as_mut()
            .ok_or(DesktopCustodyError::StorageRejected)?;
        ensure_named_file_identity(&self.directory, self.journal_name.as_str(), file)?;
        let current = file
            .metadata()
            .map_err(|_| DesktopCustodyError::StorageRejected)?
            .len();
        let current = usize::try_from(current).map_err(|_| DesktopCustodyError::Rejected)?;
        if current
            .checked_add(bytes.len())
            .is_none_or(|size| size > MAX_REBOOTSTRAP_JOURNAL_BYTES)
        {
            return Err(DesktopCustodyError::Rejected);
        }
        file.write_all(&bytes)
            .map_err(|_| DesktopCustodyError::StorageRejected)?;
        file.sync_all()
            .map_err(|_| DesktopCustodyError::StorageRejected)?;
        ensure_named_file_identity(&self.directory, self.journal_name.as_str(), file)?;
        self.directory
            .sync_all()
            .map_err(|_| DesktopCustodyError::StorageRejected)
    }

    pub(crate) fn read_last(&self) -> Result<Option<Vec<u8>>, DesktopCustodyError> {
        Ok(self.read_all()?.pop())
    }

    pub(crate) fn read_all(&self) -> Result<Vec<Vec<u8>>, DesktopCustodyError> {
        self.read_all_stable(None)
    }

    #[cfg(test)]
    pub(crate) fn read_all_with_between_reads_for_test<F>(
        &self,
        action: F,
    ) -> Result<Vec<Vec<u8>>, DesktopCustodyError>
    where
        F: FnOnce() -> Result<(), DesktopCustodyError>,
    {
        let mut action = Some(action);
        let mut between_reads = || action.take().ok_or(DesktopCustodyError::Rejected)?();
        self.read_all_stable(Some(&mut between_reads))
    }

    fn read_all_stable(
        &self,
        mut between_reads: Option<&mut dyn FnMut() -> Result<(), DesktopCustodyError>>,
    ) -> Result<Vec<Vec<u8>>, DesktopCustodyError> {
        ensure_directory_file_identity(&self.directory, self.directory_identity)?;
        let mut journal = self
            .journal
            .lock()
            .map_err(|_| DesktopCustodyError::StorageRejected)?;
        if journal.is_none() {
            *journal = open_journal_optional(&self.directory, self.journal_name.as_str())?;
        }
        let Some(file) = journal.as_mut() else {
            return Ok(Vec::new());
        };
        ensure_named_file_identity(&self.directory, self.journal_name.as_str(), file)?;
        let before = stable_journal_metadata(file)?;
        if before.size == 0 || before.size > MAX_REBOOTSTRAP_JOURNAL_BYTES as u64 {
            return Err(DesktopCustodyError::Rejected);
        }
        let bytes = read_journal_exact_at(file, before.size)?;
        let first_digest = Sha256::digest(&bytes);
        if stable_journal_metadata(file)? != before {
            return Err(DesktopCustodyError::Rejected);
        }
        if let Some(action) = between_reads.as_mut() {
            action()?;
        }
        let second = read_journal_exact_at(file, before.size)?;
        if stable_journal_metadata(file)? != before
            || Sha256::digest(&second).as_slice() != first_digest.as_slice()
            || second != bytes
        {
            return Err(DesktopCustodyError::Rejected);
        }
        ensure_named_file_identity(&self.directory, self.journal_name.as_str(), file)?;
        if bytes.last() != Some(&b'\n') {
            return Err(DesktopCustodyError::Rejected);
        }
        let mut records = Vec::new();
        for line in bytes[..bytes.len() - 1].split(|byte| *byte == b'\n') {
            if line.is_empty() || line.len() > MAX_REBOOTSTRAP_RECORD_BYTES {
                return Err(DesktopCustodyError::Rejected);
            }
            if records.len() == MAX_REBOOTSTRAP_JOURNAL_RECORDS {
                return Err(DesktopCustodyError::Rejected);
            }
            records.push(line.to_vec());
        }
        if records.is_empty() {
            return Err(DesktopCustodyError::Rejected);
        }
        Ok(records)
    }
}

#[cfg(test)]
fn open_journal(directory: &File, name: &str, create: bool) -> Result<File, DesktopCustodyError> {
    let mut flags = rustix::fs::OFlags::RDWR
        | rustix::fs::OFlags::APPEND
        | rustix::fs::OFlags::NOFOLLOW
        | rustix::fs::OFlags::CLOEXEC;
    if create {
        flags |= rustix::fs::OFlags::CREATE;
    }
    let descriptor = rustix::fs::openat(
        directory,
        name,
        flags,
        rustix::fs::Mode::RUSR | rustix::fs::Mode::WUSR,
    )
    .map_err(|_| DesktopCustodyError::StorageRejected)?;
    let file = File::from(descriptor);
    validate_file_metadata(
        &file
            .metadata()
            .map_err(|_| DesktopCustodyError::StorageRejected)?,
    )?;
    ensure_named_file_identity(directory, name, &file)?;
    Ok(file)
}

#[cfg(test)]
fn open_journal_optional(
    directory: &File,
    name: &str,
) -> Result<Option<File>, DesktopCustodyError> {
    let descriptor = match rustix::fs::openat(
        directory,
        name,
        rustix::fs::OFlags::RDWR
            | rustix::fs::OFlags::APPEND
            | rustix::fs::OFlags::NOFOLLOW
            | rustix::fs::OFlags::CLOEXEC,
        rustix::fs::Mode::empty(),
    ) {
        Ok(descriptor) => descriptor,
        Err(rustix::io::Errno::NOENT) => return Ok(None),
        Err(_) => return Err(DesktopCustodyError::Rejected),
    };
    let file = File::from(descriptor);
    validate_file_metadata(
        &file
            .metadata()
            .map_err(|_| DesktopCustodyError::StorageRejected)?,
    )?;
    ensure_named_file_identity(directory, name, &file)?;
    Ok(Some(file))
}

#[cfg(unix)]
fn ensure_named_file_identity(
    directory: &File,
    name: &str,
    file: &File,
) -> Result<(), DesktopCustodyError> {
    let identity = file_identity(file)?;
    let metadata = rustix::fs::statat(directory, name, rustix::fs::AtFlags::SYMLINK_NOFOLLOW)
        .map_err(|_| DesktopCustodyError::StorageRejected)?;
    #[cfg(unix)]
    let is_regular = rustix::fs::FileType::from_raw_mode(metadata.st_mode as _).is_file();
    #[cfg(not(unix))]
    let is_regular = false;
    #[cfg(target_os = "linux")]
    let metadata_dev = metadata.st_dev;
    #[cfg(target_os = "macos")]
    let metadata_dev = u64::try_from(metadata.st_dev).map_err(|_| DesktopCustodyError::Rejected)?;
    if !is_regular
        || metadata_dev != identity.dev
        || metadata.st_ino as u64 != identity.ino
        || metadata.st_nlink != 1
        || metadata.st_uid != rustix::process::geteuid().as_raw()
        || metadata.st_mode & 0o077 != 0
    {
        return Err(DesktopCustodyError::Rejected);
    }
    Ok(())
}

#[cfg(not(unix))]
fn ensure_named_file_identity(
    _directory: &File,
    _name: &str,
    _file: &File,
) -> Result<(), DesktopCustodyError> {
    Err(DesktopCustodyError::Rejected)
}

impl fmt::Debug for DesktopProductionCustody {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("DesktopProductionCustody([REDACTED])")
    }
}

#[expect(
    clippy::used_underscore_binding,
    reason = "the retained directory descriptor is both a lifetime guard and an identity source"
)]
impl DesktopProductionCustody {
    pub(crate) fn load_or_create(
        root: &DesktopApplicationRoot,
    ) -> Result<Self, DesktopCustodyError> {
        Self::load_or_create_with_capability(
            root,
            #[cfg(test)]
            RebootstrapCapability::Unavailable,
            #[cfg(test)]
            TestRebootstrapKeyStore::default(),
        )
    }

    #[cfg(test)]
    pub(crate) fn load_or_create_for_rebootstrap_test_with_store(
        root: &DesktopApplicationRoot,
        store: TestRebootstrapKeyStore,
    ) -> Result<Self, DesktopCustodyError> {
        Self::load_or_create_with_capability(root, RebootstrapCapability::TestCreateOnly, store)
    }

    fn load_or_create_with_capability(
        root: &DesktopApplicationRoot,
        #[cfg(test)] rebootstrap_capability: RebootstrapCapability,
        #[cfg(test)] rebootstrap_test_store: TestRebootstrapKeyStore,
    ) -> Result<Self, DesktopCustodyError> {
        root.verify_identity()
            .map_err(|_| DesktopCustodyError::Rejected)?;
        let process_lock = acquire_process_lock(root)?;
        let database_path = root.business_database_path();
        let active_workspace = ensure_active_workspace(root)?;
        let active_workspace_identity = directory_file_identity(&active_workspace)?;
        assert_rebootstrap_files_pristine(&active_workspace)?;
        #[cfg(test)]
        for slot in [RebootstrapSlot::A, RebootstrapSlot::B] {
            if load_slot_native(&rebootstrap_test_store, slot)?.is_some() {
                return Err(DesktopCustodyError::Rejected);
            }
        }
        #[cfg(not(test))]
        for account in REBOOTSTRAP_SLOT_ACCOUNTS {
            if load_native(REBOOTSTRAP_KEY_SERVICE, account)?.is_some() {
                return Err(DesktopCustodyError::Rejected);
            }
        }
        let existing_database = open_existing_database(&active_workspace)?;
        let database_exists = existing_database.is_some();

        #[cfg(test)]
        let loaded_database_key = load_database_key_for_test(&rebootstrap_test_store)?;
        #[cfg(not(test))]
        let loaded_database_key = load_database_key()?;
        let mut database_key = match loaded_database_key {
            Some(key) if database_exists => key,
            Some(_) => return Err(DesktopCustodyError::Rejected),
            None if database_exists => return Err(DesktopCustodyError::Rejected),
            None => {
                #[cfg(test)]
                {
                    generate_and_store_database_key_for_test(&rebootstrap_test_store)?
                }
                #[cfg(not(test))]
                {
                    generate_and_store_database_key()?
                }
            }
        };
        // A first-run database is created with create_new + no-follow. Once a key exists, an
        // absent path is never implicitly created by SQLite; this prevents path/check/open races.
        let database_file = if let Some(database) = existing_database {
            database
        } else {
            create_admitted_database(&active_workspace)?
        };
        let database_identity = file_identity(&database_file)?;
        ensure_path_identity(&database_path, database_identity)?;
        ensure_directory_path_identity(
            database_path
                .parent()
                .ok_or(DesktopCustodyError::StorageRejected)?,
            active_workspace_identity,
        )?;
        root.verify_identity()
            .map_err(|_| DesktopCustodyError::Rejected)?;
        let key = LocalDatabaseKey::from_bytes(*database_key);
        database_key.zeroize();
        Ok(Self {
            _process_lock: process_lock,
            _active_workspace: active_workspace,
            active_workspace_identity,
            active_database: Mutex::new(ActiveDatabaseCustody {
                file: database_file,
                identity: database_identity,
                key,
            }),
            database_path,
            #[cfg(test)]
            rebootstrap_capability,
            #[cfg(test)]
            rebootstrap_test_store,
        })
    }

    pub(crate) fn open_workspace(
        &self,
        workspace_id: &str,
    ) -> Result<crate::BusinessDatabase, crate::BusinessDatabaseError> {
        let active = self
            .active_database
            .lock()
            .map_err(|_| crate::BusinessDatabaseError::StorageRejected)?;
        ensure_file_identity(&active.file, active.identity)
            .map_err(|_| crate::BusinessDatabaseError::StorageRejected)?;
        ensure_directory_file_identity(&self._active_workspace, self.active_workspace_identity)
            .map_err(|_| crate::BusinessDatabaseError::StorageRejected)?;
        ensure_directory_path_identity(
            self.database_path
                .parent()
                .ok_or(crate::BusinessDatabaseError::StorageRejected)?,
            self.active_workspace_identity,
        )
        .map_err(|_| crate::BusinessDatabaseError::StorageRejected)?;
        ensure_path_identity(&self.database_path, active.identity)
            .map_err(|_| crate::BusinessDatabaseError::StorageRejected)?;
        let database =
            crate::BusinessDatabase::open(&self.database_path, &active.key, workspace_id)?;
        // The path must still resolve to the exact admitted file after SQLite has opened and
        // migrated it. A swap is a closed failure, never an alternate database selection.
        ensure_file_identity(&active.file, active.identity)
            .map_err(|_| crate::BusinessDatabaseError::StorageRejected)?;
        ensure_directory_file_identity(&self._active_workspace, self.active_workspace_identity)
            .map_err(|_| crate::BusinessDatabaseError::StorageRejected)?;
        ensure_directory_path_identity(
            self.database_path
                .parent()
                .ok_or(crate::BusinessDatabaseError::StorageRejected)?,
            self.active_workspace_identity,
        )
        .map_err(|_| crate::BusinessDatabaseError::StorageRejected)?;
        ensure_path_identity(&self.database_path, active.identity)
            .map_err(|_| crate::BusinessDatabaseError::StorageRejected)?;
        Ok(database)
    }

    #[cfg_attr(
        not(test),
        expect(
            clippy::unused_self,
            reason = "the platform-neutral custody API uses the test store on test builds"
        )
    )]
    pub(crate) fn load_device_id(&self) -> Result<String, DesktopCustodyError> {
        #[cfg(test)]
        let identity = load_device_identity_for_test(&self.rebootstrap_test_store)?;
        #[cfg(not(test))]
        let identity = load_device_identity()?;
        Ok(identity.device_id)
    }

    /// Returns the purpose-separated public installation binding provisioned by Secure Host.
    /// The digest is crate-private and is suitable only as input to local idempotency identities.
    #[cfg_attr(
        not(test),
        expect(
            clippy::unused_self,
            reason = "the platform-neutral custody API uses the test store on test builds"
        )
    )]
    pub(crate) fn installation_binding_digest(&self) -> Result<[u8; 32], DesktopCustodyError> {
        #[cfg(test)]
        {
            Ok(load_device_identity_for_test(&self.rebootstrap_test_store)?
                .installation_binding_digest)
        }
        #[cfg(not(test))]
        {
            Ok(load_device_identity()?.installation_binding_digest)
        }
    }
}

fn acquire_process_lock(
    root: &DesktopApplicationRoot,
) -> Result<std::fs::File, DesktopCustodyError> {
    use fs2::FileExt as _;

    #[cfg(test)]
    TEST_LOCK_INSPECTION_ATTEMPTS.fetch_add(1, Ordering::SeqCst);

    let path = root.runtime_lock_path();
    let descriptor = rustix::fs::openat(
        root.directory(),
        ".desktop-local-host.lock",
        rustix::fs::OFlags::RDWR
            | rustix::fs::OFlags::CREATE
            | rustix::fs::OFlags::NOFOLLOW
            | rustix::fs::OFlags::CLOEXEC,
        rustix::fs::Mode::RUSR | rustix::fs::Mode::WUSR,
    )
    .map_err(|_| DesktopCustodyError::StorageRejected)?;
    let file = File::from(descriptor);
    file.try_lock_exclusive()
        .map_err(|_| DesktopCustodyError::Unavailable)?;
    #[cfg(test)]
    TEST_LOCK_INSPECTION_ACQUIRED.fetch_add(1, Ordering::SeqCst);
    let metadata = file
        .metadata()
        .map_err(|_| DesktopCustodyError::StorageRejected)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt as _;
        if !metadata.is_file()
            || metadata.nlink() != 1
            || metadata.uid() != rustix::process::geteuid().as_raw()
            || metadata.mode() & 0o777 != 0o600
        {
            return Err(DesktopCustodyError::Rejected);
        }
    }
    ensure_path_identity(&path, file_identity(&file)?)?;
    root.verify_identity()
        .map_err(|_| DesktopCustodyError::Rejected)?;
    Ok(file)
}

fn ensure_active_workspace(root: &DesktopApplicationRoot) -> Result<File, DesktopCustodyError> {
    let flags = rustix::fs::OFlags::RDONLY
        | rustix::fs::OFlags::DIRECTORY
        | rustix::fs::OFlags::NOFOLLOW
        | rustix::fs::OFlags::CLOEXEC;
    let descriptor = match rustix::fs::openat(
        root.directory(),
        "active-workspace",
        flags,
        rustix::fs::Mode::empty(),
    ) {
        Ok(descriptor) => descriptor,
        Err(rustix::io::Errno::NOENT) => {
            rustix::fs::mkdirat(
                root.directory(),
                "active-workspace",
                rustix::fs::Mode::RUSR | rustix::fs::Mode::WUSR | rustix::fs::Mode::XUSR,
            )
            .map_err(|_| DesktopCustodyError::StorageRejected)?;
            rustix::fs::openat(
                root.directory(),
                "active-workspace",
                flags,
                rustix::fs::Mode::empty(),
            )
            .map_err(|_| DesktopCustodyError::StorageRejected)?
        }
        Err(_) => return Err(DesktopCustodyError::Rejected),
    };
    let directory = File::from(descriptor);
    let identity = directory_file_identity(&directory)?;
    let database_path = root.business_database_path();
    ensure_directory_path_identity(
        database_path
            .parent()
            .ok_or(DesktopCustodyError::StorageRejected)?,
        identity,
    )?;
    root.verify_identity()
        .map_err(|_| DesktopCustodyError::Rejected)?;
    Ok(directory)
}

#[cfg(test)]
fn open_active_workspace_existing(
    root: &DesktopApplicationRoot,
) -> Result<File, DesktopCustodyError> {
    let descriptor = rustix::fs::openat(
        root.directory(),
        "active-workspace",
        rustix::fs::OFlags::RDONLY
            | rustix::fs::OFlags::DIRECTORY
            | rustix::fs::OFlags::NOFOLLOW
            | rustix::fs::OFlags::CLOEXEC,
        rustix::fs::Mode::empty(),
    )
    .map_err(|_| DesktopCustodyError::Rejected)?;
    let directory = File::from(descriptor);
    let identity = directory_file_identity(&directory)?;
    ensure_directory_path_identity(
        root.business_database_path()
            .parent()
            .ok_or(DesktopCustodyError::StorageRejected)?,
        identity,
    )?;
    root.verify_identity()
        .map_err(|_| DesktopCustodyError::Rejected)?;
    Ok(directory)
}

fn create_admitted_database(directory: &File) -> Result<File, DesktopCustodyError> {
    let descriptor = rustix::fs::openat(
        directory,
        "business.db",
        rustix::fs::OFlags::RDWR
            | rustix::fs::OFlags::CREATE
            | rustix::fs::OFlags::EXCL
            | rustix::fs::OFlags::NOFOLLOW
            | rustix::fs::OFlags::CLOEXEC,
        rustix::fs::Mode::RUSR | rustix::fs::Mode::WUSR,
    )
    .map_err(|_| DesktopCustodyError::StorageRejected)?;
    let file = File::from(descriptor);
    let metadata = file
        .metadata()
        .map_err(|_| DesktopCustodyError::StorageRejected)?;
    validate_file_metadata(&metadata)?;
    Ok(file)
}

fn open_existing_database(directory: &File) -> Result<Option<File>, DesktopCustodyError> {
    #[cfg(test)]
    TEST_DATABASE_INSPECTIONS.fetch_add(1, Ordering::SeqCst);
    let descriptor = match rustix::fs::openat(
        directory,
        "business.db",
        rustix::fs::OFlags::RDWR | rustix::fs::OFlags::NOFOLLOW | rustix::fs::OFlags::CLOEXEC,
        rustix::fs::Mode::empty(),
    ) {
        Ok(descriptor) => descriptor,
        Err(rustix::io::Errno::NOENT) => return Ok(None),
        Err(_) => return Err(DesktopCustodyError::Rejected),
    };
    let file = File::from(descriptor);
    let metadata = file
        .metadata()
        .map_err(|_| DesktopCustodyError::StorageRejected)?;
    validate_file_metadata(&metadata)?;
    Ok(Some(file))
}

fn validate_file_metadata(metadata: &std::fs::Metadata) -> Result<(), DesktopCustodyError> {
    if !metadata.is_file() {
        return Err(DesktopCustodyError::Rejected);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt as _;
        let uid = rustix::process::geteuid().as_raw();
        if metadata.uid() != uid || metadata.nlink() != 1 || metadata.mode() & 0o077 != 0 {
            return Err(DesktopCustodyError::Rejected);
        }
    }
    Ok(())
}

fn validate_directory_metadata(metadata: &std::fs::Metadata) -> Result<(), DesktopCustodyError> {
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(DesktopCustodyError::Rejected);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt as _;
        if metadata.uid() != rustix::process::geteuid().as_raw() || metadata.mode() & 0o022 != 0 {
            return Err(DesktopCustodyError::Rejected);
        }
    }
    Ok(())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct FileIdentity {
    dev: u64,
    ino: u64,
}

#[derive(PartialEq, Eq)]
#[cfg(test)]
struct FileCustodyEvidence {
    identity: FileIdentity,
    size: u64,
    ciphertext_digest: String,
    key_digest: String,
}

#[cfg(test)]
impl FileCustodyEvidence {
    #[cfg(test)]
    fn for_test() -> Self {
        Self {
            identity: FileIdentity { dev: 1, ino: 1 },
            size: 1,
            ciphertext_digest: "a".repeat(64),
            key_digest: "b".repeat(64),
        }
    }
}

fn file_identity(file: &File) -> Result<FileIdentity, DesktopCustodyError> {
    let metadata = file
        .metadata()
        .map_err(|_| DesktopCustodyError::StorageRejected)?;
    validate_file_metadata(&metadata)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt as _;
        Ok(FileIdentity {
            dev: metadata.dev(),
            ino: metadata.ino(),
        })
    }
    #[cfg(not(unix))]
    {
        Err(DesktopCustodyError::Rejected)
    }
}

fn directory_file_identity(file: &File) -> Result<FileIdentity, DesktopCustodyError> {
    let metadata = file
        .metadata()
        .map_err(|_| DesktopCustodyError::StorageRejected)?;
    validate_directory_metadata(&metadata)?;
    metadata_identity(&metadata)
}

fn ensure_directory_file_identity(
    file: &File,
    expected: FileIdentity,
) -> Result<(), DesktopCustodyError> {
    if directory_file_identity(file)? != expected {
        return Err(DesktopCustodyError::Rejected);
    }
    Ok(())
}

fn ensure_directory_path_identity(
    path: &Path,
    expected: FileIdentity,
) -> Result<(), DesktopCustodyError> {
    let metadata =
        std::fs::symlink_metadata(path).map_err(|_| DesktopCustodyError::StorageRejected)?;
    validate_directory_metadata(&metadata)?;
    if metadata_identity(&metadata)? != expected {
        return Err(DesktopCustodyError::Rejected);
    }
    Ok(())
}

#[expect(
    clippy::unnecessary_wraps,
    reason = "non-Unix targets reject descriptor identity through the same cross-platform API"
)]
fn metadata_identity(metadata: &std::fs::Metadata) -> Result<FileIdentity, DesktopCustodyError> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt as _;
        Ok(FileIdentity {
            dev: metadata.dev(),
            ino: metadata.ino(),
        })
    }
    #[cfg(not(unix))]
    {
        let _ = metadata;
        Err(DesktopCustodyError::Rejected)
    }
}

fn ensure_file_identity(file: &File, expected: FileIdentity) -> Result<(), DesktopCustodyError> {
    if file_identity(file)? != expected {
        return Err(DesktopCustodyError::Rejected);
    }
    Ok(())
}

fn ensure_path_identity(path: &Path, expected: FileIdentity) -> Result<(), DesktopCustodyError> {
    let metadata =
        std::fs::symlink_metadata(path).map_err(|_| DesktopCustodyError::StorageRejected)?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(DesktopCustodyError::Rejected);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt as _;
        if metadata.dev() != expected.dev
            || metadata.ino() != expected.ino
            || metadata.nlink() != 1
            || metadata.uid() != rustix::process::geteuid().as_raw()
            || metadata.mode() & 0o077 != 0
        {
            return Err(DesktopCustodyError::Rejected);
        }
    }
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredDeviceIdentity {
    schema_version: u8,
    device_id: String,
    installation_binding_digest: String,
}

#[derive(Debug, Clone)]
struct LoadedDeviceIdentity {
    device_id: String,
    installation_binding_digest: [u8; 32],
}

#[cfg(test)]
fn load_device_identity_for_test(
    store: &TestRebootstrapKeyStore,
) -> Result<LoadedDeviceIdentity, DesktopCustodyError> {
    store
        .device_identity
        .lock()
        .map_err(|_| DesktopCustodyError::StorageRejected)
        .map(|identity| identity.clone())
}

#[cfg(not(test))]
fn load_device_identity() -> Result<LoadedDeviceIdentity, DesktopCustodyError> {
    let stored = load_device_binding_native()?.ok_or(DesktopCustodyError::Unavailable)?;
    let stored = Zeroizing::new(stored);
    if stored.is_empty() || stored.len() > MAX_DEVICE_IDENTITY_BYTES {
        return Err(DesktopCustodyError::Rejected);
    }
    decode_device_binding(&stored)
}

#[cfg(all(target_os = "macos", not(test)))]
fn load_device_binding_native() -> Result<Option<Vec<u8>>, DesktopCustodyError> {
    use security_framework::passwords::PasswordOptions;
    const ITEM_NOT_FOUND: i32 = -25_300;
    verify_binding_attributes()?;
    let mut options =
        PasswordOptions::new_generic_password(DEVICE_IDENTITY_SERVICE, DEVICE_IDENTITY_ACCOUNT);
    options.use_protected_keychain();
    options.set_access_synchronized(Some(false));
    match security_framework::passwords::generic_password(options) {
        Ok(value) => Ok(Some(value)),
        Err(error) if error.code() == ITEM_NOT_FOUND => Ok(None),
        Err(_) => Err(DesktopCustodyError::Unavailable),
    }
}

#[cfg(all(target_os = "linux", not(test)))]
fn load_device_binding_native() -> Result<Option<Vec<u8>>, DesktopCustodyError> {
    load_native(DEVICE_IDENTITY_SERVICE, DEVICE_IDENTITY_ACCOUNT)
}

#[cfg(all(not(any(target_os = "macos", target_os = "linux")), not(test)))]
fn load_device_binding_native() -> Result<Option<Vec<u8>>, DesktopCustodyError> {
    Err(DesktopCustodyError::Unavailable)
}

#[cfg(all(target_os = "macos", not(test)))]
fn verify_binding_attributes() -> Result<(), DesktopCustodyError> {
    use security_framework::item::{CloudSync, ItemClass, ItemSearchOptions, SearchResult};
    const ITEM_NOT_FOUND: i32 = -25_300;
    let mut query = ItemSearchOptions::new();
    query
        .class(ItemClass::generic_password())
        .service(DEVICE_IDENTITY_SERVICE)
        .account(DEVICE_IDENTITY_ACCOUNT)
        .cloud_sync(CloudSync::MatchSyncNo)
        .ignore_legacy_keychains()
        .load_attributes(true)
        .limit(1);
    let results = query
        .search()
        .map_err(|_| DesktopCustodyError::Unavailable)?;
    let Some(result @ SearchResult::Dict(_)) = results.first() else {
        return Err(DesktopCustodyError::Rejected);
    };
    let values = result
        .simplify_dict()
        .ok_or(DesktopCustodyError::Rejected)?;
    let valid_group = values.get("agrp").is_some_and(|value| {
        value == "app.gooddealer.desktop"
            || value
                .strip_suffix("app.gooddealer.desktop")
                .is_some_and(|prefix| {
                    let team = prefix.strip_suffix('.').unwrap_or_default();
                    team.len() == 10
                        && team
                            .bytes()
                            .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit())
                })
    });
    if values
        .get("svce")
        .is_none_or(|value| value != DEVICE_IDENTITY_SERVICE)
        || values
            .get("acct")
            .is_none_or(|value| value != DEVICE_IDENTITY_ACCOUNT)
        || values.get("pdmn").is_none_or(|value| value != "aku")
        || !values.contains_key("accc")
        || !valid_group
    {
        return Err(DesktopCustodyError::Rejected);
    }
    let mut synchronized = ItemSearchOptions::new();
    synchronized
        .class(ItemClass::generic_password())
        .service(DEVICE_IDENTITY_SERVICE)
        .account(DEVICE_IDENTITY_ACCOUNT)
        .cloud_sync(CloudSync::MatchSyncYes)
        .ignore_legacy_keychains()
        .load_attributes(true)
        .limit(1);
    match synchronized.search() {
        Err(error) if error.code() == ITEM_NOT_FOUND => Ok(()),
        Ok(results) if results.is_empty() => Ok(()),
        Ok(_) => Err(DesktopCustodyError::Rejected),
        Err(_) => Err(DesktopCustodyError::Unavailable),
    }
}

fn decode_device_binding(stored: &[u8]) -> Result<LoadedDeviceIdentity, DesktopCustodyError> {
    if stored.is_empty() || stored.len() > MAX_DEVICE_IDENTITY_BYTES {
        return Err(DesktopCustodyError::Rejected);
    }
    let identity: StoredDeviceIdentity =
        serde_json::from_slice(stored).map_err(|_| DesktopCustodyError::Rejected)?;
    if identity.schema_version != 1 || !valid_identifier(&identity.device_id) {
        return Err(DesktopCustodyError::Rejected);
    }
    let decoded = URL_SAFE_NO_PAD
        .decode(identity.installation_binding_digest.as_bytes())
        .map_err(|_| DesktopCustodyError::Rejected)?;
    if decoded.len() != 32
        || URL_SAFE_NO_PAD.encode(&decoded) != identity.installation_binding_digest
    {
        return Err(DesktopCustodyError::Rejected);
    }
    let installation_binding_digest: [u8; 32] = decoded
        .as_slice()
        .try_into()
        .map_err(|_| DesktopCustodyError::Rejected)?;
    let loaded = LoadedDeviceIdentity {
        device_id: identity.device_id,
        installation_binding_digest,
    };
    Ok(loaded)
}

#[cfg(not(test))]
fn load_database_key() -> Result<Option<Zeroizing<[u8; DATABASE_KEY_BYTES]>>, DesktopCustodyError> {
    let Some(stored) = load_native(DATABASE_KEY_SERVICE, DATABASE_KEY_ACCOUNT)? else {
        return Ok(None);
    };
    let stored = Zeroizing::new(stored);
    let key: [u8; DATABASE_KEY_BYTES] = stored
        .as_slice()
        .try_into()
        .map_err(|_| DesktopCustodyError::Rejected)?;
    Ok(Some(Zeroizing::new(key)))
}

#[cfg(not(test))]
fn generate_and_store_database_key()
-> Result<Zeroizing<[u8; DATABASE_KEY_BYTES]>, DesktopCustodyError> {
    let mut generated = Zeroizing::new([0_u8; DATABASE_KEY_BYTES]);
    getrandom::fill(&mut *generated).map_err(|_| DesktopCustodyError::RandomUnavailable)?;
    if load_native(DATABASE_KEY_SERVICE, DATABASE_KEY_ACCOUNT)?.is_some() {
        return Err(DesktopCustodyError::Rejected);
    }
    store_native(DATABASE_KEY_SERVICE, DATABASE_KEY_ACCOUNT, &generated[..])?;
    load_database_key()?.ok_or(DesktopCustodyError::Unavailable)
}

#[cfg(all(target_os = "macos", not(test)))]
fn secret_keychain_options(
    service: &str,
    account: &str,
    include_access_control: bool,
) -> security_framework::passwords::PasswordOptions {
    use security_framework::access_control::{ProtectionMode, SecAccessControl};
    use security_framework::passwords::{AccessControlOptions, PasswordOptions};

    let mut options = PasswordOptions::new_generic_password(service, account);
    options.use_protected_keychain();
    options.set_access_synchronized(Some(false));
    if include_access_control {
        options.set_access_control(
            SecAccessControl::create_with_protection(
                Some(ProtectionMode::AccessibleWhenUnlockedThisDeviceOnly),
                AccessControlOptions::empty().bits(),
            )
            .expect("fixed keychain access control flags are valid"),
        );
    }
    options
}

#[cfg(all(target_os = "macos", not(test)))]
fn load_native(service: &str, account: &str) -> Result<Option<Vec<u8>>, DesktopCustodyError> {
    const ITEM_NOT_FOUND: i32 = -25_300;
    match security_framework::passwords::generic_password(secret_keychain_options(
        service, account, false,
    )) {
        Ok(value) => {
            verify_secret_attributes(service, account)?;
            Ok(Some(value))
        }
        Err(error) if error.code() == ITEM_NOT_FOUND => Ok(None),
        Err(_) => Err(DesktopCustodyError::Unavailable),
    }
}

#[cfg(all(target_os = "macos", not(test)))]
fn store_native(service: &str, account: &str, value: &[u8]) -> Result<(), DesktopCustodyError> {
    security_framework::passwords::set_generic_password_options(
        value,
        secret_keychain_options(service, account, true),
    )
    .map_err(|_| DesktopCustodyError::Unavailable)?;
    verify_secret_attributes(service, account)?;
    match load_native(service, account)? {
        Some(readback) if readback == value => Ok(()),
        _ => Err(DesktopCustodyError::Rejected),
    }
}

#[cfg(all(target_os = "macos", not(test)))]
fn verify_secret_attributes(service: &str, account: &str) -> Result<(), DesktopCustodyError> {
    use security_framework::item::{CloudSync, ItemClass, ItemSearchOptions, SearchResult};

    let mut query = ItemSearchOptions::new();
    query
        .class(ItemClass::generic_password())
        .service(service)
        .account(account)
        .cloud_sync(CloudSync::MatchSyncNo)
        .ignore_legacy_keychains()
        .load_attributes(true)
        .limit(1);
    let results = query
        .search()
        .map_err(|_| DesktopCustodyError::Unavailable)?;
    let Some(result @ SearchResult::Dict(_)) = results.first() else {
        return Err(DesktopCustodyError::Rejected);
    };
    let values = result
        .simplify_dict()
        .ok_or(DesktopCustodyError::Rejected)?;
    let valid_group = values.get("agrp").is_some_and(|value| {
        value == "app.gooddealer.desktop"
            || value
                .strip_suffix("app.gooddealer.desktop")
                .is_some_and(|prefix| {
                    let team = prefix.strip_suffix('.').unwrap_or_default();
                    team.len() == 10
                        && team
                            .bytes()
                            .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit())
                })
    });
    if values.get("svce").is_none_or(|value| value != service)
        || values.get("acct").is_none_or(|value| value != account)
        || values.get("pdmn").is_none_or(|value| value != "aku")
        || !values.contains_key("accc")
        || !valid_group
    {
        return Err(DesktopCustodyError::Rejected);
    }
    Ok(())
}

#[cfg(all(target_os = "linux", not(test)))]
fn secret_service_error(error: crate::secret_service_custody::SecretServiceError) -> DesktopCustodyError {
    match error {
        crate::secret_service_custody::SecretServiceError::Unavailable => {
            DesktopCustodyError::Unavailable
        }
        crate::secret_service_custody::SecretServiceError::Rejected => DesktopCustodyError::Rejected,
    }
}

#[cfg(all(target_os = "linux", not(test)))]
fn load_native(service: &str, account: &str) -> Result<Option<Vec<u8>>, DesktopCustodyError> {
    // Callers own zeroization of the returned bytes, matching the macOS adapter's contract.
    crate::secret_service_custody::load(service, account)
        .map(|value| value.map(|secret| secret.to_vec()))
        .map_err(secret_service_error)
}

#[cfg(all(target_os = "linux", not(test)))]
fn store_native(service: &str, account: &str, value: &[u8]) -> Result<(), DesktopCustodyError> {
    crate::secret_service_custody::store(service, account, value).map_err(secret_service_error)
}

#[cfg(all(not(any(target_os = "macos", target_os = "linux")), not(test)))]
fn load_native(_service: &str, _account: &str) -> Result<Option<Vec<u8>>, DesktopCustodyError> {
    Err(DesktopCustodyError::Unavailable)
}

#[cfg(all(not(any(target_os = "macos", target_os = "linux")), not(test)))]
fn store_native(_service: &str, _account: &str, _value: &[u8]) -> Result<(), DesktopCustodyError> {
    Err(DesktopCustodyError::Unavailable)
}

#[cfg(test)]
fn load_active_alias_for_test(
    store: &TestRebootstrapKeyStore,
) -> Result<Option<Vec<u8>>, DesktopCustodyError> {
    TEST_ALIAS_INSPECTIONS.fetch_add(1, Ordering::SeqCst);
    store
        .active_alias
        .lock()
        .map_err(|_| DesktopCustodyError::StorageRejected)
        .map(|alias| alias.clone())
}

#[cfg(test)]
fn store_active_alias_for_test(
    store: &TestRebootstrapKeyStore,
    value: &[u8],
) -> Result<(), DesktopCustodyError> {
    *store
        .active_alias
        .lock()
        .map_err(|_| DesktopCustodyError::StorageRejected)? = Some(value.to_vec());
    Ok(())
}

#[cfg(test)]
fn load_database_key_for_test(
    store: &TestRebootstrapKeyStore,
) -> Result<Option<Zeroizing<[u8; DATABASE_KEY_BYTES]>>, DesktopCustodyError> {
    let Some(stored) = load_active_alias_for_test(store)? else {
        return Ok(None);
    };
    let stored = Zeroizing::new(stored);
    let key: [u8; DATABASE_KEY_BYTES] = stored
        .as_slice()
        .try_into()
        .map_err(|_| DesktopCustodyError::Rejected)?;
    Ok(Some(Zeroizing::new(key)))
}

#[cfg(test)]
fn generate_and_store_database_key_for_test(
    store: &TestRebootstrapKeyStore,
) -> Result<Zeroizing<[u8; DATABASE_KEY_BYTES]>, DesktopCustodyError> {
    let mut generated = Zeroizing::new([0_u8; DATABASE_KEY_BYTES]);
    getrandom::fill(&mut *generated).map_err(|_| DesktopCustodyError::RandomUnavailable)?;
    if load_active_alias_for_test(store)?.is_some() {
        return Err(DesktopCustodyError::Rejected);
    }
    store_active_alias_for_test(store, &generated[..])?;
    load_database_key_for_test(store)?.ok_or(DesktopCustodyError::Unavailable)
}

#[cfg(test)]
fn create_slot_native(
    store: &TestRebootstrapKeyStore,
    slot: RebootstrapSlot,
    value: &[u8],
) -> Result<(), DesktopCustodyError> {
    use std::collections::btree_map::Entry;

    let mut records = store
        .records
        .lock()
        .map_err(|_| DesktopCustodyError::StorageRejected)?;
    match records.entry(slot_byte(slot)) {
        Entry::Vacant(entry) => {
            entry.insert(value.to_vec());
            Ok(())
        }
        Entry::Occupied(_) => Err(DesktopCustodyError::Rejected),
    }
}

#[cfg(test)]
fn load_slot_native(
    store: &TestRebootstrapKeyStore,
    slot: RebootstrapSlot,
) -> Result<Option<Vec<u8>>, DesktopCustodyError> {
    TEST_SLOT_INSPECTIONS.fetch_add(1, Ordering::SeqCst);
    store
        .records
        .lock()
        .map_err(|_| DesktopCustodyError::StorageRejected)
        .map(|records| records.get(&slot_byte(slot)).cloned())
}

#[cfg(test)]
fn delete_slot_native_exact(
    store: &TestRebootstrapKeyStore,
    slot: RebootstrapSlot,
    expected: &[u8],
) -> Result<(), DesktopCustodyError> {
    let mut records = store
        .records
        .lock()
        .map_err(|_| DesktopCustodyError::StorageRejected)?;
    match records.entry(slot_byte(slot)) {
        std::collections::btree_map::Entry::Occupied(entry)
            if entry.get().as_slice() == expected =>
        {
            entry.remove();
            Ok(())
        }
        std::collections::btree_map::Entry::Occupied(_)
        | std::collections::btree_map::Entry::Vacant(_) => Err(DesktopCustodyError::Rejected),
    }
}

fn valid_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 160
        && value.bytes().all(|byte| (0x21..=0x7e).contains(&byte))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_slot_store_isolated_create_only_and_conflicts_never_overwrite() {
        let first = TestRebootstrapKeyStore::default();
        let second = TestRebootstrapKeyStore::default();
        let original = b"original-record";
        create_slot_native(&first, RebootstrapSlot::A, original).unwrap();
        assert_eq!(
            load_slot_native(&first, RebootstrapSlot::A).unwrap(),
            Some(original.to_vec())
        );
        assert_eq!(load_slot_native(&second, RebootstrapSlot::A).unwrap(), None);

        assert_eq!(
            create_slot_native(&first, RebootstrapSlot::A, original).unwrap_err(),
            DesktopCustodyError::Rejected
        );
        assert_eq!(
            create_slot_native(&first, RebootstrapSlot::A, b"conflicting-record").unwrap_err(),
            DesktopCustodyError::Rejected
        );
        assert_eq!(
            load_slot_native(&first, RebootstrapSlot::A).unwrap(),
            Some(original.to_vec())
        );
        assert_eq!(
            delete_slot_native_exact(&first, RebootstrapSlot::A, b"wrong-record").unwrap_err(),
            DesktopCustodyError::Rejected
        );
        assert_eq!(
            load_slot_native(&first, RebootstrapSlot::A).unwrap(),
            Some(original.to_vec())
        );
        delete_slot_native_exact(&first, RebootstrapSlot::A, original).unwrap();
        assert_eq!(load_slot_native(&first, RebootstrapSlot::A).unwrap(), None);
    }

    #[cfg(unix)]
    #[test]
    fn quarantine_custody_retains_process_lock_without_database_authority() {
        let parent = tempfile::tempdir().unwrap();
        let canonical_parent = parent.path().canonicalize().unwrap();
        let application_path = canonical_parent.join("GoodDealer");
        let root = DesktopApplicationRoot::validate(&application_path).unwrap();
        drop(ensure_active_workspace(&root).unwrap());
        let store = TestRebootstrapKeyStore::default();
        let bootstrap = TestRebootstrapRecoveryCustody::open(&root, store.clone()).unwrap();
        let before = bootstrap.state_digest().unwrap();
        let quarantine = bootstrap.quarantine_custody().unwrap();
        drop(bootstrap);

        assert_eq!(
            acquire_process_lock(&root).unwrap_err(),
            DesktopCustodyError::Unavailable
        );
        assert_eq!(quarantine.state_digest(&store).unwrap(), before);
        drop(quarantine);
        drop(acquire_process_lock(&root).unwrap());
    }

    #[cfg(unix)]
    #[test]
    fn constructor_rejects_fixed_rebootstrap_residue_before_database_or_key_creation() {
        use std::os::unix::fs::PermissionsExt as _;

        for name in [
            "rebootstrap.journal",
            "rebootstrap-a.db",
            "rebootstrap-a.db-wal",
            "rebootstrap-a.db-shm",
            "rebootstrap-a.db-journal",
            "rebootstrap-b.db",
            "rebootstrap-b.db-wal",
            "rebootstrap-b.db-shm",
            "rebootstrap-b.db-journal",
        ] {
            let parent = tempfile::tempdir().unwrap();
            let application_path = parent.path().canonicalize().unwrap().join("GoodDealer");
            let root = DesktopApplicationRoot::validate(&application_path).unwrap();
            drop(ensure_active_workspace(&root).unwrap());
            let residue = application_path.join("active-workspace").join(name);
            let residue_bytes = format!("fixed-residue-{name}").into_bytes();
            std::fs::write(&residue, &residue_bytes).unwrap();
            std::fs::set_permissions(&residue, std::fs::Permissions::from_mode(0o600)).unwrap();
            let store = TestRebootstrapKeyStore::default();

            assert_eq!(
                DesktopProductionCustody::load_or_create_for_rebootstrap_test_with_store(
                    &root,
                    store.clone(),
                )
                .unwrap_err(),
                DesktopCustodyError::Rejected,
                "{name}"
            );
            assert_eq!(std::fs::read(&residue).unwrap(), residue_bytes, "{name}");
            assert!(!root.business_database_path().exists(), "{name}");
            assert_eq!(load_active_alias_for_test(&store).unwrap(), None, "{name}");
        }

        for slot in [RebootstrapSlot::A, RebootstrapSlot::B] {
            let parent = tempfile::tempdir().unwrap();
            let application_path = parent.path().canonicalize().unwrap().join("GoodDealer");
            let root = DesktopApplicationRoot::validate(&application_path).unwrap();
            let store = TestRebootstrapKeyStore::default();
            let record = format!("foreign-slot-{}", slot_byte(slot)).into_bytes();
            create_slot_native(&store, slot, &record).unwrap();

            assert_eq!(
                DesktopProductionCustody::load_or_create_for_rebootstrap_test_with_store(
                    &root,
                    store.clone(),
                )
                .unwrap_err(),
                DesktopCustodyError::Rejected,
                "{slot:?}"
            );
            assert!(!root.business_database_path().exists(), "{slot:?}");
            assert_eq!(
                load_active_alias_for_test(&store).unwrap(),
                None,
                "{slot:?}"
            );
            assert_eq!(load_slot_native(&store, slot).unwrap(), Some(record));
        }
    }

    #[test]
    fn device_binding_record_requires_public_digest_and_rejects_seed_shape() {
        let digest = [7_u8; 32];
        let wire = serde_json::json!({
            "schemaVersion": 1,
            "deviceId": "device-test",
            "installationBindingDigest": URL_SAFE_NO_PAD.encode(digest),
        });
        let encoded = serde_json::to_vec(&wire).unwrap();
        let loaded = decode_device_binding(&encoded).unwrap();
        assert_eq!(loaded.device_id, "device-test");
        assert_eq!(loaded.installation_binding_digest, digest);

        let legacy = serde_json::json!({
            "schemaVersion": 1,
            "deviceId": "device-test",
            "keyId": "key-test",
            "seed": URL_SAFE_NO_PAD.encode(digest),
        });
        let encoded = serde_json::to_vec(&legacy).unwrap();
        assert_eq!(
            decode_device_binding(&encoded).unwrap_err(),
            DesktopCustodyError::Rejected
        );
    }

    #[cfg(unix)]
    #[test]
    fn continuity_receipts_use_fixed_atomic_slots_and_reject_substitution() {
        use std::os::unix::fs::{PermissionsExt as _, symlink};

        let parent = tempfile::tempdir().unwrap();
        let receipts = parent.path().join("receipts");
        let store = DesktopContinuityReceiptStore::for_test(&receipts).unwrap();
        assert!(!store.any_receipt().unwrap());
        store.store(0, b"sealed-a").unwrap();
        assert_eq!(store.load(0).unwrap().unwrap().as_slice(), b"sealed-a");
        store.store(0, b"sealed-a-2").unwrap();
        assert_eq!(store.load(0).unwrap().unwrap().as_slice(), b"sealed-a-2");
        assert!(store.any_receipt().unwrap());
        assert_eq!(store.load(2).unwrap_err(), DesktopCustodyError::Rejected);

        let receipt = receipts.join("receipt-b.bin");
        let target = parent.path().join("target.bin");
        std::fs::write(&target, b"target").unwrap();
        std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o600)).unwrap();
        symlink(&target, &receipt).unwrap();
        assert_eq!(store.load(1).unwrap_err(), DesktopCustodyError::Rejected);
        assert_eq!(
            store.store(1, b"sealed-b").unwrap_err(),
            DesktopCustodyError::Rejected
        );
        assert_eq!(std::fs::read(target).unwrap(), b"target");
    }

    #[cfg(unix)]
    #[test]
    fn rejects_active_workspace_and_process_lock_symlink_substitution() {
        use std::os::unix::fs::symlink;

        let parent = tempfile::tempdir().unwrap();
        // macOS tempdir commonly resolves through `/var`; validation intentionally
        // rejects symlinked path components, so use the canonical parent for the
        // admitted application root fixture.
        let canonical_parent = parent.path().canonicalize().unwrap();
        let app = canonical_parent.join("GoodDealer");
        let root = DesktopApplicationRoot::validate(&app).unwrap();
        let target = parent.path().join("redirected");
        std::fs::create_dir(&target).unwrap();
        symlink(&target, app.join("active-workspace")).unwrap();
        assert_eq!(
            DesktopProductionCustody::load_or_create(&root).unwrap_err(),
            DesktopCustodyError::Rejected
        );

        std::fs::remove_file(app.join("active-workspace")).unwrap();
        std::fs::remove_file(app.join(".desktop-local-host.lock")).unwrap();
        let lock_target = parent.path().join("lock-target");
        std::fs::write(&lock_target, b"lock").unwrap();
        symlink(&lock_target, app.join(".desktop-local-host.lock")).unwrap();
        assert_eq!(
            acquire_process_lock(&root).unwrap_err(),
            DesktopCustodyError::StorageRejected
        );
    }

    #[cfg(unix)]
    #[test]
    fn active_workspace_creation_is_single_level_and_rejects_symlink() {
        use std::os::unix::fs::symlink;

        let parent = tempfile::tempdir().unwrap();
        let canonical_parent = parent.path().canonicalize().unwrap();
        let app = canonical_parent.join("GoodDealer");
        let root = DesktopApplicationRoot::validate(&app).unwrap();
        let database_path = root.business_database_path();
        let active = database_path.parent().unwrap();
        let directory = ensure_active_workspace(&root).unwrap();
        assert!(active.is_dir());
        drop(directory);

        let redirected = canonical_parent.join("redirected");
        std::fs::create_dir(&redirected).unwrap();
        std::fs::remove_dir(active).unwrap();
        symlink(&redirected, active).unwrap();
        assert_eq!(
            ensure_active_workspace(&root).unwrap_err(),
            DesktopCustodyError::Rejected
        );
    }

    #[cfg(unix)]
    #[test]
    fn admitted_database_rejects_symlink_and_group_writable_file() {
        use std::os::unix::fs::{PermissionsExt as _, symlink};

        let parent = tempfile::tempdir().unwrap();
        let target = parent.path().join("target.db");
        std::fs::write(&target, b"db").unwrap();
        std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o600)).unwrap();
        let link = parent.path().join("business.db");
        symlink(&target, &link).unwrap();
        let directory = File::open(parent.path()).unwrap();
        assert_eq!(
            open_existing_database(&directory).unwrap_err(),
            DesktopCustodyError::Rejected
        );

        std::fs::remove_file(&link).unwrap();
        let business = parent.path().join("business.db");
        std::fs::rename(&target, &business).unwrap();
        let file = open_existing_database(&directory).unwrap().unwrap();
        drop(file);
        std::fs::set_permissions(&business, std::fs::Permissions::from_mode(0o660)).unwrap();
        assert_eq!(
            open_existing_database(&directory).unwrap_err(),
            DesktopCustodyError::Rejected
        );
    }

    #[cfg(unix)]
    #[test]
    fn path_identity_detects_inode_swap_and_missing_path() {
        use std::os::unix::fs::PermissionsExt as _;

        let parent = tempfile::tempdir().unwrap();
        let path = parent.path().join("business.db");
        let directory = File::open(parent.path()).unwrap();
        let file = create_admitted_database(&directory).unwrap();
        let identity = file_identity(&file).unwrap();
        let moved = parent.path().join("business.old");
        std::fs::rename(&path, &moved).unwrap();
        std::fs::write(&path, b"replacement").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
        assert!(ensure_path_identity(&path, identity).is_err());
        assert!(ensure_file_identity(&file, identity).is_ok());
    }

    #[cfg(unix)]
    #[test]
    fn journal_store_round_trips_and_rejects_symlink_hardlink_and_oversize() {
        use std::os::unix::fs::{PermissionsExt as _, symlink};

        let parent = tempfile::tempdir().unwrap();
        let journal = parent.path().join("journal.jsonl");
        let store = DesktopJournalStore::for_test(journal.clone()).unwrap();
        assert_eq!(store.read_last().unwrap(), None);
        store.append(br#"{"phase":"prepared"}"#).unwrap();
        store.append(br#"{"phase":"verified"}"#).unwrap();
        assert_eq!(
            store.read_all().unwrap(),
            vec![
                br#"{"phase":"prepared"}"#.to_vec(),
                br#"{"phase":"verified"}"#.to_vec()
            ]
        );
        assert_eq!(
            store.read_last().unwrap().unwrap(),
            br#"{"phase":"verified"}"#
        );

        let original = std::fs::read(&journal).unwrap();
        let mut overwritten = original.clone();
        overwritten[1] ^= 1;
        assert_eq!(
            store
                .read_all_with_between_reads_for_test(|| {
                    std::fs::write(&journal, &overwritten)
                        .map_err(|_| DesktopCustodyError::StorageRejected)
                })
                .unwrap_err(),
            DesktopCustodyError::Rejected
        );
        std::fs::write(&journal, &original).unwrap();

        std::fs::remove_file(&journal).unwrap();
        let target = parent.path().join("target");
        std::fs::write(&target, b"target").unwrap();
        std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o600)).unwrap();
        symlink(&target, &journal).unwrap();
        assert!(store.read_last().is_err());
        assert!(store.append(b"record").is_err());

        std::fs::remove_file(&journal).unwrap();
        std::fs::hard_link(&target, &journal).unwrap();
        assert_eq!(
            store.read_last().unwrap_err(),
            DesktopCustodyError::Rejected
        );
        std::fs::remove_file(&journal).unwrap();

        std::fs::write(&journal, br#"{"phase":"prepared"}"#).unwrap();
        std::fs::set_permissions(&journal, std::fs::Permissions::from_mode(0o600)).unwrap();
        let truncated = DesktopJournalStore::for_test(journal.clone()).unwrap();
        assert_eq!(
            truncated.read_all().unwrap_err(),
            DesktopCustodyError::Rejected
        );
        std::fs::remove_file(&journal).unwrap();

        let oversized = vec![b'x'; MAX_REBOOTSTRAP_JOURNAL_BYTES + 1];
        std::fs::write(&journal, oversized).unwrap();
        std::fs::set_permissions(&journal, std::fs::Permissions::from_mode(0o600)).unwrap();
        assert_eq!(
            store.read_last().unwrap_err(),
            DesktopCustodyError::Rejected
        );
    }

    #[cfg(unix)]
    #[test]
    fn journal_framing_enforces_every_declared_size_and_record_boundary() {
        use std::os::unix::fs::PermissionsExt as _;

        fn write_journal(path: &Path, bytes: &[u8]) {
            std::fs::write(path, bytes).unwrap();
            std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600)).unwrap();
        }

        let parent = tempfile::tempdir().unwrap();
        let journal = parent.path().join("empty.jsonl");
        write_journal(&journal, b"");
        let store = DesktopJournalStore::for_test(journal).unwrap();
        assert_eq!(store.read_all().unwrap_err(), DesktopCustodyError::Rejected);

        let journal = parent.path().join("exact-limit.jsonl");
        let mut exact = Vec::with_capacity(MAX_REBOOTSTRAP_JOURNAL_BYTES);
        for _ in 0..63 {
            exact.extend(std::iter::repeat_n(b'x', MAX_REBOOTSTRAP_RECORD_BYTES));
            exact.push(b'\n');
        }
        let final_record_bytes = MAX_REBOOTSTRAP_JOURNAL_BYTES - exact.len() - 1;
        exact.extend(std::iter::repeat_n(b'y', final_record_bytes));
        exact.push(b'\n');
        assert_eq!(exact.len(), MAX_REBOOTSTRAP_JOURNAL_BYTES);
        write_journal(&journal, &exact);
        let store = DesktopJournalStore::for_test(journal).unwrap();
        let records = store.read_all().unwrap();
        assert_eq!(records.len(), 64);
        assert_eq!(records.first().unwrap().len(), MAX_REBOOTSTRAP_RECORD_BYTES);
        assert_eq!(records.last().unwrap().len(), final_record_bytes);
        assert_eq!(store.read_last().unwrap(), records.last().cloned());

        let journal = parent.path().join("over-limit.jsonl");
        let mut over_limit = exact;
        over_limit.push(b'\n');
        assert_eq!(over_limit.len(), MAX_REBOOTSTRAP_JOURNAL_BYTES + 1);
        write_journal(&journal, &over_limit);
        let store = DesktopJournalStore::for_test(journal).unwrap();
        assert_eq!(store.read_all().unwrap_err(), DesktopCustodyError::Rejected);

        for (name, bytes) in [
            ("missing-final-newline.jsonl", b"record".as_slice()),
            ("blank-line.jsonl", b"first\n\nsecond\n".as_slice()),
        ] {
            let journal = parent.path().join(name);
            write_journal(&journal, bytes);
            let store = DesktopJournalStore::for_test(journal).unwrap();
            assert_eq!(
                store.read_all().unwrap_err(),
                DesktopCustodyError::Rejected,
                "{name}"
            );
        }

        let journal = parent.path().join("oversize-record.jsonl");
        let mut oversized_record = vec![b'x'; MAX_REBOOTSTRAP_RECORD_BYTES + 1];
        oversized_record.push(b'\n');
        write_journal(&journal, &oversized_record);
        let store = DesktopJournalStore::for_test(journal).unwrap();
        assert_eq!(store.read_all().unwrap_err(), DesktopCustodyError::Rejected);

        let journal = parent.path().join("too-many-records.jsonl");
        let too_many_records = b"x\n".repeat(MAX_REBOOTSTRAP_JOURNAL_RECORDS + 1);
        write_journal(&journal, &too_many_records);
        let store = DesktopJournalStore::for_test(journal).unwrap();
        assert_eq!(store.read_all().unwrap_err(), DesktopCustodyError::Rejected);
    }

    #[cfg(unix)]
    #[test]
    fn journal_exact_positional_read_rejects_short_and_extra_data() {
        let parent = tempfile::tempdir().unwrap();
        let journal = parent.path().join("journal.jsonl");
        std::fs::write(&journal, b"abc").unwrap();
        let file = File::open(journal).unwrap();

        assert_eq!(read_journal_exact_at(&file, 3).unwrap(), b"abc");
        assert_eq!(
            read_journal_exact_at(&file, 4).unwrap_err(),
            DesktopCustodyError::Rejected
        );
        assert_eq!(
            read_journal_exact_at(&file, 2).unwrap_err(),
            DesktopCustodyError::Rejected
        );
    }

    #[cfg(unix)]
    #[test]
    fn journal_stable_snapshot_rejects_every_cooperative_between_read_mutation() {
        use std::io::{Seek as _, SeekFrom};
        use std::os::unix::fs::PermissionsExt as _;

        for mutation in [
            "append",
            "truncate",
            "overwrite",
            "overwrite_restore",
            "swap",
        ] {
            let parent = tempfile::tempdir().unwrap();
            let journal = parent.path().join("journal.jsonl");
            let original = b"{\"phase\":\"prepared\"}\n".to_vec();
            std::fs::write(&journal, &original).unwrap();
            std::fs::set_permissions(&journal, std::fs::Permissions::from_mode(0o600)).unwrap();
            let store = DesktopJournalStore::for_test(journal.clone()).unwrap();

            let result = store.read_all_with_between_reads_for_test(|| {
                match mutation {
                    "append" => {
                        let mut file = std::fs::OpenOptions::new()
                            .append(true)
                            .open(&journal)
                            .map_err(|_| DesktopCustodyError::StorageRejected)?;
                        file.write_all(b"{\"phase\":\"verified\"}\n")
                            .map_err(|_| DesktopCustodyError::StorageRejected)?;
                        file.sync_all()
                            .map_err(|_| DesktopCustodyError::StorageRejected)?;
                    }
                    "truncate" => {
                        std::fs::OpenOptions::new()
                            .write(true)
                            .open(&journal)
                            .and_then(|file| file.set_len(4))
                            .map_err(|_| DesktopCustodyError::StorageRejected)?;
                    }
                    "overwrite" => {
                        let mut changed = original.clone();
                        changed[1] ^= 1;
                        std::fs::write(&journal, changed)
                            .map_err(|_| DesktopCustodyError::StorageRejected)?;
                    }
                    "overwrite_restore" => {
                        let mut file = std::fs::OpenOptions::new()
                            .write(true)
                            .open(&journal)
                            .map_err(|_| DesktopCustodyError::StorageRejected)?;
                        file.write_all(b"[")
                            .and_then(|()| file.seek(SeekFrom::Start(0)).map(|_| ()))
                            .and_then(|()| file.write_all(&original))
                            .and_then(|()| file.sync_all())
                            .map_err(|_| DesktopCustodyError::StorageRejected)?;
                    }
                    "swap" => {
                        let parked = parent.path().join("journal.parked");
                        std::fs::rename(&journal, parked)
                            .map_err(|_| DesktopCustodyError::StorageRejected)?;
                        std::fs::write(&journal, &original)
                            .map_err(|_| DesktopCustodyError::StorageRejected)?;
                        std::fs::set_permissions(&journal, std::fs::Permissions::from_mode(0o600))
                            .map_err(|_| DesktopCustodyError::StorageRejected)?;
                    }
                    _ => return Err(DesktopCustodyError::Rejected),
                }
                Ok(())
            });
            assert_eq!(
                result.unwrap_err(),
                DesktopCustodyError::Rejected,
                "{mutation}"
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn journal_append_serializes_after_a_stable_snapshot() {
        use std::sync::mpsc;
        use std::time::Duration;

        let parent = tempfile::tempdir().unwrap();
        let journal = parent.path().join("journal.jsonl");
        let store = Arc::new(DesktopJournalStore::for_test(journal).unwrap());
        store.append(br#"{"phase":"prepared"}"#).unwrap();
        let (snapshot_ready_tx, snapshot_ready_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let reader_store = Arc::clone(&store);
        let reader = std::thread::spawn(move || {
            reader_store.read_all_with_between_reads_for_test(|| {
                snapshot_ready_tx.send(()).unwrap();
                release_rx.recv().unwrap();
                Ok(())
            })
        });
        snapshot_ready_rx
            .recv_timeout(Duration::from_secs(5))
            .unwrap();

        let (append_done_tx, append_done_rx) = mpsc::channel();
        let append_store = Arc::clone(&store);
        let appender = std::thread::spawn(move || {
            let result = append_store.append(br#"{"phase":"verified"}"#);
            append_done_tx.send(()).unwrap();
            result
        });
        assert!(
            append_done_rx
                .recv_timeout(Duration::from_millis(50))
                .is_err()
        );
        release_tx.send(()).unwrap();

        assert_eq!(
            reader.join().unwrap().unwrap(),
            vec![br#"{"phase":"prepared"}"#.to_vec()]
        );
        append_done_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        appender.join().unwrap().unwrap();
        assert_eq!(
            store.read_all().unwrap(),
            vec![
                br#"{"phase":"prepared"}"#.to_vec(),
                br#"{"phase":"verified"}"#.to_vec()
            ]
        );
    }

    #[cfg(unix)]
    #[test]
    fn journal_identity_detects_path_swap_after_admission() {
        use std::os::unix::fs::PermissionsExt as _;

        let parent = tempfile::tempdir().unwrap();
        let journal = parent.path().join("journal.jsonl");
        let store = DesktopJournalStore::for_test(journal.clone()).unwrap();
        store.append(b"record").unwrap();
        let directory = File::open(parent.path()).unwrap();
        let admitted = open_journal_optional(&directory, "journal.jsonl")
            .unwrap()
            .unwrap();
        let replacement = parent.path().join("journal.replacement");
        std::fs::rename(&journal, replacement).unwrap();
        std::fs::write(&journal, b"replacement\n").unwrap();
        std::fs::set_permissions(&journal, std::fs::Permissions::from_mode(0o600)).unwrap();
        assert_eq!(
            ensure_named_file_identity(&directory, "journal.jsonl", &admitted).unwrap_err(),
            DesktopCustodyError::Rejected
        );
        assert!(store.read_last().is_err());
    }

    #[cfg(unix)]
    #[test]
    fn candidate_cleanup_requires_retained_exact_identity_and_rejects_links() {
        use std::os::unix::fs::{PermissionsExt as _, symlink};

        let parent = tempfile::tempdir().unwrap();
        let directory = File::open(parent.path()).unwrap();
        let candidate = parent.path().join("rebootstrap-a.db");
        std::fs::write(&candidate, b"candidate").unwrap();
        std::fs::set_permissions(&candidate, std::fs::Permissions::from_mode(0o600)).unwrap();
        let admitted = File::open(&candidate).unwrap();
        let identity = file_identity(&admitted).unwrap();
        ensure_named_identity(&directory, "rebootstrap-a.db", identity).unwrap();
        unlink_named_file(&directory, "rebootstrap-a.db").unwrap();
        assert!(!candidate.exists());

        let target = parent.path().join("target.db");
        std::fs::write(&target, b"target").unwrap();
        std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o600)).unwrap();
        let target_identity = file_identity(&File::open(&target).unwrap()).unwrap();
        symlink(&target, &candidate).unwrap();
        assert_eq!(
            ensure_named_identity(&directory, "rebootstrap-a.db", identity).unwrap_err(),
            DesktopCustodyError::Rejected
        );
        assert!(target.exists());

        std::fs::remove_file(&candidate).unwrap();
        std::fs::hard_link(&target, &candidate).unwrap();
        assert_eq!(
            ensure_named_identity(&directory, "rebootstrap-a.db", target_identity,).unwrap_err(),
            DesktopCustodyError::Rejected
        );
    }

    #[cfg(unix)]
    #[test]
    fn database_create_exclusive_and_existing_open_bind_inode() {
        use std::os::unix::fs::PermissionsExt as _;

        let parent = tempfile::tempdir().unwrap();
        let directory = File::open(parent.path()).unwrap();
        let path = parent.path().join("business.db");
        std::fs::write(&path, b"raced creation").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
        assert_eq!(
            create_admitted_database(&directory).unwrap_err(),
            DesktopCustodyError::StorageRejected
        );

        let admitted = open_existing_database(&directory).unwrap().unwrap();
        let identity = file_identity(&admitted).unwrap();
        let moved = parent.path().join("business.old");
        std::fs::rename(&path, moved).unwrap();
        std::fs::write(&path, b"replacement").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
        assert!(ensure_path_identity(&path, identity).is_err());
    }
}
