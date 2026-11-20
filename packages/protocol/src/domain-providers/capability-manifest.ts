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
 * - `qualification_pending`: implemented locally; awaiting its ADR-0027 qualification.
 */
export const domainProviderUnavailableReasonSchema = z.enum(["platform_facts_pending", "qualification_pending"]);

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
 * Zone and DNS observation, Spaceship, Alibaba Cloud and GoDaddy registration observation, and Atom
 * seller inventory.
 * docs/CONNECTORS.md records what the Host implements and must be
 * changed with this list; the Host qualification register, not this list, decides what may run.
 * Every other entry waits on its platform's facts.
 */
const implemented: Readonly<Partial<Record<LaunchPlatformKind, readonly DomainProviderCapabilityId[]>>> = {
  cloudflare: ["registrar.domain.observe", "zone.observe", "dns.records.observe"],
  spaceship: ["registrar.domain.observe"],
  aliyun: ["registrar.domain.observe"],
  godaddy: ["registrar.domain.observe"],
  atom: ["marketplace.listing.observe"],
};

export const domainProviderCapabilityManifest: readonly DomainProviderManifestEntry[] = Object.freeze(
  launchPlatformKindSchema.options.flatMap((platform) => domainProviderCapabilityCatalog
    .filter((capability) => capability.role !== null)
    .map((capability) => Object.freeze({
      platform,
      capabilityId: capability.id,
      execution: "not_executable" as const,
      reason: implemented[platform]?.includes(capability.id) === true ? "qualification_pending" as const : "platform_facts_pending" as const,
    }))),
);

/** The manifest entry for one platform capability; a capability without a role has none. */
export function domainProviderManifestEntry(platform: LaunchPlatformKind, capabilityId: DomainProviderCapabilityId): DomainProviderManifestEntry | null {
  return domainProviderCapabilityManifest.find((entry) => entry.platform === platform && entry.capabilityId === capabilityId) ?? null;
}
