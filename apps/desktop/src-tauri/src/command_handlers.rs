use std::path::Path;
use std::sync::Mutex;

use gooddealer_local_storage::{
    BusinessDatabase, BusinessDatabaseError, DomainAssetWrite, LocalDatabaseKey, Money,
    PortfolioReadSnapshot,
};
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalBusinessStatus {
    schema_version: u8,
    state: LocalBusinessState,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum LocalBusinessState {
    AuthorizationRequired,
    Ready,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct LocalDomainAssetUpsertRequest {
    mutation_id: String,
    created_at: String,
    asset: LocalDomainAssetWrite,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LocalDomainAssetWrite {
    entity_id: String,
    note: Option<String>,
    portfolio_id: Option<String>,
    tags: Vec<String>,
    target_price: Option<Money>,
}

/// Host-owned local business runtime. Only the trusted authorization composition may activate it;
/// no IPC command accepts a database path, key, account, device, or workspace selector.
#[derive(Default)]
pub(crate) struct LocalBusinessRuntime {
    database: Mutex<Option<BusinessDatabase>>,
}

impl LocalBusinessRuntime {
    fn status(&self) -> LocalBusinessStatus {
        let state = if self
            .database
            .lock()
            .is_ok_and(|database| database.is_some())
        {
            LocalBusinessState::Ready
        } else {
            LocalBusinessState::AuthorizationRequired
        };
        LocalBusinessStatus {
            schema_version: 1,
            state,
        }
    }

    /// This is a native composition seam, not an IPC surface. The caller must derive all inputs
    /// from a verified account/entitlement/device grant and a Host-owned application data root.
    pub(crate) fn activate_authorized_workspace(
        &self,
        path: &Path,
        key: &LocalDatabaseKey,
        workspace_id: &str,
    ) -> Result<(), BusinessDatabaseError> {
        let database = BusinessDatabase::open(path, key, workspace_id)?;
        *self
            .database
            .lock()
            .map_err(|_| BusinessDatabaseError::StorageRejected)? = Some(database);
        Ok(())
    }
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub(crate) fn local_business_status(
    runtime: State<'_, LocalBusinessRuntime>,
) -> LocalBusinessStatus {
    runtime.status()
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub(crate) fn local_portfolio_read(
    runtime: State<'_, LocalBusinessRuntime>,
) -> Result<PortfolioReadSnapshot, String> {
    let database = runtime
        .database
        .lock()
        .map_err(|_| BusinessDatabaseError::StorageRejected.to_string())?;
    database
        .as_ref()
        .ok_or_else(|| "LOCAL_AUTHORIZATION_REQUIRED".to_owned())?
        .read_portfolio()
        .map_err(|error| error.to_string())
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub(crate) fn local_domain_asset_upsert(
    request: LocalDomainAssetUpsertRequest,
    runtime: State<'_, LocalBusinessRuntime>,
) -> Result<(), String> {
    let mut database = runtime
        .database
        .lock()
        .map_err(|_| BusinessDatabaseError::StorageRejected.to_string())?;
    database
        .as_mut()
        .ok_or_else(|| "LOCAL_AUTHORIZATION_REQUIRED".to_owned())?
        .upsert_domain_asset(
            &request.mutation_id,
            &request.created_at,
            DomainAssetWrite {
                entity_id: request.asset.entity_id,
                note: request.asset.note,
                portfolio_id: request.asset.portfolio_id,
                tags: request.asset.tags,
                target_price: request.asset.target_price,
            },
        )
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use super::*;

    #[test]
    fn cloud_transport_is_not_required_for_local_business_read_and_write() {
        let directory = tempdir().unwrap();
        let runtime = LocalBusinessRuntime::default();
        assert_eq!(
            runtime.status().state,
            LocalBusinessState::AuthorizationRequired
        );
        runtime
            .activate_authorized_workspace(
                &directory.path().join("business.db"),
                &LocalDatabaseKey::from_bytes([0x61; 32]),
                "workspace-local",
            )
            .unwrap();
        {
            let mut database = runtime.database.lock().unwrap();
            database
                .as_mut()
                .unwrap()
                .upsert_domain_asset(
                    "mutation-local",
                    "2026-08-28T00:00:00Z",
                    DomainAssetWrite {
                        entity_id: "domain-local.test".to_owned(),
                        note: Some("committed without cloud".to_owned()),
                        portfolio_id: None,
                        tags: vec![],
                        target_price: None,
                    },
                )
                .unwrap();
        }
        let database = runtime.database.lock().unwrap();
        assert_eq!(
            database
                .as_ref()
                .unwrap()
                .read_portfolio()
                .unwrap()
                .domains
                .len(),
            1
        );
        drop(database);
        assert_eq!(runtime.status().state, LocalBusinessState::Ready);
    }

    #[test]
    fn runtime_starts_locked_and_exposes_no_database_identity() {
        let runtime = LocalBusinessRuntime::default();
        assert_eq!(
            serde_json::to_value(runtime.status()).unwrap(),
            serde_json::json!({"schemaVersion": 1, "state": "authorization_required"})
        );
    }
}
