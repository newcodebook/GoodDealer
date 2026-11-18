//! Guarded stored-row repair.
//! Transactions remain owned by the single `BusinessDatabase`; splitting capabilities adds no writer.

#[cfg(test)]
use super::*;
#[cfg(not(test))]
use super::{BusinessDatabase, BusinessDatabaseError, TransactionBehavior, validate_timestamp};

impl BusinessDatabase {
    /// Repairs every stored row of `kind` that a read rejects (ADR-0019) in one immediate
    /// transaction and returns how many repair receipts it wrote; zero when nothing is left. The
    /// repair is local: it quarantines Provider observations and Zone bindings, or clears an
    /// asset's local expiry, and writes no Outbox row. `commit_fence` runs last, inside the
    /// transaction, so the Host can refuse the commit when its authority changed.
    ///
    /// # Errors
    ///
    /// Returns an input, fence, or storage error; nothing is written on error.
    pub fn repair_stored_rows_guarded(
        &mut self,
        kind: crate::StorageRepairKind,
        repaired_at: &str,
        commit_fence: impl FnOnce() -> Result<(), BusinessDatabaseError>,
    ) -> Result<u32, BusinessDatabaseError> {
        validate_timestamp(Some(repaired_at.to_owned()))
            .map_err(|_| BusinessDatabaseError::InvalidInput)?;
        let transaction = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let repaired = super::super::storage_repair::repair(
            &transaction,
            &self.workspace_id,
            kind,
            repaired_at,
        )
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        commit_fence()?;
        transaction
            .commit()
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        Ok(repaired)
    }
}
