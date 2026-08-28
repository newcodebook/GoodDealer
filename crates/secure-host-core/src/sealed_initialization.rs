//! The sole sealed Core construction boundary.
//!
//! It deliberately has no public parameters, selector, feature, environment lookup, adapter, or
//! provider seam. Until a later, independently qualified native composition owns activation, this
//! boundary always returns concrete denying state and performs no keychain or network work.

use crate::sealed_host_state::SealedHostState;

pub(super) fn initialize_native_secure_host() -> SealedHostState {
    SealedHostState::concrete_denying()
}
