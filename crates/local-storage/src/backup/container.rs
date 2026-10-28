//! DesktopLocalHost-private GDBK v1 container and installation backup-key custody.
//!
//! This module deliberately has no public export. The owning local-storage aggregate composes its
//! native file-handle, projection, and restore state directly in this crate; callers never get a
//! generic decrypt operation, key material, plaintext ownership, or path-based authority.

use std::fmt;
use std::sync::atomic::{AtomicU64, Ordering};

use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{Key, XChaCha20Poly1305, XNonce};
use ring::hkdf;
use sha2::{Digest, Sha256};
use zeroize::{Zeroize, Zeroizing};

const MAGIC: &[u8; 8] = b"GDBK\0V1\0";
const FORMAT_VERSION: u16 = 1;
const CRYPTO_SUITE: u16 = 1;
const KEY_WRAP_SUITE: u16 = 1;
const MANIFEST_VERSION: u16 = 1;
const TRAILER_VERSION: u16 = 1;
const HEADER_MAX_BYTES: usize = 8_192;
const FRAME_PLAINTEXT_LIMIT: usize = 1_048_576;
const FRAME_PLAINTEXT_LIMIT_WIRE: u32 = 1_048_576;
pub(super) const ARTIFACT_BYTE_LIMIT: usize = 536_870_912;
const ARTIFACT_BYTE_LIMIT_WIRE: u64 = 536_870_912;
const FRAME_LIMIT: usize = 16_384;
const AEAD_TAG_BYTES: usize = 16;
const AEAD_TAG_BYTES_WIRE: u32 = 16;
const CONTENT_KEY_BYTES: usize = 32;
const NONCE_BYTES: usize = 24;
const DIGEST_BYTES: usize = 32;
const FRAME_HEADER_BYTES: usize = 17;
const WRAPPED_KEY_BYTES: usize = NONCE_BYTES + CONTENT_KEY_BYTES + AEAD_TAG_BYTES;
const SLOT_ID_MAX_BYTES: usize = 64;
const SLOT_VERSION_BYTES: usize = 8;
const SLOT_VERSION_BYTES_WIRE: u8 = 8;
const MAX_RETAINED_KEKS: usize = 3;
const MANIFEST_PLAINTEXT_BYTES: usize = 2 + (6 * DIGEST_BYTES) + 8 + 8 + 4 + 4 + 8;
const TRAILER_PLAINTEXT_BYTES: usize = 2 + 8 + 8 + 8 + DIGEST_BYTES;
const WRAP_DOMAIN: &[u8] = b"GOODDEALER/GDBK-WRAP-V1";
const FRAME_DOMAIN: &[u8] = b"GOODDEALER/GDBK-FRAME-V1";
const KEK_PURPOSE: &[u8] = b"GOODDEALER/BACKUP-KEK-V1";
const KEK_REGISTRY_MAGIC: &[u8; 8] = b"GDBKKEK1";
const KEK_REGISTRY_VERSION: u16 = 1;
const KEK_REGISTRY_MAX_BYTES: usize = 512;
#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "the anchor wire format remains private until an independent monotonic adapter is qualified"
    )
)]
const KEK_ANCHOR_MAGIC: &[u8; 8] = b"GDBKANC1";
#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "the anchor wire format remains private until an independent monotonic adapter is qualified"
    )
)]
const KEK_ANCHOR_VERSION: u16 = 1;
#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "the anchor wire format remains private until an independent monotonic adapter is qualified"
    )
)]
const KEK_ANCHOR_BYTES: usize = 8 + 2 + 8 + DIGEST_BYTES + DIGEST_BYTES;
#[cfg(target_os = "macos")]
const KEK_KEYCHAIN_SERVICE: &str = "com.gooddealer.desktop.backup-kek.v1";
#[cfg(target_os = "macos")]
const KEK_KEYCHAIN_ACCOUNT: &str = "backup-wrap-v1";
#[cfg(target_os = "macos")]
#[expect(
    dead_code,
    reason = "native KEK custody remains private until its monotonic anchor is production-qualified"
)]
const KEK_LOCK_DIRECTORY_PREFIX: &str = "app.gooddealer.desktop.backup-kek-custody-v1";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
enum FrameKind {
    Manifest = 0,
    Data = 1,
    Trailer = 2,
}

impl FrameKind {
    fn parse(value: u8) -> Result<Self, BackupContainerError> {
        match value {
            0 => Ok(Self::Manifest),
            1 => Ok(Self::Data),
            2 => Ok(Self::Trailer),
            _ => Err(BackupContainerError::ArtifactRejected),
        }
    }
}

/// Deliberately coarse errors: neither parser position nor cryptographic cause becomes an oracle.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum BackupContainerError {
    ArtifactRejected,
    KeyUnavailable,
    AuthorityRejected,
}

impl fmt::Debug for BackupContainerError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::ArtifactRejected => "BackupContainerError::ArtifactRejected",
            Self::KeyUnavailable => "BackupContainerError::KeyUnavailable",
            Self::AuthorityRejected => "BackupContainerError::AuthorityRejected",
        })
    }
}

impl fmt::Display for BackupContainerError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::ArtifactRejected => "BACKUP_ARTIFACT_REJECTED",
            Self::KeyUnavailable => "BACKUP_KEY_UNAVAILABLE",
            Self::AuthorityRejected => "BACKUP_AUTHORITY_REJECTED",
        })
    }
}

impl std::error::Error for BackupContainerError {}

#[derive(Clone, PartialEq, Eq)]
pub(super) struct KekReference {
    id: Vec<u8>,
    version: u64,
}

impl KekReference {
    fn validate(&self) -> Result<(), BackupContainerError> {
        if self.id.is_empty() || self.id.len() > SLOT_ID_MAX_BYTES || self.version == 0 {
            return Err(BackupContainerError::KeyUnavailable);
        }
        Ok(())
    }
}

impl fmt::Debug for KekReference {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("KekReference([REDACTED])")
    }
}

struct BackupKekSlot {
    reference: KekReference,
    material: Zeroizing<[u8; CONTENT_KEY_BYTES]>,
    encrypt_enabled: bool,
}

/// Monotonic state supplied independently from the rollbackable custody blob.
///
/// The digest covers the complete exact blob, so both rotation and retirement advance the anchor.
/// A blob cannot authenticate its own freshness by carrying another copy of these fields.
#[derive(Clone, PartialEq, Eq)]
pub(super) struct BackupKekRollbackAnchor {
    highest_kek_version: u64,
    installation_proof: [u8; DIGEST_BYTES],
    custody_blob_digest: [u8; DIGEST_BYTES],
}

impl fmt::Debug for BackupKekRollbackAnchor {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("BackupKekRollbackAnchor([REDACTED])")
    }
}

impl BackupKekRollbackAnchor {
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "anchor persistence remains private until an independent monotonic adapter is qualified"
        )
    )]
    fn encode(&self) -> [u8; KEK_ANCHOR_BYTES] {
        let mut bytes = [0_u8; KEK_ANCHOR_BYTES];
        bytes[..8].copy_from_slice(KEK_ANCHOR_MAGIC);
        bytes[8..10].copy_from_slice(&KEK_ANCHOR_VERSION.to_be_bytes());
        bytes[10..18].copy_from_slice(&self.highest_kek_version.to_be_bytes());
        bytes[18..50].copy_from_slice(&self.installation_proof);
        bytes[50..82].copy_from_slice(&self.custody_blob_digest);
        bytes
    }

    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "anchor persistence remains private until an independent monotonic adapter is qualified"
        )
    )]
    fn decode(bytes: &[u8]) -> Result<Self, BackupContainerError> {
        if bytes.len() != KEK_ANCHOR_BYTES
            || &bytes[..8] != KEK_ANCHOR_MAGIC
            || u16::from_be_bytes(
                bytes[8..10]
                    .try_into()
                    .map_err(|_| BackupContainerError::KeyUnavailable)?,
            ) != KEK_ANCHOR_VERSION
        {
            return Err(BackupContainerError::KeyUnavailable);
        }
        let anchor = Self {
            highest_kek_version: u64::from_be_bytes(
                bytes[10..18]
                    .try_into()
                    .map_err(|_| BackupContainerError::KeyUnavailable)?,
            ),
            installation_proof: bytes[18..50]
                .try_into()
                .map_err(|_| BackupContainerError::KeyUnavailable)?,
            custody_blob_digest: bytes[50..82]
                .try_into()
                .map_err(|_| BackupContainerError::KeyUnavailable)?,
        };
        if anchor.highest_kek_version == 0 {
            return Err(BackupContainerError::KeyUnavailable);
        }
        Ok(anchor)
    }
}

/// Host-private durable port. No production implementation exists until Desktop can provide an
/// independently monotonic store; absence is a closed `BACKUP_KEY_UNAVAILABLE` outcome.
#[cfg_attr(
    test,
    expect(
        dead_code,
        reason = "the rollback-anchor port has no test consumer until production custody is qualified"
    )
)]
pub(super) trait BackupKekRollbackAnchorPort {
    fn load(&self) -> Result<Option<BackupKekRollbackAnchor>, BackupContainerError>;
}

#[cfg(target_os = "macos")]
#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "native KEK custody remains private until its monotonic anchor is production-qualified"
    )
)]
trait BackupKekCustodyPort: Send + Sync {
    fn load_registry_blob(&self) -> Result<Option<Zeroizing<Vec<u8>>>, BackupContainerError>;
    fn store_registry_blob(&self, bytes: &[u8]) -> Result<(), BackupContainerError>;
    fn load_anchor_blob(&self) -> Result<Option<Vec<u8>>, BackupContainerError>;
    fn store_anchor_blob(&self, bytes: &[u8]) -> Result<(), BackupContainerError>;
}

impl fmt::Debug for BackupKekSlot {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("BackupKekSlot([REDACTED])")
    }
}

/// Installation-owned registry. Its monotonic watermark and custody proof are checked on every
/// use, independently from session, Lease, operation, and database generations.
pub(super) struct BackupKekRegistry {
    slots: Vec<BackupKekSlot>,
    version_watermark: u64,
    installation_proof: [u8; DIGEST_BYTES],
}

impl fmt::Debug for BackupKekRegistry {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("BackupKekRegistry([REDACTED])")
    }
}

impl BackupKekRegistry {
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "native KEK creation remains private until custody and rollback protection are production-qualified"
        )
    )]
    fn generate_initial() -> Result<Self, BackupContainerError> {
        let mut material = Zeroizing::new([0_u8; CONTENT_KEY_BYTES]);
        let mut id = vec![0_u8; 16];
        let mut custody_proof = [0_u8; DIGEST_BYTES];
        getrandom::fill(&mut *material).map_err(|_| BackupContainerError::KeyUnavailable)?;
        getrandom::fill(&mut id).map_err(|_| BackupContainerError::KeyUnavailable)?;
        getrandom::fill(&mut custody_proof).map_err(|_| BackupContainerError::KeyUnavailable)?;
        Ok(Self {
            slots: vec![BackupKekSlot {
                reference: KekReference { id, version: 1 },
                material,
                encrypt_enabled: true,
            }],
            version_watermark: 1,
            installation_proof: custody_proof,
        })
    }

    /// Rotates to Host-generated material. At most three versions are retained.
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "native KEK rotation remains private until custody and rollback protection are production-qualified"
        )
    )]
    pub(super) fn rotate(&mut self) -> Result<(), BackupContainerError> {
        self.validate_structure()?;
        if self.slots.len() >= MAX_RETAINED_KEKS {
            return Err(BackupContainerError::KeyUnavailable);
        }
        let version = self
            .version_watermark
            .checked_add(1)
            .ok_or(BackupContainerError::KeyUnavailable)?;
        let mut material = Zeroizing::new([0_u8; CONTENT_KEY_BYTES]);
        let mut id = vec![0_u8; 16];
        getrandom::fill(&mut *material).map_err(|_| BackupContainerError::KeyUnavailable)?;
        getrandom::fill(&mut id).map_err(|_| BackupContainerError::KeyUnavailable)?;
        for slot in &mut self.slots {
            slot.encrypt_enabled = false;
        }
        self.slots.push(BackupKekSlot {
            reference: KekReference { id, version },
            material,
            encrypt_enabled: true,
        });
        self.version_watermark = version;
        Ok(())
    }

    /// A referenced slot cannot be retired; the catalog owner supplies only the reference fact.
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "native KEK retirement remains private until custody and rollback protection are production-qualified"
        )
    )]
    pub(super) fn retire(
        &mut self,
        reference: &KekReference,
        catalog_references_slot: bool,
    ) -> Result<(), BackupContainerError> {
        self.validate_structure()?;
        if catalog_references_slot {
            return Err(BackupContainerError::KeyUnavailable);
        }
        let position = self
            .slots
            .iter()
            .position(|slot| slot.reference == *reference)
            .ok_or(BackupContainerError::KeyUnavailable)?;
        if self.slots[position].encrypt_enabled {
            return Err(BackupContainerError::KeyUnavailable);
        }
        self.slots.remove(position);
        Ok(())
    }

    fn active(
        &self,
        anchor: &BackupKekRollbackAnchor,
    ) -> Result<&BackupKekSlot, BackupContainerError> {
        self.validate_anchor(anchor)?;
        self.slots
            .iter()
            .find(|slot| slot.encrypt_enabled)
            .ok_or(BackupContainerError::KeyUnavailable)
    }

    fn exact(
        &self,
        anchor: &BackupKekRollbackAnchor,
        reference: &KekReference,
    ) -> Result<&BackupKekSlot, BackupContainerError> {
        self.validate_anchor(anchor)?;
        self.slots
            .iter()
            .find(|slot| slot.reference == *reference)
            .ok_or(BackupContainerError::KeyUnavailable)
    }

    fn validate_structure(&self) -> Result<(), BackupContainerError> {
        if self.slots.is_empty()
            || self.slots.len() > MAX_RETAINED_KEKS
            || self.version_watermark == 0
            || self
                .slots
                .iter()
                .filter(|slot| slot.encrypt_enabled)
                .count()
                != 1
        {
            return Err(BackupContainerError::KeyUnavailable);
        }

        let active = self
            .slots
            .iter()
            .find(|slot| slot.encrypt_enabled)
            .ok_or(BackupContainerError::KeyUnavailable)?;
        if active.reference.version != self.version_watermark {
            return Err(BackupContainerError::KeyUnavailable);
        }
        for (index, slot) in self.slots.iter().enumerate() {
            slot.reference.validate()?;
            if slot.reference.version > self.version_watermark
                || index > 0 && self.slots[index - 1].reference.version >= slot.reference.version
                || self.slots[..index].iter().any(|prior| {
                    prior.reference == slot.reference
                        || prior.reference.version == slot.reference.version
                        || prior.reference.id == slot.reference.id
                })
            {
                return Err(BackupContainerError::KeyUnavailable);
            }
        }
        Ok(())
    }

    fn current_anchor(&self) -> Result<BackupKekRollbackAnchor, BackupContainerError> {
        let blob = self.encode_custody()?;
        Ok(BackupKekRollbackAnchor {
            highest_kek_version: self.version_watermark,
            installation_proof: self.installation_proof,
            custody_blob_digest: Sha256::digest(&blob).into(),
        })
    }

    fn validate_anchor(
        &self,
        anchor: &BackupKekRollbackAnchor,
    ) -> Result<(), BackupContainerError> {
        self.validate_structure()?;
        let current = self.current_anchor()?;
        if &current != anchor {
            return Err(BackupContainerError::KeyUnavailable);
        }
        Ok(())
    }

    fn encode_custody(&self) -> Result<Zeroizing<Vec<u8>>, BackupContainerError> {
        self.validate_structure()?;
        let mut bytes = Zeroizing::new(Vec::with_capacity(KEK_REGISTRY_MAX_BYTES));
        bytes.extend_from_slice(KEK_REGISTRY_MAGIC);
        bytes.extend_from_slice(&KEK_REGISTRY_VERSION.to_be_bytes());
        bytes.extend_from_slice(&self.version_watermark.to_be_bytes());
        bytes.extend_from_slice(&self.installation_proof);
        bytes.push(
            u8::try_from(self.slots.len()).map_err(|_| BackupContainerError::KeyUnavailable)?,
        );
        for slot in &self.slots {
            bytes.push(
                u8::try_from(slot.reference.id.len())
                    .map_err(|_| BackupContainerError::KeyUnavailable)?,
            );
            bytes.extend_from_slice(&slot.reference.id);
            bytes.extend_from_slice(&slot.reference.version.to_be_bytes());
            bytes.push(u8::from(slot.encrypt_enabled));
            bytes.extend_from_slice(&*slot.material);
        }
        if bytes.len() > KEK_REGISTRY_MAX_BYTES {
            return Err(BackupContainerError::KeyUnavailable);
        }
        Ok(bytes)
    }

    #[allow(
        dead_code,
        reason = "private custody decoder is retained for qualified native composition"
    )]
    fn decode_custody(
        bytes: &[u8],
        anchor: Option<&BackupKekRollbackAnchor>,
    ) -> Result<Self, BackupContainerError> {
        let anchor = anchor.ok_or(BackupContainerError::KeyUnavailable)?;
        if bytes.len() > KEK_REGISTRY_MAX_BYTES {
            return Err(BackupContainerError::KeyUnavailable);
        }
        let mut cursor = Cursor::new(bytes);
        if cursor
            .bytes(KEK_REGISTRY_MAGIC.len())
            .map_err(|_| BackupContainerError::KeyUnavailable)?
            != KEK_REGISTRY_MAGIC
            || cursor
                .u16()
                .map_err(|_| BackupContainerError::KeyUnavailable)?
                != KEK_REGISTRY_VERSION
        {
            return Err(BackupContainerError::KeyUnavailable);
        }
        let version_watermark = cursor
            .u64()
            .map_err(|_| BackupContainerError::KeyUnavailable)?;
        let custody_proof = cursor
            .array()
            .map_err(|_| BackupContainerError::KeyUnavailable)?;
        let slot_count = usize::from(
            cursor
                .u8()
                .map_err(|_| BackupContainerError::KeyUnavailable)?,
        );
        if slot_count == 0 || slot_count > MAX_RETAINED_KEKS {
            return Err(BackupContainerError::KeyUnavailable);
        }
        let mut slots = Vec::with_capacity(slot_count);
        for _ in 0..slot_count {
            let id_len = usize::from(
                cursor
                    .u8()
                    .map_err(|_| BackupContainerError::KeyUnavailable)?,
            );
            if id_len == 0 || id_len > SLOT_ID_MAX_BYTES {
                return Err(BackupContainerError::KeyUnavailable);
            }
            let id = cursor
                .bytes(id_len)
                .map_err(|_| BackupContainerError::KeyUnavailable)?
                .to_vec();
            let version = cursor
                .u64()
                .map_err(|_| BackupContainerError::KeyUnavailable)?;
            let encrypt_enabled = match cursor
                .u8()
                .map_err(|_| BackupContainerError::KeyUnavailable)?
            {
                0 => false,
                1 => true,
                _ => return Err(BackupContainerError::KeyUnavailable),
            };
            let material_bytes = cursor
                .bytes(CONTENT_KEY_BYTES)
                .map_err(|_| BackupContainerError::KeyUnavailable)?;
            let mut material = Zeroizing::new([0_u8; CONTENT_KEY_BYTES]);
            material.copy_from_slice(material_bytes);
            slots.push(BackupKekSlot {
                reference: KekReference { id, version },
                material,
                encrypt_enabled,
            });
        }
        cursor
            .finish()
            .map_err(|_| BackupContainerError::KeyUnavailable)?;
        let registry = Self {
            slots,
            version_watermark,
            installation_proof: custody_proof,
        };
        registry.validate_anchor(anchor)?;
        Ok(registry)
    }

    #[cfg(test)]
    fn deterministic(material: [u8; CONTENT_KEY_BYTES], id: &[u8]) -> Self {
        let custody_proof = [0xC3; DIGEST_BYTES];
        Self {
            slots: vec![BackupKekSlot {
                reference: KekReference {
                    id: id.to_vec(),
                    version: 1,
                },
                material: Zeroizing::new(material),
                encrypt_enabled: true,
            }],
            version_watermark: 1,
            installation_proof: custody_proof,
        }
    }

    #[cfg(test)]
    fn rotate_deterministic(
        &mut self,
        material: [u8; CONTENT_KEY_BYTES],
        id: &[u8],
    ) -> Result<(), BackupContainerError> {
        self.validate_structure()?;
        if self.slots.len() >= MAX_RETAINED_KEKS || id.is_empty() || id.len() > SLOT_ID_MAX_BYTES {
            return Err(BackupContainerError::KeyUnavailable);
        }
        let version = self
            .version_watermark
            .checked_add(1)
            .ok_or(BackupContainerError::KeyUnavailable)?;
        for slot in &mut self.slots {
            slot.encrypt_enabled = false;
        }
        self.slots.push(BackupKekSlot {
            reference: KekReference {
                id: id.to_vec(),
                version,
            },
            material: Zeroizing::new(material),
            encrypt_enabled: true,
        });
        self.version_watermark = version;
        self.validate_structure()
    }
}

impl Drop for BackupKekRegistry {
    fn drop(&mut self) {
        for slot in &mut self.slots {
            slot.material.zeroize();
        }
        self.installation_proof.zeroize();
    }
}

#[derive(Clone)]
pub(super) struct BackupManifest {
    account_digest: [u8; DIGEST_BYTES],
    device_digest: [u8; DIGEST_BYTES],
    workspace_digest: [u8; DIGEST_BYTES],
    binding_digest: [u8; DIGEST_BYTES],
    source_proof_digest: [u8; DIGEST_BYTES],
    workspace_schema_version: u64,
    created_at_epoch_seconds: u64,
    allowlist_version: u32,
    data_frame_count: u32,
    data_plaintext_bytes: u64,
    authority_floor_digest: [u8; DIGEST_BYTES],
}

impl BackupManifest {
    #[allow(
        clippy::too_many_arguments,
        reason = "the fixed GDBK manifest has no optional or caller-defined fields"
    )]
    pub(super) const fn new(
        account_digest: [u8; DIGEST_BYTES],
        device_digest: [u8; DIGEST_BYTES],
        workspace_digest: [u8; DIGEST_BYTES],
        binding_digest: [u8; DIGEST_BYTES],
        source_proof_digest: [u8; DIGEST_BYTES],
        workspace_schema_version: u64,
        created_at_epoch_seconds: u64,
        allowlist_version: u32,
        data_frame_count: u32,
        data_plaintext_bytes: u64,
        authority_floor_digest: [u8; DIGEST_BYTES],
    ) -> Self {
        Self {
            account_digest,
            device_digest,
            workspace_digest,
            binding_digest,
            source_proof_digest,
            workspace_schema_version,
            created_at_epoch_seconds,
            allowlist_version,
            data_frame_count,
            data_plaintext_bytes,
            authority_floor_digest,
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) const fn from_binding(
        binding: &BindingDigests,
        source_proof_digest: [u8; DIGEST_BYTES],
        workspace_schema_version: u64,
        created_at_epoch_seconds: u64,
        allowlist_version: u32,
        data_frame_count: u32,
        data_plaintext_bytes: u64,
        authority_floor_digest: [u8; DIGEST_BYTES],
    ) -> Self {
        Self::new(
            binding.account,
            binding.device,
            binding.workspace,
            binding.binding,
            source_proof_digest,
            workspace_schema_version,
            created_at_epoch_seconds,
            allowlist_version,
            data_frame_count,
            data_plaintext_bytes,
            authority_floor_digest,
        )
    }
}

impl fmt::Debug for BackupManifest {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("BackupManifest([REDACTED])")
    }
}

/// Only non-secret, non-binding metadata leaves successful Host-private inspection.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct VerifiedArtifact {
    backup_id: [u8; 16],
    workspace_schema_version: u64,
    created_at_epoch_seconds: u64,
    allowlist_version: u32,
    data_frame_count: u32,
    data_plaintext_bytes: u64,
}

pub(super) struct SealedBackupArtifact {
    bytes: Vec<u8>,
    #[expect(
        dead_code,
        reason = "the authenticated KEK reference is retained for the future native backup catalog"
    )]
    kek_reference: KekReference,
}

impl SealedBackupArtifact {
    pub(super) fn bytes(&self) -> &[u8] {
        &self.bytes
    }

    #[expect(
        dead_code,
        reason = "the future native backup catalog consumes the authenticated KEK reference"
    )]
    pub(super) fn kek_reference(&self) -> &KekReference {
        &self.kek_reference
    }
}

impl fmt::Debug for SealedBackupArtifact {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("SealedBackupArtifact([REDACTED])")
    }
}

impl VerifiedArtifact {
    pub(super) fn backup_id(&self) -> &[u8; 16] {
        &self.backup_id
    }

    pub(super) fn workspace_schema_version(&self) -> u64 {
        self.workspace_schema_version
    }

    pub(super) fn created_at_epoch_seconds(&self) -> u64 {
        self.created_at_epoch_seconds
    }

    pub(super) fn allowlist_version(&self) -> u32 {
        self.allowlist_version
    }

    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "frame count is retained for private backup inspection while production backup remains unavailable"
        )
    )]
    pub(super) fn data_frame_count(&self) -> u32 {
        self.data_frame_count
    }

    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "plaintext byte count is retained for private backup inspection while production backup remains unavailable"
        )
    )]
    pub(super) fn data_plaintext_bytes(&self) -> u64 {
        self.data_plaintext_bytes
    }
}

pub(super) struct ExportRequest<'a> {
    workspace_schema_version: u64,
    manifest: BackupManifest,
    data_frames: &'a [&'a [u8]],
}

impl<'a> ExportRequest<'a> {
    pub(super) const fn new(
        workspace_schema_version: u64,
        manifest: BackupManifest,
        data_frames: &'a [&'a [u8]],
    ) -> Self {
        Self {
            workspace_schema_version,
            manifest,
            data_frames,
        }
    }
}

#[derive(Clone)]
struct ExportEntropy {
    backup_id: [u8; 16],
    nonce_prefix: [u8; 16],
    content_key: [u8; CONTENT_KEY_BYTES],
    wrap_nonce: [u8; NONCE_BYTES],
}

impl ExportEntropy {
    fn generate() -> Result<Self, BackupContainerError> {
        let mut value = Self {
            backup_id: [0; 16],
            nonce_prefix: [0; 16],
            content_key: [0; CONTENT_KEY_BYTES],
            wrap_nonce: [0; NONCE_BYTES],
        };
        getrandom::fill(&mut value.backup_id).map_err(|_| BackupContainerError::KeyUnavailable)?;
        getrandom::fill(&mut value.nonce_prefix)
            .map_err(|_| BackupContainerError::KeyUnavailable)?;
        getrandom::fill(&mut value.content_key)
            .map_err(|_| BackupContainerError::KeyUnavailable)?;
        getrandom::fill(&mut value.wrap_nonce).map_err(|_| BackupContainerError::KeyUnavailable)?;
        Ok(value)
    }
}

impl Drop for ExportEntropy {
    fn drop(&mut self) {
        self.content_key.zeroize();
        self.wrap_nonce.zeroize();
    }
}

pub(super) struct BackupContainerHost {
    registry: BackupKekRegistry,
    rollback_anchor: BackupKekRollbackAnchor,
    binding: BindingDigests,
}

impl fmt::Debug for BackupContainerHost {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("BackupContainerHost([REDACTED])")
    }
}

impl BackupContainerHost {
    fn new(
        registry: BackupKekRegistry,
        rollback_anchor: BackupKekRollbackAnchor,
        binding: BindingDigests,
    ) -> Result<Self, BackupContainerError> {
        registry.validate_anchor(&rollback_anchor)?;
        Ok(Self {
            registry,
            rollback_anchor,
            binding,
        })
    }

    /// Production remains unavailable until the Desktop Host supplies an independently durable,
    /// monotonic rollback-anchor adapter. Keychain custody alone is insufficient.
    #[expect(
        dead_code,
        reason = "production backup deliberately fails closed until native custody is qualified"
    )]
    pub(super) fn load_installation(
        _binding: BindingDigests,
    ) -> Result<Self, BackupContainerError> {
        Err(BackupContainerError::KeyUnavailable)
    }

    #[expect(
        dead_code,
        reason = "used only after a durable Desktop rollback-anchor port is composed"
    )]
    fn load_installation_with_anchor(
        binding: BindingDigests,
        anchor_port: &dyn BackupKekRollbackAnchorPort,
    ) -> Result<Self, BackupContainerError> {
        let anchor = anchor_port
            .load()?
            .ok_or(BackupContainerError::KeyUnavailable)?;
        let registry =
            load_native_registry(Some(&anchor))?.ok_or(BackupContainerError::KeyUnavailable)?;
        Self::new(registry, anchor, binding)
    }

    #[cfg(test)]
    pub(super) fn ephemeral_for_test(
        binding: BindingDigests,
    ) -> Result<Self, BackupContainerError> {
        let registry = BackupKekRegistry::generate_initial()?;
        let anchor = registry.current_anchor()?;
        Self::new(registry, anchor, binding)
    }

    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "native KEK rotation remains private until custody and rollback protection are production-qualified"
        )
    )]
    pub(super) fn rotate_kek(&mut self) -> Result<(), BackupContainerError> {
        self.registry.validate_anchor(&self.rollback_anchor)?;
        self.registry.rotate()?;
        self.rollback_anchor = self.registry.current_anchor()?;
        Ok(())
    }

    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "native KEK retirement remains private until custody and rollback protection are production-qualified"
        )
    )]
    pub(super) fn retire_kek(
        &mut self,
        reference: &KekReference,
        catalog_references_slot: bool,
    ) -> Result<(), BackupContainerError> {
        self.registry.validate_anchor(&self.rollback_anchor)?;
        self.registry.retire(reference, catalog_references_slot)?;
        self.rollback_anchor = self.registry.current_anchor()?;
        Ok(())
    }

    /// Serializes a complete ciphertext artifact; the caller cannot select KEK material or nonce.
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "the unfenced export wrapper is retained for private backup protocol composition and tests"
        )
    )]
    pub(super) fn export(
        &self,
        request: ExportRequest<'_>,
    ) -> Result<SealedBackupArtifact, BackupContainerError> {
        self.export_guarded(request, &mut || true)
    }

    /// Serializes while checking the aggregate-owned pending authority epoch at every crypto
    /// boundary. Callers cannot substitute a currentness callback.
    pub(super) fn export_at_epoch(
        &self,
        request: ExportRequest<'_>,
        requested_epoch: &AtomicU64,
        captured_epoch: u64,
    ) -> Result<SealedBackupArtifact, BackupContainerError> {
        self.export_guarded(request, &mut || {
            requested_epoch.load(Ordering::Acquire) == captured_epoch
        })
    }

    /// Serializes an artifact while requiring the owning runtime fence around every key and
    /// frame boundary. The callback carries no identity or key material.
    pub(super) fn export_guarded(
        &self,
        request: ExportRequest<'_>,
        authority_is_current: &mut impl FnMut() -> bool,
    ) -> Result<SealedBackupArtifact, BackupContainerError> {
        require_authority(authority_is_current)?;
        let kek_reference = self
            .registry
            .active(&self.rollback_anchor)?
            .reference
            .clone();
        require_authority(authority_is_current)?;
        let entropy = ExportEntropy::generate()?;
        require_authority(authority_is_current)?;
        let bytes = self.export_with_entropy_guarded(request, entropy, authority_is_current)?;
        require_authority(authority_is_current)?;
        Ok(SealedBackupArtifact {
            bytes,
            kek_reference,
        })
    }

    /// Authenticates the complete artifact before lending data frames to an isolated candidate.
    /// The callback cannot retain the borrow through this interface, and its error is collapsed.
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "the unfenced import wrapper is retained for private backup protocol composition and tests"
        )
    )]
    pub(super) fn import<R>(
        &self,
        artifact: &[u8],
        consume_isolated_candidate: impl FnOnce(&[&[u8]]) -> Result<R, ()>,
    ) -> Result<(VerifiedArtifact, R), BackupContainerError> {
        self.import_guarded(artifact, &mut || true, |_, _, frames| {
            consume_isolated_candidate(frames)
        })
    }

    /// Authenticates while checking the aggregate-owned pending authority epoch at every decrypt
    /// boundary. The sink receives only short-lived borrows used to build the private candidate.
    pub(super) fn import_at_epoch<R>(
        &self,
        artifact: &[u8],
        requested_epoch: &AtomicU64,
        captured_epoch: u64,
        consume_isolated_candidate: impl FnOnce(
            &[u8; 16],
            &[u8; DIGEST_BYTES],
            &[&[u8]],
        ) -> Result<R, ()>,
    ) -> Result<(VerifiedArtifact, R), BackupContainerError> {
        self.import_guarded(
            artifact,
            &mut || requested_epoch.load(Ordering::Acquire) == captured_epoch,
            consume_isolated_candidate,
        )
    }

    /// Authenticates the complete artifact under the current runtime fence before lending
    /// plaintext frames and their authenticated source proof to the isolated candidate sink.
    pub(super) fn import_guarded<R>(
        &self,
        artifact: &[u8],
        authority_is_current: &mut impl FnMut() -> bool,
        consume_isolated_candidate: impl FnOnce(
            &[u8; 16],
            &[u8; DIGEST_BYTES],
            &[&[u8]],
        ) -> Result<R, ()>,
    ) -> Result<(VerifiedArtifact, R), BackupContainerError> {
        require_authority(authority_is_current)?;
        let parsed = ParsedContainer::parse(artifact)?;
        require_authority(authority_is_current)?;
        let slot = self
            .registry
            .exact(&self.rollback_anchor, &parsed.header.kek_reference)?;
        require_authority(authority_is_current)?;
        let content_key = unwrap_content_key(
            &slot.material,
            &parsed.header_digest,
            &self.binding.binding,
            parsed.wrapped_key,
        )?;
        require_authority(authority_is_current)?;

        let mut plaintext_frames = Vec::with_capacity(parsed.encrypted_frames.len());
        for frame in &parsed.encrypted_frames {
            require_authority(authority_is_current)?;
            plaintext_frames.push(Zeroizing::new(open_frame(
                &content_key,
                &parsed.header_digest,
                &parsed.header.backup_id,
                &self.binding.binding,
                &parsed.header.nonce_prefix,
                frame,
            )?));
            require_authority(authority_is_current)?;
        }
        let verified = verify_plaintext(&parsed, &plaintext_frames, &self.binding)?;
        require_authority(authority_is_current)?;
        let data_borrows = plaintext_frames[1..plaintext_frames.len() - 1]
            .iter()
            .map(|frame| frame.as_slice())
            .collect::<Vec<_>>();
        let manifest = parse_manifest(&plaintext_frames[0])?;
        let result = consume_isolated_candidate(
            &parsed.header.backup_id,
            &manifest.source_proof_digest,
            &data_borrows,
        )
        .map_err(|()| BackupContainerError::ArtifactRejected)?;
        // The consumer is allowed to commit an already-fenced restore transaction.  A final
        // authority check here would turn a successful durable commit into an `Err` if a
        // transition publishes its intent in the tiny interval after COMMIT and before this
        // callback returns.  Consumers that can commit must perform their final check inside the
        // transaction immediately before COMMIT; inspection consumers remain read-only.
        Ok((verified, result))
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) const fn manifest(
        &self,
        source_proof_digest: [u8; DIGEST_BYTES],
        workspace_schema_version: u64,
        created_at_epoch_seconds: u64,
        allowlist_version: u32,
        data_frame_count: u32,
        data_plaintext_bytes: u64,
        authority_floor_digest: [u8; DIGEST_BYTES],
    ) -> BackupManifest {
        BackupManifest::from_binding(
            &self.binding,
            source_proof_digest,
            workspace_schema_version,
            created_at_epoch_seconds,
            allowlist_version,
            data_frame_count,
            data_plaintext_bytes,
            authority_floor_digest,
        )
    }

    #[allow(
        clippy::needless_pass_by_value,
        reason = "ownership bounds the request and guarantees generated secret entropy drops here"
    )]
    #[cfg(test)]
    fn export_with_entropy(
        &self,
        request: ExportRequest<'_>,
        entropy: ExportEntropy,
    ) -> Result<Vec<u8>, BackupContainerError> {
        self.export_with_entropy_guarded(request, entropy, &mut || true)
    }

    #[allow(
        clippy::too_many_lines,
        clippy::needless_pass_by_value,
        reason = "the fixed binary transcript keeps all encryption stages contiguous and ownership-scoped"
    )]
    fn export_with_entropy_guarded(
        &self,
        request: ExportRequest<'_>,
        entropy: ExportEntropy,
        authority_is_current: &mut impl FnMut() -> bool,
    ) -> Result<Vec<u8>, BackupContainerError> {
        require_authority(authority_is_current)?;
        validate_export_request(&request, &self.binding)?;
        let slot = self.registry.active(&self.rollback_anchor)?;
        require_authority(authority_is_current)?;
        let header = Header {
            backup_id: entropy.backup_id,
            nonce_prefix: entropy.nonce_prefix,
            workspace_schema_version: request.workspace_schema_version,
            kek_reference: slot.reference.clone(),
        };
        let header_body = header.encode()?;
        let header_len =
            u32::try_from(header_body.len()).map_err(|_| BackupContainerError::ArtifactRejected)?;
        let mut artifact = Vec::new();
        artifact.extend_from_slice(MAGIC);
        artifact.extend_from_slice(&header_len.to_be_bytes());
        artifact.extend_from_slice(&header_body);
        let header_digest: [u8; DIGEST_BYTES] = Sha256::digest(&artifact).into();
        artifact.extend_from_slice(&header_digest);

        let wrapped_key = wrap_content_key(
            &slot.material,
            &header_digest,
            &self.binding.binding,
            &entropy.wrap_nonce,
            &entropy.content_key,
        )?;
        require_authority(authority_is_current)?;
        artifact.extend_from_slice(
            &u16::try_from(wrapped_key.len())
                .map_err(|_| BackupContainerError::ArtifactRejected)?
                .to_be_bytes(),
        );
        artifact.extend_from_slice(&wrapped_key);

        let mut prior_transcript = Sha256::new();
        let mut total_plaintext = 0_u64;
        let mut total_ciphertext = 0_u64;
        let mut sequence = 0_u64;
        let manifest = encode_manifest(&request.manifest);
        append_encrypted_frame(
            &mut artifact,
            &mut prior_transcript,
            &entropy.content_key,
            &header_digest,
            &entropy.backup_id,
            &self.binding.binding,
            &entropy.nonce_prefix,
            sequence,
            FrameKind::Manifest,
            &manifest,
            &mut total_plaintext,
            &mut total_ciphertext,
        )?;
        require_authority(authority_is_current)?;
        sequence += 1;
        for data in request.data_frames {
            require_authority(authority_is_current)?;
            append_encrypted_frame(
                &mut artifact,
                &mut prior_transcript,
                &entropy.content_key,
                &header_digest,
                &entropy.backup_id,
                &self.binding.binding,
                &entropy.nonce_prefix,
                sequence,
                FrameKind::Data,
                data,
                &mut total_plaintext,
                &mut total_ciphertext,
            )?;
            require_authority(authority_is_current)?;
            sequence = sequence
                .checked_add(1)
                .ok_or(BackupContainerError::ArtifactRejected)?;
        }
        let trailer = encode_trailer(
            sequence,
            total_plaintext,
            total_ciphertext,
            &prior_transcript.finalize().into(),
        );
        let mut ignored_transcript = Sha256::new();
        let mut ignored_plaintext = 0_u64;
        let mut ignored_ciphertext = 0_u64;
        append_encrypted_frame(
            &mut artifact,
            &mut ignored_transcript,
            &entropy.content_key,
            &header_digest,
            &entropy.backup_id,
            &self.binding.binding,
            &entropy.nonce_prefix,
            sequence,
            FrameKind::Trailer,
            &trailer,
            &mut ignored_plaintext,
            &mut ignored_ciphertext,
        )?;
        require_authority(authority_is_current)?;
        if artifact.len() > ARTIFACT_BYTE_LIMIT {
            return Err(BackupContainerError::ArtifactRejected);
        }
        Ok(artifact)
    }
}

#[cfg(target_os = "macos")]
#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "native KEK custody remains private until its monotonic anchor is production-qualified"
    )
)]
struct BackupKekInstallationLock {
    _process_guard: std::sync::MutexGuard<'static, ()>,
    file: std::fs::File,
}

#[cfg(target_os = "macos")]
#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "native KEK custody remains private until its monotonic anchor is production-qualified"
    )
)]
impl BackupKekInstallationLock {
    fn acquire_at(directory: &std::path::Path) -> Result<Self, BackupContainerError> {
        use fs2::FileExt;
        use std::fs::{self, DirBuilder, OpenOptions};
        use std::io::ErrorKind;
        use std::os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt};
        use std::sync::{Mutex, OnceLock};

        static PROCESS_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        let process_guard = PROCESS_LOCK
            .get_or_init(|| Mutex::new(()))
            .lock()
            .map_err(|_| BackupContainerError::KeyUnavailable)?;

        if !directory.is_absolute() {
            return Err(BackupContainerError::KeyUnavailable);
        }
        match DirBuilder::new().mode(0o700).create(directory) {
            Ok(()) => {}
            Err(error) if error.kind() == ErrorKind::AlreadyExists => {}
            Err(_) => return Err(BackupContainerError::KeyUnavailable),
        }
        let directory_metadata =
            fs::symlink_metadata(directory).map_err(|_| BackupContainerError::KeyUnavailable)?;
        if !directory_metadata.file_type().is_dir()
            || directory_metadata.file_type().is_symlink()
            || directory_metadata.uid() != rustix::process::geteuid().as_raw()
            || directory_metadata.mode() & 0o777 != 0o700
        {
            return Err(BackupContainerError::KeyUnavailable);
        }

        let path = directory.join(format!(
            "{KEK_KEYCHAIN_SERVICE}.{KEK_KEYCHAIN_ACCOUNT}.lock"
        ));
        let file = OpenOptions::new()
            .create(true)
            .read(true)
            .write(true)
            .mode(0o600)
            .custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW)
            .open(&path)
            .map_err(|_| BackupContainerError::KeyUnavailable)?;
        let file_metadata = file
            .metadata()
            .map_err(|_| BackupContainerError::KeyUnavailable)?;
        if !file_metadata.file_type().is_file()
            || file_metadata.nlink() != 1
            || file_metadata.uid() != directory_metadata.uid()
            || file_metadata.mode() & 0o777 != 0o600
        {
            return Err(BackupContainerError::KeyUnavailable);
        }
        file.lock_exclusive()
            .map_err(|_| BackupContainerError::KeyUnavailable)?;
        let path_metadata =
            fs::symlink_metadata(path).map_err(|_| BackupContainerError::KeyUnavailable)?;
        if path_metadata.file_type().is_symlink()
            || path_metadata.dev() != file_metadata.dev()
            || path_metadata.ino() != file_metadata.ino()
        {
            return Err(BackupContainerError::KeyUnavailable);
        }
        Ok(Self {
            _process_guard: process_guard,
            file,
        })
    }
}

#[cfg(target_os = "macos")]
impl Drop for BackupKekInstallationLock {
    fn drop(&mut self) {
        let _ = fs2::FileExt::unlock(&self.file);
    }
}

#[cfg(target_os = "macos")]
#[expect(
    dead_code,
    reason = "native KEK custody remains private until its monotonic anchor is production-qualified"
)]
fn production_kek_lock_directory() -> std::path::PathBuf {
    std::path::PathBuf::from(format!(
        "/private/tmp/{KEK_LOCK_DIRECTORY_PREFIX}-{}",
        rustix::process::geteuid().as_raw()
    ))
}

#[cfg(target_os = "macos")]
#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "native KEK custody remains private until its monotonic anchor is production-qualified"
    )
)]
fn load_validated_custody(
    port: &dyn BackupKekCustodyPort,
) -> Result<Option<(BackupKekRegistry, BackupKekRollbackAnchor)>, BackupContainerError> {
    // Lock order is fixed by the caller: process mutex, kernel file lock, registry, then anchor.
    // A one-sided state is an interrupted transaction and is never repaired by guessing.
    let registry_blob = port.load_registry_blob()?;
    let anchor_blob = port.load_anchor_blob()?;
    match (registry_blob, anchor_blob) {
        (None, None) => Ok(None),
        (Some(registry_blob), Some(anchor_blob)) => {
            let anchor = BackupKekRollbackAnchor::decode(&anchor_blob)?;
            let registry = BackupKekRegistry::decode_custody(&registry_blob, Some(&anchor))?;
            Ok(Some((registry, anchor)))
        }
        (None, Some(_)) | (Some(_), None) => Err(BackupContainerError::KeyUnavailable),
    }
}

#[cfg(target_os = "macos")]
#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "native KEK custody remains private until its monotonic anchor is production-qualified"
    )
)]
fn persist_custody(
    port: &dyn BackupKekCustodyPort,
    registry: &BackupKekRegistry,
) -> Result<BackupKekRollbackAnchor, BackupContainerError> {
    let registry_blob = registry.encode_custody()?;
    let anchor = registry.current_anchor()?;
    let anchor_blob = anchor.encode();

    // The independent anchor is the commit marker and is written last. A crash before that write
    // leaves an exact mismatch that the next locked load rejects. Success is returned only after
    // both stores have independently read back the exact bytes and the pair validates together.
    port.store_registry_blob(&registry_blob)?;
    let registry_readback = port
        .load_registry_blob()?
        .ok_or(BackupContainerError::KeyUnavailable)?;
    if registry_readback.as_slice() != registry_blob.as_slice() {
        return Err(BackupContainerError::KeyUnavailable);
    }
    port.store_anchor_blob(&anchor_blob)?;
    let anchor_readback = port
        .load_anchor_blob()?
        .ok_or(BackupContainerError::KeyUnavailable)?;
    if anchor_readback.as_slice() != anchor_blob {
        return Err(BackupContainerError::KeyUnavailable);
    }
    let admitted_anchor = BackupKekRollbackAnchor::decode(&anchor_readback)?;
    BackupKekRegistry::decode_custody(&registry_readback, Some(&admitted_anchor))?;
    Ok(admitted_anchor)
}

#[cfg(target_os = "macos")]
#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "native KEK custody remains private until its monotonic anchor is production-qualified"
    )
)]
struct LockedBackupKekCustody<'a> {
    _lock: BackupKekInstallationLock,
    port: &'a dyn BackupKekCustodyPort,
    host: BackupContainerHost,
    usable: bool,
}

#[cfg(target_os = "macos")]
#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "native KEK custody remains private until its monotonic anchor is production-qualified"
    )
)]
impl<'a> LockedBackupKekCustody<'a> {
    fn load_or_create_at(
        port: &'a dyn BackupKekCustodyPort,
        lock_directory: &std::path::Path,
        binding: BindingDigests,
    ) -> Result<Self, BackupContainerError> {
        let lock = BackupKekInstallationLock::acquire_at(lock_directory)?;
        let (registry, anchor) = if let Some(custody) = load_validated_custody(port)? {
            custody
        } else {
            let registry = BackupKekRegistry::generate_initial()?;
            let anchor = persist_custody(port, &registry)?;
            (registry, anchor)
        };
        let host = BackupContainerHost::new(registry, anchor, binding)?;
        Ok(Self {
            _lock: lock,
            port,
            host,
            usable: true,
        })
    }

    fn rotate(&mut self) -> Result<(), BackupContainerError> {
        if !self.usable {
            return Err(BackupContainerError::KeyUnavailable);
        }
        self.usable = false;
        self.host.rotate_kek()?;
        self.host.rollback_anchor = persist_custody(self.port, &self.host.registry)?;
        self.usable = true;
        Ok(())
    }

    fn retire(
        &mut self,
        reference: &KekReference,
        catalog_references_slot: bool,
    ) -> Result<(), BackupContainerError> {
        if !self.usable {
            return Err(BackupContainerError::KeyUnavailable);
        }
        self.usable = false;
        self.host.retire_kek(reference, catalog_references_slot)?;
        self.host.rollback_anchor = persist_custody(self.port, &self.host.registry)?;
        self.usable = true;
        Ok(())
    }

    fn export(
        &self,
        request: ExportRequest<'_>,
    ) -> Result<SealedBackupArtifact, BackupContainerError> {
        if !self.usable {
            return Err(BackupContainerError::KeyUnavailable);
        }
        self.host.export(request)
    }

    fn import<R>(
        &self,
        artifact: &[u8],
        consume_isolated_candidate: impl FnOnce(&[&[u8]]) -> Result<R, ()>,
    ) -> Result<(VerifiedArtifact, R), BackupContainerError> {
        if !self.usable {
            return Err(BackupContainerError::KeyUnavailable);
        }
        self.host.import(artifact, consume_isolated_candidate)
    }
}

fn require_authority(
    authority_is_current: &mut impl FnMut() -> bool,
) -> Result<(), BackupContainerError> {
    if authority_is_current() {
        Ok(())
    } else {
        Err(BackupContainerError::AuthorityRejected)
    }
}

#[derive(Clone, Copy)]
pub(super) struct BindingDigests {
    account: [u8; DIGEST_BYTES],
    device: [u8; DIGEST_BYTES],
    workspace: [u8; DIGEST_BYTES],
    binding: [u8; DIGEST_BYTES],
}

impl BindingDigests {
    #[cfg(test)]
    pub(super) const fn new(
        account: [u8; DIGEST_BYTES],
        device: [u8; DIGEST_BYTES],
        workspace: [u8; DIGEST_BYTES],
        binding: [u8; DIGEST_BYTES],
    ) -> Self {
        Self {
            account,
            device,
            workspace,
            binding,
        }
    }
}

impl fmt::Debug for BindingDigests {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("BindingDigests([REDACTED])")
    }
}

#[derive(Clone)]
struct Header {
    backup_id: [u8; 16],
    nonce_prefix: [u8; 16],
    workspace_schema_version: u64,
    kek_reference: KekReference,
}

impl Header {
    fn encode(&self) -> Result<Vec<u8>, BackupContainerError> {
        self.kek_reference
            .validate()
            .map_err(|_| BackupContainerError::ArtifactRejected)?;
        let id_len = u8::try_from(self.kek_reference.id.len())
            .map_err(|_| BackupContainerError::ArtifactRejected)?;
        let mut body = Vec::with_capacity(80);
        body.extend_from_slice(&FORMAT_VERSION.to_be_bytes());
        body.extend_from_slice(&CRYPTO_SUITE.to_be_bytes());
        body.extend_from_slice(&KEY_WRAP_SUITE.to_be_bytes());
        body.extend_from_slice(&self.backup_id);
        body.extend_from_slice(&self.nonce_prefix);
        body.extend_from_slice(&FRAME_PLAINTEXT_LIMIT_WIRE.to_be_bytes());
        body.extend_from_slice(&ARTIFACT_BYTE_LIMIT_WIRE.to_be_bytes());
        body.extend_from_slice(&self.workspace_schema_version.to_be_bytes());
        body.push(id_len);
        body.extend_from_slice(&self.kek_reference.id);
        body.push(SLOT_VERSION_BYTES_WIRE);
        body.extend_from_slice(&self.kek_reference.version.to_be_bytes());
        Ok(body)
    }

    fn parse(body: &[u8]) -> Result<Self, BackupContainerError> {
        let mut cursor = Cursor::new(body);
        if cursor.u16()? != FORMAT_VERSION
            || cursor.u16()? != CRYPTO_SUITE
            || cursor.u16()? != KEY_WRAP_SUITE
        {
            return Err(BackupContainerError::ArtifactRejected);
        }
        let backup_id = cursor.array()?;
        let nonce_prefix = cursor.array()?;
        if cursor.u32()? != FRAME_PLAINTEXT_LIMIT_WIRE || cursor.u64()? != ARTIFACT_BYTE_LIMIT_WIRE
        {
            return Err(BackupContainerError::ArtifactRejected);
        }
        let workspace_schema_version = cursor.u64()?;
        let id_len = usize::from(cursor.u8()?);
        if id_len == 0 || id_len > SLOT_ID_MAX_BYTES {
            return Err(BackupContainerError::ArtifactRejected);
        }
        let id = cursor.bytes(id_len)?.to_vec();
        if usize::from(cursor.u8()?) != SLOT_VERSION_BYTES {
            return Err(BackupContainerError::ArtifactRejected);
        }
        let version = cursor.u64()?;
        cursor.finish()?;
        let kek_reference = KekReference { id, version };
        kek_reference
            .validate()
            .map_err(|_| BackupContainerError::ArtifactRejected)?;
        Ok(Self {
            backup_id,
            nonce_prefix,
            workspace_schema_version,
            kek_reference,
        })
    }
}

struct EncryptedFrame<'a> {
    sequence: u64,
    kind: FrameKind,
    plaintext_len: u32,
    ciphertext_len: u32,
    header_and_ciphertext: &'a [u8],
    ciphertext: &'a [u8],
}

struct ParsedContainer<'a> {
    header: Header,
    header_digest: [u8; DIGEST_BYTES],
    wrapped_key: &'a [u8],
    encrypted_frames: Vec<EncryptedFrame<'a>>,
}

impl<'a> ParsedContainer<'a> {
    fn parse(artifact: &'a [u8]) -> Result<Self, BackupContainerError> {
        validate_artifact_size(artifact.len())?;
        let mut cursor = Cursor::new(artifact);
        if cursor.bytes(MAGIC.len())? != MAGIC {
            return Err(BackupContainerError::ArtifactRejected);
        }
        let header_len =
            usize::try_from(cursor.u32()?).map_err(|_| BackupContainerError::ArtifactRejected)?;
        if header_len == 0 || header_len > HEADER_MAX_BYTES {
            return Err(BackupContainerError::ArtifactRejected);
        }
        let body_end = cursor
            .position()
            .checked_add(header_len)
            .ok_or(BackupContainerError::ArtifactRejected)?;
        let header_body = cursor.bytes(header_len)?;
        let header = Header::parse(header_body)?;
        let supplied_digest: [u8; DIGEST_BYTES] = cursor.array()?;
        let computed_digest: [u8; DIGEST_BYTES] = Sha256::digest(&artifact[..body_end]).into();
        if supplied_digest != computed_digest {
            return Err(BackupContainerError::ArtifactRejected);
        }
        let wrapped_key_len = usize::from(cursor.u16()?);
        if wrapped_key_len != WRAPPED_KEY_BYTES || wrapped_key_len > 128 {
            return Err(BackupContainerError::ArtifactRejected);
        }
        let wrapped_key = cursor.bytes(wrapped_key_len)?;
        let mut encrypted_frames = Vec::new();
        let mut expected_sequence = 0_u64;
        let mut trailer_seen = false;
        while cursor.remaining() != 0 {
            if encrypted_frames.len() >= FRAME_LIMIT || trailer_seen {
                return Err(BackupContainerError::ArtifactRejected);
            }
            let record_start = cursor.position();
            let sequence = cursor.u64()?;
            let kind = FrameKind::parse(cursor.u8()?)?;
            let plaintext_len = cursor.u32()?;
            let ciphertext_len = cursor.u32()?;
            if sequence != expected_sequence
                || usize::try_from(plaintext_len)
                    .map_err(|_| BackupContainerError::ArtifactRejected)?
                    > FRAME_PLAINTEXT_LIMIT
                || ciphertext_len
                    != plaintext_len
                        .checked_add(AEAD_TAG_BYTES_WIRE)
                        .ok_or(BackupContainerError::ArtifactRejected)?
            {
                return Err(BackupContainerError::ArtifactRejected);
            }
            match (expected_sequence, kind) {
                (0, FrameKind::Manifest) => {}
                (0, _) | (_, FrameKind::Manifest) => {
                    return Err(BackupContainerError::ArtifactRejected);
                }
                (_, FrameKind::Data) => {}
                (_, FrameKind::Trailer) => trailer_seen = true,
            }
            if kind == FrameKind::Manifest && plaintext_len as usize != MANIFEST_PLAINTEXT_BYTES {
                return Err(BackupContainerError::ArtifactRejected);
            }
            if kind == FrameKind::Trailer && plaintext_len as usize != TRAILER_PLAINTEXT_BYTES {
                return Err(BackupContainerError::ArtifactRejected);
            }
            let ciphertext = cursor.bytes(ciphertext_len as usize)?;
            encrypted_frames.push(EncryptedFrame {
                sequence,
                kind,
                plaintext_len,
                ciphertext_len,
                header_and_ciphertext: &artifact[record_start..cursor.position()],
                ciphertext,
            });
            expected_sequence = expected_sequence
                .checked_add(1)
                .ok_or(BackupContainerError::ArtifactRejected)?;
        }
        if !trailer_seen || encrypted_frames.len() < 2 {
            return Err(BackupContainerError::ArtifactRejected);
        }
        Ok(Self {
            header,
            header_digest: supplied_digest,
            wrapped_key,
            encrypted_frames,
        })
    }
}

fn validate_artifact_size(length: usize) -> Result<(), BackupContainerError> {
    if length > ARTIFACT_BYTE_LIMIT {
        Err(BackupContainerError::ArtifactRejected)
    } else {
        Ok(())
    }
}

struct Cursor<'a> {
    bytes: &'a [u8],
    position: usize,
}

impl<'a> Cursor<'a> {
    const fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, position: 0 }
    }

    const fn position(&self) -> usize {
        self.position
    }

    fn remaining(&self) -> usize {
        self.bytes.len().saturating_sub(self.position)
    }

    fn bytes(&mut self, length: usize) -> Result<&'a [u8], BackupContainerError> {
        let end = self
            .position
            .checked_add(length)
            .ok_or(BackupContainerError::ArtifactRejected)?;
        let value = self
            .bytes
            .get(self.position..end)
            .ok_or(BackupContainerError::ArtifactRejected)?;
        self.position = end;
        Ok(value)
    }

    fn array<const N: usize>(&mut self) -> Result<[u8; N], BackupContainerError> {
        self.bytes(N)?
            .try_into()
            .map_err(|_| BackupContainerError::ArtifactRejected)
    }

    fn u8(&mut self) -> Result<u8, BackupContainerError> {
        Ok(self.array::<1>()?[0])
    }

    fn u16(&mut self) -> Result<u16, BackupContainerError> {
        Ok(u16::from_be_bytes(self.array()?))
    }

    fn u32(&mut self) -> Result<u32, BackupContainerError> {
        Ok(u32::from_be_bytes(self.array()?))
    }

    fn u64(&mut self) -> Result<u64, BackupContainerError> {
        Ok(u64::from_be_bytes(self.array()?))
    }

    fn finish(&self) -> Result<(), BackupContainerError> {
        if self.remaining() == 0 {
            Ok(())
        } else {
            Err(BackupContainerError::ArtifactRejected)
        }
    }
}

fn validate_export_request(
    request: &ExportRequest<'_>,
    binding: &BindingDigests,
) -> Result<(), BackupContainerError> {
    if request.workspace_schema_version == 0
        || request.manifest.workspace_schema_version != request.workspace_schema_version
        || request.manifest.account_digest != binding.account
        || request.manifest.device_digest != binding.device
        || request.manifest.workspace_digest != binding.workspace
        || request.manifest.binding_digest != binding.binding
        || request.manifest.allowlist_version == 0
        || request.data_frames.len() > FRAME_LIMIT - 2
        || request.manifest.data_frame_count as usize != request.data_frames.len()
        || request
            .data_frames
            .iter()
            .any(|frame| frame.len() > FRAME_PLAINTEXT_LIMIT)
    {
        return Err(BackupContainerError::ArtifactRejected);
    }
    let data_bytes = request
        .data_frames
        .iter()
        .try_fold(0_u64, |total, frame| total.checked_add(frame.len() as u64));
    if data_bytes != Some(request.manifest.data_plaintext_bytes) {
        return Err(BackupContainerError::ArtifactRejected);
    }
    let data_bytes = data_bytes.ok_or(BackupContainerError::ArtifactRejected)?;
    let frame_count = request
        .data_frames
        .len()
        .checked_add(2)
        .ok_or(BackupContainerError::ArtifactRejected)?;
    let projected_bytes = HEADER_MAX_BYTES
        .checked_add(MAGIC.len() + 4 + DIGEST_BYTES + 2 + WRAPPED_KEY_BYTES)
        .and_then(|value| {
            value.checked_add(frame_count.checked_mul(FRAME_HEADER_BYTES + AEAD_TAG_BYTES)?)
        })
        .and_then(|value| value.checked_add(MANIFEST_PLAINTEXT_BYTES + TRAILER_PLAINTEXT_BYTES))
        .and_then(|value| value.checked_add(usize::try_from(data_bytes).ok()?))
        .ok_or(BackupContainerError::ArtifactRejected)?;
    if projected_bytes > ARTIFACT_BYTE_LIMIT {
        return Err(BackupContainerError::ArtifactRejected);
    }
    Ok(())
}

fn derive_wrap_key(
    kek: &[u8; CONTENT_KEY_BYTES],
    header_digest: &[u8; DIGEST_BYTES],
    binding_digest: &[u8; DIGEST_BYTES],
) -> Result<Zeroizing<[u8; CONTENT_KEY_BYTES]>, BackupContainerError> {
    let salt = hkdf::Salt::new(hkdf::HKDF_SHA256, header_digest);
    let prk = salt.extract(kek);
    let info = [KEK_PURPOSE, WRAP_DOMAIN, binding_digest.as_slice()];
    let okm = prk
        .expand(&info, hkdf::HKDF_SHA256)
        .map_err(|_| BackupContainerError::KeyUnavailable)?;
    let mut derived = Zeroizing::new([0_u8; CONTENT_KEY_BYTES]);
    okm.fill(&mut *derived)
        .map_err(|_| BackupContainerError::KeyUnavailable)?;
    Ok(derived)
}

fn wrap_aad(header_digest: &[u8; DIGEST_BYTES], binding_digest: &[u8; DIGEST_BYTES]) -> Vec<u8> {
    let mut aad = Vec::with_capacity(WRAP_DOMAIN.len() + (2 * DIGEST_BYTES));
    aad.extend_from_slice(WRAP_DOMAIN);
    aad.extend_from_slice(header_digest);
    aad.extend_from_slice(binding_digest);
    aad
}

fn wrap_content_key(
    kek: &[u8; CONTENT_KEY_BYTES],
    header_digest: &[u8; DIGEST_BYTES],
    binding_digest: &[u8; DIGEST_BYTES],
    nonce: &[u8; NONCE_BYTES],
    content_key: &[u8; CONTENT_KEY_BYTES],
) -> Result<Zeroizing<Vec<u8>>, BackupContainerError> {
    let derived = derive_wrap_key(kek, header_digest, binding_digest)?;
    let ciphertext = XChaCha20Poly1305::new(&Key::from(*derived))
        .encrypt(
            &XNonce::from(*nonce),
            Payload {
                msg: content_key,
                aad: &wrap_aad(header_digest, binding_digest),
            },
        )
        .map_err(|_| BackupContainerError::ArtifactRejected)?;
    let mut wrapped = Zeroizing::new(Vec::with_capacity(WRAPPED_KEY_BYTES));
    wrapped.extend_from_slice(nonce);
    wrapped.extend_from_slice(&ciphertext);
    Ok(wrapped)
}

fn unwrap_content_key(
    kek: &[u8; CONTENT_KEY_BYTES],
    header_digest: &[u8; DIGEST_BYTES],
    binding_digest: &[u8; DIGEST_BYTES],
    wrapped: &[u8],
) -> Result<Zeroizing<[u8; CONTENT_KEY_BYTES]>, BackupContainerError> {
    if wrapped.len() != WRAPPED_KEY_BYTES {
        return Err(BackupContainerError::ArtifactRejected);
    }
    let nonce: &[u8; NONCE_BYTES] = wrapped[..NONCE_BYTES]
        .try_into()
        .map_err(|_| BackupContainerError::ArtifactRejected)?;
    let derived = derive_wrap_key(kek, header_digest, binding_digest)?;
    let mut plaintext = Zeroizing::new(
        XChaCha20Poly1305::new(&Key::from(*derived))
            .decrypt(
                &XNonce::from(*nonce),
                Payload {
                    msg: &wrapped[NONCE_BYTES..],
                    aad: &wrap_aad(header_digest, binding_digest),
                },
            )
            .map_err(|_| BackupContainerError::ArtifactRejected)?,
    );
    if plaintext.len() != CONTENT_KEY_BYTES {
        return Err(BackupContainerError::ArtifactRejected);
    }
    let mut key = Zeroizing::new([0_u8; CONTENT_KEY_BYTES]);
    key.copy_from_slice(&plaintext);
    plaintext.zeroize();
    Ok(key)
}

#[allow(clippy::too_many_arguments)]
fn frame_aad(
    header_digest: &[u8; DIGEST_BYTES],
    backup_id: &[u8; 16],
    binding_digest: &[u8; DIGEST_BYTES],
    kind: FrameKind,
    sequence: u64,
    plaintext_len: u32,
    ciphertext_len: u32,
) -> Vec<u8> {
    let mut aad = Vec::with_capacity(FRAME_DOMAIN.len() + 32 + 16 + 32 + 1 + 8 + 4 + 4);
    aad.extend_from_slice(FRAME_DOMAIN);
    aad.extend_from_slice(header_digest);
    aad.extend_from_slice(backup_id);
    aad.extend_from_slice(binding_digest);
    aad.push(kind as u8);
    aad.extend_from_slice(&sequence.to_be_bytes());
    aad.extend_from_slice(&plaintext_len.to_be_bytes());
    aad.extend_from_slice(&ciphertext_len.to_be_bytes());
    aad
}

fn frame_nonce(prefix: &[u8; 16], sequence: u64) -> [u8; NONCE_BYTES] {
    let mut nonce = [0_u8; NONCE_BYTES];
    nonce[..16].copy_from_slice(prefix);
    nonce[16..].copy_from_slice(&sequence.to_be_bytes());
    nonce
}

#[allow(clippy::too_many_arguments)]
fn append_encrypted_frame(
    artifact: &mut Vec<u8>,
    transcript: &mut Sha256,
    content_key: &[u8; CONTENT_KEY_BYTES],
    header_digest: &[u8; DIGEST_BYTES],
    backup_id: &[u8; 16],
    binding_digest: &[u8; DIGEST_BYTES],
    nonce_prefix: &[u8; 16],
    sequence: u64,
    kind: FrameKind,
    plaintext: &[u8],
    total_plaintext: &mut u64,
    total_ciphertext: &mut u64,
) -> Result<(), BackupContainerError> {
    if plaintext.len() > FRAME_PLAINTEXT_LIMIT {
        return Err(BackupContainerError::ArtifactRejected);
    }
    let plaintext_len =
        u32::try_from(plaintext.len()).map_err(|_| BackupContainerError::ArtifactRejected)?;
    let ciphertext_len = plaintext_len
        .checked_add(AEAD_TAG_BYTES_WIRE)
        .ok_or(BackupContainerError::ArtifactRejected)?;
    let nonce = Zeroizing::new(frame_nonce(nonce_prefix, sequence));
    let ciphertext = XChaCha20Poly1305::new(&Key::from(*content_key))
        .encrypt(
            &XNonce::from(*nonce),
            Payload {
                msg: plaintext,
                aad: &frame_aad(
                    header_digest,
                    backup_id,
                    binding_digest,
                    kind,
                    sequence,
                    plaintext_len,
                    ciphertext_len,
                ),
            },
        )
        .map_err(|_| BackupContainerError::ArtifactRejected)?;
    let start = artifact.len();
    artifact.extend_from_slice(&sequence.to_be_bytes());
    artifact.push(kind as u8);
    artifact.extend_from_slice(&plaintext_len.to_be_bytes());
    artifact.extend_from_slice(&ciphertext_len.to_be_bytes());
    artifact.extend_from_slice(&ciphertext);
    transcript.update(&artifact[start..]);
    *total_plaintext = total_plaintext
        .checked_add(u64::from(plaintext_len))
        .ok_or(BackupContainerError::ArtifactRejected)?;
    *total_ciphertext = total_ciphertext
        .checked_add(u64::from(ciphertext_len))
        .ok_or(BackupContainerError::ArtifactRejected)?;
    Ok(())
}

fn open_frame(
    content_key: &[u8; CONTENT_KEY_BYTES],
    header_digest: &[u8; DIGEST_BYTES],
    backup_id: &[u8; 16],
    binding_digest: &[u8; DIGEST_BYTES],
    nonce_prefix: &[u8; 16],
    frame: &EncryptedFrame<'_>,
) -> Result<Vec<u8>, BackupContainerError> {
    let nonce = Zeroizing::new(frame_nonce(nonce_prefix, frame.sequence));
    XChaCha20Poly1305::new(&Key::from(*content_key))
        .decrypt(
            &XNonce::from(*nonce),
            Payload {
                msg: frame.ciphertext,
                aad: &frame_aad(
                    header_digest,
                    backup_id,
                    binding_digest,
                    frame.kind,
                    frame.sequence,
                    frame.plaintext_len,
                    frame.ciphertext_len,
                ),
            },
        )
        .map_err(|_| BackupContainerError::ArtifactRejected)
}

fn encode_manifest(manifest: &BackupManifest) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(MANIFEST_PLAINTEXT_BYTES);
    bytes.extend_from_slice(&MANIFEST_VERSION.to_be_bytes());
    bytes.extend_from_slice(&manifest.account_digest);
    bytes.extend_from_slice(&manifest.device_digest);
    bytes.extend_from_slice(&manifest.workspace_digest);
    bytes.extend_from_slice(&manifest.binding_digest);
    bytes.extend_from_slice(&manifest.source_proof_digest);
    bytes.extend_from_slice(&manifest.workspace_schema_version.to_be_bytes());
    bytes.extend_from_slice(&manifest.created_at_epoch_seconds.to_be_bytes());
    bytes.extend_from_slice(&manifest.allowlist_version.to_be_bytes());
    bytes.extend_from_slice(&manifest.data_frame_count.to_be_bytes());
    bytes.extend_from_slice(&manifest.data_plaintext_bytes.to_be_bytes());
    bytes.extend_from_slice(&manifest.authority_floor_digest);
    bytes
}

fn parse_manifest(bytes: &[u8]) -> Result<BackupManifest, BackupContainerError> {
    if bytes.len() != MANIFEST_PLAINTEXT_BYTES {
        return Err(BackupContainerError::ArtifactRejected);
    }
    let mut cursor = Cursor::new(bytes);
    if cursor.u16()? != MANIFEST_VERSION {
        return Err(BackupContainerError::ArtifactRejected);
    }
    let manifest = BackupManifest {
        account_digest: cursor.array()?,
        device_digest: cursor.array()?,
        workspace_digest: cursor.array()?,
        binding_digest: cursor.array()?,
        source_proof_digest: cursor.array()?,
        workspace_schema_version: cursor.u64()?,
        created_at_epoch_seconds: cursor.u64()?,
        allowlist_version: cursor.u32()?,
        data_frame_count: cursor.u32()?,
        data_plaintext_bytes: cursor.u64()?,
        authority_floor_digest: cursor.array()?,
    };
    cursor.finish()?;
    if manifest.workspace_schema_version == 0 || manifest.allowlist_version == 0 {
        return Err(BackupContainerError::ArtifactRejected);
    }
    Ok(manifest)
}

fn encode_trailer(
    prior_frame_count: u64,
    total_plaintext: u64,
    total_ciphertext: u64,
    transcript_digest: &[u8; DIGEST_BYTES],
) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(TRAILER_PLAINTEXT_BYTES);
    bytes.extend_from_slice(&TRAILER_VERSION.to_be_bytes());
    bytes.extend_from_slice(&prior_frame_count.to_be_bytes());
    bytes.extend_from_slice(&total_plaintext.to_be_bytes());
    bytes.extend_from_slice(&total_ciphertext.to_be_bytes());
    bytes.extend_from_slice(transcript_digest);
    bytes
}

struct Trailer {
    prior_frame_count: u64,
    total_plaintext: u64,
    total_ciphertext: u64,
    transcript_digest: [u8; DIGEST_BYTES],
}

fn parse_trailer(bytes: &[u8]) -> Result<Trailer, BackupContainerError> {
    if bytes.len() != TRAILER_PLAINTEXT_BYTES {
        return Err(BackupContainerError::ArtifactRejected);
    }
    let mut cursor = Cursor::new(bytes);
    if cursor.u16()? != TRAILER_VERSION {
        return Err(BackupContainerError::ArtifactRejected);
    }
    let trailer = Trailer {
        prior_frame_count: cursor.u64()?,
        total_plaintext: cursor.u64()?,
        total_ciphertext: cursor.u64()?,
        transcript_digest: cursor.array()?,
    };
    cursor.finish()?;
    Ok(trailer)
}

fn verify_plaintext(
    parsed: &ParsedContainer<'_>,
    plaintext: &[Zeroizing<Vec<u8>>],
    binding: &BindingDigests,
) -> Result<VerifiedArtifact, BackupContainerError> {
    if plaintext.len() != parsed.encrypted_frames.len() || plaintext.len() < 2 {
        return Err(BackupContainerError::ArtifactRejected);
    }
    let manifest = parse_manifest(&plaintext[0])?;
    if manifest.account_digest != binding.account
        || manifest.device_digest != binding.device
        || manifest.workspace_digest != binding.workspace
        || manifest.binding_digest != binding.binding
        || manifest.workspace_schema_version != parsed.header.workspace_schema_version
        || manifest.data_frame_count as usize != plaintext.len() - 2
    {
        return Err(BackupContainerError::ArtifactRejected);
    }
    let data_plaintext_bytes = plaintext[1..plaintext.len() - 1]
        .iter()
        .try_fold(0_u64, |total, frame| total.checked_add(frame.len() as u64))
        .ok_or(BackupContainerError::ArtifactRejected)?;
    if data_plaintext_bytes != manifest.data_plaintext_bytes {
        return Err(BackupContainerError::ArtifactRejected);
    }

    let trailer = parse_trailer(&plaintext[plaintext.len() - 1])?;
    let prior_frames = &parsed.encrypted_frames[..parsed.encrypted_frames.len() - 1];
    let mut transcript = Sha256::new();
    let mut total_plaintext = 0_u64;
    let mut total_ciphertext = 0_u64;
    for frame in prior_frames {
        transcript.update(frame.header_and_ciphertext);
        total_plaintext = total_plaintext
            .checked_add(u64::from(frame.plaintext_len))
            .ok_or(BackupContainerError::ArtifactRejected)?;
        total_ciphertext = total_ciphertext
            .checked_add(u64::from(frame.ciphertext_len))
            .ok_or(BackupContainerError::ArtifactRejected)?;
    }
    let transcript_digest: [u8; DIGEST_BYTES] = transcript.finalize().into();
    if trailer.prior_frame_count != prior_frames.len() as u64
        || trailer.total_plaintext != total_plaintext
        || trailer.total_ciphertext != total_ciphertext
        || trailer.transcript_digest != transcript_digest
    {
        return Err(BackupContainerError::ArtifactRejected);
    }
    Ok(VerifiedArtifact {
        backup_id: parsed.header.backup_id,
        workspace_schema_version: manifest.workspace_schema_version,
        created_at_epoch_seconds: manifest.created_at_epoch_seconds,
        allowlist_version: manifest.allowlist_version,
        data_frame_count: manifest.data_frame_count,
        data_plaintext_bytes,
    })
}

#[cfg(target_os = "macos")]
#[cfg_attr(
    test,
    expect(
        dead_code,
        reason = "native registry loading has no test caller while production backup remains unavailable"
    )
)]
fn load_native_registry(
    anchor: Option<&BackupKekRollbackAnchor>,
) -> Result<Option<BackupKekRegistry>, BackupContainerError> {
    const ITEM_NOT_FOUND: i32 = -25_300;
    match security_framework::passwords::generic_password(keychain_options(false)) {
        Ok(bytes) => {
            verify_registry_keychain_attributes()?;
            let bytes = Zeroizing::new(bytes);
            BackupKekRegistry::decode_custody(&bytes, anchor).map(Some)
        }
        Err(error) if error.code() == ITEM_NOT_FOUND => Ok(None),
        Err(_) => Err(BackupContainerError::KeyUnavailable),
    }
}

#[cfg(not(target_os = "macos"))]
#[cfg_attr(
    test,
    expect(
        dead_code,
        reason = "native registry loading has no test caller while production backup remains unavailable"
    )
)]
fn load_native_registry(
    _anchor: Option<&BackupKekRollbackAnchor>,
) -> Result<Option<BackupKekRegistry>, BackupContainerError> {
    Err(BackupContainerError::KeyUnavailable)
}

#[cfg(target_os = "macos")]
#[cfg_attr(
    test,
    expect(
        dead_code,
        reason = "native Keychain custody has no test caller while production backup remains unavailable"
    )
)]
fn keychain_options(
    include_access_control: bool,
) -> security_framework::passwords::PasswordOptions {
    use security_framework::access_control::{ProtectionMode, SecAccessControl};
    use security_framework::passwords::{AccessControlOptions, PasswordOptions};

    let mut options =
        PasswordOptions::new_generic_password(KEK_KEYCHAIN_SERVICE, KEK_KEYCHAIN_ACCOUNT);
    options.use_protected_keychain();
    options.set_access_synchronized(Some(false));
    if include_access_control {
        options.set_access_control(
            SecAccessControl::create_with_protection(
                Some(ProtectionMode::AccessibleWhenUnlockedThisDeviceOnly),
                AccessControlOptions::empty().bits(),
            )
            .expect("fixed Keychain access control flags are valid"),
        );
    }
    options
}

#[cfg(target_os = "macos")]
#[cfg_attr(
    test,
    expect(
        dead_code,
        reason = "native Keychain custody has no test caller while production backup remains unavailable"
    )
)]
fn verify_registry_keychain_attributes() -> Result<(), BackupContainerError> {
    use security_framework::item::{CloudSync, ItemClass, ItemSearchOptions, SearchResult};
    const ITEM_NOT_FOUND: i32 = -25_300;

    let mut query = ItemSearchOptions::new();
    query
        .class(ItemClass::generic_password())
        .service(KEK_KEYCHAIN_SERVICE)
        .account(KEK_KEYCHAIN_ACCOUNT)
        .cloud_sync(CloudSync::MatchSyncNo)
        .ignore_legacy_keychains()
        .load_attributes(true)
        .limit(1);
    let results = query
        .search()
        .map_err(|_| BackupContainerError::KeyUnavailable)?;
    let Some(result @ SearchResult::Dict(_)) = results.first() else {
        return Err(BackupContainerError::KeyUnavailable);
    };
    let Some(values) = result.simplify_dict() else {
        return Err(BackupContainerError::KeyUnavailable);
    };
    if !valid_keychain_attribute_values(&values) {
        return Err(BackupContainerError::KeyUnavailable);
    }

    let mut synchronized = ItemSearchOptions::new();
    synchronized
        .class(ItemClass::generic_password())
        .service(KEK_KEYCHAIN_SERVICE)
        .account(KEK_KEYCHAIN_ACCOUNT)
        .cloud_sync(CloudSync::MatchSyncYes)
        .ignore_legacy_keychains()
        .load_attributes(true)
        .limit(1);
    match synchronized.search() {
        Err(error) if error.code() == ITEM_NOT_FOUND => Ok(()),
        Ok(results) if results.is_empty() => Ok(()),
        Ok(_) | Err(_) => Err(BackupContainerError::KeyUnavailable),
    }
}

#[cfg(target_os = "macos")]
fn valid_keychain_attribute_values(values: &std::collections::HashMap<String, String>) -> bool {
    values
        .get("svce")
        .is_some_and(|value| value == KEK_KEYCHAIN_SERVICE)
        && values
            .get("acct")
            .is_some_and(|value| value == KEK_KEYCHAIN_ACCOUNT)
        && values.get("pdmn").is_some_and(|value| value == "aku")
        && values.contains_key("accc")
        && values
            .get("agrp")
            .is_some_and(|value| valid_designated_application_group(value))
}

#[cfg(target_os = "macos")]
fn valid_designated_application_group(value: &str) -> bool {
    const BUNDLE_ID: &str = "app.gooddealer.desktop";
    value == BUNDLE_ID
        || value.strip_suffix(BUNDLE_ID).is_some_and(|prefix| {
            let team = prefix.strip_suffix('.').unwrap_or_default();
            team.len() == 10
                && team
                    .bytes()
                    .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit())
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    const BINDING: [u8; DIGEST_BYTES] = [0x44; DIGEST_BYTES];
    const TEST_KEK: [u8; CONTENT_KEY_BYTES] = [0xA5; CONTENT_KEY_BYTES];

    fn host_with_registry(
        registry: BackupKekRegistry,
        binding: BindingDigests,
    ) -> BackupContainerHost {
        let anchor = registry
            .current_anchor()
            .expect("test registry has an anchor");
        BackupContainerHost::new(registry, anchor, binding).expect("test custody is consistent")
    }

    #[cfg(target_os = "macos")]
    #[derive(Clone)]
    struct FileCustodyPort {
        directory: std::path::PathBuf,
    }

    #[cfg(target_os = "macos")]
    impl FileCustodyPort {
        fn new(directory: std::path::PathBuf) -> Self {
            Self { directory }
        }

        fn load_file(
            &self,
            name: &str,
            maximum: usize,
        ) -> Result<Option<Vec<u8>>, BackupContainerError> {
            let path = self.directory.join(name);
            match std::fs::read(path) {
                Ok(bytes) if bytes.len() <= maximum => Ok(Some(bytes)),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
                Ok(_) | Err(_) => Err(BackupContainerError::KeyUnavailable),
            }
        }

        fn store_file(&self, name: &str, bytes: &[u8]) -> Result<(), BackupContainerError> {
            use std::io::Write as _;
            use std::os::unix::fs::OpenOptionsExt as _;

            let mut file = std::fs::OpenOptions::new()
                .create(true)
                .truncate(true)
                .write(true)
                .mode(0o600)
                .open(self.directory.join(name))
                .map_err(|_| BackupContainerError::KeyUnavailable)?;
            file.write_all(bytes)
                .and_then(|()| file.sync_all())
                .map_err(|_| BackupContainerError::KeyUnavailable)
        }
    }

    #[cfg(target_os = "macos")]
    impl BackupKekCustodyPort for FileCustodyPort {
        fn load_registry_blob(&self) -> Result<Option<Zeroizing<Vec<u8>>>, BackupContainerError> {
            self.load_file("registry.bin", KEK_REGISTRY_MAX_BYTES)
                .map(|bytes| bytes.map(Zeroizing::new))
        }

        fn store_registry_blob(&self, bytes: &[u8]) -> Result<(), BackupContainerError> {
            self.store_file("registry.bin", bytes)
        }

        fn load_anchor_blob(&self) -> Result<Option<Vec<u8>>, BackupContainerError> {
            self.load_file("anchor.bin", KEK_ANCHOR_BYTES)
        }

        fn store_anchor_blob(&self, bytes: &[u8]) -> Result<(), BackupContainerError> {
            self.store_file("anchor.bin", bytes)
        }
    }

    fn host() -> BackupContainerHost {
        host_with_registry(
            BackupKekRegistry::deterministic(TEST_KEK, b"slot-one"),
            binding(),
        )
    }

    fn binding() -> BindingDigests {
        BindingDigests {
            account: [0x11; DIGEST_BYTES],
            device: [0x22; DIGEST_BYTES],
            workspace: [0x33; DIGEST_BYTES],
            binding: BINDING,
        }
    }

    fn manifest(data_frames: &[&[u8]]) -> BackupManifest {
        BackupManifest {
            account_digest: [0x11; DIGEST_BYTES],
            device_digest: [0x22; DIGEST_BYTES],
            workspace_digest: [0x33; DIGEST_BYTES],
            binding_digest: BINDING,
            source_proof_digest: [0x55; DIGEST_BYTES],
            workspace_schema_version: 7,
            created_at_epoch_seconds: 1_700_000_000,
            allowlist_version: 3,
            data_frame_count: u32::try_from(data_frames.len()).expect("bounded test frame count"),
            data_plaintext_bytes: data_frames.iter().map(|frame| frame.len() as u64).sum(),
            authority_floor_digest: [0x66; DIGEST_BYTES],
        }
    }

    fn request<'a>(data_frames: &'a [&'a [u8]]) -> ExportRequest<'a> {
        ExportRequest {
            workspace_schema_version: 7,
            manifest: manifest(data_frames),
            data_frames,
        }
    }

    fn entropy() -> ExportEntropy {
        ExportEntropy {
            backup_id: [0x10; 16],
            nonce_prefix: [0x20; 16],
            content_key: [0x30; CONTENT_KEY_BYTES],
            wrap_nonce: [0x40; NONCE_BYTES],
        }
    }

    fn artifact() -> Vec<u8> {
        host()
            .export_with_entropy(request(&[b"row-a", b"row-b"]), entropy())
            .expect("fixture must encode")
    }

    fn assert_rejected(bytes: &[u8]) {
        let mut callback_called = false;
        let result = host().import(bytes, |_| {
            callback_called = true;
            Ok(())
        });
        assert_eq!(result, Err(BackupContainerError::ArtifactRejected));
        assert!(!callback_called);
    }

    #[test]
    fn deterministic_golden_transcript_is_stable_and_round_trips() {
        let bytes = artifact();
        assert_eq!(&bytes[..8], MAGIC);
        assert_eq!(bytes.len(), 620);
        assert_eq!(
            hex(Sha256::digest(&bytes).as_slice()),
            "a400b23ebc116b520adfcf31b3831ad8bd34766a5af55c1ce96faf33137af24e"
        );

        let (verified, observed) = host()
            .import(&bytes, |frames| Ok(frames.concat()))
            .expect("golden artifact must authenticate");
        assert_eq!(observed, b"row-arow-b");
        assert_eq!(verified.backup_id(), &[0x10; 16]);
        assert_eq!(verified.workspace_schema_version(), 7);
        assert_eq!(verified.created_at_epoch_seconds(), 1_700_000_000);
        assert_eq!(verified.allowlist_version(), 3);
        assert_eq!(verified.data_frame_count(), 2);
        assert_eq!(verified.data_plaintext_bytes(), 10);
    }

    #[test]
    fn header_digest_is_external_to_the_exact_header_body() {
        let bytes = artifact();
        let header_len = u32::from_be_bytes(bytes[8..12].try_into().expect("header length"));
        assert_eq!(header_len, 76);
        let digest_offset = 12 + header_len as usize;
        assert_eq!(
            &bytes[digest_offset..digest_offset + DIGEST_BYTES],
            Sha256::digest(&bytes[..digest_offset]).as_slice()
        );
    }

    #[test]
    fn header_parser_rejects_an_unknown_crypto_suite_before_key_lookup() {
        let header = Header {
            backup_id: [0x10; 16],
            nonce_prefix: [0x20; 16],
            workspace_schema_version: 7,
            kek_reference: KekReference {
                id: b"slot-one".to_vec(),
                version: 1,
            },
        };
        let mut body = header.encode().expect("valid header");
        body[2..4].copy_from_slice(&2_u16.to_be_bytes());
        assert_eq!(
            Header::parse(&body).err(),
            Some(BackupContainerError::ArtifactRejected)
        );
    }

    #[test]
    fn unknown_duplicate_reordered_extra_and_trailing_records_are_rejected() {
        let original = artifact();
        let parsed = ParsedContainer::parse(&original).expect("fixture parses structurally");
        let frames_offset = parsed.encrypted_frames[0].header_and_ciphertext.as_ptr() as usize
            - original.as_ptr() as usize;

        let mut unknown_suite = original.clone();
        unknown_suite[14] = 0x7f;
        assert_rejected(&unknown_suite);

        let first = parsed.encrypted_frames[0].header_and_ciphertext.to_vec();
        let second = parsed.encrypted_frames[1].header_and_ciphertext.to_vec();
        let remainder_offset = frames_offset + first.len() + second.len();

        let mut duplicate = original[..frames_offset + first.len()].to_vec();
        duplicate.extend_from_slice(&first);
        duplicate.extend_from_slice(&original[frames_offset + first.len()..]);
        assert_rejected(&duplicate);

        let mut reordered = original[..frames_offset].to_vec();
        reordered.extend_from_slice(&second);
        reordered.extend_from_slice(&first);
        reordered.extend_from_slice(&original[remainder_offset..]);
        assert_rejected(&reordered);

        let mut extra_header_byte = original.clone();
        let header_len = u32::from_be_bytes(extra_header_byte[8..12].try_into().expect("length"));
        extra_header_byte[8..12].copy_from_slice(&(header_len + 1).to_be_bytes());
        extra_header_byte.insert(12 + header_len as usize, 0);
        assert_rejected(&extra_header_byte);

        let mut trailing = original;
        trailing.push(0);
        assert_rejected(&trailing);
    }

    #[test]
    fn every_truncation_and_representative_length_or_digest_tamper_is_rejected() {
        let original = artifact();
        for length in 0..original.len() {
            assert_rejected(&original[..length]);
        }

        let mut header_digest = original.clone();
        let header_len = u32::from_be_bytes(header_digest[8..12].try_into().expect("length"));
        header_digest[12 + header_len as usize] ^= 1;
        assert_rejected(&header_digest);

        let parsed = ParsedContainer::parse(&original).expect("fixture parses");
        let first_offset = parsed.encrypted_frames[0].header_and_ciphertext.as_ptr() as usize
            - original.as_ptr() as usize;
        let mut bad_plaintext_length = original.clone();
        bad_plaintext_length[first_offset + 9..first_offset + 13]
            .copy_from_slice(&u32::MAX.to_be_bytes());
        assert_rejected(&bad_plaintext_length);

        let mut bad_ciphertext_length = original.clone();
        bad_ciphertext_length[first_offset + 13..first_offset + 17]
            .copy_from_slice(&1_u32.to_be_bytes());
        assert_rejected(&bad_ciphertext_length);
    }

    #[test]
    fn tampered_ciphertext_wrong_binding_and_wrong_slot_fail_closed() {
        let original = artifact();
        let parsed = ParsedContainer::parse(&original).expect("fixture parses");
        let ciphertext_offset =
            parsed.encrypted_frames[1].ciphertext.as_ptr() as usize - original.as_ptr() as usize;
        let mut tampered = original.clone();
        tampered[ciphertext_offset] ^= 1;
        assert_rejected(&tampered);

        let wrong_binding_host = host_with_registry(
            BackupKekRegistry::deterministic(TEST_KEK, b"slot-one"),
            BindingDigests {
                binding: [0x45; DIGEST_BYTES],
                ..binding()
            },
        );
        assert_eq!(
            wrong_binding_host.import(&original, |_| Ok(())).err(),
            Some(BackupContainerError::ArtifactRejected)
        );

        let wrong_account_host = host_with_registry(
            BackupKekRegistry::deterministic(TEST_KEK, b"slot-one"),
            BindingDigests {
                account: [0x12; DIGEST_BYTES],
                ..binding()
            },
        );
        assert_eq!(
            wrong_account_host.import(&original, |_| Ok(())).err(),
            Some(BackupContainerError::ArtifactRejected)
        );

        let wrong_slot_host = host_with_registry(
            BackupKekRegistry::deterministic(TEST_KEK, b"other-slot"),
            binding(),
        );
        assert_eq!(
            wrong_slot_host.import(&original, |_| Ok(())).err(),
            Some(BackupContainerError::KeyUnavailable)
        );

        let wrong_key_host = host_with_registry(
            BackupKekRegistry::deterministic([0xA6; CONTENT_KEY_BYTES], b"slot-one"),
            binding(),
        );
        assert_eq!(
            wrong_key_host.import(&original, |_| Ok(())).err(),
            Some(BackupContainerError::ArtifactRejected)
        );
    }

    #[test]
    fn retained_old_key_survives_rotation_but_retired_or_lost_key_does_not() {
        let original = artifact();
        let mut registry = BackupKekRegistry::deterministic(TEST_KEK, b"slot-one");
        let old_reference = registry.slots[0].reference.clone();
        registry
            .rotate_deterministic([0xB6; CONTENT_KEY_BYTES], b"slot-two")
            .expect("rotation succeeds");
        let mut rotated_host = host_with_registry(registry, binding());
        assert!(rotated_host.import(&original, |_| Ok(())).is_ok());
        assert_eq!(
            rotated_host.retire_kek(&old_reference, true),
            Err(BackupContainerError::KeyUnavailable)
        );
        rotated_host
            .retire_kek(&old_reference, false)
            .expect("unreferenced decrypt-only key retires");
        assert_eq!(
            rotated_host.import(&original, |_| Ok(())).err(),
            Some(BackupContainerError::KeyUnavailable)
        );
    }

    #[test]
    fn registry_enforces_three_slots_acl_and_monotonic_watermark() {
        let mut registry = BackupKekRegistry::deterministic(TEST_KEK, b"slot-one");
        registry
            .rotate_deterministic([2; CONTENT_KEY_BYTES], b"slot-two")
            .expect("second slot");
        registry
            .rotate_deterministic([3; CONTENT_KEY_BYTES], b"slot-three")
            .expect("third slot");
        assert_eq!(
            registry.rotate_deterministic([4; CONTENT_KEY_BYTES], b"slot-four"),
            Err(BackupContainerError::KeyUnavailable)
        );

        let anchor = registry.current_anchor().expect("current anchor");
        registry.installation_proof[0] ^= 1;
        assert_eq!(
            registry.active(&anchor).err(),
            Some(BackupContainerError::KeyUnavailable)
        );
        registry.installation_proof[0] ^= 1;
        registry.version_watermark -= 1;
        assert_eq!(
            registry.active(&anchor).err(),
            Some(BackupContainerError::KeyUnavailable)
        );
    }

    #[test]
    fn registry_custody_binary_is_exact_and_rejects_rollback_duplicate_or_trailing_data() {
        let mut registry = BackupKekRegistry::deterministic(TEST_KEK, b"slot-one");
        registry
            .rotate_deterministic([2; CONTENT_KEY_BYTES], b"slot-two")
            .expect("second slot");
        let encoded = registry.encode_custody().expect("registry encodes");
        let anchor = registry.current_anchor().expect("independent anchor");
        let decoded =
            BackupKekRegistry::decode_custody(&encoded, Some(&anchor)).expect("exact registry");
        assert_eq!(
            decoded.encode_custody().expect("round trip").as_slice(),
            encoded.as_slice()
        );
        assert_eq!(
            BackupKekRegistry::decode_custody(&encoded, None).err(),
            Some(BackupContainerError::KeyUnavailable)
        );

        let mut rollback = encoded.to_vec();
        rollback[10..18].copy_from_slice(&1_u64.to_be_bytes());
        assert_eq!(
            BackupKekRegistry::decode_custody(&rollback, Some(&anchor)).err(),
            Some(BackupContainerError::KeyUnavailable)
        );

        let mut duplicate_version = encoded.to_vec();
        let first_id_len = usize::from(duplicate_version[51]);
        let first_version_offset = 52 + first_id_len;
        let second_id_len_offset = first_version_offset + 8 + 1 + CONTENT_KEY_BYTES;
        let second_id_len = usize::from(duplicate_version[second_id_len_offset]);
        let second_version_offset = second_id_len_offset + 1 + second_id_len;
        duplicate_version[second_version_offset..second_version_offset + 8]
            .copy_from_slice(&1_u64.to_be_bytes());
        assert_eq!(
            BackupKekRegistry::decode_custody(&duplicate_version, Some(&anchor)).err(),
            Some(BackupContainerError::KeyUnavailable)
        );

        let mut trailing = encoded.to_vec();
        trailing.push(0);
        assert_eq!(
            BackupKekRegistry::decode_custody(&trailing, Some(&anchor)).err(),
            Some(BackupContainerError::KeyUnavailable)
        );
    }

    #[test]
    fn old_custody_blob_is_rejected_against_the_independent_current_anchor() {
        let registry = BackupKekRegistry::deterministic(TEST_KEK, b"slot-one");
        let old_blob = registry.encode_custody().expect("old blob").to_vec();
        let old_anchor = registry.current_anchor().expect("old anchor");
        let old_reference = registry.slots[0].reference.clone();
        let mut current = BackupContainerHost::new(registry, old_anchor, binding())
            .expect("initial custody is consistent");
        current.rotate_kek().expect("rotation succeeds");
        current
            .retire_kek(&old_reference, false)
            .expect("old slot retires");

        assert_eq!(
            BackupKekRegistry::decode_custody(&old_blob, Some(&current.rollback_anchor)).err(),
            Some(BackupContainerError::KeyUnavailable)
        );
        assert_eq!(
            BackupKekRegistry::decode_custody(&old_blob, None).err(),
            Some(BackupContainerError::KeyUnavailable)
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn custody_transaction_serializes_threaded_first_use_and_rotation() {
        use std::sync::{Arc, Barrier};

        let directory = tempfile::tempdir().expect("temporary custody directory");
        let port = Arc::new(FileCustodyPort::new(directory.path().to_path_buf()));
        let lock_directory = directory.path().join("lock");
        let barrier = Arc::new(Barrier::new(8));
        let mut first_use = Vec::new();
        for _ in 0..8 {
            let port = Arc::clone(&port);
            let lock_directory = lock_directory.clone();
            let barrier = Arc::clone(&barrier);
            first_use.push(std::thread::spawn(move || {
                barrier.wait();
                let custody = LockedBackupKekCustody::load_or_create_at(
                    port.as_ref(),
                    &lock_directory,
                    binding(),
                )
                .expect("locked first use");
                let frames = [b"threaded-first-use".as_slice()];
                custody
                    .export(request(&frames))
                    .expect("artifact export")
                    .bytes()
                    .to_vec()
            }));
        }
        let first_use_artifacts = first_use
            .into_iter()
            .map(|thread| thread.join().expect("first-use worker"))
            .collect::<Vec<_>>();

        let custody =
            LockedBackupKekCustody::load_or_create_at(port.as_ref(), &lock_directory, binding())
                .expect("final first-use custody");
        assert_eq!(custody.host.registry.slots.len(), 1);
        assert_eq!(custody.host.registry.version_watermark, 1);
        for artifact in &first_use_artifacts {
            assert!(custody.import(artifact, |_| Ok(())).is_ok());
        }
        drop(custody);

        let barrier = Arc::new(Barrier::new(2));
        let mut rotations = Vec::new();
        for _ in 0..2 {
            let port = Arc::clone(&port);
            let lock_directory = lock_directory.clone();
            let barrier = Arc::clone(&barrier);
            rotations.push(std::thread::spawn(move || {
                barrier.wait();
                let mut custody = LockedBackupKekCustody::load_or_create_at(
                    port.as_ref(),
                    &lock_directory,
                    binding(),
                )
                .expect("locked rotation load");
                custody.rotate().expect("serialized rotation");
                let frames = [b"artifact-after-rotation".as_slice()];
                custody
                    .export(request(&frames))
                    .expect("rotated artifact")
                    .bytes()
                    .to_vec()
            }));
        }
        let rotation_artifacts = rotations
            .into_iter()
            .map(|thread| thread.join().expect("rotation worker"))
            .collect::<Vec<_>>();
        let custody =
            LockedBackupKekCustody::load_or_create_at(port.as_ref(), &lock_directory, binding())
                .expect("final rotated custody");
        assert_eq!(custody.host.registry.slots.len(), 3);
        assert_eq!(custody.host.registry.version_watermark, 3);
        for artifact in first_use_artifacts.iter().chain(&rotation_artifacts) {
            assert!(custody.import(artifact, |_| Ok(())).is_ok());
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn custody_transaction_serializes_concurrent_retire_without_lost_updates() {
        use std::sync::{Arc, Barrier};

        let directory = tempfile::tempdir().expect("temporary custody directory");
        let port = Arc::new(FileCustodyPort::new(directory.path().to_path_buf()));
        let lock_directory = directory.path().join("lock");
        let references = {
            let mut custody = LockedBackupKekCustody::load_or_create_at(
                port.as_ref(),
                &lock_directory,
                binding(),
            )
            .expect("initial custody");
            custody.rotate().expect("second slot");
            custody.rotate().expect("third slot");
            [
                custody.host.registry.slots[0].reference.clone(),
                custody.host.registry.slots[1].reference.clone(),
            ]
        };
        let barrier = Arc::new(Barrier::new(2));
        let threads = references.map(|reference| {
            let port = Arc::clone(&port);
            let lock_directory = lock_directory.clone();
            let barrier = Arc::clone(&barrier);
            std::thread::spawn(move || {
                barrier.wait();
                let mut custody = LockedBackupKekCustody::load_or_create_at(
                    port.as_ref(),
                    &lock_directory,
                    binding(),
                )
                .expect("retirement load");
                custody
                    .retire(&reference, false)
                    .expect("serialized retirement");
            })
        });
        for thread in threads {
            thread.join().expect("retirement worker");
        }
        let custody =
            LockedBackupKekCustody::load_or_create_at(port.as_ref(), &lock_directory, binding())
                .expect("final custody");
        assert_eq!(custody.host.registry.slots.len(), 1);
        assert_eq!(custody.host.registry.version_watermark, 3);
        assert!(custody.host.registry.slots[0].encrypt_enabled);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn backup_kek_custody_child_process() {
        let Ok(root) = std::env::var("GOODDEALER_BACKUP_KEK_TEST_ROOT") else {
            return;
        };
        let role = std::env::var("GOODDEALER_BACKUP_KEK_TEST_ROLE").expect("child role is present");
        let root = std::path::PathBuf::from(root);
        let port = FileCustodyPort::new(root.clone());
        let custody =
            LockedBackupKekCustody::load_or_create_at(&port, &root.join("lock"), binding())
                .expect("child custody");
        let frames = [b"child-process-artifact".as_slice()];
        let artifact = custody.export(request(&frames)).expect("child artifact");
        std::fs::write(root.join(format!("{role}.artifact")), artifact.bytes())
            .expect("child artifact write");
        std::fs::write(root.join(format!("{role}.acquired")), b"acquired")
            .expect("child marker write");
        std::fs::write(root.join(format!("{role}.executed")), b"executed")
            .expect("child execution marker write");
        for _ in 0..500 {
            if root.join(format!("{role}.release")).exists() {
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        panic!("parent did not release child custody lock");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn kernel_lock_serializes_first_use_across_processes_and_recovers_after_crash() {
        use std::process::{Child, Command};

        fn spawn_child(root: &std::path::Path, role: &str) -> Child {
            Command::new(std::env::current_exe().expect("test executable"))
                .arg("--exact")
                .arg("backup::container::tests::backup_kek_custody_child_process")
                .arg("--nocapture")
                .env("GOODDEALER_BACKUP_KEK_TEST_ROOT", root)
                .env("GOODDEALER_BACKUP_KEK_TEST_ROLE", role)
                .spawn()
                .expect("child starts")
        }

        fn wait_for(path: &std::path::Path) {
            for _ in 0..300 {
                if path.exists() {
                    return;
                }
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
            panic!("timed out waiting for {}", path.display());
        }

        let directory = tempfile::tempdir().expect("temporary custody directory");
        let first_acquired = directory.path().join("first.acquired");
        let second_acquired = directory.path().join("second.acquired");
        let first_executed = directory.path().join("first.executed");
        let second_executed = directory.path().join("second.executed");
        let mut first = spawn_child(directory.path(), "first");
        wait_for(&first_acquired);
        wait_for(&first_executed);
        let mut second = spawn_child(directory.path(), "second");
        std::thread::sleep(std::time::Duration::from_millis(150));
        assert!(!second_acquired.exists());

        first.kill().expect("kill first child");
        assert!(!first.wait().expect("first child status").success());
        wait_for(&second_acquired);
        wait_for(&second_executed);
        std::fs::write(directory.path().join("second.release"), b"release")
            .expect("release second child");
        assert!(second.wait().expect("second child status").success());

        let port = FileCustodyPort::new(directory.path().to_path_buf());
        let custody = LockedBackupKekCustody::load_or_create_at(
            &port,
            &directory.path().join("lock"),
            binding(),
        )
        .expect("final custody");
        assert_eq!(custody.host.registry.slots.len(), 1);
        assert_eq!(custody.host.registry.version_watermark, 1);
        for role in ["first", "second"] {
            let artifact = std::fs::read(directory.path().join(format!("{role}.artifact")))
                .expect("child artifact exists");
            assert!(custody.import(&artifact, |_| Ok(())).is_ok());
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn keychain_readback_accepts_only_when_unlocked_this_device_only_attributes() {
        let mut values = std::collections::HashMap::from([
            ("svce".to_owned(), KEK_KEYCHAIN_SERVICE.to_owned()),
            ("acct".to_owned(), KEK_KEYCHAIN_ACCOUNT.to_owned()),
            ("pdmn".to_owned(), "aku".to_owned()),
            ("accc".to_owned(), "opaque".to_owned()),
            (
                "agrp".to_owned(),
                "A1B2C3D4E5.app.gooddealer.desktop".to_owned(),
            ),
        ]);
        assert!(valid_keychain_attribute_values(&values));

        values.insert("pdmn".to_owned(), "akpu".to_owned());
        assert!(!valid_keychain_attribute_values(&values));

        let source = include_str!("container.rs");
        assert!(source.contains("Some(ProtectionMode::AccessibleWhenUnlockedThisDeviceOnly)"));
    }

    #[test]
    fn registry_is_independent_of_session_lease_and_operation_generations() {
        let registry = BackupKekRegistry::deterministic(TEST_KEK, b"slot-one");
        let host_before_renewal = host_with_registry(registry, binding());
        let bytes = host_before_renewal
            .export_with_entropy(request(&[b"stable"]), entropy())
            .expect("export succeeds");
        // A renewed runtime reuses installation custody; no session/Lease/generation enters the
        // registry identity or GDBK header.
        assert!(host_before_renewal.import(&bytes, |_| Ok(())).is_ok());
    }

    #[test]
    fn limits_and_manifest_counts_are_enforced_before_encryption() {
        let oversized = vec![0_u8; FRAME_PLAINTEXT_LIMIT + 1];
        assert_eq!(
            host()
                .export_with_entropy(request(&[&oversized]), entropy())
                .err(),
            Some(BackupContainerError::ArtifactRejected)
        );

        let maximum_frame = vec![0_u8; FRAME_PLAINTEXT_LIMIT];
        assert!(
            host()
                .export_with_entropy(request(&[&maximum_frame]), entropy())
                .is_ok()
        );

        let repeated_large_frame = vec![0_u8; FRAME_PLAINTEXT_LIMIT];
        let over_artifact_limit = vec![repeated_large_frame.as_slice(); 513];
        assert_eq!(
            host()
                .export_with_entropy(request(&over_artifact_limit), entropy())
                .err(),
            Some(BackupContainerError::ArtifactRejected)
        );

        let empty = host()
            .export_with_entropy(request(&[]), entropy())
            .expect("manifest and trailer form a valid empty projection");
        assert!(host().import(&empty, |frames| Ok(frames.len())).is_ok());

        let mut bad_manifest = manifest(&[b"a"]);
        bad_manifest.data_frame_count = 2;
        assert_eq!(
            host()
                .export_with_entropy(
                    ExportRequest {
                        workspace_schema_version: 7,
                        manifest: bad_manifest,
                        data_frames: &[b"a"],
                    },
                    entropy(),
                )
                .err(),
            Some(BackupContainerError::ArtifactRejected)
        );

        assert_eq!(
            validate_artifact_size(ARTIFACT_BYTE_LIMIT + 1),
            Err(BackupContainerError::ArtifactRejected)
        );
    }

    #[test]
    fn candidate_sees_plaintext_only_after_full_verification_and_errors_are_non_observing() {
        let bytes = artifact();
        let mut seen = Vec::new();
        let (_, ()) = host()
            .import(&bytes, |frames| {
                seen.extend(frames.iter().map(|frame| frame.to_vec()));
                Ok(())
            })
            .expect("valid artifact");
        assert_eq!(seen, vec![b"row-a".to_vec(), b"row-b".to_vec()]);

        let secret = "raw-key-and-path-must-not-appear";
        let mut malformed = bytes;
        malformed.extend_from_slice(secret.as_bytes());
        let error = host()
            .import(&malformed, |_| Ok(()))
            .expect_err("must reject");
        assert_eq!(
            format!("{error:?}"),
            "BackupContainerError::ArtifactRejected"
        );
        assert_eq!(error.to_string(), "BACKUP_ARTIFACT_REJECTED");
        assert!(!format!("{error:?}{error}").contains(secret));
        assert_eq!(format!("{:?}", host()), "BackupContainerHost([REDACTED])");

        assert_eq!(
            host().import(&artifact(), |_| Err::<(), ()>(())).err(),
            Some(BackupContainerError::ArtifactRejected)
        );
    }

    #[test]
    fn secret_owners_have_drop_zeroization_and_ciphertext_never_contains_fixture_plaintext() {
        assert!(std::mem::needs_drop::<ExportEntropy>());
        assert!(std::mem::needs_drop::<BackupKekRegistry>());
        assert!(std::mem::needs_drop::<Zeroizing<Vec<u8>>>());

        let bytes = artifact();
        for plaintext in [b"row-a".as_slice(), b"row-b".as_slice()] {
            assert!(
                bytes
                    .windows(plaintext.len())
                    .all(|window| window != plaintext)
            );
        }
    }

    #[test]
    fn all_frame_nonces_are_prefix_plus_big_endian_sequence() {
        let bytes = artifact();
        let parsed = ParsedContainer::parse(&bytes).expect("fixture parses");
        for (expected, frame) in parsed.encrypted_frames.iter().enumerate() {
            let nonce = frame_nonce(&parsed.header.nonce_prefix, frame.sequence);
            assert_eq!(&nonce[..16], &[0x20; 16]);
            assert_eq!(&nonce[16..], &(expected as u64).to_be_bytes());
        }
    }

    fn hex(bytes: &[u8]) -> String {
        const DIGITS: &[u8; 16] = b"0123456789abcdef";
        let mut output = String::with_capacity(bytes.len() * 2);
        for byte in bytes {
            output.push(DIGITS[usize::from(byte >> 4)] as char);
            output.push(DIGITS[usize::from(byte & 0x0f)] as char);
        }
        output
    }
}
