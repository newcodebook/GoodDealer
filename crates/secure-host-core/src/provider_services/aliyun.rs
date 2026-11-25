//! The private 阿里云 (Alibaba Cloud) registrar and marketplace Service (ADR-0027).
//! Its Native transport is `crate::aliyun` (official signed registrar API); this module holds only the Service manifest.
//!
//! `IMPLEMENTED` must equal the protocol manifest's locally implemented capabilities for this
//! platform; the protocol test `domain-provider-host-mirror.test.ts` holds the two together.

use super::{PlatformService, ProviderCapability};

pub(super) struct AliyunService;

impl PlatformService for AliyunService {
    const IMPLEMENTED: &'static [ProviderCapability] =
        &[ProviderCapability::RegistrarDomainObserve];
}
