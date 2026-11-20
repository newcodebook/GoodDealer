//! Native-only fresh context admission; no clock sample or anchor crosses Renderer IPC.
use super::authority::execution_context::VerifiedExecutionContext;
use super::{
    DesktopApplicationRoot, DesktopBusinessRuntime, DesktopLocalHost, DesktopLocalHostError,
    DesktopRuntimeState, DesktopSyncError, DesktopSyncRunAdmission, DesktopSyncRuntime, Digest,
    MAX_SAFE_INTEGER, Ordering, PrivateWorkspaceAuthority, RuntimeRestriction, Sha256,
    TrustedWorkspaceBinding, WorkspaceAuthorityKind, current_unix_seconds, fmt, format_timestamp,
};
use crate::BusinessDatabaseError;
use crate::desktop_custody::{
    CommercialAuthorizationFloor, DeviceEvidenceFloor, ExecutionAnchorRecord,
    WorkspaceAuthorizationFloor, WorkspaceAuthorizationRecord,
};
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use std::sync::{Arc, Weak};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DesktopExecutionContextError {
    Unavailable,
    Rejected,
    Busy,
    Stale,
    Expired,
    StorageRejected,
}
impl fmt::Display for DesktopExecutionContextError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Unavailable => "EXECUTION_CONTEXT_UNAVAILABLE",
            Self::Rejected => "EXECUTION_CONTEXT_REJECTED",
            Self::Busy => "EXECUTION_CONTEXT_BUSY",
            Self::Stale => "EXECUTION_CONTEXT_STALE",
            Self::Expired => "EXECUTION_CONTEXT_EXPIRED",
            Self::StorageRejected => "EXECUTION_CONTEXT_STORAGE_REJECTED",
        })
    }
}
impl std::error::Error for DesktopExecutionContextError {}
type Error = DesktopExecutionContextError;
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DesktopContinuousClockKind {
    WindowsInterrupt100ns,
    MacosContinuousNanoseconds,
    LinuxBootNanoseconds,
}
impl DesktopContinuousClockKind {
    fn name(self) -> &'static str {
        match self {
            Self::WindowsInterrupt100ns => "windows_interrupt_100ns",
            Self::MacosContinuousNanoseconds => "macos_continuous_nanoseconds",
            Self::LinuxBootNanoseconds => "linux_boot_nanoseconds",
        }
    }
    fn divisor(self) -> u64 {
        if self == Self::WindowsInterrupt100ns {
            10_000
        } else {
            1_000_000
        }
    }
}
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct DesktopContinuousClockReading {
    kind: DesktopContinuousClockKind,
    boot_id: [u8; 16],
    ticks: u64,
}
impl DesktopContinuousClockReading {
    /// Trusted Native assembly only; this constructor does not accept or authenticate wire data.
    /// # Errors
    /// Rejects an unknown boot identity or invalid counter.
    pub fn from_native_parts(
        kind: DesktopContinuousClockKind,
        boot_id: [u8; 16],
        ticks: u64,
    ) -> Result<Self, Error> {
        if boot_id == [0; 16] || ticks == 0 {
            return Err(Error::Rejected);
        }
        Ok(Self {
            kind,
            boot_id,
            ticks,
        })
    }
    fn elapsed(self, start: Self) -> Result<u64, Error> {
        if self.kind != start.kind || self.boot_id != start.boot_id {
            return Err(Error::Stale);
        }
        let ticks = self.ticks.checked_sub(start.ticks).ok_or(Error::Stale)?;
        Ok(ticks / self.kind.divisor() + u64::from(ticks % self.kind.divisor() != 0))
    }
}
#[derive(Clone, PartialEq, Eq)]
pub struct DesktopExecutionSigningIdentity {
    device_id: String,
    key_id: String,
    public_key: [u8; 32],
}
impl DesktopExecutionSigningIdentity {
    /// Accepts only the installed Native device identity, never Renderer-provided values.
    /// # Errors
    /// Rejects invalid bounded identifiers or key material.
    pub fn from_native_parts(
        device_id: &str,
        key_id: &str,
        public_key: [u8; 32],
    ) -> Result<Self, Error> {
        if [device_id, key_id].iter().any(|v| {
            v.is_empty() || v.len() > 160 || !v.bytes().all(|b| (0x21..=0x7e).contains(&b))
        }) || public_key == [0; 32]
        {
            return Err(Error::Rejected);
        }
        Ok(Self {
            device_id: device_id.into(),
            key_id: key_id.into(),
            public_key,
        })
    }
    fn binding(&self) -> [u8; 32] {
        let mut h = Sha256::new();
        h.update(b"GOODDEALER/INSTALLATION-BINDING-V1\0");
        h.update(self.public_key);
        h.finalize().into()
    }
}
pub trait DesktopExecutionContextNativePort: Send + Sync {
    /// Signs only the fixed Afternic item approval transcript.
    /// # Errors
    /// Refuses wrong purpose, device, key or malformed transcript.
    fn sign_afternic_delist_approval(&self, transcript: &[u8]) -> Result<[u8; 64], Error>;
    /// Signs only the listing-write item approval transcript.
    /// # Errors
    /// Rejects the wrong purpose or unavailable Native identity key.
    fn sign_afternic_listing_write_approval(&self, transcript: &[u8]) -> Result<[u8; 64], Error>;
    /// Signs only a v2 Listing plan item; older Native ports fail closed until upgraded.
    /// # Errors
    /// Rejects an unavailable purpose-specific signer.
    fn sign_afternic_listing_plan_approval(&self, _transcript: &[u8]) -> Result<[u8; 64], Error> {
        Err(Error::Unavailable)
    }
    /// Signs only an ownership review item; this is distinct from Listing writes.
    /// # Errors
    /// Rejects an unavailable purpose-specific signer.
    fn sign_afternic_ownership_review_approval(
        &self,
        _transcript: &[u8],
    ) -> Result<[u8; 64], Error> {
        Err(Error::Unavailable)
    }

    /// Signs only a `SellerHub` BIN price item approval.
    /// # Errors
    /// Rejects an unavailable purpose-specific signer.
    fn sign_sellerhub_bin_price_approval(&self, _transcript: &[u8]) -> Result<[u8; 64], Error> {
        Err(Error::Unavailable)
    }

    /// Signs only the fixed device audit transcript.
    /// # Errors
    /// Refuses wrong purpose, device, key or malformed transcript.
    fn sign_device_audit_event(&self, transcript: &[u8]) -> Result<[u8; 64], Error>;
    /// Signs only the fixed execution fact transcript.
    /// # Errors
    /// Refuses wrong purpose, device, key or malformed transcript.
    fn sign_execution_fact(&self, transcript: &[u8]) -> Result<[u8; 64], Error>;
    /// Reads only the Native continuous clock; must not acquire custody or power publication locks.
    /// # Errors
    /// Refuses unavailable or uncertain native clock continuity.
    fn capture_clock(&self) -> Result<DesktopContinuousClockReading, Error>;
    /// Reads the already installed in-memory public identity; must not access the OS key store.
    /// # Errors
    /// Refuses unavailable or invalid installed signing identity.
    fn signing_identity(&self) -> Result<DesktopExecutionSigningIdentity, Error>;
}
pub struct DesktopExecutionContextRequest {
    token: Arc<()>,
    body: Vec<u8>,
}
impl DesktopExecutionContextRequest {
    #[must_use]
    pub fn request_body(&self) -> &[u8] {
        &self.body
    }
}
macro_rules! redacted { ($($t:ty),*) => {$ (impl fmt::Debug for $t { fn fmt(&self,f:&mut fmt::Formatter<'_>)->fmt::Result {f.write_str(concat!(stringify!($t),"([REDACTED])"))} })*}; }
redacted!(
    DesktopContinuousClockReading,
    DesktopExecutionSigningIdentity,
    DesktopExecutionContextRequest,
    DesktopStagedExecutionContext
);
struct Pending {
    token: Weak<()>,
    nonce: String,
    start: DesktopContinuousClockReading,
    generation: u64,
    digest: [u8; 32],
    identity: DesktopExecutionSigningIdentity,
}
struct Current {
    evidence: crate::active_workspace::business::ExecutionEvidenceContext,
    anchor: ExecutionAnchorRecord,
    observed: i64,
    expires: i64,
    generation: u64,
    snapshot_digest: String,
    identity: DesktopExecutionSigningIdentity,
}
/// A verified durable anchor awaiting the Native power/session publication fence.
/// It owns no OS custody, database handle, or transport and can only publish once to its Host.
pub struct DesktopStagedExecutionContext {
    token: Arc<()>,
    replacement: PrivateWorkspaceAuthority,
    sync: DesktopSyncRuntime,
    current: Current,
}
#[derive(Default)]
pub(super) struct ExecutionContextState {
    pending: Option<Pending>,
    current: Option<Current>,
    staged: Option<Weak<()>>,
}
fn sample(anchor: &ExecutionAnchorRecord) -> Result<DesktopContinuousClockReading, Error> {
    let kind = match anchor.clock_kind.as_str() {
        "windows_interrupt_100ns" => DesktopContinuousClockKind::WindowsInterrupt100ns,
        "macos_continuous_nanoseconds" => DesktopContinuousClockKind::MacosContinuousNanoseconds,
        "linux_boot_nanoseconds" => DesktopContinuousClockKind::LinuxBootNanoseconds,
        _ => return Err(Error::Rejected),
    };
    DesktopContinuousClockReading::from_native_parts(
        kind,
        anchor.boot_id,
        anchor.request_start_ticks,
    )
}
fn upper_bound(observed: i64, delta: u64, expires: i64) -> Result<i64, Error> {
    let ms = u64::try_from(observed)
        .ok()
        .and_then(|v| v.checked_mul(1000))
        .and_then(|v| v.checked_add(1000))
        .and_then(|v| v.checked_add(delta))
        .ok_or(Error::Rejected)?;
    let seconds =
        i64::try_from(ms / 1000 + u64::from(ms % 1000 != 0)).map_err(|_| Error::Rejected)?;
    if seconds >= expires {
        return Err(Error::Expired);
    }
    Ok(seconds)
}
impl DesktopLocalHost {
    /// Installs the trusted Native ports once at the composition root.
    /// # Errors
    /// Refuses invalid root/custody exactly as the closed production constructor does.
    pub fn production_with_execution_context(
        root: DesktopApplicationRoot,
        native: Arc<dyn DesktopExecutionContextNativePort>,
    ) -> Result<Self, DesktopLocalHostError> {
        let mut host = Self::production(root)?;
        host.execution_context_native = Some(native);
        Ok(host)
    }
    /// Captures the original request origin immediately before the fixed Native HTTP dispatch.
    /// # Errors
    /// Refuses missing ports, concurrent admission or non-Active authority.
    pub fn prepare_execution_context_request(
        &self,
    ) -> Result<DesktopExecutionContextRequest, Error> {
        let native = self
            .execution_context_native
            .as_ref()
            .ok_or(Error::Unavailable)?;
        let _operation = self
            .operation_selection
            .lock()
            .map_err(|_| Error::StorageRejected)?;
        let authority = self
            .authority_publication
            .lock()
            .map_err(|_| Error::StorageRejected)?;
        let runtime = self
            .runtime_state
            .lock()
            .map_err(|_| Error::StorageRejected)?;
        let generation = self.transition_requested_epoch.load(Ordering::Acquire);
        let active = authority
            .authority
            .as_ref()
            .filter(|a| {
                a.kind == WorkspaceAuthorityKind::Active
                    && a.generation == generation
                    && a.is_current_at(current_unix_seconds().unwrap_or(0))
            })
            .ok_or(Error::Stale)?;
        if authority.restriction != RuntimeRestriction::Active
            || authority.applied_authority_epoch != generation
        {
            return Err(Error::Stale);
        }
        // A drain still needs fresh time/authority for uploading its immutable evidence.
        // Refresh never reopens its producer: approval/claim admission stays behind the durable barrier.
        runtime.as_ref().ok_or(Error::Stale)?;
        let custody = self
            .production_custody
            .as_ref()
            .ok_or(Error::Unavailable)?
            .lock()
            .map_err(|_| Error::StorageRejected)?;
        custody
            .load_authorization_record()
            .map_err(|_| Error::StorageRejected)?;
        let identity = native.signing_identity()?;
        if identity.device_id != active.device_id
            || identity.binding()
                != custody
                    .installation_binding_digest()
                    .map_err(|_| Error::Rejected)?
        {
            return Err(Error::Rejected);
        }
        let mut state = self
            .execution_context_state
            .lock()
            .map_err(|_| Error::StorageRejected)?;
        if state
            .pending
            .as_ref()
            .is_some_and(|p| p.token.strong_count() != 0)
        {
            return Err(Error::Busy);
        }
        let mut nonce = [0; 32];
        getrandom::fill(&mut nonce).map_err(|_| Error::Unavailable)?;
        let nonce = URL_SAFE_NO_PAD.encode(nonce);
        let body = serde_json::to_vec(&serde_json::json!({"schemaVersion":1,"nonce":nonce}))
            .map_err(|_| Error::Rejected)?;
        let token = Arc::new(());
        state.pending = Some(Pending {
            token: Arc::downgrade(&token),
            nonce,
            start: native.capture_clock()?,
            generation,
            digest: active.digest,
            identity,
        });
        Ok(DesktopExecutionContextRequest { token, body })
    }
    /// Consumes even a failed response; a fresh request always draws a different nonce and t0.
    /// # Errors
    /// Refuses invalid/replayed response, changed authority, clock uncertainty or failed custody.
    pub fn stage_execution_context_response(
        &self,
        request: DesktopExecutionContextRequest,
        response: &[u8],
    ) -> Result<DesktopStagedExecutionContext, Error> {
        let native = self
            .execution_context_native
            .as_ref()
            .ok_or(Error::Unavailable)?;
        let end = native.capture_clock();
        let pending = {
            let mut state = self
                .execution_context_state
                .lock()
                .map_err(|_| Error::StorageRejected)?;
            if !state
                .pending
                .as_ref()
                .is_some_and(|p| p.token.ptr_eq(&Arc::downgrade(&request.token)))
            {
                return Err(Error::Stale);
            }
            // Once a real response enters admission, no failure may keep an older context
            // authorizing Provider effects. Transport failures before this stage retain theirs.
            state.current = None;
            state.pending.take().ok_or(Error::Stale)?
        };
        drop(request);
        let end = end?;
        if response.is_empty() || response.len() > 32_768 {
            return Err(Error::Rejected);
        }
        if end.elapsed(pending.start)? > 30_000 {
            return Err(Error::Expired);
        }
        let anchor = ExecutionAnchorRecord {
            schema_version: 1,
            response_bytes: URL_SAFE_NO_PAD.encode(response),
            nonce: pending.nonce.clone(),
            clock_kind: pending.start.kind.name().into(),
            boot_id: pending.start.boot_id,
            request_start_ticks: pending.start.ticks,
            response_ticks: end.ticks,
            anchor_digest: String::new(),
        };
        self.stage_execution_context(anchor, Some(&pending))
    }
    /// Consumes a failed/timed-out request without discarding an independently valid old anchor.
    /// # Errors
    /// Refuses foreign or already consumed handles.
    pub fn cancel_execution_context_request(
        &self,
        request: DesktopExecutionContextRequest,
    ) -> Result<(), Error> {
        let mut state = self
            .execution_context_state
            .lock()
            .map_err(|_| Error::StorageRejected)?;
        if !state
            .pending
            .as_ref()
            .is_some_and(|p| p.token.ptr_eq(&Arc::downgrade(&request.token)))
        {
            return Err(Error::Stale);
        }
        state.pending = None;
        drop(request);
        Ok(())
    }
    /// Reopens only an authenticated same-boot pair; this never re-anchors using wall time.
    /// # Errors
    /// Corrupt/partial custody is refused; unknown boot continuity cannot restore execution.
    pub fn stage_execution_context_restore(
        &self,
    ) -> Result<Option<DesktopStagedExecutionContext>, Error> {
        let anchor = {
            let custody = self
                .production_custody
                .as_ref()
                .ok_or(Error::Unavailable)?
                .lock()
                .map_err(|_| Error::StorageRejected)?;
            custody
                .load_authorization_record()
                .map_err(|_| Error::StorageRejected)?
                .and_then(|r| r.execution_anchor)
        };
        let Some(anchor) = anchor else {
            return Ok(None);
        };
        self.stage_execution_context(anchor, None).map(Some)
    }
    #[expect(
        clippy::too_many_lines,
        reason = "one publication transaction retains its complete custody and final fence"
    )]
    fn stage_execution_context(
        &self,
        mut anchor: ExecutionAnchorRecord,
        pending: Option<&Pending>,
    ) -> Result<DesktopStagedExecutionContext, Error> {
        let native = self
            .execution_context_native
            .as_ref()
            .ok_or(Error::Unavailable)?;
        let _operation = self
            .operation_selection
            .lock()
            .map_err(|_| Error::StorageRejected)?;
        let mut publication = self
            .authority_publication
            .lock()
            .map_err(|_| Error::StorageRejected)?;
        let mut runtime = self
            .runtime_state
            .lock()
            .map_err(|_| Error::StorageRejected)?;
        let custody = self
            .production_custody
            .as_ref()
            .ok_or(Error::Unavailable)?
            .lock()
            .map_err(|_| Error::StorageRejected)?;
        let old = custody
            .load_authorization_record()
            .map_err(|_| Error::StorageRejected)?;
        let identity = native.signing_identity()?;
        let generation = self.transition_requested_epoch.load(Ordering::Acquire);
        if identity.binding()
            != custody
                .installation_binding_digest()
                .map_err(|_| Error::Rejected)?
            || identity.device_id != custody.load_device_id().map_err(|_| Error::Rejected)?
        {
            return Err(Error::Rejected);
        }
        if let Some(p) = &pending {
            if generation != p.generation
                || identity != p.identity
                || publication.restriction != RuntimeRestriction::Active
                || !publication
                    .authority
                    .as_ref()
                    .is_some_and(|a| a.digest == p.digest && a.generation == generation)
            {
                return Err(Error::Stale);
            }
        } else if publication.authority.is_some()
            || publication.restriction != RuntimeRestriction::ActivationRequired
            || generation != publication.applied_authority_epoch
            || old.as_ref().and_then(|r| r.execution_anchor.as_ref()) != Some(&anchor)
        {
            return Err(Error::Stale);
        }
        let floor = old.as_ref().map(|r| &r.floor);
        let binding = TrustedWorkspaceBinding {
            account_id: floor.map(|f| f.account_id.as_str()),
            device_id: &identity.device_id,
            minimum_account_security_epoch: floor.map_or(0, |f| f.account_security_epoch),
            minimum_lease_epoch: floor.map_or(0, |f| f.maximum_lease_epoch),
        };
        let bytes = URL_SAFE_NO_PAD
            .decode(&anchor.response_bytes)
            .map_err(|_| Error::Rejected)?;
        let verified = VerifiedExecutionContext::verify(
            &bytes,
            &anchor.nonce,
            &identity.key_id,
            &binding,
            self.authority_verifier.as_ref().ok_or(Error::Unavailable)?,
        )
        .map_err(|_| Error::Rejected)?;
        if pending.is_none() && anchor.anchor_digest != verified.anchor_digest {
            return Err(Error::Rejected);
        }
        if old
            .as_ref()
            .and_then(|r| r.device_evidence_floor.as_ref())
            .is_some_and(|f| {
                verified.credential_epoch < f.credential_epoch
                    || verified.key_id != f.signing_key_id
                    || verified.key_version != f.signing_key_version
            })
        {
            return Err(Error::Rejected);
        }
        let now = upper_bound(
            verified.observed_at,
            native.capture_clock()?.elapsed(sample(&anchor)?)?,
            verified.expires_at,
        )?;
        let a = &verified.authority;
        if publication
            .authority
            .as_ref()
            .is_some_and(|current| !current.can_replace_with(a))
        {
            return Err(Error::Rejected);
        }
        let candidate = WorkspaceAuthorizationFloor {
            schema_version: 3,
            installation_binding: identity.binding(),
            account_id: a.account_id().into(),
            workspace_id: a.workspace_id().into(),
            device_id: a.device_id().into(),
            account_security_epoch: a.account_security_epoch(),
            issued_at: a.issued_at(),
            maximum_lease_epoch: a.lease_epoch(),
            last_active_lease_epoch: Some(a.lease_epoch()),
            standby_lease_epoch_floor: None,
            commercial: Some(CommercialAuthorizationFloor {
                revision: a.entitlement_revision(),
                digest: a.entitlement_projection_digest().into(),
                expires_at: a.commercial_expires_at().into(),
                capabilities: a.capabilities().to_vec(),
            }),
        }
        .advance(floor)
        .map_err(|_| Error::Rejected)?;
        let published_generation = if pending.is_some() {
            generation
                .checked_add(1)
                .filter(|v| *v <= MAX_SAFE_INTEGER)
                .ok_or(Error::Rejected)?
        } else {
            generation.max(1)
        };
        let mut replacement = PrivateWorkspaceAuthority::from_verified(a, published_generation);
        replacement.trusted_time_floor = verified.observed_at;
        replacement.execute_before = verified.expires_at;
        let snapshot_digest = a.snapshot_digest_hex();
        let sync = DesktopSyncRuntime::new(
            a.workspace_id().into(),
            a.device_id().into(),
            a.lease_epoch(),
            replacement.trusted_time_floor,
            replacement.execute_before,
            snapshot_digest.clone(),
            published_generation,
            a.capabilities().to_vec(),
        )
        .map_err(|_| Error::Rejected)?;
        // Opening and orphan cleanup are fallible prerequisites, before the Native commit point.
        let database = if runtime.is_none() {
            let installation_database =
                super::target_installation::open_for_initial_authority(&custody, a)
                    .map_err(|_| Error::Rejected)?;
            self.installation_context_gate
                .store(installation_database.is_some(), Ordering::Release);
            let mut database = installation_database
                .map_or_else(|| custody.open_workspace(a.workspace_id()), Ok)
                .map_err(|_| Error::StorageRejected)?;
            database
                .recover_cloudflare_credential_orphans_guarded(&format_timestamp(now), || Ok(()))
                .map_err(|_| Error::StorageRejected)?;
            Some(database)
        } else {
            None
        };
        anchor.anchor_digest = verified.anchor_digest;
        let mut record = WorkspaceAuthorizationRecord {
            schema_version: 4,
            floor: candidate,
            device_evidence_floor: Some(DeviceEvidenceFloor {
                credential_epoch: verified.credential_epoch,
                signing_key_id: verified.key_id,
                signing_key_version: verified.key_version,
            }),
            execution_anchor: Some(anchor.clone()),
        };
        if self.transition_requested_epoch.load(Ordering::Acquire) != generation {
            return Err(Error::Stale);
        }
        if custody.store_authorization_record(&record).is_err() {
            // A failed readback can follow a completed OS replacement. Never keep the older
            // in-memory authority executing against a possibly advanced durable floor.
            publication.authority = None;
            publication.restriction = RuntimeRestriction::SecurityLocked;
            if let Some(runtime) = runtime.as_mut() {
                runtime.sync = None;
            }
            self.invalidate_execution_context()
                .map_err(|_| Error::StorageRejected)?;
            record.execution_anchor = None;
            custody
                .store_authorization_record(&record)
                .map_err(|_| Error::StorageRejected)?;
            return Err(Error::StorageRejected);
        }
        let final_check = (|| {
            if native.signing_identity()? != identity {
                return Err(Error::Stale);
            }
            upper_bound(
                verified.observed_at,
                native.capture_clock()?.elapsed(sample(&anchor)?)?,
                verified.expires_at,
            )?;
            self.transition_requested_epoch
                .compare_exchange(
                    generation,
                    published_generation,
                    Ordering::AcqRel,
                    Ordering::Acquire,
                )
                .map_err(|_| Error::Stale)?;
            Ok(())
        })();
        if let Err(error) = final_check {
            publication.authority = None;
            publication.restriction = RuntimeRestriction::SecurityLocked;
            if let Some(runtime) = runtime.as_mut() {
                runtime.sync = None;
            }
            self.invalidate_execution_context()
                .map_err(|_| Error::StorageRejected)?;
            record.execution_anchor = None;
            custody
                .store_authorization_record(&record)
                .map_err(|_| Error::StorageRejected)?;
            return Err(error);
        }
        // The durable floor has advanced. Close old execution before returning across the
        // Native power/session gap; dropping the stage leaves a readable anchor, never Active.
        if let Some(database) = database {
            *runtime = Some(DesktopRuntimeState {
                business: DesktopBusinessRuntime::new(database),
                sync: None,
            });
        } else {
            runtime.as_mut().ok_or(Error::StorageRejected)?.sync = None;
        }
        publication.authority = None;
        publication.applied_authority_epoch = published_generation;
        publication.restriction = RuntimeRestriction::ActivationRequired;
        let mut state = self
            .execution_context_state
            .lock()
            .map_err(|_| Error::StorageRejected)?;
        let current = Current {
            evidence: crate::active_workspace::business::ExecutionEvidenceContext {
                account_id: a.account_id().into(),
                workspace_id: a.workspace_id().into(),
                source_device_id: a.device_id().into(),
                active_lease_epoch: a.lease_epoch(),
                credential_epoch: record
                    .device_evidence_floor
                    .as_ref()
                    .ok_or(Error::Rejected)?
                    .credential_epoch,
                signing_key_id: identity.key_id.clone(),
                signing_key_version: record
                    .device_evidence_floor
                    .as_ref()
                    .ok_or(Error::Rejected)?
                    .signing_key_version,
                authorization_hash: verified.authorization_hash,
                trusted_time_anchor_id: anchor.anchor_digest.clone(),
                monotonic_delta_ms: 0,
                occurred_at: format_timestamp(verified.observed_at),
                source_installation_digest: URL_SAFE_NO_PAD.encode(identity.binding()),
                public_key: identity.public_key,
            },
            anchor,
            observed: verified.observed_at,
            expires: verified.expires_at,
            generation: published_generation,
            snapshot_digest,
            identity,
        };
        let token = Arc::new(());
        state.current = None;
        state.pending = None;
        state.staged = Some(Arc::downgrade(&token));
        Ok(DesktopStagedExecutionContext {
            token,
            replacement,
            sync,
            current,
        })
    }

    /// Publishes a prepared anchor under Native's power/session fence; performs no custody or SQL I/O.
    /// # Errors
    /// Refuses foreign/consumed stages, authority changes, clock uncertainty or expired original t0.
    pub fn publish_staged_execution_context(
        &self,
        stage: DesktopStagedExecutionContext,
    ) -> Result<(), Error> {
        let native = self
            .execution_context_native
            .as_ref()
            .ok_or(Error::Unavailable)?;
        let _operation = self
            .operation_selection
            .lock()
            .map_err(|_| Error::StorageRejected)?;
        let mut publication = self
            .authority_publication
            .lock()
            .map_err(|_| Error::StorageRejected)?;
        let mut runtime = self
            .runtime_state
            .lock()
            .map_err(|_| Error::StorageRejected)?;
        let mut context = self
            .execution_context_state
            .lock()
            .map_err(|_| Error::StorageRejected)?;
        if !context
            .staged
            .as_ref()
            .is_some_and(|token| token.ptr_eq(&Arc::downgrade(&stage.token)))
        {
            return Err(Error::Stale);
        }
        context.staged = None;
        if self.transition_requested_epoch.load(Ordering::Acquire) != stage.current.generation
            || publication.applied_authority_epoch != stage.current.generation
            || publication.authority.is_some()
            || publication.restriction != RuntimeRestriction::ActivationRequired
            || native.signing_identity()? != stage.current.identity
        {
            return Err(Error::Stale);
        }
        upper_bound(
            stage.current.observed,
            native
                .capture_clock()?
                .elapsed(sample(&stage.current.anchor)?)?,
            stage.current.expires,
        )?;
        self.transition_requested_epoch
            .compare_exchange(
                stage.current.generation,
                stage.current.generation,
                Ordering::AcqRel,
                Ordering::Acquire,
            )
            .map_err(|_| Error::Stale)?;
        runtime.as_mut().ok_or(Error::StorageRejected)?.sync = Some(stage.sync);
        publication.authority = Some(stage.replacement);
        publication.restriction = RuntimeRestriction::Active;
        context.current = Some(stage.current);
        self.installation_context_gate
            .store(false, Ordering::Release);
        Ok(())
    }

    #[cfg(all(test, unix))]
    pub(super) fn complete_execution_context_request(
        &self,
        request: DesktopExecutionContextRequest,
        response: &[u8],
    ) -> Result<(), Error> {
        let stage = self.stage_execution_context_response(request, response)?;
        self.publish_staged_execution_context(stage)
    }
    #[cfg(all(test, unix))]
    pub(super) fn restore_execution_context(&self) -> Result<bool, Error> {
        let Some(stage) = self.stage_execution_context_restore()? else {
            return Ok(false);
        };
        self.publish_staged_execution_context(stage)?;
        Ok(true)
    }
    /// Called inside the existing publication lock, including the final business commit callback.
    pub(super) fn require_execution_context(
        &self,
        run: &DesktopSyncRunAdmission,
    ) -> Result<(), DesktopSyncError> {
        let native = self
            .execution_context_native
            .as_ref()
            .ok_or(DesktopSyncError::StaleAuthority)?;
        let state = self
            .execution_context_state
            .lock()
            .map_err(|_| DesktopSyncError::StorageRejected)?;
        let current = state
            .current
            .as_ref()
            .ok_or(DesktopSyncError::StaleAuthority)?;
        let check = (|| {
            if self.transition_requested_epoch.load(Ordering::Acquire) != current.generation
                || current.snapshot_digest != run.authority_snapshot_digest()
                || native.signing_identity()? != current.identity
            {
                return Err(Error::Stale);
            }
            upper_bound(
                current.observed,
                native.capture_clock()?.elapsed(sample(&current.anchor)?)?,
                current.expires,
            )?;
            Ok(())
        })();
        check.map_err(|_: Error| DesktopSyncError::StaleAuthority)
    }
    pub(super) fn execution_evidence_context(
        &self,
        run: &DesktopSyncRunAdmission,
    ) -> Result<crate::active_workspace::business::ExecutionEvidenceContext, DesktopSyncError> {
        self.require_execution_context(run)?;
        let native = self
            .execution_context_native
            .as_ref()
            .ok_or(DesktopSyncError::StaleAuthority)?;
        let state = self
            .execution_context_state
            .lock()
            .map_err(|_| DesktopSyncError::StorageRejected)?;
        let current = state
            .current
            .as_ref()
            .ok_or(DesktopSyncError::StaleAuthority)?;
        let delta = native
            .capture_clock()
            .and_then(|now| now.elapsed(sample(&current.anchor)?))
            .map_err(|_| DesktopSyncError::StaleAuthority)?;
        let boundary = upper_bound(current.observed, delta, current.expires)
            .map_err(|_| DesktopSyncError::StaleAuthority)?;
        let mut evidence = current.evidence.clone();
        evidence.monotonic_delta_ms = delta;
        evidence.occurred_at = format_timestamp(boundary);
        Ok(evidence)
    }
    pub(super) fn sign_execution_evidence(
        &self,
        purpose: crate::active_workspace::business::EvidenceSignaturePurpose,
        transcript: &[u8],
    ) -> Result<[u8; 64], BusinessDatabaseError> {
        use crate::active_workspace::business::EvidenceSignaturePurpose;
        let native = self
            .execution_context_native
            .as_ref()
            .ok_or(BusinessDatabaseError::MutationStale)?;
        match purpose {
            EvidenceSignaturePurpose::AfternicListingPlanApproval => {
                native.sign_afternic_listing_plan_approval(transcript)
            }
            EvidenceSignaturePurpose::AfternicOwnershipReviewApproval => {
                native.sign_afternic_ownership_review_approval(transcript)
            }
            EvidenceSignaturePurpose::AfternicListingWriteApproval => {
                native.sign_afternic_listing_write_approval(transcript)
            }
            EvidenceSignaturePurpose::AfternicDelistApproval => {
                native.sign_afternic_delist_approval(transcript)
            }
            EvidenceSignaturePurpose::SellerHubBinPriceApproval => {
                native.sign_sellerhub_bin_price_approval(transcript)
            }
            EvidenceSignaturePurpose::DeviceAudit => native.sign_device_audit_event(transcript),
            EvidenceSignaturePurpose::ExecutionFact => native.sign_execution_fact(transcript),
        }
        .map_err(|_| BusinessDatabaseError::MutationStale)
    }
    pub(super) fn invalidate_execution_context(&self) -> Result<(), DesktopLocalHostError> {
        let mut state = self
            .execution_context_state
            .lock()
            .map_err(|_| DesktopLocalHostError::StorageRejected)?;
        state.pending = None;
        state.current = None;
        state.staged = None;
        Ok(())
    }
}
#[cfg(all(test, unix))]
pub(crate) mod tests;
