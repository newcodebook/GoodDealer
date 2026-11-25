//! The private Spaceship registrar and `SellerHub` marketplace Service (ADR-0027).
//! Its Native transport is `crate::spaceship` (official API); this module holds only the Service manifest.
//!
//! `IMPLEMENTED` must equal the protocol manifest's locally implemented capabilities for this
//! platform; the protocol test `domain-provider-host-mirror.test.ts` holds the two together.

use super::{PlatformService, ProviderCapability};

pub(super) struct SpaceshipService;

impl PlatformService for SpaceshipService {
    const IMPLEMENTED: &'static [ProviderCapability] = &[
        ProviderCapability::RegistrarDomainObserve,
        ProviderCapability::MarketplaceListingObserve,
        ProviderCapability::MarketplacePriceManage,
    ];
}
