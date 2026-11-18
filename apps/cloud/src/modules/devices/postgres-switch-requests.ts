import { createHash, randomUUID } from "node:crypto";

import {
  DEVICE_MANAGEMENT_SCHEMA_VERSION,
  deviceSwitchRequestViewSchema,
  deviceSwitchResponseSchema,
  type DeviceSwitchRejectionCode,
  type DeviceSwitchRequestView,
  type DeviceSwitchResponse,
} from "@gooddealer/protocol/devices";
import { identifier } from "@gooddealer/protocol/wire";

import type { TenantTransaction, TenantTransactionRunner } from "../../db/index";
import type { IdentityAccountSecurityStatePort } from "../identity/index";
import { DRAINING_STATE_TTL_SECONDS } from "./switch-workflow";

const NONTERMINAL = ["requested", "draining", "waiting_expiry", "bootstrapping"] as const;
/** Cancelling a bootstrapping switch must burn its pending epoch and capability (ADR-0032 S1d). */
const CANCELLABLE = ["requested", "draining", "waiting_expiry"] as const;

interface WorkflowRow {
  readonly workflow_id: string;
  readonly mode: "normal" | "forced";
  readonly status: DeviceSwitchRequestView["status"];
  readonly from_device_id: string | null;
  readonly to_device_id: string;
  readonly created_at: Date;
  readonly bootstrap_expires_at: Date | null;
}

const WORKFLOW_COLUMNS = `w.workflow_id, w.mode, w.status, w.from_device_id, w.to_device_id, w.created_at,
  CASE WHEN w.status = 'bootstrapping' THEN c.expires_at END AS bootstrap_expires_at`;
const WORKFLOW_FROM = `device_switch_workflows w
  LEFT JOIN device_bootstrap_capabilities c USING (account_id, workspace_id, workflow_id)`;

/** The tenant a switch belongs to and the device its session resolved to; never caller-selected. */
export interface DeviceSwitchSubject {
  readonly accountId: string;
  readonly workspaceId: string;
  readonly deviceId: string;
}

/**
 * PostgreSQL normal device switch requests (ADR-0032 decision 1, slice S1b).
 *
 * Only the device holding the account's current, unexpired Lease for this workspace may start a
 * switch, and it starts in `draining`: the drain proof (S1c) is the only way forward. Locks follow
 * `DEVICE_DRAIN_LOCK_ORDER` (security, account state, bindings, signing key, workflow, held
 * Lease) so a request serializes with drain, removal and login writers instead of deadlocking.
 * The workflow binds the target's active signing key, the key bootstrap steps and activation
 * verify. A `null` result is an authorization denial; it never says why.
 */
export class PostgresDeviceSwitchRequests {
  constructor(private readonly dependencies: {
    readonly transactions: TenantTransactionRunner;
    readonly accountSecurity: IdentityAccountSecurityStatePort;
  }) {}

  async requestNormal(
    subject: DeviceSwitchSubject,
    request: { readonly toDeviceId: string; readonly idempotencyKey: string },
  ): Promise<DeviceSwitchResponse | null> {
    const source = parseSubject(subject);
    const toDeviceId = identifier.parse(request.toDeviceId);
    const idempotencyKey = identifier.parse(request.idempotencyKey);
    const requestDigest = createHash("sha256")
      .update(JSON.stringify(["gd.device-switch-request.v1", "normal", source.workspaceId, source.deviceId, toDeviceId, idempotencyKey]))
      .digest();
    return this.#run(source, async (transaction) => {
      const security = await this.dependencies.accountSecurity.lockCurrent(transaction);
      if (security === null) return null;
      if (security.status !== "normal") return rejected("ACCOUNT_RECOVERY_PENDING");
      const account = await transaction.query<{ current_lease_epoch: string }>(
        "SELECT current_lease_epoch FROM device_account_states WHERE account_id = $1 FOR UPDATE",
        [source.accountId]);
      if (account.rows[0] === undefined) return null;

      // A retry with the same key returns the first outcome; any other content under it conflicts.
      const prior = await transaction.query<WorkflowRow & { readonly request_digest: Buffer; readonly workspace_id: string }>(
        `SELECT ${WORKFLOW_COLUMNS}, w.request_digest, w.workspace_id FROM ${WORKFLOW_FROM}
         WHERE w.account_id = $1 AND w.idempotency_key = $2`,
        [source.accountId, idempotencyKey]);
      const priorRow = prior.rows[0];
      if (priorRow !== undefined) {
        return priorRow.workspace_id === source.workspaceId && priorRow.request_digest.equals(requestDigest)
          ? accepted(priorRow)
          : rejected("IDEMPOTENCY_CONFLICT");
      }
      if (toDeviceId === source.deviceId) return rejected("TARGET_IS_SOURCE");

      const devices = [source.deviceId, toDeviceId].sort();
      const bindings = await transaction.query<{ device_id: string; status: "bound" | "removed" }>(
        `SELECT device_id, status FROM device_bindings
         WHERE account_id = $1 AND device_id = ANY($2::text[]) ORDER BY device_id COLLATE "C" FOR UPDATE`,
        [source.accountId, devices]);
      const statusOf = (deviceId: string) => bindings.rows.find((row) => row.device_id === deviceId)?.status;
      if (statusOf(source.deviceId) !== "bound") return null;
      const targetStatus = statusOf(toDeviceId);
      if (targetStatus === undefined) return rejected("TARGET_NOT_BOUND");
      if (targetStatus !== "bound") return rejected("TARGET_REMOVED");
      const key = await transaction.query<{ key_id: string; key_version: string }>(
        `SELECT key_id, key_version FROM device_signing_keys
         WHERE account_id = $1 AND device_id = $2 AND status = 'active' FOR UPDATE`,
        [source.accountId, toDeviceId]);
      const targetKey = key.rows[0];
      if (targetKey === undefined) return rejected("TARGET_NOT_BOUND");

      const open = await transaction.query<{ workflow_id: string; status: string; expired: boolean }>(
        `SELECT workflow_id, status, transaction_timestamp() >= state_deadline AS expired
         FROM device_switch_workflows
         WHERE account_id = $1 AND status = ANY($2::text[]) FOR UPDATE`,
        [source.accountId, [...NONTERMINAL]]);
      const blocking = open.rows[0];
      if (blocking !== undefined) {
        // A switch that never reached bootstrap and outlived its deadline fails here, so a device
        // that lost its Lease mid-switch cannot block the account forever. Expiring a bootstrapping
        // switch must burn its epoch and capability and stays with S1d.
        if (!blocking.expired || !(CANCELLABLE as readonly string[]).includes(blocking.status)) {
          return rejected("SWITCH_IN_PROGRESS");
        }
        await transaction.query(
          `UPDATE device_switch_workflows
           SET status = 'failed', workflow_revision = workflow_revision + 1, updated_at = transaction_timestamp()
           WHERE account_id = $1 AND workflow_id = $2`,
          [source.accountId, blocking.workflow_id]);
      }

      // Re-check, under the lock, the Lease the session resolved: held by this device, current,
      // activated for this workspace and still inside its offline execution window.
      const lease = await transaction.query<{ device_id: string }>(
        `SELECT lease.device_id FROM device_active_leases lease
         JOIN device_lease_epoch_allocations allocation
           ON allocation.account_id = lease.account_id AND allocation.lease_epoch = lease.lease_epoch
         WHERE lease.account_id = $1 AND lease.released_at IS NULL AND lease.lease_epoch = $2
           AND allocation.workspace_id = $3 AND allocation.status = 'activated'
           AND lease.issued_at <= transaction_timestamp() AND lease.offline_execute_until > transaction_timestamp()
         FOR UPDATE OF lease`,
        [source.accountId, account.rows[0].current_lease_epoch, source.workspaceId]);
      if (lease.rows.length !== 1 || lease.rows[0]?.device_id !== source.deviceId) return null;

      const inserted = await transaction.query<WorkflowRow>(
        `INSERT INTO device_switch_workflows AS w
           (account_id, workspace_id, workflow_id, purpose, mode, request_digest, idempotency_key, status,
            workflow_revision, from_device_id, to_device_id, bound_key_id, bound_key_version,
            bound_account_security_epoch, state_deadline)
         VALUES ($1, $2, $3, 'device_switch', 'normal', $4, $5, 'draining', 1, $6, $7, $8, $9, $10,
           transaction_timestamp() + make_interval(secs => $11))
         RETURNING w.workflow_id, w.mode, w.status, w.from_device_id, w.to_device_id, w.created_at,
           NULL::timestamptz AS bootstrap_expires_at`,
        [source.accountId, source.workspaceId, `switch-${randomUUID()}`, requestDigest, idempotencyKey,
          source.deviceId, toDeviceId, targetKey.key_id, targetKey.key_version, security.accountSecurityEpoch,
          DRAINING_STATE_TTL_SECONDS]);
      const row = inserted.rows[0];
      if (row === undefined) throw new TypeError("switch workflow insert returned no row");
      return accepted(row);
    });
  }

  /** A switch is visible only to the two devices it names. */
  async read(subject: DeviceSwitchSubject, requestId: string): Promise<DeviceSwitchResponse | null> {
    const device = parseSubject(subject);
    const workflowId = identifier.parse(requestId);
    return this.#run(device, async (transaction) => {
      const result = await transaction.query<WorkflowRow>(
        `SELECT ${WORKFLOW_COLUMNS} FROM ${WORKFLOW_FROM}
         WHERE w.account_id = $1 AND w.workspace_id = $2 AND w.workflow_id = $3
           AND (w.from_device_id = $4 OR w.to_device_id = $4)`,
        [device.accountId, device.workspaceId, workflowId, device.deviceId]);
      const row = result.rows[0];
      return row === undefined ? rejected("SWITCH_NOT_FOUND") : accepted(row);
    });
  }

  /**
   * The source device may cancel before bootstrap starts. Cancelling an already cancelled switch
   * returns it unchanged; any other terminal or bootstrapping switch is not cancellable here.
   */
  async cancel(subject: DeviceSwitchSubject, requestId: string): Promise<DeviceSwitchResponse | null> {
    const device = parseSubject(subject);
    const workflowId = identifier.parse(requestId);
    return this.#run(device, async (transaction) => {
      const security = await this.dependencies.accountSecurity.lockCurrent(transaction);
      if (security === null) return null;
      const account = await transaction.query(
        "SELECT 1 FROM device_account_states WHERE account_id = $1 FOR UPDATE", [device.accountId]);
      if (account.rows.length !== 1) return null;
      const current = await transaction.query<WorkflowRow>(
        `SELECT ${WORKFLOW_COLUMNS} FROM ${WORKFLOW_FROM}
         WHERE w.account_id = $1 AND w.workspace_id = $2 AND w.workflow_id = $3 AND w.from_device_id = $4
         FOR UPDATE OF w`,
        [device.accountId, device.workspaceId, workflowId, device.deviceId]);
      const row = current.rows[0];
      if (row === undefined) return rejected("SWITCH_NOT_FOUND");
      if (row.status === "cancelled") return accepted(row);
      if (!(CANCELLABLE as readonly string[]).includes(row.status)) return rejected("SWITCH_NOT_CANCELLABLE");
      const updated = await transaction.query<WorkflowRow>(
        `UPDATE device_switch_workflows AS w
         SET status = 'cancelled', workflow_revision = workflow_revision + 1, updated_at = transaction_timestamp()
         WHERE account_id = $1 AND workspace_id = $2 AND workflow_id = $3 AND status = ANY($4::text[])
         RETURNING w.workflow_id, w.mode, w.status, w.from_device_id, w.to_device_id, w.created_at,
           NULL::timestamptz AS bootstrap_expires_at`,
        [device.accountId, device.workspaceId, workflowId, [...CANCELLABLE]]);
      const cancelled = updated.rows[0];
      if (cancelled === undefined) throw new TypeError("locked switch workflow did not cancel");
      return accepted(cancelled);
    });
  }

  async #run(
    subject: DeviceSwitchSubject,
    work: (transaction: TenantTransaction) => Promise<DeviceSwitchResponse | null>,
  ): Promise<DeviceSwitchResponse | null> {
    const scope = { accountId: subject.accountId, workspaceId: subject.workspaceId };
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.dependencies.transactions.withTenant(scope, async (transaction) => {
          await transaction.query("SET LOCAL lock_timeout = '2s'");
          await transaction.query("SET LOCAL statement_timeout = '10s'");
          const result = await work(transaction);
          return result === null ? null : deviceSwitchResponseSchema.parse(result);
        });
      } catch (error) {
        // The one-nonterminal index or a serialization failure means a concurrent writer won.
        if (attempt < 2 && isRetryableTransactionError(error)) continue;
        // Idempotency keys are unique per account, but workflow rows are visible per workspace:
        // a key spent in another workspace surfaces only here.
        if (uniqueConstraint(error) === "device_switch_workflows_account_id_idempotency_key_key") {
          return rejected("IDEMPOTENCY_CONFLICT");
        }
        if (uniqueConstraint(error) === "device_switch_workflows_one_nonterminal") return rejected("SWITCH_IN_PROGRESS");
        throw error;
      }
    }
  }
}

function parseSubject(subject: DeviceSwitchSubject): DeviceSwitchSubject {
  return {
    accountId: identifier.parse(subject.accountId),
    workspaceId: identifier.parse(subject.workspaceId),
    deviceId: identifier.parse(subject.deviceId),
  };
}

function accepted(row: WorkflowRow): DeviceSwitchResponse {
  return {
    schemaVersion: DEVICE_MANAGEMENT_SCHEMA_VERSION,
    accepted: true,
    request: deviceSwitchRequestViewSchema.parse({
      schemaVersion: DEVICE_MANAGEMENT_SCHEMA_VERSION,
      requestId: row.workflow_id,
      mode: row.mode,
      status: row.status,
      fromDeviceId: row.from_device_id,
      toDeviceId: row.to_device_id,
      requestedAt: canonicalTimestamp(row.created_at),
      // Only forced switches carry a takeover time, and this service creates none (ADR-0032 pause).
      earliestTakeoverAt: null,
      bootstrapExpiresAt: row.bootstrap_expires_at === null ? null : canonicalTimestamp(row.bootstrap_expires_at),
    }),
  };
}

function rejected(code: DeviceSwitchRejectionCode): DeviceSwitchResponse {
  return { schemaVersion: DEVICE_MANAGEMENT_SCHEMA_VERSION, accepted: false, code };
}

function canonicalTimestamp(value: Date): string {
  return value.toISOString().replace(/\.\d{3}Z$/u, "Z");
}

function isRetryableTransactionError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error.code === "40001" || error.code === "40P01");
}

function uniqueConstraint(error: unknown): string | null {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505"
    && "constraint" in error && typeof error.constraint === "string" ? error.constraint : null;
}
