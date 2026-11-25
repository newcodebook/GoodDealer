//! The private Atom marketplace Service (ADR-0027).
//! Its Native transport is `crate::atom` (official Seller API; the token travels in the query string, so URLs never leave that module); this module holds only the Service manifest.
//!
//! `IMPLEMENTED` must equal the protocol manifest's locally implemented capabilities for this
//! platform; the protocol test `domain-provider-host-mirror.test.ts` holds the two together.

use super::{PlatformService, ProviderCapability};

pub(super) struct AtomService;

impl PlatformService for AtomService {
    const IMPLEMENTED: &'static [ProviderCapability] =
        &[ProviderCapability::MarketplaceListingObserve];
}
