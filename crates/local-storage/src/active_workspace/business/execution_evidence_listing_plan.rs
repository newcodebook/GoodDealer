//! v2 plans retain the original evidence streams with a separate purpose for every typed item.
use super::*;
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ListingPlanAction {
    Create,
    Update,
    ReactivateOwnershipReview,
}
impl ListingPlanAction {
    pub(in crate::active_workspace::business) const fn name(self) -> &'static str {
        match self {
            Self::Create => "create",
            Self::Update => "update",
            Self::ReactivateOwnershipReview => "reactivate_ownership_review",
        }
    }
    fn version(self) -> u8 {
        if self == Self::ReactivateOwnershipReview {
            1
        } else {
            2
        }
    }
    fn typ(self) -> &'static str {
        if self == Self::ReactivateOwnershipReview {
            "gd.afternic-ownership-review-item-approval.v1"
        } else {
            "gd.afternic-listing-plan-item-approval.v2"
        }
    }
    fn domain(self) -> &'static str {
        if self == Self::ReactivateOwnershipReview {
            "GOODDEALER-AFTERNIC-OWNERSHIP-REVIEW-ITEM-APPROVAL-V1"
        } else {
            "GOODDEALER-AFTERNIC-LISTING-PLAN-ITEM-APPROVAL-V2"
        }
    }
    fn envelope_domain(self) -> &'static str {
        if self == Self::ReactivateOwnershipReview {
            "GOODDEALER-AFTERNIC-OWNERSHIP-REVIEW-ITEM-APPROVAL-ENVELOPE-V1"
        } else {
            "GOODDEALER-AFTERNIC-LISTING-PLAN-ITEM-APPROVAL-ENVELOPE-V2"
        }
    }
    fn signature_purpose(self) -> EvidenceSignaturePurpose {
        if self == Self::ReactivateOwnershipReview {
            EvidenceSignaturePurpose::AfternicOwnershipReviewApproval
        } else {
            EvidenceSignaturePurpose::AfternicListingPlanApproval
        }
    }
    fn target(self) -> &'static str {
        if self == Self::ReactivateOwnershipReview {
            "afternic_ownership_review_attempt"
        } else {
            "afternic_listing_plan_v2_attempt"
        }
    }
    fn event(self) -> &'static str {
        if self == Self::ReactivateOwnershipReview {
            "afternic_ownership_review_dispatch_claimed"
        } else {
            "afternic_listing_plan_v2_dispatch_claimed"
        }
    }
}
pub(in crate::active_workspace::business) struct ListingPlanApprovalTarget {
    pub item_id: String,
    pub action: ListingPlanAction,
    pub request_digest: String,
    pub parent_item_id: Option<String>,
    pub parent_request_digest: Option<String>,
}
fn target_set(plan: &str, targets: &[ListingPlanApprovalTarget]) -> Result<Value> {
    if targets.is_empty() || targets.len() > 1000 || !super::super::is_uuid_v4(plan) {
        return Err(rejected());
    }
    let mut ordered: Vec<_> = targets.iter().collect();
    ordered.sort_unstable_by_key(|i| &i.item_id);
    let mut parents = std::collections::BTreeSet::new();
    let mut roots = 0;
    let mut items = Vec::new();
    for (n, t) in ordered.iter().enumerate() {
        if !super::super::is_uuid_v4(&t.item_id)
            || (n > 0 && ordered[n - 1].item_id == t.item_id)
            || (t.parent_item_id.is_some() != t.parent_request_digest.is_some())
        {
            return Err(rejected());
        }
        if let Some(parent) = &t.parent_item_id {
            if t.action != ListingPlanAction::ReactivateOwnershipReview
                || !parents.insert(parent)
                || !ordered.iter().any(|p| {
                    p.item_id == *parent
                        && p.action != ListingPlanAction::ReactivateOwnershipReview
                        && Some(&p.request_digest) == t.parent_request_digest.as_ref()
                })
            {
                return Err(rejected());
            }
        } else {
            roots += 1;
        }
        items.push(json!({"operationItemId":t.item_id,"action":t.action.name(),"requestDigest":hex_to_digest(&t.request_digest)?,"parentItemId":t.parent_item_id,"parentRequestDigest":t.parent_request_digest.as_deref().map(hex_to_digest).transpose()?}));
    }
    if roots > 500 {
        return Err(rejected());
    }
    Ok(json!({"schemaVersion":2,"planId":plan,"action":"listing_plan_v2","items":items}))
}
pub(in crate::active_workspace::business) fn record_listing_plan_approval(
    tx: &Connection,
    context: &ExecutionEvidenceContext,
    plan: &str,
    operation: &str,
    plan_hash: &str,
    targets: &[ListingPlanApprovalTarget],
    signer: &mut EvidenceSigner<'_>,
) -> Result<()> {
    validate_context(context)?;
    let target_set = digest(&evidence_transcript(
        "GOODDEALER-AFTERNIC-LISTING-PLAN-TARGET-SET-V2",
        &target_set(plan, targets)?,
    )?);
    let plan_hash = hex_to_digest(plan_hash)?;
    let approval_id = random_id()?;
    let (audit_id, _) = audit(
        tx,
        context,
        "user",
        "afternic_listing_plan_v2_approval",
        &approval_id,
        &json!({"schemaVersion":2,"provider":"afternic","action":"listing_plan_v2","stage":"approved","approvedOperationId":approval_id,"operationId":operation,"planId":plan,"planHash":plan_hash,"targetCount":targets.len(),"targetSetDigest":target_set}),
        signer,
    )?;
    tx.execute("INSERT INTO afternic_listing_approvals(workspace_id,approved_operation_id,operation_id,plan_id,plan_hash,target_count,target_set_digest,source_device_id,active_lease_epoch,credential_epoch,signing_key_id,signing_key_version,source_installation_digest,approved_at,audit_event_id,action) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,'listing_plan_v2')",params![context.workspace_id,approval_id,operation,plan,plan_hash,sql(u64::try_from(targets.len()).map_err(|_|rejected())?)?,target_set,context.source_device_id,sql(context.active_lease_epoch)?,sql(context.credential_epoch)?,context.signing_key_id,sql(context.signing_key_version)?,context.source_installation_digest,context.occurred_at,audit_id]).map_err(storage)?;
    for t in targets {
        let request = hex_to_digest(&t.request_digest)?;
        let mut value = json!({"schemaVersion":t.action.version(),"typ":t.action.typ(),"aud":"gooddealer-cloud/execution-evidence","approvedOperationId":approval_id,"operationId":operation,"operationItemId":t.item_id,"planId":plan,"planHash":plan_hash,"targetCount":targets.len(),"targetSetDigest":target_set,"capability":"afternic:marketplace:write","action":t.action.name(),"requestDigest":request,"parentItemId":t.parent_item_id,"parentRequestDigest":t.parent_request_digest.as_deref().map(hex_to_digest).transpose()?,"accountId":context.account_id,"workspaceId":context.workspace_id,"sourceDeviceId":context.source_device_id,"activeLeaseEpoch":context.active_lease_epoch,"credentialEpoch":context.credential_epoch,"signingKeyId":context.signing_key_id,"signingKeyVersion":context.signing_key_version,"authorizationHash":context.authorization_hash,"trustedTimeAnchorId":context.trusted_time_anchor_id,"monotonicDeltaMs":context.monotonic_delta_ms,"approvedAt":context.occurred_at,"signatureTranscriptVersion":1});
        sign(
            &mut value,
            t.action.domain(),
            t.action.signature_purpose(),
            context,
            signer,
        )?;
        let hash = digest(&evidence_transcript(t.action.envelope_domain(), &value)?);
        tx.execute("INSERT INTO afternic_listing_item_authorizations(workspace_id,approved_operation_id,operation_id,plan_id,item_id,attempt_number,attempt_id,workflow_node_id,request_digest,envelope_json,envelope_digest) VALUES(?1,?2,?3,?4,?5,1,?6,?7,?8,?9,?10)",params![context.workspace_id,approval_id,operation,plan,t.item_id,random_id()?,random_id()?,request,encoded(&value)?,hash]).map_err(storage)?;
    }
    Ok(())
}
fn nullable<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> std::result::Result<Option<String>, D::Error> {
    serde::Deserialize::deserialize(d)
}
#[derive(serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PlanApproval {
    schema_version: u8,
    typ: String,
    aud: String,
    approved_operation_id: String,
    operation_id: String,
    operation_item_id: String,
    plan_id: String,
    plan_hash: String,
    target_count: u64,
    target_set_digest: String,
    capability: String,
    action: ListingPlanAction,
    request_digest: String,
    #[serde(deserialize_with = "nullable")]
    parent_item_id: Option<String>,
    #[serde(deserialize_with = "nullable")]
    parent_request_digest: Option<String>,
    account_id: String,
    workspace_id: String,
    source_device_id: String,
    active_lease_epoch: u64,
    credential_epoch: u64,
    signing_key_id: String,
    signing_key_version: u64,
    authorization_hash: String,
    trusted_time_anchor_id: String,
    monotonic_delta_ms: u64,
    approved_at: String,
    signature_transcript_version: u8,
    device_signature: String,
}
fn verify_approval_v2(
    wire: &str,
    hash: &str,
    c: &ExecutionEvidenceContext,
) -> Result<PlanApproval> {
    if wire.len() > 6144 {
        return Err(rejected());
    }
    let p: PlanApproval = serde_json::from_str(wire).map_err(|_| rejected())?;
    if p.schema_version != p.action.version()
        || p.typ != p.action.typ()
        || p.aud != "gooddealer-cloud/execution-evidence"
        || p.capability != "afternic:marketplace:write"
        || p.signature_transcript_version != 1
        || !(1..=1000).contains(&p.target_count)
        || p.monotonic_delta_ms > MAX_SEQUENCE
        || p.account_id != c.account_id
        || p.workspace_id != c.workspace_id
        || p.source_device_id != c.source_device_id
        || p.active_lease_epoch != c.active_lease_epoch
        || p.credential_epoch != c.credential_epoch
        || p.signing_key_id != c.signing_key_id
        || p.signing_key_version != c.signing_key_version
        || (p.parent_item_id.is_some() != p.parent_request_digest.is_some())
        || (p.action != ListingPlanAction::ReactivateOwnershipReview && p.parent_item_id.is_some())
        || p.parent_item_id.as_ref() == Some(&p.operation_item_id)
    {
        return Err(rejected());
    }
    for id in [
        &p.operation_id,
        &p.operation_item_id,
        &p.plan_id,
        &p.approved_operation_id,
    ]
    .into_iter()
    .chain(p.parent_item_id.as_ref())
    {
        if !super::super::is_uuid_v4(id) {
            return Err(rejected());
        }
    }
    for d in [
        &p.request_digest,
        &p.plan_hash,
        &p.target_set_digest,
        &p.authorization_hash,
        &p.trusted_time_anchor_id,
    ]
    .into_iter()
    .chain(p.parent_request_digest.as_ref())
    {
        if !URL_SAFE_NO_PAD
            .decode(d)
            .is_ok_and(|b| b.len() == 32 && URL_SAFE_NO_PAD.encode(b) == *d)
        {
            return Err(rejected());
        }
    }
    super::super::validate_timestamp(Some(p.approved_at.clone())).map_err(|_| rejected())?;
    let mut value = serde_json::to_value(&p).map_err(|_| rejected())?;
    if digest(&evidence_transcript(p.action.envelope_domain(), &value)?) != hash {
        return Err(rejected());
    }
    value
        .as_object_mut()
        .ok_or_else(rejected)?
        .remove("deviceSignature");
    let signature = URL_SAFE_NO_PAD
        .decode(&p.device_signature)
        .map_err(|_| rejected())?;
    if signature.len() != 64 || URL_SAFE_NO_PAD.encode(&signature) != p.device_signature {
        return Err(rejected());
    }
    UnparsedPublicKey::new(&ED25519, c.public_key)
        .verify(&evidence_transcript(p.action.domain(), &value)?, &signature)
        .map_err(|_| rejected())?;
    Ok(p)
}
#[derive(Clone, Debug)]
pub(in crate::active_workspace::business) struct OwnershipClaimDigests {
    pub resource_binding: String,
    pub preflight_observation: String,
}
pub(in crate::active_workspace::business) fn record_listing_plan_claim(
    tx: &Connection,
    c: &ExecutionEvidenceContext,
    operation: &str,
    item: &str,
    request: &str,
    ownership: Option<&OwnershipClaimDigests>,
    signer: &mut EvidenceSigner<'_>,
) -> Result<()> {
    let (wire,approval_digest,attempt,node,local_key,origin):(String,String,String,String,String,String)=tx.query_row("SELECT i.envelope_json,i.envelope_digest,i.attempt_id,i.workflow_node_id,o.idempotency_key,a.source_installation_digest FROM afternic_listing_item_authorizations i JOIN afternic_listing_approvals a USING(workspace_id,approved_operation_id) JOIN operations o ON o.workspace_id=i.workspace_id AND o.operation_id=i.operation_id WHERE i.workspace_id=?1 AND i.operation_id=?2 AND i.item_id=?3 AND a.action='listing_plan_v2'",params![c.workspace_id,operation,item],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?))).map_err(storage)?;
    let p = verify_approval_v2(&wire, &approval_digest, c)?;
    let request = hex_to_digest(request)?;
    if p.operation_id != operation
        || p.operation_item_id != item
        || p.request_digest != request
        || origin != c.source_installation_digest
        || (p.action == ListingPlanAction::ReactivateOwnershipReview) != ownership.is_some()
    {
        return Err(rejected());
    }
    let mut audit_payload = json!({"schemaVersion":p.action.version(),"provider":"afternic","action":p.action.name(),"stage":"dispatch_claimed","approvedOperationId":p.approved_operation_id,"operationId":operation,"operationItemId":item,"attemptId":attempt,"attemptNo":1,"planHash":p.plan_hash,"requestDigest":request,"approvalEnvelopeDigest":approval_digest});
    let mut payload = json!({"schemaVersion":p.action.version(),"provider":"afternic","action":p.action.name(),"stage":"dispatch_claimed","dispatchSemantics":"local_claim_only","deduplicationScope":"local_only","requestDigest":request,"approvalEnvelopeDigest":approval_digest});
    if let Some(o) = ownership {
        for v in [&mut audit_payload, &mut payload] {
            v["resourceBindingDigest"] = hex_to_digest(&o.resource_binding)?.into();
            v["preflightObservationDigest"] = hex_to_digest(&o.preflight_observation)?.into();
        }
    }
    let (audit_id, audit_hash) = audit(
        tx,
        c,
        "device_service",
        p.action.target(),
        &attempt,
        &audit_payload,
        signer,
    )?;
    let h = head(tx, c, "execution_fact")?;
    let fact_id = random_id()?;
    let idempotency = digest(&evidence_transcript(
        "GOODDEALER-AFTERNIC-LOCAL-DISPATCH-KEY-V1",
        &json!({"schemaVersion":1,"operationId":operation,"operationItemId":item,"attemptNo":1,"localOperationKey":local_key}),
    )?);
    let mut fact = json!({"schemaVersion":1,"executionFactId":fact_id,"operationId":operation,"operationItemId":item,"workflowNodeId":node,"attemptId":attempt,"attemptNo":1,"approvedOperationId":p.approved_operation_id,"planHash":p.plan_hash,"idempotencyKeyHash":idempotency,"sourceDeviceId":c.source_device_id,"workspaceId":c.workspace_id,"activeLeaseEpoch":c.active_lease_epoch,"executionFactSequence":h.sequence+1,"eventType":p.action.event(),"evidenceLevel":"durable_local_claim","occurredAt":c.occurred_at,"signingKeyId":c.signing_key_id,"signingKeyVersion":c.signing_key_version,"credentialEpoch":c.credential_epoch,"trustedTimeAnchorId":c.trusted_time_anchor_id,"monotonicDeltaMs":c.monotonic_delta_ms,"requestStartBoundary":c.occurred_at,"authorizationHash":c.authorization_hash,"executionAuthorizationEvidence":{"approvedOperationDigest":approval_digest,"approvedOperationEnvelope":URL_SAFE_NO_PAD.encode(wire.as_bytes()),"signingKeyId":p.signing_key_id,"signingKeyVersion":p.signing_key_version,"credentialEpoch":p.credential_epoch,"signatureTranscriptVersion":1},"signatureTranscriptVersion":1,"payloadRedacted":payload,"auditEventRef":audit_id,"auditEventHash":audit_hash});
    let envelope = sign(
        &mut fact,
        FACT_DOMAIN,
        EvidenceSignaturePurpose::ExecutionFact,
        c,
        signer,
    )?;
    tx.execute("INSERT INTO device_execution_fact_outbox(workspace_id,source_device_id,active_lease_epoch,execution_fact_sequence,execution_fact_id,source_installation_digest,operation_id,item_id,attempt_number,attempt_id,audit_event_id,envelope_json,canonical_envelope,envelope_digest) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,1,?9,?10,?11,?12,?13)",params![c.workspace_id,c.source_device_id,sql(c.active_lease_epoch)?,h.sequence+1,fact_id,c.source_installation_digest,operation,item,attempt,audit_id,encoded(&fact)?,envelope,digest(&envelope)]).map_err(storage)?;
    advance(tx, c, "execution_fact", &h, &envelope, None)
}

#[derive(serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OwnershipPayload {
    schema_version: u8,
    provider: String,
    action: ListingPlanAction,
    stage: String,
    dispatch_semantics: String,
    deduplication_scope: String,
    request_digest: String,
    approval_envelope_digest: String,
    resource_binding_digest: String,
    preflight_observation_digest: String,
}
pub(super) fn decode_ownership_fact(wire: &str) -> Result<Value> {
    let f: ClaimFact<OwnershipPayload> = serde_json::from_str(wire).map_err(|_| rejected())?;
    let p = &f.payload_redacted;
    if f.event_type != "afternic_ownership_review_dispatch_claimed"
        || p.schema_version != 1
        || p.provider != "afternic"
        || p.action != ListingPlanAction::ReactivateOwnershipReview
        || p.stage != "dispatch_claimed"
        || p.dispatch_semantics != "local_claim_only"
        || p.deduplication_scope != "local_only"
    {
        return Err(rejected());
    }
    for d in [
        &p.resource_binding_digest,
        &p.preflight_observation_digest,
        &p.request_digest,
        &p.approval_envelope_digest,
    ] {
        if !URL_SAFE_NO_PAD
            .decode(d)
            .is_ok_and(|b| b.len() == 32 && URL_SAFE_NO_PAD.encode(b) == *d)
        {
            return Err(rejected());
        }
    }
    serde_json::to_value(f).map_err(|_| rejected())
}

#[expect(
    clippy::too_many_arguments,
    reason = "the exact approved item and authenticated observation share a signed source fence"
)]
pub(in crate::active_workspace::business) fn record_listing_plan_observation(
    tx: &Connection,
    c: &ExecutionEvidenceContext,
    fence: &EvidenceReadFence,
    operation: &str,
    item: &str,
    outcome: &str,
    reason: Option<&str>,
    preflight: bool,
    signer: &mut EvidenceSigner<'_>,
) -> Result<Option<String>> {
    if fence.source != c.source_device_id || fence.epoch != c.active_lease_epoch {
        return Err(rejected());
    }
    check_read_fence(tx, &c.workspace_id, fence)?;
    let (approval,attempt,plan_hash,request_digest,envelope_digest,wire):(String,String,String,String,String,String)=tx.query_row("SELECT a.approved_operation_id,i.attempt_id,a.plan_hash,i.request_digest,i.envelope_digest,i.envelope_json FROM afternic_listing_item_authorizations i JOIN afternic_listing_approvals a USING(workspace_id,approved_operation_id) WHERE i.workspace_id=?1 AND i.operation_id=?2 AND i.item_id=?3 AND i.attempt_number=1 AND a.action='listing_plan_v2'",params![c.workspace_id,operation,item],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?))).map_err(storage)?;
    let p: PlanApproval = serde_json::from_str(&wire).map_err(|_| rejected())?;
    let action = p.action;
    if preflight && outcome == "read_failed" {
        return Ok(None);
    }
    let payload = if preflight {
        let claimed:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM device_execution_fact_outbox WHERE workspace_id=?1 AND operation_id=?2 AND item_id=?3)",params![c.workspace_id,operation,item],|r|r.get(0)).map_err(storage)?;
        if claimed {
            return Err(rejected());
        }
        let satisfied = action == ListingPlanAction::ReactivateOwnershipReview
            && outcome == "satisfied"
            && reason.is_none();
        if !satisfied
            && !reason.is_some_and(|r| {
                matches!(
                    r,
                    "precondition_changed"
                        | "connection_changed"
                        | "listing_absent"
                        | "provider_state_blocked"
                ) || (action == ListingPlanAction::ReactivateOwnershipReview
                    && matches!(r, "cooldown" | "prior_outcome_unknown"))
                    || (action != ListingPlanAction::ReactivateOwnershipReview
                        && r == "already_present")
            })
        {
            return Err(rejected());
        }
        let mut payload = json!({"schemaVersion":action.version(),"provider":"afternic","action":action.name(),"stage":if satisfied{"preflight_satisfied"}else{"preflight_refused"},"approvedOperationId":approval,"operationId":operation,"operationItemId":item,"attemptId":attempt,"planHash":plan_hash,"requestDigest":request_digest,"approvalEnvelopeDigest":envelope_digest});
        if !satisfied {
            payload["reason"] = json!(reason);
        }
        payload
    } else {
        let valid = if action == ListingPlanAction::ReactivateOwnershipReview {
            match outcome {
                "confirmed" => reason.is_none(),
                "still_review" => reason == Some("postcondition_pending"),
                "read_failed" => reason == Some("read_failed"),
                "conflict" => matches!(
                    reason,
                    Some("precondition_changed" | "connection_changed" | "provider_state_blocked")
                ),
                _ => false,
            }
        } else {
            match outcome {
                "matched" => reason.is_none(),
                "absent" | "different" => reason == Some("postcondition_pending"),
                "read_failed" => reason == Some("read_failed"),
                "conflict" => matches!(
                    reason,
                    Some("precondition_changed" | "connection_changed" | "provider_state_blocked")
                ),
                _ => false,
            }
        };
        if !valid {
            return Err(rejected());
        }
        let (id,hash,stored_attempt,wire,envelope):(String,String,String,String,Vec<u8>)=tx.query_row("SELECT execution_fact_id,envelope_digest,attempt_id,envelope_json,canonical_envelope FROM device_execution_fact_outbox WHERE workspace_id=?1 AND operation_id=?2 AND item_id=?3 AND attempt_number=1",params![c.workspace_id,operation,item],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?))).map_err(storage)?;
        let fact = if action == ListingPlanAction::ReactivateOwnershipReview {
            decode_ownership_fact(&wire)?
        } else {
            serde_json::to_value(serde_json::from_str::<ClaimFact>(&wire).map_err(|_| rejected())?)
                .map_err(|_| rejected())?
        };
        if digest(&envelope) != hash
            || stored_attempt != attempt
            || fact["executionFactId"] != id
            || fact["attemptId"] != attempt
            || fact["operationId"] != operation
            || fact["operationItemId"] != item
            || fact["workspaceId"] != c.workspace_id
            || fact["payloadRedacted"]["action"] != action.name()
            || fact["eventType"] != action.event()
        {
            return Err(rejected());
        }
        json!({"schemaVersion":action.version(),"provider":"afternic","action":action.name(),"stage":"reconciled","operationId":operation,"operationItemId":item,"attemptId":attempt,"originalExecutionFactId":id,"originalExecutionFactDigest":hash,"outcome":outcome,"reason":reason})
    };
    audit(
        tx,
        c,
        "device_service",
        action.target(),
        &attempt,
        &payload,
        signer,
    )
    .map(|(id, _)| Some(id))
}

pub(in crate::active_workspace::business) fn require_listing_plan_claim(
    tx: &Connection,
    c: &ExecutionEvidenceContext,
    operation: &str,
    item: &str,
) -> Result<()> {
    let (wire,canonical,hash):(String,Vec<u8>,String)=tx.query_row("SELECT envelope_json,canonical_envelope,envelope_digest FROM device_execution_fact_outbox WHERE workspace_id=?1 AND operation_id=?2 AND item_id=?3 AND source_device_id=?4 AND active_lease_epoch=?5 AND source_installation_digest=?6",params![c.workspace_id,operation,item,c.source_device_id,sql(c.active_lease_epoch)?,c.source_installation_digest],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).map_err(storage)?;
    if digest(&canonical) != hash {
        return Err(rejected());
    }
    let value = validate_delivery_source(&wire, &canonical, c, false)?;
    if value["operationId"] != operation
        || value["operationItemId"] != item
        || value["credentialEpoch"] != c.credential_epoch
        || value["signingKeyId"] != c.signing_key_id
        || value["signingKeyVersion"] != c.signing_key_version
        || value["activeLeaseEpoch"] != c.active_lease_epoch
    {
        return Err(rejected());
    }
    Ok(())
}
