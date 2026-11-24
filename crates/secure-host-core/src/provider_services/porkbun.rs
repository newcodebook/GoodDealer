//! The private Porkbun registrar and marketplace Service (ADR-0027).
//! Its Native transport is `crate::porkbun` (official API v3, account inventory only); this module
//! holds only the Service manifest.
//!
//! `IMPLEMENTED` must equal the protocol manifest's locally implemented capabilities for this
//! platform; the protocol test `domain-provider-host-mirror.test.ts` holds the two together.

use super::{PlatformService, ProviderCapability};

pub(super) struct PorkbunService;

impl PlatformService for PorkbunService {
    const IMPLEMENTED: &'static [ProviderCapability] =
        &[ProviderCapability::RegistrarDomainObserve];
}
