use std::fmt;

use zeroize::{Zeroize, Zeroizing};

use crate::sealed_host_state::{BackupAuthorityFence, SealedHostState};
use crate::sealed_initialization::initialize_native_secure_host;
use crate::sealed_key::{CONTENT_KEY_BYTES, NONCE_BYTES};

const MAX_FRAME_BYTES: usize = 1024 * 1024;

/// Coarse, redacted outcomes for the sealed backup operation.
#[derive(PartialEq, Eq)]
pub enum BackupOperationError {
    Denied,
    IdentityMismatch,
    CryptoUnavailable,
    AuthenticationFailed,
}

impl fmt::Debug for BackupOperationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Denied => "BackupOperationError::Denied",
            Self::IdentityMismatch => "BackupOperationError::IdentityMismatch",
            Self::CryptoUnavailable => "BackupOperationError::CryptoUnavailable",
            Self::AuthenticationFailed => "BackupOperationError::AuthenticationFailed",
        })
    }
}

impl fmt::Display for BackupOperationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Denied => "backup operation denied",
            Self::IdentityMismatch => "backup artifact identity rejected",
            Self::CryptoUnavailable => "backup cryptography unavailable",
            Self::AuthenticationFailed => "backup frame rejected",
        })
    }
}

impl std::error::Error for BackupOperationError {}

/// Rust-owned backup authority with intentionally private construction and backing.
///
/// ```compile_fail
/// use gooddealer_secure_host_core::SecureHost;
///
/// let _host = SecureHost {};
/// ```
pub struct SecureHost {
    pub(super) state: SealedHostState,
    pub(super) cloudflare_credential: crate::cloudflare_credential::CloudflareCredentialState,
    pub(super) cloudflare_transport: crate::cloudflare_transport::CloudflareTransport,
    #[cfg(test)]
    pub(super) cloudflare_mutation:
        Option<crate::cloudflare_credential::CloudflareCredentialMutation>,
}

impl fmt::Debug for SecureHost {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("SecureHost([REDACTED])")
    }
}

impl SecureHost {
    /// Runs one Host-minted backup operation while retaining all authority inside this crate.
    ///
    /// The callback can compare the active artifact identity and consume that admission into a
    /// one-shot exporter. It cannot construct, select, persist, or retain Host authority.
    ///
    /// # Errors
    ///
    /// Returns [`BackupOperationError::Denied`] when the concrete denying composition is active
    /// or when any part of the private authority fence is not current before the callback runs.
    pub fn with_active_backup_operation<R>(
        &mut self,
        use_operation: impl for<'host> FnOnce(&'host mut ActiveBackupOperation<'host>) -> R,
    ) -> Result<R, BackupOperationError> {
        let fence = self
            .state
            .current_fence()
            .ok_or(BackupOperationError::Denied)?;
        if !self.state.fence_matches(&fence) {
            return Err(BackupOperationError::Denied);
        }

        let mut operation = ActiveBackupOperation {
            state: &mut self.state,
            fence,
            admission_issued: false,
        };
        if !operation.authority_is_current() {
            return Err(BackupOperationError::Denied);
        }

        Ok(use_operation(&mut operation))
    }

    #[allow(
        dead_code,
        reason = "the sealed production boundary is intentionally inaccessible until native qualification"
    )]
    fn concrete_denying() -> Self {
        Self {
            state: initialize_native_secure_host(),
            cloudflare_credential: crate::cloudflare_credential::CloudflareCredentialState::denying(
            ),
            cloudflare_transport: crate::cloudflare_transport::CloudflareTransport::production(),
            #[cfg(test)]
            cloudflare_mutation: None,
        }
    }
}

/// A borrowed, Host-minted backup operation with an immutable private authority fence.
pub struct ActiveBackupOperation<'host> {
    state: &'host mut SealedHostState,
    fence: BackupAuthorityFence,
    admission_issued: bool,
}

impl fmt::Debug for ActiveBackupOperation<'_> {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("ActiveBackupOperation([REDACTED])")
    }
}

impl ActiveBackupOperation<'_> {
    #[must_use]
    pub fn backup_id(&self) -> &str {
        self.fence.backup_id()
    }

    #[must_use]
    pub fn manifest_digest(&self) -> &str {
        self.fence.manifest_digest()
    }

    /// Admits only an exact comparison against the Host-held artifact identity.
    ///
    /// # Errors
    ///
    /// Returns [`BackupOperationError::Denied`] when the admission was already consumed or the
    /// Host authority changed, and [`BackupOperationError::IdentityMismatch`] for a different
    /// backup ID or manifest digest.
    pub fn assert_artifact_identity(
        &mut self,
        backup_id: &str,
        manifest_digest: &str,
    ) -> Result<BackupArtifactAdmission<'_>, BackupOperationError> {
        if self.admission_issued || !self.authority_is_current() {
            return Err(BackupOperationError::Denied);
        }
        if backup_id != self.backup_id() || manifest_digest != self.manifest_digest() {
            return Err(BackupOperationError::IdentityMismatch);
        }

        self.admission_issued = true;
        Ok(BackupArtifactAdmission {
            state: &mut *self.state,
            fence: self.fence.clone(),
        })
    }

    fn authority_is_current(&self) -> bool {
        self.state.fence_matches(&self.fence)
    }
}

/// A nonconstructible proof that one opaque Host operation matches one artifact.
pub struct BackupArtifactAdmission<'op> {
    state: &'op mut SealedHostState,
    fence: BackupAuthorityFence,
}

impl fmt::Debug for BackupArtifactAdmission<'_> {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("BackupArtifactAdmission([REDACTED])")
    }
}

impl<'op> BackupArtifactAdmission<'op> {
    /// Internally generates and wraps a content key after rechecking the complete Host fence.
    ///
    /// # Errors
    ///
    /// Returns [`BackupOperationError::Denied`] if any fenced authority component changes before
    /// or after key work, [`BackupOperationError::CryptoUnavailable`] if randomness is unavailable,
    /// or [`BackupOperationError::AuthenticationFailed`] if the internal AEAD operation fails.
    pub fn begin_export(self) -> Result<BackupExportOperation<'op>, BackupOperationError> {
        let Self { state, fence } = self;

        #[cfg(test)]
        state.apply_scheduled_mutation_for_test(
            crate::sealed_host_state::TestFenceMoment::Admission,
        );

        if !state.fence_matches(&fence) {
            return Err(BackupOperationError::Denied);
        }
        let content_key = state.generate_content_key(&fence)?;

        #[cfg(test)]
        state.apply_scheduled_mutation_for_test(
            crate::sealed_host_state::TestFenceMoment::ContentKeyGeneration,
        );

        if !state.fence_matches(&fence) {
            return Err(BackupOperationError::Denied);
        }
        let wrapped_content_key = state.wrap_content_key(&fence, &content_key)?;

        #[cfg(test)]
        state.apply_scheduled_mutation_for_test(crate::sealed_host_state::TestFenceMoment::KeyWrap);

        if !state.fence_matches(&fence) {
            return Err(BackupOperationError::Denied);
        }

        Ok(BackupExportOperation {
            state,
            fence,
            content_key,
            wrapped_content_key,
            next_sequence: 0,
            final_frame_seen: false,
        })
    }
}

/// A one-shot exporter that retains its generated and wrapped key material only inside the Host.
pub struct BackupExportOperation<'op> {
    state: &'op mut SealedHostState,
    fence: BackupAuthorityFence,
    content_key: Zeroizing<[u8; CONTENT_KEY_BYTES]>,
    wrapped_content_key: Zeroizing<Vec<u8>>,
    next_sequence: u32,
    final_frame_seen: bool,
}

impl fmt::Debug for BackupExportOperation<'_> {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("BackupExportOperation([REDACTED])")
    }
}

impl BackupExportOperation<'_> {
    /// Returns the Host-produced wrapped content-key record for local container serialization.
    ///
    /// This is an authenticated wrapping output, not raw key material. The Host exposes no
    /// unwrap, key-selection, key-reference, AAD, nonce-selection, import, open, or decrypt API.
    #[must_use]
    pub fn wrapped_content_key_bytes(&self) -> &[u8] {
        &self.wrapped_content_key
    }

    /// Seals exactly the next bounded frame using a Host-generated nonce and Host-derived AAD.
    ///
    /// # Errors
    ///
    /// Returns [`BackupOperationError::AuthenticationFailed`] for invalid sequence/final-frame
    /// use or AEAD failure, [`BackupOperationError::Denied`] when the complete authority fence is
    /// stale before or after frame work, and [`BackupOperationError::CryptoUnavailable`] when
    /// nonce generation fails.
    pub fn seal_frame(
        &mut self,
        sequence: u32,
        final_frame: bool,
        plaintext: &[u8],
    ) -> Result<SealedBackupFrame, BackupOperationError> {
        if self.final_frame_seen
            || sequence != self.next_sequence
            || plaintext.len() > MAX_FRAME_BYTES
            || (sequence == u32::MAX && !final_frame)
        {
            return Err(BackupOperationError::AuthenticationFailed);
        }
        if !self.authority_is_current() {
            return Err(BackupOperationError::Denied);
        }

        let mut nonce = Zeroizing::new([0_u8; NONCE_BYTES]);
        getrandom::fill(&mut *nonce).map_err(|_| BackupOperationError::CryptoUnavailable)?;
        #[cfg(test)]
        self.state.apply_scheduled_mutation_for_test(
            crate::sealed_host_state::TestFenceMoment::NonceGeneration,
        );
        if !self.authority_is_current() {
            return Err(BackupOperationError::Denied);
        }
        let ciphertext = self.state.seal_frame(
            &self.fence,
            &self.content_key,
            &nonce,
            sequence,
            final_frame,
            plaintext,
        )?;

        #[cfg(test)]
        self.state.apply_scheduled_mutation_for_test(
            crate::sealed_host_state::TestFenceMoment::FrameEncryption,
        );

        if !self.authority_is_current() {
            return Err(BackupOperationError::Denied);
        }
        if final_frame {
            self.final_frame_seen = true;
        } else {
            self.next_sequence = self
                .next_sequence
                .checked_add(1)
                .ok_or(BackupOperationError::AuthenticationFailed)?;
        }
        #[cfg(test)]
        self.state.note_frame_publication();

        Ok(SealedBackupFrame { nonce, ciphertext })
    }

    fn authority_is_current(&self) -> bool {
        self.state.fence_matches(&self.fence)
    }
}

impl Drop for BackupExportOperation<'_> {
    fn drop(&mut self) {
        self.content_key.zeroize();
        self.wrapped_content_key.zeroize();
    }
}

/// An opaque sealed backup frame.
///
/// It has no public fields, construction path, parser, decoder, key output, AAD output, decrypt,
/// import, open, or recovery operation. Local container writers may read only its nonce and
/// ciphertext bytes.
///
/// ```compile_fail
/// use gooddealer_secure_host_core::SealedBackupFrame;
///
/// let _frame = SealedBackupFrame {
///     nonce: [0; 24],
///     ciphertext: Vec::new(),
/// };
/// ```
///
/// ```compile_fail
/// use gooddealer_secure_host_core::SealedBackupFrame;
///
/// fn forbidden(frame: &SealedBackupFrame) {
///     frame.open();
/// }
/// ```
pub struct SealedBackupFrame {
    nonce: Zeroizing<[u8; NONCE_BYTES]>,
    ciphertext: Vec<u8>,
}

impl SealedBackupFrame {
    /// Returns the Host-generated frame nonce for local container serialization.
    #[must_use]
    pub fn nonce(&self) -> &[u8] {
        &self.nonce[..]
    }

    /// Returns the authenticated ciphertext for local container serialization.
    #[must_use]
    pub fn ciphertext(&self) -> &[u8] {
        &self.ciphertext
    }
}

impl fmt::Debug for SealedBackupFrame {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("SealedBackupFrame([REDACTED])")
    }
}

impl Drop for SealedBackupFrame {
    fn drop(&mut self) {
        self.nonce.zeroize();
        self.ciphertext.zeroize();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sealed_host_state::{
        AuthorityMutation, SealedHostState, TestEffects, TestFenceMoment,
    };

    const BACKUP_ID: &str = "backup-opaque-42";
    const MANIFEST_DIGEST: &str = "digest-opaque-42";

    fn active_host() -> SecureHost {
        SecureHost {
            state: SealedHostState::active_for_test(BACKUP_ID, MANIFEST_DIGEST),
            cloudflare_credential: crate::cloudflare_credential::CloudflareCredentialState::denying(
            ),
            cloudflare_transport: crate::cloudflare_transport::CloudflareTransport::production(),
            cloudflare_mutation: None,
        }
    }

    fn assert_no_sensitive_effects(effects: TestEffects) {
        assert_eq!(
            effects,
            TestEffects {
                content_key_generations: 0,
                key_wraps: 0,
                frame_encryptions: 0,
                frame_publications: 0,
                session_accesses: 0,
                credential_accesses: 0,
                secure_http_attempts: 0,
                durable_writes: 0,
            }
        );
    }

    #[test]
    fn concrete_denying_host_rejects_before_the_callback_or_sensitive_action() {
        let mut host = SecureHost::concrete_denying();
        let mut callback_called = false;

        let outcome = host.with_active_backup_operation(|_| {
            callback_called = true;
        });

        assert_eq!(outcome, Err(BackupOperationError::Denied));
        assert!(!callback_called);
        assert_no_sensitive_effects(host.state.effects_for_test());
    }

    #[test]
    fn identity_substitution_is_rejected_before_any_key_or_frame_action() {
        let mut host = active_host();

        let result = host.with_active_backup_operation(|operation| {
            let admission = operation.assert_artifact_identity("other-backup", MANIFEST_DIGEST);
            assert_eq!(
                admission.err(),
                Some(BackupOperationError::IdentityMismatch)
            );
        });

        assert!(result.is_ok());
        assert_no_sensitive_effects(host.state.effects_for_test());
    }

    #[test]
    fn every_fenced_component_change_after_admission_denies_before_key_work() {
        for mutation in AuthorityMutation::ALL {
            let mut host = active_host();
            host.state
                .schedule_mutation_for_test(TestFenceMoment::Admission, mutation);

            let result = host.with_active_backup_operation(|operation| {
                let admission = operation
                    .assert_artifact_identity(BACKUP_ID, MANIFEST_DIGEST)
                    .expect("Host-minted identity must admit");
                assert!(matches!(
                    admission.begin_export(),
                    Err(BackupOperationError::Denied)
                ));
            });

            assert!(result.is_ok());
            assert_no_sensitive_effects(host.state.effects_for_test());
        }
    }

    #[test]
    fn stale_authority_is_rejected_before_the_callback_or_sensitive_action() {
        let mut host = active_host();
        host.state.mutate_for_test(AuthorityMutation::TrustedTime);
        let mut callback_called = false;

        let result = host.with_active_backup_operation(|_| {
            callback_called = true;
        });

        assert_eq!(result, Err(BackupOperationError::Denied));
        assert!(!callback_called);
        assert_no_sensitive_effects(host.state.effects_for_test());
    }

    #[test]
    fn account_web_audience_cannot_become_desktop_backup_authority() {
        let mut host = active_host();
        host.state.mutate_for_test(AuthorityMutation::Audience);

        assert_eq!(
            host.with_active_backup_operation(|_| ()),
            Err(BackupOperationError::Denied)
        );
        assert_no_sensitive_effects(host.state.effects_for_test());
    }

    #[test]
    fn post_key_generation_change_returns_no_wrapped_key_export_or_frame() {
        let mut host = active_host();
        host.state.schedule_mutation_for_test(
            TestFenceMoment::ContentKeyGeneration,
            AuthorityMutation::CredentialBindingGeneration,
        );

        let result = host.with_active_backup_operation(|operation| {
            let admission = operation
                .assert_artifact_identity(BACKUP_ID, MANIFEST_DIGEST)
                .expect("Host-minted identity must admit");
            assert!(matches!(
                admission.begin_export(),
                Err(BackupOperationError::Denied)
            ));
        });

        assert!(result.is_ok());
        let effects = host.state.effects_for_test();
        assert_eq!(effects.content_key_generations, 1);
        assert_eq!(effects.key_wraps, 0);
        assert_eq!(effects.frame_encryptions, 0);
        assert_eq!(effects.frame_publications, 0);
    }

    #[test]
    fn post_key_wrap_change_returns_no_export_or_frame_publication() {
        let mut host = active_host();
        host.state.schedule_mutation_for_test(
            TestFenceMoment::KeyWrap,
            AuthorityMutation::WrappingKeyGeneration,
        );

        let result = host.with_active_backup_operation(|operation| {
            let admission = operation
                .assert_artifact_identity(BACKUP_ID, MANIFEST_DIGEST)
                .expect("Host-minted identity must admit");
            assert!(matches!(
                admission.begin_export(),
                Err(BackupOperationError::Denied)
            ));
        });

        assert!(result.is_ok());
        let effects = host.state.effects_for_test();
        assert_eq!(effects.content_key_generations, 1);
        assert_eq!(effects.key_wraps, 1);
        assert_eq!(effects.frame_encryptions, 0);
        assert_eq!(effects.frame_publications, 0);
    }

    #[test]
    fn post_frame_fence_change_never_publishes_a_frame() {
        let mut host = active_host();

        let result = host.with_active_backup_operation(|operation| {
            let admission = operation
                .assert_artifact_identity(BACKUP_ID, MANIFEST_DIGEST)
                .expect("Host-minted identity must admit");
            let mut export = admission
                .begin_export()
                .expect("internal test authority is active");
            export.state.schedule_mutation_for_test(
                TestFenceMoment::FrameEncryption,
                AuthorityMutation::TrustedTimeGeneration,
            );
            assert!(matches!(
                export.seal_frame(0, false, b"frame"),
                Err(BackupOperationError::Denied)
            ));
        });

        assert!(result.is_ok());
        let effects = host.state.effects_for_test();
        assert_eq!(effects.content_key_generations, 1);
        assert_eq!(effects.key_wraps, 1);
        assert_eq!(effects.frame_encryptions, 1);
        assert_eq!(effects.frame_publications, 0);
    }

    #[test]
    fn post_nonce_fence_change_never_encrypts_or_publishes_a_frame() {
        let mut host = active_host();

        let result = host.with_active_backup_operation(|operation| {
            let admission = operation
                .assert_artifact_identity(BACKUP_ID, MANIFEST_DIGEST)
                .expect("Host-minted identity must admit");
            let mut export = admission
                .begin_export()
                .expect("internal test authority is active");
            export.state.schedule_mutation_for_test(
                TestFenceMoment::NonceGeneration,
                AuthorityMutation::LeaseGeneration,
            );
            assert!(matches!(
                export.seal_frame(0, false, b"frame"),
                Err(BackupOperationError::Denied)
            ));
        });

        assert!(result.is_ok());
        let effects = host.state.effects_for_test();
        assert_eq!(effects.content_key_generations, 1);
        assert_eq!(effects.key_wraps, 1);
        assert_eq!(effects.frame_encryptions, 0);
        assert_eq!(effects.frame_publications, 0);
    }

    #[test]
    fn artifact_admission_cannot_be_reused_after_it_is_dropped() {
        let mut host = active_host();

        let result = host.with_active_backup_operation(|operation| {
            let admission = operation
                .assert_artifact_identity(BACKUP_ID, MANIFEST_DIGEST)
                .expect("Host-minted identity must admit");
            drop(admission);
            assert!(matches!(
                operation.assert_artifact_identity(BACKUP_ID, MANIFEST_DIGEST),
                Err(BackupOperationError::Denied)
            ));
        });

        assert!(result.is_ok());
        assert_no_sensitive_effects(host.state.effects_for_test());
    }

    #[test]
    fn export_is_strictly_ordered_final_and_serializable_only_as_sealed_bytes() {
        let mut host = active_host();

        let result = host.with_active_backup_operation(|operation| {
            let admission = operation
                .assert_artifact_identity(BACKUP_ID, MANIFEST_DIGEST)
                .expect("Host-minted identity must admit");
            let mut export = admission
                .begin_export()
                .expect("internal test authority is active");
            assert!(!export.wrapped_content_key_bytes().is_empty());
            assert!(matches!(
                export.seal_frame(1, false, b"skipped"),
                Err(BackupOperationError::AuthenticationFailed)
            ));
            let first = export
                .seal_frame(0, false, b"first")
                .expect("first frame must be accepted");
            assert_eq!(first.nonce().len(), NONCE_BYTES);
            assert_ne!(first.ciphertext(), b"first");
            assert_eq!(format!("{first:?}"), "SealedBackupFrame([REDACTED])");
            assert!(matches!(
                export.seal_frame(0, false, b"duplicate"),
                Err(BackupOperationError::AuthenticationFailed)
            ));
            let final_frame = export
                .seal_frame(1, true, b"final")
                .expect("next final frame must be accepted");
            assert!(!final_frame.ciphertext().is_empty());
            assert!(matches!(
                export.seal_frame(2, false, b"after-final"),
                Err(BackupOperationError::AuthenticationFailed)
            ));
        });

        assert!(result.is_ok());
        let effects = host.state.effects_for_test();
        assert_eq!(effects.content_key_generations, 1);
        assert_eq!(effects.key_wraps, 1);
        assert_eq!(effects.frame_encryptions, 2);
        assert_eq!(effects.frame_publications, 2);
    }

    #[test]
    fn legal_debug_and_error_output_are_redacted() {
        let mut host = active_host();
        let host_debug = format!("{host:?}");
        assert!(!host_debug.contains(BACKUP_ID));
        assert!(!host_debug.contains(MANIFEST_DIGEST));
        assert_eq!(
            BackupOperationError::IdentityMismatch.to_string(),
            "backup artifact identity rejected"
        );

        let result = host.with_active_backup_operation(|operation| {
            assert!(!format!("{operation:?}").contains(BACKUP_ID));
            let admission = operation
                .assert_artifact_identity(BACKUP_ID, MANIFEST_DIGEST)
                .expect("Host-minted identity must admit");
            assert!(!format!("{admission:?}").contains(MANIFEST_DIGEST));
            let export = admission
                .begin_export()
                .expect("internal test authority is active");
            assert!(!format!("{export:?}").contains(BACKUP_ID));
            assert!(
                !export
                    .wrapped_content_key_bytes()
                    .windows(CONTENT_KEY_BYTES)
                    .any(|window| window == [0xA5; CONTENT_KEY_BYTES])
            );
        });

        assert!(result.is_ok());
    }
}
