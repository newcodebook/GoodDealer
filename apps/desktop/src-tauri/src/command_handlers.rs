use std::sync::{Arc, Mutex};

use gooddealer_local_storage::{
    BusinessDatabase, BusinessDatabaseError, DomainAssetWrite, Money, PortfolioReadSnapshot,
};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::authorization::{AuthorizedWorkspace, SystemClock, TrustedClock};
use crate::host_storage::HostStorageBootstrap;

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
pub(crate) struct LocalBusinessRuntime {
    storage: Option<HostStorageBootstrap>,
    clock: Arc<dyn TrustedClock>,
    state: Mutex<LocalBusinessRuntimeState>,
}

#[derive(Default)]
struct LocalBusinessRuntimeState {
    authorization: Option<AuthorizedWorkspace>,
    database: Option<BusinessDatabase>,
}

impl LocalBusinessRuntime {
    pub(crate) fn new(storage: HostStorageBootstrap) -> Self {
        Self::with_clock(storage, Arc::new(SystemClock))
    }

    fn with_clock(storage: HostStorageBootstrap, clock: Arc<dyn TrustedClock>) -> Self {
        Self {
            storage: Some(storage),
            clock,
            state: Mutex::new(LocalBusinessRuntimeState::default()),
        }
    }

    fn status(&self) -> LocalBusinessStatus {
        let state =
            self.clock
                .unix_seconds()
                .map_or(LocalBusinessState::AuthorizationRequired, |now| {
                    self.state
                        .lock()
                        .map_or(LocalBusinessState::AuthorizationRequired, |state| {
                            if state.database.is_some()
                                && state
                                    .authorization
                                    .as_ref()
                                    .is_some_and(|authorization| authorization.allows_at(now))
                            {
                                LocalBusinessState::Ready
                            } else {
                                LocalBusinessState::AuthorizationRequired
                            }
                        })
                });
        LocalBusinessStatus {
            schema_version: 1,
            state,
        }
    }

    /// This is a native composition seam, not an IPC surface. The caller must derive all inputs
    /// from a verified account/entitlement/device grant and a Host-owned application data root.
    #[cfg_attr(
        not(test),
        allow(
            dead_code,
            reason = "the authorization composition will call this seam; tests exercise it before that host wiring lands"
        )
    )]
    pub(crate) fn activate_authorized_workspace(
        &self,
        authorization: AuthorizedWorkspace,
    ) -> Result<(), BusinessDatabaseError> {
        let now = self
            .clock
            .unix_seconds()
            .map_err(|_| BusinessDatabaseError::WorkspaceRejected)?;
        if !authorization.allows_at(now) {
            return Err(BusinessDatabaseError::WorkspaceRejected);
        }
        let mut state = self
            .state
            .lock()
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        if state
            .authorization
            .as_ref()
            .is_some_and(|existing| !existing.can_replace_with(&authorization))
        {
            return Err(BusinessDatabaseError::WorkspaceRejected);
        }
        let database = self
            .storage
            .as_ref()
            .ok_or(BusinessDatabaseError::StorageRejected)?
            .open_workspace(authorization.workspace_id())?;
        state.database = Some(database);
        state.authorization = Some(authorization);
        Ok(())
    }

    fn read_portfolio(&self) -> Result<PortfolioReadSnapshot, String> {
        let now = self
            .clock
            .unix_seconds()
            .map_err(|error| error.to_string())?;
        let state = self
            .state
            .lock()
            .map_err(|_| BusinessDatabaseError::StorageRejected.to_string())?;
        ensure_authorized(&state, now)?;
        state
            .database
            .as_ref()
            .ok_or_else(|| "LOCAL_AUTHORIZATION_REQUIRED".to_owned())?
            .read_portfolio()
            .map_err(|error| error.to_string())
    }

    fn upsert_domain_asset(&self, request: LocalDomainAssetUpsertRequest) -> Result<(), String> {
        let now = self
            .clock
            .unix_seconds()
            .map_err(|error| error.to_string())?;
        let mut state = self
            .state
            .lock()
            .map_err(|_| BusinessDatabaseError::StorageRejected.to_string())?;
        ensure_authorized(&state, now)?;
        state
            .database
            .as_mut()
            .ok_or_else(|| "LOCAL_AUTHORIZATION_REQUIRED".to_owned())?
            .upsert_domain_asset(
                &request.mutation_id,
                &request.created_at,
                &DomainAssetWrite {
                    entity_id: request.asset.entity_id,
                    note: request.asset.note,
                    portfolio_id: request.asset.portfolio_id,
                    tags: request.asset.tags,
                    target_price: request.asset.target_price,
                },
            )
            .map_err(|error| error.to_string())
    }
}

impl Default for LocalBusinessRuntime {
    fn default() -> Self {
        Self {
            storage: None,
            clock: Arc::new(SystemClock),
            state: Mutex::new(LocalBusinessRuntimeState::default()),
        }
    }
}

fn ensure_authorized(state: &LocalBusinessRuntimeState, now: i64) -> Result<(), String> {
    if state
        .authorization
        .as_ref()
        .is_some_and(|authorization| authorization.allows_at(now))
    {
        Ok(())
    } else {
        Err("LOCAL_AUTHORIZATION_REQUIRED".to_owned())
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
    runtime.read_portfolio()
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub(crate) fn local_domain_asset_upsert(
    request: LocalDomainAssetUpsertRequest,
    runtime: State<'_, LocalBusinessRuntime>,
) -> Result<(), String> {
    runtime.upsert_domain_asset(request)
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicI64, Ordering};

    use tempfile::tempdir;

    use super::*;
    use crate::authorization::tests::{AcceptingVerifier, grant};
    use crate::authorization::{
        AuthorizationError, TrustedDeviceBinding, parse_canonical_utc,
        verify_desktop_authorization_grant,
    };
    use crate::host_storage::{DatabaseKeyStore, HostStorageError};

    struct TestKeyStore;

    impl DatabaseKeyStore for TestKeyStore {
        fn load(&self) -> Result<Option<[u8; 32]>, HostStorageError> {
            Ok(Some([0x61; 32]))
        }

        fn generate_and_store(&self) -> Result<[u8; 32], HostStorageError> {
            unreachable!("the deterministic test key already exists")
        }
    }

    struct TestClock(AtomicI64);

    impl TestClock {
        fn new(now: i64) -> Self {
            Self(AtomicI64::new(now))
        }

        fn set(&self, now: i64) {
            self.0.store(now, Ordering::Relaxed);
        }
    }

    impl TrustedClock for TestClock {
        fn unix_seconds(&self) -> Result<i64, AuthorizationError> {
            Ok(self.0.load(Ordering::Relaxed))
        }
    }

    #[test]
    fn cloud_transport_is_not_required_for_local_business_read_and_write() {
        let directory = tempdir().unwrap();
        let storage = HostStorageBootstrap::initialize(directory.path(), &TestKeyStore).unwrap();
        let clock = Arc::new(TestClock::new(
            parse_canonical_utc("2026-08-29T18:00:00Z").unwrap(),
        ));
        let runtime = LocalBusinessRuntime::with_clock(storage, clock.clone());
        assert_eq!(
            runtime.status().state,
            LocalBusinessState::AuthorizationRequired
        );
        let authorization = verify_desktop_authorization_grant(
            &grant(serde_json::json!({})),
            &TrustedDeviceBinding {
                account_id: "account-local",
                device_id: "device-local",
                account_security_epoch: 4,
                lease_epoch: 7,
            },
            clock.unix_seconds().unwrap(),
            &AcceptingVerifier,
        )
        .unwrap();
        runtime
            .activate_authorized_workspace(authorization)
            .unwrap();
        runtime
            .upsert_domain_asset(LocalDomainAssetUpsertRequest {
                mutation_id: "mutation-local".to_owned(),
                created_at: "2026-08-29T18:00:00Z".to_owned(),
                asset: LocalDomainAssetWrite {
                    entity_id: "domain-local.test".to_owned(),
                    note: Some("committed without cloud".to_owned()),
                    portfolio_id: None,
                    tags: vec![],
                    target_price: None,
                },
            })
            .unwrap();
        assert_eq!(runtime.read_portfolio().unwrap().domains.len(), 1);
        assert_eq!(runtime.status().state, LocalBusinessState::Ready);

        let mismatched_workspace = verify_desktop_authorization_grant(
            &grant(serde_json::json!({"workspace": {"workspaceId": "workspace-other"}})),
            &TrustedDeviceBinding {
                account_id: "account-local",
                device_id: "device-local",
                account_security_epoch: 4,
                lease_epoch: 7,
            },
            clock.unix_seconds().unwrap(),
            &AcceptingVerifier,
        )
        .unwrap();
        assert_eq!(
            runtime
                .activate_authorized_workspace(mismatched_workspace)
                .unwrap_err(),
            BusinessDatabaseError::WorkspaceRejected
        );

        clock.set(parse_canonical_utc("2026-08-30T00:00:00Z").unwrap());
        assert_eq!(
            runtime.status().state,
            LocalBusinessState::AuthorizationRequired
        );
        assert_eq!(
            runtime.read_portfolio().unwrap_err(),
            "LOCAL_AUTHORIZATION_REQUIRED"
        );
        assert_eq!(
            runtime
                .upsert_domain_asset(LocalDomainAssetUpsertRequest {
                    mutation_id: "mutation-expired".to_owned(),
                    created_at: "2026-08-30T00:00:00Z".to_owned(),
                    asset: LocalDomainAssetWrite {
                        entity_id: "blocked.test".to_owned(),
                        note: None,
                        portfolio_id: None,
                        tags: vec![],
                        target_price: None,
                    },
                })
                .unwrap_err(),
            "LOCAL_AUTHORIZATION_REQUIRED"
        );
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
