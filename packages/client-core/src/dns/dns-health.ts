import { z } from "zod";

import { canonicalDomainNameSchema } from "../portfolio/domain-name";
import { copyPlainData, portfolioFreshnessSchema } from "../portfolio/view-models";
import type { DnsVerificationRowViewModel, DnsVerificationViewModel } from "../verification";

const safeCount = z.number().int().nonnegative().max(1_024);
const labelSchema = z.string().min(1).max(253)
  .refine((value) => !/[\p{Cc}\p{Cf}]/u.test(value), "labels reject control characters");

const dnsZoneBindingSchema = z.object({
  providerKind: z.literal("cloudflare"),
  connectionLabel: labelSchema,
  zoneLabel: canonicalDomainNameSchema,
  validationStatus: z.enum(["unverified", "verified", "stale", "conflicted", "detached"]),
}).strict();

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
}).strict();

/** Host DNS health window: observed facts only, never a delegation, record or ownership verdict. */
export const dnsHealthReadSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("dns_health"),
  readGeneration: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  freshness: portfolioFreshnessSchema,
  totalRows: z.number().int().nonnegative().max(1_000_200),
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

function observationStatus(row: DnsHealthRow): DnsVerificationRowViewModel["propagationStatus"] {
  if (row.observation === null) return "unobserved";
  return row.observation.availability === "available" && row.observation.evidenceStatus === "confirmed"
    ? "current"
    : "warning";
}

function projectRow(row: DnsHealthRow): DnsVerificationRowViewModel {
  const observation = row.observation;
  const recordCount = observation === null || observation.availability !== "available"
    ? null
    : Object.values(observation.recordCounts).reduce((sum, value) => sum + value, 0);
  const bound = row.zoneBinding !== null && row.zoneBinding.validationStatus !== "detached";
  return {
    domainAssetId: row.entityId,
    domain: row.entityId,
    // Ownership verification is not composed; every row says so instead of guessing.
    ownershipStatus: "unavailable",
    verificationAttemptId: null,
    verificationStatus: null,
    challenge: null,
    delegatedNameservers: observation === null ? [] : [...observation.authoritativeNameservers],
    // Zone nameservers are observed, but registrar delegation is not, so it is never "healthy".
    delegationStatus: "unknown",
    recordHealth: recordCount === null ? "unobserved" : "observed",
    recordCount,
    providerDisplayName: bound ? row.zoneBinding!.connectionLabel : observation === null ? "—" : "Cloudflare",
    providerResolved: bound,
    propagationStatus: observationStatus(row),
    lastCheckedAt: observation?.observedAt ?? null,
    records: [],
    availableActions: [],
  };
}

/**
 * Projects complete Host DNS health windows into the DNS page model. Every window must come from
 * one Host generation; mixed or partial reads are rejected rather than stitched together.
 */
export function projectDnsHealthViewModel(windows: readonly DnsHealthRead[]): DnsVerificationViewModel {
  const first = windows[0];
  if (first === undefined) throw new TypeError("DNS health needs at least one Host window");
  let expectedStart = 0;
  for (const window of windows) {
    if (
      window.readGeneration !== first.readGeneration
      || window.totalRows !== first.totalRows
      || window.window.startIndex !== expectedStart
    ) {
      throw new TypeError("DNS health windows must be contiguous reads of one Host generation");
    }
    expectedStart += window.window.rows.length;
  }
  if (expectedStart !== first.totalRows) throw new TypeError("DNS health windows must cover every asset");
  const rows = windows.flatMap((window) => window.window.rows.map(projectRow));
  return {
    state: rows.some((row) => row.propagationStatus === "warning") ? "warning" : "normal",
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
      observed: rows.filter((row) => row.propagationStatus !== "unobserved").length,
      unobserved: rows.filter((row) => row.propagationStatus === "unobserved").length,
    },
    rows,
  };
}
