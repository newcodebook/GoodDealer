//! Persistent fixed-price listing scope for the current `SellerHub` account.
use super::execution_evidence::{
    ApprovalTarget, EvidenceSigner, ExecutionEvidenceContext,
    marketplace_approval::{self, ApprovalPurpose},
};
use super::{
    BusinessDatabase, BusinessDatabaseError, afternic::random_id, execution_evidence, hex_digest,
    is_uuid_v4, validate_domain_asset_id, validate_timestamp,
};
use crate::active_workspace::capability_qualification::SPACESHIP_MARKETPLACE_WRITE;
use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[path = "spaceship_sellerhub_create_results.rs"]
mod results;
pub use results::SellerHubCreateReadback;

pub(super) const KIND: &str = "sellerhub_create_listing";
const MAX_PRICE_CENTS: u64 = 9_007_199_254_740_991;
const MAX_ITEMS: usize = 500;
type Result<T> = std::result::Result<T, BusinessDatabaseError>;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DesktopSellerHubCreatePreviewRequest {
    schema_version: u8,
    connection_id: String,
    items: Vec<CreateItem>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CreateItem {
    domain: String,
    price_cents: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopSellerHubCreatePreview {
    schema_version: u8,
    plan_id: String,
    connection_id: String,
    plan_hash: String,
    expires_at: String,
    items: Vec<CreateTerms>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DesktopSellerHubCreateApproveRequest {
    schema_version: u8,
    plan_id: String,
    plan_hash: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopSellerHubCreateApproval {
    schema_version: u8,
    operation_id: String,
}

struct StoredCreationPlan {
    plan_hash: String,
    connection_id: String,
    expires_at: String,
    phase: String,
    frozen: Vec<FrozenItem>,
}

impl StoredCreationPlan {
    fn into_preview(self, plan_id: &str) -> DesktopSellerHubCreatePreview {
        DesktopSellerHubCreatePreview {
            schema_version: 1,
            plan_id: plan_id.to_owned(),
            connection_id: self.connection_id,
            plan_hash: self.plan_hash,
            expires_at: self.expires_at,
            items: self.frozen.into_iter().map(|item| item.terms).collect(),
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DesktopSellerHubCreateStatusRequest {
    schema_version: u8,
    plan_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopSellerHubCreatePlanSummary {
    plan_id: String,
    phase: String,
    count: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopSellerHubCreateItemStatus {
    domain: String,
    state: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopSellerHubCreateDetail {
    preview: DesktopSellerHubCreatePreview,
    phase: String,
    items: Vec<DesktopSellerHubCreateItemStatus>,
}

#[derive(Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CreateTerms {
    domain: String,
    price_cents: u64,
    currency: Currency,
    bin_price_enabled: bool,
    min_price_enabled: bool,
}

#[derive(Deserialize, Eq, PartialEq, Serialize)]
enum Currency {
    #[serde(rename = "USD")]
    Usd,
}

#[derive(Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FrozenItem {
    item_id: String,
    connection_incarnation_id: String,
    scan_id: String,
    asset_generation: i64,
    terms: CreateTerms,
}

pub(crate) struct SellerHubCreateWork {
    operation_id: String,
    plan_id: String,
    connection_id: String,
    target: FrozenItem,
    request_digest: String,
    reconciliation_only: bool,
    retry_after: Option<String>,
}

impl SellerHubCreateWork {
    pub(crate) fn connection_id(&self) -> &str {
        &self.connection_id
    }
    pub(crate) fn incarnation(&self) -> &str {
        &self.target.connection_incarnation_id
    }
    pub(crate) fn domain(&self) -> &str {
        &self.target.terms.domain
    }
    pub(crate) fn cents(&self) -> u64 {
        self.target.terms.price_cents
    }

    pub(crate) fn reconciliation_only(&self) -> bool {
        self.reconciliation_only
    }
}

struct ScanScope {
    incarnation: String,
    scan: String,
    observation_run: Option<String>,
}

fn storage(_: rusqlite::Error) -> BusinessDatabaseError {
    BusinessDatabaseError::StorageRejected
}

fn bounded_index(value: usize) -> Result<i64> {
    i64::try_from(value).map_err(|_| BusinessDatabaseError::InvalidInput)
}

fn validate_items(input: &DesktopSellerHubCreatePreviewRequest) -> Result<BTreeMap<&str, u64>> {
    let invalid = BusinessDatabaseError::InvalidInput;
    if input.schema_version != 1
        || !is_uuid_v4(&input.connection_id)
        || !(1..=MAX_ITEMS).contains(&input.items.len())
    {
        return Err(invalid);
    }
    let mut items = BTreeMap::new();
    for item in &input.items {
        validate_domain_asset_id(&item.domain).map_err(|_| invalid)?;
        if !(1..=MAX_PRICE_CENTS).contains(&item.price_cents)
            || items
                .insert(item.domain.as_str(), item.price_cents)
                .is_some()
        {
            return Err(invalid);
        }
    }
    Ok(items)
}

fn current_scan(tx: &Connection, workspace: &str, connection: &str) -> Result<ScanScope> {
    tx.query_row(
        "SELECT s.incarnation_id,r.scan_id,r.observation_run_id
         FROM spaceship_sellerhub_scans r
         JOIN spaceship_sellerhub_connections s USING(workspace_id,connection_id)
         JOIN local_provider_connections c USING(workspace_id,connection_id)
         WHERE r.workspace_id=?1 AND r.connection_id=?2
           AND s.state='active' AND s.purged_at IS NULL AND c.deleted_at IS NULL
           AND c.revoked_at IS NULL AND c.lifecycle_status='active' AND c.validation_status='valid'
           AND c.credential_use_state='active'
           AND c.connection_incarnation_id=s.incarnation_id AND c.provider_kind='spaceship'
           AND json(c.capabilities_json)='[\"marketplace\"]'
         ORDER BY r.rowid DESC LIMIT 1",
        params![workspace, connection],
        |row| {
            Ok(ScanScope {
                incarnation: row.get(0)?,
                scan: row.get(1)?,
                observation_run: row.get(2)?,
            })
        },
    )
    .optional()
    .map_err(storage)?
    .ok_or(BusinessDatabaseError::MutationStale)
}

fn available_asset_generation(
    tx: &Transaction<'_>,
    workspace: &str,
    connection: &str,
    scan: &ScanScope,
    domain: &str,
) -> Result<i64> {
    // The local receipt is a preview precondition. A live authenticated account
    // scan before dispatch remains necessary, including for previously skipped assets.
    tx.query_row(
        "SELECT a.entity_generation FROM domain_assets a WHERE a.workspace_id=?1 AND a.entity_id=?2
           AND a.lifecycle_status='active' AND a.deleted_at IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM sync_domain_asset_provisional_re_adds p
             WHERE p.workspace_id=a.workspace_id AND p.entity_id=a.entity_id
           )
           AND NOT EXISTS (
             SELECT 1 FROM marketplace_listing_observations m
             WHERE m.workspace_id=a.workspace_id AND m.entity_id=a.entity_id
               AND m.observation_run_id=?3 AND m.binding_connection_id=?4
               AND m.marketplace_kind='spaceship' AND m.confirmed=1
           )
           AND NOT EXISTS (
             SELECT 1 FROM operation_attempts op
             JOIN operation_plan_items i USING(workspace_id,plan_id,item_id)
             JOIN operation_plans p USING(workspace_id,plan_id)
             WHERE i.workspace_id=a.workspace_id AND i.entity_id=a.entity_id AND i.connection_id=?4
               AND p.operation_kind IN ('sellerhub_bin_price','sellerhub_create_listing')
               AND op.status IN ('queued','running','outcome_unknown','waiting_remote',
                                 'manual_action_required','failed_retryable')
           )",
        params![workspace, domain, scan.observation_run, connection],
        |row| row.get(0),
    )
    .optional()
    .map_err(storage)?
    .ok_or(BusinessDatabaseError::MutationStale)
}

fn scope_hash(
    workspace: &str,
    connection: &str,
    plan_id: &str,
    at: &str,
    expires_at: &str,
    frozen: &[FrozenItem],
) -> Result<String> {
    let scope = serde_json::to_vec(&(
        KIND, 1, workspace, connection, plan_id, at, expires_at, frozen,
    ))
    .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    Ok(hex_digest(&scope))
}

#[expect(
    clippy::too_many_lines,
    reason = "one strict read validates the persisted rows and their aggregate plan hash"
)]
fn read_plan(db: &Connection, workspace: &str, plan_id: &str) -> Result<StoredCreationPlan> {
    let invalid = BusinessDatabaseError::StorageRejected;
    let (stored_hash, at, expires_at, count, phase): (String, String, String, i64, String) = db
        .query_row(
            "SELECT plan_hash,created_at,expires_at,item_count,phase FROM operation_plans
         WHERE workspace_id=?1 AND plan_id=?2 AND operation_kind=?3
           AND phase IN ('awaiting_approval','executing','completed') AND risk_level='standard'",
            params![workspace, plan_id, KIND],
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
        .optional()
        .map_err(storage)?
        .ok_or(BusinessDatabaseError::MutationStale)?;
    let count = usize::try_from(count).map_err(|_| invalid)?;
    if !(1..=MAX_ITEMS).contains(&count) {
        return Err(invalid);
    }
    validate_timestamp(Some(at.clone())).map_err(|_| invalid)?;
    validate_timestamp(Some(expires_at.clone())).map_err(|_| invalid)?;
    let mut statement = db.prepare(
        "SELECT item_id,entity_id,connection_id,ordinal,precondition_json,new_value_json,
                (capability=?3 AND field_path='listing' AND risk_level='standard'
                 AND execution_mode='automatic' AND inclusion_status='included' AND old_value_json IS NULL)
         FROM operation_plan_items
         WHERE workspace_id=?1 AND plan_id=?2 ORDER BY ordinal LIMIT ?4",
    ).map_err(storage)?;
    let mut rows = statement
        .query(params![
            workspace,
            plan_id,
            SPACESHIP_MARKETPLACE_WRITE,
            bounded_index(count + 1)?
        ])
        .map_err(storage)?;
    let mut frozen: Vec<FrozenItem> = Vec::with_capacity(count);
    let mut connection = None;
    while let Some(row) = rows.next().map_err(storage)? {
        let expectation: String = row.get(4).map_err(storage)?;
        let terms: String = row.get(5).map_err(storage)?;
        if expectation.len() > 1024 || terms.len() > 512 {
            return Err(invalid);
        }
        let expected: FrozenItem = serde_json::from_str(&expectation).map_err(|_| invalid)?;
        let terms: CreateTerms = serde_json::from_str(&terms).map_err(|_| invalid)?;
        let row_id: String = row.get(0).map_err(storage)?;
        let row_domain: String = row.get(1).map_err(storage)?;
        let row_connection: String = row.get(2).map_err(storage)?;
        let ordinal: i64 = row.get(3).map_err(storage)?;
        let valid: bool = row.get(6).map_err(storage)?;
        if !valid
            || ordinal != bounded_index(frozen.len())?
            || row_id != expected.item_id
            || row_domain != expected.terms.domain
            || expected.terms != terms
            || !is_uuid_v4(&expected.item_id)
            || !is_uuid_v4(&expected.connection_incarnation_id)
            || !is_uuid_v4(&expected.scan_id)
            || !is_uuid_v4(&row_connection)
            || !terms.bin_price_enabled
            || terms.min_price_enabled
            || !(1..=MAX_PRICE_CENTS).contains(&terms.price_cents)
            || !(1..=9_007_199_254_740_991).contains(&expected.asset_generation)
        {
            return Err(invalid);
        }
        validate_domain_asset_id(&row_domain).map_err(|_| invalid)?;
        if frozen.last().is_some_and(|prior| {
            prior.terms.domain >= row_domain
                || prior.scan_id != expected.scan_id
                || prior.connection_incarnation_id != expected.connection_incarnation_id
        }) {
            return Err(invalid);
        }
        if connection.get_or_insert(row_connection.clone()) != &row_connection {
            return Err(invalid);
        }
        frozen.push(expected);
    }
    let connection_id = connection.ok_or(invalid)?;
    if frozen.len() != count
        || scope_hash(
            workspace,
            &connection_id,
            plan_id,
            &at,
            &expires_at,
            &frozen,
        )? != stored_hash
    {
        return Err(invalid);
    }
    Ok(StoredCreationPlan {
        plan_hash: stored_hash,
        connection_id,
        expires_at,
        phase,
        frozen,
    })
}

fn next_sequence(db: &Connection, at: &str) -> Result<i64> {
    db.query_row(
        "UPDATE active_workspace_metadata SET local_commit_sequence=local_commit_sequence+1,updated_at=?1
         WHERE singleton=1 RETURNING local_commit_sequence", [at], |row| row.get(0),
    ).map_err(|_| BusinessDatabaseError::SequenceExhausted)
}

fn request_digest(connection: &str, scope: &FrozenItem) -> Result<String> {
    let encoded = serde_json::to_vec(&(
        "GOODDEALER-SELLERHUB-CREATE-LISTING-REQUEST-V1",
        connection,
        scope,
    ))
    .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    Ok(hex_digest(&encoded))
}

fn current_asset_generation(connection: &Connection, workspace: &str, domain: &str) -> Result<i64> {
    connection
        .query_row(
            "SELECT a.entity_generation FROM domain_assets a
         WHERE a.workspace_id=?1 AND a.entity_id=?2 AND a.lifecycle_status='active'
           AND a.deleted_at IS NULL AND NOT EXISTS (
             SELECT 1 FROM sync_domain_asset_provisional_re_adds r
             WHERE r.workspace_id=a.workspace_id AND r.entity_id=a.entity_id
           )",
            params![workspace, domain],
            |row| row.get(0),
        )
        .optional()
        .map_err(storage)?
        .ok_or(BusinessDatabaseError::MutationStale)
}

fn require_absent_in_complete_inventory(inventory: &[String], domain: &str) -> Result<()> {
    if inventory.len() > 10_000 {
        return Err(BusinessDatabaseError::StorageRejected);
    }
    let mut seen = BTreeSet::new();
    for observed in inventory {
        validate_domain_asset_id(observed).map_err(|_| BusinessDatabaseError::StorageRejected)?;
        if observed == domain || !seen.insert(observed.as_str()) {
            return Err(BusinessDatabaseError::MutationStale);
        }
    }
    Ok(())
}

impl BusinessDatabase {
    /// Stores the canonical scope to be approved before exposing a preview.
    pub(crate) fn preview_sellerhub_create<G>(
        &mut self,
        input: &DesktopSellerHubCreatePreviewRequest,
        at: &str,
        authenticated_time: &str,
        guard: impl FnOnce() -> Result<G>,
    ) -> Result<DesktopSellerHubCreatePreview> {
        let items = validate_items(input)?;
        validate_timestamp(Some(at.to_owned())).map_err(|_| BusinessDatabaseError::InvalidInput)?;
        validate_timestamp(Some(authenticated_time.to_owned()))
            .map_err(|_| BusinessDatabaseError::InvalidInput)?;
        let workspace = &self.workspace_id;
        let tx = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(storage)?;
        execution_evidence::require_no_barrier(&tx, workspace)?;
        let scan = current_scan(&tx, workspace, &input.connection_id)?;
        let frozen = items
            .into_iter()
            .map(|(domain, cents)| {
                Ok(FrozenItem {
                    item_id: random_id()?,
                    connection_incarnation_id: scan.incarnation.clone(),
                    scan_id: scan.scan.clone(),
                    asset_generation: available_asset_generation(
                        &tx,
                        workspace,
                        &input.connection_id,
                        &scan,
                        domain,
                    )?,
                    terms: CreateTerms {
                        domain: domain.to_owned(),
                        price_cents: cents,
                        currency: Currency::Usd,
                        bin_price_enabled: true,
                        min_price_enabled: false,
                    },
                })
            })
            .collect::<Result<Vec<_>>>()?;
        let expires_at: String = tx
            .query_row(
                "SELECT strftime('%Y-%m-%dT%H:%M:%SZ',?1,'+900 seconds')",
                [authenticated_time],
                |row| row.get(0),
            )
            .map_err(storage)?;
        let plan_id = random_id()?;
        let plan_hash = scope_hash(
            workspace,
            &input.connection_id,
            &plan_id,
            at,
            &expires_at,
            &frozen,
        )?;
        let sequence = next_sequence(&tx, at)?;
        tx.execute(
            "INSERT INTO operation_plans(workspace_id,plan_id,operation_kind,plan_hash,title,phase,
             risk_level,item_count,created_at,expires_at,local_commit_sequence)
             VALUES(?1,?2,?3,?4,'SellerHub fixed-price listing','awaiting_approval','standard',?5,?6,?7,?8)",
            params![workspace, plan_id, KIND, plan_hash, bounded_index(frozen.len())?, at, expires_at, sequence],
        ).map_err(storage)?;
        for (ordinal, item) in frozen.iter().enumerate() {
            let precondition_json =
                serde_json::to_string(item).map_err(|_| BusinessDatabaseError::StorageRejected)?;
            let terms_json = serde_json::to_string(&item.terms)
                .map_err(|_| BusinessDatabaseError::StorageRejected)?;
            tx.execute(
                "INSERT INTO operation_plan_items(workspace_id,plan_id,item_id,ordinal,entity_id,
                 connection_id,capability,field_path,new_value_json,precondition_json,risk_level,
                 execution_mode,inclusion_status)
                 VALUES(?1,?2,?3,?4,?5,?6,?7,'listing',?8,?9,'standard','automatic','included')",
                params![
                    workspace,
                    plan_id,
                    item.item_id,
                    bounded_index(ordinal)?,
                    item.terms.domain,
                    input.connection_id,
                    SPACESHIP_MARKETPLACE_WRITE,
                    terms_json,
                    precondition_json
                ],
            )
            .map_err(storage)?;
        }
        let preview = read_plan(&tx, workspace, &plan_id)?.into_preview(&plan_id);
        let _guard = guard()?;
        tx.commit().map_err(storage)?;
        Ok(preview)
    }

    pub(crate) fn read_sellerhub_create_status(
        &self,
        request: &DesktopSellerHubCreateStatusRequest,
        at: &str,
    ) -> Result<(
        Vec<DesktopSellerHubCreatePlanSummary>,
        Option<DesktopSellerHubCreateDetail>,
    )> {
        let invalid = BusinessDatabaseError::InvalidInput;
        if request.schema_version != 1
            || request.plan_id.as_deref().is_some_and(|id| !is_uuid_v4(id))
        {
            return Err(invalid);
        }
        let db = self.store.raw_connection();
        let workspace = &self.workspace_id;
        let mut q = db
            .prepare(
                "SELECT plan_id,CASE WHEN phase='awaiting_approval' AND expires_at<=?3
             THEN 'expired' ELSE phase END,item_count FROM operation_plans
             WHERE workspace_id=?1 AND operation_kind=?2
             AND phase IN ('awaiting_approval','executing','completed')
             ORDER BY created_at DESC,local_commit_sequence DESC LIMIT 20",
            )
            .map_err(storage)?;
        let recent = q
            .query_map(params![workspace, KIND, at], |row| {
                Ok(DesktopSellerHubCreatePlanSummary {
                    plan_id: row.get(0)?,
                    phase: row.get(1)?,
                    count: row.get(2)?,
                })
            })
            .map_err(storage)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(storage)?;
        let Some(id) = request.plan_id.as_deref() else {
            return Ok((recent, None));
        };
        let plan = read_plan(db, workspace, id)?;
        let phase = if plan.phase == "awaiting_approval" && plan.expires_at.as_str() <= at {
            "expired".to_owned()
        } else {
            plan.phase.clone()
        };
        let mut items = Vec::with_capacity(plan.frozen.len());
        let mut query = db
            .prepare(
                "SELECT status,error_code FROM operation_attempts
             WHERE workspace_id=?1 AND plan_id=?2 AND item_id=?3 AND attempt_number=1",
            )
            .map_err(storage)?;
        for target in &plan.frozen {
            let current = query
                .query_row(params![workspace, id, target.item_id], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
                })
                .optional()
                .map_err(storage)?;
            let state = match current
                .as_ref()
                .map(|(status, reason)| (status.as_str(), reason.as_deref()))
            {
                None if plan.phase == "awaiting_approval" => "planned",
                Some(("queued", _)) => "queued",
                Some(("running", _)) => "reconciling",
                Some(("waiting_remote", Some("ownership_verifying"))) => "ownership_pending",
                Some(("waiting_remote", _)) => "unconfirmed",
                Some(("succeeded", None)) => "published",
                Some(("failed_final", _)) => "not_sent",
                _ => return Err(BusinessDatabaseError::StorageRejected),
            };
            items.push(DesktopSellerHubCreateItemStatus {
                domain: target.terms.domain.clone(),
                state: state.to_owned(),
            });
        }
        Ok((
            recent,
            Some(DesktopSellerHubCreateDetail {
                preview: plan.into_preview(id),
                phase,
                items,
            }),
        ))
    }

    #[cfg(test)]
    fn read_sellerhub_create_preview(&self, id: &str) -> Result<DesktopSellerHubCreatePreview> {
        Ok(read_plan(self.store.raw_connection(), &self.workspace_id, id)?.into_preview(id))
    }

    #[expect(
        clippy::too_many_lines,
        reason = "confirmation, exact replay and signing share one transaction and final fence"
    )]
    pub(crate) fn approve_sellerhub_create<G>(
        &mut self,
        input: &DesktopSellerHubCreateApproveRequest,
        at: &str,
        context: &ExecutionEvidenceContext,
        signer: &mut EvidenceSigner<'_>,
        guard: impl FnOnce(Option<&str>) -> Result<G>,
    ) -> Result<(DesktopSellerHubCreateApproval, bool)> {
        let invalid = BusinessDatabaseError::InvalidInput;
        let stale = BusinessDatabaseError::MutationStale;
        if input.schema_version != 1 || !is_uuid_v4(&input.plan_id) {
            return Err(invalid);
        }
        super::validate_sha256_hex(&input.plan_hash).map_err(|_| invalid)?;
        validate_timestamp(Some(at.to_owned())).map_err(|_| invalid)?;
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
        let id = &input.plan_id;
        let plan = read_plan(&tx, workspace, id)?;
        if plan.plan_hash != input.plan_hash {
            return Err(stale);
        }
        let (operation_id, deadline) = match plan.phase.as_str() {
            "awaiting_approval" => {
                if plan.expires_at.as_str() <= at.max(context.occurred_at.as_str()) {
                    return Err(stale);
                }
                let scan = current_scan(&tx, workspace, &plan.connection_id)?;
                for item in &plan.frozen {
                    let generation = available_asset_generation(
                        &tx,
                        workspace,
                        &plan.connection_id,
                        &scan,
                        &item.terms.domain,
                    )?;
                    if generation != item.asset_generation
                        || scan.scan != item.scan_id
                        || scan.incarnation != item.connection_incarnation_id
                    {
                        return Err(stale);
                    }
                }
                let sequence = next_sequence(&tx, at)?;
                let operation_id = random_id()?;
                tx.execute(
                    "UPDATE operation_plans SET phase='approved',approved_at=?3,local_commit_sequence=?4
                     WHERE workspace_id=?1 AND plan_id=?2", params![workspace,id,at,sequence],
                ).map_err(storage)?;
                tx.execute(
                    "INSERT INTO operations(workspace_id,operation_id,plan_id,idempotency_key,phase,requested_at,local_commit_sequence)
                     VALUES(?1,?2,?3,?3,'queued',?4,?5)", params![workspace,operation_id,id,at,sequence],
                ).map_err(storage)?;
                let mut targets = Vec::with_capacity(plan.frozen.len());
                for item in &plan.frozen {
                    let digest = request_digest(&plan.connection_id, item)?;
                    tx.execute(
                        "INSERT INTO operation_attempts(workspace_id,operation_id,plan_id,item_id,attempt_number,status,request_digest)
                         VALUES(?1,?2,?3,?4,1,'queued',?5)", params![workspace,operation_id,id,item.item_id,digest],
                    ).map_err(storage)?;
                    targets.push(ApprovalTarget {
                        item_id: item.item_id.clone(),
                        request_digest: digest,
                    });
                }
                marketplace_approval::record_approval(
                    ApprovalPurpose::SellerHubCreateListing,
                    &tx,
                    context,
                    id,
                    &operation_id,
                    &plan.plan_hash,
                    &targets,
                    signer,
                )?;
                tx.execute("UPDATE operation_plans SET phase='executing' WHERE workspace_id=?1 AND plan_id=?2",
                    params![workspace,id]).map_err(storage)?;
                tx.execute("UPDATE operations SET phase='running',started_at=?3 WHERE workspace_id=?1 AND operation_id=?2",
                    params![workspace,operation_id,at]).map_err(storage)?;
                (operation_id, Some(plan.expires_at.as_str()))
            }
            "executing" | "completed" => {
                let operation_id = tx.query_row(
                    "SELECT o.operation_id FROM operations o JOIN afternic_listing_approvals approval
                     USING(workspace_id,operation_id,plan_id)
                     WHERE o.workspace_id=?1 AND o.plan_id=?2
                       AND approval.action='create_listing' AND approval.plan_hash=?3",
                    params![workspace, id, execution_evidence::hex_to_digest(&plan.plan_hash)?],
                    |row| row.get(0),
                ).map_err(storage)?;
                (operation_id, None)
            }
            _ => return Err(stale),
        };
        let _guard = guard(deadline)?;
        tx.commit().map_err(storage)?;
        Ok((
            DesktopSellerHubCreateApproval {
                schema_version: 1,
                operation_id,
            },
            deadline.is_some(),
        ))
    }

    pub(crate) fn next_sellerhub_create_work(
        &self,
        allow_write: bool,
        context: &ExecutionEvidenceContext,
    ) -> Result<Option<SellerHubCreateWork>> {
        let workspace = &self.workspace_id;
        if context.workspace_id != *workspace {
            return Err(BusinessDatabaseError::MutationStale);
        }
        let db = self.store.raw_connection();
        execution_evidence::require_no_barrier(db, workspace)?;
        let row = db.query_row(
            "SELECT a.operation_id,a.plan_id,a.item_id,a.request_digest,a.status,a.retry_after
             FROM operation_attempts a JOIN operations o USING(workspace_id,operation_id,plan_id)
             JOIN operation_plans p USING(workspace_id,plan_id)
             JOIN operation_plan_items i USING(workspace_id,plan_id,item_id)
             WHERE a.workspace_id=?1 AND p.operation_kind=?2 AND p.phase='executing'
                AND o.phase='running' AND a.attempt_number=1
                AND ((a.status IN ('running','waiting_remote') AND EXISTS(
                  SELECT 1 FROM spaceship_sellerhub_connections c JOIN domain_assets d ON d.workspace_id=c.workspace_id
                  WHERE c.workspace_id=a.workspace_id AND c.connection_id=i.connection_id
                    AND c.state='active' AND c.purged_at IS NULL
                    AND c.incarnation_id=json_extract(i.precondition_json,'$.connectionIncarnationId')
                    AND d.entity_id=i.entity_id AND d.deleted_at IS NULL AND d.lifecycle_status='active'
                    AND d.entity_generation=json_extract(i.precondition_json,'$.assetGeneration')
                    AND NOT EXISTS(SELECT 1 FROM sync_domain_asset_provisional_re_adds r
                      WHERE r.workspace_id=d.workspace_id AND r.entity_id=d.entity_id)))
                  OR (a.status='queued' AND ?3
                  AND EXISTS(SELECT 1 FROM afternic_listing_approvals approval
                     WHERE approval.workspace_id=a.workspace_id AND approval.operation_id=a.operation_id
                      AND approval.plan_id=a.plan_id AND approval.action='create_listing'
                      AND approval.source_device_id=?5 AND approval.active_lease_epoch=?6
                      AND approval.source_installation_digest=?7 AND approval.credential_epoch=?8
                      AND approval.signing_key_id=?9 AND approval.signing_key_version=?10)))
                AND (a.retry_after IS NULL OR a.retry_after<=?4)
             ORDER BY a.status='queued',o.requested_at,a.operation_id,i.ordinal LIMIT 1",
            params![workspace, KIND, allow_write, context.occurred_at, context.source_device_id,
              i64::try_from(context.active_lease_epoch).map_err(|_| BusinessDatabaseError::InvalidInput)?,
              context.source_installation_digest,
              i64::try_from(context.credential_epoch).map_err(|_| BusinessDatabaseError::InvalidInput)?,
              context.signing_key_id,
              i64::try_from(context.signing_key_version).map_err(|_| BusinessDatabaseError::InvalidInput)?],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?,
                      row.get::<_, String>(3)?, row.get::<_, String>(4)?, row.get::<_, Option<String>>(5)?)),
        ).optional().map_err(storage)?;
        let Some((operation_id, plan_id, item_id, stored_request, status, retry_after)) = row
        else {
            return Ok(None);
        };
        let plan = read_plan(db, workspace, &plan_id)?;
        let target = plan
            .frozen
            .into_iter()
            .find(|item| item.item_id == item_id)
            .ok_or(BusinessDatabaseError::StorageRejected)?;
        if request_digest(&plan.connection_id, &target)? != stored_request {
            return Err(BusinessDatabaseError::StorageRejected);
        }
        Ok(Some(SellerHubCreateWork {
            operation_id,
            plan_id,
            connection_id: plan.connection_id,
            target,
            request_digest: stored_request,
            reconciliation_only: status != "queued",
            retry_after,
        }))
    }

    pub(crate) fn check_sellerhub_create_scope(
        &self,
        work: &SellerHubCreateWork,
        dispatch: bool,
        context: &ExecutionEvidenceContext,
    ) -> Result<()> {
        let db = self.store.raw_connection();
        let workspace = &self.workspace_id;
        let stale = BusinessDatabaseError::MutationStale;
        if context.workspace_id != *workspace {
            return Err(stale);
        }
        execution_evidence::require_no_barrier(db, workspace)?;
        let scan = current_scan(db, workspace, &work.connection_id)?;
        if scan.incarnation != work.incarnation()
            || current_asset_generation(db, workspace, work.domain())?
                != work.target.asset_generation
        {
            return Err(stale);
        }
        let approval = if dispatch || !work.reconciliation_only {
            Some((
                &context.source_device_id,
                &context.source_installation_digest,
            ))
        } else {
            None
        };
        let status = if dispatch {
            "running"
        } else if work.reconciliation_only {
            "reconcile"
        } else {
            "queued"
        };
        let exists: bool = db.query_row(
            "SELECT EXISTS(SELECT 1 FROM operation_attempts a
             JOIN operations o USING(workspace_id,operation_id,plan_id)
             JOIN afternic_listing_approvals p USING(workspace_id,operation_id,plan_id)
             WHERE a.workspace_id=?1 AND a.operation_id=?2 AND a.plan_id=?3 AND a.item_id=?4
               AND a.request_digest=?5 AND a.retry_after IS ?6 AND a.attempt_number=1 AND o.phase='running'
               AND (a.status=?7 OR (?7='reconcile' AND a.status IN ('running','waiting_remote')))
               AND p.action='create_listing' AND (?8 IS NULL OR (
                 p.source_device_id=?8 AND p.source_installation_digest=?9 AND p.active_lease_epoch=?10
                 AND p.credential_epoch=?11 AND p.signing_key_id=?12 AND p.signing_key_version=?13))
               AND (NOT ?14 OR EXISTS(SELECT 1 FROM device_execution_fact_outbox f
                 WHERE f.workspace_id=a.workspace_id AND f.operation_id=a.operation_id
                 AND f.item_id=a.item_id AND f.attempt_number=1
                 AND json_extract(f.envelope_json,'$.eventType')='sellerhub_create_listing_dispatch_claimed')))",
            params![workspace,work.operation_id,work.plan_id,work.target.item_id,work.request_digest,
              if dispatch { None } else { work.retry_after.as_deref() }, status,
              approval.map(|a|a.0),approval.map(|a|a.1),i64::try_from(context.active_lease_epoch).map_err(|_| stale)?,
              i64::try_from(context.credential_epoch).map_err(|_| stale)?,context.signing_key_id,
              i64::try_from(context.signing_key_version).map_err(|_| stale)?,dispatch],
            |row| row.get(0),
        ).map_err(storage)?;
        if !exists {
            return Err(stale);
        }
        Ok(())
    }

    /// Makes the sole dispatch claim after the Native service validates an authenticated full scan.
    pub(crate) fn claim_sellerhub_create<G>(
        &mut self,
        work: &SellerHubCreateWork,
        native_inventory: &[String],
        at: &str,
        context: &ExecutionEvidenceContext,
        signer: &mut EvidenceSigner<'_>,
        guard: impl FnOnce() -> Result<G>,
    ) -> Result<()> {
        let stale = BusinessDatabaseError::MutationStale;
        if context.workspace_id != self.workspace_id || work.reconciliation_only {
            return Err(stale);
        }
        validate_timestamp(Some(at.to_owned())).map_err(|_| BusinessDatabaseError::InvalidInput)?;
        require_absent_in_complete_inventory(native_inventory, &work.target.terms.domain)?;
        let workspace = &self.workspace_id;
        let tx = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(storage)?;
        execution_evidence::require_no_barrier(&tx, workspace)?;
        let target = &work.target;
        let scan = current_scan(&tx, workspace, &work.connection_id)?;
        if scan.incarnation != target.connection_incarnation_id
            || current_asset_generation(&tx, workspace, &target.terms.domain)?
                != target.asset_generation
            || request_digest(&work.connection_id, target)? != work.request_digest
        {
            return Err(stale);
        }
        let plan = read_plan(&tx, workspace, &work.plan_id)?;
        if plan.connection_id != work.connection_id
            || !plan.frozen.iter().any(|frozen| frozen == target)
        {
            return Err(stale);
        }
        let pending: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM operation_attempts a JOIN operations o USING(workspace_id,operation_id,plan_id)
              WHERE a.workspace_id=?1 AND a.operation_id=?2 AND a.plan_id=?3 AND a.item_id=?4
               AND a.request_digest=?5 AND a.attempt_number=1 AND a.status='queued' AND o.phase='running'
               AND a.retry_after IS ?6)",
            params![workspace,work.operation_id,work.plan_id,target.item_id,work.request_digest,work.retry_after],
            |row| row.get(0),
        ).map_err(storage)?;
        if !pending || plan.phase != "executing" {
            return Err(stale);
        }
        marketplace_approval::record_claim(
            ApprovalPurpose::SellerHubCreateListing,
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
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::active_workspace::business::{
        LocalDatabaseKey,
        spaceship_sellerhub::{
            DesktopSellerHubListingFact, DesktopSellerHubListingState, SellerHubInventoryCommit,
        },
    };
    use serde_json::json;

    #[test]
    #[expect(
        clippy::too_many_lines,
        reason = "the same encrypted database is reopened across preview, claim and readback"
    )]
    fn freezes_only_a_locally_unobserved_asset_and_rolls_back_if_authority_changes() {
        const AT: &str = "2026-11-20T00:00:00Z";
        let directory = crate::test_tempdir::tempdir().unwrap();
        let path = directory.path().join("workspace.db");
        let key = LocalDatabaseKey::from_bytes([0x6a; 32]);
        let open = || BusinessDatabase::open(&path, &key, "workspace-local").unwrap();
        let mut db = open();
        let execution = ("source-device", 1);
        let initial = db
            .prepare_sellerhub_connection("SellerHub", AT, execution, || Ok(()))
            .unwrap();
        let listing = [DesktopSellerHubListingFact {
            domain: "example.test".to_owned(),
            state: DesktopSellerHubListingState::Verifying,
            enabled_bin_price_usd: None,
        }];
        db.import_sellerhub_inventory(
            &SellerHubInventoryCommit {
                seed: &initial,
                listings: &listing,
                device_id: execution.0,
                lease_epoch: execution.1,
                at: AT,
            },
            || Ok(()),
        )
        .unwrap();
        let wire = json!({
            "schemaVersion":1, "connectionId":initial.connection_id,
            "items":[{"domain":"example.test","priceCents":20305}]
        });
        let request = serde_json::from_value(wire).unwrap();
        assert!(matches!(
            db.preview_sellerhub_create(&request, AT, AT, || Ok(())),
            Err(BusinessDatabaseError::MutationStale)
        ));
        let scope = db
            .queue_sellerhub_scan(&initial.connection_id, execution, || Ok(()))
            .unwrap();
        db.import_sellerhub_inventory(
            &SellerHubInventoryCommit {
                seed: &scope,
                listings: &[],
                device_id: execution.0,
                lease_epoch: execution.1,
                at: AT,
            },
            || Ok(()),
        )
        .unwrap();
        assert!(matches!(
            db.preview_sellerhub_create(&request, AT, AT, || Err::<(), _>(
                BusinessDatabaseError::MutationStale
            )),
            Err(BusinessDatabaseError::MutationStale)
        ));
        let preview = db
            .preview_sellerhub_create(&request, AT, AT, || Ok(()))
            .unwrap();
        assert_eq!(preview.expires_at, "2026-11-20T00:15:00Z");
        assert_eq!(preview.items[0].price_cents, 20_305);
        drop(db);
        let mut db = open();
        let reopened = db.read_sellerhub_create_preview(&preview.plan_id).unwrap();
        assert_eq!(reopened.plan_hash, preview.plan_hash);
        let count: i64 = db.store.raw_connection().query_row(
            "SELECT count(*) FROM operation_plans WHERE operation_kind='sellerhub_create_listing'",
            [], |row| row.get(0),
        ).unwrap();
        assert_eq!(count, 1);
        let fact: (String, String) = db
            .store
            .raw_connection()
            .query_row(
                "SELECT json_extract(precondition_json,'$.connectionIncarnationId'),new_value_json
             FROM operation_plan_items WHERE plan_id=?1",
                [&preview.plan_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(fact.0, initial.incarnation_id);
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&fact.1).unwrap(),
            json!({
                "domain":"example.test","priceCents":20305,"currency":"USD",
                "binPriceEnabled":true,"minPriceEnabled":false
            })
        );
        db.store.fixture_connection().execute(
            "UPDATE operation_plan_items SET new_value_json=json_set(new_value_json,'$.minPriceEnabled',json('true'))
             WHERE plan_id=?1", [&preview.plan_id],
        ).unwrap();
        assert!(matches!(
            db.read_sellerhub_create_preview(&preview.plan_id),
            Err(BusinessDatabaseError::StorageRejected)
        ));

        let approve = |db: &mut BusinessDatabase| {
            let preview = db
                .preview_sellerhub_create(&request, AT, AT, || Ok(()))
                .unwrap();
            DesktopSellerHubCreateApproveRequest {
                schema_version: 1,
                plan_id: preview.plan_id,
                plan_hash: preview.plan_hash,
            }
        };
        let accepted = approve(&mut db);
        let competitor = approve(&mut db);
        let (context, mut signer) = execution_evidence::test_context("workspace-local", AT);
        let (foreign, _) = execution_evidence::test_context("foreign-workspace", AT);
        assert!(matches!(
            db.approve_sellerhub_create(&accepted, AT, &foreign, &mut signer, |_| Ok(())),
            Err(BusinessDatabaseError::MutationStale)
        ));
        assert!(matches!(
            db.approve_sellerhub_create(&accepted, AT, &context, &mut signer, |_| Err::<(), _>(
                BusinessDatabaseError::MutationStale
            )),
            Err(BusinessDatabaseError::MutationStale)
        ));
        let empty: i64 = db
            .store
            .raw_connection()
            .query_row("SELECT count(*) FROM operation_attempts", [], |r| r.get(0))
            .unwrap();
        assert_eq!(empty, 0);
        let (published, fresh) = db
            .approve_sellerhub_create(&accepted, AT, &context, &mut signer, |_| Ok(()))
            .unwrap();
        assert!(fresh);
        let (replayed, fresh) = db
            .approve_sellerhub_create(&accepted, AT, &context, &mut signer, |_| Ok(()))
            .unwrap();
        assert!(!fresh);
        assert_eq!(published.operation_id, replayed.operation_id);
        assert!(matches!(
            db.approve_sellerhub_create(&competitor, AT, &context, &mut signer, |_| Ok(())),
            Err(BusinessDatabaseError::MutationStale)
        ));
        let count: i64 = db.store.raw_connection().query_row(
            "SELECT count(*) FROM operation_attempts WHERE status='queued' AND attempt_number=1 AND operation_id=?1",
            [&published.operation_id], |r| r.get(0),
        ).unwrap();
        assert_eq!(count, 1);

        let queued = db
            .next_sellerhub_create_work(true, &context)
            .unwrap()
            .unwrap();
        assert!(!queued.reconciliation_only());
        assert!(matches!(
            db.claim_sellerhub_create(
                &queued,
                &[String::from("example.test")],
                AT,
                &context,
                &mut signer,
                || Ok(())
            ),
            Err(BusinessDatabaseError::MutationStale)
        ));
        assert!(matches!(
            db.claim_sellerhub_create(&queued, &[], AT, &context, &mut signer, || Err::<(), _>(
                BusinessDatabaseError::MutationStale
            )),
            Err(BusinessDatabaseError::MutationStale)
        ));
        db.claim_sellerhub_create(&queued, &[], AT, &context, &mut signer, || Ok(()))
            .unwrap();
        drop(db);
        let mut reopened_database = open();
        let readonly = reopened_database
            .next_sellerhub_create_work(false, &context)
            .unwrap()
            .unwrap();
        assert!(readonly.reconciliation_only());
        for purpose in [&queued, &readonly] {
            assert!(matches!(
                reopened_database.claim_sellerhub_create(
                    purpose,
                    &[],
                    AT,
                    &context,
                    &mut signer,
                    || Ok(())
                ),
                Err(BusinessDatabaseError::MutationStale)
            ));
        }

        reopened_database
            .settle_sellerhub_create_observation(
                &readonly,
                SellerHubCreateReadback::OwnershipPending,
                None,
                AT,
                &context,
                &mut signer,
                || Ok(()),
            )
            .unwrap();
        assert!(
            reopened_database
                .next_sellerhub_create_work(false, &context)
                .unwrap()
                .is_none()
        );
        let new_time = "2026-11-20T00:00:30Z";
        let (new_context, mut signer) =
            execution_evidence::test_context("workspace-local", new_time);
        let retry = reopened_database
            .next_sellerhub_create_work(false, &new_context)
            .unwrap()
            .unwrap();
        assert!(retry.reconciliation_only());
        assert!(matches!(
            reopened_database.settle_sellerhub_create_observation(
                &readonly,
                SellerHubCreateReadback::Published,
                None,
                new_time,
                &new_context,
                &mut signer,
                || Ok(())
            ),
            Err(BusinessDatabaseError::MutationStale)
        ));
        for (observed, reason) in [
            (
                SellerHubCreateReadback::TermsUnconfirmed,
                "postcondition_pending",
            ),
            (SellerHubCreateReadback::StateBlocked, "not_on_sale"),
            (SellerHubCreateReadback::ReadFailed, "read_failed"),
        ] {
            assert_eq!(observed.evidence().1, Some(reason));
        }
        reopened_database
            .settle_sellerhub_create_observation(
                &retry,
                SellerHubCreateReadback::Published,
                None,
                new_time,
                &new_context,
                &mut signer,
                || Ok(()),
            )
            .unwrap();
        let phase: (String, i64) = reopened_database.store.raw_connection().query_row(
            "SELECT o.phase,(SELECT count(*) FROM operation_results r WHERE r.workspace_id=o.workspace_id
               AND r.operation_id=o.operation_id) FROM operations o WHERE operation_id=?1",
            [&published.operation_id], |row| Ok((row.get(0)?, row.get(1)?)),
        ).unwrap();
        assert_eq!(phase, ("completed".into(), 2));
    }
}
