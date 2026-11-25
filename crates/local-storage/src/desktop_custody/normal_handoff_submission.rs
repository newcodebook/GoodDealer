//! Native-only exact signed request custody. Business backups never include this slot.

use std::sync::Mutex;

use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use serde::{Deserialize, Serialize};
use zeroize::{Zeroize as _, Zeroizing};

use super::{DesktopCustodyError, DesktopProductionCustody};

const MAX_SUBMISSION_BYTES: usize = 65_536;
const MAX_ENVELOPE_BYTES: usize = 90_000;
#[cfg(not(test))]
const SERVICE: &str = "com.gooddealer.desktop.normal-handoff";
#[cfg(not(test))]
const ACCOUNT: &str = "pending-signed-submission-v1";
// The installation process lock excludes other processes. This lock makes comparison and
// replacement indivisible within the process, including callers racing with reconciliation.
static SUBMISSION_LOCK: Mutex<()> = Mutex::new(());

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SubmissionEnvelope {
    schema_version: u8,
    installation_binding: [u8; 32],
    device_id: String,
    request_id: String,
    submission: String,
}

impl Drop for SubmissionEnvelope {
    fn drop(&mut self) {
        self.submission.zeroize();
    }
}

fn validate_request_id(request_id: &str) -> Result<(), DesktopCustodyError> {
    if request_id.is_empty()
        || request_id.len() > 160
        || !request_id.bytes().all(|byte| (0x21..=0x7e).contains(&byte))
    {
        return Err(DesktopCustodyError::Rejected);
    }
    Ok(())
}

impl DesktopProductionCustody {
    /// Host proves this request is either an unsent orphan or terminal before calling. An
    /// unrelated pending request is never removed by cleanup of an older operation.
    pub(crate) fn clear_handoff_submission(
        &self,
        request_id: &str,
    ) -> Result<(), DesktopCustodyError> {
        validate_request_id(request_id)?;
        let _lock = SUBMISSION_LOCK
            .lock()
            .map_err(|_| DesktopCustodyError::StorageRejected)?;
        let Some(record) = self.load_handoff_envelope()? else {
            return Ok(());
        };
        if record.request_id != request_id {
            return Err(DesktopCustodyError::Rejected);
        }
        #[cfg(not(test))]
        super::delete_native(SERVICE, ACCOUNT)?;
        #[cfg(test)]
        {
            let previous = self
                .rebootstrap_test_store
                .normal_handoff_submission
                .lock()
                .map_err(|_| DesktopCustodyError::StorageRejected)?
                .take();
            drop(previous.map(Zeroizing::new));
        }
        if self.load_handoff_envelope()?.is_some() {
            return Err(DesktopCustodyError::StorageRejected);
        }
        Ok(())
    }

    /// Only Host may replace a different request after admitting its new drain barrier. For the
    /// same request, custody is immutable: retry must reuse the originally signed bytes.
    pub(crate) fn store_handoff_submission(
        &self,
        request_id: &str,
        submission: &[u8],
    ) -> Result<(), DesktopCustodyError> {
        validate_request_id(request_id)?;
        if submission.is_empty() || submission.len() > MAX_SUBMISSION_BYTES {
            return Err(DesktopCustodyError::Rejected);
        }
        let _lock = SUBMISSION_LOCK
            .lock()
            .map_err(|_| DesktopCustodyError::StorageRejected)?;
        if let Some(previous) = self.load_handoff_envelope()?
            && previous.request_id == request_id
        {
            let encoded = Zeroizing::new(URL_SAFE_NO_PAD.encode(submission));
            return if previous.submission == *encoded {
                Ok(())
            } else {
                Err(DesktopCustodyError::Rejected)
            };
        }
        let record = SubmissionEnvelope {
            schema_version: 1,
            installation_binding: self.installation_binding_digest()?,
            device_id: self.load_device_id()?,
            request_id: request_id.to_owned(),
            submission: URL_SAFE_NO_PAD.encode(submission),
        };
        let bytes =
            Zeroizing::new(serde_json::to_vec(&record).map_err(|_| DesktopCustodyError::Rejected)?);
        if bytes.len() > MAX_ENVELOPE_BYTES {
            return Err(DesktopCustodyError::Rejected);
        }
        #[cfg(not(test))]
        super::store_native(SERVICE, ACCOUNT, &bytes)?;
        #[cfg(test)]
        {
            *self
                .rebootstrap_test_store
                .normal_handoff_submission
                .lock()
                .map_err(|_| DesktopCustodyError::StorageRejected)? = Some(bytes.to_vec());
        }
        let readback = self
            .load_handoff_envelope()?
            .ok_or(DesktopCustodyError::StorageRejected)?;
        if readback.request_id != record.request_id || readback.submission != record.submission {
            return Err(DesktopCustodyError::StorageRejected);
        }
        Ok(())
    }

    pub(crate) fn load_handoff_submission(
        &self,
        request_id: &str,
    ) -> Result<Option<Vec<u8>>, DesktopCustodyError> {
        validate_request_id(request_id)?;
        let _lock = SUBMISSION_LOCK
            .lock()
            .map_err(|_| DesktopCustodyError::StorageRejected)?;
        let Some(record) = self.load_handoff_envelope()? else {
            return Ok(None);
        };
        if record.request_id != request_id {
            return Ok(None);
        }
        URL_SAFE_NO_PAD
            .decode(record.submission.as_bytes())
            .map(Some)
            .map_err(|_| DesktopCustodyError::Rejected)
    }

    fn load_handoff_envelope(&self) -> Result<Option<SubmissionEnvelope>, DesktopCustodyError> {
        #[cfg(not(test))]
        let bytes = super::load_native(SERVICE, ACCOUNT)?;
        #[cfg(test)]
        let bytes = self
            .rebootstrap_test_store
            .normal_handoff_submission
            .lock()
            .map_err(|_| DesktopCustodyError::StorageRejected)?
            .clone();
        let Some(bytes) = bytes.map(Zeroizing::new) else {
            return Ok(None);
        };
        if bytes.is_empty() || bytes.len() > MAX_ENVELOPE_BYTES {
            return Err(DesktopCustodyError::Rejected);
        }
        let record: SubmissionEnvelope =
            serde_json::from_slice(&bytes).map_err(|_| DesktopCustodyError::Rejected)?;
        validate_request_id(&record.request_id)?;
        if record.schema_version != 1
            || record.installation_binding != self.installation_binding_digest()?
            || record.device_id != self.load_device_id()?
        {
            return Err(DesktopCustodyError::Rejected);
        }
        let submission = Zeroizing::new(
            URL_SAFE_NO_PAD
                .decode(record.submission.as_bytes())
                .map_err(|_| DesktopCustodyError::Rejected)?,
        );
        let canonical = Zeroizing::new(URL_SAFE_NO_PAD.encode(&submission));
        if submission.is_empty()
            || submission.len() > MAX_SUBMISSION_BYTES
            || *canonical != record.submission
        {
            return Err(DesktopCustodyError::Rejected);
        }
        Ok(Some(record))
    }
}

#[cfg(test)]
mod tests {
    use super::super::TestRebootstrapKeyStore;
    use super::*;

    fn open(
        root: &crate::DesktopApplicationRoot,
        store: &TestRebootstrapKeyStore,
    ) -> DesktopProductionCustody {
        DesktopProductionCustody::load_or_create_for_rebootstrap_test_with_store(
            root,
            store.clone(),
        )
        .unwrap()
    }

    #[test]
    fn exact_submission_survives_reopen_and_only_new_request_can_replace_it() {
        let temp = crate::test_tempdir::tempdir().unwrap();
        let path = temp.path().canonicalize().unwrap().join("GoodDealer");
        let root = crate::DesktopApplicationRoot::validate(&path).unwrap();
        let store = TestRebootstrapKeyStore::default();
        let custody = open(&root, &store);
        assert_eq!(custody.load_handoff_submission("request-1").unwrap(), None);
        let body = br#"{ "signed": "exact bytes" }"#;
        custody.store_handoff_submission("request-1", body).unwrap();
        custody.store_handoff_submission("request-1", body).unwrap();
        assert_eq!(
            custody.store_handoff_submission("request-1", b"different"),
            Err(DesktopCustodyError::Rejected)
        );
        drop(custody);
        let custody = open(&root, &store);
        assert_eq!(
            custody.load_handoff_submission("request-1").unwrap(),
            Some(body.to_vec())
        );
        assert_eq!(custody.load_handoff_submission("request-2").unwrap(), None);
        custody
            .store_handoff_submission("request-2", b"new signed request")
            .unwrap();
        assert_eq!(custody.load_handoff_submission("request-1").unwrap(), None);
        assert_eq!(
            custody.load_handoff_submission("request-2").unwrap(),
            Some(b"new signed request".to_vec())
        );
        assert!(store.authorization_floor.lock().unwrap().is_none());
        assert!(store.authorization_floor_marker.lock().unwrap().is_none());
    }

    #[test]
    fn clear_requires_exact_request_and_survives_reopen() {
        let temp = crate::test_tempdir::tempdir().unwrap();
        let path = temp.path().canonicalize().unwrap().join("GoodDealer");
        let root = crate::DesktopApplicationRoot::validate(&path).unwrap();
        let store = TestRebootstrapKeyStore::default();
        let custody = open(&root, &store);
        custody.clear_handoff_submission("request-1").unwrap();
        custody
            .store_handoff_submission("request-1", b"signed")
            .unwrap();
        assert_eq!(
            custody.clear_handoff_submission("request-2"),
            Err(DesktopCustodyError::Rejected)
        );
        assert_eq!(
            custody.load_handoff_submission("request-1").unwrap(),
            Some(b"signed".to_vec())
        );
        custody.clear_handoff_submission("request-1").unwrap();
        assert!(store.normal_handoff_submission.lock().unwrap().is_none());
        drop(custody);
        let custody = open(&root, &store);
        assert_eq!(custody.load_handoff_submission("request-1").unwrap(), None);
        custody
            .store_handoff_submission("request-1", b"new unsent proof")
            .unwrap();
        assert_eq!(
            custody.load_handoff_submission("request-1").unwrap(),
            Some(b"new unsent proof".to_vec())
        );
    }

    #[test]
    fn rejects_corrupt_cross_installation_and_cross_device_records_without_overwrite() {
        let temp = crate::test_tempdir::tempdir().unwrap();
        let path = temp.path().canonicalize().unwrap().join("GoodDealer");
        let root = crate::DesktopApplicationRoot::validate(&path).unwrap();
        let store = TestRebootstrapKeyStore::default();
        let custody = open(&root, &store);
        custody
            .store_handoff_submission("request-1", b"signed")
            .unwrap();
        let original = store
            .normal_handoff_submission
            .lock()
            .unwrap()
            .clone()
            .unwrap();
        for (field, value) in [
            ("schemaVersion", serde_json::json!(2)),
            ("installationBinding", serde_json::json!([0; 32].to_vec())),
            ("deviceId", serde_json::json!("other-device")),
            ("requestId", serde_json::json!("")),
            ("submission", serde_json::json!("%%")),
            ("submission", serde_json::json!("")),
            ("unexpected", serde_json::json!(true)),
        ] {
            let mut value_json: serde_json::Value = serde_json::from_slice(&original).unwrap();
            value_json[field] = value;
            let corrupt = serde_json::to_vec(&value_json).unwrap();
            *store.normal_handoff_submission.lock().unwrap() = Some(corrupt.clone());
            assert_eq!(
                custody.load_handoff_submission("request-1"),
                Err(DesktopCustodyError::Rejected),
                "{field}"
            );
            assert_eq!(
                custody.store_handoff_submission("request-2", b"new"),
                Err(DesktopCustodyError::Rejected),
                "{field}"
            );
            assert_eq!(
                custody.clear_handoff_submission("request-1"),
                Err(DesktopCustodyError::Rejected)
            );
            assert_eq!(
                *store.normal_handoff_submission.lock().unwrap(),
                Some(corrupt)
            );
        }
        let mut duplicate = original.clone();
        duplicate.pop();
        duplicate.extend_from_slice(br#", "schemaVersion": 1}"#);
        for corrupt in [
            vec![b'x'; MAX_ENVELOPE_BYTES + 1],
            duplicate,
            b"{}".to_vec(),
        ] {
            *store.normal_handoff_submission.lock().unwrap() = Some(corrupt);
            assert_eq!(
                custody.load_handoff_submission("request-1"),
                Err(DesktopCustodyError::Rejected)
            );
        }
    }

    #[test]
    fn enforces_submission_and_identifier_bounds_before_store_mutation() {
        let temp = crate::test_tempdir::tempdir().unwrap();
        let path = temp.path().canonicalize().unwrap().join("GoodDealer");
        let root = crate::DesktopApplicationRoot::validate(&path).unwrap();
        let store = TestRebootstrapKeyStore::default();
        let custody = open(&root, &store);
        for invalid in ["", "with space", "line\nbreak", &"x".repeat(161)] {
            assert_eq!(
                custody.store_handoff_submission(invalid, b"signed"),
                Err(DesktopCustodyError::Rejected)
            );
            assert_eq!(
                custody.load_handoff_submission(invalid),
                Err(DesktopCustodyError::Rejected)
            );
        }
        for body in [vec![], vec![0; MAX_SUBMISSION_BYTES + 1]] {
            assert_eq!(
                custody.store_handoff_submission("request", &body),
                Err(DesktopCustodyError::Rejected)
            );
        }
        assert!(store.normal_handoff_submission.lock().unwrap().is_none());
        let maximum = vec![0xff; MAX_SUBMISSION_BYTES];
        custody
            .store_handoff_submission("request", &maximum)
            .unwrap();
        assert_eq!(
            custody.load_handoff_submission("request").unwrap(),
            Some(maximum)
        );
    }

    #[test]
    fn concurrent_same_request_cannot_publish_two_different_submissions() {
        let temp = crate::test_tempdir::tempdir().unwrap();
        let path = temp.path().canonicalize().unwrap().join("GoodDealer");
        let root = crate::DesktopApplicationRoot::validate(&path).unwrap();
        let store = TestRebootstrapKeyStore::default();
        let custody = std::sync::Arc::new(open(&root, &store));
        let workers: Vec<_> = [b"first".to_vec(), b"second".to_vec()]
            .into_iter()
            .map(|body| {
                let custody = std::sync::Arc::clone(&custody);
                std::thread::spawn(move || custody.store_handoff_submission("request", &body))
            })
            .collect();
        let results: Vec<_> = workers
            .into_iter()
            .map(|worker| worker.join().unwrap())
            .collect();
        assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
        assert_eq!(
            results
                .iter()
                .filter(|result| **result == Err(DesktopCustodyError::Rejected))
                .count(),
            1
        );
        assert!(matches!(
            custody
                .load_handoff_submission("request")
                .unwrap()
                .as_deref(),
            Some(b"first" | b"second")
        ));
    }
}
