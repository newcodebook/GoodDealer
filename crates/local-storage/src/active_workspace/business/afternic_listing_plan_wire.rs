//! Bounded, purpose-specific customer intents and redacted durable plan projections.
use super::{
    BusinessDatabaseError, DesktopAfternicControlledAcceptance,
    DesktopAfternicListingWriteObserved, DesktopAfternicListingWritePatch,
    DesktopAfternicListingWritePlan, DesktopAfternicListingWriteSummary,
    DesktopAfternicListingWriteValues, is_uuid_v4, validate_domain_asset_id, validate_sha256_hex,
};
use serde::{Deserialize, Deserializer, Serialize};
use std::collections::BTreeSet;

fn required_nullable<'de, D: Deserializer<'de>, T: Deserialize<'de>>(
    d: D,
) -> Result<Option<T>, D::Error> {
    Option::<T>::deserialize(d)
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DesktopAfternicListingPlanAction {
    Create,
    Update,
    ReactivateOwnershipReview,
}
#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DesktopAfternicOwnershipReviewMode {
    ReactivateOnceIfReview,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DesktopAfternicOwnershipReviewIntent {
    pub mode: DesktopAfternicOwnershipReviewMode,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DesktopAfternicListingPlanCreateItem {
    pub domain: String,
    pub values: DesktopAfternicListingWriteValues,
    #[serde(deserialize_with = "required_nullable")]
    pub ownership_review: Option<DesktopAfternicOwnershipReviewIntent>,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DesktopAfternicListingPlanUpdateItem {
    pub domain: String,
    pub patch: DesktopAfternicListingWritePatch,
    #[serde(deserialize_with = "required_nullable")]
    pub ownership_review: Option<DesktopAfternicOwnershipReviewIntent>,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DesktopAfternicListingPlanReviewItem {
    pub domain: String,
}
#[derive(Debug, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
pub enum DesktopAfternicListingPlanPreviewRequest {
    Create {
        #[serde(rename = "schemaVersion")]
        schema_version: u8,
        #[serde(rename = "connectionId")]
        connection_id: String,
        items: Vec<DesktopAfternicListingPlanCreateItem>,
    },
    Update {
        #[serde(rename = "schemaVersion")]
        schema_version: u8,
        #[serde(rename = "connectionId")]
        connection_id: String,
        items: Vec<DesktopAfternicListingPlanUpdateItem>,
    },
    ReactivateOwnershipReview {
        #[serde(rename = "schemaVersion")]
        schema_version: u8,
        #[serde(rename = "connectionId")]
        connection_id: String,
        items: Vec<DesktopAfternicListingPlanReviewItem>,
    },
}
impl DesktopAfternicListingPlanPreviewRequest {
    pub(crate) const fn schema_version(&self) -> u8 {
        match self {
            Self::Create { schema_version, .. }
            | Self::Update { schema_version, .. }
            | Self::ReactivateOwnershipReview { schema_version, .. } => *schema_version,
        }
    }
    pub(crate) fn connection_id(&self) -> &str {
        match self {
            Self::Create { connection_id, .. }
            | Self::Update { connection_id, .. }
            | Self::ReactivateOwnershipReview { connection_id, .. } => connection_id,
        }
    }
    pub(crate) const fn action(&self) -> DesktopAfternicListingPlanAction {
        match self {
            Self::Create { .. } => DesktopAfternicListingPlanAction::Create,
            Self::Update { .. } => DesktopAfternicListingPlanAction::Update,
            Self::ReactivateOwnershipReview { .. } => {
                DesktopAfternicListingPlanAction::ReactivateOwnershipReview
            }
        }
    }
    pub(crate) fn targets(&self) -> Vec<(String, Option<DesktopAfternicListingWritePatch>, bool)> {
        match self {
            Self::Create { items, .. } => items
                .iter()
                .map(|i| {
                    (
                        i.domain.clone(),
                        Some((&i.values).into()),
                        i.ownership_review.is_some(),
                    )
                })
                .collect(),
            Self::Update { items, .. } => items
                .iter()
                .map(|i| {
                    (
                        i.domain.clone(),
                        Some(i.patch.clone()),
                        i.ownership_review.is_some(),
                    )
                })
                .collect(),
            Self::ReactivateOwnershipReview { items, .. } => items
                .iter()
                .map(|i| (i.domain.clone(), None, true))
                .collect(),
        }
    }
    pub(crate) fn validate(&self) -> Result<(), BusinessDatabaseError> {
        let targets = self.targets();
        if self.schema_version() != 2
            || !is_uuid_v4(self.connection_id())
            || targets.is_empty()
            || targets.len() > 500
            || !targets.iter().any(|(_, _, review)| *review)
        {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        let mut unique = BTreeSet::new();
        for (domain, patch, _) in &targets {
            validate_domain_asset_id(domain).map_err(|_| BusinessDatabaseError::InvalidInput)?;
            if !unique.insert(domain)
                || !domain
                    .rsplit('.')
                    .next()
                    .is_some_and(|tld| tld.bytes().any(|b| b.is_ascii_lowercase()))
            {
                return Err(BusinessDatabaseError::InvalidInput);
            }
            if let Some(patch) = patch {
                patch.validate()?;
            }
        }
        Ok(())
    }
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DesktopAfternicListingPlanApproveRequest {
    pub schema_version: u8,
    pub plan_ref: String,
    pub plan_hash: String,
}
impl DesktopAfternicListingPlanApproveRequest {
    pub(crate) fn validate(&self) -> Result<(), BusinessDatabaseError> {
        if self.schema_version != 2 || !is_uuid_v4(&self.plan_ref) {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        validate_sha256_hex(&self.plan_hash)
    }
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DesktopAfternicListingPlanStatusRequest {
    pub schema_version: u8,
    #[serde(deserialize_with = "required_nullable")]
    pub plan_ref: Option<String>,
}
impl DesktopAfternicListingPlanStatusRequest {
    pub(crate) fn validate(&self) -> Result<(), BusinessDatabaseError> {
        if self.schema_version != 2 || self.plan_ref.as_deref().is_some_and(|id| !is_uuid_v4(id)) {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        Ok(())
    }
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopAfternicListingPlanWrite {
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
pub struct DesktopAfternicListingPlanOwnershipReviewObserved {
    pub provider_status: String,
    pub observed_at: String,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopAfternicListingPlanOwnershipReview {
    pub state: String,
    pub reason: Option<String>,
    pub claimed_at: Option<String>,
    pub retry_at: Option<String>,
    pub retry_not_before: Option<String>,
    pub latest: Option<DesktopAfternicListingPlanOwnershipReviewObserved>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopAfternicListingPlanItem {
    pub domain: String,
    pub listing_write: Option<DesktopAfternicListingPlanWrite>,
    pub ownership_review: Option<DesktopAfternicListingPlanOwnershipReview>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopAfternicListingPlan {
    pub schema_version: u8,
    pub plan_ref: String,
    pub plan_hash: String,
    pub action: DesktopAfternicListingPlanAction,
    pub connection_label: String,
    pub created_at: String,
    pub expires_at: String,
    pub approved_at: Option<String>,
    pub state: String,
    pub items: Vec<DesktopAfternicListingPlanItem>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopAfternicListingPlanCurrentSummary {
    pub schema_version: u8,
    pub plan_ref: String,
    pub action: DesktopAfternicListingPlanAction,
    pub connection_label: String,
    pub created_at: String,
    pub state: String,
    pub total: u32,
    pub applied: u32,
    pub conflicts: u32,
    pub pending: u32,
    pub pending_provider: u32,
    pub pending_verification: u32,
    pub ownership_review_total: u32,
    pub ownership_review_pending: u32,
    pub ownership_review_confirmed: u32,
    pub ownership_review_not_required: u32,
    pub ownership_review_conflicts: u32,
}
#[derive(Clone, Debug, Serialize)]
#[serde(untagged)]
pub enum DesktopAfternicListingPlanSummary {
    Legacy {
        #[serde(rename = "schemaVersion")]
        schema_version: u8,
        #[serde(flatten)]
        summary: DesktopAfternicListingWriteSummary,
    },
    Current(DesktopAfternicListingPlanCurrentSummary),
}
#[derive(Clone, Debug, Serialize)]
#[serde(untagged)]
pub enum DesktopAfternicListingPlanDetail {
    Legacy(DesktopAfternicListingWritePlan),
    Current(DesktopAfternicListingPlan),
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
#[expect(
    clippy::struct_excessive_bools,
    reason = "independent qualification, commercial entitlement and current Native readiness cannot be collapsed into one authority flag"
)]
pub struct DesktopAfternicListingPlanStatus {
    pub schema_version: u8,
    pub controlled_acceptance: Option<DesktopAfternicControlledAcceptance>,
    pub write_qualified: bool,
    pub write_entitled: bool,
    pub execution_available: bool,
    pub ownership_review_qualified: bool,
    pub ownership_review_execution_available: bool,
    pub plans: Vec<DesktopAfternicListingPlanSummary>,
    pub detail: Option<DesktopAfternicListingPlanDetail>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};
    fn request() -> Value {
        json!({"schemaVersion":2,"connectionId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","action":"update","items":[{"domain":"example.com","patch":{"hidden":false},"ownershipReview":{"mode":"reactivate_once_if_review"}}]})
    }
    fn valid(v: Value) -> bool {
        serde_json::from_value::<DesktopAfternicListingPlanPreviewRequest>(v)
            .is_ok_and(|r| r.validate().is_ok())
    }
    #[test]
    fn bounded_intents_reject_expansion_and_wrong_purpose() {
        assert!(valid(request()));
        let mut cases = Vec::new();
        let mut v = request();
        v["schemaVersion"] = json!(1);
        cases.push(v);
        let mut v = request();
        v["extra"] = json!(true);
        cases.push(v);
        let mut v = request();
        v["items"][0]["ownershipReview"]["mode"] = json!("always");
        cases.push(v);
        let mut v = request();
        v["items"][0]
            .as_object_mut()
            .unwrap()
            .remove("ownershipReview");
        cases.push(v);
        let mut v = request();
        v["items"][0]["ownershipReview"] = Value::Null;
        cases.push(v);
        let mut v = request();
        v["items"][0]["patch"] = json!({});
        cases.push(v);
        let mut v = request();
        v["items"][0]["patch"] = json!({"hidden":null});
        cases.push(v);
        let mut v = request();
        v["items"][0]["patch"] = json!({"minbidPriceMicroUsd":1});
        cases.push(v);
        let mut v = request();
        v["items"][0]["domain"] = json!("EXAMPLE.com");
        cases.push(v);
        let mut v = request();
        v["items"] = json!([]);
        cases.push(v);
        let mut v = request();
        let item = v["items"][0].clone();
        v["items"] = json!([item, item]);
        cases.push(v);
        let mut v = request();
        v["items"]=json!((0..501).map(|i| json!({"domain":format!("d{i}.com"),"patch":{"hidden":false},"ownershipReview":{"mode":"reactivate_once_if_review"}})).collect::<Vec<_>>());
        cases.push(v);
        for v in cases {
            assert!(!valid(v));
        }
    }
    #[test]
    fn standalone_cannot_smuggle_write_fields_and_nullable_is_required() {
        let v = json!({"schemaVersion":2,"connectionId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","action":"reactivate_ownership_review","items":[{"domain":"example.com"}]});
        assert!(valid(v.clone()));
        let mut invalid = v;
        invalid["items"][0]["patch"] = json!({"hidden":false});
        assert!(!valid(invalid));
        assert!(
            serde_json::from_value::<DesktopAfternicListingPlanStatusRequest>(
                json!({"schemaVersion":2})
            )
            .is_err()
        );
        assert!(
            serde_json::from_value::<DesktopAfternicListingPlanStatusRequest>(
                json!({"schemaVersion":2,"planRef":null})
            )
            .is_ok()
        );
    }
}
