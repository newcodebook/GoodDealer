//! Sedo portfolio publication and refresh in the workspace business writer.
use super::{
    BusinessDatabase, BusinessDatabaseError, afternic::random_id, assets::import_discovered_asset,
    hex_digest, is_uuid_v4, validate_domain_asset_id, validate_sha256_hex,
};
use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior, params};
use serde::Serialize;
use std::collections::BTreeSet;

type Result<T> = std::result::Result<T, BusinessDatabaseError>;

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopSedoMarketplaceScanReceipt {
    pub observed: u32,
    pub imported: u32,
    pub skipped: u32,
    pub completed_at: String,
}

/// Only these allowlisted facts can reach the workspace writer from the Native service.
pub struct DesktopSedoMarketplaceListingFact {
    pub domain: String,
    pub for_sale: bool,
    pub fixed_price: bool,
    pub price_cents: Option<u64>,
    pub currency: DesktopSedoCurrency,
}

#[derive(Clone, Copy)]
pub enum DesktopSedoCurrency {
    Eur,
    Usd,
    Gbp,
}

impl DesktopSedoCurrency {
    fn code(self) -> &'static str {
        match self {
            Self::Eur => "EUR",
            Self::Usd => "USD",
            Self::Gbp => "GBP",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DesktopSedoConnectionState {
    Prepared,
    Active,
    Revoked,
}

#[derive(PartialEq, Eq)]
pub(crate) struct SedoMarketplaceConnectionSeed {
    pub connection_id: String,
    pub incarnation_id: String,
    pub credential_proof: String,
    pub state: DesktopSedoConnectionState,
    pending: Option<SedoMarketplaceScanRequest>,
}

impl SedoMarketplaceConnectionSeed {
    pub(crate) fn has_scan_for(&self, device_id: &str, lease_epoch: u64) -> bool {
        self.pending.as_ref().is_some_and(|request| {
            request.device_id == device_id && i64::try_from(lease_epoch) == Ok(request.lease_epoch)
        })
    }
}

#[derive(PartialEq, Eq)]
struct SedoMarketplaceScanRequest {
    id: String,
    device_id: String,
    lease_epoch: i64,
}

fn insert_scan_request(
    tx: &Connection,
    workspace: &str,
    seed: &SedoMarketplaceConnectionSeed,
    (device_id, lease_epoch): (&str, u64),
) -> Result<()> {
    let epoch = i64::try_from(lease_epoch).map_err(|_| BusinessDatabaseError::InvalidInput)?;
    tx.execute(
        "INSERT INTO sedo_marketplace_pending_scans
           (workspace_id,connection_id,incarnation_id,device_id,lease_epoch,request_id)
         VALUES (?1,?2,?3,?4,?5,?6)",
        params![
            workspace,
            seed.connection_id,
            seed.incarnation_id,
            device_id,
            epoch,
            random_id()?
        ],
    )
    .map_err(storage)?;
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopSedoMarketplaceConnectionSummary {
    pub connection_id: String,
    pub state: DesktopSedoConnectionState,
    pub scan_pending: bool,
    pub last_scan: Option<DesktopSedoMarketplaceScanReceipt>,
}

pub(crate) struct SedoMarketplaceInventoryCommit<'a> {
    pub seed: &'a SedoMarketplaceConnectionSeed,
    pub listings: &'a [DesktopSedoMarketplaceListingFact],
    pub device_id: &'a str,
    pub lease_epoch: u64,
    pub at: &'a str,
}

impl SedoMarketplaceInventoryCommit<'_> {
    fn validate(&self) -> Result<()> {
        let invalid = BusinessDatabaseError::InvalidInput;
        super::validate_timestamp(Some(self.at.to_owned())).map_err(|_| invalid)?;
        if self.listings.len() > 10_000 {
            return Err(invalid);
        }
        let mut domains = BTreeSet::new();
        for item in self.listings {
            validate_domain_asset_id(&item.domain).map_err(|_| invalid)?;
            if !domains.insert(&item.domain) {
                return Err(invalid);
            }
            if item
                .price_cents
                .is_some_and(|price| !(1..=9_007_199_254_740_991).contains(&price))
            {
                return Err(invalid);
            }
        }
        Ok(())
    }

    fn write<'a>(
        &self,
        tx: &Transaction<'_>,
        workspace: &str,
        run: &'a str,
    ) -> Result<(Option<&'a str>, DesktopSedoMarketplaceScanReceipt)> {
        let connection = &self.seed.connection_id;
        let mut persisted_run = None;
        let mut receipt = DesktopSedoMarketplaceScanReceipt {
            observed: u32::try_from(self.listings.len())
                .map_err(|_| BusinessDatabaseError::InvalidInput)?,
            imported: 0,
            skipped: 0,
            completed_at: self.at.to_owned(),
        };
        for (ordinal, item) in self.listings.iter().enumerate() {
            let Some(imported) = import_discovered_asset(
                tx,
                workspace,
                &random_id()?,
                self.device_id,
                self.lease_epoch,
                self.at,
                &item.domain,
            )?
            else {
                receipt.skipped += 1;
                continue;
            };
            if persisted_run.is_none() {
                tx.execute(
                    "INSERT INTO provider_observation_runs (workspace_id,observation_run_id,connection_id,
                     observation_capability,started_at,status,connector_version)
                     VALUES (?1,?2,?3,'marketplace',?4,'running','sedo-marketplace-v1')",
                    params![workspace,run,connection,self.at],
                ).map_err(storage)?;
                persisted_run = Some(run);
            }
            receipt.imported += u32::from(imported);
            self.write_listing(tx, workspace, run, ordinal, item)?;
        }
        if persisted_run.is_some() {
            tx.execute(
                "UPDATE provider_observation_runs SET status='succeeded',completed_at=?1
                 WHERE workspace_id=?2 AND observation_run_id=?3",
                params![self.at, workspace, run],
            )
            .map_err(storage)?;
        }
        Ok((persisted_run, receipt))
    }

    fn write_listing(
        &self,
        tx: &Connection,
        workspace: &str,
        run: &str,
        ordinal: usize,
        item: &DesktopSedoMarketplaceListingFact,
    ) -> Result<()> {
        let domain = &item.domain;
        let connection = &self.seed.connection_id;
        let asset_generation: i64 = tx
            .query_row(
                "SELECT entity_generation FROM domain_assets
             WHERE workspace_id=?1 AND entity_id=?2 AND deleted_at IS NULL",
                params![workspace, domain],
                |row| row.get(0),
            )
            .map_err(storage)?;
        let sequence: i64 = tx.query_row(
            "UPDATE active_workspace_metadata SET local_commit_sequence=local_commit_sequence+1,updated_at=?1
             WHERE singleton=1 RETURNING local_commit_sequence", [self.at], |row| row.get(0),
        ).map_err(|_| BusinessDatabaseError::SequenceExhausted)?;
        let currency = item.currency.code();
        let amount = item
            .price_cents
            .map(|price| format!("{}.{:02}", price / 100, price % 100));
        let observed = hex_digest(format!(
            "gooddealer:sedo:observation:v1:{connection}:{domain}:{asset_generation}:{}:{}:{currency}:{}",
            item.for_sale, item.fixed_price, amount.as_deref().unwrap_or_default(),
        ).as_bytes());
        let (resource, binding_generation) =
            self.write_binding(tx, workspace, domain, asset_generation, sequence, &observed)?;
        tx.execute(
            "INSERT INTO provider_observation_targets (workspace_id,observation_run_id,entity_id,ordinal,status,requested_at)
             VALUES (?1,?2,?3,?4,'requested',?5)",
            params![workspace,run,domain,i64::try_from(ordinal).map_err(|_| BusinessDatabaseError::InvalidInput)?,self.at],
        ).map_err(storage)?;
        tx.execute(
            "INSERT INTO marketplace_listing_observations (workspace_id,listing_observation_id,observation_run_id,
             entity_id,marketplace_kind,listing_status,observed_at,provider_version_token,observation_availability,
             evidence_status,asking_price_currency,asking_price_amount,binding_connection_id,
             binding_resource_digest,binding_generation,sedo_asset_generation,sedo_for_sale,sedo_fixed_price)
             VALUES (?1,?2,?3,?4,'sedo','unknown',?5,?6,'available','confirmed',
                CASE WHEN ?7 IS NOT NULL THEN ?8 END,?7,?9,?10,?11,?12,?13,?14)",
            params![workspace,random_id()?,run,domain,self.at,observed,
                amount,currency,connection,resource,binding_generation,asset_generation,item.for_sale,item.fixed_price],
        ).map_err(storage)?;
        tx.execute(
            "UPDATE provider_observation_targets SET status='succeeded',completed_at=?1
             WHERE workspace_id=?2 AND observation_run_id=?3 AND entity_id=?4",
            params![self.at, workspace, run, domain],
        )
        .map_err(storage)?;
        Ok(())
    }

    fn write_binding(
        &self,
        tx: &Connection,
        workspace: &str,
        domain: &str,
        asset_generation: i64,
        sequence: i64,
        observed: &str,
    ) -> Result<(String, i64)> {
        let connection = &self.seed.connection_id;
        let current: Option<(String, i64, Option<i64>)> = tx.query_row(
            "SELECT b.resource_binding_digest,b.binding_generation,(
                SELECT m.sedo_asset_generation FROM marketplace_listing_observations m
                WHERE m.workspace_id=b.workspace_id AND m.entity_id=b.entity_id
                  AND m.marketplace_kind=b.provider_kind AND m.binding_connection_id=b.connection_id
                  AND m.binding_resource_digest=b.resource_binding_digest AND m.binding_generation=b.binding_generation
                ORDER BY m.rowid DESC LIMIT 1
             ) FROM domain_asset_provider_bindings b WHERE b.workspace_id=?1 AND b.entity_id=?2
               AND b.connection_id=?3 AND b.provider_kind='sedo' AND b.resource_kind='listing'
               AND b.validation_status!='detached'",
            params![workspace,domain,connection], |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?)),
        ).optional().map_err(storage)?;
        if let Some((resource, generation, prior_asset)) = current {
            if prior_asset == Some(asset_generation) {
                tx.execute(
                    "UPDATE domain_asset_provider_bindings SET observation_digest=?1,local_commit_sequence=?2,
                     last_observed_at=?3,updated_at=?3 WHERE workspace_id=?4 AND entity_id=?5 AND connection_id=?6
                     AND resource_kind='listing' AND resource_binding_digest=?7 AND binding_generation=?8",
                    params![observed,sequence,self.at,workspace,domain,connection,resource,generation],
                ).map_err(storage)?;
                return Ok((resource, generation));
            }
            // A later asset generation cannot use an earlier asset's binding, even when the
            // observed domain name is identical. Scan absence itself never detaches a binding.
            tx.execute(
                "UPDATE domain_asset_provider_bindings SET validation_status='detached',verified_at=NULL,
                 local_commit_sequence=?1,updated_at=?2 WHERE workspace_id=?3 AND entity_id=?4 AND connection_id=?5
                 AND resource_kind='listing' AND resource_binding_digest=?6 AND binding_generation=?7",
                params![sequence,self.at,workspace,domain,connection,resource,generation],
            ).map_err(storage)?;
        }
        // The API supplies no immutable Listing ID. Scope a local occurrence to this
        // connection and never reconstruct an old digest from the domain.
        let resource = hex_digest(
            format!(
                "gooddealer:sedo:listing:v1:{}:{}",
                self.seed.incarnation_id,
                random_id()?
            )
            .as_bytes(),
        );
        tx.execute(
            "INSERT INTO domain_asset_provider_bindings (workspace_id,entity_id,connection_id,provider_kind,
             resource_kind,resource_binding_digest,observation_digest,resource_label,binding_generation,
             local_commit_sequence,validation_status,last_observed_at,created_at,updated_at)
             VALUES (?1,?2,?3,'sedo','listing',?4,?5,?2,1,?6,'unverified',?7,?7,?7)",
            params![workspace,domain,connection,resource,observed,sequence,self.at],
        ).map_err(storage)?;
        Ok((resource, 1))
    }
}

fn storage(_: rusqlite::Error) -> BusinessDatabaseError {
    BusinessDatabaseError::StorageRejected
}

fn read_state(
    row: &rusqlite::Row<'_>,
    column: usize,
) -> rusqlite::Result<DesktopSedoConnectionState> {
    use DesktopSedoConnectionState::{Active, Prepared, Revoked};
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
) -> Result<SedoMarketplaceConnectionSeed> {
    let seed = connection.query_row(
        "SELECT s.connection_id,s.incarnation_id,s.credential_proof,s.state,p.request_id,p.device_id,p.lease_epoch
           FROM sedo_marketplace_connections s JOIN local_provider_connections c USING(workspace_id,connection_id)
           LEFT JOIN sedo_marketplace_pending_scans p
             ON p.workspace_id=s.workspace_id AND p.connection_id=s.connection_id AND p.incarnation_id=s.incarnation_id
          WHERE s.workspace_id=?1 AND s.connection_id=?2 AND c.provider_kind='sedo'
            AND c.connection_incarnation_id=s.incarnation_id AND json(c.capabilities_json)='[\"marketplace\"]'
            AND s.purged_at IS NULL AND c.deleted_at IS NULL AND (
              (s.state='prepared' AND c.credential_use_state='inactive' AND c.lifecycle_status='invalid' AND c.revoked_at IS NULL)
              OR (s.state='active' AND c.credential_use_state='active' AND c.lifecycle_status='active' AND c.validation_status='valid' AND c.revoked_at IS NULL)
              OR (s.state='revoked' AND c.credential_use_state='revoked' AND c.lifecycle_status='revoked' AND c.revoked_at IS NOT NULL)
            )",
        params![workspace,id], |row| {
            let pending = if let Some(id) = row.get(4)? {
                Some(SedoMarketplaceScanRequest { id, device_id: row.get(5)?, lease_epoch: row.get(6)? })
            } else {
                None
            };
            Ok(SedoMarketplaceConnectionSeed {
                connection_id: row.get(0)?, incarnation_id: row.get(1)?, credential_proof: row.get(2)?,
                state: read_state(row, 3)?, pending,
            })
        }
    ).optional().map_err(storage)?.ok_or(BusinessDatabaseError::MutationStale)?;
    validate_sha256_hex(&seed.credential_proof)?;
    if !is_uuid_v4(&seed.incarnation_id)
        || !is_uuid_v4(&seed.connection_id)
        || seed
            .pending
            .as_ref()
            .is_some_and(|request| !is_uuid_v4(&request.id))
    {
        return Err(BusinessDatabaseError::StorageRejected);
    }
    Ok(seed)
}

pub(super) fn queue_scan_in_transaction(
    tx: &Connection,
    workspace: &str,
    id: &str,
    execution: (&str, u64),
) -> Result<SedoMarketplaceConnectionSeed> {
    if !is_uuid_v4(id) {
        return Err(BusinessDatabaseError::InvalidInput);
    }
    let seed = connection_seed(tx, workspace, id)?;
    super::execution_evidence::require_no_barrier(tx, workspace)?;
    if seed.state == DesktopSedoConnectionState::Revoked {
        return Err(BusinessDatabaseError::MutationStale);
    }
    if !seed.has_scan_for(execution.0, execution.1) {
        tx.execute(
            "DELETE FROM sedo_marketplace_pending_scans WHERE workspace_id=?1 AND connection_id=?2",
            params![workspace, id],
        )
        .map_err(storage)?;
        insert_scan_request(tx, workspace, &seed, execution)?;
    }
    connection_seed(tx, workspace, id)
}

impl BusinessDatabase {
    pub(crate) fn prepare_sedo_connection<G>(
        &mut self,
        label: &str,
        at: &str,
        execution: (&str, u64),
        guard: impl FnOnce() -> Result<G>,
    ) -> Result<SedoMarketplaceConnectionSeed> {
        if !crate::portfolio_projection::valid_connection_label(label) {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        super::validate_timestamp(Some(at.to_owned()))
            .map_err(|_| BusinessDatabaseError::InvalidInput)?;
        let seed = SedoMarketplaceConnectionSeed {
            connection_id: random_id()?,
            incarnation_id: random_id()?,
            credential_proof: hex_digest(random_id()?.as_bytes()),
            state: DesktopSedoConnectionState::Prepared,
            pending: None,
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
             VALUES (?1,?2,'sedo',?3,?4,'invalid','[\"marketplace\"]',?4,'unknown',?5,'inactive')",
             params![workspace,seed.connection_id,label,at,seed.incarnation_id],
        ).map_err(storage)?;
        tx.execute(
            "INSERT INTO sedo_marketplace_connections (workspace_id,connection_id,incarnation_id,credential_proof,state,created_at)
             VALUES (?1,?2,?3,?4,'prepared',?5)",
             params![workspace,seed.connection_id,seed.incarnation_id,seed.credential_proof,at],
        ).map_err(storage)?;
        insert_scan_request(&tx, workspace, &seed, execution)?;
        let seed = connection_seed(&tx, workspace, &seed.connection_id)?;
        let _guard = guard()?;
        tx.commit().map_err(storage)?;
        Ok(seed)
    }

    pub(crate) fn sedo_connection(&self, id: &str) -> Result<SedoMarketplaceConnectionSeed> {
        if !is_uuid_v4(id) {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        connection_seed(self.store.raw_connection(), &self.workspace_id, id)
    }

    pub(crate) fn sedo_connection_summaries(
        &self,
        execution: Option<(&str, u64)>,
    ) -> Result<Vec<DesktopSedoMarketplaceConnectionSummary>> {
        let (device_id, lease_epoch) = match execution {
            Some((device, epoch)) => (
                Some(device),
                Some(i64::try_from(epoch).map_err(|_| BusinessDatabaseError::InvalidInput)?),
            ),
            None => (None, None),
        };
        let mut query = self.store.raw_connection().prepare(
            "SELECT s.connection_id,s.state,r.observed_count,r.imported_count,r.skipped_count,r.completed_at,
               EXISTS (
                 SELECT 1 FROM sedo_marketplace_pending_scans p
                 WHERE p.workspace_id=s.workspace_id AND p.connection_id=s.connection_id
                   AND p.incarnation_id=s.incarnation_id AND p.device_id=?2 AND p.lease_epoch=?3
               )
             FROM sedo_marketplace_connections s
             JOIN local_provider_connections c USING(workspace_id,connection_id)
             LEFT JOIN sedo_marketplace_scans r ON r.workspace_id=s.workspace_id
              AND r.scan_id=(SELECT latest.scan_id FROM sedo_marketplace_scans latest
                WHERE latest.workspace_id=s.workspace_id AND latest.connection_id=s.connection_id
                ORDER BY latest.rowid DESC LIMIT 1)
             WHERE s.workspace_id=?1 AND s.purged_at IS NULL AND c.deleted_at IS NULL
             ORDER BY s.created_at DESC,s.connection_id",
        ).map_err(storage)?;
        let summaries = query
            .query_map(params![self.workspace_id, device_id, lease_epoch], |row| {
                Ok(DesktopSedoMarketplaceConnectionSummary {
                    connection_id: row.get(0)?,
                    state: read_state(row, 1)?,
                    scan_pending: row.get(6)?,
                    last_scan: if let Some(completed_at) = row.get::<_, Option<String>>(5)? {
                        Some(DesktopSedoMarketplaceScanReceipt {
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

    pub(crate) fn queue_sedo_scan<G>(
        &mut self,
        id: &str,
        execution: (&str, u64),
        guard: impl FnOnce() -> Result<G>,
    ) -> Result<SedoMarketplaceConnectionSeed> {
        let workspace = &self.workspace_id;
        let tx = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(storage)?;
        let seed = queue_scan_in_transaction(&tx, workspace, id, execution)?;
        let _guard = guard()?;
        tx.commit().map_err(storage)?;
        Ok(seed)
    }

    /// Absence in a scan can never delete an asset or assert loss of ownership.
    pub(crate) fn import_sedo_inventory<G>(
        &mut self,
        input: &SedoMarketplaceInventoryCommit<'_>,
        guard: impl FnOnce() -> Result<G>,
    ) -> Result<DesktopSedoMarketplaceScanReceipt> {
        use DesktopSedoConnectionState::{Prepared, Revoked};
        let seed = input.seed;
        let workspace = &self.workspace_id;
        input.validate()?;
        if seed.state == Revoked {
            return Err(BusinessDatabaseError::MutationStale);
        }
        let request = seed
            .pending
            .as_ref()
            .filter(|_| seed.has_scan_for(input.device_id, input.lease_epoch))
            .ok_or(BusinessDatabaseError::MutationStale)?;
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
                "UPDATE sedo_marketplace_connections SET state='active' WHERE workspace_id=?1 AND connection_id=?2",
                params![workspace,seed.connection_id],
            ).map_err(storage)?;
        }
        tx.execute(
            "UPDATE local_provider_connections SET lifecycle_status='active',credential_use_state='active',
             validation_status='valid',last_validated_at=?1 WHERE workspace_id=?2 AND connection_id=?3",
            params![input.at,workspace,seed.connection_id],
        ).map_err(storage)?;
        let run = &request.id;
        let (observation_run, receipt) = input.write(&tx, workspace, run)?;
        tx.execute(
            "INSERT INTO sedo_marketplace_scans (workspace_id,scan_id,connection_id,observation_run_id,
              observed_count,imported_count,skipped_count,completed_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
            params![workspace,run,seed.connection_id,observation_run,receipt.observed,receipt.imported,receipt.skipped,input.at],
        ).map_err(storage)?;
        tx.execute(
            "UPDATE active_workspace_metadata SET last_successful_provider_observation_at=?1,updated_at=?1 WHERE singleton=1",
            [input.at],
        ).map_err(storage)?;
        let _guard = guard()?;
        tx.commit().map_err(storage)?;
        Ok(receipt)
    }

    pub(crate) fn revoke_sedo_connection<G>(
        &mut self,
        seed: &SedoMarketplaceConnectionSeed,
        at: &str,
        guard: impl FnOnce() -> Result<G>,
    ) -> Result<SedoMarketplaceConnectionSeed> {
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
            "UPDATE sedo_marketplace_connections SET state='revoked' WHERE workspace_id=?1 AND connection_id=?2",
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

    pub(crate) fn confirm_sedo_purge<G>(
        &mut self,
        seed: &SedoMarketplaceConnectionSeed,
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
        if seed.state != DesktopSedoConnectionState::Revoked
            || connection_seed(&tx, workspace, &seed.connection_id)? != *seed
        {
            return Err(BusinessDatabaseError::MutationStale);
        }
        tx.execute(
            "UPDATE sedo_marketplace_connections SET purged_at=?1 WHERE workspace_id=?2 AND connection_id=?3",
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::active_workspace::business::LocalDatabaseKey;

    #[test]
    fn current_account_inventory_and_scope_are_durable() {
        const AT: &str = "2026-11-20T00:00:00Z";
        let directory = crate::test_tempdir::tempdir().unwrap();
        let path = directory.path().join("workspace.db");
        let key = LocalDatabaseKey::from_bytes([0x78; 32]);
        let open = || BusinessDatabase::open(&path, &key, "workspace-local").unwrap();
        let mut db = open();
        let authorization = ("source-device", 1);
        let connection = db
            .prepare_sedo_connection("Sedo", AT, authorization, || Ok(()))
            .unwrap();
        let listings = [DesktopSedoMarketplaceListingFact {
            domain: "parked.test".into(),
            price_cents: Some(12_500),
            currency: DesktopSedoCurrency::Gbp,
            for_sale: false,
            fixed_price: true,
        }];
        let import =
            |db: &mut BusinessDatabase, seed: &SedoMarketplaceConnectionSeed, fence: bool| {
                db.import_sedo_inventory(
                    &SedoMarketplaceInventoryCommit {
                        seed,
                        listings: &listings,
                        device_id: authorization.0,
                        lease_epoch: authorization.1,
                        at: AT,
                    },
                    || {
                        if fence {
                            Ok(())
                        } else {
                            Err(BusinessDatabaseError::MutationStale)
                        }
                    },
                )
            };
        assert_eq!(
            import(&mut db, &connection, false),
            Err(BusinessDatabaseError::MutationStale)
        );
        assert_eq!(
            db.sedo_connection(&connection.connection_id).unwrap().state,
            DesktopSedoConnectionState::Prepared
        );
        assert_eq!(import(&mut db, &connection, true).unwrap().imported, 1);
        let observed = db.store.raw_connection().query_row(
            "SELECT sedo_for_sale,sedo_fixed_price,asking_price_currency,asking_price_amount,listing_status,binding_fresh
             FROM marketplace_listing_observations_read_facts WHERE entity_id='parked.test' AND marketplace_kind='sedo'",
            [], |row| Ok((row.get::<_, bool>(0)?,row.get::<_, bool>(1)?,row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,row.get::<_, String>(4)?,row.get::<_, bool>(5)?)),
        ).unwrap();
        assert_eq!(
            observed,
            (
                false,
                true,
                String::from("GBP"),
                String::from("125.00"),
                String::from("unknown"),
                true
            )
        );
        let pending = db
            .queue_sedo_scan(&connection.connection_id, authorization, || Ok(()))
            .unwrap();
        drop(db);
        let mut db = open();
        let restored = db.sedo_connection(&connection.connection_id).unwrap();
        assert!(restored == pending);
        assert!(db.sedo_connection_summaries(Some(authorization)).unwrap()[0].scan_pending);
        assert_eq!(import(&mut db, &restored, true).unwrap().imported, 0);
        let current = db.sedo_connection(&connection.connection_id).unwrap();
        let revoked = db.revoke_sedo_connection(&current, AT, || Ok(())).unwrap();
        assert_eq!(
            import(&mut db, &pending, true),
            Err(BusinessDatabaseError::MutationStale)
        );
        db.confirm_sedo_purge(&revoked, AT, || Ok(())).unwrap();
        assert!(
            db.sedo_connection_summaries(Some(authorization))
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn rescoped_scan_rejects_old_work_and_empty_receipt_only_expires_observations() {
        const AT: &str = "2026-11-20T00:00:00Z";
        let directory = crate::test_tempdir::tempdir().unwrap();
        let path = directory.path().join("workspace.db");
        let key = LocalDatabaseKey::from_bytes([0x79; 32]);
        let mut db = BusinessDatabase::open(&path, &key, "workspace-local").unwrap();
        let first = ("source-device", 1);
        let second = ("other-device", 2);
        let initial = db
            .prepare_sedo_connection("Sedo", AT, first, || Ok(()))
            .unwrap();
        let listings = [DesktopSedoMarketplaceListingFact {
            domain: "portfolio.test".into(),
            price_cents: Some(12_500),
            currency: DesktopSedoCurrency::Eur,
            for_sale: true,
            fixed_price: true,
        }];
        let input = |seed, listings, (device_id, lease_epoch)| SedoMarketplaceInventoryCommit {
            seed,
            listings,
            device_id,
            lease_epoch,
            at: AT,
        };
        db.import_sedo_inventory(&input(&initial, &listings, first), || Ok(()))
            .unwrap();
        let id = &initial.connection_id;
        let old_scan = db.queue_sedo_scan(id, first, || Ok(())).unwrap();
        assert!(!db.sedo_connection_summaries(Some(second)).unwrap()[0].scan_pending);
        let new_scan = db.queue_sedo_scan(id, second, || Ok(())).unwrap();
        assert_ne!(
            new_scan.pending.as_ref().unwrap().id,
            old_scan.pending.as_ref().unwrap().id
        );
        assert_eq!(
            db.import_sedo_inventory(&input(&old_scan, &[], first), || Ok(())),
            Err(BusinessDatabaseError::MutationStale)
        );
        assert_eq!(
            db.import_sedo_inventory(&input(&new_scan, &[], first), || Ok(())),
            Err(BusinessDatabaseError::MutationStale)
        );
        let empty = input(&new_scan, &[], second);
        assert_eq!(
            db.import_sedo_inventory(&empty, || Ok(()))
                .unwrap()
                .observed,
            0
        );
        assert_eq!(
            db.import_sedo_inventory(&empty, || Ok(())),
            Err(BusinessDatabaseError::MutationStale)
        );
        let stored: (bool, bool, String) = db
            .store
            .raw_connection()
            .query_row(
                "SELECT binding_fresh,binding_current,listing_status
             FROM marketplace_listing_observations_read_facts WHERE entity_id='portfolio.test'
             AND marketplace_kind='sedo'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(stored, (false, true, String::from("unknown")));
        assert_eq!(
            db.sedo_connection_summaries(Some(second)).unwrap()[0]
                .last_scan
                .as_ref()
                .unwrap()
                .observed,
            0
        );
    }
}
