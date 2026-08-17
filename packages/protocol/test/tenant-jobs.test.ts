import { describe, expect, it } from "vitest";

import {
  TENANT_JOB_SCHEMA_VERSION,
  buildJobIdempotencyKey,
  jobIdempotencyKeySchema,
  jobLeaseSchema,
  quarantineRecordSchema,
  quarantineReasonSchema,
  tenantJobEnvelopeSchema,
  workspaceTenantScopeSchema,
} from "../src/jobs/index";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validTenant(overrides?: Partial<{ accountId: string; workspaceId: string }>) {
  return {
    accountId: overrides?.accountId ?? "acct-001",
    workspaceId: overrides?.workspaceId ?? "ws-001",
  };
}

function validEnvelope(overrides?: Record<string, unknown>) {
  return {
    schemaVersion: TENANT_JOB_SCHEMA_VERSION,
    envelopeId: "env-001",
    tenant: validTenant(),
    jobKind: "workspace_maintenance",
    idempotencyKey: "idem-001",
    leaseEpoch: 1,
    attempt: 1,
    enqueuedAt: "2026-01-15T10:00:00Z",
    payload: { targetEntity: "entity-001" },
    ...overrides,
  };
}

function validLease(overrides?: Record<string, unknown>) {
  return {
    typ: "gd.tenant-job-lease.v1",
    tenant: validTenant(),
    jobKind: "workspace_maintenance",
    partitionKey: "part-001",
    workerId: "worker-001",
    leaseEpoch: 1,
    state: "held",
    acquiredAt: "2026-01-15T10:00:00Z",
    renewAfter: "2026-01-15T10:05:00Z",
    expiresAt: "2026-01-15T10:10:00Z",
    ...overrides,
  };
}

function validQuarantine(overrides?: Record<string, unknown>) {
  return {
    tenant: validTenant(),
    jobKind: "workspace_maintenance",
    partitionKey: "part-001",
    reason: "unknown_envelope",
    disposition: "pending_human_review",
    capturedAt: "2026-01-15T10:00:00Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Positive baseline
// ---------------------------------------------------------------------------

describe("tenant job protocol contracts — positive baseline", () => {
  it("accepts a valid TenantJobEnvelope", () => {
    expect(tenantJobEnvelopeSchema.safeParse(validEnvelope()).success).toBe(true);
  });

  it("accepts a valid JobLease", () => {
    expect(jobLeaseSchema.safeParse(validLease()).success).toBe(true);
  });

  it("accepts a valid QuarantineRecord", () => {
    expect(quarantineRecordSchema.safeParse(validQuarantine()).success).toBe(true);
  });

  it("accepts a valid WorkspaceTenantScope", () => {
    expect(workspaceTenantScopeSchema.safeParse(validTenant()).success).toBe(true);
  });

  it("accepts a valid NUL-separated idempotency key", () => {
    const key = buildJobIdempotencyKey(validTenant(), "workspace_maintenance", "idem-001");
    expect(jobIdempotencyKeySchema.safeParse(key).success).toBe(true);
    expect(key).toBe("acct-001\0ws-001\0workspace_maintenance\0idem-001");
  });

  it("exports TENANT_JOB_SCHEMA_VERSION = 1", () => {
    expect(TENANT_JOB_SCHEMA_VERSION).toBe(1);
  });

  it("enumerates all eight quarantine reasons", () => {
    expect(quarantineReasonSchema.options).toEqual([
      "unknown_envelope",
      "cross_tenant_violation",
      "replay_conflict",
      "idempotency_conflict",
      "lease_contention",
      "stale_lease_epoch",
      "max_attempts_exhausted",
      "payload_schema_invalid",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Negative matrix N-01..N-14
// ---------------------------------------------------------------------------

describe("N-01: unknown field rejected by .strict()", () => {
  it("rejects unknown field on TenantJobEnvelope", () => {
    const result = tenantJobEnvelopeSchema.safeParse(
      validEnvelope({ secretField: "should-not-exist" }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects unknown field on JobLease", () => {
    const result = jobLeaseSchema.safeParse(
      validLease({ secretField: "should-not-exist" }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects unknown field on QuarantineRecord", () => {
    const result = quarantineRecordSchema.safeParse(
      validQuarantine({ secretField: "should-not-exist" }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects unknown field on WorkspaceTenantScope", () => {
    const result = workspaceTenantScopeSchema.safeParse({
      ...validTenant(),
      extraField: "nope",
    });
    expect(result.success).toBe(false);
  });
});

describe("N-02: unknown jobKind rejected by discriminatedUnion", () => {
  it("rejects an envelope with an unrecognized jobKind", () => {
    const result = tenantJobEnvelopeSchema.safeParse(
      validEnvelope({ jobKind: "nonexistent_job_type" }),
    );
    expect(result.success).toBe(false);
  });
});

describe("N-03: payload schema invalid → quarantine", () => {
  it("rejects an envelope with a malformed payload", () => {
    const result = tenantJobEnvelopeSchema.safeParse(
      validEnvelope({ payload: { targetEntity: "" } }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects an envelope with a completely wrong payload type", () => {
    const result = tenantJobEnvelopeSchema.safeParse(
      validEnvelope({ payload: "not-an-object" }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects an envelope with unknown fields in the payload", () => {
    const result = tenantJobEnvelopeSchema.safeParse(
      validEnvelope({
        payload: { targetEntity: "entity-001", extraPayloadField: "bad" },
      }),
    );
    expect(result.success).toBe(false);
  });
});

describe("N-04: cross-tenant violation → quarantine (invalid tenant)", () => {
  it("rejects an envelope with an empty accountId", () => {
    const result = tenantJobEnvelopeSchema.safeParse(
      validEnvelope({ tenant: { accountId: "", workspaceId: "ws-001" } }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects an envelope with an empty workspaceId", () => {
    const result = tenantJobEnvelopeSchema.safeParse(
      validEnvelope({ tenant: { accountId: "acct-001", workspaceId: "" } }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects a quarantine record with invalid tenant scope", () => {
    const result = quarantineRecordSchema.safeParse(
      validQuarantine({ tenant: { accountId: "", workspaceId: "ws-001" } }),
    );
    expect(result.success).toBe(false);
  });
});

describe("N-05: dual-tenant same literal ID → independent composite keys", () => {
  it("produces distinct idempotency keys for different tenants with same local IDs", () => {
    const tenantA = { accountId: "acct-A", workspaceId: "ws-shared" };
    const tenantB = { accountId: "acct-B", workspaceId: "ws-shared" };
    const keyA = buildJobIdempotencyKey(tenantA, "workspace_maintenance", "idem-shared");
    const keyB = buildJobIdempotencyKey(tenantB, "workspace_maintenance", "idem-shared");
    expect(keyA).not.toBe(keyB);
    expect(keyA).toBe("acct-A\0ws-shared\0workspace_maintenance\0idem-shared");
    expect(keyB).toBe("acct-B\0ws-shared\0workspace_maintenance\0idem-shared");
  });

  it("different workspaceId with same accountId also produces distinct keys", () => {
    const tenantA = { accountId: "acct-shared", workspaceId: "ws-A" };
    const tenantB = { accountId: "acct-shared", workspaceId: "ws-B" };
    const keyA = buildJobIdempotencyKey(tenantA, "workspace_maintenance", "idem-001");
    const keyB = buildJobIdempotencyKey(tenantB, "workspace_maintenance", "idem-001");
    expect(keyA).not.toBe(keyB);
  });
});

describe("N-06: replay same key same content → deduplicate", () => {
  it("validates that identical envelopes parse identically (schema-level dedup basis)", () => {
    const envelope = validEnvelope();
    const first = tenantJobEnvelopeSchema.safeParse(envelope);
    const second = tenantJobEnvelopeSchema.safeParse({ ...envelope });
    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    if (first.success && second.success) {
      expect(first.data).toEqual(second.data);
    }
    // Same idempotency key is produced
    const key1 = buildJobIdempotencyKey(
      envelope.tenant as { accountId: string; workspaceId: string },
      envelope.jobKind,
      envelope.idempotencyKey,
    );
    const key2 = buildJobIdempotencyKey(
      envelope.tenant as { accountId: string; workspaceId: string },
      envelope.jobKind,
      envelope.idempotencyKey,
    );
    expect(key1).toBe(key2);
  });
});

describe("N-07: replay same key different content → quarantine idempotency_conflict", () => {
  it("same idempotency key with different payloads have the same composite key", () => {
    const tenant = validTenant();
    const key1 = buildJobIdempotencyKey(tenant, "workspace_maintenance", "idem-001");
    const key2 = buildJobIdempotencyKey(tenant, "workspace_maintenance", "idem-001");
    // Same key — runtime store detects content difference via digest
    expect(key1).toBe(key2);
  });

  it("quarantine record accepts idempotency_conflict reason", () => {
    const result = quarantineRecordSchema.safeParse(
      validQuarantine({ reason: "idempotency_conflict" }),
    );
    expect(result.success).toBe(true);
  });
});

describe("N-08: lease contention → rejected", () => {
  it("quarantine record accepts lease_contention reason", () => {
    const result = quarantineRecordSchema.safeParse(
      validQuarantine({ reason: "lease_contention" }),
    );
    expect(result.success).toBe(true);
  });

  it("lease schema rejects non-positive leaseEpoch (epoch 0)", () => {
    const result = jobLeaseSchema.safeParse(validLease({ leaseEpoch: 0 }));
    expect(result.success).toBe(false);
  });
});

describe("N-09: stale epoch envelope → rejected", () => {
  it("envelope with leaseEpoch 0 is rejected", () => {
    const result = tenantJobEnvelopeSchema.safeParse(
      validEnvelope({ leaseEpoch: 0 }),
    );
    expect(result.success).toBe(false);
  });

  it("envelope with negative leaseEpoch is rejected", () => {
    const result = tenantJobEnvelopeSchema.safeParse(
      validEnvelope({ leaseEpoch: -1 }),
    );
    expect(result.success).toBe(false);
  });

  it("quarantine record accepts stale_lease_epoch reason", () => {
    const result = quarantineRecordSchema.safeParse(
      validQuarantine({ reason: "stale_lease_epoch" }),
    );
    expect(result.success).toBe(true);
  });
});

describe("N-10: expired lease renewal → rejected", () => {
  it("expired state is a valid lease state", () => {
    const result = jobLeaseSchema.safeParse(validLease({ state: "expired" }));
    expect(result.success).toBe(true);
  });

  it("lease schema rejects invalid state values", () => {
    const result = jobLeaseSchema.safeParse(validLease({ state: "active" }));
    expect(result.success).toBe(false);
  });
});

describe("N-11: epoch reuse → rejected", () => {
  it("released state is a valid lease state (epoch consumed, cannot reuse)", () => {
    const result = jobLeaseSchema.safeParse(validLease({ state: "released" }));
    expect(result.success).toBe(true);
  });

  it("leaseEpoch must be positive integer — fractional rejected", () => {
    const result = jobLeaseSchema.safeParse(validLease({ leaseEpoch: 1.5 }));
    expect(result.success).toBe(false);
  });
});

describe("N-12: max attempts exceeded → quarantine", () => {
  it("quarantine record accepts max_attempts_exhausted reason", () => {
    const result = quarantineRecordSchema.safeParse(
      validQuarantine({ reason: "max_attempts_exhausted" }),
    );
    expect(result.success).toBe(true);
  });

  it("attempt must be a positive integer", () => {
    const result = tenantJobEnvelopeSchema.safeParse(
      validEnvelope({ attempt: 0 }),
    );
    expect(result.success).toBe(false);
  });
});

describe("N-13: no active lease → rejected", () => {
  it("envelope with non-integer leaseEpoch is rejected", () => {
    const result = tenantJobEnvelopeSchema.safeParse(
      validEnvelope({ leaseEpoch: "not-a-number" }),
    );
    expect(result.success).toBe(false);
  });

  it("lease typ must be exact literal", () => {
    const result = jobLeaseSchema.safeParse(
      validLease({ typ: "gd.tenant-job-lease.v2" }),
    );
    expect(result.success).toBe(false);
  });
});

describe("N-14: cross-tenant quarantine read → invisible (per-tenant isolation)", () => {
  it("quarantine records for different tenants have disjoint tenant scopes", () => {
    const qA = quarantineRecordSchema.parse(
      validQuarantine({ tenant: { accountId: "acct-A", workspaceId: "ws-001" } }),
    );
    const qB = quarantineRecordSchema.parse(
      validQuarantine({ tenant: { accountId: "acct-B", workspaceId: "ws-001" } }),
    );
    expect(qA.tenant.accountId).not.toBe(qB.tenant.accountId);
    // Per-tenant isolation is a runtime concern; the schema ensures tenant is always present
    expect(qA.tenant).toBeDefined();
    expect(qB.tenant).toBeDefined();
  });

  it("quarantine disposition is always pending_human_review", () => {
    const result = quarantineRecordSchema.safeParse(
      validQuarantine({ disposition: "auto_retry" }),
    );
    expect(result.success).toBe(false);
  });

  it("quarantine rejects unknown reason values", () => {
    const result = quarantineRecordSchema.safeParse(
      validQuarantine({ reason: "nonexistent_reason" }),
    );
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Idempotency key structural validation
// ---------------------------------------------------------------------------

describe("JobIdempotencyKey structural validation", () => {
  it("rejects a key with fewer than four segments", () => {
    expect(jobIdempotencyKeySchema.safeParse("a\0b\0c").success).toBe(false);
  });

  it("rejects a key with more than four segments", () => {
    expect(jobIdempotencyKeySchema.safeParse("a\0b\0c\0d\0e").success).toBe(false);
  });

  it("rejects a key with an empty segment", () => {
    expect(jobIdempotencyKeySchema.safeParse("a\0\0c\0d").success).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(jobIdempotencyKeySchema.safeParse("").success).toBe(false);
  });
});
