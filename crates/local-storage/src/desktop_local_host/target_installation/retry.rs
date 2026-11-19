//! A new confirmed workflow may follow only a proven terminal attempt that never opened SQL.
//! Original sealed terminal journals remain selected by the same custody head as their successor.
use super::{
    DesktopLocalHost, DesktopNativeCloudAdmission, DesktopProductionCustody,
    DesktopTargetBootstrapTerminalStatus, DesktopTargetInstallationExchangeKind,
    DesktopTargetInstallationNewWorkflow, DesktopTargetInstallationView, Error,
    InitialReplicaPhase, Journal, PrivateWorkspaceAuthority, Value, load_journal, rejected,
    require_transfer_window, stale_security_view, storage, wire,
};
use crate::desktop_custody::InitialReplicaState;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum WriteState {
    NotStarted,
    Started,
    LegacyUnknown,
}

pub(super) fn decode_journal(bytes: &[u8]) -> Result<Journal, Error> {
    let mut value = wire::parse(bytes, 32 * 1_048_576)?;
    if value.get("schemaVersion")?.number()? == 1 {
        if value.get("writeState").is_ok() || value.get("terminalEvidence").is_ok() {
            return Err(rejected());
        }
        // v1 could have committed SQL before its receipt reached this journal. Only an absent
        // pin proves the installer could not have reached its first database open.
        let never_opened = value.get("pin")?.is_null()
            && value.get("localReceipt")?.is_null()
            && value.get("activation")?.is_null();
        value.set(
            "writeState",
            Value::string(if never_opened {
                "not_started"
            } else {
                "legacy_unknown"
            }),
        )?;
        value.set("terminalEvidence", Value::Null)?;
        value.set("schemaVersion", Value::Number(2))?;
        let mut view = value.get("view")?.clone();
        if view.get("kind")?.equals_text("stopped") {
            if view.get("new_workflow").is_ok() {
                return Err(rejected());
            }
            view.set("new_workflow", Value::string("awaiting_terminal"))?;
            value.set("view", view)?;
        }
    }
    if value.get("schemaVersion")?.number()? == 2 {
        if value.get("origin").is_ok() {
            return Err(rejected());
        }
        value.set("origin", Value::Null)?;
        value.set("schemaVersion", Value::Number(3))?;
    }
    let journal: Journal = serde_json::from_slice(&value.bytes()?).map_err(|_| rejected())?;
    journal.validate()?;
    Ok(journal)
}

pub(super) fn validate_journal(journal: &Journal) -> Result<(), Error> {
    let (DesktopTargetInstallationView::Running {
        request_id: request,
        ..
    }
    | DesktopTargetInstallationView::Completed {
        request_id: request,
    }
    | DesktopTargetInstallationView::Stopped {
        request_id: request,
        ..
    }) = &journal.view
    else {
        return Err(rejected());
    };
    if request != &journal.request_id
        || journal.write_state == WriteState::NotStarted
            && (journal.local_receipt.is_some() || journal.activation.is_some())
        || matches!(
            journal.view,
            DesktopTargetInstallationView::Completed { .. }
        ) && journal.activation.is_none()
    {
        return Err(rejected());
    }
    if journal.terminal_evidence.is_some() {
        terminal(journal)?;
    }
    Ok(())
}

fn terminal(journal: &Journal) -> Result<Option<DesktopTargetBootstrapTerminalStatus>, Error> {
    let Some(evidence) = &journal.terminal_evidence else {
        return Ok(None);
    };
    if evidence.get("kind")?.equals_text("forced_control") {
        evidence.shape(&["kind", "record"], &[])?;
        let origin = journal.origin.as_ref().ok_or_else(rejected)?;
        return super::super::forced_takeover::validate_terminal_record(
            &evidence.get("record")?.bytes()?,
            origin,
            journal.security_epoch,
        )
        .map(Some);
    }
    let view = if evidence.get("kind")?.equals_text("target_control") {
        evidence.shape(&["kind", "record"], &[])?;
        let record = evidence.get("record")?;
        // The full validated Native record is retained, including the original cancellation
        // request. It is evidence of Cloud's exact terminal reply, not a local stopped view.
        let last = record.get("lastFinished")?;
        if last.get("request_id")?.text()? != journal.request_id {
            return Err(rejected());
        }
        last
    } else {
        evidence.shape(&["kind", "response"], &[])?;
        if !evidence.get("kind")?.equals_text("receipt") {
            return Err(rejected());
        }
        let response = evidence.get("response")?;
        if !["committed", "terminal"].contains(&response.get("outcome")?.text()?) {
            return Err(rejected());
        }
        let workflow = response.get("workflow")?;
        if workflow.get("requestId")?.text()? != journal.request_id {
            return Err(rejected());
        }
        workflow
    };
    let status = super::terminal_status(view.get("status")?.text()?)?;
    Ok(Some(status))
}

fn control_evidence(
    custody: &DesktopProductionCustody,
    journal: &Journal,
) -> Result<Option<Value>, Error> {
    if let Some(origin) = &journal.origin
        && let Some(bytes) =
            super::super::forced_takeover::terminal_record(custody, origin, journal.security_epoch)?
    {
        return Ok(Some(Value::object([
            ("kind", Value::string("forced_control")),
            ("record", wire::parse(&bytes, 65_536)?),
        ])));
    }
    super::super::target_bootstrap::installation_terminal_record(custody, &journal.request_id)?
        .map(|bytes| {
            Ok(Value::object([
                ("kind", Value::string("target_control")),
                ("record", wire::parse(&bytes, 65_536)?),
            ]))
        })
        .transpose()
}

pub(super) fn eligibility(
    custody: &DesktopProductionCustody,
    current: &PrivateWorkspaceAuthority,
    state: &InitialReplicaState,
    journal: &Journal,
) -> Result<DesktopTargetInstallationNewWorkflow, Error> {
    use DesktopTargetInstallationNewWorkflow as Next;
    if journal.security_epoch != current.account_security_epoch {
        return Ok(Next::AuthorizationChanged);
    }
    if journal.write_state != WriteState::NotStarted
        || state.phase != InitialReplicaPhase::Installing
        || journal.local_receipt.is_some()
        || journal.activation.is_some()
        || !custody
            .initial_replica_database_unwritten()
            .map_err(|_| storage())?
    {
        return Ok(Next::RequiresRecovery);
    }
    let status = terminal(journal)?;
    if !matches!(
        status,
        Some(
            DesktopTargetBootstrapTerminalStatus::Cancelled
                | DesktopTargetBootstrapTerminalStatus::Failed
        )
    ) {
        return Ok(Next::AwaitingTerminal);
    }
    if journal
        .pending
        .as_ref()
        .is_some_and(|pending| pending.kind == DesktopTargetInstallationExchangeKind::Activate)
    {
        return Ok(Next::RequiresRecovery);
    }
    if !custody
        .initial_replica_has_history_capacity()
        .map_err(|_| storage())?
    {
        return Ok(Next::HistoryFull);
    }
    Ok(Next::Allowed)
}

pub(super) fn view(
    custody: &DesktopProductionCustody,
    current: &PrivateWorkspaceAuthority,
    state: &InitialReplicaState,
    journal: &Journal,
) -> Result<DesktopTargetInstallationView, Error> {
    if journal.security_epoch != current.account_security_epoch {
        return Ok(stale_security_view(journal));
    }
    if let DesktopTargetInstallationView::Stopped {
        request_id, status, ..
    } = &journal.view
    {
        return Ok(DesktopTargetInstallationView::Stopped {
            request_id: request_id.clone(),
            status: status.clone(),
            new_workflow: eligibility(custody, current, state, journal)?,
        });
    }
    Ok(journal.view.clone())
}

pub(super) fn validate_history(state: &InitialReplicaState) -> Result<(), Error> {
    for history in &state.history {
        let journal = decode_journal(&history.bytes)?;
        validate_terminal_scope(&journal, &history.scope)?;
        if journal.request_id != history.scope.workflow
            || journal.write_state != WriteState::NotStarted
            || !matches!(journal.view, DesktopTargetInstallationView::Stopped { .. })
            || !matches!(
                terminal(&journal)?,
                Some(
                    DesktopTargetBootstrapTerminalStatus::Cancelled
                        | DesktopTargetBootstrapTerminalStatus::Failed
                )
            )
        {
            return Err(rejected());
        }
    }
    Ok(())
}

impl DesktopLocalHost {
    pub(in crate::desktop_local_host) fn reconcile_installation_terminal(
        &self,
        admission: &DesktopNativeCloudAdmission,
    ) -> Result<(), Error> {
        self.with_initial_replica(admission, |custody, current, state| {
            let Some(mut journal) = load_journal(&state)? else {
                return Ok(((), None));
            };
            if journal.security_epoch != current.account_security_epoch
                || journal.activation.is_some()
                || journal.terminal_evidence.is_some()
            {
                return Ok(((), None));
            }
            let Some(evidence) = control_evidence(custody, &journal)? else {
                return Ok(((), None));
            };
            journal.terminal_evidence = Some(evidence);
            let status = terminal(&journal)?.ok_or_else(rejected)?;
            if status == DesktopTargetBootstrapTerminalStatus::Completed {
                return Ok(((), None));
            }
            journal.view = DesktopTargetInstallationView::Stopped {
                request_id: journal.request_id.clone(),
                status,
                new_workflow: DesktopTargetInstallationNewWorkflow::AwaitingTerminal,
            };
            Ok(((), Some((journal, state.phase))))
        })
    }

    pub(super) fn mark_installation_write_started(
        &self,
        admission: &DesktopNativeCloudAdmission,
    ) -> Result<(), Error> {
        self.with_initial_replica(admission, |custody, current, state| {
            let mut journal = load_journal(&state)?.ok_or_else(rejected)?;
            if journal.security_epoch != current.account_security_epoch
                || state.phase != InitialReplicaPhase::Installing
                || !matches!(journal.view, DesktopTargetInstallationView::Running { .. })
                || journal.pending.is_some()
                || journal.local_receipt.is_some()
                || journal.terminal_evidence.is_some()
                || super::super::target_bootstrap::installation_terminal(
                    custody,
                    &journal.request_id,
                )?
                .is_some()
                || super::installation_cancel_pending(custody, &journal)?
            {
                return Err(rejected());
            }
            require_transfer_window(
                &journal,
                current,
                self.authority_verifier.as_ref().ok_or(Error::Unavailable)?,
            )?;
            journal.projection(&current.workspace_id)?;
            if journal.write_state == WriteState::Started {
                return Ok(((), None));
            }
            journal.write_state = WriteState::Started;
            Ok(((), Some((journal, state.phase))))
        })
    }
}

pub(super) fn reconciliation_request(
    custody: &DesktopProductionCustody,
) -> Result<Option<String>, Error> {
    let state = custody.initial_replica_state().map_err(|_| storage())?;
    let Some(journal) = load_journal(&state)? else {
        return Ok(None);
    };
    if journal.terminal_evidence.is_some() || journal.activation.is_some() {
        return Ok(None);
    }
    // last_finished may outlive discovery of a later workflow. Once available, the installation
    // background stage copies it into the sealed journal before any subsequent new approval.
    if control_evidence(custody, &journal)?.is_some() {
        return Ok(None);
    }
    if journal.origin.is_some() && journal.claim.is_none() {
        return Ok(None);
    }
    Ok(Some(journal.request_id))
}

pub(super) fn validate_terminal_scope(
    journal: &Journal,
    scope: &crate::desktop_custody::InitialReplicaScope,
) -> Result<(), Error> {
    if let Some(evidence) = &journal.terminal_evidence
        && evidence.get("kind")?.equals_text("forced_control")
    {
        super::super::forced_takeover::validate_terminal_scope(
            &evidence.get("record")?.bytes()?,
            scope,
        )?;
    }
    Ok(())
}
