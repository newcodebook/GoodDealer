//! Purpose-specific private backup wrapping-key lifecycle.

use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{Key, XChaCha20Poly1305, XNonce};
use zeroize::{Zeroize, Zeroizing};

use crate::backup_operation::BackupOperationError;
use crate::sealed_session::SealedSessionFence;

pub(super) const CONTENT_KEY_BYTES: usize = 32;
pub(super) const NONCE_BYTES: usize = 24;

pub(super) struct SealedBackupKeyState {
    active: bool,
    account_id: String,
    device_installation_id: String,
    workspace_id: String,
    wrapping_key_generation: u64,
    wrapping_key: Zeroizing<[u8; CONTENT_KEY_BYTES]>,
}

impl SealedBackupKeyState {
    pub(super) fn denying() -> Self {
        Self {
            active: false,
            account_id: String::new(),
            device_installation_id: String::new(),
            workspace_id: String::new(),
            wrapping_key_generation: 0,
            wrapping_key: Zeroizing::new([0_u8; CONTENT_KEY_BYTES]),
        }
    }

    pub(super) fn current_generation(&self, session: &SealedSessionFence) -> Option<u64> {
        (self.active
            && self.wrapping_key_generation != 0
            && self.account_id == session.account_id
            && self.device_installation_id == session.device_installation_id
            && self.workspace_id == session.workspace_id)
            .then_some(self.wrapping_key_generation)
    }

    pub(super) fn generate_content_key(
        &self,
        session: &SealedSessionFence,
    ) -> Result<Zeroizing<[u8; CONTENT_KEY_BYTES]>, BackupOperationError> {
        self.current_generation(session)
            .ok_or(BackupOperationError::Denied)?;
        let mut content_key = Zeroizing::new([0_u8; CONTENT_KEY_BYTES]);
        getrandom::fill(&mut *content_key).map_err(|_| BackupOperationError::CryptoUnavailable)?;
        Ok(content_key)
    }

    pub(super) fn wrap_content_key(
        &self,
        session: &SealedSessionFence,
        content_key: &[u8; CONTENT_KEY_BYTES],
        aad: &[u8],
    ) -> Result<Zeroizing<Vec<u8>>, BackupOperationError> {
        self.current_generation(session)
            .ok_or(BackupOperationError::Denied)?;
        let mut nonce = Zeroizing::new([0_u8; NONCE_BYTES]);
        getrandom::fill(&mut *nonce).map_err(|_| BackupOperationError::CryptoUnavailable)?;
        let sealed = cipher(&self.wrapping_key)
            .encrypt(
                &XNonce::from(*nonce),
                Payload {
                    msg: content_key,
                    aad,
                },
            )
            .map_err(|_| BackupOperationError::AuthenticationFailed)?;
        let mut wrapped = Zeroizing::new(Vec::with_capacity(NONCE_BYTES + sealed.len()));
        wrapped.extend_from_slice(&nonce[..]);
        wrapped.extend_from_slice(&sealed);
        Ok(wrapped)
    }

    pub(super) fn seal_frame(
        &self,
        session: &SealedSessionFence,
        content_key: &[u8; CONTENT_KEY_BYTES],
        nonce: &[u8; NONCE_BYTES],
        aad: &[u8],
        plaintext: &[u8],
    ) -> Result<Vec<u8>, BackupOperationError> {
        self.current_generation(session)
            .ok_or(BackupOperationError::Denied)?;
        cipher(content_key)
            .encrypt(
                &XNonce::from(*nonce),
                Payload {
                    msg: plaintext,
                    aad,
                },
            )
            .map_err(|_| BackupOperationError::AuthenticationFailed)
    }

    #[cfg(test)]
    pub(super) fn active_for_test(session: &SealedSessionFence) -> Self {
        Self {
            active: true,
            account_id: session.account_id.clone(),
            device_installation_id: session.device_installation_id.clone(),
            workspace_id: session.workspace_id.clone(),
            wrapping_key_generation: 1,
            wrapping_key: Zeroizing::new([0xA5; CONTENT_KEY_BYTES]),
        }
    }

    #[cfg(test)]
    pub(super) fn mutate_for_test(&mut self, mutation: BackupKeyMutation) {
        match mutation {
            BackupKeyMutation::Generation => {
                self.wrapping_key_generation = self.wrapping_key_generation.saturating_add(1);
            }
            BackupKeyMutation::Account => self.account_id.push_str("-changed"),
            BackupKeyMutation::DeviceInstallation => {
                self.device_installation_id.push_str("-changed");
            }
            BackupKeyMutation::Workspace => self.workspace_id.push_str("-changed"),
        }
    }
}

#[cfg(test)]
#[derive(Clone, Copy)]
pub(super) enum BackupKeyMutation {
    Generation,
    Account,
    DeviceInstallation,
    Workspace,
}

impl Drop for SealedBackupKeyState {
    fn drop(&mut self) {
        self.wrapping_key.zeroize();
    }
}

fn cipher(key: &[u8; CONTENT_KEY_BYTES]) -> XChaCha20Poly1305 {
    XChaCha20Poly1305::new(&Key::from(*key))
}
