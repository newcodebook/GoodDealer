//! Private composition and complete authority fence for one backup operation.

use zeroize::Zeroizing;

use crate::backup_operation::BackupOperationError;
#[cfg(test)]
use crate::sealed_credential::CredentialMutation;
use crate::sealed_credential::{SealedCredentialFence, SealedCredentialState};
#[cfg(test)]
use crate::sealed_key::BackupKeyMutation;
use crate::sealed_key::{CONTENT_KEY_BYTES, SealedBackupKeyState};
#[cfg(test)]
use crate::sealed_runtime::RuntimeMutation;
use crate::sealed_runtime::{SealedRuntimeFence, SealedRuntimeState};
#[cfg(test)]
use crate::sealed_secure_http::SecureHttpMutation;
use crate::sealed_secure_http::{SealedSecureHttpFence, SealedSecureHttpState};
#[cfg(test)]
use crate::sealed_session::SessionMutation;
use crate::sealed_session::{SealedSessionFence, SealedSessionState};

const KEY_WRAP_DOMAIN: &[u8] = b"GOODDEALER-SEALED-BACKUP-WRAP-V1";
const FRAME_DOMAIN: &[u8] = b"GOODDEALER-SEALED-BACKUP-FRAME-V1";

pub(super) struct SealedHostState {
    session: SealedSessionState,
    runtime: SealedRuntimeState,
    credential: SealedCredentialState,
    secure_http: SealedSecureHttpState,
    backup_key: SealedBackupKeyState,
    artifact: SealedBackupArtifact,
    #[cfg(test)]
    test_hooks: TestHooks,
}

#[derive(Clone, PartialEq, Eq)]
pub(super) struct BackupAuthorityFence {
    session: SealedSessionFence,
    runtime: SealedRuntimeFence,
    credential: SealedCredentialFence,
    secure_http: SealedSecureHttpFence,
    backup_id: String,
    manifest_digest: String,
    backup_generation: u64,
    manifest_generation: u64,
    wrapping_key_generation: u64,
}

struct SealedBackupArtifact {
    active: bool,
    account_id: String,
    device_installation_id: String,
    workspace_id: String,
    backup_id: String,
    manifest_digest: String,
    backup_generation: u64,
    manifest_generation: u64,
}

impl SealedBackupArtifact {
    fn denying() -> Self {
        Self {
            active: false,
            account_id: String::new(),
            device_installation_id: String::new(),
            workspace_id: String::new(),
            backup_id: String::new(),
            manifest_digest: String::new(),
            backup_generation: 0,
            manifest_generation: 0,
        }
    }

    fn current_fence(&self, session: &SealedSessionFence) -> Option<(String, String, u64, u64)> {
        (self.active
            && self.backup_generation != 0
            && self.manifest_generation != 0
            && !self.backup_id.is_empty()
            && !self.manifest_digest.is_empty()
            && self.account_id == session.account_id
            && self.device_installation_id == session.device_installation_id
            && self.workspace_id == session.workspace_id)
            .then(|| {
                (
                    self.backup_id.clone(),
                    self.manifest_digest.clone(),
                    self.backup_generation,
                    self.manifest_generation,
                )
            })
    }

    #[cfg(test)]
    fn active_for_test(
        session: &SealedSessionFence,
        backup_id: &str,
        manifest_digest: &str,
    ) -> Self {
        Self {
            active: true,
            account_id: session.account_id.clone(),
            device_installation_id: session.device_installation_id.clone(),
            workspace_id: session.workspace_id.clone(),
            backup_id: backup_id.to_owned(),
            manifest_digest: manifest_digest.to_owned(),
            backup_generation: 1,
            manifest_generation: 1,
        }
    }
}

impl SealedHostState {
    pub(super) fn concrete_denying() -> Self {
        Self {
            session: SealedSessionState::denying(),
            runtime: SealedRuntimeState::denying(),
            credential: SealedCredentialState::denying(),
            secure_http: SealedSecureHttpState::denying(),
            backup_key: SealedBackupKeyState::denying(),
            artifact: SealedBackupArtifact::denying(),
            #[cfg(test)]
            test_hooks: TestHooks::default(),
        }
    }

    pub(super) fn current_fence(&self) -> Option<BackupAuthorityFence> {
        let session = self.session.current_fence()?;
        let runtime = self.runtime.current_fence(&session)?;
        let credential = self.credential.current_fence(&session)?;
        let secure_http = self
            .secure_http
            .current_fence(&session, &runtime, &credential)?;
        let wrapping_key_generation = self.backup_key.current_generation(&session)?;
        let (backup_id, manifest_digest, backup_generation, manifest_generation) =
            self.artifact.current_fence(&session)?;

        Some(BackupAuthorityFence {
            session,
            runtime,
            credential,
            secure_http,
            backup_id,
            manifest_digest,
            backup_generation,
            manifest_generation,
            wrapping_key_generation,
        })
    }

    pub(super) fn fence_matches(&self, fence: &BackupAuthorityFence) -> bool {
        self.current_fence().as_ref() == Some(fence)
    }

    pub(super) fn generate_content_key(
        &mut self,
        fence: &BackupAuthorityFence,
    ) -> Result<Zeroizing<[u8; CONTENT_KEY_BYTES]>, BackupOperationError> {
        let content_key = self.backup_key.generate_content_key(&fence.session)?;
        #[cfg(test)]
        {
            self.test_hooks.effects.content_key_generations += 1;
        }
        Ok(content_key)
    }

    pub(super) fn wrap_content_key(
        &mut self,
        fence: &BackupAuthorityFence,
        content_key: &[u8; CONTENT_KEY_BYTES],
    ) -> Result<Zeroizing<Vec<u8>>, BackupOperationError> {
        if !self.fence_matches(fence) {
            return Err(BackupOperationError::Denied);
        }
        let aad = fence.key_wrap_aad()?;
        let wrapped = self
            .backup_key
            .wrap_content_key(&fence.session, content_key, &aad)?;
        #[cfg(test)]
        {
            self.test_hooks.effects.key_wraps += 1;
        }
        Ok(wrapped)
    }

    pub(super) fn seal_frame(
        &mut self,
        fence: &BackupAuthorityFence,
        content_key: &[u8; CONTENT_KEY_BYTES],
        nonce: &[u8; crate::sealed_key::NONCE_BYTES],
        sequence: u32,
        final_frame: bool,
        plaintext: &[u8],
    ) -> Result<Vec<u8>, BackupOperationError> {
        if !self.fence_matches(fence) {
            return Err(BackupOperationError::Denied);
        }
        let aad = fence.frame_aad(sequence, final_frame)?;
        let ciphertext =
            self.backup_key
                .seal_frame(&fence.session, content_key, nonce, &aad, plaintext)?;
        #[cfg(test)]
        {
            self.test_hooks.effects.frame_encryptions += 1;
        }
        Ok(ciphertext)
    }

    #[cfg(test)]
    pub(super) fn note_frame_publication(&mut self) {
        self.test_hooks.effects.frame_publications += 1;
    }

    #[cfg(test)]
    pub(super) fn active_for_test(backup_id: &str, manifest_digest: &str) -> Self {
        let session = SealedSessionState::active_for_test();
        let session_fence = session
            .current_fence()
            .expect("test session state must be internally active");
        Self {
            credential: SealedCredentialState::active_for_test(&session_fence),
            session,
            runtime: SealedRuntimeState::active_for_test(&session_fence),
            secure_http: SealedSecureHttpState::active_for_test(),
            backup_key: SealedBackupKeyState::active_for_test(&session_fence),
            artifact: SealedBackupArtifact::active_for_test(
                &session_fence,
                backup_id,
                manifest_digest,
            ),
            test_hooks: TestHooks::default(),
        }
    }

    #[cfg(test)]
    pub(super) fn schedule_mutation_for_test(
        &mut self,
        moment: TestFenceMoment,
        mutation: AuthorityMutation,
    ) {
        match moment {
            TestFenceMoment::Admission => {
                self.test_hooks.after_admission = Some(mutation);
            }
            TestFenceMoment::ContentKeyGeneration => {
                self.test_hooks.after_content_key_generation = Some(mutation);
            }
            TestFenceMoment::KeyWrap => self.test_hooks.after_key_wrap = Some(mutation),
            TestFenceMoment::NonceGeneration => {
                self.test_hooks.after_nonce_generation = Some(mutation);
            }
            TestFenceMoment::FrameEncryption => {
                self.test_hooks.after_frame_encryption = Some(mutation);
            }
        }
    }

    #[cfg(test)]
    pub(super) fn apply_scheduled_mutation_for_test(&mut self, moment: TestFenceMoment) {
        let mutation = match moment {
            TestFenceMoment::Admission => self.test_hooks.after_admission.take(),
            TestFenceMoment::ContentKeyGeneration => {
                self.test_hooks.after_content_key_generation.take()
            }
            TestFenceMoment::KeyWrap => self.test_hooks.after_key_wrap.take(),
            TestFenceMoment::NonceGeneration => self.test_hooks.after_nonce_generation.take(),
            TestFenceMoment::FrameEncryption => self.test_hooks.after_frame_encryption.take(),
        };
        if let Some(mutation) = mutation {
            self.mutate_for_test(mutation);
        }
    }

    #[cfg(test)]
    pub(super) fn mutate_for_test(&mut self, mutation: AuthorityMutation) {
        if let Some(session_mutation) = mutation.session_mutation() {
            self.session.mutate_for_test(session_mutation);
        } else if let Some(runtime_mutation) = mutation.runtime_mutation() {
            self.runtime.mutate_for_test(runtime_mutation);
        } else if let Some(credential_mutation) = mutation.credential_mutation() {
            self.credential.mutate_for_test(credential_mutation);
        } else if let Some(secure_http_mutation) = mutation.secure_http_mutation() {
            self.secure_http.mutate_for_test(secure_http_mutation);
        } else if let Some(backup_key_mutation) = mutation.backup_key_mutation() {
            self.backup_key.mutate_for_test(backup_key_mutation);
        } else {
            self.mutate_backup_artifact_for_test(mutation);
        }
    }

    #[cfg(test)]
    fn mutate_backup_artifact_for_test(&mut self, mutation: AuthorityMutation) {
        match mutation {
            AuthorityMutation::ArtifactAccount => self.artifact.account_id.push_str("-changed"),
            AuthorityMutation::ArtifactDeviceInstallation => {
                self.artifact.device_installation_id.push_str("-changed");
            }
            AuthorityMutation::ArtifactWorkspace => {
                self.artifact.workspace_id.push_str("-changed");
            }
            AuthorityMutation::BackupId => self.artifact.backup_id.push_str("-changed"),
            AuthorityMutation::ManifestDigest => self.artifact.manifest_digest.push_str("-changed"),
            AuthorityMutation::BackupGeneration => {
                self.artifact.backup_generation = self.artifact.backup_generation.saturating_add(1);
            }
            AuthorityMutation::ManifestGeneration => {
                self.artifact.manifest_generation =
                    self.artifact.manifest_generation.saturating_add(1);
            }
            _ => unreachable!("authority mutation must belong to one private fence component"),
        }
    }

    #[cfg(test)]
    pub(super) const fn effects_for_test(&self) -> TestEffects {
        self.test_hooks.effects
    }
}

impl BackupAuthorityFence {
    pub(super) fn backup_id(&self) -> &str {
        &self.backup_id
    }

    pub(super) fn manifest_digest(&self) -> &str {
        &self.manifest_digest
    }

    fn key_wrap_aad(&self) -> Result<Zeroizing<Vec<u8>>, BackupOperationError> {
        let mut aad = Zeroizing::new(Vec::new());
        append_framed(&mut aad, KEY_WRAP_DOMAIN)?;
        self.append_context(&mut aad)?;
        Ok(aad)
    }

    fn frame_aad(
        &self,
        sequence: u32,
        final_frame: bool,
    ) -> Result<Zeroizing<Vec<u8>>, BackupOperationError> {
        let mut aad = Zeroizing::new(Vec::new());
        append_framed(&mut aad, FRAME_DOMAIN)?;
        self.append_context(&mut aad)?;
        append_framed(&mut aad, &sequence.to_be_bytes())?;
        append_framed(&mut aad, &[u8::from(final_frame)])?;
        Ok(aad)
    }

    fn append_context(&self, aad: &mut Vec<u8>) -> Result<(), BackupOperationError> {
        append_framed(aad, self.session.account_id.as_bytes())?;
        append_framed(aad, self.session.device_installation_id.as_bytes())?;
        append_framed(aad, self.session.workspace_id.as_bytes())?;
        append_framed(aad, self.session.session_family_id.as_bytes())?;
        append_framed(aad, self.session.audience.domain_tag())?;
        append_framed(aad, self.session.key_purpose.domain_tag())?;
        append_framed(aad, self.runtime.account_id.as_bytes())?;
        append_framed(aad, self.runtime.device_installation_id.as_bytes())?;
        append_framed(aad, self.runtime.workspace_id.as_bytes())?;
        append_framed(aad, self.runtime.lease_id.as_bytes())?;
        append_framed(aad, self.credential.binding_id.as_bytes())?;
        append_framed(aad, self.secure_http.channel.domain_tag())?;
        append_framed(aad, self.backup_id.as_bytes())?;
        append_framed(aad, self.manifest_digest.as_bytes())?;
        for generation in [
            self.session.account_generation,
            self.session.device_installation_generation,
            self.session.workspace_generation,
            self.session.session_generation,
            self.runtime.runtime_generation,
            self.runtime.lease_generation,
            self.runtime.trusted_time_epoch,
            self.runtime.trusted_time_valid_until,
            self.runtime.trusted_time_generation,
            self.credential.binding_generation,
            self.secure_http.generation,
            self.backup_generation,
            self.manifest_generation,
            self.wrapping_key_generation,
        ] {
            append_framed(aad, &generation.to_be_bytes())?;
        }
        Ok(())
    }
}

fn append_framed(target: &mut Vec<u8>, value: &[u8]) -> Result<(), BackupOperationError> {
    let length = u64::try_from(value.len()).map_err(|_| BackupOperationError::CryptoUnavailable)?;
    target.extend_from_slice(&length.to_be_bytes());
    target.extend_from_slice(value);
    Ok(())
}

#[cfg(test)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(super) struct TestEffects {
    pub(super) content_key_generations: u64,
    pub(super) key_wraps: u64,
    pub(super) frame_encryptions: u64,
    pub(super) frame_publications: u64,
    pub(super) session_accesses: u64,
    pub(super) credential_accesses: u64,
    pub(super) secure_http_attempts: u64,
    pub(super) durable_writes: u64,
}

#[cfg(test)]
#[derive(Default)]
struct TestHooks {
    effects: TestEffects,
    after_admission: Option<AuthorityMutation>,
    after_content_key_generation: Option<AuthorityMutation>,
    after_key_wrap: Option<AuthorityMutation>,
    after_nonce_generation: Option<AuthorityMutation>,
    after_frame_encryption: Option<AuthorityMutation>,
}

#[cfg(test)]
#[derive(Clone, Copy)]
pub(super) enum TestFenceMoment {
    Admission,
    ContentKeyGeneration,
    KeyWrap,
    NonceGeneration,
    FrameEncryption,
}

#[cfg(test)]
#[derive(Clone, Copy)]
pub(super) enum AuthorityMutation {
    Account,
    DeviceInstallation,
    Workspace,
    SessionFamily,
    Audience,
    KeyPurpose,
    Runtime,
    Lease,
    RuntimeLeaseAccount,
    RuntimeLeaseDeviceInstallation,
    RuntimeLeaseWorkspace,
    TrustedTime,
    CredentialBinding,
    CredentialBindingAccount,
    CredentialBindingDeviceInstallation,
    CredentialBindingWorkspace,
    SecureHttp,
    SecureHttpChannel,
    SecureHttpEndpoint,
    SecureHttpOrigin,
    SecureHttpAdapter,
    SecureHttpResolver,
    SecureHttpTls,
    SecureHttpProxy,
    SecureHttpRedirect,
    SecureHttpCredentialInjection,
    ArtifactAccount,
    ArtifactDeviceInstallation,
    ArtifactWorkspace,
    BackupId,
    ManifestDigest,
    AccountGeneration,
    DeviceInstallationGeneration,
    WorkspaceGeneration,
    SessionGeneration,
    RuntimeGeneration,
    LeaseGeneration,
    TrustedTimeGeneration,
    CredentialBindingGeneration,
    SecureHttpGeneration,
    BackupGeneration,
    ManifestGeneration,
    WrappingKeyAccount,
    WrappingKeyDeviceInstallation,
    WrappingKeyWorkspace,
    WrappingKeyGeneration,
}

#[cfg(test)]
impl AuthorityMutation {
    pub(super) const ALL: [Self; 46] = [
        Self::Account,
        Self::DeviceInstallation,
        Self::Workspace,
        Self::SessionFamily,
        Self::Audience,
        Self::KeyPurpose,
        Self::Runtime,
        Self::Lease,
        Self::RuntimeLeaseAccount,
        Self::RuntimeLeaseDeviceInstallation,
        Self::RuntimeLeaseWorkspace,
        Self::TrustedTime,
        Self::CredentialBinding,
        Self::CredentialBindingAccount,
        Self::CredentialBindingDeviceInstallation,
        Self::CredentialBindingWorkspace,
        Self::SecureHttp,
        Self::SecureHttpChannel,
        Self::SecureHttpEndpoint,
        Self::SecureHttpOrigin,
        Self::SecureHttpAdapter,
        Self::SecureHttpResolver,
        Self::SecureHttpTls,
        Self::SecureHttpProxy,
        Self::SecureHttpRedirect,
        Self::SecureHttpCredentialInjection,
        Self::ArtifactAccount,
        Self::ArtifactDeviceInstallation,
        Self::ArtifactWorkspace,
        Self::BackupId,
        Self::ManifestDigest,
        Self::AccountGeneration,
        Self::DeviceInstallationGeneration,
        Self::WorkspaceGeneration,
        Self::SessionGeneration,
        Self::RuntimeGeneration,
        Self::LeaseGeneration,
        Self::TrustedTimeGeneration,
        Self::CredentialBindingGeneration,
        Self::SecureHttpGeneration,
        Self::BackupGeneration,
        Self::ManifestGeneration,
        Self::WrappingKeyAccount,
        Self::WrappingKeyDeviceInstallation,
        Self::WrappingKeyWorkspace,
        Self::WrappingKeyGeneration,
    ];

    #[must_use]
    fn session_mutation(self) -> Option<SessionMutation> {
        match self {
            Self::Account => Some(SessionMutation::Account),
            Self::DeviceInstallation => Some(SessionMutation::DeviceInstallation),
            Self::Workspace => Some(SessionMutation::Workspace),
            Self::SessionFamily => Some(SessionMutation::SessionFamily),
            Self::Audience => Some(SessionMutation::Audience),
            Self::KeyPurpose => Some(SessionMutation::KeyPurpose),
            Self::AccountGeneration => Some(SessionMutation::AccountGeneration),
            Self::DeviceInstallationGeneration => {
                Some(SessionMutation::DeviceInstallationGeneration)
            }
            Self::WorkspaceGeneration => Some(SessionMutation::WorkspaceGeneration),
            Self::SessionGeneration => Some(SessionMutation::SessionGeneration),
            _ => None,
        }
    }

    #[must_use]
    fn runtime_mutation(self) -> Option<RuntimeMutation> {
        match self {
            Self::Runtime => Some(RuntimeMutation::Runtime),
            Self::Lease => Some(RuntimeMutation::Lease),
            Self::RuntimeLeaseAccount => Some(RuntimeMutation::LeaseAccount),
            Self::RuntimeLeaseDeviceInstallation => Some(RuntimeMutation::LeaseDeviceInstallation),
            Self::RuntimeLeaseWorkspace => Some(RuntimeMutation::LeaseWorkspace),
            Self::TrustedTime => Some(RuntimeMutation::TrustedTime),
            Self::RuntimeGeneration => Some(RuntimeMutation::RuntimeGeneration),
            Self::LeaseGeneration => Some(RuntimeMutation::LeaseGeneration),
            Self::TrustedTimeGeneration => Some(RuntimeMutation::TrustedTimeGeneration),
            _ => None,
        }
    }

    #[must_use]
    fn credential_mutation(self) -> Option<CredentialMutation> {
        match self {
            Self::CredentialBinding => Some(CredentialMutation::Binding),
            Self::CredentialBindingAccount => Some(CredentialMutation::Account),
            Self::CredentialBindingDeviceInstallation => {
                Some(CredentialMutation::DeviceInstallation)
            }
            Self::CredentialBindingWorkspace => Some(CredentialMutation::Workspace),
            Self::CredentialBindingGeneration => Some(CredentialMutation::BindingGeneration),
            _ => None,
        }
    }

    #[must_use]
    fn secure_http_mutation(self) -> Option<SecureHttpMutation> {
        match self {
            Self::SecureHttp | Self::SecureHttpGeneration => Some(SecureHttpMutation::Generation),
            Self::SecureHttpChannel => Some(SecureHttpMutation::Channel),
            Self::SecureHttpEndpoint => Some(SecureHttpMutation::Endpoint),
            Self::SecureHttpOrigin => Some(SecureHttpMutation::Origin),
            Self::SecureHttpAdapter => Some(SecureHttpMutation::Adapter),
            Self::SecureHttpResolver => Some(SecureHttpMutation::Resolver),
            Self::SecureHttpTls => Some(SecureHttpMutation::Tls),
            Self::SecureHttpProxy => Some(SecureHttpMutation::Proxy),
            Self::SecureHttpRedirect => Some(SecureHttpMutation::Redirect),
            Self::SecureHttpCredentialInjection => Some(SecureHttpMutation::CredentialInjection),
            _ => None,
        }
    }

    #[must_use]
    fn backup_key_mutation(self) -> Option<BackupKeyMutation> {
        match self {
            Self::WrappingKeyAccount => Some(BackupKeyMutation::Account),
            Self::WrappingKeyDeviceInstallation => Some(BackupKeyMutation::DeviceInstallation),
            Self::WrappingKeyWorkspace => Some(BackupKeyMutation::Workspace),
            Self::WrappingKeyGeneration => Some(BackupKeyMutation::Generation),
            _ => None,
        }
    }
}
