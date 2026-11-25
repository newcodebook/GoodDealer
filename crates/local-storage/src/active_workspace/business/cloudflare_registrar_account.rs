//! The direct Cloudflare Registrar connection and complete scan share one workspace transaction.
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
pub enum DesktopCloudflareRegistrarAccountState {
    Prepared,
    Active,
    Revoked,
}

use DesktopCloudflareRegistrarAccountState::{Active, Prepared, Revoked};

#[derive(Clone, PartialEq, Eq)]
pub(crate) struct RegistrarAccountRequest {
    pub id: String,
    pub device_id: String,
    lease_epoch: i64,
}

impl RegistrarAccountRequest {
    pub(crate) fn matches(&self, device_id: &str, epoch: u64) -> bool {
        self.device_id == device_id && i64::try_from(epoch) == Ok(self.lease_epoch)
    }

    fn new(device_id: &str, lease_epoch: u64) -> Result<Self> {
        Ok(Self {
            id: random_id()?,
            device_id: device_id.to_owned(),
            lease_epoch: i64::try_from(lease_epoch)
                .map_err(|_| BusinessDatabaseError::InvalidInput)?,
        })
    }
}

#[derive(PartialEq, Eq)]
pub(crate) struct RegistrarAccountSeed {
    pub connection_id: String,
    pub incarnation_id: String,
    pub credential_proof: String,
    pub state: DesktopCloudflareRegistrarAccountState,
    pub request: Option<RegistrarAccountRequest>,
    pub account_scope_digest: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopCloudflareRegistrarAccountSummary {
    pub connection_id: String,
    pub state: DesktopCloudflareRegistrarAccountState,
    pub scan_pending: bool,
    pub last_scan: Option<DesktopRegistrarScanReceipt>,
}

pub(crate) struct RegistrarAccountCommit<'a> {
    pub seed: &'a RegistrarAccountSeed,
    pub registrations: &'a [DesktopRegistrationFact],
    pub scope_digest: &'a str,
    pub device_id: &'a str,
    pub lease_epoch: u64,
    pub at: &'a str,
}

fn storage(_: rusqlite::Error) -> BusinessDatabaseError {
    BusinessDatabaseError::StorageRejected
}

fn state(
    row: &rusqlite::Row<'_>,
    column: usize,
) -> rusqlite::Result<DesktopCloudflareRegistrarAccountState> {
    match row.get_ref(column)?.as_str()? {
        "prepared" => Ok(Prepared),
        "active" => Ok(Active),
        "revoked" => Ok(Revoked),
        _ => Err(rusqlite::Error::InvalidQuery),
    }
}

const SLOT_VIEW: &str =
    "FROM cloudflare_registrar_account_slots s
     JOIN local_provider_connections c USING(workspace_id,connection_id)
     LEFT JOIN cloudflare_registrar_account_scans r ON r.workspace_id=s.workspace_id
        AND r.scan_id=(SELECT latest.scan_id FROM cloudflare_registrar_account_scans latest
          WHERE latest.workspace_id=s.workspace_id AND latest.connection_id=s.connection_id
          ORDER BY latest.rowid DESC LIMIT 1)
     WHERE s.workspace_id=?1 AND c.provider_kind='cloudflare'
       AND c.connection_incarnation_id=s.incarnation_id AND json(c.capabilities_json)='[\"registrar\"]'
       AND s.purged_at IS NULL AND c.deleted_at IS NULL AND (
         (s.state='prepared' AND c.credential_use_state='inactive' AND c.lifecycle_status='invalid' AND c.revoked_at IS NULL)
         OR (s.state='active' AND c.credential_use_state='active' AND c.lifecycle_status='active' AND c.validation_status='valid' AND c.revoked_at IS NULL)
         OR (s.state='revoked' AND c.credential_use_state='revoked' AND c.lifecycle_status='revoked' AND c.revoked_at IS NOT NULL)
       )";

fn seed(connection: &Connection, workspace: &str, id: &str) -> Result<RegistrarAccountSeed> {
    if !is_uuid_v4(id) {
        return Err(BusinessDatabaseError::InvalidInput);
    }
    let slot = connection
        .query_row(
            &format!(
                "SELECT s.connection_id,s.incarnation_id,s.credential_proof,s.state,
               s.request_id,s.request_device_id,s.request_lease_epoch,r.account_scope_digest
           {SLOT_VIEW} AND s.connection_id=?2"
            ),
            params![workspace, id],
            |row| {
                let request = if let Some(id) = row.get(4)? {
                    Some(RegistrarAccountRequest {
                        id,
                        device_id: row.get(5)?,
                        lease_epoch: row.get(6)?,
                    })
                } else {
                    None
                };
                Ok(RegistrarAccountSeed {
                    connection_id: row.get(0)?,
                    incarnation_id: row.get(1)?,
                    credential_proof: row.get(2)?,
                    state: state(row, 3)?,
                    request,
                    account_scope_digest: row.get(7)?,
                })
            },
        )
        .optional()
        .map_err(storage)?
        .ok_or(BusinessDatabaseError::MutationStale)?;
    validate_sha256_hex(&slot.credential_proof)?;
    if let Some(scope) = &slot.account_scope_digest {
        validate_sha256_hex(scope)?;
    }
    if !is_uuid_v4(&slot.incarnation_id)
        || slot
            .request
            .as_ref()
            .is_some_and(|request| !is_uuid_v4(&request.id))
        || (slot.state == Active && slot.account_scope_digest.is_none())
    {
        return Err(BusinessDatabaseError::StorageRejected);
    }
    Ok(slot)
}

impl BusinessDatabase {
    pub(crate) fn prepare_cloudflare_registrar_account<G>(
        &mut self,
        device_id: &str,
        lease_epoch: u64,
        at: &str,
        guard: impl FnOnce() -> Result<G>,
    ) -> Result<RegistrarAccountSeed> {
        let id = random_id()?;
        let incarnation = random_id()?;
        let proof = hex_digest(random_id()?.as_bytes());
        let request = RegistrarAccountRequest::new(device_id, lease_epoch)?;
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
             VALUES (?1,?2,'cloudflare','Cloudflare Registrar',?3,'invalid','[\"registrar\"]',?3,'unknown',?4,'inactive')",
            params![workspace,id,at,incarnation],
        ).map_err(storage)?;
        tx.execute(
            "INSERT INTO cloudflare_registrar_account_slots
               (workspace_id,connection_id,incarnation_id,credential_proof,state,request_id,request_device_id,request_lease_epoch,created_at)
             VALUES (?1,?2,?3,?4,'prepared',?5,?6,?7,?8)",
            params![workspace,id,incarnation,proof,request.id,request.device_id,request.lease_epoch,at],
        ).map_err(storage)?;
        let seed = seed(&tx, workspace, &id)?;
        let _guard = guard()?;
        tx.commit().map_err(storage)?;
        Ok(seed)
    }

    pub(crate) fn cloudflare_registrar_account(&self, id: &str) -> Result<RegistrarAccountSeed> {
        seed(self.store.raw_connection(), &self.workspace_id, id)
    }

    pub(crate) fn cloudflare_registrar_account_summaries(
        &self,
        execution: Option<(&str, u64)>,
    ) -> Result<Vec<DesktopCloudflareRegistrarAccountSummary>> {
        let mut query = self.store.raw_connection().prepare(&format!(
            "SELECT s.connection_id,s.state,r.observed_count,r.imported_count,r.skipped_count,r.completed_at,
               coalesce(s.request_device_id=?2 AND s.request_lease_epoch=?3,0)
             {SLOT_VIEW} ORDER BY s.created_at DESC,s.connection_id"
        )).map_err(storage)?;
        let (device_id, epoch) = if let Some((device_id, epoch)) = execution {
            (
                Some(device_id),
                Some(i64::try_from(epoch).map_err(|_| BusinessDatabaseError::InvalidInput)?),
            )
        } else {
            (None, None)
        };
        let summaries = query
            .query_map(params![self.workspace_id, device_id, epoch], |row| {
                Ok(DesktopCloudflareRegistrarAccountSummary {
                    connection_id: row.get(0)?,
                    state: state(row, 1)?,
                    scan_pending: row.get(6)?,
                    last_scan: if let Some(completed_at) = row.get(5)? {
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
        if summaries.len() > usize::from(super::super::settings::MAX_CONNECTIONS)
            || summaries.iter().any(|summary| {
                !is_uuid_v4(&summary.connection_id)
                    || (summary.state == Active && summary.last_scan.is_none())
            })
        {
            return Err(BusinessDatabaseError::StorageRejected);
        }
        Ok(summaries)
    }

    pub(crate) fn queue_cloudflare_registrar_account_scan<G>(
        &mut self,
        id: &str,
        device_id: &str,
        epoch: u64,
        guard: impl FnOnce() -> Result<G>,
    ) -> Result<()> {
        let workspace = &self.workspace_id;
        let tx = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(storage)?;
        let current = seed(&tx, workspace, id)?;
        let handoff: bool = tx
            .query_row(
                "SELECT EXISTS (SELECT 1 FROM device_handoff_barriers WHERE workspace_id=?1)",
                [workspace],
                |row| row.get(0),
            )
            .map_err(storage)?;
        if current.state != Active || handoff {
            return Err(BusinessDatabaseError::MutationStale);
        }
        if current
            .request
            .as_ref()
            .is_none_or(|work| !work.matches(device_id, epoch))
        {
            let request = RegistrarAccountRequest::new(device_id, epoch)?;
            let changed = tx.execute(
                "UPDATE cloudflare_registrar_account_slots SET request_id=?3,request_device_id=?4,request_lease_epoch=?5
                 WHERE workspace_id=?1 AND connection_id=?2",
                params![workspace,id,request.id,request.device_id,request.lease_epoch],
            ).map_err(storage)?;
            if changed != 1 {
                return Err(BusinessDatabaseError::MutationStale);
            }
        }
        let _guard = guard()?;
        tx.commit().map_err(storage)
    }

    pub(crate) fn import_cloudflare_registrar_account<G>(
        &mut self,
        input: &RegistrarAccountCommit<'_>,
        guard: impl FnOnce() -> Result<G>,
    ) -> Result<DesktopRegistrarScanReceipt> {
        validate_sha256_hex(input.scope_digest)?;
        let workspace = &self.workspace_id;
        let slot = input.seed;
        let request = slot
            .request
            .as_ref()
            .filter(|request| request.matches(input.device_id, input.lease_epoch))
            .ok_or(BusinessDatabaseError::MutationStale)?;
        if slot.state == Revoked
            || slot
                .account_scope_digest
                .as_deref()
                .is_some_and(|expected| expected != input.scope_digest)
        {
            return Err(BusinessDatabaseError::MutationStale);
        }
        let inventory = RegistrarInventoryBatch {
            workspace,
            connection_id: &slot.connection_id,
            registrations: input.registrations,
            device_id: input.device_id,
            lease_epoch: input.lease_epoch,
            at: input.at,
            source: RegistrarInventorySource::Cloudflare,
        };
        inventory.validate()?;
        let tx = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(storage)?;
        if seed(&tx, workspace, &slot.connection_id)? != *slot {
            return Err(BusinessDatabaseError::MutationStale);
        }
        if slot.state == Prepared {
            tx.execute(
                "UPDATE cloudflare_registrar_account_slots SET state='active' WHERE workspace_id=?1 AND connection_id=?2",
                params![workspace,slot.connection_id],
            ).map_err(storage)?;
        }
        tx.execute(
            "UPDATE local_provider_connections SET lifecycle_status='active',credential_use_state='active',
                validation_status='valid',last_validated_at=?1 WHERE workspace_id=?2 AND connection_id=?3",
            params![input.at,workspace,slot.connection_id],
        ).map_err(storage)?;
        let (observation_run, receipt) = inventory.write(&tx, &request.id)?;
        tx.execute(
            "INSERT INTO cloudflare_registrar_account_scans (workspace_id,scan_id,connection_id,observation_run_id,
               account_scope_digest,observed_count,imported_count,skipped_count,completed_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            params![workspace,request.id,slot.connection_id,observation_run,input.scope_digest,
                receipt.observed,receipt.imported,receipt.skipped,input.at],
        ).map_err(storage)?;
        tx.execute(
            "UPDATE cloudflare_registrar_account_slots SET request_id=NULL,request_device_id=NULL,request_lease_epoch=NULL
               WHERE workspace_id=?1 AND connection_id=?2",
            params![workspace,slot.connection_id],
        ).map_err(storage)?;
        tx.execute(
            "UPDATE active_workspace_metadata SET last_successful_provider_observation_at=?1,updated_at=?1 WHERE singleton=1",
            [input.at],
        ).map_err(storage)?;
        let _guard = guard()?;
        tx.commit().map_err(storage)?;
        Ok(receipt)
    }

    pub(crate) fn revoke_cloudflare_registrar_account<G>(
        &mut self,
        slot: &RegistrarAccountSeed,
        at: &str,
        guard: impl FnOnce() -> Result<G>,
    ) -> Result<RegistrarAccountSeed> {
        let workspace = &self.workspace_id;
        let tx = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(storage)?;
        let id = &slot.connection_id;
        if seed(&tx, workspace, id)? != *slot {
            return Err(BusinessDatabaseError::MutationStale);
        }
        tx.execute(
            "UPDATE cloudflare_registrar_account_slots
             SET state='revoked',request_id=NULL,request_device_id=NULL,request_lease_epoch=NULL
             WHERE workspace_id=?1 AND connection_id=?2",
            params![workspace, id],
        )
        .map_err(storage)?;
        tx.execute(
            "UPDATE local_provider_connections SET lifecycle_status='revoked',validation_status='unknown',
                revoked_at=coalesce(revoked_at,?1),active_credential_changed_at=?1 WHERE workspace_id=?2 AND connection_id=?3",
            params![at,workspace,id],
        ).map_err(storage)?;
        let revoked = seed(&tx, workspace, id)?;
        let _guard = guard()?;
        tx.commit().map_err(storage)?;
        Ok(revoked)
    }

    pub(crate) fn confirm_cloudflare_registrar_account_purge<G>(
        &mut self,
        slot: &RegistrarAccountSeed,
        at: &str,
        guard: impl FnOnce() -> Result<G>,
    ) -> Result<()> {
        let workspace = &self.workspace_id;
        let tx = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(storage)?;
        let id = &slot.connection_id;
        if slot.state != Revoked || seed(&tx, workspace, id)? != *slot {
            return Err(BusinessDatabaseError::MutationStale);
        }
        tx.execute(
            "UPDATE cloudflare_registrar_account_slots SET purged_at=?1 WHERE workspace_id=?2 AND connection_id=?3",
            params![at,workspace,id],
        ).map_err(storage)?;
        tx.execute(
            "UPDATE local_provider_connections SET lifecycle_status='deleted',deleted_at=?1 WHERE workspace_id=?2 AND connection_id=?3",
            params![at,workspace,id],
        ).map_err(storage)?;
        let _guard = guard()?;
        tx.commit().map_err(storage)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::active_workspace::business::{
        registrar_inventory::DesktopRegistrationStanding, tests::TestDatabase,
    };

    const AT: &str = "2026-11-20T00:00:00Z";
    const DEVICE: &str = "desktop-a";
    const SCOPE: &str = "1111111111111111111111111111111111111111111111111111111111111111";
    const OTHER_SCOPE: &str = "2222222222222222222222222222222222222222222222222222222222222222";

    fn receipt(
        db: &mut BusinessDatabase,
        seed: &RegistrarAccountSeed,
        scope_digest: &str,
        lease_epoch: u64,
        registrations: &[DesktopRegistrationFact],
    ) -> Result<DesktopRegistrarScanReceipt> {
        db.import_cloudflare_registrar_account(
            &RegistrarAccountCommit {
                seed,
                scope_digest,
                device_id: DEVICE,
                lease_epoch,
                registrations,
                at: AT,
            },
            || Ok(()),
        )
    }

    #[test]
    fn account_only_import_is_atomic_and_kept_out_of_zone_admission() {
        let mut db = TestDatabase::open([0x71; 32]);
        let slot = db
            .prepare_cloudflare_registrar_account(DEVICE, 1, AT, || Ok(()))
            .unwrap();
        assert!(db.cloudflare_provision_seed(&slot.connection_id).is_err());
        let expiry: String = db
            .store
            .raw_connection()
            .query_row("SELECT date('now','+12 days')", [], |row| row.get(0))
            .unwrap();
        let row = DesktopRegistrationFact {
            domain: "registered.test".to_owned(),
            registered_on: "2025-01-01".to_owned(),
            expires_on: Some(expiry.clone()),
            auto_renew: Some(true),
            locked: Some(true),
            standing: DesktopRegistrationStanding::Active,
        };
        let input = RegistrarAccountCommit {
            seed: &slot,
            scope_digest: SCOPE,
            device_id: DEVICE,
            lease_epoch: 1,
            registrations: std::slice::from_ref(&row),
            at: AT,
        };
        assert_eq!(
            db.import_cloudflare_registrar_account(&input, || Err::<(), _>(
                BusinessDatabaseError::MutationStale
            )),
            Err(BusinessDatabaseError::MutationStale)
        );
        assert_eq!(db.read_asset_library(0, 10, "").unwrap().total_rows, 0);
        assert!(
            db.cloudflare_registrar_account(&slot.connection_id)
                .unwrap()
                .state
                == Prepared
        );
        assert_eq!(
            db.import_cloudflare_registrar_account(&input, || Ok(()))
                .unwrap()
                .imported,
            1
        );
        assert!(
            db.import_cloudflare_registrar_account(&input, || Ok(()))
                .is_err()
        );
        assert_eq!(db.read_cloudflare_connection().unwrap(), (None, None));
        let detail = db.read_domain_detail(&row.domain).unwrap().asset;
        assert_eq!(detail.expires_on.as_deref(), Some(expiry.as_str()));
        assert_eq!(detail.registrar.as_deref(), Some("Cloudflare"));
        assert_eq!(detail.auto_renew, Some(true));
        assert_eq!(
            db.read_renewals(0, 20).unwrap().window.rows[0].entity_id,
            row.domain
        );

        let zone = db
            .create_cloudflare_connection_guarded(
                "11111111-1111-4111-a111-111111111111",
                "22222222-2222-4222-a222-222222222222",
                "Cloudflare DNS",
                AT,
                || Ok(()),
            )
            .unwrap();
        assert_ne!(zone.connection_id, slot.connection_id);
    }

    #[test]
    fn refresh_recovery_keeps_the_exact_lease_account_and_connection() {
        let mut db = TestDatabase::open([0x79; 32]);
        let slot = db
            .prepare_cloudflare_registrar_account(DEVICE, 1, AT, || Ok(()))
            .unwrap();
        let id = slot.connection_id.clone();
        let other = db
            .prepare_cloudflare_registrar_account(DEVICE, 1, AT, || Ok(()))
            .unwrap();
        let swapped = RegistrarAccountSeed {
            connection_id: other.connection_id,
            ..slot
        };
        assert_eq!(
            receipt(&mut db, &swapped, SCOPE, 1, &[]),
            Err(BusinessDatabaseError::MutationStale)
        );
        let slot = db.cloudflare_registrar_account(&id).unwrap();
        receipt(&mut db, &slot, SCOPE, 1, &[]).unwrap();
        db.queue_cloudflare_registrar_account_scan(&id, DEVICE, 1, || Ok(()))
            .unwrap();
        let old = db.cloudflare_registrar_account(&id).unwrap();
        db.queue_cloudflare_registrar_account_scan(&id, DEVICE, 1, || Ok(()))
            .unwrap();
        assert!(db.cloudflare_registrar_account(&id).unwrap() == old);
        let other_lease = db
            .cloudflare_registrar_account_summaries(Some((DEVICE, 2)))
            .unwrap();
        assert!(other_lease.iter().all(|row| !row.scan_pending));
        db.queue_cloudflare_registrar_account_scan(&id, DEVICE, 2, || Ok(()))
            .unwrap();
        let new = db.cloudflare_registrar_account(&id).unwrap();
        assert_eq!(
            receipt(&mut db, &old, SCOPE, 1, &[]),
            Err(BusinessDatabaseError::MutationStale)
        );
        assert_eq!(
            receipt(&mut db, &new, OTHER_SCOPE, 2, &[]),
            Err(BusinessDatabaseError::MutationStale)
        );
        let revoked = db
            .revoke_cloudflare_registrar_account(&new, AT, || Ok(()))
            .unwrap();
        assert_eq!(
            receipt(&mut db, &new, SCOPE, 2, &[]),
            Err(BusinessDatabaseError::MutationStale)
        );
        db.confirm_cloudflare_registrar_account_purge(&revoked, AT, || Ok(()))
            .unwrap();
        assert!(db.cloudflare_registrar_account(&id).is_err());
    }

    #[test]
    fn pending_scan_survives_reopen_and_handoff_refuses_both_queue_and_late_result() {
        let folder = crate::test_tempdir::tempdir().unwrap();
        let path = folder.path().join("workspace.db");
        let key = crate::LocalDatabaseKey::from_bytes([0x72; 32]);
        let open = || BusinessDatabase::open(&path, &key, "workspace-local").unwrap();
        let mut db = open();
        let slot = db
            .prepare_cloudflare_registrar_account(DEVICE, 1, AT, || Ok(()))
            .unwrap();
        let id = &slot.connection_id;
        receipt(&mut db, &slot, SCOPE, 1, &[]).unwrap();
        db.queue_cloudflare_registrar_account_scan(id, DEVICE, 1, || Ok(()))
            .unwrap();
        let pending = db.cloudflare_registrar_account(id).unwrap();
        drop(db);

        let mut db = open();
        assert!(db.cloudflare_registrar_account(id).unwrap() == pending);
        db.store.fixture_connection().execute(
            "INSERT INTO device_handoff_barriers(workspace_id,device_switch_request_id,began_at)
             VALUES ('workspace-local','test-switch',?1)", [AT],
        ).unwrap();
        assert_eq!(
            db.queue_cloudflare_registrar_account_scan(id, DEVICE, 1, || Ok(())),
            Err(BusinessDatabaseError::MutationStale)
        );
        assert!(receipt(&mut db, &pending, SCOPE, 1, &[]).is_err());
        assert!(db.cloudflare_registrar_account(id).unwrap() == pending);
        db.store
            .fixture_connection()
            .execute("DELETE FROM device_handoff_barriers", [])
            .unwrap();
        assert_eq!(
            receipt(&mut db, &pending, SCOPE, 1, &[]).unwrap().observed,
            0
        );
        assert!(
            db.cloudflare_registrar_account(id)
                .unwrap()
                .request
                .is_none()
        );
    }
}
