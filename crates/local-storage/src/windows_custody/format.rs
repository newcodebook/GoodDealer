//! Closed Windows vault commitment format and initialization crash classification.
use zeroize::Zeroizing;
#[derive(Clone, Copy, Debug)]
pub(super) struct FormatRejected;
type Result<T> = std::result::Result<T, FormatRejected>;
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) struct FileIdentity {
    pub(crate) volume: u64,
    pub(crate) index: u64,
}
pub(super) const MAX_RECORD: usize = 131_072;
const PENDING_MAGIC: &[u8] = b"GOODDEALER/WINDOWS-CUSTODY-PENDING-V1\0";
const REF_MAGIC: &[u8] = b"GOODDEALER/WINDOWS-CUSTODY-REF-V1\0";
const AAD_DOMAIN: &[u8] = b"GOODDEALER/WINDOWS-CUSTODY-AEAD-V1\0";
pub(super) struct CommitReference {
    pub(super) purpose: [u8; 32],
    pub(super) initialization: [u8; 32],
    pub(super) root: FileIdentity,
    pub(super) file: FileIdentity,
    pub(super) id: [u8; 16],
    pub(super) length: u32,
    pub(super) digest: [u8; 32],
    pub(super) key: Zeroizing<[u8; 32]>,
    pub(super) nonce: [u8; 24],
    pub(super) deleted: bool,
}

pub(super) enum SlotState {
    Fresh,
    Pending([u8; 32]),
    Committed(CommitReference),
}
impl CommitReference {
    pub(super) fn aad(&self) -> Vec<u8> {
        let mut bytes = AAD_DOMAIN.to_vec();
        bytes.extend(self.purpose);
        bytes.extend(self.initialization);
        for identity in [self.root, self.file] {
            bytes.extend(identity.volume.to_be_bytes());
            bytes.extend(identity.index.to_be_bytes());
        }
        bytes.extend(self.id);
        bytes.push(u8::from(self.deleted));
        bytes
    }
    pub(super) fn encode(&self) -> Zeroizing<Vec<u8>> {
        let mut bytes = Zeroizing::new(REF_MAGIC.to_vec());
        bytes.extend(self.purpose);
        bytes.extend(self.initialization);
        for identity in [self.root, self.file] {
            bytes.extend(identity.volume.to_be_bytes());
            bytes.extend(identity.index.to_be_bytes());
        }
        bytes.extend(self.id);
        bytes.extend(self.length.to_be_bytes());
        bytes.extend(self.digest);
        bytes.extend(*self.key);
        bytes.extend(self.nonce);
        bytes.push(u8::from(self.deleted));
        bytes
    }
    pub(super) fn decode(bytes: &[u8]) -> Result<Self> {
        fn take<const N: usize>(bytes: &mut &[u8]) -> Result<[u8; N]> {
            let (value, rest) = bytes.split_at_checked(N).ok_or(FormatRejected)?;
            *bytes = rest;
            value.try_into().map_err(|_| FormatRejected)
        }
        let mut bytes = bytes.strip_prefix(REF_MAGIC).ok_or(FormatRejected)?;
        let purpose = take(&mut bytes)?;
        let initialization = take(&mut bytes)?;
        let root = FileIdentity {
            volume: u64::from_be_bytes(take(&mut bytes)?),
            index: u64::from_be_bytes(take(&mut bytes)?),
        };
        let file = FileIdentity {
            volume: u64::from_be_bytes(take(&mut bytes)?),
            index: u64::from_be_bytes(take(&mut bytes)?),
        };
        let id = take(&mut bytes)?;
        let length = u32::from_be_bytes(take(&mut bytes)?);
        let digest = take(&mut bytes)?;
        let key = Zeroizing::new(take(&mut bytes)?);
        let nonce = take(&mut bytes)?;
        let deleted = match take::<1>(&mut bytes)?[0] {
            0 => false,
            1 => true,
            _ => return Err(FormatRejected),
        };
        if !bytes.is_empty()
            || length < 16
            || length as usize > MAX_RECORD + 16
            || id == [0; 16]
            || initialization == [0; 32]
            || root.volume == 0
            || root.index == 0
            || file.volume == 0
            || file.index == 0
        {
            return Err(FormatRejected);
        }
        Ok(Self {
            purpose,
            initialization,
            root,
            file,
            id,
            length,
            digest,
            key,
            nonce,
            deleted,
        })
    }
}
pub(super) fn encode_pending(
    purpose: [u8; 32],
    root: FileIdentity,
    initialization: [u8; 32],
) -> Vec<u8> {
    let mut bytes = PENDING_MAGIC.to_vec();
    bytes.extend(purpose);
    bytes.extend(root.volume.to_be_bytes());
    bytes.extend(root.index.to_be_bytes());
    bytes.extend(initialization);
    bytes
}
pub(super) fn marker_value(purpose: [u8; 32], initialization: [u8; 32]) -> Vec<u8> {
    [purpose.as_slice(), initialization.as_slice()].concat()
}
pub(super) fn classify_slot(
    purpose: [u8; 32],
    root: FileIdentity,
    marker: Option<&[u8]>,
    vault: Option<&[u8]>,
) -> Result<SlotState> {
    let Some(bytes) = vault else {
        return if marker.is_none() {
            Ok(SlotState::Fresh)
        } else {
            Err(FormatRejected)
        };
    };
    if let Some(payload) = bytes.strip_prefix(PENDING_MAGIC) {
        if payload.len() != 80 {
            return Err(FormatRejected);
        }
        let nonce: [u8; 32] = payload[48..].try_into().map_err(|_| FormatRejected)?;
        if nonce == [0; 32]
            || encode_pending(purpose, root, nonce).as_slice() != bytes
            || marker.is_some_and(|value| !marker_value(purpose, nonce).starts_with(value))
        {
            return Err(FormatRejected);
        }
        return Ok(SlotState::Pending(nonce));
    }
    let reference = CommitReference::decode(bytes)?;
    if reference.purpose != purpose
        || reference.root != root
        || marker != Some(marker_value(purpose, reference.initialization).as_slice())
    {
        return Err(FormatRejected);
    }
    Ok(SlotState::Committed(reference))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chacha20poly1305::aead::{Aead as _, Payload};
    use chacha20poly1305::{KeyInit as _, XChaCha20Poly1305, XNonce};

    fn reference() -> CommitReference {
        CommitReference {
            purpose: [1; 32],
            initialization: [2; 32],
            root: FileIdentity {
                volume: 3,
                index: 4,
            },
            file: FileIdentity {
                volume: 3,
                index: 5,
            },
            id: [6; 16],
            length: 32,
            digest: [7; 32],
            key: Zeroizing::new([8; 32]),
            nonce: [9; 24],
            deleted: false,
        }
    }
    #[test]
    fn initialization_recovers_every_marker_crash_prefix_without_granting_a_record() {
        let r = reference();
        let pending = encode_pending(r.purpose, r.root, r.initialization);
        assert!(matches!(
            classify_slot(r.purpose, r.root, None, None),
            Ok(SlotState::Fresh)
        ));
        assert!(
            matches!(classify_slot(r.purpose,r.root,None,Some(&pending)),Ok(SlotState::Pending(n)) if n==r.initialization)
        );
        let marker = marker_value(r.purpose, r.initialization);
        for size in 0..=marker.len() {
            assert!(
                matches!(classify_slot(r.purpose,r.root,Some(&marker[..size]),Some(&pending)),Ok(SlotState::Pending(n)) if n==r.initialization)
            );
        }
        assert!(classify_slot(r.purpose, r.root, Some(&[0]), Some(&pending)).is_err());
    }
    #[test]
    fn committed_authority_never_falls_back_to_first_use() {
        let r = reference();
        let committed = r.encode();
        let marker = marker_value(r.purpose, r.initialization);
        assert!(matches!(
            classify_slot(r.purpose, r.root, Some(&marker), Some(&committed)),
            Ok(SlotState::Committed(decoded)) if decoded.length==r.length
        ));
        assert!(classify_slot(r.purpose, r.root, None, Some(&committed)).is_err());
        for size in 0..marker.len() {
            assert!(
                classify_slot(r.purpose, r.root, Some(&marker[..size]), Some(&committed)).is_err()
            );
            assert!(classify_slot(r.purpose, r.root, Some(&marker[..size]), None).is_err());
        }
        assert!(classify_slot(r.purpose, r.root, Some(&marker), None).is_err());
        let wrong_marker = marker_value(r.purpose, [99; 32]);
        assert!(classify_slot(r.purpose, r.root, Some(&wrong_marker), Some(&committed)).is_err());
    }
    #[test]
    fn vault_states_bind_purpose_root_nonce_and_exact_versioned_length() {
        let r = reference();
        let marker = marker_value(r.purpose, r.initialization);
        for encoded in [
            r.encode().to_vec(),
            encode_pending(r.purpose, r.root, r.initialization),
        ] {
            assert!(classify_slot([99; 32], r.root, Some(&marker), Some(&encoded)).is_err());
            assert!(
                classify_slot(
                    r.purpose,
                    FileIdentity {
                        volume: 3,
                        index: 99
                    },
                    Some(&marker),
                    Some(&encoded)
                )
                .is_err()
            );
            for length in 0..encoded.len() {
                assert!(
                    classify_slot(r.purpose, r.root, Some(&marker), Some(&encoded[..length]))
                        .is_err()
                );
            }
            let mut trailing = encoded;
            trailing.push(0);
            assert!(classify_slot(r.purpose, r.root, Some(&marker), Some(&trailing)).is_err());
        }
        let zero_pending = encode_pending(r.purpose, r.root, [0; 32]);
        assert!(classify_slot(r.purpose, r.root, None, Some(&zero_pending)).is_err());
    }
    #[test]
    fn committed_codec_rejects_unbounded_or_invalid_metadata() {
        let r = reference();
        let decoded = CommitReference::decode(&r.encode()).unwrap();
        assert_eq!(decoded.encode().as_slice(), r.encode().as_slice());
        let mut r = reference();
        r.length = u32::try_from(MAX_RECORD).unwrap() + 17;
        assert!(CommitReference::decode(&r.encode()).is_err());
        r.length = 15;
        assert!(CommitReference::decode(&r.encode()).is_err());
        r.length = 32;
        r.initialization = [0; 32];
        assert!(CommitReference::decode(&r.encode()).is_err());
        r.initialization = [2; 32];
        r.root.index = 0;
        assert!(CommitReference::decode(&r.encode()).is_err());
        r.root.index = 4;
        r.id = [0; 16];
        assert!(CommitReference::decode(&r.encode()).is_err());
    }
    #[test]
    fn real_aead_handles_large_records_and_binds_every_custody_identity() {
        let r = reference();
        let cipher = XChaCha20Poly1305::new((&*r.key).into());
        for length in [32, 65_536, 90_000, MAX_RECORD] {
            let plain = Zeroizing::new(vec![42; length]);
            let ciphertext = cipher
                .encrypt(
                    &XNonce::from(r.nonce),
                    Payload {
                        msg: &plain,
                        aad: &r.aad(),
                    },
                )
                .unwrap();
            let decoded = Zeroizing::new(
                cipher
                    .decrypt(
                        &XNonce::from(r.nonce),
                        Payload {
                            msg: &ciphertext,
                            aad: &r.aad(),
                        },
                    )
                    .unwrap(),
            );
            assert_eq!(decoded.as_slice(), plain.as_slice());
            let mut changed = r.aad();
            for index in [
                0,
                AAD_DOMAIN.len(),
                AAD_DOMAIN.len() + 32,
                AAD_DOMAIN.len() + 64,
                changed.len() - 1,
            ] {
                changed[index] ^= 1;
                assert!(
                    cipher
                        .decrypt(
                            &XNonce::from(r.nonce),
                            Payload {
                                msg: &ciphertext,
                                aad: &changed
                            }
                        )
                        .is_err()
                );
                changed[index] ^= 1;
            }
            let mut corrupt = ciphertext;
            corrupt[0] ^= 1;
            assert!(
                cipher
                    .decrypt(
                        &XNonce::from(r.nonce),
                        Payload {
                            msg: &corrupt,
                            aad: &r.aad()
                        }
                    )
                    .is_err()
            );
        }
    }
}
