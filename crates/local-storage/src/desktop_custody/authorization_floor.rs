//! Native-owned authorization floors survive workspace replacement and process restart.

use super::DesktopCustodyError;
#[cfg(unix)]
use super::DesktopProductionCustody;
use serde::{Deserialize, Serialize};

#[cfg(unix)]
const MAX_BYTES: usize = 65_536;
const MAX_EPOCH: u64 = 9_007_199_254_740_991;
#[cfg(all(unix, not(test)))]
const SERVICE: &str = "com.gooddealer.desktop.workspace-authority-floor";
#[cfg(all(unix, not(test)))]
const ACCOUNT: &str = "verified-authority-floor-v1";
#[cfg(all(unix, not(test)))]
const MARKER_ACCOUNT: &str = "verified-authority-established-v1";

/// One Native atomic value: business backups never carry this record.
#[derive(Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct WorkspaceAuthorizationRecord {
    pub(crate) schema_version: u8,
    pub(crate) floor: WorkspaceAuthorizationFloor,
    #[serde(deserialize_with = "required_option")]
    pub(crate) device_evidence_floor: Option<DeviceEvidenceFloor>,
    #[serde(deserialize_with = "required_option")]
    pub(crate) execution_anchor: Option<ExecutionAnchorRecord>,
}
#[derive(Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DeviceEvidenceFloor {
    pub(crate) credential_epoch: u64,
    pub(crate) signing_key_id: String,
    pub(crate) signing_key_version: u64,
}
#[derive(Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ExecutionAnchorRecord {
    pub(crate) schema_version: u8,
    pub(crate) response_bytes: String,
    pub(crate) nonce: String,
    pub(crate) clock_kind: String,
    pub(crate) boot_id: [u8; 16],
    pub(crate) request_start_ticks: u64,
    pub(crate) response_ticks: u64,
    pub(crate) anchor_digest: String,
}
impl WorkspaceAuthorizationRecord {
    pub(crate) fn validate(&self) -> Result<(), DesktopCustodyError> {
        self.floor.validate()?;
        if self.schema_version != 4
            || self.device_evidence_floor.as_ref().is_some_and(|v| {
                v.credential_epoch == 0
                    || v.credential_epoch > MAX_EPOCH
                    || v.signing_key_version == 0
                    || v.signing_key_version > MAX_EPOCH
                    || !valid_identifier(&v.signing_key_id)
            })
        {
            return Err(DesktopCustodyError::Rejected);
        }
        if let Some(a) = &self.execution_anchor {
            use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
            let canonical = |v: &str, len: usize| {
                URL_SAFE_NO_PAD
                    .decode(v)
                    .is_ok_and(|bytes| bytes.len() == len && URL_SAFE_NO_PAD.encode(bytes) == v)
            };
            let divisor = match a.clock_kind.as_str() {
                "windows_interrupt_100ns" => 10_000,
                "macos_continuous_nanoseconds" | "linux_boot_nanoseconds" => 1_000_000,
                _ => return Err(DesktopCustodyError::Rejected),
            };
            let delta = a
                .response_ticks
                .checked_sub(a.request_start_ticks)
                .ok_or(DesktopCustodyError::Rejected)?;
            if a.schema_version != 1
                || self.device_evidence_floor.is_none()
                || a.boot_id == [0; 16]
                || a.request_start_ticks == 0
                || delta / divisor + u64::from(delta % divisor != 0) > 30_000
                || !canonical(&a.nonce, 32)
                || !canonical(&a.anchor_digest, 32)
                || !URL_SAFE_NO_PAD
                    .decode(&a.response_bytes)
                    .is_ok_and(|bytes| {
                        !bytes.is_empty()
                            && bytes.len() <= 32_768
                            && URL_SAFE_NO_PAD.encode(bytes) == a.response_bytes
                    })
            {
                return Err(DesktopCustodyError::Rejected);
            }
        }
        Ok(())
    }
}

#[derive(Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct WorkspaceAuthorizationFloor {
    pub(crate) schema_version: u8,
    pub(crate) installation_binding: [u8; 32],
    pub(crate) account_id: String,
    pub(crate) workspace_id: String,
    pub(crate) device_id: String,
    pub(crate) account_security_epoch: u64,
    pub(crate) issued_at: i64,
    pub(crate) maximum_lease_epoch: u64,
    #[serde(deserialize_with = "required_option")]
    pub(crate) last_active_lease_epoch: Option<u64>,
    #[serde(deserialize_with = "required_option")]
    pub(crate) standby_lease_epoch_floor: Option<u64>,
    #[serde(deserialize_with = "required_option")]
    pub(crate) commercial: Option<CommercialAuthorizationFloor>,
}

#[derive(Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CommercialAuthorizationFloor {
    pub(crate) revision: u64,
    pub(crate) digest: String,
    pub(crate) expires_at: String,
    pub(crate) capabilities: Vec<String>,
}

fn valid_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 160
        && value.bytes().all(|byte| (0x21..=0x7e).contains(&byte))
}

fn required_option<'de, D: serde::Deserializer<'de>, T: Deserialize<'de>>(
    deserializer: D,
) -> Result<Option<T>, D::Error> {
    Option::<T>::deserialize(deserializer)
}

impl WorkspaceAuthorizationFloor {
    pub(crate) fn validate(&self) -> Result<(), DesktopCustodyError> {
        if (self.standby_lease_epoch_floor.is_none() && self.commercial.is_none())
            || self.schema_version != 3
            || !valid_identifier(&self.account_id)
            || !valid_identifier(&self.workspace_id)
            || !valid_identifier(&self.device_id)
            || self.account_security_epoch == 0
            || self.account_security_epoch > MAX_EPOCH
            || self.issued_at <= 0
            || self.issued_at > 253_402_300_799
            || self.maximum_lease_epoch > MAX_EPOCH
            || self
                .last_active_lease_epoch
                .is_some_and(|value| value == 0 || value > self.maximum_lease_epoch)
            || self
                .standby_lease_epoch_floor
                .is_some_and(|value| value > self.maximum_lease_epoch)
            || self.commercial.as_ref().is_some_and(|commercial| {
                !crate::desktop_sync_runtime::valid_provider_capabilities(&commercial.capabilities)
                    || commercial.revision == 0
                    || commercial.revision > MAX_EPOCH
                    || commercial.digest.len() != 64
                    || !commercial
                        .digest
                        .bytes()
                        .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
                    || crate::portfolio_projection::validate_timestamp(Some(
                        commercial.expires_at.clone(),
                    ))
                    .is_err()
            })
        {
            return Err(DesktopCustodyError::Rejected);
        }
        Ok(())
    }

    /// The candidate describes the newly verified role; the stored record retains both roles'
    /// floors. A Standby publication never forgets the last accepted commercial authority.
    pub(crate) fn advance(mut self, previous: Option<&Self>) -> Result<Self, DesktopCustodyError> {
        self.validate()?;
        let Some(old) = previous else {
            return Ok(self);
        };
        old.validate()?;
        if self.installation_binding != old.installation_binding
            || self.account_id != old.account_id
            || self.workspace_id != old.workspace_id
            || self.device_id != old.device_id
            || self.account_security_epoch < old.account_security_epoch
            || self.issued_at < old.issued_at
            || self.maximum_lease_epoch < old.maximum_lease_epoch
        {
            return Err(DesktopCustodyError::Rejected);
        }
        if let Some(floor) = self.standby_lease_epoch_floor {
            if floor < old.maximum_lease_epoch
                || old.standby_lease_epoch_floor.is_some_and(|old| floor < old)
            {
                return Err(DesktopCustodyError::Rejected);
            }
            self.commercial.clone_from(&old.commercial);
            self.last_active_lease_epoch = old.last_active_lease_epoch;
        } else {
            if old
                .standby_lease_epoch_floor
                .is_some_and(|floor| self.maximum_lease_epoch <= floor)
            {
                return Err(DesktopCustodyError::Rejected);
            }
            if let Some(old_commercial) = old.commercial.as_ref() {
                let current = self
                    .commercial
                    .as_ref()
                    .ok_or(DesktopCustodyError::Rejected)?;
                if current.revision < old_commercial.revision
                    || (current.revision == old_commercial.revision && current != old_commercial)
                    || (current.digest == old_commercial.digest
                        && (current.expires_at != old_commercial.expires_at
                            || current.capabilities != old_commercial.capabilities))
                {
                    return Err(DesktopCustodyError::Rejected);
                }
            }
            self.standby_lease_epoch_floor = old.standby_lease_epoch_floor;
        }
        Ok(self)
    }
}

/// Legacy records only ever authorized the historical Cloudflare permission. Migration must
/// preserve known last-Active epochs (v2), and leave that fact unknown for v1; neither historical
/// commercial state nor a Standby floor can synthesize an Afternic permission.
#[cfg(any(unix, windows))]
fn decode_persisted_floor(
    bytes: &[u8],
) -> Result<WorkspaceAuthorizationFloor, DesktopCustodyError> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct LegacyCommercial {
        revision: u64,
        digest: String,
        expires_at: String,
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct LegacyFloor {
        schema_version: u8,
        installation_binding: [u8; 32],
        account_id: String,
        workspace_id: String,
        device_id: String,
        account_security_epoch: u64,
        issued_at: i64,
        maximum_lease_epoch: u64,
        #[serde(default)]
        last_active_lease_epoch: Option<u64>,
        #[serde(deserialize_with = "required_option")]
        standby_lease_epoch_floor: Option<u64>,
        #[serde(deserialize_with = "required_option")]
        commercial: Option<LegacyCommercial>,
    }
    // This look-ahead selects a version only. The typed parse below independently refuses every
    // unknown/duplicate field, including duplicates hidden by serde_json::Value's map.
    let value: serde_json::Value =
        serde_json::from_slice(bytes).map_err(|_| DesktopCustodyError::Rejected)?;
    if value
        .get("schemaVersion")
        .and_then(serde_json::Value::as_u64)
        == Some(3)
    {
        let record: WorkspaceAuthorizationFloor =
            serde_json::from_slice(bytes).map_err(|_| DesktopCustodyError::Rejected)?;
        record.validate()?;
        return Ok(record);
    }
    let old: LegacyFloor =
        serde_json::from_slice(bytes).map_err(|_| DesktopCustodyError::Rejected)?;
    let has_last_active = value.get("lastActiveLeaseEpoch").is_some();
    if !matches!(
        (old.schema_version, has_last_active),
        (1, false) | (2, true)
    ) {
        return Err(DesktopCustodyError::Rejected);
    }
    let record = WorkspaceAuthorizationFloor {
        schema_version: 3,
        installation_binding: old.installation_binding,
        account_id: old.account_id,
        workspace_id: old.workspace_id,
        device_id: old.device_id,
        account_security_epoch: old.account_security_epoch,
        issued_at: old.issued_at,
        maximum_lease_epoch: old.maximum_lease_epoch,
        last_active_lease_epoch: old.last_active_lease_epoch,
        standby_lease_epoch_floor: old.standby_lease_epoch_floor,
        commercial: old.commercial.map(|old| CommercialAuthorizationFloor {
            revision: old.revision,
            digest: old.digest,
            expires_at: old.expires_at,
            capabilities: vec!["cloudflare:dns:observe".to_owned()],
        }),
    };
    record.validate()?;
    Ok(record)
}

#[cfg(any(unix, windows))]
pub(super) fn decode_persisted_record(
    bytes: &[u8],
) -> Result<WorkspaceAuthorizationRecord, DesktopCustodyError> {
    let value: serde_json::Value =
        serde_json::from_slice(bytes).map_err(|_| DesktopCustodyError::Rejected)?;
    let record = if value
        .get("schemaVersion")
        .and_then(serde_json::Value::as_u64)
        == Some(4)
    {
        serde_json::from_slice(bytes).map_err(|_| DesktopCustodyError::Rejected)?
    } else {
        WorkspaceAuthorizationRecord {
            schema_version: 4,
            floor: decode_persisted_floor(bytes)?,
            device_evidence_floor: None,
            execution_anchor: None,
        }
    };
    record.validate()?;
    Ok(record)
}

#[cfg(unix)]
impl DesktopProductionCustody {
    pub(crate) fn load_authorization_floor(
        &self,
    ) -> Result<Option<WorkspaceAuthorizationFloor>, DesktopCustodyError> {
        Ok(self.load_authorization_record()?.map(|record| record.floor))
    }
    pub(crate) fn store_authorization_floor(
        &self,
        floor: &WorkspaceAuthorizationFloor,
    ) -> Result<(), DesktopCustodyError> {
        let old = self.load_authorization_record()?;
        // A role publication cannot carry an old execution anchor across a new authority generation.
        self.store_authorization_record(&WorkspaceAuthorizationRecord {
            schema_version: 4,
            floor: floor.clone(),
            device_evidence_floor: old.and_then(|record| record.device_evidence_floor),
            execution_anchor: None,
        })
    }
    pub(crate) fn load_authorization_record(
        &self,
    ) -> Result<Option<WorkspaceAuthorizationRecord>, DesktopCustodyError> {
        #[cfg(not(test))]
        let bytes = super::load_native(SERVICE, ACCOUNT)?;
        #[cfg(test)]
        let bytes = self
            .rebootstrap_test_store
            .authorization_floor
            .lock()
            .map_err(|_| DesktopCustodyError::StorageRejected)?
            .clone();
        let marker = self.load_authorization_marker()?;
        // Two independent Native items distinguish first admission from a lost floor. Neither is
        // part of business backup. Missing either after establishment fails closed, including a
        // crash between marker persistence and the first floor write.
        match (&bytes, &marker) {
            (None, None) => return Ok(None),
            (Some(_), Some(value)) if *value == self.installation_binding_digest()? => {}
            _ => return Err(DesktopCustodyError::Rejected),
        }
        let bytes = bytes.ok_or(DesktopCustodyError::Rejected)?;
        if bytes.is_empty() || bytes.len() > MAX_BYTES {
            return Err(DesktopCustodyError::Rejected);
        }
        let record = decode_persisted_record(&bytes)?;
        record.validate()?;
        if record.floor.installation_binding != self.installation_binding_digest()?
            || record.floor.device_id != self.load_device_id()?
        {
            return Err(DesktopCustodyError::Rejected);
        }
        Ok(Some(record))
    }

    #[cfg_attr(
        not(test),
        expect(
            clippy::unused_self,
            reason = "test custody is per installation; production uses the Native store under its process lock"
        )
    )]
    fn load_authorization_marker(&self) -> Result<Option<[u8; 32]>, DesktopCustodyError> {
        #[cfg(not(test))]
        let bytes = super::load_native(SERVICE, MARKER_ACCOUNT)?;
        #[cfg(test)]
        let bytes = self
            .rebootstrap_test_store
            .authorization_floor_marker
            .lock()
            .map_err(|_| DesktopCustodyError::StorageRejected)?
            .clone();
        bytes
            .map(|value| value.try_into().map_err(|_| DesktopCustodyError::Rejected))
            .transpose()
    }

    pub(crate) fn store_authorization_record(
        &self,
        record: &WorkspaceAuthorizationRecord,
    ) -> Result<(), DesktopCustodyError> {
        record.validate()?;
        if record.floor.installation_binding != self.installation_binding_digest()?
            || record.floor.device_id != self.load_device_id()?
        {
            return Err(DesktopCustodyError::Rejected);
        }
        let bytes = serde_json::to_vec(record).map_err(|_| DesktopCustodyError::Rejected)?;
        if bytes.len() > MAX_BYTES {
            return Err(DesktopCustodyError::Rejected);
        }
        // Validate the previous pair before changing either item; never repair a missing floor
        // by treating an untrusted new wire as the installation's first admission.
        self.load_authorization_record()?;
        let marker = self.installation_binding_digest()?;
        #[cfg(not(test))]
        super::store_native(SERVICE, MARKER_ACCOUNT, &marker)?;
        #[cfg(test)]
        {
            *self
                .rebootstrap_test_store
                .authorization_floor_marker
                .lock()
                .map_err(|_| DesktopCustodyError::StorageRejected)? = Some(marker.to_vec());
        }
        if self.load_authorization_marker()? != Some(marker) {
            return Err(DesktopCustodyError::StorageRejected);
        }
        #[cfg(not(test))]
        super::store_native(SERVICE, ACCOUNT, &bytes)?;
        #[cfg(test)]
        {
            *self
                .rebootstrap_test_store
                .authorization_floor
                .lock()
                .map_err(|_| DesktopCustodyError::StorageRejected)? = Some(bytes);
        }
        if self.load_authorization_record()?.as_ref() != Some(record) {
            return Err(DesktopCustodyError::StorageRejected);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn active(epoch: u64) -> WorkspaceAuthorizationFloor {
        WorkspaceAuthorizationFloor {
            schema_version: 3,
            installation_binding: [1; 32],
            account_id: "account-a".into(),
            workspace_id: "workspace-a".into(),
            device_id: "device-a".into(),
            account_security_epoch: 2,
            issued_at: 1_795_000_000,
            maximum_lease_epoch: epoch,
            last_active_lease_epoch: Some(epoch),
            standby_lease_epoch_floor: None,
            commercial: Some(CommercialAuthorizationFloor {
                revision: 3,
                digest: "ab".repeat(32),
                expires_at: "2099-12-31T23:59:59Z".into(),
                capabilities: vec!["cloudflare:dns:observe".to_owned()],
            }),
        }
    }
    fn standby(epoch: u64) -> WorkspaceAuthorizationFloor {
        WorkspaceAuthorizationFloor {
            standby_lease_epoch_floor: Some(epoch),
            last_active_lease_epoch: None,
            commercial: None,
            ..active(epoch)
        }
    }

    #[test]
    fn standby_preserves_commercial_floor_and_requires_a_strictly_new_active_epoch() {
        let initial = active(7);
        let demoted = standby(7).advance(Some(&initial)).unwrap();
        assert!(demoted.commercial == initial.commercial);
        assert!(active(7).advance(Some(&demoted)).is_err());
        let promoted = active(8).advance(Some(&demoted)).unwrap();
        assert_eq!(promoted.standby_lease_epoch_floor, Some(7));
        assert!(standby(7).advance(Some(&promoted)).is_err());
        assert!(active(8).advance(Some(&promoted)).is_ok());
        let mut rollback = active(8);
        rollback.commercial.as_mut().unwrap().revision = 2;
        assert!(rollback.advance(Some(&demoted)).is_err());
        let mut equivocation = active(8);
        equivocation.commercial.as_mut().unwrap().digest = "cd".repeat(32);
        assert!(equivocation.advance(Some(&demoted)).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn legacy_native_floor_preserves_replay_protection_without_guessing_last_local_active() {
        let mut legacy = serde_json::to_value(active(7)).unwrap();
        legacy["schemaVersion"] = serde_json::json!(1);
        legacy["commercial"]
            .as_object_mut()
            .unwrap()
            .remove("capabilities");
        legacy
            .as_object_mut()
            .unwrap()
            .remove("lastActiveLeaseEpoch");
        let migrated = decode_persisted_floor(&serde_json::to_vec(&legacy).unwrap()).unwrap();
        assert_eq!(migrated.maximum_lease_epoch, 7);
        assert_eq!(migrated.last_active_lease_epoch, None);
        let demoted = standby(10).advance(Some(&migrated)).unwrap();
        assert_eq!(demoted.last_active_lease_epoch, None);
        let promoted = active(11).advance(Some(&demoted)).unwrap();
        assert_eq!(promoted.last_active_lease_epoch, Some(11));
        let later = standby(20).advance(Some(&promoted)).unwrap();
        assert_eq!(later.last_active_lease_epoch, Some(11));
        assert_eq!(later.maximum_lease_epoch, 20);
        // Missing the new required key in version 2 is corruption, never a legacy upgrade.
        legacy["schemaVersion"] = serde_json::json!(2);
        assert!(decode_persisted_floor(&serde_json::to_vec(&legacy).unwrap()).is_err());
    }

    #[test]
    fn commercial_permissions_can_change_only_with_new_revision_and_digest() {
        let old = active(7);
        let mut changed = active(8);
        changed.commercial.as_mut().unwrap().capabilities =
            vec!["afternic:marketplace:observe".into()];
        assert!(changed.clone().advance(Some(&old)).is_err());
        changed.commercial.as_mut().unwrap().revision += 1;
        assert!(changed.clone().advance(Some(&old)).is_err());
        changed.commercial.as_mut().unwrap().digest = "cd".repeat(32);
        let added = changed.advance(Some(&old)).unwrap();
        let mut revoked = added.clone();
        let commercial = revoked.commercial.as_mut().unwrap();
        commercial.revision += 1;
        commercial.digest = "ef".repeat(32);
        commercial.capabilities.clear();
        assert!(revoked.advance(Some(&added)).is_ok());
        for capabilities in [
            vec!["unknown".into()],
            vec!["afternic:marketplace:write".into()],
            vec![
                "cloudflare:dns:observe".into(),
                "cloudflare:dns:observe".into(),
            ],
        ] {
            let mut invalid = active(7);
            invalid.commercial.as_mut().unwrap().capabilities = capabilities;
            assert!(invalid.validate().is_err());
        }
    }

    #[cfg(unix)]
    #[test]
    fn v2_floor_preserves_last_active_and_only_maps_historical_cloudflare() {
        let mut legacy = serde_json::to_value(active(7)).unwrap();
        legacy["schemaVersion"] = serde_json::json!(2);
        legacy["commercial"]
            .as_object_mut()
            .unwrap()
            .remove("capabilities");
        let upgraded = decode_persisted_floor(&serde_json::to_vec(&legacy).unwrap()).unwrap();
        assert_eq!(upgraded.schema_version, 3);
        assert_eq!(upgraded.last_active_lease_epoch, Some(7));
        assert_eq!(
            upgraded.commercial.unwrap().capabilities,
            ["cloudflare:dns:observe"]
        );
        legacy["commercial"]["capabilities"] = serde_json::json!(["afternic:marketplace:observe"]);
        assert!(decode_persisted_floor(&serde_json::to_vec(&legacy).unwrap()).is_err());
        legacy["schemaVersion"] = serde_json::json!(3);
        assert!(decode_persisted_floor(&serde_json::to_vec(&legacy).unwrap()).is_ok());
        legacy["commercial"]
            .as_object_mut()
            .unwrap()
            .remove("capabilities");
        assert!(decode_persisted_floor(&serde_json::to_vec(&legacy).unwrap()).is_err());
    }

    #[test]
    fn zero_floor_standby_and_exact_pending_target_promotion_are_valid() {
        let fresh = standby(0).advance(None).unwrap();
        assert!(active(1).advance(Some(&fresh)).is_ok());
        // Cloud may reserve epoch 9 for this exact target and issue floor 8 during bootstrap.
        let pending_target = standby(8).advance(Some(&standby(7))).unwrap();
        assert!(active(9).advance(Some(&pending_target)).is_ok());
        assert!(active(8).advance(Some(&pending_target)).is_err());
    }

    #[test]
    fn rejects_identity_security_time_and_record_rollback() {
        let old = active(7);
        let mut candidates = Vec::new();
        let mut value = standby(8);
        value.account_id = "account-b".into();
        candidates.push(value);
        let mut value = standby(8);
        value.workspace_id = "workspace-b".into();
        candidates.push(value);
        let mut value = standby(8);
        value.device_id = "device-b".into();
        candidates.push(value);
        let mut value = standby(8);
        value.installation_binding = [2; 32];
        candidates.push(value);
        let mut value = standby(8);
        value.account_security_epoch = 1;
        candidates.push(value);
        let mut value = standby(8);
        value.issued_at -= 1;
        candidates.push(value);
        let mut value = standby(8);
        value.standby_lease_epoch_floor = Some(9);
        candidates.push(value);
        let mut value = active(8);
        value.commercial.as_mut().unwrap().expires_at = "2099-02-31T23:59:59Z".into();
        candidates.push(value);
        for candidate in candidates {
            assert!(candidate.advance(Some(&old)).is_err());
        }
        let mut json = serde_json::to_value(&old).unwrap();
        json["role"] = serde_json::json!("active");
        assert!(serde_json::from_value::<WorkspaceAuthorizationFloor>(json).is_err());
    }
    #[test]
    fn persisted_optional_floors_require_explicit_keys() {
        for key in [
            "standbyLeaseEpochFloor",
            "commercial",
            "lastActiveLeaseEpoch",
        ] {
            let mut value = serde_json::to_value(active(7)).unwrap();
            value.as_object_mut().unwrap().remove(key);
            assert!(serde_json::from_value::<WorkspaceAuthorizationFloor>(value).is_err());
        }
        let mut empty = active(7);
        empty.commercial = None;
        assert!(empty.validate().is_err());
    }

    #[cfg(unix)]
    #[test]
    fn native_floor_survives_reopen_and_refuses_missing_or_corrupt_items() {
        for corrupt in [
            "floor_missing",
            "marker_missing",
            "floor_malformed",
            "marker_malformed",
        ] {
            let parent = crate::test_tempdir::tempdir().unwrap();
            let path = parent.path().canonicalize().unwrap().join("GoodDealer");
            let root = crate::DesktopApplicationRoot::validate(&path).unwrap();
            let store = super::super::TestRebootstrapKeyStore::default();
            let custody = DesktopProductionCustody::load_or_create_for_rebootstrap_test_with_store(
                &root,
                store.clone(),
            )
            .unwrap();
            assert!(custody.load_authorization_floor().unwrap().is_none());
            let mut record = standby(7);
            record.device_id = custody.load_device_id().unwrap();
            record.installation_binding = custody.installation_binding_digest().unwrap();
            custody.store_authorization_floor(&record).unwrap();
            drop(custody);
            let custody = DesktopProductionCustody::load_or_create_for_rebootstrap_test_with_store(
                &root,
                store.clone(),
            )
            .unwrap();
            assert!(custody.load_authorization_floor().unwrap().as_ref() == Some(&record));
            match corrupt {
                "floor_missing" => *store.authorization_floor.lock().unwrap() = None,
                "marker_missing" => *store.authorization_floor_marker.lock().unwrap() = None,
                "floor_malformed" => {
                    *store.authorization_floor.lock().unwrap() = Some(b"{}".to_vec());
                }
                _ => *store.authorization_floor_marker.lock().unwrap() = Some(vec![0; 32]),
            }
            assert!(custody.load_authorization_floor().is_err());
            assert!(custody.store_authorization_floor(&record).is_err());
        }
    }

    #[cfg(unix)]
    #[test]
    fn v4_combines_floor_and_anchor_and_never_synthesizes_legacy_evidence() {
        let floor = active(7);
        let old = serde_json::to_vec(&floor).unwrap();
        let migrated = decode_persisted_record(&old).unwrap();
        assert!(migrated.floor == floor);
        assert!(migrated.device_evidence_floor.is_none());
        assert!(migrated.execution_anchor.is_none());
        let bytes = serde_json::to_vec(&migrated).unwrap();
        assert!(decode_persisted_record(&bytes).unwrap() == migrated);
        for field in ["floor", "deviceEvidenceFloor", "executionAnchor"] {
            let mut value = serde_json::to_value(&migrated).unwrap();
            value.as_object_mut().unwrap().remove(field);
            assert!(decode_persisted_record(&serde_json::to_vec(&value).unwrap()).is_err());
        }
        let duplicated = String::from_utf8(bytes).unwrap().replacen(
            "\"executionAnchor\":null",
            "\"executionAnchor\":null,\"executionAnchor\":null",
            1,
        );
        assert!(decode_persisted_record(duplicated.as_bytes()).is_err());
        let mut malformed = migrated.clone();
        malformed.device_evidence_floor = Some(DeviceEvidenceFloor {
            credential_epoch: 0,
            signing_key_id: "key".into(),
            signing_key_version: 1,
        });
        assert!(malformed.validate().is_err());
        let mut downgrade = serde_json::to_value(&migrated).unwrap();
        downgrade["schemaVersion"] = serde_json::json!(3);
        assert!(decode_persisted_record(&serde_json::to_vec(&downgrade).unwrap()).is_err());
    }
}
