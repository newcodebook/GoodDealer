import { serverRevisionSchema } from "@gooddealer/protocol/workspace";
import { canonicalUtcTimestamp, identifier } from "@gooddealer/protocol/wire";
import { z } from "zod";

import {
  dnsExecutionAvailabilitySchema,
  dnsQueryResultSchema,
  dnsQuerySourceSchema,
  type DnsExecutionAction,
  type DnsExecutionAvailability,
  type DnsQueryResult,
  type DnsQuerySource,
  type DnsRecordSummary,
} from "../dns/index";

const verificationValuePreviewSchema = z
  .string()
  .min(1)
  .max(128)
  .refine((value) => value.includes("…"), "verification challenge previews must remain redacted")
  .refine((value) => !/[\p{Cc}\p{Cf}]/u.test(value), "verification previews reject control characters");

const sha256FingerprintSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);

export const verificationAttemptStatusSchema = z.enum([
  "acquiring_challenge",
  "waiting_user_login",
  "ready_to_plan",
  "waiting_approval",
  "writing_dns",
  "changing_nameserver",
  "manual_action_required",
  "waiting_dns",
  "ready_to_verify",
  "verifying",
  "waiting_remote",
  "verified",
  "expired",
  "cancelled",
  "outcome_unknown",
  "requires_challenge_reacquisition",
  "cleanup_pending",
  "retained",
]);

export const ownershipStatusSchema = z.enum(["verified", "pending", "failed"]);

export const verificationChallengeSummarySchema = z
  .object({
    recordType: z.literal("TXT"),
    host: z
      .string()
      .min(1)
      .max(253)
      .refine((value) => !/[\p{Cc}\p{Cf}]/u.test(value), "verification hosts reject control characters"),
    valuePreview: verificationValuePreviewSchema,
    fingerprint: sha256FingerprintSchema,
  })
  .strict();

export const verificationReadFreshnessSchema = z
  .object({
    source: dnsQuerySourceSchema,
    serverRevision: serverRevisionSchema,
    lastReplicationActivityAt: canonicalUtcTimestamp.nullable(),
    lastSuccessfulProviderObservationAt: canonicalUtcTimestamp.nullable(),
  })
  .strict();

export const verificationAttemptSummarySchema = z
  .object({
    attemptId: identifier,
    domainAssetId: identifier,
    status: verificationAttemptStatusSchema,
    method: z.enum(["txt", "nameserver", "manual"]),
    challenge: verificationChallengeSummarySchema.nullable(),
    evidenceSource: z.enum(["api", "official_result", "official_page", "user_confirmed", "none"]),
    lastCheckedAt: canonicalUtcTimestamp.nullable(),
    verifiedAt: canonicalUtcTimestamp.nullable(),
    expiresAt: canonicalUtcTimestamp.nullable(),
  })
  .strict()
  .superRefine((attempt, context) => {
    const completed = attempt.status === "verified" || attempt.status === "cleanup_pending" || attempt.status === "retained";
    if (completed !== (attempt.verifiedAt !== null)) {
      context.addIssue({
        code: "custom",
        path: ["verifiedAt"],
        message: "only completed verification states carry verifiedAt",
      });
    }
    if (attempt.method !== "txt" && attempt.challenge !== null) {
      context.addIssue({
        code: "custom",
        path: ["challenge"],
        message: "only TXT attempts expose a redacted DNS challenge summary",
      });
    }
  });

export const verificationQueryResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    workspaceId: identifier,
    attempts: z.array(verificationAttemptSummarySchema).max(10_000),
    freshness: verificationReadFreshnessSchema,
  })
  .strict()
  .superRefine((result, context) => {
    const attemptIds = new Set<string>();
    const domainIds = new Set<string>();
    for (const [index, attempt] of result.attempts.entries()) {
      if (attemptIds.has(attempt.attemptId)) {
        context.addIssue({ code: "custom", path: ["attempts", index, "attemptId"], message: "duplicate attemptId" });
      }
      if (domainIds.has(attempt.domainAssetId)) {
        context.addIssue({
          code: "custom",
          path: ["attempts", index, "domainAssetId"],
          message: "only one current verification attempt is allowed per domain",
        });
      }
      attemptIds.add(attempt.attemptId);
      domainIds.add(attempt.domainAssetId);
    }
  });

export const verificationPlanRequestSchema = z
  .object({
    schemaVersion: z.literal(1),
    domainAssetId: identifier,
    verificationAttemptId: identifier,
    intent: z.literal("recheck_remote_evidence"),
  })
  .strict();

export const verificationPlanPreviewSchema = z
  .object({
    schemaVersion: z.literal(1),
    planId: identifier,
    domainAssetId: identifier,
    verificationAttemptId: identifier,
    effect: z.literal("read_only_remote_check"),
    risk: z.literal("none"),
    requiresApproval: z.literal(false),
    itemCount: z.literal(1),
  })
  .strict();

export type VerificationAttemptStatus = z.infer<typeof verificationAttemptStatusSchema>;
export type OwnershipStatus = z.infer<typeof ownershipStatusSchema>;
export type VerificationChallengeSummary = z.infer<typeof verificationChallengeSummarySchema>;
export type VerificationAttemptSummary = z.infer<typeof verificationAttemptSummarySchema>;
export type VerificationQueryResult = z.infer<typeof verificationQueryResultSchema>;
export type VerificationPlanRequest = z.infer<typeof verificationPlanRequestSchema>;
export type VerificationPlanPreview = z.infer<typeof verificationPlanPreviewSchema>;

export interface VerificationQueryPort {
  getOwnershipVerification(): Promise<VerificationQueryResult>;
}

export interface VerificationQueryBoundary {
  getOwnershipVerification(): Promise<unknown>;
}

/** Strict boundary decoder; it supplies no connector, network, or fixture authority. */
export class ValidatingVerificationQueryClient implements VerificationQueryPort {
  readonly #boundary: VerificationQueryBoundary;
  readonly #expectedSource: DnsQuerySource;

  constructor(boundary: VerificationQueryBoundary, expectedSource: DnsQuerySource) {
    this.#boundary = boundary;
    this.#expectedSource = expectedSource;
  }

  async getOwnershipVerification(): Promise<VerificationQueryResult> {
    const result = verificationQueryResultSchema.parse(await this.#boundary.getOwnershipVerification());
    if (result.freshness.source !== this.#expectedSource) {
      throw new TypeError(`verification query expected ${this.#expectedSource} freshness`);
    }
    return structuredClone(result);
  }
}

export interface VerificationPlanPort {
  planReverification(request: VerificationPlanRequest): Promise<VerificationPlanPreview>;
}

export interface VerificationPlanBoundary {
  planReverification(request: VerificationPlanRequest): Promise<unknown>;
}

export class ValidatingVerificationPlanClient implements VerificationPlanPort {
  readonly #boundary: VerificationPlanBoundary;

  constructor(boundary: VerificationPlanBoundary) {
    this.#boundary = boundary;
  }

  async planReverification(requestInput: VerificationPlanRequest): Promise<VerificationPlanPreview> {
    const request = verificationPlanRequestSchema.parse(requestInput);
    const preview = verificationPlanPreviewSchema.parse(
      await this.#boundary.planReverification(structuredClone(request)),
    );
    if (
      preview.domainAssetId !== request.domainAssetId ||
      preview.verificationAttemptId !== request.verificationAttemptId
    ) {
      throw new TypeError("verification plan preview does not match its request");
    }
    return structuredClone(preview);
  }
}

export type DnsVerificationScreenState = "normal" | "propagating" | "warning";

export interface DnsVerificationRowViewModel {
  readonly domainAssetId: string;
  readonly domain: string;
  readonly ownershipStatus: OwnershipStatus;
  readonly verificationAttemptId: string;
  readonly verificationStatus: VerificationAttemptStatus;
  readonly challenge: VerificationChallengeSummary | null;
  readonly delegatedNameservers: readonly string[];
  readonly delegationStatus: "healthy" | "mismatch" | "unresolved";
  readonly recordHealth: "healthy" | "warning" | "missing";
  readonly providerDisplayName: string;
  readonly providerResolved: boolean;
  readonly propagationStatus: "current" | "propagating" | "warning";
  readonly lastCheckedAt: string | null;
  readonly records: readonly DnsRecordSummary[];
  readonly availableActions: readonly DnsExecutionAction[];
}

export interface DnsVerificationViewModel {
  readonly state: DnsVerificationScreenState;
  readonly readSource: DnsQuerySource;
  readonly serverRevision: number;
  readonly lastReplicationActivityAt: string | null;
  readonly lastSuccessfulProviderObservationAt: string | null;
  readonly metrics: {
    readonly verified: number;
    readonly pendingOrFailed: number;
    readonly nameserverIssues: number;
    readonly recordIssues: number;
    readonly propagating: number;
  };
  readonly rows: readonly DnsVerificationRowViewModel[];
}

function projectOwnershipStatus(status: VerificationAttemptStatus): OwnershipStatus {
  switch (status) {
    case "verified":
    case "cleanup_pending":
    case "retained":
      return "verified";
    case "expired":
    case "cancelled":
    case "outcome_unknown":
    case "requires_challenge_reacquisition":
      return "failed";
    case "acquiring_challenge":
    case "waiting_user_login":
    case "ready_to_plan":
    case "waiting_approval":
    case "writing_dns":
    case "changing_nameserver":
    case "manual_action_required":
    case "waiting_dns":
    case "ready_to_verify":
    case "verifying":
    case "waiting_remote":
      return "pending";
  }
}

function relevantActions(
  domainAssetId: string,
  ownershipStatus: OwnershipStatus,
  verificationStatus: VerificationAttemptStatus,
  dns: DnsQueryResult["domains"][number],
  availability: DnsExecutionAvailability,
): DnsExecutionAction[] {
  if (availability.surface !== "active") return [];
  const admitted = new Set(
    availability.admittedActions
      .filter((action) => action.domainAssetId === domainAssetId)
      .map((action) => action.action),
  );
  const result: DnsExecutionAction[] = [];
  const cannotReverify =
    verificationStatus === "expired" ||
    verificationStatus === "cancelled" ||
    verificationStatus === "outcome_unknown" ||
    verificationStatus === "requires_challenge_reacquisition";
  if (ownershipStatus !== "verified" && !cannotReverify && admitted.has("reverify_ownership")) {
    result.push("reverify_ownership");
  }
  if (dns.recordHealth !== "healthy" && admitted.has("plan_txt_append")) result.push("plan_txt_append");
  if (dns.delegationStatus !== "healthy" && admitted.has("plan_nameserver_change")) {
    result.push("plan_nameserver_change");
  }
  return result;
}

/**
 * Joins two already-validated read projections with separately adjudicated
 * action availability. It only reduces authority and rejects stale/misaligned joins.
 */
export function projectDnsVerificationViewModel(
  dnsInput: DnsQueryResult,
  verificationInput: VerificationQueryResult,
  availabilityInput: DnsExecutionAvailability,
): DnsVerificationViewModel {
  const dns = dnsQueryResultSchema.parse(dnsInput);
  const verification = verificationQueryResultSchema.parse(verificationInput);
  const availability = dnsExecutionAvailabilitySchema.parse(availabilityInput);

  if (
    dns.workspaceId !== verification.workspaceId ||
    dns.freshness.source !== verification.freshness.source ||
    dns.freshness.serverRevision !== verification.freshness.serverRevision
  ) {
    throw new TypeError("DNS and verification reads must share workspace, source, and Server Revision");
  }

  const attempts = new Map(verification.attempts.map((attempt) => [attempt.domainAssetId, attempt]));
  if (dns.domains.length !== attempts.size) {
    throw new TypeError("DNS and verification reads must cover the same domains");
  }
  if (availability.surface === "active") {
    const domainIds = new Set(dns.domains.map((domain) => domain.domainAssetId));
    if (availability.admittedActions.some((action) => !domainIds.has(action.domainAssetId))) {
      throw new TypeError("DNS execution availability references an unread domain");
    }
  }

  const rows = dns.domains.map((dnsDomain): DnsVerificationRowViewModel => {
    const attempt = attempts.get(dnsDomain.domainAssetId);
    if (!attempt) throw new TypeError(`missing verification attempt for ${dnsDomain.domainAssetId}`);
    const ownershipStatus = projectOwnershipStatus(attempt.status);
    return {
      domainAssetId: dnsDomain.domainAssetId,
      domain: dnsDomain.domain,
      ownershipStatus,
      verificationAttemptId: attempt.attemptId,
      verificationStatus: attempt.status,
      challenge: attempt.challenge === null ? null : { ...attempt.challenge },
      delegatedNameservers: [...dnsDomain.delegatedNameservers],
      delegationStatus: dnsDomain.delegationStatus,
      recordHealth: dnsDomain.recordHealth,
      providerDisplayName: dnsDomain.provider.displayName,
      providerResolved: dnsDomain.provider.kind === "connected",
      propagationStatus: dnsDomain.propagationStatus,
      lastCheckedAt: attempt.lastCheckedAt ?? dnsDomain.lastCheckedAt,
      records: structuredClone(dnsDomain.records),
      availableActions: relevantActions(
        dnsDomain.domainAssetId,
        ownershipStatus,
        attempt.status,
        dnsDomain,
        availability,
      ),
    };
  });

  const metrics = {
    verified: rows.filter((row) => row.ownershipStatus === "verified").length,
    pendingOrFailed: rows.filter((row) => row.ownershipStatus !== "verified").length,
    nameserverIssues: rows.filter((row) => row.delegationStatus !== "healthy").length,
    recordIssues: rows.filter((row) => row.recordHealth !== "healthy").length,
    propagating: rows.filter((row) => row.propagationStatus === "propagating").length,
  };
  const state: DnsVerificationScreenState = rows.some(
    (row) =>
      row.ownershipStatus === "failed" ||
      row.verificationStatus === "manual_action_required" ||
      row.delegationStatus !== "healthy" ||
      row.recordHealth !== "healthy" ||
      row.propagationStatus === "warning",
  )
    ? "warning"
    : metrics.propagating > 0
      ? "propagating"
      : "normal";

  return {
    state,
    readSource: dns.freshness.source,
    serverRevision: dns.freshness.serverRevision,
    lastReplicationActivityAt: dns.freshness.lastReplicationActivityAt,
    lastSuccessfulProviderObservationAt: dns.freshness.lastSuccessfulProviderObservationAt,
    metrics,
    rows,
  };
}
