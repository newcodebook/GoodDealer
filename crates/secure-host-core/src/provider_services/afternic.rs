//! The private Afternic marketplace Service (ADR-0027).
//! Its Native transport is `crate::afternic_provider` (official seller API, composed under its controlled-acceptance gate); this module holds only the Service manifest.
//!
//! `IMPLEMENTED` must equal the protocol manifest's locally implemented capabilities for this
//! platform; the protocol test `domain-provider-host-mirror.test.ts` holds the two together.

use super::{PlatformService, ProviderCapability};

pub(super) struct AfternicService;

impl PlatformService for AfternicService {
    const IMPLEMENTED: &'static [ProviderCapability] = &[];
}
