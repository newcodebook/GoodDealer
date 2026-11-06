import { z } from "zod";

import { launchPlatformKindSchema, launchPlatformNames } from "../connections/launch-platforms";
import { connectionLabelSchema } from "../connections/connection-label";
import { canonicalDomainNameSchema } from "../portfolio/domain-name";
import { assetLibraryWindowRequestSchema, copyPlainData, portfolioFreshnessSchema } from "../portfolio/view-models";
import type { DnsVerificationRowViewModel, DnsVerificationViewModel } from "../verification";

const safeCount = z.number().int().nonnegative().max(1_024);

const dnsZoneBindingSchema = z.object({
  providerKind: launchPlatformKindSchema,
  connectionLabel: connectionLabelSchema,
  zoneLabel: canonicalDomainNameSchema,
  validationStatus: z.enum(["unverified", "verified", "stale", "conflicted", "detached"]),
}).strict();

/** Only Cloudflare Zones are observed today; other platforms have no composed observation. */
const dnsZoneObservationSummarySchema = z.object({
  providerKind: z.literal("cloudflare"),
  observedAt: z.iso.datetime(),
  availability: z.enum(["available", "unavailable"]),
  evidenceStatus: z.enum(["confirmed", "stale", "conflicted", "unknown"]),
  zoneLabel: canonicalDomainNameSchema,
  zoneStatus: z.enum(["active", "pending", "unknown"]),
  authoritativeNameservers: z.array(canonicalDomainNameSchema).max(16).readonly(),
  dnssecStatus: z.enum(["active", "inactive", "unknown", "unsupported"]),
  recordCounts: z.object({ a: safeCount, aaaa: safeCount, cname: safeCount, txt: safeCount, other: safeCount }).strict(),
}).strict();

const dnsHealthRowSchema = z.object({
  entityId: canonicalDomainNameSchema,
  zoneBinding: dnsZoneBindingSchema.nullable(),
  observation: dnsZoneObservationSummarySchema.nullable(),
}).strict();

export const dnsHealthWindowRequestSchema = z.object({
  startIndex: z.number().int().nonnegative().max(1_000_000),
  size: z.number().int().min(1).max(200),
  /** A domain prefix, searched by the Host like the asset library's; empty for every asset. */
  query: assetLibraryWindowRequestSchema.shape.query,
}).strict();

/** Host DNS health window: observed facts only, never a delegation, record or ownership verdict. */
export const dnsHealthReadSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("dns_health"),
  readGeneration: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  freshness: portfolioFreshnessSchema,
  /** Rows matching the search; the window pages through these. */
  totalRows: z.number().int().nonnegative().max(1_000_200),
  /** Workspace-wide counts, unaffected by the search, for the page metrics. */
  assetCount: z.number().int().nonnegative().max(1_000_200),
  observedCount: z.number().int().nonnegative().max(1_000_200),
  warningCount: z.number().int().nonnegative().max(1_000_200),
  window: z.object({
    startIndex: dnsHealthWindowRequestSchema.shape.startIndex,
    size: dnsHealthWindowRequestSchema.shape.size,
    rows: z.array(dnsHealthRowSchema).max(200).readonly(),
  }).strict(),
}).strict().superRefine((read, context) => {
  const { startIndex, size, rows } = read.window;
  if (rows.length > size || startIndex + rows.length > read.totalRows) {
    context.addIssue({ code: "custom", path: ["window", "rows"], message: "window exceeds its bounds" });
  }
  if (read.totalRows > read.assetCount || read.observedCount > read.assetCount || read.warningCount > read.observedCount) {
    context.addIssue({ code: "custom", path: ["warningCount"], message: "counts exceed the workspace" });
  }
  for (let index = 1; index < rows.length; index += 1) {
    if (rows[index - 1]!.entityId >= rows[index]!.entityId) {
      context.addIssue({ code: "custom", path: ["window", "rows", index], message: "rows must be unique and ordered" });
      break;
    }
  }
});

export type DnsHealthWindowRequest = z.infer<typeof dnsHealthWindowRequestSchema>;
export type DnsHealthRead = z.infer<typeof dnsHealthReadSchema>;
export type DnsHealthRow = z.infer<typeof dnsHealthRowSchema>;

export function parseDnsHealthRead(input: unknown): DnsHealthRead {
  return dnsHealthReadSchema.parse(copyPlainData(input));
}

export interface DnsHealthPort {
  loadDnsHealth(request: DnsHealthWindowRequest): Promise<DnsHealthRead>;
}

function observationStatus(observation: DnsHealthRow["observation"]): DnsVerificationRowViewModel["propagationStatus"] {
  if (observation === null) return "unobserved";
  // A pending or unknown Zone means the platform has not seen delegation; that needs attention.
  return observation.availability === "available"
    && observation.evidenceStatus === "confirmed"
    && observation.zoneStatus === "active"
    ? "current"
    : "warning";
}

function projectRow(row: DnsHealthRow): DnsVerificationRowViewModel {
  const bound = row.zoneBinding !== null && row.zoneBinding.validationStatus !== "detached";
  // An observation from another platform says nothing about the bound Zone, so it is not shown as one.
  const observation = bound && row.zoneBinding!.providerKind !== row.observation?.providerKind ? null : row.observation;
  const recordCount = observation === null || observation.availability !== "available"
    ? null
    : Object.values(observation.recordCounts).reduce((sum, value) => sum + value, 0);
  return {
    domainAssetId: row.entityId,
    domain: row.entityId,
    // Ownership verification is not composed; every row says so instead of guessing.
    ownershipStatus: "unavailable",
    verificationAttemptId: null,
    verificationStatus: null,
    challenge: null,
    // Registrar delegation is not observed, so it is unknown and never "healthy". The Zone's own
    // nameservers are reported separately: matching them is what delegation would have to prove.
    delegatedNameservers: [],
    delegationStatus: "unknown",
    zoneNameservers: observation === null ? [] : [...observation.authoritativeNameservers],
    dnssecStatus: observation?.dnssecStatus ?? null,
    recordHealth: recordCount === null ? "unobserved" : "observed",
    recordCount,
    providerDisplayName: bound ? row.zoneBinding!.connectionLabel : observation === null ? "—" : launchPlatformNames[observation.providerKind],
    providerResolved: bound,
    propagationStatus: observationStatus(observation),
    lastCheckedAt: observation?.observedAt ?? null,
    records: [],
    availableActions: bindable(row) ? ["bind_zone"] : [],
  };
}

/**
 * A row may be bound when it has no live binding and a confirmed, available Cloudflare observation
 * of the Zone with the asset's own name. The Host binds only from that committed evidence and
 * checks it again; this only decides whether to offer the action.
 */
function bindable(row: DnsHealthRow): boolean {
  const unbound = row.zoneBinding === null || row.zoneBinding.validationStatus === "detached";
  const observation = row.observation;
  return unbound
    && observation !== null
    && observation.providerKind === "cloudflare"
    && observation.availability === "available"
    && observation.evidenceStatus === "confirmed"
    && observation.zoneLabel === row.entityId;
}

/**
 * Projects one page of `pageSize` rows from Host DNS health windows into the DNS page model. The
 * windows must come from one Host generation, be contiguous from the page's first window and hold
 * every row of the page (fewer only on the last page); mixed or partial reads are rejected rather
 * than stitched together. Metrics and the page state come from the Host's workspace-wide counts.
 */
export function projectDnsHealthViewModel(windows: readonly DnsHealthRead[], pageSize: number): DnsVerificationViewModel {
  const first = windows[0];
  if (first === undefined) throw new TypeError("DNS health needs at least one Host window");
  let expectedStart = first.window.startIndex;
  for (const window of windows) {
    if (
      window.readGeneration !== first.readGeneration
      || window.totalRows !== first.totalRows
      || window.assetCount !== first.assetCount
      || window.observedCount !== first.observedCount
      || window.warningCount !== first.warningCount
      || window.window.startIndex !== expectedStart
    ) {
      throw new TypeError("DNS health windows must be contiguous reads of one Host generation");
    }
    expectedStart += window.window.rows.length;
  }
  if (expectedStart !== Math.min(first.totalRows, first.window.startIndex + pageSize)) {
    throw new TypeError("DNS health windows must cover the whole page");
  }
  const rows = windows.flatMap((window) => window.window.rows.map(projectRow));
  return {
    state: first.warningCount > 0 ? "warning" : "normal",
    readSource: first.freshness.source,
    serverRevision: first.freshness.serverRevision,
    lastReplicationActivityAt: first.freshness.lastReplicationActivityAt,
    lastSuccessfulProviderObservationAt: first.freshness.lastSuccessfulProviderObservationAt,
    ownershipAvailability: "unavailable",
    metrics: {
      verified: 0,
      pendingOrFailed: 0,
      nameserverIssues: 0,
      recordIssues: 0,
      propagating: 0,
      observed: first.observedCount,
      unobserved: first.assetCount - first.observedCount,
    },
    rows,
    page: { startIndex: first.window.startIndex, size: pageSize, totalItems: first.totalRows },
  };
}
