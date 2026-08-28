//! Private Desktop-host session binding used only by the sealed backup operation.
//!
//! Account-Web material is deliberately represented by a distinct closed audience and never has a
//! parser or conversion into the Desktop-host session binding. Callers cannot supply either kind
//! of material because this module is not exported from the crate.

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum SealedSessionAudience {
    DesktopBackup,
    AccountWebCookie,
}

impl SealedSessionAudience {
    pub(super) const fn domain_tag(self) -> &'static [u8] {
        match self {
            Self::DesktopBackup => b"gooddealer.desktop.backup-session.v1",
            Self::AccountWebCookie => b"gooddealer.account-web.cookie.v1",
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum SealedSessionKeyPurpose {
    BackupWrapping,
    AccountWebCookie,
}

impl SealedSessionKeyPurpose {
    pub(super) const fn domain_tag(self) -> &'static [u8] {
        match self {
            Self::BackupWrapping => b"gooddealer.host.backup-wrapping.v1",
            Self::AccountWebCookie => b"gooddealer.account-web.cookie.v1",
        }
    }
}

#[derive(Clone, PartialEq, Eq)]
pub(super) struct SealedSessionFence {
    pub(super) account_id: String,
    pub(super) device_installation_id: String,
    pub(super) workspace_id: String,
    pub(super) session_family_id: String,
    pub(super) audience: SealedSessionAudience,
    pub(super) key_purpose: SealedSessionKeyPurpose,
    pub(super) account_generation: u64,
    pub(super) device_installation_generation: u64,
    pub(super) workspace_generation: u64,
    pub(super) session_generation: u64,
}

/// Session authority never accepts wire material here. The only non-denying instance is a private
/// test seam so the authorization fence can be exercised without a selectable runtime provider.
pub(super) struct SealedSessionState {
    active: bool,
    account_id: String,
    device_installation_id: String,
    workspace_id: String,
    session_family_id: String,
    audience: SealedSessionAudience,
    key_purpose: SealedSessionKeyPurpose,
    account_generation: u64,
    device_installation_generation: u64,
    workspace_generation: u64,
    session_generation: u64,
}

impl SealedSessionState {
    pub(super) fn denying() -> Self {
        Self {
            active: false,
            account_id: String::new(),
            device_installation_id: String::new(),
            workspace_id: String::new(),
            session_family_id: String::new(),
            audience: SealedSessionAudience::AccountWebCookie,
            key_purpose: SealedSessionKeyPurpose::AccountWebCookie,
            account_generation: 0,
            device_installation_generation: 0,
            workspace_generation: 0,
            session_generation: 0,
        }
    }

    pub(super) fn current_fence(&self) -> Option<SealedSessionFence> {
        (self.active
            && self.audience == SealedSessionAudience::DesktopBackup
            && self.key_purpose == SealedSessionKeyPurpose::BackupWrapping
            && self.account_generation != 0
            && self.device_installation_generation != 0
            && self.workspace_generation != 0
            && self.session_generation != 0
            && !self.account_id.is_empty()
            && !self.device_installation_id.is_empty()
            && !self.workspace_id.is_empty()
            && !self.session_family_id.is_empty())
        .then(|| SealedSessionFence {
            account_id: self.account_id.clone(),
            device_installation_id: self.device_installation_id.clone(),
            workspace_id: self.workspace_id.clone(),
            session_family_id: self.session_family_id.clone(),
            audience: self.audience,
            key_purpose: self.key_purpose,
            account_generation: self.account_generation,
            device_installation_generation: self.device_installation_generation,
            workspace_generation: self.workspace_generation,
            session_generation: self.session_generation,
        })
    }

    #[cfg(test)]
    pub(super) fn active_for_test() -> Self {
        Self {
            active: true,
            account_id: "account-host-42".to_owned(),
            device_installation_id: "installation-host-42".to_owned(),
            workspace_id: "workspace-host-42".to_owned(),
            session_family_id: "desktop-family-host-42".to_owned(),
            audience: SealedSessionAudience::DesktopBackup,
            key_purpose: SealedSessionKeyPurpose::BackupWrapping,
            account_generation: 1,
            device_installation_generation: 1,
            workspace_generation: 1,
            session_generation: 1,
        }
    }

    #[cfg(test)]
    pub(super) fn mutate_for_test(&mut self, mutation: SessionMutation) {
        match mutation {
            SessionMutation::Account => self.account_id.push_str("-changed"),
            SessionMutation::DeviceInstallation => self.device_installation_id.push_str("-changed"),
            SessionMutation::Workspace => self.workspace_id.push_str("-changed"),
            SessionMutation::SessionFamily => self.session_family_id.push_str("-changed"),
            SessionMutation::Audience => self.audience = SealedSessionAudience::AccountWebCookie,
            SessionMutation::KeyPurpose => {
                self.key_purpose = SealedSessionKeyPurpose::AccountWebCookie;
            }
            SessionMutation::AccountGeneration => {
                self.account_generation = self.account_generation.saturating_add(1);
            }
            SessionMutation::DeviceInstallationGeneration => {
                self.device_installation_generation =
                    self.device_installation_generation.saturating_add(1);
            }
            SessionMutation::WorkspaceGeneration => {
                self.workspace_generation = self.workspace_generation.saturating_add(1);
            }
            SessionMutation::SessionGeneration => {
                self.session_generation = self.session_generation.saturating_add(1);
            }
        }
    }
}

#[cfg(test)]
#[derive(Clone, Copy)]
pub(super) enum SessionMutation {
    Account,
    DeviceInstallation,
    Workspace,
    SessionFamily,
    Audience,
    KeyPurpose,
    AccountGeneration,
    DeviceInstallationGeneration,
    WorkspaceGeneration,
    SessionGeneration,
}
