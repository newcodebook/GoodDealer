//! Afternic connection publication and complete inventory transactions; no credential is stored here.
use super::{
    BusinessDatabase, BusinessDatabaseError, assets::import_discovered_asset, hex_digest,
    is_uuid_v4, validate_domain_asset_id, validate_sha256_hex, validate_timestamp,
};
use rusqlite::{OptionalExtension, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct AfternicConnectionSeed {
    pub connection_id: String,
    pub connection_incarnation_id: String,
    pub credential_generation: u64,
    pub credential_public_proof: String,
    pub authority_snapshot_digest: String,
    pub publication_state: String,
}

/// Native-only bounded observation. The Renderer never supplies Provider facts.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DesktopAfternicListingObservation {
    pub domain: String,
    pub status: String,
    pub buynow_price: Option<u64>,
    pub floor_price: Option<u64>,
    pub minbid_price: Option<u64>,
    pub hidden: Option<bool>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopAfternicInventoryReceipt {
    pub observed: u32,
    pub imported: u32,
    pub skipped_deleted: Vec<String>,
}

fn timestamp(value: &str) -> Result<(), BusinessDatabaseError> {
    validate_timestamp(Some(value.to_owned()))
        .map(|_| ())
        .map_err(|_| BusinessDatabaseError::InvalidInput)
}

pub(crate) fn random_id() -> Result<String, BusinessDatabaseError> {
    let mut bytes = [0_u8; 16];
    getrandom::fill(&mut bytes).map_err(|_| BusinessDatabaseError::StorageRejected)?;
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    let hex: String = bytes
        .iter()
        .fold(String::with_capacity(32), |mut output, byte| {
            use std::fmt::Write as _;
            write!(output, "{byte:02x}").expect("writing into String");
            output
        });
    Ok(format!(
        "{}-{}-{}-{}-{}",
        &hex[..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..]
    ))
}

impl DesktopAfternicListingObservation {
    pub(super) fn validate(&self) -> Result<(), BusinessDatabaseError> {
        validate_domain_asset_id(&self.domain).map_err(|_| BusinessDatabaseError::InvalidInput)?;
        if !self
            .domain
            .rsplit('.')
            .next()
            .is_some_and(|tld| tld.bytes().any(|b| b.is_ascii_lowercase()))
        {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        self.listing_status()?;
        for (value, minimum) in [
            (self.buynow_price, 0),
            (self.floor_price, 0),
            (self.minbid_price, 20_000_000),
        ] {
            if value.is_some_and(|value| {
                value < minimum || value > 49_999_999_000_000 || value % 1_000_000 != 0
            }) {
                return Err(BusinessDatabaseError::InvalidInput);
            }
        }
        timestamp(&self.created_at)?;
        timestamp(&self.updated_at)?;
        Ok(())
    }
    fn listing_status(&self) -> Result<&'static str, BusinessDatabaseError> {
        Ok(match self.status.as_str() {
            "ACTIVE" if self.hidden != Some(true) => "active",
            "ACTIVE" | "HIDDEN" | "INACTIVE" | "PENDING" => "draft",
            "SOLD" => "sold",
            "ON_HOLD"
            | "FAILED_COMPLIANCE"
            | "INVENTORY_COMPLIANCE_ISSUE"
            | "TLD_UNSUPPORTED"
            | "UNREGISTERED_DOMAIN" => "suspended",
            "OWNERSHIP_REVIEW" | "OWNERSHIP_UNVERIFIED" | "VERIFIED_OWNER_CONFLICT" | "UNKNOWN" => {
                "unknown"
            }
            _ => return Err(BusinessDatabaseError::InvalidInput),
        })
    }
}

impl BusinessDatabase {
    /// A prepared generation precedes secret capture/publication and survives every crash window.
    #[cfg(test)]
    pub(crate) fn prepare_afternic_connection<G>(
        &mut self,
        display_label: &str,
        authority_digest: &str,
        at: &str,
        guard: impl FnOnce() -> Result<G, BusinessDatabaseError>,
    ) -> Result<AfternicConnectionSeed, BusinessDatabaseError> {
        self.prepare_afternic_connection_with_acceptance(
            display_label,
            authority_digest,
            at,
            None,
            guard,
        )
    }

    pub(crate) fn prepare_afternic_connection_with_acceptance<G>(
        &mut self,
        display_label: &str,
        authority_digest: &str,
        at: &str,
        acceptance: Option<&super::ExecutionEvidenceContext>,
        guard: impl FnOnce() -> Result<G, BusinessDatabaseError>,
    ) -> Result<AfternicConnectionSeed, BusinessDatabaseError> {
        if !crate::portfolio_projection::valid_connection_label(display_label) {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        validate_sha256_hex(authority_digest)?;
        timestamp(at)?;
        let seed = AfternicConnectionSeed {
            connection_id: random_id()?,
            connection_incarnation_id: random_id()?,
            credential_generation: 1,
            credential_public_proof: hex_digest(random_id()?.as_bytes()),
            authority_snapshot_digest: authority_digest.to_owned(),
            publication_state: "prepared".to_owned(),
        };
        let tx = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let existing: i64 = tx.query_row("SELECT count(*) FROM local_provider_connections WHERE workspace_id=?1 AND deleted_at IS NULL AND lifecycle_status<>'deleted' AND credential_use_state<>'retired'",[&self.workspace_id],|row|row.get(0)).map_err(|_|BusinessDatabaseError::StorageRejected)?;
        if existing >= i64::from(super::super::settings::MAX_CONNECTIONS) {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        tx.execute("INSERT INTO local_provider_connections (workspace_id,connection_id,provider_kind,display_label,active_credential_changed_at,lifecycle_status,capabilities_json,created_at,validation_status,connection_incarnation_id,credential_use_state) VALUES (?1,?2,'afternic',?3,?4,'invalid','[\"marketplace\"]',?4,'unknown',?5,'inactive')",params![self.workspace_id,seed.connection_id,display_label,at,seed.connection_incarnation_id]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
        tx.execute("INSERT INTO afternic_connection_publications (workspace_id,connection_id,connection_incarnation_id,credential_generation,credential_public_proof,authority_snapshot_digest,publication_state,created_at,updated_at) VALUES (?1,?2,?3,1,?4,?5,'prepared',?6,?6)",params![self.workspace_id,seed.connection_id,seed.connection_incarnation_id,seed.credential_public_proof,authority_digest,at]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
        if let Some(evidence) = acceptance {
            if evidence.workspace_id != self.workspace_id {
                return Err(BusinessDatabaseError::MutationStale);
            }
            super::afternic_controlled_acceptance::bind(&tx, evidence, &seed)?;
        }
        let _guard = guard()?;
        tx.commit()
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        Ok(seed)
    }

    pub(crate) fn afternic_connection_seed(
        &self,
        connection_id: &str,
    ) -> Result<AfternicConnectionSeed, BusinessDatabaseError> {
        if !is_uuid_v4(connection_id) {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        connection_seed(
            self.store.raw_connection(),
            &self.workspace_id,
            connection_id,
        )
    }

    pub(crate) fn recheck_afternic_connection(
        &self,
        seed: &AfternicConnectionSeed,
    ) -> Result<(), BusinessDatabaseError> {
        if self.afternic_connection_seed(&seed.connection_id)? != *seed {
            return Err(BusinessDatabaseError::MutationStale);
        }
        Ok(())
    }

    pub(crate) fn admit_afternic_provider(
        &self,
        seed: &AfternicConnectionSeed,
    ) -> Result<(), BusinessDatabaseError> {
        self.recheck_afternic_connection(seed)?;
        let admitted: bool = self.store.raw_connection().query_row(
            "SELECT EXISTS(SELECT 1 FROM local_provider_connections WHERE workspace_id=?1 AND connection_id=?2 AND provider_kind='afternic' AND connection_incarnation_id=?3 AND revoked_at IS NULL AND deleted_at IS NULL AND ((?4='prepared' AND credential_use_state='inactive' AND lifecycle_status='invalid') OR (?4='active' AND credential_use_state='active' AND lifecycle_status='active' AND validation_status='valid')))",
            params![self.workspace_id,seed.connection_id,seed.connection_incarnation_id,seed.publication_state], |row| row.get(0),
        ).map_err(|_|BusinessDatabaseError::StorageRejected)?;
        if !admitted {
            return Err(BusinessDatabaseError::MutationStale);
        }
        Ok(())
    }

    /// Revoke locally before Native deletion. The retained proof allows idempotent purge retry.
    pub(crate) fn revoke_afternic_connection<G>(
        &mut self,
        seed: &AfternicConnectionSeed,
        at: &str,
        guard: impl FnOnce() -> Result<G, BusinessDatabaseError>,
    ) -> Result<AfternicConnectionSeed, BusinessDatabaseError> {
        timestamp(at)?;
        self.recheck_afternic_connection(seed)?;
        let tx = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        if seed.publication_state != "revoked" {
            tx.execute("UPDATE afternic_connection_publications SET publication_state='revoked',updated_at=?1 WHERE workspace_id=?2 AND connection_id=?3 AND credential_generation=?4",params![at,self.workspace_id,seed.connection_id,sql_integer(seed.credential_generation)?]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
            tx.execute("UPDATE local_provider_connections SET credential_use_state='revoked',lifecycle_status='revoked',validation_status='unknown',revoked_at=?1,active_credential_changed_at=?1 WHERE workspace_id=?2 AND connection_id=?3",params![at,self.workspace_id,seed.connection_id]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
        }
        let _guard = guard()?;
        tx.commit()
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let mut revoked = seed.clone();
        "revoked".clone_into(&mut revoked.publication_state);
        Ok(revoked)
    }

    pub(crate) fn confirm_afternic_purge<G>(
        &mut self,
        seed: &AfternicConnectionSeed,
        at: &str,
        guard: impl FnOnce() -> Result<G, BusinessDatabaseError>,
    ) -> Result<(), BusinessDatabaseError> {
        timestamp(at)?;
        self.recheck_afternic_connection(seed)?;
        if seed.publication_state != "revoked" {
            return Err(BusinessDatabaseError::MutationStale);
        }
        let tx = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        tx.execute("UPDATE afternic_connection_publications SET purged_at=COALESCE(purged_at,?1) WHERE workspace_id=?2 AND connection_id=?3 AND credential_generation=?4",params![at,self.workspace_id,seed.connection_id,sql_integer(seed.credential_generation)?]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
        // Hide a fully purged local connection without deleting its immutable slot or Listing history.
        tx.execute("UPDATE local_provider_connections SET lifecycle_status='deleted',deleted_at=COALESCE(deleted_at,?1) WHERE workspace_id=?2 AND connection_id=?3",params![at,self.workspace_id,seed.connection_id]).map_err(|_|BusinessDatabaseError::StorageRejected)?;
        let _guard = guard()?;
        tx.commit()
            .map_err(|_| BusinessDatabaseError::StorageRejected)
    }
}

fn connection_seed(
    connection: &rusqlite::Connection,
    workspace_id: &str,
    id: &str,
) -> Result<AfternicConnectionSeed, BusinessDatabaseError> {
    let seed = connection.query_row("SELECT p.connection_id,p.connection_incarnation_id,p.credential_generation,p.credential_public_proof,p.authority_snapshot_digest,p.publication_state FROM afternic_connection_publications p JOIN local_provider_connections c USING(workspace_id,connection_id) WHERE p.workspace_id=?1 AND p.connection_id=?2 AND c.provider_kind='afternic' AND c.connection_incarnation_id=p.connection_incarnation_id ORDER BY p.credential_generation DESC LIMIT 1",params![workspace_id,id],|row| Ok(AfternicConnectionSeed { connection_id: row.get(0)?,connection_incarnation_id: row.get(1)?,credential_generation: u64::try_from(row.get::<_,i64>(2)?).map_err(|_|rusqlite::Error::IntegralValueOutOfRange(2,-1))?,credential_public_proof: row.get(3)?,authority_snapshot_digest: row.get(4)?,publication_state: row.get(5)? })).map_err(|_| BusinessDatabaseError::MutationStale)?;
    if !is_uuid_v4(&seed.connection_id)
        || !is_uuid_v4(&seed.connection_incarnation_id)
        || seed.credential_generation == 0
        || seed.credential_generation > 9_007_199_254_740_991
        || !["prepared", "active", "remediation_required", "revoked"]
            .contains(&seed.publication_state.as_str())
    {
        return Err(BusinessDatabaseError::StorageRejected);
    }
    validate_sha256_hex(&seed.credential_public_proof)?;
    validate_sha256_hex(&seed.authority_snapshot_digest)?;
    Ok(seed)
}

impl BusinessDatabase {
    /// Publishes only a complete bounded scan. Absence in offset pagination never detaches a binding.
    pub(crate) fn import_afternic_inventory<G>(
        &mut self,
        seed: &AfternicConnectionSeed,
        listings: &[DesktopAfternicListingObservation],
        device_id: &str,
        lease_epoch: u64,
        at: &str,
        guard: impl FnOnce() -> Result<G, BusinessDatabaseError>,
    ) -> Result<DesktopAfternicInventoryReceipt, BusinessDatabaseError> {
        timestamp(at)?;
        if listings.len() > 10_000
            || !["prepared", "active"].contains(&seed.publication_state.as_str())
        {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        let mut names = BTreeSet::new();
        for listing in listings {
            listing.validate()?;
            if !names.insert(&listing.domain) {
                return Err(BusinessDatabaseError::InvalidInput);
            }
        }
        self.admit_afternic_provider(seed)?;
        let run = random_id()?;
        let tx = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        if seed.publication_state == "prepared" {
            tx.execute("UPDATE afternic_connection_publications SET publication_state='active',updated_at=?1 WHERE workspace_id=?2 AND connection_id=?3 AND credential_generation=?4",params![at,self.workspace_id,seed.connection_id,sql_integer(seed.credential_generation)?]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
        }
        tx.execute("UPDATE local_provider_connections SET credential_use_state='active',lifecycle_status='active',validation_status='valid',last_validated_at=?1,active_credential_changed_at=CASE WHEN ?4='prepared' THEN ?1 ELSE active_credential_changed_at END WHERE workspace_id=?2 AND connection_id=?3",params![at,self.workspace_id,seed.connection_id,seed.publication_state]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let mut run_inserted = false;
        let mut receipt = DesktopAfternicInventoryReceipt {
            observed: 0,
            imported: 0,
            skipped_deleted: Vec::new(),
        };
        for (ordinal, listing) in listings.iter().enumerate() {
            let imported = import_discovered_asset(
                &tx,
                &self.workspace_id,
                &random_id()?,
                device_id,
                lease_epoch,
                at,
                &listing.domain,
            )?;
            let Some(imported) = imported else {
                receipt.skipped_deleted.push(listing.domain.clone());
                continue;
            };
            if !run_inserted {
                tx.execute("INSERT INTO provider_observation_runs(workspace_id,observation_run_id,connection_id,observation_capability,started_at,status,connector_version) VALUES (?1,?2,?3,'marketplace',?4,'running','afternic-official-v3')",params![self.workspace_id,run,seed.connection_id,at]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
                run_inserted = true;
            }
            receipt.imported += u32::from(imported);
            record_listing_observation(
                &tx,
                &self.workspace_id,
                &seed.connection_id,
                seed.credential_generation,
                listing,
                &run,
                ordinal,
                at,
            )?;
            receipt.observed += 1;
        }
        if run_inserted {
            tx.execute("UPDATE provider_observation_runs SET status='succeeded',completed_at=?1 WHERE workspace_id=?2 AND observation_run_id=?3",params![at,self.workspace_id,run]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
        }
        tx.execute("INSERT INTO afternic_inventory_scans(workspace_id,scan_id,connection_id,credential_generation,observation_run_id,observed_count,imported_count,skipped_deleted_json,completed_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",params![self.workspace_id,run,seed.connection_id,sql_integer(seed.credential_generation)?,run_inserted.then_some(&run),receipt.observed,receipt.imported,serde_json::to_string(&receipt.skipped_deleted).map_err(|_| BusinessDatabaseError::InvalidInput)?,at]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
        tx.execute("UPDATE active_workspace_metadata SET last_successful_provider_observation_at=?1,updated_at=?1 WHERE singleton=1", [at]).map_err(|_|BusinessDatabaseError::StorageRejected)?;
        let _guard = guard()?;
        tx.commit()
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        Ok(receipt)
    }
}

fn sql_integer(value: u64) -> Result<i64, BusinessDatabaseError> {
    i64::try_from(value).map_err(|_| BusinessDatabaseError::InvalidInput)
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopAfternicScanSummary {
    pub observed: u32,
    pub imported: u32,
    pub skipped_deleted: u32,
    pub completed_at: String,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopAfternicConnectionSummary {
    pub connection_id: String,
    pub display_label: String,
    pub state: String,
    pub purge_pending: bool,
    pub last_scan: Option<DesktopAfternicScanSummary>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopAfternicConnectionsRead {
    pub controlled_acceptance: Option<super::DesktopAfternicControlledAcceptance>,
    pub schema_version: u8,
    pub connections: Vec<DesktopAfternicConnectionSummary>,
    pub observe_qualified: bool,
    pub observe_entitled: bool,
}

impl BusinessDatabase {
    pub(crate) fn afternic_connections(
        &self,
    ) -> Result<Vec<DesktopAfternicConnectionSummary>, BusinessDatabaseError> {
        let c = self.store.raw_connection();
        let mut statement = c.prepare("SELECT c.connection_id,c.display_label,p.publication_state,p.publication_state='revoked' AND p.purged_at IS NULL FROM local_provider_connections c JOIN afternic_connection_publications p USING(workspace_id,connection_id) WHERE c.workspace_id=?1 AND c.provider_kind='afternic' AND c.deleted_at IS NULL AND c.lifecycle_status<>'deleted' AND p.credential_generation=(SELECT max(n.credential_generation) FROM afternic_connection_publications n WHERE n.workspace_id=p.workspace_id AND n.connection_id=p.connection_id) ORDER BY c.created_at,c.connection_id LIMIT 101").map_err(|_|BusinessDatabaseError::StorageRejected)?;
        let rows = statement
            .query_map([&self.workspace_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, bool>(3)?,
                ))
            })
            .map_err(|_| BusinessDatabaseError::StorageRejected)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        if rows.len() > 100 {
            return Err(BusinessDatabaseError::StorageRejected);
        }
        rows.into_iter().map(|(connection_id,display_label,state,purge_pending)| {
            if !is_uuid_v4(&connection_id) || !crate::portfolio_projection::valid_connection_label(&display_label) || !["prepared","active","remediation_required","revoked"].contains(&state.as_str()) { return Err(BusinessDatabaseError::StorageRejected); }
            let last = c.query_row("SELECT observed_count,imported_count,skipped_deleted_json,completed_at FROM afternic_inventory_scans WHERE workspace_id=?1 AND connection_id=?2 ORDER BY completed_at DESC,rowid DESC LIMIT 1",params![self.workspace_id,connection_id],|row| Ok((row.get::<_,u32>(0)?,row.get::<_,u32>(1)?,row.get::<_,String>(2)?,row.get::<_,String>(3)?))).optional().map_err(|_|BusinessDatabaseError::StorageRejected)?;
            let last_scan = last.map(|(observed,imported,skipped,completed_at)| {
                let skipped_deleted: Vec<String> = serde_json::from_str(&skipped).map_err(|_|BusinessDatabaseError::StorageRejected)?;
                if observed>10000 || imported>observed || skipped_deleted.len()>10000 || usize::try_from(observed).map_err(|_| BusinessDatabaseError::StorageRejected)? + skipped_deleted.len()>10000 { return Err(BusinessDatabaseError::StorageRejected); }
                let mut unique = BTreeSet::new();
                for domain in &skipped_deleted { validate_domain_asset_id(domain).map_err(|_|BusinessDatabaseError::StorageRejected)?; if !unique.insert(domain) { return Err(BusinessDatabaseError::StorageRejected); } }
                timestamp(&completed_at).map_err(|_|BusinessDatabaseError::StorageRejected)?;
                Ok(DesktopAfternicScanSummary {observed,imported,skipped_deleted: u32::try_from(skipped_deleted.len()).map_err(|_|BusinessDatabaseError::StorageRejected)?,completed_at})
            }).transpose()?;
            Ok(DesktopAfternicConnectionSummary{connection_id,display_label,state,purge_pending,last_scan})
        }).collect()
    }
    pub(crate) fn mark_afternic_remediation<G>(
        &mut self,
        seed: &AfternicConnectionSeed,
        at: &str,
        guard: impl FnOnce() -> Result<G, BusinessDatabaseError>,
    ) -> Result<(), BusinessDatabaseError> {
        timestamp(at)?;
        self.recheck_afternic_connection(seed)?;
        if !["prepared", "active"].contains(&seed.publication_state.as_str()) {
            return Err(BusinessDatabaseError::MutationStale);
        }
        let tx = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        tx.execute("UPDATE afternic_connection_publications SET publication_state='remediation_required',updated_at=?1 WHERE workspace_id=?2 AND connection_id=?3 AND credential_generation=?4",params![at,self.workspace_id,seed.connection_id,sql_integer(seed.credential_generation)?]).map_err(|_|BusinessDatabaseError::StorageRejected)?;
        tx.execute("UPDATE local_provider_connections SET lifecycle_status='invalid',validation_status='invalid' WHERE workspace_id=?1 AND connection_id=?2",params![self.workspace_id,seed.connection_id]).map_err(|_|BusinessDatabaseError::StorageRejected)?;
        let _guard = guard()?;
        tx.commit()
            .map_err(|_| BusinessDatabaseError::StorageRejected)
    }
}

/// Inventory and exact-write GETs publish through the same binding/observation owner.
#[expect(
    clippy::too_many_arguments,
    reason = "one provider observation is inserted in its existing caller transaction"
)]
pub(super) fn record_listing_observation(
    tx: &rusqlite::Connection,
    workspace: &str,
    connection_id: &str,
    credential_generation: u64,
    listing: &DesktopAfternicListingObservation,
    run: &str,
    ordinal: usize,
    at: &str,
) -> Result<String, BusinessDatabaseError> {
    let observation_id = random_id()?;
    let encoded = serde_json::to_vec(listing).map_err(|_| BusinessDatabaseError::InvalidInput)?;
    let observation_digest = hex_digest(&encoded);
    let live: Option<String> = tx.query_row("SELECT resource_binding_digest FROM domain_asset_provider_bindings WHERE workspace_id=?1 AND entity_id=?2 AND connection_id=?3 AND resource_kind='listing' AND validation_status!='detached'",params![workspace,listing.domain,connection_id],|row|row.get(0)).optional().map_err(|_| BusinessDatabaseError::StorageRejected)?;
    let (sequence,): (i64,) = tx.query_row("UPDATE active_workspace_metadata SET local_commit_sequence=local_commit_sequence+1,updated_at=?1 WHERE singleton=1 RETURNING local_commit_sequence",[at],|row|Ok((row.get(0)?,))).map_err(|_| BusinessDatabaseError::SequenceExhausted)?;
    let binding_digest = if let Some(digest) = live {
        tx.execute("UPDATE domain_asset_provider_bindings SET observation_digest=?1,binding_generation=?2,local_commit_sequence=?3,validation_status='unverified',verified_at=NULL,last_observed_at=?4,updated_at=?4 WHERE workspace_id=?5 AND entity_id=?6 AND connection_id=?7 AND resource_kind='listing' AND resource_binding_digest=?8",params![observation_digest,sql_integer(credential_generation)?,sequence,at,workspace,listing.domain,connection_id,digest]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
        digest
    } else {
        // This random digest is a LOCAL binding incarnation. Neither a name nor a remote
        // timestamp is evidence of a stable Afternic resource ID or verified ownership.
        let digest = hex_digest(random_id()?.as_bytes());
        tx.execute("INSERT INTO domain_asset_provider_bindings(workspace_id,entity_id,connection_id,provider_kind,resource_kind,resource_binding_digest,observation_digest,resource_label,binding_generation,local_commit_sequence,validation_status,last_observed_at,created_at,updated_at) VALUES (?1,?2,?3,'afternic','listing',?4,?5,?2,?6,?7,'unverified',?8,?8,?8)",params![workspace,listing.domain,connection_id,digest,observation_digest,sql_integer(credential_generation)?,sequence,at]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
        digest
    };
    tx.execute("INSERT INTO provider_observation_targets(workspace_id,observation_run_id,entity_id,ordinal,status,requested_at) VALUES (?1,?2,?3,?4,'requested',?5)",params![workspace,run,listing.domain,i64::try_from(ordinal).map_err(|_| BusinessDatabaseError::InvalidInput)?,at]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
    let amount = listing
        .buynow_price
        .map(|value| (value / 1_000_000).to_string());
    tx.execute("INSERT INTO marketplace_listing_observations(workspace_id,listing_observation_id,observation_run_id,entity_id,marketplace_kind,listing_status,asking_price_currency,asking_price_amount,observed_at,provider_version_token,observation_availability,evidence_status,binding_connection_id,binding_resource_digest,binding_generation) VALUES (?1,?2,?3,?4,'afternic',?5,?6,?7,?8,?9,'available','confirmed',?10,?11,?12)",params![workspace,observation_id,run,listing.domain,listing.listing_status()?,amount.as_ref().map(|_| "USD"),amount,at,observation_digest,connection_id,binding_digest,sql_integer(credential_generation)?]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
    tx.execute("INSERT INTO afternic_listing_details(workspace_id,listing_observation_id,provider_status,buynow_price,floor_price,minbid_price,hidden,provider_created_at,provider_updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",params![workspace,observation_id,listing.status,listing.buynow_price.map(sql_integer).transpose()?,listing.floor_price.map(sql_integer).transpose()?,listing.minbid_price.map(sql_integer).transpose()?,listing.hidden,listing.created_at,listing.updated_at]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
    tx.execute("UPDATE provider_observation_targets SET status='succeeded',completed_at=?1 WHERE workspace_id=?2 AND observation_run_id=?3 AND entity_id=?4",params![at,workspace,run,listing.domain]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
    Ok(observation_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::active_workspace::business::DomainAssetWrite;
    use crate::active_workspace::business::tests::TestDatabase;
    const AT: &str = "2026-11-19T00:00:00Z";
    fn listing(domain: &str) -> DesktopAfternicListingObservation {
        DesktopAfternicListingObservation {
            domain: domain.to_owned(),
            status: "ACTIVE".to_owned(),
            buynow_price: Some(300_000_000),
            floor_price: None,
            minbid_price: None,
            hidden: Some(false),
            created_at: AT.to_owned(),
            updated_at: AT.to_owned(),
        }
    }
    fn count(db: &TestDatabase, table: &str) -> i64 {
        db.store
            .raw_connection()
            .query_row(&format!("SELECT count(*) FROM {table}"), [], |row| {
                row.get(0)
            })
            .unwrap()
    }
    fn prepare(db: &mut TestDatabase) -> AfternicConnectionSeed {
        db.prepare_afternic_connection("Afternic", &"a".repeat(64), AT, || Ok(()))
            .unwrap()
    }
    #[test]
    fn afternic_complete_inventory_import_is_atomic_and_preserves_user_fields() {
        let mut db = TestDatabase::open([0x61; 32]);
        db.create_domain_asset_guarded(
            "manual-existing",
            "device-local",
            1,
            AT,
            &DomainAssetWrite {
                entity_id: "existing.test".into(),
                note: Some("keep my note".into()),
                portfolio_id: None,
                tags: vec!["personal".into()],
                target_price: None,
            },
            true,
            |_| Ok(()),
            |(), _| Ok(()),
        )
        .unwrap();
        let seed = prepare(&mut db);
        let rows = [listing("existing.test"), listing("new.test")];
        let before = count(&db, "sync_outbox");
        assert_eq!(
            db.import_afternic_inventory(&seed, &rows, "device-local", 1, AT, || Err::<(), _>(
                BusinessDatabaseError::MutationStale
            )),
            Err(BusinessDatabaseError::MutationStale)
        );
        assert_eq!(count(&db, "sync_outbox"), before);
        assert_eq!(count(&db, "marketplace_listing_observations"), 0);
        assert_eq!(
            db.afternic_connection_seed(&seed.connection_id)
                .unwrap()
                .publication_state,
            "prepared"
        );
        let receipt = db
            .import_afternic_inventory(&seed, &rows, "device-local", 1, AT, || Ok(()))
            .unwrap();
        assert_eq!((receipt.observed, receipt.imported), (2, 1));
        assert_eq!(count(&db, "sync_outbox"), before + 1);
        assert_eq!(count(&db, "sync_outbox_fields"), 8);
        let note: String = db
            .store
            .raw_connection()
            .query_row(
                "SELECT note FROM domain_asset_desired_state WHERE entity_id='existing.test'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(note, "keep my note");
        assert_eq!(count(&db, "afternic_listing_details"), 2);
        assert_eq!(count(&db, "registrar_observations"), 0);
        let seed = db.afternic_connection_seed(&seed.connection_id).unwrap();
        db.import_afternic_inventory(&seed, &rows, "device-local", 1, AT, || Ok(()))
            .unwrap();
        assert_eq!(count(&db, "sync_outbox"), before + 1);
        assert_eq!(count(&db, "domain_asset_provider_bindings"), 2);
        // An empty complete offset scan cannot prove remote deletion.
        db.import_afternic_inventory(&seed, &[], "device-local", 1, AT, || Ok(()))
            .unwrap();
        assert_eq!(count(&db, "domain_asset_provider_bindings"), 2);
        assert_eq!(count(&db, "marketplace_listing_observations"), 4);
    }
    #[test]
    fn afternic_inventory_rejects_duplicate_invalid_and_revoked_generations() {
        let mut db = TestDatabase::open([0x62; 32]);
        let seed = prepare(&mut db);
        assert_eq!(
            db.import_afternic_inventory(
                &seed,
                &[listing("a.test"), listing("a.test")],
                "device-local",
                1,
                AT,
                || Ok(())
            ),
            Err(BusinessDatabaseError::InvalidInput)
        );
        let mut invalid = listing("a.test");
        invalid.minbid_price = Some(19_000_000);
        assert_eq!(
            db.import_afternic_inventory(&seed, &[invalid], "device-local", 1, AT, || Ok(())),
            Err(BusinessDatabaseError::InvalidInput)
        );
        let mut cross = seed.clone();
        cross.connection_incarnation_id = random_id().unwrap();
        assert_eq!(
            db.import_afternic_inventory(
                &cross,
                &[listing("a.test")],
                "device-local",
                1,
                AT,
                || Ok(())
            ),
            Err(BusinessDatabaseError::MutationStale)
        );
        let revoked = db.revoke_afternic_connection(&seed, AT, || Ok(())).unwrap();
        assert_eq!(
            db.import_afternic_inventory(
                &seed,
                &[listing("a.test")],
                "device-local",
                1,
                AT,
                || Ok(())
            ),
            Err(BusinessDatabaseError::MutationStale)
        );
        assert_eq!(count(&db, "domain_assets"), 0);
        db.confirm_afternic_purge(&revoked, AT, || Ok(())).unwrap();
        db.confirm_afternic_purge(&revoked, AT, || Ok(())).unwrap();
        assert_eq!(count(&db, "afternic_connection_publications"), 1);
    }
    #[test]
    fn afternic_scan_never_resurrects_tombstone_even_with_readd_gate_open() {
        let mut db = TestDatabase::open([0x63; 32]);
        let created = db
            .create_domain_asset_guarded(
                "create-deleted",
                "device-local",
                1,
                AT,
                &DomainAssetWrite {
                    entity_id: "deleted.test".into(),
                    note: None,
                    portfolio_id: None,
                    tags: Vec::new(),
                    target_price: None,
                },
                true,
                |_| Ok(()),
                |(), _| Ok(()),
            )
            .unwrap();
        db.delete_domain_asset(
            "delete-it",
            created.local_commit_sequence,
            "device-local",
            1,
            AT,
            "deleted.test",
            true,
        )
        .unwrap();
        let before = count(&db, "sync_outbox");
        let seed = prepare(&mut db);
        let receipt = db
            .import_afternic_inventory(
                &seed,
                &[listing("deleted.test")],
                "device-local",
                1,
                AT,
                || Ok(()),
            )
            .unwrap();
        assert_eq!(receipt.skipped_deleted, vec!["deleted.test"]);
        assert_eq!((receipt.imported, receipt.observed), (0, 0));
        assert_eq!(count(&db, "sync_outbox"), before);
        assert_eq!(count(&db, "domain_asset_provider_bindings"), 0);
    }
    #[test]
    fn afternic_visible_connection_capacity_is_reclaimed_only_after_confirmed_purge() {
        let mut db = TestDatabase::open([0x64; 32]);
        let first = prepare(&mut db);
        for _ in 1..super::super::super::settings::MAX_CONNECTIONS {
            prepare(&mut db);
        }
        assert_eq!(
            db.prepare_afternic_connection("overflow", &"a".repeat(64), AT, || Ok(())),
            Err(BusinessDatabaseError::InvalidInput)
        );
        let revoked = db
            .revoke_afternic_connection(&first, AT, || Ok(()))
            .unwrap();
        assert!(
            db.prepare_afternic_connection("still-full", &"a".repeat(64), AT, || Ok(()))
                .is_err()
        );
        db.confirm_afternic_purge(&revoked, AT, || Ok(())).unwrap();
        prepare(&mut db);
        assert_eq!(db.afternic_connections().unwrap().len(), 64);
        assert_eq!(count(&db, "afternic_connection_publications"), 65);
    }
}
