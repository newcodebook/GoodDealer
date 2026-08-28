//! Private, deny-by-default secure-HTTP admission for the backup key channel.
//!
//! It deliberately owns the fixed endpoint/origin, adapter, resolver, TLS, proxy, redirect, and
//! credential-injection policy as one closed internal record. It is an admission substrate only:
//! this repair performs no network I/O and exposes no generic transport or endpoint authority.

use crate::sealed_credential::SealedCredentialFence;
use crate::sealed_runtime::SealedRuntimeFence;
use crate::sealed_session::{SealedSessionAudience, SealedSessionFence, SealedSessionKeyPurpose};

const BACKUP_ENDPOINT: &str = "gooddealer.backup-envelope.v1";
const BACKUP_ORIGIN: &str = "https://backup.gooddealer.invalid";

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum SealedSecureHttpChannel {
    DesktopBackup,
    AccountWebCookie,
}

impl SealedSecureHttpChannel {
    pub(super) const fn domain_tag(self) -> &'static [u8] {
        match self {
            Self::DesktopBackup => b"gooddealer.host.backup-https.v1",
            Self::AccountWebCookie => b"gooddealer.account-web.cookie.v1",
        }
    }
}

#[derive(Clone, PartialEq, Eq)]
pub(super) struct SealedSecureHttpFence {
    pub(super) channel: SealedSecureHttpChannel,
    pub(super) generation: u64,
}

#[derive(Clone, Copy, PartialEq, Eq)]
struct SealedSecureHttpControls(u8);

impl SealedSecureHttpControls {
    const HOST_OWNED_ADAPTER: u8 = 1 << 0;
    const PINNED_RESOLVER: u8 = 1 << 1;
    const REQUIRED_TLS: u8 = 1 << 2;
    const DENIED_PROXY: u8 = 1 << 3;
    const DENIED_REDIRECT: u8 = 1 << 4;
    const BOUND_CREDENTIAL_INJECTION: u8 = 1 << 5;
    const REQUIRED: u8 = Self::HOST_OWNED_ADAPTER
        | Self::PINNED_RESOLVER
        | Self::REQUIRED_TLS
        | Self::DENIED_PROXY
        | Self::DENIED_REDIRECT
        | Self::BOUND_CREDENTIAL_INJECTION;

    const fn denying() -> Self {
        Self(0)
    }

    #[cfg(test)]
    const fn fixed_backup_channel() -> Self {
        Self(Self::REQUIRED)
    }

    const fn admits_backup_channel(self) -> bool {
        self.0 == Self::REQUIRED
    }

    #[cfg(test)]
    fn remove_for_test(&mut self, control: u8) {
        self.0 &= !control;
    }
}

pub(super) struct SealedSecureHttpState {
    active: bool,
    channel: SealedSecureHttpChannel,
    endpoint: &'static str,
    origin: &'static str,
    controls: SealedSecureHttpControls,
    generation: u64,
}

impl SealedSecureHttpState {
    pub(super) fn denying() -> Self {
        Self {
            active: false,
            channel: SealedSecureHttpChannel::AccountWebCookie,
            endpoint: "",
            origin: "",
            controls: SealedSecureHttpControls::denying(),
            generation: 0,
        }
    }

    pub(super) fn current_fence(
        &self,
        session: &SealedSessionFence,
        runtime: &SealedRuntimeFence,
        credential: &SealedCredentialFence,
    ) -> Option<SealedSecureHttpFence> {
        (self.active
            && self.channel == SealedSecureHttpChannel::DesktopBackup
            && self.endpoint == BACKUP_ENDPOINT
            && self.origin == BACKUP_ORIGIN
            && self.controls.admits_backup_channel()
            && self.generation != 0
            && session.audience == SealedSessionAudience::DesktopBackup
            && session.key_purpose == SealedSessionKeyPurpose::BackupWrapping
            && runtime.lease_generation != 0
            && credential.binding_generation != 0)
            .then_some(SealedSecureHttpFence {
                channel: self.channel,
                generation: self.generation,
            })
    }

    #[cfg(test)]
    pub(super) fn active_for_test() -> Self {
        Self {
            active: true,
            channel: SealedSecureHttpChannel::DesktopBackup,
            endpoint: BACKUP_ENDPOINT,
            origin: BACKUP_ORIGIN,
            controls: SealedSecureHttpControls::fixed_backup_channel(),
            generation: 1,
        }
    }

    #[cfg(test)]
    pub(super) fn mutate_for_test(&mut self, mutation: SecureHttpMutation) {
        match mutation {
            SecureHttpMutation::Channel => self.channel = SealedSecureHttpChannel::AccountWebCookie,
            SecureHttpMutation::Endpoint => self.endpoint = "untrusted.endpoint",
            SecureHttpMutation::Origin => self.origin = "https://untrusted.invalid",
            SecureHttpMutation::Adapter => self
                .controls
                .remove_for_test(SealedSecureHttpControls::HOST_OWNED_ADAPTER),
            SecureHttpMutation::Resolver => self
                .controls
                .remove_for_test(SealedSecureHttpControls::PINNED_RESOLVER),
            SecureHttpMutation::Tls => self
                .controls
                .remove_for_test(SealedSecureHttpControls::REQUIRED_TLS),
            SecureHttpMutation::Proxy => self
                .controls
                .remove_for_test(SealedSecureHttpControls::DENIED_PROXY),
            SecureHttpMutation::Redirect => self
                .controls
                .remove_for_test(SealedSecureHttpControls::DENIED_REDIRECT),
            SecureHttpMutation::CredentialInjection => self
                .controls
                .remove_for_test(SealedSecureHttpControls::BOUND_CREDENTIAL_INJECTION),
            SecureHttpMutation::Generation => {
                self.generation = self.generation.saturating_add(1);
            }
        }
    }
}

#[cfg(test)]
#[derive(Clone, Copy)]
pub(super) enum SecureHttpMutation {
    Channel,
    Endpoint,
    Origin,
    Adapter,
    Resolver,
    Tls,
    Proxy,
    Redirect,
    CredentialInjection,
    Generation,
}
