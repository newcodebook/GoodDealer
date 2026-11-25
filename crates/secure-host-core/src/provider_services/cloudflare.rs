//! The private Cloudflare Registrar and DNS Service (ADR-0027).
//! Its Native transport is `crate::cloudflare_provider` (Zone/DNS) and `crate::cloudflare_registrar`; this module holds only the Service manifest.
//!
//! `IMPLEMENTED` must equal the protocol manifest's locally implemented capabilities for this
//! platform; the protocol test `domain-provider-host-mirror.test.ts` holds the two together.

use super::{PlatformService, ProviderCapability};

pub(super) struct CloudflareService;

impl PlatformService for CloudflareService {
    const IMPLEMENTED: &'static [ProviderCapability] = &[
        ProviderCapability::RegistrarDomainObserve,
        ProviderCapability::ZoneObserve,
        ProviderCapability::DnsRecordsObserve,
    ];
}
