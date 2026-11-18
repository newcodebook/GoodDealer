import {
  DEVICE_MANAGEMENT_SCHEMA_VERSION,
  deviceBindingListSchema,
  deviceListRequestSchema,
  deviceSelfReportSchema,
  type DeviceBindingList,
} from "@gooddealer/protocol/devices";

import type { AccountTransaction, AccountTransactionRunner } from "../../db/index";
import type { PublicPrincipal } from "../../entrypoints/ports/public-session";

/** A `null` result is an authorization denial; the route answers it without detail. */
export interface DeviceDirectoryApplicationPort {
  list(value: unknown, principal: PublicPrincipal): Promise<DeviceBindingList | null>;
  reportSelf(value: unknown, principal: PublicPrincipal): Promise<DeviceBindingList | null>;
}

/** The list carries at most eight devices: every bound device, then the most recently removed. */
const MAX_LISTED_DEVICES = 8;

interface DeviceRow {
  readonly device_id: string;
  readonly status: "bound" | "removed";
  readonly platform: string | null;
  readonly display_name: string | null;
  readonly credential_epoch: string;
  readonly key_id: string;
  readonly key_version: string;
  readonly key_status: "active" | "rotated" | "revoked";
  readonly bound_at: Date;
  readonly last_seen_at: Date | null;
  readonly removed_at: Date | null;
  readonly holds_lease: boolean;
}

/**
 * The account's device list and a Desktop's report of itself (ADR-0032 S3a). Account and device
 * come only from the authenticated Desktop session, which must name a bound device; holding the
 * Lease is not required to read the list or report. Removing, renaming another device, or
 * choosing a role is not possible here.
 */
export class PostgresDeviceDirectory implements DeviceDirectoryApplicationPort {
  constructor(private readonly transactions: Pick<AccountTransactionRunner, "withAccount">) {}

  async list(value: unknown, principal: PublicPrincipal): Promise<DeviceBindingList | null> {
    deviceListRequestSchema.parse(value);
    if (principal.clientKind !== "desktop") return null;
    return this.transactions.withAccount(principal.accountId, async (transaction) => {
      const deviceId = await sessionDevice(transaction, principal, false);
      return deviceId === null ? null : readList(transaction, principal.accountId, deviceId);
    });
  }

  async reportSelf(value: unknown, principal: PublicPrincipal): Promise<DeviceBindingList | null> {
    const report = deviceSelfReportSchema.parse(value);
    if (principal.clientKind !== "desktop") return null;
    return this.transactions.withAccount(principal.accountId, async (transaction) => {
      // Locks follow DEVICE_DRAIN_LOCK_ORDER (security, account state, bindings) so a report that
      // bumps the list revision serializes with drain, login and switch writers instead of
      // deadlocking against them.
      await transaction.query(
        "SELECT 1 FROM identity_account_security_states WHERE account_id = $1 FOR UPDATE", [principal.accountId]);
      await transaction.query(
        "SELECT 1 FROM device_account_states WHERE account_id = $1 FOR UPDATE", [principal.accountId]);
      const deviceId = await sessionDevice(transaction, principal, true);
      if (deviceId === null) return null;
      const updated = await transaction.query<{ renamed: boolean }>(
        `WITH previous AS (
           SELECT platform, display_name FROM device_bindings
            WHERE account_id = $1 AND device_id = $2 AND status = 'bound'
         )
         UPDATE device_bindings binding
            SET platform = $3, display_name = $4,
                last_seen_at = date_trunc('hour', transaction_timestamp(), 'UTC')
           FROM previous
          WHERE binding.account_id = $1 AND binding.device_id = $2
         RETURNING previous.platform IS DISTINCT FROM $3 OR previous.display_name IS DISTINCT FROM $4 AS renamed`,
        [principal.accountId, deviceId, report.platform, report.displayName],
      );
      if (updated.rows.length !== 1) return null;
      // Last seen alone does not change the list's identity; a new name or platform does.
      if (updated.rows[0]?.renamed === true) {
        await transaction.query(
          `UPDATE device_account_states
              SET binding_list_revision = binding_list_revision + 1, updated_at = transaction_timestamp()
            WHERE account_id = $1`,
          [principal.accountId],
        );
      }
      return readList(transaction, principal.accountId, deviceId);
    });
  }
}

/**
 * The bound device of a live Desktop session. For a report the binding row is locked, after the
 * caller has locked security and account state, so a concurrent removal cannot interleave.
 */
async function sessionDevice(
  transaction: AccountTransaction,
  principal: PublicPrincipal,
  lock: boolean,
): Promise<string | null> {
  const result = await transaction.query<{ device_id: string }>(
    `SELECT session.device_id
       FROM identity_auth_sessions session
       JOIN identity_refresh_families family
         ON family.account_id = session.account_id AND family.session_id = session.session_id
       JOIN identity_account_security_states security ON security.account_id = session.account_id
       JOIN device_bindings binding
         ON binding.account_id = session.account_id AND binding.device_id = session.device_id
      WHERE session.account_id = $1 AND session.session_id = $2 AND session.client_kind = 'desktop'
        AND session.revoked_at IS NULL AND session.epoch_at_issue = security.account_security_epoch
        AND (session.expires_at IS NULL OR session.expires_at > transaction_timestamp())
        AND security.status = 'normal' AND family.state = 'active' AND binding.status = 'bound'
      LIMIT 2${lock ? " FOR UPDATE OF binding" : ""}`,
    [principal.accountId, principal.sessionId],
  );
  return result.rows.length === 1 ? result.rows[0]?.device_id ?? null : null;
}

async function readList(
  transaction: AccountTransaction,
  accountId: string,
  currentDeviceId: string,
): Promise<DeviceBindingList> {
  const state = await transaction.query<{ binding_list_revision: string; current_lease_epoch: string }>(
    "SELECT binding_list_revision, current_lease_epoch FROM device_account_states WHERE account_id = $1",
    [accountId],
  );
  const revision = state.rows[0]?.binding_list_revision;
  if (revision === undefined) throw new TypeError("device account state is missing");
  const rows = await transaction.query<DeviceRow>(
    `SELECT binding.device_id, binding.status, binding.platform, binding.display_name,
            binding.credential_epoch, key.key_id, key.key_version, key.status AS key_status,
            binding.bound_at, binding.last_seen_at, binding.removed_at,
            EXISTS (
              SELECT 1 FROM device_active_leases lease
               WHERE lease.account_id = binding.account_id AND lease.device_id = binding.device_id
                 AND lease.lease_epoch = $2 AND lease.released_at IS NULL
            ) AS holds_lease
       FROM device_bindings binding
       JOIN LATERAL (
         SELECT key_id, key_version, status FROM device_signing_keys
          WHERE account_id = binding.account_id AND device_id = binding.device_id
          ORDER BY key_version DESC LIMIT 1
       ) key ON true
      WHERE binding.account_id = $1
      ORDER BY binding.status = 'bound' DESC, binding.removed_at DESC NULLS LAST, binding.device_id COLLATE "C"
      LIMIT ${MAX_LISTED_DEVICES}`,
    [accountId, state.rows[0]?.current_lease_epoch],
  );
  // The schema parse is the last gate: a row Cloud cannot describe within the contract fails the
  // read rather than reaching a Desktop.
  return deviceBindingListSchema.parse({
    schemaVersion: DEVICE_MANAGEMENT_SCHEMA_VERSION,
    listRevision: Number(revision),
    devices: rows.rows.map((row) => ({
      schemaVersion: DEVICE_MANAGEMENT_SCHEMA_VERSION,
      deviceId: row.device_id,
      platform: row.platform,
      displayName: row.display_name,
      status: row.status,
      role: row.status !== "bound" || row.key_status === "revoked" ? "none" : row.holds_lease ? "active" : "standby",
      credentialEpoch: Number(row.credential_epoch),
      signingKeyId: row.key_id,
      signingKeyVersion: Number(row.key_version),
      signingKeyStatus: row.key_status,
      boundAt: canonicalSecond(row.bound_at),
      lastSeenAt: row.last_seen_at === null ? null : canonicalSecond(row.last_seen_at),
      removedAt: row.removed_at === null ? null : canonicalSecond(row.removed_at),
      currentDevice: row.status === "bound" && row.device_id === currentDeviceId,
    })),
  });
}

function canonicalSecond(value: Date): string {
  return `${value.toISOString().slice(0, 19)}Z`;
}
