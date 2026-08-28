//! Portable logical browser lifecycle used to prove Host ordering invariants.
//!
//! This is not a native engine and deliberately has no public constructor.

use crate::download_policy::{
    DownloadDecision, UploadDecision, decide_download, decide_file_chooser,
};
use crate::engine::{BrowserEngineError, EngineAdapter, EngineContextLease};
use crate::navigation_policy::{NavigationError, NavigationPolicy};
use crate::permission_policy::{BrowserPermission, PermissionDecision, decide_permission};
use crate::popup_policy::{PopupDecision, decide_popup};
use crate::profile::{
    ProfileGeneration, ProfileId, ProfileKey, ProfileRegistry, SessionPersistence,
};
use crate::session::{BrowserSessionState, SessionId, SessionSequence, SideEffectState};

const MAX_ENGINE_EVENT_BYTES: usize = 256;

#[derive(Debug)]
pub(crate) struct BrowserPolicyBundle {
    session_id: u64,
    profile_generation: u64,
    navigation_generation: u64,
    navigation: NavigationPolicy,
}

impl BrowserPolicyBundle {
    pub(crate) fn host_created(
        session_id: &SessionId,
        profile_generation: &ProfileGeneration,
        navigation_generation: u64,
        navigation: NavigationPolicy,
    ) -> Self {
        Self {
            session_id: session_id.value(),
            profile_generation: profile_generation.value(),
            navigation_generation,
            navigation,
        }
    }

    fn decide_navigation(
        &self,
        session_id: &SessionId,
        profile_generation: &ProfileGeneration,
        navigation_generation: u64,
        url: &str,
    ) -> Result<(), NavigationError> {
        if self.session_id != session_id.value()
            || self.profile_generation != profile_generation.value()
            || self.navigation_generation != navigation_generation
        {
            return Err(NavigationError::StalePolicyBinding);
        }
        self.navigation.decide(url)
    }
}

#[derive(Debug)]
pub(crate) struct BrowserRuntime {
    session_id: SessionId,
    sequence: SessionSequence,
    state: BrowserSessionState,
    key: ProfileKey,
    profile_id: ProfileId,
    profile_generation: ProfileGeneration,
    navigation_generation: u64,
    app_boot_generation: u64,
    policy: BrowserPolicyBundle,
    context: Option<EngineContextLease>,
    side_effect: SideEffectState,
}

impl BrowserRuntime {
    pub(crate) fn prepare(
        session_id: SessionId,
        key: ProfileKey,
        registry: &mut ProfileRegistry,
        navigation: NavigationPolicy,
    ) -> Self {
        let profile_id = registry.resolve(&key);
        let profile_generation = ProfileGeneration::initial();
        let navigation_generation = 1;
        let policy = BrowserPolicyBundle::host_created(
            &session_id,
            &profile_generation,
            navigation_generation,
            navigation,
        );
        Self {
            session_id,
            sequence: SessionSequence::initial(),
            state: BrowserSessionState::Prepared,
            key,
            profile_id,
            profile_generation,
            navigation_generation,
            app_boot_generation: 1,
            policy,
            context: None,
            side_effect: SideEffectState::NotDispatched,
        }
    }

    pub(crate) fn start<A: EngineAdapter>(
        &mut self,
        initial_url: &str,
        adapter: &mut A,
    ) -> Result<(), BrowserRuntimeError> {
        self.require_state(BrowserSessionState::Prepared)?;
        // URL admission deliberately precedes context/profile/native allocation.
        if self
            .policy
            .decide_navigation(
                &self.session_id,
                &self.profile_generation,
                self.navigation_generation,
                initial_url,
            )
            .is_err()
        {
            self.invalidate();
            return Err(BrowserRuntimeError::NavigationDenied);
        }
        let lease = match adapter.open_context(&self.profile_id) {
            Ok(lease) => lease,
            Err(BrowserEngineError::ContextOccupied) => {
                return Err(BrowserRuntimeError::ContextOccupied);
            }
            Err(error) => {
                self.invalidate();
                return Err(error.into());
            }
        };
        self.context = Some(lease);
        if let Err(error) =
            adapter.navigate(self.context.as_ref().expect("context was just installed"))
        {
            self.invalidate();
            return Err(terminal_adapter_error(error));
        }
        self.state = BrowserSessionState::UserControlled;
        if !self.sequence.try_advance() {
            self.invalidate();
            return Err(BrowserRuntimeError::GenerationOverflow);
        }
        Ok(())
    }

    pub(crate) fn navigate<A: EngineAdapter>(
        &mut self,
        url: &str,
        adapter: &mut A,
    ) -> Result<(), BrowserRuntimeError> {
        self.require_state(BrowserSessionState::UserControlled)?;
        if self
            .policy
            .decide_navigation(
                &self.session_id,
                &self.profile_generation,
                self.navigation_generation,
                url,
            )
            .is_err()
        {
            self.invalidate();
            return Err(BrowserRuntimeError::NavigationDenied);
        }
        let lease = self
            .context
            .as_ref()
            .ok_or(BrowserRuntimeError::InvalidState)?;
        if let Err(error) = adapter.navigate(lease) {
            self.invalidate();
            return Err(terminal_adapter_error(error));
        }
        self.sequence.advance();
        Ok(())
    }

    /// Consumes evidence that a fresh ticket was exchanged and transfers control to software.
    /// There is deliberately no `resume` transition: after takeover, callers must perform the
    /// full authorization exchange again to obtain another permit.
    pub(crate) fn begin_software_control(
        &mut self,
        _permit: FreshAutomationPermit,
    ) -> Result<(), BrowserRuntimeError> {
        self.require_state(BrowserSessionState::UserControlled)?;
        self.side_effect = SideEffectState::NotDispatched;
        self.state = BrowserSessionState::SoftwareControlled;
        self.sequence.advance();
        Ok(())
    }

    pub(crate) fn record_dispatched_side_effect(
        &mut self,
        side_effect: SideEffectState,
    ) -> Result<(), BrowserRuntimeError> {
        self.require_state(BrowserSessionState::SoftwareControlled)?;
        if side_effect == SideEffectState::NotDispatched {
            return Err(BrowserRuntimeError::InvalidSideEffectTransition);
        }
        if self.side_effect.requires_independent_confirmation()
            && !side_effect.requires_independent_confirmation()
        {
            return Err(BrowserRuntimeError::InvalidSideEffectTransition);
        }
        self.side_effect = side_effect;
        Ok(())
    }

    pub(crate) fn request_takeover(&mut self) -> Result<(), BrowserRuntimeError> {
        self.require_state(BrowserSessionState::SoftwareControlled)?;
        self.state = BrowserSessionState::TakeoverPending;
        Ok(())
    }

    /// Invalidates the active execution while the same Host serialization is held, then
    /// advances local generations before user control can become observable.
    pub(crate) fn complete_takeover<E>(
        &mut self,
        invalidate_execution: impl FnOnce() -> Result<(), E>,
    ) -> Result<BrowserSessionState, BrowserRuntimeError> {
        self.require_state(BrowserSessionState::TakeoverPending)?;
        if invalidate_execution().is_err() {
            self.invalidate();
            return Err(BrowserRuntimeError::ExecutionInvalidationFailed);
        }
        if !self.sequence.try_advance() {
            self.invalidate();
            return Err(BrowserRuntimeError::GenerationOverflow);
        }
        self.navigation_generation =
            self.navigation_generation.checked_add(1).ok_or_else(|| {
                self.invalidate();
                BrowserRuntimeError::GenerationOverflow
            })?;
        self.state = if self.side_effect.requires_independent_confirmation() {
            BrowserSessionState::OutcomeUnknown
        } else {
            BrowserSessionState::UserControlled
        };
        Ok(self.state)
    }

    pub(crate) fn record_independent_confirmation(&mut self) -> Result<(), BrowserRuntimeError> {
        self.require_state(BrowserSessionState::OutcomeUnknown)?;
        self.side_effect = SideEffectState::NotDispatched;
        self.state = BrowserSessionState::UserControlled;
        self.sequence.advance();
        Ok(())
    }

    pub(crate) fn complete_software_control(&mut self) -> Result<(), BrowserRuntimeError> {
        self.require_state(BrowserSessionState::SoftwareControlled)?;
        // This method represents a clean, authenticated adapter completion. A dispatched write
        // becomes unknown only when takeover or failure loses its result, never merely because it
        // crossed the dispatch boundary.
        self.side_effect = SideEffectState::NotDispatched;
        self.state = BrowserSessionState::UserControlled;
        self.sequence.advance();
        Ok(())
    }

    pub(crate) fn record_software_failure(
        &mut self,
        result_may_be_lost: bool,
    ) -> Result<BrowserSessionState, BrowserRuntimeError> {
        self.require_state(BrowserSessionState::SoftwareControlled)?;
        self.state = if result_may_be_lost || self.side_effect.requires_independent_confirmation() {
            BrowserSessionState::OutcomeUnknown
        } else {
            BrowserSessionState::Failed
        };
        self.sequence.advance();
        Ok(self.state)
    }

    pub(crate) fn close<A: EngineAdapter>(
        mut self,
        adapter: &mut A,
    ) -> Result<(), BrowserRuntimeError> {
        if !matches!(
            self.state,
            BrowserSessionState::Prepared
                | BrowserSessionState::UserControlled
                | BrowserSessionState::OutcomeUnknown
                | BrowserSessionState::Failed
        ) {
            return Err(BrowserRuntimeError::InvalidState);
        }
        if let Some(lease) = self.context.take() {
            let private = self.key.persistence() == SessionPersistence::Private;
            adapter.close_context(lease, private);
        }
        self.state = BrowserSessionState::Closed;
        self.sequence.advance();
        Ok(())
    }

    pub(crate) fn request_download(&mut self) -> DownloadDecision {
        self.invalidate();
        decide_download()
    }

    pub(crate) fn request_file_chooser(&mut self) -> UploadDecision {
        self.invalidate();
        decide_file_chooser()
    }

    pub(crate) fn request_popup(&mut self) -> PopupDecision {
        self.invalidate();
        decide_popup()
    }

    pub(crate) fn request_permission(
        &mut self,
        permission: BrowserPermission,
    ) -> PermissionDecision {
        self.invalidate();
        decide_permission(permission)
    }

    pub(crate) fn observe_engine_event(
        &mut self,
        event: &[u8],
    ) -> Result<EngineObservation, BrowserRuntimeError> {
        if event.is_empty() || event.len() > MAX_ENGINE_EVENT_BYTES {
            self.invalidate();
            return Err(BrowserRuntimeError::InvalidObservation);
        }
        let observation = match event {
            b"navigation_committed" => EngineObservation::NavigationCommitted,
            b"engine_crashed" => EngineObservation::EngineCrashed,
            _ => {
                self.invalidate();
                return Err(BrowserRuntimeError::InvalidObservation);
            }
        };
        self.sequence.advance();
        if observation == EngineObservation::EngineCrashed {
            self.context.take();
            self.state = BrowserSessionState::Failed;
        }
        Ok(observation)
    }

    pub(crate) fn advance_profile_generation(&mut self) {
        self.profile_generation.advance();
        self.invalidate();
    }

    pub(crate) fn advance_navigation_generation(&mut self) {
        self.navigation_generation = self.navigation_generation.saturating_add(1);
        self.invalidate();
    }

    pub(crate) fn advance_app_boot(&mut self) {
        self.app_boot_generation = self.app_boot_generation.saturating_add(1);
        self.context.take();
        self.invalidate();
    }

    fn require_state(&self, expected: BrowserSessionState) -> Result<(), BrowserRuntimeError> {
        if self.state == expected {
            Ok(())
        } else {
            Err(BrowserRuntimeError::InvalidState)
        }
    }

    fn invalidate(&mut self) {
        self.state = BrowserSessionState::Failed;
        self.sequence.advance();
    }

    #[cfg(test)]
    fn child_context_plan(&self) -> Result<ChildContextPlan, BrowserRuntimeError> {
        let lease = self
            .context
            .as_ref()
            .ok_or(BrowserRuntimeError::InvalidState)?;
        Ok(ChildContextPlan {
            profile: lease.profile().clone(),
            context_id: lease.context_id(),
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum EngineObservation {
    NavigationCommitted,
    EngineCrashed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum BrowserRuntimeError {
    InvalidState,
    InvalidSideEffectTransition,
    ExecutionInvalidationFailed,
    GenerationOverflow,
    NavigationDenied,
    InvalidObservation,
    EngineUnavailable,
    ContextOccupied,
    EngineFailure,
}

/// Private, single-use proof that the future Host composition exchanged a new mode-correct
/// ticket. It is intentionally neither Clone nor serializable and cannot be supplied by UI/IPC.
#[derive(Debug)]
pub(crate) struct FreshAutomationPermit(());

impl FreshAutomationPermit {
    #[cfg(test)]
    const fn fixture() -> Self {
        Self(())
    }
}

impl From<BrowserEngineError> for BrowserRuntimeError {
    fn from(value: BrowserEngineError) -> Self {
        match value {
            BrowserEngineError::Unavailable => Self::EngineUnavailable,
            BrowserEngineError::ContextOccupied => Self::ContextOccupied,
            BrowserEngineError::AdapterFailure => Self::EngineFailure,
        }
    }
}

fn terminal_adapter_error(error: BrowserEngineError) -> BrowserRuntimeError {
    match error {
        BrowserEngineError::Unavailable => BrowserRuntimeError::EngineUnavailable,
        BrowserEngineError::ContextOccupied | BrowserEngineError::AdapterFailure => {
            BrowserRuntimeError::EngineFailure
        }
    }
}

#[cfg(test)]
#[derive(Debug, PartialEq, Eq)]
struct ChildContextPlan {
    profile: ProfileId,
    context_id: u64,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::{TestAdapter, open_production_engine};
    use crate::permission_policy::BrowserPermission;
    use crate::profile::{ActiveProfileIdentity, ProfileAuthorityScope};
    use std::cell::Cell;

    fn key(persistence: SessionPersistence) -> ProfileKey {
        ProfileKey::host_created(
            ProfileAuthorityScope::Active(
                ActiveProfileIdentity::host_created("device-a", "connection-a").unwrap(),
            ),
            persistence,
        )
    }

    fn prepared(persistence: SessionPersistence, registry: &mut ProfileRegistry) -> BrowserRuntime {
        BrowserRuntime::prepare(
            SessionId::host_created(1),
            key(persistence),
            registry,
            NavigationPolicy::host_created(&["https://spaceship.com"]).unwrap(),
        )
    }

    #[test]
    fn production_factory_is_unavailable_before_resource_creation() {
        let calls = Cell::new(0);
        let result = open_production_engine(|| calls.set(calls.get() + 1));
        assert_eq!(result, Err(BrowserEngineError::Unavailable));
        assert_eq!(calls.get(), 0);
        assert_eq!(
            crate::browser_engine_availability(),
            crate::BrowserEngineAvailability::Unavailable
        );
    }

    #[test]
    fn navigation_policy_rejects_before_any_engine_resource() {
        let mut registry = ProfileRegistry::default();
        let mut runtime = prepared(SessionPersistence::Persistent, &mut registry);
        let mut adapter = TestAdapter::default();
        assert_eq!(
            runtime.start("https://evilspaceship.com", &mut adapter),
            Err(BrowserRuntimeError::NavigationDenied)
        );
        assert_eq!(adapter.resource_calls(), 0);
    }

    #[test]
    fn one_logical_context_occupies_a_profile_and_child_cannot_change_it() {
        let mut registry = ProfileRegistry::default();
        let mut first = prepared(SessionPersistence::Persistent, &mut registry);
        let mut second = prepared(SessionPersistence::Persistent, &mut registry);
        let mut adapter = TestAdapter::default();
        first.start("https://spaceship.com", &mut adapter).unwrap();
        let before = adapter.resource_calls();
        assert_eq!(
            second.start("https://spaceship.com", &mut adapter),
            Err(BrowserRuntimeError::ContextOccupied)
        );
        assert_eq!(adapter.resource_calls(), before);
        let child = first.child_context_plan().unwrap();
        assert_eq!(child.profile, first.profile_id);
        assert_eq!(
            child.context_id,
            first.context.as_ref().unwrap().context_id()
        );
        assert_eq!(adapter.resource_calls(), before);
        first.close(&mut adapter).unwrap();
        second.start("https://spaceship.com", &mut adapter).unwrap();
    }

    #[test]
    fn takeover_before_step_admission_invalidates_before_user_control_without_adapter_calls() {
        let mut registry = ProfileRegistry::default();
        let mut runtime = prepared(SessionPersistence::Persistent, &mut registry);
        let mut adapter = TestAdapter::default();
        runtime
            .start("https://spaceship.com", &mut adapter)
            .unwrap();
        runtime
            .begin_software_control(FreshAutomationPermit::fixture())
            .unwrap();
        runtime.request_takeover().unwrap();
        let resources = adapter.resource_calls();
        let sequence = runtime.sequence.value();
        let navigation_generation = runtime.navigation_generation;
        let invalidated = Cell::new(false);
        assert_eq!(
            runtime.complete_takeover(|| {
                invalidated.set(true);
                Ok::<(), ()>(())
            }),
            Ok(BrowserSessionState::UserControlled)
        );
        assert!(invalidated.get());
        assert!(runtime.sequence.value() > sequence);
        assert_eq!(
            runtime.navigation_generation,
            navigation_generation + 1,
            "takeover must invalidate old navigation/control authority"
        );
        assert_eq!(adapter.resource_calls(), resources);
    }

    #[test]
    fn takeover_after_dispatched_write_requires_independent_confirmation_and_fresh_permit() {
        let mut registry = ProfileRegistry::default();
        let mut runtime = prepared(SessionPersistence::Persistent, &mut registry);
        let mut adapter = TestAdapter::default();
        runtime
            .start("https://spaceship.com", &mut adapter)
            .unwrap();
        runtime
            .begin_software_control(FreshAutomationPermit::fixture())
            .unwrap();
        runtime
            .record_dispatched_side_effect(SideEffectState::WriteDispatched)
            .unwrap();
        runtime.request_takeover().unwrap();
        let resources = adapter.resource_calls();
        assert_eq!(
            runtime.complete_takeover(|| Ok::<(), ()>(())),
            Ok(BrowserSessionState::OutcomeUnknown)
        );
        assert_eq!(
            runtime.begin_software_control(FreshAutomationPermit::fixture()),
            Err(BrowserRuntimeError::InvalidState),
            "an old execution can never be resumed while its outcome is unknown"
        );
        assert_eq!(adapter.resource_calls(), resources);

        runtime.record_independent_confirmation().unwrap();
        runtime
            .begin_software_control(FreshAutomationPermit::fixture())
            .unwrap();
        assert_eq!(runtime.state, BrowserSessionState::SoftwareControlled);
    }

    #[test]
    fn clean_ticket_completion_returns_control_without_false_outcome_unknown() {
        let mut registry = ProfileRegistry::default();
        let mut runtime = prepared(SessionPersistence::Persistent, &mut registry);
        let mut adapter = TestAdapter::default();
        runtime
            .start("https://spaceship.com", &mut adapter)
            .unwrap();
        runtime
            .begin_software_control(FreshAutomationPermit::fixture())
            .unwrap();
        runtime
            .record_dispatched_side_effect(SideEffectState::WriteDispatched)
            .unwrap();
        runtime.complete_software_control().unwrap();
        assert_eq!(runtime.state, BrowserSessionState::UserControlled);
        assert_eq!(runtime.side_effect, SideEffectState::NotDispatched);
    }

    #[test]
    fn takeover_invalidation_failure_never_exposes_user_control() {
        let mut registry = ProfileRegistry::default();
        let mut runtime = prepared(SessionPersistence::Persistent, &mut registry);
        let mut adapter = TestAdapter::default();
        runtime
            .start("https://spaceship.com", &mut adapter)
            .unwrap();
        runtime
            .begin_software_control(FreshAutomationPermit::fixture())
            .unwrap();
        runtime.request_takeover().unwrap();
        let resources = adapter.resource_calls();
        assert_eq!(
            runtime.complete_takeover(|| Err::<(), ()>(())),
            Err(BrowserRuntimeError::ExecutionInvalidationFailed)
        );
        assert_eq!(runtime.state, BrowserSessionState::Failed);
        assert_eq!(
            runtime.navigate("https://spaceship.com/account", &mut adapter),
            Err(BrowserRuntimeError::InvalidState)
        );
        assert_eq!(adapter.resource_calls(), resources);
    }

    #[test]
    fn dispatched_write_and_lost_result_are_monotonic_outcome_unknown_states() {
        for dispatched in [
            SideEffectState::WriteDispatched,
            SideEffectState::ResultLost,
        ] {
            let mut registry = ProfileRegistry::default();
            let mut runtime = prepared(SessionPersistence::Persistent, &mut registry);
            let mut adapter = TestAdapter::default();
            runtime
                .start("https://spaceship.com", &mut adapter)
                .unwrap();
            runtime
                .begin_software_control(FreshAutomationPermit::fixture())
                .unwrap();
            runtime.record_dispatched_side_effect(dispatched).unwrap();
            assert_eq!(
                runtime.record_dispatched_side_effect(SideEffectState::ReadDispatched),
                Err(BrowserRuntimeError::InvalidSideEffectTransition)
            );
            assert_eq!(
                runtime.record_software_failure(false),
                Ok(BrowserSessionState::OutcomeUnknown)
            );
        }
    }

    #[test]
    fn profile_and_boot_advance_reject_before_later_resources() {
        for advance in [
            BrowserRuntime::advance_profile_generation as fn(&mut BrowserRuntime),
            BrowserRuntime::advance_app_boot,
        ] {
            let mut registry = ProfileRegistry::default();
            let mut runtime = prepared(SessionPersistence::Persistent, &mut registry);
            let mut adapter = TestAdapter::default();
            runtime
                .start("https://spaceship.com", &mut adapter)
                .unwrap();
            let resources = adapter.resource_calls();
            advance(&mut runtime);
            assert_eq!(
                runtime.navigate("https://spaceship.com/account", &mut adapter),
                Err(BrowserRuntimeError::InvalidState)
            );
            assert_eq!(adapter.resource_calls(), resources);
        }
    }

    #[test]
    fn download_upload_popup_and_every_permission_default_deny_without_adapter_calls() {
        let mut registry = ProfileRegistry::default();
        for permission in BrowserPermission::ALL {
            let mut runtime = prepared(SessionPersistence::Private, &mut registry);
            let adapter = TestAdapter::default();
            assert_eq!(
                runtime.request_permission(permission),
                PermissionDecision::Deny
            );
            assert_eq!(adapter.resource_calls(), 0);
        }
        let mut download = prepared(SessionPersistence::Private, &mut registry);
        let mut upload = prepared(SessionPersistence::Private, &mut registry);
        let mut popup = prepared(SessionPersistence::Private, &mut registry);
        let adapter = TestAdapter::default();
        assert_eq!(download.request_download(), DownloadDecision::Deny);
        assert_eq!(upload.request_file_chooser(), UploadDecision::Unavailable);
        assert_eq!(popup.request_popup(), PopupDecision::Deny);
        assert_eq!(adapter.resource_calls(), 0);
    }

    #[test]
    fn private_close_records_cleanup_while_persistent_close_preserves_partition() {
        let mut registry = ProfileRegistry::default();
        let mut private = prepared(SessionPersistence::Private, &mut registry);
        let mut persistent = prepared(SessionPersistence::Persistent, &mut registry);
        let mut adapter = TestAdapter::default();
        private
            .start("https://spaceship.com", &mut adapter)
            .unwrap();
        private.close(&mut adapter).unwrap();
        assert_eq!(adapter.cleanup_observed(), 1);
        persistent
            .start("https://spaceship.com", &mut adapter)
            .unwrap();
        persistent.close(&mut adapter).unwrap();
        assert_eq!(adapter.cleanup_observed(), 1);
    }

    #[test]
    fn bounded_unknown_engine_event_terminates_without_claiming_success() {
        let mut registry = ProfileRegistry::default();
        let mut runtime = prepared(SessionPersistence::Persistent, &mut registry);
        let mut adapter = TestAdapter::default();
        runtime
            .start("https://spaceship.com", &mut adapter)
            .unwrap();
        let resources = adapter.resource_calls();
        assert_eq!(
            runtime.observe_engine_event(br#"{"success":true}"#),
            Err(BrowserRuntimeError::InvalidObservation)
        );
        assert_eq!(adapter.resource_calls(), resources);
        assert_eq!(
            runtime.navigate("https://spaceship.com", &mut adapter),
            Err(BrowserRuntimeError::InvalidState)
        );

        let mut oversized = prepared(SessionPersistence::Persistent, &mut registry);
        assert_eq!(
            oversized.observe_engine_event(&vec![b'a'; MAX_ENGINE_EVENT_BYTES + 1]),
            Err(BrowserRuntimeError::InvalidObservation)
        );
    }

    #[test]
    fn engine_crash_invalidates_before_later_adapter_calls() {
        let mut registry = ProfileRegistry::default();
        let mut runtime = prepared(SessionPersistence::Persistent, &mut registry);
        let mut adapter = TestAdapter::default();
        runtime
            .start("https://spaceship.com", &mut adapter)
            .unwrap();
        let resources = adapter.resource_calls();
        assert_eq!(
            runtime.observe_engine_event(b"engine_crashed"),
            Ok(EngineObservation::EngineCrashed)
        );
        assert_eq!(
            runtime.navigate("https://spaceship.com", &mut adapter),
            Err(BrowserRuntimeError::InvalidState)
        );
        assert_eq!(adapter.resource_calls(), resources);
    }

    #[test]
    fn start_adapter_failures_terminate_and_preserve_lease_for_explicit_close() {
        let mut registry = ProfileRegistry::default();
        let mut open_failure = prepared(SessionPersistence::Private, &mut registry);
        let mut open_adapter = TestAdapter::default();
        open_adapter.fail_next_open_context();
        assert_eq!(
            open_failure.start("https://spaceship.com", &mut open_adapter),
            Err(BrowserRuntimeError::EngineFailure)
        );
        let resources = open_adapter.resource_calls();
        assert_eq!(
            open_failure.start("https://spaceship.com", &mut open_adapter),
            Err(BrowserRuntimeError::InvalidState)
        );
        assert_eq!(open_adapter.resource_calls(), resources);

        let mut registry = ProfileRegistry::default();
        let mut runtime = prepared(SessionPersistence::Private, &mut registry);
        let mut adapter = TestAdapter::default();
        adapter.fail_next_navigation();
        assert_eq!(
            runtime.start("https://spaceship.com", &mut adapter),
            Err(BrowserRuntimeError::EngineFailure)
        );
        let resources = adapter.resource_calls();
        assert_eq!(
            runtime.navigate("https://spaceship.com", &mut adapter),
            Err(BrowserRuntimeError::InvalidState)
        );
        assert_eq!(adapter.resource_calls(), resources);
        runtime.close(&mut adapter).unwrap();
        assert_eq!(adapter.cleanup_observed(), 1);
    }

    #[test]
    fn later_navigation_adapter_failure_terminates_before_subsequent_resources() {
        let mut registry = ProfileRegistry::default();
        let mut runtime = prepared(SessionPersistence::Persistent, &mut registry);
        let mut adapter = TestAdapter::default();
        runtime
            .start("https://spaceship.com", &mut adapter)
            .unwrap();
        adapter.fail_next_navigation();
        assert_eq!(
            runtime.navigate("https://spaceship.com/account", &mut adapter),
            Err(BrowserRuntimeError::EngineFailure)
        );
        let resources = adapter.resource_calls();
        assert_eq!(
            runtime.navigate("https://spaceship.com/portfolio", &mut adapter),
            Err(BrowserRuntimeError::InvalidState)
        );
        assert_eq!(adapter.resource_calls(), resources);
    }

    #[test]
    fn portable_browser_runtime_foundation_evidence() {
        println!(
            "GD_WP3_NATIVE_RUNTIME_FOUNDATION_EVIDENCE={}",
            serde_json::json!({
                "portableContract": true,
                "engineInstantiated": false,
                "logicalPartitionOnly": true,
                "nativeProcessIsolationObserved": false,
                "productionFactoryDenying": true,
                "policyBeforeResource": true,
                "callerAuthorityAccepted": false,
                "controlLifecycle": [
                    "prepared",
                    "user_controlled",
                    "software_controlled",
                    "takeover_pending",
                    "outcome_unknown",
                    "closed",
                    "failed"
                ],
                "takeoverInvalidatesBeforeUserControl": true,
                "dispatchedWriteRequiresIndependentConfirmation": true,
                "oldTicketResumeAvailable": false,
                "sessionAxes": ["authority_scope", "persistence"],
                "permissionCategoriesDenied": BrowserPermission::ALL.len(),
                "signedApplication": false,
                "productionComposition": false,
                "closesGate": false
            })
        );
    }
}
