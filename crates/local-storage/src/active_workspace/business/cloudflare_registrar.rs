//! Account inventory publication through the sole business writer.

use super::{
    BusinessDatabase, BusinessDatabaseError,
    afternic::random_id,
    registrar_inventory::{RegistrarInventoryBatch, RegistrarInventorySource},
    validate_sha256_hex,
};
use rusqlite::{OptionalExtension, TransactionBehavior, params};

pub use super::registrar_inventory::{
    DesktopRegistrarScanReceipt as DesktopCloudflareRegistrarScanReceipt,
    DesktopRegistrationFact as DesktopCloudflareRegistrationFact,
    DesktopRegistrationStanding as DesktopCloudflareRegistrationStanding,
};
#[derive(PartialEq, Eq)]
pub(crate) struct CloudflareRegistrarScanHead {
    pub run_id: String,
    pub account_scope_digest: String,
    pub receipt: DesktopCloudflareRegistrarScanReceipt,
}

pub(crate) struct CloudflareRegistrarInventoryCommit<'a> {
    pub request_id: &'a str,
    pub connection_id: &'a str,
    pub connection_incarnation_id: &'a str,
    pub credential_generation: u64,
    pub prior: Option<&'a CloudflareRegistrarScanHead>,
    pub account_scope_digest: &'a str,
    pub registrations: &'a [DesktopCloudflareRegistrationFact],
    pub device_id: &'a str,
    pub lease_epoch: u64,
    pub at: &'a str,
}

pub(crate) struct CloudflareRegistrarScanScope<'a> {
    pub connection_id: &'a str,
    pub connection_incarnation_id: &'a str,
    pub credential_generation: i64,
    pub device_id: &'a str,
    pub lease_epoch: i64,
}

fn pending_request(
    connection: &rusqlite::Connection,
    workspace: &str,
    scope: &CloudflareRegistrarScanScope<'_>,
) -> Result<Option<String>, BusinessDatabaseError> {
    connection
        .query_row(
            "SELECT request_id FROM cloudflare_registrar_pending_scans
         WHERE workspace_id=?1 AND connection_id=?2 AND connection_incarnation_id=?3
           AND credential_generation=?4 AND device_id=?5 AND lease_epoch=?6",
            params![
                workspace,
                scope.connection_id,
                scope.connection_incarnation_id,
                scope.credential_generation,
                scope.device_id,
                scope.lease_epoch
            ],
            |row| row.get(0),
        )
        .optional()
        .map_err(storage)
}

fn storage(_: rusqlite::Error) -> BusinessDatabaseError {
    BusinessDatabaseError::StorageRejected
}

fn current_head(
    connection: &rusqlite::Connection,
    workspace: &str,
    incarnation: &str,
    generation: i64,
) -> Result<Option<CloudflareRegistrarScanHead>, BusinessDatabaseError> {
    connection.query_row(
        "SELECT scan.scan_id, scan.account_scope_digest, scan.observed_count,
                scan.imported_count, scan.skipped_count, scan.completed_at
           FROM cloudflare_registrar_inventory_scans scan
          WHERE scan.workspace_id=?1 AND scan.connection_incarnation_id=?2 AND scan.credential_generation=?3
          ORDER BY scan.rowid DESC LIMIT 1",
        params![workspace, incarnation, generation],
        |row| Ok(CloudflareRegistrarScanHead {
            run_id: row.get(0)?,
            account_scope_digest: row.get(1)?,
            receipt: DesktopCloudflareRegistrarScanReceipt {
                observed: row.get(2)?, imported: row.get(3)?, skipped: row.get(4)?, completed_at: row.get(5)?,
            },
        }),
    ).optional().map_err(storage)
}

impl BusinessDatabase {
    pub(crate) fn cloudflare_registrar_pending_request(
        &self,
        scope: &CloudflareRegistrarScanScope<'_>,
    ) -> Result<Option<String>, BusinessDatabaseError> {
        pending_request(self.store.raw_connection(), &self.workspace_id, scope)
    }

    pub(crate) fn queue_cloudflare_registrar_scan(
        &mut self,
        scope: &CloudflareRegistrarScanScope<'_>,
        final_guard: impl FnOnce() -> Result<(), BusinessDatabaseError>,
    ) -> Result<(), BusinessDatabaseError> {
        let workspace = &self.workspace_id;
        let tx = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(storage)?;
        if pending_request(&tx, workspace, scope)?.is_none() {
            // A fresh explicit refresh can replace a request from an earlier lease. Startup
            // recovery only reads exact pending work and can never adopt that earlier request.
            tx.execute(
                "DELETE FROM cloudflare_registrar_pending_scans WHERE workspace_id=?1 AND connection_id=?2",
                params![workspace, scope.connection_id],
            ).map_err(storage)?;
            tx.execute(
                "INSERT INTO cloudflare_registrar_pending_scans
                   (workspace_id,connection_id,connection_incarnation_id,credential_generation,device_id,lease_epoch,request_id)
                 VALUES (?1,?2,?3,?4,?5,?6,?7)",
                params![workspace, scope.connection_id, scope.connection_incarnation_id,
                    scope.credential_generation, scope.device_id, scope.lease_epoch, random_id()?],
            ).map_err(storage)?;
        }
        final_guard()?;
        tx.commit().map_err(storage)
    }

    pub(crate) fn cloudflare_registrar_scan_head(
        &self,
        incarnation: &str,
        generation: u64,
    ) -> Result<Option<CloudflareRegistrarScanHead>, BusinessDatabaseError> {
        current_head(
            self.store.raw_connection(),
            &self.workspace_id,
            incarnation,
            i64::try_from(generation).map_err(|_| BusinessDatabaseError::InvalidInput)?,
        )
    }

    /// Commits only a complete scan, with ordinary asset creation and Outbox entries in the
    /// same transaction. An absence can never remove an asset or assert loss of ownership.
    pub(crate) fn import_cloudflare_registrar_inventory(
        &mut self,
        input: &CloudflareRegistrarInventoryCommit<'_>,
        final_guard: impl FnOnce() -> Result<(), BusinessDatabaseError>,
    ) -> Result<DesktopCloudflareRegistrarScanReceipt, BusinessDatabaseError> {
        validate_sha256_hex(input.account_scope_digest)?;
        let inventory = RegistrarInventoryBatch {
            workspace: &self.workspace_id,
            connection_id: input.connection_id,
            registrations: input.registrations,
            device_id: input.device_id,
            lease_epoch: input.lease_epoch,
            at: input.at,
            source: RegistrarInventorySource::Cloudflare,
        };
        inventory.validate()?;
        let generation = i64::try_from(input.credential_generation)
            .map_err(|_| BusinessDatabaseError::InvalidInput)?;
        let lease_epoch =
            i64::try_from(input.lease_epoch).map_err(|_| BusinessDatabaseError::InvalidInput)?;
        let tx = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(storage)?;
        let head = current_head(
            &tx,
            &self.workspace_id,
            input.connection_incarnation_id,
            generation,
        )?;
        if head.as_ref() != input.prior
            || head
                .as_ref()
                .is_some_and(|scan| scan.account_scope_digest != input.account_scope_digest)
        {
            return Err(BusinessDatabaseError::MutationStale);
        }
        let workspace = &self.workspace_id;
        let cleared = tx.execute(
            "DELETE FROM cloudflare_registrar_pending_scans WHERE workspace_id=?1 AND connection_id=?2
               AND connection_incarnation_id=?3 AND credential_generation=?4
               AND device_id=?5 AND lease_epoch=?6 AND request_id=?7
               AND NOT EXISTS (SELECT 1 FROM device_handoff_barriers WHERE workspace_id=?1)",
            params![workspace, input.connection_id, input.connection_incarnation_id, generation,
                input.device_id, lease_epoch, input.request_id],
        ).map_err(storage)?;
        if cleared != 1 {
            return Err(BusinessDatabaseError::MutationStale);
        }
        // Using the durable request identifier for the completed scan permits exact history
        // correlation while the transaction consumes the work only with its observations.
        let run = input.request_id;
        let qualified_role = tx
            .execute(
                "UPDATE local_provider_connections SET capabilities_json='[\"dns\",\"registrar\"]'
              WHERE workspace_id=?1 AND connection_id=?2 AND provider_kind='cloudflare'
                AND json(capabilities_json) IN ('[\"dns\"]','[\"dns\",\"registrar\"]')",
                params![workspace, input.connection_id],
            )
            .map_err(storage)?;
        if qualified_role != 1 {
            return Err(BusinessDatabaseError::MutationStale);
        }
        let (observation_run, receipt) = inventory.write(&tx, run)?;
        tx.execute(
            "INSERT INTO cloudflare_registrar_inventory_scans (workspace_id,scan_id,observation_run_id,connection_id,connection_incarnation_id,
                    credential_generation,account_scope_digest,observed_count,imported_count,skipped_count,completed_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
            params![workspace,run,observation_run,input.connection_id,input.connection_incarnation_id,generation,input.account_scope_digest,
                receipt.observed,receipt.imported,receipt.skipped,input.at],
        ).map_err(storage)?;
        tx.execute(
            "UPDATE active_workspace_metadata SET last_successful_provider_observation_at=?1,updated_at=?1 WHERE singleton=1",
            [input.at],
        ).map_err(storage)?;
        final_guard()?;
        tx.commit().map_err(storage)?;
        Ok(receipt)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::DomainAssetWrite;
    use crate::active_workspace::business::tests::TestDatabase;

    #[test]
    #[expect(
        clippy::too_many_lines,
        reason = "one SQLCipher history proves rollback, then import and tombstone skip"
    )]
    fn cloudflare_registrar_fence_rolls_back_observations_outbox_and_role() {
        let mut db = TestDatabase::open([0x62; 32]);
        let at = "2026-11-20T00:00:00Z";
        db.upsert_domain_asset(
            "zone-mutation",
            at,
            &DomainAssetWrite {
                entity_id: "anchor.test".into(),
                note: None,
                portfolio_id: None,
                tags: Vec::new(),
                target_price: None,
            },
        )
        .unwrap();
        db.seed_verified_cloudflare_binding_for_test("anchor.test");
        let snapshot = |db: &TestDatabase| -> (String, i64, i64, i64, i64) {
            db.store
                .raw_connection()
                .query_row(
                    "SELECT capabilities_json, (SELECT count(*) FROM registrar_observations),
                        (SELECT count(*) FROM cloudflare_registrar_inventory_scans),
                        (SELECT count(*) FROM sync_outbox), (SELECT count(*) FROM domain_assets)
                   FROM local_provider_connections WHERE provider_kind='cloudflare'",
                    [],
                    |row| {
                        Ok((
                            row.get(0)?,
                            row.get(1)?,
                            row.get(2)?,
                            row.get(3)?,
                            row.get(4)?,
                        ))
                    },
                )
                .unwrap()
        };
        let (connection, incarnation, generation): (String, String, i64) = db
            .store
            .raw_connection()
            .query_row(
                "SELECT logical_connection_id, connection_incarnation_id, known_envelope_generation
               FROM cloudflare_credential_roots",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        let registrations = [DesktopCloudflareRegistrationFact {
            domain: "fresh.test".into(),
            registered_on: "2026-10-20".into(),
            expires_on: None,
            auto_renew: Some(false),
            locked: Some(false),
            standing: DesktopCloudflareRegistrationStanding::Pending,
        }];
        let scope = CloudflareRegistrarScanScope {
            connection_id: &connection,
            connection_incarnation_id: &incarnation,
            credential_generation: generation,
            device_id: "device-local",
            lease_epoch: 1,
        };
        assert_eq!(
            db.queue_cloudflare_registrar_scan(&scope, || Err(
                BusinessDatabaseError::MutationStale
            )),
            Err(BusinessDatabaseError::MutationStale)
        );
        assert_eq!(
            db.cloudflare_registrar_pending_request(&scope).unwrap(),
            None
        );
        db.queue_cloudflare_registrar_scan(&scope, || Ok(()))
            .unwrap();
        let request = db
            .cloudflare_registrar_pending_request(&scope)
            .unwrap()
            .unwrap();
        db.queue_cloudflare_registrar_scan(&scope, || Ok(()))
            .unwrap();
        assert_eq!(
            db.cloudflare_registrar_pending_request(&scope)
                .unwrap()
                .as_deref(),
            Some(request.as_str())
        );
        let input = CloudflareRegistrarInventoryCommit {
            request_id: &request,
            connection_id: &connection,
            connection_incarnation_id: &incarnation,
            credential_generation: u64::try_from(generation).unwrap(),
            prior: None,
            account_scope_digest: &"ab".repeat(32),
            registrations: &registrations,
            device_id: "device-local",
            lease_epoch: 1,
            at,
        };
        let before = snapshot(&db);
        assert_eq!(
            db.import_cloudflare_registrar_inventory(&input, || Err(
                BusinessDatabaseError::MutationStale
            )),
            Err(BusinessDatabaseError::MutationStale)
        );
        assert_eq!(snapshot(&db), before);
        assert_eq!(
            db.cloudflare_registrar_pending_request(&scope)
                .unwrap()
                .as_deref(),
            Some(request.as_str())
        );
        let successful = db
            .import_cloudflare_registrar_inventory(&input, || Ok(()))
            .unwrap();
        assert_eq!(successful.imported, 1);
        assert_eq!(
            db.cloudflare_registrar_pending_request(&scope).unwrap(),
            None
        );
        let evidence: String = db
            .store
            .raw_connection()
            .query_row(
                "SELECT evidence_status FROM registrar_observations WHERE entity_id='fresh.test'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(evidence, "unknown");
        let version: i64 = db
            .store
            .raw_connection()
            .query_row(
                "SELECT local_commit_sequence FROM domain_assets WHERE entity_id='fresh.test'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        db.delete_domain_asset_guarded(
            "delete-after-inventory",
            u64::try_from(version).unwrap(),
            "device-local",
            1,
            at,
            "fresh.test",
            true,
            |_| Ok(()),
            |(), _| Ok(()),
        )
        .unwrap();
        let head = db
            .cloudflare_registrar_scan_head(&incarnation, input.credential_generation)
            .unwrap();
        db.queue_cloudflare_registrar_scan(&scope, || Ok(()))
            .unwrap();
        let next = db
            .cloudflare_registrar_pending_request(&scope)
            .unwrap()
            .unwrap();
        let skipped = db
            .import_cloudflare_registrar_inventory(
                &CloudflareRegistrarInventoryCommit {
                    request_id: &next,
                    prior: head.as_ref(),
                    ..input
                },
                || Ok(()),
            )
            .unwrap();
        assert_eq!(
            (skipped.observed, skipped.imported, skipped.skipped),
            (1, 0, 1)
        );
        let observation_run: Option<String> = db.store.raw_connection().query_row(
            "SELECT observation_run_id FROM cloudflare_registrar_inventory_scans ORDER BY rowid DESC LIMIT 1",
            [], |row| row.get(0),
        ).unwrap();
        assert_eq!(observation_run, None);
    }
}
