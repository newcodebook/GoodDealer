import { z } from "zod";

import {
  canonicalUtcTimestamp,
  identifier,
  safePositiveInteger,
} from "../wire/index";
import { workspaceTenantScopeSchema } from "./tenant-scope";
import type { WorkspaceTenantScope } from "./tenant-scope";

export const TENANT_JOB_SCHEMA_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// WorkspaceTenantScope — defined natively in protocol (NOT imported from cloud)
// ---------------------------------------------------------------------------

export { workspaceTenantScopeSchema } from "./tenant-scope";
export type { WorkspaceTenantScope } from "./tenant-scope";

// ---------------------------------------------------------------------------
// Quarantine reason enum
// ---------------------------------------------------------------------------

export const quarantineReasonSchema = z.enum([
  "unknown_envelope",
  "cross_tenant_violation",
  "replay_conflict",
  "idempotency_conflict",
  "lease_contention",
  "stale_lease_epoch",
  "max_attempts_exhausted",
  "payload_schema_invalid",
]);

export type QuarantineReason = z.infer<typeof quarantineReasonSchema>;

// ---------------------------------------------------------------------------
// QuarantineRecord
// ---------------------------------------------------------------------------

export const quarantineRecordSchema = z
  .object({
    tenant: workspaceTenantScopeSchema,
    jobKind: identifier,
    partitionKey: identifier,
    reason: quarantineReasonSchema,
    disposition: z.literal("pending_human_review"),
    capturedAt: canonicalUtcTimestamp,
  })
  .strict();

export type QuarantineRecord = z.infer<typeof quarantineRecordSchema>;

// ---------------------------------------------------------------------------
// JobLease (state machine: unleased → held → renewed → released/expired)
// ---------------------------------------------------------------------------

export const jobLeaseStateSchema = z.enum([
  "held",
  "renewed",
  "released",
  "expired",
]);

export type JobLeaseState = z.infer<typeof jobLeaseStateSchema>;

export const jobLeaseSchema = z
  .object({
    typ: z.literal("gd.tenant-job-lease.v1"),
    tenant: workspaceTenantScopeSchema,
    jobKind: identifier,
    partitionKey: identifier,
    workerId: identifier,
    leaseEpoch: safePositiveInteger,
    state: jobLeaseStateSchema,
    acquiredAt: canonicalUtcTimestamp,
    renewAfter: canonicalUtcTimestamp,
    expiresAt: canonicalUtcTimestamp,
  })
  .strict();

export type JobLease = z.infer<typeof jobLeaseSchema>;

// ---------------------------------------------------------------------------
// JobIdempotencyKey — NUL-separated composite key concept
// ---------------------------------------------------------------------------

/** Composite idempotency key: `accountId\0workspaceId\0jobKind\0idempotencyKey`. */
export const jobIdempotencyKeySchema = z
  .string()
  .min(4)
  .refine(
    (value) => {
      const segments = value.split("\0");
      return segments.length === 4 && segments.every((segment) => segment.length > 0);
    },
    "idempotency key must be four non-empty NUL-separated segments: accountId, workspaceId, jobKind, idempotencyKey",
  );

export type JobIdempotencyKey = z.infer<typeof jobIdempotencyKeySchema>;

/** Build the composite idempotency key from its components. */
export function buildJobIdempotencyKey(
  tenant: WorkspaceTenantScope,
  jobKind: string,
  idempotencyKey: string,
): string {
  return `${tenant.accountId}\0${tenant.workspaceId}\0${jobKind}\0${idempotencyKey}`;
}

// ---------------------------------------------------------------------------
// TenantJobEnvelope — discriminatedUnion on jobKind
// ---------------------------------------------------------------------------

/** Per-jobKind payload schemas. At least one concrete variant is required. */
const workspaceMaintenancePayloadSchema = z
  .object({
    targetEntity: identifier,
  })
  .strict();

export const workspaceMaintenanceEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(TENANT_JOB_SCHEMA_VERSION),
    envelopeId: identifier,
    tenant: workspaceTenantScopeSchema,
    jobKind: z.literal("workspace_maintenance"),
    idempotencyKey: identifier,
    leaseEpoch: safePositiveInteger,
    attempt: safePositiveInteger,
    enqueuedAt: canonicalUtcTimestamp,
    payload: workspaceMaintenancePayloadSchema,
  })
  .strict();

export const tenantJobEnvelopeSchema = z.discriminatedUnion("jobKind", [
  workspaceMaintenanceEnvelopeSchema,
]);

export type TenantJobEnvelope = z.infer<typeof tenantJobEnvelopeSchema>;

// Persistence create is distinct from the fixture envelope above; entry-point ownership,
// not a design-iteration version number, keeps caller-authored attempt/lease fields out.
export {
  MAX_PERSISTENT_JOB_CREATE_BYTES,
  PERSISTENT_JOB_CREATE_SCHEMA_VERSION,
  encodePersistentJobPayloadDigestInput,
  encodePersistentJobRequestDigestInput,
  parsePersistentJobCreateRequest,
  persistentJobCreateRequestSchema,
} from "./persistent-create";
export type { PersistentJobCreateRequest, PersistentJobRuntimePolicy } from "./persistent-create";
