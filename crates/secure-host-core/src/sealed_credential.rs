//! Private backup credential-binding metadata.
//!
//! This stores no caller-provided credential reference and exports no secret access. It only
//! proves that the fixed Host backup path remains bound to the current account, installation, and
//! workspace before key work begins.

use crate::sealed_session::SealedSessionFence;

#[derive(Clone, PartialEq, Eq)]
pub(super) struct SealedCredentialFence {
    pub(super) binding_id: String,
    pub(super) binding_generation: u64,
}

pub(super) struct SealedCredentialState {
    active: bool,
    binding_id: String,
    binding_generation: u64,
    account_id: String,
    device_installation_id: String,
    workspace_id: String,
}

impl SealedCredentialState {
    pub(super) fn denying() -> Self {
        Self {
            active: false,
            binding_id: String::new(),
            binding_generation: 0,
            account_id: String::new(),
            device_installation_id: String::new(),
            workspace_id: String::new(),
        }
    }

    pub(super) fn current_fence(
        &self,
        session: &SealedSessionFence,
    ) -> Option<SealedCredentialFence> {
        (self.active
            && self.binding_generation != 0
            && !self.binding_id.is_empty()
            && self.account_id == session.account_id
            && self.device_installation_id == session.device_installation_id
            && self.workspace_id == session.workspace_id)
            .then(|| SealedCredentialFence {
                binding_id: self.binding_id.clone(),
                binding_generation: self.binding_generation,
            })
    }

    #[cfg(test)]
    pub(super) fn active_for_test(session: &SealedSessionFence) -> Self {
        Self {
            active: true,
            binding_id: "backup-binding-host-42".to_owned(),
            binding_generation: 1,
            account_id: session.account_id.clone(),
            device_installation_id: session.device_installation_id.clone(),
            workspace_id: session.workspace_id.clone(),
        }
    }

    #[cfg(test)]
    pub(super) fn mutate_for_test(&mut self, mutation: CredentialMutation) {
        match mutation {
            CredentialMutation::Binding => self.binding_id.push_str("-changed"),
            CredentialMutation::BindingGeneration => {
                self.binding_generation = self.binding_generation.saturating_add(1);
            }
            CredentialMutation::Account => self.account_id.push_str("-changed"),
            CredentialMutation::DeviceInstallation => {
                self.device_installation_id.push_str("-changed");
            }
            CredentialMutation::Workspace => self.workspace_id.push_str("-changed"),
        }
    }
}

#[cfg(test)]
#[derive(Clone, Copy)]
pub(super) enum CredentialMutation {
    Binding,
    BindingGeneration,
    Account,
    DeviceInstallation,
    Workspace,
}
