import { serverRevisionSchema } from "@gooddealer/protocol/workspace";
import { canonicalUtcTimestamp, displayLabel, identifier, safeUnsignedInteger } from "@gooddealer/protocol/wire";
import { z } from "zod";

const domainNameSchema = z
  .string()
  .min(1)
  .max(253)
  .regex(/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/);

const dnsHostSchema = z
  .string()
  .min(1)
  .max(253)
  .refine((value) => !/[\p{Cc}\p{Cf}]/u.test(value), "DNS hosts reject control characters");

const dnsValuePreviewSchema = z
  .string()
  .min(1)
  .max(128)
  .refine((value) => value.includes("…"), "verification challenge previews must remain redacted")
  .refine((value) => !/[\p{Cc}\p{Cf}]/u.test(value), "DNS previews reject control characters");

const sha256FingerprintSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const rrsetHashSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);

export const dnsQuerySourceSchema = z.enum(["active_local", "standby_cloud"]);
export const dnsRecordTypeSchema = z.enum(["A", "AAAA", "CNAME", "TXT", "MX"]);
export const dnsDelegationStatusSchema = z.enum(["healthy", "mismatch", "unresolved"]);
export const dnsRecordHealthSchema = z.enum(["healthy", "warning", "missing"]);
export const dnsPropagationStatusSchema = z.enum(["current", "propagating", "warning"]);

export const dnsProviderSummarySchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("connected"),
      providerKind: z.enum(["cloudflare", "spaceship", "registrar_dns", "custom"]),
      connectionId: identifier,
      displayName: displayLabel,
    })
    .strict(),
  z.object({ kind: z.literal("unresolved"), displayName: z.literal("—") }).strict(),
]);

const ordinaryDnsRecordSchema = z
  .object({
    recordId: identifier,
    type: dnsRecordTypeSchema,
    host: dnsHostSchema,
    ttl: z.union([z.literal("auto"), safeUnsignedInteger]),
    classification: z.literal("ordinary"),
    value: z
      .string()
      .min(1)
      .max(4_096)
      .refine((value) => !/[\p{Cc}\p{Cf}]/u.test(value), "DNS values reject control characters"),
  })
  .strict();

const redactedVerificationDnsRecordSchema = z
  .object({
    recordId: identifier,
    type: z.literal("TXT"),
    host: dnsHostSchema,
    ttl: z.union([z.literal("auto"), safeUnsignedInteger]),
    classification: z.literal("verification_challenge_redacted"),
    valuePreview: dnsValuePreviewSchema,
    challengeFingerprint: sha256FingerprintSchema,
  })
  .strict();

export const dnsRecordSummarySchema = z
  .discriminatedUnion("classification", [ordinaryDnsRecordSchema, redactedVerificationDnsRecordSchema])
  .superRefine((record, context) => {
    if (
      record.classification === "ordinary" &&
      record.type === "TXT" &&
      (record.host === "_atomverify" || record.host.startsWith("_atomverify."))
    ) {
      context.addIssue({
        code: "custom",
        path: ["classification"],
        message: "verification challenge TXT values must be redacted",
      });
    }
  });

export const dnsReadFreshnessSchema = z
  .object({
    source: dnsQuerySourceSchema,
    serverRevision: serverRevisionSchema,
    lastReplicationActivityAt: canonicalUtcTimestamp.nullable(),
    lastSuccessfulProviderObservationAt: canonicalUtcTimestamp.nullable(),
  })
  .strict();

export const dnsDomainSnapshotSchema = z
  .object({
    domainAssetId: identifier,
    domain: domainNameSchema,
    delegatedNameservers: z.array(domainNameSchema).max(16),
    delegationStatus: dnsDelegationStatusSchema,
    provider: dnsProviderSummarySchema,
    recordHealth: dnsRecordHealthSchema,
    propagationStatus: dnsPropagationStatusSchema,
    records: z.array(dnsRecordSummarySchema).max(2_048),
    lastCheckedAt: canonicalUtcTimestamp.nullable(),
  })
  .strict()
  .superRefine((snapshot, context) => {
    if (snapshot.delegationStatus !== "unresolved" && snapshot.delegatedNameservers.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["delegatedNameservers"],
        message: "resolved delegation requires at least one nameserver",
      });
    }
    const recordIds = new Set<string>();
    for (const [index, record] of snapshot.records.entries()) {
      if (recordIds.has(record.recordId)) {
        context.addIssue({ code: "custom", path: ["records", index, "recordId"], message: "duplicate recordId" });
      }
      recordIds.add(record.recordId);
    }
  });

export const dnsQueryResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    workspaceId: identifier,
    domains: z.array(dnsDomainSnapshotSchema).max(10_000),
    freshness: dnsReadFreshnessSchema,
  })
  .strict()
  .superRefine((result, context) => {
    const domainIds = new Set<string>();
    for (const [index, domain] of result.domains.entries()) {
      if (domainIds.has(domain.domainAssetId)) {
        context.addIssue({ code: "custom", path: ["domains", index, "domainAssetId"], message: "duplicate domainAssetId" });
      }
      domainIds.add(domain.domainAssetId);
    }
  });

export const dnsExecutionActionSchema = z.enum([
  "reverify_ownership",
  "plan_txt_append",
  "plan_nameserver_change",
]);

const admittedDnsActionSchema = z.object({ domainAssetId: identifier, action: dnsExecutionActionSchema }).strict();
const noDnsActionsSchema = z.tuple([]);

export const dnsExecutionAvailabilitySchema = z.discriminatedUnion("surface", [
  z.object({ surface: z.literal("standby_read_only"), admittedActions: noDnsActionsSchema }).strict(),
  z
    .object({
      surface: z.literal("unavailable"),
      reason: z.enum(["missing_boundary", "not_authorized", "provider_unavailable"]),
      admittedActions: noDnsActionsSchema,
    })
    .strict(),
  z
    .object({ surface: z.literal("active"), admittedActions: z.array(admittedDnsActionSchema).max(30_000) })
    .strict()
    .superRefine((availability, context) => {
      const keys = new Set<string>();
      for (const [index, admitted] of availability.admittedActions.entries()) {
        const key = `${admitted.domainAssetId}:${admitted.action}`;
        if (keys.has(key)) {
          context.addIssue({ code: "custom", path: ["admittedActions", index], message: "duplicate admitted action" });
        }
        keys.add(key);
      }
    }),
]);

export const dnsTxtAppendPlanRequestSchema = z
  .object({
    schemaVersion: z.literal(1),
    domainAssetId: identifier,
    verificationAttemptId: identifier,
    fqdn: dnsHostSchema,
    challengeRef: identifier,
    challengeFingerprint: sha256FingerprintSchema,
    expectedRrsetHash: rrsetHashSchema,
    observedAt: canonicalUtcTimestamp,
    intent: z.literal("append_verification_value"),
  })
  .strict();

export const dnsTxtAppendPlanPreviewSchema = z
  .object({
    schemaVersion: z.literal(1),
    planId: identifier,
    domainAssetId: identifier,
    verificationAttemptId: identifier,
    fqdn: dnsHostSchema,
    recordType: z.literal("TXT"),
    valuePreview: dnsValuePreviewSchema,
    challengeFingerprint: sha256FingerprintSchema,
    writeMode: z.literal("append_preserving_rrset"),
    existingValueCount: safeUnsignedInteger,
    existingValuesPreserved: z.literal(true),
    overwritesExistingValues: z.literal(false),
    requiresFreshRrsetRead: z.literal(true),
    expectedRrsetHash: rrsetHashSchema,
    risk: z.literal("caution"),
    itemCount: z.literal(1),
  })
  .strict();

/**
 * Display-only contract for the Registration-owned Nameserver plan. DNS and
 * Verification may render this preview, but they never execute delegation changes.
 */
export const nameserverChangePlanPreviewSchema = z
  .object({
    schemaVersion: z.literal(1),
    planId: identifier,
    domainAssetId: identifier,
    registrarDisplayName: displayLabel,
    currentNameservers: z.array(domainNameSchema).min(1).max(16),
    targetNameservers: z.array(domainNameSchema).min(1).max(16),
    risk: z.literal("high"),
    requiresExplicitAcknowledgement: z.literal(true),
    operationOwner: z.literal("registration"),
    mayInterruptResolution: z.literal(true),
    mayInterruptMail: z.literal(true),
    propagationRequiredForRollback: z.literal(true),
    itemCount: z.literal(1),
  })
  .strict();

export type DnsQuerySource = z.infer<typeof dnsQuerySourceSchema>;
export type DnsProviderSummary = z.infer<typeof dnsProviderSummarySchema>;
export type DnsRecordSummary = z.infer<typeof dnsRecordSummarySchema>;
export type DnsDomainSnapshot = z.infer<typeof dnsDomainSnapshotSchema>;
export type DnsReadFreshness = z.infer<typeof dnsReadFreshnessSchema>;
export type DnsQueryResult = z.infer<typeof dnsQueryResultSchema>;
export type DnsExecutionAction = z.infer<typeof dnsExecutionActionSchema>;
export type DnsExecutionAvailability = z.infer<typeof dnsExecutionAvailabilitySchema>;
export type DnsTxtAppendPlanRequest = z.infer<typeof dnsTxtAppendPlanRequestSchema>;
export type DnsTxtAppendPlanPreview = z.infer<typeof dnsTxtAppendPlanPreviewSchema>;
export type NameserverChangePlanPreview = z.infer<typeof nameserverChangePlanPreviewSchema>;

export interface DnsQueryPort {
  getDnsHealth(): Promise<DnsQueryResult>;
}

export interface DnsQueryBoundary {
  getDnsHealth(): Promise<unknown>;
}

/** Strict boundary decoder; it supplies no network or fixture implementation. */
export class ValidatingDnsQueryClient implements DnsQueryPort {
  readonly #boundary: DnsQueryBoundary;
  readonly #expectedSource: DnsQuerySource;

  constructor(boundary: DnsQueryBoundary, expectedSource: DnsQuerySource) {
    this.#boundary = boundary;
    this.#expectedSource = expectedSource;
  }

  async getDnsHealth(): Promise<DnsQueryResult> {
    const result = dnsQueryResultSchema.parse(await this.#boundary.getDnsHealth());
    if (result.freshness.source !== this.#expectedSource) {
      throw new TypeError(`DNS query expected ${this.#expectedSource} freshness`);
    }
    return structuredClone(result);
  }
}

export interface DnsTxtAppendPlanPort {
  planTxtAppend(request: DnsTxtAppendPlanRequest): Promise<DnsTxtAppendPlanPreview>;
}

export interface DnsTxtAppendPlanBoundary {
  planTxtAppend(request: DnsTxtAppendPlanRequest): Promise<unknown>;
}

/** Validates a planner boundary and rejects request/preview identity confusion. */
export class ValidatingDnsTxtAppendPlanClient implements DnsTxtAppendPlanPort {
  readonly #boundary: DnsTxtAppendPlanBoundary;

  constructor(boundary: DnsTxtAppendPlanBoundary) {
    this.#boundary = boundary;
  }

  async planTxtAppend(requestInput: DnsTxtAppendPlanRequest): Promise<DnsTxtAppendPlanPreview> {
    const request = dnsTxtAppendPlanRequestSchema.parse(requestInput);
    const preview = dnsTxtAppendPlanPreviewSchema.parse(await this.#boundary.planTxtAppend(structuredClone(request)));
    if (
      preview.domainAssetId !== request.domainAssetId ||
      preview.verificationAttemptId !== request.verificationAttemptId ||
      preview.fqdn !== request.fqdn ||
      preview.challengeFingerprint !== request.challengeFingerprint ||
      preview.expectedRrsetHash !== request.expectedRrsetHash
    ) {
      throw new TypeError("DNS TXT plan preview does not match its request");
    }
    return structuredClone(preview);
  }
}
