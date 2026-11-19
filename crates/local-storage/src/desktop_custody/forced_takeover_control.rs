//! Fixed-purpose forced takeover control record. It is never part of a business backup.
use super::{DesktopCustodyError, DesktopProductionCustody};
use std::sync::Mutex;

#[cfg(not(all(test, unix)))]
const SERVICE: &str = "com.gooddealer.desktop.forced-takeover";
#[cfg(not(all(test, unix)))]
const ACCOUNT: &str = "intent-control-v1";
#[cfg(not(all(test, unix)))]
const MARKER_ACCOUNT: &str = "intent-established-v1";
const MARKER: &[u8] = b"GOODDEALER/FORCED-TAKEOVER-CONTROL-V1";
const MAX_BYTES: usize = 65_536;
static CONTROL_LOCK: Mutex<()> = Mutex::new(());

impl DesktopProductionCustody {
    pub(crate) fn load_forced_takeover_control(
        &self,
    ) -> Result<Option<Vec<u8>>, DesktopCustodyError> {
        let _lock = CONTROL_LOCK
            .lock()
            .map_err(|_| DesktopCustodyError::StorageRejected)?;
        self.read_forced_takeover_control()
    }

    pub(crate) fn replace_forced_takeover_control(
        &self,
        expected: Option<&[u8]>,
        replacement: &[u8],
    ) -> Result<(), DesktopCustodyError> {
        let _lock = CONTROL_LOCK
            .lock()
            .map_err(|_| DesktopCustodyError::StorageRejected)?;
        if replacement.is_empty()
            || replacement.len() > MAX_BYTES
            || self.read_forced_takeover_control()?.as_deref() != expected
        {
            return Err(DesktopCustodyError::Rejected);
        }
        // Host has validated the exact scoped prior bytes. Repair only the legitimate first-write
        // prefix (record exists, marker absent) before advancing it; never reset a missing record.
        if expected.is_some() && self.read_forced_takeover_marker()?.is_none() {
            self.store_forced_takeover_marker()?;
        }
        #[cfg(all(test, unix))]
        {
            *self
                .rebootstrap_test_store
                .forced_takeover_control
                .lock()
                .map_err(|_| DesktopCustodyError::StorageRejected)? = Some(replacement.to_vec());
        }
        #[cfg(all(unix, not(test)))]
        super::store_native(SERVICE, ACCOUNT, replacement)?;
        #[cfg(windows)]
        super::store(SERVICE, ACCOUNT, replacement)?;
        self.store_forced_takeover_marker()?;
        #[cfg(all(test, unix))]
        if let Some(probe) = self
            .rebootstrap_test_store
            .forced_takeover_write_probe
            .lock()
            .map_err(|_| DesktopCustodyError::StorageRejected)?
            .take()
        {
            probe.persisted.wait();
            probe.resume.wait();
            if probe.reject_after_write {
                return Err(DesktopCustodyError::StorageRejected);
            }
        }
        if self.read_forced_takeover_control()?.as_deref() != Some(replacement) {
            return Err(DesktopCustodyError::StorageRejected);
        }
        Ok(())
    }

    fn read_forced_takeover_control(&self) -> Result<Option<Vec<u8>>, DesktopCustodyError> {
        #[cfg(all(test, unix))]
        let bytes = self
            .rebootstrap_test_store
            .forced_takeover_control
            .lock()
            .map_err(|_| DesktopCustodyError::StorageRejected)?
            .clone();
        #[cfg(all(unix, not(test)))]
        let bytes = super::load_native(SERVICE, ACCOUNT)?;
        #[cfg(windows)]
        let bytes = super::load(SERVICE, ACCOUNT)?;
        if bytes
            .as_ref()
            .is_some_and(|value| value.is_empty() || value.len() > MAX_BYTES)
        {
            return Err(DesktopCustodyError::Rejected);
        }
        let marker = self.read_forced_takeover_marker()?;
        if marker.as_ref().is_some_and(|marker| marker != MARKER)
            || (marker.is_some() && bytes.is_none())
        {
            return Err(DesktopCustodyError::Rejected);
        }
        Ok(bytes)
    }
    #[cfg_attr(
        not(all(test, unix)),
        expect(
            clippy::unused_self,
            reason = "fixed production purpose with per-instance test custody"
        )
    )]
    fn read_forced_takeover_marker(&self) -> Result<Option<Vec<u8>>, DesktopCustodyError> {
        #[cfg(all(test, unix))]
        {
            Ok(self
                .rebootstrap_test_store
                .forced_takeover_marker
                .lock()
                .map_err(|_| DesktopCustodyError::StorageRejected)?
                .clone())
        }
        #[cfg(all(unix, not(test)))]
        {
            super::load_native(SERVICE, MARKER_ACCOUNT)
        }
        #[cfg(windows)]
        {
            super::load(SERVICE, MARKER_ACCOUNT)
        }
    }
    fn store_forced_takeover_marker(&self) -> Result<(), DesktopCustodyError> {
        #[cfg(all(test, unix))]
        {
            *self
                .rebootstrap_test_store
                .forced_takeover_marker
                .lock()
                .map_err(|_| DesktopCustodyError::StorageRejected)? = Some(MARKER.to_vec());
        }
        #[cfg(all(unix, not(test)))]
        super::store_native(SERVICE, MARKER_ACCOUNT, MARKER)?;
        #[cfg(windows)]
        super::store(SERVICE, MARKER_ACCOUNT, MARKER)?;
        if self.read_forced_takeover_marker()?.as_deref() != Some(MARKER) {
            return Err(DesktopCustodyError::StorageRejected);
        }
        Ok(())
    }
}

#[cfg(all(test, unix))]
pub(crate) struct ForcedTakeoverWriteProbe {
    pub(crate) persisted: std::sync::Barrier,
    pub(crate) resume: std::sync::Barrier,
    reject_after_write: bool,
}
#[cfg(all(test, unix))]
impl super::TestRebootstrapKeyStore {
    pub(crate) fn damage_forced_takeover_record(&self, missing: bool) {
        *self.forced_takeover_control.lock().unwrap() =
            if missing { None } else { Some(b"{}".to_vec()) };
    }
    pub(crate) fn remove_forced_takeover_marker(&self) {
        *self.forced_takeover_marker.lock().unwrap() = None;
    }
    pub(crate) fn pause_forced_takeover_after_write(
        &self,
        reject_after_write: bool,
    ) -> std::sync::Arc<ForcedTakeoverWriteProbe> {
        let probe = std::sync::Arc::new(ForcedTakeoverWriteProbe {
            persisted: std::sync::Barrier::new(2),
            resume: std::sync::Barrier::new(2),
            reject_after_write,
        });
        *self.forced_takeover_write_probe.lock().unwrap() = Some(probe.clone());
        probe
    }
}
