import { z } from "zod";

import {
  domainProviderCapabilityCatalog,
  domainProviderCapabilityIdSchema,
  type DomainProviderCapabilityId,
} from "./domain-capabilities";
import { launchPlatformKindSchema, type LaunchPlatformKind } from "./launch-platforms";

/**
 * ADR-0027 per-platform capability manifest. It states, for every launch platform and
 * every catalog capability that has a role, why that capability cannot run there. It has no
 * executable state: the ADR-0027 fields an executable entry needs (minimal permission, risk,
 * idempotency, asynchronous result, unknown-outcome reconciliation, compensation, qualification
 * evidence) come only from that platform's phase, checked against the official documentation of
 * that day, and the first qualified entry must extend this schema rather than reuse it. The Host
 * qualification register stays the only authority on what may execute.
 */
export const DOMAIN_PROVIDER_CAPABILITY_MANIFEST_VERSION = 1 as const;

/**
 * - `platform_facts_pending`: the platform's facts for this capability are not yet checked in its
 *   ADR-0027 phase, so it is not known whether the platform offers it.
 * - `implementation_pending`: the platform's official API offers it (checked in its phase); not yet
 *   implemented locally.
 * - `official_api_absent`: the platform's official API has no endpoint for it on the checked date.
 *   ADR-0027 puts such a capability on that platform's private-adapter list instead of ruling it out.
 * - `qualification_pending`: implemented locally; awaiting its ADR-0027 qualification.
 */
export const domainProviderUnavailableReasonSchema = z.enum([
  "platform_facts_pending",
  "implementation_pending",
  "official_api_absent",
  "qualification_pending",
]);

export const domainProviderManifestEntrySchema = z.object({
  platform: launchPlatformKindSchema,
  capabilityId: domainProviderCapabilityIdSchema,
  execution: z.literal("not_executable"),
  reason: domainProviderUnavailableReasonSchema,
}).strict();

export type DomainProviderUnavailableReason = z.infer<typeof domainProviderUnavailableReasonSchema>;
export type DomainProviderManifestEntry = z.infer<typeof domainProviderManifestEntrySchema>;

/**
 * Locally implemented capabilities awaiting qualification include Cloudflare's registration,
 * Zone and DNS observation, Spaceship, Alibaba Cloud, GoDaddy and Porkbun registration observation,
 * Porkbun DNS record observation, Spaceship SellerHub listing observation and BIN price changes,
 * and Atom seller inventory.
 * docs/CONNECTORS.md records what the Host implements, and the matching `secure-host-core`
 * `provider_services` module's `IMPLEMENTED` list mirrors it; both must change with this list; the Host qualification register, not this list, decides what may run.
 * Every other entry waits on its platform's facts.
 */
const implemented: Readonly<Partial<Record<LaunchPlatformKind, readonly DomainProviderCapabilityId[]>>> = {
  cloudflare: ["registrar.domain.observe", "zone.observe", "dns.records.observe"],
  spaceship: ["registrar.domain.observe", "marketplace.listing.observe", "marketplace.price.manage"],
  aliyun: ["registrar.domain.observe"],
  godaddy: ["registrar.domain.observe"],
  porkbun: ["registrar.domain.observe", "dns.records.observe"],
  atom: ["marketplace.listing.observe"],
  sedo: ["marketplace.listing.observe"],
};

type CheckedFacts = Readonly<Partial<Record<DomainProviderCapabilityId, "implementation_pending" | "official_api_absent">>>;

/**
 * Per-platform official facts for capabilities that are not implemented. A platform appears here
 * only after its phase checked every role capability against that day's official documentation;
 * docs/PROVIDER_API_REVIEW.md holds the dated source and the endpoints.
 */
const checkedFacts: Readonly<Partial<Record<LaunchPlatformKind, CheckedFacts>>> = {
  // Porkbun API v3.112, https://porkbun.com/api/json/v3/spec, checked 2026-11-24. Selling, bidding,
  // backorders, aftermarket purchase, outbound transfer codes, lock, restore and a privacy toggle
  // have no endpoint; Porkbun Marketplace and aftermarket search are public browse, not the
  // account's own listings. Auction outbid/end and backorder results cannot be watched, so
  // acquisition monitoring is absent. `acquisition.purchase` covers fixed-price closeouts only;
  // aftermarket purchase (website `buyUrl`) and premium renewal stay on the private-adapter list.
  porkbun: {
    "registrar.register": "implementation_pending",
    "registrar.renew": "implementation_pending",
    "registrar.restore": "official_api_absent",
    "registrar.transfer.in": "implementation_pending",
    "registrar.transfer.out": "official_api_absent",
    "registrar.auth-code.request": "official_api_absent",
    "registrar.lock.manage": "official_api_absent",
    "registrar.auto-renew.manage": "implementation_pending",
    "registrar.contact.manage": "implementation_pending",
    "registrar.privacy.manage": "official_api_absent",
    "nameservers.manage": "implementation_pending",
    "registrar.glue.manage": "implementation_pending",
    "registrar.monitor": "implementation_pending",
    "zone.observe": "implementation_pending",
    "dns.records.manage": "implementation_pending",
    "dnssec.manage": "implementation_pending",
    "dns.monitor": "implementation_pending",
    "marketplace.listing.observe": "official_api_absent",
    "marketplace.listing.manage": "official_api_absent",
    "marketplace.price.manage": "official_api_absent",
    "marketplace.sales.observe": "official_api_absent",
    "marketplace.sale.auth-code.deliver": "official_api_absent",
    "marketplace.ownership.verify": "official_api_absent",
    "marketplace.monitor": "official_api_absent",
    "acquisition.search": "implementation_pending",
    "acquisition.offer.observe": "implementation_pending",
    "acquisition.bid": "official_api_absent",
    "acquisition.backorder": "official_api_absent",
    "acquisition.purchase": "implementation_pending",
    "acquisition.arrival.reconcile": "implementation_pending",
    "acquisition.monitor": "official_api_absent",
  },
  // Spaceship External API OpenAPI 1.0.0 embedded in https://docs.spaceship.dev/, checked
  // 2026-11-24. Spaceship has no separate Zone resource: hosted DNS is per domain, so Zone
  // observation reads the domain's nameservers and record list. DNSSEC has no endpoint. A
  // SellerHub sale is delivered outside the API, which has no delivery endpoint.
  // SellerHub fixed-price creation is implemented, but delisting is not, so listing management
  // as a whole stays pending.
  // `acquisition.purchase` covers only a buyer-initiated SafePay escrow for a named domain;
  // there is no auction, backorder or public aftermarket search, so their monitoring is absent.
  spaceship: {
    "registrar.register": "implementation_pending",
    "registrar.renew": "implementation_pending",
    "registrar.restore": "implementation_pending",
    "registrar.transfer.in": "implementation_pending",
    "registrar.transfer.out": "implementation_pending",
    "registrar.auth-code.request": "implementation_pending",
    "registrar.lock.manage": "implementation_pending",
    "registrar.auto-renew.manage": "implementation_pending",
    "registrar.contact.manage": "implementation_pending",
    "registrar.privacy.manage": "implementation_pending",
    "nameservers.manage": "implementation_pending",
    "registrar.glue.manage": "implementation_pending",
    "registrar.monitor": "implementation_pending",
    "zone.observe": "implementation_pending",
    "dns.records.observe": "implementation_pending",
    "dns.records.manage": "implementation_pending",
    "dnssec.manage": "official_api_absent",
    "dns.monitor": "implementation_pending",
    "marketplace.listing.manage": "implementation_pending",
    "marketplace.sales.observe": "implementation_pending",
    "marketplace.sale.auth-code.deliver": "official_api_absent",
    "marketplace.ownership.verify": "implementation_pending",
    "marketplace.monitor": "implementation_pending",
    "acquisition.search": "implementation_pending",
    "acquisition.offer.observe": "implementation_pending",
    "acquisition.bid": "official_api_absent",
    "acquisition.backorder": "official_api_absent",
    "acquisition.purchase": "implementation_pending",
    "acquisition.arrival.reconcile": "implementation_pending",
    "acquisition.monitor": "official_api_absent",
  },
};

function unavailableReason(platform: LaunchPlatformKind, capabilityId: DomainProviderCapabilityId): DomainProviderUnavailableReason {
  if (implemented[platform]?.includes(capabilityId) === true) return "qualification_pending";
  return checkedFacts[platform]?.[capabilityId] ?? "platform_facts_pending";
}

export const domainProviderCapabilityManifest: readonly DomainProviderManifestEntry[] = Object.freeze(
  launchPlatformKindSchema.options.flatMap((platform) => domainProviderCapabilityCatalog
    .filter((capability) => capability.role !== null)
    .map((capability) => Object.freeze({
      platform,
      capabilityId: capability.id,
      execution: "not_executable" as const,
      reason: unavailableReason(platform, capability.id),
    }))),
);

/** The manifest entry for one platform capability; a capability without a role has none. */
export function domainProviderManifestEntry(platform: LaunchPlatformKind, capabilityId: DomainProviderCapabilityId): DomainProviderManifestEntry | null {
  return domainProviderCapabilityManifest.find((entry) => entry.platform === platform && entry.capabilityId === capabilityId) ?? null;
}
