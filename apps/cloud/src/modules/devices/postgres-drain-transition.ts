import type { TenantTransaction, TenantTransactionRunner } from "../../db/index";
import type { IdentityAccountSecurityStatePort } from "../identity/index";
import type { TransactionalDrainLedgerPort } from "./ports";

export const DEVICE_DRAIN_LOCK_ORDER = [
  "identity_account_security_state",
  "device_account_state",
  "bindings_by_device_id",
  "signing_key",
  "workflow",
  "held_lease_and_epoch",
  "proof",
  "mutation_head",
  "execution_fact_head",
  "device_audit_head",
  "bootstrap_rows",
] as const;

export type PostgresDrainFaultPoint =
  | "after_proof_consumption"
  | "after_mutation_seal"
  | "after_execution_fact_seal"
  | "after_device_audit_seal"
  | "after_lease_release"
  | "after_epoch_allocation"
  | "after_capability_creation"
  | "after_workflow_transition";

export interface PostgresDrainTransitionResult {
  readonly status: "bootstrapping";
  readonly workflowId: string;
  readonly workflowRevision: number;
  readonly pendingLeaseEpoch: number;
  readonly bootstrapCapabilityJti: string;
  readonly bootstrapIssuedAt: string;
  readonly bootstrapExpiresAt: string;
}

export type PostgresDrainTransitionAttempt =
  | PostgresDrainTransitionResult
  | { readonly status: "rejected"; readonly reason: DrainTransitionRejection };

export type DrainTransitionRejection =
  | "ACCOUNT_STATE_UNRESOLVED"
  | "ACCOUNT_SECURITY_CONFLICT"
  | "WORKFLOW_CONFLICT"
  | "WORKFLOW_EXPIRED"
  | "BINDING_CONFLICT"
  | "SIGNING_KEY_CONFLICT"
  | "LEASE_CONFLICT"
  | "PROOF_CONFLICT"
  | "PROOF_EXPIRED"
  | "STREAM_HEAD_CONFLICT"
  | "PROOF_REPLAY_CONFLICT";

export class PostgresDeviceDrainTransition {
  constructor(
    private readonly transactions: TenantTransactionRunner,
    private readonly accountSecurity: IdentityAccountSecurityStatePort,
    private readonly mutation: TransactionalDrainLedgerPort<"mutation">,
    private readonly executionFact: TransactionalDrainLedgerPort<"execution_fact">,
    private readonly deviceAudit: TransactionalDrainLedgerPort<"device_audit">,
    private readonly fault?: (point: PostgresDrainFaultPoint) => void,
  ) {}

  async commit(input: {
    readonly accountId: string;
    readonly workspaceId: string;
    readonly workflowId: string;
    readonly expectedWorkflowRevision: number;
    readonly targetDeviceId: string;
    readonly proofId: string;
    readonly proofDigest: string;
    readonly bootstrapCapabilityJti: string;
  }): Promise<PostgresDrainTransitionAttempt> {
    assertIdentifier(input.workflowId, "workflow id");
    assertIdentifier(input.targetDeviceId, "target device id", 160);
    assertIdentifier(input.proofId, "proof id");
    assertIdentifier(input.bootstrapCapabilityJti, "bootstrap capability jti");
    if (!Number.isSafeInteger(input.expectedWorkflowRevision) || input.expectedWorkflowRevision < 1) {
      throw new TypeError("workflow revision is invalid");
    }
    const proofDigest = decodeDigest(input.proofDigest);
    const scope = { accountId: input.accountId, workspaceId: input.workspaceId };
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.transactions.withTenant(scope, (transaction) => this.#commitOnce(transaction, input, proofDigest));
      } catch (error) {
        if (error instanceof DrainRefusal) return { status: "rejected", reason: error.reason };
        if (attempt < 2 && isRetryableTransactionError(error)) continue;
        throw error;
      }
    }
  }

  async #commitOnce(
    transaction: TenantTransaction,
    input: {
      readonly workflowId: string;
      readonly expectedWorkflowRevision: number;
      readonly targetDeviceId: string;
      readonly proofId: string;
      readonly bootstrapCapabilityJti: string;
    },
    proofDigest: Uint8Array,
  ): Promise<PostgresDrainTransitionResult> {
    await transaction.query("SET LOCAL lock_timeout = '2s'");
    await transaction.query("SET LOCAL statement_timeout = '10s'");

    // Identity security authority is the first account lock class. Auth writers stop there;
    // device writers continue forward and no device writer may later acquire an identity lock.
    const security = await this.accountSecurity.lockCurrent(transaction);
    if (security === null || security.status !== "normal") refuse("ACCOUNT_SECURITY_CONFLICT");

    // Every writer may omit a suffix of DEVICE_DRAIN_LOCK_ORDER, but never move backwards.
    const account = await transaction.query<{ highest_allocated_lease_epoch: string }>(
      `SELECT highest_allocated_lease_epoch FROM device_account_states
       WHERE account_id = $1 FOR UPDATE`, [transaction.scope.accountId]);
    if (account.rows[0] === undefined) refuse("ACCOUNT_STATE_UNRESOLVED");

    // This read only discovers keys for the earlier binding and signing-key lock classes. It
    // carries no digest, sequence, or head authority; the devices owner routine locks and checks
    // the proof only after the held-Lease lock has been acquired.
    const discovered = await transaction.query<ProofDiscoveryRow>(
      `SELECT source_device_id, active_lease_epoch, signing_key_id, signing_key_version
       FROM device_drain_proofs
       WHERE account_id = $1 AND workspace_id = $2 AND proof_id = $3`,
      [transaction.scope.accountId, transaction.scope.workspaceId, input.proofId]);
    const snapshot = discovered.rows[0];
    if (snapshot === undefined) refuse("PROOF_CONFLICT");

    const bindings = await transaction.query<{ device_id: string; status: "bound" | "removed" }>(
      `SELECT device_id, status FROM device_bindings
       WHERE account_id = $1 AND device_id = ANY($2::text[]) ORDER BY device_id COLLATE "C" FOR UPDATE`,
      [transaction.scope.accountId, [...new Set([snapshot.source_device_id, input.targetDeviceId])].sort()],
    );
    if (bindings.rows.length !== new Set([snapshot.source_device_id, input.targetDeviceId]).size ||
      bindings.rows.some(({ status }) => status !== "bound")) refuse("BINDING_CONFLICT");

    const key = await transaction.query<{ status: "active" | "rotated" | "revoked" }>(
      `SELECT status FROM device_signing_keys
       WHERE account_id = $1 AND device_id = $2 AND key_id = $3 AND key_version = $4 FOR UPDATE`,
      [transaction.scope.accountId, snapshot.source_device_id, snapshot.signing_key_id, snapshot.signing_key_version],
    );
    if (key.rows[0]?.status !== "active") refuse("SIGNING_KEY_CONFLICT");

    const workflow = await transaction.query<{
      status: string; workflow_revision: string; from_device_id: string | null; to_device_id: string;
      bound_key_id: string; bound_key_version: string; bound_account_security_epoch: string;
      deadline_live: boolean;
    }>(
      `SELECT status, workflow_revision, from_device_id, to_device_id, bound_key_id, bound_key_version,
              bound_account_security_epoch, transaction_timestamp() < state_deadline AS deadline_live
       FROM device_switch_workflows
       WHERE account_id = $1 AND workspace_id = $2 AND workflow_id = $3 FOR UPDATE`,
      [transaction.scope.accountId, transaction.scope.workspaceId, input.workflowId],
    );
    const workflowRow = workflow.rows[0];
    if (workflowRow === undefined ||
      workflowRow.from_device_id !== snapshot.source_device_id || workflowRow.to_device_id !== input.targetDeviceId ||
      workflowRow.bound_key_id !== snapshot.signing_key_id ||
      parseStoredInteger(workflowRow.bound_key_version) !== parseStoredInteger(snapshot.signing_key_version)) {
      refuse("WORKFLOW_CONFLICT");
    }
    if (parseStoredInteger(workflowRow.bound_account_security_epoch) !== security.accountSecurityEpoch) {
      refuse("ACCOUNT_SECURITY_CONFLICT");
    }
    if (workflowRow.status === "bootstrapping") {
      if (parseStoredInteger(workflowRow.workflow_revision) !== input.expectedWorkflowRevision + 1) {
        refuse("WORKFLOW_CONFLICT");
      }
      const replay = await readCommittedReplay(transaction, input, proofDigest);
      if (replay === null) refuse("PROOF_REPLAY_CONFLICT");
      return replay;
    }
    if (workflowRow.status !== "draining" ||
      parseStoredInteger(workflowRow.workflow_revision) !== input.expectedWorkflowRevision) refuse("WORKFLOW_CONFLICT");
    if (!workflowRow.deadline_live) refuse("WORKFLOW_EXPIRED");

    const lease = await transaction.query<{ device_id: string; lease_epoch: string }>(
      `SELECT device_id, lease_epoch FROM device_active_leases
       WHERE account_id = $1 AND released_at IS NULL FOR UPDATE`, [transaction.scope.accountId]);
    const held = lease.rows[0];
    if (held === undefined || held.device_id !== snapshot.source_device_id ||
      parseStoredInteger(held.lease_epoch) !== parseStoredInteger(snapshot.active_lease_epoch)) refuse("LEASE_CONFLICT");

    const consumed = await consumeHandoffProof(transaction, {
      proofId: input.proofId,
      proofDigest,
      workflowId: input.workflowId,
      expectedWorkflowRevision: input.expectedWorkflowRevision,
      targetDeviceId: input.targetDeviceId,
    });
    if (!consumed.accepted) refuse(consumed.reason);
    if (consumed.sourceDeviceId !== snapshot.source_device_id ||
      consumed.activeLeaseEpoch !== parseStoredInteger(snapshot.active_lease_epoch)) refuse("PROOF_CONFLICT");
    this.fault?.("after_proof_consumption");

    const ledgers = [this.mutation, this.executionFact, this.deviceAudit] as const;
    for (const ledger of ledgers) {
      if (!(await ledger.installAcceptedSeal(transaction, { proofId: input.proofId }))) {
        refuse("STREAM_HEAD_CONFLICT");
      }
      this.fault?.(ledger.stream === "mutation" ? "after_mutation_seal" :
        ledger.stream === "execution_fact" ? "after_execution_fact_seal" : "after_device_audit_seal");
    }

    const released = await transaction.query(
      `UPDATE device_active_leases SET released_at = transaction_timestamp(), release_reason = 'normal_handoff'
       WHERE account_id = $1 AND lease_epoch = $2 AND device_id = $3 AND released_at IS NULL`,
      [transaction.scope.accountId, consumed.activeLeaseEpoch, consumed.sourceDeviceId]);
    if (released.rowCount !== 1) refuse("LEASE_CONFLICT");
    this.fault?.("after_lease_release");

    const epoch = await transaction.query<{ highest_allocated_lease_epoch: string }>(
      `UPDATE device_account_states
       SET highest_allocated_lease_epoch = highest_allocated_lease_epoch + 1, updated_at = transaction_timestamp()
       WHERE account_id = $1 AND highest_allocated_lease_epoch < 9007199254740991
       RETURNING highest_allocated_lease_epoch`, [transaction.scope.accountId]);
    const pendingLeaseEpoch = parseStoredInteger(epoch.rows[0]?.highest_allocated_lease_epoch);
    await transaction.query(
      `INSERT INTO device_lease_epoch_allocations
         (account_id, workspace_id, workflow_id, lease_epoch, status)
       VALUES ($1, $2, $3, $4, 'pending')`,
      [transaction.scope.accountId, transaction.scope.workspaceId, input.workflowId, pendingLeaseEpoch]);
    this.fault?.("after_epoch_allocation");

    const capability = await transaction.query<{ issued_at: Date; expires_at: Date }>(
      `INSERT INTO device_bootstrap_capabilities
         (account_id, workspace_id, workflow_id, jti, target_device_id, issued_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, transaction_timestamp(), transaction_timestamp() + interval '1 hour')
       RETURNING issued_at, expires_at`,
      [transaction.scope.accountId, transaction.scope.workspaceId, input.workflowId,
        input.bootstrapCapabilityJti, input.targetDeviceId]);
    this.fault?.("after_capability_creation");

    const transitioned = await transaction.query<{ workflow_revision: string }>(
      `UPDATE device_switch_workflows
       SET status = 'bootstrapping', pending_lease_epoch = $5,
           workflow_revision = workflow_revision + 1, updated_at = transaction_timestamp()
       WHERE account_id = $1 AND workspace_id = $2 AND workflow_id = $3
         AND status = 'draining' AND workflow_revision = $4
       RETURNING workflow_revision`,
      [transaction.scope.accountId, transaction.scope.workspaceId, input.workflowId,
        input.expectedWorkflowRevision, pendingLeaseEpoch]);
    const workflowRevision = parseStoredInteger(transitioned.rows[0]?.workflow_revision);
    this.fault?.("after_workflow_transition");
    const capabilityRow = capability.rows[0];
    if (capabilityRow === undefined) throw new TypeError("bootstrap capability insert returned no row");
    return {
      status: "bootstrapping",
      workflowId: input.workflowId,
      workflowRevision,
      pendingLeaseEpoch,
      bootstrapCapabilityJti: input.bootstrapCapabilityJti,
      bootstrapIssuedAt: canonicalTimestamp(capabilityRow.issued_at),
      bootstrapExpiresAt: canonicalTimestamp(capabilityRow.expires_at),
    };
  }
}

interface ProofDiscoveryRow {
  readonly source_device_id: string;
  readonly active_lease_epoch: string;
  readonly signing_key_id: string;
  readonly signing_key_version: string;
}

type ConsumedProof =
  | { readonly accepted: true; readonly sourceDeviceId: string; readonly activeLeaseEpoch: number }
  | { readonly accepted: false; readonly reason: DrainTransitionRejection };

/**
 * This is the sole devices-owned proof write boundary. The SECURITY DEFINER routine locks and
 * consumes the tenant-scoped proof; TypeScript receives neither stream seals nor head claims.
 */
async function consumeHandoffProof(
  transaction: TenantTransaction,
  input: {
    readonly proofId: string;
    readonly proofDigest: Uint8Array;
    readonly workflowId: string;
    readonly expectedWorkflowRevision: number;
    readonly targetDeviceId: string;
  },
): Promise<ConsumedProof> {
  const result = await transaction.query<{
    accepted: boolean;
    rejection_reason: string | null;
    source_device_id: string | null;
    active_lease_epoch: string | null;
  }>(
    `SELECT accepted, rejection_reason, source_device_id, active_lease_epoch
     FROM public.device_consume_drain_proof(
       $1::text, $2::bytea, $3::text, $4::bigint, $5::text
     )`,
    [input.proofId, Buffer.from(input.proofDigest), input.workflowId,
      input.expectedWorkflowRevision, input.targetDeviceId],
  );
  const row = result.rows[0];
  if (row === undefined) throw new TypeError("proof-consumption authority returned no result");
  if (row.accepted) {
    if (row.source_device_id === null || row.active_lease_epoch === null) {
      throw new TypeError("proof-consumption authority returned incomplete claims");
    }
    return {
      accepted: true,
      sourceDeviceId: row.source_device_id,
      activeLeaseEpoch: parseStoredInteger(row.active_lease_epoch),
    };
  }
  if (!isDrainTransitionRejection(row.rejection_reason)) {
    throw new TypeError("proof-consumption authority returned an invalid rejection");
  }
  return { accepted: false, reason: row.rejection_reason };
}

async function readCommittedReplay(
  transaction: TenantTransaction,
  input: { readonly workflowId: string; readonly proofId: string; readonly bootstrapCapabilityJti: string },
  proofDigest: Uint8Array,
): Promise<PostgresDrainTransitionResult | null> {
  const result = await transaction.query<{
    status: string; workflow_revision: string; pending_lease_epoch: string | null; jti: string | null;
    issued_at: Date | null; expires_at: Date | null; proof_digest: Buffer | null; consumed_at: Date | null;
    accepted_at: Date | null;
  }>(
    `SELECT w.status, w.workflow_revision, w.pending_lease_epoch, c.jti, c.issued_at, c.expires_at,
            p.proof_digest, p.consumed_at, p.accepted_at
     FROM device_switch_workflows w
     LEFT JOIN device_bootstrap_capabilities c USING (account_id, workspace_id, workflow_id)
     LEFT JOIN device_drain_proofs p ON p.account_id = w.account_id AND p.workspace_id = w.workspace_id
       AND p.workflow_id = w.workflow_id AND p.proof_id = $4
     WHERE w.account_id = $1 AND w.workspace_id = $2 AND w.workflow_id = $3`,
    [transaction.scope.accountId, transaction.scope.workspaceId, input.workflowId, input.proofId],
  );
  const row = result.rows[0];
  if (row?.status !== "bootstrapping") return null;
  if (row.pending_lease_epoch === null || row.jti !== input.bootstrapCapabilityJti || row.issued_at === null ||
    row.expires_at === null || row.proof_digest === null || !row.proof_digest.equals(Buffer.from(proofDigest)) ||
    row.consumed_at === null || row.accepted_at === null) {
    refuse("PROOF_REPLAY_CONFLICT");
  }
  return {
    status: "bootstrapping",
    workflowId: input.workflowId,
    workflowRevision: parseStoredInteger(row.workflow_revision),
    pendingLeaseEpoch: parseStoredInteger(row.pending_lease_epoch),
    bootstrapCapabilityJti: row.jti,
    bootstrapIssuedAt: canonicalTimestamp(row.issued_at),
    bootstrapExpiresAt: canonicalTimestamp(row.expires_at),
  };
}

class DrainRefusal extends Error {
  constructor(readonly reason: DrainTransitionRejection) { super(reason); }
}
function refuse(reason: DrainTransitionRejection): never { throw new DrainRefusal(reason); }
function assertIdentifier(value: string, label: string, maximumLength = 200): void {
  if (value.length < 1 || value.length > maximumLength || !/^[!-~]+$/u.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
}
function decodeDigest(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]{43}$/u.test(value)) throw new TypeError("proof digest is invalid");
  const digest = Buffer.from(value, "base64url");
  if (digest.byteLength !== 32 || digest.toString("base64url") !== value) throw new TypeError("proof digest is invalid");
  return digest;
}
function parseStoredInteger(value: string | null | undefined): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new TypeError("stored device integer is invalid");
  return parsed;
}
function isDrainTransitionRejection(value: string | null): value is DrainTransitionRejection {
  return value === "ACCOUNT_STATE_UNRESOLVED" || value === "ACCOUNT_SECURITY_CONFLICT" ||
    value === "WORKFLOW_CONFLICT" || value === "WORKFLOW_EXPIRED" || value === "BINDING_CONFLICT" ||
    value === "SIGNING_KEY_CONFLICT" || value === "LEASE_CONFLICT" || value === "PROOF_CONFLICT" ||
    value === "PROOF_EXPIRED" || value === "STREAM_HEAD_CONFLICT" || value === "PROOF_REPLAY_CONFLICT";
}
function canonicalTimestamp(value: Date): string { return value.toISOString().replace(/\.\d{3}Z$/u, "Z"); }
function isRetryableTransactionError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error.code === "40001" || error.code === "40P01");
}
