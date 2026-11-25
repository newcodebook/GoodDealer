//! Exact Windows `SQLCipher` initialization record and crash admission decisions.
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use serde::{Deserialize, Serialize};
use zeroize::{Zeroize as _, Zeroizing};
#[derive(Debug)]
pub(super) struct Rejected;
#[derive(Debug, PartialEq, Eq)]
pub(super) enum BoundFileAction {
    TruncateMarker,
    OpenDatabase,
}
const DATABASE_INIT_MAGIC: &[u8] = b"GOODDEALER/WINDOWS-DATABASE-INITIALIZING-V1\0";
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct DatabaseKeyRecord {
    pub(super) schema_version: u8,
    pub(super) root_volume: u64,
    pub(super) root_index: u64,
    pub(super) initialization: [u8; 32],
    pub(super) key: String,
    #[serde(deserialize_with = "required_option")]
    pub(super) file_volume: Option<u64>,
    #[serde(deserialize_with = "required_option")]
    pub(super) file_index: Option<u64>,
    pub(super) database_initialized: bool,
}
impl Drop for DatabaseKeyRecord {
    fn drop(&mut self) {
        self.key.zeroize();
    }
}

impl DatabaseKeyRecord {
    pub(super) fn decode(bytes: &[u8]) -> Result<Self, Rejected> {
        if bytes.len() > 1024 {
            return Err(Rejected);
        }
        let record: Self = serde_json::from_slice(bytes).map_err(|_| Rejected)?;
        record.validate(record.root_volume, record.root_index)?;
        Ok(record)
    }
    pub(super) fn key_bytes(&self) -> Result<Zeroizing<[u8; 32]>, Rejected> {
        let bytes = Zeroizing::new(URL_SAFE_NO_PAD.decode(&self.key).map_err(|_| Rejected)?);
        if URL_SAFE_NO_PAD.encode(&bytes) != self.key {
            return Err(Rejected);
        }
        Ok(Zeroizing::new(
            bytes.as_slice().try_into().map_err(|_| Rejected)?,
        ))
    }
    pub(super) fn validate(&self, root_volume: u64, root_index: u64) -> Result<(), Rejected> {
        if self.schema_version != 1
            || root_volume == 0
            || root_index == 0
            || self.root_volume != root_volume
            || self.root_index != root_index
            || self.initialization == [0; 32]
            || self.file_volume.is_some() != self.file_index.is_some()
            || self.file_volume == Some(0)
            || self.file_index == Some(0)
            || (self.database_initialized && self.file_index.is_none())
        {
            return Err(Rejected);
        }
        self.key_bytes()?;
        Ok(())
    }
    pub(super) fn marker(&self) -> Vec<u8> {
        [DATABASE_INIT_MAGIC, self.initialization.as_slice()].concat()
    }
    pub(super) fn admit_unbound_marker(&self, bytes: &[u8]) -> Result<(), Rejected> {
        if self.database_initialized
            || self.file_index.is_some()
            || !self.marker().starts_with(bytes)
        {
            return Err(Rejected);
        }
        Ok(())
    }
    pub(super) fn bound_action(
        &self,
        volume: u64,
        index: u64,
        length: u64,
        prefix: &[u8],
    ) -> Result<BoundFileAction, Rejected> {
        if self.file_volume != Some(volume) || self.file_index != Some(index) {
            return Err(Rejected);
        }
        if self.database_initialized {
            return if length >= 4096 {
                Ok(BoundFileAction::OpenDatabase)
            } else {
                Err(Rejected)
            };
        }
        if length == 0 || length >= 4096 {
            return Ok(BoundFileAction::OpenDatabase);
        }
        let marker = self.marker();
        if length == marker.len() as u64 && prefix == marker {
            Ok(BoundFileAction::TruncateMarker)
        } else {
            Err(Rejected)
        }
    }
}
fn required_option<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn pending() -> DatabaseKeyRecord {
        DatabaseKeyRecord {
            schema_version: 1,
            root_volume: 11,
            root_index: 12,
            initialization: [13; 32],
            key: URL_SAFE_NO_PAD.encode([14; 32]),
            file_volume: None,
            file_index: None,
            database_initialized: false,
        }
    }
    fn roundtrip(record: &DatabaseKeyRecord) -> DatabaseKeyRecord {
        DatabaseKeyRecord::decode(&serde_json::to_vec(record).unwrap()).unwrap()
    }
    #[test]
    fn resumes_every_marker_write_crash_then_only_bound_file_can_initialize() {
        let record = roundtrip(&pending());
        let marker = record.marker();
        for split in 0..=marker.len() {
            assert!(record.admit_unbound_marker(&marker[..split]).is_ok());
        }
        let mut bound = roundtrip(&record);
        bound.file_volume = Some(21);
        bound.file_index = Some(22);
        let bound = roundtrip(&bound);
        assert!(bound.admit_unbound_marker(&marker).is_err());
        assert_eq!(
            bound
                .bound_action(21, 22, marker.len() as u64, &marker)
                .unwrap(),
            BoundFileAction::TruncateMarker
        );
        // Crash after truncation, during creation, or after SQLCipher commit before vault commit.
        assert_eq!(
            bound.bound_action(21, 22, 0, &[]).unwrap(),
            BoundFileAction::OpenDatabase
        );
        assert!(bound.bound_action(21, 22, 100, &[1; 100]).is_err());
        assert_eq!(
            bound.bound_action(21, 22, 4096, &[1; 73]).unwrap(),
            BoundFileAction::OpenDatabase
        );
        assert!(bound.bound_action(21, 23, 0, &[]).is_err());
    }
    #[test]
    fn committed_database_loss_never_becomes_initialization() {
        let mut record = pending();
        record.file_volume = Some(21);
        record.file_index = Some(22);
        record.database_initialized = true;
        let record = roundtrip(&record);
        let marker = record.marker();
        for length in [0, 1, marker.len() as u64, 4095] {
            assert!(record.bound_action(21, 22, length, &marker).is_err());
        }
        assert!(record.admit_unbound_marker(&[]).is_err());
        assert!(record.bound_action(21, 23, 4096, &[]).is_err());
        assert_eq!(
            record.bound_action(21, 22, 4096, &[]).unwrap(),
            BoundFileAction::OpenDatabase
        );
    }
    #[test]
    fn refuses_foreign_or_appended_initialization_markers() {
        let record = pending();
        let marker = record.marker();
        for split in 1..=marker.len() {
            let mut corrupted = marker[..split].to_vec();
            corrupted[split - 1] ^= 1;
            assert!(record.admit_unbound_marker(&corrupted).is_err());
        }
        let mut appended = marker.clone();
        appended.push(0);
        assert!(record.admit_unbound_marker(&appended).is_err());
        let mut bound = roundtrip(&record);
        bound.file_volume = Some(21);
        bound.file_index = Some(22);
        let mut foreign = marker.clone();
        *foreign.last_mut().unwrap() ^= 1;
        assert!(
            bound
                .bound_action(21, 22, marker.len() as u64, &foreign)
                .is_err()
        );
    }
    #[test]
    fn record_is_closed_bounded_and_requires_nullable_identity_fields() {
        let valid = serde_json::to_value(pending()).unwrap();
        for field in [
            "fileVolume",
            "fileIndex",
            "databaseInitialized",
            "initialization",
            "key",
        ] {
            let mut value = valid.clone();
            value.as_object_mut().unwrap().remove(field);
            assert!(DatabaseKeyRecord::decode(&serde_json::to_vec(&value).unwrap()).is_err());
        }
        let mut unknown = valid.clone();
        unknown["unknown"] = serde_json::json!(1);
        assert!(DatabaseKeyRecord::decode(&serde_json::to_vec(&unknown).unwrap()).is_err());
        for (field, value) in [
            ("schemaVersion", serde_json::json!(2)),
            ("fileVolume", serde_json::json!(21)),
            ("databaseInitialized", serde_json::json!(true)),
            ("rootIndex", serde_json::json!(0)),
            ("key", serde_json::json!("bad")),
        ] {
            let mut invalid = valid.clone();
            invalid[field] = value;
            assert!(DatabaseKeyRecord::decode(&serde_json::to_vec(&invalid).unwrap()).is_err());
        }
        assert!(DatabaseKeyRecord::decode(&[b' '; 1025]).is_err());
        assert!(pending().validate(11, 99).is_err());
        assert!(pending().validate(99, 12).is_err());
        let mut zero_nonce = pending();
        zero_nonce.initialization = [0; 32];
        assert!(DatabaseKeyRecord::decode(&serde_json::to_vec(&zero_nonce).unwrap()).is_err());
    }
}
