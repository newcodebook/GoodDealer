//! Exact forced takeover intent and server observations, owned by Native custody, never business backup.
mod wire;
use super::target_bootstrap::DesktopTargetBootstrapTerminalStatus as Terminal;
use super::target_installation::{
    DesktopTargetInstallationPhase as Phase, DesktopTargetInstallationView as Install,
};
use super::{
    DesktopLocalHost, DesktopLocalHostError as Error, PrivateWorkspaceAuthority,
    RuntimeRestriction, WorkspaceAuthorityKind, hex_digest,
};
use crate::desktop_native_cloud::{strict_json, validate_identifier};
use crate::{DesktopNativeCloudAdmission, desktop_custody::DesktopProductionCustody};
use DesktopForcedTakeoverExchangeKind as Kind;
use DesktopForcedTakeoverPreviewReason as Reason;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest as _, Sha256};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DesktopForcedTakeoverPreviewReason {
    SourceUnavailable,
    SwitchInProgress,
    TargetNotStandby,
    ReauthenticationRequired,
    LocalRecoveryRequired,
    HistoryFull,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum DesktopForcedTakeoverPreview {
    Available {
        preview_id: String,
        source_device_id: String,
        source_lease_epoch: u64,
        earliest_takeover_at: String,
        evaluated_at: String,
    },
    Unavailable {
        reason: DesktopForcedTakeoverPreviewReason,
    },
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DesktopForcedTakeoverStoppedReason {
    ReauthenticationRequired,
    SourceChanged,
    AuthorizationChanged,
    LocalRecoveryRequired,
    HistoryFull,
    RequestRejected,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum DesktopForcedTakeoverView {
    Idle,
    CancelledBeforeRequest {
        intent_id: String,
    },
    Requesting {
        intent_id: String,
    },
    Waiting {
        intent_id: String,
        request_id: String,
        source_device_id: String,
        earliest_takeover_at: String,
        evaluated_at: String,
    },
    Cancelling {
        intent_id: String,
        request_id: Option<String>,
    },
    Installing {
        intent_id: String,
        request_id: String,
    },
    Finished {
        intent_id: String,
        request_id: String,
        status: Terminal,
    },
    Stopped {
        intent_id: String,
        reason: DesktopForcedTakeoverStoppedReason,
        can_cancel: bool,
    },
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DesktopForcedTakeoverExchangeKind {
    Preview,
    Request,
    Resolve,
    Status,
    Cancel,
    CancelIntent,
}
pub struct DesktopForcedTakeoverExchange {
    kind: DesktopForcedTakeoverExchangeKind,
    body: Vec<u8>,
    revision: u64,
    authority_epoch: u64,
}
impl DesktopForcedTakeoverExchange {
    #[must_use]
    pub fn kind(&self) -> DesktopForcedTakeoverExchangeKind {
        self.kind
    }
    #[must_use]
    pub fn request_bytes(&self) -> &[u8] {
        &self.body
    }
}
pub enum DesktopForcedTakeoverWork {
    Exchange(DesktopForcedTakeoverExchange),
    ResumeInstallation,
    Settled(DesktopForcedTakeoverView),
}
impl std::fmt::Debug for DesktopForcedTakeoverExchange {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("DesktopForcedTakeoverExchange([REDACTED])")
    }
}
impl std::fmt::Debug for DesktopForcedTakeoverWork {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("DesktopForcedTakeoverWork([REDACTED])")
    }
}
#[derive(Default)]
pub(super) struct Runtime {
    preview: Option<Preview>,
    ready: Option<String>,
    observation: Option<Observation>,
}
struct Preview {
    id: String,
    source: String,
    epoch: u64,
    authority_epoch: u64,
    revision: u64,
}
struct Observation {
    intent: String,
    workflow_revision: u64,
    authority_epoch: u64,
    claimable: bool,
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Origin {
    pub intent_id: String,
    pub idempotency_key: String,
    pub request_digest: String,
    pub source_lease_epoch: u64,
    pub workflow_id: String,
}
impl Origin {
    pub(super) fn validate(&self, workflow: &str) -> Result<(), Error> {
        validate_identifier(&self.intent_id, 160)?;
        validate_identifier(&self.idempotency_key, 160)?;
        validate_identifier(&self.workflow_id, 160)?;
        wire::positive(self.source_lease_epoch)?;
        if self.workflow_id != workflow
            || self.request_digest.len() != 64
            || !self
                .request_digest
                .bytes()
                .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
        {
            return Err(rejected());
        }
        Ok(())
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Intent {
    id: String,
    idempotency_key: String,
    source_device: String,
    source_epoch: u64,
    security_epoch: u64,
    authority_digest: String,
    request_bytes: Vec<u8>,
    sent: bool,
    cancel: bool,
    cancel_unknown: bool,
    #[serde(deserialize_with = "required_option")]
    cancelled_before_request: Option<Value>,
    #[serde(deserialize_with = "required_option")]
    request: Option<wire::Request>,
    #[serde(deserialize_with = "required_option")]
    workflow: Option<wire::Workflow>,
    #[serde(deserialize_with = "required_option")]
    stopped: Option<DesktopForcedTakeoverStoppedReason>,
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Control {
    schema_version: u8,
    installation: [u8; 32],
    account: String,
    workspace: String,
    device: String,
    revision: u64,
    #[serde(deserialize_with = "required_option")]
    intent: Option<Intent>,
    history: Vec<Intent>,
}
fn required_option<'de, D: serde::Deserializer<'de>, T: Deserialize<'de>>(
    d: D,
) -> Result<Option<T>, D::Error> {
    Option::deserialize(d)
}
fn rejected() -> Error {
    Error::CloudProtocolRejected
}
fn storage() -> Error {
    Error::StorageRejected
}
fn bytes<T: Serialize>(value: &T) -> Result<Vec<u8>, Error> {
    serde_json::to_vec(value).map_err(|_| storage())
}
fn random_id() -> Result<String, Error> {
    let mut value = [0u8; 32];
    getrandom::fill(&mut value).map_err(|_| Error::Unavailable)?;
    Ok(hex_digest(&value))
}
fn request_bytes(intent: &Intent, target: &str) -> Result<Vec<u8>, Error> {
    bytes(
        &json!({"schemaVersion":2,"mode":"forced","toDeviceId":target,"expectedSourceLeaseEpoch":intent.source_epoch,"idempotencyKey":intent.idempotency_key}),
    )
}
fn request_id_bytes(id: &str) -> Result<Vec<u8>, Error> {
    bytes(&json!({"schemaVersion":1,"requestId":id}))
}
impl Intent {
    fn validate(&self, target: &str) -> Result<(), Error> {
        for id in [&self.id, &self.idempotency_key, &self.source_device] {
            validate_identifier(id, 160)?;
        }
        wire::positive(self.source_epoch)?;
        wire::positive(self.security_epoch)?;
        if self.cancelled_before_request.is_some() && (self.request.is_some() || !self.cancel) {
            return Err(rejected());
        }
        if let Some(evidence) = &self.cancelled_before_request {
            if evidence["outcome"].as_str() == Some("cancelled_before_request") {
                wire::exact(evidence, &["schemaVersion", "outcome", "originalRequest"])?;
                if evidence["originalRequest"] != strict_json::<Value>(&self.request_bytes)? {
                    return Err(rejected());
                }
            } else {
                wire::exact(evidence, &["schemaVersion", "accepted", "code"])?;
                if evidence["accepted"] != false || evidence["code"] != "FORCED_INTENT_CANCELLED" {
                    return Err(rejected());
                }
            }
        }
        if self.source_device == target
            || self.authority_digest.len() != 64
            || self.request_bytes != request_bytes(self, target)?
            || self.cancel_unknown && !self.cancel
        {
            return Err(rejected());
        }
        if let Some(request) = &self.request {
            self.matches_request(request, target)?;
        }
        if let Some(workflow) = &self.workflow {
            workflow.validate(target)?;
            self.matches_request(&workflow.request, target)?;
            if workflow.source_lease_epoch != self.source_epoch
                || self.request.as_ref() != Some(&workflow.request)
            {
                return Err(rejected());
            }
        }
        Ok(())
    }
    fn matches_request(&self, request: &wire::Request, target: &str) -> Result<(), Error> {
        request.validate(target)?;
        if request.from_device_id.as_ref() != Some(&self.source_device)
            || self.request.as_ref().is_some_and(|old| {
                old.request_id != request.request_id
                    || old.requested_at != request.requested_at
                    || old.earliest_takeover_at > request.earliest_takeover_at
                    || old.status == "bootstrapping" && request.status == "waiting_expiry"
                    || matches!(old.status.as_str(), "cancelled" | "failed" | "completed")
                        && old != request
            })
        {
            return Err(rejected());
        }
        Ok(())
    }
    fn origin(&self) -> Result<Origin, Error> {
        Ok(Origin {
            intent_id: self.id.clone(),
            idempotency_key: self.idempotency_key.clone(),
            request_digest: hex_digest(&Sha256::digest(&self.request_bytes).into()),
            source_lease_epoch: self.source_epoch,
            workflow_id: self
                .request
                .as_ref()
                .ok_or_else(rejected)?
                .request_id
                .clone(),
        })
    }
    fn consume_switch_response(
        &mut self,
        kind: Kind,
        value: &Value,
        target: &str,
    ) -> Result<(), Error> {
        if value["accepted"] == false {
            wire::exact(value, &["schemaVersion", "accepted", "code"])?;
            let code = value["code"].as_str().ok_or_else(rejected)?;
            let reason = wire::rejection(code)?;
            if kind == Kind::Request {
                if code == "FORCED_INTENT_CANCELLED" {
                    self.cancel = true;
                    self.cancelled_before_request = Some(value.clone());
                } else {
                    self.stopped = Some(reason);
                }
            } // Cancel remains uncertain until exact status.
        } else {
            wire::exact(value, &["schemaVersion", "accepted", "request"])?;
            if value["accepted"] != true {
                return Err(rejected());
            }
            let request = wire::request(value["request"].clone(), target)?;
            self.matches_request(&request, target)?;
            if kind == Kind::Cancel
                && !["cancelled", "failed", "completed"].contains(&request.status.as_str())
            {
                return Err(rejected());
            }
            self.request = Some(request);
            self.workflow = None;
        }
        Ok(())
    }
    fn consume_cancel_intent(&mut self, value: &Value, target: &str) -> Result<(), Error> {
        if !self.cancel || self.request.is_some() {
            return Err(rejected());
        }
        let outcome = value["outcome"].as_str().ok_or_else(rejected)?;
        wire::exact(
            value,
            if outcome == "cancelled_before_request" {
                &["schemaVersion", "outcome", "originalRequest"]
            } else {
                &["schemaVersion", "outcome", "originalRequest", "workflow"]
            },
        )?;
        if value["originalRequest"] != strict_json::<Value>(&self.request_bytes)? {
            return Err(rejected());
        }
        match outcome {
            "cancelled_before_request" => {
                self.cancelled_before_request = Some(value.clone());
                self.cancel_unknown = false;
            }
            "workflow" => {
                let workflow = wire::workflow(value["workflow"].clone(), target)?;
                self.matches_request(&workflow.request, target)?;
                if workflow.source_lease_epoch != self.source_epoch {
                    return Err(rejected());
                }
                self.request = Some(workflow.request.clone());
                self.workflow = Some(workflow);
                self.cancel_unknown = false;
            }
            _ => return Err(rejected()),
        }
        Ok(())
    }
    fn terminal(&self) -> Option<Terminal> {
        match self.request.as_ref()?.status.as_str() {
            "cancelled" => Some(Terminal::Cancelled),
            "failed" => Some(Terminal::Failed),
            "completed" => Some(Terminal::Completed),
            _ => None,
        }
    }
    fn view(&self, security: u64) -> DesktopForcedTakeoverView {
        use DesktopForcedTakeoverView as View;
        if self.cancelled_before_request.is_some() {
            return View::CancelledBeforeRequest {
                intent_id: self.id.clone(),
            };
        }
        if let Some(status) = self.terminal() {
            return View::Finished {
                intent_id: self.id.clone(),
                request_id: self
                    .request
                    .as_ref()
                    .expect("terminal has request")
                    .request_id
                    .clone(),
                status,
            };
        }
        if self.security_epoch != security {
            return View::Stopped {
                intent_id: self.id.clone(),
                reason: DesktopForcedTakeoverStoppedReason::AuthorizationChanged,
                can_cancel: false,
            };
        }
        if self.cancel {
            return View::Cancelling {
                intent_id: self.id.clone(),
                request_id: self.request.as_ref().map(|v| v.request_id.clone()),
            };
        }
        if let Some(reason) = &self.stopped {
            return View::Stopped {
                intent_id: self.id.clone(),
                reason: reason.clone(),
                can_cancel: self.request.is_some(),
            };
        }
        match &self.request {
            Some(request) if request.status == "bootstrapping" => View::Installing {
                intent_id: self.id.clone(),
                request_id: request.request_id.clone(),
            },
            Some(request) if request.status == "waiting_expiry" => {
                self.workflow.as_ref().map_or_else(
                    || View::Requesting {
                        intent_id: self.id.clone(),
                    },
                    |workflow| View::Waiting {
                        intent_id: self.id.clone(),
                        request_id: request.request_id.clone(),
                        source_device_id: self.source_device.clone(),
                        earliest_takeover_at: request
                            .earliest_takeover_at
                            .clone()
                            .expect("validated earliest"),
                        evaluated_at: workflow.evaluated_at.clone(),
                    },
                )
            }
            _ => View::Requesting {
                intent_id: self.id.clone(),
            },
        }
    }
}
impl Control {
    fn validate(&self) -> Result<(), Error> {
        if self.schema_version != 1 || self.revision > wire::MAX_NUMBER || self.history.len() > 8 {
            return Err(rejected());
        }
        for id in [&self.account, &self.workspace, &self.device] {
            validate_identifier(id, 160)?;
        }
        if let Some(intent) = &self.intent {
            intent.validate(&self.device)?;
        }
        for intent in &self.history {
            intent.validate(&self.device)?;
            if intent.terminal().is_none()
                && intent.cancelled_before_request.is_none()
                && !(intent.request.is_none() && intent.stopped.is_some())
            {
                return Err(rejected());
            }
        }
        Ok(())
    }
    fn view(&self, security: u64) -> DesktopForcedTakeoverView {
        self.intent
            .as_ref()
            .map_or(DesktopForcedTakeoverView::Idle, |i| i.view(security))
    }
}

impl DesktopLocalHost {
    fn with_forced<T>(
        &self,
        admission: &DesktopNativeCloudAdmission,
        mutate: bool,
        action: impl FnOnce(
            &mut Control,
            &PrivateWorkspaceAuthority,
            &DesktopProductionCustody,
            u64,
        ) -> Result<T, Error>,
    ) -> Result<T, Error> {
        let _operation = self.operation_selection.lock().map_err(|_| storage())?;
        let authority = self.authority_publication.lock().map_err(|_| storage())?;
        let current = authority
            .authority
            .as_ref()
            .ok_or(Error::AuthorityRejected)?;
        let epoch = authority.applied_authority_epoch;
        let matching = matches!(
            (authority.restriction, current.kind, admission.is_active()),
            (
                RuntimeRestriction::Standby,
                WorkspaceAuthorityKind::Standby,
                false
            ) | (
                RuntimeRestriction::Active,
                WorkspaceAuthorityKind::Active,
                true
            )
        );
        let installing = admission.is_installing_target()
            && self
                .installation_context_gate
                .load(super::Ordering::Acquire)
            && authority.restriction == RuntimeRestriction::Active
            && current.kind == WorkspaceAuthorityKind::Active;
        if !(matching || installing)
            || epoch != admission.inner.authority_epoch
            || admission.workspace_id() != current.workspace_id
            || admission.inner.device_id() != current.device_id
            || admission.inner.authority_snapshot_digest() != hex_digest(&current.digest)
        {
            return Err(Error::AuthorityRejected);
        }
        let fence = || {
            self.require_business_commit_fence(epoch, current)
                .map_err(super::map_host_database_error)
        };
        fence()?;
        let custody = self
            .production_custody
            .as_ref()
            .ok_or(Error::Unavailable)?
            .lock()
            .map_err(|_| storage())?;
        let installation = custody
            .installation_binding_digest()
            .map_err(|_| storage())?;
        let previous = custody
            .load_forced_takeover_control()
            .map_err(|_| storage())?;
        let mut control = if let Some(bytes) = &previous {
            decode(bytes)?
        } else {
            Control {
                schema_version: 1,
                installation,
                account: current.account_id.clone(),
                workspace: current.workspace_id.clone(),
                device: current.device_id.clone(),
                revision: 0,
                intent: None,
                history: Vec::new(),
            }
        };
        if control.installation != installation
            || control.account != current.account_id
            || control.workspace != current.workspace_id
            || control.device != current.device_id
        {
            return Err(Error::AuthorityRejected);
        }
        let revision = control
            .revision
            .checked_add(u64::from(mutate))
            .filter(|v| *v <= wire::MAX_NUMBER)
            .ok_or_else(rejected)?;
        let before = control.clone();
        let result = action(&mut control, current, &custody, revision)?;
        if mutate && control != before {
            control.revision = revision;
            control.validate()?;
            fence()?;
            custody
                .replace_forced_takeover_control(previous.as_deref(), &bytes(&control)?)
                .map_err(|_| storage())?;
        }
        fence()?;
        Ok(result)
    }
    /// Selects a fresh, target-bound source preview after Native's explicit browser reauthentication.
    /// # Errors
    /// Rejects changed authority or unavailable custody; it never releases a source lease.
    pub fn prepare_forced_takeover_preview(
        &self,
        admission: &DesktopNativeCloudAdmission,
    ) -> Result<DesktopForcedTakeoverExchange, Error> {
        self.reconcile_installation_terminal(admission)?;
        self.with_forced(admission, true, |control, current, _, revision| {
            if current.kind != WorkspaceAuthorityKind::Standby {
                return Err(Error::AuthorityRejected);
            }
            control.revision = revision;
            self.forced_takeover_runtime
                .lock()
                .map_err(|_| storage())?
                .preview = None;
            Ok(DesktopForcedTakeoverExchange {
                kind: DesktopForcedTakeoverExchangeKind::Preview,
                body: bytes(&json!({"schemaVersion":1}))?,
                revision,
                authority_epoch: admission.inner.authority_epoch,
            })
        })
    }
    /// Checks both Cloud's source preview and the local unopened-installation prerequisite.
    /// # Errors
    /// Rejects stale exchanges, foreign devices and unknown fields.
    pub fn complete_forced_takeover_preview(
        &self,
        admission: &DesktopNativeCloudAdmission,
        exchange: &DesktopForcedTakeoverExchange,
        response: &[u8],
    ) -> Result<DesktopForcedTakeoverPreview, Error> {
        let value = wire::parse(response)?;
        self.with_forced(admission, true, |control, current, custody, revision| {
            require_exchange(
                control,
                admission,
                exchange,
                DesktopForcedTakeoverExchangeKind::Preview,
            )?;
            control.revision = revision;
            if current.kind != WorkspaceAuthorityKind::Standby {
                return Err(Error::AuthorityRejected);
            }
            let unavailable = |reason| Ok(DesktopForcedTakeoverPreview::Unavailable { reason });
            if value["available"] == false {
                wire::exact(&value, &["schemaVersion", "available", "reason"])?;
                return unavailable(match value["reason"].as_str() {
                    Some("SOURCE_UNAVAILABLE") => Reason::SourceUnavailable,
                    Some("SWITCH_IN_PROGRESS") => Reason::SwitchInProgress,
                    Some("TARGET_NOT_STANDBY") => Reason::TargetNotStandby,
                    Some("REAUTH_REQUIRED") => Reason::ReauthenticationRequired,
                    _ => return Err(rejected()),
                });
            }
            wire::exact(
                &value,
                &[
                    "schemaVersion",
                    "available",
                    "sourceDeviceId",
                    "sourceLeaseEpoch",
                    "toDeviceId",
                    "earliestTakeoverAt",
                    "evaluatedAt",
                ],
            )?;
            if value["available"] != true
                || value["toDeviceId"].as_str() != Some(current.device_id.as_str())
            {
                return Err(rejected());
            }
            let source = value["sourceDeviceId"]
                .as_str()
                .ok_or_else(rejected)?
                .to_owned();
            validate_identifier(&source, 160)?;
            let source_epoch = value["sourceLeaseEpoch"].as_u64().ok_or_else(rejected)?;
            wire::positive(source_epoch)?;
            let earliest = value["earliestTakeoverAt"]
                .as_str()
                .ok_or_else(rejected)?
                .to_owned();
            let evaluated = value["evaluatedAt"]
                .as_str()
                .ok_or_else(rejected)?
                .to_owned();
            crate::desktop_native_cloud::validate_timestamp(&earliest)?;
            crate::desktop_native_cloud::validate_timestamp(&evaluated)?;
            if source == current.device_id || earliest < evaluated {
                return Err(rejected());
            }
            if control.intent.as_ref().is_some_and(|intent| {
                intent.terminal().is_none()
                    && intent.cancelled_before_request.is_none()
                    && !(intent.request.is_none() && intent.stopped.is_some())
            }) {
                return unavailable(Reason::SwitchInProgress);
            }
            if control.history.len() == 8 {
                return unavailable(Reason::HistoryFull);
            }
            match super::target_installation::forced_eligibility(custody, current)? {
                super::target_installation::DesktopTargetInstallationNewWorkflow::Allowed => {}
                super::target_installation::DesktopTargetInstallationNewWorkflow::HistoryFull => {
                    return unavailable(Reason::HistoryFull);
                }
                _ => return unavailable(Reason::LocalRecoveryRequired),
            }
            let id = random_id()?;
            self.forced_takeover_runtime
                .lock()
                .map_err(|_| storage())?
                .preview = Some(Preview {
                id: id.clone(),
                source: source.clone(),
                epoch: source_epoch,
                authority_epoch: admission.inner.authority_epoch,
                revision,
            });
            Ok(DesktopForcedTakeoverPreview::Available {
                preview_id: id,
                source_device_id: source,
                source_lease_epoch: source_epoch,
                earliest_takeover_at: earliest,
                evaluated_at: evaluated,
            })
        })
    }
    /// Persists exactly one approved request before any mutation HTTP is permitted.
    /// # Errors
    /// Rejects stale or replayed previews and any target that cannot reserve an unopened replica.
    pub fn confirm_forced_takeover(
        &self,
        admission: &DesktopNativeCloudAdmission,
        preview_id: &str,
    ) -> Result<DesktopForcedTakeoverView, Error> {
        validate_identifier(preview_id, 160)?;
        self.with_forced(admission, true, |control, current, custody, _| {
            let mut runtime = self.forced_takeover_runtime.lock().map_err(|_| storage())?;
            let preview = runtime.preview.take().ok_or_else(rejected)?;
            if preview.id != preview_id
                || preview.authority_epoch != admission.inner.authority_epoch
                || preview.revision != control.revision
                || current.kind != WorkspaceAuthorityKind::Standby
                || control.history.len() == 8
                || super::target_installation::forced_eligibility(custody, current)?
                    != super::target_installation::DesktopTargetInstallationNewWorkflow::Allowed
            {
                return Err(rejected());
            }
            if control.intent.as_ref().is_some_and(|i| {
                i.terminal().is_none()
                    && i.cancelled_before_request.is_none()
                    && !(i.request.is_none() && i.stopped.is_some())
            }) {
                return Err(rejected());
            }
            let mut intent = Intent {
                id: random_id()?,
                idempotency_key: random_id()?,
                source_device: preview.source,
                source_epoch: preview.epoch,
                security_epoch: current.account_security_epoch,
                authority_digest: hex_digest(&current.digest),
                request_bytes: Vec::new(),
                sent: false,
                cancel: false,
                cancel_unknown: false,
                cancelled_before_request: None,
                request: None,
                workflow: None,
                stopped: None,
            };
            intent.request_bytes = request_bytes(&intent, &current.device_id)?;
            runtime.ready = Some(intent.id.clone());
            runtime.observation = None;
            if let Some(old) = control.intent.replace(intent) {
                control.history.push(old);
            }
            Ok(control.view(current.account_security_epoch))
        })
    }
    /// Reads local progress without advancing a network exchange or its compare-and-swap revision.
    /// # Errors
    /// Rejects damaged custody and authority changes.
    pub fn forced_takeover_status(
        &self,
        admission: &DesktopNativeCloudAdmission,
    ) -> Result<DesktopForcedTakeoverView, Error> {
        let installation = self.target_installation_status(admission)?;
        self.with_forced(admission, false, |control, current, _, _| {
            let view = control.view(current.account_security_epoch);
            let Some(intent) = &control.intent else {
                return Ok(view);
            };
            let Some(request) = &intent.request else {
                return Ok(view);
            };
            if intent.security_epoch != current.account_security_epoch
                || intent.cancel
                || intent.stopped.is_some()
            {
                return Ok(view);
            }
            Ok(match installation {
                Install::Completed { request_id } if request_id == request.request_id => {
                    DesktopForcedTakeoverView::Finished {
                        intent_id: intent.id.clone(),
                        request_id,
                        status: Terminal::Completed,
                    }
                }
                Install::Stopped {
                    request_id, status, ..
                } if request_id == request.request_id => DesktopForcedTakeoverView::Finished {
                    intent_id: intent.id.clone(),
                    request_id,
                    status,
                },
                Install::Running { request_id, phase }
                    if request_id == request.request_id && phase != Phase::Claiming =>
                {
                    DesktopForcedTakeoverView::Installing {
                        intent_id: intent.id.clone(),
                        request_id,
                    }
                }
                _ => view,
            })
        })
    }
    /// Persists cancellation of the original intent; an unknown request is resolved before cancellation.
    /// # Errors
    /// Rejects a foreign intent or consent from a revoked security epoch.
    pub fn cancel_forced_takeover(
        &self,
        admission: &DesktopNativeCloudAdmission,
        intent_id: &str,
    ) -> Result<DesktopForcedTakeoverView, Error> {
        validate_identifier(intent_id, 160)?;
        self.with_forced(admission, true, |control, current, _, _| {
            let intent = control.intent.as_mut().ok_or_else(rejected)?;
            if intent.id != intent_id || intent.security_epoch != current.account_security_epoch {
                return Err(rejected());
            }
            if intent.terminal().is_none() && intent.cancelled_before_request.is_none() {
                intent.cancel = true;
                intent.cancel_unknown = true;
            }
            self.forced_takeover_runtime
                .lock()
                .map_err(|_| storage())?
                .observation = None;
            Ok(control.view(current.account_security_epoch))
        })
    }
    /// Selects fixed routes, or durably reserves the real workflow before resuming installation.
    /// # Errors
    /// Rejects scope changes and damaged evidence without releasing the source.
    #[expect(
        clippy::too_many_lines,
        reason = "one owner transaction prioritizes terminal reconciliation and cancellation before any source-release reservation"
    )]
    pub fn prepare_forced_takeover_work(
        &self,
        admission: &DesktopNativeCloudAdmission,
    ) -> Result<DesktopForcedTakeoverWork, Error> {
        self.reconcile_installation_terminal(admission)?;
        let work = self.with_forced(admission, true, |control, current, custody, revision| {
            let Some(intent) = control.intent.as_mut() else {
                return Ok(DesktopForcedTakeoverWork::Settled(
                    DesktopForcedTakeoverView::Idle,
                ));
            };
            if intent.security_epoch != current.account_security_epoch
                || intent.terminal().is_some()
                || intent.cancelled_before_request.is_some()
                || intent.stopped.is_some() && !intent.cancel
            {
                return Ok(DesktopForcedTakeoverWork::Settled(
                    intent.view(current.account_security_epoch),
                ));
            }
            if intent.request.is_some()
                && super::target_installation::forced_installation_terminal(
                    custody,
                    &intent.origin()?,
                    current.account_security_epoch,
                )?
                .is_some()
            {
                control.revision = revision;
                return Ok(DesktopForcedTakeoverWork::Exchange(
                    DesktopForcedTakeoverExchange {
                        kind: Kind::Status,
                        body: request_id_bytes(
                            &intent.request.as_ref().ok_or_else(rejected)?.request_id,
                        )?,
                        revision,
                        authority_epoch: admission.inner.authority_epoch,
                    },
                ));
            }
            let mut runtime = self.forced_takeover_runtime.lock().map_err(|_| storage())?;
            let claimed = intent.request.is_some()
                && super::target_installation::forced_installation_has_claim(
                    custody,
                    &intent.origin()?,
                    current.account_security_epoch,
                )?;
            if claimed && (admission.is_installing_target() || !intent.cancel) {
                return Ok(DesktopForcedTakeoverWork::ResumeInstallation);
            }
            let (kind, body) = if let Some(request) = &intent.request {
                if intent.cancel {
                    let transferred = request.status == "bootstrapping" || claimed;
                    let terminal = super::target_bootstrap::installation_terminal(
                        custody,
                        &request.request_id,
                    )?;
                    if transferred && terminal.is_none() {
                        super::target_bootstrap::inherit_forced_cancel(
                            custody,
                            &request.request_id,
                            current.account_security_epoch,
                        )?;
                    }
                    if super::target_installation::cancellation_blocked(
                        custody,
                        &request.request_id,
                        current.account_security_epoch,
                    )? {
                        return Ok(DesktopForcedTakeoverWork::ResumeInstallation);
                    }
                    if transferred {
                        if terminal.is_none() {
                            // Once capability exists, only the bootstrap cancellation lane may
                            // terminate it. The waiting endpoint cannot cancel this workflow.
                            return Ok(DesktopForcedTakeoverWork::Settled(
                                intent.view(current.account_security_epoch),
                            ));
                        }
                        (Kind::Status, request_id_bytes(&request.request_id)?)
                    } else if intent.cancel_unknown {
                        (Kind::Status, request_id_bytes(&request.request_id)?)
                    } else {
                        intent.cancel_unknown = true;
                        (Kind::Cancel, request_id_bytes(&request.request_id)?)
                    }
                } else if request.status == "bootstrapping"
                    || runtime.observation.as_ref().is_some_and(|observation| {
                        observation.intent == intent.id
                            && observation.authority_epoch == admission.inner.authority_epoch
                            && observation.claimable
                            && intent.workflow.as_ref().is_some_and(|workflow| {
                                workflow.workflow_revision == observation.workflow_revision
                            })
                    })
                {
                    return Ok(DesktopForcedTakeoverWork::ResumeInstallation);
                } else {
                    (Kind::Status, request_id_bytes(&request.request_id)?)
                }
            } else if intent.cancel {
                (Kind::CancelIntent, cancel_intent_bytes(intent)?)
            } else if !intent.sent && runtime.ready.as_ref() == Some(&intent.id) {
                runtime.ready = None;
                intent.sent = true;
                (Kind::Request, intent.request_bytes.clone())
            } else {
                (
                    Kind::Resolve,
                    bytes(&json!({"schemaVersion":1,"idempotencyKey":intent.idempotency_key}))?,
                )
            };
            control.revision = revision;
            Ok(DesktopForcedTakeoverWork::Exchange(
                DesktopForcedTakeoverExchange {
                    kind,
                    body,
                    revision,
                    authority_epoch: admission.inner.authority_epoch,
                },
            ))
        })?;
        if matches!(work, DesktopForcedTakeoverWork::ResumeInstallation) {
            // The second owner transaction revalidates the exact durable intent, including a
            // racing cancellation. The coordinator cannot send Claim until this reservation exists.
            if let Some(reason) = self.reserve_forced_installation(admission)? {
                return self.with_forced(admission, true, |control, current, _, _| {
                    if let Some(intent) = &mut control.intent {
                        intent.stopped = Some(reason);
                    }
                    Ok(DesktopForcedTakeoverWork::Settled(
                        control.view(current.account_security_epoch),
                    ))
                });
            }
        }
        Ok(work)
    }
    /// Accepts only exact original request/epoch results and persists them before publication.
    /// # Errors
    /// Rejects foreign workflows, stale responses, nonmonotone status and unknown wire fields.
    #[expect(
        clippy::too_many_lines,
        reason = "fixed response branches share one original-intent CAS and final publication fence"
    )]
    pub fn complete_forced_takeover_work(
        &self,
        admission: &DesktopNativeCloudAdmission,
        exchange: &DesktopForcedTakeoverExchange,
        response: &[u8],
    ) -> Result<DesktopForcedTakeoverView, Error> {
        let value = wire::parse(response)?;
        self.with_forced(admission, true, |control, current, custody, revision| {
            if exchange.kind == DesktopForcedTakeoverExchangeKind::Preview {
                return Err(rejected());
            }
            require_exchange(control, admission, exchange, exchange.kind)?;
            control.revision = revision;
            let intent = control.intent.as_mut().ok_or_else(rejected)?;
            if intent.security_epoch != current.account_security_epoch {
                return Err(Error::AuthorityRejected);
            }
            let expected = match exchange.kind {
                DesktopForcedTakeoverExchangeKind::Request => intent.request_bytes.clone(),
                DesktopForcedTakeoverExchangeKind::CancelIntent => cancel_intent_bytes(intent)?,
                DesktopForcedTakeoverExchangeKind::Resolve => {
                    bytes(&json!({"schemaVersion":1,"idempotencyKey":intent.idempotency_key}))?
                }
                _ => request_id_bytes(&intent.request.as_ref().ok_or_else(rejected)?.request_id)?,
            };
            if exchange.body != expected {
                return Err(rejected());
            }
            match exchange.kind {
                Kind::Request | Kind::Cancel => {
                    intent.consume_switch_response(exchange.kind, &value, &current.device_id)?;
                }
                Kind::Resolve | Kind::Status => {
                    if value["found"] == false {
                        wire::exact(&value, &["schemaVersion", "found"])?;
                        if exchange.kind == Kind::Resolve && !intent.sent {
                            // Only this persisted fact proves no POST bytes ever left the owner.
                            // A not-found lookup cannot rule out an already-sent request arriving later.
                            intent.stopped =
                                Some(DesktopForcedTakeoverStoppedReason::ReauthenticationRequired);
                            intent.cancel = false;
                        }
                    } else {
                        wire::exact(
                            &value,
                            if exchange.kind == Kind::Resolve {
                                &[
                                    "schemaVersion",
                                    "found",
                                    "idempotencyKey",
                                    "originalRequest",
                                    "workflow",
                                ]
                            } else {
                                &["schemaVersion", "found", "workflow"]
                            },
                        )?;
                        if value["found"] != true {
                            return Err(rejected());
                        }
                        if exchange.kind == Kind::Resolve
                            && (value["idempotencyKey"].as_str()
                                != Some(intent.idempotency_key.as_str())
                                || value["originalRequest"]
                                    != strict_json::<Value>(&intent.request_bytes)?)
                        {
                            return Err(rejected());
                        }
                        let workflow =
                            wire::workflow(value["workflow"].clone(), &current.device_id)?;
                        intent.matches_request(&workflow.request, &current.device_id)?;
                        if workflow.source_lease_epoch != intent.source_epoch
                            || intent.workflow.as_ref().is_some_and(|old| {
                                workflow.workflow_revision < old.workflow_revision
                                    || workflow.workflow_revision == old.workflow_revision
                                        && workflow.request != old.request
                                    || workflow.evaluated_at < old.evaluated_at
                                    || workflow.request.earliest_takeover_at
                                        < old.request.earliest_takeover_at
                            })
                        {
                            return Err(rejected());
                        }
                        if intent.terminal().is_some()
                            && intent.request.as_ref() != Some(&workflow.request)
                        {
                            return Err(rejected());
                        }
                        self.forced_takeover_runtime
                            .lock()
                            .map_err(|_| storage())?
                            .observation = Some(Observation {
                            intent: intent.id.clone(),
                            workflow_revision: workflow.workflow_revision,
                            authority_epoch: admission.inner.authority_epoch,
                            claimable: workflow.claimable,
                        });
                        intent.request = Some(workflow.request.clone());
                        intent.workflow = Some(workflow);
                        intent.cancel_unknown = false;
                    }
                }
                Kind::CancelIntent => intent.consume_cancel_intent(&value, &current.device_id)?,
                Kind::Preview => return Err(rejected()),
            }
            if intent.cancel
                && intent
                    .request
                    .as_ref()
                    .is_some_and(|r| r.status == "bootstrapping")
            {
                super::target_bootstrap::inherit_forced_cancel(
                    custody,
                    &intent.request.as_ref().ok_or_else(rejected)?.request_id,
                    current.account_security_epoch,
                )?;
            }
            Ok(control.view(current.account_security_epoch))
        })
    }
}
fn require_exchange(
    control: &Control,
    admission: &DesktopNativeCloudAdmission,
    exchange: &DesktopForcedTakeoverExchange,
    kind: DesktopForcedTakeoverExchangeKind,
) -> Result<(), Error> {
    if exchange.kind != kind
        || exchange.revision != control.revision
        || exchange.authority_epoch != admission.inner.authority_epoch
    {
        return Err(rejected());
    }
    Ok(())
}
fn decode(bytes: &[u8]) -> Result<Control, Error> {
    let control: Control = strict_json(bytes)?;
    control.validate()?;
    Ok(control)
}
fn installation_control(custody: &DesktopProductionCustody) -> Result<Option<Control>, Error> {
    custody
        .load_forced_takeover_control()
        .map_err(|_| storage())?
        .map(|bytes| {
            let control = decode(&bytes)?;
            let floor = custody
                .load_authorization_floor()
                .map_err(|_| storage())?
                .ok_or(Error::AuthorityRejected)?;
            if control.installation
                != custody
                    .installation_binding_digest()
                    .map_err(|_| storage())?
                || control.account != floor.account_id
                || control.workspace != floor.workspace_id
                || control.device != floor.device_id
            {
                return Err(Error::AuthorityRejected);
            }
            Ok(control)
        })
        .transpose()
}
pub(super) fn approved_origin(
    custody: &DesktopProductionCustody,
    current: &PrivateWorkspaceAuthority,
) -> Result<Origin, Error> {
    let control = installation_control(custody)?.ok_or_else(rejected)?;
    let intent = control.intent.ok_or_else(rejected)?;
    if intent.security_epoch != current.account_security_epoch
        || intent.terminal().is_some()
        || intent.cancel
        || intent.stopped.is_some()
    {
        return Err(rejected());
    }
    intent.origin()
}
pub(super) fn cancelled(
    custody: &DesktopProductionCustody,
    origin: &Origin,
) -> Result<bool, Error> {
    let control = installation_control(custody)?.ok_or_else(rejected)?;
    let intent = control.intent.as_ref().ok_or_else(rejected)?;
    if intent.origin()? != *origin {
        return Err(rejected());
    }
    Ok(intent.cancel || intent.terminal().is_some())
}
pub(super) fn terminal_record(
    custody: &DesktopProductionCustody,
    origin: &Origin,
    security_epoch: u64,
) -> Result<Option<Vec<u8>>, Error> {
    let Some(control) = installation_control(custody)? else {
        return Err(rejected());
    };
    let intent = control.intent.as_ref().ok_or_else(rejected)?;
    if intent.origin()? != *origin || intent.security_epoch != security_epoch {
        return Err(rejected());
    }
    if intent.terminal().is_some() {
        bytes(&control).map(Some)
    } else {
        Ok(None)
    }
}
pub(super) fn validate_terminal_record(
    bytes: &[u8],
    origin: &Origin,
    security_epoch: u64,
) -> Result<Terminal, Error> {
    let control = decode(bytes)?;
    let intent = control.intent.as_ref().ok_or_else(rejected)?;
    if intent.origin()? != *origin || intent.security_epoch != security_epoch {
        return Err(rejected());
    }
    intent.terminal().ok_or_else(rejected)
}
impl DesktopLocalHost {
    pub(super) fn allow_forced_claim(
        &self,
        custody: &DesktopProductionCustody,
        current: &PrivateWorkspaceAuthority,
        origin: &Origin,
        authority_epoch: u64,
    ) -> Result<bool, Error> {
        let control = installation_control(custody)?.ok_or_else(rejected)?;
        let intent = control.intent.as_ref().ok_or_else(rejected)?;
        if intent.origin()? != *origin || intent.security_epoch != current.account_security_epoch {
            return Err(rejected());
        }
        if intent.cancel
            || intent.terminal().is_some()
            || intent.stopped.is_some()
            || !custody
                .initial_replica_database_unwritten()
                .map_err(|_| storage())?
        {
            return Ok(false);
        }
        let mut runtime = self.forced_takeover_runtime.lock().map_err(|_| storage())?;
        let allowed = runtime.observation.as_ref().is_some_and(|observation| {
            observation.intent == intent.id
                && observation.authority_epoch == authority_epoch
                && observation.claimable
                && intent.workflow.as_ref().is_some_and(|workflow| {
                    workflow.workflow_revision == observation.workflow_revision
                })
        });
        if allowed {
            runtime.observation = None;
        }
        Ok(allowed)
    }
}
#[cfg(all(test, unix))]
mod tests;

pub(super) fn matches_current_origin(
    custody: &DesktopProductionCustody,
    origin: &Origin,
    security_epoch: u64,
) -> Result<bool, Error> {
    let Some(control) = installation_control(custody)? else {
        return Ok(false);
    };
    let Some(intent) = control.intent.as_ref() else {
        return Ok(false);
    };
    if intent.request.is_none() {
        return Ok(false);
    }
    Ok(intent.security_epoch == security_epoch && intent.origin()? == *origin)
}

fn cancel_intent_bytes(intent: &Intent) -> Result<Vec<u8>, Error> {
    bytes(
        &json!({"schemaVersion":1,"originalRequest":strict_json::<Value>(&intent.request_bytes)?}),
    )
}

pub(super) fn validate_terminal_scope(
    bytes: &[u8],
    scope: &crate::desktop_custody::InitialReplicaScope,
) -> Result<(), Error> {
    let control = decode(bytes)?;
    if control.installation != scope.installation
        || control.account != scope.account
        || control.workspace != scope.workspace
        || control.device != scope.device
        || control
            .intent
            .as_ref()
            .and_then(|intent| intent.request.as_ref())
            .is_none_or(|request| request.request_id != scope.workflow)
    {
        return Err(Error::AuthorityRejected);
    }
    Ok(())
}
