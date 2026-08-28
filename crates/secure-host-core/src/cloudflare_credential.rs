//! Private Cloudflare credential custody, deliberately unrelated to backup authority.

use zeroize::Zeroizing;

use crate::cloudflare_operation::CloudflareZoneReadIntent;

#[derive(Clone, Copy, PartialEq, Eq)]
enum CloudflareCredentialPurpose {
    ZoneMetadataAndDnsReadV1,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum CloudflarePermissionClaim {
    ZoneReadAndDnsRead,
}

#[derive(Clone, PartialEq, Eq)]
pub(super) struct CloudflareCredentialFence {
    connection_id: String,
    zone_id: String,
    purpose: CloudflareCredentialPurpose,
    permission: CloudflarePermissionClaim,
    generation: u64,
}

pub(super) struct CloudflareCredentialState {
    active: bool,
    connection_id: String,
    zone_id: String,
    purpose: CloudflareCredentialPurpose,
    permission: CloudflarePermissionClaim,
    generation: u64,
    token: Zeroizing<String>,
}

impl CloudflareCredentialState {
    pub(super) fn denying() -> Self {
        Self {
            active: false,
            connection_id: String::new(),
            zone_id: String::new(),
            purpose: CloudflareCredentialPurpose::ZoneMetadataAndDnsReadV1,
            permission: CloudflarePermissionClaim::ZoneReadAndDnsRead,
            generation: 0,
            token: Zeroizing::new(String::new()),
        }
    }

    pub(super) fn current_fence(
        &self,
        intent: &CloudflareZoneReadIntent,
    ) -> Option<CloudflareCredentialFence> {
        (self.active
            && self.generation != 0
            && !self.token.is_empty()
            && self.connection_id == intent.connection_id()
            && self.zone_id == intent.zone_id()
            && self.purpose == CloudflareCredentialPurpose::ZoneMetadataAndDnsReadV1
            && self.permission == CloudflarePermissionClaim::ZoneReadAndDnsRead)
            .then(|| CloudflareCredentialFence {
                connection_id: self.connection_id.clone(),
                zone_id: self.zone_id.clone(),
                purpose: self.purpose,
                permission: self.permission,
                generation: self.generation,
            })
    }

    pub(super) fn fence_matches(
        &self,
        intent: &CloudflareZoneReadIntent,
        fence: &CloudflareCredentialFence,
    ) -> bool {
        self.current_fence(intent).as_ref() == Some(fence)
    }

    pub(super) fn token(&self) -> &str {
        &self.token
    }

    #[cfg(test)]
    pub(super) fn active_for_test(connection_id: &str, zone_id: &str, token: &str) -> Self {
        Self {
            active: true,
            connection_id: connection_id.to_owned(),
            zone_id: zone_id.to_owned(),
            purpose: CloudflareCredentialPurpose::ZoneMetadataAndDnsReadV1,
            permission: CloudflarePermissionClaim::ZoneReadAndDnsRead,
            generation: 1,
            token: Zeroizing::new(token.to_owned()),
        }
    }

    #[cfg(test)]
    pub(super) fn mutate_for_test(&mut self, mutation: CloudflareCredentialMutation) {
        match mutation {
            CloudflareCredentialMutation::Remove | CloudflareCredentialMutation::Permission => {
                self.active = false;
            }
            CloudflareCredentialMutation::Connection => self.connection_id.push_str("-changed"),
            CloudflareCredentialMutation::Zone => self.zone_id.replace_range(..1, "f"),
            CloudflareCredentialMutation::Purpose => {
                // There is intentionally no second valid purpose. Deactivation models a purpose
                // record outside the closed Cloudflare admission domain.
                self.active = false;
            }
            CloudflareCredentialMutation::Generation => {
                self.generation = self.generation.saturating_add(1);
            }
            CloudflareCredentialMutation::Token => {
                self.token.push_str("-changed");
                self.generation = self.generation.saturating_add(1);
            }
        }
    }
}

#[cfg(test)]
#[derive(Clone, Copy)]
pub(super) enum CloudflareCredentialMutation {
    Remove,
    Connection,
    Zone,
    Purpose,
    Permission,
    Generation,
    Token,
}
