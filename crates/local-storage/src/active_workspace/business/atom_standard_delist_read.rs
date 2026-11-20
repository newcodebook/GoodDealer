//! Customer readback exposes only the approved domains and closed operation states.
use super::{
    ACTION, BusinessDatabase, BusinessDatabaseError, Deserialize, KIND, OptionalExtension, Result,
    Serialize, is_uuid_v4, params, read_plan, storage, validate_timestamp,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DesktopAtomStandardDelistStatusRequest {
    pub schema_version: u8,
    pub plan_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopAtomStandardDelistStatus {
    schema_version: u8,
    pub execution_available: bool,
    recent: Vec<DesktopAtomStandardDelistPlanSummary>,
    plan: Option<DesktopAtomStandardDelistPlanStatus>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopAtomStandardDelistPlanSummary {
    plan_id: String,
    connection_label: String,
    created_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopAtomStandardDelistPlanStatus {
    plan_id: String,
    plan_hash: String,
    connection_id: String,
    expires_at: String,
    state: &'static str,
    items: Vec<DesktopAtomStandardDelistItemStatus>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopAtomStandardDelistItemStatus {
    domain: String,
    state: &'static str,
    reason: Option<&'static str>,
    retry_at: Option<String>,
}

impl BusinessDatabase {
    pub(crate) fn read_atom_standard_delist_status(
        &self,
        request: &DesktopAtomStandardDelistStatusRequest,
        at: &str,
        execution_available: bool,
    ) -> Result<DesktopAtomStandardDelistStatus> {
        let bad = BusinessDatabaseError::StorageRejected;
        if request.schema_version != 1
            || request.plan_id.as_deref().is_some_and(|id| !is_uuid_v4(id))
        {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        let db = self.store.raw_connection();
        let workspace = &self.workspace_id;
        let mut stmt = db.prepare(
            "SELECT p.plan_id,p.created_at,c.display_label FROM operation_plans p
             JOIN operation_plan_items i USING(workspace_id,plan_id)
             JOIN local_provider_connections c ON c.workspace_id=i.workspace_id AND c.connection_id=i.connection_id
             WHERE p.workspace_id=?1 AND p.operation_kind=?2 AND i.ordinal=0
             ORDER BY p.created_at DESC,p.plan_id LIMIT 20",
        ).map_err(storage)?;
        let rows = stmt
            .query_map(params![workspace, KIND], |row| {
                Ok(DesktopAtomStandardDelistPlanSummary {
                    plan_id: row.get(0)?,
                    created_at: row.get(1)?,
                    connection_label: row.get(2)?,
                })
            })
            .map_err(storage)?;
        let recent = rows
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(storage)?;
        for entry in &recent {
            if !is_uuid_v4(&entry.plan_id) {
                return Err(bad);
            }
            validate_timestamp(Some(entry.created_at.clone())).map_err(|_| bad)?;
        }
        let chosen = request
            .plan_id
            .as_deref()
            .or_else(|| recent.first().map(|row| row.plan_id.as_str()));
        let plan = chosen
            .map(|id| self.read_atom_standard_delist_plan(id, at))
            .transpose()?;
        Ok(DesktopAtomStandardDelistStatus {
            schema_version: 1,
            execution_available,
            recent,
            plan,
        })
    }

    fn read_atom_standard_delist_plan(
        &self,
        id: &str,
        at: &str,
    ) -> Result<DesktopAtomStandardDelistPlanStatus> {
        let bad = BusinessDatabaseError::StorageRejected;
        let db = self.store.raw_connection();
        let workspace = &self.workspace_id;
        let plan = read_plan(db, workspace, id)?;
        let operation = db
            .query_row(
                "SELECT o.operation_id,o.phase FROM operations o JOIN afternic_listing_approvals a
             USING(workspace_id,operation_id,plan_id)
             WHERE o.workspace_id=?1 AND o.plan_id=?2 AND a.action=?3 AND a.plan_hash=?4",
                params![
                    workspace,
                    id,
                    ACTION,
                    super::execution_evidence::hex_to_digest(&plan.hash)?
                ],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()
            .map_err(storage)?;
        let state = match (
            plan.phase.as_str(),
            operation.as_ref().map(|(_, phase)| phase.as_str()),
        ) {
            ("awaiting_approval", None) if plan.expires_at.as_str() <= at => "expired",
            ("awaiting_approval", None) => "awaiting_approval",
            ("executing", Some("running")) => "executing",
            ("completed", Some("partially_failed")) => "partially_failed",
            _ => return Err(bad),
        };
        let mut items = Vec::with_capacity(plan.targets.len());
        for item in &plan.targets {
            let (state, reason, retry_at) = if let Some((operation_id, _)) = &operation {
                let (status, error, retry): (String, Option<String>, Option<String>) = db
                    .query_row(
                        "SELECT status,error_code,retry_after FROM operation_attempts
                     WHERE workspace_id=?1 AND plan_id=?2 AND operation_id=?3 AND item_id=?4
                      AND attempt_number=1 AND request_digest=?5",
                        params![
                            workspace,
                            id,
                            operation_id,
                            item.item_id,
                            super::request_digest(item)?
                        ],
                        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                    )
                    .map_err(storage)?;
                validate_timestamp(retry.clone()).map_err(|_| bad)?;
                match (status.as_str(), error.as_deref()) {
                    ("queued", None) => ("queued", None, retry),
                    ("queued", Some("read_failed")) => ("queued", Some("read_failed"), retry),
                    ("running", None) => ("outcome_unknown", None, retry),
                    ("waiting_remote", Some("read_failed")) => {
                        ("outcome_unknown", Some("read_failed"), retry)
                    }
                    ("waiting_remote", Some("postcondition_pending")) => {
                        ("outcome_unknown", Some("postcondition_pending"), retry)
                    }
                    ("failed_final", Some("precondition_changed")) => {
                        ("failed_final", Some("precondition_changed"), None)
                    }
                    ("failed_final", Some("connection_changed")) => {
                        ("failed_final", Some("connection_changed"), None)
                    }
                    ("failed_final", Some("provider_state_blocked")) => {
                        ("failed_final", Some("provider_state_blocked"), None)
                    }
                    _ => return Err(bad),
                }
            } else {
                (state, None, None)
            };
            items.push(DesktopAtomStandardDelistItemStatus {
                domain: item.domain.clone(),
                state,
                reason,
                retry_at,
            });
        }
        Ok(DesktopAtomStandardDelistPlanStatus {
            plan_id: id.to_owned(),
            plan_hash: plan.hash,
            expires_at: plan.expires_at,
            connection_id: plan.targets[0].connection_id.clone(),
            state,
            items,
        })
    }
}
