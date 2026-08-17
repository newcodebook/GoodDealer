import { createHash } from "node:crypto";

import type {
  JobLease,
  QuarantineReason,
  QuarantineRecord,
  TenantJobEnvelope,
  WorkspaceTenantScope,
} from "@gooddealer/protocol/jobs";
import {
  buildJobIdempotencyKey,
  tenantJobEnvelopeSchema,
} from "@gooddealer/protocol/jobs";

// ---------------------------------------------------------------------------
// Fixture TTL constants (not production wall clock)
// ---------------------------------------------------------------------------

const LEASE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const LEASE_RENEW_AFTER_MS = 5 * 60 * 1000; // 5 minutes
const MAX_ATTEMPTS = 5;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tenantKey(tenant: WorkspaceTenantScope): string {
  return `${tenant.accountId}\0${tenant.workspaceId}`;
}

function formatTimestamp(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function envelopeDigest(envelope: TenantJobEnvelope): string {
  const canonical = JSON.stringify({
    schemaVersion: envelope.schemaVersion,
    tenant: envelope.tenant,
    jobKind: envelope.jobKind,
    idempotencyKey: envelope.idempotencyKey,
    payload: envelope.payload,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

// ---------------------------------------------------------------------------
// JobLeaseRegistry — in-memory, single-occupancy per partitionKey
// ---------------------------------------------------------------------------

interface LeaseEntry {
  lease: JobLease;
  highestEpoch: number;
}

export class JobLeaseRegistry {
  private readonly leases = new Map<string, LeaseEntry>();

  acquire(
    tenant: WorkspaceTenantScope,
    jobKind: string,
    partitionKey: string,
    workerId: string,
    now: Date,
  ): JobLease | { rejected: true; reason: "lease_contention" } {
    const existing = this.leases.get(partitionKey);

    // Check for single-occupancy: if a held or renewed lease exists and isn't expired
    if (existing) {
      const expiresAt = new Date(existing.lease.expiresAt.replace(/Z$/, ".000Z"));
      if (
        (existing.lease.state === "held" || existing.lease.state === "renewed") &&
        now < expiresAt
      ) {
        return { rejected: true, reason: "lease_contention" };
      }
      // If expired, allow re-acquisition but ensure monotonic epoch
      if (now >= expiresAt) {
        existing.lease = { ...existing.lease, state: "expired" };
      }
    }

    const highestEpoch = existing ? existing.highestEpoch : 0;
    const newEpoch = highestEpoch + 1;

    const acquiredAt = formatTimestamp(now);
    const renewAfter = formatTimestamp(new Date(now.getTime() + LEASE_RENEW_AFTER_MS));
    const expiresAt = formatTimestamp(new Date(now.getTime() + LEASE_TTL_MS));

    const lease: JobLease = {
      typ: "gd.tenant-job-lease.v1",
      tenant,
      jobKind,
      partitionKey,
      workerId,
      leaseEpoch: newEpoch,
      state: "held",
      acquiredAt,
      renewAfter,
      expiresAt,
    };

    this.leases.set(partitionKey, { lease, highestEpoch: newEpoch });
    return lease;
  }

  renew(
    partitionKey: string,
    workerId: string,
    expectedEpoch: number,
    now: Date,
  ):
    | JobLease
    | { rejected: true; reason: "no_active_lease" | "stale_lease_epoch" | "expired_lease" | "lease_contention" } {
    const entry = this.leases.get(partitionKey);
    if (!entry) {
      return { rejected: true, reason: "no_active_lease" };
    }

    if (entry.lease.workerId !== workerId) {
      return { rejected: true, reason: "lease_contention" };
    }

    if (expectedEpoch !== entry.lease.leaseEpoch) {
      return { rejected: true, reason: "stale_lease_epoch" };
    }

    const expiresAt = new Date(entry.lease.expiresAt.replace(/Z$/, ".000Z"));
    if (now >= expiresAt) {
      entry.lease = { ...entry.lease, state: "expired" };
      return { rejected: true, reason: "expired_lease" };
    }

    if (entry.lease.state !== "held" && entry.lease.state !== "renewed") {
      return { rejected: true, reason: "no_active_lease" };
    }

    const renewedLease: JobLease = {
      ...entry.lease,
      state: "renewed",
      renewAfter: formatTimestamp(new Date(now.getTime() + LEASE_RENEW_AFTER_MS)),
      expiresAt: formatTimestamp(new Date(now.getTime() + LEASE_TTL_MS)),
    };

    entry.lease = renewedLease;
    return renewedLease;
  }

  release(
    partitionKey: string,
    workerId: string,
    expectedEpoch: number,
  ): { released: true } | { rejected: true; reason: string } {
    const entry = this.leases.get(partitionKey);
    if (!entry) {
      return { rejected: true, reason: "no_active_lease" };
    }

    if (entry.lease.workerId !== workerId) {
      return { rejected: true, reason: "lease_contention" };
    }

    if (expectedEpoch !== entry.lease.leaseEpoch) {
      return { rejected: true, reason: "stale_lease_epoch" };
    }

    entry.lease = { ...entry.lease, state: "released" };
    return { released: true };
  }

  get(partitionKey: string): LeaseEntry | undefined {
    return this.leases.get(partitionKey);
  }

  currentEpoch(partitionKey: string): number {
    return this.leases.get(partitionKey)?.lease.leaseEpoch ?? 0;
  }
}

// ---------------------------------------------------------------------------
// JobIdempotencyStore — NUL-separated composite key, dedup/conflict detection
// ---------------------------------------------------------------------------

interface IdempotencyEntry {
  readonly compositeKey: string;
  readonly envelopeDigest: string;
  readonly terminalOutcome: "completed" | "quarantined";
}

export type IdempotencyResult =
  | { status: "new" }
  | { status: "duplicate"; existing: IdempotencyEntry }
  | { status: "conflict"; existing: IdempotencyEntry; incomingDigest: string };

export class JobIdempotencyStore {
  private readonly entries = new Map<string, IdempotencyEntry>();

  check(envelope: TenantJobEnvelope): IdempotencyResult {
    const compositeKey = buildJobIdempotencyKey(
      envelope.tenant,
      envelope.jobKind,
      envelope.idempotencyKey,
    );
    const digest = envelopeDigest(envelope);
    const existing = this.entries.get(compositeKey);

    if (!existing) {
      return { status: "new" };
    }

    if (existing.envelopeDigest === digest) {
      return { status: "duplicate", existing };
    }

    return { status: "conflict", existing, incomingDigest: digest };
  }

  record(
    envelope: TenantJobEnvelope,
    terminalOutcome: "completed" | "quarantined",
  ): void {
    const compositeKey = buildJobIdempotencyKey(
      envelope.tenant,
      envelope.jobKind,
      envelope.idempotencyKey,
    );
    const digest = envelopeDigest(envelope);
    this.entries.set(compositeKey, { compositeKey, envelopeDigest: digest, terminalOutcome });
  }

  get(compositeKey: string): IdempotencyEntry | undefined {
    return this.entries.get(compositeKey);
  }
}

// ---------------------------------------------------------------------------
// JobQuarantineLedger — per-tenant isolation, disposition always pending_human_review
// ---------------------------------------------------------------------------

export class JobQuarantineLedger {
  // Keyed by tenant key → list of quarantine records
  private readonly ledger = new Map<string, QuarantineRecord[]>();

  quarantine(
    tenant: WorkspaceTenantScope,
    jobKind: string,
    partitionKey: string,
    reason: QuarantineReason,
    now: Date,
  ): QuarantineRecord {
    const record: QuarantineRecord = {
      tenant,
      jobKind,
      partitionKey,
      reason,
      disposition: "pending_human_review",
      capturedAt: formatTimestamp(now),
    };

    const key = tenantKey(tenant);
    const existing = this.ledger.get(key);
    if (existing) {
      existing.push(record);
    } else {
      this.ledger.set(key, [record]);
    }

    return record;
  }

  /** Returns quarantine records visible only to the specified tenant. */
  listForTenant(tenant: WorkspaceTenantScope): readonly QuarantineRecord[] {
    return this.ledger.get(tenantKey(tenant)) ?? [];
  }

  /** Returns the total count of quarantine records for a specific tenant. */
  countForTenant(tenant: WorkspaceTenantScope): number {
    return this.listForTenant(tenant).length;
  }
}

// ---------------------------------------------------------------------------
// fanOutTenantJobs — pure function, NOT connected to any scheduler
// ---------------------------------------------------------------------------

export interface TenantRosterEntry {
  readonly tenant: WorkspaceTenantScope;
}

export interface FanOutSpec {
  readonly jobKind: string;
  readonly idempotencyKeySuffix: string;
  readonly payload: Record<string, unknown>;
  readonly schemaVersion: number;
}

export interface FanOutResult {
  readonly envelopes: TenantJobEnvelope[];
  readonly parseErrors: Array<{ tenant: WorkspaceTenantScope; error: string }>;
}

/**
 * Pure function: creates one TenantJobEnvelope per roster entry.
 * Does NOT touch JobSchedulerPort; DenyingPeriodicScheduler stays deny.
 */
export function fanOutTenantJobs(
  roster: readonly TenantRosterEntry[],
  spec: FanOutSpec & {
    readonly envelopeIdPrefix: string;
    readonly leaseEpoch: number;
    readonly attempt: number;
    readonly enqueuedAt: string;
  },
): FanOutResult {
  const envelopes: TenantJobEnvelope[] = [];
  const parseErrors: Array<{ tenant: WorkspaceTenantScope; error: string }> = [];

  for (const entry of roster) {
    const raw = {
      schemaVersion: spec.schemaVersion,
      envelopeId: `${spec.envelopeIdPrefix}-${entry.tenant.accountId}-${entry.tenant.workspaceId}`,
      tenant: entry.tenant,
      jobKind: spec.jobKind,
      idempotencyKey: `${entry.tenant.accountId}-${entry.tenant.workspaceId}-${spec.idempotencyKeySuffix}`,
      leaseEpoch: spec.leaseEpoch,
      attempt: spec.attempt,
      enqueuedAt: spec.enqueuedAt,
      payload: spec.payload,
    };

    const result = tenantJobEnvelopeSchema.safeParse(raw);
    if (result.success) {
      envelopes.push(result.data);
    } else {
      parseErrors.push({
        tenant: entry.tenant,
        error: result.error.message,
      });
    }
  }

  return { envelopes, parseErrors };
}

// ---------------------------------------------------------------------------
// submitEnvelope — orchestration helper for the negative matrix
// ---------------------------------------------------------------------------

export interface SubmitResult {
  readonly accepted: boolean;
  readonly deduplicated?: boolean;
  readonly quarantined?: QuarantineRecord;
  readonly reason?: string;
}

export function submitEnvelope(
  envelope: unknown,
  leaseRegistry: JobLeaseRegistry,
  idempotencyStore: JobIdempotencyStore,
  quarantineLedger: JobQuarantineLedger,
  now: Date,
): SubmitResult {
  // Validate envelope schema
  const parsed = tenantJobEnvelopeSchema.safeParse(envelope);
  if (!parsed.success) {
    // Determine reason: unknown jobKind, unknown fields, or payload
    const errorMessage = parsed.error.message;
    if (errorMessage.includes("Invalid discriminator")) {
      // Unknown jobKind — could still get tenant from the raw object for quarantine
      return { accepted: false, reason: "unknown_envelope" };
    }
    // Payload or structural issue
    const raw = envelope as Record<string, unknown> | undefined;
    const tenant = raw?.tenant;
    const parsedTenant = tenant && typeof tenant === "object" && tenant !== null
      ? { accountId: String((tenant as Record<string, unknown>).accountId ?? ""), workspaceId: String((tenant as Record<string, unknown>).workspaceId ?? "") }
      : null;
    if (parsedTenant && parsedTenant.accountId && parsedTenant.workspaceId) {
      const record = quarantineLedger.quarantine(
        parsedTenant,
        String(raw?.jobKind ?? "unknown"),
        "unresolved",
        "payload_schema_invalid",
        now,
      );
      return { accepted: false, quarantined: record, reason: "payload_schema_invalid" };
    }
    return { accepted: false, reason: "payload_schema_invalid" };
  }

  const validEnvelope = parsed.data;

  // Check lease epoch matches currently held lease
  const leaseEntry = leaseRegistry.get(validEnvelope.idempotencyKey);
  if (leaseEntry) {
    const currentLease = leaseEntry.lease;
    if (currentLease.state !== "held" && currentLease.state !== "renewed") {
      return { accepted: false, reason: "no_active_lease" };
    }
    if (validEnvelope.leaseEpoch !== currentLease.leaseEpoch) {
      const record = quarantineLedger.quarantine(
        validEnvelope.tenant,
        validEnvelope.jobKind,
        validEnvelope.idempotencyKey,
        "stale_lease_epoch",
        now,
      );
      return { accepted: false, quarantined: record, reason: "stale_lease_epoch" };
    }
  }

  // Check max attempts
  if (validEnvelope.attempt > MAX_ATTEMPTS) {
    const record = quarantineLedger.quarantine(
      validEnvelope.tenant,
      validEnvelope.jobKind,
      validEnvelope.idempotencyKey,
      "max_attempts_exhausted",
      now,
    );
    return { accepted: false, quarantined: record, reason: "max_attempts_exhausted" };
  }

  // Check idempotency
  const idempotencyResult = idempotencyStore.check(validEnvelope);
  if (idempotencyResult.status === "duplicate") {
    return { accepted: true, deduplicated: true };
  }
  if (idempotencyResult.status === "conflict") {
    const record = quarantineLedger.quarantine(
      validEnvelope.tenant,
      validEnvelope.jobKind,
      validEnvelope.idempotencyKey,
      "idempotency_conflict",
      now,
    );
    return { accepted: false, quarantined: record, reason: "idempotency_conflict" };
  }

  // Record and accept
  idempotencyStore.record(validEnvelope, "completed");
  return { accepted: true };
}
