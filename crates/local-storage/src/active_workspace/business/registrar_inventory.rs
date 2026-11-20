//! Complete registrar inventory, persisted by the same business transaction as asset creation.
use super::{
    BusinessDatabaseError, afternic::random_id, assets::import_discovered_asset,
    validate_domain_asset_id, validate_timestamp,
};
use crate::portfolio_projection::valid_date;
use rusqlite::{Transaction, params};
use serde::Serialize;
use std::collections::BTreeSet;

/// Bounded Native-only fields from a complete account Registrar scan.
pub struct DesktopRegistrationFact {
    pub domain: String,
    pub registered_on: String,
    pub expires_on: Option<String>,
    pub auto_renew: Option<bool>,
    pub locked: Option<bool>,
    pub standing: DesktopRegistrationStanding,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum DesktopRegistrationStanding {
    Active,
    Pending,
    Inactive,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopRegistrarScanReceipt {
    pub observed: u32,
    pub imported: u32,
    pub skipped: u32,
    pub completed_at: String,
}

#[derive(Clone, Copy)]
pub(super) enum RegistrarInventorySource {
    Cloudflare,
    Spaceship,
    Aliyun,
}

impl RegistrarInventorySource {
    const fn name(self) -> &'static str {
        match self {
            Self::Cloudflare => "Cloudflare",
            Self::Spaceship => "Spaceship",
            Self::Aliyun => "Aliyun",
        }
    }

    const fn connector_version(self) -> &'static str {
        match self {
            Self::Cloudflare => "cloudflare-registrar-v4",
            Self::Spaceship => "spaceship-registrar-v1",
            Self::Aliyun => "aliyun-registrar-v1",
        }
    }
}

pub(super) struct RegistrarInventoryBatch<'a> {
    pub workspace: &'a str,
    pub connection_id: &'a str,
    pub registrations: &'a [DesktopRegistrationFact],
    pub device_id: &'a str,
    pub lease_epoch: u64,
    pub at: &'a str,
    pub source: RegistrarInventorySource,
}

impl RegistrarInventoryBatch<'_> {
    pub(super) fn validate(&self) -> Result<(), BusinessDatabaseError> {
        if self.registrations.len() > 10_000 {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        validate_timestamp(Some(self.at.to_owned()))
            .map_err(|_| BusinessDatabaseError::InvalidInput)?;
        let mut domains = BTreeSet::new();
        for row in self.registrations {
            validate_domain_asset_id(&row.domain)
                .map_err(|_| BusinessDatabaseError::InvalidInput)?;
            if !domains.insert(&row.domain)
                || !valid_date(&row.registered_on)
                || row.expires_on.as_ref().map_or(
                    row.standing != DesktopRegistrationStanding::Pending,
                    |expiry| !valid_date(expiry) || expiry < &row.registered_on,
                )
            {
                return Err(BusinessDatabaseError::InvalidInput);
            }
        }
        Ok(())
    }

    pub(super) fn write<'run>(
        &self,
        tx: &Transaction<'_>,
        run: &'run str,
    ) -> Result<(Option<&'run str>, DesktopRegistrarScanReceipt), BusinessDatabaseError> {
        let workspace = self.workspace;
        let mut has_targets = false;
        let mut receipt = DesktopRegistrarScanReceipt {
            observed: u32::try_from(self.registrations.len())
                .map_err(|_| BusinessDatabaseError::InvalidInput)?,
            imported: 0,
            skipped: 0,
            completed_at: self.at.to_owned(),
        };
        for (ordinal, row) in self.registrations.iter().enumerate() {
            let Some(created) = import_discovered_asset(
                tx,
                workspace,
                &random_id()?,
                self.device_id,
                self.lease_epoch,
                self.at,
                &row.domain,
            )?
            else {
                receipt.skipped += 1;
                continue;
            };
            receipt.imported += u32::from(created);
            if !has_targets {
                tx.execute(
                    "INSERT INTO provider_observation_runs (workspace_id,observation_run_id,connection_id,observation_capability,started_at,status,connector_version)
                     VALUES (?1,?2,?3,'registrar',?4,'running',?5)",
                    params![workspace,run,self.connection_id,self.at,self.source.connector_version()],
                ).map_err(storage)?;
                has_targets = true;
            }
            let ordinal =
                u32::try_from(ordinal).map_err(|_| BusinessDatabaseError::InvalidInput)?;
            tx.execute(
                "INSERT INTO provider_observation_targets (workspace_id,observation_run_id,entity_id,ordinal,status,requested_at)
                 VALUES (?1,?2,?3,?4,'requested',?5)",
                params![workspace,run,row.domain,ordinal,self.at],
            ).map_err(storage)?;
            tx.execute(
                "INSERT INTO registrar_observations (workspace_id,observation_id,observation_run_id,entity_id,
                        registrar_name,registered_on,expires_on,auto_renew,registrar_lock,observation_availability,
                        evidence_status,observed_at,provider_version_token,observed_asset_generation)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,'available',?10,?11,?3,
                    (SELECT entity_generation FROM domain_assets WHERE workspace_id=?1 AND entity_id=?4))",
                params![workspace,random_id()?,run,row.domain,self.source.name(),row.registered_on,row.expires_on,row.auto_renew,row.locked,
                    if row.standing == DesktopRegistrationStanding::Active { "confirmed" } else { "unknown" },self.at],
            ).map_err(storage)?;
        }
        tx.execute(
            "UPDATE provider_observation_targets SET status='succeeded',completed_at=?1 WHERE workspace_id=?2 AND observation_run_id=?3",
            params![self.at,workspace,run],
        ).map_err(storage)?;
        tx.execute(
            "UPDATE provider_observation_runs SET status='succeeded',completed_at=?1 WHERE workspace_id=?2 AND observation_run_id=?3",
            params![self.at,workspace,run],
        ).map_err(storage)?;
        Ok((has_targets.then_some(run), receipt))
    }
}

fn storage(_: rusqlite::Error) -> BusinessDatabaseError {
    BusinessDatabaseError::StorageRejected
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::BusinessDatabase;
    use crate::active_workspace::business::{
        aliyun_registrar::AliyunInventoryCommit, canonical_page_digest,
        spaceship_registrar::SpaceshipInventoryCommit, tests::TestDatabase,
    };

    const AT: &str = "2026-11-20T00:00:00Z";

    #[test]
    #[expect(
        clippy::too_many_lines,
        reason = "one SQLCipher history verifies the same asset across current, conflicting, empty and revoked inventories"
    )]
    fn current_registrar_inventory_feeds_library_detail_and_renewals_without_reviving_history() {
        let mut db = TestDatabase::open([0x74; 32]);
        let expiry: String = db
            .store
            .raw_connection()
            .query_row("SELECT date('now', '+10 days')", [], |r| r.get(0))
            .unwrap();
        let row = DesktopRegistrationFact {
            domain: "renew.test".into(),
            registered_on: "2025-01-01".into(),
            expires_on: Some(expiry.clone()),
            auto_renew: Some(true),
            locked: Some(false),
            standing: DesktopRegistrationStanding::Active,
        };
        let spaceship = db
            .prepare_spaceship_connection("Spaceship", AT, || Ok(()))
            .unwrap();
        db.import_spaceship_inventory(
            &SpaceshipInventoryCommit {
                seed: &spaceship,
                registrations: std::slice::from_ref(&row),
                device_id: "device-local",
                lease_epoch: 1,
                at: AT,
            },
            || Ok(()),
        )
        .unwrap();
        let library = db.read_asset_library(0, 10, "").unwrap();
        assert_eq!(library.expiring_within60_days, 1);
        assert_eq!(
            library.window.rows[0].expires_on.as_deref(),
            Some(expiry.as_str())
        );
        assert!(library.window.rows[0].expiring);
        let detail = db.read_domain_detail("renew.test").unwrap().asset;
        assert_eq!(detail.registrar.as_deref(), Some("Spaceship"));
        assert_eq!(
            (detail.auto_renew, detail.registrar_lock),
            (Some(true), Some(false))
        );
        let renewals = db.read_renewals(0, 10).unwrap();
        assert_eq!(
            (renewals.total_rows, renewals.auto_renew_enabled_count),
            (1, 1)
        );
        assert_eq!(renewals.window.rows[0].expires_on, expiry);
        assert_eq!(
            renewals.window.rows[0].registrar_name.as_deref(),
            Some("Spaceship")
        );
        db.store.fixture_connection().execute(
            "UPDATE domain_assets SET expires_on=?1,auto_renew=0,registrar_lock=1 WHERE entity_id='renew.test'",
            [&expiry],
        ).unwrap();

        let aliyun = db
            .prepare_aliyun_connection("Aliyun", AT, || Ok(()))
            .unwrap();
        db.import_aliyun_inventory(
            &AliyunInventoryCommit {
                seed: &aliyun,
                registrations: &[DesktopRegistrationFact {
                    auto_renew: None,
                    locked: Some(true),
                    ..row
                }],
                device_id: "device-local",
                lease_epoch: 1,
                at: AT,
            },
            || Ok(()),
        )
        .unwrap();
        let detail = db.read_domain_detail("renew.test").unwrap().asset;
        assert_eq!(
            (
                detail.registrar,
                detail.expires_on,
                detail.auto_renew,
                detail.registrar_lock
            ),
            (None, None, None, None)
        );
        assert_eq!(db.read_renewals(0, 10).unwrap().total_rows, 0);

        let spaceship = db
            .begin_spaceship_scan(&spaceship.connection_id, || Ok(()))
            .unwrap();
        db.import_spaceship_inventory(
            &SpaceshipInventoryCommit {
                seed: &spaceship,
                registrations: &[],
                device_id: "device-local",
                lease_epoch: 1,
                at: AT,
            },
            || Ok(()),
        )
        .unwrap();
        let fresh = db.read_domain_detail("renew.test").unwrap().asset;
        assert_eq!(fresh.registrar.as_deref(), Some("Aliyun"));
        assert_eq!(fresh.expires_on.as_deref(), Some(expiry.as_str()));
        assert_eq!((fresh.auto_renew, fresh.registrar_lock), (None, Some(true)));
        let aliyun = db.aliyun_connection(&aliyun.connection_id).unwrap();
        db.revoke_aliyun_connection(&aliyun, AT, || Ok(())).unwrap();
        assert!(
            db.read_domain_detail("renew.test")
                .unwrap()
                .asset
                .expires_on
                .is_none()
        );
        assert_eq!(db.read_renewals(0, 10).unwrap().total_rows, 0);
        let historical: i64 = db
            .store
            .raw_connection()
            .query_row(
                "SELECT count(*) FROM registrar_observations WHERE entity_id='renew.test'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(historical, 2);
    }

    #[test]
    fn current_registrar_inventory_cannot_rebind_an_observation_to_a_readded_asset() {
        let mut db = TestDatabase::open([0x75; 32]);
        let domain = "readded.test";
        let remote = |name: &str, generation: u64, base: u64, note: Option<&str>| {
            let mut wire = serde_json::json!({
                "schemaVersion":3, "mutationId":name, "workspaceId":"workspace-local",
                "workspaceSchemaVersion":1, "entityType":"domain_asset", "entityId":domain,
                "entityGeneration":generation, "operationKind":"upsert", "baseServerRevision":base,
                "changedFields":[{"fieldPath":"note","value":note}],
                "sourceDeviceId":"device-other","activeLeaseEpoch":1,"deviceMutationSequence":1,
                "serverRevision":base+1,
            });
            if note.is_none() {
                wire["operationKind"] = serde_json::json!("delete");
                wire["changedFields"] = serde_json::json!([]);
                wire["deletedAt"] = serde_json::json!(AT);
            }
            wire
        };
        let pull = |db: &mut BusinessDatabase, from: u64, mutations: Vec<serde_json::Value>| {
            let through = from + u64::try_from(mutations.len()).unwrap();
            let mut page = serde_json::json!({
                "schemaVersion":3, "workspaceId":"workspace-local", "fromServerRevisionExclusive":from,
                "throughServerRevisionInclusive":through, "returnedThroughServerRevision":through,
                "mutations":mutations, "nextCursor":null, "pageDigest":"A".repeat(43),
            });
            page["pageDigest"] = serde_json::Value::String(canonical_page_digest(&page).unwrap());
            db.apply_sync_page_v2(
                "reader-registrar",
                &page.to_string(),
                &format!("confirm-{through}"),
            )
            .unwrap();
        };
        pull(&mut db, 0, vec![remote("first-life", 1, 0, Some("first"))]);
        let connection = db
            .prepare_spaceship_connection("Spaceship", AT, || Ok(()))
            .unwrap();
        let rows = [DesktopRegistrationFact {
            domain: domain.to_owned(),
            registered_on: "2025-01-01".into(),
            expires_on: Some("2027-12-01".into()),
            auto_renew: Some(true),
            locked: Some(true),
            standing: DesktopRegistrationStanding::Active,
        }];
        db.import_spaceship_inventory(
            &SpaceshipInventoryCommit {
                seed: &connection,
                registrations: &rows,
                device_id: "device-local",
                lease_epoch: 1,
                at: AT,
            },
            || Ok(()),
        )
        .unwrap();
        assert_eq!(
            db.read_domain_detail(domain)
                .unwrap()
                .asset
                .registrar
                .as_deref(),
            Some("Spaceship")
        );
        let mut readd = remote("second-life", 2, 2, Some("second"));
        readd["reAddsDeletedRevision"] = serde_json::json!(2);
        pull(&mut db, 1, vec![remote("deleted", 1, 1, None), readd]);
        let asset = db.read_domain_detail(domain).unwrap().asset;
        assert_eq!(
            (asset.registrar, asset.expires_on, asset.auto_renew),
            (None, None, None)
        );
        let scan = db
            .begin_spaceship_scan(&connection.connection_id, || Ok(()))
            .unwrap();
        db.import_spaceship_inventory(
            &SpaceshipInventoryCommit {
                seed: &scan,
                registrations: &rows,
                device_id: "device-local",
                lease_epoch: 1,
                at: AT,
            },
            || Ok(()),
        )
        .unwrap();
        let asset = db.read_domain_detail(domain).unwrap().asset;
        assert_eq!(asset.expires_on.as_deref(), Some("2027-12-01"));
        assert_eq!(asset.note.as_deref(), Some("second"));
    }
}
