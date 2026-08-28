import { createHash, type KeyObject, randomBytes, verify } from "node:crypto";

import {
  activeDeviceLeaseEnvelopeSchema,
  encodeActiveDeviceLeaseSignatureTranscript,
  type ActiveDeviceLeaseEnvelope,
} from "@gooddealer/protocol/devices";
import { encodeDomainSeparatedWireValue } from "@gooddealer/protocol/wire";

import type { TenantTransaction, TenantTransactionRunner } from "../../db/index";
import type {
  ActiveEntitlementDeadlinePort,
  BootstrapAccountSecurityPort,
  BootstrapCheckpointPort,
  BootstrapDeviceCursorPort,
} from "./bootstrap-persistence-ports";

export const ACTIVE_DEVICE_LEASE_KEY_PURPOSE = "gooddealer.devices.active-device-lease.v1" as const;

export interface ActiveDeviceLeaseSigner {
  sign(input: {
    readonly purpose: typeof ACTIVE_DEVICE_LEASE_KEY_PURPOSE;
    readonly claims: Omit<ActiveDeviceLeaseEnvelope, "kid" | "signature">;
  }): Promise<
    | { readonly signed: false }
    | {
      readonly signed: true;
      readonly envelope: unknown;
      readonly verificationKey: KeyObject;
      readonly receipt: Uint8Array;
    }
  >;
}

/** The only signer used by the production factory. */
export class DenyingActiveDeviceLeaseSigner implements ActiveDeviceLeaseSigner {
  async sign(): Promise<{ readonly signed: false }> {
    return { signed: false };
  }
}

export type BootstrapActivationAttempt =
  | { readonly installed: false; readonly code: "LEASE_SIGNING_DISABLED" | "ACTIVATION_CONFLICT" }
  | { readonly installed: true; readonly lease: ActiveDeviceLeaseEnvelope; readonly cursorGeneration: number };

/**
 * Internal future activation seam. Production uses the Denying signer, so the mutation branch is
 * unreachable; fixed signer construction belongs only to Cloud test support.
 */
export class PostgresBootstrapActivation {
  constructor(private readonly dependencies: {
    readonly transactions: TenantTransactionRunner;
    readonly accountSecurity: BootstrapAccountSecurityPort;
    readonly entitlement: ActiveEntitlementDeadlinePort;
    readonly checkpoints: BootstrapCheckpointPort;
    readonly cursors: BootstrapDeviceCursorPort;
    readonly signer: ActiveDeviceLeaseSigner;
    readonly fault?: (point: string) => void;
  }) {}

  async activate(input: {
    readonly accountId: string;
    readonly workspaceId: string;
    readonly workflowId: string;
    readonly expectedWorkflowRevision: number;
  }): Promise<BootstrapActivationAttempt> {
    try {
      return await this.dependencies.transactions.withTenant(
        { accountId: input.accountId, workspaceId: input.workspaceId },
        (transaction) => this.#activateOnce(transaction, input),
      );
    } catch (error) {
      if (error instanceof ActivationRefusal) return { installed: false, code: "ACTIVATION_CONFLICT" };
      throw error;
    }
  }

  async #activateOnce(
    transaction: TenantTransaction,
    input: { readonly workflowId: string; readonly expectedWorkflowRevision: number },
  ): Promise<BootstrapActivationAttempt> {
    await transaction.query("SET LOCAL lock_timeout = '2s'");
    await transaction.query("SET LOCAL statement_timeout = '10s'");
    const security = await this.dependencies.accountSecurity.lockCurrent(transaction);
    const entitlement = await this.dependencies.entitlement.lockCurrent(transaction);
    if (security === null || security.status !== "normal" || entitlement === null) refuse();
    const account = await transaction.query<{
      highest_allocated_lease_epoch: string; current_lease_epoch: string;
      exclusive_execution_block_until: Date | null; unblocked: boolean;
    }>(
      `SELECT highest_allocated_lease_epoch, current_lease_epoch, exclusive_execution_block_until,
              exclusive_execution_block_until IS NULL OR exclusive_execution_block_until <= transaction_timestamp() AS unblocked
       FROM device_account_states WHERE account_id = $1 FOR UPDATE`, [transaction.scope.accountId],
    );
    const accountRow = account.rows[0];
    if (accountRow === undefined || !accountRow.unblocked) refuse();
    const workflow = await transaction.query<{
      status: string; workflow_revision: string; to_device_id: string; bound_key_id: string;
      bound_key_version: string; bound_account_security_epoch: string; pending_lease_epoch: string | null;
    }>(
      `SELECT status, workflow_revision, to_device_id, bound_key_id, bound_key_version,
              bound_account_security_epoch, pending_lease_epoch
       FROM device_switch_workflows
       WHERE account_id = $1 AND workspace_id = $2 AND workflow_id = $3 FOR UPDATE`,
      [transaction.scope.accountId, transaction.scope.workspaceId, input.workflowId],
    );
    const workflowRow = workflow.rows[0];
    if (workflowRow === undefined || workflowRow.status !== "bootstrapping" ||
      parsePositive(workflowRow.workflow_revision) !== input.expectedWorkflowRevision ||
      parsePositive(workflowRow.bound_account_security_epoch) !== security.accountSecurityEpoch ||
      workflowRow.pending_lease_epoch === null) refuse();
    const pendingEpoch = parsePositive(workflowRow.pending_lease_epoch);
    if (pendingEpoch !== parsePositive(accountRow.highest_allocated_lease_epoch) ||
      pendingEpoch <= Number(accountRow.current_lease_epoch)) refuse();
    const binding = await transaction.query<{ status: string }>(
      `SELECT status FROM device_bindings WHERE account_id = $1 AND device_id = $2 FOR UPDATE`,
      [transaction.scope.accountId, workflowRow.to_device_id],
    );
    const key = await transaction.query<{ status: string }>(
      `SELECT status FROM device_signing_keys
       WHERE account_id = $1 AND device_id = $2 AND key_id = $3 AND key_version = $4 FOR UPDATE`,
      [transaction.scope.accountId, workflowRow.to_device_id, workflowRow.bound_key_id,
        parsePositive(workflowRow.bound_key_version)],
    );
    if (binding.rows[0]?.status !== "bound" || key.rows[0]?.status !== "active") refuse();
    const allocation = await transaction.query<{ status: string }>(
      `SELECT status FROM device_lease_epoch_allocations
       WHERE account_id = $1 AND workspace_id = $2 AND workflow_id = $3 AND lease_epoch = $4 FOR UPDATE`,
      [transaction.scope.accountId, transaction.scope.workspaceId, input.workflowId, pendingEpoch],
    );
    const capability = await transaction.query<{
      jti: string; consumed_at: Date | null; ready_at: Date | null; live: boolean;
    }>(
      `SELECT jti, consumed_at, ready_at,
              transaction_timestamp() >= issued_at AND transaction_timestamp() < expires_at AS live
       FROM device_bootstrap_capabilities
       WHERE account_id = $1 AND workspace_id = $2 AND workflow_id = $3 FOR UPDATE`,
      [transaction.scope.accountId, transaction.scope.workspaceId, input.workflowId],
    );
    const authority = await transaction.query<{
      target_server_revision: string | null; target_schema_version: string | null;
      pinned_checkpoint_id: string | null; pin_expires_at: Date | null;
      verified_entity_digests: Buffer | null; verified_rebuild_digest: Buffer | null; next_step_kind: string | null;
      pin_live: boolean;
    }>(
      `SELECT target_server_revision, target_schema_version, pinned_checkpoint_id, pin_expires_at,
              verified_entity_digests, verified_rebuild_digest, next_step_kind,
              pin_expires_at > transaction_timestamp() AS pin_live
       FROM device_bootstrap_authorities
       WHERE account_id = $1 AND workspace_id = $2 AND workflow_id = $3 FOR UPDATE`,
      [transaction.scope.accountId, transaction.scope.workspaceId, input.workflowId],
    );
    const capabilityRow = capability.rows[0];
    const authorityRow = authority.rows[0];
    if (allocation.rows[0]?.status !== "pending" || capabilityRow === undefined ||
      capabilityRow.consumed_at !== null || capabilityRow.ready_at === null || !capabilityRow.live ||
      authorityRow === undefined || !authorityRow.pin_live || authorityRow.next_step_kind !== null ||
      authorityRow.verified_entity_digests === null || authorityRow.verified_rebuild_digest === null ||
      authorityRow.target_server_revision === null || authorityRow.target_schema_version === null ||
      authorityRow.pinned_checkpoint_id === null) refuse();
    const held = await transaction.query(
      `SELECT lease_epoch FROM device_active_leases WHERE account_id = $1 AND released_at IS NULL FOR UPDATE`,
      [transaction.scope.accountId],
    );
    if (held.rowCount !== 0) refuse();
    const clock = await transaction.query<{ now: Date }>("SELECT transaction_timestamp() AS now");
    const issuedAt = clock.rows[0] === undefined ? undefined : canonicalSecond(clock.rows[0].now);
    if (issuedAt === undefined) refuse();
    const onlineExpiresAt = minimumTimestamp([addSeconds(issuedAt, 900), entitlement.securityDeadline,
      entitlement.entitlementDeadline]);
    const offlineExecuteUntil = minimumTimestamp([addSeconds(issuedAt, 86_400),
      entitlement.securityDeadline, entitlement.entitlementDeadline]);
    const claims = {
      schemaVersion: 1 as const,
      typ: "gd.active-device-lease.v1" as const,
      iss: "https://accounts.gooddealer.com" as const,
      aud: "gooddealer-desktop/active-device-lease" as const,
      accountId: transaction.scope.accountId,
      deviceId: workflowRow.to_device_id,
      accountSecurityEpoch: security.accountSecurityEpoch,
      jti: `fixture-lease-${randomBytes(16).toString("base64url")}`,
      issuedAt,
      expiresAt: offlineExecuteUntil,
      payload: {
        leaseEpoch: pendingEpoch,
        renewAfter: minimumTimestamp([addSeconds(issuedAt, 300), onlineExpiresAt]),
        onlineExpiresAt,
        offlineExecuteUntil,
      },
    };
    const signed = await this.dependencies.signer.sign({
      purpose: ACTIVE_DEVICE_LEASE_KEY_PURPOSE,
      claims,
    });
    if (!signed.signed) return { installed: false, code: "LEASE_SIGNING_DISABLED" };
    const envelope = activeDeviceLeaseEnvelopeSchema.parse(signed.envelope);
    if (!sameClaims(envelope, claims) || signed.verificationKey.type !== "public" ||
      signed.verificationKey.asymmetricKeyType !== "ed25519" ||
      !verify(null, encodeActiveDeviceLeaseSignatureTranscript(envelope), signed.verificationKey,
        Buffer.from(envelope.signature, "base64url"))) refuse();

    const canonicalEnvelope = Buffer.from(encodeDomainSeparatedWireValue(
      "GOODDEALER-ACTIVE-DEVICE-LEASE-ENVELOPE-V1", envelope,
    ));
    const attemptId = `fixture-${randomBytes(16).toString("base64url")}`;
    await transaction.query(
      `INSERT INTO device_active_leases
         (account_id, lease_epoch, device_id, jti, issued_at, renew_after, online_expires_at,
          offline_execute_until, signed_envelope)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [transaction.scope.accountId, pendingEpoch, envelope.deviceId, envelope.jti, envelope.issuedAt,
        envelope.payload.renewAfter, envelope.payload.onlineExpiresAt,
        envelope.payload.offlineExecuteUntil, canonicalEnvelope],
    );
    this.dependencies.fault?.("after_lease_insert");
    await transaction.query(
      `UPDATE device_lease_epoch_allocations SET status = 'activated', terminal_at = transaction_timestamp()
       WHERE account_id = $1 AND lease_epoch = $2 AND status = 'pending'`,
      [transaction.scope.accountId, pendingEpoch],
    );
    await transaction.query(
      `UPDATE device_account_states SET current_lease_epoch = $2, updated_at = transaction_timestamp()
       WHERE account_id = $1 AND current_lease_epoch < $2`, [transaction.scope.accountId, pendingEpoch]);
    await transaction.query(
      `UPDATE device_bootstrap_capabilities
       SET consumed_at = transaction_timestamp(), consumed_reason = 'activated'
       WHERE account_id = $1 AND workspace_id = $2 AND workflow_id = $3 AND consumed_at IS NULL`,
      [transaction.scope.accountId, transaction.scope.workspaceId, input.workflowId],
    );
    await this.dependencies.cursors.lockDomain(transaction);
    await this.dependencies.cursors.retireCurrent(transaction, "replaced");
    const cursorGeneration = await this.dependencies.cursors.insertNextGeneration(
      transaction, envelope.deviceId, parseUnsigned(authorityRow.target_server_revision),
    );
    await transaction.query(
      `UPDATE device_switch_workflows SET status = 'completed', pending_lease_epoch = NULL,
         workflow_revision = workflow_revision + 1, updated_at = transaction_timestamp()
       WHERE account_id = $1 AND workspace_id = $2 AND workflow_id = $3 AND status = 'bootstrapping'`,
      [transaction.scope.accountId, transaction.scope.workspaceId, input.workflowId],
    );
    await transaction.query(
      `UPDATE device_bootstrap_authorities SET next_step_kind = NULL, next_nonce_digest = NULL,
         row_version = row_version + 1, updated_at = transaction_timestamp()
       WHERE account_id = $1 AND workspace_id = $2 AND workflow_id = $3`,
      [transaction.scope.accountId, transaction.scope.workspaceId, input.workflowId],
    );
    await this.dependencies.checkpoints.release(transaction, input.workflowId, authorityRow.pinned_checkpoint_id);
    await transaction.query(
      `INSERT INTO device_bootstrap_activation_attempts
         (account_id, workspace_id, workflow_id, attempt_id, canonical_claims, claims_digest,
          status, signer_receipt_digest, signed_envelope_digest, completed_at)
       VALUES ($1,$2,$3,$4,$5,$6,'installed',$7,$8,transaction_timestamp())`,
      [transaction.scope.accountId, transaction.scope.workspaceId, input.workflowId, attemptId,
        Buffer.from(encodeActiveDeviceLeaseSignatureTranscript(envelope)),
        createHash("sha256").update(encodeActiveDeviceLeaseSignatureTranscript(envelope)).digest(),
        createHash("sha256").update(signed.receipt).digest(), createHash("sha256").update(canonicalEnvelope).digest()],
    );
    this.dependencies.fault?.("before_activation_commit");
    return { installed: true, lease: envelope, cursorGeneration };
  }
}

class ActivationRefusal extends Error {}
function refuse(): never { throw new ActivationRefusal("bootstrap activation conflict"); }
function parsePositive(value: string): number {
  const parsed = Number(value); if (!Number.isSafeInteger(parsed) || parsed < 1) refuse(); return parsed;
}
function parseUnsigned(value: string): number {
  const parsed = Number(value); if (!Number.isSafeInteger(parsed) || parsed < 0) refuse(); return parsed;
}
function addSeconds(value: string, seconds: number): string {
  return canonicalSecond(new Date(Date.parse(value) + seconds * 1_000));
}
function minimumTimestamp(values: readonly string[]): string {
  return canonicalSecond(new Date(Math.min(...values.map((value) => Date.parse(value)))));
}
function canonicalSecond(value: Date): string {
  return value.toISOString().replace(/\.\d{3}Z$/u, "Z");
}
function sameClaims(envelope: ActiveDeviceLeaseEnvelope, claims: Omit<ActiveDeviceLeaseEnvelope, "kid" | "signature">): boolean {
  const { kid: _kid, signature: _signature, ...actual } = envelope;
  return Buffer.from(encodeDomainSeparatedWireValue("GOODDEALER-ACTIVE-DEVICE-LEASE-CLAIMS-V1", actual))
    .equals(Buffer.from(encodeDomainSeparatedWireValue("GOODDEALER-ACTIVE-DEVICE-LEASE-CLAIMS-V1", claims)));
}
