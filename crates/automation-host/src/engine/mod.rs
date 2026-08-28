//! Sealed platform adapter seam. No downstream crate can implement or inject it.

mod denying;
mod webview2;
mod wkwebview;

#[cfg(test)]
mod test_adapter;

use crate::BrowserEngineAvailability;
use crate::profile::ProfileId;

mod sealed {
    pub trait Sealed {}
}

pub(crate) trait EngineAdapter: sealed::Sealed {
    fn open_context(
        &mut self,
        profile: &ProfileId,
    ) -> Result<EngineContextLease, BrowserEngineError>;
    fn navigate(&mut self, lease: &EngineContextLease) -> Result<(), BrowserEngineError>;
    fn close_context(&mut self, lease: EngineContextLease, private: bool);
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct EngineContextLease {
    profile: ProfileId,
    context_id: u64,
}

impl EngineContextLease {
    pub(crate) fn profile(&self) -> &ProfileId {
        &self.profile
    }

    #[cfg(test)]
    pub(crate) const fn context_id(&self) -> u64 {
        self.context_id
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum BrowserEngineError {
    Unavailable,
    ContextOccupied,
    AdapterFailure,
}

pub(crate) const fn production_availability() -> BrowserEngineAvailability {
    let _ = webview2::TARGET;
    let _ = wkwebview::TARGET;
    BrowserEngineAvailability::Unavailable
}

pub(crate) fn open_production_engine<T>(
    resource: impl FnOnce() -> T,
) -> Result<T, BrowserEngineError> {
    denying::open(resource)
}

#[cfg(test)]
pub(crate) use test_adapter::TestAdapter;
