//! Trusted composition of OS samples and this installation's device identity for Local Host.

use std::sync::Arc;

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use gooddealer_local_storage::{
    DesktopApplicationRoot, DesktopContinuousClockKind, DesktopContinuousClockReading,
    DesktopExecutionContextError, DesktopExecutionContextNativePort,
    DesktopExecutionSigningIdentity, DesktopLocalHost, DesktopLocalHostError,
};

pub(crate) fn production_host(
    root: DesktopApplicationRoot,
    identity: Option<Arc<DesktopDeviceIdentity>>,
    power: &NativePowerGate,
) -> Result<DesktopLocalHost, DesktopLocalHostError> {
    let native = std::sync::Arc::new(ExecutionContextNative::new(identity, power.clone()));
    let host = DesktopLocalHost::production_with_execution_context(root, native)?;
    // Restore preserves original signed samples; unavailable/expired continuity never creates
    // execution authority. Online authentication may later acquire a new verified context.
    let epoch = power.snapshot().epoch;
    // OS custody and database opening can block. Stage them before taking the short power
    // publication fence; a power/authority change discards the staged in-memory authority.
    if let Ok(Some(staged)) = host.stage_execution_context_restore()
        && let Ok(_power) = power.hold_write_epoch(epoch)
    {
        let _ = host.publish_staged_execution_context(staged);
    }
    Ok(host)
}
use gooddealer_secure_host_core::{
    DesktopDeviceIdentity, NativeContinuousClockKind, NativePowerGate,
    capture_native_continuous_clock,
};

pub(crate) struct ExecutionContextNative {
    identity: Option<Arc<DesktopDeviceIdentity>>,
    power: NativePowerGate,
}

impl ExecutionContextNative {
    pub(crate) fn new(
        identity: Option<Arc<DesktopDeviceIdentity>>,
        power: NativePowerGate,
    ) -> Self {
        Self { identity, power }
    }
}

impl DesktopExecutionContextNativePort for ExecutionContextNative {
    fn capture_clock(&self) -> Result<DesktopContinuousClockReading, DesktopExecutionContextError> {
        // Host calls this while holding its own publication locks. Never acquire a power commit
        // guard here: the final Native composition acquires power before Host, in that order.
        let before = self.power.snapshot();
        if !before.ready || before.paused {
            return Err(DesktopExecutionContextError::Unavailable);
        }
        let sample = capture_native_continuous_clock()
            .map_err(|_| DesktopExecutionContextError::Unavailable)?;
        let after = self.power.snapshot();
        if !after.ready || after.paused || before.epoch != after.epoch {
            return Err(DesktopExecutionContextError::Stale);
        }
        let kind = match sample.clock_kind() {
            NativeContinuousClockKind::WindowsInterrupt100ns => {
                DesktopContinuousClockKind::WindowsInterrupt100ns
            }
            NativeContinuousClockKind::MacosContinuousNanoseconds => {
                DesktopContinuousClockKind::MacosContinuousNanoseconds
            }
            NativeContinuousClockKind::LinuxBootNanoseconds => {
                DesktopContinuousClockKind::LinuxBootNanoseconds
            }
        };
        DesktopContinuousClockReading::from_native_parts(kind, sample.boot_id(), sample.ticks())
    }

    fn signing_identity(
        &self,
    ) -> Result<DesktopExecutionSigningIdentity, DesktopExecutionContextError> {
        let identity = self
            .identity
            .as_ref()
            .ok_or(DesktopExecutionContextError::Unavailable)?;
        let public_key = URL_SAFE_NO_PAD
            .decode(identity.public_key_base64url())
            .ok()
            .and_then(|bytes| bytes.try_into().ok())
            .ok_or(DesktopExecutionContextError::Rejected)?;
        DesktopExecutionSigningIdentity::from_native_parts(
            identity.device_id(),
            identity.key_id(),
            public_key,
        )
    }

    fn sign_afternic_delist_approval(
        &self,
        transcript: &[u8],
    ) -> Result<[u8; 64], DesktopExecutionContextError> {
        self.identity
            .as_ref()
            .ok_or(DesktopExecutionContextError::Unavailable)?
            .sign_afternic_delist_approval_transcript(transcript)
            .map_err(|_| DesktopExecutionContextError::Rejected)
    }

    fn sign_afternic_listing_write_approval(
        &self,
        transcript: &[u8],
    ) -> Result<[u8; 64], DesktopExecutionContextError> {
        self.identity
            .as_ref()
            .ok_or(DesktopExecutionContextError::Unavailable)?
            .sign_afternic_listing_write_approval_transcript(transcript)
            .map_err(|_| DesktopExecutionContextError::Rejected)
    }

    fn sign_afternic_listing_plan_approval(
        &self,
        transcript: &[u8],
    ) -> Result<[u8; 64], DesktopExecutionContextError> {
        self.identity
            .as_ref()
            .ok_or(DesktopExecutionContextError::Unavailable)?
            .sign_afternic_listing_plan_approval_transcript(transcript)
            .map_err(|_| DesktopExecutionContextError::Rejected)
    }

    fn sign_afternic_ownership_review_approval(
        &self,
        transcript: &[u8],
    ) -> Result<[u8; 64], DesktopExecutionContextError> {
        self.identity
            .as_ref()
            .ok_or(DesktopExecutionContextError::Unavailable)?
            .sign_afternic_ownership_review_approval_transcript(transcript)
            .map_err(|_| DesktopExecutionContextError::Rejected)
    }

    fn sign_device_audit_event(
        &self,
        transcript: &[u8],
    ) -> Result<[u8; 64], DesktopExecutionContextError> {
        self.identity
            .as_ref()
            .ok_or(DesktopExecutionContextError::Unavailable)?
            .sign_device_audit_event_transcript(transcript)
            .map_err(|_| DesktopExecutionContextError::Rejected)
    }

    fn sign_execution_fact(
        &self,
        transcript: &[u8],
    ) -> Result<[u8; 64], DesktopExecutionContextError> {
        self.identity
            .as_ref()
            .ok_or(DesktopExecutionContextError::Unavailable)?
            .sign_execution_fact_transcript(transcript)
            .map_err(|_| DesktopExecutionContextError::Rejected)
    }
}
