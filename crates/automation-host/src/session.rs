//! Host-owned browser session lifecycle vocabulary.
//!
//! No wire parser exists here: runtime mode, Lease Epoch, trusted time, device
//! authority, grants, and generations are owned by Secure Host and cannot be
//! supplied by a page or TypeScript caller.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum BrowserSessionState {
    Prepared,
    UserControlled,
    SoftwareControlled,
    TakeoverPending,
    OutcomeUnknown,
    Closed,
    Failed,
}

/// Whether an automation action crossed the point where the external system may have observed it.
///
/// This is Host-owned execution state, not a page report. In particular, a dispatched write can
/// never be downgraded to `NotDispatched` merely because its result was lost.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SideEffectState {
    NotDispatched,
    ReadDispatched,
    WriteDispatched,
    ResultLost,
}

impl SideEffectState {
    pub(crate) const fn requires_independent_confirmation(self) -> bool {
        matches!(self, Self::WriteDispatched | Self::ResultLost)
    }
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct SessionId(u64);

impl SessionId {
    pub(crate) const fn host_created(value: u64) -> Self {
        Self(value)
    }

    pub(crate) const fn value(&self) -> u64 {
        self.0
    }
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct SessionSequence(u64);

impl SessionSequence {
    pub(crate) const fn initial() -> Self {
        Self(1)
    }

    pub(crate) fn advance(&mut self) {
        self.0 = self.0.saturating_add(1);
    }

    pub(crate) fn try_advance(&mut self) -> bool {
        let Some(next) = self.0.checked_add(1) else {
            return false;
        };
        self.0 = next;
        true
    }

    #[cfg(test)]
    pub(crate) const fn value(&self) -> u64 {
        self.0
    }
}
