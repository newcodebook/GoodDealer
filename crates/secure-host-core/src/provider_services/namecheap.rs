//! The private Namecheap registrar and marketplace Service (ADR-0027).
//! No Native transport exists yet: every capability waits on this platform's facts in
//! `docs/PROVIDER_API_REVIEW.md`, so this module holds only the Service manifest.
//!
//! `IMPLEMENTED` must equal the protocol manifest's locally implemented capabilities for this
//! platform; the protocol test `domain-provider-host-mirror.test.ts` holds the two together.

use super::{PlatformService, ProviderCapability};

pub(super) struct NamecheapService;

impl PlatformService for NamecheapService {
    const IMPLEMENTED: &'static [ProviderCapability] = &[];
}
