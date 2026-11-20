//! Actual Afternic user approval and dispatch claims, atomically owned by `BusinessDatabase`.
use super::afternic::random_id;
use super::{BusinessDatabaseError, append_frame, canonical_wire_value};
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use ring::signature::{ED25519, UnparsedPublicKey};
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
type Result<T> = std::result::Result<T, BusinessDatabaseError>;
const MAX_SEQUENCE: u64 = 9_007_199_254_740_991;
const DRAIN_GENESIS: &[u8] = b"GOODDEALER-DRAIN-SHA256-V1";
const AUDIT_GENESIS: &[u8] = b"GOODDEALER-DEVICE-AUDIT-CHAIN-GENESIS-V1";
const APPROVAL_DOMAIN: &str = "GOODDEALER-AFTERNIC-DELIST-ITEM-APPROVAL-V1";
const APPROVAL_ENVELOPE_DOMAIN: &str = "GOODDEALER-AFTERNIC-DELIST-ITEM-APPROVAL-ENVELOPE-V1";
const AUDIT_DOMAIN: &str = "GOODDEALER-DEVICE-AUDIT-EVENT-V1";
const FACT_DOMAIN: &str = "GOODDEALER-EXECUTION-FACT-V1";
const WRITE_APPROVAL_DOMAIN: &str = "GOODDEALER-AFTERNIC-LISTING-WRITE-ITEM-APPROVAL-V1";
const WRITE_APPROVAL_ENVELOPE_DOMAIN: &str =
    "GOODDEALER-AFTERNIC-LISTING-WRITE-ITEM-APPROVAL-ENVELOPE-V1";
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum AfternicEvidenceAction {
    Remove,
    Create,
    Update,
}
impl AfternicEvidenceAction {
    fn parse(s: &str) -> Result<Self> {
        match s {
            "remove" => Ok(Self::Remove),
            "create" => Ok(Self::Create),
            "update" => Ok(Self::Update),
            _ => Err(rejected()),
        }
    }
    fn as_str(self) -> &'static str {
        match self {
            Self::Remove => "remove",
            Self::Create => "create",
            Self::Update => "update",
        }
    }
    fn typ(self) -> &'static str {
        if self == Self::Remove {
            "gd.afternic-delist-item-approval.v1"
        } else {
            "gd.afternic-listing-write-item-approval.v1"
        }
    }
    fn approval_domain(self) -> &'static str {
        if self == Self::Remove {
            APPROVAL_DOMAIN
        } else {
            WRITE_APPROVAL_DOMAIN
        }
    }
    fn envelope_domain(self) -> &'static str {
        if self == Self::Remove {
            APPROVAL_ENVELOPE_DOMAIN
        } else {
            WRITE_APPROVAL_ENVELOPE_DOMAIN
        }
    }
    fn attempt_target(self) -> &'static str {
        if self == Self::Remove {
            "afternic_delist_attempt"
        } else {
            "afternic_listing_write_attempt"
        }
    }
    fn fact_event(self) -> &'static str {
        if self == Self::Remove {
            "afternic_delist_dispatch_claimed"
        } else {
            "afternic_listing_write_dispatch_claimed"
        }
    }
}
fn stored_action(
    tx: &Connection,
    workspace: &str,
    operation: &str,
) -> Result<AfternicEvidenceAction> {
    let action: String = tx.query_row("SELECT action FROM afternic_listing_approvals WHERE workspace_id=?1 AND operation_id=?2",params![workspace,operation],|r|r.get(0)).map_err(storage)?;
    AfternicEvidenceAction::parse(&action)
}
#[derive(Clone)]
pub(crate) struct ExecutionEvidenceContext {
    pub(crate) account_id: String,
    pub(crate) workspace_id: String,
    pub(crate) source_device_id: String,
    pub(crate) active_lease_epoch: u64,
    pub(crate) credential_epoch: u64,
    pub(crate) signing_key_id: String,
    pub(crate) signing_key_version: u64,
    pub(crate) authorization_hash: String,
    pub(crate) trusted_time_anchor_id: String,
    pub(crate) monotonic_delta_ms: u64,
    pub(crate) occurred_at: String,
    pub(crate) source_installation_digest: String,
    pub(crate) public_key: [u8; 32],
}
#[derive(Clone, Copy)]
pub(crate) enum EvidenceSignaturePurpose {
    AfternicDelistApproval,
    AfternicListingWriteApproval,
    AfternicListingPlanApproval,
    AfternicOwnershipReviewApproval,
    SellerHubBinPriceApproval,
    AtomStandardDelistApproval,
    DeviceAudit,
    ExecutionFact,
}
pub(crate) type EvidenceSigner<'a> =
    dyn FnMut(EvidenceSignaturePurpose, &[u8]) -> Result<[u8; 64]> + 'a;
pub(super) struct ApprovalTarget {
    pub(super) item_id: String,
    pub(super) request_digest: String,
}
fn storage(_: rusqlite::Error) -> BusinessDatabaseError {
    BusinessDatabaseError::StorageRejected
}
pub(super) fn sql(value: u64) -> Result<i64> {
    i64::try_from(value).map_err(|_| rejected())
}
fn rejected() -> BusinessDatabaseError {
    BusinessDatabaseError::MutationStale
}
fn encoded(value: &Value) -> Result<String> {
    serde_json::to_string(value).map_err(|_| rejected())
}
fn digest(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(bytes))
}
pub(crate) fn evidence_transcript(domain: &str, value: &Value) -> Result<Vec<u8>> {
    let mut bytes = Vec::new();
    append_frame(&mut bytes, b'd', domain.as_bytes());
    append_frame(&mut bytes, b'v', &canonical_wire_value(value)?);
    Ok(bytes)
}
pub(crate) fn hex_to_digest(value: &str) -> Result<String> {
    if value.len() != 64 {
        return Err(rejected());
    }
    let mut bytes = [0; 32];
    for (i, pair) in value.as_bytes().as_chunks::<2>().0.iter().enumerate() {
        let nibble = |v: u8| match v {
            b'0'..=b'9' => Some(v - b'0'),
            b'a'..=b'f' => Some(v - b'a' + 10),
            _ => None,
        };
        bytes[i] =
            (nibble(pair[0]).ok_or_else(rejected)? << 4) | nibble(pair[1]).ok_or_else(rejected)?;
    }
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}
fn sign(
    value: &mut Value,
    domain: &str,
    purpose: EvidenceSignaturePurpose,
    context: &ExecutionEvidenceContext,
    signer: &mut EvidenceSigner<'_>,
) -> Result<Vec<u8>> {
    let transcript = evidence_transcript(domain, value)?;
    let signature = signer(purpose, &transcript)?;
    UnparsedPublicKey::new(&ED25519, context.public_key)
        .verify(&transcript, &signature)
        .map_err(|_| rejected())?;
    let signature = URL_SAFE_NO_PAD.encode(signature);
    value["deviceSignature"] = json!(signature);
    // Stream v1 uses the existing signature transcript followed by the length-prefixed base64url signature.
    let mut envelope = transcript;
    envelope.extend(
        u32::try_from(signature.len())
            .map_err(|_| rejected())?
            .to_be_bytes(),
    );
    envelope.extend(signature.as_bytes());
    Ok(envelope)
}
fn validate_context(context: &ExecutionEvidenceContext) -> Result<()> {
    if [
        context.active_lease_epoch,
        context.credential_epoch,
        context.signing_key_version,
    ]
    .iter()
    .any(|v| *v == 0 || *v > MAX_SEQUENCE)
        || context.monotonic_delta_ms > MAX_SEQUENCE
    {
        return Err(rejected());
    }
    for value in [
        &context.account_id,
        &context.workspace_id,
        &context.source_device_id,
        &context.signing_key_id,
    ] {
        if value.is_empty()
            || value.len() > 160
            || !value.bytes().all(|b| (0x21..=0x7e).contains(&b))
        {
            return Err(rejected());
        }
    }
    for value in [
        &context.authorization_hash,
        &context.trusted_time_anchor_id,
        &context.source_installation_digest,
    ] {
        if !URL_SAFE_NO_PAD
            .decode(value)
            .is_ok_and(|b| b.len() == 32 && URL_SAFE_NO_PAD.encode(b) == *value)
        {
            return Err(rejected());
        }
    }
    super::validate_timestamp(Some(context.occurred_at.clone())).map_err(|_| rejected())?;
    Ok(())
}
struct Head {
    sequence: i64,
    rolling: String,
    audit_hash: Option<String>,
}
fn head(tx: &Connection, context: &ExecutionEvidenceContext, stream: &str) -> Result<Head> {
    validate_context(context)?;
    require_no_barrier(tx, &context.workspace_id)?;
    let audit_hash = (stream == "device_audit").then(|| digest(AUDIT_GENESIS));
    tx.execute("INSERT OR IGNORE INTO execution_evidence_stream_heads(workspace_id,source_device_id,active_lease_epoch,stream,source_installation_digest,last_sequence,rolling_digest,audit_head_hash,producer_state) VALUES(?1,?2,?3,?4,?5,0,?6,?7,'open')",params![context.workspace_id,context.source_device_id,sql(context.active_lease_epoch)?,stream,context.source_installation_digest,digest(DRAIN_GENESIS),audit_hash]).map_err(storage)?;
    let (sequence,rolling,audit_hash,origin,state):(i64,String,Option<String>,String,String)=tx.query_row("SELECT last_sequence,rolling_digest,audit_head_hash,source_installation_digest,producer_state FROM execution_evidence_stream_heads WHERE workspace_id=?1 AND source_device_id=?2 AND active_lease_epoch=?3 AND stream=?4",params![context.workspace_id,context.source_device_id,sql(context.active_lease_epoch)?,stream],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?))).map_err(storage)?;
    if state != "open"
        || origin != context.source_installation_digest
        || sequence >= 9_007_199_254_740_991
    {
        return Err(rejected());
    }
    Ok(Head {
        sequence,
        rolling,
        audit_hash,
    })
}
fn advance(
    tx: &Connection,
    context: &ExecutionEvidenceContext,
    stream: &str,
    old: &Head,
    envelope: &[u8],
    audit_hash: Option<&str>,
) -> Result<()> {
    let mut bytes = URL_SAFE_NO_PAD
        .decode(&old.rolling)
        .map_err(|_| rejected())?;
    if bytes.len() != 32 {
        return Err(rejected());
    }
    bytes.extend(
        u32::try_from(envelope.len())
            .map_err(|_| rejected())?
            .to_be_bytes(),
    );
    bytes.extend(envelope);
    let changed=tx.execute("UPDATE execution_evidence_stream_heads SET last_sequence=last_sequence+1,rolling_digest=?5,audit_head_hash=?6 WHERE workspace_id=?1 AND source_device_id=?2 AND active_lease_epoch=?3 AND stream=?4 AND last_sequence=?7 AND rolling_digest=?8 AND producer_state='open' AND source_installation_digest=?9",params![context.workspace_id,context.source_device_id,sql(context.active_lease_epoch)?,stream,digest(&bytes),audit_hash,old.sequence,old.rolling,context.source_installation_digest]).map_err(storage)?;
    if changed != 1 {
        return Err(rejected());
    }
    Ok(())
}
fn audit(
    tx: &Connection,
    context: &ExecutionEvidenceContext,
    actor: &str,
    target_type: &str,
    target: &str,
    payload: &Value,
    signer: &mut EvidenceSigner<'_>,
) -> Result<(String, String)> {
    let h = head(tx, context, "device_audit")?;
    let event_id = random_id()?;
    let chain_id = digest(&evidence_transcript(
        "GOODDEALER-DEVICE-AUDIT-CHAIN-V1",
        &json!({"scope":"workspace","workspaceId":context.workspace_id,"sourceDeviceId":context.source_device_id,"activeLeaseEpoch":context.active_lease_epoch}),
    )?);
    let runtime = matches!(
        payload["stage"].as_str(),
        Some("reconciled" | "preflight_refused" | "preflight_satisfied")
    );
    let event_type = if runtime {
        "runtime_security_lifecycle"
    } else {
        "approved_operation_execution"
    };
    let authorization_source = if runtime {
        "runtime_security_context"
    } else {
        "approved_operation"
    };
    let mut event = json!({"schemaVersion":1,"auditEventId":event_id,"auditEventKind":"device","eventType":event_type,"accountId":context.account_id,"actorKind":actor,"authorizationSource":authorization_source,"targetType":target_type,"targetRef":target,"sourceDeviceId":context.source_device_id,"credentialEpoch":context.credential_epoch,"chainId":chain_id,"auditSequence":h.sequence+1,"previousHash":h.audit_hash,"occurredAt":context.occurred_at,"signingKeyId":context.signing_key_id,"signingKeyVersion":context.signing_key_version,"signingKeyPurpose":"device_identity_audit","trustedTimeAnchorId":context.trusted_time_anchor_id,"monotonicDeltaMs":context.monotonic_delta_ms,"authorizationContextHash":context.authorization_hash,"signatureTranscriptVersion":1,"payloadRedacted":payload,"scopeKind":"workspace","workspaceId":context.workspace_id,"activeLeaseEpoch":context.active_lease_epoch});
    let hash = digest(&evidence_transcript(
        "GOODDEALER-DEVICE-AUDIT-EVENT-HASH-V1",
        &event,
    )?);
    event["eventHash"] = json!(hash);
    let envelope = sign(
        &mut event,
        AUDIT_DOMAIN,
        EvidenceSignaturePurpose::DeviceAudit,
        context,
        signer,
    )?;
    tx.execute("INSERT INTO workspace_device_audit_outbox(workspace_id,source_device_id,active_lease_epoch,audit_sequence,audit_event_id,source_installation_digest,chain_id,previous_hash,event_hash,envelope_json,canonical_envelope,envelope_digest) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",params![context.workspace_id,context.source_device_id,sql(context.active_lease_epoch)?,h.sequence+1,event_id,context.source_installation_digest,chain_id,h.audit_hash,hash,encoded(&event)?,envelope,digest(&envelope)]).map_err(storage)?;
    advance(tx, context, "device_audit", &h, &envelope, Some(&hash))?;
    Ok((event_id, hash))
}

pub(super) fn record_approval(
    tx: &Connection,
    context: &ExecutionEvidenceContext,
    plan: &str,
    operation: &str,
    plan_hash: &str,
    targets: &[ApprovalTarget],
    signer: &mut EvidenceSigner<'_>,
) -> Result<()> {
    record_action_approval(
        tx,
        context,
        plan,
        operation,
        plan_hash,
        targets,
        AfternicEvidenceAction::Remove,
        signer,
    )
}

#[expect(
    clippy::too_many_arguments,
    reason = "closed Afternic actions share the original evidence stream and transaction"
)]
pub(super) fn record_action_approval(
    tx: &Connection,
    context: &ExecutionEvidenceContext,
    plan: &str,
    operation: &str,
    plan_hash: &str,
    targets: &[ApprovalTarget],
    action: AfternicEvidenceAction,
    signer: &mut EvidenceSigner<'_>,
) -> Result<()> {
    if targets.is_empty() || targets.len() > 500 {
        return Err(rejected());
    }
    let plan_hash = hex_to_digest(plan_hash)?;
    let approval_id = random_id()?;
    let mut ordered = targets.iter().collect::<Vec<_>>();
    ordered.sort_unstable_by_key(|t| &t.item_id);
    if ordered.windows(2).any(|p| p[0].item_id == p[1].item_id) {
        return Err(rejected());
    }
    let items=ordered.iter().map(|t|Ok(json!({"operationItemId":t.item_id,"requestDigest":hex_to_digest(&t.request_digest)?}))).collect::<Result<Vec<_>>>()?;
    let mut target_value = json!({"schemaVersion":1,"planId":plan,"items":items});
    if action != AfternicEvidenceAction::Remove {
        target_value["action"] = json!(action.as_str());
    }
    let target_set = digest(&evidence_transcript(
        if action == AfternicEvidenceAction::Remove {
            "GOODDEALER-AFTERNIC-DELIST-TARGET-SET-V1"
        } else {
            "GOODDEALER-AFTERNIC-LISTING-WRITE-TARGET-SET-V1"
        },
        &target_value,
    )?);
    let (audit_id, _) = audit(
        tx,
        context,
        "user",
        if action == AfternicEvidenceAction::Remove {
            "afternic_delist_approval"
        } else {
            "afternic_listing_write_approval"
        },
        &approval_id,
        &json!({"schemaVersion":1,"provider":"afternic","action":action.as_str(),"stage":"approved","approvedOperationId":approval_id,"operationId":operation,"planId":plan,"planHash":plan_hash,"targetCount":targets.len(),"targetSetDigest":target_set}),
        signer,
    )?;
    tx.execute("INSERT INTO afternic_listing_approvals(workspace_id,approved_operation_id,operation_id,plan_id,plan_hash,target_count,target_set_digest,source_device_id,active_lease_epoch,credential_epoch,signing_key_id,signing_key_version,source_installation_digest,approved_at,audit_event_id,action) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)",params![context.workspace_id,approval_id,operation,plan,plan_hash,i64::try_from(targets.len()).map_err(|_|rejected())?,target_set,context.source_device_id,sql(context.active_lease_epoch)?,sql(context.credential_epoch)?,context.signing_key_id,sql(context.signing_key_version)?,context.source_installation_digest,context.occurred_at,audit_id,action.as_str()]).map_err(storage)?;
    for target in targets {
        let request_digest = hex_to_digest(&target.request_digest)?;
        let mut approval = json!({"schemaVersion":1,"typ":action.typ(),"aud":"gooddealer-cloud/execution-evidence","approvedOperationId":approval_id,"operationId":operation,"operationItemId":target.item_id,"planId":plan,"planHash":plan_hash,"targetCount":targets.len(),"targetSetDigest":target_set,"capability":"afternic:marketplace:write","action":action.as_str(),"requestDigest":request_digest,"accountId":context.account_id,"workspaceId":context.workspace_id,"sourceDeviceId":context.source_device_id,"activeLeaseEpoch":context.active_lease_epoch,"credentialEpoch":context.credential_epoch,"signingKeyId":context.signing_key_id,"signingKeyVersion":context.signing_key_version,"authorizationHash":context.authorization_hash,"trustedTimeAnchorId":context.trusted_time_anchor_id,"monotonicDeltaMs":context.monotonic_delta_ms,"approvedAt":context.occurred_at,"signatureTranscriptVersion":1});
        sign(
            &mut approval,
            action.approval_domain(),
            if action == AfternicEvidenceAction::Remove {
                EvidenceSignaturePurpose::AfternicDelistApproval
            } else {
                EvidenceSignaturePurpose::AfternicListingWriteApproval
            },
            context,
            signer,
        )?;
        let hash = digest(&evidence_transcript(action.envelope_domain(), &approval)?);
        tx.execute("INSERT INTO afternic_listing_item_authorizations(workspace_id,approved_operation_id,operation_id,plan_id,item_id,attempt_number,attempt_id,workflow_node_id,request_digest,envelope_json,envelope_digest) VALUES(?1,?2,?3,?4,?5,1,?6,?7,?8,?9,?10)",params![context.workspace_id,approval_id,operation,plan,target.item_id,random_id()?,random_id()?,request_digest,encoded(&approval)?,hash]).map_err(storage)?;
    }
    Ok(())
}

#[derive(serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ApprovalEnvelope {
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
    action: String,
    request_digest: String,
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
#[expect(
    clippy::too_many_arguments,
    reason = "checks the exact immutable approval against all persisted source identities"
)]
fn verify_approval(
    json: &str,
    expected_digest: &str,
    context: &ExecutionEvidenceContext,
    operation: &str,
    item: &str,
    approval: &str,
    plan_hash: &str,
    request_digest: &str,
    action: AfternicEvidenceAction,
) -> Result<()> {
    if json.is_empty() || json.len() > 6144 {
        return Err(rejected());
    }
    let parsed: ApprovalEnvelope = serde_json::from_str(json).map_err(|_| rejected())?;
    if parsed.schema_version != 1
        || parsed.typ != action.typ()
        || parsed.aud != "gooddealer-cloud/execution-evidence"
        || parsed.capability != "afternic:marketplace:write"
        || parsed.action != action.as_str()
        || parsed.signature_transcript_version != 1
        || !(1..=500).contains(&parsed.target_count)
        || parsed.monotonic_delta_ms > MAX_SEQUENCE
        || parsed.account_id != context.account_id
        || parsed.workspace_id != context.workspace_id
        || parsed.source_device_id != context.source_device_id
        || parsed.active_lease_epoch != context.active_lease_epoch
        || parsed.credential_epoch != context.credential_epoch
        || parsed.signing_key_id != context.signing_key_id
        || parsed.signing_key_version != context.signing_key_version
        || parsed.operation_id != operation
        || parsed.operation_item_id != item
        || parsed.approved_operation_id != approval
        || parsed.plan_hash != plan_hash
        || parsed.request_digest != request_digest
    {
        return Err(rejected());
    }
    verify_approval_envelope(
        &parsed,
        expected_digest,
        context,
        action.approval_domain(),
        action.envelope_domain(),
    )
}

fn verify_approval_envelope(
    parsed: &ApprovalEnvelope,
    expected_digest: &str,
    context: &ExecutionEvidenceContext,
    signature_domain: &str,
    envelope_domain: &str,
) -> Result<()> {
    for value in [
        &parsed.plan_id,
        &parsed.operation_id,
        &parsed.operation_item_id,
        &parsed.approved_operation_id,
    ] {
        if !super::is_uuid_v4(value) {
            return Err(rejected());
        }
    }
    for value in [
        &parsed.plan_hash,
        &parsed.request_digest,
        &parsed.target_set_digest,
        &parsed.authorization_hash,
        &parsed.trusted_time_anchor_id,
    ] {
        if !URL_SAFE_NO_PAD
            .decode(value)
            .is_ok_and(|b| b.len() == 32 && URL_SAFE_NO_PAD.encode(b) == *value)
        {
            return Err(rejected());
        }
    }
    super::validate_timestamp(Some(parsed.approved_at.clone())).map_err(|_| rejected())?;
    let mut value = serde_json::to_value(parsed).map_err(|_| rejected())?;
    if digest(&evidence_transcript(envelope_domain, &value)?) != expected_digest {
        return Err(rejected());
    }
    value
        .as_object_mut()
        .ok_or_else(rejected)?
        .remove("deviceSignature");
    let signature = URL_SAFE_NO_PAD
        .decode(&parsed.device_signature)
        .map_err(|_| rejected())?;
    if signature.len() != 64 || URL_SAFE_NO_PAD.encode(&signature) != parsed.device_signature {
        return Err(rejected());
    }
    UnparsedPublicKey::new(&ED25519, context.public_key)
        .verify(&evidence_transcript(signature_domain, &value)?, &signature)
        .map_err(|_| rejected())
}

#[expect(
    clippy::type_complexity,
    reason = "one SQL row joins the complete immutable approval and original dispatch identity"
)]
pub(super) fn record_claim(
    tx: &Connection,
    context: &ExecutionEvidenceContext,
    operation: &str,
    item: &str,
    request_digest: &str,
    signer: &mut EvidenceSigner<'_>,
) -> Result<()> {
    if tx.query_row("SELECT EXISTS(SELECT 1 FROM afternic_listing_approvals WHERE workspace_id=?1 AND operation_id=?2 AND action='listing_plan_v2')",params![context.workspace_id,operation],|r|r.get::<_,bool>(0)).map_err(storage)? {
        return listing_plan::record_listing_plan_claim(tx,context,operation,item,request_digest,None,signer);
    }
    let action = stored_action(tx, &context.workspace_id, operation)?;
    let (approval_id,attempt_id,node_id,approval_json,approval_digest,plan_hash,local_key,source,epoch,credential,key,key_version,origin):(String,String,String,String,String,String,String,String,i64,i64,String,i64,String)=tx.query_row("SELECT a.approved_operation_id,i.attempt_id,i.workflow_node_id,i.envelope_json,i.envelope_digest,a.plan_hash,o.idempotency_key,a.source_device_id,a.active_lease_epoch,a.credential_epoch,a.signing_key_id,a.signing_key_version,a.source_installation_digest FROM afternic_listing_item_authorizations i JOIN afternic_listing_approvals a USING(workspace_id,approved_operation_id) JOIN operations o ON o.workspace_id=i.workspace_id AND o.operation_id=i.operation_id WHERE i.workspace_id=?1 AND i.operation_id=?2 AND i.item_id=?3 AND i.attempt_number=1 AND i.request_digest=?4",params![context.workspace_id,operation,item,hex_to_digest(request_digest)?],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?,r.get(7)?,r.get(8)?,r.get(9)?,r.get(10)?,r.get(11)?,r.get(12)?))).map_err(|_|rejected())?;
    if source != context.source_device_id
        || epoch != sql(context.active_lease_epoch)?
        || credential != sql(context.credential_epoch)?
        || key != context.signing_key_id
        || key_version != sql(context.signing_key_version)?
        || origin != context.source_installation_digest
    {
        return Err(rejected());
    }
    let request_digest = hex_to_digest(request_digest)?;
    verify_approval(
        &approval_json,
        &approval_digest,
        context,
        operation,
        item,
        &approval_id,
        &plan_hash,
        &request_digest,
        action,
    )?;
    let (audit_id, audit_hash) = audit(
        tx,
        context,
        "device_service",
        action.attempt_target(),
        &attempt_id,
        &json!({"schemaVersion":1,"provider":"afternic","action":action.as_str(),"stage":"dispatch_claimed","approvedOperationId":approval_id,"operationId":operation,"operationItemId":item,"attemptId":attempt_id,"attemptNo":1,"planHash":plan_hash,"requestDigest":request_digest,"approvalEnvelopeDigest":approval_digest}),
        signer,
    )?;
    let h = head(tx, context, "execution_fact")?;
    let fact_id = random_id()?;
    let idempotency = digest(&evidence_transcript(
        "GOODDEALER-AFTERNIC-LOCAL-DISPATCH-KEY-V1",
        &json!({"schemaVersion":1,"operationId":operation,"operationItemId":item,"attemptNo":1,"localOperationKey":local_key}),
    )?);
    let mut fact = json!({"schemaVersion":1,"executionFactId":fact_id,"operationId":operation,"operationItemId":item,"workflowNodeId":node_id,"attemptId":attempt_id,"attemptNo":1,"approvedOperationId":approval_id,"planHash":plan_hash,"idempotencyKeyHash":idempotency,"sourceDeviceId":context.source_device_id,"workspaceId":context.workspace_id,"activeLeaseEpoch":context.active_lease_epoch,"executionFactSequence":h.sequence+1,"eventType":action.fact_event(),"evidenceLevel":"durable_local_claim","occurredAt":context.occurred_at,"signingKeyId":context.signing_key_id,"signingKeyVersion":context.signing_key_version,"credentialEpoch":context.credential_epoch,"trustedTimeAnchorId":context.trusted_time_anchor_id,"monotonicDeltaMs":context.monotonic_delta_ms,"requestStartBoundary":context.occurred_at,"authorizationHash":context.authorization_hash,"executionAuthorizationEvidence":{"approvedOperationDigest":approval_digest,"approvedOperationEnvelope":URL_SAFE_NO_PAD.encode(approval_json.as_bytes()),"signingKeyId":key,"signingKeyVersion":key_version,"credentialEpoch":credential,"signatureTranscriptVersion":1},"signatureTranscriptVersion":1,"payloadRedacted":{"schemaVersion":1,"provider":"afternic","action":action.as_str(),"stage":"dispatch_claimed","dispatchSemantics":"local_claim_only","deduplicationScope":"local_only","requestDigest":request_digest,"approvalEnvelopeDigest":approval_digest},"auditEventRef":audit_id,"auditEventHash":audit_hash});
    let envelope = sign(
        &mut fact,
        FACT_DOMAIN,
        EvidenceSignaturePurpose::ExecutionFact,
        context,
        signer,
    )?;
    tx.execute("INSERT INTO device_execution_fact_outbox(workspace_id,source_device_id,active_lease_epoch,execution_fact_sequence,execution_fact_id,source_installation_digest,operation_id,item_id,attempt_number,attempt_id,audit_event_id,envelope_json,canonical_envelope,envelope_digest) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,1,?9,?10,?11,?12,?13)",params![context.workspace_id,context.source_device_id,sql(context.active_lease_epoch)?,h.sequence+1,fact_id,context.source_installation_digest,operation,item,attempt_id,audit_id,encoded(&fact)?,envelope,digest(&envelope)]).map_err(storage)?;
    advance(tx, context, "execution_fact", &h, &envelope, None)
}

pub(super) fn require_claim(
    tx: &Connection,
    context: &ExecutionEvidenceContext,
    operation: &str,
    item: &str,
) -> Result<()> {
    if tx.query_row("SELECT EXISTS(SELECT 1 FROM afternic_listing_approvals WHERE workspace_id=?1 AND operation_id=?2 AND action='listing_plan_v2')",params![context.workspace_id,operation],|r|r.get::<_,bool>(0)).map_err(storage)? {
        return listing_plan::require_listing_plan_claim(tx,context,operation,item);
    }
    let action = stored_action(tx, &context.workspace_id, operation)?;
    let stored: Option<(String,Vec<u8>,String)> = tx.query_row("SELECT envelope_json,canonical_envelope,envelope_digest FROM device_execution_fact_outbox WHERE workspace_id=?1 AND operation_id=?2 AND item_id=?3 AND attempt_number=1 AND source_device_id=?4 AND active_lease_epoch=?5 AND source_installation_digest=?6",params![context.workspace_id,operation,item,context.source_device_id,sql(context.active_lease_epoch)?,context.source_installation_digest],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional().map_err(storage)?;
    let (wire, envelope, hash) = stored.ok_or_else(rejected)?;
    if wire.len() > 32768 || digest(&envelope) != hash {
        return Err(rejected());
    }
    let fact: ClaimFact = serde_json::from_str(&wire).map_err(|_| rejected())?;
    if fact.schema_version != 1
        || fact.signature_transcript_version != 1
        || fact.attempt_no != 1
        || fact.event_type != action.fact_event()
        || fact.payload_redacted.action != action.as_str()
        || fact.evidence_level != "durable_local_claim"
        || fact.workspace_id != context.workspace_id
        || fact.source_device_id != context.source_device_id
        || fact.active_lease_epoch != context.active_lease_epoch
        || fact.credential_epoch != context.credential_epoch
        || fact.signing_key_id != context.signing_key_id
        || fact.signing_key_version != context.signing_key_version
        || fact.operation_id != operation
        || fact.operation_item_id != item
    {
        return Err(rejected());
    }
    let mut value = serde_json::to_value(&fact).map_err(|_| rejected())?;
    value
        .as_object_mut()
        .ok_or_else(rejected)?
        .remove("deviceSignature");
    let transcript = evidence_transcript(FACT_DOMAIN, &value)?;
    let signature = URL_SAFE_NO_PAD
        .decode(&fact.device_signature)
        .map_err(|_| rejected())?;
    if signature.len() != 64 || URL_SAFE_NO_PAD.encode(&signature) != fact.device_signature {
        return Err(rejected());
    }
    UnparsedPublicKey::new(&ED25519, context.public_key)
        .verify(&transcript, &signature)
        .map_err(|_| rejected())?;
    let mut expected = transcript;
    expected.extend(
        u32::try_from(fact.device_signature.len())
            .map_err(|_| rejected())?
            .to_be_bytes(),
    );
    expected.extend(fact.device_signature.as_bytes());
    if expected != envelope {
        return Err(rejected());
    }
    Ok(())
}
#[derive(serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ClaimFact<P = ClaimPayload> {
    schema_version: u8,
    execution_fact_id: String,
    operation_id: String,
    operation_item_id: String,
    workflow_node_id: String,
    attempt_id: String,
    attempt_no: u8,
    approved_operation_id: String,
    plan_hash: String,
    idempotency_key_hash: String,
    source_device_id: String,
    workspace_id: String,
    active_lease_epoch: u64,
    execution_fact_sequence: u64,
    event_type: String,
    evidence_level: String,
    occurred_at: String,
    signing_key_id: String,
    signing_key_version: u64,
    credential_epoch: u64,
    trusted_time_anchor_id: String,
    monotonic_delta_ms: u64,
    request_start_boundary: String,
    authorization_hash: String,
    execution_authorization_evidence: ClaimAuthorization,
    signature_transcript_version: u8,
    payload_redacted: P,
    audit_event_ref: String,
    audit_event_hash: String,
    device_signature: String,
}
#[derive(serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ClaimAuthorization {
    approved_operation_digest: String,
    approved_operation_envelope: String,
    signing_key_id: String,
    signing_key_version: u64,
    credential_epoch: u64,
    signature_transcript_version: u8,
}
#[derive(serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ClaimPayload {
    schema_version: u8,
    provider: String,
    action: String,
    stage: String,
    dispatch_semantics: String,
    deduplication_scope: String,
    request_digest: String,
    approval_envelope_digest: String,
}

#[cfg(test)]
pub(super) fn test_context(
    workspace: &str,
    at: &str,
) -> (
    ExecutionEvidenceContext,
    impl FnMut(EvidenceSignaturePurpose, &[u8]) -> Result<[u8; 64]> + use<>,
) {
    use ring::signature::KeyPair as _;
    let pair = ring::signature::Ed25519KeyPair::from_seed_unchecked(&[0x31; 32]).unwrap();
    let context = ExecutionEvidenceContext {
        account_id: "account-test".into(),
        workspace_id: workspace.into(),
        source_device_id: "device-test".into(),
        active_lease_epoch: 1,
        credential_epoch: 2,
        signing_key_id: "device-test-key".into(),
        signing_key_version: 1,
        authorization_hash: URL_SAFE_NO_PAD.encode([1; 32]),
        trusted_time_anchor_id: URL_SAFE_NO_PAD.encode([2; 32]),
        monotonic_delta_ms: 100,
        occurred_at: at.into(),
        source_installation_digest: URL_SAFE_NO_PAD.encode([3; 32]),
        public_key: pair.public_key().as_ref().try_into().unwrap(),
    };
    (context, move |_, bytes| {
        Ok(pair.sign(bytes).as_ref().try_into().unwrap())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn afternic_execution_evidence_matches_all_protocol_golden_transcripts_and_signatures() {
        for wire in [
            include_str!(
                "../../../../../packages/protocol/test-vectors/afternic-execution-evidence/valid.json"
            ),
            include_str!(
                "../../../../../packages/protocol/test-vectors/afternic-listing-write-evidence/create.json"
            ),
            include_str!(
                "../../../../../packages/protocol/test-vectors/afternic-listing-write-evidence/update.json"
            ),
        ] {
            assert_evidence_fixture(wire);
        }
    }
    fn assert_evidence_fixture(wire: &str) {
        let fixture: Value = serde_json::from_str(wire).unwrap();
        let action =
            AfternicEvidenceAction::parse(fixture["approval"]["action"].as_str().unwrap()).unwrap();
        let hex = |bytes: &[u8]| {
            bytes.iter().fold(String::new(), |mut text, b| {
                use std::fmt::Write as _;
                write!(&mut text, "{b:02x}").unwrap();
                text
            })
        };
        let mut approval = fixture["approval"].clone();
        approval.as_object_mut().unwrap().remove("deviceSignature");
        let transcript = evidence_transcript(action.approval_domain(), &approval).unwrap();
        assert_eq!(hex(&transcript), fixture["bytes"]["approvalTranscript"]);
        assert_eq!(
            hex(&evidence_transcript(action.envelope_domain(), &fixture["approval"]).unwrap()),
            fixture["bytes"]["approvalEnvelope"]
        );
        for (key, domain) in [
            (
                "targetSet",
                if action == AfternicEvidenceAction::Remove {
                    "GOODDEALER-AFTERNIC-DELIST-TARGET-SET-V1"
                } else {
                    "GOODDEALER-AFTERNIC-LISTING-WRITE-TARGET-SET-V1"
                },
            ),
            ("dispatchKey", "GOODDEALER-AFTERNIC-LOCAL-DISPATCH-KEY-V1"),
        ] {
            assert_eq!(
                hex(&evidence_transcript(domain, &fixture[key]).unwrap()),
                fixture["bytes"][key]
            );
        }
        assert_eq!(digest(AUDIT_GENESIS), fixture["deviceAuditGenesisDigest"]);
        let public = URL_SAFE_NO_PAD
            .decode(fixture["devicePublicKey"].as_str().unwrap())
            .unwrap();
        for (key, domain, envelope_key) in [
            ("claimAudit", AUDIT_DOMAIN, "claimAuditEnvelope"),
            ("fact", FACT_DOMAIN, "executionFactEnvelope"),
        ] {
            let mut value = fixture[key].clone();
            let signature = value
                .as_object_mut()
                .unwrap()
                .remove("deviceSignature")
                .unwrap()
                .as_str()
                .unwrap()
                .to_owned();
            let mut envelope = evidence_transcript(domain, &value).unwrap();
            UnparsedPublicKey::new(&ED25519, &public)
                .verify(&envelope, &URL_SAFE_NO_PAD.decode(&signature).unwrap())
                .unwrap();
            envelope.extend(u32::try_from(signature.len()).unwrap().to_be_bytes());
            envelope.extend(signature.as_bytes());
            assert_eq!(hex(&envelope), fixture["bytes"][envelope_key]);
        }
        for (key, hash_key) in [
            ("approvalAudit", "approvalAuditHashInput"),
            ("claimAudit", "claimAuditHashInput"),
        ] {
            let mut value = fixture[key].clone();
            value.as_object_mut().unwrap().remove("deviceSignature");
            value.as_object_mut().unwrap().remove("eventHash");
            let bytes =
                evidence_transcript("GOODDEALER-DEVICE-AUDIT-EVENT-HASH-V1", &value).unwrap();
            assert_eq!(hex(&bytes), fixture["bytes"][hash_key]);
            assert_eq!(digest(&bytes), fixture[key]["eventHash"]);
        }
    }
}

#[derive(Clone)]
pub(super) struct EvidenceReadFence {
    source: String,
    epoch: u64,
    generation: i64,
}
pub(super) fn require_no_barrier(tx: &Connection, workspace: &str) -> Result<()> {
    let blocked: bool = tx
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM device_handoff_barriers WHERE workspace_id=?1)",
            [workspace],
            |r| r.get(0),
        )
        .map_err(storage)?;
    if blocked {
        return Err(rejected());
    }
    Ok(())
}
pub(super) fn read_fence(
    tx: &Connection,
    context: &ExecutionEvidenceContext,
) -> Result<EvidenceReadFence> {
    head(tx, context, "device_audit")?;
    head(tx, context, "execution_fact")?;
    let generation = tx.query_row("SELECT admission_generation FROM execution_evidence_stream_heads WHERE workspace_id=?1 AND source_device_id=?2 AND active_lease_epoch=?3 AND stream='device_audit'",params![context.workspace_id,context.source_device_id,sql(context.active_lease_epoch)?],|r|r.get(0)).map_err(storage)?;
    Ok(EvidenceReadFence {
        source: context.source_device_id.clone(),
        epoch: context.active_lease_epoch,
        generation,
    })
}
pub(super) fn check_read_fence(
    tx: &Connection,
    workspace: &str,
    fence: &EvidenceReadFence,
) -> Result<()> {
    require_no_barrier(tx, workspace)?;
    let valid:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM execution_evidence_stream_heads WHERE workspace_id=?1 AND source_device_id=?2 AND active_lease_epoch=?3 AND stream='device_audit' AND producer_state='open' AND admission_generation=?4)",params![workspace,fence.source,sql(fence.epoch)?,fence.generation],|r|r.get(0)).map_err(storage)?;
    if !valid {
        return Err(rejected());
    }
    Ok(())
}
#[expect(
    clippy::too_many_arguments,
    reason = "one exact existing attempt and its actual observation form the result audit"
)]
pub(super) fn record_observation(
    tx: &Connection,
    context: &ExecutionEvidenceContext,
    fence: &EvidenceReadFence,
    operation: &str,
    item: &str,
    outcome: &str,
    reason: Option<&str>,
    preflight: bool,
    signer: &mut EvidenceSigner<'_>,
) -> Result<Option<String>> {
    if tx.query_row("SELECT EXISTS(SELECT 1 FROM afternic_listing_approvals WHERE workspace_id=?1 AND operation_id=?2 AND action='listing_plan_v2')",params![context.workspace_id,operation],|r|r.get::<_,bool>(0)).map_err(storage)? {
        return listing_plan::record_listing_plan_observation(tx,context,fence,operation,item,outcome,reason,preflight,signer);
    }
    let action = stored_action(tx, &context.workspace_id, operation)?;
    if fence.source != context.source_device_id || fence.epoch != context.active_lease_epoch {
        return Err(rejected());
    }
    check_read_fence(tx, &context.workspace_id, fence)?;
    // A failed preflight GET is backoff, not a terminal decision or a fabricated execution fact.
    if preflight && outcome == "read_failed" {
        return Ok(None);
    }
    let payload = if preflight {
        let (approval,attempt,plan_hash,request_digest,envelope_digest):(String,String,String,String,String)=tx.query_row("SELECT a.approved_operation_id,i.attempt_id,a.plan_hash,i.request_digest,i.envelope_digest FROM afternic_listing_item_authorizations i JOIN afternic_listing_approvals a USING(workspace_id,approved_operation_id) WHERE i.workspace_id=?1 AND i.operation_id=?2 AND i.item_id=?3 AND i.attempt_number=1",params![context.workspace_id,operation,item],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?))).map_err(|_|rejected())?;
        let reason = if action == AfternicEvidenceAction::Remove && outcome == "absent" {
            "already_absent"
        } else {
            reason
                .filter(|r| {
                    matches!(*r, "precondition_changed" | "connection_changed")
                        || (action != AfternicEvidenceAction::Remove
                            && matches!(
                                *r,
                                "already_present" | "listing_absent" | "provider_state_blocked"
                            ))
                })
                .ok_or_else(rejected)?
        };
        json!({"schemaVersion":1,"provider":"afternic","action":action.as_str(),"stage":"preflight_refused","approvedOperationId":approval,"operationId":operation,"operationItemId":item,"attemptId":attempt,"planHash":plan_hash,"requestDigest":request_digest,"approvalEnvelopeDigest":envelope_digest,"reason":reason})
    } else {
        let (id,hash,attempt,wire,envelope):(String,String,String,String,Vec<u8>)=tx.query_row("SELECT execution_fact_id,envelope_digest,attempt_id,envelope_json,canonical_envelope FROM device_execution_fact_outbox WHERE workspace_id=?1 AND operation_id=?2 AND item_id=?3 AND attempt_number=1",params![context.workspace_id,operation,item],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?))).map_err(|_|rejected())?;
        let fact: ClaimFact = serde_json::from_str(&wire).map_err(|_| rejected())?;
        if digest(&envelope) != hash
            || fact.execution_fact_id != id
            || fact.attempt_id != attempt
            || fact.operation_id != operation
            || fact.operation_item_id != item
            || fact.workspace_id != context.workspace_id
            || fact.payload_redacted.action != action.as_str()
            || fact.event_type != action.fact_event()
        {
            return Err(rejected());
        }
        let valid = if action == AfternicEvidenceAction::Remove {
            match outcome {
                "absent" => reason.is_none(),
                "present" => reason == Some("still_present"),
                "read_failed" => reason == Some("read_failed"),
                "conflict" => matches!(reason, Some("precondition_changed" | "connection_changed")),
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
        json!({"schemaVersion":1,"provider":"afternic","action":action.as_str(),"stage":"reconciled","operationId":operation,"operationItemId":item,"attemptId":attempt,"originalExecutionFactId":id,"originalExecutionFactDigest":hash,"outcome":outcome,"reason":reason})
    };
    let target = payload["attemptId"].as_str().ok_or_else(rejected)?;
    let (id, _) = audit(
        tx,
        context,
        "device_service",
        action.attempt_target(),
        target,
        &payload,
        signer,
    )?;
    Ok(Some(id))
}

pub(super) fn validate_delivery_source(
    wire: &str,
    canonical: &[u8],
    context: &ExecutionEvidenceContext,
    audit_stream: bool,
) -> Result<Value> {
    let mut value: Value = if audit_stream {
        let value: Value = serde_json::from_str(wire).map_err(|_| rejected())?;
        let fields = "schemaVersion auditEventId auditEventKind eventType accountId actorKind authorizationSource targetType targetRef sourceDeviceId credentialEpoch chainId auditSequence previousHash occurredAt signingKeyId signingKeyVersion signingKeyPurpose trustedTimeAnchorId monotonicDeltaMs authorizationContextHash signatureTranscriptVersion payloadRedacted scopeKind workspaceId activeLeaseEpoch eventHash deviceSignature";
        require_fields(&value, fields)?;
        let payload = &value["payloadRedacted"];
        let fields = match payload["stage"].as_str() {
            Some("approved") => {
                "schemaVersion provider action stage approvedOperationId operationId planId planHash targetCount targetSetDigest"
            }
            Some("dispatch_claimed") if payload["action"] == "reactivate_ownership_review" => {
                "schemaVersion provider action stage approvedOperationId operationId operationItemId attemptId attemptNo planHash requestDigest approvalEnvelopeDigest resourceBindingDigest preflightObservationDigest"
            }
            Some("dispatch_claimed") => {
                "schemaVersion provider action stage approvedOperationId operationId operationItemId attemptId attemptNo planHash requestDigest approvalEnvelopeDigest"
            }
            Some("preflight_satisfied") if payload["action"] == "reactivate_ownership_review" => {
                "schemaVersion provider action stage approvedOperationId operationId operationItemId attemptId planHash requestDigest approvalEnvelopeDigest"
            }
            Some("preflight_refused") => {
                "schemaVersion provider action stage approvedOperationId operationId operationItemId attemptId planHash requestDigest approvalEnvelopeDigest reason"
            }
            Some("reconciled") => {
                "schemaVersion provider action stage operationId operationItemId attemptId originalExecutionFactId originalExecutionFactDigest outcome reason"
            }
            _ => return Err(rejected()),
        };
        require_fields(payload, fields)?;
        value
    } else {
        match serde_json::from_str::<ClaimFact>(wire) {
            Ok(fact) => serde_json::to_value(fact).map_err(|_| rejected())?,
            Err(_) => listing_plan::decode_ownership_fact(wire)?,
        }
    };
    if value["workspaceId"] != context.workspace_id
        || value["sourceDeviceId"] != context.source_device_id
        || value["schemaVersion"] != 1
        || value["signatureTranscriptVersion"] != 1
    {
        return Err(rejected());
    }
    let signature = value
        .as_object_mut()
        .ok_or_else(rejected)?
        .remove("deviceSignature")
        .ok_or_else(rejected)?;
    let signature_text = signature.as_str().ok_or_else(rejected)?;
    let signature_bytes = URL_SAFE_NO_PAD
        .decode(signature_text)
        .map_err(|_| rejected())?;
    if signature_bytes.len() != 64 || URL_SAFE_NO_PAD.encode(&signature_bytes) != signature_text {
        return Err(rejected());
    }
    let transcript = evidence_transcript(
        if audit_stream {
            AUDIT_DOMAIN
        } else {
            FACT_DOMAIN
        },
        &value,
    )?;
    UnparsedPublicKey::new(&ED25519, context.public_key)
        .verify(&transcript, &signature_bytes)
        .map_err(|_| rejected())?;
    let mut expected = transcript;
    expected.extend(
        u32::try_from(signature_text.len())
            .map_err(|_| rejected())?
            .to_be_bytes(),
    );
    expected.extend(signature_text.as_bytes());
    if expected != canonical {
        return Err(rejected());
    }
    value["deviceSignature"] = signature;
    Ok(value)
}
fn require_fields(value: &Value, fields: &str) -> Result<()> {
    let object = value.as_object().ok_or_else(rejected)?;
    if object.len() != fields.split_ascii_whitespace().count()
        || fields
            .split_ascii_whitespace()
            .any(|key| !object.contains_key(key))
    {
        return Err(rejected());
    }
    Ok(())
}

#[path = "execution_evidence_listing_plan.rs"]
mod listing_plan;
pub(super) use listing_plan::{
    ListingPlanAction, ListingPlanApprovalTarget, OwnershipClaimDigests,
    record_listing_plan_approval, record_listing_plan_claim, record_listing_plan_observation,
};

#[path = "execution_evidence_marketplace_approval.rs"]
pub(super) mod marketplace_approval;
