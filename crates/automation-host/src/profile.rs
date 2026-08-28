//! Opaque Host-owned browser profile identities and logical partitions.

use std::collections::HashMap;
#[cfg(test)]
use std::fmt::Write as _;

use sha2::{Digest, Sha256};

const MAX_ID_BYTES: usize = 256;
const PROFILE_DOMAIN: &[u8] = b"GOODDEALER-BROWSER-PROFILE-V1\0";

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct BoundedId(String);

impl BoundedId {
    fn parse(value: &str) -> Result<Self, ProfileError> {
        if value.is_empty() || value.len() > MAX_ID_BYTES {
            return Err(ProfileError::InvalidIdentity);
        }
        if !value.is_ascii()
            || value.bytes().any(|byte| {
                byte.is_ascii_control()
                    || byte.is_ascii_whitespace()
                    || matches!(byte, b'/' | b'\\' | b':' | b'?' | b'#')
            })
        {
            return Err(ProfileError::InvalidIdentity);
        }
        Ok(Self(value.to_owned()))
    }

    fn append_to(&self, digest: &mut Sha256) {
        digest.update(
            u32::try_from(self.0.len())
                .unwrap_or(u32::MAX)
                .to_be_bytes(),
        );
        digest.update(self.0.as_bytes());
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub(crate) struct ActiveProfileIdentity {
    device_id: BoundedId,
    provider_connection_id: BoundedId,
}

impl ActiveProfileIdentity {
    pub(crate) fn host_created(
        device_id: &str,
        provider_connection_id: &str,
    ) -> Result<Self, ProfileError> {
        Ok(Self {
            device_id: BoundedId::parse(device_id)?,
            provider_connection_id: BoundedId::parse(provider_connection_id)?,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub(crate) struct SunsetProfileIdentity {
    sunset_installation_id: BoundedId,
    workspace_id: BoundedId,
    sunset_credential_generation: u64,
    device_signing_key_id: BoundedId,
    device_signing_key_version: u64,
    provider_connection_id: BoundedId,
}

impl SunsetProfileIdentity {
    pub(crate) fn host_created(
        sunset_installation_id: &str,
        workspace_id: &str,
        sunset_credential_generation: u64,
        device_signing_key_id: &str,
        device_signing_key_version: u64,
        provider_connection_id: &str,
    ) -> Result<Self, ProfileError> {
        if sunset_credential_generation == 0 || device_signing_key_version == 0 {
            return Err(ProfileError::InvalidGeneration);
        }
        Ok(Self {
            sunset_installation_id: BoundedId::parse(sunset_installation_id)?,
            workspace_id: BoundedId::parse(workspace_id)?,
            sunset_credential_generation,
            device_signing_key_id: BoundedId::parse(device_signing_key_id)?,
            device_signing_key_version,
            provider_connection_id: BoundedId::parse(provider_connection_id)?,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub(crate) enum ProfileAuthorityScope {
    Active(ActiveProfileIdentity),
    Sunset(SunsetProfileIdentity),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum SessionPersistence {
    Persistent,
    Private,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub(crate) struct ProfileKey {
    authority_scope: ProfileAuthorityScope,
    persistence: SessionPersistence,
}

impl ProfileKey {
    pub(crate) const fn host_created(
        authority_scope: ProfileAuthorityScope,
        persistence: SessionPersistence,
    ) -> Self {
        Self {
            authority_scope,
            persistence,
        }
    }

    pub(crate) const fn persistence(&self) -> SessionPersistence {
        self.persistence
    }

    fn partition_digest(&self, private_nonce: u64) -> [u8; 32] {
        let mut digest = Sha256::new();
        digest.update(PROFILE_DOMAIN);
        match &self.authority_scope {
            ProfileAuthorityScope::Active(identity) => {
                digest.update([1]);
                identity.device_id.append_to(&mut digest);
                identity.provider_connection_id.append_to(&mut digest);
            }
            ProfileAuthorityScope::Sunset(identity) => {
                digest.update([2]);
                identity.sunset_installation_id.append_to(&mut digest);
                identity.workspace_id.append_to(&mut digest);
                digest.update(identity.sunset_credential_generation.to_be_bytes());
                identity.device_signing_key_id.append_to(&mut digest);
                digest.update(identity.device_signing_key_version.to_be_bytes());
                identity.provider_connection_id.append_to(&mut digest);
            }
        }
        match self.persistence {
            SessionPersistence::Persistent => digest.update([1]),
            SessionPersistence::Private => {
                digest.update([2]);
                digest.update(private_nonce.to_be_bytes());
            }
        }
        digest.finalize().into()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub(crate) struct ProfileId([u8; 32]);

impl ProfileId {
    #[cfg(test)]
    pub(crate) fn opaque_hex(&self) -> String {
        self.0
            .iter()
            .fold(String::with_capacity(64), |mut output, byte| {
                write!(output, "{byte:02x}").expect("writing to String cannot fail");
                output
            })
    }
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct ProfileGeneration(u64);

impl ProfileGeneration {
    pub(crate) const fn initial() -> Self {
        Self(1)
    }

    pub(crate) fn advance(&mut self) {
        self.0 = self.0.saturating_add(1);
    }

    pub(crate) const fn value(&self) -> u64 {
        self.0
    }
}

#[derive(Debug, Default)]
pub(crate) struct ProfileRegistry {
    persistent: HashMap<ProfileKey, ProfileId>,
    next_private_nonce: u64,
}

impl ProfileRegistry {
    pub(crate) fn resolve(&mut self, key: &ProfileKey) -> ProfileId {
        if key.persistence == SessionPersistence::Persistent {
            return self
                .persistent
                .entry(key.clone())
                .or_insert_with(|| ProfileId(key.partition_digest(0)))
                .clone();
        }
        self.next_private_nonce = self.next_private_nonce.saturating_add(1);
        ProfileId(key.partition_digest(self.next_private_nonce))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ProfileError {
    InvalidIdentity,
    InvalidGeneration,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn active(device: &str, connection: &str) -> ProfileKey {
        ProfileKey::host_created(
            ProfileAuthorityScope::Active(
                ActiveProfileIdentity::host_created(device, connection).unwrap(),
            ),
            SessionPersistence::Persistent,
        )
    }

    fn sunset(
        installation: &str,
        workspace: &str,
        credential_generation: u64,
        key_id: &str,
        key_version: u64,
        connection: &str,
    ) -> ProfileKey {
        ProfileKey::host_created(
            ProfileAuthorityScope::Sunset(
                SunsetProfileIdentity::host_created(
                    installation,
                    workspace,
                    credential_generation,
                    key_id,
                    key_version,
                    connection,
                )
                .unwrap(),
            ),
            SessionPersistence::Persistent,
        )
    }

    #[test]
    fn authority_scope_and_persistence_are_orthogonal() {
        let active_private = ProfileKey::host_created(
            ProfileAuthorityScope::Active(
                ActiveProfileIdentity::host_created("device-a", "connection-a").unwrap(),
            ),
            SessionPersistence::Private,
        );
        let sunset_private = ProfileKey::host_created(
            ProfileAuthorityScope::Sunset(
                SunsetProfileIdentity::host_created(
                    "installation-a",
                    "workspace-a",
                    1,
                    "device-key-a",
                    1,
                    "connection-a",
                )
                .unwrap(),
            ),
            SessionPersistence::Private,
        );
        assert_ne!(active_private, sunset_private);
    }

    #[test]
    fn complete_identity_derives_distinct_opaque_partitions() {
        let keys = [
            active("device-a", "connection-a"),
            active("device-b", "connection-a"),
            active("device-a", "connection-b"),
            sunset(
                "installation-a",
                "workspace-a",
                1,
                "key-a",
                1,
                "connection-a",
            ),
            sunset(
                "installation-b",
                "workspace-a",
                1,
                "key-a",
                1,
                "connection-a",
            ),
            sunset(
                "installation-a",
                "workspace-b",
                1,
                "key-a",
                1,
                "connection-a",
            ),
            sunset(
                "installation-a",
                "workspace-a",
                2,
                "key-a",
                1,
                "connection-a",
            ),
            sunset(
                "installation-a",
                "workspace-a",
                1,
                "key-b",
                1,
                "connection-a",
            ),
            sunset(
                "installation-a",
                "workspace-a",
                1,
                "key-a",
                2,
                "connection-a",
            ),
            sunset(
                "installation-a",
                "workspace-a",
                1,
                "key-a",
                1,
                "connection-b",
            ),
        ];
        let mut registry = ProfileRegistry::default();
        let ids: std::collections::HashSet<_> = keys
            .iter()
            .map(|key| registry.resolve(key).opaque_hex())
            .collect();
        assert_eq!(ids.len(), keys.len());
        assert!(ids.iter().all(|id| id.len() == 64));
        assert!(ids.iter().all(|id| !id.contains("device")));
    }

    #[test]
    fn persistent_exact_key_reuses_and_private_never_reuses() {
        let mut registry = ProfileRegistry::default();
        let persistent = active("device-a", "connection-a");
        assert_eq!(registry.resolve(&persistent), registry.resolve(&persistent));

        let private = ProfileKey::host_created(
            persistent.authority_scope.clone(),
            SessionPersistence::Private,
        );
        assert_ne!(registry.resolve(&private), registry.resolve(&private));
        assert_ne!(registry.resolve(&persistent), registry.resolve(&private));
    }

    #[test]
    fn invalid_empty_oversized_and_path_like_identities_reject() {
        assert_eq!(
            ActiveProfileIdentity::host_created("", "connection"),
            Err(ProfileError::InvalidIdentity)
        );
        assert_eq!(
            ActiveProfileIdentity::host_created(&"a".repeat(MAX_ID_BYTES + 1), "connection"),
            Err(ProfileError::InvalidIdentity)
        );
        assert_eq!(
            ActiveProfileIdentity::host_created("../profile", "connection"),
            Err(ProfileError::InvalidIdentity)
        );
        assert_eq!(
            SunsetProfileIdentity::host_created("install", "workspace", 0, "key", 1, "conn"),
            Err(ProfileError::InvalidGeneration)
        );
    }
}
