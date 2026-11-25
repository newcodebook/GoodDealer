//! The private `GoDaddy` registrar Service (ADR-0027).
//! Its Native transport is `crate::godaddy` (official registrar API); this module holds only the Service manifest.
//!
//! `IMPLEMENTED` must equal the protocol manifest's locally implemented capabilities for this
//! platform; the protocol test `domain-provider-host-mirror.test.ts` holds the two together.

use super::{PlatformService, ProviderCapability};

pub(super) struct GodaddyService;

impl PlatformService for GodaddyService {
    const IMPLEMENTED: &'static [ProviderCapability] =
        &[ProviderCapability::RegistrarDomainObserve];
}
