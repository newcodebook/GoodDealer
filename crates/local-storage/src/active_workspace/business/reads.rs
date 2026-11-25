//! Non-secret workspace read projections.
//! Transactions remain owned by the single `BusinessDatabase`; splitting capabilities adds no writer.

#[cfg(test)]
use super::*;
#[cfg(not(test))]
use super::{
    AssetLibraryReadSnapshot, BusinessDatabase, BusinessDatabaseError, DomainDetailReadSnapshot,
    map_portfolio_read_error,
};

impl BusinessDatabase {
    #[cfg(test)]
    pub(crate) fn read_portfolio(&self) -> Result<PortfolioReadSnapshot, BusinessDatabaseError> {
        self.store
            .read_portfolio(&self.workspace_id)
            .map_err(|_| BusinessDatabaseError::StorageRejected)
    }

    /// Reads one bounded, deterministic domain-library window from this database's workspace.
    ///
    /// # Errors
    ///
    /// Returns a closed storage, workspace, projection, query, or window error.
    pub fn read_asset_library(
        &self,
        start_index: u32,
        size: u16,
        query: &str,
    ) -> Result<AssetLibraryReadSnapshot, BusinessDatabaseError> {
        self.store
            .read_asset_library(&self.workspace_id, start_index, size, query)
            .map_err(map_portfolio_read_error)
    }

    /// Reads one bounded window of manual tasks, oldest waiting first.
    ///
    /// # Errors
    ///
    /// Returns a closed storage, workspace, projection, or window error.
    pub fn read_manual_tasks(
        &self,
        start_index: u32,
        size: u16,
    ) -> Result<crate::ManualTasksReadSnapshot, BusinessDatabaseError> {
        self.store
            .read_manual_tasks(&self.workspace_id, start_index, size)
            .map_err(map_portfolio_read_error)
    }

    /// Reads one bounded window of the local revision ledger, newest first, with field-level diffs,
    /// and counts the revisions committed within `today` (the Renderer's local day as canonical
    /// UTC instants, start inclusive and end exclusive).
    ///
    /// # Errors
    ///
    /// Returns a closed storage, workspace, projection, or window error.
    pub fn read_history(
        &self,
        start_index: u32,
        size: u16,
        today: (&str, &str),
    ) -> Result<crate::HistoryReadSnapshot, BusinessDatabaseError> {
        self.store
            .read_history(&self.workspace_id, start_index, size, today)
            .map_err(map_portfolio_read_error)
    }

    /// Reads one bounded window of operation plans, newest first, with planned and attempted counts.
    ///
    /// # Errors
    ///
    /// Returns a closed storage, workspace, projection, or window error.
    pub fn read_batch_operations(
        &self,
        start_index: u32,
        size: u16,
    ) -> Result<crate::BatchOperationsReadSnapshot, BusinessDatabaseError> {
        self.store
            .read_batch_operations(&self.workspace_id, start_index, size)
            .map_err(map_portfolio_read_error)
    }

    /// Reads one bounded window of assets expiring within the next 60 days, soonest first.
    ///
    /// # Errors
    ///
    /// Returns a closed storage, workspace, projection, or window error.
    pub fn read_renewals(
        &self,
        start_index: u32,
        size: u16,
    ) -> Result<crate::RenewalsReadSnapshot, BusinessDatabaseError> {
        self.store
            .read_renewals(&self.workspace_id, start_index, size)
            .map_err(map_portfolio_read_error)
    }

    /// Reads one bounded window of the latest marketplace listing observations.
    ///
    /// # Errors
    ///
    /// Returns a closed storage, workspace, projection, or window error.
    pub fn read_sales(
        &self,
        start_index: u32,
        size: u16,
    ) -> Result<crate::SalesReadSnapshot, BusinessDatabaseError> {
        self.store
            .read_sales(&self.workspace_id, start_index, size)
            .map_err(map_portfolio_read_error)
    }

    /// Reads this database's Provider connections and role availability for settings.
    ///
    /// # Errors
    ///
    /// Returns a closed storage, workspace, or projection error.
    pub fn read_settings(&self) -> Result<crate::SettingsReadSnapshot, BusinessDatabaseError> {
        self.store
            .read_settings(&self.workspace_id)
            .map_err(map_portfolio_read_error)
    }

    /// Reads one bounded DNS health window from this database's workspace.
    ///
    /// # Errors
    ///
    /// Returns a closed storage, workspace, projection, or window error.
    pub fn read_dns_health(
        &self,
        start_index: u32,
        size: u16,
        query: &str,
    ) -> Result<crate::DnsHealthReadSnapshot, BusinessDatabaseError> {
        self.store
            .read_dns_health(&self.workspace_id, start_index, size, query)
            .map_err(map_portfolio_read_error)
    }

    /// Reads one canonical domain detail from this database's workspace.
    ///
    /// # Errors
    ///
    /// Returns a closed storage, workspace, projection, or missing-asset error.
    pub fn read_domain_detail(
        &self,
        entity_id: &str,
    ) -> Result<DomainDetailReadSnapshot, BusinessDatabaseError> {
        self.store
            .read_domain_detail(&self.workspace_id, entity_id)
            .map_err(map_portfolio_read_error)
    }
}
