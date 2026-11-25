//! Redacted read models for the durable `SellerHub` price workflow.
use super::{
    BusinessDatabase, BusinessDatabaseError, Connection, Deserialize, DesktopSellerHubBinPlan,
    DesktopSellerHubBinPlanItem, OptionalExtension, PLAN_KIND, Result, Serialize, StoredPlan,
    is_uuid_v4, params, read_plan, storage, validate_timestamp,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DesktopSellerHubBinStatusRequest {
    pub schema_version: u8,
    pub plan_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopSellerHubBinPlanSummary {
    pub plan_id: String,
    pub connection_label: String,
    pub created_at: String,
    pub state: &'static str,
}

impl BusinessDatabase {
    pub(crate) fn read_sellerhub_bin_status(
        &self,
        request: &DesktopSellerHubBinStatusRequest,
        at: &str,
    ) -> Result<(
        Vec<DesktopSellerHubBinPlanSummary>,
        Option<DesktopSellerHubBinPlan>,
    )> {
        if request.schema_version != 1
            || request.plan_id.as_deref().is_some_and(|id| !is_uuid_v4(id))
        {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        let c = self.store.raw_connection();
        let workspace = &self.workspace_id;
        let mut statement = c.prepare(
            "SELECT p.plan_id,p.created_at,p.expires_at,p.phase,o.phase,c.display_label
             FROM operation_plans p JOIN operation_plan_items i USING(workspace_id,plan_id)
             JOIN local_provider_connections c ON i.workspace_id=c.workspace_id AND i.connection_id=c.connection_id
             LEFT JOIN operations o ON o.workspace_id=p.workspace_id AND o.plan_id=p.plan_id
             WHERE p.workspace_id=?1 AND p.operation_kind=?2 AND i.ordinal=0
             ORDER BY p.phase='executing' DESC,p.created_at DESC,p.plan_id LIMIT 20",
        ).map_err(storage)?;
        let mut rows = statement
            .query(params![workspace, PLAN_KIND])
            .map_err(storage)?;
        let mut recent = Vec::new();
        while let Some(row) = rows.next().map_err(storage)? {
            let id: String = row.get(0).map_err(storage)?;
            let created: String = row.get(1).map_err(storage)?;
            let expires: String = row.get(2).map_err(storage)?;
            let phase: String = row.get(3).map_err(storage)?;
            let execution: Option<String> = row.get(4).map_err(storage)?;
            let label = row.get(5).map_err(storage)?;
            if !is_uuid_v4(&id) {
                return Err(BusinessDatabaseError::StorageRejected);
            }
            validate_timestamp(Some(created.clone()))
                .map_err(|_| BusinessDatabaseError::StorageRejected)?;
            validate_timestamp(Some(expires.clone()))
                .map_err(|_| BusinessDatabaseError::StorageRejected)?;
            recent.push(DesktopSellerHubBinPlanSummary {
                plan_id: id,
                connection_label: label,
                created_at: created,
                state: plan_state(&phase, execution.as_deref(), &expires, Some(at))?,
            });
        }
        let selected = request
            .plan_id
            .as_deref()
            .or_else(|| recent.first().map(|row| row.plan_id.as_str()));
        let plan = selected
            .map(|id| {
                let stored = read_plan(c, workspace, id)?;
                project_plan(c, workspace, id, stored, Some(at))
            })
            .transpose()?;
        Ok((recent, plan))
    }
}

fn plan_state(
    phase: &str,
    operation: Option<&str>,
    expires: &str,
    at: Option<&str>,
) -> Result<&'static str> {
    match (phase, operation) {
        ("awaiting_approval", None) if at.is_some_and(|now| now >= expires) => Ok("expired"),
        ("awaiting_approval", None) => Ok("awaiting_approval"),
        ("executing", Some("running")) => Ok("executing"),
        ("completed", Some("completed")) => Ok("completed"),
        ("completed", Some("partially_failed")) => Ok("partially_failed"),
        _ => Err(BusinessDatabaseError::StorageRejected),
    }
}

pub(super) fn project_plan(
    c: &Connection,
    workspace: &str,
    id: &str,
    stored: StoredPlan,
    at: Option<&str>,
) -> Result<DesktopSellerHubBinPlan> {
    let connection_id = stored
        .targets
        .first()
        .ok_or(BusinessDatabaseError::StorageRejected)?
        .connection_id
        .clone();
    let label = c.query_row(
        "SELECT display_label FROM local_provider_connections WHERE workspace_id=?1 AND connection_id=?2",
        params![workspace,connection_id], |r| r.get(0),
    ).map_err(storage)?;
    let phase: Option<String> = c
        .query_row(
            "SELECT phase FROM operations WHERE workspace_id=?1 AND plan_id=?2",
            params![workspace, id],
            |r| r.get(0),
        )
        .optional()
        .map_err(storage)?;
    let state = plan_state(&stored.phase, phase.as_deref(), &stored.expires_at, at)?;
    let mut items = Vec::with_capacity(stored.targets.len());
    for target in stored.targets {
        let (status, reason, retry) = if phase.is_none() {
            ("preview", None, None)
        } else {
            attempt_read(c, workspace, id, &target.item_id)?
        };
        items.push(DesktopSellerHubBinPlanItem {
            domain: target.domain,
            previous_price_cents: target.previous_price_cents,
            price_cents: target.price_cents,
            state: status,
            reason,
            retry_at: retry,
        });
    }
    Ok(DesktopSellerHubBinPlan {
        schema_version: 1,
        plan_id: id.to_owned(),
        connection_id,
        connection_label: label,
        plan_hash: stored.hash,
        expires_at: stored.expires_at,
        state,
        items,
    })
}

type AttemptRead = (&'static str, Option<String>, Option<String>);

fn attempt_read(c: &Connection, workspace: &str, plan: &str, item: &str) -> Result<AttemptRead> {
    let (state, reason, retry): (String, Option<String>, Option<String>) = c
        .query_row(
            "SELECT status,error_code,retry_after FROM operation_attempts
         WHERE workspace_id=?1 AND plan_id=?2 AND item_id=?3 AND attempt_number=1",
            params![workspace, plan, item],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(storage)?;
    validate_timestamp(retry.clone()).map_err(|_| BusinessDatabaseError::StorageRejected)?;
    let status = match (state.as_str(), reason.as_deref(), retry.as_ref()) {
        ("queued", None, _) => "queued",
        ("running", None, _) => "reconciling",
        ("succeeded", None, None) => "changed",
        (
            "failed_final",
            Some("precondition_changed" | "connection_changed" | "provider_state_blocked"),
            None,
        ) => "refused",
        _ => return Err(BusinessDatabaseError::StorageRejected),
    };
    Ok((status, reason, retry))
}
