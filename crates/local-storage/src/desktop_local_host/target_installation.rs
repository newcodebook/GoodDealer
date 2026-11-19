mod contract;
mod wire;
use super::{DesktopLocalHost, DesktopLocalHostError as Error};
// First installation of this target's frozen Cloud replica. Existing replicas never enter here.
use super::target_bootstrap::DesktopTargetBootstrapTerminalStatus;
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DesktopTargetInstallationPhase {
    Claiming,
    Downloading,
    Installing,
    Verifying,
    Activating,
    Authorizing,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum DesktopTargetInstallationView {
    Idle,
    Running {
        request_id: String,
        phase: DesktopTargetInstallationPhase,
    },
    Completed {
        request_id: String,
    },
    Stopped {
        request_id: String,
        status: DesktopTargetBootstrapTerminalStatus,
    },
    ExistingReplica {
        request_id: String,
    },
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DesktopTargetInstallationExchangeKind {
    Claim,
    Step,
    Checkpoint,
    Receipt,
    Activate,
}

pub struct DesktopTargetInstallationExchange {
    kind: DesktopTargetInstallationExchangeKind,
    body: Zeroizing<Vec<u8>>,
    authority_epoch: u64,
    journal_revision: u64,
}
impl DesktopTargetInstallationExchange {
    #[must_use]
    pub fn kind(&self) -> DesktopTargetInstallationExchangeKind {
        self.kind
    }
    #[must_use]
    pub fn request_bytes(&self) -> &[u8] {
        &self.body
    }
}
pub enum DesktopTargetInstallationWork {
    Exchange(DesktopTargetInstallationExchange),
    Install,
    RefreshAuthorization,
    Settled(DesktopTargetInstallationView),
}
/// No database handle is carried across the Native power/session publication boundary.
pub struct DesktopTargetInstallationStage {
    token: std::sync::Arc<()>,
    authority_epoch: u64,
    journal_revision: u64,
}
macro_rules! redacted { ($($kind:ty),+) => { $(impl std::fmt::Debug for $kind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result { f.write_str(concat!(stringify!($kind), "([REDACTED])")) }
})+ }; }
redacted!(
    DesktopTargetInstallationExchange,
    DesktopTargetInstallationWork,
    DesktopTargetInstallationStage
);

use super::{
    Ordering, PrivateWorkspaceAuthority, RuntimeRestriction, WorkspaceAuthorityKind,
    current_unix_seconds, hex_digest,
};
use crate::{
    DesktopNativeCloudAdmission,
    active_workspace::business::{InitialReplicaProjection, InitialReplicaReceipt},
    desktop_custody::{DesktopProductionCustody, InitialReplicaPhase, InitialReplicaScope},
};
use wire::{Value, rejected};
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Journal {
    schema_version: u8,
    security_epoch: u64,
    request_id: String,
    view: DesktopTargetInstallationView,
    #[serde(deserialize_with = "required_option")]
    claim: Option<Value>,
    #[serde(deserialize_with = "required_option")]
    pin: Option<Value>,
    checkpoint_pages: Vec<Value>,
    mutation_pages: Vec<Value>,
    next_step_number: u64,
    workflow_revision: u64,
    #[serde(deserialize_with = "required_option")]
    next_nonce: Option<Value>,
    #[serde(deserialize_with = "required_option")]
    pending: Option<Pending>,
    #[serde(deserialize_with = "required_option")]
    local_receipt: Option<InitialReplicaReceipt>,
    #[serde(deserialize_with = "required_option")]
    activation: Option<Value>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Pending {
    kind: DesktopTargetInstallationExchangeKind,
    body: Value,
    retry_authorized: bool,
}
fn required_option<'de, D: serde::Deserializer<'de>, T: Deserialize<'de>>(
    d: D,
) -> Result<Option<T>, D::Error> {
    Option::deserialize(d)
}
fn storage() -> Error {
    Error::StorageRejected
}
fn protected_bytes<T: Serialize>(value: &T) -> Result<Zeroizing<Vec<u8>>, Error> {
    let mut bytes = Zeroizing::new(Vec::new());
    serde_json::to_writer(&mut *bytes, value).map_err(|_| storage())?;
    Ok(bytes)
}
impl Journal {
    fn new(request_id: &str, security_epoch: u64) -> Self {
        Self {
            schema_version: 1,
            security_epoch,
            request_id: request_id.into(),
            view: DesktopTargetInstallationView::Running {
                request_id: request_id.into(),
                phase: DesktopTargetInstallationPhase::Claiming,
            },
            claim: None,
            pin: None,
            checkpoint_pages: Vec::new(),
            mutation_pages: Vec::new(),
            next_step_number: 1,
            workflow_revision: 0,
            next_nonce: None,
            pending: None,
            local_receipt: None,
            activation: None,
        }
    }
    fn running(&mut self, phase: DesktopTargetInstallationPhase) {
        self.view = DesktopTargetInstallationView::Running {
            request_id: self.request_id.clone(),
            phase,
        };
    }
    fn validate(&self) -> Result<(), Error> {
        if self.schema_version != 1
            || self.security_epoch == 0
            || self.security_epoch > 9_007_199_254_740_991
            || self.next_step_number == 0
            || self.next_step_number > 9_007_199_254_740_991
            || self.workflow_revision > 9_007_199_254_740_991
            || self.checkpoint_pages.len() > 8192
            || self.mutation_pages.len() > 4096
        {
            return Err(rejected());
        }
        crate::desktop_native_cloud::validate_identifier(&self.request_id, 160)?;
        if let Some(pending) = &self.pending {
            if pending.kind == DesktopTargetInstallationExchangeKind::Receipt {
                return Err(rejected());
            }
            if pending.body.bytes()?.len() > 1_048_576 {
                return Err(rejected());
            }
        }
        if self.pin.is_some() && self.claim.is_none()
            || self.local_receipt.is_some() && self.pin.is_none()
            || self.activation.is_some() && self.local_receipt.is_none()
        {
            return Err(rejected());
        }
        Ok(())
    }
    fn receipt_request(&self) -> Result<Value, Error> {
        let pending = self.pending.as_ref().ok_or_else(rejected)?;
        let operation = match pending.kind {
            DesktopTargetInstallationExchangeKind::Claim => {
                Value::object([("kind", Value::string("claim"))])
            }
            DesktopTargetInstallationExchangeKind::Step => {
                let step = pending.body.get("step")?;
                Value::object([
                    ("kind", Value::string("step")),
                    ("stepNumber", step.get("stepNumber")?.clone()),
                    ("requestDigest", step.get("requestDigest")?.clone()),
                    (
                        "replayDigest",
                        Value::string(&wire::digest(
                            "GOODDEALER-BOOTSTRAP-STEP-REQUEST-REPLAY-V2",
                            step,
                        )),
                    ),
                ])
            }
            DesktopTargetInstallationExchangeKind::Activate => Value::object([
                ("kind", Value::string("activate")),
                ("activationId", pending.body.get("activationId")?.clone()),
                ("requestDigest", pending.body.get("requestDigest")?.clone()),
            ]),
            _ => return Err(rejected()),
        };
        Ok(Value::object([
            ("schemaVersion", Value::Number(1)),
            ("requestId", Value::string(&self.request_id)),
            ("operation", operation),
        ]))
    }
    fn capability(&self) -> Result<&Value, Error> {
        self.claim.as_ref().ok_or_else(rejected)?.get("capability")
    }
    fn prepare_step(&self, kind: &str, payload: Value) -> Result<Value, Error> {
        let mut step = Value::object([
            ("schemaVersion", Value::Number(2)),
            ("deviceSwitchRequestId", Value::string(&self.request_id)),
            ("capabilityJti", self.capability()?.get("jti")?.clone()),
            ("stepNumber", Value::Number(self.next_step_number)),
            (
                "stepNonce",
                self.next_nonce.as_ref().ok_or_else(rejected)?.clone(),
            ),
            (
                "expectedWorkflowRevision",
                Value::Number(self.workflow_revision),
            ),
            ("stepKind", Value::string(kind)),
            ("stepPayload", payload),
        ]);
        let digest = wire::digest(
            "GOODDEALER-BOOTSTRAP-STEP-REQUEST-V2",
            &step.without(&["stepNonce"])?,
        );
        step.set("requestDigest", Value::string(&digest))?;
        Ok(Value::object([
            ("schemaVersion", Value::Number(1)),
            ("capability", self.capability()?.clone()),
            ("step", step),
        ]))
    }
    fn projection(&self, workspace: &str) -> Result<InitialReplicaProjection, Error> {
        self.projection_partial(workspace, true)
    }
    fn projection_partial(
        &self,
        workspace: &str,
        complete: bool,
    ) -> Result<InitialReplicaProjection, Error> {
        let pin = self.pin.as_ref().ok_or_else(rejected)?;
        let descriptors = pin.get("checkpointEntityDigests")?.array()?;
        let mut assets = Vec::new();
        let mut tombstones = Vec::new();
        let mut page_index = 0;
        for descriptor in descriptors {
            let mut rows = Vec::new();
            let mut offset = 0;
            let mut total = None;
            loop {
                let page = self.checkpoint_pages.get(page_index).ok_or_else(rejected)?;
                page_index += 1;
                if page.get("entityType")? != descriptor.get("entityType")?
                    || page.get("partitionId")? != descriptor.get("partitionId")?
                    || page.get("offset")?.number() != Ok(offset)
                    || total.is_some_and(|expected| {
                        page.get("totalRows").and_then(Value::number) != Ok(expected)
                    })
                {
                    return Err(rejected());
                }
                total = Some(page.get("totalRows")?.number()?);
                rows.extend_from_slice(page.get("rows")?.array()?);
                if page.get("nextOffset")?.is_null() {
                    break;
                }
                offset = page.get("nextOffset")?.number()?;
            }
            let domain = if descriptor.get("entityType")?.equals_text("domain_asset") {
                "GOODDEALER-WORKSPACE-CHECKPOINT-DOMAIN-ASSET-V3"
            } else {
                "GOODDEALER-WORKSPACE-CHECKPOINT-DOMAIN-ASSET-TOMBSTONE-V3"
            };
            if descriptor.get("digest")?.text()
                != Ok(wire::digest(domain, &Value::Array(rows.clone())).as_str())
            {
                return Err(rejected());
            }
            if descriptor.get("entityType")?.equals_text("domain_asset") {
                assets.extend(rows);
            } else {
                tombstones.extend(rows);
            }
        }
        if page_index != self.checkpoint_pages.len() {
            return Err(rejected());
        }
        let checkpoint = pin.get("checkpoint")?;
        let state = Value::object([
            ("assets", Value::Array(assets)),
            ("tombstones", Value::Array(tombstones)),
        ]);
        let mut projection = InitialReplicaProjection::parse(
            &state.bytes()?,
            checkpoint.get("throughServerRevision")?.number()?,
        )
        .map_err(|_| rejected())?;
        if projection.digest().map_err(|_| rejected())?
            != checkpoint.get("checkpointDigest")?.text()?
        {
            return Err(rejected());
        }
        let mut from = checkpoint.get("throughServerRevision")?.number()?;
        let target = pin.get("targetServerRevision")?.number()?;
        for page in &self.mutation_pages {
            from = projection
                .apply_page(
                    &page.bytes()?,
                    workspace,
                    pin.get("workspaceSchemaVersion")?.number()?,
                    from,
                    target,
                )
                .map_err(|_| rejected())?;
        }
        if complete && from != target {
            return Err(rejected());
        }
        Ok(projection)
    }
}

impl DesktopLocalHost {
    /// Persists one confirmed, currently previewed target. It performs no network operation.
    /// # Errors
    /// Rejects stale authority, a changed preview, or incompatible initialized-replica custody.
    pub fn start_target_installation(
        &self,
        admission: &DesktopNativeCloudAdmission,
        preview_request_id: &str,
    ) -> Result<DesktopTargetInstallationView, Error> {
        crate::desktop_native_cloud::validate_identifier(preview_request_id, 160)?;
        self.with_initial_replica(admission, |custody, current, state| {
            if let Some(journal) = load_journal(&state)? {
                if journal.security_epoch != current.account_security_epoch {
                    return Ok((stale_security_view(&journal), None));
                }
                if journal.request_id != preview_request_id {
                    return Err(rejected());
                }
                return Ok((journal.view, None));
            }
            super::target_bootstrap::require_installation_preview(custody, preview_request_id)?;
            if state.phase != InitialReplicaPhase::Fresh {
                return Ok((
                    DesktopTargetInstallationView::ExistingReplica {
                        request_id: preview_request_id.into(),
                    },
                    None,
                ));
            }
            if current.kind != WorkspaceAuthorityKind::Standby {
                return Err(Error::AuthorityRejected);
            }
            let journal = Journal::new(preview_request_id, current.account_security_epoch);
            let view = journal.view.clone();
            Ok((view, Some((journal, InitialReplicaPhase::Installing))))
        })
    }
    /// Reads durable local progress only. Renderer polling never advances network work.
    /// # Errors
    /// Rejects stale authority or an invalid local journal.
    pub fn target_installation_status(
        &self,
        admission: &DesktopNativeCloudAdmission,
    ) -> Result<DesktopTargetInstallationView, Error> {
        self.with_initial_replica(admission, |_, current, state| {
            let Some(journal) = load_journal(&state)? else {
                return Ok((DesktopTargetInstallationView::Idle, None));
            };
            if journal.security_epoch != current.account_security_epoch {
                return Ok((stale_security_view(&journal), None));
            }
            let view = if journal.activation.is_some()
                && current.kind == WorkspaceAuthorityKind::Active
                && current.lease_epoch
                    == journal
                        .claim
                        .as_ref()
                        .ok_or_else(rejected)?
                        .get("pendingLeaseEpoch")?
                        .number()?
                && self.require_execution_context(&admission.inner).is_ok()
            {
                DesktopTargetInstallationView::Completed {
                    request_id: journal.request_id,
                }
            } else {
                journal.view
            };
            Ok((view, None))
        })
    }
    /// Selects one fixed-purpose operation; an uncertain mutation always selects its exact receipt.
    /// # Errors
    /// Rejects stale authority, invalid state, and changed scope.
    #[expect(
        clippy::too_many_lines,
        reason = "one durable state decision prioritizes cancellation, exact receipts and authorizing before new work"
    )]
    pub fn prepare_target_installation_work(
        &self,
        admission: &DesktopNativeCloudAdmission,
    ) -> Result<DesktopTargetInstallationWork, Error> {
        self.with_initial_replica(admission, |custody, current, state| {
            let Some(mut journal) = load_journal(&state)? else {
                return Ok((
                    DesktopTargetInstallationWork::Settled(DesktopTargetInstallationView::Idle),
                    None,
                ));
            };
            if journal.security_epoch != current.account_security_epoch {
                return Ok((
                    DesktopTargetInstallationWork::Settled(stale_security_view(&journal)),
                    None,
                ));
            }
            if !matches!(journal.view, DesktopTargetInstallationView::Running { .. }) {
                return Ok((DesktopTargetInstallationWork::Settled(journal.view), None));
            }
            if let Some(status) =
                super::target_bootstrap::installation_terminal(custody, &journal.request_id)?
                && status != DesktopTargetBootstrapTerminalStatus::Completed
            {
                journal.view = DesktopTargetInstallationView::Stopped {
                    request_id: journal.request_id.clone(),
                    status,
                };
                let view = journal.view.clone();
                return Ok((
                    DesktopTargetInstallationWork::Settled(view),
                    Some((journal, state.phase)),
                ));
            }
            let cancelled =
                super::target_bootstrap::installation_cancel_pending(custody, &journal.request_id)?;
            if journal.activation.is_some() {
                if current.kind == WorkspaceAuthorityKind::Active
                    && current.lease_epoch
                        == journal
                            .claim
                            .as_ref()
                            .ok_or_else(rejected)?
                            .get("pendingLeaseEpoch")?
                            .number()?
                    && self.require_execution_context(&admission.inner).is_ok()
                {
                    journal.view = DesktopTargetInstallationView::Completed {
                        request_id: journal.request_id.clone(),
                    };
                    let view = journal.view.clone();
                    return Ok((
                        DesktopTargetInstallationWork::Settled(view),
                        Some((journal, InitialReplicaPhase::Initialized)),
                    ));
                }
                return Ok((DesktopTargetInstallationWork::RefreshAuthorization, None));
            }
            if cancelled
                && journal.pending.as_ref().is_none_or(|pending| {
                    pending.kind != DesktopTargetInstallationExchangeKind::Activate
                })
            {
                return Ok((DesktopTargetInstallationWork::Settled(journal.view), None));
            }
            if journal.pending.as_ref().is_some_and(|pending| {
                pending.kind == DesktopTargetInstallationExchangeKind::Checkpoint
                    || pending.retry_authorized && !cancelled
            }) {
                require_transfer_window(
                    &journal,
                    current,
                    self.authority_verifier.as_ref().ok_or(Error::Unavailable)?,
                )?;
            }
            if let Some(pending) = journal.pending.as_mut() {
                if pending.kind == DesktopTargetInstallationExchangeKind::Checkpoint
                    || pending.retry_authorized && !cancelled
                {
                    pending.retry_authorized = false;
                    let kind = pending.kind;
                    let body = pending.body.bytes()?;
                    return Ok((
                        DesktopTargetInstallationWork::Exchange(
                            DesktopTargetInstallationExchange {
                                kind,
                                body,
                                authority_epoch: admission.inner.authority_epoch,
                                journal_revision: state.revision + 1,
                            },
                        ),
                        Some((journal, state.phase)),
                    ));
                }
                let body = journal.receipt_request()?.bytes()?;
                return Ok((
                    DesktopTargetInstallationWork::Exchange(DesktopTargetInstallationExchange {
                        kind: DesktopTargetInstallationExchangeKind::Receipt,
                        body,
                        authority_epoch: admission.inner.authority_epoch,
                        journal_revision: state.revision,
                    }),
                    None,
                ));
            }
            require_transfer_window(
                &journal,
                current,
                self.authority_verifier.as_ref().ok_or(Error::Unavailable)?,
            )?;
            let (kind, body) = next_operation(&journal, current)?;
            if kind.is_none() {
                return Ok((DesktopTargetInstallationWork::Install, None));
            }
            let kind = kind.ok_or_else(rejected)?;
            let body = body.ok_or_else(rejected)?;
            let bytes = body.bytes()?;
            journal.pending = Some(Pending {
                kind,
                body,
                retry_authorized: false,
            });
            if kind == DesktopTargetInstallationExchangeKind::Activate {
                journal.running(DesktopTargetInstallationPhase::Activating);
            }
            Ok((
                DesktopTargetInstallationWork::Exchange(DesktopTargetInstallationExchange {
                    kind,
                    body: bytes,
                    authority_epoch: admission.inner.authority_epoch,
                    journal_revision: state.revision + 1,
                }),
                Some((journal, state.phase)),
            ))
        })
    }
    /// Validates only the exact prepared response and persists it before selecting another step.
    /// # Errors
    /// Rejects response substitution, invalid signatures, races, and changed authority.
    pub fn complete_target_installation_exchange(
        &self,
        admission: &DesktopNativeCloudAdmission,
        exchange: &DesktopTargetInstallationExchange,
        bytes: &[u8],
    ) -> Result<DesktopTargetInstallationView, Error> {
        let limit = if matches!(
            exchange.kind,
            DesktopTargetInstallationExchangeKind::Claim
                | DesktopTargetInstallationExchangeKind::Activate
        ) {
            16_384
        } else {
            1_048_576
        };
        let response = wire::parse(bytes, limit)?;
        self.with_initial_replica(admission, |custody, current, state| {
            if state.revision != exchange.journal_revision
                || exchange.authority_epoch != admission.inner.authority_epoch
            {
                return Err(rejected());
            }
            let mut journal = load_journal(&state)?.ok_or_else(rejected)?;
            if journal.security_epoch != current.account_security_epoch {
                return Err(Error::AuthorityRejected);
            }
            let pending = journal.pending.as_ref().ok_or_else(rejected)?;
            let expected = if exchange.kind == DesktopTargetInstallationExchangeKind::Receipt {
                journal.receipt_request()?
            } else {
                if exchange.kind != pending.kind {
                    return Err(rejected());
                }
                pending.body.clone()
            };
            if expected.bytes()?.as_slice() != exchange.body.as_slice() {
                return Err(rejected());
            }
            let now = current_unix_seconds().map_err(|_| Error::Unavailable)?;
            let verifier = self.authority_verifier.as_ref().ok_or(Error::Unavailable)?;
            if exchange.kind == DesktopTargetInstallationExchangeKind::Receipt {
                let cancelled = super::target_bootstrap::installation_cancel_pending(
                    custody,
                    &journal.request_id,
                )?;
                consume_receipt(&mut journal, &response, current, now, verifier, cancelled)?;
            } else {
                consume_direct(&mut journal, &response, current, now, verifier)?;
            }
            let phase = if journal.activation.is_some() {
                let database = custody
                    .open_initial_replica_database(&current.workspace_id)
                    .map_err(|_| storage())?;
                database
                    .verify_initial_replica_receipt(
                        journal.local_receipt.as_ref().ok_or_else(rejected)?,
                    )
                    .map_err(|_| storage())?;
                InitialReplicaPhase::Installed
            } else {
                state.phase
            };
            let view = journal.view.clone();
            Ok((view, Some((journal, phase))))
        })
    }
    /// Performs slow projection verification, encrypted SQL transaction, and immutable readback.
    /// # Errors
    /// Rejects an existing replica, invalid reconstruction, or authority loss at the final fence.
    pub fn stage_target_installation(
        &self,
        admission: &DesktopNativeCloudAdmission,
    ) -> Result<DesktopTargetInstallationStage, Error> {
        self.with_initial_replica(admission, |custody, current, state| {
            let mut journal = load_journal(&state)?.ok_or_else(rejected)?;
            if journal.security_epoch != current.account_security_epoch {
                return Err(Error::AuthorityRejected);
            }
            if journal.pending.is_some()
                || journal.local_receipt.is_some()
                || super::target_bootstrap::installation_cancel_pending(
                    custody,
                    &journal.request_id,
                )?
            {
                return Err(rejected());
            }
            require_transfer_window(
                &journal,
                current,
                self.authority_verifier.as_ref().ok_or(Error::Unavailable)?,
            )?;
            let projection = journal.projection(&current.workspace_id)?;
            let pin = journal.pin.as_ref().ok_or_else(rejected)?;
            let receipt = InitialReplicaReceipt {
                workflow_id: journal.request_id.clone(),
                target_device_id: current.device_id.clone(),
                target_server_revision: pin.get("targetServerRevision")?.number()?,
                workspace_schema_version: pin.get("workspaceSchemaVersion")?.number()?,
                replica_digest: projection.digest().map_err(|_| rejected())?,
            };
            let mut database = custody
                .open_initial_replica_database(&current.workspace_id)
                .map_err(|_| storage())?;
            database
                .install_initial_replica(&projection, &receipt, || {
                    self.require_business_commit_fence(admission.inner.authority_epoch, current)
                })
                .map_err(|_| storage())?;
            journal.local_receipt = Some(receipt);
            journal.running(DesktopTargetInstallationPhase::Verifying);
            let token = std::sync::Arc::new(());
            *self
                .target_installation_stage
                .lock()
                .map_err(|_| storage())? = Some((
                std::sync::Arc::downgrade(&token),
                admission.inner.authority_epoch,
                state.revision + 1,
                journal.view.clone(),
            ));
            Ok((
                DesktopTargetInstallationStage {
                    token,
                    authority_epoch: admission.inner.authority_epoch,
                    journal_revision: state.revision + 1,
                },
                Some((journal, InitialReplicaPhase::Installed)),
            ))
        })
    }
    /// Publishes only a prepared in-memory result under Native's short power/session fence.
    /// # Errors
    /// Rejects stale or replayed stage tokens without custody, cryptography, or SQL work.
    #[expect(
        clippy::needless_pass_by_value,
        reason = "the opaque stage is deliberately consumed exactly once at publication"
    )]
    pub fn publish_target_installation(
        &self,
        admission: &DesktopNativeCloudAdmission,
        stage: DesktopTargetInstallationStage,
    ) -> Result<DesktopTargetInstallationView, Error> {
        if stage.authority_epoch != admission.inner.authority_epoch
            || self.transition_requested_epoch.load(Ordering::Acquire) != stage.authority_epoch
        {
            return Err(Error::AuthorityRejected);
        }
        let mut staged = self
            .target_installation_stage
            .lock()
            .map_err(|_| storage())?;
        let (token, epoch, revision, view) = staged.as_ref().ok_or_else(rejected)?;
        if *epoch != stage.authority_epoch
            || *revision != stage.journal_revision
            || !token.ptr_eq(&std::sync::Arc::downgrade(&stage.token))
        {
            return Err(rejected());
        }
        let view = view.clone();
        *staged = None;
        Ok(view)
    }
    fn with_initial_replica<T>(
        &self,
        admission: &DesktopNativeCloudAdmission,
        action: impl FnOnce(
            &DesktopProductionCustody,
            &PrivateWorkspaceAuthority,
            crate::desktop_custody::InitialReplicaState,
        ) -> Result<(T, Option<(Journal, InitialReplicaPhase)>), Error>,
    ) -> Result<T, Error> {
        let _operation = self.operation_selection.lock().map_err(|_| storage())?;
        let authority = self.authority_publication.lock().map_err(|_| storage())?;
        let current = authority
            .authority
            .as_ref()
            .ok_or(Error::AuthorityRejected)?;
        let epoch = authority.applied_authority_epoch;
        let restricted_target = admission.is_installing_target()
            && self.installation_context_gate.load(Ordering::Acquire)
            && authority.restriction == RuntimeRestriction::Active
            && current.kind == WorkspaceAuthorityKind::Active;
        if !restricted_target
            && !matches!(
                (authority.restriction, current.kind, admission.is_active()),
                (
                    RuntimeRestriction::Active,
                    WorkspaceAuthorityKind::Active,
                    true
                ) | (
                    RuntimeRestriction::Standby,
                    WorkspaceAuthorityKind::Standby,
                    false
                )
            )
            || epoch != admission.inner.authority_epoch
            || admission.workspace_id() != current.workspace_id
            || admission.inner.device_id() != current.device_id
            || admission.inner.authority_snapshot_digest() != hex_digest(&current.digest)
        {
            return Err(Error::AuthorityRejected);
        }
        self.require_business_commit_fence(epoch, current)
            .map_err(super::map_host_database_error)?;
        let custody = self
            .production_custody
            .as_ref()
            .ok_or(Error::Unavailable)?
            .lock()
            .map_err(|_| storage())?;
        let state = custody.initial_replica_state().map_err(|_| storage())?;
        let revision = state.revision;
        if let Some(scope) = &state.scope {
            if scope.installation
                != custody
                    .installation_binding_digest()
                    .map_err(|_| storage())?
                || scope.account != current.account_id
                || scope.workspace != current.workspace_id
                || scope.device != current.device_id
            {
                return Err(Error::AuthorityRejected);
            }
            let journal = load_journal(&state)?.ok_or_else(rejected)?;
            if journal.request_id != scope.workflow {
                return Err(Error::AuthorityRejected);
            }
        }
        let (result, update) = action(&custody, current, state)?;
        if let Some((journal, phase)) = update {
            journal.validate()?;
            let scope = InitialReplicaScope {
                installation: custody
                    .installation_binding_digest()
                    .map_err(|_| storage())?,
                account: current.account_id.clone(),
                workspace: current.workspace_id.clone(),
                device: current.device_id.clone(),
                workflow: journal.request_id.clone(),
            };
            self.require_business_commit_fence(epoch, current)
                .map_err(super::map_host_database_error)?;
            custody
                .store_initial_replica_state(revision, &scope, &protected_bytes(&journal)?, phase)
                .map_err(|_| storage())?;
        }
        self.require_business_commit_fence(epoch, current)
            .map_err(super::map_host_database_error)?;
        Ok(result)
    }
}
fn load_journal(
    state: &crate::desktop_custody::InitialReplicaState,
) -> Result<Option<Journal>, Error> {
    state
        .bytes
        .as_ref()
        .map(|bytes| {
            let journal: Journal = serde_json::from_slice(bytes).map_err(|_| rejected())?;
            journal.validate()?;
            Ok(journal)
        })
        .transpose()
}

#[expect(
    clippy::too_many_lines,
    reason = "fixed installation route contracts are prepared together without a generic transport or workflow abstraction"
)]
fn next_operation(
    journal: &Journal,
    current: &PrivateWorkspaceAuthority,
) -> Result<(Option<DesktopTargetInstallationExchangeKind>, Option<Value>), Error> {
    use DesktopTargetInstallationExchangeKind::{Activate, Checkpoint, Claim, Step};
    let operation = if journal.claim.is_none() {
        (
            Claim,
            Value::object([
                ("schemaVersion", Value::Number(1)),
                ("requestId", Value::string(&journal.request_id)),
            ]),
        )
    } else if journal.pin.is_none() {
        (
            Step,
            journal.prepare_step("pin_checkpoint", Value::object([]))?,
        )
    } else {
        let pin = journal.pin.as_ref().ok_or_else(rejected)?;
        let checkpoint = pin.get("checkpoint")?;
        let completed = journal
            .checkpoint_pages
            .iter()
            .filter(|page| page.get("nextOffset").is_ok_and(Value::is_null))
            .count();
        let descriptors = pin.get("checkpointEntityDigests")?.array()?;
        if let Some(descriptor) = descriptors.get(completed) {
            let offset = journal
                .checkpoint_pages
                .last()
                .and_then(|page| page.get("nextOffset").ok())
                .filter(|value| !value.is_null())
                .cloned()
                .unwrap_or(Value::Number(0));
            (
                Checkpoint,
                Value::object([
                    ("schemaVersion", Value::Number(1)),
                    ("requestId", Value::string(&journal.request_id)),
                    ("capability", journal.capability()?.clone()),
                    ("checkpointId", checkpoint.get("checkpointId")?.clone()),
                    (
                        "checkpointDigest",
                        checkpoint.get("checkpointDigest")?.clone(),
                    ),
                    ("entityType", descriptor.get("entityType")?.clone()),
                    ("partitionId", descriptor.get("partitionId")?.clone()),
                    ("offset", offset),
                    ("pageLimit", Value::Number(256)),
                ]),
            )
        } else if journal
            .mutation_pages
            .last()
            .is_none_or(|page| page.get("nextCursor").is_ok_and(|value| !value.is_null()))
        {
            let last = journal.mutation_pages.last();
            (
                Step,
                journal.prepare_step(
                    "fetch_mutations",
                    Value::object([
                        (
                            "pinnedCheckpointId",
                            checkpoint.get("checkpointId")?.clone(),
                        ),
                        (
                            "pinnedCheckpointThroughServerRevision",
                            checkpoint.get("throughServerRevision")?.clone(),
                        ),
                        (
                            "pinnedCheckpointDigest",
                            checkpoint.get("checkpointDigest")?.clone(),
                        ),
                        (
                            "fromServerRevisionExclusive",
                            last.map_or(checkpoint.get("throughServerRevision"), |page| {
                                page.get("returnedThroughServerRevision")
                            })?
                            .clone(),
                        ),
                        (
                            "throughServerRevisionInclusive",
                            pin.get("targetServerRevision")?.clone(),
                        ),
                        (
                            "cursor",
                            last.map_or(Ok(&Value::Null), |page| page.get("nextCursor"))?
                                .clone(),
                        ),
                        ("pageLimit", Value::Number(256)),
                    ]),
                )?,
            )
        } else if journal.local_receipt.is_none() {
            return Ok((None, None));
        } else if journal.next_nonce.is_some() {
            let projection = journal.projection(&current.workspace_id)?;
            let digests = protected_bytes(&projection.entity_digests().map_err(|_| rejected())?)?;
            (
                Step,
                journal.prepare_step(
                    "submit_rebuild_digest",
                    Value::object([
                        (
                            "targetServerRevision",
                            pin.get("targetServerRevision")?.clone(),
                        ),
                        (
                            "workspaceSchemaVersion",
                            pin.get("workspaceSchemaVersion")?.clone(),
                        ),
                        ("entityDigests", wire::parse(&digests, 1_048_576)?),
                    ]),
                )?,
            )
        } else {
            let mut random = [0_u8; 16];
            getrandom::fill(&mut random).map_err(|_| Error::Unavailable)?;
            random[6] = (random[6] & 15) | 64;
            random[8] = (random[8] & 63) | 128;
            let activation_id = format!(
                "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
                random[0],
                random[1],
                random[2],
                random[3],
                random[4],
                random[5],
                random[6],
                random[7],
                random[8],
                random[9],
                random[10],
                random[11],
                random[12],
                random[13],
                random[14],
                random[15]
            );
            let mut body = Value::object([
                ("schemaVersion", Value::Number(1)),
                ("requestId", Value::string(&journal.request_id)),
                ("capability", journal.capability()?.clone()),
                ("activationId", Value::string(&activation_id)),
                (
                    "expectedWorkflowRevision",
                    Value::Number(journal.workflow_revision),
                ),
                (
                    "pendingLeaseEpoch",
                    journal
                        .claim
                        .as_ref()
                        .ok_or_else(rejected)?
                        .get("pendingLeaseEpoch")?
                        .clone(),
                ),
                (
                    "targetServerRevision",
                    pin.get("targetServerRevision")?.clone(),
                ),
                (
                    "workspaceSchemaVersion",
                    pin.get("workspaceSchemaVersion")?.clone(),
                ),
                (
                    "verifiedRebuildDigest",
                    Value::string(
                        &journal
                            .local_receipt
                            .as_ref()
                            .ok_or_else(rejected)?
                            .replica_digest,
                    ),
                ),
            ]);
            let mut digest_input = body.without(&["capability"])?;
            digest_input.set(
                "capabilityDigest",
                Value::string(&wire::capability_digest(journal.capability()?)),
            )?;
            body.set(
                "requestDigest",
                Value::string(&wire::digest(
                    "GOODDEALER-BOOTSTRAP-ACTIVATION-REQUEST-V1",
                    &digest_input,
                )),
            )?;
            (Activate, body)
        }
    };
    Ok((Some(operation.0), Some(operation.1)))
}
fn consume_direct(
    journal: &mut Journal,
    response: &Value,
    current: &PrivateWorkspaceAuthority,
    now: i64,
    verifier: &super::authority::WorkspaceAuthorityVerifier,
) -> Result<(), Error> {
    let pending = journal.pending.as_ref().ok_or_else(rejected)?;
    let field = match pending.kind {
        DesktopTargetInstallationExchangeKind::Claim => "claim",
        DesktopTargetInstallationExchangeKind::Step => "result",
        DesktopTargetInstallationExchangeKind::Checkpoint => "page",
        DesktopTargetInstallationExchangeKind::Activate => "receipt",
        DesktopTargetInstallationExchangeKind::Receipt => return Err(rejected()),
    };
    wire::accepted(response, field)?;
    consume_result(journal, response.get(field)?, current, now, verifier)
}
fn consume_result(
    journal: &mut Journal,
    value: &Value,
    current: &PrivateWorkspaceAuthority,
    now: i64,
    verifier: &super::authority::WorkspaceAuthorityVerifier,
) -> Result<(), Error> {
    let pending = journal.pending.as_ref().ok_or_else(rejected)?;
    match pending.kind {
        DesktopTargetInstallationExchangeKind::Claim => {
            contract::claim(value, current, &journal.request_id, now, verifier)?;
            journal.workflow_revision = value.get("workflowRevision")?.number()?;
            journal.next_nonce = Some(value.get("nextStep")?.get("stepNonce")?.clone());
            journal.claim = Some(value.clone());
            journal.running(DesktopTargetInstallationPhase::Downloading);
        }
        DesktopTargetInstallationExchangeKind::Step => {
            let request = pending.body.get("step")?;
            contract::step_result(value, request)?;
            let payload = value.get("resultPayload")?;
            match request.get("stepKind")?.text()? {
                "pin_checkpoint" => {
                    if payload.get("checkpoint")?.get("workspaceId")?.text()
                        != Ok(current.workspace_id.as_str())
                        || wire::utc(payload.get("pinExpiresAt")?)? <= now
                    {
                        return Err(rejected());
                    }
                    journal.pin = Some(payload.clone());
                }
                "fetch_mutations" => {
                    let page = payload.get("mutationPage")?;
                    let request_payload = request.get("stepPayload")?;
                    if page.get("fromServerRevisionExclusive")?
                        != request_payload.get("fromServerRevisionExclusive")?
                        || page.get("throughServerRevisionInclusive")?
                            != request_payload.get("throughServerRevisionInclusive")?
                    {
                        return Err(rejected());
                    }
                    journal.mutation_pages.push(page.clone());
                    // Every partial replay validates against the complete checkpoint. A final page
                    // is required before any SQL; intermediate pages are checked below independently.
                    validate_downloaded_replay(journal, &current.workspace_id)?;
                    if page.get("nextCursor")?.is_null() {
                        journal.running(DesktopTargetInstallationPhase::Installing);
                    }
                }
                "submit_rebuild_digest" => {
                    if payload.get("verifiedDigest")?.text()
                        != Ok(journal
                            .local_receipt
                            .as_ref()
                            .ok_or_else(rejected)?
                            .replica_digest
                            .as_str())
                    {
                        return Err(rejected());
                    }
                    journal.running(DesktopTargetInstallationPhase::Activating);
                }
                _ => return Err(rejected()),
            }
            journal.workflow_revision = value.get("workflowRevision")?.number()?;
            journal.next_step_number = journal
                .next_step_number
                .checked_add(1)
                .ok_or_else(rejected)?;
            journal.next_nonce = if value.get("nextStepNonce")?.is_null() {
                None
            } else {
                Some(value.get("nextStepNonce")?.clone())
            };
        }
        DesktopTargetInstallationExchangeKind::Checkpoint => {
            contract::checkpoint_page(value, &pending.body)?;
            let (assets, tombstones) = if value.get("entityType")?.equals_text("domain_asset") {
                (value.get("rows")?.clone(), Value::Array(Vec::new()))
            } else {
                (Value::Array(Vec::new()), value.get("rows")?.clone())
            };
            let projected = Value::object([("assets", assets), ("tombstones", tombstones)]);
            InitialReplicaProjection::parse(
                &projected.bytes()?,
                journal
                    .pin
                    .as_ref()
                    .ok_or_else(rejected)?
                    .get("checkpoint")?
                    .get("throughServerRevision")?
                    .number()?,
            )
            .map_err(|_| rejected())?;
            journal.checkpoint_pages.push(value.clone());
        }
        DesktopTargetInstallationExchangeKind::Activate => {
            contract::activation(value, &pending.body, current, now, verifier)?;
            journal.activation = Some(value.clone());
            journal.running(DesktopTargetInstallationPhase::Authorizing);
        }
        DesktopTargetInstallationExchangeKind::Receipt => return Err(rejected()),
    }
    journal.pending = None;
    Ok(())
}
fn validate_downloaded_replay(journal: &Journal, workspace: &str) -> Result<(), Error> {
    journal.projection_partial(workspace, false).map(|_| ())
}
#[expect(
    clippy::too_many_lines,
    reason = "closed receipt outcomes must correlate the original request before any nonce or activation transition"
)]
fn consume_receipt(
    journal: &mut Journal,
    response: &Value,
    current: &PrivateWorkspaceAuthority,
    now: i64,
    verifier: &super::authority::WorkspaceAuthorityVerifier,
    cancelled: bool,
) -> Result<(), Error> {
    let outcome = response.get("outcome")?.text()?;
    if response.get("schemaVersion")?.number() != Ok(1) {
        return Err(rejected());
    }
    if matches!(outcome, "not_found" | "conflict") {
        response.shape(&["schemaVersion", "outcome"], &[])?;
        return Err(rejected());
    }
    response.shape(
        &["schemaVersion", "outcome", "workflow", "operation"],
        if outcome == "uncommitted" {
            &["nextStep"]
        } else {
            &[]
        },
    )?;
    let workflow = response.get("workflow")?;
    workflow.shape(&["requestId", "workflowRevision", "status"], &[])?;
    if workflow.get("requestId")?.text() != Ok(journal.request_id.as_str())
        || wire::positive(workflow.get("workflowRevision")?)? < journal.workflow_revision
    {
        return Err(rejected());
    }
    let status = workflow.get("status")?.text()?;
    if !["bootstrapping", "completed", "cancelled", "failed"].contains(&status) {
        return Err(rejected());
    }
    let operation = response.get("operation")?;
    let expected = journal.receipt_request()?.get("operation")?.clone();
    if outcome == "committed" {
        let kind = expected.get("kind")?.text()?;
        let field = match kind {
            "claim" => "claim",
            "step" => "result",
            "activate" => "receipt",
            _ => return Err(rejected()),
        };
        let keys = match kind {
            "claim" => vec!["kind", field],
            "step" => vec!["kind", "stepNumber", "requestDigest", "replayDigest", field],
            _ => vec!["kind", "activationId", "requestDigest", field],
        };
        operation.shape(&keys, &[])?;
        if operation.without(&[field])? != expected {
            return Err(rejected());
        }
        if status != "bootstrapping" && !(status == "completed" && kind == "activate") {
            journal.pending = None;
            journal.view = DesktopTargetInstallationView::Stopped {
                request_id: journal.request_id.clone(),
                status: terminal_status(status)?,
            };
            return Ok(());
        }
        if operation.get(field)?.get("workflowRevision")? != workflow.get("workflowRevision")? {
            return Err(rejected());
        }
        consume_result(journal, operation.get(field)?, current, now, verifier)?;
    } else {
        if operation != &expected {
            return Err(rejected());
        }
        match outcome {
            "uncommitted" => {
                if status != "bootstrapping" {
                    return Err(rejected());
                }
                let next = response.get("nextStep")?;
                let pending = journal.pending.as_mut().ok_or_else(rejected)?;
                if pending.kind != DesktopTargetInstallationExchangeKind::Claim
                    && workflow.get("workflowRevision")?.number()? != journal.workflow_revision
                {
                    return Err(rejected());
                }
                if pending.kind == DesktopTargetInstallationExchangeKind::Step {
                    next.shape(&["stepNumber", "stepKind"], &[])?;
                    let step = pending.body.get("step")?;
                    if next.get("stepNumber")? != step.get("stepNumber")?
                        || next.get("stepKind")? != step.get("stepKind")?
                    {
                        return Err(rejected());
                    }
                } else if !next.is_null() {
                    next.shape(&["stepNumber", "stepKind"], &[])?;
                    wire::positive(next.get("stepNumber")?)?;
                    if !["pin_checkpoint", "fetch_mutations", "submit_rebuild_digest"]
                        .contains(&next.get("stepKind")?.text()?)
                    {
                        return Err(rejected());
                    }
                }
                if cancelled {
                    journal.pending = None;
                } else {
                    pending.retry_authorized = true;
                }
            }
            "terminal" => {
                journal.pending = None;
                journal.view = DesktopTargetInstallationView::Stopped {
                    request_id: journal.request_id.clone(),
                    status: terminal_status(status)?,
                };
            }
            _ => return Err(rejected()),
        }
    }
    Ok(())
}
fn terminal_status(status: &str) -> Result<DesktopTargetBootstrapTerminalStatus, Error> {
    match status {
        "cancelled" => Ok(DesktopTargetBootstrapTerminalStatus::Cancelled),
        "completed" => Ok(DesktopTargetBootstrapTerminalStatus::Completed),
        "failed" => Ok(DesktopTargetBootstrapTerminalStatus::Failed),
        _ => Err(rejected()),
    }
}

pub(super) fn cancellation_blocked(
    custody: &DesktopProductionCustody,
    request_id: &str,
    security_epoch: u64,
) -> Result<bool, Error> {
    let state = custody.initial_replica_state().map_err(|_| storage())?;
    Ok(load_journal(&state)?.is_some_and(|journal| {
        journal.request_id == request_id
            && journal.security_epoch == security_epoch
            && journal.pending.as_ref().is_some_and(|pending| {
                pending.kind == DesktopTargetInstallationExchangeKind::Activate
            })
    }))
}

fn require_transfer_window(
    journal: &Journal,
    current: &PrivateWorkspaceAuthority,
    verifier: &super::authority::WorkspaceAuthorityVerifier,
) -> Result<(), Error> {
    let now = current_unix_seconds().map_err(|_| Error::Unavailable)?;
    if journal.claim.is_some() {
        contract::capability(
            journal.capability()?,
            current,
            &journal.request_id,
            now,
            verifier,
        )?;
    }
    if let Some(pin) = &journal.pin
        && (wire::utc(pin.get("pinExpiresAt")?)? <= now
            || wire::utc(pin.get("pinExpiresAt")?)?
                > wire::utc(journal.capability()?.get("expiresAt")?)?)
    {
        return Err(rejected());
    }

    Ok(())
}

pub(super) fn open_for_initial_authority(
    custody: &DesktopProductionCustody,
    authority: &super::authority::VerifiedWorkspaceAuthority,
) -> Result<Option<crate::BusinessDatabase>, Error> {
    let state = custody.initial_replica_state().map_err(|_| storage())?;
    if state.phase != InitialReplicaPhase::Installed {
        return Ok(None);
    }
    let scope = state.scope.as_ref().ok_or_else(rejected)?;
    let journal = load_journal(&state)?.ok_or_else(rejected)?;
    if scope.installation
        != custody
            .installation_binding_digest()
            .map_err(|_| storage())?
        || scope.account != authority.account_id()
        || scope.workspace != authority.workspace_id()
        || scope.device != authority.device_id()
        || scope.workflow != journal.request_id
        || journal.security_epoch != authority.account_security_epoch()
    {
        return Err(Error::AuthorityRejected);
    }
    let activation = journal
        .activation
        .as_ref()
        .ok_or(Error::AuthorityRejected)?;
    if activation.get("pendingLeaseEpoch")?.number()? != authority.lease_epoch() {
        return Err(Error::AuthorityRejected);
    }
    let database = custody
        .open_initial_replica_database(authority.workspace_id())
        .map_err(|_| storage())?;
    database
        .verify_initial_replica_receipt(journal.local_receipt.as_ref().ok_or_else(rejected)?)
        .map_err(|_| storage())?;
    Ok(Some(database))
}

#[cfg(all(test, unix))]
mod tests;

fn stale_security_view(journal: &Journal) -> DesktopTargetInstallationView {
    DesktopTargetInstallationView::Stopped {
        request_id: journal.request_id.clone(),
        status: DesktopTargetBootstrapTerminalStatus::Failed,
    }
}

pub(super) fn initial_authority_awaits_receipt(
    custody: &DesktopProductionCustody,
    authority: &super::authority::VerifiedWorkspaceAuthority,
) -> Result<bool, Error> {
    let state = custody.initial_replica_state().map_err(|_| storage())?;
    if !matches!(
        state.phase,
        InitialReplicaPhase::Installing | InitialReplicaPhase::Installed
    ) {
        return Ok(false);
    }
    let scope = state.scope.as_ref().ok_or_else(rejected)?;
    let journal = load_journal(&state)?.ok_or_else(rejected)?;
    if scope.installation
        != custody
            .installation_binding_digest()
            .map_err(|_| storage())?
        || scope.account != authority.account_id()
        || scope.workspace != authority.workspace_id()
        || scope.device != authority.device_id()
        || scope.workflow != journal.request_id
        || journal.security_epoch != authority.account_security_epoch()
    {
        return Err(Error::AuthorityRejected);
    }
    if journal.activation.is_some() {
        return Ok(false);
    }
    let pending = journal
        .pending
        .as_ref()
        .filter(|pending| pending.kind == DesktopTargetInstallationExchangeKind::Activate)
        .ok_or(Error::AuthorityRejected)?;
    if pending.body.get("pendingLeaseEpoch")?.number()? != authority.lease_epoch() {
        return Err(Error::AuthorityRejected);
    }
    Ok(true)
}

pub(super) type PreparedInstallationPublication =
    (std::sync::Weak<()>, u64, u64, DesktopTargetInstallationView);
