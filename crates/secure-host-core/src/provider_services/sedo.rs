//! The private Sedo marketplace Service (ADR-0027).
//! Its Native transport is `crate::sedo` (official seller API); this module holds only the Service manifest.
//!
//! `IMPLEMENTED` must equal the protocol manifest's locally implemented capabilities for this
//! platform; the protocol test `domain-provider-host-mirror.test.ts` holds the two together.

use super::{PlatformService, ProviderCapability};

pub(super) struct SedoService;

impl PlatformService for SedoService {
    const IMPLEMENTED: &'static [ProviderCapability] =
        &[ProviderCapability::MarketplaceListingObserve];
}
