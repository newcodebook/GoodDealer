//! Private runtime, lease, and trusted-time state for the sealed Host operation.

use crate::sealed_session::SealedSessionFence;

#[derive(Clone, PartialEq, Eq)]
pub(super) struct SealedRuntimeFence {
    pub(super) account_id: String,
    pub(super) device_installation_id: String,
    pub(super) workspace_id: String,
    pub(super) lease_id: String,
    pub(super) runtime_generation: u64,
    pub(super) lease_generation: u64,
    pub(super) trusted_time_epoch: u64,
    pub(super) trusted_time_valid_until: u64,
    pub(super) trusted_time_generation: u64,
}

pub(super) struct SealedRuntimeState {
    active: bool,
    account_id: String,
    device_installation_id: String,
    workspace_id: String,
    lease_id: String,
    runtime_generation: u64,
    lease_generation: u64,
    trusted_time_epoch: u64,
    trusted_time_valid_until: u64,
    trusted_time_generation: u64,
}

impl SealedRuntimeState {
    pub(super) fn denying() -> Self {
        Self {
            active: false,
            account_id: String::new(),
            device_installation_id: String::new(),
            workspace_id: String::new(),
            lease_id: String::new(),
            runtime_generation: 0,
            lease_generation: 0,
            trusted_time_epoch: 0,
            trusted_time_valid_until: 0,
            trusted_time_generation: 0,
        }
    }

    pub(super) fn current_fence(&self, session: &SealedSessionFence) -> Option<SealedRuntimeFence> {
        (self.active
            && self.runtime_generation != 0
            && self.lease_generation != 0
            && self.trusted_time_generation != 0
            && self.trusted_time_epoch <= self.trusted_time_valid_until
            && !self.lease_id.is_empty()
            && self.account_id == session.account_id
            && self.device_installation_id == session.device_installation_id
            && self.workspace_id == session.workspace_id)
            .then(|| SealedRuntimeFence {
                account_id: self.account_id.clone(),
                device_installation_id: self.device_installation_id.clone(),
                workspace_id: self.workspace_id.clone(),
                lease_id: self.lease_id.clone(),
                runtime_generation: self.runtime_generation,
                lease_generation: self.lease_generation,
                trusted_time_epoch: self.trusted_time_epoch,
                trusted_time_valid_until: self.trusted_time_valid_until,
                trusted_time_generation: self.trusted_time_generation,
            })
    }

    #[cfg(test)]
    pub(super) fn active_for_test(session: &SealedSessionFence) -> Self {
        Self {
            active: true,
            account_id: session.account_id.clone(),
            device_installation_id: session.device_installation_id.clone(),
            workspace_id: session.workspace_id.clone(),
            lease_id: "lease-host-42".to_owned(),
            runtime_generation: 1,
            lease_generation: 1,
            trusted_time_epoch: 100,
            trusted_time_valid_until: 200,
            trusted_time_generation: 1,
        }
    }

    #[cfg(test)]
    pub(super) fn mutate_for_test(&mut self, mutation: RuntimeMutation) {
        match mutation {
            RuntimeMutation::Runtime => self.active = false,
            RuntimeMutation::Lease => self.lease_id.push_str("-changed"),
            RuntimeMutation::LeaseAccount => self.account_id.push_str("-changed"),
            RuntimeMutation::LeaseDeviceInstallation => {
                self.device_installation_id.push_str("-changed");
            }
            RuntimeMutation::LeaseWorkspace => self.workspace_id.push_str("-changed"),
            RuntimeMutation::TrustedTime => {
                self.trusted_time_epoch = self.trusted_time_valid_until.saturating_add(1);
            }
            RuntimeMutation::RuntimeGeneration => {
                self.runtime_generation = self.runtime_generation.saturating_add(1);
            }
            RuntimeMutation::LeaseGeneration => {
                self.lease_generation = self.lease_generation.saturating_add(1);
            }
            RuntimeMutation::TrustedTimeGeneration => {
                self.trusted_time_generation = self.trusted_time_generation.saturating_add(1);
            }
        }
    }
}

#[cfg(test)]
#[derive(Clone, Copy)]
pub(super) enum RuntimeMutation {
    Runtime,
    Lease,
    LeaseAccount,
    LeaseDeviceInstallation,
    LeaseWorkspace,
    TrustedTime,
    RuntimeGeneration,
    LeaseGeneration,
    TrustedTimeGeneration,
}
