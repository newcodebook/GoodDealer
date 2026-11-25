//! Purpose-specific signed evidence for marketplace writes with one dispatch claim.
use super::{
    ApprovalEnvelope, ApprovalTarget, EvidenceSignaturePurpose, EvidenceSigner,
    ExecutionEvidenceContext, FACT_DOMAIN, MAX_SEQUENCE, Result, URL_SAFE_NO_PAD, advance, audit,
    digest, encoded, evidence_transcript, head, hex_to_digest, random_id, rejected, sign, sql,
    storage, validate_context, verify_approval_envelope,
};
use crate::active_workspace::capability_qualification::{
    ATOM_MARKETPLACE_WRITE, SPACESHIP_MARKETPLACE_WRITE,
};
use base64::Engine as _;
use rusqlite::{Connection, params};
use serde_json::json;

#[derive(Clone, Copy)]
pub(in crate::active_workspace::business) enum ApprovalPurpose {
    SellerHubBinPrice,
    SellerHubCreateListing,
    AtomStandardDelist,
}

struct ApprovalScope {
    provider: &'static str,
    capability: &'static str,
    action: &'static str,
    audit_target: &'static str,
    plan_kind: &'static str,
    attempt_target: &'static str,
    claim_event: &'static str,
    dispatch_key_domain: &'static str,
    approval_type: &'static str,
    signature_domain: &'static str,
    envelope_domain: &'static str,
    target_set_domain: &'static str,
    signing_purpose: EvidenceSignaturePurpose,
}

impl ApprovalPurpose {
    const fn scope(self) -> ApprovalScope {
        match self {
            Self::SellerHubBinPrice => ApprovalScope {
                provider: "spaceship",
                capability: SPACESHIP_MARKETPLACE_WRITE,
                action: "set_bin_price",
                audit_target: "sellerhub_bin_price_approval",
                plan_kind: "sellerhub_bin_price",
                attempt_target: "sellerhub_bin_price_attempt",
                claim_event: "sellerhub_bin_price_dispatch_claimed",
                dispatch_key_domain: "GOODDEALER-SELLERHUB-BIN-PRICE-LOCAL-DISPATCH-KEY-V1",
                approval_type: "gd.sellerhub-bin-price-item-approval.v1",
                signature_domain: "GOODDEALER-SELLERHUB-BIN-PRICE-ITEM-APPROVAL-V1",
                envelope_domain: "GOODDEALER-SELLERHUB-BIN-PRICE-ITEM-APPROVAL-ENVELOPE-V1",
                target_set_domain: "GOODDEALER-SELLERHUB-BIN-PRICE-TARGET-SET-V1",
                signing_purpose: EvidenceSignaturePurpose::SellerHubBinPriceApproval,
            },
            Self::SellerHubCreateListing => ApprovalScope {
                provider: "spaceship",
                capability: SPACESHIP_MARKETPLACE_WRITE,
                action: "create_listing",
                audit_target: "sellerhub_create_listing_approval",
                plan_kind: "sellerhub_create_listing",
                attempt_target: "sellerhub_create_listing_attempt",
                claim_event: "sellerhub_create_listing_dispatch_claimed",
                dispatch_key_domain: "GOODDEALER-SELLERHUB-CREATE-LISTING-LOCAL-DISPATCH-KEY-V1",
                approval_type: "gd.sellerhub-create-listing-item-approval.v1",
                signature_domain: "GOODDEALER-SELLERHUB-CREATE-LISTING-ITEM-APPROVAL-V1",
                envelope_domain: "GOODDEALER-SELLERHUB-CREATE-LISTING-ITEM-APPROVAL-ENVELOPE-V1",
                target_set_domain: "GOODDEALER-SELLERHUB-CREATE-LISTING-TARGET-SET-V1",
                signing_purpose: EvidenceSignaturePurpose::SellerHubCreateListingApproval,
            },
            Self::AtomStandardDelist => ApprovalScope {
                provider: "atom",
                capability: ATOM_MARKETPLACE_WRITE,
                action: "remove_standard",
                audit_target: "atom_standard_delist_approval",
                plan_kind: "atom_standard_delist",
                attempt_target: "atom_standard_delist_attempt",
                claim_event: "atom_standard_delist_dispatch_claimed",
                dispatch_key_domain: "GOODDEALER-ATOM-STANDARD-DELIST-LOCAL-DISPATCH-KEY-V1",
                approval_type: "gd.atom-standard-delist-item-approval.v1",
                signature_domain: "GOODDEALER-ATOM-STANDARD-DELIST-ITEM-APPROVAL-V1",
                envelope_domain: "GOODDEALER-ATOM-STANDARD-DELIST-ITEM-APPROVAL-ENVELOPE-V1",
                target_set_domain: "GOODDEALER-ATOM-STANDARD-DELIST-TARGET-SET-V1",
                signing_purpose: EvidenceSignaturePurpose::AtomStandardDelistApproval,
            },
        }
    }
}

#[expect(
    clippy::too_many_arguments,
    reason = "approval binds the exact plan and its authority"
)]
pub(in crate::active_workspace::business) fn record_approval(
    purpose: ApprovalPurpose,
    tx: &Connection,
    context: &ExecutionEvidenceContext,
    plan: &str,
    operation: &str,
    plan_hash: &str,
    targets: &[ApprovalTarget],
    signer: &mut EvidenceSigner<'_>,
) -> Result<()> {
    let scope = purpose.scope();
    validate_context(context)?;
    if !(1..=500).contains(&targets.len())
        || !super::super::is_uuid_v4(plan)
        || !super::super::is_uuid_v4(operation)
    {
        return Err(rejected());
    }
    let mut ordered: Vec<_> = targets.iter().collect();
    ordered.sort_unstable_by_key(|target| &target.item_id);
    if ordered
        .iter()
        .any(|target| !super::super::is_uuid_v4(&target.item_id))
        || ordered
            .windows(2)
            .any(|pair| pair[0].item_id == pair[1].item_id)
    {
        return Err(rejected());
    }
    let items = ordered
        .into_iter()
        .map(|target| {
            Ok((
                target.item_id.as_str(),
                hex_to_digest(&target.request_digest)?,
            ))
        })
        .collect::<Result<Vec<_>>>()?;
    let target_set = digest(&evidence_transcript(
        scope.target_set_domain,
        &json!({"schemaVersion":1,"planId":plan,"action":scope.action,"items":items.iter().map(|(item,request)|
            json!({"operationItemId":item,"requestDigest":request})).collect::<Vec<_>>()}),
    )?);
    let plan_hash = hex_to_digest(plan_hash)?;
    let approval_id = random_id()?;
    let (audit_id, _) = audit(
        tx,
        context,
        "user",
        scope.audit_target,
        &approval_id,
        &json!({"schemaVersion":1,"provider":scope.provider,"action":scope.action,"stage":"approved",
            "approvedOperationId":approval_id,"operationId":operation,"planId":plan,
            "planHash":plan_hash,"targetCount":items.len(),"targetSetDigest":target_set}),
        signer,
    )?;
    tx.execute(
        "INSERT INTO afternic_listing_approvals(workspace_id,approved_operation_id,operation_id,plan_id,plan_hash,
         target_count,target_set_digest,source_device_id,active_lease_epoch,credential_epoch,signing_key_id,
         signing_key_version,source_installation_digest,approved_at,audit_event_id,action)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)",
        params![context.workspace_id,approval_id,operation,plan,plan_hash,i64::try_from(items.len()).map_err(|_| rejected())?,target_set,
            context.source_device_id,sql(context.active_lease_epoch)?,sql(context.credential_epoch)?,
            context.signing_key_id,sql(context.signing_key_version)?,context.source_installation_digest,
            context.occurred_at,audit_id,scope.action],
    ).map_err(storage)?;
    for (item, request) in items {
        let mut value = json!({"schemaVersion":1,"typ":scope.approval_type,
            "aud":"gooddealer-cloud/execution-evidence","approvedOperationId":approval_id,
            "operationId":operation,"operationItemId":item,"planId":plan,"planHash":plan_hash,
            "targetCount":targets.len(),"targetSetDigest":target_set,"capability":scope.capability,
            "action":scope.action,"requestDigest":request,"accountId":context.account_id,
            "workspaceId":context.workspace_id,"sourceDeviceId":context.source_device_id,
            "activeLeaseEpoch":context.active_lease_epoch,"credentialEpoch":context.credential_epoch,
            "signingKeyId":context.signing_key_id,"signingKeyVersion":context.signing_key_version,
            "authorizationHash":context.authorization_hash,"trustedTimeAnchorId":context.trusted_time_anchor_id,
            "monotonicDeltaMs":context.monotonic_delta_ms,"approvedAt":context.occurred_at,
            "signatureTranscriptVersion":1});
        sign(
            &mut value,
            scope.signature_domain,
            scope.signing_purpose,
            context,
            signer,
        )?;
        let hash = digest(&evidence_transcript(scope.envelope_domain, &value)?);
        tx.execute(
            "INSERT INTO afternic_listing_item_authorizations(workspace_id,approved_operation_id,operation_id,
             plan_id,item_id,attempt_number,attempt_id,workflow_node_id,request_digest,envelope_json,envelope_digest)
             VALUES(?1,?2,?3,?4,?5,1,?6,?7,?8,?9,?10)",
            params![context.workspace_id,approval_id,operation,plan,item,random_id()?,random_id()?,request,
                encoded(&value)?,hash],
        ).map_err(storage)?;
    }
    Ok(())
}

struct SignedItem {
    approval_id: String,
    attempt_id: String,
    workflow_node_id: String,
    wire: String,
    envelope_digest: String,
    plan_hash: String,
}

fn current_approval(
    purpose: ApprovalPurpose,
    tx: &Connection,
    context: &ExecutionEvidenceContext,
    operation: &str,
    plan: &str,
    item: &str,
    request: &str,
) -> Result<SignedItem> {
    let scope = purpose.scope();
    validate_context(context)?;
    let result = tx.query_row(
        "SELECT a.approved_operation_id,i.attempt_id,i.workflow_node_id,i.envelope_json,i.envelope_digest,a.plan_hash
         FROM afternic_listing_item_authorizations i
         JOIN afternic_listing_approvals a USING(workspace_id,approved_operation_id,operation_id,plan_id)
         JOIN operations o USING(workspace_id,operation_id,plan_id)
         WHERE a.workspace_id=?1 AND o.operation_id=?2 AND o.plan_id=?3 AND o.idempotency_key=o.plan_id
          AND i.item_id=?4 AND i.request_digest=?5 AND i.attempt_number=1
          AND a.source_device_id=?6 AND a.active_lease_epoch=?7 AND a.credential_epoch=?8
          AND a.signing_key_id=?9 AND a.signing_key_version=?10 AND a.source_installation_digest=?11
          AND a.action=?12",
        params![context.workspace_id,operation,plan,item,request,context.source_device_id,
            sql(context.active_lease_epoch)?,sql(context.credential_epoch)?,
            context.signing_key_id,sql(context.signing_key_version)?,context.source_installation_digest,scope.action],
        |r| Ok(SignedItem { approval_id:r.get(0)?, attempt_id:r.get(1)?, workflow_node_id:r.get(2)?,
            wire:r.get(3)?, envelope_digest:r.get(4)?, plan_hash:r.get(5)? }),
    ).map_err(|_| rejected())?;
    if result.wire.len() > 6144 {
        return Err(rejected());
    }
    let p: ApprovalEnvelope = serde_json::from_str(&result.wire).map_err(|_| rejected())?;
    if p.schema_version != 1
        || p.typ != scope.approval_type
        || p.aud != "gooddealer-cloud/execution-evidence"
        || p.action != scope.action
        || p.capability != scope.capability
        || p.signature_transcript_version != 1
        || !(1..=500).contains(&p.target_count)
        || p.monotonic_delta_ms > MAX_SEQUENCE
        || p.approved_at > context.occurred_at
        || p.account_id != context.account_id
        || p.workspace_id != context.workspace_id
        || p.source_device_id != context.source_device_id
        || p.active_lease_epoch != context.active_lease_epoch
        || p.credential_epoch != context.credential_epoch
        || p.signing_key_id != context.signing_key_id
        || p.signing_key_version != context.signing_key_version
        || p.operation_id != operation
        || p.plan_id != plan
        || p.operation_item_id != item
        || p.approved_operation_id != result.approval_id
        || p.plan_hash != result.plan_hash
        || p.request_digest != request
        || !super::super::is_uuid_v4(&result.attempt_id)
        || !super::super::is_uuid_v4(&result.workflow_node_id)
    {
        return Err(rejected());
    }
    verify_approval_envelope(
        &p,
        &result.envelope_digest,
        context,
        scope.signature_domain,
        scope.envelope_domain,
    )?;
    Ok(result)
}

#[expect(
    clippy::too_many_arguments,
    reason = "evidence binds the exact marketplace purpose and request identity"
)]
pub(in crate::active_workspace::business) fn record_claim(
    purpose: ApprovalPurpose,
    tx: &Connection,
    context: &ExecutionEvidenceContext,
    operation: &str,
    plan: &str,
    item: &str,
    request: &str,
    signer: &mut EvidenceSigner<'_>,
) -> Result<()> {
    let scope = purpose.scope();
    let request = hex_to_digest(request)?;
    let p = current_approval(purpose, tx, context, operation, plan, item, &request)?;
    let (audit_id, audit_hash) = audit(
        tx,
        context,
        "device_service",
        scope.attempt_target,
        &p.attempt_id,
        &json!({"schemaVersion":1,"provider":scope.provider,"action":scope.action,"stage":"dispatch_claimed",
           "approvedOperationId":p.approval_id,"operationId":operation,"operationItemId":item,
           "attemptId":p.attempt_id,"attemptNo":1,"planHash":p.plan_hash,"requestDigest":request,
           "approvalEnvelopeDigest":p.envelope_digest}),
        signer,
    )?;
    let h = head(tx, context, "execution_fact")?;
    let fact_id = random_id()?;
    let idempotency = digest(&evidence_transcript(
        scope.dispatch_key_domain,
        &json!({"schemaVersion":1,"operationId":operation,"operationItemId":item,
            "attemptNo":1,"localOperationKey":plan}),
    )?);
    let mut fact = json!({"schemaVersion":1,"executionFactId":fact_id,"operationId":operation,
        "operationItemId":item,"workflowNodeId":p.workflow_node_id,"attemptId":p.attempt_id,"attemptNo":1,
        "approvedOperationId":p.approval_id,"planHash":p.plan_hash,"idempotencyKeyHash":idempotency,
        "sourceDeviceId":context.source_device_id,"workspaceId":context.workspace_id,
        "activeLeaseEpoch":context.active_lease_epoch,"executionFactSequence":h.sequence+1,"eventType":scope.claim_event,
        "evidenceLevel":"durable_local_claim","occurredAt":context.occurred_at,"signingKeyId":context.signing_key_id,
        "signingKeyVersion":context.signing_key_version,"credentialEpoch":context.credential_epoch,
        "trustedTimeAnchorId":context.trusted_time_anchor_id,"monotonicDeltaMs":context.monotonic_delta_ms,
        "requestStartBoundary":context.occurred_at,"authorizationHash":context.authorization_hash,
        "executionAuthorizationEvidence":{"approvedOperationDigest":p.envelope_digest,
            "approvedOperationEnvelope":URL_SAFE_NO_PAD.encode(p.wire.as_bytes()),"signingKeyId":context.signing_key_id,
            "signingKeyVersion":context.signing_key_version,"credentialEpoch":context.credential_epoch,
            "signatureTranscriptVersion":1},"signatureTranscriptVersion":1,
        "payloadRedacted":{"schemaVersion":1,"provider":scope.provider,"action":scope.action,"stage":"dispatch_claimed",
            "dispatchSemantics":"local_claim_only","deduplicationScope":"local_only","requestDigest":request,
            "approvalEnvelopeDigest":p.envelope_digest},"auditEventRef":audit_id,"auditEventHash":audit_hash});
    let envelope = sign(
        &mut fact,
        FACT_DOMAIN,
        EvidenceSignaturePurpose::ExecutionFact,
        context,
        signer,
    )?;
    tx.execute(
        "INSERT INTO device_execution_fact_outbox(workspace_id,source_device_id,active_lease_epoch,execution_fact_sequence,
         execution_fact_id,source_installation_digest,operation_id,item_id,attempt_number,attempt_id,
         audit_event_id,envelope_json,canonical_envelope,envelope_digest)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,1,?9,?10,?11,?12,?13)",
        params![context.workspace_id,context.source_device_id,sql(context.active_lease_epoch)?,h.sequence+1,
            fact_id,context.source_installation_digest,operation,item,p.attempt_id,
            audit_id,encoded(&fact)?,envelope,digest(&envelope)],
    ).map_err(storage)?;
    advance(tx, context, "execution_fact", &h, &envelope, None)
}

/// Refuses an exact approved item before any dispatch claim exists.
#[expect(
    clippy::too_many_arguments,
    reason = "the signed refusal binds the complete immutable request identity"
)]
pub(in crate::active_workspace::business) fn record_preflight_refusal(
    purpose: ApprovalPurpose,
    tx: &Connection,
    context: &ExecutionEvidenceContext,
    operation: &str,
    plan: &str,
    item: &str,
    request: &str,
    reason: &str,
    signer: &mut EvidenceSigner<'_>,
) -> Result<(String, String)> {
    let scope = purpose.scope();
    let request = hex_to_digest(request)?;
    let p = current_approval(purpose, tx, context, operation, plan, item, &request)?;
    let claimed: bool = tx
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM device_execution_fact_outbox
         WHERE workspace_id=?1 AND operation_id=?2 AND item_id=?3 AND attempt_number=1)",
            params![context.workspace_id, operation, item],
            |r| r.get(0),
        )
        .map_err(storage)?;
    if claimed {
        return Err(rejected());
    }
    audit(
        tx,
        context,
        "device_service",
        scope.attempt_target,
        &p.attempt_id,
        &json!({"schemaVersion":1,"provider":scope.provider,"action":scope.action,"stage":"preflight_refused",
            "approvedOperationId":p.approval_id,"operationId":operation,"operationItemId":item,
            "attemptId":p.attempt_id,"planHash":p.plan_hash,"requestDigest":request,
            "approvalEnvelopeDigest":p.envelope_digest,"reason":reason}),
        signer,
    )
}

#[derive(Clone, Copy)]
pub(in crate::active_workspace::business) enum ReconciliationOutcome {
    Matched,
    Different,
    OwnershipPending,
    StateBlocked,
    ReadFailed,
}

#[expect(
    clippy::too_many_arguments,
    clippy::too_many_lines,
    reason = "evidence binds the exact marketplace purpose and request identity"
)]
pub(in crate::active_workspace::business) fn record_reconciliation(
    purpose: ApprovalPurpose,
    tx: &Connection,
    context: &ExecutionEvidenceContext,
    operation: &str,
    item: &str,
    request: &str,
    outcome: ReconciliationOutcome,
    signer: &mut EvidenceSigner<'_>,
) -> Result<(String, String)> {
    let scope = purpose.scope();
    let prior = tx
        .query_row(
            "SELECT f.execution_fact_id,f.envelope_digest,f.canonical_envelope,f.envelope_json,
             f.attempt_id,f.source_device_id,f.active_lease_epoch
         FROM device_execution_fact_outbox f
         WHERE f.workspace_id=?1 AND f.operation_id=?2 AND f.item_id=?3 AND f.attempt_number=1",
            params![context.workspace_id, operation, item],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Vec<u8>>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, String>(4)?,
                    r.get::<_, String>(5)?,
                    r.get::<_, i64>(6)?,
                ))
            },
        )
        .map_err(|_| rejected())?;
    let (id, previous_digest, bytes, wire, attempt, device, lease) = prior;
    let lease = u64::try_from(lease).map_err(|_| rejected())?;
    let fact: super::ClaimFact = serde_json::from_str(&wire).map_err(|_| rejected())?;
    let mut value = serde_json::to_value(&fact).map_err(|_| rejected())?;
    value
        .as_object_mut()
        .ok_or_else(rejected)?
        .remove("deviceSignature");
    let signature = URL_SAFE_NO_PAD
        .decode(&fact.device_signature)
        .map_err(|_| rejected())?;
    if signature.len() != 64 || URL_SAFE_NO_PAD.encode(signature) != fact.device_signature {
        return Err(rejected());
    }
    let mut canonical = evidence_transcript(FACT_DOMAIN, &value)?;
    canonical.extend(
        u32::try_from(fact.device_signature.len())
            .map_err(|_| rejected())?
            .to_be_bytes(),
    );
    canonical.extend(fact.device_signature.as_bytes());
    if canonical != bytes
        || digest(&bytes) != previous_digest
        || fact.execution_fact_id != id
        || fact.source_device_id != device
        || fact.active_lease_epoch != lease
        || fact.workspace_id != context.workspace_id
        || fact.operation_id != operation
        || fact.operation_item_id != item
        || fact.attempt_id != attempt
        || fact.event_type != scope.claim_event
        || fact.occurred_at > context.occurred_at
        || fact.payload_redacted.provider != scope.provider
        || fact.payload_redacted.action != scope.action
        || fact.payload_redacted.stage != "dispatch_claimed"
        || fact.payload_redacted.request_digest != hex_to_digest(request)?
    {
        return Err(rejected());
    }
    let (outcome, reason) = match outcome {
        ReconciliationOutcome::Matched => match purpose {
            ApprovalPurpose::SellerHubBinPrice => ("matched", None),
            ApprovalPurpose::SellerHubCreateListing => ("published", None),
            ApprovalPurpose::AtomStandardDelist => return Err(rejected()),
        },
        ReconciliationOutcome::Different => {
            let result = if matches!(purpose, ApprovalPurpose::SellerHubCreateListing) {
                "terms_unconfirmed"
            } else {
                "different"
            };
            (result, Some("postcondition_pending"))
        }
        ReconciliationOutcome::OwnershipPending
            if matches!(purpose, ApprovalPurpose::SellerHubCreateListing) =>
        {
            ("ownership_pending", Some("ownership_verifying"))
        }
        ReconciliationOutcome::StateBlocked
            if matches!(purpose, ApprovalPurpose::SellerHubCreateListing) =>
        {
            ("state_blocked", Some("not_on_sale"))
        }
        ReconciliationOutcome::OwnershipPending | ReconciliationOutcome::StateBlocked => {
            return Err(rejected());
        }
        ReconciliationOutcome::ReadFailed => ("read_failed", Some("read_failed")),
    };
    audit(
        tx,
        context,
        "device_service",
        scope.attempt_target,
        &attempt,
        &json!({"schemaVersion":1,"provider":scope.provider,"action":scope.action,"stage":"reconciled",
            "operationId":operation,"operationItemId":item,"attemptId":attempt,
            "originalExecutionFactId":id,"originalExecutionFactDigest":previous_digest,
            "originalSourceDeviceId":device,"originalActiveLeaseEpoch":lease,
            "outcome":outcome,"reason":reason}),
        signer,
    )
}

/// A handoff must see either the one signed claim or a signed refusal to dispatch.
pub(in crate::active_workspace::business) fn has_unattested_attempt(
    conn: &Connection,
    workspace: &str,
) -> Result<bool> {
    Ok(
        has_unattested_attempt_for(ApprovalPurpose::SellerHubBinPrice, conn, workspace)?
            || has_unattested_attempt_for(
                ApprovalPurpose::SellerHubCreateListing,
                conn,
                workspace,
            )?
            || has_unattested_attempt_for(ApprovalPurpose::AtomStandardDelist, conn, workspace)?,
    )
}

fn has_unattested_attempt_for(
    purpose: ApprovalPurpose,
    conn: &Connection,
    workspace: &str,
) -> Result<bool> {
    let scope = purpose.scope();
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM operation_attempts a JOIN operation_plans p USING(workspace_id,plan_id)
          WHERE a.workspace_id=?1 AND p.operation_kind=?4 AND (
           NOT EXISTS(SELECT 1 FROM afternic_listing_item_authorizations j JOIN afternic_listing_approvals batch
              USING(workspace_id,approved_operation_id,operation_id,plan_id)
             WHERE j.workspace_id=a.workspace_id AND j.operation_id=a.operation_id AND j.item_id=a.item_id
              AND j.attempt_number=a.attempt_number AND batch.action=?5)
           OR (a.status!='queued'
            AND NOT EXISTS(SELECT 1 FROM device_execution_fact_outbox f
              WHERE f.workspace_id=a.workspace_id AND f.operation_id=a.operation_id AND f.item_id=a.item_id
               AND f.attempt_number=a.attempt_number AND json_extract(f.envelope_json,'$.eventType')=?2)
            AND NOT EXISTS(SELECT 1 FROM operation_results r JOIN workspace_device_audit_outbox d
              ON d.workspace_id=r.workspace_id AND d.audit_event_id=json_extract(r.result_json,'$.auditEventId')
               AND d.event_hash=r.evidence_digest
              WHERE r.workspace_id=a.workspace_id AND r.operation_id=a.operation_id AND r.item_id=a.item_id
               AND r.attempt_number=a.attempt_number AND r.outcome='failed_final' AND a.status='failed_final'
               AND json_extract(d.envelope_json,'$.targetType')=?3
               AND json_extract(d.envelope_json,'$.payloadRedacted.stage')='preflight_refused'
               AND json_extract(d.envelope_json,'$.payloadRedacted.action')=?5
               AND json_extract(d.envelope_json,'$.payloadRedacted.operationId')=a.operation_id
               AND json_extract(d.envelope_json,'$.payloadRedacted.operationItemId')=a.item_id))))",
        params![workspace,scope.claim_event,scope.attempt_target,scope.plan_kind,scope.action], |r| r.get(0),
    ).map_err(storage)
}
