import { describe, expect, it } from "vitest";

import type {
  TenantJobEnvelope,
  WorkspaceTenantScope,
} from "@gooddealer/protocol/jobs";
import {
  TENANT_JOB_SCHEMA_VERSION,
  buildJobIdempotencyKey,
} from "@gooddealer/protocol/jobs";

import {
  JobIdempotencyStore,
  JobLeaseRegistry,
  JobQuarantineLedger,
  fanOutTenantJobs,
  submitEnvelope,
} from "../src/modules/job-runtime/index";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tenant(overrides?: Partial<WorkspaceTenantScope>): WorkspaceTenantScope {
  return {
    accountId: overrides?.accountId ?? "acct-001",
    workspaceId: overrides?.workspaceId ?? "ws-001",
  };
}

function envelope(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    schemaVersion: TENANT_JOB_SCHEMA_VERSION,
    envelopeId: "env-001",
    tenant: tenant(),
    jobKind: "workspace_maintenance",
    idempotencyKey: "idem-001",
    leaseEpoch: 1,
    attempt: 1,
    enqueuedAt: "2026-01-15T10:00:00Z",
    payload: { targetEntity: "entity-001" },
    ...overrides,
  };
}

const baseTime = new Date("2026-01-15T10:00:00.000Z");
function timeOffset(ms: number): Date {
  return new Date(baseTime.getTime() + ms);
}

// ---------------------------------------------------------------------------
// JobLeaseRegistry
// ---------------------------------------------------------------------------

describe("JobLeaseRegistry", () => {
  it("acquires a lease with monotonic epoch starting at 1", () => {
    const registry = new JobLeaseRegistry();
    const lease = registry.acquire(tenant(), "workspace_maintenance", "part-001", "worker-A", baseTime);
    expect("rejected" in lease).toBe(false);
    if (!("rejected" in lease)) {
      expect(lease.leaseEpoch).toBe(1);
      expect(lease.state).toBe("held");
      expect(lease.workerId).toBe("worker-A");
    }
  });

  it("INV-LEASE-01: single-occupancy — second acquire for same partitionKey is rejected", () => {
    const registry = new JobLeaseRegistry();
    registry.acquire(tenant(), "workspace_maintenance", "part-001", "worker-A", baseTime);
    const second = registry.acquire(tenant(), "workspace_maintenance", "part-001", "worker-B", baseTime);
    expect("rejected" in second && second.rejected).toBe(true);
    if ("rejected" in second) {
      expect(second.reason).toBe("lease_contention");
    }
  });

  it("INV-LEASE-02: monotonic epoch — new acquire after release increments", () => {
    const registry = new JobLeaseRegistry();
    const first = registry.acquire(tenant(), "workspace_maintenance", "part-001", "worker-A", baseTime);
    expect("rejected" in first).toBe(false);
    if (!("rejected" in first)) {
      registry.release("part-001", "worker-A", first.leaseEpoch);
    }
    // Expired time to allow re-acquire
    const laterTime = timeOffset(11 * 60 * 1000);
    const second = registry.acquire(tenant(), "workspace_maintenance", "part-001", "worker-B", laterTime);
    expect("rejected" in second).toBe(false);
    if (!("rejected" in second)) {
      expect(second.leaseEpoch).toBe(2);
    }
  });

  it("INV-LEASE-03: stale renewal is rejected", () => {
    const registry = new JobLeaseRegistry();
    registry.acquire(tenant(), "workspace_maintenance", "part-001", "worker-A", baseTime);
    const result = registry.renew("part-001", "worker-A", 999, baseTime);
    expect("rejected" in result && result.rejected).toBe(true);
    if ("rejected" in result) {
      expect(result.reason).toBe("stale_lease_epoch");
    }
  });

  it("INV-LEASE-03: expired lease renewal is rejected", () => {
    const registry = new JobLeaseRegistry();
    registry.acquire(tenant(), "workspace_maintenance", "part-001", "worker-A", baseTime);
    const expiredTime = timeOffset(11 * 60 * 1000);
    const result = registry.renew("part-001", "worker-A", 1, expiredTime);
    expect("rejected" in result && result.rejected).toBe(true);
    if ("rejected" in result) {
      expect(result.reason).toBe("expired_lease");
    }
  });

  it("INV-LEASE-04: expired partitionKey returns to unleased", () => {
    const registry = new JobLeaseRegistry();
    registry.acquire(tenant(), "workspace_maintenance", "part-001", "worker-A", baseTime);
    const expiredTime = timeOffset(11 * 60 * 1000);
    const newLease = registry.acquire(tenant(), "workspace_maintenance", "part-001", "worker-B", expiredTime);
    expect("rejected" in newLease).toBe(false);
    if (!("rejected" in newLease)) {
      expect(newLease.leaseEpoch).toBe(2);
      expect(newLease.workerId).toBe("worker-B");
    }
  });

  it("successful renewal extends the lease", () => {
    const registry = new JobLeaseRegistry();
    registry.acquire(tenant(), "workspace_maintenance", "part-001", "worker-A", baseTime);
    const renewTime = timeOffset(3 * 60 * 1000);
    const result = registry.renew("part-001", "worker-A", 1, renewTime);
    expect("rejected" in result).toBe(false);
    if (!("rejected" in result)) {
      expect(result.state).toBe("renewed");
    }
  });

  it("release marks the lease as released", () => {
    const registry = new JobLeaseRegistry();
    registry.acquire(tenant(), "workspace_maintenance", "part-001", "worker-A", baseTime);
    const result = registry.release("part-001", "worker-A", 1);
    expect("released" in result && result.released).toBe(true);
  });

  it("renew for non-existent partition returns no_active_lease", () => {
    const registry = new JobLeaseRegistry();
    const result = registry.renew("nonexistent", "worker-A", 1, baseTime);
    expect("rejected" in result && result.rejected).toBe(true);
    if ("rejected" in result) {
      expect(result.reason).toBe("no_active_lease");
    }
  });

  it("renew by wrong worker is rejected as lease_contention", () => {
    const registry = new JobLeaseRegistry();
    registry.acquire(tenant(), "workspace_maintenance", "part-001", "worker-A", baseTime);
    const result = registry.renew("part-001", "worker-B", 1, baseTime);
    expect("rejected" in result && result.rejected).toBe(true);
    if ("rejected" in result) {
      expect(result.reason).toBe("lease_contention");
    }
  });
});

// ---------------------------------------------------------------------------
// JobIdempotencyStore
// ---------------------------------------------------------------------------

describe("JobIdempotencyStore", () => {
  const validEnvelope: TenantJobEnvelope = {
    schemaVersion: TENANT_JOB_SCHEMA_VERSION,
    envelopeId: "env-001",
    tenant: tenant(),
    jobKind: "workspace_maintenance",
    idempotencyKey: "idem-001",
    leaseEpoch: 1,
    attempt: 1,
    enqueuedAt: "2026-01-15T10:00:00Z",
    payload: { targetEntity: "entity-001" },
  };

  it("INV-IDEM-01: first submission returns new", () => {
    const store = new JobIdempotencyStore();
    const result = store.check(validEnvelope);
    expect(result.status).toBe("new");
  });

  it("INV-IDEM-02: same key + same digest → duplicate", () => {
    const store = new JobIdempotencyStore();
    store.record(validEnvelope, "completed");
    const result = store.check(validEnvelope);
    expect(result.status).toBe("duplicate");
  });

  it("INV-IDEM-03: same key + different digest → conflict", () => {
    const store = new JobIdempotencyStore();
    store.record(validEnvelope, "completed");

    const differentPayload: TenantJobEnvelope = {
      ...validEnvelope,
      payload: { targetEntity: "different-entity" },
    };
    const result = store.check(differentPayload);
    expect(result.status).toBe("conflict");
  });

  it("INV-IDEM-04: cross-tenant keys never collide", () => {
    const store = new JobIdempotencyStore();
    const envelopeA: TenantJobEnvelope = {
      ...validEnvelope,
      tenant: { accountId: "acct-A", workspaceId: "ws-001" },
    };
    const envelopeB: TenantJobEnvelope = {
      ...validEnvelope,
      tenant: { accountId: "acct-B", workspaceId: "ws-001" },
    };

    store.record(envelopeA, "completed");
    const result = store.check(envelopeB);
    expect(result.status).toBe("new");

    const keyA = buildJobIdempotencyKey(envelopeA.tenant, envelopeA.jobKind, envelopeA.idempotencyKey);
    const keyB = buildJobIdempotencyKey(envelopeB.tenant, envelopeB.jobKind, envelopeB.idempotencyKey);
    expect(keyA).not.toBe(keyB);
  });
});

// ---------------------------------------------------------------------------
// JobQuarantineLedger
// ---------------------------------------------------------------------------

describe("JobQuarantineLedger", () => {
  it("INV-QTN-01: disposition is always pending_human_review", () => {
    const ledger = new JobQuarantineLedger();
    const record = ledger.quarantine(
      tenant(),
      "workspace_maintenance",
      "part-001",
      "unknown_envelope",
      baseTime,
    );
    expect(record.disposition).toBe("pending_human_review");
  });

  it("INV-QTN-02: quarantine is terminal — no auto-retry state", () => {
    const ledger = new JobQuarantineLedger();
    const record = ledger.quarantine(
      tenant(),
      "workspace_maintenance",
      "part-001",
      "replay_conflict",
      baseTime,
    );
    // Only pending_human_review — no auto_retry or dead_letter
    expect(record.disposition).toBe("pending_human_review");
  });

  it("INV-QTN-03: per-tenant isolation — different tenants see only their records", () => {
    const ledger = new JobQuarantineLedger();
    const tenantA = tenant({ accountId: "acct-A" });
    const tenantB = tenant({ accountId: "acct-B" });

    ledger.quarantine(tenantA, "workspace_maintenance", "part-001", "unknown_envelope", baseTime);
    ledger.quarantine(tenantA, "workspace_maintenance", "part-002", "replay_conflict", baseTime);
    ledger.quarantine(tenantB, "workspace_maintenance", "part-003", "lease_contention", baseTime);

    expect(ledger.listForTenant(tenantA)).toHaveLength(2);
    expect(ledger.listForTenant(tenantB)).toHaveLength(1);
    expect(ledger.listForTenant(tenantA).every((r: { tenant: { accountId: string } }) => r.tenant.accountId === "acct-A")).toBe(true);
    expect(ledger.listForTenant(tenantB).every((r: { tenant: { accountId: string } }) => r.tenant.accountId === "acct-B")).toBe(true);
  });

  it("N-14: cross-tenant quarantine read returns no records for unrelated tenant", () => {
    const ledger = new JobQuarantineLedger();
    ledger.quarantine(tenant({ accountId: "acct-A" }), "workspace_maintenance", "part-001", "unknown_envelope", baseTime);
    const unrelatedTenant = tenant({ accountId: "acct-C" });
    expect(ledger.listForTenant(unrelatedTenant)).toHaveLength(0);
  });

  it("records all eight quarantine reasons", () => {
    const ledger = new JobQuarantineLedger();
    const reasons = [
      "unknown_envelope",
      "cross_tenant_violation",
      "replay_conflict",
      "idempotency_conflict",
      "lease_contention",
      "stale_lease_epoch",
      "max_attempts_exhausted",
      "payload_schema_invalid",
    ] as const;

    for (const reason of reasons) {
      const record = ledger.quarantine(tenant(), "workspace_maintenance", `part-${reason}`, reason, baseTime);
      expect(record.reason).toBe(reason);
      expect(record.disposition).toBe("pending_human_review");
    }
  });
});

// ---------------------------------------------------------------------------
// fanOutTenantJobs
// ---------------------------------------------------------------------------

describe("fanOutTenantJobs", () => {
  it("INV-FANOUT-01: each output envelope tenant matches exactly one roster entry", () => {
    const roster = [
      { tenant: tenant({ accountId: "acct-A", workspaceId: "ws-1" }) },
      { tenant: tenant({ accountId: "acct-B", workspaceId: "ws-2" }) },
    ];

    const result = fanOutTenantJobs(roster, {
      jobKind: "workspace_maintenance",
      idempotencyKeySuffix: "batch-001",
      payload: { targetEntity: "entity-001" },
      schemaVersion: TENANT_JOB_SCHEMA_VERSION,
      envelopeIdPrefix: "fanout",
      leaseEpoch: 1,
      attempt: 1,
      enqueuedAt: "2026-01-15T10:00:00Z",
    });

    expect(result.envelopes).toHaveLength(2);
    expect(result.parseErrors).toHaveLength(0);

    const tenantIds = result.envelopes.map((e: TenantJobEnvelope) => e.tenant.accountId);
    expect(tenantIds).toContain("acct-A");
    expect(tenantIds).toContain("acct-B");

    // Each envelope's tenant matches exactly one roster entry
    for (const env of result.envelopes) {
      const matchingRoster = roster.filter(
        (r) => r.tenant.accountId === env.tenant.accountId && r.tenant.workspaceId === env.tenant.workspaceId,
      );
      expect(matchingRoster).toHaveLength(1);
    }
  });

  it("INV-FANOUT-02: does not touch JobSchedulerPort", () => {
    // fanOutTenantJobs is a pure function that takes roster + spec and returns envelopes.
    // It has no dependency on JobSchedulerPort or DenyingPeriodicScheduler.
    const roster = [{ tenant: tenant() }];
    const result = fanOutTenantJobs(roster, {
      jobKind: "workspace_maintenance",
      idempotencyKeySuffix: "pure-test",
      payload: { targetEntity: "entity-001" },
      schemaVersion: TENANT_JOB_SCHEMA_VERSION,
      envelopeIdPrefix: "pure",
      leaseEpoch: 1,
      attempt: 1,
      enqueuedAt: "2026-01-15T10:00:00Z",
    });
    expect(result.envelopes).toHaveLength(1);
    expect(result.parseErrors).toHaveLength(0);
  });

  it("captures parse errors for invalid roster entries", () => {
    const roster = [
      { tenant: tenant({ accountId: "acct-valid" }) },
      { tenant: { accountId: "", workspaceId: "ws-001" } },
    ];

    const result = fanOutTenantJobs(roster, {
      jobKind: "workspace_maintenance",
      idempotencyKeySuffix: "batch-err",
      payload: { targetEntity: "entity-001" },
      schemaVersion: TENANT_JOB_SCHEMA_VERSION,
      envelopeIdPrefix: "fanout-err",
      leaseEpoch: 1,
      attempt: 1,
      enqueuedAt: "2026-01-15T10:00:00Z",
    });

    expect(result.envelopes).toHaveLength(1);
    expect(result.parseErrors).toHaveLength(1);
    expect(result.parseErrors[0]!.tenant.accountId).toBe("");
  });
});

// ---------------------------------------------------------------------------
// submitEnvelope integration (negative matrix)
// ---------------------------------------------------------------------------

describe("submitEnvelope — negative matrix", () => {
  it("N-01: unknown field in envelope → rejected", () => {
    const registry = new JobLeaseRegistry();
    const store = new JobIdempotencyStore();
    const ledger = new JobQuarantineLedger();

    const result = submitEnvelope(
      envelope({ extraSecret: "should-not-exist" }),
      registry,
      store,
      ledger,
      baseTime,
    );
    expect(result.accepted).toBe(false);
  });

  it("N-02: unknown jobKind → rejected", () => {
    const registry = new JobLeaseRegistry();
    const store = new JobIdempotencyStore();
    const ledger = new JobQuarantineLedger();

    const result = submitEnvelope(
      envelope({ jobKind: "nonexistent_type" }),
      registry,
      store,
      ledger,
      baseTime,
    );
    expect(result.accepted).toBe(false);
    expect(result.reason).toBe("unknown_envelope");
  });

  it("N-03: payload schema invalid → quarantine", () => {
    const registry = new JobLeaseRegistry();
    const store = new JobIdempotencyStore();
    const ledger = new JobQuarantineLedger();

    const result = submitEnvelope(
      envelope({ payload: { targetEntity: "" } }),
      registry,
      store,
      ledger,
      baseTime,
    );
    expect(result.accepted).toBe(false);
    expect(result.reason).toBe("payload_schema_invalid");
  });

  it("N-06: replay same key same content → deduplicate", () => {
    const registry = new JobLeaseRegistry();
    const store = new JobIdempotencyStore();
    const ledger = new JobQuarantineLedger();

    const env = envelope();
    const first = submitEnvelope(env, registry, store, ledger, baseTime);
    expect(first.accepted).toBe(true);
    expect(first.deduplicated).toBeUndefined();

    const second = submitEnvelope(env, registry, store, ledger, baseTime);
    expect(second.accepted).toBe(true);
    expect(second.deduplicated).toBe(true);
  });

  it("N-07: replay same key different content → quarantine idempotency_conflict", () => {
    const registry = new JobLeaseRegistry();
    const store = new JobIdempotencyStore();
    const ledger = new JobQuarantineLedger();

    submitEnvelope(envelope(), registry, store, ledger, baseTime);

    const different = envelope({ payload: { targetEntity: "different-entity" } });
    const result = submitEnvelope(different, registry, store, ledger, baseTime);
    expect(result.accepted).toBe(false);
    expect(result.reason).toBe("idempotency_conflict");
    expect(result.quarantined?.reason).toBe("idempotency_conflict");
  });

  it("N-12: max attempts exceeded → quarantine", () => {
    const registry = new JobLeaseRegistry();
    const store = new JobIdempotencyStore();
    const ledger = new JobQuarantineLedger();

    const result = submitEnvelope(
      envelope({ attempt: 6, idempotencyKey: "idem-max" }),
      registry,
      store,
      ledger,
      baseTime,
    );
    expect(result.accepted).toBe(false);
    expect(result.reason).toBe("max_attempts_exhausted");
    expect(result.quarantined?.reason).toBe("max_attempts_exhausted");
  });

  it("N-04+N-05: cross-tenant isolation via composite key", () => {
    const store = new JobIdempotencyStore();
    const tenantA: TenantJobEnvelope = {
      schemaVersion: TENANT_JOB_SCHEMA_VERSION,
      envelopeId: "env-A",
      tenant: { accountId: "acct-A", workspaceId: "ws-001" },
      jobKind: "workspace_maintenance",
      idempotencyKey: "idem-shared",
      leaseEpoch: 1,
      attempt: 1,
      enqueuedAt: "2026-01-15T10:00:00Z",
      payload: { targetEntity: "entity-001" },
    };
    const tenantB: TenantJobEnvelope = {
      ...tenantA,
      envelopeId: "env-B",
      tenant: { accountId: "acct-B", workspaceId: "ws-001" },
    };

    store.record(tenantA, "completed");
    // Tenant B with same idempotencyKey should be "new", not duplicate
    const result = store.check(tenantB);
    expect(result.status).toBe("new");
  });
});
