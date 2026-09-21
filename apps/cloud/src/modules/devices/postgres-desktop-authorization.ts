import {
  authoritativeEntitlementSnapshotSchema,
  encodeAuthoritativeEntitlementSnapshotDigestInput,
  type AuthoritativeEntitlementSnapshot,
} from "@gooddealer/protocol/account";
import {
  type ActiveDeviceLeaseEnvelope,
  type DesktopAuthorizationGrant,
  type DesktopAuthorizationGrantRequest,
} from "@gooddealer/protocol/devices";

import type {
  AccountTransaction,
  IdentityCapabilityTransactionRunner,
} from "../../db/index";
import type { DesktopAuthorizationApplicationPort } from "../../entrypoints/ports/desktop-authorization";
import type { PublicPrincipal } from "../../entrypoints/ports/public-session";
import type { LockedDefaultWorkspaceAuthorityPort } from "../workspace/default-workspace/index";
import { DesktopAuthorizationGrantIssuer } from "./authorization-grant-issuer";
import type { ActiveDeviceLeaseVerifier } from "./active-device-lease-verifier";

type AccountTransactions = Pick<IdentityCapabilityTransactionRunner, "withAccountCredential">;

/**
 * Resolves every Grant selector from authenticated and locked server state. The request carries no
 * account, device, workspace, Lease, Epoch or scope authority.
 */
export class PostgresDesktopAuthorizationApplicationService
implements DesktopAuthorizationApplicationPort {
  constructor(
    private readonly transactions: AccountTransactions,
    private readonly workspaces: LockedDefaultWorkspaceAuthorityPort,
    private readonly issuer: DesktopAuthorizationGrantIssuer,
    private readonly leaseVerifier: ActiveDeviceLeaseVerifier,
  ) {}

  async issue(
    _request: DesktopAuthorizationGrantRequest,
    principal: PublicPrincipal,
  ): Promise<DesktopAuthorizationGrant | null> {
    if (principal.clientKind !== "desktop") return null;
    const execute = async (transaction: AccountTransaction) => {
      // Global order: account security -> session/family -> default Workspace -> device/Lease.
      const identity = await readCurrentIdentity(transaction, principal);
      if (identity === null) return null;
      const scope = await this.workspaces.resolveLocked(transaction);
      if (scope === null || scope.accountId !== principal.accountId) return null;
      const lease = await readCurrentLease(transaction, principal.accountId, identity, this.leaseVerifier);
      if (lease === null) return null;
      const commercial = await readCurrentCommercialAuthority(transaction);
      if (commercial === null) return null;
      const result = await this.issuer.issue({
        accountId: principal.accountId,
        deviceId: identity.deviceId,
        workspaceId: scope.workspaceId,
        activeDeviceLease: lease,
        authoritativeEntitlementSnapshot: commercial.snapshot,
        trustedNow: commercial.trustedNow,
      });
      if (!result.issued) return null;
      const currentCommercial = await readCurrentCommercialAuthority(transaction);
      if (
        currentCommercial === null
        || currentCommercial.snapshot.state !== "active"
        || currentCommercial.snapshot.commercialExpiresAt === null
        || currentCommercial.snapshot.commercialExpiresAt <= currentCommercial.trustedNow
        || !currentCommercial.snapshot.featureEntitlements.includes("cloudflare:dns:observe")
        || !Buffer.from(encodeAuthoritativeEntitlementSnapshotDigestInput(currentCommercial.snapshot))
          .equals(Buffer.from(encodeAuthoritativeEntitlementSnapshotDigestInput(commercial.snapshot)))
      ) return null;
      const current = await grantAuthorityStillCurrent(
        transaction,
        principal,
        identity,
        scope.workspaceId,
        lease,
      );
      return current ? result.grant : null;
    };
    if (principal.transactionCredential === undefined) return null;
    try {
      return await this.transactions.withAccountCredential(
        principal.transactionCredential,
        "devices_account",
        execute,
      );
    } catch (error) {
      // Identity deliberately gives every invalid, expired, revoked, or stale credential the
      // same PostgreSQL authorization failure. Grant publication treats that result as denial,
      // while operational/database faults remain visible to the HTTP error boundary.
      if (isPostgresAuthorizationFailure(error)) return null;
      throw error;
    }
  }
}

function isPostgresAuthorizationFailure(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "42501";
}

async function readCurrentCommercialAuthority(transaction: AccountTransaction): Promise<{
  readonly snapshot: AuthoritativeEntitlementSnapshot;
  readonly trustedNow: string;
} | null> {
  const result = await transaction.query<{
    source_event_id: string;
    source_revision: string;
    occurred_at: Date;
    state: string;
    license_id: string;
    plan: string;
    entitlement_kind: string;
    commercial_expires_at: Date | null;
    offline_grace_until: Date;
    credential_refresh_due_at: Date;
    feature_entitlements: string[];
    trusted_now: Date;
  }>(
    "SELECT * FROM licensing_api.read_authoritative_entitlement_snapshot()",
  );
  if (result.rows.length !== 1) return null;
  const row = result.rows[0];
  if (row === undefined || row.commercial_expires_at === null) return null;
  const timestamp = (value: Date): string => value.toISOString().replace(/\.\d{3}Z$/u, "Z");
  const snapshot = {
    sourceEventId: row.source_event_id,
    sourceRevision: Number(row.source_revision),
    occurredAt: timestamp(row.occurred_at),
    state: row.state,
    licenseId: row.license_id,
    plan: row.plan,
    entitlementKind: row.entitlement_kind,
    commercialExpiresAt: timestamp(row.commercial_expires_at),
    offlineGraceUntil: timestamp(row.offline_grace_until),
    credentialRefreshDueAt: timestamp(row.credential_refresh_due_at),
    featureEntitlements: [...row.feature_entitlements].sort(),
    versionEntitlement: { kind: "subscription_supported" },
  };
  try {
    return {
      snapshot: authoritativeEntitlementSnapshotSchema.parse(snapshot),
      trustedNow: timestamp(row.trusted_now),
    };
  } catch {
    return null;
  }
}

interface CurrentDesktopIdentity {
  readonly accountSecurityEpoch: number;
  readonly deviceId: string;
}

async function readCurrentIdentity(
  transaction: AccountTransaction,
  principal: PublicPrincipal,
): Promise<CurrentDesktopIdentity | null> {
  const security = await transaction.query<{ account_security_epoch: string; status: string }>(
    `SELECT account_security_epoch, status
       FROM identity_account_security_states
      WHERE account_id = $1
      FOR SHARE`,
    [principal.accountId],
  );
  const securityRow = security.rows[0];
  if (security.rows.length !== 1 || securityRow?.status !== "normal") return null;
  const accountSecurityEpoch = positiveInteger(securityRow.account_security_epoch);
  if (accountSecurityEpoch === null) return null;

  const session = await transaction.query<{ device_id: string | null }>(
    `SELECT a.device_id
       FROM identity_auth_sessions a
       JOIN identity_refresh_families f
         ON f.account_id = a.account_id AND f.session_id = a.session_id
      WHERE a.account_id = $1 AND a.session_id = $2 AND a.client_kind = 'desktop'
        AND a.revoked_at IS NULL AND a.epoch_at_issue = $3
        AND (a.expires_at IS NULL OR clock_timestamp() < a.expires_at)
        AND f.state = 'active'
      FOR SHARE OF a, f`,
    [principal.accountId, principal.sessionId, accountSecurityEpoch],
  );
  const sessionRow = session.rows[0];
  if (session.rows.length !== 1 || sessionRow === undefined || sessionRow.device_id === null) return null;
  return { accountSecurityEpoch, deviceId: sessionRow.device_id };
}

async function readCurrentLease(
  transaction: AccountTransaction,
  accountId: string,
  identity: CurrentDesktopIdentity,
  leaseVerifier: ActiveDeviceLeaseVerifier,
): Promise<ActiveDeviceLeaseEnvelope | null> {
  const leaseResult = await transaction.query<{
    device_id: string;
    wire_envelope: unknown;
    binding_live: boolean;
    lease_live: boolean;
    current_epoch: boolean;
    lease_epoch: string;
    jti: string;
    issued_at: Date;
    renew_after: Date;
    online_expires_at: Date;
    offline_execute_until: Date;
  }>(
    `SELECT l.device_id, l.wire_envelope, l.lease_epoch, l.jti, l.issued_at, l.renew_after,
            l.online_expires_at, l.offline_execute_until,
            b.status = 'bound' AS binding_live,
            l.released_at IS NULL AND clock_timestamp() >= l.issued_at
              AND clock_timestamp() < l.online_expires_at AS lease_live,
            s.current_lease_epoch = l.lease_epoch AS current_epoch
       FROM device_active_leases l
       JOIN device_account_states s ON s.account_id = l.account_id
       JOIN device_bindings b ON b.account_id = l.account_id AND b.device_id = l.device_id
      WHERE l.account_id = $1 AND l.device_id = $2 AND l.released_at IS NULL
      FOR SHARE OF l, s, b`,
    [accountId, identity.deviceId],
  );
  const row = leaseResult.rows[0];
  if (
    leaseResult.rows.length !== 1 || row === undefined || row.device_id !== identity.deviceId
    || !row.binding_live || !row.lease_live || !row.current_epoch || row.wire_envelope === null
  ) return null;
  const lease = leaseVerifier.verify(row.wire_envelope);
  if (
    lease === null || lease.accountId !== accountId || lease.deviceId !== identity.deviceId
    || lease.accountSecurityEpoch !== identity.accountSecurityEpoch || !persistedLeaseMatches(row, lease)
  ) {
    return null;
  }
  return lease;
}

async function grantAuthorityStillCurrent(
  transaction: AccountTransaction,
  principal: PublicPrincipal,
  identity: CurrentDesktopIdentity,
  workspaceId: string,
  lease: ActiveDeviceLeaseEnvelope,
): Promise<boolean> {
  // transaction_timestamp() is fixed at BEGIN; clock_timestamp() closes a remote-signer time crossing.
  const result = await transaction.query<{ authorized: boolean }>(
    `SELECT (
        security.status = 'normal'
        AND security.account_security_epoch = $3
        AND session.client_kind = 'desktop'
        AND session.device_id = $4
        AND session.revoked_at IS NULL
        AND session.epoch_at_issue = security.account_security_epoch
        AND (session.expires_at IS NULL OR clock_timestamp() < session.expires_at)
        AND family.state = 'active'
        AND workspace.owner_kind = 'account'
        AND workspace.role = 'default_owner'
        AND workspace.is_default = true
        AND binding.status = 'bound'
        AND device_state.current_lease_epoch = active_lease.lease_epoch
        AND active_lease.released_at IS NULL
        AND active_lease.wire_envelope IS NOT NULL
        AND active_lease.signer_receipt_digest IS NOT NULL
        AND clock_timestamp() >= active_lease.issued_at
        AND clock_timestamp() < active_lease.online_expires_at
      ) AS authorized
       FROM identity_account_security_states security
       JOIN identity_auth_sessions session
         ON session.account_id = security.account_id AND session.session_id = $2
       JOIN identity_refresh_families family
         ON family.account_id = session.account_id AND family.session_id = session.session_id
       JOIN workspace_account_bindings workspace
         ON workspace.account_id = session.account_id AND workspace.workspace_id = $5
       JOIN device_account_states device_state ON device_state.account_id = session.account_id
       JOIN device_bindings binding
         ON binding.account_id = session.account_id AND binding.device_id = session.device_id
       JOIN device_active_leases active_lease
         ON active_lease.account_id = session.account_id AND active_lease.device_id = session.device_id
        AND active_lease.jti = $6 AND active_lease.lease_epoch = $7
      WHERE security.account_id = $1`,
    [principal.accountId, principal.sessionId, identity.accountSecurityEpoch, identity.deviceId,
      workspaceId, lease.jti, lease.payload.leaseEpoch],
  );
  return result.rows.length === 1 && result.rows[0]?.authorized === true;
}

function positiveInteger(value: string): number | null {
  if (!/^[1-9]\d*$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function persistedLeaseMatches(
  row: {
    readonly lease_epoch: string;
    readonly jti: string;
    readonly issued_at: Date;
    readonly renew_after: Date;
    readonly online_expires_at: Date;
    readonly offline_execute_until: Date;
  },
  lease: ActiveDeviceLeaseEnvelope,
): boolean {
  return positiveInteger(row.lease_epoch) === lease.payload.leaseEpoch
    && row.jti === lease.jti
    && canonicalSecond(row.issued_at) === lease.issuedAt
    && canonicalSecond(row.renew_after) === lease.payload.renewAfter
    && canonicalSecond(row.online_expires_at) === lease.payload.onlineExpiresAt
    && canonicalSecond(row.offline_execute_until) === lease.payload.offlineExecuteUntil;
}

function canonicalSecond(value: Date): string {
  return value.toISOString().replace(/\.\d{3}Z$/u, "Z");
}
