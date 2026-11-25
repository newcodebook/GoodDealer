use super::super::{
    PrivateWorkspaceAuthority,
    authority::{CredentialPurpose, WorkspaceAuthorityVerifier},
};
use super::{
    Error,
    wire::{self, Value, rejected},
};
pub(super) fn capability(
    value: &Value,
    authority: &PrivateWorkspaceAuthority,
    workflow: &str,
    now: i64,
    verifier: &WorkspaceAuthorityVerifier,
) -> Result<(), Error> {
    envelope(
        value,
        authority,
        now,
        "gd.bootstrap-capability.v1",
        "gooddealer-desktop/bootstrap",
    )?;
    value
        .get("payload")?
        .shape(&["deviceSwitchRequestId"], &[])?;
    if value.get("payload")?.get("deviceSwitchRequestId")?.text() != Ok(workflow)
        || wire::utc(value.get("expiresAt")?)? - wire::utc(value.get("issuedAt")?)? > 3600
    {
        return Err(rejected());
    }
    signature(
        value,
        verifier,
        CredentialPurpose::BootstrapCapabilityV1,
        "GOODDEALER-BOOTSTRAP-CAPABILITY-V1",
    )
}
fn envelope(
    value: &Value,
    authority: &PrivateWorkspaceAuthority,
    now: i64,
    typ: &str,
    audience: &str,
) -> Result<(), Error> {
    value.shape(
        &[
            "schemaVersion",
            "typ",
            "iss",
            "aud",
            "kid",
            "accountId",
            "deviceId",
            "accountSecurityEpoch",
            "jti",
            "issuedAt",
            "expiresAt",
            "payload",
            "signature",
        ],
        &[],
    )?;
    for key in ["kid", "accountId", "deviceId", "jti"] {
        wire::id(value.get(key)?)?;
    }
    wire::encoded(value.get("signature")?, 64)?;
    let issued = wire::utc(value.get("issuedAt")?)?;
    let expires = wire::utc(value.get("expiresAt")?)?;
    if value.get("schemaVersion")?.number() != Ok(1)
        || value.get("typ")?.text() != Ok(typ)
        || value.get("iss")?.text() != Ok("https://accounts.gooddealer.com")
        || value.get("aud")?.text() != Ok(audience)
        || value.get("accountId")?.text() != Ok(authority.account_id.as_str())
        || value.get("deviceId")?.text() != Ok(authority.device_id.as_str())
        || value.get("accountSecurityEpoch")?.number() != Ok(authority.account_security_epoch)
        || issued > now
        || expires <= now
        || expires <= issued
    {
        return Err(rejected());
    }
    Ok(())
}
fn signature(
    value: &Value,
    verifier: &WorkspaceAuthorityVerifier,
    purpose: CredentialPurpose,
    domain: &str,
) -> Result<(), Error> {
    if !verifier.verify(
        purpose,
        value.get("kid")?.text()?,
        &wire::transcript(domain, &value.without(&["signature"])?),
        value.get("signature")?.text()?,
    ) {
        return Err(rejected());
    }
    Ok(())
}
pub(super) fn claim(
    value: &Value,
    authority: &PrivateWorkspaceAuthority,
    workflow: &str,
    now: i64,
    verifier: &WorkspaceAuthorityVerifier,
) -> Result<(), Error> {
    value.shape(
        &[
            "requestId",
            "stepSchemaVersion",
            "capability",
            "pendingLeaseEpoch",
            "workflowRevision",
            "nextStep",
        ],
        &[],
    )?;
    if value.get("requestId")?.text() != Ok(workflow)
        || value.get("stepSchemaVersion")?.number() != Ok(2)
        || wire::positive(value.get("pendingLeaseEpoch")?)? <= authority.lease_epoch
    {
        return Err(rejected());
    }
    wire::positive(value.get("workflowRevision")?)?;
    capability(value.get("capability")?, authority, workflow, now, verifier)?;
    let step = value.get("nextStep")?;
    step.shape(&["stepNumber", "stepKind", "stepNonce"], &[])?;
    wire::encoded(step.get("stepNonce")?, 32)?;
    if step.get("stepNumber")?.number() != Ok(1)
        || !step.get("stepKind")?.equals_text("pin_checkpoint")
    {
        return Err(rejected());
    }
    Ok(())
}
#[expect(
    clippy::too_many_lines,
    reason = "all three strict step result variants share one correlated digest boundary"
)]
pub(super) fn step_result(value: &Value, request: &Value) -> Result<(), Error> {
    value.shape(
        &[
            "schemaVersion",
            "workflowRevision",
            "acceptedStepNumber",
            "nextStepNonce",
            "resultDigest",
            "stepKind",
            "resultPayload",
        ],
        &[],
    )?;
    let kind = request.get("stepKind")?.text()?;
    if value.get("schemaVersion")?.number() != Ok(2)
        || value.get("stepKind")?.text() != Ok(kind)
        || value.get("acceptedStepNumber")? != request.get("stepNumber")?
        || value.get("workflowRevision")?.number()?
            != request
                .get("expectedWorkflowRevision")?
                .number()?
                .checked_add(1)
                .ok_or_else(rejected)?
        || value.get("resultDigest")?.text()
            != Ok(wire::digest(
                "GOODDEALER-BOOTSTRAP-STEP-RESULT-V2",
                &value.without(&["resultDigest"])?,
            )
            .as_str())
    {
        return Err(rejected());
    }
    if kind == "submit_rebuild_digest" {
        if !value.get("nextStepNonce")?.is_null() {
            return Err(rejected());
        }
    } else {
        wire::encoded(value.get("nextStepNonce")?, 32)?;
    }
    let payload = value.get("resultPayload")?;
    match kind {
        "pin_checkpoint" => {
            payload.shape(
                &[
                    "checkpoint",
                    "pinExpiresAt",
                    "targetServerRevision",
                    "workspaceSchemaVersion",
                    "checkpointEntityDigests",
                ],
                &[],
            )?;
            wire::utc(payload.get("pinExpiresAt")?)?;
            wire::positive(payload.get("workspaceSchemaVersion")?)?;
            let checkpoint = payload.get("checkpoint")?;
            checkpoint.shape(
                &[
                    "schemaVersion",
                    "checkpointId",
                    "workspaceId",
                    "workspaceSchemaVersion",
                    "throughServerRevision",
                    "checkpointDigest",
                ],
                &[],
            )?;
            for field in ["checkpointId", "workspaceId"] {
                wire::id(checkpoint.get(field)?)?;
            }
            wire::encoded(checkpoint.get("checkpointDigest")?, 32)?;
            if checkpoint.get("schemaVersion")?.number() != Ok(3)
                || checkpoint.get("workspaceSchemaVersion")?
                    != payload.get("workspaceSchemaVersion")?
                || checkpoint.get("throughServerRevision")?.number()?
                    > payload.get("targetServerRevision")?.number()?
            {
                return Err(rejected());
            }
            digests(payload.get("checkpointEntityDigests")?)?;
            if checkpoint.get("checkpointDigest")?.text()
                != Ok(wire::digest(
                    "GOODDEALER-WORKSPACE-CHECKPOINT-ENTITY-DIGESTS-V3",
                    payload.get("checkpointEntityDigests")?,
                )
                .as_str())
            {
                return Err(rejected());
            }
        }
        "fetch_mutations" => {
            payload.shape(&["mutationPage"], &[])?;
        }
        "submit_rebuild_digest" => {
            payload.shape(
                &[
                    "verifiedRevision",
                    "workspaceSchemaVersion",
                    "verifiedDigest",
                    "accepted",
                ],
                &[],
            )?;
            let expected = request.get("stepPayload")?;
            if payload.get("accepted")? != &Value::Bool(true)
                || payload.get("verifiedRevision")? != expected.get("targetServerRevision")?
                || payload.get("workspaceSchemaVersion")?
                    != expected.get("workspaceSchemaVersion")?
                || payload.get("verifiedDigest")?.text()
                    != Ok(wire::digest(
                        "GOODDEALER-WORKSPACE-CHECKPOINT-ENTITY-DIGESTS-V3",
                        expected.get("entityDigests")?,
                    )
                    .as_str())
            {
                return Err(rejected());
            }
        }
        _ => return Err(rejected()),
    }
    Ok(())
}
pub(super) fn digests(value: &Value) -> Result<(), Error> {
    let rows = value.array()?;
    if rows.is_empty() || rows.len() > 4096 {
        return Err(rejected());
    }
    let mut previous: Option<(&str, &str)> = None;
    for row in rows {
        row.shape(&["entityType", "partitionId", "digest"], &[])?;
        let kind = row.get("entityType")?.text()?;
        let partition = row.get("partitionId")?.text()?;
        let prefix = match kind {
            "domain_asset" => b'p',
            "domain_asset_tombstone" => b't',
            _ => return Err(rejected()),
        };
        if !(partition == "empty" && prefix == b'p')
            && (partition.len() != 5
                || partition.as_bytes()[0] != prefix
                || !partition.as_bytes()[1..].iter().all(u8::is_ascii_digit))
        {
            return Err(rejected());
        }
        if previous.is_some_and(|prior| prior >= (kind, partition)) {
            return Err(rejected());
        }
        previous = Some((kind, partition));
        wire::encoded(row.get("digest")?, 32)?;
    }
    Ok(())
}
pub(super) fn checkpoint_page(value: &Value, request: &Value) -> Result<(), Error> {
    value.shape(
        &[
            "requestId",
            "checkpointId",
            "checkpointDigest",
            "entityType",
            "partitionId",
            "offset",
            "totalRows",
            "nextOffset",
            "rows",
            "pageDigest",
        ],
        &[],
    )?;
    for key in [
        "requestId",
        "checkpointId",
        "checkpointDigest",
        "entityType",
        "partitionId",
        "offset",
    ] {
        if value.get(key)? != request.get(key)? {
            return Err(rejected());
        }
    }
    let rows = value.get("rows")?.array()?;
    let offset = value.get("offset")?.number()?;
    let total = value.get("totalRows")?.number()?;
    let end = offset + u64::try_from(rows.len()).map_err(|_| rejected())?;
    let next = if end == total {
        Value::Null
    } else {
        Value::Number(end)
    };
    if total > 512
        || end > total
        || rows.len() > 256
        || u64::try_from(rows.len()).map_err(|_| rejected())?
            > request.get("pageLimit")?.number()?
        || value.get("nextOffset")? != &next
        || (rows.is_empty()
            && (offset != 0 || total != 0 || !value.get("partitionId")?.equals_text("empty")))
        || (!rows.is_empty() && value.get("partitionId")?.equals_text("empty"))
        || value.get("pageDigest")?.text()
            != Ok(wire::digest(
                "GOODDEALER-BOOTSTRAP-CHECKPOINT-PAGE-V1",
                &value.without(&["pageDigest"])?,
            )
            .as_str())
    {
        return Err(rejected());
    }
    let mut previous: Option<&str> = None;
    for row in rows {
        let id = row.get("entityId")?.text()?;
        if previous.is_some_and(|prior| prior.as_bytes() >= id.as_bytes()) {
            return Err(rejected());
        }
        previous = Some(id);
    }
    Ok(())
}
pub(super) fn activation(
    value: &Value,
    request: &Value,
    authority: &PrivateWorkspaceAuthority,
    now: i64,
    verifier: &WorkspaceAuthorityVerifier,
) -> Result<(), Error> {
    value.shape(
        &[
            "requestId",
            "activationId",
            "requestDigest",
            "workflowRevision",
            "status",
            "pendingLeaseEpoch",
            "targetServerRevision",
            "workspaceSchemaVersion",
            "verifiedRebuildDigest",
            "cursorGeneration",
            "lease",
        ],
        &[],
    )?;
    for key in [
        "requestId",
        "activationId",
        "requestDigest",
        "pendingLeaseEpoch",
        "targetServerRevision",
        "workspaceSchemaVersion",
        "verifiedRebuildDigest",
    ] {
        if value.get(key)? != request.get(key)? {
            return Err(rejected());
        }
    }
    if !value.get("status")?.equals_text("completed")
        || value.get("workflowRevision")?.number()?
            != request
                .get("expectedWorkflowRevision")?
                .number()?
                .checked_add(1)
                .ok_or_else(rejected)?
    {
        return Err(rejected());
    }
    wire::positive(value.get("cursorGeneration")?)?;
    let lease = value.get("lease")?;
    let issued = wire::utc(lease.get("issuedAt")?)?;
    if issued > now {
        return Err(rejected());
    }
    envelope(
        lease,
        authority,
        issued,
        "gd.active-device-lease.v1",
        "gooddealer-desktop/active-device-lease",
    )?;
    let payload = lease.get("payload")?;
    payload.shape(
        &[
            "leaseEpoch",
            "renewAfter",
            "onlineExpiresAt",
            "offlineExecuteUntil",
        ],
        &[],
    )?;
    let issued = wire::utc(lease.get("issuedAt")?)?;
    let renew = wire::utc(payload.get("renewAfter")?)?;
    let online = wire::utc(payload.get("onlineExpiresAt")?)?;
    let offline = wire::utc(payload.get("offlineExecuteUntil")?)?;
    if payload.get("leaseEpoch")? != request.get("pendingLeaseEpoch")?
        || renew <= issued
        || online <= renew
        || offline < online
        || offline != wire::utc(lease.get("expiresAt")?)?
        || offline - issued > 86_400
    {
        return Err(rejected());
    }
    signature(
        lease,
        verifier,
        CredentialPurpose::ActiveDeviceLeaseV1,
        "GOODDEALER-ACTIVE-DEVICE-LEASE-V1",
    )
}
