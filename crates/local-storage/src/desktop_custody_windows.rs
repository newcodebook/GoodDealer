//! Windows custody boundary.
//!
//! The qualified custody implementation depends on descriptor-relative POSIX operations and
//! is intentionally unavailable on Windows until an equivalent handle-based implementation is
//! qualified. Keeping this module explicit makes the native target compile while preserving the
//! fail-closed production contract.

use zeroize::Zeroizing;

use crate::{BusinessDatabase, BusinessDatabaseError, DesktopApplicationRoot};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum DesktopCustodyError {
    Unavailable,
    Rejected,
    RandomUnavailable,
    StorageRejected,
}

pub(crate) struct DesktopProductionCustody;

impl DesktopProductionCustody {
    pub(crate) fn load_or_create(
        _root: &DesktopApplicationRoot,
    ) -> Result<Self, DesktopCustodyError> {
        Err(DesktopCustodyError::Unavailable)
    }

    pub(crate) fn open_workspace(
        &self,
        _workspace_id: &str,
    ) -> Result<BusinessDatabase, BusinessDatabaseError> {
        Err(BusinessDatabaseError::StorageRejected)
    }

    pub(crate) fn load_device_id(&self) -> Result<String, DesktopCustodyError> {
        Err(DesktopCustodyError::Unavailable)
    }

    pub(crate) fn installation_binding_digest(&self) -> Result<[u8; 32], DesktopCustodyError> {
        Err(DesktopCustodyError::Unavailable)
    }

    #[allow(dead_code)]
    pub(crate) fn require_rebootstrap_reservation_capability(
        &self,
    ) -> Result<(), DesktopCustodyError> {
        Err(DesktopCustodyError::Unavailable)
    }
}

pub(crate) struct DesktopContinuityReceiptStore;

impl DesktopContinuityReceiptStore {
    pub(crate) fn load(
        &self,
        _slot: u8,
    ) -> Result<Option<Zeroizing<Vec<u8>>>, DesktopCustodyError> {
        Err(DesktopCustodyError::Unavailable)
    }

    pub(crate) fn store(&self, _slot: u8, _sealed: &[u8]) -> Result<(), DesktopCustodyError> {
        Err(DesktopCustodyError::Unavailable)
    }

    pub(crate) fn any_receipt(&self) -> Result<bool, DesktopCustodyError> {
        Err(DesktopCustodyError::Unavailable)
    }
}
