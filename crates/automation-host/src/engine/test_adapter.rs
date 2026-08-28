use std::collections::HashSet;

use super::{BrowserEngineError, EngineAdapter, EngineContextLease, sealed};
use crate::profile::ProfileId;

#[derive(Debug, Default)]
pub(crate) struct TestAdapter {
    occupied: HashSet<ProfileId>,
    next_context_id: u64,
    resource_calls: usize,
    cleanup_observed: usize,
    fail_next_open_context: bool,
    fail_next_navigation: bool,
}

impl sealed::Sealed for TestAdapter {}

impl EngineAdapter for TestAdapter {
    fn open_context(
        &mut self,
        profile: &ProfileId,
    ) -> Result<EngineContextLease, BrowserEngineError> {
        if std::mem::take(&mut self.fail_next_open_context) {
            self.resource_calls += 1;
            return Err(BrowserEngineError::AdapterFailure);
        }
        if !self.occupied.insert(profile.clone()) {
            return Err(BrowserEngineError::ContextOccupied);
        }
        self.resource_calls += 1;
        self.next_context_id = self.next_context_id.saturating_add(1);
        Ok(EngineContextLease {
            profile: profile.clone(),
            context_id: self.next_context_id,
        })
    }

    fn navigate(&mut self, _lease: &EngineContextLease) -> Result<(), BrowserEngineError> {
        self.resource_calls += 1;
        if std::mem::take(&mut self.fail_next_navigation) {
            return Err(BrowserEngineError::AdapterFailure);
        }
        Ok(())
    }

    fn close_context(&mut self, lease: EngineContextLease, private: bool) {
        self.resource_calls += 1;
        self.occupied.remove(&lease.profile);
        if private {
            self.cleanup_observed += 1;
        }
    }
}

impl TestAdapter {
    pub(crate) const fn resource_calls(&self) -> usize {
        self.resource_calls
    }

    pub(crate) const fn cleanup_observed(&self) -> usize {
        self.cleanup_observed
    }

    pub(crate) fn fail_next_open_context(&mut self) {
        self.fail_next_open_context = true;
    }

    pub(crate) fn fail_next_navigation(&mut self) {
        self.fail_next_navigation = true;
    }
}
