//! Target-only bootstrap termination; no workspace database is opened or mutated here.
mod wire;

use super::{
    DesktopLocalHost, DesktopLocalHostError, Ordering, RuntimeRestriction, WorkspaceAuthorityKind,
    hex_digest,
};
use crate::DesktopNativeCloudAdmission;
use crate::desktop_native_cloud::{strict_json, validate_identifier};
use serde::{Deserialize, Serialize};

type Error = DesktopLocalHostError;
const MAX_REVISION: u64 = 9_007_199_254_740_991;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DesktopTargetBootstrapTerminalStatus {
    Cancelled,
    Failed,
    Completed,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum DesktopTargetBootstrapView {
    Idle,
    Available {
        request_id: String,
        bootstrap_expires_at: String,
    },
    Pending {
        request_id: String,
    },
    Finished {
        request_id: String,
        status: DesktopTargetBootstrapTerminalStatus,
    },
}

#[derive(Clone)]
pub struct DesktopTargetBootstrapStatusExchange {
    request_id: Option<String>,
    revision: u64,
    authority_epoch: u64,
    body: Vec<u8>,
}
#[derive(Clone)]
pub struct DesktopTargetBootstrapCancelExchange {
    request_id: String,
    revision: u64,
    authority_epoch: u64,
    body: Vec<u8>,
}
macro_rules! exchange {
    ($name:ident) => {
        impl $name {
            #[must_use]
            pub fn request_bytes(&self) -> &[u8] {
                &self.body
            }
        }
        impl std::fmt::Debug for $name {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                f.write_str(concat!(stringify!($name), "([REDACTED])"))
            }
        }
    };
}
exchange!(DesktopTargetBootstrapStatusExchange);
exchange!(DesktopTargetBootstrapCancelExchange);

#[derive(Debug)]
pub struct DesktopTargetBootstrapStatusOutcome {
    view: DesktopTargetBootstrapView,
    retry_cancel: Option<DesktopTargetBootstrapCancelExchange>,
}
impl DesktopTargetBootstrapStatusOutcome {
    #[must_use]
    pub fn into_parts(
        self,
    ) -> (
        DesktopTargetBootstrapView,
        Option<DesktopTargetBootstrapCancelExchange>,
    ) {
        (self.view, self.retry_cancel)
    }
    #[must_use]
    pub fn view(&self) -> &DesktopTargetBootstrapView {
        &self.view
    }
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
    state: DesktopTargetBootstrapView,
    #[serde(deserialize_with = "required_option")]
    pending: Option<Pending>,
    #[serde(deserialize_with = "required_option")]
    last_finished: Option<DesktopTargetBootstrapView>,
    #[serde(deserialize_with = "required_option")]
    retired_intent: Option<Pending>,
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Pending {
    request_id: String,
    account_security_epoch: u64,
    request_bytes: Vec<u8>,
}
fn required_option<'de, D: serde::Deserializer<'de>, T: Deserialize<'de>>(
    d: D,
) -> Result<Option<T>, D::Error> {
    Option::deserialize(d)
}

impl Control {
    fn view(&self) -> DesktopTargetBootstrapView {
        if self.state == DesktopTargetBootstrapView::Idle {
            self.last_finished
                .clone()
                .unwrap_or(DesktopTargetBootstrapView::Idle)
        } else {
            self.state.clone()
        }
    }
    fn validate(&self) -> Result<(), Error> {
        if self.schema_version != 1 || self.revision > MAX_REVISION {
            return Err(rejected());
        }
        for id in [&self.account, &self.workspace, &self.device] {
            validate_identifier(id, 160)?;
        }
        wire::validate_view(&self.state)?;
        if let Some(last) = &self.last_finished {
            if !matches!(last, DesktopTargetBootstrapView::Finished { .. }) {
                return Err(rejected());
            }
            wire::validate_view(last)?;
        }
        if let Some(retired) = &self.retired_intent {
            validate_identifier(&retired.request_id, 160)?;
            if retired.account_security_epoch == 0
                || retired.account_security_epoch > MAX_REVISION
                || retired.request_bytes != cancel_bytes(&retired.request_id)?
            {
                return Err(rejected());
            }
        }
        if matches!(self.state, DesktopTargetBootstrapView::Finished { .. })
            && self.last_finished.as_ref() != Some(&self.state)
        {
            return Err(rejected());
        }
        match (&self.state, &self.pending) {
            (DesktopTargetBootstrapView::Pending { request_id }, Some(pending)) => {
                if request_id != &pending.request_id
                    || pending.account_security_epoch == 0
                    || pending.account_security_epoch > MAX_REVISION
                    || pending.request_bytes != cancel_bytes(request_id)?
                {
                    return Err(rejected());
                }
            }
            (DesktopTargetBootstrapView::Pending { .. }, None) | (_, Some(_)) => {
                return Err(rejected());
            }
            _ => {}
        }
        Ok(())
    }
    fn cancel_exchange(
        &self,
        revision: u64,
        authority_epoch: u64,
    ) -> Result<DesktopTargetBootstrapCancelExchange, Error> {
        let pending = self.pending.as_ref().ok_or_else(rejected)?;
        Ok(DesktopTargetBootstrapCancelExchange {
            request_id: pending.request_id.clone(),
            revision,
            authority_epoch,
            body: pending.request_bytes.clone(),
        })
    }
    fn finish(&mut self, view: DesktopTargetBootstrapView) {
        self.pending = None;
        self.last_finished = Some(view.clone());
        self.state = view;
    }
}

impl DesktopLocalHost {
    /// Selects the original pending id after response loss, otherwise discovers this target's next workflow.
    /// # Errors
    /// Rejects unavailable custody or stale authority without opening a business database.
    pub fn prepare_target_bootstrap_status(
        &self,
        admission: &DesktopNativeCloudAdmission,
    ) -> Result<DesktopTargetBootstrapStatusExchange, Error> {
        self.with_target_control(admission, |record, _, next_revision| {
            let request_id = record
                .pending
                .as_ref()
                .map(|pending| pending.request_id.clone());
            let body =
                serde_json::to_vec(&serde_json::json!({"schemaVersion":1,"requestId":request_id}))
                    .map_err(|_| rejected())?;
            Ok(DesktopTargetBootstrapStatusExchange {
                request_id,
                revision: next_revision,
                authority_epoch: admission.inner.authority_epoch,
                body,
            })
        })
    }

    /// Consumes only the matching target response. A pending cancellation can retry only after exact status lookup.
    /// # Errors
    /// Rejects foreign targets, changed records, malformed responses and stale authority.
    pub fn complete_target_bootstrap_status(
        &self,
        admission: &DesktopNativeCloudAdmission,
        exchange: &DesktopTargetBootstrapStatusExchange,
        bytes: &[u8],
    ) -> Result<DesktopTargetBootstrapStatusOutcome, Error> {
        let response = wire::status(
            bytes,
            admission.inner.device_id(),
            exchange.request_id.as_deref(),
        )?;
        self.with_target_control(admission, |record, security_epoch, next_revision| {
            if exchange.authority_epoch != admission.inner.authority_epoch
                || record.revision != exchange.revision
                || record.pending.as_ref().map(|p| &p.request_id) != exchange.request_id.as_ref()
            {
                return Err(rejected());
            }
            let mut retry = false;
            match response {
                Some(view @ DesktopTargetBootstrapView::Finished { .. }) => record.finish(view),
                Some(view @ DesktopTargetBootstrapView::Available { .. }) => {
                    if matches!((&view, &record.last_finished),
                        (DesktopTargetBootstrapView::Available { request_id, .. }, Some(DesktopTargetBootstrapView::Finished { request_id: finished, .. })) if request_id == finished) {
                        return Err(rejected());
                    }
                    if let Some(pending) = &record.pending {
                        retry = pending.account_security_epoch == security_epoch;
                        if !retry {
                            // Fresh authority may reconcile the old exact target, but cannot reuse
                            // consent from a revoked security epoch. Preserve the retired intent.
                            record.retired_intent = record.pending.take();
                            record.state = view;
                        }
                    } else {
                        record.state = view;
                    }
                }
                None if record.pending.is_none() => record.state = DesktopTargetBootstrapView::Idle,
                // Not-found never authorizes another workflow or a blind cancellation.
                None => {}
                _ => return Err(rejected()),
            }
            // Exchange revision anticipates the single durable update performed by the owner below.
            let cancel = if retry {
                Some(record.cancel_exchange(next_revision, admission.inner.authority_epoch)?)
            } else {
                None
            };
            Ok(DesktopTargetBootstrapStatusOutcome {
                view: record.view(),
                retry_cancel: cancel,
            })
        })
    }

    /// Persists the user's exact confirmed target before Native may send the cancellation.
    /// # Errors
    /// Refuses any target other than the latest available preview or an unresolved prior intent.
    pub fn prepare_target_bootstrap_cancel(
        &self,
        admission: &DesktopNativeCloudAdmission,
        request_id: &str,
    ) -> Result<DesktopTargetBootstrapCancelExchange, Error> {
        validate_identifier(request_id, 160)?;
        self.with_target_control(admission, |record, security_epoch, next_revision| {
            if record.pending.is_some() || !matches!(&record.state, DesktopTargetBootstrapView::Available { request_id: current, .. } if current == request_id) { return Err(rejected()); }
            record.pending = Some(Pending { request_id: request_id.into(), account_security_epoch: security_epoch, request_bytes: cancel_bytes(request_id)? });
            record.state = DesktopTargetBootstrapView::Pending { request_id: request_id.into() };
            record.cancel_exchange(next_revision, admission.inner.authority_epoch)
        })
    }

    /// Saves the immutable terminal result. A closed rejection remains pending until an exact status read.
    /// # Errors
    /// Rejects response substitution, record races and stale publication.
    pub fn complete_target_bootstrap_cancel(
        &self,
        admission: &DesktopNativeCloudAdmission,
        exchange: &DesktopTargetBootstrapCancelExchange,
        bytes: &[u8],
    ) -> Result<DesktopTargetBootstrapView, Error> {
        let response = wire::cancel(bytes, admission.inner.device_id(), &exchange.request_id)?;
        self.with_target_control(admission, |record, _, _| {
            if exchange.authority_epoch != admission.inner.authority_epoch
                || record.revision != exchange.revision
                || record.pending.as_ref().is_none_or(|pending| {
                    pending.request_id != exchange.request_id
                        || pending.request_bytes != exchange.body
                })
            {
                return Err(rejected());
            }
            if let Some(view) = response {
                record.finish(view);
            }
            Ok(record.view())
        })
    }

    fn with_target_control<T>(
        &self,
        admission: &DesktopNativeCloudAdmission,
        action: impl FnOnce(&mut Control, u64, u64) -> Result<T, Error>,
    ) -> Result<T, Error> {
        let _operation = self.operation_selection.lock().map_err(|_| storage())?;
        let authority = self.authority_publication.lock().map_err(|_| storage())?;
        let current = authority
            .authority
            .as_ref()
            .ok_or(Error::AuthorityRejected)?;
        let epoch = authority.applied_authority_epoch;
        let matching_role = matches!(
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
        );
        if !matching_role
            || admission.inner.authority_epoch != epoch
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
            .load_target_bootstrap_control()
            .map_err(|_| storage())?;
        let mut record = if let Some(bytes) = &previous {
            let value = strict_json(bytes)?;
            serde_json::from_value::<Control>(value).map_err(|_| rejected())?
        } else {
            Control {
                schema_version: 1,
                installation,
                account: current.account_id.clone(),
                workspace: current.workspace_id.clone(),
                device: current.device_id.clone(),
                revision: 0,
                state: DesktopTargetBootstrapView::Idle,
                pending: None,
                last_finished: None,
                retired_intent: None,
            }
        };
        record.validate()?;
        if record.installation != installation
            || record.account != current.account_id
            || record.workspace != current.workspace_id
            || record.device != current.device_id
        {
            return Err(Error::AuthorityRejected);
        }
        // Every operation advances the CAS, including reads. An old response cannot replace a newer preview.
        let next_revision = record
            .revision
            .checked_add(1)
            .filter(|n| *n <= MAX_REVISION)
            .ok_or_else(rejected)?;
        let result = action(&mut record, current.account_security_epoch, next_revision)?;
        record.revision = next_revision;
        record.validate()?;
        let bytes = serde_json::to_vec(&record).map_err(|_| storage())?;
        fence()?;
        custody
            .replace_target_bootstrap_control(previous.as_deref(), &bytes)
            .map_err(|_| storage())?;
        // A role change may have requested the lock during OS custody I/O. The exact intent stays
        // durable, but its response is not published and Native must reconcile under fresh authority.
        fence()?;
        if self.transition_requested_epoch.load(Ordering::Acquire) != epoch {
            return Err(Error::AuthorityRejected);
        }
        Ok(result)
    }
}

fn cancel_bytes(request_id: &str) -> Result<Vec<u8>, Error> {
    serde_json::to_vec(&serde_json::json!({"schemaVersion":1,"requestId":request_id}))
        .map_err(|_| rejected())
}
fn rejected() -> Error {
    Error::CloudProtocolRejected
}
fn storage() -> Error {
    Error::StorageRejected
}

#[cfg(all(test, unix))]
mod tests;
