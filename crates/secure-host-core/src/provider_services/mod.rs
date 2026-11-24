//! ADR-0027 "平台 Service 骨架": one private Service per launch platform behind one admission entry.
//!
//! Each platform's Service owns that platform's endpoints, wire parsing, authentication and
//! network authority, reachable only through [`admit_provider_capability`]; nothing here is a
//! generic Provider proxy. Where a platform already has a Native transport (for example
//! `crate::atom`, `crate::sedo`), its Service module names it; the four platforms without one
//! (Dynadot, 易名, Namecheap, 22.cn) have only their manifest.
//!
//! The skeleton admits nothing. [`ProviderAdmission`] has no value, so `admit_provider_capability`
//! cannot return `Ok` and no caller can hold an admission until a reviewed change adds an
//! executable manifest state. That change must also take the Host qualification register's verdict
//! (`local-storage`'s `capability_qualification`) as an input here, so a Service and the register
//! must both agree before a capability runs (ADR-0024).
//!
//! Temporary exception (ADR-0027 "平台 Service 骨架"): the implemented platform transports
//! (Cloudflare Zone/DNS and Registrar observation, Spaceship, 阿里云, `GoDaddy`, Porkbun, Atom, Sedo
//! and Afternic) are composed directly by Desktop under their own qualification or
//! controlled-acceptance gates, not through this admission. Each moves behind
//! `admit_provider_capability` in the change that makes an admission constructible; until then
//! this skeleton describes them but does not gate them.
//!
//! The catalog and the platforms mirror `@gooddealer/protocol/domain-providers`; the protocol
//! test `domain-provider-host-mirror.test.ts` pins ids, roles, effects, platforms and every
//! Service's implemented list to it.

mod afternic;
mod aliyun;
mod atom;
mod cloudflare;
mod dynadot;
mod ename;
mod godaddy;
mod namecheap;
mod porkbun;
mod sedo;
mod spaceship;
mod twenty_two_cn;

/// ADR-0027's twelve launch platforms, in the protocol's order. No other platform has a Service.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ProviderPlatform {
    TwentyTwoCn,
    Afternic,
    Aliyun,
    Atom,
    Cloudflare,
    Dynadot,
    Ename,
    Godaddy,
    Namecheap,
    Porkbun,
    Sedo,
    Spaceship,
}

impl ProviderPlatform {
    /// Every launch platform, in the protocol's order.
    pub(crate) const ALL: [Self; 12] = [
        Self::TwentyTwoCn,
        Self::Afternic,
        Self::Aliyun,
        Self::Atom,
        Self::Cloudflare,
        Self::Dynadot,
        Self::Ename,
        Self::Godaddy,
        Self::Namecheap,
        Self::Porkbun,
        Self::Sedo,
        Self::Spaceship,
    ];

    /// The protocol's platform kind.
    #[must_use]
    pub(crate) fn kind(self) -> &'static str {
        match self {
            Self::TwentyTwoCn => "22cn",
            Self::Afternic => "afternic",
            Self::Aliyun => "aliyun",
            Self::Atom => "atom",
            Self::Cloudflare => "cloudflare",
            Self::Dynadot => "dynadot",
            Self::Ename => "ename",
            Self::Godaddy => "godaddy",
            Self::Namecheap => "namecheap",
            Self::Porkbun => "porkbun",
            Self::Sedo => "sedo",
            Self::Spaceship => "spaceship",
        }
    }
}

/// The four platform roles a connection may declare (ADR-0027 section 3).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ProviderRole {
    Registrar,
    Dns,
    Marketplace,
    Acquisition,
}

/// What running a capability does. Every financial capability needs the user's per-item
/// confirmation of a Host quote (ADR-0024, ADR-0027 section 7); no standing authorisation replaces it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ProviderEffect {
    Read,
    Write,
    Financial,
}

/// Every catalog capability that has a role. `connection.manage` is the Host's local credential
/// management, has no role, and is never admitted through a platform Service.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ProviderCapability {
    RegistrarDomainObserve,
    RegistrarRegister,
    RegistrarRenew,
    RegistrarRestore,
    RegistrarTransferIn,
    RegistrarTransferOut,
    RegistrarAuthCodeRequest,
    RegistrarLockManage,
    RegistrarAutoRenewManage,
    RegistrarContactManage,
    RegistrarPrivacyManage,
    NameserversManage,
    RegistrarGlueManage,
    RegistrarMonitor,
    ZoneObserve,
    DnsRecordsObserve,
    DnsRecordsManage,
    DnssecManage,
    DnsMonitor,
    MarketplaceListingObserve,
    MarketplaceListingManage,
    MarketplacePriceManage,
    MarketplaceSalesObserve,
    MarketplaceSaleAuthCodeDeliver,
    MarketplaceOwnershipVerify,
    MarketplaceMonitor,
    AcquisitionSearch,
    AcquisitionOfferObserve,
    AcquisitionBid,
    AcquisitionBackorder,
    AcquisitionPurchase,
    AcquisitionArrivalReconcile,
    AcquisitionMonitor,
}

use ProviderCapability as C;
use ProviderEffect::{Financial, Read, Write};
use ProviderRole::{Acquisition, Dns, Marketplace, Registrar};

/// The number of `ProviderCapability` variants. The match is exhaustive, so adding a variant
/// without listing it here (and so without lengthening the catalog to match) fails to compile.
const VARIANT_COUNT: usize = match ProviderCapability::AcquisitionMonitor {
    C::RegistrarDomainObserve
    | C::RegistrarRegister
    | C::RegistrarRenew
    | C::RegistrarRestore
    | C::RegistrarTransferIn
    | C::RegistrarTransferOut
    | C::RegistrarAuthCodeRequest
    | C::RegistrarLockManage
    | C::RegistrarAutoRenewManage
    | C::RegistrarContactManage
    | C::RegistrarPrivacyManage
    | C::NameserversManage
    | C::RegistrarGlueManage
    | C::RegistrarMonitor
    | C::ZoneObserve
    | C::DnsRecordsObserve
    | C::DnsRecordsManage
    | C::DnssecManage
    | C::DnsMonitor
    | C::MarketplaceListingObserve
    | C::MarketplaceListingManage
    | C::MarketplacePriceManage
    | C::MarketplaceSalesObserve
    | C::MarketplaceSaleAuthCodeDeliver
    | C::MarketplaceOwnershipVerify
    | C::MarketplaceMonitor
    | C::AcquisitionSearch
    | C::AcquisitionOfferObserve
    | C::AcquisitionBid
    | C::AcquisitionBackorder
    | C::AcquisitionPurchase
    | C::AcquisitionArrivalReconcile
    | C::AcquisitionMonitor => C::AcquisitionMonitor as usize + 1,
};

/// The catalog, in the protocol's order: capability, protocol id, role, effect.
const CATALOG: [(ProviderCapability, &str, ProviderRole, ProviderEffect); VARIANT_COUNT] = [
    (
        C::RegistrarDomainObserve,
        "registrar.domain.observe",
        Registrar,
        Read,
    ),
    (
        C::RegistrarRegister,
        "registrar.register",
        Registrar,
        Financial,
    ),
    (C::RegistrarRenew, "registrar.renew", Registrar, Financial),
    (
        C::RegistrarRestore,
        "registrar.restore",
        Registrar,
        Financial,
    ),
    (
        C::RegistrarTransferIn,
        "registrar.transfer.in",
        Registrar,
        Financial,
    ),
    (
        C::RegistrarTransferOut,
        "registrar.transfer.out",
        Registrar,
        Financial,
    ),
    (
        C::RegistrarAuthCodeRequest,
        "registrar.auth-code.request",
        Registrar,
        Write,
    ),
    (
        C::RegistrarLockManage,
        "registrar.lock.manage",
        Registrar,
        Write,
    ),
    (
        C::RegistrarAutoRenewManage,
        "registrar.auto-renew.manage",
        Registrar,
        Financial,
    ),
    (
        C::RegistrarContactManage,
        "registrar.contact.manage",
        Registrar,
        Write,
    ),
    (
        C::RegistrarPrivacyManage,
        "registrar.privacy.manage",
        Registrar,
        Write,
    ),
    (C::NameserversManage, "nameservers.manage", Registrar, Write),
    (
        C::RegistrarGlueManage,
        "registrar.glue.manage",
        Registrar,
        Write,
    ),
    (C::RegistrarMonitor, "registrar.monitor", Registrar, Read),
    (C::ZoneObserve, "zone.observe", Dns, Read),
    (C::DnsRecordsObserve, "dns.records.observe", Dns, Read),
    (C::DnsRecordsManage, "dns.records.manage", Dns, Write),
    (C::DnssecManage, "dnssec.manage", Dns, Write),
    (C::DnsMonitor, "dns.monitor", Dns, Read),
    (
        C::MarketplaceListingObserve,
        "marketplace.listing.observe",
        Marketplace,
        Read,
    ),
    (
        C::MarketplaceListingManage,
        "marketplace.listing.manage",
        Marketplace,
        Write,
    ),
    (
        C::MarketplacePriceManage,
        "marketplace.price.manage",
        Marketplace,
        Write,
    ),
    (
        C::MarketplaceSalesObserve,
        "marketplace.sales.observe",
        Marketplace,
        Read,
    ),
    (
        C::MarketplaceSaleAuthCodeDeliver,
        "marketplace.sale.auth-code.deliver",
        Marketplace,
        Write,
    ),
    (
        C::MarketplaceOwnershipVerify,
        "marketplace.ownership.verify",
        Marketplace,
        Write,
    ),
    (
        C::MarketplaceMonitor,
        "marketplace.monitor",
        Marketplace,
        Read,
    ),
    (
        C::AcquisitionSearch,
        "acquisition.search",
        Acquisition,
        Read,
    ),
    (
        C::AcquisitionOfferObserve,
        "acquisition.offer.observe",
        Acquisition,
        Read,
    ),
    (C::AcquisitionBid, "acquisition.bid", Acquisition, Financial),
    (
        C::AcquisitionBackorder,
        "acquisition.backorder",
        Acquisition,
        Financial,
    ),
    (
        C::AcquisitionPurchase,
        "acquisition.purchase",
        Acquisition,
        Financial,
    ),
    (
        C::AcquisitionArrivalReconcile,
        "acquisition.arrival.reconcile",
        Acquisition,
        Read,
    ),
    (
        C::AcquisitionMonitor,
        "acquisition.monitor",
        Acquisition,
        Read,
    ),
];

impl ProviderCapability {
    /// Every capability, in catalog order.
    pub(crate) const ALL: [Self; CATALOG.len()] = {
        // Every variant is listed, so a variant added without a catalog entry fails to compile.
        let mut all = [Self::RegistrarDomainObserve; CATALOG.len()];
        let mut index = 0;
        while index < CATALOG.len() {
            all[index] = CATALOG[index].0;
            index += 1;
        }
        all
    };

    fn entry(
        self,
    ) -> (
        ProviderCapability,
        &'static str,
        ProviderRole,
        ProviderEffect,
    ) {
        // The catalog lists every variant exactly once (checked by the tests below).
        CATALOG[self as usize]
    }

    /// The protocol catalog id.
    #[must_use]
    pub(crate) fn id(self) -> &'static str {
        self.entry().1
    }

    /// The one role that may run this capability.
    #[must_use]
    pub(crate) fn role(self) -> ProviderRole {
        self.entry().2
    }

    /// What running it does.
    #[must_use]
    pub(crate) fn effect(self) -> ProviderEffect {
        self.entry().3
    }

    /// The capability for a protocol catalog id; `None` for `connection.manage` and unknown ids.
    #[must_use]
    pub(crate) fn from_id(id: &str) -> Option<Self> {
        CATALOG
            .iter()
            .find(|entry| entry.1 == id)
            .map(|entry| entry.0)
    }
}

/// Why a platform capability cannot run, as the per-platform manifest states it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ProviderUnavailableReason {
    /// The platform's facts for this capability are not yet checked in its ADR-0027 phase.
    PlatformFactsPending,
    /// Implemented locally; awaiting its ADR-0024 qualification.
    QualificationPending,
}

/// Why a Service refused admission. Closed: a caller cannot learn more than this.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ProviderAdmissionRefusal {
    /// The connection does not declare the capability's role: a credential held for one role is
    /// never used for another role's capability.
    RoleNotDeclared,
    /// The connection's declared roles are malformed (a role listed twice), so they are not trusted.
    RolesRejected,
    /// The manifest marks the capability not executable on this platform.
    NotExecutable(ProviderUnavailableReason),
}

/// Proof that a Service admitted one capability. It has no value: no capability is executable,
/// so no admission can exist.
#[derive(Debug)]
pub(crate) struct ProviderAdmission {
    #[allow(
        dead_code,
        reason = "uninhabited: its only purpose is that no value exists"
    )]
    never: Never,
}

#[derive(Debug)]
enum Never {}

/// One platform's private Service and its manifest.
trait PlatformService {
    /// Capabilities implemented locally on this platform; all of them await qualification.
    const IMPLEMENTED: &'static [ProviderCapability];

    /// The manifest state of one capability. There is no executable state.
    fn manifest(capability: ProviderCapability) -> ProviderUnavailableReason {
        if Self::IMPLEMENTED.contains(&capability) {
            ProviderUnavailableReason::QualificationPending
        } else {
            ProviderUnavailableReason::PlatformFactsPending
        }
    }
}

fn manifest(
    platform: ProviderPlatform,
    capability: ProviderCapability,
) -> ProviderUnavailableReason {
    match platform {
        ProviderPlatform::TwentyTwoCn => twenty_two_cn::TwentyTwoCnService::manifest(capability),
        ProviderPlatform::Afternic => afternic::AfternicService::manifest(capability),
        ProviderPlatform::Aliyun => aliyun::AliyunService::manifest(capability),
        ProviderPlatform::Atom => atom::AtomService::manifest(capability),
        ProviderPlatform::Cloudflare => cloudflare::CloudflareService::manifest(capability),
        ProviderPlatform::Dynadot => dynadot::DynadotService::manifest(capability),
        ProviderPlatform::Ename => ename::EnameService::manifest(capability),
        ProviderPlatform::Godaddy => godaddy::GodaddyService::manifest(capability),
        ProviderPlatform::Namecheap => namecheap::NamecheapService::manifest(capability),
        ProviderPlatform::Porkbun => porkbun::PorkbunService::manifest(capability),
        ProviderPlatform::Sedo => sedo::SedoService::manifest(capability),
        ProviderPlatform::Spaceship => spaceship::SpaceshipService::manifest(capability),
    }
}

/// Why `capability` cannot run on `platform`, as that platform's Service manifest states it.
#[must_use]
pub(crate) fn provider_capability_unavailable_reason(
    platform: ProviderPlatform,
    capability: ProviderCapability,
) -> ProviderUnavailableReason {
    manifest(platform, capability)
}

/// The only entry to a platform Service. A connection's declared roles are checked first, so a
/// credential held for one role is refused for another role's capability before any manifest is
/// consulted; then the platform's manifest refuses every capability, because none is executable.
///
/// # Errors
///
/// Always: `RolesRejected` for a role listed twice, `RoleNotDeclared` when the connection does not
/// declare the capability's role, otherwise `NotExecutable` with the manifest's reason.
pub(crate) fn admit_provider_capability(
    platform: ProviderPlatform,
    capability: ProviderCapability,
    connection_roles: &[ProviderRole],
) -> Result<ProviderAdmission, ProviderAdmissionRefusal> {
    if connection_roles
        .iter()
        .enumerate()
        .any(|(index, role)| connection_roles[..index].contains(role))
    {
        return Err(ProviderAdmissionRefusal::RolesRejected);
    }
    if !connection_roles.contains(&capability.role()) {
        return Err(ProviderAdmissionRefusal::RoleNotDeclared);
    }
    Err(ProviderAdmissionRefusal::NotExecutable(manifest(
        platform, capability,
    )))
}

#[cfg(test)]
mod tests {
    use super::*;

    const ROLES: [ProviderRole; 4] = [Registrar, Dns, Marketplace, Acquisition];

    #[test]
    fn the_catalog_lists_every_variant_once_in_declaration_order() {
        for (index, entry) in CATALOG.iter().enumerate() {
            assert_eq!(entry.0 as usize, index, "{}", entry.1);
            assert_eq!(ProviderCapability::ALL[index], entry.0);
            assert_eq!(ProviderCapability::from_id(entry.1), Some(entry.0));
        }
        let mut ids = CATALOG.iter().map(|entry| entry.1).collect::<Vec<_>>();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), CATALOG.len());
        for unknown in [
            "connection.manage",
            "",
            "zone.observe ",
            "ZONE.OBSERVE",
            "acquisition.proxy-bid",
        ] {
            assert_eq!(ProviderCapability::from_id(unknown), None, "{unknown}");
        }
    }

    #[test]
    fn no_platform_admits_any_capability_for_any_role_set() {
        for platform in ProviderPlatform::ALL {
            for capability in ProviderCapability::ALL {
                let reason = provider_capability_unavailable_reason(platform, capability);
                // Independent oracle for the protocol manifest's locally implemented entries.
                let implemented = match platform {
                    ProviderPlatform::Cloudflare => matches!(
                        capability,
                        C::RegistrarDomainObserve | C::ZoneObserve | C::DnsRecordsObserve
                    ),
                    ProviderPlatform::Spaceship
                    | ProviderPlatform::Aliyun
                    | ProviderPlatform::Godaddy
                    | ProviderPlatform::Porkbun => capability == C::RegistrarDomainObserve,
                    ProviderPlatform::Atom | ProviderPlatform::Sedo => {
                        capability == C::MarketplaceListingObserve
                    }
                    _ => false,
                };
                let expected = if implemented {
                    ProviderUnavailableReason::QualificationPending
                } else {
                    ProviderUnavailableReason::PlatformFactsPending
                };
                assert_eq!(reason, expected, "{platform:?} {}", capability.id());
                assert!(matches!(
                    admit_provider_capability(platform, capability, &ROLES),
                    Err(ProviderAdmissionRefusal::NotExecutable(found)) if found == reason
                ));
                assert_eq!(
                    admit_provider_capability(platform, capability, &[]).unwrap_err(),
                    ProviderAdmissionRefusal::RoleNotDeclared
                );
            }
        }
    }

    #[test]
    fn a_credential_held_for_one_role_is_refused_for_every_other_role() {
        for platform in ProviderPlatform::ALL {
            for capability in ProviderCapability::ALL {
                for held in ROLES {
                    let refusal =
                        admit_provider_capability(platform, capability, &[held]).unwrap_err();
                    if held == capability.role() {
                        assert!(matches!(
                            refusal,
                            ProviderAdmissionRefusal::NotExecutable(_)
                        ));
                    } else {
                        assert_eq!(
                            refusal,
                            ProviderAdmissionRefusal::RoleNotDeclared,
                            "{platform:?} {} via {held:?}",
                            capability.id()
                        );
                    }
                }
            }
        }
    }

    #[test]
    fn platform_kinds_are_the_protocol_launch_platforms_in_order() {
        let kinds = ProviderPlatform::ALL.map(ProviderPlatform::kind);
        assert_eq!(
            kinds,
            [
                "22cn",
                "afternic",
                "aliyun",
                "atom",
                "cloudflare",
                "dynadot",
                "ename",
                "godaddy",
                "namecheap",
                "porkbun",
                "sedo",
                "spaceship",
            ]
        );
    }

    #[test]
    fn a_role_listed_twice_is_rejected_before_anything_else() {
        assert_eq!(
            admit_provider_capability(
                ProviderPlatform::Cloudflare,
                C::ZoneObserve,
                &[Dns, Registrar, Dns]
            )
            .unwrap_err(),
            ProviderAdmissionRefusal::RolesRejected
        );
    }

    #[test]
    fn bids_backorders_purchases_and_charges_are_financial() {
        for capability in [
            C::AcquisitionBid,
            C::AcquisitionBackorder,
            C::AcquisitionPurchase,
            C::RegistrarRegister,
            C::RegistrarRenew,
            C::RegistrarRestore,
            C::RegistrarTransferIn,
            C::RegistrarAutoRenewManage,
        ] {
            assert_eq!(capability.effect(), Financial, "{}", capability.id());
        }
        assert_eq!(C::AcquisitionSearch.effect(), Read);
    }
}
