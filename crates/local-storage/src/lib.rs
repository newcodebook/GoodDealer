use gooddealer_secure_host_core::{ActivationPurpose, RuntimeMode};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StorageKind {
    StandbyCache,
    ActivationStaging,
    ActiveWorkspace,
    RecoveryStaging,
    LocalContinuationWorkspace,
    EvidenceSpool,
    /// Logical narrow capability over the same physical evidence-spool domain. It never exposes
    /// generic spool queries and is reserved for Tombstone/Challenge/old-key `PoP` evidence upload.
    RemovedEvidenceSpool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StorageAccess {
    ReadOnly,
    ReadWrite,
}

#[must_use]
pub const fn storage_access(
    mode: RuntimeMode,
    activation_purpose: Option<ActivationPurpose>,
    storage: StorageKind,
) -> Option<StorageAccess> {
    match (mode, activation_purpose, storage) {
        (
            RuntimeMode::Activating,
            Some(ActivationPurpose::Bootstrap),
            StorageKind::ActivationStaging,
        )
        | (
            RuntimeMode::Activating,
            Some(ActivationPurpose::LocalRecovery),
            StorageKind::RecoveryStaging,
        )
        | (RuntimeMode::Active | RuntimeMode::Draining, None, StorageKind::ActiveWorkspace)
        | (
            RuntimeMode::Active | RuntimeMode::Draining | RuntimeMode::Standby,
            None,
            StorageKind::EvidenceSpool,
        )
        | (RuntimeMode::LocalContinuation, None, StorageKind::LocalContinuationWorkspace) => {
            Some(StorageAccess::ReadWrite)
        }
        (RuntimeMode::Standby, None, StorageKind::StandbyCache)
        | (RuntimeMode::Activating, Some(_), StorageKind::StandbyCache)
        | (RuntimeMode::Locked, None, StorageKind::RemovedEvidenceSpool) => {
            Some(StorageAccess::ReadOnly)
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use gooddealer_secure_host_core::{ActivationPurpose, RuntimeMode};

    use super::{StorageAccess, StorageKind, storage_access};

    #[test]
    fn runtime_mode_admits_only_the_named_storage_resource() {
        assert_eq!(
            storage_access(RuntimeMode::Standby, None, StorageKind::StandbyCache),
            Some(StorageAccess::ReadOnly)
        );
        assert_eq!(
            storage_access(RuntimeMode::Standby, None, StorageKind::ActiveWorkspace),
            None
        );
        assert_eq!(
            storage_access(
                RuntimeMode::Activating,
                Some(ActivationPurpose::Bootstrap),
                StorageKind::ActivationStaging,
            ),
            Some(StorageAccess::ReadWrite)
        );
        assert_eq!(
            storage_access(
                RuntimeMode::Activating,
                Some(ActivationPurpose::Bootstrap),
                StorageKind::ActiveWorkspace,
            ),
            None
        );
        assert_eq!(
            storage_access(
                RuntimeMode::Activating,
                Some(ActivationPurpose::Bootstrap),
                StorageKind::RecoveryStaging,
            ),
            None
        );
        assert_eq!(
            storage_access(
                RuntimeMode::Activating,
                Some(ActivationPurpose::LocalRecovery),
                StorageKind::RecoveryStaging,
            ),
            Some(StorageAccess::ReadWrite)
        );
        assert_eq!(
            storage_access(
                RuntimeMode::Activating,
                Some(ActivationPurpose::LocalRecovery),
                StorageKind::ActivationStaging,
            ),
            None
        );
        assert_eq!(
            storage_access(
                RuntimeMode::LocalContinuation,
                None,
                StorageKind::LocalContinuationWorkspace,
            ),
            Some(StorageAccess::ReadWrite)
        );
        assert_eq!(
            storage_access(
                RuntimeMode::LocalContinuation,
                None,
                StorageKind::ActiveWorkspace,
            ),
            None
        );
        assert_eq!(
            storage_access(
                RuntimeMode::LocalContinuation,
                None,
                StorageKind::RecoveryStaging,
            ),
            None
        );
        assert_eq!(
            storage_access(RuntimeMode::Locked, None, StorageKind::ActiveWorkspace),
            None
        );
        assert_eq!(
            storage_access(RuntimeMode::Locked, None, StorageKind::RecoveryStaging),
            None
        );
        assert_eq!(
            storage_access(RuntimeMode::Locked, None, StorageKind::EvidenceSpool),
            None
        );
        assert_eq!(
            storage_access(RuntimeMode::Locked, None, StorageKind::RemovedEvidenceSpool),
            Some(StorageAccess::ReadOnly)
        );
    }
}
