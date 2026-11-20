//! The durable BIN price preview reads only current, account-scoped `SellerHub` observations.
use super::{
    BusinessDatabase, BusinessDatabaseError,
    afternic::random_id,
    execution_evidence::{
        self, ApprovalTarget, EvidenceSigner, ExecutionEvidenceContext,
        marketplace_approval::{self, ApprovalPurpose},
    },
    hex_digest, is_uuid_v4, validate_domain_asset_id, validate_sha256_hex, validate_timestamp,
};
use crate::{DesktopSellerHubListingFact, DesktopSellerHubListingState};
use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[path = "spaceship_sellerhub_bin_read.rs"]
mod read;
#[path = "spaceship_sellerhub_bin_results.rs"]
mod results;
pub use read::{DesktopSellerHubBinPlanSummary, DesktopSellerHubBinStatusRequest};

const MAX_CENTS: u64 = 9_007_199_254_740_991;
const MAX_TARGETS: usize = 500;
const PLAN_KIND: &str = "sellerhub_bin_price";
type Result<T> = std::result::Result<T, BusinessDatabaseError>;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DesktopSellerHubBinPreviewRequest {
    pub schema_version: u8,
    pub connection_id: String,
    pub items: Vec<DesktopSellerHubBinTarget>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DesktopSellerHubBinTarget {
    pub domain: String,
    pub price_cents: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopSellerHubBinPlan {
    pub schema_version: u8,
    pub plan_id: String,
    pub connection_id: String,
    pub connection_label: String,
    pub state: &'static str,
    pub plan_hash: String,
    pub expires_at: String,
    pub items: Vec<DesktopSellerHubBinPlanItem>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopSellerHubBinPlanItem {
    pub domain: String,
    pub previous_price_cents: u64,
    pub price_cents: u64,
    pub state: &'static str,
    pub reason: Option<String>,
    pub retry_at: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DesktopSellerHubBinApproveRequest {
    pub schema_version: u8,
    pub plan_id: String,
    pub plan_hash: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopSellerHubBinApproval {
    pub schema_version: u8,
    pub operation_id: String,
}

#[derive(PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FrozenTarget {
    item_id: String,
    domain: String,
    connection_id: String,
    connection_incarnation_id: String,
    scan_id: String,
    observation_id: String,
    observation_digest: String,
    asset_generation: u64,
    binding_digest: String,
    binding_generation: u64,
    previous_price_cents: u64,
    price_cents: u64,
}

impl FrozenTarget {
    fn validate(&self) -> Result<()> {
        let rejected = BusinessDatabaseError::StorageRejected;
        if [
            &self.item_id,
            &self.connection_id,
            &self.connection_incarnation_id,
            &self.scan_id,
            &self.observation_id,
        ]
        .into_iter()
        .any(|id| !is_uuid_v4(id))
            || [
                self.previous_price_cents,
                self.price_cents,
                self.asset_generation,
                self.binding_generation,
            ]
            .into_iter()
            .any(|n| !(1..=MAX_CENTS).contains(&n))
            || self.previous_price_cents == self.price_cents
        {
            return Err(rejected);
        }
        validate_domain_asset_id(&self.domain).map_err(|_| rejected)?;
        validate_sha256_hex(&self.observation_digest).map_err(|_| rejected)?;
        validate_sha256_hex(&self.binding_digest).map_err(|_| rejected)
    }
}

fn stored_price(value: &str) -> Result<u64> {
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct PriceProjection {
        cents: u64,
    }

    let rejected = BusinessDatabaseError::StorageRejected;
    if value.len() > 64 {
        return Err(rejected);
    }
    let price: PriceProjection = serde_json::from_str(value).map_err(|_| rejected)?;
    (1..=MAX_CENTS)
        .contains(&price.cents)
        .then_some(price.cents)
        .ok_or(rejected)
}

fn plan_hash(
    workspace: &str,
    id: &str,
    at: &str,
    expires_at: &str,
    target: &[FrozenTarget],
) -> Result<String> {
    let bytes = serde_json::to_vec(&(PLAN_KIND, 1, workspace, id, at, expires_at, target))
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    Ok(hex_digest(&bytes))
}

struct StoredPlan {
    hash: String,
    phase: String,
    expires_at: String,
    targets: Vec<FrozenTarget>,
}

fn read_plan(db: &Connection, workspace: &str, id: &str) -> Result<StoredPlan> {
    use crate::active_workspace::capability_qualification::SPACESHIP_MARKETPLACE_WRITE;
    let rejected = BusinessDatabaseError::StorageRejected;
    let (hash, created_at, expires_at, count, phase): (String, String, String, i64, String) = db.query_row(
        "SELECT plan_hash,created_at,expires_at,item_count,phase FROM operation_plans WHERE workspace_id=?1
         AND plan_id=?2 AND operation_kind=?3 AND risk_level='standard'",
        params![workspace,id,PLAN_KIND],
        |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?)),
    ).optional().map_err(storage)?.ok_or(BusinessDatabaseError::MutationStale)?;
    let count = usize::try_from(count).map_err(|_| rejected)?;
    if !is_uuid_v4(id) || !(1..=MAX_TARGETS).contains(&count) {
        return Err(rejected);
    }
    validate_timestamp(Some(created_at.clone())).map_err(|_| rejected)?;
    validate_timestamp(Some(expires_at.clone())).map_err(|_| rejected)?;
    let mut stmt = db
        .prepare(
            "SELECT item_id,entity_id,connection_id,ordinal,precondition_json,old_value_json,new_value_json,
               capability=?3 AND field_path='binPrice' AND risk_level='standard'
                 AND execution_mode='automatic' AND inclusion_status='included'
             FROM operation_plan_items WHERE workspace_id=?1 AND plan_id=?2
             ORDER BY ordinal LIMIT ?4",
        )
        .map_err(storage)?;
    let mut rows = stmt
        .query(params![
            workspace,
            id,
            SPACESHIP_MARKETPLACE_WRITE,
            sql_integer(MAX_TARGETS + 1)?
        ])
        .map_err(storage)?;
    let mut frozen: Vec<FrozenTarget> = Vec::with_capacity(count);
    while let Some(row) = rows.next().map_err(storage)? {
        let encoded: String = row.get(4).map_err(storage)?;
        if !row.get::<_, bool>(7).map_err(storage)? || encoded.len() > 4096 {
            return Err(rejected);
        }
        let item: FrozenTarget = serde_json::from_str(&encoded).map_err(|_| rejected)?;
        item.validate()?;
        if row.get::<_, String>(0).map_err(storage)? != item.item_id
            || row.get::<_, String>(1).map_err(storage)? != item.domain
            || row.get::<_, String>(2).map_err(storage)? != item.connection_id
            || row.get::<_, i64>(3).map_err(storage)? != sql_integer(frozen.len())?
            || stored_price(&row.get::<_, String>(5).map_err(storage)?)?
                != item.previous_price_cents
            || stored_price(&row.get::<_, String>(6).map_err(storage)?)? != item.price_cents
            || frozen.last().is_some_and(|previous| {
                previous.domain >= item.domain || previous.connection_id != item.connection_id
            })
        {
            return Err(rejected);
        }
        frozen.push(item);
    }
    if frozen.len() != count || hash != plan_hash(workspace, id, &created_at, &expires_at, &frozen)?
    {
        return Err(rejected);
    }
    Ok(StoredPlan {
        hash,
        phase,
        expires_at,
        targets: frozen,
    })
}

fn read_preview(db: &Connection, workspace: &str, id: &str) -> Result<DesktopSellerHubBinPlan> {
    let plan = read_plan(db, workspace, id)?;
    if plan.phase != "awaiting_approval" {
        return Err(BusinessDatabaseError::MutationStale);
    }
    read::project_plan(db, workspace, id, plan, None)
}

fn storage(_: rusqlite::Error) -> BusinessDatabaseError {
    BusinessDatabaseError::StorageRejected
}

fn sql_integer(value: impl TryInto<i64>) -> Result<i64> {
    value
        .try_into()
        .map_err(|_| BusinessDatabaseError::InvalidInput)
}

fn price_cents(amount: &str) -> Option<u64> {
    let (whole, fraction) = amount.split_once('.').unwrap_or((amount, ""));
    if whole.is_empty()
        || !whole.bytes().all(|b| b.is_ascii_digit())
        || fraction.len() > 2
        || !fraction.bytes().all(|b| b.is_ascii_digit())
        || (amount.contains('.') && fraction.is_empty())
    {
        return None;
    }
    let subunits = match fraction.len() {
        0 => 0,
        1 => fraction.parse::<u64>().ok()? * 10,
        _ => fraction.parse().ok()?,
    };
    let cents = whole
        .parse::<u64>()
        .ok()?
        .checked_mul(100)?
        .checked_add(subunits)?;
    (1..=MAX_CENTS).contains(&cents).then_some(cents)
}

fn targets(request: &DesktopSellerHubBinPreviewRequest) -> Result<BTreeMap<&str, u64>> {
    let bad = BusinessDatabaseError::InvalidInput;
    if request.schema_version != 1
        || !is_uuid_v4(&request.connection_id)
        || !(1..=MAX_TARGETS).contains(&request.items.len())
    {
        return Err(bad);
    }
    let mut unique = BTreeMap::new();
    for item in &request.items {
        validate_domain_asset_id(&item.domain).map_err(|_| bad)?;
        if !(1..=MAX_CENTS).contains(&item.price_cents)
            || unique
                .insert(item.domain.as_str(), item.price_cents)
                .is_some()
        {
            return Err(bad);
        }
    }
    Ok(unique)
}

fn load_target(
    db: &Connection,
    workspace: &str,
    connection: &str,
    domain: &str,
    next_price: u64,
    at: &str,
    item_id: String,
) -> Result<FrozenTarget> {
    let row = db.query_row(
        "SELECT s.incarnation_id,scan.scan_id,m.listing_observation_id,m.provider_version_token,
                m.sellerhub_asset_generation,m.binding_resource_digest,m.binding_generation,m.asking_price_amount
         FROM marketplace_listing_observations_read_facts m
         JOIN domain_assets a ON a.workspace_id=m.workspace_id AND a.entity_id=m.entity_id
           AND a.entity_generation=m.sellerhub_asset_generation
         JOIN spaceship_sellerhub_connections s ON s.workspace_id=m.workspace_id AND s.connection_id=m.binding_connection_id
         JOIN spaceship_sellerhub_scans scan ON scan.workspace_id=s.workspace_id AND scan.connection_id=s.connection_id
           AND scan.observation_run_id=m.observation_run_id
         WHERE m.workspace_id=?1 AND m.binding_connection_id=?2 AND m.entity_id=?3
           AND m.connection_rank=1 AND m.binding_fresh=1 AND m.binding_valid=1
           AND m.marketplace_kind='spaceship' AND m.sellerhub_asset_generation IS NOT NULL
           AND s.state='active' AND s.purged_at IS NULL
           AND a.lifecycle_status='active' AND a.deleted_at IS NULL
           AND m.listing_status='active' AND m.evidence_status='confirmed' AND m.observation_availability='available'
           AND m.asking_price_currency='USD' AND m.observed_at<=?4
           AND NOT EXISTS (SELECT 1 FROM sync_domain_asset_provisional_re_adds pending
             WHERE pending.workspace_id=a.workspace_id AND pending.entity_id=a.entity_id)
           AND NOT EXISTS (
             SELECT 1 FROM storage_repair_receipts r WHERE r.workspace_id=m.workspace_id
               AND r.repair_kind='listing_observation' AND r.row_key=m.listing_observation_id
           )",
        params![workspace,connection,domain,at],
        |row| Ok((
            row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?,
            row.get::<_, String>(3)?, row.get::<_, i64>(4)?, row.get::<_, String>(5)?,
            row.get::<_, i64>(6)?, row.get::<_, String>(7)?,
        )),
    ).optional().map_err(storage)?.ok_or(BusinessDatabaseError::MutationStale)?;
    let (
        incarnation,
        scan,
        observation,
        digest,
        asset_generation,
        binding_digest,
        binding_generation,
        amount,
    ) = row;
    let previous_price = price_cents(&amount).ok_or(BusinessDatabaseError::MutationStale)?;
    if previous_price == next_price {
        return Err(BusinessDatabaseError::InvalidInput);
    }
    validate_sha256_hex(&digest)?;
    validate_sha256_hex(&binding_digest)?;
    if [incarnation.as_str(), observation.as_str(), scan.as_str()]
        .into_iter()
        .any(|id| !is_uuid_v4(id))
        || asset_generation <= 0
        || binding_generation <= 0
    {
        return Err(BusinessDatabaseError::StorageRejected);
    }
    Ok(FrozenTarget {
        item_id,
        domain: domain.to_owned(),
        connection_id: connection.to_owned(),
        connection_incarnation_id: incarnation,
        scan_id: scan,
        observation_id: observation,
        observation_digest: digest,
        asset_generation: u64::try_from(asset_generation)
            .map_err(|_| BusinessDatabaseError::StorageRejected)?,
        binding_digest,
        binding_generation: u64::try_from(binding_generation)
            .map_err(|_| BusinessDatabaseError::StorageRejected)?,
        previous_price_cents: previous_price,
        price_cents: next_price,
    })
}

fn next_sequence(db: &Connection, at: &str) -> Result<i64> {
    db.query_row(
        "UPDATE active_workspace_metadata SET local_commit_sequence=local_commit_sequence+1,updated_at=?1
         WHERE singleton=1 RETURNING local_commit_sequence", [at], |r| r.get(0),
    ).map_err(storage)
}

fn already_in_execution(db: &Connection, workspace: &str, item: &FrozenTarget) -> Result<bool> {
    db.query_row(
        "SELECT EXISTS(SELECT 1 FROM operation_attempts a
         JOIN operation_plan_items i USING(workspace_id,plan_id,item_id)
         JOIN operation_plans p USING(workspace_id,plan_id)
         WHERE i.workspace_id=?1 AND i.connection_id=?2 AND i.entity_id=?3
         AND p.operation_kind=?4 AND
         a.status IN ('queued','running','outcome_unknown','waiting_remote','manual_action_required','failed_retryable'))",
        params![workspace,item.connection_id,item.domain,PLAN_KIND], |r| r.get(0),
    ).map_err(storage)
}

fn request_digest(item: &FrozenTarget) -> Result<String> {
    let bytes = serde_json::to_vec(&("GOODDEALER-SELLERHUB-BIN-PRICE-REQUEST-V1", item))
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    Ok(hex_digest(&bytes))
}

pub(crate) struct SellerHubBinWorkSeed {
    operation_id: String,
    plan_id: String,
    target: FrozenTarget,
    request_digest: String,
    pub(crate) needs_reconciliation: bool,
    retry_after: Option<String>,
    pub(crate) may_read_provider: bool,
}

impl SellerHubBinWorkSeed {
    pub(crate) fn domain(&self) -> &str {
        &self.target.domain
    }
    pub(crate) fn connection_id(&self) -> &str {
        &self.target.connection_id
    }
    pub(crate) fn connection_incarnation(&self) -> &str {
        &self.target.connection_incarnation_id
    }
    pub(crate) fn matches_prior_price(&self, observed: &DesktopSellerHubListingFact) -> bool {
        observed.domain == self.target.domain
            && matches!(observed.state, DesktopSellerHubListingState::OnSale)
            && observed
                .enabled_bin_price_usd
                .as_deref()
                .and_then(price_cents)
                == Some(self.target.previous_price_cents)
    }
    pub(crate) fn price_cents(&self) -> u64 {
        self.target.price_cents
    }
}

fn provider_block_reason(
    db: &Connection,
    workspace: &str,
    target: &FrozenTarget,
) -> Result<Option<&'static str>> {
    let (connection, binding): (bool,bool) = db.query_row(
        "SELECT EXISTS(SELECT 1 FROM spaceship_sellerhub_connections WHERE workspace_id=?1
          AND connection_id=?2 AND incarnation_id=?3 AND state='active' AND purged_at IS NULL),
         EXISTS(SELECT 1 FROM domain_assets d JOIN domain_asset_provider_bindings b USING(workspace_id,entity_id)
          WHERE d.workspace_id=?1 AND d.entity_id=?4 AND d.deleted_at IS NULL
           AND d.lifecycle_status='active' AND d.entity_generation=?5
           AND b.resource_kind='listing' AND b.connection_id=?2 AND b.validation_status!='detached'
           AND b.resource_binding_digest=?6 AND b.binding_generation=?7
           AND NOT EXISTS(SELECT 1 FROM sync_domain_asset_provisional_re_adds r
            WHERE r.workspace_id=d.workspace_id AND r.entity_id=d.entity_id))",
        params![workspace,target.connection_id,target.connection_incarnation_id,target.domain,
          sql_integer(target.asset_generation)?,target.binding_digest,sql_integer(target.binding_generation)?],
        |r| Ok((r.get(0)?,r.get(1)?)),
    ).map_err(storage)?;
    Ok(if !connection {
        Some("connection_changed")
    } else if !binding {
        Some("precondition_changed")
    } else {
        None
    })
}

struct WorkRow {
    operation: String,
    plan: String,
    item: String,
    digest: String,
    status: String,
    retry_after: Option<String>,
}

fn work(tx: &Connection, workspace: &str, row: WorkRow) -> Result<SellerHubBinWorkSeed> {
    let stale = BusinessDatabaseError::MutationStale;
    let stored = read_plan(tx, workspace, &row.plan)?;
    if stored.phase != "executing" || !is_uuid_v4(&row.operation) {
        return Err(stale);
    }
    let target = stored
        .targets
        .into_iter()
        .find(|target| target.item_id == row.item)
        .ok_or(stale)?;
    if request_digest(&target)? != row.digest {
        return Err(stale);
    }
    let needs_reconciliation = match row.status.as_str() {
        "queued" => false,
        "running" => true,
        _ => return Err(stale),
    };
    let may_read_provider = provider_block_reason(tx, workspace, &target)?.is_none();
    Ok(SellerHubBinWorkSeed {
        operation_id: row.operation,
        plan_id: row.plan,
        target,
        request_digest: row.digest,
        needs_reconciliation,
        retry_after: row.retry_after,
        may_read_provider,
    })
}

impl BusinessDatabase {
    pub(crate) fn preview_sellerhub_bin_price<G>(
        &mut self,
        request: &DesktopSellerHubBinPreviewRequest,
        at: &str,
        trusted_at: &str,
        guard: impl FnOnce() -> Result<G>,
    ) -> Result<DesktopSellerHubBinPlan> {
        let bad = BusinessDatabaseError::InvalidInput;
        let targets = targets(request)?;
        validate_timestamp(Some(at.to_owned())).map_err(|_| bad)?;
        validate_timestamp(Some(trusted_at.to_owned())).map_err(|_| bad)?;
        let workspace = &self.workspace_id;
        let tx = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(storage)?;
        let handoff: bool = tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM device_handoff_barriers WHERE workspace_id=?1)",
                [workspace],
                |r| r.get(0),
            )
            .map_err(storage)?;
        if handoff {
            return Err(BusinessDatabaseError::MutationStale);
        }
        let frozen = targets
            .into_iter()
            .map(|(domain, cents)| {
                load_target(
                    &tx,
                    workspace,
                    &request.connection_id,
                    domain,
                    cents,
                    at,
                    random_id()?,
                )
            })
            .collect::<Result<Vec<_>>>()?;
        let expires_at: String = tx
            .query_row(
                "SELECT strftime('%Y-%m-%dT%H:%M:%SZ',?1,'+900 seconds')",
                [trusted_at],
                |r| r.get(0),
            )
            .map_err(storage)?;
        let plan_id = random_id()?;
        let plan_hash = plan_hash(workspace, &plan_id, at, &expires_at, &frozen)?;
        let sequence = next_sequence(&tx, at)?;
        tx.execute(
            "INSERT INTO operation_plans(workspace_id,plan_id,operation_kind,plan_hash,title,phase,risk_level,item_count,
             created_at,expires_at,local_commit_sequence)
             VALUES(?1,?2,?3,?4,'SellerHub BIN price','awaiting_approval','standard',?5,?6,?7,?8)",
            params![workspace,plan_id,PLAN_KIND,plan_hash,sql_integer(frozen.len())?,at,expires_at,sequence],
        ).map_err(storage)?;
        for (ordinal, item) in frozen.iter().enumerate() {
            let preconditions = serde_json::to_string(item).map_err(|_| bad)?;
            tx.execute(
                "INSERT INTO operation_plan_items(workspace_id,plan_id,item_id,ordinal,entity_id,connection_id,
                 capability,field_path,old_value_json,new_value_json,precondition_json,risk_level,execution_mode,inclusion_status)
                 VALUES(?1,?2,?3,?4,?5,?6,?7,'binPrice',json_object('cents',?8),json_object('cents',?9),
                   ?10,'standard','automatic','included')",
                params![workspace,plan_id,item.item_id,sql_integer(ordinal)?,item.domain,item.connection_id,
                    crate::active_workspace::capability_qualification::SPACESHIP_MARKETPLACE_WRITE,
                    sql_integer(item.previous_price_cents)?,sql_integer(item.price_cents)?,preconditions],
            ).map_err(storage)?;
        }
        let plan = read_preview(&tx, workspace, &plan_id)?;
        let _guard = guard()?;
        tx.commit().map_err(storage)?;
        Ok(plan)
    }

    pub(crate) fn approve_sellerhub_bin_price<G>(
        &mut self,
        request: &DesktopSellerHubBinApproveRequest,
        at: &str,
        context: &ExecutionEvidenceContext,
        signer: &mut EvidenceSigner<'_>,
        guard: impl FnOnce(Option<&str>) -> Result<G>,
    ) -> Result<(DesktopSellerHubBinApproval, bool)> {
        let stale = BusinessDatabaseError::MutationStale;
        let bad = BusinessDatabaseError::InvalidInput;
        if request.schema_version != 1 || !is_uuid_v4(&request.plan_id) {
            return Err(bad);
        }
        validate_sha256_hex(&request.plan_hash).map_err(|_| bad)?;
        validate_timestamp(Some(at.to_owned())).map_err(|_| bad)?;
        let workspace = &self.workspace_id;
        if context.workspace_id != *workspace {
            return Err(stale);
        }
        let tx = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(storage)?;
        execution_evidence::require_no_barrier(&tx, workspace)?;
        let id = &request.plan_id;
        let plan = read_plan(&tx, workspace, id)?;
        if request.plan_hash != plan.hash {
            return Err(stale);
        }
        let (operation_id, deadline) = match plan.phase.as_str() {
            "executing" | "completed" => {
                let existing = tx.query_row(
                    "SELECT o.operation_id FROM operations o JOIN afternic_listing_approvals a
                       USING(workspace_id,operation_id,plan_id)
                     WHERE o.workspace_id=?1 AND o.plan_id=?2 AND a.action='set_bin_price' AND a.plan_hash=?3",
                    params![workspace,id,execution_evidence::hex_to_digest(&plan.hash)?], |r| r.get(0),
                ).map_err(storage)?;
                (existing, None)
            }
            "awaiting_approval" => {
                if plan.expires_at.as_str() <= at.max(context.occurred_at.as_str()) {
                    return Err(stale);
                }
                for item in &plan.targets {
                    let current = load_target(
                        &tx,
                        workspace,
                        &item.connection_id,
                        &item.domain,
                        item.price_cents,
                        at,
                        item.item_id.clone(),
                    )
                    .map_err(|e| {
                        if matches!(e, BusinessDatabaseError::InvalidInput) {
                            stale
                        } else {
                            e
                        }
                    })?;
                    if current != *item || already_in_execution(&tx, workspace, item)? {
                        return Err(stale);
                    }
                }
                let sequence = next_sequence(&tx, at)?;
                let operation = random_id()?;
                tx.execute("UPDATE operation_plans SET phase='approved',approved_at=?3,local_commit_sequence=?4
                    WHERE workspace_id=?1 AND plan_id=?2", params![workspace,id,at,sequence]).map_err(storage)?;
                tx.execute("INSERT INTO operations(workspace_id,operation_id,plan_id,idempotency_key,phase,requested_at,local_commit_sequence)
                    VALUES(?1,?2,?3,?3,'queued',?4,?5)", params![workspace,operation,id,at,sequence]).map_err(storage)?;
                let mut targets = Vec::with_capacity(plan.targets.len());
                for item in &plan.targets {
                    let digest = request_digest(item)?;
                    tx.execute("INSERT INTO operation_attempts(workspace_id,operation_id,plan_id,item_id,attempt_number,status,request_digest)
                        VALUES(?1,?2,?3,?4,1,'queued',?5)", params![workspace,operation,id,item.item_id,digest]).map_err(storage)?;
                    targets.push(ApprovalTarget {
                        item_id: item.item_id.clone(),
                        request_digest: digest,
                    });
                }
                marketplace_approval::record_approval(
                    ApprovalPurpose::SellerHubBinPrice,
                    &tx,
                    context,
                    id,
                    &operation,
                    &plan.hash,
                    &targets,
                    signer,
                )?;
                tx.execute("UPDATE operation_plans SET phase='executing' WHERE workspace_id=?1 AND plan_id=?2",
                    params![workspace,id]).map_err(storage)?;
                tx.execute("UPDATE operations SET phase='running',started_at=?3 WHERE workspace_id=?1 AND operation_id=?2",
                    params![workspace,operation,at]).map_err(storage)?;
                (operation, Some(plan.expires_at.as_str()))
            }
            _ => return Err(stale),
        };
        let _guard = guard(deadline)?;
        tx.commit().map_err(storage)?;
        Ok((
            DesktopSellerHubBinApproval {
                schema_version: 1,
                operation_id,
            },
            deadline.is_some(),
        ))
    }

    pub(crate) fn next_sellerhub_bin_work(
        &self,
        allow_write: bool,
        context: &ExecutionEvidenceContext,
    ) -> Result<Option<SellerHubBinWorkSeed>> {
        let db = self.store.raw_connection();
        let workspace = &self.workspace_id;
        if context.workspace_id != *workspace {
            return Err(BusinessDatabaseError::MutationStale);
        }
        execution_evidence::require_no_barrier(db, workspace)?;
        let row = db
            .query_row(
                "SELECT o.operation_id,p.plan_id,a.item_id,a.request_digest,a.status,a.retry_after
             FROM operation_attempts a JOIN operations o USING(workspace_id,operation_id,plan_id)
             JOIN operation_plans p USING(workspace_id,plan_id)
             JOIN operation_plan_items i USING(workspace_id,plan_id,item_id)
             JOIN spaceship_sellerhub_connections s ON s.workspace_id=i.workspace_id AND s.connection_id=i.connection_id
             WHERE p.workspace_id=?1 AND p.operation_kind=?2 AND o.phase='running'
              AND a.attempt_number=1 AND (a.status='running' OR (?3 AND a.status='queued'
               AND EXISTS(SELECT 1 FROM afternic_listing_approvals approval
                WHERE approval.workspace_id=a.workspace_id AND approval.operation_id=a.operation_id
                AND approval.plan_id=a.plan_id AND approval.action='set_bin_price'
                AND approval.source_device_id=?5 AND approval.active_lease_epoch=?6
                AND approval.source_installation_digest=?7 AND approval.credential_epoch=?8
                AND approval.signing_key_id=?9 AND approval.signing_key_version=?10)))
              AND (a.status='queued' OR (s.state='active' AND s.purged_at IS NULL
              AND s.incarnation_id=json_extract(i.precondition_json,'$.connectionIncarnationId')
              AND EXISTS(SELECT 1 FROM domain_assets d JOIN domain_asset_provider_bindings b USING(workspace_id,entity_id)
                WHERE d.workspace_id=i.workspace_id AND d.entity_id=i.entity_id AND d.deleted_at IS NULL
                 AND d.lifecycle_status='active' AND d.entity_generation=json_extract(i.precondition_json,'$.assetGeneration')
                 AND b.resource_kind='listing' AND b.connection_id=i.connection_id AND b.validation_status!='detached'
                 AND b.resource_binding_digest=json_extract(i.precondition_json,'$.bindingDigest')
                 AND b.binding_generation=json_extract(i.precondition_json,'$.bindingGeneration')
                 AND NOT EXISTS(SELECT 1 FROM sync_domain_asset_provisional_re_adds r
                   WHERE r.workspace_id=d.workspace_id AND r.entity_id=d.entity_id))))
              AND (a.retry_after IS NULL OR a.retry_after<=?4)
             ORDER BY a.status='queued',o.requested_at,o.operation_id,i.ordinal LIMIT 1",
                params![workspace, PLAN_KIND, allow_write, context.occurred_at,
                  context.source_device_id,sql_integer(context.active_lease_epoch)?,context.source_installation_digest,
                  sql_integer(context.credential_epoch)?,context.signing_key_id,sql_integer(context.signing_key_version)?],
                |r| Ok(WorkRow {
                    operation:r.get(0)?, plan:r.get(1)?, item:r.get(2)?, digest:r.get(3)?,
                    status:r.get(4)?, retry_after:r.get(5)?,
                }),
            )
            .optional()
            .map_err(storage)?;
        row.map(|row| work(db, workspace, row)).transpose()
    }

    pub(crate) fn recheck_sellerhub_bin_read(&self, work: &SellerHubBinWorkSeed) -> Result<()> {
        let db = self.store.raw_connection();
        let workspace = &self.workspace_id;
        execution_evidence::require_no_barrier(db, workspace)?;
        if !work.may_read_provider || provider_block_reason(db, workspace, &work.target)?.is_some()
        {
            return Err(BusinessDatabaseError::MutationStale);
        }
        results::current_attempt_start(db, workspace, work).map(|_| ())
    }

    pub(crate) fn claim_sellerhub_bin_write<G>(
        &mut self,
        work: &SellerHubBinWorkSeed,
        observed: &DesktopSellerHubListingFact,
        at: &str,
        context: &ExecutionEvidenceContext,
        signer: &mut EvidenceSigner<'_>,
        guard: impl FnOnce() -> Result<G>,
    ) -> Result<()> {
        let stale = BusinessDatabaseError::MutationStale;
        let target = &work.target;
        if context.workspace_id != self.workspace_id
            || work.needs_reconciliation
            || !work.matches_prior_price(observed)
        {
            return Err(stale);
        }
        validate_timestamp(Some(at.to_owned())).map_err(|_| BusinessDatabaseError::InvalidInput)?;
        let workspace = &self.workspace_id;
        let tx = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(storage)?;
        execution_evidence::require_no_barrier(&tx, workspace)?;
        let current = load_target(
            &tx,
            workspace,
            &target.connection_id,
            &target.domain,
            target.price_cents,
            at,
            target.item_id.clone(),
        )
        .map_err(|e| {
            if matches!(e, BusinessDatabaseError::InvalidInput) {
                stale
            } else {
                e
            }
        })?;
        if current != *target {
            return Err(stale);
        }
        let pending: bool = tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM operation_attempts a
             JOIN operations o USING(workspace_id,operation_id,plan_id)
             JOIN operation_plans p USING(workspace_id,plan_id)
             WHERE a.workspace_id=?1 AND a.operation_id=?2 AND a.plan_id=?3 AND a.item_id=?4
              AND a.request_digest=?5 AND a.attempt_number=1 AND a.status='queued'
              AND a.retry_after IS ?7 AND p.operation_kind=?6 AND p.phase='executing' AND o.phase='running')",
                params![
                    workspace,
                    work.operation_id,
                    work.plan_id,
                    target.item_id,
                    work.request_digest,
                    PLAN_KIND,
                    work.retry_after
                ],
                |r| r.get(0),
            )
            .map_err(storage)?;
        if !pending || request_digest(target)? != work.request_digest {
            return Err(stale);
        }
        marketplace_approval::record_claim(
            ApprovalPurpose::SellerHubBinPrice,
            &tx,
            context,
            &work.operation_id,
            &work.plan_id,
            &target.item_id,
            &work.request_digest,
            signer,
        )?;
        let changed = tx
            .execute(
                "UPDATE operation_attempts SET status='running',started_at=?6,retry_after=NULL
             WHERE workspace_id=?1 AND operation_id=?2 AND plan_id=?3 AND item_id=?4
             AND request_digest=?5 AND attempt_number=1 AND status='queued'",
                params![
                    workspace,
                    work.operation_id,
                    work.plan_id,
                    target.item_id,
                    work.request_digest,
                    at
                ],
            )
            .map_err(storage)?;
        if changed != 1 {
            return Err(stale);
        }
        next_sequence(&tx, at)?;
        let _guard = guard()?;
        tx.commit().map_err(storage)
    }

    pub(crate) fn recheck_sellerhub_bin_dispatch(
        &self,
        work: &SellerHubBinWorkSeed,
        at: &str,
        context: &ExecutionEvidenceContext,
    ) -> Result<()> {
        let stale = BusinessDatabaseError::MutationStale;
        if context.workspace_id != self.workspace_id || work.needs_reconciliation {
            return Err(stale);
        }
        let db = self.store.raw_connection();
        let workspace = &self.workspace_id;
        execution_evidence::require_no_barrier(db, workspace)?;
        let target = &work.target;
        let current = load_target(
            db,
            workspace,
            &target.connection_id,
            &target.domain,
            target.price_cents,
            at,
            target.item_id.clone(),
        )
        .map_err(|e| {
            if matches!(e, BusinessDatabaseError::InvalidInput) {
                stale
            } else {
                e
            }
        })?;
        if current != *target || request_digest(target)? != work.request_digest {
            return Err(stale);
        }
        let still_claimed: bool = db.query_row(
            "SELECT EXISTS(SELECT 1 FROM operation_attempts a
             JOIN operations o USING(workspace_id,operation_id,plan_id)
             JOIN device_execution_fact_outbox f USING(workspace_id,operation_id,item_id,attempt_number)
             WHERE a.workspace_id=?1 AND a.operation_id=?2 AND a.plan_id=?3 AND a.item_id=?4
              AND a.request_digest=?5 AND a.attempt_number=1 AND a.status='running' AND o.phase='running'
              AND f.source_device_id=?6 AND f.active_lease_epoch=?7 AND f.source_installation_digest=?8
              AND json_extract(f.envelope_json,'$.eventType')='sellerhub_bin_price_dispatch_claimed'
              AND json_extract(f.envelope_json,'$.credentialEpoch')=?9 AND json_extract(f.envelope_json,'$.signingKeyId')=?10
              AND json_extract(f.envelope_json,'$.signingKeyVersion')=?11
              AND json_extract(f.envelope_json,'$.authorizationHash')=?12)",
            params![workspace,work.operation_id,work.plan_id,target.item_id,work.request_digest,
                context.source_device_id,sql_integer(context.active_lease_epoch)?,context.source_installation_digest,
                sql_integer(context.credential_epoch)?,context.signing_key_id,sql_integer(context.signing_key_version)?,
                context.authorization_hash],
            |r| r.get(0),
        ).map_err(storage)?;
        still_claimed.then_some(()).ok_or(stale)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::active_workspace::business::{
        EvidenceSignaturePurpose, LocalDatabaseKey, SellerHubInventoryCommit,
    };

    const AT: &str = "2026-11-20T10:00:00Z";
    const TRUSTED_AT: &str = "2026-11-20T09:59:30Z";
    const EXECUTION: (&str, u64) = ("device-local", 1);

    fn import(
        db: &mut BusinessDatabase,
        connection: &str,
        listings: &[DesktopSellerHubListingFact],
    ) {
        let seed = db.sellerhub_connection(connection).unwrap();
        db.import_sellerhub_inventory(
            &SellerHubInventoryCommit {
                seed: &seed,
                listings,
                device_id: EXECUTION.0,
                lease_epoch: EXECUTION.1,
                at: AT,
            },
            || Ok(()),
        )
        .unwrap();
    }
    fn listing(domain: &str, price: &str) -> DesktopSellerHubListingFact {
        DesktopSellerHubListingFact {
            domain: domain.to_owned(),
            state: DesktopSellerHubListingState::OnSale,
            enabled_bin_price_usd: Some(price.to_owned()),
        }
    }
    fn item(domain: &str, price_cents: u64) -> DesktopSellerHubBinTarget {
        DesktopSellerHubBinTarget {
            domain: domain.to_owned(),
            price_cents,
        }
    }

    #[test]
    fn preview_freezes_the_visible_price_and_current_binding_in_one_transaction() {
        let dir = crate::test_tempdir::tempdir().unwrap();
        let path = dir.path().join("workspace.db");
        let key = LocalDatabaseKey::from_bytes([0x46; 32]);
        let open = || BusinessDatabase::open(&path, &key, "workspace-local").unwrap();
        let mut db = open();
        let seed = db
            .prepare_sellerhub_connection("SellerHub", AT, EXECUTION, || Ok(()))
            .unwrap();
        import(
            &mut db,
            &seed.connection_id,
            &[listing("a.test", "120.0"), listing("b.test", "99.42")],
        );
        let request = DesktopSellerHubBinPreviewRequest {
            schema_version: 1,
            connection_id: seed.connection_id,
            items: vec![item("b.test", 10_000), item("a.test", 12_001)],
        };
        assert!(matches!(
            db.preview_sellerhub_bin_price(&request, AT, TRUSTED_AT, || {
                Err::<(), _>(BusinessDatabaseError::MutationStale)
            }),
            Err(BusinessDatabaseError::MutationStale)
        ));
        let counts = |db: &BusinessDatabase| {
            db.store.raw_connection().query_row(
            "SELECT (SELECT count(*) FROM operation_plans),(SELECT count(*) FROM operation_plan_items),
             (SELECT count(*) FROM operation_attempts)", [],
            |r| Ok((r.get::<_,i64>(0)?,r.get::<_,i64>(1)?,r.get::<_,i64>(2)?)),
        ).unwrap()
        };
        assert_eq!(counts(&db), (0, 0, 0));
        let plan = db
            .preview_sellerhub_bin_price(&request, AT, TRUSTED_AT, || Ok(()))
            .unwrap();
        assert_eq!(plan.expires_at, "2026-11-20T10:14:30Z");
        assert_eq!(plan.items[0].domain, "a.test");
        assert_eq!(plan.items[0].previous_price_cents, 12_000);
        assert_eq!(plan.items[0].price_cents, 12_001);
        drop(db);
        let mut db = open();
        assert_eq!(counts(&db), (1, 2, 0));
        let phase: String = db
            .store
            .raw_connection()
            .query_row(
                "SELECT phase FROM operation_plans WHERE plan_id=?1 AND plan_hash=?2",
                params![plan.plan_id, plan.plan_hash],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(phase, "awaiting_approval");
        let reopened =
            read_preview(db.store.raw_connection(), "workspace-local", &plan.plan_id).unwrap();
        assert_eq!(reopened.plan_hash, plan.plan_hash);
        for changed in [
            r#"{"cents":25}"#,
            r#"{"cents":12001,"enabled":false}"#,
            r#"{"cents":12001,"cents":12001}"#,
        ] {
            db.store.fixture_connection().execute(
                "UPDATE operation_plan_items SET new_value_json=?2 WHERE plan_id=?1 AND ordinal=0",
                params![plan.plan_id,changed],
            ).unwrap();
            assert!(matches!(
                read_preview(db.store.raw_connection(), "workspace-local", &plan.plan_id),
                Err(BusinessDatabaseError::StorageRejected)
            ));
        }
        db.store.fixture_connection().execute_batch(
            "UPDATE operation_plan_items SET new_value_json='{\"cents\":12001}' WHERE ordinal=0;
             INSERT INTO operation_plan_items(workspace_id,plan_id,item_id,ordinal,entity_id,connection_id,
               capability,field_path,old_value_json,new_value_json,precondition_json,risk_level,execution_mode,inclusion_status)
             SELECT workspace_id,plan_id,'extra-target',2,entity_id,connection_id,'spaceship:registrar:observe',
               field_path,old_value_json,new_value_json,precondition_json,risk_level,execution_mode,inclusion_status
             FROM operation_plan_items WHERE ordinal=0;",
        ).unwrap();
        assert!(matches!(
            read_preview(db.store.raw_connection(), "workspace-local", &plan.plan_id),
            Err(BusinessDatabaseError::StorageRejected)
        ));
    }

    #[test]
    fn preview_refuses_other_accounts_missing_listings_and_unchanged_or_invalid_amounts() {
        let dir = crate::test_tempdir::tempdir().unwrap();
        let key = LocalDatabaseKey::from_bytes([0x47; 32]);
        let mut db =
            BusinessDatabase::open(&dir.path().join("workspace.db"), &key, "workspace-local")
                .unwrap();
        let seller = db
            .prepare_sellerhub_connection("SellerHub", AT, EXECUTION, || Ok(()))
            .unwrap();
        let other = db
            .prepare_sellerhub_connection("Other SellerHub", AT, EXECUTION, || Ok(()))
            .unwrap();
        import(&mut db, &seller.connection_id, &[listing("a.test", "120")]);
        import(&mut db, &other.connection_id, &[]);
        let mut request = DesktopSellerHubBinPreviewRequest {
            schema_version: 1,
            connection_id: other.connection_id,
            items: vec![item("a.test", 12_100)],
        };
        assert!(matches!(
            db.preview_sellerhub_bin_price(&request, AT, TRUSTED_AT, || Ok(())),
            Err(BusinessDatabaseError::MutationStale)
        ));
        request.connection_id = seller.connection_id;
        for items in [
            vec![item("a.test", 12_000)],
            vec![item("a.test", MAX_CENTS + 1)],
            vec![item("a.test", 12_100), item("a.test", 12_200)],
        ] {
            request.items = items;
            assert!(matches!(
                db.preview_sellerhub_bin_price(&request, AT, TRUSTED_AT, || Ok(())),
                Err(BusinessDatabaseError::InvalidInput)
            ));
        }
        request.items = vec![item("a.test", 12_100)];
        db.queue_sellerhub_scan(&request.connection_id, EXECUTION, || Ok(()))
            .unwrap();
        import(&mut db, &request.connection_id, &[]);
        assert!(matches!(
            db.preview_sellerhub_bin_price(&request, AT, TRUSTED_AT, || Ok(())),
            Err(BusinessDatabaseError::MutationStale)
        ));
    }

    fn approval_request(preview: DesktopSellerHubBinPlan) -> DesktopSellerHubBinApproveRequest {
        DesktopSellerHubBinApproveRequest {
            schema_version: 1,
            plan_id: preview.plan_id,
            plan_hash: preview.plan_hash,
        }
    }

    fn evidence_counts(db: &BusinessDatabase) -> [i64; 6] {
        db.store.raw_connection().query_row(
                "SELECT (SELECT count(*) FROM operations), (SELECT count(*) FROM operation_attempts),
                 (SELECT count(*) FROM workspace_device_audit_outbox), (SELECT count(*) FROM afternic_listing_approvals),
                 (SELECT count(*) FROM afternic_listing_item_authorizations), (SELECT count(*) FROM device_execution_fact_outbox)",
                [], |r| Ok([r.get::<_, i64>(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?]),
            ).unwrap()
    }

    fn queued_authorizations(db: &BusinessDatabase, operation: &str) -> i64 {
        db.store.raw_connection().query_row(
            "SELECT count(*) FROM operation_attempts t JOIN afternic_listing_item_authorizations a
               USING(workspace_id,operation_id,plan_id,item_id,attempt_number)
             WHERE t.operation_id=?1 AND t.status='queued' AND t.attempt_number=1
              AND a.request_digest=json_extract(a.envelope_json,'$.requestDigest')
              AND json_extract(a.envelope_json,'$.capability')='spaceship:marketplace:write'",
            [operation], |r| r.get(0),
        ).unwrap()
    }

    #[test]
    fn approval_commits_exact_signed_attempts_atomically_and_replays_after_reopen() {
        let dir = crate::test_tempdir::tempdir().unwrap();
        let key = LocalDatabaseKey::from_bytes([0x48; 32]);
        let open = || {
            BusinessDatabase::open(&dir.path().join("workspace.db"), &key, "workspace-local")
                .unwrap()
        };
        let mut db = open();
        let seller = db
            .prepare_sellerhub_connection("SellerHub", AT, EXECUTION, || Ok(()))
            .unwrap();
        import(
            &mut db,
            &seller.connection_id,
            &[listing("a.test", "120"), listing("b.test", "90")],
        );
        let preview = |db: &mut BusinessDatabase| {
            approval_request(
                db.preview_sellerhub_bin_price(
                    &DesktopSellerHubBinPreviewRequest {
                        schema_version: 1,
                        connection_id: seller.connection_id.clone(),
                        items: vec![item("a.test", 12_100), item("b.test", 10_000)],
                    },
                    AT,
                    TRUSTED_AT,
                    || Ok(()),
                )
                .unwrap(),
            )
        };
        let plan = preview(&mut db);
        let competitor = preview(&mut db);
        let (context, mut signer) = execution_evidence::test_context("workspace-local", AT);
        let (foreign, _) = execution_evidence::test_context("foreign-workspace", AT);
        let (expired, _) =
            execution_evidence::test_context("workspace-local", "2026-11-20T10:14:30Z");
        let changed = DesktopSellerHubBinApproveRequest {
            schema_version: 1,
            plan_id: plan.plan_id.clone(),
            plan_hash: "a".repeat(64),
        };
        for (request, evidence) in [(&changed, &context), (&plan, &foreign), (&plan, &expired)] {
            assert!(matches!(
                db.approve_sellerhub_bin_price(request, AT, evidence, &mut signer, |_| Ok(())),
                Err(BusinessDatabaseError::MutationStale)
            ));
        }
        let mut rejected_purpose = |purpose, bytes: &[u8]| {
            assert!(!bytes.is_empty());
            match purpose {
                EvidenceSignaturePurpose::DeviceAudit => signer(purpose, bytes),
                EvidenceSignaturePurpose::SellerHubBinPriceApproval => Ok([0; 64]),
                _ => panic!("unexpected evidence purpose"),
            }
        };
        assert!(matches!(
            db.approve_sellerhub_bin_price(&plan, AT, &context, &mut rejected_purpose, |_| Ok(())),
            Err(BusinessDatabaseError::MutationStale)
        ));
        assert!(matches!(
            db.approve_sellerhub_bin_price(&plan, AT, &context, &mut signer, |deadline| {
                assert_eq!(deadline, Some("2026-11-20T10:14:30Z"));
                Err::<(), _>(BusinessDatabaseError::MutationStale)
            }),
            Err(BusinessDatabaseError::MutationStale)
        ));
        assert_eq!(evidence_counts(&db), [0; 6]);
        assert_eq!(
            read_plan(db.store.raw_connection(), "workspace-local", &plan.plan_id)
                .unwrap()
                .phase,
            "awaiting_approval"
        );

        let (receipt, inserted) = db
            .approve_sellerhub_bin_price(&plan, AT, &context, &mut signer, |_| Ok(()))
            .unwrap();
        assert!(inserted);
        assert_eq!(evidence_counts(&db), [1, 2, 1, 1, 2, 0]);
        assert_eq!(queued_authorizations(&db, &receipt.operation_id), 2);
        drop(db);
        let mut db = open();
        assert!(matches!(
            db.approve_sellerhub_bin_price(&competitor, AT, &context, &mut signer, |_| Ok(())),
            Err(BusinessDatabaseError::MutationStale)
        ));
        let (replayed, inserted) = db
            .approve_sellerhub_bin_price(
                &plan,
                AT,
                &expired,
                &mut |_, _| panic!("replay cannot sign new evidence"),
                |deadline| {
                    assert_eq!(deadline, None);
                    Ok(())
                },
            )
            .unwrap();
        assert!(!inserted);
        assert_eq!(replayed.operation_id, receipt.operation_id);
        assert_eq!(evidence_counts(&db), [1, 2, 1, 1, 2, 0]);
    }

    #[test]
    fn approval_refuses_a_new_scan_or_revoked_connection_after_preview() {
        let dir = crate::test_tempdir::tempdir().unwrap();
        let key = LocalDatabaseKey::from_bytes([0x49; 32]);
        let mut db =
            BusinessDatabase::open(&dir.path().join("workspace.db"), &key, "workspace-local")
                .unwrap();
        let seller = db
            .prepare_sellerhub_connection("SellerHub", AT, EXECUTION, || Ok(()))
            .unwrap();
        let fact = listing("a.test", "120");
        import(&mut db, &seller.connection_id, std::slice::from_ref(&fact));
        let request = DesktopSellerHubBinPreviewRequest {
            schema_version: 1,
            connection_id: seller.connection_id.clone(),
            items: vec![item("a.test", 12_100)],
        };
        let preview = |db: &mut BusinessDatabase| {
            approval_request(
                db.preview_sellerhub_bin_price(&request, AT, TRUSTED_AT, || Ok(()))
                    .unwrap(),
            )
        };
        let prior = preview(&mut db);
        db.queue_sellerhub_scan(&seller.connection_id, EXECUTION, || Ok(()))
            .unwrap();
        import(&mut db, &seller.connection_id, &[fact]);
        let (context, mut signer) = execution_evidence::test_context("workspace-local", AT);
        assert!(matches!(
            db.approve_sellerhub_bin_price(&prior, AT, &context, &mut signer, |_| Ok(())),
            Err(BusinessDatabaseError::MutationStale)
        ));
        let latest = preview(&mut db);
        let current = db.sellerhub_connection(&seller.connection_id).unwrap();
        db.revoke_sellerhub_connection(&current, AT, || Ok(()))
            .unwrap();
        assert!(matches!(
            db.approve_sellerhub_bin_price(&latest, AT, &context, &mut signer, |_| Ok(())),
            Err(BusinessDatabaseError::MutationStale)
        ));
    }

    #[test]
    #[expect(
        clippy::too_many_lines,
        reason = "one scenario spans claim, guard rollback, restart and replay"
    )]
    fn only_a_fenced_single_claim_changes_retry_after_reopen_to_read_only() {
        let dir = crate::test_tempdir::tempdir().unwrap();
        let key = LocalDatabaseKey::from_bytes([0x50; 32]);
        let open = || {
            BusinessDatabase::open(&dir.path().join("workspace.db"), &key, "workspace-local")
                .unwrap()
        };
        let mut db = open();
        let seller = db
            .prepare_sellerhub_connection("SellerHub", AT, EXECUTION, || Ok(()))
            .unwrap();
        let observed = listing("a.test", "120.00");
        import(
            &mut db,
            &seller.connection_id,
            std::slice::from_ref(&observed),
        );
        let plan = approval_request(
            db.preview_sellerhub_bin_price(
                &DesktopSellerHubBinPreviewRequest {
                    schema_version: 1,
                    connection_id: seller.connection_id,
                    items: vec![item("a.test", 12_100)],
                },
                AT,
                TRUSTED_AT,
                || Ok(()),
            )
            .unwrap(),
        );
        let (context, mut signer) = execution_evidence::test_context("workspace-local", AT);
        let (receipt, _) = db
            .approve_sellerhub_bin_price(&plan, AT, &context, &mut signer, |_| Ok(()))
            .unwrap();
        assert!(
            db.next_sellerhub_bin_work(false, &context)
                .unwrap()
                .is_none()
        );
        let pending = db.next_sellerhub_bin_work(true, &context).unwrap().unwrap();
        assert!(!pending.needs_reconciliation);
        assert!(
            !db.sellerhub_connection(pending.connection_id())
                .unwrap()
                .has_scan_for(EXECUTION.0, EXECUTION.1)
        );
        db.recheck_sellerhub_bin_read(&pending).unwrap();
        assert!(db.store.fixture_connection().execute(
            "UPDATE operation_attempts SET status='running',started_at=?1 WHERE operation_id=?2",
            params![AT,receipt.operation_id],
        ).is_err());
        for mismatched in [listing("other.test", "120"), listing("a.test", "121")] {
            assert!(matches!(
                db.claim_sellerhub_bin_write(
                    &pending,
                    &mismatched,
                    AT,
                    &context,
                    &mut signer,
                    || Ok(())
                ),
                Err(BusinessDatabaseError::MutationStale)
            ));
        }
        let (mut replaced_authority, _) = execution_evidence::test_context("workspace-local", AT);
        replaced_authority.credential_epoch += 1;
        assert!(matches!(
            db.claim_sellerhub_bin_write(
                &pending,
                &observed,
                AT,
                &replaced_authority,
                &mut signer,
                || Ok(())
            ),
            Err(BusinessDatabaseError::MutationStale)
        ));
        assert!(matches!(
            db.claim_sellerhub_bin_write(&pending, &observed, AT, &context, &mut signer, || {
                Err::<(), _>(BusinessDatabaseError::MutationStale)
            }),
            Err(BusinessDatabaseError::MutationStale)
        ));
        assert_eq!(evidence_counts(&db), [1, 1, 1, 1, 1, 0]);

        db.claim_sellerhub_bin_write(&pending, &observed, AT, &context, &mut signer, || Ok(()))
            .unwrap();
        assert!(matches!(
            db.claim_sellerhub_bin_write(&pending, &observed, AT, &context, &mut signer, || Ok(())),
            Err(BusinessDatabaseError::MutationStale)
        ));
        db.recheck_sellerhub_bin_dispatch(&pending, AT, &context)
            .unwrap();
        assert!(matches!(
            db.recheck_sellerhub_bin_dispatch(&pending, AT, &replaced_authority),
            Err(BusinessDatabaseError::MutationStale)
        ));
        assert_eq!(evidence_counts(&db), [1, 1, 2, 1, 1, 1]);
        drop(db);

        let mut db = open();
        for allow_write in [false, true] {
            let recovered = db
                .next_sellerhub_bin_work(allow_write, &context)
                .unwrap()
                .unwrap();
            assert!(matches!(
                db.recheck_sellerhub_bin_dispatch(&recovered, AT, &context),
                Err(BusinessDatabaseError::MutationStale)
            ));
            assert!(recovered.needs_reconciliation);
            assert_eq!(recovered.operation_id, receipt.operation_id);
            assert!(matches!(
                db.claim_sellerhub_bin_write(
                    &recovered,
                    &observed,
                    AT,
                    &context,
                    &mut signer,
                    || Ok(())
                ),
                Err(BusinessDatabaseError::MutationStale)
            ));
        }
        assert_eq!(evidence_counts(&db), [1, 1, 2, 1, 1, 1]);
        db.begin_device_handoff_barrier("test-switch", 1, AT, || Ok(()))
            .unwrap();
        assert_eq!(
            db.device_handoff_frozen_unresolved_count("device-test", 1)
                .unwrap(),
            1
        );
        assert!(matches!(
            db.next_sellerhub_bin_work(true, &context),
            Err(BusinessDatabaseError::MutationStale)
        ));
    }

    fn assert_reconciliation_rejects_altered_original_wire(
        db: &mut BusinessDatabase,
        work: &SellerHubBinWorkSeed,
        after: &DesktopSellerHubListingFact,
        at: &str,
        context: &ExecutionEvidenceContext,
        signer: &mut EvidenceSigner<'_>,
    ) {
        let conn = db.store.fixture_connection();
        let original: String = conn
            .query_row(
                "SELECT envelope_json FROM device_execution_fact_outbox WHERE operation_id=?1",
                [&work.operation_id],
                |row| row.get(0),
            )
            .unwrap();
        let altered: String = conn.query_row(
            "SELECT json_set(?1,'$.authorizationHash',json_extract(?1,'$.trustedTimeAnchorId'))",
            [&original], |row| row.get(0),
        ).unwrap();
        assert_ne!(altered, original);
        conn.execute_batch("DROP TRIGGER device_execution_fact_outbox_no_update")
            .unwrap();
        conn.execute(
            "UPDATE device_execution_fact_outbox SET envelope_json=?1",
            [&altered],
        )
        .unwrap();
        assert!(matches!(
            db.settle_sellerhub_bin_observation(
                work,
                Some(after),
                None,
                at,
                context,
                signer,
                || Ok(())
            ),
            Err(BusinessDatabaseError::MutationStale)
        ));
        let conn = db.store.fixture_connection();
        conn.execute(
            "UPDATE device_execution_fact_outbox SET envelope_json=?1",
            [&original],
        )
        .unwrap();
        conn.execute_batch("CREATE TRIGGER device_execution_fact_outbox_no_update
          BEFORE UPDATE ON device_execution_fact_outbox BEGIN SELECT RAISE(ABORT,'execution source evidence is immutable'); END;").unwrap();
    }

    #[test]
    #[expect(
        clippy::too_many_lines,
        reason = "one persisted journey verifies mismatched read, replay rejection and exact settlement"
    )]
    fn unknown_price_readback_resumes_without_resend_and_finishes_only_on_matching_get() {
        let dir = crate::test_tempdir::tempdir().unwrap();
        let key = LocalDatabaseKey::from_bytes([0x51; 32]);
        let open = || {
            BusinessDatabase::open(&dir.path().join("workspace.db"), &key, "workspace-local")
                .unwrap()
        };
        let mut db = open();
        let seller = db
            .prepare_sellerhub_connection("SellerHub", AT, EXECUTION, || Ok(()))
            .unwrap();
        let before = listing("a.test", "120");
        let after = listing("a.test", "121");
        import(
            &mut db,
            &seller.connection_id,
            std::slice::from_ref(&before),
        );
        let plan = approval_request(
            db.preview_sellerhub_bin_price(
                &DesktopSellerHubBinPreviewRequest {
                    schema_version: 1,
                    connection_id: seller.connection_id.clone(),
                    items: vec![item("a.test", 12_100)],
                },
                AT,
                TRUSTED_AT,
                || Ok(()),
            )
            .unwrap(),
        );
        let (context, mut signer) = execution_evidence::test_context("workspace-local", AT);
        db.approve_sellerhub_bin_price(&plan, AT, &context, &mut signer, |_| Ok(()))
            .unwrap();
        let queued = db.next_sellerhub_bin_work(true, &context).unwrap().unwrap();
        db.claim_sellerhub_bin_write(&queued, &before, AT, &context, &mut signer, || Ok(()))
            .unwrap();
        let unknown = db
            .next_sellerhub_bin_work(false, &context)
            .unwrap()
            .unwrap();
        assert!(unknown.needs_reconciliation);
        db.settle_sellerhub_bin_observation(
            &unknown,
            Some(&before),
            Some(60),
            AT,
            &context,
            &mut signer,
            || Ok(()),
        )
        .unwrap();
        assert!(matches!(
            db.settle_sellerhub_bin_observation(
                &unknown,
                Some(&after),
                None,
                AT,
                &context,
                &mut signer,
                || Ok(())
            ),
            Err(BusinessDatabaseError::MutationStale)
        ));
        assert_eq!(evidence_counts(&db), [1, 1, 3, 1, 1, 1]);
        drop(db);

        let mut db = open();
        let (before_due, _) =
            execution_evidence::test_context("workspace-local", "2026-11-20T10:00:59Z");
        assert!(
            db.next_sellerhub_bin_work(true, &before_due)
                .unwrap()
                .is_none()
        );
        let later = "2026-11-20T10:01:00Z";
        let (current, mut signer) = execution_evidence::test_context("workspace-local", later);
        let replay = db
            .next_sellerhub_bin_work(false, &current)
            .unwrap()
            .unwrap();
        assert!(replay.needs_reconciliation);
        assert_reconciliation_rejects_altered_original_wire(
            &mut db,
            &replay,
            &after,
            later,
            &current,
            &mut signer,
        );
        assert!(matches!(
            db.settle_sellerhub_bin_observation(
                &replay,
                Some(&after),
                None,
                later,
                &current,
                &mut signer,
                || { Err::<(), _>(BusinessDatabaseError::MutationStale) }
            ),
            Err(BusinessDatabaseError::MutationStale)
        ));
        assert_eq!(evidence_counts(&db), [1, 1, 3, 1, 1, 1]);
        db.settle_sellerhub_bin_observation(
            &replay,
            Some(&after),
            None,
            later,
            &current,
            &mut signer,
            || Ok(()),
        )
        .unwrap();
        assert!(
            db.next_sellerhub_bin_work(true, &current)
                .unwrap()
                .is_none()
        );
        assert_eq!(evidence_counts(&db), [1, 1, 4, 1, 1, 1]);
        let final_result: String = db.store.raw_connection().query_row(
            "SELECT r.outcome FROM operation_results r JOIN operations o USING(workspace_id,operation_id,plan_id)
             WHERE o.phase='completed' AND r.operation_id=?1", [&replay.operation_id], |row| row.get(0),
        ).unwrap();
        assert_eq!(final_result, "succeeded");
        let (recent, detail) = db
            .read_sellerhub_bin_status(
                &DesktopSellerHubBinStatusRequest {
                    schema_version: 1,
                    plan_id: None,
                },
                later,
            )
            .unwrap();
        assert_eq!(recent[0].state, "completed");
        let detail = detail.unwrap();
        assert_eq!(detail.plan_id, plan.plan_id);
        assert_eq!(detail.items[0].state, "changed");
        assert_eq!(detail.items[0].price_cents, 12_100);
        assert!(
            db.sellerhub_connection(&seller.connection_id)
                .unwrap()
                .has_scan_for(&current.source_device_id, current.active_lease_epoch)
        );
    }

    #[test]
    fn approval_revoked_before_send_resolves_to_refused_without_reading_credentials() {
        let dir = crate::test_tempdir::tempdir().unwrap();
        let mut db = BusinessDatabase::open(
            &dir.path().join("workspace.db"),
            &LocalDatabaseKey::from_bytes([0x52; 32]),
            "workspace-local",
        )
        .unwrap();
        let seller = db
            .prepare_sellerhub_connection("SellerHub", AT, EXECUTION, || Ok(()))
            .unwrap();
        import(&mut db, &seller.connection_id, &[listing("a.test", "120")]);
        let plan = approval_request(
            db.preview_sellerhub_bin_price(
                &DesktopSellerHubBinPreviewRequest {
                    schema_version: 1,
                    connection_id: seller.connection_id.clone(),
                    items: vec![item("a.test", 12_100)],
                },
                AT,
                TRUSTED_AT,
                || Ok(()),
            )
            .unwrap(),
        );
        let (context, mut signer) = execution_evidence::test_context("workspace-local", AT);
        db.approve_sellerhub_bin_price(&plan, AT, &context, &mut signer, |_| Ok(()))
            .unwrap();
        let current = db.sellerhub_connection(&seller.connection_id).unwrap();
        db.revoke_sellerhub_connection(&current, AT, || Ok(()))
            .unwrap();
        let blocked = db.next_sellerhub_bin_work(true, &context).unwrap().unwrap();
        assert!(!blocked.may_read_provider);
        assert!(db.recheck_sellerhub_bin_read(&blocked).is_err());
        db.settle_sellerhub_bin_observation(
            &blocked,
            None,
            None,
            AT,
            &context,
            &mut signer,
            || Ok(()),
        )
        .unwrap();
        assert!(
            db.next_sellerhub_bin_work(true, &context)
                .unwrap()
                .is_none()
        );
        assert_eq!(evidence_counts(&db), [1, 1, 2, 1, 1, 0]);
        let (recent, detail) = db
            .read_sellerhub_bin_status(
                &DesktopSellerHubBinStatusRequest {
                    schema_version: 1,
                    plan_id: None,
                },
                AT,
            )
            .unwrap();
        assert_eq!(recent[0].state, "partially_failed");
        let detail = detail.unwrap();
        assert_eq!(detail.items[0].state, "refused");
        assert_eq!(
            detail.items[0].reason.as_deref(),
            Some("connection_changed")
        );
        assert_eq!(db.execution_evidence_pending_count().unwrap(), Some(2));
    }
}
