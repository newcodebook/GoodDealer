//! Durable Afternic removal plans. The sole business writer owns approval and reconciliation.
use super::afternic::{inventory_still_matches, latest_inventory_scan, random_id};
use super::execution_evidence::{self, ApprovalTarget, EvidenceSigner, ExecutionEvidenceContext};
use super::{
    AfternicConnectionSeed, BusinessDatabase, BusinessDatabaseError,
    DesktopAfternicListingObservation, hex_digest, is_uuid_v4, validate_domain_asset_id,
    validate_sha256_hex, validate_timestamp,
};
use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde::{Deserialize, Deserializer, Serialize};
use std::collections::BTreeSet;

pub(crate) const DELIST_KIND: &str = "afternic_delist";
const ADAPTER: &str = "afternic-official-v3-delist-v1";
type Result<T> = std::result::Result<T, BusinessDatabaseError>;
fn storage(_: rusqlite::Error) -> BusinessDatabaseError {
    BusinessDatabaseError::StorageRejected
}
fn encode<T: Serialize>(value: &T) -> Result<String> {
    serde_json::to_string(value).map_err(|_| BusinessDatabaseError::InvalidInput)
}
fn decode<T: serde::de::DeserializeOwned>(value: &str) -> Result<T> {
    serde_json::from_str(value).map_err(|_| BusinessDatabaseError::StorageRejected)
}
fn timestamp(value: &str) -> Result<()> {
    validate_timestamp(Some(value.to_owned()))
        .map(|_| ())
        .map_err(|_| BusinessDatabaseError::InvalidInput)
}
fn identifier(value: &str) -> Result<()> {
    if is_uuid_v4(value) {
        Ok(())
    } else {
        Err(BusinessDatabaseError::InvalidInput)
    }
}
fn sql_integer<T: TryInto<i64>>(value: T) -> Result<i64> {
    value
        .try_into()
        .map_err(|_| BusinessDatabaseError::InvalidInput)
}
fn unsigned(row: &rusqlite::Row<'_>, column: usize) -> rusqlite::Result<u64> {
    let value: i64 = row.get(column)?;
    u64::try_from(value).map_err(|_| rusqlite::Error::IntegralValueOutOfRange(column, value))
}
fn optional_unsigned(row: &rusqlite::Row<'_>, column: usize) -> rusqlite::Result<Option<u64>> {
    let value: Option<i64> = row.get(column)?;
    value
        .map(|value| {
            u64::try_from(value)
                .map_err(|_| rusqlite::Error::IntegralValueOutOfRange(column, value))
        })
        .transpose()
}
fn required_nullable<'de, D: Deserializer<'de>>(
    d: D,
) -> std::result::Result<Option<String>, D::Error> {
    Option::<String>::deserialize(d)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DesktopAfternicDelistPreviewRequest {
    pub schema_version: u8,
    pub connection_id: String,
    pub domains: Vec<String>,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DesktopAfternicDelistApproveRequest {
    pub schema_version: u8,
    pub plan_ref: String,
    pub plan_hash: String,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DesktopAfternicDelistStatusRequest {
    pub schema_version: u8,
    #[serde(deserialize_with = "required_nullable")]
    pub plan_ref: Option<String>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopAfternicDelistPreviewItem {
    pub domain: String,
    pub provider_status: String,
    pub buynow_price: Option<u64>,
    pub floor_price: Option<u64>,
    pub minbid_price: Option<u64>,
    pub hidden: Option<bool>,
    pub observed_at: String,
    pub state: String,
    pub reason: Option<String>,
    pub retry_at: Option<String>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopAfternicDelistPlan {
    pub schema_version: u8,
    pub plan_ref: String,
    pub plan_hash: String,
    pub connection_label: String,
    pub created_at: String,
    pub expires_at: String,
    pub approved_at: Option<String>,
    pub state: String,
    pub items: Vec<DesktopAfternicDelistPreviewItem>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopAfternicDelistSummary {
    pub plan_ref: String,
    pub connection_label: String,
    pub created_at: String,
    pub state: String,
    pub total: u32,
    pub succeeded: u32,
    pub conflicts: u32,
    pub pending: u32,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopAfternicDelistStatus {
    pub controlled_acceptance: Option<super::DesktopAfternicControlledAcceptance>,
    pub schema_version: u8,
    pub write_qualified: bool,
    pub write_entitled: bool,
    pub plans: Vec<DesktopAfternicDelistSummary>,
    pub detail: Option<DesktopAfternicDelistPlan>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AfternicDelistFrozenItem {
    schema_version: u8,
    adapter_revision: String,
    scan_id: String,
    observation_id: String,
    observation_digest: String,
    observed_at: String,
    pub domain: String,
    pub entity_generation: u64,
    pub connection_id: String,
    pub connection_incarnation_id: String,
    pub credential_generation: u64,
    pub binding_digest: String,
    pub binding_generation: u64,
    pub listing: DesktopAfternicListingObservation,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DesktopAfternicDelistWorkKind {
    Preflight,
    Reconcile,
}
#[derive(Clone)]
pub(crate) struct AfternicDelistWorkSeed {
    pub plan_id: String,
    pub operation_id: String,
    pub item_id: String,
    pub request_digest: String,
    pub frozen: AfternicDelistFrozenItem,
    pub kind: DesktopAfternicDelistWorkKind,
    evidence_fence: execution_evidence::EvidenceReadFence,
}
type ItemReadFact = (String, Option<String>, Option<String>, Option<String>);
struct StoredItem {
    id: String,
    frozen: AfternicDelistFrozenItem,
}

fn validate_frozen(item: &AfternicDelistFrozenItem) -> Result<()> {
    if item.schema_version != 1
        || item.adapter_revision != ADAPTER
        || item.domain != item.listing.domain
        || item.entity_generation == 0
        || item.credential_generation == 0
        || item.binding_generation != item.credential_generation
    {
        return Err(BusinessDatabaseError::StorageRejected);
    }
    for id in [
        &item.scan_id,
        &item.observation_id,
        &item.connection_id,
        &item.connection_incarnation_id,
    ] {
        identifier(id)?;
    }
    validate_sha256_hex(&item.observation_digest)?;
    validate_sha256_hex(&item.binding_digest)?;
    timestamp(&item.observed_at)?;
    item.listing.validate()?;
    if hex_digest(encode(&item.listing)?.as_bytes()) != item.observation_digest {
        return Err(BusinessDatabaseError::StorageRejected);
    }
    Ok(())
}
fn request_digest(item: &AfternicDelistFrozenItem) -> Result<String> {
    Ok(hex_digest(encode(&(ADAPTER, "remove", item))?.as_bytes()))
}
fn plan_hash(
    workspace: &str,
    id: &str,
    at: &str,
    expires: &str,
    items: &[StoredItem],
) -> Result<String> {
    let frozen: Vec<_> = items.iter().map(|i| (&i.id, &i.frozen)).collect();
    Ok(hex_digest(
        encode(&(1, DELIST_KIND, workspace, id, at, expires, frozen))?.as_bytes(),
    ))
}
fn validate_source(c: &Connection, workspace: &str, item: &AfternicDelistFrozenItem) -> Result<()> {
    let yes:bool=c.query_row("SELECT EXISTS(SELECT 1 FROM afternic_inventory_scans s JOIN marketplace_listing_observations m ON m.workspace_id=s.workspace_id AND m.observation_run_id=s.observation_run_id JOIN afternic_listing_details d USING(workspace_id,listing_observation_id) JOIN afternic_connection_publications p ON p.workspace_id=s.workspace_id AND p.connection_id=s.connection_id AND p.credential_generation=s.credential_generation WHERE s.workspace_id=?1 AND s.scan_id=?2 AND m.listing_observation_id=?3 AND s.connection_id=?4 AND s.credential_generation=?5 AND m.binding_connection_id=?4 AND m.binding_resource_digest=?6 AND m.binding_generation=?7 AND m.entity_id=?8 AND m.provider_version_token=?9 AND m.observed_at=?10 AND d.provider_status=?11 AND d.buynow_price IS ?12 AND d.floor_price IS ?13 AND d.minbid_price IS ?14 AND d.hidden IS ?15 AND d.provider_created_at=?16 AND d.provider_updated_at=?17 AND p.connection_incarnation_id=?18 AND m.confirmed=1 AND m.observation_availability='available' AND m.evidence_status='confirmed')",params![workspace,item.scan_id,item.observation_id,item.connection_id,sql_integer(item.credential_generation)?,item.binding_digest,sql_integer(item.binding_generation)?,item.domain,item.observation_digest,item.observed_at,item.listing.status,item.listing.buynow_price.map(sql_integer).transpose()?,item.listing.floor_price.map(sql_integer).transpose()?,item.listing.minbid_price.map(sql_integer).transpose()?,item.listing.hidden,item.listing.created_at,item.listing.updated_at,item.connection_incarnation_id],|r|r.get(0)).map_err(storage)?;
    if !yes {
        return Err(BusinessDatabaseError::StorageRejected);
    }
    Ok(())
}
// Approval and dispatch must agree on every execution column, not just the JSON hash.
fn validate_stored_item(
    c: &Connection,
    workspace: &str,
    plan: &str,
    id: &str,
    frozen: &AfternicDelistFrozenItem,
) -> Result<()> {
    validate_frozen(frozen)?;
    validate_source(c, workspace, frozen)?;
    let yes:bool=c.query_row("SELECT EXISTS(SELECT 1 FROM operation_plan_items WHERE workspace_id=?1 AND plan_id=?2 AND item_id=?3 AND entity_id=?4 AND connection_id=?5 AND capability='afternic:marketplace:write' AND field_path IS NULL AND old_value_json=?6 AND new_value_json='{\"action\":\"remove\"}' AND precondition_json=?7 AND risk_level='standard' AND execution_mode='automatic' AND inclusion_status='included')",params![workspace,plan,id,frozen.domain,frozen.connection_id,encode(&frozen.listing)?,encode(frozen)?],|r|r.get(0)).map_err(storage)?;
    if !yes {
        return Err(BusinessDatabaseError::StorageRejected);
    }
    Ok(())
}
fn items(c: &Connection, workspace: &str, plan: &str) -> Result<Vec<StoredItem>> {
    let mut q=c.prepare("SELECT item_id,precondition_json,ordinal FROM operation_plan_items WHERE workspace_id=?1 AND plan_id=?2 ORDER BY ordinal LIMIT 501").map_err(storage)?;
    let raw = q
        .query_map(params![workspace, plan], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, i64>(2)?,
            ))
        })
        .map_err(storage)?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(storage)?;
    let expected:i64=c.query_row("SELECT item_count FROM operation_plans WHERE workspace_id=?1 AND plan_id=?2 AND operation_kind='afternic_delist' AND risk_level='standard'",params![workspace,plan],|r|r.get(0)).map_err(storage)?;
    if raw.is_empty() || raw.len() > 500 || sql_integer(raw.len())? != expected {
        return Err(BusinessDatabaseError::StorageRejected);
    }
    let mut output = Vec::new();
    let mut previous = None;
    for (ordinal, (id, wire, stored_ordinal)) in raw.into_iter().enumerate() {
        identifier(&id)?;
        let frozen: AfternicDelistFrozenItem = decode(&wire)?;
        validate_stored_item(c, workspace, plan, &id, &frozen)?;
        if stored_ordinal != sql_integer(ordinal)?
            || previous
                .as_ref()
                .is_some_and(|previous: &String| previous >= &frozen.domain)
        {
            return Err(BusinessDatabaseError::StorageRejected);
        }
        previous = Some(frozen.domain.clone());
        output.push(StoredItem { id, frozen });
    }
    Ok(output)
}
fn next_sequence(c: &Connection, at: &str) -> Result<i64> {
    c.query_row("UPDATE active_workspace_metadata SET local_commit_sequence=local_commit_sequence+1,updated_at=?1 WHERE singleton=1 RETURNING local_commit_sequence",[at],|r|r.get(0)).map_err(storage)
}
fn plus_seconds(c: &Connection, at: &str, seconds: u32) -> Result<String> {
    let next: String = c
        .query_row(
            "SELECT strftime('%Y-%m-%dT%H:%M:%SZ',?1,'+'||?2||' seconds')",
            params![at, seconds],
            |r| r.get(0),
        )
        .map_err(storage)?;
    timestamp(&next)?;
    if next.as_str() <= at {
        return Err(BusinessDatabaseError::StorageRejected);
    }
    Ok(next)
}

fn delist_write_open(c: &Connection, workspace: &str) -> Result<bool> {
    c.query_row(
        "SELECT NOT EXISTS(SELECT 1 FROM device_handoff_barriers WHERE workspace_id=?1)",
        [workspace],
        |row| row.get(0),
    )
    .map_err(storage)
}
fn require_delist_write_open(c: &Connection, workspace: &str) -> Result<()> {
    if !delist_write_open(c, workspace)? {
        return Err(BusinessDatabaseError::MutationStale);
    }
    Ok(())
}
fn locally_current(
    c: &Connection,
    workspace: &str,
    item: &AfternicDelistFrozenItem,
) -> Result<bool> {
    c.query_row("SELECT EXISTS(SELECT 1 FROM domain_assets a JOIN domain_asset_provider_bindings b ON b.workspace_id=a.workspace_id AND b.entity_id=a.entity_id JOIN local_provider_connections c ON c.workspace_id=b.workspace_id AND c.connection_id=b.connection_id JOIN afternic_connection_publications p ON p.workspace_id=c.workspace_id AND p.connection_id=c.connection_id WHERE a.workspace_id=?1 AND a.entity_id=?2 AND a.lifecycle_status='active' AND a.entity_generation=?3 AND b.connection_id=?4 AND b.resource_kind='listing' AND b.resource_binding_digest=?5 AND b.binding_generation=?6 AND b.validation_status IN ('verified','unverified') AND c.connection_incarnation_id=?7 AND c.lifecycle_status='active' AND c.deleted_at IS NULL AND c.validation_status='valid' AND c.credential_use_state='active' AND p.connection_incarnation_id=?7 AND p.credential_generation=?8 AND p.publication_state='active')",params![workspace,item.domain,sql_integer(item.entity_generation)?,item.connection_id,item.binding_digest,sql_integer(item.binding_generation)?,item.connection_incarnation_id,sql_integer(item.credential_generation)?],|r|r.get(0)).map_err(storage)
}
fn other_execution(
    c: &Connection,
    workspace: &str,
    item: &AfternicDelistFrozenItem,
    except_plan: &str,
) -> Result<bool> {
    c.query_row("SELECT EXISTS(SELECT 1 FROM operation_plan_items i JOIN operation_attempts a USING(workspace_id,plan_id,item_id) JOIN operation_plans p USING(workspace_id,plan_id) WHERE i.workspace_id=?1 AND i.plan_id<>?2 AND p.operation_kind IN ('afternic_delist','afternic_listing_write') AND i.connection_id=?3 AND i.entity_id=?4 AND json_extract(i.precondition_json,'$.connectionIncarnationId')=?5 AND a.status IN ('queued','running','outcome_unknown') AND NOT EXISTS(SELECT 1 FROM afternic_listing_write_reconciliations w WHERE w.workspace_id=a.workspace_id AND w.operation_id=a.operation_id AND w.item_id=a.item_id AND w.item_state='applied') AND NOT EXISTS(SELECT 1 FROM afternic_delist_reconciliations r WHERE r.workspace_id=a.workspace_id AND r.operation_id=a.operation_id AND r.item_id=a.item_id AND r.outcome='absent'))",params![workspace,except_plan,item.connection_id,item.domain,item.connection_incarnation_id],|r|r.get(0)).map_err(storage)
}

impl BusinessDatabase {
    pub(crate) fn require_afternic_delist_write_open(&self) -> Result<()> {
        require_delist_write_open(self.store.raw_connection(), &self.workspace_id)
    }
    pub(crate) fn afternic_delist_commit_sequence(&self) -> Result<i64> {
        self.store
            .raw_connection()
            .query_row(
                "SELECT local_commit_sequence FROM active_workspace_metadata WHERE singleton=1",
                [],
                |r| r.get(0),
            )
            .map_err(storage)
    }
    pub(crate) fn preview_afternic_delist_with_time<G>(
        &mut self,
        seed: &AfternicConnectionSeed,
        domains: &[String],
        at: &str,
        authorization_time: &str,
        guard: G,
    ) -> Result<DesktopAfternicDelistPlan>
    where
        G: FnOnce() -> Result<()>,
    {
        timestamp(at)?;
        timestamp(authorization_time)?;
        if domains.is_empty() || domains.len() > 500 || seed.publication_state != "active" {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        let mut unique = BTreeSet::new();
        for domain in domains {
            validate_domain_asset_id(domain).map_err(|_| BusinessDatabaseError::InvalidInput)?;
            if !unique.insert(domain) {
                return Err(BusinessDatabaseError::InvalidInput);
            }
        }
        self.admit_afternic_provider(seed)?;
        let tx = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(storage)?;
        require_delist_write_open(&tx, &self.workspace_id)?;
        let scan = latest_inventory_scan(
            &tx,
            &self.workspace_id,
            &seed.connection_id,
            seed.credential_generation,
        )?;
        let Some(run) = scan.1 else {
            return Err(BusinessDatabaseError::MutationStale);
        };
        let plan_id = random_id()?;
        let mut frozen = Vec::new();
        for domain in unique {
            let item=tx.query_row("SELECT m.listing_observation_id,m.provider_version_token,m.observed_at,m.binding_resource_digest,m.binding_generation,a.entity_generation,d.provider_status,d.buynow_price,d.floor_price,d.minbid_price,d.hidden,d.provider_created_at,d.provider_updated_at FROM marketplace_listing_observations m JOIN afternic_listing_details d USING(workspace_id,listing_observation_id) JOIN domain_assets a USING(workspace_id,entity_id) WHERE m.workspace_id=?1 AND m.observation_run_id=?2 AND m.entity_id=?3 AND m.binding_connection_id=?4 AND m.confirmed=1 AND m.observation_availability='available' AND m.evidence_status='confirmed'",params![self.workspace_id,run,domain,seed.connection_id],|r|Ok(AfternicDelistFrozenItem{schema_version:1,adapter_revision:ADAPTER.into(),scan_id:scan.0.clone(),observation_id:r.get(0)?,observation_digest:r.get(1)?,observed_at:r.get(2)?,domain:domain.clone(),entity_generation:unsigned(r,5)?,connection_id:seed.connection_id.clone(),connection_incarnation_id:seed.connection_incarnation_id.clone(),credential_generation:seed.credential_generation,binding_digest:r.get(3)?,binding_generation:unsigned(r,4)?,listing:DesktopAfternicListingObservation{domain:domain.clone(),status:r.get(6)?,buynow_price:optional_unsigned(r,7)?,floor_price:optional_unsigned(r,8)?,minbid_price:optional_unsigned(r,9)?,hidden:r.get(10)?,created_at:r.get(11)?,updated_at:r.get(12)?}})).map_err(|_|BusinessDatabaseError::MutationStale)?;
            validate_frozen(&item)?;
            if item.observed_at.as_str() > at
                || !locally_current(&tx, &self.workspace_id, &item)?
                || other_execution(&tx, &self.workspace_id, &item, &plan_id)?
            {
                return Err(BusinessDatabaseError::MutationStale);
            }
            frozen.push(StoredItem {
                id: random_id()?,
                frozen: item,
            });
        }
        // Preview lifetime comes from the authenticated continuous-clock projection; wall time
        // remains only the local business timestamp and cannot extend approval admission.
        let expires = plus_seconds(&tx, authorization_time, 900)?;
        let hash = plan_hash(&self.workspace_id, &plan_id, at, &expires, &frozen)?;
        let sequence = next_sequence(&tx, at)?;
        tx.execute("INSERT INTO operation_plans(workspace_id,plan_id,operation_kind,plan_hash,title,phase,risk_level,item_count,created_at,expires_at,local_commit_sequence) VALUES(?1,?2,'afternic_delist',?3,'Afternic delisting','awaiting_approval','standard',?4,?5,?6,?7)",params![self.workspace_id,plan_id,hash,sql_integer(frozen.len())?,at,expires,sequence]).map_err(storage)?;
        for (ordinal, item) in frozen.iter().enumerate() {
            tx.execute("INSERT INTO operation_plan_items(workspace_id,plan_id,item_id,ordinal,entity_id,connection_id,capability,old_value_json,new_value_json,precondition_json,risk_level,execution_mode,inclusion_status) VALUES(?1,?2,?3,?4,?5,?6,'afternic:marketplace:write',?7,'{\"action\":\"remove\"}',?8,'standard','automatic','included')",params![self.workspace_id,plan_id,item.id,sql_integer(ordinal)?,item.frozen.domain,item.frozen.connection_id,encode(&item.frozen.listing)?,encode(&item.frozen)?]).map_err(storage)?;
        }
        guard()?;
        tx.commit().map_err(storage)?;
        self.afternic_delist_plan(&plan_id, at)
    }
    pub(crate) fn approve_afternic_delist_with_evidence<G>(
        &mut self,
        plan: &str,
        hash: &str,
        at: &str,
        evidence: &ExecutionEvidenceContext,
        signer: &mut EvidenceSigner<'_>,
        guard: G,
    ) -> Result<DesktopAfternicDelistPlan>
    where
        G: FnOnce() -> Result<()>,
    {
        if evidence.workspace_id != self.workspace_id {
            return Err(BusinessDatabaseError::MutationStale);
        }
        identifier(plan)?;
        validate_sha256_hex(hash)?;
        timestamp(at)?;
        let tx = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(storage)?;
        let (stored_hash,phase,created,expires):(String,String,String,String)=tx.query_row("SELECT plan_hash,phase,created_at,expires_at FROM operation_plans WHERE workspace_id=?1 AND plan_id=?2 AND operation_kind='afternic_delist'",params![self.workspace_id,plan],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).map_err(|_|BusinessDatabaseError::MutationStale)?;
        require_delist_write_open(&tx, &self.workspace_id)?;
        let frozen = items(&tx, &self.workspace_id, plan)?;
        if stored_hash != hash
            || plan_hash(&self.workspace_id, plan, &created, &expires, &frozen)? != hash
        {
            return Err(BusinessDatabaseError::MutationStale);
        }
        if phase == "awaiting_approval" {
            if expires.as_str() <= evidence.occurred_at.as_str() {
                return Err(BusinessDatabaseError::MutationStale);
            }
            for item in &frozen {
                if !inventory_still_matches(
                    &tx,
                    &self.workspace_id,
                    &item.frozen.connection_id,
                    item.frozen.credential_generation,
                    &item.frozen.domain,
                    Some(&item.frozen.observation_digest),
                )? || !locally_current(&tx, &self.workspace_id, &item.frozen)?
                    || other_execution(&tx, &self.workspace_id, &item.frozen, plan)?
                {
                    return Err(BusinessDatabaseError::MutationStale);
                }
            }
            let sequence = next_sequence(&tx, at)?;
            let operation = random_id()?;
            tx.execute("UPDATE operation_plans SET phase='approved',approved_at=?3,local_commit_sequence=?4 WHERE workspace_id=?1 AND plan_id=?2",params![self.workspace_id,plan,at,sequence]).map_err(storage)?;
            tx.execute("INSERT INTO operations(workspace_id,operation_id,plan_id,idempotency_key,phase,requested_at,local_commit_sequence) VALUES(?1,?2,?3,?3,'queued',?4,?5)",params![self.workspace_id,operation,plan,at,sequence]).map_err(storage)?;
            for item in &frozen {
                tx.execute("INSERT INTO operation_attempts(workspace_id,operation_id,plan_id,item_id,attempt_number,status,request_digest) VALUES(?1,?2,?3,?4,1,'queued',?5)",params![self.workspace_id,operation,plan,item.id,request_digest(&item.frozen)?]).map_err(storage)?;
            }
            let targets = frozen
                .iter()
                .map(|item| {
                    Ok(ApprovalTarget {
                        item_id: item.id.clone(),
                        request_digest: request_digest(&item.frozen)?,
                    })
                })
                .collect::<Result<Vec<_>>>()?;
            execution_evidence::record_approval(
                &tx, evidence, plan, &operation, hash, &targets, signer,
            )?;
            tx.execute(
                "UPDATE operation_plans SET phase='executing' WHERE workspace_id=?1 AND plan_id=?2",
                params![self.workspace_id, plan],
            )
            .map_err(storage)?;
            tx.execute("UPDATE operations SET phase='running',started_at=?3 WHERE workspace_id=?1 AND operation_id=?2",params![self.workspace_id,operation,at]).map_err(storage)?;
        } else if !["approved", "executing", "completed"].contains(&phase.as_str()) {
            return Err(BusinessDatabaseError::MutationStale);
        }
        guard()?;
        tx.commit().map_err(storage)?;
        self.afternic_delist_plan(plan, at)
    }
}

impl BusinessDatabase {
    pub(crate) fn afternic_delist_plan(
        &self,
        plan: &str,
        at: &str,
    ) -> Result<DesktopAfternicDelistPlan> {
        identifier(plan)?;
        timestamp(at)?;
        let c = self.store.raw_connection();
        let (hash,phase,created,expires,approved):(String,String,String,String,Option<String>)=c.query_row("SELECT plan_hash,phase,created_at,expires_at,approved_at FROM operation_plans WHERE workspace_id=?1 AND plan_id=?2 AND operation_kind='afternic_delist'",params![self.workspace_id,plan],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?))).map_err(|_|BusinessDatabaseError::InvalidInput)?;
        let stored = items(c, &self.workspace_id, plan)?;
        if plan_hash(&self.workspace_id, plan, &created, &expires, &stored)? != hash {
            return Err(BusinessDatabaseError::StorageRejected);
        }
        let label:String=c.query_row("SELECT display_label FROM local_provider_connections WHERE workspace_id=?1 AND connection_id=?2",params![self.workspace_id,stored[0].frozen.connection_id],|r|r.get(0)).map_err(storage)?;
        let mut output = Vec::with_capacity(stored.len());
        for item in stored {
            let fact:Option<ItemReadFact>=c.query_row("SELECT a.status,r.outcome,r.reason,r.next_read_at FROM operation_attempts a LEFT JOIN afternic_delist_reconciliations r ON r.workspace_id=a.workspace_id AND r.operation_id=a.operation_id AND r.item_id=a.item_id AND r.sequence=(SELECT max(n.sequence) FROM afternic_delist_reconciliations n WHERE n.workspace_id=a.workspace_id AND n.operation_id=a.operation_id AND n.item_id=a.item_id) WHERE a.workspace_id=?1 AND a.plan_id=?2 AND a.item_id=?3",params![self.workspace_id,plan,item.id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).optional().map_err(storage)?;
            let (state, reason, retry) = match fact {
                None if approved.is_none() => ("preview", None, None),
                Some((_, Some(outcome), _, _)) if outcome == "absent" => ("succeeded", None, None),
                Some((_, Some(outcome), reason, _)) if outcome == "conflict" => {
                    ("conflict", reason, None)
                }
                Some((status, _, reason, retry)) if status == "queued" => ("queued", reason, retry),
                Some((status, _, reason, retry))
                    if ["running", "outcome_unknown"].contains(&status.as_str()) =>
                {
                    ("reconciling", reason, retry)
                }
                _ => return Err(BusinessDatabaseError::StorageRejected),
            };
            let frozen = item.frozen;
            output.push(DesktopAfternicDelistPreviewItem {
                domain: frozen.domain,
                provider_status: frozen.listing.status,
                buynow_price: frozen.listing.buynow_price,
                floor_price: frozen.listing.floor_price,
                minbid_price: frozen.listing.minbid_price,
                hidden: frozen.listing.hidden,
                observed_at: frozen.observed_at,
                state: state.into(),
                reason,
                retry_at: retry,
            });
        }
        let pending = output
            .iter()
            .any(|i| ["queued", "reconciling"].contains(&i.state.as_str()));
        let conflict = output.iter().any(|i| i.state == "conflict");
        let state = if approved.is_none() {
            if expires.as_str() <= at {
                "expired"
            } else {
                "awaiting_approval"
            }
        } else if pending {
            "executing"
        } else if conflict {
            "partially_failed"
        } else {
            "completed"
        };
        if approved.is_some() && ((phase == "completed") == pending) {
            return Err(BusinessDatabaseError::StorageRejected);
        }
        Ok(DesktopAfternicDelistPlan {
            schema_version: 1,
            plan_ref: plan.into(),
            plan_hash: hash,
            connection_label: label,
            created_at: created,
            expires_at: expires,
            approved_at: approved,
            state: state.into(),
            items: output,
        })
    }
    pub(crate) fn afternic_delist_status(
        &self,
        selected: Option<&str>,
        at: &str,
    ) -> Result<DesktopAfternicDelistStatus> {
        let mut q=self.store.raw_connection().prepare("SELECT plan_id FROM operation_plans WHERE workspace_id=?1 AND operation_kind='afternic_delist' ORDER BY created_at DESC,plan_id DESC LIMIT 50").map_err(storage)?;
        let ids = q
            .query_map([&self.workspace_id], |r| r.get::<_, String>(0))
            .map_err(storage)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(storage)?;
        let mut plans = Vec::new();
        for id in ids {
            let p = self.afternic_delist_plan(&id, at)?;
            let total =
                u32::try_from(p.items.len()).map_err(|_| BusinessDatabaseError::StorageRejected)?;
            let succeeded =
                u32::try_from(p.items.iter().filter(|i| i.state == "succeeded").count())
                    .map_err(|_| BusinessDatabaseError::StorageRejected)?;
            let conflicts = u32::try_from(p.items.iter().filter(|i| i.state == "conflict").count())
                .map_err(|_| BusinessDatabaseError::StorageRejected)?;
            plans.push(DesktopAfternicDelistSummary {
                plan_ref: p.plan_ref,
                connection_label: p.connection_label,
                created_at: p.created_at,
                state: p.state,
                total,
                succeeded,
                conflicts,
                pending: total - succeeded - conflicts,
            });
        }
        Ok(DesktopAfternicDelistStatus {
            schema_version: 1,
            controlled_acceptance: None,
            write_qualified: false,
            write_entitled: false,
            plans,
            detail: selected
                .map(|id| self.afternic_delist_plan(id, at))
                .transpose()?,
        })
    }
    pub(crate) fn next_afternic_delist_work_with_evidence<G>(
        &mut self,
        at: &str,
        allow_write: bool,
        evidence: &ExecutionEvidenceContext,
        signer: &mut EvidenceSigner<'_>,
        guard: G,
    ) -> Result<Option<AfternicDelistWorkSeed>>
    where
        G: FnOnce() -> Result<()>,
    {
        timestamp(at)?;
        let tx = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(storage)?;
        if !delist_write_open(&tx, &self.workspace_id)? {
            return Ok(None);
        }
        let evidence_fence = execution_evidence::read_fence(&tx, evidence)?;
        let allow_write = allow_write && delist_write_open(&tx, &self.workspace_id)?;
        let mut selected = None;
        // Bound maintenance per wake so corrupt or stale histories cannot starve the application.
        for _ in 0..500 {
            let row:Option<(String,String,String,String,String,String)>=tx.query_row("SELECT a.plan_id,a.operation_id,a.item_id,a.request_digest,a.status,i.precondition_json FROM afternic_delist_effective_attempts a JOIN operation_plan_items i USING(workspace_id,plan_id,item_id) JOIN operations o USING(workspace_id,operation_id) LEFT JOIN afternic_delist_reconciliations r ON r.workspace_id=a.workspace_id AND r.operation_id=a.operation_id AND r.item_id=a.item_id AND r.sequence=(SELECT max(n.sequence) FROM afternic_delist_reconciliations n WHERE n.workspace_id=a.workspace_id AND n.operation_id=a.operation_id AND n.item_id=a.item_id) WHERE a.workspace_id=?1 AND o.phase='running' AND a.effective_status IN ('queued','running','outcome_unknown') AND (?3 OR a.status!='queued') AND (r.next_read_at IS NULL OR r.next_read_at<=?2) ORDER BY a.status='queued',o.requested_at,a.operation_id,i.ordinal LIMIT 1",params![self.workspace_id,at,allow_write],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?))).optional().map_err(storage)?;
            let Some((plan_id, operation_id, item_id, digest, status, wire)) = row else {
                break;
            };
            let frozen: AfternicDelistFrozenItem = decode(&wire)?;
            validate_stored_item(&tx, &self.workspace_id, &plan_id, &item_id, &frozen)?;
            if request_digest(&frozen)? != digest {
                return Err(BusinessDatabaseError::StorageRejected);
            }
            let seed = AfternicDelistWorkSeed {
                plan_id,
                operation_id,
                item_id,
                request_digest: digest,
                frozen,
                evidence_fence: evidence_fence.clone(),
                kind: if status == "queued" {
                    DesktopAfternicDelistWorkKind::Preflight
                } else {
                    DesktopAfternicDelistWorkKind::Reconcile
                },
            };
            if locally_current(&tx, &self.workspace_id, &seed.frozen)? {
                selected = Some(seed);
                break;
            }
            record_fact(
                &tx,
                &self.workspace_id,
                &seed,
                "conflict",
                Some("connection_changed"),
                None,
                None,
                at,
                evidence,
                signer,
            )?;
        }
        guard()?;
        tx.commit().map_err(storage)?;
        Ok(selected)
    }
    pub(crate) fn recheck_afternic_delist_work(&self, seed: &AfternicDelistWorkSeed) -> Result<()> {
        if seed.kind == DesktopAfternicDelistWorkKind::Preflight {
            self.require_afternic_delist_write_open()?;
        }
        execution_evidence::check_read_fence(
            self.store.raw_connection(),
            &self.workspace_id,
            &seed.evidence_fence,
        )?;
        check_work(self.store.raw_connection(), &self.workspace_id, seed)?;
        if !locally_current(
            self.store.raw_connection(),
            &self.workspace_id,
            &seed.frozen,
        )? {
            return Err(BusinessDatabaseError::MutationStale);
        }
        Ok(())
    }
    pub(crate) fn claim_afternic_delist_with_evidence<G>(
        &mut self,
        seed: &AfternicDelistWorkSeed,
        observation: Option<&DesktopAfternicListingObservation>,
        at: &str,
        evidence: &ExecutionEvidenceContext,
        signer: &mut EvidenceSigner<'_>,
        guard: G,
    ) -> Result<bool>
    where
        G: FnOnce() -> Result<()>,
    {
        if evidence.workspace_id != self.workspace_id {
            return Err(BusinessDatabaseError::MutationStale);
        }
        if seed.kind != DesktopAfternicDelistWorkKind::Preflight {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        validate_observation(seed, observation)?;
        timestamp(at)?;
        let tx = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(storage)?;
        require_delist_write_open(&tx, &self.workspace_id)?;
        execution_evidence::check_read_fence(&tx, &self.workspace_id, &seed.evidence_fence)?;
        check_work(&tx, &self.workspace_id, seed)?;
        if !locally_current(&tx, &self.workspace_id, &seed.frozen)? {
            return Err(BusinessDatabaseError::MutationStale);
        }
        let claim = match observation {
            None => {
                record_fact(
                    &tx,
                    &self.workspace_id,
                    seed,
                    "absent",
                    None,
                    None,
                    None,
                    at,
                    evidence,
                    signer,
                )?;
                false
            }
            Some(current) if *current != seed.frozen.listing => {
                record_fact(
                    &tx,
                    &self.workspace_id,
                    seed,
                    "conflict",
                    Some("precondition_changed"),
                    Some(current),
                    None,
                    at,
                    evidence,
                    signer,
                )?;
                false
            }
            Some(_) => {
                execution_evidence::record_claim(
                    &tx,
                    evidence,
                    &seed.operation_id,
                    &seed.item_id,
                    &seed.request_digest,
                    signer,
                )?;
                let changed=tx.execute("UPDATE operation_attempts SET status='running',started_at=?5,retry_after=NULL WHERE workspace_id=?1 AND operation_id=?2 AND item_id=?3 AND request_digest=?4 AND status='queued'",params![self.workspace_id,seed.operation_id,seed.item_id,seed.request_digest,at]).map_err(storage)?;
                if changed != 1 {
                    return Err(BusinessDatabaseError::MutationStale);
                }
                next_sequence(&tx, at)?;
                true
            }
        };
        guard()?;
        tx.commit().map_err(storage)?;
        Ok(claim)
    }
    pub(crate) fn require_afternic_delist_signed_claim(
        &self,
        seed: &AfternicDelistWorkSeed,
        context: &ExecutionEvidenceContext,
    ) -> Result<()> {
        execution_evidence::require_claim(
            self.store.raw_connection(),
            context,
            &seed.operation_id,
            &seed.item_id,
        )
    }
    pub(crate) fn reconcile_afternic_delist_with_evidence<G>(
        &mut self,
        seed: &AfternicDelistWorkSeed,
        observation: Option<&DesktopAfternicListingObservation>,
        at: &str,
        evidence: &ExecutionEvidenceContext,
        signer: &mut EvidenceSigner<'_>,
        guard: G,
    ) -> Result<()>
    where
        G: FnOnce() -> Result<()>,
    {
        if seed.kind != DesktopAfternicDelistWorkKind::Reconcile {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        validate_observation(seed, observation)?;
        timestamp(at)?;
        let tx = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(storage)?;
        execution_evidence::check_read_fence(&tx, &self.workspace_id, &seed.evidence_fence)?;
        check_work(&tx, &self.workspace_id, seed)?;
        if !locally_current(&tx, &self.workspace_id, &seed.frozen)? {
            return Err(BusinessDatabaseError::MutationStale);
        }
        record_fact(
            &tx,
            &self.workspace_id,
            seed,
            if observation.is_none() {
                "absent"
            } else {
                "present"
            },
            observation.map(|_| "still_present"),
            observation,
            None,
            at,
            evidence,
            signer,
        )?;
        guard()?;
        tx.commit().map_err(storage)
    }
    pub(crate) fn defer_afternic_delist_read_with_evidence<G>(
        &mut self,
        seed: &AfternicDelistWorkSeed,
        retry_after: Option<u32>,
        at: &str,
        evidence: &ExecutionEvidenceContext,
        signer: &mut EvidenceSigner<'_>,
        guard: G,
    ) -> Result<()>
    where
        G: FnOnce() -> Result<()>,
    {
        timestamp(at)?;
        let tx = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(storage)?;
        execution_evidence::check_read_fence(&tx, &self.workspace_id, &seed.evidence_fence)?;
        check_work(&tx, &self.workspace_id, seed)?;
        if !locally_current(&tx, &self.workspace_id, &seed.frozen)? {
            return Err(BusinessDatabaseError::MutationStale);
        }
        record_fact(
            &tx,
            &self.workspace_id,
            seed,
            "read_failed",
            Some("read_failed"),
            None,
            retry_after,
            at,
            evidence,
            signer,
        )?;
        guard()?;
        tx.commit().map_err(storage)
    }
}

fn validate_observation(
    seed: &AfternicDelistWorkSeed,
    observation: Option<&DesktopAfternicListingObservation>,
) -> Result<()> {
    if let Some(listing) = observation {
        listing.validate()?;
        if listing.domain != seed.frozen.domain {
            return Err(BusinessDatabaseError::InvalidInput);
        }
    }
    Ok(())
}
fn check_work(c: &Connection, workspace: &str, seed: &AfternicDelistWorkSeed) -> Result<()> {
    validate_stored_item(c, workspace, &seed.plan_id, &seed.item_id, &seed.frozen)?;
    let valid:bool=c.query_row("SELECT EXISTS(SELECT 1 FROM afternic_delist_effective_attempts a JOIN operation_plan_items i USING(workspace_id,plan_id,item_id) JOIN operations o USING(workspace_id,operation_id) WHERE a.workspace_id=?1 AND a.operation_id=?2 AND a.plan_id=?3 AND a.item_id=?4 AND a.request_digest=?5 AND i.precondition_json=?6 AND o.phase='running' AND a.effective_status IN ('queued','running','outcome_unknown') AND ((?7 AND a.status='queued') OR (NOT ?7 AND a.status IN ('running','outcome_unknown'))))",params![workspace,seed.operation_id,seed.plan_id,seed.item_id,seed.request_digest,encode(&seed.frozen)?,seed.kind==DesktopAfternicDelistWorkKind::Preflight],|r|r.get(0)).map_err(storage)?;
    if !valid || request_digest(&seed.frozen)? != seed.request_digest {
        return Err(BusinessDatabaseError::MutationStale);
    }
    Ok(())
}

#[expect(
    clippy::too_many_arguments,
    reason = "one concrete reconciliation fact is committed with its exact transaction, workspace, attempt and observation time"
)]
fn record_fact(
    c: &Connection,
    workspace: &str,
    seed: &AfternicDelistWorkSeed,
    outcome: &str,
    reason: Option<&str>,
    observation: Option<&DesktopAfternicListingObservation>,
    retry_after: Option<u32>,
    at: &str,
    evidence: &ExecutionEvidenceContext,
    signer: &mut EvidenceSigner<'_>,
) -> Result<()> {
    if evidence.workspace_id != workspace {
        return Err(BusinessDatabaseError::MutationStale);
    }
    let audit_id = execution_evidence::record_observation(
        c,
        evidence,
        &seed.evidence_fence,
        &seed.operation_id,
        &seed.item_id,
        outcome,
        reason,
        seed.kind == DesktopAfternicDelistWorkKind::Preflight,
        signer,
    )?;
    let current:String=c.query_row("SELECT status FROM operation_attempts WHERE workspace_id=?1 AND operation_id=?2 AND item_id=?3",params![workspace,seed.operation_id,seed.item_id],|r|r.get(0)).map_err(storage)?;
    // A terminal unknown attempt remains immutable. Later GET facts resolve its effective
    // customer state without granting a second mutation or erasing the uncertainty history.
    let target = match (current.as_str(), outcome) {
        ("queued" | "running", "absent") => Some("succeeded"),
        ("queued", "conflict") => Some("failed_final"),
        ("running", _) => Some("outcome_unknown"),
        ("queued", "read_failed") | ("outcome_unknown", _) => None,
        _ => return Err(BusinessDatabaseError::MutationStale),
    };
    if let Some(target) = target {
        c.execute("UPDATE operation_attempts SET status=?4,started_at=COALESCE(started_at,?5),completed_at=?5,retry_after=NULL,error_code=?6 WHERE workspace_id=?1 AND operation_id=?2 AND item_id=?3",params![workspace,seed.operation_id,seed.item_id,target,at,reason]).map_err(storage)?;
        c.execute("INSERT INTO operation_results(workspace_id,operation_id,plan_id,item_id,attempt_number,result_version,outcome,result_json,observed_at) VALUES(?1,?2,?3,?4,1,1,?5,?6,?7)",params![workspace,seed.operation_id,seed.plan_id,seed.item_id,target,encode(&serde_json::json!({"action":"remove","outcome":target}))?,at]).map_err(storage)?;
    }
    let sequence:i64=c.query_row("SELECT count(*)+1 FROM afternic_delist_reconciliations WHERE workspace_id=?1 AND operation_id=?2 AND item_id=?3",params![workspace,seed.operation_id,seed.item_id],|r|r.get(0)).map_err(storage)?;
    let next_read = if ["present", "read_failed"].contains(&outcome) {
        let exponent = u32::try_from(sequence - 1).unwrap_or(u32::MAX).min(5);
        let seconds = (30_u32 << exponent).min(900).max(retry_after.unwrap_or(0));
        Some(plus_seconds(c, at, seconds)?)
    } else {
        None
    };
    let observation_json = observation.map(encode).transpose()?;
    let digest = if outcome == "absent" {
        Some(hex_digest(
            encode(&(
                "afternic-exact-absence-v1",
                &seed.frozen.domain,
                &seed.request_digest,
                at,
            ))?
            .as_bytes(),
        ))
    } else {
        observation_json
            .as_ref()
            .map(|wire| hex_digest(wire.as_bytes()))
    };
    let commit_sequence = next_sequence(c, at)?;
    let listing_observation_id = if outcome == "absent" {
        Some(record_absence(
            c,
            workspace,
            seed,
            digest
                .as_deref()
                .ok_or(BusinessDatabaseError::StorageRejected)?,
            at,
            commit_sequence,
        )?)
    } else {
        None
    };
    c.execute("INSERT INTO afternic_delist_reconciliations(workspace_id,operation_id,plan_id,item_id,attempt_number,sequence,request_digest,stage,outcome,reason,observed_at,next_read_at,observation_json,observation_digest,listing_observation_id,audit_event_id) VALUES(?1,?2,?3,?4,1,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)",params![workspace,seed.operation_id,seed.plan_id,seed.item_id,sequence,seed.request_digest,if seed.kind==DesktopAfternicDelistWorkKind::Preflight{"preflight"}else{"reconcile"},outcome,reason,at,next_read,observation_json,digest,listing_observation_id,audit_id]).map_err(storage)?;
    if outcome == "absent" {
        let changed=c.execute("UPDATE domain_asset_provider_bindings SET validation_status='detached',verified_at=NULL,local_commit_sequence=?7,last_observed_at=?8,updated_at=?8 WHERE workspace_id=?1 AND entity_id=?2 AND connection_id=?3 AND resource_kind='listing' AND resource_binding_digest=?4 AND binding_generation=?5 AND validation_status IN ('verified','unverified') AND observation_digest=?6",params![workspace,seed.frozen.domain,seed.frozen.connection_id,seed.frozen.binding_digest,sql_integer(seed.frozen.binding_generation)?,digest,commit_sequence,at]).map_err(storage)?;
        if changed != 1 {
            return Err(BusinessDatabaseError::MutationStale);
        }
    }
    let (pending,failures):(i64,i64)=c.query_row("SELECT sum(effective_status IN ('queued','running','outcome_unknown')),sum(effective_status='failed_final') FROM afternic_delist_effective_attempts WHERE workspace_id=?1 AND operation_id=?2",params![workspace,seed.operation_id],|r|Ok((r.get(0)?,r.get(1)?))).map_err(storage)?;
    if pending == 0 {
        c.execute("UPDATE operations SET phase=?3,completed_at=?4,local_commit_sequence=?5 WHERE workspace_id=?1 AND operation_id=?2",params![workspace,seed.operation_id,if failures==0{"completed"}else{"partially_failed"},at,commit_sequence]).map_err(storage)?;
        c.execute("UPDATE operation_plans SET phase='completed',local_commit_sequence=?3 WHERE workspace_id=?1 AND plan_id=?2",params![workspace,seed.plan_id,commit_sequence]).map_err(storage)?;
    }
    Ok(())
}
fn record_absence(
    c: &Connection,
    workspace: &str,
    seed: &AfternicDelistWorkSeed,
    digest: &str,
    at: &str,
    sequence: i64,
) -> Result<String> {
    let run = random_id()?;
    let observation = random_id()?;
    c.execute("INSERT INTO provider_observation_runs(workspace_id,observation_run_id,connection_id,observation_capability,started_at,status,connector_version) VALUES(?1,?2,?3,'marketplace',?4,'running',?5)",params![workspace,run,seed.frozen.connection_id,at,ADAPTER]).map_err(storage)?;
    c.execute("INSERT INTO provider_observation_targets(workspace_id,observation_run_id,entity_id,ordinal,status,requested_at) VALUES(?1,?2,?3,0,'requested',?4)",params![workspace,run,seed.frozen.domain,at]).map_err(storage)?;
    c.execute("UPDATE domain_asset_provider_bindings SET observation_digest=?6,last_observed_at=?7,updated_at=?7,local_commit_sequence=?8 WHERE workspace_id=?1 AND entity_id=?2 AND connection_id=?3 AND resource_kind='listing' AND resource_binding_digest=?4 AND binding_generation=?5 AND validation_status IN ('verified','unverified')",params![workspace,seed.frozen.domain,seed.frozen.connection_id,seed.frozen.binding_digest,sql_integer(seed.frozen.binding_generation)?,digest,at,sequence]).map_err(storage)?;
    c.execute("INSERT INTO marketplace_listing_observations(workspace_id,listing_observation_id,observation_run_id,entity_id,marketplace_kind,listing_status,observed_at,provider_version_token,observation_availability,evidence_status,binding_connection_id,binding_resource_digest,binding_generation) VALUES(?1,?2,?3,?4,'afternic','unlisted',?5,?6,'available','confirmed',?7,?8,?9)",params![workspace,observation,run,seed.frozen.domain,at,digest,seed.frozen.connection_id,seed.frozen.binding_digest,sql_integer(seed.frozen.binding_generation)?]).map_err(storage)?;
    c.execute("UPDATE provider_observation_targets SET status='succeeded',completed_at=?4 WHERE workspace_id=?1 AND observation_run_id=?2 AND entity_id=?3",params![workspace,run,seed.frozen.domain,at]).map_err(storage)?;
    c.execute("UPDATE provider_observation_runs SET status='succeeded',completed_at=?3 WHERE workspace_id=?1 AND observation_run_id=?2",params![workspace,run,at]).map_err(storage)?;
    c.execute("UPDATE active_workspace_metadata SET last_successful_provider_observation_at=?1 WHERE singleton=1",[at]).map_err(storage)?;
    Ok(observation)
}

#[cfg(test)]
#[path = "afternic_delist_tests.rs"]
mod tests;

#[cfg(test)]
impl BusinessDatabase {
    pub(crate) fn preview_afternic_delist<G>(
        &mut self,
        seed: &AfternicConnectionSeed,
        domains: &[String],
        at: &str,
        guard: G,
    ) -> Result<DesktopAfternicDelistPlan>
    where
        G: FnOnce() -> Result<()>,
    {
        self.preview_afternic_delist_with_time(seed, domains, at, at, guard)
    }

    pub(crate) fn approve_afternic_delist<G>(
        &mut self,
        plan: &str,
        hash: &str,
        at: &str,
        guard: G,
    ) -> Result<DesktopAfternicDelistPlan>
    where
        G: FnOnce() -> Result<()>,
    {
        let (context, mut signer) = execution_evidence::test_context(&self.workspace_id, at);
        self.approve_afternic_delist_with_evidence(plan, hash, at, &context, &mut signer, guard)
    }
    pub(crate) fn claim_afternic_delist<G>(
        &mut self,
        seed: &AfternicDelistWorkSeed,
        observation: Option<&DesktopAfternicListingObservation>,
        at: &str,
        guard: G,
    ) -> Result<bool>
    where
        G: FnOnce() -> Result<()>,
    {
        let (context, mut signer) = execution_evidence::test_context(&self.workspace_id, at);
        self.claim_afternic_delist_with_evidence(
            seed,
            observation,
            at,
            &context,
            &mut signer,
            guard,
        )
    }
}

#[cfg(test)]
impl BusinessDatabase {
    pub(crate) fn next_afternic_delist_work(
        &mut self,
        at: &str,
        allow_write: bool,
        guard: impl FnOnce() -> Result<()>,
    ) -> Result<Option<AfternicDelistWorkSeed>> {
        let (context, mut signer) = execution_evidence::test_context(&self.workspace_id, at);
        self.next_afternic_delist_work_with_evidence(at, allow_write, &context, &mut signer, guard)
    }
    pub(crate) fn reconcile_afternic_delist(
        &mut self,
        seed: &AfternicDelistWorkSeed,
        observation: Option<&DesktopAfternicListingObservation>,
        at: &str,
        guard: impl FnOnce() -> Result<()>,
    ) -> Result<()> {
        let (context, mut signer) = execution_evidence::test_context(&self.workspace_id, at);
        self.reconcile_afternic_delist_with_evidence(
            seed,
            observation,
            at,
            &context,
            &mut signer,
            guard,
        )
    }
    pub(crate) fn defer_afternic_delist_read(
        &mut self,
        seed: &AfternicDelistWorkSeed,
        retry: Option<u32>,
        at: &str,
        guard: impl FnOnce() -> Result<()>,
    ) -> Result<()> {
        let (context, mut signer) = execution_evidence::test_context(&self.workspace_id, at);
        self.defer_afternic_delist_read_with_evidence(seed, retry, at, &context, &mut signer, guard)
    }
}
