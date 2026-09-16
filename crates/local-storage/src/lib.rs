mod active_workspace;

mod migrations;

mod portfolio_projection;
mod sqlcipher_key_sql;
mod sqlcipher_process_policy;

pub use active_workspace::business::{
    BusinessDatabase, BusinessDatabaseError, DomainAssetReplicaMutation, DomainAssetWrite,
    LocalDatabaseKey, PendingSyncMutation, ProviderConnectionWrite, SealedProviderCredential,
};
pub use portfolio_projection::{DomainAssetProjectionRow, Money, PortfolioReadSnapshot};

#[cfg(feature = "backup-foundation-evidence")]
pub mod backup;

#[cfg(test)]
mod sqlcipher_fixture;
