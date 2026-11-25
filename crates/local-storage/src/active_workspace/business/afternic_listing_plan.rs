//! Typed Afternic v2 parent plans. All steps retain the original single business writer.
use super::afternic_listing_write as write;
use super::execution_evidence::{
    self, EvidenceReadFence, EvidenceSigner, ListingPlanApprovalTarget, OwnershipClaimDigests,
};
use super::{
    AfternicConnectionSeed, AfternicListingWriteWorkSeed, BusinessDatabase, BusinessDatabaseError,
    DesktopAfternicListingObservation, DesktopAfternicListingPlan,
    DesktopAfternicListingPlanAction, DesktopAfternicListingPlanCurrentSummary,
    DesktopAfternicListingPlanDetail, DesktopAfternicListingPlanItem,
    DesktopAfternicListingPlanOwnershipReview, DesktopAfternicListingPlanOwnershipReviewObserved,
    DesktopAfternicListingPlanPreviewRequest, DesktopAfternicListingPlanStatus,
    DesktopAfternicListingPlanSummary, DesktopAfternicListingPlanWrite,
    DesktopAfternicListingWriteAction, DesktopAfternicListingWritePatch,
    DesktopAfternicListingWritePreviewRequest, DesktopAfternicListingWriteWorkKind,
    ExecutionEvidenceContext, afternic, afternic_ownership_review, hex_digest, is_uuid_v4,
    validate_domain_asset_id, validate_sha256_hex, validate_timestamp,
};
use rusqlite::OptionalExtension;
use rusqlite::{Connection, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
type Result<T> = std::result::Result<T, BusinessDatabaseError>;
fn storage(_: rusqlite::Error) -> BusinessDatabaseError {
    BusinessDatabaseError::StorageRejected
}
fn stale() -> BusinessDatabaseError {
    BusinessDatabaseError::MutationStale
}
fn encode<T: Serialize>(v: &T) -> Result<String> {
    serde_json::to_string(v).map_err(|_| BusinessDatabaseError::InvalidInput)
}
fn decode<T: serde::de::DeserializeOwned>(s: &str) -> Result<T> {
    serde_json::from_str(s).map_err(|_| BusinessDatabaseError::StorageRejected)
}
fn timestamp(s: &str) -> Result<()> {
    validate_timestamp(Some(s.into()))
        .map(|_| ())
        .map_err(|_| BusinessDatabaseError::InvalidInput)
}
fn integer(v: u64) -> Result<i64> {
    i64::try_from(v).map_err(|_| BusinessDatabaseError::InvalidInput)
}
fn required_nullable<'de, D: serde::Deserializer<'de>, T: Deserialize<'de>>(
    d: D,
) -> std::result::Result<Option<T>, D::Error> {
    Option::<T>::deserialize(d)
}
const REVIEW_ADAPTER: &str = "afternic-official-v3-ownership-review-v1";
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReviewFrozen {
    schema_version: u8,
    adapter_revision: String,
    action: DesktopAfternicListingPlanAction,
    domain: String,
    connection_id: String,
    connection_incarnation_id: String,
    credential_generation: u64,
    credential_public_proof: String,
    entity_generation: u64,
    #[serde(deserialize_with = "required_nullable")]
    parent_item_id: Option<String>,
    #[serde(deserialize_with = "required_nullable")]
    parent_request_digest: Option<String>,
    #[serde(deserialize_with = "required_nullable")]
    binding_digest: Option<String>,
    #[serde(deserialize_with = "required_nullable")]
    binding_generation: Option<u64>,
    #[serde(deserialize_with = "required_nullable")]
    observation_id: Option<String>,
    #[serde(deserialize_with = "required_nullable")]
    observation_digest: Option<String>,
    observed_at: String,
    #[serde(deserialize_with = "required_nullable")]
    listing: Option<DesktopAfternicListingObservation>,
    trigger_status: String,
    max_dispatches: u8,
    minimum_interval_seconds: u32,
}
#[derive(Clone)]
enum Frozen {
    Write(write::AfternicListingWriteFrozenItem),
    Review(ReviewFrozen),
}
impl Frozen {
    fn domain(&self) -> &str {
        match self {
            Self::Write(i) => &i.domain,
            Self::Review(i) => &i.domain,
        }
    }
    fn connection(&self) -> &str {
        match self {
            Self::Write(i) => &i.connection_id,
            Self::Review(i) => &i.connection_id,
        }
    }
    fn action(&self) -> DesktopAfternicListingPlanAction {
        match self {
            Self::Write(i) => match i.action {
                DesktopAfternicListingWriteAction::Create => {
                    DesktopAfternicListingPlanAction::Create
                }
                DesktopAfternicListingWriteAction::Update => {
                    DesktopAfternicListingPlanAction::Update
                }
            },
            Self::Review(_) => DesktopAfternicListingPlanAction::ReactivateOwnershipReview,
        }
    }
    fn wire(&self) -> Result<String> {
        match self {
            Self::Write(i) => encode(i),
            Self::Review(i) => encode(i),
        }
    }
    fn digest(&self) -> Result<String> {
        match self {
            Self::Write(i) => write::request_digest(i),
            Self::Review(i) => Ok(hex_digest(encode(&(2, REVIEW_ADAPTER, i))?.as_bytes())),
        }
    }
    fn parent(&self) -> (Option<String>, Option<String>) {
        match self {
            Self::Write(_) => (None, None),
            Self::Review(i) => (i.parent_item_id.clone(), i.parent_request_digest.clone()),
        }
    }
}
struct Stored {
    id: String,
    frozen: Frozen,
}
#[derive(Clone)]
pub(crate) struct AfternicListingPlanFrozenItem {
    pub(crate) domain: String,
    pub(crate) connection_id: String,
    pub(crate) connection_incarnation_id: String,
    pub(crate) credential_generation: u64,
    pub(crate) action: DesktopAfternicListingPlanAction,
    pub(crate) changes: Option<DesktopAfternicListingWritePatch>,
    stored: Frozen,
}
#[derive(Clone)]
pub(crate) struct AfternicListingPlanWorkSeed {
    pub(crate) plan_id: String,
    pub(crate) operation_id: String,
    pub(crate) item_id: String,
    pub(crate) request_digest: String,
    pub(crate) frozen: AfternicListingPlanFrozenItem,
    pub(crate) kind: DesktopAfternicListingWriteWorkKind,
    evidence_fence: EvidenceReadFence,
}
fn read_frozen(wire: &str) -> Result<Frozen> {
    let v: serde_json::Value = decode(wire)?;
    if v["schemaVersion"] != 2 {
        return Err(stale());
    }
    if v["action"] == "reactivate_ownership_review" {
        let i: ReviewFrozen = decode(wire)?;
        validate_review(&i)?;
        Ok(Frozen::Review(i))
    } else {
        let i = decode(wire)?;
        write::validate_frozen(&i)?;
        Ok(Frozen::Write(i))
    }
}
fn validate_review(i: &ReviewFrozen) -> Result<()> {
    if i.schema_version != 2
        || i.adapter_revision != REVIEW_ADAPTER
        || i.action != DesktopAfternicListingPlanAction::ReactivateOwnershipReview
        || i.trigger_status != "OWNERSHIP_REVIEW"
        || i.max_dispatches != 1
        || i.minimum_interval_seconds != 86400
        || i.entity_generation == 0
        || i.credential_generation == 0
        || (i.parent_item_id.is_some() != i.parent_request_digest.is_some())
        || (i.binding_digest.is_some() != i.binding_generation.is_some())
        || (i.parent_item_id.is_none() && i.binding_digest.is_none())
    {
        return Err(stale());
    }
    validate_domain_asset_id(&i.domain).map_err(|_| stale())?;
    timestamp(&i.observed_at)?;
    for id in [&i.connection_id, &i.connection_incarnation_id]
        .into_iter()
        .chain(i.parent_item_id.as_ref())
        .chain(i.observation_id.as_ref())
    {
        if !is_uuid_v4(id) {
            return Err(stale());
        }
    }
    for d in [&i.credential_public_proof]
        .into_iter()
        .chain(i.parent_request_digest.as_ref())
        .chain(i.binding_digest.as_ref())
        .chain(i.observation_digest.as_ref())
    {
        validate_sha256_hex(d).map_err(|_| stale())?;
    }
    if let Some(o) = &i.listing {
        o.validate()?;
        if o.domain != i.domain
            || i.observation_digest.as_deref() != Some(hex_digest(encode(o)?.as_bytes()).as_str())
            || i.binding_generation != Some(i.credential_generation)
        {
            return Err(stale());
        }
    }
    Ok(())
}
fn stored_items(c: &Connection, workspace: &str, plan: &str) -> Result<Vec<Stored>> {
    let mut q=c.prepare("SELECT item_id,precondition_json FROM operation_plan_items WHERE workspace_id=?1 AND plan_id=?2 ORDER BY ordinal LIMIT 1001").map_err(storage)?;
    let rows = q
        .query_map(params![workspace, plan], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })
        .map_err(storage)?;
    let mut items = Vec::new();
    for row in rows {
        let (id, wire) = row.map_err(storage)?;
        items.push(Stored {
            id,
            frozen: read_frozen(&wire)?,
        });
    }
    if items.is_empty() || items.len() > 1000 {
        return Err(stale());
    }
    let mut domains = BTreeSet::new();
    let mut actions = BTreeSet::new();
    let mut reviews = BTreeSet::new();
    let mut connection = None;
    for i in &items {
        domains.insert(i.frozen.domain());
        if connection.is_some_and(|c| c != i.frozen.connection()) {
            return Err(stale());
        }
        connection = Some(i.frozen.connection());
        match &i.frozen {
            Frozen::Write(w) => {
                actions.insert(encode(&w.action)?);
            }
            Frozen::Review(r) => {
                if !reviews.insert(&r.domain) {
                    return Err(stale());
                }
                if let Some(p) = &r.parent_item_id {
                    let parent = items.iter().find(|i| &i.id == p).ok_or_else(stale)?;
                    if !matches!(parent.frozen, Frozen::Write(_))
                        || parent.frozen.domain() != r.domain
                        || Some(parent.frozen.digest()?) != r.parent_request_digest
                    {
                        return Err(stale());
                    }
                }
            }
        }
    }
    if domains.len() > 500 || actions.len() > 1 {
        return Err(stale());
    }
    Ok(items)
}
fn plan_hash(
    workspace: &str,
    plan: &str,
    created: &str,
    expires: &str,
    items: &[Stored],
) -> Result<String> {
    let targets = items
        .iter()
        .map(|i| Ok((&i.id, decode::<serde_json::Value>(&i.frozen.wire()?)?)))
        .collect::<Result<Vec<_>>>()?;
    Ok(hex_digest(
        encode(&(
            2,
            "afternic_listing_plan",
            workspace,
            plan,
            created,
            expires,
            targets,
        ))?
        .as_bytes(),
    ))
}
fn validate_plan(c: &Connection, workspace: &str, plan: &str) -> Result<Vec<Stored>> {
    let(hash,created,expires):(String,String,String)=c.query_row("SELECT plan_hash,created_at,expires_at FROM operation_plans WHERE workspace_id=?1 AND plan_id=?2 AND operation_kind='afternic_listing_write'",params![workspace,plan],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).map_err(storage)?;
    let items = stored_items(c, workspace, plan)?;
    if hash != plan_hash(workspace, plan, &created, &expires, &items)? {
        return Err(stale());
    }
    Ok(items)
}
fn review_from_parent(
    seed: &AfternicConnectionSeed,
    domain: &str,
    parent: Option<&Stored>,
    at: &str,
) -> Result<ReviewFrozen> {
    let w = parent.and_then(|p| {
        if let Frozen::Write(w) = &p.frozen {
            Some(w)
        } else {
            None
        }
    });
    Ok(ReviewFrozen {
        schema_version: 2,
        adapter_revision: REVIEW_ADAPTER.into(),
        action: DesktopAfternicListingPlanAction::ReactivateOwnershipReview,
        domain: domain.into(),
        connection_id: seed.connection_id.clone(),
        connection_incarnation_id: seed.connection_incarnation_id.clone(),
        credential_generation: seed.credential_generation,
        credential_public_proof: seed.credential_public_proof.clone(),
        entity_generation: w.map_or(0, |w| w.entity_generation),
        parent_item_id: parent.map(|p| p.id.clone()),
        parent_request_digest: parent.map(|p| p.frozen.digest()).transpose()?,
        binding_digest: w.and_then(|w| w.binding_digest.clone()),
        binding_generation: w.and_then(|w| w.binding_generation),
        observation_id: w.and_then(|w| w.observation_id.clone()),
        observation_digest: w.and_then(|w| w.observation_digest.clone()),
        observed_at: w.map_or_else(|| at.into(), |w| w.observed_at.clone()),
        listing: w.and_then(|w| w.listing.clone()),
        trigger_status: "OWNERSHIP_REVIEW".into(),
        max_dispatches: 1,
        minimum_interval_seconds: 86400,
    })
}
fn standalone_review(
    c: &Connection,
    workspace: &str,
    seed: &AfternicConnectionSeed,
    domain: &str,
    at: &str,
) -> Result<ReviewFrozen> {
    type StandaloneObservation = (
        u64,
        String,
        String,
        String,
        String,
        u64,
        String,
        Option<u64>,
        Option<u64>,
        Option<u64>,
        Option<bool>,
        String,
        String,
    );
    let mut i = review_from_parent(seed, domain, None, at)?;
    let row:StandaloneObservation=c.query_row("SELECT a.entity_generation,m.listing_observation_id,m.provider_version_token,m.observed_at,m.binding_resource_digest,m.binding_generation,d.provider_status,d.buynow_price,d.floor_price,d.minbid_price,d.hidden,d.provider_created_at,d.provider_updated_at FROM domain_assets a JOIN afternic_inventory_scans s ON s.workspace_id=a.workspace_id AND s.connection_id=?2 AND s.credential_generation=?3 JOIN marketplace_listing_observations m ON m.workspace_id=s.workspace_id AND m.observation_run_id=s.observation_run_id AND m.entity_id=a.entity_id JOIN afternic_listing_details d USING(workspace_id,listing_observation_id) WHERE a.workspace_id=?1 AND a.entity_id=?4 AND a.lifecycle_status='active' AND s.scan_id=(SELECT latest.scan_id FROM afternic_inventory_scans latest WHERE latest.workspace_id=?1 AND latest.connection_id=?2 AND latest.credential_generation=?3 ORDER BY latest.rowid DESC LIMIT 1) AND m.binding_connection_id=?2 AND m.confirmed=1 AND m.observation_availability='available' AND m.evidence_status='confirmed' LIMIT 1",params![workspace,seed.connection_id,integer(seed.credential_generation)?,domain],|r|Ok((write::unsigned(r,0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,write::unsigned(r,5)?,r.get(6)?,write::optional_unsigned(r,7)?,write::optional_unsigned(r,8)?,write::optional_unsigned(r,9)?,r.get(10)?,r.get(11)?,r.get(12)?))).map_err(storage)?;
    i.entity_generation = row.0;
    i.observation_id = Some(row.1);
    i.observation_digest = Some(row.2);
    i.observed_at = row.3;
    i.binding_digest = Some(row.4);
    i.binding_generation = Some(row.5);
    i.listing = Some(DesktopAfternicListingObservation {
        domain: domain.into(),
        status: row.6,
        buynow_price: row.7,
        floor_price: row.8,
        minbid_price: row.9,
        hidden: row.10,
        created_at: row.11,
        updated_at: row.12,
    });
    validate_review(&i)?;
    Ok(i)
}
fn insert_scope(c: &Connection, workspace: &str, plan: &str, item: &Stored) -> Result<()> {
    if let Frozen::Review(r) = &item.frozen {
        c.execute("INSERT INTO afternic_ownership_review_items(workspace_id,plan_id,item_id,domain,connection_id,connection_incarnation_id,credential_generation,credential_public_proof,entity_generation,parent_item_id,parent_request_digest,binding_digest,binding_generation) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",params![workspace,plan,item.id,r.domain,r.connection_id,r.connection_incarnation_id,integer(r.credential_generation)?,r.credential_public_proof,integer(r.entity_generation)?,r.parent_item_id,r.parent_request_digest,r.binding_digest,r.binding_generation.map(integer).transpose()?]).map_err(storage)?;
    }
    Ok(())
}
impl BusinessDatabase {
    pub(crate) fn preview_afternic_listing_plan_with_time<G: FnOnce() -> Result<()>>(
        &mut self,
        seed: &AfternicConnectionSeed,
        request: &DesktopAfternicListingPlanPreviewRequest,
        at: &str,
        execution_at: &str,
        guard: G,
    ) -> Result<DesktopAfternicListingPlan> {
        request.validate()?;
        timestamp(at)?;
        timestamp(execution_at)?;
        self.admit_afternic_provider(seed)?;
        require_not_controlled(
            self.store.raw_connection(),
            &self.workspace_id,
            &seed.connection_id,
            &seed.connection_incarnation_id,
            seed.credential_generation,
        )?;
        if request.connection_id() != seed.connection_id {
            return Err(stale());
        }
        let targets = request.targets();
        let plan = afternic::random_id()?;
        let tx = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(storage)?;
        execution_evidence::require_no_barrier(&tx, &self.workspace_id)?;
        let mut items = Vec::new();
        if request.action() != DesktopAfternicListingPlanAction::ReactivateOwnershipReview {
            let action = if request.action() == DesktopAfternicListingPlanAction::Create {
                "create"
            } else {
                "update"
            };
            let input:DesktopAfternicListingWritePreviewRequest=serde_json::from_value(serde_json::json!({"schemaVersion":1,"connectionId":seed.connection_id,"action":action,"items":targets.iter().map(|(domain,changes,_)|{if action=="create"{serde_json::json!({"domain":domain,"values":changes})}else{serde_json::json!({"domain":domain,"patch":changes})}}).collect::<Vec<_>>()})).map_err(|_|BusinessDatabaseError::InvalidInput)?;
            items = write::freeze_items(&tx, &self.workspace_id, seed, &input, at, &plan)?
                .into_iter()
                .map(|mut i| {
                    i.frozen.schema_version = 2;
                    Stored {
                        id: i.id,
                        frozen: Frozen::Write(i.frozen),
                    }
                })
                .collect();
        }
        for (domain, _, review) in &targets {
            if *review {
                let parent = items.iter().find(|i| i.frozen.domain() == domain);
                let frozen = if parent.is_some() {
                    review_from_parent(seed, domain, parent, at)?
                } else {
                    standalone_review(&tx, &self.workspace_id, seed, domain, at)?
                };
                validate_review(&frozen)?;
                items.push(Stored {
                    id: afternic::random_id()?,
                    frozen: Frozen::Review(frozen),
                });
            }
        }
        let expires = write::plus_seconds(&tx, execution_at, 900)?;
        let hash = plan_hash(&self.workspace_id, &plan, at, &expires, &items)?;
        let seq = write::next_sequence(&tx, at)?;
        tx.execute("INSERT INTO operation_plans(workspace_id,plan_id,operation_kind,plan_hash,title,phase,risk_level,item_count,created_at,expires_at,local_commit_sequence) VALUES(?1,?2,'afternic_listing_write',?3,'Afternic listing and ownership review','awaiting_approval','standard',?4,?5,?6,?7)",params![self.workspace_id,plan,hash,integer(items.len() as u64)?,at,expires,seq]).map_err(storage)?;
        for (ordinal, i) in items.iter().enumerate() {
            let (old, intent) = match &i.frozen {
                Frozen::Write(w) => (encode(&w.listing)?, write::intent(w)?),
                Frozen::Review(r) => (
                    encode(&r.listing)?,
                    encode(&serde_json::json!({"action":"reactivate_ownership_review"}))?,
                ),
            };
            tx.execute("INSERT INTO operation_plan_items(workspace_id,plan_id,item_id,ordinal,entity_id,connection_id,capability,old_value_json,new_value_json,precondition_json,risk_level,execution_mode,inclusion_status) VALUES(?1,?2,?3,?4,?5,?6,'afternic:marketplace:write',?7,?8,?9,'standard','automatic','included')",params![self.workspace_id,plan,i.id,integer(ordinal as u64)?,i.frozen.domain(),i.frozen.connection(),old,intent,i.frozen.wire()?]).map_err(storage)?;
        }
        for i in &items {
            insert_scope(&tx, &self.workspace_id, &plan, i)?;
        }
        guard()?;
        tx.commit().map_err(storage)?;
        self.afternic_listing_plan(&plan, at)
    }
}

fn require_not_controlled(
    c: &Connection,
    workspace: &str,
    connection: &str,
    incarnation: &str,
    generation: u64,
) -> Result<()> {
    let blocked:bool=c.query_row("SELECT EXISTS(SELECT 1 FROM afternic_controlled_acceptance_runs WHERE workspace_id=?1 AND connection_id=?2 AND connection_incarnation_id=?3 AND credential_generation=?4)",params![workspace,connection,incarnation,integer(generation)?],|r|r.get(0)).map_err(storage)?;
    if blocked { Err(stale()) } else { Ok(()) }
}
fn locally_current(c: &Connection, workspace: &str, f: &Frozen) -> Result<bool> {
    match f {Frozen::Write(w)=>write::locally_current(c,workspace,w),Frozen::Review(r)=>c.query_row("SELECT EXISTS(SELECT 1 FROM domain_assets a JOIN local_provider_connections c ON c.workspace_id=a.workspace_id AND c.connection_id=?3 JOIN afternic_connection_publications p ON p.workspace_id=c.workspace_id AND p.connection_id=c.connection_id AND p.credential_generation=?5 WHERE a.workspace_id=?1 AND a.entity_id=?2 AND a.entity_generation=?7 AND a.lifecycle_status='active' AND c.connection_incarnation_id=?4 AND c.lifecycle_status='active' AND c.credential_use_state='active' AND c.validation_status='valid' AND c.deleted_at IS NULL AND c.revoked_at IS NULL AND p.connection_incarnation_id=?4 AND p.credential_public_proof=?6 AND p.publication_state='active' AND NOT EXISTS(SELECT 1 FROM sync_domain_asset_provisional_re_adds x WHERE x.workspace_id=a.workspace_id AND x.entity_id=a.entity_id) AND (?8 IS NULL OR EXISTS(SELECT 1 FROM domain_asset_provider_bindings b WHERE b.workspace_id=a.workspace_id AND b.entity_id=a.entity_id AND b.connection_id=c.connection_id AND b.resource_kind='listing' AND b.resource_binding_digest=?8 AND b.binding_generation=?5 AND b.validation_status IN ('verified','unverified'))))",params![workspace,r.domain,r.connection_id,r.connection_incarnation_id,integer(r.credential_generation)?,r.credential_public_proof,integer(r.entity_generation)?,r.binding_digest],|row|row.get(0)).map_err(storage)}
}
fn approval_inventory_is_current(c: &Connection, workspace: &str, f: &Frozen) -> Result<bool> {
    let (connection, _, generation) = identity(f);
    let digest = match f {
        Frozen::Write(item) => item.observation_digest.as_deref(),
        // The parent already validates the same inventory fact for a conditional review.
        Frozen::Review(item) if item.parent_item_id.is_some() => return Ok(true),
        Frozen::Review(item) => item.observation_digest.as_deref(),
    };
    afternic::inventory_still_matches(c, workspace, connection, generation, f.domain(), digest)
}

fn identity(f: &Frozen) -> (&str, &str, u64) {
    match f {
        Frozen::Write(w) => (
            &w.connection_id,
            &w.connection_incarnation_id,
            w.credential_generation,
        ),
        Frozen::Review(r) => (
            &r.connection_id,
            &r.connection_incarnation_id,
            r.credential_generation,
        ),
    }
}
fn evidence_action(a: DesktopAfternicListingPlanAction) -> execution_evidence::ListingPlanAction {
    match a {
        DesktopAfternicListingPlanAction::Create => execution_evidence::ListingPlanAction::Create,
        DesktopAfternicListingPlanAction::Update => execution_evidence::ListingPlanAction::Update,
        DesktopAfternicListingPlanAction::ReactivateOwnershipReview => {
            execution_evidence::ListingPlanAction::ReactivateOwnershipReview
        }
    }
}
impl BusinessDatabase {
    pub(crate) fn approve_afternic_listing_plan_with_evidence<G: FnOnce() -> Result<()>>(
        &mut self,
        plan: &str,
        hash: &str,
        at: &str,
        e: &ExecutionEvidenceContext,
        signer: &mut EvidenceSigner<'_>,
        guard: G,
    ) -> Result<DesktopAfternicListingPlan> {
        if e.workspace_id != self.workspace_id || !is_uuid_v4(plan) {
            return Err(stale());
        }
        timestamp(at)?;
        validate_sha256_hex(hash).map_err(|_| stale())?;
        let tx = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(storage)?;
        execution_evidence::require_no_barrier(&tx, &self.workspace_id)?;
        let items = validate_plan(&tx, &self.workspace_id, plan)?;
        let(saved,phase,expires):(String,String,String)=tx.query_row("SELECT plan_hash,phase,expires_at FROM operation_plans WHERE workspace_id=?1 AND plan_id=?2",params![self.workspace_id,plan],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).map_err(storage)?;
        if saved != hash {
            return Err(stale());
        }
        for i in &items {
            let (connection, incarnation, generation) = identity(&i.frozen);
            require_not_controlled(&tx, &self.workspace_id, connection, incarnation, generation)?;
        }
        if phase == "awaiting_approval" {
            if expires <= e.occurred_at {
                return Err(stale());
            }
            for i in &items {
                if !locally_current(&tx, &self.workspace_id, &i.frozen)?
                    || !approval_inventory_is_current(&tx, &self.workspace_id, &i.frozen)?
                {
                    return Err(stale());
                }
                if let Frozen::Write(w) = &i.frozen
                    && (write::other_execution(&tx, &self.workspace_id, w, plan)?
                        || w.action == DesktopAfternicListingWriteAction::Create
                            && !write::no_live_binding(&tx, &self.workspace_id, w)?)
                {
                    return Err(stale());
                }
            }
            let sequence = write::next_sequence(&tx, at)?;
            let operation = afternic::random_id()?;
            tx.execute("UPDATE operation_plans SET phase='approved',approved_at=?3,local_commit_sequence=?4 WHERE workspace_id=?1 AND plan_id=?2",params![self.workspace_id,plan,at,sequence]).map_err(storage)?;
            tx.execute("INSERT INTO operations(workspace_id,operation_id,plan_id,idempotency_key,phase,requested_at,local_commit_sequence) VALUES(?1,?2,?3,?3,'queued',?4,?5)",params![self.workspace_id,operation,plan,at,sequence]).map_err(storage)?;
            let mut targets = Vec::new();
            for i in &items {
                let request = i.frozen.digest()?;
                let (parent_item_id, parent_request_digest) = i.frozen.parent();
                tx.execute("INSERT INTO operation_attempts(workspace_id,operation_id,plan_id,item_id,attempt_number,status,request_digest) VALUES(?1,?2,?3,?4,1,'queued',?5)",params![self.workspace_id,operation,plan,i.id,request]).map_err(storage)?;
                targets.push(ListingPlanApprovalTarget {
                    item_id: i.id.clone(),
                    action: evidence_action(i.frozen.action()),
                    request_digest: request,
                    parent_item_id,
                    parent_request_digest,
                });
            }
            execution_evidence::record_listing_plan_approval(
                &tx, e, plan, &operation, hash, &targets, signer,
            )?;
            tx.execute(
                "UPDATE operation_plans SET phase='executing' WHERE workspace_id=?1 AND plan_id=?2",
                params![self.workspace_id, plan],
            )
            .map_err(storage)?;
            tx.execute("UPDATE operations SET phase='running',started_at=?3 WHERE workspace_id=?1 AND operation_id=?2",params![self.workspace_id,operation,at]).map_err(storage)?;
        } else if !matches!(phase.as_str(), "approved" | "executing" | "completed") {
            return Err(stale());
        }
        guard()?;
        tx.commit().map_err(storage)?;
        self.afternic_listing_plan(plan, at)
    }
}
fn work_seed(
    plan: String,
    operation: String,
    item: String,
    request: String,
    stored: Frozen,
    kind: DesktopAfternicListingWriteWorkKind,
    fence: EvidenceReadFence,
) -> AfternicListingPlanWorkSeed {
    let (connection, incarnation, generation) = identity(&stored);
    let frozen = AfternicListingPlanFrozenItem {
        domain: stored.domain().into(),
        connection_id: connection.into(),
        connection_incarnation_id: incarnation.into(),
        credential_generation: generation,
        action: stored.action(),
        changes: match &stored {
            Frozen::Write(w) => Some(w.changes.clone()),
            Frozen::Review(_) => None,
        },
        stored,
    };
    AfternicListingPlanWorkSeed {
        plan_id: plan,
        operation_id: operation,
        item_id: item,
        request_digest: request,
        frozen,
        kind,
        evidence_fence: fence,
    }
}
fn base_seed(seed: &AfternicListingPlanWorkSeed) -> Result<AfternicListingWriteWorkSeed> {
    let Frozen::Write(w) = &seed.frozen.stored else {
        return Err(stale());
    };
    Ok(AfternicListingWriteWorkSeed {
        plan_id: seed.plan_id.clone(),
        operation_id: seed.operation_id.clone(),
        item_id: seed.item_id.clone(),
        request_digest: seed.request_digest.clone(),
        frozen: w.clone(),
        kind: seed.kind,
        evidence_fence: seed.evidence_fence.clone(),
    })
}
fn check_work(c: &Connection, workspace: &str, seed: &AfternicListingPlanWorkSeed) -> Result<()> {
    let (_, incarnation, generation) = identity(&seed.frozen.stored);
    if incarnation != seed.frozen.connection_incarnation_id
        || generation != seed.frozen.credential_generation
    {
        return Err(stale());
    }
    execution_evidence::check_read_fence(c, workspace, &seed.evidence_fence)?;
    let items = validate_plan(c, workspace, &seed.plan_id)?;
    let found = items
        .iter()
        .find(|i| i.id == seed.item_id)
        .ok_or_else(stale)?;
    if found.frozen.wire()? != seed.frozen.stored.wire()?
        || found.frozen.digest()? != seed.request_digest
    {
        return Err(stale());
    }
    let valid:bool=c.query_row("SELECT EXISTS(SELECT 1 FROM afternic_listing_write_effective_attempts a JOIN operations o USING(workspace_id,operation_id) WHERE a.workspace_id=?1 AND a.operation_id=?2 AND a.plan_id=?3 AND a.item_id=?4 AND a.request_digest=?5 AND o.phase='running' AND a.effective_status IN ('queued','running','outcome_unknown') AND ((?6 AND a.status='queued') OR (NOT ?6 AND a.status IN ('running','outcome_unknown'))))",params![workspace,seed.operation_id,seed.plan_id,seed.item_id,seed.request_digest,seed.kind==DesktopAfternicListingWriteWorkKind::Preflight],|r|r.get(0)).map_err(storage)?;
    if !valid {
        return Err(stale());
    }
    Ok(())
}
impl BusinessDatabase {
    #[expect(
        clippy::too_many_lines,
        reason = "bounded parent and stale-work maintenance share one guarded transaction"
    )]
    pub(crate) fn next_afternic_listing_plan_work_with_evidence<G: FnOnce() -> Result<()>>(
        &mut self,
        at: &str,
        allow_write: bool,
        e: &ExecutionEvidenceContext,
        signer: &mut EvidenceSigner<'_>,
        guard: G,
    ) -> Result<Option<AfternicListingPlanWorkSeed>> {
        timestamp(at)?;
        if e.workspace_id != self.workspace_id {
            return Err(stale());
        }
        let tx = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(storage)?;
        let barrier: bool = tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM device_handoff_barriers WHERE workspace_id=?1)",
                [&self.workspace_id],
                |r| r.get(0),
            )
            .map_err(storage)?;
        if barrier {
            return Ok(None);
        }
        // A terminal parent cannot leave its independently approved child waiting forever.
        // This is a signed no-dispatch refusal, never a fabricated ownership claim.
        for _ in 0..500 {
            let failed:Option<(String,String,String,String,String)>=tx.query_row("SELECT a.plan_id,a.operation_id,a.item_id,a.request_digest,i.precondition_json FROM afternic_listing_write_effective_attempts a JOIN afternic_ownership_review_items s USING(workspace_id,plan_id,item_id) JOIN operation_plan_items i USING(workspace_id,plan_id,item_id) JOIN afternic_listing_write_effective_attempts p ON p.workspace_id=a.workspace_id AND p.operation_id=a.operation_id AND p.item_id=s.parent_item_id WHERE a.workspace_id=?1 AND a.status='queued' AND a.effective_status='queued' AND p.effective_status='failed_final' ORDER BY a.operation_id,i.ordinal LIMIT 1",[&self.workspace_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?))).optional().map_err(storage)?;
            let Some((plan, operation, item, request, wire)) = failed else {
                break;
            };
            let fence = execution_evidence::read_fence(&tx, e)?;
            let work = work_seed(
                plan,
                operation,
                item,
                request,
                read_frozen(&wire)?,
                DesktopAfternicListingWriteWorkKind::Preflight,
                fence,
            );
            check_work(&tx, &self.workspace_id, &work)?;
            review_result(
                &tx,
                &self.workspace_id,
                &work,
                "refused",
                Some("precondition_changed"),
                None,
                None,
                e,
                signer,
            )?;
        }
        let mut selected = None;
        for _ in 0..500 {
            let row:Option<(String,String,String,String,String,String)>=tx.query_row("SELECT a.plan_id,a.operation_id,a.item_id,a.request_digest,a.status,i.precondition_json FROM afternic_listing_write_effective_attempts a JOIN operation_plan_items i USING(workspace_id,plan_id,item_id) JOIN operations o USING(workspace_id,operation_id) LEFT JOIN afternic_listing_write_reconciliations w ON w.workspace_id=a.workspace_id AND w.operation_id=a.operation_id AND w.item_id=a.item_id AND w.sequence=(SELECT max(n.sequence) FROM afternic_listing_write_reconciliations n WHERE n.workspace_id=a.workspace_id AND n.operation_id=a.operation_id AND n.item_id=a.item_id) LEFT JOIN afternic_ownership_review_reconciliations r ON r.workspace_id=a.workspace_id AND r.operation_id=a.operation_id AND r.item_id=a.item_id AND r.sequence=(SELECT max(n.sequence) FROM afternic_ownership_review_reconciliations n WHERE n.workspace_id=a.workspace_id AND n.operation_id=a.operation_id AND n.item_id=a.item_id) LEFT JOIN afternic_ownership_review_preflights f ON f.workspace_id=a.workspace_id AND f.operation_id=a.operation_id AND f.item_id=a.item_id AND f.sequence=(SELECT max(n.sequence) FROM afternic_ownership_review_preflights n WHERE n.workspace_id=a.workspace_id AND n.operation_id=a.operation_id AND n.item_id=a.item_id) LEFT JOIN afternic_ownership_review_items s ON s.workspace_id=a.workspace_id AND s.plan_id=a.plan_id AND s.item_id=a.item_id WHERE a.workspace_id=?1 AND json_extract(i.precondition_json,'$.schemaVersion')=2 AND o.phase='running' AND a.effective_status IN ('queued','running','outcome_unknown') AND (?3 OR a.status!='queued') AND coalesce(w.next_read_at,r.next_read_at,f.next_read_at,?2)<=?2 AND (s.parent_item_id IS NULL OR a.status!='queued' OR EXISTS(SELECT 1 FROM afternic_listing_write_reconciliations p WHERE p.workspace_id=a.workspace_id AND p.operation_id=a.operation_id AND p.item_id=s.parent_item_id AND p.fields_matched=1 AND p.sequence=(SELECT max(n.sequence) FROM afternic_listing_write_reconciliations n WHERE n.workspace_id=p.workspace_id AND n.operation_id=p.operation_id AND n.item_id=p.item_id))) ORDER BY a.status='queued',o.requested_at,a.operation_id,i.ordinal LIMIT 1",params![self.workspace_id,e.occurred_at,allow_write],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?))).optional().map_err(storage)?;
            let Some((plan, operation, item, request, status, wire)) = row else {
                break;
            };
            let stored = read_frozen(&wire)?;
            let fence = execution_evidence::read_fence(&tx, e)?;
            let work = work_seed(
                plan,
                operation,
                item,
                request,
                stored,
                if status == "queued" {
                    DesktopAfternicListingWriteWorkKind::Preflight
                } else {
                    DesktopAfternicListingWriteWorkKind::Reconcile
                },
                fence,
            );
            check_work(&tx, &self.workspace_id, &work)?;
            if locally_current(&tx, &self.workspace_id, &work.frozen.stored)? {
                selected = Some(work);
                break;
            }
            match &work.frozen.stored {
                Frozen::Write(_) => write::record_fact(
                    &tx,
                    &self.workspace_id,
                    &base_seed(&work)?,
                    "conflict",
                    Some("connection_changed"),
                    None,
                    None,
                    &e.occurred_at,
                    e,
                    signer,
                )?,
                Frozen::Review(_) => review_result(
                    &tx,
                    &self.workspace_id,
                    &work,
                    if work.kind == DesktopAfternicListingWriteWorkKind::Preflight {
                        "refused"
                    } else {
                        "conflict"
                    },
                    Some("connection_changed"),
                    None,
                    None,
                    e,
                    signer,
                )?,
            }
        }
        guard()?;
        tx.commit().map_err(storage)?;
        Ok(selected)
    }
    pub(crate) fn recheck_afternic_listing_plan_work(
        &self,
        seed: &AfternicListingPlanWorkSeed,
    ) -> Result<()> {
        check_work(self.store.raw_connection(), &self.workspace_id, seed)?;
        if !locally_current(
            self.store.raw_connection(),
            &self.workspace_id,
            &seed.frozen.stored,
        )? {
            return Err(stale());
        }
        Ok(())
    }
    pub(crate) fn require_afternic_listing_plan_signed_claim(
        &self,
        seed: &AfternicListingPlanWorkSeed,
        e: &ExecutionEvidenceContext,
    ) -> Result<()> {
        self.recheck_afternic_listing_plan_work(seed)?;
        let (c, i, g) = identity(&seed.frozen.stored);
        require_not_controlled(self.store.raw_connection(), &self.workspace_id, c, i, g)?;
        execution_evidence::require_claim(
            self.store.raw_connection(),
            e,
            &seed.operation_id,
            &seed.item_id,
        )
    }
}

fn review_compatible(
    c: &Connection,
    workspace: &str,
    r: &ReviewFrozen,
    o: &DesktopAfternicListingObservation,
) -> Result<bool> {
    o.validate()?;
    if o.domain != r.domain {
        return Err(BusinessDatabaseError::InvalidInput);
    }
    c.query_row("SELECT EXISTS(SELECT 1 FROM domain_asset_provider_bindings b JOIN marketplace_listing_observations m ON m.workspace_id=b.workspace_id AND m.entity_id=b.entity_id AND m.binding_connection_id=b.connection_id AND m.binding_resource_digest=b.resource_binding_digest AND m.binding_generation=b.binding_generation AND m.provider_version_token=b.observation_digest JOIN afternic_listing_details d ON d.workspace_id=m.workspace_id AND d.listing_observation_id=m.listing_observation_id WHERE b.workspace_id=?1 AND b.entity_id=?2 AND b.connection_id=?3 AND b.resource_kind='listing' AND b.binding_generation=?4 AND b.validation_status IN ('verified','unverified') AND (?5 IS NULL OR b.resource_binding_digest=?5) AND d.provider_created_at=?6)",params![workspace,r.domain,r.connection_id,integer(r.credential_generation)?,r.binding_digest,o.created_at],|row|row.get(0)).map_err(storage)
}
fn record_observation(
    c: &Connection,
    workspace: &str,
    r: &ReviewFrozen,
    o: &DesktopAfternicListingObservation,
    at: &str,
) -> Result<String> {
    let run = afternic::random_id()?;
    c.execute("INSERT INTO provider_observation_runs(workspace_id,observation_run_id,connection_id,observation_capability,started_at,status,connector_version) VALUES(?1,?2,?3,'marketplace',?4,'running',?5)",params![workspace,run,r.connection_id,at,REVIEW_ADAPTER]).map_err(storage)?;
    let id = afternic::record_listing_observation(
        c,
        workspace,
        &r.connection_id,
        r.credential_generation,
        o,
        &run,
        0,
        at,
    )?;
    c.execute("UPDATE provider_observation_runs SET status='succeeded',completed_at=?3 WHERE workspace_id=?1 AND observation_run_id=?2",params![workspace,run,at]).map_err(storage)?;
    Ok(id)
}
fn finish_operation(
    c: &Connection,
    workspace: &str,
    seed: &AfternicListingPlanWorkSeed,
    at: &str,
) -> Result<()> {
    let(pending,failed):(i64,i64)=c.query_row("SELECT coalesce(sum(effective_status IN ('queued','running','outcome_unknown')),0),coalesce(sum(effective_status='failed_final'),0) FROM afternic_listing_write_effective_attempts WHERE workspace_id=?1 AND operation_id=?2",params![workspace,seed.operation_id],|r|Ok((r.get(0)?,r.get(1)?))).map_err(storage)?;
    let seq = write::next_sequence(c, at)?;
    if pending == 0 {
        c.execute("UPDATE operations SET phase=?3,completed_at=?4,local_commit_sequence=?5 WHERE workspace_id=?1 AND operation_id=?2",params![workspace,seed.operation_id,if failed==0{"completed"}else{"partially_failed"},at,seq]).map_err(storage)?;
        c.execute("UPDATE operation_plans SET phase='completed',local_commit_sequence=?3 WHERE workspace_id=?1 AND plan_id=?2",params![workspace,seed.plan_id,seq]).map_err(storage)?;
    }
    Ok(())
}
#[expect(
    clippy::too_many_arguments,
    reason = "one owned observation and its signed audit commit atomically"
)]
fn review_result(
    c: &Connection,
    workspace: &str,
    seed: &AfternicListingPlanWorkSeed,
    outcome: &str,
    reason: Option<&str>,
    o: Option<&DesktopAfternicListingObservation>,
    retry: Option<u32>,
    e: &ExecutionEvidenceContext,
    signer: &mut EvidenceSigner<'_>,
) -> Result<()> {
    let Frozen::Review(r) = &seed.frozen.stored else {
        return Err(stale());
    };
    let at = &e.occurred_at;
    let preflight = seed.kind == DesktopAfternicListingWriteWorkKind::Preflight;
    let observation = o
        .map(|o| record_observation(c, workspace, r, o, at))
        .transpose()?;
    let audit = execution_evidence::record_listing_plan_observation(
        c,
        e,
        &seed.evidence_fence,
        &seed.operation_id,
        &seed.item_id,
        outcome,
        reason,
        preflight,
        signer,
    )?;
    let terminal = matches!(outcome, "confirmed" | "satisfied" | "conflict" | "refused");
    let next = if terminal {
        None
    } else {
        Some(write::plus_seconds(c, at, retry.unwrap_or(30).max(30))?)
    };
    let table = if preflight {
        "afternic_ownership_review_preflights"
    } else {
        "afternic_ownership_review_reconciliations"
    };
    c.execute(&format!("INSERT INTO {table}(workspace_id,operation_id,plan_id,item_id,attempt_number,sequence,outcome,reason,observed_at,next_read_at,listing_observation_id,audit_event_id) VALUES(?1,?2,?3,?4,1,(SELECT count(*)+1 FROM {table} WHERE workspace_id=?1 AND operation_id=?2 AND item_id=?4),?5,?6,?7,?8,?9,?10)"),params![workspace,seed.operation_id,seed.plan_id,seed.item_id,outcome,reason,at,next,observation,audit]).map_err(storage)?;
    let status:String=c.query_row("SELECT status FROM operation_attempts WHERE workspace_id=?1 AND operation_id=?2 AND item_id=?3",params![workspace,seed.operation_id,seed.item_id],|r|r.get(0)).map_err(storage)?;
    let target = match (status.as_str(), outcome) {
        ("queued", "satisfied") | ("running", "confirmed") => Some("succeeded"),
        ("queued", "refused") => Some("failed_final"),
        ("running", _) => Some("outcome_unknown"),
        _ => None,
    };
    if let Some(target) = target {
        c.execute("UPDATE operation_attempts SET status=?4,started_at=coalesce(started_at,?5),completed_at=?5,error_code=?6 WHERE workspace_id=?1 AND operation_id=?2 AND item_id=?3",params![workspace,seed.operation_id,seed.item_id,target,at,reason]).map_err(storage)?;
        c.execute("INSERT INTO operation_results(workspace_id,operation_id,plan_id,item_id,attempt_number,result_version,outcome,result_json,observed_at) VALUES(?1,?2,?3,?4,1,(SELECT count(*)+1 FROM operation_results WHERE workspace_id=?1 AND operation_id=?2 AND item_id=?4),?5,?6,?7)",params![workspace,seed.operation_id,seed.plan_id,seed.item_id,target,encode(&serde_json::json!({"action":"reactivate_ownership_review","outcome":outcome}))?,at]).map_err(storage)?;
    }
    finish_operation(c, workspace, seed, at)
}
impl BusinessDatabase {
    #[expect(
        clippy::too_many_lines,
        reason = "the fresh observation, independent signed claim and attempt edge commit atomically"
    )]
    pub(crate) fn claim_afternic_listing_plan_with_evidence<G: FnOnce() -> Result<()>>(
        &mut self,
        seed: &AfternicListingPlanWorkSeed,
        o: Option<&DesktopAfternicListingObservation>,
        at: &str,
        e: &ExecutionEvidenceContext,
        signer: &mut EvidenceSigner<'_>,
        guard: G,
    ) -> Result<bool> {
        if e.workspace_id != self.workspace_id
            || seed.kind != DesktopAfternicListingWriteWorkKind::Preflight
        {
            return Err(stale());
        }
        let (connection, incarnation, generation) = identity(&seed.frozen.stored);
        require_not_controlled(
            self.store.raw_connection(),
            &self.workspace_id,
            connection,
            incarnation,
            generation,
        )?;
        if matches!(seed.frozen.stored, Frozen::Write(_)) {
            return self.claim_afternic_listing_write_with_evidence(
                &base_seed(seed)?,
                o,
                at,
                e,
                signer,
                guard,
            );
        }
        let Frozen::Review(r) = &seed.frozen.stored else {
            return Err(stale());
        };
        let tx = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(storage)?;
        check_work(&tx, &self.workspace_id, seed)?;
        let current = locally_current(&tx, &self.workspace_id, &seed.frozen.stored)?;
        let compatible = if current {
            o.map(|o| review_compatible(&tx, &self.workspace_id, r, o))
                .transpose()?
                .unwrap_or(true)
        } else {
            false
        };
        let blocker = afternic_ownership_review::blocker(&tx, e, &r.domain)?;
        let refusal = if !current {
            Some("connection_changed")
        } else if !compatible {
            Some("precondition_changed")
        } else if o.is_none() {
            Some("listing_absent")
        } else if !matches!(
            o.map(|o| o.status.as_str()),
            Some("OWNERSHIP_REVIEW" | "ACTIVE" | "HIDDEN")
        ) {
            Some("provider_state_blocked")
        } else if o.is_some_and(|o| o.status == "OWNERSHIP_REVIEW") {
            blocker
        } else {
            None
        };
        if let Some(reason) = refusal {
            review_result(
                &tx,
                &self.workspace_id,
                seed,
                "refused",
                Some(reason),
                if compatible { o } else { None },
                None,
                e,
                signer,
            )?;
            guard()?;
            tx.commit().map_err(storage)?;
            return Ok(false);
        }
        let observed = o.ok_or_else(stale)?;
        if observed.status == "ACTIVE"
            || (observed.status == "HIDDEN" && observed.hidden == Some(true))
        {
            review_result(
                &tx,
                &self.workspace_id,
                seed,
                "satisfied",
                None,
                Some(observed),
                None,
                e,
                signer,
            )?;
            guard()?;
            tx.commit().map_err(storage)?;
            return Ok(false);
        }
        if observed.status != "OWNERSHIP_REVIEW" {
            review_result(
                &tx,
                &self.workspace_id,
                seed,
                "refused",
                Some("provider_state_blocked"),
                Some(observed),
                None,
                e,
                signer,
            )?;
            guard()?;
            tx.commit().map_err(storage)?;
            return Ok(false);
        }
        let observation = record_observation(&tx, &self.workspace_id, r, observed, &e.occurred_at)?;
        let(binding,observation_digest,binding_generation):(String,String,i64)=tx.query_row("SELECT binding_resource_digest,provider_version_token,binding_generation FROM marketplace_listing_observations WHERE workspace_id=?1 AND listing_observation_id=?2",params![self.workspace_id,observation],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).map_err(storage)?;
        execution_evidence::record_listing_plan_claim(
            &tx,
            e,
            &seed.operation_id,
            &seed.item_id,
            &seed.request_digest,
            Some(&OwnershipClaimDigests {
                resource_binding: binding.clone(),
                preflight_observation: observation_digest.clone(),
            }),
            signer,
        )?;
        tx.execute("INSERT INTO afternic_ownership_review_claims(workspace_id,operation_id,plan_id,item_id,attempt_number,attempt_id,domain,connection_id,resource_binding_digest,binding_generation,resource_binding_evidence_digest,preflight_observation_evidence_digest,listing_observation_id,preflight_observation_digest,preflight_observed_at,claimed_at,retry_not_before,execution_fact_id,audit_event_id) SELECT workspace_id,operation_id,?3,item_id,1,attempt_id,?4,?5,?6,?7,?8,?9,?10,?11,?12,?12,strftime('%Y-%m-%dT%H:%M:%SZ',?12,'+86400 seconds'),execution_fact_id,audit_event_id FROM device_execution_fact_outbox WHERE workspace_id=?1 AND operation_id=?2 AND item_id=?13",params![self.workspace_id,seed.operation_id,seed.plan_id,r.domain,r.connection_id,binding,binding_generation,execution_evidence::hex_to_digest(&binding)?,execution_evidence::hex_to_digest(&observation_digest)?,observation,observation_digest,e.occurred_at,seed.item_id]).map_err(storage)?;
        let changed=tx.execute("UPDATE operation_attempts SET status='running',started_at=?4 WHERE workspace_id=?1 AND operation_id=?2 AND item_id=?3 AND status='queued'",params![self.workspace_id,seed.operation_id,seed.item_id,e.occurred_at]).map_err(storage)?;
        if changed != 1 {
            return Err(stale());
        }
        write::next_sequence(&tx, &e.occurred_at)?;
        guard()?;
        tx.commit().map_err(storage)?;
        Ok(true)
    }
    pub(crate) fn reconcile_afternic_listing_plan_with_evidence<G: FnOnce() -> Result<()>>(
        &mut self,
        seed: &AfternicListingPlanWorkSeed,
        o: Option<&DesktopAfternicListingObservation>,
        at: &str,
        e: &ExecutionEvidenceContext,
        signer: &mut EvidenceSigner<'_>,
        guard: G,
    ) -> Result<()> {
        if e.workspace_id != self.workspace_id
            || seed.kind != DesktopAfternicListingWriteWorkKind::Reconcile
        {
            return Err(stale());
        }
        if matches!(seed.frozen.stored, Frozen::Write(_)) {
            return self.reconcile_afternic_listing_write_with_evidence(
                &base_seed(seed)?,
                o,
                at,
                e,
                signer,
                guard,
            );
        }
        let Frozen::Review(r) = &seed.frozen.stored else {
            return Err(stale());
        };
        let tx = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(storage)?;
        check_work(&tx, &self.workspace_id, seed)?;
        let current = locally_current(&tx, &self.workspace_id, &seed.frozen.stored)?;
        let compatible = if current {
            o.map(|o| review_compatible(&tx, &self.workspace_id, r, o))
                .transpose()?
                .unwrap_or(true)
        } else {
            false
        };
        let (outcome, reason) = if !current {
            ("conflict", Some("connection_changed"))
        } else if !compatible {
            ("conflict", Some("precondition_changed"))
        } else {
            match o {
                Some(o)
                    if o.status == "ACTIVE" || (o.status == "HIDDEN" && o.hidden == Some(true)) =>
                {
                    ("confirmed", None)
                }
                Some(o) if o.status == "OWNERSHIP_REVIEW" => {
                    ("still_review", Some("postcondition_pending"))
                }
                Some(_) => ("conflict", Some("provider_state_blocked")),
                None => ("conflict", Some("precondition_changed")),
            }
        };
        review_result(
            &tx,
            &self.workspace_id,
            seed,
            outcome,
            reason,
            if compatible { o } else { None },
            None,
            e,
            signer,
        )?;
        guard()?;
        tx.commit().map_err(storage)
    }
    pub(crate) fn defer_afternic_listing_plan_read_with_evidence<G: FnOnce() -> Result<()>>(
        &mut self,
        seed: &AfternicListingPlanWorkSeed,
        retry_after: Option<u32>,
        at: &str,
        e: &ExecutionEvidenceContext,
        signer: &mut EvidenceSigner<'_>,
        guard: G,
    ) -> Result<()> {
        if e.workspace_id != self.workspace_id {
            return Err(stale());
        }
        if matches!(seed.frozen.stored, Frozen::Write(_)) {
            return self.defer_afternic_listing_write_read_with_evidence(
                &base_seed(seed)?,
                retry_after,
                at,
                e,
                signer,
                guard,
            );
        }
        let tx = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(storage)?;
        check_work(&tx, &self.workspace_id, seed)?;
        review_result(
            &tx,
            &self.workspace_id,
            seed,
            "read_failed",
            Some("read_failed"),
            None,
            retry_after,
            e,
            signer,
        )?;
        guard()?;
        tx.commit().map_err(storage)
    }
}

type OwnershipReviewRead = (
    String,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
);
fn read_review(
    c: &Connection,
    workspace: &str,
    plan: &str,
    id: &str,
    r: &ReviewFrozen,
    approved: bool,
) -> Result<DesktopAfternicListingPlanOwnershipReview> {
    let claim:Option<(String,String)>=c.query_row("SELECT claimed_at,retry_not_before FROM afternic_ownership_review_claims WHERE workspace_id=?1 AND plan_id=?2 AND item_id=?3",params![workspace,plan,id],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(storage)?;
    let table = if claim.is_some() {
        "afternic_ownership_review_reconciliations"
    } else {
        "afternic_ownership_review_preflights"
    };
    let result:Option<OwnershipReviewRead>=c.query_row(&format!("SELECT x.outcome,x.reason,x.next_read_at,d.provider_status,m.observed_at FROM {table} x LEFT JOIN marketplace_listing_observations m ON m.workspace_id=x.workspace_id AND m.listing_observation_id=x.listing_observation_id LEFT JOIN afternic_listing_details d ON d.workspace_id=m.workspace_id AND d.listing_observation_id=m.listing_observation_id WHERE x.workspace_id=?1 AND x.plan_id=?2 AND x.item_id=?3 ORDER BY x.sequence DESC LIMIT 1"),params![workspace,plan,id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?))).optional().map_err(storage)?;
    let (state, reason, retry, latest) = if let Some((outcome, reason, retry, status, observed)) =
        result
    {
        let state = match outcome.as_str() {
            "confirmed" => "confirmed",
            "satisfied" => "not_required",
            "still_review" => "pending_provider",
            "conflict" | "refused" => "conflict",
            "read_failed" if claim.is_some() => "reconciling",
            "read_failed" => "queued",
            _ => return Err(stale()),
        };
        let latest = match (status, observed) {
            (Some(provider_status), Some(observed_at)) => {
                Some(DesktopAfternicListingPlanOwnershipReviewObserved {
                    provider_status,
                    observed_at,
                })
            }
            (None, None) => None,
            _ => return Err(stale()),
        };
        (state, reason, retry, latest)
    } else if !approved {
        ("preview", None, None, None)
    } else if claim.is_some() {
        ("reconciling", None, None, None)
    } else {
        let parent_ready=match &r.parent_item_id{None=>true,Some(parent)=>c.query_row("SELECT EXISTS(SELECT 1 FROM afternic_listing_write_reconciliations x WHERE x.workspace_id=?1 AND x.plan_id=?2 AND x.item_id=?3 AND x.fields_matched=1 AND x.sequence=(SELECT max(n.sequence) FROM afternic_listing_write_reconciliations n WHERE n.workspace_id=x.workspace_id AND n.operation_id=x.operation_id AND n.item_id=x.item_id))",params![workspace,plan,parent],|r|r.get(0)).map_err(storage)?};
        (
            if parent_ready {
                "queued"
            } else {
                "waiting_parent"
            },
            None,
            None,
            None,
        )
    };
    let (claimed_at, retry_not_before) = claim.map_or((None, None), |(a, b)| (Some(a), Some(b)));
    Ok(DesktopAfternicListingPlanOwnershipReview {
        state: state.into(),
        reason,
        claimed_at,
        retry_at: retry,
        retry_not_before,
        latest,
    })
}
fn terminal(state: &str) -> bool {
    matches!(state, "applied" | "confirmed" | "not_required" | "conflict")
}
fn summary(p: &DesktopAfternicListingPlan) -> Result<DesktopAfternicListingPlanCurrentSummary> {
    let mut s = DesktopAfternicListingPlanCurrentSummary {
        schema_version: 2,
        plan_ref: p.plan_ref.clone(),
        action: p.action,
        connection_label: p.connection_label.clone(),
        created_at: p.created_at.clone(),
        state: p.state.clone(),
        total: u32::try_from(p.items.len()).map_err(|_| stale())?,
        applied: 0,
        conflicts: 0,
        pending: 0,
        pending_provider: 0,
        pending_verification: 0,
        ownership_review_total: 0,
        ownership_review_pending: 0,
        ownership_review_confirmed: 0,
        ownership_review_not_required: 0,
        ownership_review_conflicts: 0,
    };
    for i in &p.items {
        let state = i
            .listing_write
            .as_ref()
            .map(|w| w.state.as_str())
            .or_else(|| i.ownership_review.as_ref().map(|r| r.state.as_str()))
            .unwrap_or("preview");
        match state {
            "applied" | "confirmed" | "not_required" => s.applied += 1,
            "conflict" => s.conflicts += 1,
            _ => s.pending += 1,
        }
        if state == "pending_provider" {
            s.pending_provider += 1;
        }
        if state == "pending_verification" {
            s.pending_verification += 1;
        }
        if let Some(r) = &i.ownership_review {
            s.ownership_review_total += 1;
            match r.state.as_str() {
                "confirmed" => s.ownership_review_confirmed += 1,
                "not_required" => s.ownership_review_not_required += 1,
                "conflict" => s.ownership_review_conflicts += 1,
                _ => s.ownership_review_pending += 1,
            }
        }
    }
    Ok(s)
}
impl BusinessDatabase {
    pub(crate) fn afternic_listing_plan(
        &self,
        plan: &str,
        at: &str,
    ) -> Result<DesktopAfternicListingPlan> {
        if !is_uuid_v4(plan) {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        timestamp(at)?;
        let c = self.store.raw_connection();
        let stored = validate_plan(c, &self.workspace_id, plan)?;
        let(hash,phase,created,expires,approved):(String,String,String,String,Option<String>)=c.query_row("SELECT plan_hash,phase,created_at,expires_at,approved_at FROM operation_plans WHERE workspace_id=?1 AND plan_id=?2",params![self.workspace_id,plan],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?))).map_err(storage)?;
        let label:String=c.query_row("SELECT display_label FROM local_provider_connections WHERE workspace_id=?1 AND connection_id=?2",params![self.workspace_id,stored[0].frozen.connection()],|r|r.get(0)).map_err(storage)?;
        let action = stored[0].frozen.action();
        let mut output = BTreeMap::new();
        for item in stored {
            let row = output
                .entry(item.frozen.domain().to_owned())
                .or_insert_with(|| DesktopAfternicListingPlanItem {
                    domain: item.frozen.domain().into(),
                    listing_write: None,
                    ownership_review: None,
                });
            match item.frozen {
                Frozen::Write(w) => {
                    let v = write::read_item(
                        c,
                        &self.workspace_id,
                        plan,
                        &item.id,
                        w,
                        approved.is_some(),
                    )?;
                    row.listing_write = Some(DesktopAfternicListingPlanWrite {
                        before: v.before,
                        changes: v.changes,
                        latest: v.latest,
                        fields_matched: v.fields_matched,
                        state: v.state,
                        reason: v.reason,
                        retry_at: v.retry_at,
                    });
                }
                Frozen::Review(r) => {
                    row.ownership_review = Some(read_review(
                        c,
                        &self.workspace_id,
                        plan,
                        &item.id,
                        &r,
                        approved.is_some(),
                    )?);
                }
            }
        }
        let output: Vec<_> = output.into_values().collect();
        let states = output.iter().flat_map(|i| {
            i.listing_write
                .as_ref()
                .map(|w| w.state.as_str())
                .into_iter()
                .chain(i.ownership_review.as_ref().map(|r| r.state.as_str()))
        });
        let pending = states.clone().any(|s| !terminal(s));
        let conflict = states.clone().any(|s| s == "conflict");
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
            return Err(stale());
        }
        Ok(DesktopAfternicListingPlan {
            schema_version: 2,
            plan_ref: plan.into(),
            plan_hash: hash,
            action,
            connection_label: label,
            created_at: created,
            expires_at: expires,
            approved_at: approved,
            state: state.into(),
            items: output,
        })
    }
    pub(crate) fn afternic_listing_plan_status(
        &self,
        selected: Option<&str>,
        at: &str,
    ) -> Result<DesktopAfternicListingPlanStatus> {
        timestamp(at)?;
        let c = self.store.raw_connection();
        let mut q=c.prepare("SELECT p.plan_id,(SELECT json_extract(i.precondition_json,'$.schemaVersion') FROM operation_plan_items i WHERE i.workspace_id=p.workspace_id AND i.plan_id=p.plan_id ORDER BY i.ordinal LIMIT 1) FROM operation_plans p WHERE p.workspace_id=?1 AND p.operation_kind='afternic_listing_write' ORDER BY p.created_at DESC,p.plan_id DESC LIMIT 50").map_err(storage)?;
        let ids = q
            .query_map([&self.workspace_id], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, u8>(1)?))
            })
            .map_err(storage)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(storage)?;
        let legacy = self.afternic_listing_write_status(None, at)?;
        let mut plans = Vec::new();
        for (id, version) in ids {
            match version {
                2 => plans.push(DesktopAfternicListingPlanSummary::Current(summary(
                    &self.afternic_listing_plan(&id, at)?,
                )?)),
                1 => {
                    let s = legacy
                        .plans
                        .iter()
                        .find(|p| p.plan_ref == id)
                        .ok_or_else(stale)?;
                    plans.push(DesktopAfternicListingPlanSummary::Legacy {
                        schema_version: 1,
                        summary: s.clone(),
                    });
                }
                _ => return Err(stale()),
            }
        }
        let detail=selected.map(|id|{let version:u8=c.query_row("SELECT json_extract(precondition_json,'$.schemaVersion') FROM operation_plan_items WHERE workspace_id=?1 AND plan_id=?2 ORDER BY ordinal LIMIT 1",params![self.workspace_id,id],|r|r.get(0)).map_err(storage)?;match version{1=>self.afternic_listing_write_plan(id,at).map(DesktopAfternicListingPlanDetail::Legacy),2=>self.afternic_listing_plan(id,at).map(DesktopAfternicListingPlanDetail::Current),_=>Err(stale())}}).transpose()?;
        Ok(DesktopAfternicListingPlanStatus {
            schema_version: 2,
            controlled_acceptance: None,
            write_qualified: false,
            write_entitled: false,
            execution_available: false,
            ownership_review_qualified: false,
            ownership_review_execution_available: false,
            plans,
            detail,
        })
    }
}
