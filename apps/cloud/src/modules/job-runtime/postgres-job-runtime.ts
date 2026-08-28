import { createHash, randomUUID } from "node:crypto";

import {
  encodePersistentJobPayloadDigestInput,
  encodePersistentJobRequestDigestInput,
  parsePersistentJobCreateRequest,
  type PersistentJobCreateRequest,
  type PersistentJobRuntimePolicy,
  type QuarantineRecord,
  type QuarantineReason,
} from "@gooddealer/protocol/jobs";

import type { TenantTransaction, TenantTransactionRunner } from "../../db/index";
import type { WorkspaceTenantScope } from "../workspace/tenant-scope";

const handleBrand: unique symbol = Symbol("job-runtime-leased-handle");
const replayCapabilityBrand: unique symbol = Symbol("job-runtime-replay-capability");
const MAX_CANONICAL_PAYLOAD_BYTES = 64 * 1024;

interface LeaseAuthority {
  readonly scope: WorkspaceTenantScope;
  readonly jobId: string;
  readonly jobKind: string;
  readonly partitionKey: string;
  readonly workerId: string;
  readonly leaseEpoch: number;
  readonly attempt: number;
}

interface ReplayCapabilityAuthority {
  readonly owner: object;
  readonly scope: WorkspaceTenantScope;
  readonly jobId: string;
  readonly quarantineId: string;
  readonly expectedQuarantineRevision: number;
  readonly expectedReplayGeneration: number;
  readonly authorization: ReplayAuthorizationRecord;
}

const leasedHandleAuthorities = new WeakMap<object, LeaseAuthority>();
const replayCapabilityAuthorities = new WeakMap<object, ReplayCapabilityAuthority>();

export interface JobRuntimeRecord {
  readonly tenant: WorkspaceTenantScope;
  readonly jobId: string;
  readonly jobKind: string;
  readonly targetModule: string;
  readonly payloadVersion: number;
  readonly partitionKey: string;
  readonly idempotencyKey: string;
  readonly canonicalPayload: Uint8Array;
  readonly payloadDigest: string;
  readonly requestDigest: string;
  readonly authorization: PersistentJobCreateRequest["authorization"];
  readonly runtimePolicy: PersistentJobRuntimePolicy;
  readonly attempt: number;
  readonly leaseEpoch: number;
  readonly replayGeneration: number;
  readonly state: "available" | "leased" | "retry_wait" | "completed" | "quarantined";
}

export interface JobKindDefinition<Payload = unknown> {
  readonly jobKind: string;
  readonly targetModule: string;
  readonly payloadVersion: number;
  readonly runtimePolicy: PersistentJobRuntimePolicy;
  decodePayload(value: unknown): Payload;
  decodeCanonicalPayload(value: Uint8Array): Payload;
  encodeCanonicalPayload(value: Payload): Uint8Array;
  derivePartitionKey(value: Payload): string;
  readonly authorization: JobAuthorizationRevalidationPort;
  readonly handler: TransactionalJobHandlerPort<Payload>;
}

export interface JobAuthorizationRevalidationPort {
  revalidate(transaction: TenantTransaction, job: JobRuntimeRecord): Promise<boolean>;
}

export interface ReplayAuthorizationRecord {
  readonly kind: "admin_action";
  readonly ref: string;
  readonly revision: number;
  readonly digest: string;
}

export interface JobReplayAuthorizationVerificationPort {
  verify(transaction: TenantTransaction, input: {
    readonly jobId: string;
    readonly quarantineId: string;
    readonly authorization: ReplayAuthorizationRecord;
  }): Promise<boolean>;
}

export interface TransactionalJobHandlerPort<Payload = unknown> {
  handle(transaction: TenantTransaction, input: {
    readonly tenant: WorkspaceTenantScope;
    readonly job: JobRuntimeRecord;
    readonly payload: Payload;
  }): Promise<{ readonly outcomeDigest: Uint8Array }>;
}

export const productionJobKindDefinitions: readonly [] = [];

const denyingReplayAuthorization: JobReplayAuthorizationVerificationPort = Object.freeze({
  async verify() { return false; },
});

export class JobKindRegistry {
  private readonly definitions = new Map<string, JobKindDefinition>();

  constructor(definitions: readonly JobKindDefinition[]) {
    for (const definition of definitions) {
      assertIdentifier(definition.jobKind, "job kind");
      assertIdentifier(definition.targetModule, "target module");
      if (!Number.isSafeInteger(definition.payloadVersion) || definition.payloadVersion < 1) {
        throw new TypeError("job payload version is invalid");
      }
      const key = definitionKey(definition.jobKind, definition.targetModule, definition.payloadVersion);
      if (this.definitions.has(key)) throw new TypeError(`duplicate job kind definition: ${key}`);
      if (
        definition.runtimePolicy.maxAttempts < 1 || definition.runtimePolicy.maxAttempts > 100 ||
        definition.runtimePolicy.leaseSeconds > definition.runtimePolicy.attemptTimeoutSeconds
      ) {
        throw new TypeError("job runtime policy is out of bounds");
      }
      Object.freeze(definition.runtimePolicy);
      Object.freeze(definition.authorization);
      Object.freeze(definition.handler);
      Object.freeze(definition);
      this.definitions.set(key, definition);
    }
  }

  resolve(jobKind: string, targetModule: string, payloadVersion: number): JobKindDefinition | null {
    return this.definitions.get(definitionKey(jobKind, targetModule, payloadVersion)) ?? null;
  }

  get size(): number { return this.definitions.size; }
}

export interface LeasedJobHandle {
  readonly [handleBrand]: true;
  toJSON(): never;
}

class PrivateLeasedJobHandle implements LeasedJobHandle {
  readonly [handleBrand] = true as const;
  constructor(authority: LeaseAuthority) {
    leasedHandleAuthorities.set(this, authority);
    Object.freeze(this);
  }
  toJSON(): never { throw new TypeError("leased job handles are not serializable"); }
}

export interface VerifiedJobReplayCapability {
  readonly [replayCapabilityBrand]: true;
  toJSON(): never;
}

class PrivateVerifiedJobReplayCapability implements VerifiedJobReplayCapability {
  readonly [replayCapabilityBrand] = true as const;
  constructor(authority: ReplayCapabilityAuthority) {
    replayCapabilityAuthorities.set(this, authority);
    Object.freeze(this);
  }
  toJSON(): never { throw new TypeError("verified replay capabilities are not serializable"); }
}

export type EnqueueResult =
  | { readonly status: "enqueued" | "duplicate"; readonly job: JobRuntimeRecord }
  | { readonly status: "idempotency_conflict"; readonly jobId: string; readonly quarantineId: string };

export type JobRuntimeFaultPoint =
  | "after_enqueue_insert" | "after_idempotency_conflict"
  | "after_claim_job" | "after_claim_partition" | "after_claim_attempt"
  | "after_retry_attempt" | "after_retry_job"
  | "after_completion_attempt" | "after_completion_job"
  | "after_quarantine_attempt" | "after_quarantine_job" | "after_quarantine_event"
  | "after_replay_job" | "after_replay_event" | "after_release_partition";

export class PostgresJobRuntime {
  private readonly capabilityOwner = Object.freeze({});
  private readonly transactions: TenantTransactionRunner;
  private readonly registry: JobKindRegistry;
  private readonly replayAuthorization: JobReplayAuthorizationVerificationPort;
  private readonly fault: ((point: JobRuntimeFaultPoint) => void) | undefined;

  constructor(
    transactions: TenantTransactionRunner,
    registry: JobKindRegistry,
    replayAuthorization: JobReplayAuthorizationVerificationPort = denyingReplayAuthorization,
    fault?: (point: JobRuntimeFaultPoint) => void,
  ) {
    this.transactions = transactions;
    this.registry = registry;
    this.replayAuthorization = Object.freeze({
      verify: replayAuthorization.verify.bind(replayAuthorization),
    });
    this.fault = fault;
  }

  async enqueue(scope: WorkspaceTenantScope, value: unknown): Promise<EnqueueResult> {
    const prepared = prepareCreate(scope, value, this.registry);
    return this.transactions.withTenant(scope, async (transaction) => {
      const jobId = `job-${randomUUID()}`;
      const inserted = await transaction.query(
        `INSERT INTO job_runtime_jobs (
           account_id, workspace_id, job_id, job_kind, target_module, payload_version,
           partition_key, idempotency_key, trigger_kind, trigger_ref,
           authorization_kind, authorization_ref, authorization_revision, authorization_digest,
           canonical_payload, payload_digest, request_digest, runtime_policy_id,
           runtime_policy_version, max_attempts, attempt_timeout_seconds, lease_seconds,
           base_backoff_seconds, retry_mode)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,decode($14,'hex'),$15,
                 decode($16,'hex'),decode($17,'hex'),$18,$19,$20,$21,$22,$23,$24)
         ON CONFLICT (account_id, workspace_id, job_kind, idempotency_key) DO NOTHING`,
        [scope.accountId, scope.workspaceId, jobId, prepared.request.jobKind,
          prepared.request.targetModule, prepared.request.payloadVersion, prepared.request.partitionKey,
          prepared.request.idempotencyKey, prepared.request.trigger.kind, prepared.request.trigger.ref,
          prepared.request.authorization.kind, prepared.request.authorization.ref,
          prepared.request.authorization.revision, prepared.request.authorization.digest,
          Buffer.from(prepared.canonicalPayload), prepared.payloadDigest, prepared.requestDigest,
          prepared.request.runtimePolicy.id, prepared.request.runtimePolicy.version,
          prepared.request.runtimePolicy.maxAttempts, prepared.request.runtimePolicy.attemptTimeoutSeconds,
          prepared.request.runtimePolicy.leaseSeconds, prepared.request.runtimePolicy.baseBackoffSeconds,
          prepared.request.runtimePolicy.retryMode],
      );
      if (inserted.rowCount === 1) this.fault?.("after_enqueue_insert");
      const existing = await selectByIdempotency(transaction, prepared.request.jobKind, prepared.request.idempotencyKey, true);
      if (existing === null) throw new Error("job enqueue invariant failed");
      if (inserted.rowCount === 1) return { status: "enqueued", job: existing };
      if (existing.requestDigest === prepared.requestDigest) return { status: "duplicate", job: existing };

      const quarantineId = `quarantine-${randomUUID()}`;
      await insertQuarantine(transaction, existing, quarantineId, "idempotency_conflict", prepared.requestDigest);
      this.fault?.("after_idempotency_conflict");
      return { status: "idempotency_conflict", jobId: existing.jobId, quarantineId };
    });
  }

  async claim(scope: WorkspaceTenantScope, workerId: string): Promise<LeasedJobHandle | null> {
    assertIdentifier(workerId, "worker id");
    return this.transactions.withTenant(scope, async (transaction) => {
      const candidate = await transaction.query<{ job_id: string; job_kind: string; partition_key: string; state: string }>(
        `SELECT j.job_id, j.job_kind, j.partition_key, j.state
         FROM job_runtime_jobs j
         WHERE j.account_id = $1 AND j.workspace_id = $2
           AND ((j.state IN ('available','retry_wait') AND j.available_at <= clock_timestamp())
             OR (j.state = 'leased' AND j.lease_expires_at <= clock_timestamp()))
           AND NOT EXISTS (
             SELECT 1 FROM job_runtime_partition_leases p
             WHERE p.account_id=j.account_id AND p.workspace_id=j.workspace_id
               AND p.job_kind=j.job_kind AND p.partition_key=j.partition_key
               AND p.state IN ('held','renewed') AND p.expires_at > clock_timestamp()
           )
         ORDER BY (j.state='leased') DESC, j.available_at, j.enqueued_at, j.job_id
         FOR UPDATE OF j SKIP LOCKED LIMIT 1`,
        [scope.accountId, scope.workspaceId],
      );
      const row = candidate.rows[0];
      if (row === undefined) return null;

      await transaction.query(
        `INSERT INTO job_runtime_partition_leases
           (account_id, workspace_id, job_kind, partition_key, highest_lease_epoch, state)
         VALUES ($1,$2,$3,$4,0,'released') ON CONFLICT DO NOTHING`,
        [scope.accountId, scope.workspaceId, row.job_kind, row.partition_key],
      );
      const partition = await transaction.query<{
        highest_lease_epoch: string; current_job_id: string | null; active: boolean;
      }>(
        `SELECT highest_lease_epoch,current_job_id,
           state IN ('held','renewed') AND expires_at>clock_timestamp() AS active
         FROM job_runtime_partition_leases
         WHERE account_id=$1 AND workspace_id=$2 AND job_kind=$3 AND partition_key=$4 FOR UPDATE`,
        [scope.accountId, scope.workspaceId, row.job_kind, row.partition_key],
      );
      const partitionRow = requiredRow(partition.rows[0], "partition lease");
      if (partitionRow.active || (partitionRow.current_job_id !== null && partitionRow.current_job_id !== row.job_id)) return null;
      const nextEpoch = parseSafeInteger(partitionRow.highest_lease_epoch) + 1;
      if (row.state === "leased") {
        await transaction.query(
          `UPDATE job_runtime_attempts SET outcome='lease_expired', finished_at=clock_timestamp()
           WHERE account_id=$1 AND workspace_id=$2 AND job_id=$3 AND outcome='running'`,
          [scope.accountId, scope.workspaceId, row.job_id],
        );
      }
      const leased = await transaction.query<JobRow>(
        `UPDATE job_runtime_jobs SET state='leased', attempt_count=attempt_count+1,
           lease_epoch=$4, current_worker=$5, lease_acquired_at=clock_timestamp(),
           lease_renewed_at=NULL,
           lease_expires_at=clock_timestamp() + make_interval(secs => lease_seconds),
           attempt_deadline_at=clock_timestamp() + make_interval(secs => attempt_timeout_seconds)
         WHERE account_id=$1 AND workspace_id=$2 AND job_id=$3
         RETURNING ${JOB_COLUMNS}`,
        [scope.accountId, scope.workspaceId, row.job_id, nextEpoch, workerId],
      );
      this.fault?.("after_claim_job");
      await transaction.query(
        `UPDATE job_runtime_partition_leases SET current_job_id=$5, current_worker=$6,
           highest_lease_epoch=$7, current_lease_epoch=$7, state='held',
           acquired_at=clock_timestamp(), renewed_at=NULL,
           expires_at=clock_timestamp() + make_interval(secs => $8)
         WHERE account_id=$1 AND workspace_id=$2 AND job_kind=$3 AND partition_key=$4`,
        [scope.accountId, scope.workspaceId, row.job_kind, row.partition_key, row.job_id,
          workerId, nextEpoch, leased.rows[0]?.lease_seconds],
      );
      this.fault?.("after_claim_partition");
      const job = mapJob(requiredRow(leased.rows[0], "claimed job"), scope);
      await transaction.query(
        `INSERT INTO job_runtime_attempts
           (account_id,workspace_id,job_id,attempt_no,lease_epoch,worker_id,deadline_at,outcome)
         VALUES ($1,$2,$3,$4,$5,$6,clock_timestamp()+make_interval(secs => $7),'running')`,
        [scope.accountId, scope.workspaceId, job.jobId, job.attempt, job.leaseEpoch,
          workerId, job.runtimePolicy.attemptTimeoutSeconds],
      );
      this.fault?.("after_claim_attempt");
      return mintLeasedJobHandle(job, workerId);
    });
  }

  async renew(handle: LeasedJobHandle): Promise<LeasedJobHandle | null> {
    const authority = consumeHandle(handle);
    return this.transactions.withTenant(authority.scope, async (transaction) => {
      const fenced = await lockFenced(transaction, authority);
      if (fenced === null) return null;
      const renewed = await transaction.query<JobRow>(
        `UPDATE job_runtime_jobs SET lease_renewed_at=clock_timestamp(),
           lease_expires_at=least(clock_timestamp()+make_interval(secs => lease_seconds), attempt_deadline_at)
         WHERE account_id=$1 AND workspace_id=$2 AND job_id=$3 RETURNING ${JOB_COLUMNS}`,
        [fenced.tenant.accountId, fenced.tenant.workspaceId, fenced.jobId],
      );
      await transaction.query(
        `UPDATE job_runtime_partition_leases SET state='renewed', renewed_at=clock_timestamp(),
           expires_at=least(clock_timestamp()+make_interval(secs => $7), $8)
         WHERE account_id=$1 AND workspace_id=$2 AND job_kind=$3 AND partition_key=$4
           AND current_worker=$5 AND current_lease_epoch=$6`,
        [fenced.tenant.accountId, fenced.tenant.workspaceId, fenced.jobKind, fenced.partitionKey,
          authority.workerId, fenced.leaseEpoch, fenced.runtimePolicy.leaseSeconds,
          requiredRow(renewed.rows[0], "renewed job").attempt_deadline_at],
      );
      return mintLeasedJobHandle(mapJob(requiredRow(renewed.rows[0], "renewed job"), authority.scope), authority.workerId);
    });
  }

  async executeDatabaseJob(handle: LeasedJobHandle): Promise<"completed" | "authorization_rejected" | "stale"> {
    const authority = consumeHandle(handle);
    return this.transactions.withTenant(authority.scope, async (transaction) => {
      let fenced = await lockFenced(transaction, authority);
      if (fenced === null) return "stale";
      const definition = this.registry.resolve(fenced.jobKind, fenced.targetModule, fenced.payloadVersion);
      if (definition === null) {
        await quarantineFenced(transaction, authority, fenced, "unknown_envelope", this.fault);
        return "authorization_rejected";
      }
      if (!(await definition.authorization.revalidate(transaction, fenced))) {
        fenced = await lockFenced(transaction, authority);
        if (fenced === null) return "stale";
        await quarantineFenced(transaction, authority, fenced, "replay_conflict", this.fault);
        return "authorization_rejected";
      }
      fenced = await lockFenced(transaction, authority);
      if (fenced === null) throw new Error("job lease expired before handler entry");
      const payload = definition.decodeCanonicalPayload(fenced.canonicalPayload);
      const result = await definition.handler.handle(transaction, { tenant: fenced.tenant, job: fenced, payload });
      if (result.outcomeDigest.byteLength !== 32) throw new TypeError("handler outcome digest must be 32 bytes");
      fenced = await lockFenced(transaction, authority);
      if (fenced === null) throw new Error("job lease expired before terminal commit");
      await completeFenced(transaction, authority, result.outcomeDigest, this.fault);
      return "completed";
    });
  }

  /** Test/database handlers can use this overload when their decoder needs the original decoded value. */
  async executeDecodedDatabaseJob<Payload>(
    handle: LeasedJobHandle,
    definition: JobKindDefinition<Payload>,
    payload: Payload,
  ): Promise<"completed" | "authorization_rejected" | "stale"> {
    const authority = consumeHandle(handle);
    return this.transactions.withTenant(authority.scope, async (transaction) => {
      let fenced = await lockFenced(transaction, authority);
      if (fenced === null) return "stale";
      const registered = this.registry.resolve(fenced.jobKind, fenced.targetModule, fenced.payloadVersion);
      if (registered !== definition) return "stale";
      const canonical = definition.encodeCanonicalPayload(payload);
      if (!bytesEqual(canonical, fenced.canonicalPayload)) throw new TypeError("payload bytes do not match frozen job");
      if (!(await definition.authorization.revalidate(transaction, fenced))) {
        fenced = await lockFenced(transaction, authority);
        if (fenced === null) return "stale";
        await quarantineFenced(transaction, authority, fenced, "replay_conflict", this.fault);
        return "authorization_rejected";
      }
      fenced = await lockFenced(transaction, authority);
      if (fenced === null) throw new Error("job lease expired before handler entry");
      const result = await definition.handler.handle(transaction, { tenant: fenced.tenant, job: fenced, payload });
      if (result.outcomeDigest.byteLength !== 32) throw new TypeError("handler outcome digest must be 32 bytes");
      fenced = await lockFenced(transaction, authority);
      if (fenced === null) throw new Error("job lease expired before terminal commit");
      await completeFenced(transaction, authority, result.outcomeDigest, this.fault);
      return "completed";
    });
  }

  async retry(handle: LeasedJobHandle, errorClass: "transient_database"): Promise<"retry_scheduled" | "quarantined" | "stale"> {
    const authority = consumeHandle(handle);
    return this.transactions.withTenant(authority.scope, async (transaction) => {
      let fenced = await lockFenced(transaction, authority);
      if (fenced === null) return "stale";
      const definition = this.registry.resolve(fenced.jobKind, fenced.targetModule, fenced.payloadVersion);
      if (definition === null || !sameRuntimePolicy(definition.runtimePolicy, fenced.runtimePolicy)
        || fenced.runtimePolicy.retryMode !== "database_safe") {
        await quarantineFenced(transaction, authority, fenced, "payload_schema_invalid", this.fault);
        return "quarantined";
      }
      if (!(await definition.authorization.revalidate(transaction, fenced))) {
        fenced = await lockFenced(transaction, authority);
        if (fenced === null) return "stale";
        await quarantineFenced(transaction, authority, fenced, "replay_conflict", this.fault);
        return "quarantined";
      }
      fenced = await lockFenced(transaction, authority);
      if (fenced === null) return "stale";
      if (fenced.attempt >= fenced.runtimePolicy.maxAttempts) {
        await quarantineFenced(transaction, authority, fenced, "max_attempts_exhausted", this.fault);
        return "quarantined";
      }
      await transaction.query(
        `UPDATE job_runtime_attempts SET outcome='retry_scheduled', error_class=$6,
           finished_at=clock_timestamp(),
           next_retry_at=clock_timestamp()+make_interval(secs => least($7 * power(2,$4-1),86400)::integer)
         WHERE account_id=$1 AND workspace_id=$2 AND job_id=$3 AND attempt_no=$4 AND lease_epoch=$5`,
        [fenced.tenant.accountId, fenced.tenant.workspaceId, fenced.jobId, fenced.attempt,
          fenced.leaseEpoch, errorClass, fenced.runtimePolicy.baseBackoffSeconds],
      );
      this.fault?.("after_retry_attempt");
      await transaction.query(
        `UPDATE job_runtime_jobs SET state='retry_wait',
           available_at=clock_timestamp()+make_interval(secs => least(base_backoff_seconds * power(2,attempt_count-1),86400)::integer),
           current_worker=NULL, lease_acquired_at=NULL, lease_renewed_at=NULL,
           lease_expires_at=NULL, attempt_deadline_at=NULL
         WHERE account_id=$1 AND workspace_id=$2 AND job_id=$3`,
        [fenced.tenant.accountId, fenced.tenant.workspaceId, fenced.jobId],
      );
      this.fault?.("after_retry_job");
      await releasePartition(transaction, authority, "released", this.fault);
      return "retry_scheduled";
    });
  }

  async quarantine(handle: LeasedJobHandle, reason: QuarantineReason): Promise<"quarantined" | "stale"> {
    const authority = consumeHandle(handle);
    return this.transactions.withTenant(authority.scope, async (transaction) => {
      const fenced = await lockFenced(transaction, authority);
      if (fenced === null) return "stale";
      await quarantineFenced(transaction, authority, fenced, reason, this.fault);
      return "quarantined";
    });
  }

  async verifyReplayAuthorization(scope: WorkspaceTenantScope, input: {
    readonly jobId: string;
    readonly quarantineId: string;
    readonly expectedQuarantineRevision: number;
    readonly expectedReplayGeneration: number;
    readonly authorization: ReplayAuthorizationRecord;
  }): Promise<VerifiedJobReplayCapability | null> {
    assertReplayInput(input);
    const verified = await this.transactions.withTenant(scope, (transaction) =>
      this.replayAuthorization.verify(transaction, {
        jobId: input.jobId,
        quarantineId: input.quarantineId,
        authorization: input.authorization,
      }));
    if (!verified) return null;
    return new PrivateVerifiedJobReplayCapability(freezeReplayAuthority(this.capabilityOwner, scope, input));
  }

  async replay(capability: VerifiedJobReplayCapability): Promise<"requeued" | "authorization_rejected" | "conflict"> {
    const authority = consumeReplayCapability(capability, this.capabilityOwner);
    return this.transactions.withTenant(authority.scope, async (transaction) => {
      let job = await selectByJobId(transaction, authority.jobId, true);
      if (job === null || job.state !== "quarantined" || job.replayGeneration !== authority.expectedReplayGeneration) return "conflict";
      const quarantine = await transaction.query<{ quarantine_revision: string }>(
        `SELECT quarantine_revision FROM job_runtime_quarantine_events
         WHERE account_id=$1 AND workspace_id=$2 AND job_id=$3 AND quarantine_id=$4 FOR UPDATE`,
        [authority.scope.accountId, authority.scope.workspaceId, authority.jobId, authority.quarantineId],
      );
      if (parseSafeInteger(quarantine.rows[0]?.quarantine_revision) !== authority.expectedQuarantineRevision) return "conflict";
      const definition = this.registry.resolve(job.jobKind, job.targetModule, job.payloadVersion);
      if (definition === null || !(await definition.authorization.revalidate(transaction, job))) return "authorization_rejected";
      job = await selectByJobId(transaction, authority.jobId, true);
      if (job === null || job.state !== "quarantined" || job.replayGeneration !== authority.expectedReplayGeneration) return "conflict";
      const generation = job.replayGeneration + 1;
      const updated = await transaction.query(
        `UPDATE job_runtime_jobs SET state='available', available_at=clock_timestamp(),
           replay_generation=replay_generation+1, terminal_at=NULL
         WHERE account_id=$1 AND workspace_id=$2 AND job_id=$3
           AND state='quarantined' AND replay_generation=$4`,
        [authority.scope.accountId, authority.scope.workspaceId, authority.jobId, authority.expectedReplayGeneration],
      );
      if (updated.rowCount !== 1) return "conflict";
      this.fault?.("after_replay_job");
      await transaction.query(
        `INSERT INTO job_runtime_replay_events
          (account_id,workspace_id,job_id,quarantine_id,replay_generation,
           replay_authorization_kind,replay_authorization_ref,replay_authorization_revision,
           replay_authorization_digest,outcome)
         VALUES ($1,$2,$3,$4,$5,'admin_action',$6,$7,decode($8,'hex'),'requeued')`,
        [authority.scope.accountId, authority.scope.workspaceId, authority.jobId, authority.quarantineId, generation,
          authority.authorization.ref, authority.authorization.revision, authority.authorization.digest],
      );
      this.fault?.("after_replay_event");
      return "requeued";
    });
  }

  listQuarantine(scope: WorkspaceTenantScope): Promise<readonly QuarantineRecord[]> {
    return this.transactions.withTenant(scope, async (transaction) => {
      const result = await transaction.query<{
        job_kind: string; partition_key: string; reason: QuarantineReason;
        disposition: "pending_human_review"; captured_at: Date;
      }>(
        `SELECT j.job_kind,j.partition_key,q.reason,q.disposition,q.captured_at
         FROM job_runtime_quarantine_events q JOIN job_runtime_jobs j USING (account_id,workspace_id,job_id)
         WHERE q.account_id=$1 AND q.workspace_id=$2 ORDER BY q.captured_at,q.quarantine_id`,
        [scope.accountId, scope.workspaceId],
      );
      return result.rows.map((row) => ({ tenant: scope, jobKind: row.job_kind,
        partitionKey: row.partition_key, reason: row.reason, disposition: row.disposition,
        capturedAt: row.captured_at.toISOString().replace(/\.\d{3}Z$/u, "Z") }));
    }, { readOnly: true });
  }
}

interface PreparedCreate {
  readonly request: PersistentJobCreateRequest;
  readonly definition: JobKindDefinition;
  readonly payload: unknown;
  readonly canonicalPayload: Uint8Array;
  readonly payloadDigest: string;
  readonly requestDigest: string;
}

function prepareCreate(scope: WorkspaceTenantScope, value: unknown, registry: JobKindRegistry): PreparedCreate {
  const request = parsePersistentJobCreateRequest(value, scope);
  const definition = registry.resolve(request.jobKind, request.targetModule, request.payloadVersion);
  if (definition === null) throw new TypeError("job kind, target module, or payload version is not registered");
  if (!sameRuntimePolicy(definition.runtimePolicy, request.runtimePolicy)) throw new TypeError("runtime policy does not match registered definition");
  const payload = definition.decodePayload(request.payload);
  if (definition.derivePartitionKey(payload) !== request.partitionKey) throw new TypeError("partition key does not match decoded payload");
  const canonicalPayload = definition.encodeCanonicalPayload(payload);
  if (canonicalPayload.byteLength < 1 || canonicalPayload.byteLength > MAX_CANONICAL_PAYLOAD_BYTES) {
    throw new TypeError("canonical payload exceeds job-runtime bounds");
  }
  const expectedCanonical = encodePersistentJobPayloadDigestInput(request.payload);
  if (!bytesEqual(canonicalPayload, expectedCanonical)) throw new TypeError("job payload is not canonical");
  const payloadDigest = sha256(canonicalPayload);
  const { payload: _payload, ...header } = request;
  const requestDigest = sha256(encodePersistentJobRequestDigestInput({ request: header, payloadDigest }));
  return { request, definition, payload, canonicalPayload, payloadDigest, requestDigest };
}

const JOB_COLUMNS = `account_id,workspace_id,job_id,job_kind,target_module,payload_version,
  partition_key,idempotency_key,authorization_kind,authorization_ref,authorization_revision,
  encode(authorization_digest,'hex') AS authorization_digest, canonical_payload,
  encode(payload_digest,'hex') AS payload_digest, encode(request_digest,'hex') AS request_digest,
  runtime_policy_id,runtime_policy_version,max_attempts,attempt_timeout_seconds,lease_seconds,
  base_backoff_seconds,retry_mode,state,attempt_count,lease_epoch,replay_generation,attempt_deadline_at`;

interface JobRow {
  account_id: string; workspace_id: string; job_id: string; job_kind: string; target_module: string;
  payload_version: string; partition_key: string; idempotency_key: string; authorization_kind: PersistentJobCreateRequest["authorization"]["kind"];
  authorization_ref: string; authorization_revision: string; authorization_digest: string; canonical_payload: Buffer;
  payload_digest: string; request_digest: string; runtime_policy_id: string; runtime_policy_version: string;
  max_attempts: number; attempt_timeout_seconds: number; lease_seconds: number; base_backoff_seconds: number;
  retry_mode: PersistentJobRuntimePolicy["retryMode"]; state: JobRuntimeRecord["state"]; attempt_count: number;
  lease_epoch: string; replay_generation: string; attempt_deadline_at: Date | null;
}

async function selectByIdempotency(transaction: TenantTransaction, kind: string, key: string, lock: boolean) {
  const result = await transaction.query<JobRow>(
    `SELECT ${JOB_COLUMNS} FROM job_runtime_jobs
     WHERE account_id=$1 AND workspace_id=$2 AND job_kind=$3 AND idempotency_key=$4${lock ? " FOR UPDATE" : ""}`,
    [transaction.scope.accountId, transaction.scope.workspaceId, kind, key],
  );
  return result.rows[0] === undefined ? null : mapJob(result.rows[0], transaction.scope);
}

async function selectByJobId(transaction: TenantTransaction, jobId: string, lock: boolean) {
  const result = await transaction.query<JobRow>(
    `SELECT ${JOB_COLUMNS} FROM job_runtime_jobs
     WHERE account_id=$1 AND workspace_id=$2 AND job_id=$3${lock ? " FOR UPDATE" : ""}`,
    [transaction.scope.accountId, transaction.scope.workspaceId, jobId],
  );
  return result.rows[0] === undefined ? null : mapJob(result.rows[0], transaction.scope);
}

function mapJob(row: JobRow, tenant: WorkspaceTenantScope): JobRuntimeRecord {
  return {
    tenant, jobId: row.job_id, jobKind: row.job_kind, targetModule: row.target_module,
    payloadVersion: parseSafeInteger(row.payload_version), partitionKey: row.partition_key,
    idempotencyKey: row.idempotency_key, canonicalPayload: new Uint8Array(row.canonical_payload),
    payloadDigest: row.payload_digest, requestDigest: row.request_digest,
    authorization: { kind: row.authorization_kind, ref: row.authorization_ref,
      revision: parseSafeInteger(row.authorization_revision), digest: row.authorization_digest },
    runtimePolicy: { id: row.runtime_policy_id, version: parseSafeInteger(row.runtime_policy_version),
      maxAttempts: row.max_attempts, attemptTimeoutSeconds: row.attempt_timeout_seconds,
      leaseSeconds: row.lease_seconds, baseBackoffSeconds: row.base_backoff_seconds, retryMode: row.retry_mode },
    attempt: row.attempt_count, leaseEpoch: parseSafeInteger(row.lease_epoch), state: row.state,
    replayGeneration: parseSafeInteger(row.replay_generation),
  };
}

function mintLeasedJobHandle(job: JobRuntimeRecord, workerId: string): LeasedJobHandle {
  const scope = Object.freeze({ accountId: job.tenant.accountId, workspaceId: job.tenant.workspaceId });
  return new PrivateLeasedJobHandle(Object.freeze({
    scope,
    jobId: job.jobId,
    jobKind: job.jobKind,
    partitionKey: job.partitionKey,
    workerId,
    leaseEpoch: job.leaseEpoch,
    attempt: job.attempt,
  }));
}

async function lockFenced(transaction: TenantTransaction, authority: LeaseAuthority): Promise<JobRuntimeRecord | null> {
  const result = await transaction.query<{ job_id: string }>(
    `SELECT j.job_id FROM job_runtime_jobs j
     JOIN job_runtime_partition_leases p USING (account_id,workspace_id,job_kind,partition_key)
     WHERE j.account_id=$1 AND j.workspace_id=$2 AND j.job_id=$3 AND j.state='leased'
       AND j.current_worker=$4 AND j.lease_epoch=$5 AND j.attempt_count=$6
       AND j.job_kind=$7 AND j.partition_key=$8
       AND j.lease_expires_at>clock_timestamp() AND j.attempt_deadline_at>clock_timestamp()
       AND p.current_job_id=j.job_id AND p.current_worker=$4 AND p.current_lease_epoch=$5
       AND p.state IN ('held','renewed') AND p.expires_at>clock_timestamp()
     FOR UPDATE OF j,p`,
    [authority.scope.accountId, authority.scope.workspaceId, authority.jobId,
      authority.workerId, authority.leaseEpoch, authority.attempt,
      authority.jobKind, authority.partitionKey],
  );
  return result.rows[0] === undefined ? null : selectByJobId(transaction, authority.jobId, false);
}

async function completeFenced(transaction: TenantTransaction, authority: LeaseAuthority, digest: Uint8Array, fault?: (point: JobRuntimeFaultPoint) => void) {
  await transaction.query(
    `UPDATE job_runtime_attempts SET outcome='succeeded',finished_at=clock_timestamp()
     WHERE account_id=$1 AND workspace_id=$2 AND job_id=$3 AND attempt_no=$4 AND lease_epoch=$5 AND outcome='running'`,
    [authority.scope.accountId, authority.scope.workspaceId, authority.jobId, authority.attempt, authority.leaseEpoch],
  );
  fault?.("after_completion_attempt");
  await transaction.query(
    `UPDATE job_runtime_jobs SET state='completed',terminal_at=clock_timestamp(),terminal_outcome_digest=$4,
       current_worker=NULL,lease_acquired_at=NULL,lease_renewed_at=NULL,lease_expires_at=NULL,attempt_deadline_at=NULL
     WHERE account_id=$1 AND workspace_id=$2 AND job_id=$3`,
    [authority.scope.accountId, authority.scope.workspaceId, authority.jobId, Buffer.from(digest)],
  );
  fault?.("after_completion_job");
  await releasePartition(transaction, authority, "released", fault);
}

async function quarantineFenced(transaction: TenantTransaction, authority: LeaseAuthority, job: JobRuntimeRecord, reason: QuarantineReason, fault?: (point: JobRuntimeFaultPoint) => void) {
  await transaction.query(
    `UPDATE job_runtime_attempts SET outcome='quarantined',finished_at=clock_timestamp()
     WHERE account_id=$1 AND workspace_id=$2 AND job_id=$3 AND attempt_no=$4 AND lease_epoch=$5 AND outcome='running'`,
    [authority.scope.accountId, authority.scope.workspaceId, authority.jobId, authority.attempt, authority.leaseEpoch],
  );
  fault?.("after_quarantine_attempt");
  await transaction.query(
    `UPDATE job_runtime_jobs SET state='quarantined',terminal_at=clock_timestamp(),
       current_worker=NULL,lease_acquired_at=NULL,lease_renewed_at=NULL,lease_expires_at=NULL,attempt_deadline_at=NULL
     WHERE account_id=$1 AND workspace_id=$2 AND job_id=$3`,
    [authority.scope.accountId, authority.scope.workspaceId, authority.jobId],
  );
  fault?.("after_quarantine_job");
  await insertQuarantine(transaction, job, `quarantine-${randomUUID()}`, reason, null);
  fault?.("after_quarantine_event");
  await releasePartition(transaction, authority, "released", fault);
}

async function insertQuarantine(transaction: TenantTransaction, job: JobRuntimeRecord, quarantineId: string, reason: QuarantineReason, incoming: string | null) {
  await transaction.query(
    `INSERT INTO job_runtime_quarantine_events
      (account_id,workspace_id,job_id,quarantine_id,quarantine_revision,reason,
       frozen_request_digest,frozen_payload_digest,frozen_authorization_digest,
       frozen_idempotency_digest,incoming_request_digest,lease_epoch,attempt_no)
     SELECT $1,$2,$3,$4,coalesce(max(quarantine_revision),0)+1,$5,decode($6,'hex'),decode($7,'hex'),
       decode($8,'hex'),decode($9,'hex'),CASE WHEN $10::text IS NULL THEN NULL ELSE decode($10,'hex') END,$11,$12
     FROM job_runtime_quarantine_events WHERE account_id=$1 AND workspace_id=$2 AND job_id=$3`,
    [job.tenant.accountId, job.tenant.workspaceId, job.jobId, quarantineId, reason,
      job.requestDigest, job.payloadDigest, job.authorization.digest,
      sha256Text(`gooddealer.job.idempotency.v1\0${job.jobKind}\0${job.idempotencyKey}`), incoming,
      job.leaseEpoch, job.attempt],
  );
}

async function releasePartition(transaction: TenantTransaction, authority: LeaseAuthority, state: "released" | "expired", fault?: (point: JobRuntimeFaultPoint) => void) {
  await transaction.query(
    `UPDATE job_runtime_partition_leases SET state=$7,current_job_id=NULL,current_worker=NULL,
       current_lease_epoch=NULL,expires_at=NULL
     WHERE account_id=$1 AND workspace_id=$2 AND job_kind=$3 AND partition_key=$4
       AND current_worker=$5 AND current_lease_epoch=$6`,
    [authority.scope.accountId, authority.scope.workspaceId, authority.jobKind, authority.partitionKey,
      authority.workerId, authority.leaseEpoch, state],
  );
  fault?.("after_release_partition");
}

function consumeHandle(handle: LeasedJobHandle): LeaseAuthority {
  const authority = handle instanceof PrivateLeasedJobHandle ? leasedHandleAuthorities.get(handle) : undefined;
  if (authority === undefined || !leasedHandleAuthorities.delete(handle)) {
    throw new TypeError("leased job handle is invalid or already consumed");
  }
  return authority;
}

function consumeReplayCapability(capability: VerifiedJobReplayCapability, owner: object): ReplayCapabilityAuthority {
  const authority = capability instanceof PrivateVerifiedJobReplayCapability
    ? replayCapabilityAuthorities.get(capability)
    : undefined;
  if (authority === undefined || authority.owner !== owner || !replayCapabilityAuthorities.delete(capability)) {
    throw new TypeError("verified replay capability is invalid or already consumed");
  }
  return authority;
}

function freezeReplayAuthority(
  owner: object,
  scope: WorkspaceTenantScope,
  input: Parameters<PostgresJobRuntime["verifyReplayAuthorization"]>[1],
): ReplayCapabilityAuthority {
  return Object.freeze({
    owner,
    scope: Object.freeze({ accountId: scope.accountId, workspaceId: scope.workspaceId }),
    jobId: input.jobId,
    quarantineId: input.quarantineId,
    expectedQuarantineRevision: input.expectedQuarantineRevision,
    expectedReplayGeneration: input.expectedReplayGeneration,
    authorization: Object.freeze({ ...input.authorization }),
  });
}

function assertReplayInput(input: Parameters<PostgresJobRuntime["verifyReplayAuthorization"]>[1]): void {
  assertExactDataObject(input, ["jobId", "quarantineId", "expectedQuarantineRevision", "expectedReplayGeneration", "authorization"], "replay input");
  assertExactDataObject(input.authorization, ["kind", "ref", "revision", "digest"], "replay authorization");
  assertIdentifier(input.jobId, "job id");
  assertIdentifier(input.quarantineId, "quarantine id");
  assertIdentifier(input.authorization.ref, "replay authorization ref");
  for (const value of [input.expectedQuarantineRevision, input.expectedReplayGeneration, input.authorization.revision]) {
    if (!Number.isSafeInteger(value) || value < 0) throw new TypeError("replay revision is invalid");
  }
  if (input.authorization.kind !== "admin_action" || !/^[0-9a-f]{64}$/u.test(input.authorization.digest)) {
    throw new TypeError("replay authorization is invalid");
  }
}

function assertExactDataObject(value: unknown, expectedKeys: readonly string[], label: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError(`${label} is invalid`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${label} has an unsupported prototype`);
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key === "symbol")) throw new TypeError(`${label} contains symbol keys`);
  if (ownKeys.length !== expectedKeys.length || expectedKeys.some((key) => !ownKeys.includes(key))) throw new TypeError(`${label} fields are invalid`);
  const keys = ownKeys as string[];
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) throw new TypeError(`${label}.${key} is not an own data property`);
  }
}

function assertIdentifier(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !/^[!-~]{1,160}$/u.test(value)) throw new TypeError(`${label} is unresolved`);
}
function definitionKey(kind: string, target: string, version: number) { return `${kind}\0${target}\0${version}`; }
function sha256(value: Uint8Array) { return createHash("sha256").update(value).digest("hex"); }
function sha256Text(value: string) { return createHash("sha256").update(value, "utf8").digest("hex"); }
function bytesEqual(left: Uint8Array, right: Uint8Array) { return Buffer.from(left).equals(Buffer.from(right)); }
function sameRuntimePolicy(left: PersistentJobRuntimePolicy, right: PersistentJobRuntimePolicy) {
  return left.id === right.id && left.version === right.version && left.maxAttempts === right.maxAttempts
    && left.attemptTimeoutSeconds === right.attemptTimeoutSeconds && left.leaseSeconds === right.leaseSeconds
    && left.baseBackoffSeconds === right.baseBackoffSeconds && left.retryMode === right.retryMode;
}
function parseSafeInteger(value: string | number | undefined): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new TypeError("stored job-runtime integer is invalid");
  return parsed;
}
function requiredRow<Row>(row: Row | undefined, label: string): Row {
  if (row === undefined) throw new Error(`${label} is unresolved`);
  return row;
}
