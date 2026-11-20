//! Freeze positive Standard evidence from the current Atom account before any removal.
use super::{
    BusinessDatabase, BusinessDatabaseError,
    afternic::random_id,
    atom_marketplace::listing_observation_digest,
    execution_evidence::{
        self, ApprovalTarget, EvidenceSigner, ExecutionEvidenceContext,
        marketplace_approval::{self, ApprovalPurpose},
        require_no_barrier,
    },
    hex_digest, is_uuid_v4, validate_domain_asset_id, validate_sha256_hex, validate_timestamp,
};
use crate::DesktopAtomListingState;
use crate::active_workspace::capability_qualification::ATOM_MARKETPLACE_WRITE;
use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

#[path = "atom_standard_delist_execution.rs"]
mod execution;
pub(crate) use execution::AtomStandardDelistWorkSeed;
#[path = "atom_standard_delist_read.rs"]
mod read;
pub use read::{DesktopAtomStandardDelistStatus, DesktopAtomStandardDelistStatusRequest};

const KIND: &str = "atom_standard_delist";
const ACTION: &str = "remove_standard";
const MAX_TARGETS: usize = 500;
type Result<T> = std::result::Result<T, BusinessDatabaseError>;

/// Native-only account observation from the exact domain-details response.
pub struct DesktopAtomListingObservation {
    pub domain: String,
    pub resource_digest: String,
    pub state: DesktopAtomListingState,
    pub reported_standard: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DesktopAtomStandardDelistPreviewRequest {
    pub schema_version: u8,
    pub connection_id: String,
    pub domains: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopAtomStandardDelistPreview {
    pub schema_version: u8,
    pub connection_id: String,
    pub plan_id: String,
    pub plan_hash: String,
    pub expires_at: String,
    pub domains: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DesktopAtomStandardDelistApproveRequest {
    pub schema_version: u8,
    pub plan_id: String,
    pub plan_hash: String,
}

#[derive(PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FrozenListing {
    item_id: String,
    domain: String,
    connection_id: String,
    connection_incarnation_id: String,
    scan_id: String,
    observation_id: String,
    observation_digest: String,
    resource_binding_digest: String,
    asset_generation: u64,
    binding_generation: u64,
}

impl FrozenListing {
    fn validate(&self) -> Result<()> {
        let rejected = BusinessDatabaseError::StorageRejected;
        validate_domain_asset_id(&self.domain).map_err(|_| rejected)?;
        for id in [
            &self.item_id,
            &self.connection_id,
            &self.connection_incarnation_id,
            &self.scan_id,
            &self.observation_id,
        ] {
            if !is_uuid_v4(id) {
                return Err(rejected);
            }
        }
        for digest in [&self.observation_digest, &self.resource_binding_digest] {
            validate_sha256_hex(digest).map_err(|_| rejected)?;
        }
        if [self.asset_generation, self.binding_generation]
            .into_iter()
            .any(|generation| !(1..=9_007_199_254_740_991).contains(&generation))
        {
            return Err(rejected);
        }
        Ok(())
    }
}

fn hash_plan(
    workspace: &str,
    id: &str,
    at: &str,
    expires: &str,
    targets: &[FrozenListing],
) -> Result<String> {
    let bytes = serde_json::to_vec(&(KIND, 1, workspace, id, at, expires, targets))
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    Ok(hex_digest(&bytes))
}

struct StoredPlan {
    hash: String,
    expires_at: String,
    phase: String,
    targets: Vec<FrozenListing>,
}

fn read_plan(db: &Connection, workspace: &str, id: &str) -> Result<StoredPlan> {
    let bad = BusinessDatabaseError::StorageRejected;
    if !is_uuid_v4(id) {
        return Err(bad);
    }
    let (hash, at, expires, count, phase): (String, String, String, i64, String) = db
        .query_row(
            "SELECT plan_hash,created_at,expires_at,item_count,phase FROM operation_plans
         WHERE workspace_id=?1 AND plan_id=?2 AND operation_kind=?3 AND risk_level='standard'",
            params![workspace, id, KIND],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )
        .optional()
        .map_err(storage)?
        .ok_or(BusinessDatabaseError::MutationStale)?;
    let count = usize::try_from(count).map_err(|_| bad)?;
    if !(1..=MAX_TARGETS).contains(&count) {
        return Err(bad);
    }
    validate_timestamp(Some(at.clone())).map_err(|_| bad)?;
    validate_timestamp(Some(expires.clone())).map_err(|_| bad)?;
    let mut stmt=db.prepare(
        "SELECT item_id,entity_id,connection_id,ordinal,precondition_json,
           capability=?3 AND field_path='listing' AND risk_level='standard'
           AND execution_mode='automatic' AND inclusion_status='included'
           AND old_value_json=json_object('listingType','standard') AND new_value_json=json_object('action',?5)
         FROM operation_plan_items WHERE workspace_id=?1 AND plan_id=?2 ORDER BY ordinal LIMIT ?4"
    ).map_err(storage)?;
    let limit = i64::try_from(MAX_TARGETS + 1).map_err(|_| bad)?;
    let mut rows = stmt
        .query(params![
            workspace,
            id,
            ATOM_MARKETPLACE_WRITE,
            limit,
            ACTION
        ])
        .map_err(storage)?;
    let mut targets: Vec<FrozenListing> = Vec::with_capacity(count);
    while let Some(row) = rows.next().map_err(storage)? {
        let wire: String = row.get(4).map_err(storage)?;
        if wire.len() > 4096 || !row.get::<_, bool>(5).map_err(storage)? {
            return Err(bad);
        }
        let target: FrozenListing = serde_json::from_str(&wire).map_err(|_| bad)?;
        target.validate()?;
        if row.get::<_, String>(0).map_err(storage)? != target.item_id
            || row.get::<_, String>(1).map_err(storage)? != target.domain
            || row.get::<_, String>(2).map_err(storage)? != target.connection_id
            || row.get::<_, i64>(3).map_err(storage)?
                != i64::try_from(targets.len()).map_err(|_| bad)?
            || targets.last().is_some_and(|prior| {
                prior.domain >= target.domain || prior.connection_id != target.connection_id
            })
        {
            return Err(bad);
        }
        targets.push(target);
    }
    if targets.len() != count || hash_plan(workspace, id, &at, &expires, &targets)? != hash {
        return Err(bad);
    }
    Ok(StoredPlan {
        hash,
        phase,
        expires_at: expires,
        targets,
    })
}

fn read_preview(
    db: &Connection,
    workspace: &str,
    id: &str,
) -> Result<DesktopAtomStandardDelistPreview> {
    let plan = read_plan(db, workspace, id)?;
    if plan.phase != "awaiting_approval" {
        return Err(BusinessDatabaseError::MutationStale);
    }
    Ok(DesktopAtomStandardDelistPreview {
        schema_version: 1,
        connection_id: plan.targets[0].connection_id.clone(),
        plan_id: id.to_owned(),
        plan_hash: plan.hash,
        expires_at: plan.expires_at,
        domains: plan
            .targets
            .into_iter()
            .map(|target| target.domain)
            .collect(),
    })
}

fn storage(_: rusqlite::Error) -> BusinessDatabaseError {
    BusinessDatabaseError::StorageRejected
}

fn freeze_listing(
    db: &Connection,
    workspace: &str,
    connection: &str,
    domain: &str,
    at: &str,
    item_id: String,
) -> Result<FrozenListing> {
    let (incarnation, scan, observation, digest, resource, asset_generation, binding_generation) = db.query_row(
        "SELECT c.incarnation_id,s.scan_id,m.listing_observation_id,m.provider_version_token,
         m.binding_resource_digest,m.atom_standard_asset_generation,m.binding_generation
         FROM atom_marketplace_connections c JOIN atom_marketplace_scans s USING(workspace_id,connection_id)
         JOIN marketplace_listing_observations m ON m.workspace_id=s.workspace_id AND m.observation_run_id=s.observation_run_id
           AND m.binding_connection_id=s.connection_id
         JOIN domain_assets a ON a.workspace_id=m.workspace_id AND a.entity_id=m.entity_id AND a.entity_generation=m.atom_standard_asset_generation
         JOIN domain_asset_provider_bindings b ON b.workspace_id=m.workspace_id AND b.entity_id=m.entity_id
           AND b.connection_id=s.connection_id AND b.resource_kind='listing' AND b.provider_kind='atom'
           AND b.resource_binding_digest=m.binding_resource_digest AND b.binding_generation=m.binding_generation
           AND b.observation_digest=m.provider_version_token
         WHERE c.workspace_id=?1 AND c.connection_id=?2 AND m.entity_id=?3
          AND c.state='active' AND c.purged_at IS NULL
          AND s.scan_id=(SELECT scan_id FROM atom_marketplace_scans latest
            WHERE latest.workspace_id=c.workspace_id AND latest.connection_id=c.connection_id ORDER BY latest.rowid DESC LIMIT 1)
          AND s.standard_observed_count>0 AND s.completed_at<=?4
          AND m.marketplace_kind='atom' AND m.confirmed=1 AND m.observation_availability='available'
          AND m.evidence_status='confirmed' AND m.observed_at<=?4
          AND a.lifecycle_status='active' AND a.deleted_at IS NULL AND b.validation_status IN ('verified','unverified')
          AND NOT EXISTS(SELECT 1 FROM sync_domain_asset_provisional_re_adds r
            WHERE r.workspace_id=a.workspace_id AND r.entity_id=a.entity_id)
          AND NOT EXISTS(SELECT 1 FROM storage_repair_receipts x WHERE x.workspace_id=m.workspace_id
             AND x.repair_kind='listing_observation' AND x.row_key=m.listing_observation_id)",
        params![workspace,connection,domain,at], |r| Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,
          r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,String>(4)?,r.get::<_,i64>(5)?,r.get::<_,i64>(6)?)),
    ).optional().map_err(storage)?.ok_or(BusinessDatabaseError::MutationStale)?;

    let rejected = BusinessDatabaseError::StorageRejected;
    if [&incarnation, &scan, &observation]
        .into_iter()
        .any(|id| !is_uuid_v4(id))
        || [asset_generation, binding_generation]
            .into_iter()
            .any(|generation| !(1..=9_007_199_254_740_991).contains(&generation))
    {
        return Err(rejected);
    }
    validate_sha256_hex(&digest).map_err(|_| rejected)?;
    validate_sha256_hex(&resource).map_err(|_| rejected)?;
    if digest
        != listing_observation_digest(&resource, domain, DesktopAtomListingState::SellerApproved)?
    {
        return Err(BusinessDatabaseError::MutationStale);
    }
    Ok(FrozenListing {
        item_id,
        domain: domain.to_owned(),
        connection_id: connection.to_owned(),
        connection_incarnation_id: incarnation,
        scan_id: scan,
        observation_id: observation,
        observation_digest: digest,
        resource_binding_digest: resource,
        asset_generation: u64::try_from(asset_generation).map_err(|_| rejected)?,
        binding_generation: u64::try_from(binding_generation).map_err(|_| rejected)?,
    })
}

fn request_digest(target: &FrozenListing) -> Result<String> {
    let bytes = serde_json::to_vec(&("GOODDEALER-ATOM-STANDARD-DELIST-REQUEST-V1", target))
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    Ok(hex_digest(&bytes))
}

fn next_sequence(tx: &Connection, at: &str) -> Result<i64> {
    tx.query_row(
        "UPDATE active_workspace_metadata SET local_commit_sequence=local_commit_sequence+1,updated_at=?1
         WHERE singleton=1 RETURNING local_commit_sequence",
        [at],
        |row| row.get(0),
    ).map_err(storage)
}

fn has_open_attempt(
    tx: &Connection,
    context: &ExecutionEvidenceContext,
    target: &FrozenListing,
) -> Result<bool> {
    tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM operation_attempts a
         JOIN operation_plan_items i USING(workspace_id,plan_id,item_id)
         JOIN operation_plans p USING(workspace_id,plan_id)
         LEFT JOIN afternic_listing_approvals b USING(workspace_id,operation_id,plan_id)
         WHERE i.workspace_id=?1 AND i.connection_id=?2 AND i.entity_id=?3 AND p.operation_kind=?4
          AND (a.status IN ('running','outcome_unknown','waiting_remote','manual_action_required','failed_retryable')
           OR (a.status='queued' AND (b.action IS NOT ?5 OR (
              b.source_device_id=?6 AND b.active_lease_epoch=?7 AND b.source_installation_digest=?8
              AND b.credential_epoch=?9 AND b.signing_key_id=?10 AND b.signing_key_version=?11)))))",
        params![context.workspace_id,target.connection_id,target.domain,KIND,ACTION,context.source_device_id,
          execution_evidence::sql(context.active_lease_epoch)?,context.source_installation_digest,
          execution_evidence::sql(context.credential_epoch)?,context.signing_key_id,execution_evidence::sql(context.signing_key_version)?],
        |row| row.get(0),
    ).map_err(storage)
}

impl BusinessDatabase {
    pub(crate) fn preview_atom_standard_delist<G>(
        &mut self,
        request: &DesktopAtomStandardDelistPreviewRequest,
        at: &str,
        trusted_at: &str,
        guard: impl FnOnce() -> Result<G>,
    ) -> Result<DesktopAtomStandardDelistPreview> {
        let bad = BusinessDatabaseError::InvalidInput;
        if request.schema_version != 1
            || !is_uuid_v4(&request.connection_id)
            || !(1..=MAX_TARGETS).contains(&request.domains.len())
        {
            return Err(bad);
        }
        validate_timestamp(Some(at.to_owned())).map_err(|_| bad)?;
        validate_timestamp(Some(trusted_at.to_owned())).map_err(|_| bad)?;
        let mut domains = BTreeSet::new();
        for domain in &request.domains {
            validate_domain_asset_id(domain).map_err(|_| bad)?;
            if !domains.insert(domain.as_str()) {
                return Err(bad);
            }
        }
        let workspace = &self.workspace_id;
        let tx = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(storage)?;
        require_no_barrier(&tx, workspace)?;
        let listings = domains
            .into_iter()
            .map(|domain| {
                freeze_listing(
                    &tx,
                    workspace,
                    &request.connection_id,
                    domain,
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
        validate_timestamp(Some(expires_at.clone()))
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let plan_id = random_id()?;
        let plan_hash = hash_plan(workspace, &plan_id, at, &expires_at, &listings)?;
        let sequence = next_sequence(&tx, at)?;
        let count = i64::try_from(listings.len()).map_err(|_| bad)?;
        tx.execute(
            "INSERT INTO operation_plans(workspace_id,plan_id,operation_kind,plan_hash,title,phase,risk_level,item_count,
              created_at,expires_at,local_commit_sequence)
             VALUES(?1,?2,?3,?4,'Atom Standard delisting','awaiting_approval','standard',?5,?6,?7,?8)",
            params![workspace,plan_id,KIND,plan_hash,count,at,expires_at,sequence],
        ).map_err(storage)?;
        for (ordinal, target) in listings.iter().enumerate() {
            let frozen = serde_json::to_string(target)
                .map_err(|_| BusinessDatabaseError::StorageRejected)?;
            tx.execute(
                "INSERT INTO operation_plan_items(workspace_id,plan_id,item_id,ordinal,entity_id,connection_id,
                 capability,field_path,old_value_json,new_value_json,precondition_json,risk_level,execution_mode,inclusion_status)
                 VALUES(?1,?2,?3,?4,?5,?6,?7,'listing',
                 json_object('listingType','standard'),json_object('action',?8),?9,'standard','automatic','included')",
                params![workspace,plan_id,target.item_id,i64::try_from(ordinal).map_err(|_| bad)?,
                  target.domain,target.connection_id,ATOM_MARKETPLACE_WRITE,ACTION,frozen],
            ).map_err(storage)?;
        }
        let plan = read_preview(&tx, workspace, &plan_id)?;
        let _guard = guard()?;
        tx.commit().map_err(storage)?;
        Ok(plan)
    }

    pub(crate) fn approve_atom_standard_delist<G>(
        &mut self,
        request: &DesktopAtomStandardDelistApproveRequest,
        at: &str,
        context: &ExecutionEvidenceContext,
        signer: &mut EvidenceSigner<'_>,
        guard: impl FnOnce(Option<&str>) -> Result<G>,
    ) -> Result<String> {
        let bad = BusinessDatabaseError::InvalidInput;
        let stale = BusinessDatabaseError::MutationStale;
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
        require_no_barrier(&tx, workspace)?;
        let id = &request.plan_id;
        let plan = read_plan(&tx, workspace, id)?;
        if plan.hash != request.plan_hash {
            return Err(stale);
        }
        let (operation, deadline) =
            match plan.phase.as_str() {
                "awaiting_approval" => {
                    if plan.expires_at.as_str() <= at || plan.expires_at <= context.occurred_at {
                        return Err(stale);
                    }
                    for target in &plan.targets {
                        let current = freeze_listing(
                            &tx,
                            workspace,
                            &target.connection_id,
                            &target.domain,
                            at,
                            target.item_id.clone(),
                        )?;
                        if current != *target || has_open_attempt(&tx, context, target)? {
                            return Err(stale);
                        }
                    }
                    let operation = persist_approval(&tx, context, at, id, &plan, signer)?;
                    (operation, Some(plan.expires_at.as_str()))
                }
                "executing" | "completed" => {
                    let operation = tx.query_row(
                    "SELECT o.operation_id FROM operations o JOIN afternic_listing_approvals a
                     USING(workspace_id,operation_id,plan_id)
                     WHERE o.workspace_id=?1 AND o.plan_id=?2 AND o.idempotency_key=o.plan_id
                      AND a.action=?3 AND a.plan_hash=?4",
                    params![workspace,id,ACTION,execution_evidence::hex_to_digest(&plan.hash)?],
                    |row| row.get::<_, String>(0),
                ).map_err(storage)?;
                    if !is_uuid_v4(&operation) {
                        return Err(BusinessDatabaseError::StorageRejected);
                    }
                    (operation, None)
                }
                _ => return Err(stale),
            };
        let _guard = guard(deadline)?;
        tx.commit().map_err(storage)?;
        Ok(operation)
    }
}

fn persist_approval(
    tx: &Connection,
    context: &ExecutionEvidenceContext,
    at: &str,
    id: &str,
    plan: &StoredPlan,
    signer: &mut EvidenceSigner<'_>,
) -> Result<String> {
    let workspace = &context.workspace_id;
    let operation = random_id()?;
    let sequence = next_sequence(tx, at)?;
    tx.execute(
        "UPDATE operation_plans SET phase='approved',approved_at=?3,local_commit_sequence=?4
         WHERE workspace_id=?1 AND plan_id=?2",
        params![workspace, id, at, sequence],
    )
    .map_err(storage)?;
    tx.execute(
        "INSERT INTO operations(workspace_id,operation_id,plan_id,idempotency_key,phase,requested_at,local_commit_sequence)
         VALUES(?1,?2,?3,?3,'queued',?4,?5)",
        params![workspace,operation,id,at,sequence],
    ).map_err(storage)?;
    let targets = plan
        .targets
        .iter()
        .map(|target| {
            Ok(ApprovalTarget {
                item_id: target.item_id.clone(),
                request_digest: request_digest(target)?,
            })
        })
        .collect::<Result<Vec<_>>>()?;
    for target in &targets {
        tx.execute(
            "INSERT INTO operation_attempts(workspace_id,operation_id,plan_id,item_id,attempt_number,status,request_digest)
             VALUES(?1,?2,?3,?4,1,'queued',?5)",
            params![workspace,operation,id,target.item_id,target.request_digest],
        ).map_err(storage)?;
    }
    marketplace_approval::record_approval(
        ApprovalPurpose::AtomStandardDelist,
        tx,
        context,
        id,
        &operation,
        &plan.hash,
        &targets,
        signer,
    )?;
    tx.execute(
        "UPDATE operation_plans SET phase='executing' WHERE workspace_id=?1 AND plan_id=?2",
        params![workspace, id],
    )
    .map_err(storage)?;
    tx.execute(
        "UPDATE operations SET phase='running',started_at=?3 WHERE workspace_id=?1 AND operation_id=?2",
        params![workspace,operation,at],
    ).map_err(storage)?;
    Ok(operation)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        DesktopAtomListingFact, DesktopAtomListingState,
        active_workspace::business::{AtomInventoryCommit, LocalDatabaseKey},
    };

    #[test]
    #[expect(
        clippy::too_many_lines,
        reason = "checks independent approval failures against the same durable plan"
    )]
    fn preview_only_freezes_current_positive_standard_inventory() {
        const AT: &str = "2026-11-20T00:00:00Z";
        let dir = crate::test_tempdir::tempdir().unwrap();
        let key = LocalDatabaseKey::from_bytes([0x64; 32]);
        let open = || {
            BusinessDatabase::open(&dir.path().join("workspace.db"), &key, "workspace-local")
                .unwrap()
        };
        let mut db = open();
        let seed = db
            .prepare_atom_connection("Atom", AT, ("device-local", 1), || Ok(()))
            .unwrap();
        let listings = [
            DesktopAtomListingFact {
                domain: "first.test".into(),
                resource_digest: "1".repeat(64),
                state: DesktopAtomListingState::SellerApproved,
                observed_in_standard_scan: true,
            },
            DesktopAtomListingFact {
                domain: "other.test".into(),
                resource_digest: "2".repeat(64),
                state: DesktopAtomListingState::SellerApproved,
                observed_in_standard_scan: false,
            },
        ];
        db.import_atom_inventory(
            &AtomInventoryCommit {
                seed: &seed,
                listings: &listings,
                standard_scan_checked: true,
                device_id: "device-local",
                lease_epoch: 1,
                at: AT,
            },
            || Ok(()),
        )
        .unwrap();
        let mut request = DesktopAtomStandardDelistPreviewRequest {
            schema_version: 1,
            connection_id: seed.connection_id,
            domains: vec!["other.test".into()],
        };
        assert!(matches!(
            db.preview_atom_standard_delist(&request, AT, AT, || Ok(())),
            Err(BusinessDatabaseError::MutationStale)
        ));
        request.domains = vec!["first.test".into()];
        assert!(matches!(
            db.preview_atom_standard_delist(&request, AT, AT, || Err::<(), _>(
                BusinessDatabaseError::MutationStale
            )),
            Err(BusinessDatabaseError::MutationStale)
        ));
        let plan = db
            .preview_atom_standard_delist(&request, AT, AT, || Ok(()))
            .unwrap();
        assert_eq!(plan.domains, request.domains);
        drop(db);
        let db = open();
        let count:i64=db.store.raw_connection().query_row(
            "SELECT count(*) FROM operation_plans WHERE plan_id=?1 AND plan_hash=?2 AND phase='awaiting_approval'",
            params![plan.plan_id,plan.plan_hash],|r|r.get(0),
        ).unwrap();
        assert_eq!(count, 1);
        let reopened =
            read_preview(db.store.raw_connection(), "workspace-local", &plan.plan_id).unwrap();
        assert_eq!(reopened.plan_hash, plan.plan_hash);

        let mut db = db;
        let approve = DesktopAtomStandardDelistApproveRequest {
            schema_version: 1,
            plan_id: plan.plan_id,
            plan_hash: plan.plan_hash,
        };
        let competitor = db
            .preview_atom_standard_delist(&request, AT, AT, || Ok(()))
            .unwrap();
        let (context, mut signer) = execution_evidence::test_context("workspace-local", AT);
        let (foreign, _) = execution_evidence::test_context("other-workspace", AT);
        assert_eq!(
            db.approve_atom_standard_delist(&approve, AT, &foreign, &mut signer, |_| Ok(())),
            Err(BusinessDatabaseError::MutationStale)
        );
        let changed = DesktopAtomStandardDelistApproveRequest {
            schema_version: 1,
            plan_id: approve.plan_id.clone(),
            plan_hash: "f".repeat(64),
        };
        assert_eq!(
            db.approve_atom_standard_delist(&changed, AT, &context, &mut signer, |_| Ok(())),
            Err(BusinessDatabaseError::MutationStale)
        );
        let mut wrong_signer = |purpose, bytes: &[u8]| match purpose {
            execution_evidence::EvidenceSignaturePurpose::AtomStandardDelistApproval => Ok([0; 64]),
            _ => signer(purpose, bytes),
        };
        assert_eq!(
            db.approve_atom_standard_delist(&approve, AT, &context, &mut wrong_signer, |_| Ok(())),
            Err(BusinessDatabaseError::MutationStale)
        );
        assert_eq!(
            db.approve_atom_standard_delist(&approve, AT, &context, &mut signer, |deadline| {
                assert_eq!(deadline, Some("2026-11-20T00:15:00Z"));
                Err::<(), _>(BusinessDatabaseError::MutationStale)
            }),
            Err(BusinessDatabaseError::MutationStale)
        );
        let operation_count = |db: &BusinessDatabase| {
            db.store.raw_connection().query_row(
                "SELECT (SELECT count(*) FROM operations), (SELECT count(*) FROM operation_attempts),
                        (SELECT count(*) FROM workspace_device_audit_outbox)",
                [],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?, row.get::<_, i64>(2)?)),
            ).unwrap()
        };
        assert_eq!(operation_count(&db), (0, 0, 0));
        assert_eq!(
            read_plan(
                db.store.raw_connection(),
                "workspace-local",
                &approve.plan_id
            )
            .unwrap()
            .phase,
            "awaiting_approval"
        );
        let operation = db
            .approve_atom_standard_delist(&approve, AT, &context, &mut signer, |_| Ok(()))
            .unwrap();
        assert!(
            db.store
                .fixture_connection()
                .execute(
                    "UPDATE operation_attempts SET status='running' WHERE operation_id=?1",
                    [&operation],
                )
                .is_err()
        );
        drop(db);
        let mut db = open();
        assert_eq!(
            db.approve_atom_standard_delist(&approve, AT, &context, &mut signer, |deadline| {
                assert!(deadline.is_none());
                Ok(())
            })
            .unwrap(),
            operation
        );
        assert_eq!(operation_count(&db), (1, 1, 1));
        let competitor = DesktopAtomStandardDelistApproveRequest {
            schema_version: 1,
            plan_id: competitor.plan_id,
            plan_hash: competitor.plan_hash,
        };
        assert_eq!(
            db.approve_atom_standard_delist(&competitor, AT, &context, &mut signer, |_| Ok(())),
            Err(BusinessDatabaseError::MutationStale)
        );
        let mut successor = context.clone();
        successor.active_lease_epoch += 1;
        assert!(
            db.next_atom_standard_delist_work(&successor, true)
                .unwrap()
                .is_none()
        );
        let replacement = db
            .approve_atom_standard_delist(&competitor, AT, &successor, &mut signer, |_| Ok(()))
            .unwrap();
        assert_ne!(replacement, operation);
        assert!(
            db.next_atom_standard_delist_work(&successor, true)
                .unwrap()
                .is_some()
        );
    }

    #[test]
    #[expect(
        clippy::too_many_lines,
        reason = "keeps the competing work and evidence across reopen in one scenario"
    )]
    fn one_signed_claim_is_durable_and_reopens_for_observation_only() {
        const AT: &str = "2026-11-20T00:00:00Z";
        let dir = crate::test_tempdir::tempdir().unwrap();
        let key = LocalDatabaseKey::from_bytes([0x65; 32]);
        let open = || {
            BusinessDatabase::open(&dir.path().join("workspace.db"), &key, "workspace-local")
                .unwrap()
        };
        let mut db = open();
        let (context, mut signer) = execution_evidence::test_context("workspace-local", AT);
        let source = (
            context.source_device_id.as_str(),
            context.active_lease_epoch,
        );
        let connection = db
            .prepare_atom_connection("Atom", AT, source, || Ok(()))
            .unwrap();
        let listing = DesktopAtomListingFact {
            domain: "claim.test".into(),
            resource_digest: "a".repeat(64),
            state: DesktopAtomListingState::SellerApproved,
            observed_in_standard_scan: true,
        };
        db.import_atom_inventory(
            &AtomInventoryCommit {
                seed: &connection,
                listings: std::slice::from_ref(&listing),
                standard_scan_checked: true,
                device_id: source.0,
                lease_epoch: source.1,
                at: AT,
            },
            || Ok(()),
        )
        .unwrap();
        let plan = db
            .preview_atom_standard_delist(
                &DesktopAtomStandardDelistPreviewRequest {
                    schema_version: 1,
                    connection_id: connection.connection_id.clone(),
                    domains: vec![listing.domain.clone()],
                },
                AT,
                AT,
                || Ok(()),
            )
            .unwrap();
        let operation = db
            .approve_atom_standard_delist(
                &DesktopAtomStandardDelistApproveRequest {
                    schema_version: 1,
                    plan_id: plan.plan_id.clone(),
                    plan_hash: plan.plan_hash,
                },
                AT,
                &context,
                &mut signer,
                |_| Ok(()),
            )
            .unwrap();
        assert!(
            db.next_atom_standard_delist_work(&context, false)
                .unwrap()
                .is_none()
        );
        let first = db
            .next_atom_standard_delist_work(&context, true)
            .unwrap()
            .unwrap();
        let overlapping = db
            .next_atom_standard_delist_work(&context, true)
            .unwrap()
            .unwrap();
        let mut observed = DesktopAtomListingObservation {
            domain: listing.domain,
            resource_digest: listing.resource_digest,
            state: listing.state,
            reported_standard: false,
        };
        assert_eq!(
            db.claim_atom_standard_delist(&first, &observed, AT, &context, &mut signer, || Ok(())),
            Err(BusinessDatabaseError::MutationStale)
        );
        observed.reported_standard = true;
        assert_eq!(
            db.claim_atom_standard_delist(&first, &observed, AT, &context, &mut signer, || Err::<
                (),
                _,
            >(
                BusinessDatabaseError::MutationStale
            )),
            Err(BusinessDatabaseError::MutationStale)
        );
        let num_facts = |db: &BusinessDatabase| -> i64 {
            db.store
                .raw_connection()
                .query_row(
                    "SELECT count(*) FROM device_execution_fact_outbox",
                    [],
                    |row| row.get(0),
                )
                .unwrap()
        };
        assert_eq!(num_facts(&db), 0);
        db.claim_atom_standard_delist(&first, &observed, AT, &context, &mut signer, || Ok(()))
            .unwrap();
        assert_eq!(num_facts(&db), 1);
        db.recheck_atom_standard_delist_dispatch(&first, AT, &context)
            .unwrap();
        assert_eq!(
            db.claim_atom_standard_delist(
                &overlapping,
                &observed,
                AT,
                &context,
                &mut signer,
                || Ok(())
            ),
            Err(BusinessDatabaseError::MutationStale)
        );
        for sql in [
            "UPDATE operation_attempts SET status='queued',started_at=NULL WHERE operation_id=?1",
            "UPDATE operation_attempts SET status='succeeded',completed_at=started_at WHERE operation_id=?1",
        ] {
            assert!(
                db.store
                    .fixture_connection()
                    .execute(sql, [&operation])
                    .is_err()
            );
        }
        drop(db);
        let mut db = open();
        let mut successor = context.clone();
        successor.source_device_id = "another-active".into();
        successor.active_lease_epoch += 1;
        let recovered = db
            .next_atom_standard_delist_work(&successor, false)
            .unwrap()
            .unwrap();
        assert!(recovered.claimed());
        assert_eq!(
            db.recheck_atom_standard_delist_dispatch(&recovered, AT, &successor),
            Err(BusinessDatabaseError::MutationStale)
        );
        assert_eq!(
            db.recheck_atom_standard_delist_dispatch(&first, AT, &successor),
            Err(BusinessDatabaseError::MutationStale)
        );
        db.recheck_atom_standard_delist_read(&recovered, AT)
            .unwrap();
        db.settle_atom_standard_delist_observation(
            &recovered,
            None,
            AT,
            &successor,
            &mut signer,
            || Ok(()),
        )
        .unwrap();
        assert_eq!(
            db.recheck_atom_standard_delist_dispatch(&first, AT, &context),
            Err(BusinessDatabaseError::MutationStale)
        );
        assert!(
            db.store
                .fixture_connection()
                .execute(
                    "UPDATE operation_attempts SET status='running' WHERE operation_id=?1",
                    [&operation],
                )
                .is_err()
        );
        successor.occurred_at = "2026-11-20T00:05:00Z".into();
        let retried = db
            .next_atom_standard_delist_work(&successor, false)
            .unwrap()
            .unwrap();
        db.settle_atom_standard_delist_observation(
            &retried,
            None,
            &successor.occurred_at,
            &successor,
            &mut signer,
            || Ok(()),
        )
        .unwrap();
        let status = db
            .read_atom_standard_delist_status(
                &DesktopAtomStandardDelistStatusRequest {
                    schema_version: 1,
                    plan_id: Some(plan.plan_id),
                },
                AT,
                false,
            )
            .unwrap();
        let redacted = serde_json::to_value(status).unwrap();
        assert_eq!(redacted["plan"]["items"][0]["state"], "outcome_unknown");
        assert_eq!(redacted["plan"]["items"][0]["reason"], "read_failed");
        assert_eq!(num_facts(&db), 1);
        let (results, detached) = db.store.raw_connection().query_row(
            "SELECT (SELECT count(*) FROM operation_results),
                    (SELECT count(*) FROM domain_asset_provider_bindings WHERE validation_status='detached')",
            [], |row| Ok((row.get::<_, i64>(0)?,row.get::<_, i64>(1)?)),
        ).unwrap();
        assert_eq!((results, detached), (1, 0));
        let active = db.atom_connection(&connection.connection_id).unwrap();
        db.revoke_atom_connection(&active, AT, || Ok(())).unwrap();
        assert_eq!(
            db.recheck_atom_standard_delist_read(&retried, &successor.occurred_at),
            Err(BusinessDatabaseError::MutationStale)
        );
    }
}
