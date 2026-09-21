import {
  cloudflareDnsProjectionDigestInput,
  cloudflareDnsProjectionRequestSchema,
  type CloudflareDnsProjectionAck,
  type CloudflareDnsProjectionRequest,
} from "@gooddealer/protocol/workspace-observations/cloudflare-dns";
import { createHash, timingSafeEqual } from "node:crypto";
import { identifier } from "@gooddealer/protocol/wire";

import type { AccountTransaction, IdentityCapabilityTransactionRunner, TenantTransaction } from "../../../db/index";
import type { PublicPrincipal } from "../../../entrypoints/ports/public-session";
import type { LockedDefaultWorkspaceAuthorityPort } from "../default-workspace/index";
import { MAX_CLOUDFLARE_DNS_SOURCE_ADVANCE } from "@gooddealer/protocol/workspace-observations/cloudflare-dns";

export interface CloudflareDnsObservationIngressPort {
  submit(value: unknown, principal: PublicPrincipal): Promise<CloudflareDnsProjectionAck | null>;
}

/**
 * Cloud's only Cloudflare observation boundary. It accepts a redacted projection and never
 * calls a Provider or exposes a read path. IdentityCapabilityTransactionRunner supplies the
 * authenticated account and tenant RLS settings; all device and Lease selectors are derived
 * from the locked server session.
 */
export class PostgresCloudflareDnsObservationIngress implements CloudflareDnsObservationIngressPort {
  constructor(private readonly dependencies: {
    readonly transactions: Pick<IdentityCapabilityTransactionRunner, "withAccountCredential">;
    readonly workspaces: Pick<LockedDefaultWorkspaceAuthorityPort, "resolveLocked">;
  }) {}

  async submit(value: unknown, principal: PublicPrincipal): Promise<CloudflareDnsProjectionAck | null> {
    if (principal.clientKind !== "desktop" || principal.transactionCredential === undefined) return null;
    const parsed = cloudflareDnsProjectionRequestSchema.safeParse(value);
    if (!parsed.success) return null;
    const request = parsed.data as CloudflareDnsProjectionRequest;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await this.dependencies.transactions.withAccountCredential(
          principal.transactionCredential,
          "devices_account",
          async (accountTransaction) => {
            const scope = await this.dependencies.workspaces.resolveLocked(accountTransaction);
            if (scope === null || scope.accountId !== principal.accountId) return null;
            await accountTransaction.query("SELECT set_config('gooddealer.workspace_id', $1, true)", [scope.workspaceId]);
            const transaction: TenantTransaction = {
              scope,
              query: accountTransaction.query.bind(accountTransaction),
            };
            return this.ingest(transaction, principal, request);
          },
        );
      } catch (error) {
        // A same-ID race can lose the composite receipt insert after the advisory lock was
        // acquired on another connection. The aborted transaction is discarded and replay
        // lookup is retried from a fresh capability transaction exactly once.
        if (!isUniqueViolation(error) || attempt === 1) return null;
      }
    }
    return null;
  }

  private async ingest(
    transaction: TenantTransaction,
    principal: PublicPrincipal,
    request: CloudflareDnsProjectionRequest,
  ): Promise<CloudflareDnsProjectionAck | null> {
    if (transaction.scope.accountId !== principal.accountId) return null;
    const digest = createHash("sha256").update(cloudflareDnsProjectionDigestInput(request)).digest();
    const replay = await transaction.query<Record<string, unknown>>(
      `SELECT observation_id, device_id, lease_epoch, source_sequence, entity_id,
              canonical_request_digest, observation_sequence, disposition
         FROM cloudflare_dns_observation_receipts
        WHERE account_id = $1 AND workspace_id = $2 AND observation_id = $3`,
      [transaction.scope.accountId, transaction.scope.workspaceId, request.observationId],
    );
    const existingRows = parseReceiptRows(replay.rows);
    if (existingRows.length > 1) return null;
    const existing = existingRows[0];
    if (existing !== undefined) {
      const deviceId = await this.lockAuthenticatedPrincipalDevice(transaction, principal);
      if (deviceId === null || existing.device_id !== deviceId || existing.entityId !== request.entityId
        || existing.leaseEpoch !== request.leaseEpoch || existing.sourceSequence !== request.sourceSequence
        || !sameDigest(existing.canonicalRequestDigest, digest)) return null;
      return ack(request, digest, existing.observationSequence, existing.disposition);
    }

    await transaction.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
      `${transaction.scope.accountId}\u0000${transaction.scope.workspaceId}\u0000${request.observationId}`,
    ]);
    const raced = await transaction.query<Record<string, unknown>>(
      `SELECT observation_id, device_id, lease_epoch, source_sequence, entity_id,
              canonical_request_digest, observation_sequence, disposition
         FROM cloudflare_dns_observation_receipts
        WHERE account_id = $1 AND workspace_id = $2 AND observation_id = $3`,
      [transaction.scope.accountId, transaction.scope.workspaceId, request.observationId],
    );
    const racedRows = parseReceiptRows(raced.rows);
    if (racedRows.length > 1) return null;
    if (racedRows[0] !== undefined) {
      const deviceId = await this.lockAuthenticatedPrincipalDevice(transaction, principal);
      const row = racedRows[0];
      if (deviceId === null || row.device_id !== deviceId || row.entityId !== request.entityId
        || row.leaseEpoch !== request.leaseEpoch || row.sourceSequence !== request.sourceSequence
        || !sameDigest(row.canonicalRequestDigest, digest)) return null;
      return ack(request, digest, row.observationSequence, row.disposition);
    }

    const deviceId = await this.lockNewObservationDeviceAuthority(transaction, principal);
    if (deviceId === null) return null;
    const commercial = await transaction.query<Record<string, unknown>>("SELECT source_revision, state, commercial_expires_at, feature_entitlements, trusted_now FROM licensing_api.read_authoritative_entitlement_snapshot()");
    const authority = parseAuthorityRows(commercial.rows)[0];
    if (commercial.rows.length !== 1 || authority === undefined || authority.state !== "active"
      || authority.commercialExpiresAt <= authority.trustedNow
      || !authority.featureEntitlements.includes("cloudflare:dns:observe")) return null;
    const lease = await transaction.query<Record<string, unknown>>(
      `SELECT lease.lease_epoch, lease.device_id
         FROM device_active_leases lease
         JOIN device_lease_epoch_allocations allocation
           ON allocation.account_id = lease.account_id AND allocation.lease_epoch = lease.lease_epoch
        WHERE lease.account_id = $1 AND allocation.workspace_id = $2
          AND lease.released_at IS NULL AND lease.issued_at <= clock_timestamp()
          AND lease.offline_execute_until > clock_timestamp() AND allocation.status = 'activated'
          AND lease.device_id = $3
        FOR UPDATE OF lease`,
      [transaction.scope.accountId, transaction.scope.workspaceId, deviceId],
    );
    const heldLease = parseLeaseRows(lease.rows)[0];
    if (lease.rows.length !== 1 || heldLease === undefined || heldLease.leaseEpoch !== request.leaseEpoch) return null;

    const skew = await transaction.query<Record<string, unknown>>("SELECT clock_timestamp() AS now");
    const now = toMillis(parseClockRows(skew.rows));
    const observed = Date.parse(request.observedAt);
    if (now === null || !Number.isFinite(observed) || Math.abs(now - observed) > 300_000) return null;

    // Fixed lock order after the observation-ID lock: parent workspace, entity, latest head,
    // then sequence head and immutable receipt.
    await transaction.query(
      `SELECT 1 FROM workspace_revisions
        WHERE account_id = $1 AND workspace_id = $2
        FOR UPDATE`,
      [transaction.scope.accountId, transaction.scope.workspaceId],
    ).then((result) => { if (result.rowCount !== 1) throw new ObservationRejectedError(); });

    await transaction.query(
      `SELECT 1 FROM workspace_replica_domain_assets
        WHERE account_id = $1 AND workspace_id = $2 AND entity_id = $3
        FOR KEY SHARE`,
      [transaction.scope.accountId, transaction.scope.workspaceId, request.entityId],
    ).then((result) => { if (result.rowCount !== 1) throw new ObservationRejectedError(); });

    const latest = await transaction.query<Record<string, unknown>>(
      `SELECT lease_epoch, source_sequence, canonical_request_digest
         FROM cloudflare_dns_observation_projections
        WHERE account_id = $1 AND workspace_id = $2 AND entity_id = $3
        FOR UPDATE`,
      [transaction.scope.accountId, transaction.scope.workspaceId, request.entityId],
    );
    const latestRows = parseLatestRows(latest.rows);
    if (latest.rows.length > 1) return null;
    const current = latestRows[0];
    let disposition: "current" | "stale" = "current";
    if (current !== undefined) {
      if (request.leaseEpoch < current.leaseEpoch
        || (request.leaseEpoch === current.leaseEpoch && request.sourceSequence < current.sourceSequence)) {
        disposition = "stale";
      } else if (request.leaseEpoch === current.leaseEpoch && request.sourceSequence === current.sourceSequence) {
        if (!sameDigest(current.canonicalRequestDigest, digest)) return null;
        disposition = "current";
      } else if (request.leaseEpoch === current.leaseEpoch
        && request.sourceSequence > current.sourceSequence + MAX_CLOUDFLARE_DNS_SOURCE_ADVANCE) {
        return null;
      } else if (request.leaseEpoch > current.leaseEpoch
        && request.sourceSequence !== 1) {
        return null;
      }
    } else if (request.sourceSequence !== 1) {
      return null;
    }

    const sequence = await transaction.query<Record<string, unknown>>(
      `INSERT INTO cloudflare_dns_observation_sequence_heads (account_id, workspace_id, observation_sequence)
       VALUES ($1, $2, 1)
       ON CONFLICT (account_id, workspace_id) DO UPDATE
         SET observation_sequence = cloudflare_dns_observation_sequence_heads.observation_sequence + 1
       RETURNING observation_sequence`,
      [transaction.scope.accountId, transaction.scope.workspaceId],
    );
    const observationSequence = parseSafePositive(sequence.rows[0]?.observation_sequence);
    if (observationSequence === null) throw new ObservationRejectedError();

    await transaction.query(
      `INSERT INTO cloudflare_dns_observation_receipts (
         account_id, workspace_id, observation_id, device_id, lease_epoch, source_sequence,
         entity_id, canonical_request_digest, observed_at, received_at, observation_sequence, disposition
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,clock_timestamp(),$10,$11)`,
      [transaction.scope.accountId, transaction.scope.workspaceId, request.observationId, deviceId,
        request.leaseEpoch, request.sourceSequence, request.entityId, digest, request.observedAt,
        observationSequence, disposition],
    );
    if (disposition === "current" && (current === undefined
      || request.leaseEpoch > current.leaseEpoch
      || request.sourceSequence > current.sourceSequence)) {
      const counts = request.availability === "available" ? request.counts : null;
      await transaction.query(
        `INSERT INTO cloudflare_dns_observation_projections (
           account_id, workspace_id, entity_id, observation_id, device_id, lease_epoch, source_sequence,
           canonical_request_digest, observed_at, availability, zone_status,
           a_count, aaaa_count, cname_count, txt_count, proxied_count, observation_sequence
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         ON CONFLICT (account_id, workspace_id, entity_id) DO UPDATE SET
           observation_id = EXCLUDED.observation_id, device_id = EXCLUDED.device_id,
           lease_epoch = EXCLUDED.lease_epoch, source_sequence = EXCLUDED.source_sequence,
           canonical_request_digest = EXCLUDED.canonical_request_digest, observed_at = EXCLUDED.observed_at,
           availability = EXCLUDED.availability, zone_status = EXCLUDED.zone_status,
           a_count = EXCLUDED.a_count, aaaa_count = EXCLUDED.aaaa_count, cname_count = EXCLUDED.cname_count,
           txt_count = EXCLUDED.txt_count, proxied_count = EXCLUDED.proxied_count,
           observation_sequence = EXCLUDED.observation_sequence`,
        [transaction.scope.accountId, transaction.scope.workspaceId, request.entityId, request.observationId,
          deviceId, request.leaseEpoch, request.sourceSequence, digest, request.observedAt, request.availability,
          request.zoneStatus,
          counts?.a ?? null, counts?.aaaa ?? null, counts?.cname ?? null,
          counts?.txt ?? null, counts?.proxied ?? null,
          observationSequence],
      );
    }
    return ack(request, digest, observationSequence, disposition);
  }

  private async lockAuthenticatedPrincipalDevice(
    transaction: TenantTransaction,
    principal: PublicPrincipal,
  ): Promise<string | null> {
    const result = await transaction.query<Record<string, unknown>>(
      `SELECT session.device_id
         FROM identity_auth_sessions session
         JOIN identity_refresh_families family
           ON family.account_id = session.account_id AND family.session_id = session.session_id
         JOIN identity_account_security_states security
           ON security.account_id = session.account_id
        WHERE session.account_id = $1 AND session.session_id = $2
          AND session.client_kind = 'desktop' AND session.revoked_at IS NULL
          AND session.epoch_at_issue = security.account_security_epoch AND security.status = 'normal'
          AND family.state = 'active'
          AND (session.expires_at IS NULL OR session.expires_at > clock_timestamp())
        FOR UPDATE OF session, family, security`,
      [transaction.scope.accountId, principal.sessionId],
    );
    const rows = parseDeviceRows(result.rows);
    return rows.length === 1 ? rows[0]!.deviceId : null;
  }

  private async lockNewObservationDeviceAuthority(
    transaction: TenantTransaction,
    principal: PublicPrincipal,
  ): Promise<string | null> {
    const deviceId = await this.lockAuthenticatedPrincipalDevice(transaction, principal);
    if (deviceId === null) return null;
    const authority = await transaction.query<Record<string, unknown>>(
      `SELECT binding.status
         FROM device_account_states device_state
         JOIN device_bindings binding ON binding.account_id = device_state.account_id
        WHERE device_state.account_id = $1 AND binding.device_id = $2
        FOR UPDATE OF device_state, binding`,
      [transaction.scope.accountId, deviceId],
    );
    const rows = parseBindingRows(authority.rows);
    return rows.length === 1 && rows[0]!.status === "bound" ? deviceId : null;
  }
}

class ObservationRejectedError extends Error {}

interface ReceiptRow {
  readonly observationId: string;
  readonly device_id: string;
  readonly leaseEpoch: number;
  readonly sourceSequence: number;
  readonly entityId: string;
  readonly canonicalRequestDigest: Buffer;
  readonly observationSequence: number;
  readonly disposition: "current" | "stale";
}

interface LatestRow {
  readonly leaseEpoch: number;
  readonly sourceSequence: number;
  readonly canonicalRequestDigest: Buffer;
}

function ack(request: CloudflareDnsProjectionRequest, digest: Buffer, sequence: string | number, disposition: "current" | "stale"): CloudflareDnsProjectionAck {
  return {
    schemaVersion: 1,
    accepted: true,
    observationId: request.observationId,
    leaseEpoch: request.leaseEpoch,
    sourceSequence: request.sourceSequence,
    canonicalRequestDigest: digest.toString("hex"),
    observationSequence: Number(sequence),
    disposition,
  } as CloudflareDnsProjectionAck;
}

function sameDigest(left: Buffer, right: Buffer): boolean {
  return Buffer.isBuffer(left) && left.length === right.length && timingSafeEqual(left, right);
}

function toMillis(value: Date | string | undefined): number | null {
  const millis = value instanceof Date ? value.getTime() : typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(millis) ? millis : null;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "23505";
}

function parseReceiptRows(rows: unknown): ReceiptRow[] {
  if (!Array.isArray(rows)) throw new ObservationRejectedError();
  return rows.map((row) => {
    if (!exactKeys(row, ["observation_id", "device_id", "lease_epoch", "source_sequence", "entity_id", "canonical_request_digest", "observation_sequence", "disposition"])) throw new ObservationRejectedError();
    const value = row as Record<string, unknown>;
    const observationId = identifier.safeParse(value.observation_id);
    const deviceId = identifier.safeParse(value.device_id);
    const entityId = identifier.safeParse(value.entity_id);
    const leaseEpoch = parseSafePositive(value.lease_epoch);
    const sourceSequence = parseSafePositive(value.source_sequence);
    const observationSequence = parseSafePositive(value.observation_sequence);
    if (!observationId.success || !deviceId.success || !entityId.success || leaseEpoch === null || sourceSequence === null || observationSequence === null
      || !isUuid(observationId.data) || !isDigest(value.canonical_request_digest)
      || (value.disposition !== "current" && value.disposition !== "stale")) throw new ObservationRejectedError();
    return { observationId: observationId.data, device_id: deviceId.data, leaseEpoch, sourceSequence,
      entityId: entityId.data, canonicalRequestDigest: value.canonical_request_digest, observationSequence,
      disposition: value.disposition };
  });
}

function parseLatestRows(rows: unknown): LatestRow[] {
  if (!Array.isArray(rows)) throw new ObservationRejectedError();
  return rows.map((row) => {
    if (!exactKeys(row, ["lease_epoch", "source_sequence", "canonical_request_digest"])) throw new ObservationRejectedError();
    const value = row as Record<string, unknown>;
    const leaseEpoch = parseSafePositive(value.lease_epoch);
    const sourceSequence = parseSafePositive(value.source_sequence);
    if (leaseEpoch === null || sourceSequence === null || !isDigest(value.canonical_request_digest)) throw new ObservationRejectedError();
    return { leaseEpoch, sourceSequence, canonicalRequestDigest: value.canonical_request_digest };
  });
}

function parseLeaseRows(rows: unknown): Array<{ readonly leaseEpoch: number; readonly deviceId: string }> {
  if (!Array.isArray(rows)) throw new ObservationRejectedError();
  return rows.map((row) => {
    if (!exactKeys(row, ["lease_epoch", "device_id"])) throw new ObservationRejectedError();
    const value = row as Record<string, unknown>;
    const leaseEpoch = parseSafePositive(value.lease_epoch);
    const deviceId = identifier.safeParse(value.device_id);
    if (leaseEpoch === null || !deviceId.success) throw new ObservationRejectedError();
    return { leaseEpoch, deviceId: deviceId.data };
  });
}

function parseDeviceRows(rows: unknown): Array<{ readonly deviceId: string }> {
  if (!Array.isArray(rows)) throw new ObservationRejectedError();
  return rows.map((row) => {
    if (!exactKeys(row, ["device_id"])) throw new ObservationRejectedError();
    const deviceId = identifier.safeParse((row as Record<string, unknown>).device_id);
    if (!deviceId.success) throw new ObservationRejectedError();
    return { deviceId: deviceId.data };
  });
}

function parseBindingRows(rows: unknown): Array<{ readonly status: string }> {
  if (!Array.isArray(rows)) throw new ObservationRejectedError();
  return rows.map((row) => {
    if (!exactKeys(row, ["status"]) || (row as Record<string, unknown>).status !== "bound") throw new ObservationRejectedError();
    return { status: "bound" };
  });
}

function parseAuthorityRows(rows: unknown): Array<{
  readonly sourceRevision: number;
  readonly state: string;
  readonly commercialExpiresAt: number;
  readonly trustedNow: number;
  readonly featureEntitlements: string[];
}> {
  if (!Array.isArray(rows)) throw new ObservationRejectedError();
  return rows.map((row) => {
    if (!exactKeys(row, ["source_revision", "state", "commercial_expires_at", "feature_entitlements", "trusted_now"])) throw new ObservationRejectedError();
    const value = row as Record<string, unknown>;
    const sourceRevision = parseSafePositive(value.source_revision);
    const commercialExpiresAt = toMillis(value.commercial_expires_at as Date | string | undefined);
    const trustedNow = toMillis(value.trusted_now as Date | string | undefined);
    if (sourceRevision === null || commercialExpiresAt === null || trustedNow === null || value.state !== "active"
      || !Array.isArray(value.feature_entitlements)
      || value.feature_entitlements.some((item) => typeof item !== "string" || !/^[!-~]{1,160}$/u.test(item))) throw new ObservationRejectedError();
    return { sourceRevision, state: "active", commercialExpiresAt, trustedNow, featureEntitlements: value.feature_entitlements };
  });
}

function parseClockRows(rows: unknown): Date | string | undefined {
  if (!Array.isArray(rows) || rows.length !== 1 || !exactKeys(rows[0], ["now"])) throw new ObservationRejectedError();
  const value = (rows[0] as Record<string, unknown>).now;
  return value instanceof Date || typeof value === "string" ? value : undefined;
}

function parseSafePositive(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" && /^[1-9][0-9]*$/u.test(value) ? Number(value) : Number.NaN;
  return Number.isSafeInteger(number) && number >= 1 ? number : null;
}

function isDigest(value: unknown): value is Buffer {
  return Buffer.isBuffer(value) && value.length === 32;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value);
}

function exactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const ownKeys = Reflect.ownKeys(value);
  return ownKeys.length === keys.length && ownKeys.every((key) => typeof key === "string" && keys.includes(key))
    && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key)
      && Object.getOwnPropertyDescriptor(value, key)?.enumerable === true
      && "value" in Object.getOwnPropertyDescriptor(value, key)!);
}
