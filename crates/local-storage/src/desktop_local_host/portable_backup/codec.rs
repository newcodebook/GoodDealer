//! Portable business backup framing. Recovery material is independent of installation identity,
//! database keys, authorization and Cloud. Frames contain the existing business projection.

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use chacha20poly1305::{
    XChaCha20Poly1305, XNonce,
    aead::{AeadInOut, KeyInit},
};
use ring::hkdf;
use zeroize::Zeroizing;

const MAGIC: &[u8; 8] = b"GDBK\0V2\0";
const SUITE: u16 = 1;
const KDF_INFO: &[u8] = b"GOODDEALER/GDBK-V2/PORTABLE-ARTIFACT";
const MATERIAL_PREFIX: &[u8; 6] = b"GDBK2-";
pub(super) const MATERIAL_LENGTH: usize = MATERIAL_PREFIX.len() + 43;
const HEADER_LEN: usize = 8 + 2 + 8 + 32 + 16;
const TAG_LEN: usize = 16;
const FRAME_LEN: usize = 1024 * 1024;
pub(super) const MAX_PROJECTION_LEN: usize = 64 * FRAME_LEN;
const MANIFEST_LEN: usize = 8 + 2 + 32;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct PortableArtifactRejected;

pub(super) struct RecoveryMaterial(Zeroizing<[u8; 32]>);

impl RecoveryMaterial {
    pub(super) fn generate() -> Result<Self, PortableArtifactRejected> {
        let mut material = Zeroizing::new([0; 32]);
        getrandom::fill(material.as_mut()).map_err(|_| PortableArtifactRejected)?;
        Ok(Self(material))
    }

    pub(super) fn parse(input: &[u8]) -> Result<Self, PortableArtifactRejected> {
        if input.len() != MATERIAL_LENGTH || !input.starts_with(MATERIAL_PREFIX) {
            return Err(PortableArtifactRejected);
        }
        // Some base64 decoders require room for a 33rd estimated byte even for this exact input.
        let mut decoded = Zeroizing::new([0; 33]);
        if URL_SAFE_NO_PAD
            .decode_slice(&input[MATERIAL_PREFIX.len()..], decoded.as_mut())
            .map_err(|_| PortableArtifactRejected)?
            != 32
        {
            return Err(PortableArtifactRejected);
        }
        let mut material = Zeroizing::new([0; 32]);
        material.copy_from_slice(&decoded[..32]);
        if Self::encode_material(&material)?.as_slice() != input {
            return Err(PortableArtifactRejected);
        }
        Ok(Self(material))
    }

    pub(super) fn encode(
        &self,
    ) -> Result<Zeroizing<[u8; MATERIAL_LENGTH]>, PortableArtifactRejected> {
        Self::encode_material(&self.0)
    }

    fn encode_material(
        material: &[u8; 32],
    ) -> Result<Zeroizing<[u8; MATERIAL_LENGTH]>, PortableArtifactRejected> {
        let mut output = Zeroizing::new([0; MATERIAL_LENGTH]);
        output[..MATERIAL_PREFIX.len()].copy_from_slice(MATERIAL_PREFIX);
        if URL_SAFE_NO_PAD
            .encode_slice(material, &mut output[MATERIAL_PREFIX.len()..])
            .map_err(|_| PortableArtifactRejected)?
            != MATERIAL_LENGTH - MATERIAL_PREFIX.len()
        {
            return Err(PortableArtifactRejected);
        }
        Ok(output)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct Manifest {
    pub created_at: u64,
    pub allowlist_version: u16,
    pub projection_digest: [u8; 32],
}

pub(super) struct OpenedArtifact {
    pub manifest: Manifest,
    projection: Zeroizing<Vec<u8>>,
}
impl OpenedArtifact {
    pub(super) fn frames(&self) -> impl Iterator<Item = &[u8]> {
        projection_frames(&self.projection)
    }

    pub(super) fn authenticated_projection(&self) -> &[u8] {
        self.projection.as_slice()
    }
}

pub(super) fn projection_frames(projection: &[u8]) -> impl Iterator<Item = &[u8]> {
    projection.chunks(FRAME_LEN)
}

pub(super) fn seal(
    material: &RecoveryMaterial,
    manifest: Manifest,
    frames: &[&[u8]],
) -> Result<Vec<u8>, PortableArtifactRejected> {
    let (last, prefix) = frames.split_last().ok_or(PortableArtifactRejected)?;
    if !(1..=FRAME_LEN).contains(&last.len())
        || prefix.len() >= MAX_PROJECTION_LEN / FRAME_LEN
        || prefix.iter().any(|frame| frame.len() != FRAME_LEN)
    {
        return Err(PortableArtifactRejected);
    }
    let projection_len = prefix.len() * FRAME_LEN + last.len();
    let mut header = [0; HEADER_LEN];
    header[..8].copy_from_slice(MAGIC);
    header[8..10].copy_from_slice(&SUITE.to_be_bytes());
    let length = u64::try_from(projection_len).map_err(|_| PortableArtifactRejected)?;
    header[10..18].copy_from_slice(&length.to_be_bytes());
    getrandom::fill(&mut header[18..]).map_err(|_| PortableArtifactRejected)?;
    let cipher = cipher(material, &header)?;
    let mut output = Vec::with_capacity(artifact_len(projection_len));
    output.extend_from_slice(&header);
    let mut meta = Zeroizing::new([0; MANIFEST_LEN]);
    meta[..8].copy_from_slice(&manifest.created_at.to_be_bytes());
    meta[8..10].copy_from_slice(&manifest.allowlist_version.to_be_bytes());
    meta[10..].copy_from_slice(&manifest.projection_digest);
    append_frame(&mut output, &cipher, &header, 0, &meta[..])?;
    for (index, frame) in frames.iter().enumerate() {
        append_frame(&mut output, &cipher, &header, sequence(index)?, frame)?;
    }
    Ok(output)
}

pub(super) fn open(
    material: &RecoveryMaterial,
    bytes: &[u8],
) -> Result<OpenedArtifact, PortableArtifactRejected> {
    let (header, ciphertext) = bytes
        .split_first_chunk::<HEADER_LEN>()
        .ok_or(PortableArtifactRejected)?;
    if &header[..8] != MAGIC || header[8..10] != SUITE.to_be_bytes() {
        return Err(PortableArtifactRejected);
    }
    let length = u64::from_be_bytes(
        header[10..18]
            .try_into()
            .map_err(|_| PortableArtifactRejected)?,
    );
    let length = usize::try_from(length).map_err(|_| PortableArtifactRejected)?;
    if !(1..=MAX_PROJECTION_LEN).contains(&length) || bytes.len() != artifact_len(length) {
        return Err(PortableArtifactRejected);
    }
    let (meta_wire, data_wire) = ciphertext.split_at(MANIFEST_LEN + TAG_LEN);
    let cipher = cipher(material, header)?;
    let mut meta = Zeroizing::new([0; MANIFEST_LEN]);
    open_frame(&mut meta[..], &cipher, header, 0, meta_wire)?;
    let manifest = Manifest {
        created_at: u64::from_be_bytes(meta[..8].try_into().map_err(|_| PortableArtifactRejected)?),
        allowlist_version: u16::from_be_bytes(
            meta[8..10]
                .try_into()
                .map_err(|_| PortableArtifactRejected)?,
        ),
        projection_digest: meta[10..]
            .try_into()
            .map_err(|_| PortableArtifactRejected)?,
    };
    // The authenticated manifest proves the material before allocating the projection.
    let mut projection = Zeroizing::new(vec![0; length]);
    for (index, (frame, encrypted)) in projection
        .chunks_mut(FRAME_LEN)
        .zip(data_wire.chunks(FRAME_LEN + TAG_LEN))
        .enumerate()
    {
        open_frame(frame, &cipher, header, sequence(index)?, encrypted)?;
    }
    Ok(OpenedArtifact {
        manifest,
        projection,
    })
}

pub(super) fn artifact_len(plaintext_len: usize) -> usize {
    HEADER_LEN
        + MANIFEST_LEN
        + TAG_LEN
        + plaintext_len
        + plaintext_len.div_ceil(FRAME_LEN) * TAG_LEN
}

fn cipher(
    material: &RecoveryMaterial,
    header: &[u8; HEADER_LEN],
) -> Result<XChaCha20Poly1305, PortableArtifactRejected> {
    let salt = hkdf::Salt::new(hkdf::HKDF_SHA256, &header[18..50]);
    let extracted = salt.extract(material.0.as_slice());
    let info = [KDF_INFO];
    let mut key = Zeroizing::new([0; 32]);
    extracted
        .expand(&info, hkdf::HKDF_SHA256)
        .map_err(|_| PortableArtifactRejected)?
        .fill(key.as_mut())
        .map_err(|_| PortableArtifactRejected)?;
    XChaCha20Poly1305::new_from_slice(key.as_slice()).map_err(|_| PortableArtifactRejected)
}

fn sequence(index: usize) -> Result<u64, PortableArtifactRejected> {
    u64::try_from(index + 1).map_err(|_| PortableArtifactRejected)
}

fn nonce_and_aad(header: &[u8; HEADER_LEN], sequence: u64) -> (XNonce, [u8; HEADER_LEN + 8]) {
    let sequence = sequence.to_be_bytes();
    let mut nonce = [0; 24];
    nonce[..16].copy_from_slice(&header[50..]);
    nonce[16..].copy_from_slice(&sequence);
    let mut aad = [0; HEADER_LEN + 8];
    aad[..HEADER_LEN].copy_from_slice(header);
    aad[HEADER_LEN..].copy_from_slice(&sequence);
    (XNonce::from(nonce), aad)
}

fn append_frame(
    output: &mut Vec<u8>,
    cipher: &XChaCha20Poly1305,
    header: &[u8; HEADER_LEN],
    sequence: u64,
    plaintext: &[u8],
) -> Result<(), PortableArtifactRejected> {
    let (nonce, aad) = nonce_and_aad(header, sequence);
    let mut frame = Zeroizing::new(vec![0; plaintext.len()]);
    frame.copy_from_slice(plaintext);
    let tag = cipher
        .encrypt_inout_detached(&nonce, &aad, frame.as_mut_slice().into())
        .map_err(|_| PortableArtifactRejected)?;
    output.extend_from_slice(&frame);
    output.extend_from_slice(&tag);
    Ok(())
}

fn open_frame(
    output: &mut [u8],
    cipher: &XChaCha20Poly1305,
    header: &[u8; HEADER_LEN],
    sequence: u64,
    encrypted: &[u8],
) -> Result<(), PortableArtifactRejected> {
    let (ciphertext, tag) = encrypted.split_at(output.len());
    let tag: &[u8; TAG_LEN] = tag.try_into().map_err(|_| PortableArtifactRejected)?;
    output.copy_from_slice(ciphertext);
    let (nonce, aad) = nonce_and_aad(header, sequence);
    cipher
        .decrypt_inout_detached(&nonce, &aad, output.into(), tag.into())
        .map_err(|_| PortableArtifactRejected)
}

#[cfg(test)]
mod tests {
    use super::*;

    const MANIFEST: Manifest = Manifest {
        created_at: 1,
        allowlist_version: 1,
        projection_digest: [0x27; 32],
    };

    #[test]
    fn recovers_in_a_fresh_context_with_only_material_and_artifact() {
        let original = RecoveryMaterial::generate().unwrap();
        let secret = original.encode().unwrap();
        let frames = [b"native encrypted business projection".as_slice()];
        let old = seal(&original, MANIFEST, &frames).unwrap();
        let repeat = seal(&original, MANIFEST, &frames).unwrap();
        assert_ne!(old, repeat);
        drop(original);
        let restored = RecoveryMaterial::parse(&secret[..]).unwrap();
        let opened = open(&restored, &old).unwrap();
        assert_eq!(opened.manifest, MANIFEST);
        assert!(opened.frames().eq(frames));
        assert!(open(&RecoveryMaterial::generate().unwrap(), &old).is_err());
        assert!(
            !old.windows(frames[0].len())
                .any(|window| window == frames[0])
        );
    }

    #[test]
    fn rejects_header_changes_truncation_trailing_data_and_frame_swaps() {
        let material = RecoveryMaterial::generate().unwrap();
        let first = vec![1; FRAME_LEN];
        let second = vec![2; FRAME_LEN];
        let mut artifact = seal(&material, MANIFEST, &[&first, &second]).unwrap();
        for index in [0, 8, 10, 18, 50, HEADER_LEN, artifact.len() - 1] {
            artifact[index] ^= 1;
            assert!(open(&material, &artifact).is_err());
            artifact[index] ^= 1;
        }
        assert!(open(&material, &artifact[..artifact.len() - 1]).is_err());
        artifact.push(0);
        assert!(open(&material, &artifact).is_err());
        artifact.pop();
        artifact[HEADER_LEN + MANIFEST_LEN + TAG_LEN..].rotate_left(FRAME_LEN + TAG_LEN);
        assert!(open(&material, &artifact).is_err());
        assert!(seal(&material, MANIFEST, &[b"short", b"extra"]).is_err());
    }
}
