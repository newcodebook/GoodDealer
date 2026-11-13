/**
 * Deterministic multi-tenant workload for the live PostgreSQL durability evidence (capacity,
 * crash recovery and soak). Every tenant is a separate account that owns the same workspace id,
 * so isolation is proven on identical literal ids. Each mutation is fully determined by
 * (tenant, sequence): a crashed run can be resumed by resubmitting the whole plan, and the
 * Cloud must answer every committed item as an exact duplicate at its stored revision.
 */
import { Pool } from "pg";

import { submittedSyncMutationSchema } from "@gooddealer/protocol/workspace";

import { runCloudMigrations, TenantTransactionRunner } from "../../../src/db/index";
import { cloudMigrations } from "../../../src/db/migrations";
import { PostgresMutationAuthority } from "../../../src/modules/devices/index";
import type { MutationIngestResult } from "../../../src/modules/workspace/mutations/index";
import { PostgresWorkspaceMutationIngest } from "../../../src/modules/workspace/mutations/postgres-ingest-service";
import { PostgresWorkspaceMutationRepository } from "../../../src/modules/workspace/mutations/postgres-repository";
import { PostgresWorkspaceRevisionRepository } from "../../../src/modules/workspace/revisions/index";
import { PostgresPortfolioRepository } from "../../../src/modules/workspace/state/portfolio/index";
import type { WorkspaceTenantScope } from "../../../src/modules/workspace/tenant-scope";

export const DURABILITY_WORKSPACE_ID = "durability-workspace";
const ENTITY_ID = "durable-asset.test";
const DEVICE_ID = "device-1";

export interface DurabilityHarness {
  readonly ownerPool: Pool;
  readonly appPool: Pool;
  readonly transactions: TenantTransactionRunner;
  readonly ingest: PostgresWorkspaceMutationIngest;
  close(): Promise<void>;
}

export function durabilityHarness(appConnections: number): DurabilityHarness {
  const ownerPool = new Pool({ connectionString: requiredEnvironment("GOODDEALER_POSTGRES_OWNER_URL"), max: 1 });
  const appPool = new Pool({ connectionString: requiredEnvironment("GOODDEALER_POSTGRES_APP_URL"), max: appConnections });
  // A server kill surfaces as an `error` event on every connection, idle or checked out. The
  // operation that owned a checked-out connection already rejects on its own, so the event must not
  // crash the process: a crash test has to outlive the kill to report what was acknowledged.
  for (const pool of [appPool, ownerPool]) {
    pool.on("error", () => undefined);
    pool.on("connect", (client) => { client.on("error", () => undefined); });
  }
  const transactions = new TenantTransactionRunner(appPool);
  const ingest = new PostgresWorkspaceMutationIngest({
    transactions,
    authority: new PostgresMutationAuthority(),
    revisions: new PostgresWorkspaceRevisionRepository(),
    portfolio: new PostgresPortfolioRepository(),
    mutations: new PostgresWorkspaceMutationRepository(),
  });
  return {
    ownerPool,
    appPool,
    transactions,
    ingest,
    close: async () => { await Promise.all([ownerPool.end(), appPool.end()]); },
  };
}

export function tenant(index: number): WorkspaceTenantScope {
  return { accountId: `durability-account-${index}`, workspaceId: DURABILITY_WORKSPACE_ID };
}

export async function requireQualifiedServer(harness: DurabilityHarness): Promise<string> {
  const version = (await harness.ownerPool.query<{ server_version: string }>("SHOW server_version")).rows[0]?.server_version ?? "unknown";
  if (process.env.GOODDEALER_UNQUALIFIED_POSTGRES_DIAGNOSTIC === "true") {
    console.warn(`UNQUALIFIED PostgreSQL diagnostic only: ${version}`);
  } else if (!/^18\.6(?:\D|$)/u.test(version)) {
    throw new Error(`durability evidence qualifies only PostgreSQL 18.6, not ${version}`);
  }
  return version;
}

/** Migrates, clears every table the workload writes and binds `tenants` fresh tenants. */
export async function resetTenants(harness: DurabilityHarness, tenants: number): Promise<void> {
  await runCloudMigrations(harness.ownerPool, cloudMigrations);
  await harness.ownerPool.query(`TRUNCATE
    workspace_mutation_fields, workspace_mutations, workspace_mutation_receipts,
    workspace_device_audit_drain_seals, workspace_device_audit_drain_records,
    workspace_device_audit_drain_heads,
    execution_fact_drain_seals, execution_fact_drain_records, execution_fact_drain_heads,
    mutation_drain_seals, mutation_drain_records, mutation_drain_heads,
    workspace_replica_domain_assets, workspace_revisions,
    device_active_leases, device_lease_epoch_allocations, device_bindings, device_account_states CASCADE`);
  const revisions = new PostgresWorkspaceRevisionRepository();
  const portfolio = new PostgresPortfolioRepository();
  for (let index = 0; index < tenants; index += 1) {
    const scope = tenant(index);
    await harness.transactions.withTenant(scope, async (transaction) => {
      await revisions.bind(transaction, 1);
      await transaction.query("INSERT INTO device_account_states (account_id) VALUES ($1)", [scope.accountId]);
      await transaction.query(`INSERT INTO device_bindings
        (account_id, device_id, slot, status, credential_epoch)
        VALUES ($1, $2, 1, 'bound', 1)`, [scope.accountId, DEVICE_ID]);
      await transaction.query(`INSERT INTO device_lease_epoch_allocations
        (account_id, workspace_id, workflow_id, lease_epoch, status, terminal_at)
        VALUES ($1, $2, 'durability-ingest', 1, 'activated', transaction_timestamp())`,
      [scope.accountId, scope.workspaceId]);
      // The Lease outlives the longest soak, so expiry never masquerades as a durability failure.
      await transaction.query(`INSERT INTO device_active_leases
        (account_id, lease_epoch, device_id, jti, issued_at, renew_after, online_expires_at,
         offline_execute_until, signed_envelope, wire_envelope, signer_receipt_digest)
        VALUES ($1, 1, $2, $3, transaction_timestamp() - interval '2 minutes',
          transaction_timestamp() - interval '1 minute', transaction_timestamp() + interval '1 day',
          transaction_timestamp() + interval '2 days', decode('01', 'hex'),
          jsonb_build_object('fixture', 'workspace-sync-durability'), pg_catalog.sha256(decode('01', 'hex')))`,
      [scope.accountId, DEVICE_ID, `durability-lease-${scope.accountId}`]);
      await portfolio.seed(transaction, { entityId: ENTITY_ID, note: null, portfolioId: null, tags: [], targetPrice: null });
    });
  }
}

/** The `sequence`th (1-based) edit of a tenant: a note write based on the revision before it. */
export function plannedPush(tenantIndex: number, sequence: number) {
  const mutation = submittedSyncMutationSchema.parse({
    schemaVersion: 2,
    mutationId: `durability-${tenantIndex}-${sequence}`,
    workspaceId: DURABILITY_WORKSPACE_ID,
    workspaceSchemaVersion: 1,
    entityType: "domain_asset",
    entityId: ENTITY_ID,
    operationKind: "upsert",
    baseServerRevision: sequence - 1,
    changedFields: [{ fieldPath: "note", value: plannedNote(tenantIndex, sequence) }],
    sourceDeviceId: DEVICE_ID,
    activeLeaseEpoch: 1,
    deviceMutationSequence: sequence,
  });
  const { workspaceId: _workspaceId, ...wire } = mutation;
  return { schemaVersion: 2 as const, mutations: [wire] };
}

export function plannedNote(tenantIndex: number, sequence: number): string {
  return `durable-${tenantIndex}-${sequence}`;
}

/**
 * Submits a tenant's plan from `from` through `through` in order. Each item must be accepted at
 * exactly its own sequence (the plan is linear, so revision == sequence); a duplicate is allowed
 * only when `allowDuplicates` (resuming after a crash).
 */
export async function runTenantPlan(
  harness: DurabilityHarness,
  tenantIndex: number,
  from: number,
  through: number,
  options: {
    readonly allowDuplicates: boolean;
    readonly latencies?: number[];
    readonly duplicates?: { count: number };
    /** Called with each sequence the Cloud acknowledged, in order; a crash test records them. */
    readonly onAcknowledged?: (sequence: number) => void;
  },
): Promise<void> {
  for (let sequence = from; sequence <= through; sequence += 1) {
    const started = performance.now();
    const result: MutationIngestResult = await harness.ingest.ingest(tenant(tenantIndex), plannedPush(tenantIndex, sequence));
    options.latencies?.push(performance.now() - started);
    if (!result.accepted) throw new Error(`tenant ${tenantIndex} sequence ${sequence} rejected: ${result.code}`);
    const assignment = result.assignments[0];
    if (result.assignments.length !== 1 || assignment?.serverRevision !== sequence) {
      throw new Error(`tenant ${tenantIndex} sequence ${sequence} assigned ${JSON.stringify(result.assignments)}`);
    }
    if (assignment.duplicate) {
      if (!options.allowDuplicates) throw new Error(`tenant ${tenantIndex} sequence ${sequence} replayed unexpectedly`);
      if (options.duplicates !== undefined) options.duplicates.count += 1;
    }
    options.onAcknowledged?.(sequence);
  }
}

export interface TenantState {
  readonly head: number;
  readonly mutations: number;
  readonly receipts: number;
  readonly fields: number;
  readonly minRevision: number | null;
  readonly maxRevision: number | null;
  readonly drainContiguous: number;
  readonly drainHighest: number;
  readonly note: string | null;
  readonly foreignRows: number;
}

/**
 * Reads one tenant through the application role on a single repeatable-read snapshot. RLS must
 * confine every count to this tenant even though all tenants share the workspace id; `foreignRows`
 * asks explicitly for other accounts' rows and must be zero.
 */
export async function readTenant(harness: DurabilityHarness, tenantIndex: number): Promise<TenantState> {
  const scope = tenant(tenantIndex);
  return harness.transactions.withTenant(scope, async (transaction) => {
    const row = (await transaction.query<{
      head: string | null; mutations: string; receipts: string; fields: string; min: string | null; max: string | null;
      contiguous: string | null; highest: string | null; note: string | null; foreign: string;
    }>(`SELECT
        (SELECT server_revision::text FROM workspace_revisions) AS head,
        (SELECT count(*)::text FROM workspace_mutations) AS mutations,
        (SELECT count(*)::text FROM workspace_mutation_receipts) AS receipts,
        (SELECT count(*)::text FROM workspace_mutation_fields) AS fields,
        (SELECT min(server_revision)::text FROM workspace_mutations) AS min,
        (SELECT max(server_revision)::text FROM workspace_mutations) AS max,
        (SELECT contiguous_received_through::text FROM mutation_drain_heads) AS contiguous,
        (SELECT highest_received_sequence::text FROM mutation_drain_heads) AS highest,
        (SELECT note FROM workspace_replica_domain_assets WHERE entity_id = $1) AS note,
        ((SELECT count(*) FROM workspace_mutations WHERE account_id <> $2)
          + (SELECT count(*) FROM workspace_mutation_receipts WHERE account_id <> $2)
          + (SELECT count(*) FROM workspace_revisions WHERE account_id <> $2))::text AS foreign`,
    [ENTITY_ID, scope.accountId])).rows[0];
    if (row === undefined) throw new Error(`tenant ${tenantIndex} state is unreadable`);
    return {
      head: Number(row.head ?? Number.NaN),
      mutations: Number(row.mutations),
      receipts: Number(row.receipts),
      fields: Number(row.fields),
      minRevision: row.min === null ? null : Number(row.min),
      maxRevision: row.max === null ? null : Number(row.max),
      drainContiguous: Number(row.contiguous ?? 0),
      drainHighest: Number(row.highest ?? 0),
      note: row.note,
      foreignRows: Number(row.foreign),
    };
  }, { readOnly: true, repeatableRead: true });
}

/**
 * The invariant every committed state must satisfy, whatever point a crash interrupted: the head,
 * the dense mutation log, the receipts, the changed fields, the Drain head and the materialized
 * replica all describe the same prefix of the plan, and nothing of another tenant is visible.
 */
export function tenantInvariantErrors(tenantIndex: number, state: TenantState): readonly string[] {
  const n = state.head;
  const errors: string[] = [];
  if (!Number.isSafeInteger(n) || n < 0) errors.push(`head ${n} is not a revision`);
  if (state.mutations !== n) errors.push(`${state.mutations} mutations for head ${n}`);
  if (state.receipts !== n) errors.push(`${state.receipts} receipts for head ${n}`);
  if (state.fields !== n) errors.push(`${state.fields} changed fields for head ${n}`);
  if (n > 0 && (state.minRevision !== 1 || state.maxRevision !== n)) {
    errors.push(`mutation log spans ${state.minRevision}..${state.maxRevision}, not 1..${n}`);
  }
  if (state.drainContiguous !== n || state.drainHighest !== n) {
    errors.push(`Drain head ${state.drainContiguous}/${state.drainHighest} for head ${n}`);
  }
  const expectedNote = n === 0 ? null : plannedNote(tenantIndex, n);
  if (state.note !== expectedNote) errors.push(`replica note ${state.note} is not ${expectedNote}`);
  if (state.foreignRows !== 0) errors.push(`${state.foreignRows} rows of other tenants are visible`);
  return errors.map((error) => `tenant ${tenantIndex}: ${error}`);
}

export function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))] ?? Number.NaN;
}

export function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required; PostgreSQL integration evidence never skips`);
  }
  return value;
}
