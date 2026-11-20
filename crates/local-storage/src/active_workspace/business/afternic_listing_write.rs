//! Durable Afternic create/update plans. The sole business writer owns approval and reconciliation.
use super::afternic::random_id;
use super::execution_evidence::{self, ApprovalTarget, EvidenceSigner, ExecutionEvidenceContext};
use super::{
    AfternicConnectionSeed, BusinessDatabase, BusinessDatabaseError,
    DesktopAfternicListingObservation, hex_digest, is_uuid_v4, validate_domain_asset_id,
    validate_sha256_hex, validate_timestamp,
};
use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde::{Deserialize, Deserializer, Serialize};
use std::collections::BTreeSet;

pub(crate) const WRITE_KIND: &str = "afternic_listing_write";
const ADAPTER: &str = "afternic-official-v3-listing-write-v1";
type Result<T> = std::result::Result<T, BusinessDatabaseError>;
fn storage(_: rusqlite::Error) -> BusinessDatabaseError {
    BusinessDatabaseError::StorageRejected
}
pub(super) fn encode<T: Serialize>(value: &T) -> Result<String> {
    serde_json::to_string(value).map_err(|_| BusinessDatabaseError::InvalidInput)
}
pub(super) fn decode<T: serde::de::DeserializeOwned>(value: &str) -> Result<T> {
    serde_json::from_str(value).map_err(|_| BusinessDatabaseError::StorageRejected)
}
fn timestamp(value: &str) -> Result<()> {
    validate_timestamp(Some(value.to_owned()))
        .map(|_| ())
        .map_err(|_| BusinessDatabaseError::InvalidInput)
}
fn identifier(value: &str) -> Result<()> {
    if is_uuid_v4(value) {
        Ok(())
    } else {
        Err(BusinessDatabaseError::InvalidInput)
    }
}
fn sql_integer<T: TryInto<i64>>(value: T) -> Result<i64> {
    value
        .try_into()
        .map_err(|_| BusinessDatabaseError::InvalidInput)
}
pub(super) fn unsigned(row: &rusqlite::Row<'_>, column: usize) -> rusqlite::Result<u64> {
    let value: i64 = row.get(column)?;
    u64::try_from(value).map_err(|_| rusqlite::Error::IntegralValueOutOfRange(column, value))
}
pub(super) fn optional_unsigned(
    row: &rusqlite::Row<'_>,
    column: usize,
) -> rusqlite::Result<Option<u64>> {
    let value: Option<i64> = row.get(column)?;
    value
        .map(|value| {
            u64::try_from(value)
                .map_err(|_| rusqlite::Error::IntegralValueOutOfRange(column, value))
        })
        .transpose()
}
fn required_nullable<'de, D: Deserializer<'de>>(
    d: D,
) -> std::result::Result<Option<String>, D::Error> {
    Option::<String>::deserialize(d)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DesktopAfternicListingWriteAction {
    Create,
    Update,
}
fn selected<'de, D: Deserializer<'de>, T: Deserialize<'de>>(
    d: D,
) -> std::result::Result<Option<T>, D::Error> {
    T::deserialize(d).map(Some)
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DesktopAfternicListingWritePatch {
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "selected"
    )]
    pub buynow_price_micro_usd: Option<u64>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "selected"
    )]
    pub floor_price_micro_usd: Option<u64>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "selected"
    )]
    pub minbid_price_micro_usd: Option<u64>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "selected"
    )]
    pub hidden: Option<bool>,
}
impl DesktopAfternicListingWritePatch {
    pub(super) fn validate(&self) -> Result<()> {
        if self.buynow_price_micro_usd.is_none()
            && self.floor_price_micro_usd.is_none()
            && self.minbid_price_micro_usd.is_none()
            && self.hidden.is_none()
        {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        for (value, min) in [
            (self.buynow_price_micro_usd, 0),
            (self.floor_price_micro_usd, 0),
            (self.minbid_price_micro_usd, 20_000_000),
        ] {
            if value.is_some_and(|v| v < min || v > 49_999_999_000_000 || v % 1_000_000 != 0) {
                return Err(BusinessDatabaseError::InvalidInput);
            }
        }
        Ok(())
    }
    fn matches(&self, o: &DesktopAfternicListingObservation) -> bool {
        self.buynow_price_micro_usd
            .is_none_or(|v| o.buynow_price == Some(v))
            && self
                .floor_price_micro_usd
                .is_none_or(|v| o.floor_price == Some(v))
            && self
                .minbid_price_micro_usd
                .is_none_or(|v| o.minbid_price == Some(v))
            && self.hidden.is_none_or(|v| o.hidden == Some(v))
    }
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DesktopAfternicListingWriteValues {
    pub buynow_price_micro_usd: u64,
    pub floor_price_micro_usd: u64,
    pub minbid_price_micro_usd: u64,
    pub hidden: bool,
}
impl From<&DesktopAfternicListingWriteValues> for DesktopAfternicListingWritePatch {
    fn from(v: &DesktopAfternicListingWriteValues) -> Self {
        Self {
            buynow_price_micro_usd: Some(v.buynow_price_micro_usd),
            floor_price_micro_usd: Some(v.floor_price_micro_usd),
            minbid_price_micro_usd: Some(v.minbid_price_micro_usd),
            hidden: Some(v.hidden),
        }
    }
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DesktopAfternicListingWriteCreateItem {
    pub domain: String,
    pub values: DesktopAfternicListingWriteValues,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DesktopAfternicListingWriteUpdateItem {
    pub domain: String,
    pub patch: DesktopAfternicListingWritePatch,
}
#[derive(Debug, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
pub enum DesktopAfternicListingWritePreviewRequest {
    Create {
        #[serde(rename = "schemaVersion")]
        schema_version: u8,
        #[serde(rename = "connectionId")]
        connection_id: String,
        items: Vec<DesktopAfternicListingWriteCreateItem>,
    },
    Update {
        #[serde(rename = "schemaVersion")]
        schema_version: u8,
        #[serde(rename = "connectionId")]
        connection_id: String,
        items: Vec<DesktopAfternicListingWriteUpdateItem>,
    },
}
impl DesktopAfternicListingWritePreviewRequest {
    pub(crate) const fn schema_version(&self) -> u8 {
        match self {
            Self::Create { schema_version, .. } | Self::Update { schema_version, .. } => {
                *schema_version
            }
        }
    }
    pub(crate) fn connection_id(&self) -> &str {
        match self {
            Self::Create { connection_id, .. } | Self::Update { connection_id, .. } => {
                connection_id
            }
        }
    }
    fn action(&self) -> DesktopAfternicListingWriteAction {
        match self {
            Self::Create { .. } => DesktopAfternicListingWriteAction::Create,
            Self::Update { .. } => DesktopAfternicListingWriteAction::Update,
        }
    }
    fn patches(&self) -> Vec<(String, DesktopAfternicListingWritePatch)> {
        match self {
            Self::Create { items, .. } => items
                .iter()
                .map(|i| (i.domain.clone(), (&i.values).into()))
                .collect(),
            Self::Update { items, .. } => items
                .iter()
                .map(|i| (i.domain.clone(), i.patch.clone()))
                .collect(),
        }
    }
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DesktopAfternicListingWriteApproveRequest {
    pub schema_version: u8,
    pub plan_ref: String,
    pub plan_hash: String,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DesktopAfternicListingWriteStatusRequest {
    pub schema_version: u8,
    #[serde(deserialize_with = "required_nullable")]
    pub plan_ref: Option<String>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopAfternicListingWriteObserved {
    pub provider_status: String,
    pub buynow_price_micro_usd: Option<u64>,
    pub floor_price_micro_usd: Option<u64>,
    pub minbid_price_micro_usd: Option<u64>,
    pub hidden: Option<bool>,
    pub observed_at: String,
}
impl DesktopAfternicListingWriteObserved {
    fn from_observation(o: &DesktopAfternicListingObservation, at: &str) -> Self {
        Self {
            provider_status: o.status.clone(),
            buynow_price_micro_usd: o.buynow_price,
            floor_price_micro_usd: o.floor_price,
            minbid_price_micro_usd: o.minbid_price,
            hidden: o.hidden,
            observed_at: at.into(),
        }
    }
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopAfternicListingWriteItem {
    pub domain: String,
    pub before: Option<DesktopAfternicListingWriteObserved>,
    pub changes: DesktopAfternicListingWritePatch,
    pub latest: Option<DesktopAfternicListingWriteObserved>,
    pub fields_matched: bool,
    pub state: String,
    pub reason: Option<String>,
    pub retry_at: Option<String>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopAfternicListingWritePlan {
    pub schema_version: u8,
    pub plan_ref: String,
    pub plan_hash: String,
    pub action: DesktopAfternicListingWriteAction,
    pub connection_label: String,
    pub created_at: String,
    pub expires_at: String,
    pub approved_at: Option<String>,
    pub state: String,
    pub items: Vec<DesktopAfternicListingWriteItem>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopAfternicListingWriteSummary {
    pub plan_ref: String,
    pub action: DesktopAfternicListingWriteAction,
    pub connection_label: String,
    pub created_at: String,
    pub state: String,
    pub total: u32,
    pub applied: u32,
    pub conflicts: u32,
    pub pending: u32,
    pub pending_provider: u32,
    pub pending_verification: u32,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopAfternicListingWriteStatus {
    pub controlled_acceptance: Option<super::DesktopAfternicControlledAcceptance>,
    pub schema_version: u8,
    pub write_qualified: bool,
    pub write_entitled: bool,
    pub execution_available: bool,
    pub plans: Vec<DesktopAfternicListingWriteSummary>,
    pub detail: Option<DesktopAfternicListingWritePlan>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AfternicListingWriteFrozenItem {
    pub(super) schema_version: u8,
    pub(super) adapter_revision: String,
    pub(super) scan_id: String,
    pub(super) observation_id: Option<String>,
    pub(super) observation_digest: Option<String>,
    pub(super) observed_at: String,
    pub domain: String,
    pub entity_generation: u64,
    pub connection_id: String,
    pub connection_incarnation_id: String,
    pub credential_generation: u64,
    pub binding_digest: Option<String>,
    pub binding_generation: Option<u64>,
    pub listing: Option<DesktopAfternicListingObservation>,
    pub action: DesktopAfternicListingWriteAction,
    pub changes: DesktopAfternicListingWritePatch,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DesktopAfternicListingWriteWorkKind {
    Preflight,
    Reconcile,
}
#[derive(Clone)]
pub(crate) struct AfternicListingWriteWorkSeed {
    pub plan_id: String,
    pub operation_id: String,
    pub item_id: String,
    pub request_digest: String,
    pub frozen: AfternicListingWriteFrozenItem,
    pub kind: DesktopAfternicListingWriteWorkKind,
    pub(super) evidence_fence: execution_evidence::EvidenceReadFence,
}

type ItemReadFact = (
    String,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<bool>,
    Option<String>,
    Option<String>,
);
pub(super) struct StoredItem {
    pub(super) id: String,
    pub(super) frozen: AfternicListingWriteFrozenItem,
}

pub(super) fn validate_frozen(item: &AfternicListingWriteFrozenItem) -> Result<()> {
    item.changes.validate()?;
    if !matches!(item.schema_version, 1 | 2)
        || item.adapter_revision != ADAPTER
        || item.entity_generation == 0
        || item.credential_generation == 0
    {
        return Err(BusinessDatabaseError::StorageRejected);
    }
    for id in [
        &item.scan_id,
        &item.connection_id,
        &item.connection_incarnation_id,
    ] {
        identifier(id)?;
    }
    validate_domain_asset_id(&item.domain).map_err(|_| BusinessDatabaseError::InvalidInput)?;
    timestamp(&item.observed_at)?;
    match (&item.listing, item.action) {
        (Some(o), DesktopAfternicListingWriteAction::Update) => {
            o.validate()?;
            if o.domain != item.domain
                || item.binding_generation != Some(item.credential_generation)
                || item.observation_digest.as_deref()
                    != Some(hex_digest(encode(o)?.as_bytes()).as_str())
            {
                return Err(BusinessDatabaseError::StorageRejected);
            }
            identifier(
                item.observation_id
                    .as_deref()
                    .ok_or(BusinessDatabaseError::StorageRejected)?,
            )?;
            validate_sha256_hex(
                item.binding_digest
                    .as_deref()
                    .ok_or(BusinessDatabaseError::StorageRejected)?,
            )?;
        }
        (None, DesktopAfternicListingWriteAction::Create) => {
            if item.observation_id.is_some()
                || item.observation_digest.is_some()
                || item.binding_digest.is_some()
                || item.binding_generation.is_some()
                || item.changes.buynow_price_micro_usd.is_none()
                || item.changes.floor_price_micro_usd.is_none()
                || item.changes.minbid_price_micro_usd.is_none()
                || item.changes.hidden.is_none()
            {
                return Err(BusinessDatabaseError::StorageRejected);
            }
        }
        _ => return Err(BusinessDatabaseError::StorageRejected),
    }
    Ok(())
}
pub(super) fn request_digest(item: &AfternicListingWriteFrozenItem) -> Result<String> {
    Ok(hex_digest(
        encode(&(ADAPTER, item.action, item))?.as_bytes(),
    ))
}
pub(super) fn intent(item: &AfternicListingWriteFrozenItem) -> Result<String> {
    encode(&serde_json::json!({"action":item.action,"changes":item.changes}))
}
fn plan_hash(
    workspace: &str,
    id: &str,
    at: &str,
    expires: &str,
    items: &[StoredItem],
) -> Result<String> {
    let frozen: Vec<_> = items.iter().map(|i| (&i.id, &i.frozen)).collect();
    Ok(hex_digest(
        encode(&(1, WRITE_KIND, workspace, id, at, expires, frozen))?.as_bytes(),
    ))
}
pub(super) fn validate_source(
    c: &Connection,
    workspace: &str,
    item: &AfternicListingWriteFrozenItem,
) -> Result<()> {
    let scan: bool = c.query_row("SELECT EXISTS(SELECT 1 FROM afternic_inventory_scans s JOIN afternic_connection_publications p ON p.workspace_id=s.workspace_id AND p.connection_id=s.connection_id AND p.credential_generation=s.credential_generation WHERE s.workspace_id=?1 AND s.scan_id=?2 AND s.connection_id=?3 AND s.credential_generation=?4 AND p.connection_incarnation_id=?5)",params![workspace,item.scan_id,item.connection_id,sql_integer(item.credential_generation)?,item.connection_incarnation_id],|r|r.get(0)).map_err(storage)?;
    if !scan {
        return Err(BusinessDatabaseError::StorageRejected);
    }
    if let Some(o) = &item.listing {
        let yes: bool = c.query_row("SELECT EXISTS(SELECT 1 FROM afternic_inventory_scans s JOIN marketplace_listing_observations m ON m.workspace_id=s.workspace_id AND m.observation_run_id=s.observation_run_id JOIN afternic_listing_details d USING(workspace_id,listing_observation_id) WHERE s.workspace_id=?1 AND s.scan_id=?2 AND m.listing_observation_id=?3 AND m.binding_connection_id=?4 AND m.binding_resource_digest=?5 AND m.binding_generation=?6 AND m.entity_id=?7 AND m.provider_version_token=?8 AND m.observed_at=?9 AND d.provider_status=?10 AND d.buynow_price IS ?11 AND d.floor_price IS ?12 AND d.minbid_price IS ?13 AND d.hidden IS ?14 AND d.provider_created_at=?15 AND d.provider_updated_at=?16 AND m.confirmed=1 AND m.observation_availability='available' AND m.evidence_status='confirmed')",params![workspace,item.scan_id,item.observation_id,item.connection_id,item.binding_digest,item.binding_generation.map(sql_integer).transpose()?,item.domain,item.observation_digest,item.observed_at,o.status,o.buynow_price.map(sql_integer).transpose()?,o.floor_price.map(sql_integer).transpose()?,o.minbid_price.map(sql_integer).transpose()?,o.hidden,o.created_at,o.updated_at],|r|r.get(0)).map_err(storage)?;
        if !yes {
            return Err(BusinessDatabaseError::StorageRejected);
        }
    } else {
        let present: bool = c.query_row("SELECT EXISTS(SELECT 1 FROM afternic_inventory_scans s JOIN marketplace_listing_observations m ON m.workspace_id=s.workspace_id AND m.observation_run_id=s.observation_run_id WHERE s.workspace_id=?1 AND s.scan_id=?2 AND m.entity_id=?3)",params![workspace,item.scan_id,item.domain],|r|r.get(0)).map_err(storage)?;
        if present {
            return Err(BusinessDatabaseError::StorageRejected);
        }
    }
    Ok(())
}
// Approval and dispatch must agree on every execution column, not just the JSON hash.
fn validate_stored_item(
    c: &Connection,
    workspace: &str,
    plan: &str,
    id: &str,
    frozen: &AfternicListingWriteFrozenItem,
) -> Result<()> {
    validate_frozen(frozen)?;
    validate_source(c, workspace, frozen)?;
    let yes:bool=c.query_row("SELECT EXISTS(SELECT 1 FROM operation_plan_items WHERE workspace_id=?1 AND plan_id=?2 AND item_id=?3 AND entity_id=?4 AND connection_id=?5 AND capability='afternic:marketplace:write' AND field_path IS NULL AND old_value_json=?6 AND new_value_json=?8 AND precondition_json=?7 AND risk_level='standard' AND execution_mode='automatic' AND inclusion_status='included')",params![workspace,plan,id,frozen.domain,frozen.connection_id,encode(&frozen.listing)?,encode(frozen)?,intent(frozen)?],|r|r.get(0)).map_err(storage)?;
    if !yes {
        return Err(BusinessDatabaseError::StorageRejected);
    }
    Ok(())
}
fn items(c: &Connection, workspace: &str, plan: &str) -> Result<Vec<StoredItem>> {
    let mut q=c.prepare("SELECT item_id,precondition_json,ordinal FROM operation_plan_items WHERE workspace_id=?1 AND plan_id=?2 ORDER BY ordinal LIMIT 501").map_err(storage)?;
    let raw = q
        .query_map(params![workspace, plan], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, i64>(2)?,
            ))
        })
        .map_err(storage)?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(storage)?;
    let expected:i64=c.query_row("SELECT item_count FROM operation_plans WHERE workspace_id=?1 AND plan_id=?2 AND operation_kind='afternic_listing_write' AND risk_level='standard'",params![workspace,plan],|r|r.get(0)).map_err(storage)?;
    if raw.is_empty() || raw.len() > 500 || sql_integer(raw.len())? != expected {
        return Err(BusinessDatabaseError::StorageRejected);
    }
    let mut output = Vec::new();
    let mut previous = None;
    for (ordinal, (id, wire, stored_ordinal)) in raw.into_iter().enumerate() {
        identifier(&id)?;
        let frozen: AfternicListingWriteFrozenItem = decode(&wire)?;
        validate_stored_item(c, workspace, plan, &id, &frozen)?;
        if stored_ordinal != sql_integer(ordinal)?
            || previous
                .as_ref()
                .is_some_and(|previous: &String| previous >= &frozen.domain)
        {
            return Err(BusinessDatabaseError::StorageRejected);
        }
        if output.first().is_some_and(|first: &StoredItem| {
            first.frozen.action != frozen.action
                || first.frozen.connection_id != frozen.connection_id
                || first.frozen.connection_incarnation_id != frozen.connection_incarnation_id
                || first.frozen.credential_generation != frozen.credential_generation
        }) {
            return Err(BusinessDatabaseError::StorageRejected);
        }
        previous = Some(frozen.domain.clone());
        output.push(StoredItem { id, frozen });
    }
    Ok(output)
}
pub(super) fn next_sequence(c: &Connection, at: &str) -> Result<i64> {
    c.query_row("UPDATE active_workspace_metadata SET local_commit_sequence=local_commit_sequence+1,updated_at=?1 WHERE singleton=1 RETURNING local_commit_sequence",[at],|r|r.get(0)).map_err(storage)
}
pub(super) fn plus_seconds(c: &Connection, at: &str, seconds: u32) -> Result<String> {
    let next: String = c
        .query_row(
            "SELECT strftime('%Y-%m-%dT%H:%M:%SZ',?1,'+'||?2||' seconds')",
            params![at, seconds],
            |r| r.get(0),
        )
        .map_err(storage)?;
    timestamp(&next)?;
    if next.as_str() <= at {
        return Err(BusinessDatabaseError::StorageRejected);
    }
    Ok(next)
}

fn listing_write_open(c: &Connection, workspace: &str) -> Result<bool> {
    c.query_row(
        "SELECT NOT EXISTS(SELECT 1 FROM device_handoff_barriers WHERE workspace_id=?1)",
        [workspace],
        |row| row.get(0),
    )
    .map_err(storage)
}
fn require_listing_write_open(c: &Connection, workspace: &str) -> Result<()> {
    if !listing_write_open(c, workspace)? {
        return Err(BusinessDatabaseError::MutationStale);
    }
    Ok(())
}
pub(super) fn locally_current(
    c: &Connection,
    workspace: &str,
    item: &AfternicListingWriteFrozenItem,
) -> Result<bool> {
    let valid: bool = c.query_row("SELECT EXISTS(SELECT 1 FROM domain_assets a JOIN local_provider_connections c ON c.workspace_id=a.workspace_id JOIN afternic_connection_publications p ON p.workspace_id=c.workspace_id AND p.connection_id=c.connection_id WHERE a.workspace_id=?1 AND a.entity_id=?2 AND a.lifecycle_status='active' AND a.entity_generation=?3 AND c.connection_id=?4 AND c.connection_incarnation_id=?5 AND c.lifecycle_status='active' AND c.deleted_at IS NULL AND c.revoked_at IS NULL AND c.validation_status='valid' AND c.credential_use_state='active' AND p.connection_incarnation_id=?5 AND p.credential_generation=?6 AND p.publication_state='active' AND NOT EXISTS(SELECT 1 FROM sync_domain_asset_provisional_re_adds r WHERE r.workspace_id=a.workspace_id AND r.entity_id=a.entity_id))",params![workspace,item.domain,sql_integer(item.entity_generation)?,item.connection_id,item.connection_incarnation_id,sql_integer(item.credential_generation)?],|r|r.get(0)).map_err(storage)?;
    if !valid {
        return Ok(false);
    }
    if let Some(binding) = &item.binding_digest {
        return c.query_row("SELECT EXISTS(SELECT 1 FROM domain_asset_provider_bindings WHERE workspace_id=?1 AND entity_id=?2 AND connection_id=?3 AND resource_kind='listing' AND resource_binding_digest=?4 AND binding_generation=?5 AND validation_status IN ('verified','unverified'))",params![workspace,item.domain,item.connection_id,binding,item.binding_generation.map(sql_integer).transpose()?],|r|r.get(0)).map_err(storage);
    }
    // A new create has no bound resource. A binding created by a later observation is checked
    // against its precise resource history before any result is published, never used to resend.
    Ok(true)
}
pub(super) fn no_live_binding(
    c: &Connection,
    workspace: &str,
    item: &AfternicListingWriteFrozenItem,
) -> Result<bool> {
    c.query_row("SELECT NOT EXISTS(SELECT 1 FROM domain_asset_provider_bindings WHERE workspace_id=?1 AND entity_id=?2 AND connection_id=?3 AND resource_kind='listing' AND validation_status!='detached')",params![workspace,item.domain,item.connection_id],|r|r.get(0)).map_err(storage)
}
pub(super) fn other_execution(
    c: &Connection,
    workspace: &str,
    item: &AfternicListingWriteFrozenItem,
    except_plan: &str,
) -> Result<bool> {
    c.query_row("SELECT EXISTS(SELECT 1 FROM operation_plan_items i JOIN operation_attempts a USING(workspace_id,plan_id,item_id) JOIN operation_plans p USING(workspace_id,plan_id) WHERE i.workspace_id=?1 AND i.plan_id<>?2 AND p.operation_kind IN ('afternic_delist','afternic_listing_write') AND i.connection_id=?3 AND i.entity_id=?4 AND json_extract(i.precondition_json,'$.connectionIncarnationId')=?5 AND a.status IN ('queued','running','outcome_unknown') AND NOT EXISTS(SELECT 1 FROM afternic_delist_reconciliations d WHERE d.workspace_id=a.workspace_id AND d.operation_id=a.operation_id AND d.item_id=a.item_id AND d.outcome='absent') AND NOT EXISTS(SELECT 1 FROM afternic_listing_write_reconciliations r WHERE r.workspace_id=a.workspace_id AND r.operation_id=a.operation_id AND r.item_id=a.item_id AND r.item_state='applied'))",params![workspace,except_plan,item.connection_id,item.domain,item.connection_incarnation_id],|r|r.get(0)).map_err(storage)
}

pub(super) fn freeze_items(
    tx: &Connection,
    workspace: &str,
    seed: &AfternicConnectionSeed,
    request: &DesktopAfternicListingWritePreviewRequest,
    at: &str,
    plan_id: &str,
) -> Result<Vec<StoredItem>> {
    let patches = request.patches();
    if request.schema_version() != 1
        || request.connection_id() != seed.connection_id
        || patches.is_empty()
        || patches.len() > 500
        || seed.publication_state != "active"
    {
        return Err(BusinessDatabaseError::InvalidInput);
    }
    let mut unique = BTreeSet::new();
    for (domain, patch) in &patches {
        patch.validate()?;
        if !domain
            .rsplit('.')
            .next()
            .is_some_and(|tld| tld.bytes().any(|b| b.is_ascii_lowercase()))
        {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        validate_domain_asset_id(domain).map_err(|_| BusinessDatabaseError::InvalidInput)?;
        if !unique.insert(domain) {
            return Err(BusinessDatabaseError::InvalidInput);
        }
    }
    let scan:(String,Option<String>)=tx.query_row("SELECT scan_id,observation_run_id FROM afternic_inventory_scans WHERE workspace_id=?1 AND connection_id=?2 AND credential_generation=?3 ORDER BY completed_at DESC,rowid DESC LIMIT 1",params![workspace,seed.connection_id,sql_integer(seed.credential_generation)?],|r|Ok((r.get(0)?,r.get(1)?))).map_err(|_|BusinessDatabaseError::MutationStale)?;
    let run = scan.1;
    let mut frozen = Vec::new();
    for domain in unique {
        let changes = patches
            .iter()
            .find(|(d, _)| d == domain)
            .ok_or(BusinessDatabaseError::InvalidInput)?
            .1
            .clone();
        let generation = tx.query_row("SELECT entity_generation FROM domain_assets WHERE workspace_id=?1 AND entity_id=?2 AND lifecycle_status='active'",params![workspace,domain],|r|unsigned(r,0)).map_err(|_|BusinessDatabaseError::MutationStale)?;
        let mut item = AfternicListingWriteFrozenItem {
            schema_version: 1,
            adapter_revision: ADAPTER.into(),
            scan_id: scan.0.clone(),
            observation_id: None,
            observation_digest: None,
            observed_at: at.into(),
            domain: domain.clone(),
            entity_generation: generation,
            connection_id: seed.connection_id.clone(),
            connection_incarnation_id: seed.connection_incarnation_id.clone(),
            credential_generation: seed.credential_generation,
            binding_digest: None,
            binding_generation: None,
            listing: None,
            action: request.action(),
            changes,
        };
        if item.action == DesktopAfternicListingWriteAction::Update {
            let observed = tx.query_row("SELECT m.listing_observation_id,m.provider_version_token,m.observed_at,m.binding_resource_digest,m.binding_generation,d.provider_status,d.buynow_price,d.floor_price,d.minbid_price,d.hidden,d.provider_created_at,d.provider_updated_at FROM marketplace_listing_observations m JOIN afternic_listing_details d USING(workspace_id,listing_observation_id) WHERE m.workspace_id=?1 AND m.observation_run_id=?2 AND m.entity_id=?3 AND m.binding_connection_id=?4 AND m.confirmed=1 AND m.observation_availability='available' AND m.evidence_status='confirmed'",params![workspace,run,domain,seed.connection_id],|r| { let mut frozen=item.clone(); frozen.observation_id=r.get(0)?;frozen.observation_digest=r.get(1)?;frozen.observed_at=r.get(2)?;frozen.binding_digest=r.get(3)?;frozen.binding_generation=optional_unsigned(r,4)?;frozen.listing=Some(DesktopAfternicListingObservation{domain:domain.clone(),status:r.get(5)?,buynow_price:optional_unsigned(r,6)?,floor_price:optional_unsigned(r,7)?,minbid_price:optional_unsigned(r,8)?,hidden:r.get(9)?,created_at:r.get(10)?,updated_at:r.get(11)?}); Ok(frozen) }).map_err(|_|BusinessDatabaseError::MutationStale)?;
            item = observed;
        } else if !no_live_binding(tx, workspace, &item)? {
            return Err(BusinessDatabaseError::MutationStale);
        }
        validate_frozen(&item)?;
        validate_source(tx, workspace, &item)?;
        if item.observed_at.as_str() > at
            || !locally_current(tx, workspace, &item)?
            || other_execution(tx, workspace, &item, plan_id)?
        {
            return Err(BusinessDatabaseError::MutationStale);
        }
        frozen.push(StoredItem {
            id: random_id()?,
            frozen: item,
        });
    }
    Ok(frozen)
}

pub(super) fn read_item(
    c: &Connection,
    workspace: &str,
    plan: &str,
    id: &str,
    frozen: AfternicListingWriteFrozenItem,
    approved: bool,
) -> Result<DesktopAfternicListingWriteItem> {
    let fact: Option<ItemReadFact> = c.query_row("SELECT a.status,r.item_state,r.reason,r.next_read_at,r.observation_json,r.fields_matched,r.observed_at,r.outcome FROM operation_attempts a LEFT JOIN afternic_listing_write_reconciliations r ON r.workspace_id=a.workspace_id AND r.operation_id=a.operation_id AND r.item_id=a.item_id AND r.sequence=(SELECT max(n.sequence) FROM afternic_listing_write_reconciliations n WHERE n.workspace_id=a.workspace_id AND n.operation_id=a.operation_id AND n.item_id=a.item_id) WHERE a.workspace_id=?1 AND a.plan_id=?2 AND a.item_id=?3",params![workspace,plan,id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?,r.get(7)?))).optional().map_err(storage)?;
    let (state, reason, retry, latest, matched) = match fact {
        None if !approved => ("preview".into(), None, None, None, false),
        Some((status, state, reason, retry, wire, matched, observed_at, _)) => {
            let latest = wire
                .map(|w| {
                    let o: DesktopAfternicListingObservation = decode(&w)?;
                    o.validate()?;
                    Ok(DesktopAfternicListingWriteObserved::from_observation(
                        &o,
                        observed_at
                            .as_deref()
                            .ok_or(BusinessDatabaseError::StorageRejected)?,
                    ))
                })
                .transpose()?;
            (
                state.unwrap_or_else(|| {
                    if status == "queued" {
                        "queued".into()
                    } else {
                        "reconciling".into()
                    }
                }),
                reason,
                retry,
                latest,
                matched.unwrap_or(false),
            )
        }
        _ => return Err(BusinessDatabaseError::StorageRejected),
    };
    Ok(DesktopAfternicListingWriteItem {
        domain: frozen.domain,
        before: frozen
            .listing
            .as_ref()
            .map(|o| DesktopAfternicListingWriteObserved::from_observation(o, &frozen.observed_at)),
        changes: frozen.changes,
        latest,
        fields_matched: matched,
        state,
        reason,
        retry_at: retry,
    })
}

impl BusinessDatabase {
    pub(crate) fn require_afternic_listing_write_write_open(&self) -> Result<()> {
        require_listing_write_open(self.store.raw_connection(), &self.workspace_id)
    }
    pub(crate) fn afternic_listing_write_commit_sequence(&self) -> Result<i64> {
        self.store
            .raw_connection()
            .query_row(
                "SELECT local_commit_sequence FROM active_workspace_metadata WHERE singleton=1",
                [],
                |r| r.get(0),
            )
            .map_err(storage)
    }
    pub(crate) fn preview_afternic_listing_write_with_time<G>(
        &mut self,
        seed: &AfternicConnectionSeed,
        request: &DesktopAfternicListingWritePreviewRequest,
        at: &str,
        authorization_time: &str,
        guard: G,
    ) -> Result<DesktopAfternicListingWritePlan>
    where
        G: FnOnce() -> Result<()>,
    {
        timestamp(at)?;
        timestamp(authorization_time)?;
        let patches = request.patches();
        if request.schema_version() != 1
            || request.connection_id() != seed.connection_id
            || patches.is_empty()
            || patches.len() > 500
            || seed.publication_state != "active"
        {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        let mut unique = BTreeSet::new();
        for (domain, patch) in &patches {
            patch.validate()?;
            if !domain
                .rsplit('.')
                .next()
                .is_some_and(|tld| tld.bytes().any(|b| b.is_ascii_lowercase()))
            {
                return Err(BusinessDatabaseError::InvalidInput);
            }
            validate_domain_asset_id(domain).map_err(|_| BusinessDatabaseError::InvalidInput)?;
            if !unique.insert(domain) {
                return Err(BusinessDatabaseError::InvalidInput);
            }
        }
        self.admit_afternic_provider(seed)?;
        let tx = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(storage)?;
        require_listing_write_open(&tx, &self.workspace_id)?;
        let plan_id = random_id()?;
        let frozen = freeze_items(&tx, &self.workspace_id, seed, request, at, &plan_id)?;
        // Preview lifetime comes from the authenticated continuous-clock projection; wall time
        // remains only the local business timestamp and cannot extend approval admission.
        let expires = plus_seconds(&tx, authorization_time, 900)?;
        let hash = plan_hash(&self.workspace_id, &plan_id, at, &expires, &frozen)?;
        let sequence = next_sequence(&tx, at)?;
        tx.execute("INSERT INTO operation_plans(workspace_id,plan_id,operation_kind,plan_hash,title,phase,risk_level,item_count,created_at,expires_at,local_commit_sequence) VALUES(?1,?2,'afternic_listing_write',?3,?8,'awaiting_approval','standard',?4,?5,?6,?7)",params![self.workspace_id,plan_id,hash,sql_integer(frozen.len())?,at,expires,sequence,if request.action()==DesktopAfternicListingWriteAction::Create {"Afternic listing creation"} else {"Afternic listing update"}]).map_err(storage)?;
        for (ordinal, item) in frozen.iter().enumerate() {
            tx.execute("INSERT INTO operation_plan_items(workspace_id,plan_id,item_id,ordinal,entity_id,connection_id,capability,old_value_json,new_value_json,precondition_json,risk_level,execution_mode,inclusion_status) VALUES(?1,?2,?3,?4,?5,?6,'afternic:marketplace:write',?7,?9,?8,'standard','automatic','included')",params![self.workspace_id,plan_id,item.id,sql_integer(ordinal)?,item.frozen.domain,item.frozen.connection_id,encode(&item.frozen.listing)?,encode(&item.frozen)?,intent(&item.frozen)?]).map_err(storage)?;
        }
        guard()?;
        tx.commit().map_err(storage)?;
        self.afternic_listing_write_plan(&plan_id, at)
    }
    pub(crate) fn approve_afternic_listing_write_with_evidence<G>(
        &mut self,
        plan: &str,
        hash: &str,
        at: &str,
        evidence: &ExecutionEvidenceContext,
        signer: &mut EvidenceSigner<'_>,
        guard: G,
    ) -> Result<DesktopAfternicListingWritePlan>
    where
        G: FnOnce() -> Result<()>,
    {
        if evidence.workspace_id != self.workspace_id {
            return Err(BusinessDatabaseError::MutationStale);
        }
        identifier(plan)?;
        validate_sha256_hex(hash)?;
        timestamp(at)?;
        let tx = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(storage)?;
        let (stored_hash,phase,created,expires):(String,String,String,String)=tx.query_row("SELECT plan_hash,phase,created_at,expires_at FROM operation_plans WHERE workspace_id=?1 AND plan_id=?2 AND operation_kind='afternic_listing_write'",params![self.workspace_id,plan],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).map_err(|_|BusinessDatabaseError::MutationStale)?;
        require_listing_write_open(&tx, &self.workspace_id)?;
        let frozen = items(&tx, &self.workspace_id, plan)?;
        if stored_hash != hash
            || plan_hash(&self.workspace_id, plan, &created, &expires, &frozen)? != hash
        {
            return Err(BusinessDatabaseError::MutationStale);
        }
        if phase == "awaiting_approval" {
            if expires.as_str() <= evidence.occurred_at.as_str() {
                return Err(BusinessDatabaseError::MutationStale);
            }
            for item in &frozen {
                if !locally_current(&tx, &self.workspace_id, &item.frozen)?
                    || other_execution(&tx, &self.workspace_id, &item.frozen, plan)?
                    || (item.frozen.action == DesktopAfternicListingWriteAction::Create
                        && !no_live_binding(&tx, &self.workspace_id, &item.frozen)?)
                {
                    return Err(BusinessDatabaseError::MutationStale);
                }
            }
            let sequence = next_sequence(&tx, at)?;
            let operation = random_id()?;
            tx.execute("UPDATE operation_plans SET phase='approved',approved_at=?3,local_commit_sequence=?4 WHERE workspace_id=?1 AND plan_id=?2",params![self.workspace_id,plan,at,sequence]).map_err(storage)?;
            tx.execute("INSERT INTO operations(workspace_id,operation_id,plan_id,idempotency_key,phase,requested_at,local_commit_sequence) VALUES(?1,?2,?3,?3,'queued',?4,?5)",params![self.workspace_id,operation,plan,at,sequence]).map_err(storage)?;
            for item in &frozen {
                tx.execute("INSERT INTO operation_attempts(workspace_id,operation_id,plan_id,item_id,attempt_number,status,request_digest) VALUES(?1,?2,?3,?4,1,'queued',?5)",params![self.workspace_id,operation,plan,item.id,request_digest(&item.frozen)?]).map_err(storage)?;
            }
            let targets = frozen
                .iter()
                .map(|item| {
                    Ok(ApprovalTarget {
                        item_id: item.id.clone(),
                        request_digest: request_digest(&item.frozen)?,
                    })
                })
                .collect::<Result<Vec<_>>>()?;
            execution_evidence::record_action_approval(
                &tx,
                evidence,
                plan,
                &operation,
                hash,
                &targets,
                match frozen[0].frozen.action {
                    DesktopAfternicListingWriteAction::Create => {
                        execution_evidence::AfternicEvidenceAction::Create
                    }
                    DesktopAfternicListingWriteAction::Update => {
                        execution_evidence::AfternicEvidenceAction::Update
                    }
                },
                signer,
            )?;
            tx.execute(
                "UPDATE operation_plans SET phase='executing' WHERE workspace_id=?1 AND plan_id=?2",
                params![self.workspace_id, plan],
            )
            .map_err(storage)?;
            tx.execute("UPDATE operations SET phase='running',started_at=?3 WHERE workspace_id=?1 AND operation_id=?2",params![self.workspace_id,operation,at]).map_err(storage)?;
        } else if !["approved", "executing", "completed"].contains(&phase.as_str()) {
            return Err(BusinessDatabaseError::MutationStale);
        }
        guard()?;
        tx.commit().map_err(storage)?;
        self.afternic_listing_write_plan(plan, at)
    }
}

impl BusinessDatabase {
    pub(crate) fn afternic_listing_write_plan(
        &self,
        plan: &str,
        at: &str,
    ) -> Result<DesktopAfternicListingWritePlan> {
        identifier(plan)?;
        timestamp(at)?;
        let c = self.store.raw_connection();
        let (hash,phase,created,expires,approved):(String,String,String,String,Option<String>)=c.query_row("SELECT plan_hash,phase,created_at,expires_at,approved_at FROM operation_plans WHERE workspace_id=?1 AND plan_id=?2 AND operation_kind='afternic_listing_write'",params![self.workspace_id,plan],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?))).map_err(|_|BusinessDatabaseError::InvalidInput)?;
        let stored = items(c, &self.workspace_id, plan)?;
        if plan_hash(&self.workspace_id, plan, &created, &expires, &stored)? != hash {
            return Err(BusinessDatabaseError::StorageRejected);
        }
        let label:String=c.query_row("SELECT display_label FROM local_provider_connections WHERE workspace_id=?1 AND connection_id=?2",params![self.workspace_id,stored[0].frozen.connection_id],|r|r.get(0)).map_err(storage)?;
        let action = stored[0].frozen.action;
        let mut output = Vec::with_capacity(stored.len());
        for item in stored {
            output.push(read_item(
                c,
                &self.workspace_id,
                plan,
                &item.id,
                item.frozen,
                approved.is_some(),
            )?);
        }
        let pending = output.iter().any(|i| {
            [
                "queued",
                "reconciling",
                "pending_provider",
                "pending_verification",
            ]
            .contains(&i.state.as_str())
        });
        let conflict = output.iter().any(|i| i.state == "conflict");
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
            return Err(BusinessDatabaseError::StorageRejected);
        }
        Ok(DesktopAfternicListingWritePlan {
            schema_version: 1,
            action,
            plan_ref: plan.into(),
            plan_hash: hash,
            connection_label: label,
            created_at: created,
            expires_at: expires,
            approved_at: approved,
            state: state.into(),
            items: output,
        })
    }
    pub(crate) fn afternic_listing_write_status(
        &self,
        selected: Option<&str>,
        at: &str,
    ) -> Result<DesktopAfternicListingWriteStatus> {
        let mut q=self.store.raw_connection().prepare("SELECT plan_id FROM operation_plans WHERE workspace_id=?1 AND operation_kind='afternic_listing_write' AND NOT EXISTS(SELECT 1 FROM operation_plan_items i WHERE i.workspace_id=operation_plans.workspace_id AND i.plan_id=operation_plans.plan_id AND json_extract(i.precondition_json,'$.schemaVersion')=2) ORDER BY created_at DESC,plan_id DESC LIMIT 50").map_err(storage)?;
        let ids = q
            .query_map([&self.workspace_id], |r| r.get::<_, String>(0))
            .map_err(storage)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(storage)?;
        let mut plans = Vec::new();
        for id in ids {
            let p = self.afternic_listing_write_plan(&id, at)?;
            let total =
                u32::try_from(p.items.len()).map_err(|_| BusinessDatabaseError::StorageRejected)?;
            let applied = u32::try_from(p.items.iter().filter(|i| i.state == "applied").count())
                .map_err(|_| BusinessDatabaseError::StorageRejected)?;
            let conflicts = u32::try_from(p.items.iter().filter(|i| i.state == "conflict").count())
                .map_err(|_| BusinessDatabaseError::StorageRejected)?;
            plans.push(DesktopAfternicListingWriteSummary {
                plan_ref: p.plan_ref,
                connection_label: p.connection_label,
                created_at: p.created_at,
                state: p.state,
                total,
                applied,
                action: p.action,
                pending_provider: u32::try_from(
                    p.items
                        .iter()
                        .filter(|i| i.state == "pending_provider")
                        .count(),
                )
                .map_err(|_| BusinessDatabaseError::StorageRejected)?,
                pending_verification: u32::try_from(
                    p.items
                        .iter()
                        .filter(|i| i.state == "pending_verification")
                        .count(),
                )
                .map_err(|_| BusinessDatabaseError::StorageRejected)?,
                conflicts,
                pending: total - applied - conflicts,
            });
        }
        Ok(DesktopAfternicListingWriteStatus {
            schema_version: 1,
            controlled_acceptance: None,
            write_qualified: false,
            write_entitled: false,
            execution_available: false,
            plans,
            detail: selected
                .map(|id| self.afternic_listing_write_plan(id, at))
                .transpose()?,
        })
    }
    pub(crate) fn next_afternic_listing_write_work_with_evidence<G>(
        &mut self,
        at: &str,
        allow_write: bool,
        evidence: &ExecutionEvidenceContext,
        signer: &mut EvidenceSigner<'_>,
        guard: G,
    ) -> Result<Option<AfternicListingWriteWorkSeed>>
    where
        G: FnOnce() -> Result<()>,
    {
        timestamp(at)?;
        let tx = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(storage)?;
        if !listing_write_open(&tx, &self.workspace_id)? {
            return Ok(None);
        }
        let evidence_fence = execution_evidence::read_fence(&tx, evidence)?;
        let allow_write = allow_write && listing_write_open(&tx, &self.workspace_id)?;
        let mut selected = None;
        // Bound maintenance per wake so corrupt or stale histories cannot starve the application.
        for _ in 0..500 {
            let row:Option<(String,String,String,String,String,String)>=tx.query_row("SELECT a.plan_id,a.operation_id,a.item_id,a.request_digest,a.status,i.precondition_json FROM afternic_listing_write_effective_attempts a JOIN operation_plan_items i USING(workspace_id,plan_id,item_id) JOIN operations o USING(workspace_id,operation_id) LEFT JOIN afternic_listing_write_reconciliations r ON r.workspace_id=a.workspace_id AND r.operation_id=a.operation_id AND r.item_id=a.item_id AND r.sequence=(SELECT max(n.sequence) FROM afternic_listing_write_reconciliations n WHERE n.workspace_id=a.workspace_id AND n.operation_id=a.operation_id AND n.item_id=a.item_id) WHERE a.workspace_id=?1 AND json_extract(i.precondition_json,'$.schemaVersion')=1 AND o.phase='running' AND a.effective_status IN ('queued','running','outcome_unknown') AND (?3 OR a.status!='queued') AND (r.next_read_at IS NULL OR r.next_read_at<=?2) ORDER BY a.status='queued',o.requested_at,a.operation_id,i.ordinal LIMIT 1",params![self.workspace_id,at,allow_write],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?))).optional().map_err(storage)?;
            let Some((plan_id, operation_id, item_id, digest, status, wire)) = row else {
                break;
            };
            let frozen: AfternicListingWriteFrozenItem = decode(&wire)?;
            validate_stored_item(&tx, &self.workspace_id, &plan_id, &item_id, &frozen)?;
            if request_digest(&frozen)? != digest {
                return Err(BusinessDatabaseError::StorageRejected);
            }
            let seed = AfternicListingWriteWorkSeed {
                plan_id,
                operation_id,
                item_id,
                request_digest: digest,
                frozen,
                evidence_fence: evidence_fence.clone(),
                kind: if status == "queued" {
                    DesktopAfternicListingWriteWorkKind::Preflight
                } else {
                    DesktopAfternicListingWriteWorkKind::Reconcile
                },
            };
            if locally_current(&tx, &self.workspace_id, &seed.frozen)? {
                selected = Some(seed);
                break;
            }
            record_fact(
                &tx,
                &self.workspace_id,
                &seed,
                "conflict",
                Some("connection_changed"),
                None,
                None,
                at,
                evidence,
                signer,
            )?;
        }
        guard()?;
        tx.commit().map_err(storage)?;
        Ok(selected)
    }
    pub(crate) fn recheck_afternic_listing_write_work(
        &self,
        seed: &AfternicListingWriteWorkSeed,
    ) -> Result<()> {
        if seed.kind == DesktopAfternicListingWriteWorkKind::Preflight {
            self.require_afternic_listing_write_write_open()?;
        }
        execution_evidence::check_read_fence(
            self.store.raw_connection(),
            &self.workspace_id,
            &seed.evidence_fence,
        )?;
        check_work(self.store.raw_connection(), &self.workspace_id, seed)?;
        if !locally_current(
            self.store.raw_connection(),
            &self.workspace_id,
            &seed.frozen,
        )? {
            return Err(BusinessDatabaseError::MutationStale);
        }
        Ok(())
    }
    pub(crate) fn claim_afternic_listing_write_with_evidence<G>(
        &mut self,
        seed: &AfternicListingWriteWorkSeed,
        observation: Option<&DesktopAfternicListingObservation>,
        at: &str,
        evidence: &ExecutionEvidenceContext,
        signer: &mut EvidenceSigner<'_>,
        guard: G,
    ) -> Result<bool>
    where
        G: FnOnce() -> Result<()>,
    {
        if evidence.workspace_id != self.workspace_id {
            return Err(BusinessDatabaseError::MutationStale);
        }
        if seed.kind != DesktopAfternicListingWriteWorkKind::Preflight {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        validate_observation(seed, observation)?;
        timestamp(at)?;
        let tx = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(storage)?;
        require_listing_write_open(&tx, &self.workspace_id)?;
        execution_evidence::check_read_fence(&tx, &self.workspace_id, &seed.evidence_fence)?;
        check_work(&tx, &self.workspace_id, seed)?;
        if !locally_current(&tx, &self.workspace_id, &seed.frozen)? {
            return Err(BusinessDatabaseError::MutationStale);
        }
        let refusal = match (seed.frozen.action, observation) {
            (DesktopAfternicListingWriteAction::Create, Some(_)) => Some("already_present"),
            (DesktopAfternicListingWriteAction::Create, None)
                if !no_live_binding(&tx, &self.workspace_id, &seed.frozen)? =>
            {
                Some("precondition_changed")
            }
            (DesktopAfternicListingWriteAction::Update, None) => Some("listing_absent"),
            (DesktopAfternicListingWriteAction::Update, Some(o)) if blocked_status(&o.status) => {
                Some("provider_state_blocked")
            }
            (DesktopAfternicListingWriteAction::Update, Some(o))
                if Some(o) != seed.frozen.listing.as_ref() =>
            {
                Some("precondition_changed")
            }
            _ => None,
        };
        let claim = if let Some(reason) = refusal {
            record_fact(
                &tx,
                &self.workspace_id,
                seed,
                "conflict",
                Some(reason),
                observation,
                None,
                at,
                evidence,
                signer,
            )?;
            false
        } else {
            execution_evidence::record_claim(
                &tx,
                evidence,
                &seed.operation_id,
                &seed.item_id,
                &seed.request_digest,
                signer,
            )?;
            let changed=tx.execute("UPDATE operation_attempts SET status='running',started_at=?5,retry_after=NULL WHERE workspace_id=?1 AND operation_id=?2 AND item_id=?3 AND request_digest=?4 AND status='queued'",params![self.workspace_id,seed.operation_id,seed.item_id,seed.request_digest,at]).map_err(storage)?;
            if changed != 1 {
                return Err(BusinessDatabaseError::MutationStale);
            }
            next_sequence(&tx, at)?;
            true
        };
        guard()?;
        tx.commit().map_err(storage)?;
        Ok(claim)
    }
    pub(crate) fn require_afternic_listing_write_signed_claim(
        &self,
        seed: &AfternicListingWriteWorkSeed,
        context: &ExecutionEvidenceContext,
    ) -> Result<()> {
        if seed.frozen.action == DesktopAfternicListingWriteAction::Create
            && !no_live_binding(
                self.store.raw_connection(),
                &self.workspace_id,
                &seed.frozen,
            )?
        {
            return Err(BusinessDatabaseError::MutationStale);
        }
        execution_evidence::require_claim(
            self.store.raw_connection(),
            context,
            &seed.operation_id,
            &seed.item_id,
        )
    }
    pub(crate) fn reconcile_afternic_listing_write_with_evidence<G>(
        &mut self,
        seed: &AfternicListingWriteWorkSeed,
        observation: Option<&DesktopAfternicListingObservation>,
        at: &str,
        evidence: &ExecutionEvidenceContext,
        signer: &mut EvidenceSigner<'_>,
        guard: G,
    ) -> Result<()>
    where
        G: FnOnce() -> Result<()>,
    {
        if seed.kind != DesktopAfternicListingWriteWorkKind::Reconcile {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        validate_observation(seed, observation)?;
        timestamp(at)?;
        let tx = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(storage)?;
        execution_evidence::check_read_fence(&tx, &self.workspace_id, &seed.evidence_fence)?;
        check_work(&tx, &self.workspace_id, seed)?;
        if !locally_current(&tx, &self.workspace_id, &seed.frozen)? {
            return Err(BusinessDatabaseError::MutationStale);
        }
        let (outcome, reason) = match observation {
            Some(o) if blocked_status(&o.status) => ("conflict", Some("provider_state_blocked")),
            Some(o) if seed.frozen.changes.matches(o) => ("matched", None),
            Some(_) => ("different", Some("postcondition_pending")),
            None => ("absent", Some("postcondition_pending")),
        };
        record_fact(
            &tx,
            &self.workspace_id,
            seed,
            outcome,
            reason,
            observation,
            None,
            at,
            evidence,
            signer,
        )?;
        guard()?;
        tx.commit().map_err(storage)
    }
    pub(crate) fn defer_afternic_listing_write_read_with_evidence<G>(
        &mut self,
        seed: &AfternicListingWriteWorkSeed,
        retry_after: Option<u32>,
        at: &str,
        evidence: &ExecutionEvidenceContext,
        signer: &mut EvidenceSigner<'_>,
        guard: G,
    ) -> Result<()>
    where
        G: FnOnce() -> Result<()>,
    {
        timestamp(at)?;
        let tx = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(storage)?;
        execution_evidence::check_read_fence(&tx, &self.workspace_id, &seed.evidence_fence)?;
        check_work(&tx, &self.workspace_id, seed)?;
        if !locally_current(&tx, &self.workspace_id, &seed.frozen)? {
            return Err(BusinessDatabaseError::MutationStale);
        }
        record_fact(
            &tx,
            &self.workspace_id,
            seed,
            "read_failed",
            Some("read_failed"),
            None,
            retry_after,
            at,
            evidence,
            signer,
        )?;
        guard()?;
        tx.commit().map_err(storage)
    }
}

fn validate_observation(
    seed: &AfternicListingWriteWorkSeed,
    observation: Option<&DesktopAfternicListingObservation>,
) -> Result<()> {
    if let Some(listing) = observation {
        listing.validate()?;
        if listing.domain != seed.frozen.domain {
            return Err(BusinessDatabaseError::InvalidInput);
        }
    }
    Ok(())
}
fn check_work(c: &Connection, workspace: &str, seed: &AfternicListingWriteWorkSeed) -> Result<()> {
    validate_stored_item(c, workspace, &seed.plan_id, &seed.item_id, &seed.frozen)?;
    let valid:bool=c.query_row("SELECT EXISTS(SELECT 1 FROM afternic_listing_write_effective_attempts a JOIN operation_plan_items i USING(workspace_id,plan_id,item_id) JOIN operations o USING(workspace_id,operation_id) WHERE a.workspace_id=?1 AND a.operation_id=?2 AND a.plan_id=?3 AND a.item_id=?4 AND a.request_digest=?5 AND i.precondition_json=?6 AND o.phase='running' AND a.effective_status IN ('queued','running','outcome_unknown') AND ((?7 AND a.status='queued') OR (NOT ?7 AND a.status IN ('running','outcome_unknown'))))",params![workspace,seed.operation_id,seed.plan_id,seed.item_id,seed.request_digest,encode(&seed.frozen)?,seed.kind==DesktopAfternicListingWriteWorkKind::Preflight],|r|r.get(0)).map_err(storage)?;
    if !valid || request_digest(&seed.frozen)? != seed.request_digest {
        return Err(BusinessDatabaseError::MutationStale);
    }
    Ok(())
}

pub(super) fn blocked_status(status: &str) -> bool {
    matches!(
        status,
        "SOLD"
            | "FAILED_COMPLIANCE"
            | "INVENTORY_COMPLIANCE_ISSUE"
            | "TLD_UNSUPPORTED"
            | "UNREGISTERED_DOMAIN"
            | "VERIFIED_OWNER_CONFLICT"
    )
}
pub(super) fn result_state(
    seed: &AfternicListingWriteWorkSeed,
    outcome: &str,
    observation: Option<&DesktopAfternicListingObservation>,
) -> &'static str {
    if outcome == "conflict" {
        return "conflict";
    }
    if seed.kind == DesktopAfternicListingWriteWorkKind::Preflight {
        return "queued";
    }
    if let Some(o) = observation {
        if matches!(
            o.status.as_str(),
            "OWNERSHIP_REVIEW" | "OWNERSHIP_UNVERIFIED"
        ) {
            return "pending_verification";
        }
        if matches!(
            o.status.as_str(),
            "PENDING" | "INACTIVE" | "UNKNOWN" | "ON_HOLD"
        ) {
            return "pending_provider";
        }
        if outcome == "matched" {
            let compatible = match seed.frozen.action {
                DesktopAfternicListingWriteAction::Create => {
                    if seed.frozen.changes.hidden == Some(true) {
                        matches!(o.status.as_str(), "ACTIVE" | "HIDDEN") && o.hidden == Some(true)
                    } else {
                        o.status == "ACTIVE" && o.hidden == Some(false)
                    }
                }
                DesktopAfternicListingWriteAction::Update => {
                    matches!(o.status.as_str(), "ACTIVE" | "HIDDEN")
                        && (o.status != "HIDDEN" || o.hidden == Some(true))
                }
            };
            if compatible {
                return "applied";
            }
            return "pending_provider";
        }
    }
    "reconciling"
}
// A create may reuse a binding observed by a concurrent complete inventory only when the
// same connection generation, canonical resource path and provider creation identity agree.
pub(super) fn create_binding_compatible(
    c: &Connection,
    workspace: &str,
    seed: &AfternicListingWriteWorkSeed,
    observation: &DesktopAfternicListingObservation,
) -> Result<bool> {
    if seed.frozen.action == DesktopAfternicListingWriteAction::Update {
        return Ok(seed
            .frozen
            .listing
            .as_ref()
            .is_some_and(|before| before.created_at == observation.created_at));
    }
    if no_live_binding(c, workspace, &seed.frozen)? {
        return Ok(true);
    }
    c.query_row("SELECT EXISTS(SELECT 1 FROM domain_asset_provider_bindings b JOIN marketplace_listing_observations m ON m.workspace_id=b.workspace_id AND m.entity_id=b.entity_id AND m.binding_connection_id=b.connection_id AND m.binding_resource_digest=b.resource_binding_digest AND m.binding_generation=b.binding_generation JOIN afternic_listing_details d USING(workspace_id,listing_observation_id) WHERE b.workspace_id=?1 AND b.entity_id=?2 AND b.connection_id=?3 AND b.resource_kind='listing' AND b.validation_status IN ('verified','unverified') AND b.resource_label=?2 AND b.binding_generation=?4 AND d.provider_created_at=?5 AND m.provider_version_token=b.observation_digest AND m.confirmed=1 AND m.observation_availability='available' AND m.evidence_status='confirmed' AND m.observed_at=(SELECT max(n.observed_at) FROM marketplace_listing_observations n WHERE n.workspace_id=b.workspace_id AND n.entity_id=b.entity_id AND n.binding_connection_id=b.connection_id AND n.binding_resource_digest=b.resource_binding_digest))",params![workspace,seed.frozen.domain,seed.frozen.connection_id,sql_integer(seed.frozen.credential_generation)?,observation.created_at],|r|r.get(0)).map_err(storage)
}
#[expect(
    clippy::too_many_arguments,
    reason = "one concrete result and its signed audit commit with the original business transaction"
)]
pub(super) fn record_fact(
    c: &Connection,
    workspace: &str,
    seed: &AfternicListingWriteWorkSeed,
    outcome: &str,
    reason: Option<&str>,
    observation: Option<&DesktopAfternicListingObservation>,
    retry_after: Option<u32>,
    at: &str,
    evidence: &ExecutionEvidenceContext,
    signer: &mut EvidenceSigner<'_>,
) -> Result<()> {
    if evidence.workspace_id != workspace {
        return Err(BusinessDatabaseError::MutationStale);
    }
    let compatible = observation
        .map(|o| create_binding_compatible(c, workspace, seed, o))
        .transpose()?
        .unwrap_or(true);
    let (outcome, reason) = if compatible {
        (outcome, reason)
    } else {
        ("conflict", Some("precondition_changed"))
    };
    let state = result_state(seed, outcome, observation);
    let audit_id = execution_evidence::record_observation(
        c,
        evidence,
        &seed.evidence_fence,
        &seed.operation_id,
        &seed.item_id,
        outcome,
        reason,
        seed.kind == DesktopAfternicListingWriteWorkKind::Preflight,
        signer,
    )?;
    let current:String=c.query_row("SELECT status FROM operation_attempts WHERE workspace_id=?1 AND operation_id=?2 AND item_id=?3",params![workspace,seed.operation_id,seed.item_id],|r|r.get(0)).map_err(storage)?;
    let target = match (current.as_str(), state) {
        ("queued", "conflict") => Some("failed_final"),
        ("queued", "queued") | ("outcome_unknown", _) => None,
        ("running", "applied") => Some("succeeded"),
        ("running", _) => Some("outcome_unknown"),
        _ => return Err(BusinessDatabaseError::MutationStale),
    };
    if let Some(target) = target {
        c.execute("UPDATE operation_attempts SET status=?4,started_at=COALESCE(started_at,?5),completed_at=?5,retry_after=NULL,error_code=?6 WHERE workspace_id=?1 AND operation_id=?2 AND item_id=?3",params![workspace,seed.operation_id,seed.item_id,target,at,reason]).map_err(storage)?;
        c.execute("INSERT INTO operation_results(workspace_id,operation_id,plan_id,item_id,attempt_number,result_version,outcome,result_json,observed_at) VALUES(?1,?2,?3,?4,1,1,?5,?6,?7)",params![workspace,seed.operation_id,seed.plan_id,seed.item_id,target,encode(&serde_json::json!({"action":seed.frozen.action,"outcome":target}))?,at]).map_err(storage)?;
    }
    let sequence:i64=c.query_row("SELECT count(*)+1 FROM afternic_listing_write_reconciliations WHERE workspace_id=?1 AND operation_id=?2 AND item_id=?3",params![workspace,seed.operation_id,seed.item_id],|r|r.get(0)).map_err(storage)?;
    let next_read = if matches!(state, "applied" | "conflict") {
        None
    } else {
        let exponent = u32::try_from(sequence - 1).unwrap_or(u32::MAX).min(5);
        Some(plus_seconds(
            c,
            at,
            (30_u32 << exponent).min(900).max(retry_after.unwrap_or(0)),
        )?)
    };
    let observation_json = observation.map(encode).transpose()?;
    let digest = observation_json
        .as_ref()
        .map(|wire| hex_digest(wire.as_bytes()));
    let commit_sequence = next_sequence(c, at)?;
    // Refusals retain the observed fact in the attempt. Only an admitted, dispatched exact GET
    // may establish or update the existing Listing binding and sales projection.
    let listing_observation_id =
        if seed.kind == DesktopAfternicListingWriteWorkKind::Reconcile && compatible {
            observation
                .map(|o| record_result_observation(c, workspace, seed, o, at))
                .transpose()?
        } else {
            None
        };
    c.execute("INSERT INTO afternic_listing_write_reconciliations(workspace_id,operation_id,plan_id,item_id,attempt_number,sequence,request_digest,stage,outcome,reason,item_state,fields_matched,observed_at,next_read_at,observation_json,observation_digest,listing_observation_id,audit_event_id) VALUES(?1,?2,?3,?4,1,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17)",params![workspace,seed.operation_id,seed.plan_id,seed.item_id,sequence,seed.request_digest,if seed.kind == DesktopAfternicListingWriteWorkKind::Preflight {"preflight"} else {"reconcile"},outcome,reason,state,observation.is_some_and(|o|seed.frozen.changes.matches(o)),at,next_read,observation_json,digest,listing_observation_id,audit_id]).map_err(storage)?;
    let (pending,failures):(i64,i64)=c.query_row("SELECT sum(effective_status IN ('queued','running','outcome_unknown')),sum(effective_status='failed_final') FROM afternic_listing_write_effective_attempts WHERE workspace_id=?1 AND operation_id=?2",params![workspace,seed.operation_id],|r|Ok((r.get(0)?,r.get(1)?))).map_err(storage)?;
    if pending == 0 {
        c.execute("UPDATE operations SET phase=?3,completed_at=?4,local_commit_sequence=?5 WHERE workspace_id=?1 AND operation_id=?2",params![workspace,seed.operation_id,if failures==0 {"completed"} else {"partially_failed"},at,commit_sequence]).map_err(storage)?;
        c.execute("UPDATE operation_plans SET phase='completed',local_commit_sequence=?3 WHERE workspace_id=?1 AND plan_id=?2",params![workspace,seed.plan_id,commit_sequence]).map_err(storage)?;
    }
    Ok(())
}
fn record_result_observation(
    c: &Connection,
    workspace: &str,
    seed: &AfternicListingWriteWorkSeed,
    observation: &DesktopAfternicListingObservation,
    at: &str,
) -> Result<String> {
    let run = random_id()?;
    c.execute("INSERT INTO provider_observation_runs(workspace_id,observation_run_id,connection_id,observation_capability,started_at,status,connector_version) VALUES(?1,?2,?3,'marketplace',?4,'running',?5)",params![workspace,run,seed.frozen.connection_id,at,ADAPTER]).map_err(storage)?;
    let id = super::afternic::record_listing_observation(
        c,
        workspace,
        &seed.frozen.connection_id,
        seed.frozen.credential_generation,
        observation,
        &run,
        0,
        at,
    )?;
    c.execute("UPDATE provider_observation_runs SET status='succeeded',completed_at=?3 WHERE workspace_id=?1 AND observation_run_id=?2",params![workspace,run,at]).map_err(storage)?;
    c.execute("UPDATE active_workspace_metadata SET last_successful_provider_observation_at=?1 WHERE singleton=1",[at]).map_err(storage)?;
    Ok(id)
}
#[cfg(test)]
#[path = "afternic_listing_write_tests.rs"]
mod tests;
