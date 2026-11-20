//! Aliyun connection publication and receipts, owned by the workspace business writer.
use super::{
    BusinessDatabase, BusinessDatabaseError,
    afternic::random_id,
    hex_digest, is_uuid_v4,
    registrar_inventory::{
        DesktopRegistrarScanReceipt, DesktopRegistrationFact, RegistrarInventoryBatch,
        RegistrarInventorySource,
    },
    validate_sha256_hex,
};
use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde::Serialize;

type Result<T> = std::result::Result<T, BusinessDatabaseError>;

#[derive(Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DesktopAliyunConnectionState {
    Prepared,
    Active,
    Revoked,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::active_workspace::business::{
        LocalDatabaseKey, registrar_inventory::DesktopRegistrationStanding,
    };

    const AT: &str = "2026-11-20T00:00:00Z";

    fn fact(name: &str) -> DesktopRegistrationFact {
        DesktopRegistrationFact {
            domain: name.to_owned(),
            registered_on: "2025-04-01".to_owned(),
            expires_on: Some("2027-04-01".to_owned()),
            auto_renew: Some(true),
            locked: None,
            standing: DesktopRegistrationStanding::Active,
        }
    }

    fn import(
        db: &mut BusinessDatabase,
        seed: &AliyunConnectionSeed,
        rows: &[DesktopRegistrationFact],
        fence: impl FnOnce() -> Result<()>,
    ) -> Result<DesktopRegistrarScanReceipt> {
        db.import_aliyun_inventory(
            &AliyunInventoryCommit {
                seed,
                registrations: rows,
                device_id: "device-local",
                lease_epoch: 1,
                at: AT,
            },
            fence,
        )
    }

    fn counts(db: &BusinessDatabase) -> (i64, i64, i64, i64) {
        db.store
            .raw_connection()
            .query_row(
                "SELECT (SELECT count(*) FROM domain_assets),
               (SELECT count(*) FROM sync_outbox),
               (SELECT count(*) FROM registrar_observations),
               (SELECT count(*) FROM aliyun_registrar_scans)",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap()
    }

    #[test]
    fn unfinished_scan_reopens_and_the_final_fence_covers_all_writes() {
        let dir = crate::test_tempdir::tempdir().unwrap();
        let path = dir.path().join("workspace.db");
        let key = LocalDatabaseKey::from_bytes([0x71; 32]);
        let open = || BusinessDatabase::open(&path, &key, "workspace-local").unwrap();
        let mut db = open();
        let seed = db
            .prepare_aliyun_connection("Alibaba Cloud", AT, || Ok(()))
            .unwrap();
        let rows = [fact("example.test")];
        assert_eq!(
            import(&mut db, &seed, &rows, || Err(
                BusinessDatabaseError::MutationStale
            )),
            Err(BusinessDatabaseError::MutationStale)
        );
        assert_eq!(counts(&db), (0, 0, 0, 0));
        drop(db);

        let mut db = open();
        let reopened = db.aliyun_connection(&seed.connection_id).unwrap();
        assert!(reopened == seed);
        assert!(db.aliyun_connection_summaries().unwrap()[0].scan_pending);
        let first = import(&mut db, &reopened, &rows, || Ok(())).unwrap();
        assert_eq!((first.observed, first.imported, first.skipped), (1, 1, 0));
        assert_eq!(counts(&db), (1, 1, 1, 1));
        assert_eq!(
            import(&mut db, &reopened, &rows, || Ok(())),
            Err(BusinessDatabaseError::MutationStale)
        );
        db.begin_aliyun_scan(&seed.connection_id, || Ok(()))
            .unwrap();
        drop(db);

        let mut db = open();
        let refresh = db.aliyun_connection(&seed.connection_id).unwrap();
        assert!(refresh.scan_pending);
        assert!(refresh != reopened);
        let repeat = import(&mut db, &refresh, &rows, || Ok(())).unwrap();
        assert_eq!(
            (repeat.observed, repeat.imported, repeat.skipped),
            (1, 0, 0)
        );
        assert_eq!(counts(&db), (1, 1, 2, 2));
        assert!(!db.aliyun_connection_summaries().unwrap()[0].scan_pending);
    }

    #[test]
    fn exact_connection_and_revocation_fence_reject_stale_or_cross_scope_results() {
        let mut db = super::super::tests::TestDatabase::open([0x72; 32]);
        let a = db
            .prepare_aliyun_connection("First", AT, || Ok(()))
            .unwrap();
        let b = db
            .prepare_aliyun_connection("Second", AT, || Ok(()))
            .unwrap();
        let swapped = AliyunConnectionSeed {
            connection_id: b.connection_id,
            ..a
        };
        assert_eq!(
            import(&mut db, &swapped, &[fact("example.test")], || Ok(())),
            Err(BusinessDatabaseError::MutationStale)
        );
        let b = db.aliyun_connection(&swapped.connection_id).unwrap();
        assert_eq!(
            import(
                &mut db,
                &b,
                &[fact("example.test"), fact("example.test")],
                || Ok(())
            ),
            Err(BusinessDatabaseError::InvalidInput)
        );
        let revoked = db.revoke_aliyun_connection(&b, AT, || Ok(())).unwrap();
        assert_eq!(
            import(&mut db, &b, &[], || Ok(())),
            Err(BusinessDatabaseError::MutationStale)
        );
        assert!(db.begin_aliyun_scan(&b.connection_id, || Ok(())).is_err());
        db.confirm_aliyun_purge(&revoked, AT, || Ok(())).unwrap();
        assert!(db.aliyun_connection(&b.connection_id).is_err());
        assert_eq!(counts(&db), (0, 0, 0, 0));
    }
}

#[derive(PartialEq, Eq)]
pub(crate) struct AliyunConnectionSeed {
    pub connection_id: String,
    pub incarnation_id: String,
    pub credential_proof: String,
    pub state: DesktopAliyunConnectionState,
    pub scan_pending: bool,
    pub last_scan_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopAliyunConnectionSummary {
    pub connection_id: String,
    pub state: DesktopAliyunConnectionState,
    pub scan_pending: bool,
    pub last_scan: Option<DesktopRegistrarScanReceipt>,
}

pub(crate) struct AliyunInventoryCommit<'a> {
    pub seed: &'a AliyunConnectionSeed,
    pub registrations: &'a [DesktopRegistrationFact],
    pub device_id: &'a str,
    pub lease_epoch: u64,
    pub at: &'a str,
}

fn storage(_: rusqlite::Error) -> BusinessDatabaseError {
    BusinessDatabaseError::StorageRejected
}

fn read_state(
    row: &rusqlite::Row<'_>,
    column: usize,
) -> rusqlite::Result<DesktopAliyunConnectionState> {
    use DesktopAliyunConnectionState::{Active, Prepared, Revoked};
    match row.get_ref(column)?.as_str()? {
        "prepared" => Ok(Prepared),
        "active" => Ok(Active),
        "revoked" => Ok(Revoked),
        _ => Err(rusqlite::Error::InvalidQuery),
    }
}

fn connection_seed(
    connection: &Connection,
    workspace: &str,
    id: &str,
) -> Result<AliyunConnectionSeed> {
    let seed = connection.query_row(
        "SELECT s.connection_id,s.incarnation_id,s.credential_proof,s.state,s.scan_pending,
                (SELECT r.scan_id FROM aliyun_registrar_scans r
                 WHERE r.workspace_id=s.workspace_id AND r.connection_id=s.connection_id
                 ORDER BY r.rowid DESC LIMIT 1)
           FROM aliyun_registrar_connections s JOIN local_provider_connections c USING(workspace_id,connection_id)
          WHERE s.workspace_id=?1 AND s.connection_id=?2 AND c.provider_kind='aliyun'
            AND c.connection_incarnation_id=s.incarnation_id AND json(c.capabilities_json)='[\"registrar\"]'
            AND s.purged_at IS NULL AND c.deleted_at IS NULL AND (
              (s.state='prepared' AND c.credential_use_state='inactive' AND c.lifecycle_status='invalid' AND c.revoked_at IS NULL)
              OR (s.state='active' AND c.credential_use_state='active' AND c.lifecycle_status='active' AND c.validation_status='valid' AND c.revoked_at IS NULL)
              OR (s.state='revoked' AND c.credential_use_state='revoked' AND c.lifecycle_status='revoked' AND c.revoked_at IS NOT NULL)
            )",
        params![workspace,id], |row| Ok(AliyunConnectionSeed {
            connection_id: row.get(0)?, incarnation_id: row.get(1)?, credential_proof: row.get(2)?,
            state: read_state(row, 3)?, scan_pending: row.get(4)?, last_scan_id: row.get(5)?,
        })
    ).optional().map_err(storage)?.ok_or(BusinessDatabaseError::MutationStale)?;
    validate_sha256_hex(&seed.credential_proof)?;
    if !is_uuid_v4(&seed.incarnation_id) || !is_uuid_v4(&seed.connection_id) {
        return Err(BusinessDatabaseError::StorageRejected);
    }
    Ok(seed)
}

impl BusinessDatabase {
    pub(crate) fn prepare_aliyun_connection<G>(
        &mut self,
        label: &str,
        at: &str,
        guard: impl FnOnce() -> Result<G>,
    ) -> Result<AliyunConnectionSeed> {
        if !crate::portfolio_projection::valid_connection_label(label) {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        super::validate_timestamp(Some(at.to_owned()))
            .map_err(|_| BusinessDatabaseError::InvalidInput)?;
        let seed = AliyunConnectionSeed {
            connection_id: random_id()?,
            incarnation_id: random_id()?,
            credential_proof: hex_digest(random_id()?.as_bytes()),
            state: DesktopAliyunConnectionState::Prepared,
            scan_pending: true,
            last_scan_id: None,
        };
        let workspace = &self.workspace_id;
        let tx = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(storage)?;
        let existing: i64 = tx.query_row(
            "SELECT count(*) FROM local_provider_connections WHERE workspace_id=?1 AND deleted_at IS NULL
              AND lifecycle_status<>'deleted' AND credential_use_state<>'retired'",
            [workspace], |row| row.get(0),
        ).map_err(storage)?;
        if existing >= i64::from(super::super::settings::MAX_CONNECTIONS) {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        tx.execute(
            "INSERT INTO local_provider_connections
             (workspace_id,connection_id,provider_kind,display_label,active_credential_changed_at,lifecycle_status,
              capabilities_json,created_at,validation_status,connection_incarnation_id,credential_use_state)
             VALUES (?1,?2,'aliyun',?3,?4,'invalid','[\"registrar\"]',?4,'unknown',?5,'inactive')",
             params![workspace,seed.connection_id,label,at,seed.incarnation_id],
        ).map_err(storage)?;
        tx.execute(
            "INSERT INTO aliyun_registrar_connections (workspace_id,connection_id,incarnation_id,credential_proof,state,scan_pending,created_at)
             VALUES (?1,?2,?3,?4,'prepared',1,?5)",
             params![workspace,seed.connection_id,seed.incarnation_id,seed.credential_proof,at],
        ).map_err(storage)?;
        let _guard = guard()?;
        tx.commit().map_err(storage)?;
        Ok(seed)
    }

    pub(crate) fn aliyun_connection(&self, id: &str) -> Result<AliyunConnectionSeed> {
        if !is_uuid_v4(id) {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        connection_seed(self.store.raw_connection(), &self.workspace_id, id)
    }

    pub(crate) fn aliyun_connection_summaries(
        &self,
    ) -> Result<Vec<DesktopAliyunConnectionSummary>> {
        let mut query = self.store.raw_connection().prepare(
            "SELECT s.connection_id,s.state,r.observed_count,r.imported_count,r.skipped_count,r.completed_at,s.scan_pending
             FROM aliyun_registrar_connections s
             JOIN local_provider_connections c USING(workspace_id,connection_id)
             LEFT JOIN aliyun_registrar_scans r ON r.workspace_id=s.workspace_id
              AND r.scan_id=(SELECT latest.scan_id FROM aliyun_registrar_scans latest
                WHERE latest.workspace_id=s.workspace_id AND latest.connection_id=s.connection_id
                ORDER BY latest.rowid DESC LIMIT 1)
             WHERE s.workspace_id=?1 AND s.purged_at IS NULL AND c.deleted_at IS NULL
             ORDER BY s.created_at DESC,s.connection_id",
        ).map_err(storage)?;
        let summaries = query
            .query_map([&self.workspace_id], |row| {
                Ok(DesktopAliyunConnectionSummary {
                    connection_id: row.get(0)?,
                    state: read_state(row, 1)?,
                    scan_pending: row.get(6)?,
                    last_scan: if let Some(completed_at) = row.get::<_, Option<String>>(5)? {
                        Some(DesktopRegistrarScanReceipt {
                            observed: row.get(2)?,
                            imported: row.get(3)?,
                            skipped: row.get(4)?,
                            completed_at,
                        })
                    } else {
                        None
                    },
                })
            })
            .map_err(storage)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(storage)?;
        if summaries.len() > usize::from(super::super::settings::MAX_CONNECTIONS) {
            return Err(BusinessDatabaseError::StorageRejected);
        }
        Ok(summaries)
    }

    pub(crate) fn begin_aliyun_scan<G>(
        &mut self,
        id: &str,
        guard: impl FnOnce() -> Result<G>,
    ) -> Result<AliyunConnectionSeed> {
        if !is_uuid_v4(id) {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        let workspace = &self.workspace_id;
        let tx = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(storage)?;
        let mut seed = connection_seed(&tx, workspace, id)?;
        if seed.state == DesktopAliyunConnectionState::Revoked {
            return Err(BusinessDatabaseError::MutationStale);
        }
        if !seed.scan_pending {
            tx.execute(
                "UPDATE aliyun_registrar_connections SET scan_pending=1 WHERE workspace_id=?1 AND connection_id=?2",
                params![workspace,id],
            ).map_err(storage)?;
            seed.scan_pending = true;
        }
        let _guard = guard()?;
        tx.commit().map_err(storage)?;
        Ok(seed)
    }

    /// Absence in a scan can never delete an asset or assert loss of ownership.
    pub(crate) fn import_aliyun_inventory<G>(
        &mut self,
        input: &AliyunInventoryCommit<'_>,
        guard: impl FnOnce() -> Result<G>,
    ) -> Result<DesktopRegistrarScanReceipt> {
        use DesktopAliyunConnectionState::{Prepared, Revoked};
        let seed = input.seed;
        let workspace = &self.workspace_id;
        let inventory = RegistrarInventoryBatch {
            workspace,
            connection_id: &seed.connection_id,
            registrations: input.registrations,
            device_id: input.device_id,
            lease_epoch: input.lease_epoch,
            at: input.at,
            source: RegistrarInventorySource::Aliyun,
        };
        inventory.validate()?;
        if seed.state == Revoked
            || !seed.scan_pending
            || input
                .registrations
                .iter()
                .any(|row| row.expires_on.is_none())
        {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        let tx = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(storage)?;
        if connection_seed(&tx, workspace, &seed.connection_id)? != *seed {
            return Err(BusinessDatabaseError::MutationStale);
        }
        if seed.state == Prepared {
            tx.execute(
                "UPDATE aliyun_registrar_connections SET state='active' WHERE workspace_id=?1 AND connection_id=?2",
                params![workspace,seed.connection_id],
            ).map_err(storage)?;
        }
        tx.execute(
            "UPDATE local_provider_connections SET lifecycle_status='active',credential_use_state='active',
             validation_status='valid',last_validated_at=?1 WHERE workspace_id=?2 AND connection_id=?3",
            params![input.at,workspace,seed.connection_id],
        ).map_err(storage)?;
        let run = random_id()?;
        let (observation_run, receipt) = inventory.write(&tx, &run)?;
        tx.execute(
            "INSERT INTO aliyun_registrar_scans (workspace_id,scan_id,connection_id,observation_run_id,
              observed_count,imported_count,skipped_count,completed_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
            params![workspace,run,seed.connection_id,observation_run,receipt.observed,receipt.imported,receipt.skipped,input.at],
        ).map_err(storage)?;
        tx.execute(
            "UPDATE aliyun_registrar_connections SET scan_pending=0 WHERE workspace_id=?1 AND connection_id=?2",
            params![workspace,seed.connection_id],
        ).map_err(storage)?;
        tx.execute(
            "UPDATE active_workspace_metadata SET last_successful_provider_observation_at=?1,updated_at=?1 WHERE singleton=1",
            [input.at],
        ).map_err(storage)?;
        let _guard = guard()?;
        tx.commit().map_err(storage)?;
        Ok(receipt)
    }

    pub(crate) fn revoke_aliyun_connection<G>(
        &mut self,
        seed: &AliyunConnectionSeed,
        at: &str,
        guard: impl FnOnce() -> Result<G>,
    ) -> Result<AliyunConnectionSeed> {
        super::validate_timestamp(Some(at.to_owned()))
            .map_err(|_| BusinessDatabaseError::InvalidInput)?;
        let workspace = &self.workspace_id;
        let tx = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(storage)?;
        if connection_seed(&tx, workspace, &seed.connection_id)? != *seed {
            return Err(BusinessDatabaseError::MutationStale);
        }
        tx.execute(
            "UPDATE aliyun_registrar_connections SET state='revoked',scan_pending=0 WHERE workspace_id=?1 AND connection_id=?2",
            params![workspace,seed.connection_id],
        ).map_err(storage)?;
        tx.execute(
            "UPDATE local_provider_connections SET lifecycle_status='revoked',validation_status='unknown',
               revoked_at=coalesce(revoked_at,?1),active_credential_changed_at=?1 WHERE workspace_id=?2 AND connection_id=?3",
            params![at,workspace,seed.connection_id],
        ).map_err(storage)?;
        let revoked = connection_seed(&tx, workspace, &seed.connection_id)?;
        let _guard = guard()?;
        tx.commit().map_err(storage)?;
        Ok(revoked)
    }

    pub(crate) fn confirm_aliyun_purge<G>(
        &mut self,
        seed: &AliyunConnectionSeed,
        at: &str,
        guard: impl FnOnce() -> Result<G>,
    ) -> Result<()> {
        super::validate_timestamp(Some(at.to_owned()))
            .map_err(|_| BusinessDatabaseError::InvalidInput)?;
        let workspace = &self.workspace_id;
        let tx = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(storage)?;
        if seed.state != DesktopAliyunConnectionState::Revoked
            || connection_seed(&tx, workspace, &seed.connection_id)? != *seed
        {
            return Err(BusinessDatabaseError::MutationStale);
        }
        tx.execute(
            "UPDATE aliyun_registrar_connections SET purged_at=?1 WHERE workspace_id=?2 AND connection_id=?3",
            params![at,workspace,seed.connection_id],
        ).map_err(storage)?;
        tx.execute(
            "UPDATE local_provider_connections SET lifecycle_status='deleted',deleted_at=?1 WHERE workspace_id=?2 AND connection_id=?3",
            params![at,workspace,seed.connection_id],
        ).map_err(storage)?;
        let _guard = guard()?;
        tx.commit().map_err(storage)
    }
}
