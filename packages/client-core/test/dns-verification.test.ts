import { describe, expect, expectTypeOf, it } from "vitest";

import {
  ValidatingDnsQueryClient,
  ValidatingDnsTxtAppendPlanClient,
  dnsExecutionAvailabilitySchema,
  dnsQueryResultSchema,
  dnsTxtAppendPlanPreviewSchema,
  nameserverChangePlanPreviewSchema,
  type DnsExecutionAvailability,
  type DnsQueryBoundary,
  type DnsQueryResult,
  type DnsTxtAppendPlanBoundary,
  type DnsTxtAppendPlanPreview,
  type DnsTxtAppendPlanRequest,
} from "../src/dns/index";
import {
  ValidatingVerificationPlanClient,
  ValidatingVerificationQueryClient,
  projectDnsVerificationViewModel,
  verificationPlanPreviewSchema,
  verificationQueryResultSchema,
  type VerificationPlanBoundary,
  type VerificationPlanPreview,
  type VerificationPlanRequest,
  type VerificationQueryBoundary,
  type VerificationQueryResult,
} from "../src/verification/index";

const observedAt = "2026-08-17T05:00:00Z";
const fingerprint = `sha256:${"a".repeat(64)}`;
const rrsetHash = `sha256:${"b".repeat(64)}`;

function dnsResult(
  source: "active_local" | "standby_cloud",
  state: "normal" | "propagating" | "warning" = "normal",
): DnsQueryResult {
  return dnsQueryResultSchema.parse({
    schemaVersion: 1,
    workspaceId: "workspace-1",
    freshness: {
      source,
      serverRevision: 17,
      lastReplicationActivityAt: observedAt,
      lastSuccessfulProviderObservationAt: observedAt,
    },
    domains: [
      {
        domainAssetId: "domain-1",
        domain: "vault.io",
        delegatedNameservers: ["ada.ns.cloudflare.com", "bob.ns.cloudflare.com"],
        delegationStatus: state === "warning" ? "mismatch" : "healthy",
        provider: {
          kind: "connected",
          providerKind: "cloudflare",
          connectionId: "dns-connection-1",
          displayName: "Cloudflare",
        },
        recordHealth: state === "warning" ? "warning" : "healthy",
        propagationStatus: state === "propagating" ? "propagating" : state === "warning" ? "warning" : "current",
        records: [
          {
            recordId: "record-1",
            type: "TXT",
            host: "_atomverify",
            ttl: 3_600,
            classification: "verification_challenge_redacted",
            valuePreview: "atom-verify=8f2a…",
            challengeFingerprint: fingerprint,
          },
        ],
        lastCheckedAt: observedAt,
      },
    ],
  });
}

function verificationResult(
  source: "active_local" | "standby_cloud",
  status: VerificationQueryResult["attempts"][number]["status"] = "verified",
): VerificationQueryResult {
  const completed = status === "verified" || status === "cleanup_pending" || status === "retained";
  return verificationQueryResultSchema.parse({
    schemaVersion: 1,
    workspaceId: "workspace-1",
    freshness: {
      source,
      serverRevision: 17,
      lastReplicationActivityAt: observedAt,
      lastSuccessfulProviderObservationAt: observedAt,
    },
    attempts: [
      {
        attemptId: "attempt-1",
        domainAssetId: "domain-1",
        status,
        method: "txt",
        challenge: {
          recordType: "TXT",
          host: "_atomverify",
          valuePreview: "atom-verify=8f2a…",
          fingerprint,
        },
        evidenceSource: completed ? "api" : "none",
        lastCheckedAt: observedAt,
        verifiedAt: completed ? observedAt : null,
        expiresAt: null,
      },
    ],
  });
}

function dnsBoundary(value: unknown): DnsQueryBoundary {
  return { getDnsHealth: async () => structuredClone(value) };
}

function verificationBoundary(value: unknown): VerificationQueryBoundary {
  return { getOwnershipVerification: async () => structuredClone(value) };
}

describe("DNS query boundary", () => {
  it("accepts strict Active and Standby reads without granting actions", async () => {
    await expect(new ValidatingDnsQueryClient(dnsBoundary(dnsResult("active_local")), "active_local").getDnsHealth())
      .resolves.toEqual(dnsResult("active_local"));
    await expect(new ValidatingDnsQueryClient(dnsBoundary(dnsResult("standby_cloud")), "standby_cloud").getDnsHealth())
      .resolves.toEqual(dnsResult("standby_cloud"));
    expectTypeOf<keyof DnsQueryResult>().not.toEqualTypeOf<"admittedActions">();
  });

  it("fails closed for unknown provider, status, record type, and extra fields", async () => {
    const base = dnsResult("active_local") as any;
    const corruptions = [
      { ...base, domains: [{ ...base.domains[0], provider: { kind: "connected", providerKind: "mystery", connectionId: "x", displayName: "Mystery" } }] },
      { ...base, domains: [{ ...base.domains[0], propagationStatus: "unknown" }] },
      { ...base, domains: [{ ...base.domains[0], records: [{ ...base.domains[0].records[0], type: "CAA" }] }] },
      { ...base, connectorSecret: "must-not-pass" },
    ];
    for (const corruption of corruptions) {
      await expect(new ValidatingDnsQueryClient(dnsBoundary(corruption), "active_local").getDnsHealth()).rejects.toThrow();
    }
  });

  it("rejects an unredacted verification TXT and wrong provenance", async () => {
    const base = dnsResult("active_local");
    const unredacted = {
      ...base,
      domains: [{
        ...base.domains[0],
        records: [{
          recordId: "record-1",
          type: "TXT",
          host: "_atomverify",
          ttl: 3_600,
          classification: "ordinary",
          value: "raw-challenge-must-not-cross-boundary",
        }],
      }],
    };
    await expect(new ValidatingDnsQueryClient(dnsBoundary(unredacted), "active_local").getDnsHealth()).rejects.toThrow();
    await expect(
      new ValidatingDnsQueryClient(dnsBoundary(dnsResult("standby_cloud")), "active_local").getDnsHealth(),
    ).rejects.toThrow("expected active_local freshness");
  });
});

describe("TXT append planning safety", () => {
  const request: DnsTxtAppendPlanRequest = {
    schemaVersion: 1,
    domainAssetId: "domain-1",
    verificationAttemptId: "attempt-1",
    fqdn: "_atomverify.vault.io",
    challengeRef: "challenge-ref-1",
    challengeFingerprint: fingerprint,
    expectedRrsetHash: rrsetHash,
    observedAt,
    intent: "append_verification_value",
  };
  const preview: DnsTxtAppendPlanPreview = dnsTxtAppendPlanPreviewSchema.parse({
    schemaVersion: 1,
    planId: "plan-1",
    domainAssetId: request.domainAssetId,
    verificationAttemptId: request.verificationAttemptId,
    fqdn: request.fqdn,
    recordType: "TXT",
    valuePreview: "atom-verify=8f2a…",
    challengeFingerprint: fingerprint,
    writeMode: "append_preserving_rrset",
    existingValueCount: 3,
    existingValuesPreserved: true,
    overwritesExistingValues: false,
    requiresFreshRrsetRead: true,
    expectedRrsetHash: rrsetHash,
    risk: "caution",
    itemCount: 1,
  });

  function planBoundary(value: unknown): DnsTxtAppendPlanBoundary {
    return { planTxtAppend: async () => structuredClone(value) };
  }

  it("locks every TXT plan to append, preserve, re-read, and never overwrite", async () => {
    await expect(new ValidatingDnsTxtAppendPlanClient(planBoundary(preview)).planTxtAppend(request)).resolves.toEqual(preview);
    expect(preview).toMatchObject({
      writeMode: "append_preserving_rrset",
      existingValuesPreserved: true,
      overwritesExistingValues: false,
      requiresFreshRrsetRead: true,
    });
  });

  it("rejects overwrite semantics and confused request identity", async () => {
    for (const corrupt of [
      { ...preview, writeMode: "replace_rrset" },
      { ...preview, overwritesExistingValues: true },
      { ...preview, existingValuesPreserved: false },
      { ...preview, requiresFreshRrsetRead: false },
    ]) {
      await expect(new ValidatingDnsTxtAppendPlanClient(planBoundary(corrupt)).planTxtAppend(request)).rejects.toThrow();
    }
    await expect(
      new ValidatingDnsTxtAppendPlanClient(planBoundary({ ...preview, domainAssetId: "domain-2" })).planTxtAppend(request),
    ).rejects.toThrow("does not match its request");
  });
});

describe("Nameserver preview safety", () => {
  const preview = {
    schemaVersion: 1,
    planId: "ns-plan-1",
    domainAssetId: "domain-1",
    registrarDisplayName: "Spaceship",
    currentNameservers: ["ns1.old.example", "ns2.old.example"],
    targetNameservers: ["ada.ns.cloudflare.com", "bob.ns.cloudflare.com"],
    risk: "high",
    requiresExplicitAcknowledgement: true,
    operationOwner: "registration",
    mayInterruptResolution: true,
    mayInterruptMail: true,
    propagationRequiredForRollback: true,
    itemCount: 1,
  } as const;

  it("accepts only a Registration-owned high-risk preview with explicit acknowledgement", () => {
    expect(nameserverChangePlanPreviewSchema.parse(preview)).toEqual(preview);
    for (const corruption of [
      { ...preview, risk: "caution" },
      { ...preview, requiresExplicitAcknowledgement: false },
      { ...preview, operationOwner: "dns" },
      { ...preview, mayInterruptMail: false },
    ]) {
      expect(nameserverChangePlanPreviewSchema.safeParse(corruption).success).toBe(false);
    }
  });
});

describe("Verification boundaries and projection", () => {
  it("fails closed for unknown attempt/evidence shapes and wrong provenance", async () => {
    const base = verificationResult("active_local") as any;
    for (const corruption of [
      { ...base, attempts: [{ ...base.attempts[0], status: "mystery" }] },
      { ...base, attempts: [{ ...base.attempts[0], evidenceSource: "scraped_dom" }] },
      { ...base, rawChallenge: "must-not-pass" },
    ]) {
      await expect(
        new ValidatingVerificationQueryClient(verificationBoundary(corruption), "active_local")
          .getOwnershipVerification(),
      ).rejects.toThrow();
    }
    await expect(
      new ValidatingVerificationQueryClient(verificationBoundary(verificationResult("standby_cloud")), "active_local")
        .getOwnershipVerification(),
    ).rejects.toThrow("expected active_local freshness");
  });

  it("projects normal, propagating, and warning states", () => {
    const active: DnsExecutionAvailability = {
      surface: "active",
      admittedActions: [
        { domainAssetId: "domain-1", action: "reverify_ownership" },
        { domainAssetId: "domain-1", action: "plan_txt_append" },
        { domainAssetId: "domain-1", action: "plan_nameserver_change" },
      ],
    };
    expect(projectDnsVerificationViewModel(
      dnsResult("active_local", "normal"),
      verificationResult("active_local", "verified"),
      active,
    ).state).toBe("normal");
    expect(projectDnsVerificationViewModel(
      dnsResult("active_local", "propagating"),
      verificationResult("active_local", "waiting_dns"),
      active,
    ).state).toBe("propagating");
    const warning = projectDnsVerificationViewModel(
      dnsResult("active_local", "warning"),
      verificationResult("active_local", "expired"),
      active,
    );
    expect(warning.state).toBe("warning");
    expect(warning.rows[0]?.availableActions).toEqual([
      "plan_txt_append",
      "plan_nameserver_change",
    ]);
  });

  it("never offers reverify for expired, unknown-outcome, or reacquisition states", () => {
    const availability: DnsExecutionAvailability = {
      surface: "active",
      admittedActions: [{ domainAssetId: "domain-1", action: "reverify_ownership" }],
    };
    for (const status of ["expired", "outcome_unknown", "requires_challenge_reacquisition"] as const) {
      const view = projectDnsVerificationViewModel(
        dnsResult("active_local", "warning"),
        verificationResult("active_local", status),
        availability,
      );
      expect(view.rows[0]?.availableActions).toEqual([]);
    }
  });

  it("keeps Standby reads byte-equivalent but strips all execution actions", () => {
    const standby = projectDnsVerificationViewModel(
      dnsResult("standby_cloud", "warning"),
      verificationResult("standby_cloud", "expired"),
      { surface: "standby_read_only", admittedActions: [] },
    );
    expect(standby.readSource).toBe("standby_cloud");
    expect(standby.rows).toHaveLength(1);
    expect(standby.rows[0]?.availableActions).toEqual([]);
    expect(dnsExecutionAvailabilitySchema.safeParse({
      surface: "standby_read_only",
      admittedActions: [{ domainAssetId: "domain-1", action: "reverify_ownership" }],
    }).success).toBe(false);
  });

  it("rejects stale or partial DNS/verification joins", () => {
    expect(() => projectDnsVerificationViewModel(
      dnsResult("active_local"),
      { ...verificationResult("active_local"), freshness: { ...verificationResult("active_local").freshness, serverRevision: 16 } },
      { surface: "active", admittedActions: [] },
    )).toThrow("must share workspace, source, and Server Revision");
    expect(() => projectDnsVerificationViewModel(
      dnsResult("active_local"),
      { ...verificationResult("active_local"), attempts: [] },
      { surface: "active", admittedActions: [] },
    )).toThrow("must cover the same domains");
    expect(() => projectDnsVerificationViewModel(
      dnsResult("active_local"),
      verificationResult("active_local"),
      { surface: "active", admittedActions: [{ domainAssetId: "domain-2", action: "reverify_ownership" }] },
    )).toThrow("references an unread domain");
  });
});

describe("Verification plan boundary", () => {
  const request: VerificationPlanRequest = {
    schemaVersion: 1,
    domainAssetId: "domain-1",
    verificationAttemptId: "attempt-1",
    intent: "recheck_remote_evidence",
  };
  const preview: VerificationPlanPreview = verificationPlanPreviewSchema.parse({
    schemaVersion: 1,
    planId: "verify-plan-1",
    domainAssetId: "domain-1",
    verificationAttemptId: "attempt-1",
    effect: "read_only_remote_check",
    risk: "none",
    requiresApproval: false,
    itemCount: 1,
  });
  function planBoundary(value: unknown): VerificationPlanBoundary {
    return { planReverification: async () => structuredClone(value) };
  }

  it("plans a read-only evidence recheck without claiming verification success", async () => {
    await expect(new ValidatingVerificationPlanClient(planBoundary(preview)).planReverification(request))
      .resolves.toEqual(preview);
    expect(preview).toMatchObject({ effect: "read_only_remote_check", requiresApproval: false });
    expect(preview).not.toHaveProperty("status", "verified");
  });

  it("rejects unknown effects and mismatched attempts", async () => {
    await expect(
      new ValidatingVerificationPlanClient(planBoundary({ ...preview, effect: "mark_verified" })).planReverification(request),
    ).rejects.toThrow();
    await expect(
      new ValidatingVerificationPlanClient(planBoundary({ ...preview, verificationAttemptId: "attempt-2" }))
        .planReverification(request),
    ).rejects.toThrow("does not match its request");
  });
});
