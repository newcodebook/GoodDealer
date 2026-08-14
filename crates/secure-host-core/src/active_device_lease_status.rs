use serde::{Deserialize, Deserializer, Serialize};

use crate::wire_scalar::{
    SafeUnsignedInteger, canonical_utc_seconds, deserialize_required_option,
    is_canonical_utc_timestamp, is_identifier,
};

pub const ACTIVE_DEVICE_LEASE_STATUS_SCHEMA_VERSION: u64 = 1;
const MAX_OFFLINE_EXECUTION_SECONDS: i64 = 86_400;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LeaseRenewalState {
    Fresh,
    RenewalWindow,
    OfflineGrace,
    Expired,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveDeviceLeaseStatus {
    schema_version: u64,
    held: bool,
    device_id: Option<String>,
    lease_epoch: Option<u64>,
    issued_at: Option<String>,
    renew_after: Option<String>,
    online_expires_at: Option<String>,
    offline_execute_until: Option<String>,
    renewal_state: LeaseRenewalState,
    evaluated_at: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawActiveDeviceLeaseStatus {
    schema_version: SafeUnsignedInteger,
    held: bool,
    #[serde(deserialize_with = "deserialize_required_option")]
    device_id: Option<String>,
    #[serde(deserialize_with = "deserialize_required_option")]
    lease_epoch: Option<SafeUnsignedInteger>,
    #[serde(deserialize_with = "deserialize_required_option")]
    issued_at: Option<String>,
    #[serde(deserialize_with = "deserialize_required_option")]
    renew_after: Option<String>,
    #[serde(deserialize_with = "deserialize_required_option")]
    online_expires_at: Option<String>,
    #[serde(deserialize_with = "deserialize_required_option")]
    offline_execute_until: Option<String>,
    renewal_state: LeaseRenewalState,
    evaluated_at: String,
}

impl TryFrom<RawActiveDeviceLeaseStatus> for ActiveDeviceLeaseStatus {
    type Error = ();

    fn try_from(raw: RawActiveDeviceLeaseStatus) -> Result<Self, Self::Error> {
        let timestamps_are_valid = [
            &raw.issued_at,
            &raw.renew_after,
            &raw.online_expires_at,
            &raw.offline_execute_until,
        ]
        .into_iter()
        .all(|value| value.as_deref().is_none_or(is_canonical_utc_timestamp))
            && is_canonical_utc_timestamp(&raw.evaluated_at);
        let scalar_fields_are_valid = raw.device_id.as_deref().is_none_or(is_identifier)
            && raw.lease_epoch.is_none_or(|epoch| epoch.get() > 0);

        let lease_fields_are_null = raw.device_id.is_none()
            && raw.lease_epoch.is_none()
            && raw.issued_at.is_none()
            && raw.renew_after.is_none()
            && raw.online_expires_at.is_none()
            && raw.offline_execute_until.is_none();
        let unheld_is_valid =
            lease_fields_are_null && raw.renewal_state == LeaseRenewalState::Expired;

        let held_is_valid = match (
            raw.device_id.as_deref(),
            raw.lease_epoch,
            raw.issued_at.as_deref(),
            raw.renew_after.as_deref(),
            raw.online_expires_at.as_deref(),
            raw.offline_execute_until.as_deref(),
        ) {
            (Some(_), Some(_), Some(issued), Some(renew), Some(online), Some(offline)) => {
                let timestamps_are_ordered = issued < renew && renew < online && online <= offline;
                let offline_window_is_bounded = canonical_utc_seconds(offline)
                    .zip(canonical_utc_seconds(issued))
                    .is_some_and(|(offline_seconds, issued_seconds)| {
                        offline_seconds - issued_seconds <= MAX_OFFLINE_EXECUTION_SECONDS
                    });
                let expected_state = if raw.evaluated_at.as_str() < renew {
                    LeaseRenewalState::Fresh
                } else if raw.evaluated_at.as_str() < online {
                    LeaseRenewalState::RenewalWindow
                } else if raw.evaluated_at.as_str() < offline {
                    LeaseRenewalState::OfflineGrace
                } else {
                    LeaseRenewalState::Expired
                };
                timestamps_are_ordered
                    && offline_window_is_bounded
                    && raw.renewal_state == expected_state
            }
            _ => false,
        };

        if raw.schema_version.get() != ACTIVE_DEVICE_LEASE_STATUS_SCHEMA_VERSION
            || !timestamps_are_valid
            || !scalar_fields_are_valid
            || if raw.held {
                !held_is_valid
            } else {
                !unheld_is_valid
            }
        {
            return Err(());
        }

        Ok(Self {
            schema_version: raw.schema_version.get(),
            held: raw.held,
            device_id: raw.device_id,
            lease_epoch: raw.lease_epoch.map(SafeUnsignedInteger::get),
            issued_at: raw.issued_at,
            renew_after: raw.renew_after,
            online_expires_at: raw.online_expires_at,
            offline_execute_until: raw.offline_execute_until,
            renewal_state: raw.renewal_state,
            evaluated_at: raw.evaluated_at,
        })
    }
}

impl<'de> Deserialize<'de> for ActiveDeviceLeaseStatus {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        Self::try_from(RawActiveDeviceLeaseStatus::deserialize(deserializer)?)
            .map_err(|()| serde::de::Error::custom("invalid active device lease status"))
    }
}

impl ActiveDeviceLeaseStatus {
    #[must_use]
    pub const fn held(&self) -> bool {
        self.held
    }

    #[must_use]
    pub fn device_id(&self) -> Option<&str> {
        self.device_id.as_deref()
    }

    #[must_use]
    pub const fn lease_epoch(&self) -> Option<u64> {
        self.lease_epoch
    }

    #[must_use]
    pub fn issued_at(&self) -> Option<&str> {
        self.issued_at.as_deref()
    }

    #[must_use]
    pub fn renew_after(&self) -> Option<&str> {
        self.renew_after.as_deref()
    }

    #[must_use]
    pub fn online_expires_at(&self) -> Option<&str> {
        self.online_expires_at.as_deref()
    }

    #[must_use]
    pub fn offline_execute_until(&self) -> Option<&str> {
        self.offline_execute_until.as_deref()
    }

    #[must_use]
    pub const fn renewal_state(&self) -> LeaseRenewalState {
        self.renewal_state
    }

    #[must_use]
    pub fn evaluated_at(&self) -> &str {
        &self.evaluated_at
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ActiveDeviceLeaseStatusValidationError {
    InvalidJson,
    InvalidStatus,
}

/// Parses and semantically validates the strict Rust mirror of `ActiveDeviceLeaseStatus`.
///
/// # Errors
///
/// Returns [`ActiveDeviceLeaseStatusValidationError::InvalidJson`] for malformed or structurally
/// invalid wire data, and [`ActiveDeviceLeaseStatusValidationError::InvalidStatus`] for a
/// cross-field invariant violation.
pub fn validate_active_device_lease_status_json(
    source: &str,
) -> Result<ActiveDeviceLeaseStatus, ActiveDeviceLeaseStatusValidationError> {
    let raw: RawActiveDeviceLeaseStatus = serde_json::from_str(source)
        .map_err(|_| ActiveDeviceLeaseStatusValidationError::InvalidJson)?;
    ActiveDeviceLeaseStatus::try_from(raw)
        .map_err(|()| ActiveDeviceLeaseStatusValidationError::InvalidStatus)
}

#[cfg(test)]
mod tests {
    use super::{ActiveDeviceLeaseStatus, validate_active_device_lease_status_json};

    const VALID_VECTORS: [(&str, &str); 4] = [
        (
            "lease-status-held-fresh.json",
            include_str!(
                "../../../packages/protocol/test-vectors/device-management/valid/lease-status-held-fresh.json"
            ),
        ),
        (
            "lease-status-held-renewal-window.json",
            include_str!(
                "../../../packages/protocol/test-vectors/device-management/valid/lease-status-held-renewal-window.json"
            ),
        ),
        (
            "lease-status-held-offline-grace.json",
            include_str!(
                "../../../packages/protocol/test-vectors/device-management/valid/lease-status-held-offline-grace.json"
            ),
        ),
        (
            "lease-status-not-held.json",
            include_str!(
                "../../../packages/protocol/test-vectors/device-management/valid/lease-status-not-held.json"
            ),
        ),
    ];
    const INVALID_VECTORS: [(&str, &str); 8] = [
        (
            "lease-status-not-held-with-epoch.json",
            include_str!(
                "../../../packages/protocol/test-vectors/device-management/invalid/lease-status-not-held-with-epoch.json"
            ),
        ),
        (
            "lease-status-not-held-wrong-renewal-state.json",
            include_str!(
                "../../../packages/protocol/test-vectors/device-management/invalid/lease-status-not-held-wrong-renewal-state.json"
            ),
        ),
        (
            "lease-status-held-missing-epoch.json",
            include_str!(
                "../../../packages/protocol/test-vectors/device-management/invalid/lease-status-held-missing-epoch.json"
            ),
        ),
        (
            "lease-status-inverted-window.json",
            include_str!(
                "../../../packages/protocol/test-vectors/device-management/invalid/lease-status-inverted-window.json"
            ),
        ),
        (
            "lease-status-window-inverted-only.json",
            include_str!(
                "../../../packages/protocol/test-vectors/device-management/invalid/lease-status-window-inverted-only.json"
            ),
        ),
        (
            "lease-status-offline-window-too-long.json",
            include_str!(
                "../../../packages/protocol/test-vectors/device-management/invalid/lease-status-offline-window-too-long.json"
            ),
        ),
        (
            "lease-status-renewal-state-mismatch.json",
            include_str!(
                "../../../packages/protocol/test-vectors/device-management/invalid/lease-status-renewal-state-mismatch.json"
            ),
        ),
        (
            "lease-status-with-signature.json",
            include_str!(
                "../../../packages/protocol/test-vectors/device-management/invalid/lease-status-with-signature.json"
            ),
        ),
    ];

    #[test]
    fn mirrors_typescript_verdicts_per_shared_vector() {
        for (name, vector) in VALID_VECTORS {
            assert!(
                validate_active_device_lease_status_json(vector).is_ok(),
                "TypeScript accepts valid/{name}"
            );
            assert!(
                serde_json::from_str::<ActiveDeviceLeaseStatus>(vector).is_ok(),
                "Serde must preserve the fail-closed verdict for valid/{name}"
            );
        }
        for (name, vector) in INVALID_VECTORS {
            assert!(
                validate_active_device_lease_status_json(vector).is_err(),
                "TypeScript rejects invalid/{name}"
            );
            assert!(
                serde_json::from_str::<ActiveDeviceLeaseStatus>(vector).is_err(),
                "Serde must preserve the fail-closed verdict for invalid/{name}"
            );
        }
    }

    #[test]
    fn rejects_missing_required_nullable_fields() {
        let mut lease: serde_json::Value =
            serde_json::from_str(VALID_VECTORS[0].1).expect("shared vector is valid JSON");
        lease
            .as_object_mut()
            .expect("shared vector is an object")
            .remove("deviceId");
        assert!(serde_json::from_value::<ActiveDeviceLeaseStatus>(lease).is_err());
    }

    #[test]
    fn rejects_mutated_literal_enum_and_scalar_boundaries() {
        let mut lease: serde_json::Value =
            serde_json::from_str(VALID_VECTORS[0].1).expect("shared vector is valid JSON");
        lease["schemaVersion"] = serde_json::Value::from(2);
        assert!(serde_json::from_value::<ActiveDeviceLeaseStatus>(lease).is_err());

        let mut lease: serde_json::Value =
            serde_json::from_str(VALID_VECTORS[0].1).expect("shared vector is valid JSON");
        lease["renewalState"] = serde_json::Value::String("unknown".to_owned());
        assert!(serde_json::from_value::<ActiveDeviceLeaseStatus>(lease).is_err());

        let mut lease: serde_json::Value =
            serde_json::from_str(VALID_VECTORS[0].1).expect("shared vector is valid JSON");
        lease["deviceId"] = serde_json::Value::String(String::new());
        assert!(serde_json::from_value::<ActiveDeviceLeaseStatus>(lease).is_err());
    }
}
