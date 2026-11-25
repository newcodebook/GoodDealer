//! Device-directory wire validation and the non-authoritative settings projection.

use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DeviceDirectoryRejected;

#[derive(Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum Platform {
    Windows,
    Macos,
    Linux,
    Ios,
    Android,
}
#[derive(Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum BindingStatus {
    Bound,
    Removed,
}
#[derive(Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum Role {
    Active,
    Standby,
    None,
}
#[derive(Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum KeyStatus {
    Active,
    Rotated,
    Revoked,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DirectoryWire {
    schema_version: u8,
    list_revision: u64,
    devices: Vec<DeviceWire>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DeviceWire {
    schema_version: u8,
    device_id: String,
    #[serde(deserialize_with = "required_nullable")]
    platform: Option<Platform>,
    #[serde(deserialize_with = "required_nullable")]
    display_name: Option<String>,
    status: BindingStatus,
    role: Role,
    credential_epoch: u64,
    signing_key_id: String,
    signing_key_version: u64,
    signing_key_status: KeyStatus,
    bound_at: String,
    #[serde(deserialize_with = "required_nullable")]
    last_seen_at: Option<String>,
    #[serde(deserialize_with = "required_nullable")]
    removed_at: Option<String>,
    current_device: bool,
}

fn required_nullable<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer)
}

/// Display only. Signing metadata and credential epochs never leave Native.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopDeviceDirectory {
    schema_version: u8,
    list_revision: u64,
    devices: Vec<DeviceDisplay>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DeviceDisplay {
    device_id: String,
    platform: Option<Platform>,
    display_name: Option<String>,
    status: BindingStatus,
    role: Role,
    current_device: bool,
    last_seen_at: Option<String>,
}

/// Validates Cloud's full v1 response and binds its current device to Native's admitted identity.
///
/// # Errors
/// Rejects malformed, inconsistent, oversized or wrong-device responses without retaining wire text.
pub fn parse_desktop_device_directory(
    wire: &[u8],
    expected_device_id: &str,
) -> Result<DesktopDeviceDirectory, DeviceDirectoryRejected> {
    if wire.is_empty() || wire.len() > 16_384 || !identifier(expected_device_id) {
        return Err(DeviceDirectoryRejected);
    }
    let directory: DirectoryWire =
        serde_json::from_slice(wire).map_err(|_| DeviceDirectoryRejected)?;
    if directory.schema_version != 1
        || !positive(directory.list_revision)
        || directory.devices.is_empty()
        || directory.devices.len() > 8
    {
        return Err(DeviceDirectoryRejected);
    }
    let mut ids = BTreeSet::new();
    let (mut current, mut active, mut bound) = (0, 0, 0);
    for device in &directory.devices {
        current += usize::from(device.current_device);
        active += usize::from(device.role == Role::Active);
        bound += usize::from(device.status == BindingStatus::Bound);
        if device.schema_version != 1
            || !identifier(&device.device_id)
            || !ids.insert(&device.device_id)
            || !identifier(&device.signing_key_id)
            || !positive(device.credential_epoch)
            || !positive(device.signing_key_version)
            || device
                .display_name
                .as_ref()
                .is_some_and(|name| !display_name(name))
            || device.platform.is_some() != device.display_name.is_some()
            || !timestamp(&device.bound_at)
            || device.last_seen_at.as_ref().is_some_and(|at| {
                !timestamp(at)
                    || &at[14..] != "00:00Z"
                    || at.as_str() < format!("{}:00:00Z", &device.bound_at[..13]).as_str()
            })
            || device
                .removed_at
                .as_ref()
                .is_some_and(|at| !timestamp(at) || at < &device.bound_at)
            || (device.status == BindingStatus::Removed) != device.removed_at.is_some()
            || (device.status == BindingStatus::Removed
                && (device.role != Role::None || device.current_device))
            || (device.signing_key_status != KeyStatus::Active && device.role != Role::None)
            || (device.current_device
                && (device.device_id != expected_device_id || device.role == Role::None))
        {
            return Err(DeviceDirectoryRejected);
        }
    }
    if current != 1 || active > 1 || bound > 2 {
        return Err(DeviceDirectoryRejected);
    }
    Ok(DesktopDeviceDirectory {
        schema_version: 1,
        list_revision: directory.list_revision,
        devices: directory
            .devices
            .into_iter()
            .map(|device| DeviceDisplay {
                device_id: device.device_id,
                platform: device.platform,
                display_name: device.display_name,
                status: device.status,
                role: device.role,
                current_device: device.current_device,
                last_seen_at: device.last_seen_at,
            })
            .collect(),
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SelfNameIntent {
    schema_version: u8,
    display_name: String,
}

/// Builds a self-report from a bounded name intent; the Renderer cannot choose platform or device.
///
/// # Errors
/// Rejects invalid names, extra selectors, oversized requests and unsupported build targets.
pub fn prepare_desktop_device_self_report(wire: &[u8]) -> Result<Vec<u8>, DeviceDirectoryRejected> {
    if wire.is_empty() || wire.len() > 1024 {
        return Err(DeviceDirectoryRejected);
    }
    let intent: SelfNameIntent =
        serde_json::from_slice(wire).map_err(|_| DeviceDirectoryRejected)?;
    if intent.schema_version != 1 || !display_name(&intent.display_name) {
        return Err(DeviceDirectoryRejected);
    }
    let platform = if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else {
        return Err(DeviceDirectoryRejected);
    };
    serde_json::to_vec(&serde_json::json!({"schemaVersion":1,"platform":platform,"displayName":intent.display_name})).map_err(|_| DeviceDirectoryRejected)
}

fn positive(value: u64) -> bool {
    (1..=MAX_SAFE_INTEGER).contains(&value)
}
fn identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 160
        && value.bytes().all(|byte| (0x21..=0x7e).contains(&byte))
}
fn display_name(value: &str) -> bool {
    !value.is_empty() && value.chars().count() <= 64 && value.trim() == value
        && !value.chars().any(|c| c.is_control() || matches!(c as u32,
            0x00ad | 0x0600..=0x0605 | 0x061c | 0x06dd | 0x070f | 0x0890..=0x0891 | 0x08e2 | 0x180e | 0x200b..=0x200f | 0x202a..=0x202e | 0x2060..=0x2064 | 0x2066..=0x206f | 0xfeff | 0xfff9..=0xfffb | 0x110bd | 0x110cd | 0x13430..=0x1343f | 0x1bca0..=0x1bca3 | 0x1d173..=0x1d17a | 0xe0001 | 0xe0020..=0xe007f))
}

fn timestamp(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 20
        || bytes[19] != b'Z'
        || bytes[4] != b'-'
        || bytes[7] != b'-'
        || bytes[10] != b'T'
        || bytes[13] != b':'
        || bytes[16] != b':'
        || !bytes[..19]
            .iter()
            .enumerate()
            .all(|(index, byte)| matches!(index, 4 | 7 | 10 | 13 | 16) || byte.is_ascii_digit())
    {
        return false;
    }
    let parse = |start: usize, end: usize| {
        std::str::from_utf8(&bytes[start..end])
            .ok()?
            .parse::<u32>()
            .ok()
    };
    let (Some(year), Some(month), Some(day), Some(hour), Some(minute), Some(second)) = (
        parse(0, 4),
        parse(5, 7),
        parse(8, 10),
        parse(11, 13),
        parse(14, 16),
        parse(17, 19),
    ) else {
        return false;
    };
    let leap_year =
        year.is_multiple_of(4) && (!year.is_multiple_of(100) || year.is_multiple_of(400));
    let last_day = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap_year => 29,
        2 => 28,
        _ => return false,
    };
    (1..=last_day).contains(&day) && hour < 24 && minute < 60 && second < 60
}

#[cfg(test)]
mod tests {
    use super::*;
    const LIST: &[u8] = include_bytes!(
        "../../../packages/protocol/test-vectors/device-management/valid/binding-list-two-bound.json"
    );

    #[test]
    fn shared_contract_projects_only_display_metadata() {
        let view = parse_desktop_device_directory(LIST, "device-1").unwrap();
        let value = serde_json::to_value(view).unwrap();
        assert_eq!(value["devices"][0]["displayName"], "Sean's Mac");
        assert_eq!(value["devices"][1]["platform"], "windows");
        let text = value.to_string();
        for field in [
            "signingKey",
            "credentialEpoch",
            "boundAt",
            "removedAt",
            "lease",
            "signature",
        ] {
            assert!(!text.contains(field));
        }
        assert!(parse_desktop_device_directory(LIST, "another-device").is_err());
    }

    #[test]
    fn rejects_protocol_negative_vectors_and_inconsistent_identity() {
        let directory = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../packages/protocol/test-vectors/device-management/invalid");
        for entry in std::fs::read_dir(directory).unwrap() {
            let entry = entry.unwrap();
            let file = entry.file_name();
            if !file.to_str().unwrap().starts_with("binding-") {
                continue;
            }
            let bytes = std::fs::read(entry.path()).unwrap();
            let value: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
            let list = if value.get("devices").is_some() {
                value
            } else {
                serde_json::json!({"schemaVersion":1,"listRevision":1,"devices":[value]})
            };
            assert!(
                parse_desktop_device_directory(&serde_json::to_vec(&list).unwrap(), "device-1")
                    .is_err(),
                "{}",
                file.to_string_lossy()
            );
        }
        let base: serde_json::Value = serde_json::from_slice(LIST).unwrap();
        for (field, value) in [
            ("signingKeyStatus", serde_json::json!("rotated")),
            ("lastSeenAt", serde_json::json!("2026-02-30T11:00:00Z")),
            ("currentDevice", serde_json::json!(false)),
            ("displayName", serde_json::json!("\u{200b}secret")),
        ] {
            let mut changed = base.clone();
            changed["devices"][0][field] = value;
            assert!(
                parse_desktop_device_directory(&serde_json::to_vec(&changed).unwrap(), "device-1")
                    .is_err()
            );
        }
        let mut missing = base;
        missing["devices"][0]
            .as_object_mut()
            .unwrap()
            .remove("removedAt");
        assert!(
            parse_desktop_device_directory(&serde_json::to_vec(&missing).unwrap(), "device-1")
                .is_err()
        );
        let duplicate = String::from_utf8(LIST.to_vec()).unwrap().replacen(
            "\"listRevision\": 4",
            "\"listRevision\":4,\"listRevision\":5",
            1,
        );
        assert!(parse_desktop_device_directory(duplicate.as_bytes(), "device-1").is_err());
        assert!(parse_desktop_device_directory(&vec![b' '; 16_385], "device-1").is_err());
    }

    #[test]
    fn name_intent_is_strict_bounded_and_platform_is_native() {
        for name in ["Desk", "办公室", "é", &"😀".repeat(64)] {
            let body = prepare_desktop_device_self_report(
                &serde_json::to_vec(&serde_json::json!({"schemaVersion":1,"displayName":name}))
                    .unwrap(),
            )
            .unwrap();
            let value: serde_json::Value = serde_json::from_slice(&body).unwrap();
            assert_eq!(value["displayName"], name);
            assert!(matches!(
                value["platform"].as_str(),
                Some("linux" | "macos" | "windows")
            ));
            assert!(value.get("deviceId").is_none());
        }
        for name in [
            "",
            " a",
            "a ",
            "a\nb",
            "a\u{061c}b",
            "a\u{e0020}b",
            &"😀".repeat(65),
        ] {
            assert!(
                prepare_desktop_device_self_report(
                    &serde_json::to_vec(&serde_json::json!({"schemaVersion":1,"displayName":name}))
                        .unwrap()
                )
                .is_err()
            );
        }
        for wire in [
            br#"{"schemaVersion":1,"displayName":"x","platform":"windows"}"#.as_slice(),
            br#"{"schemaVersion":1,"displayName":"x","deviceId":"other"}"#,
            br#"{"schemaVersion":1,"displayName":"x","displayName":"y"}"#,
        ] {
            assert!(prepare_desktop_device_self_report(wire).is_err());
        }
    }
}
