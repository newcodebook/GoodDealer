import {
  encodeAuthoritativeEntitlementSnapshotDigestInput,
} from "@gooddealer/protocol/account";
import {
  DESKTOP_AUTHORIZATION_GRANT_ROLE_EXCHANGE_SCHEMA_VERSION,
  desktopAuthorizationGrantRoleRequestSchema,
  type DesktopAuthorizationGrantRoleResponse,
} from "@gooddealer/protocol/devices";

import type {
  AccountTransaction,
  IdentityCapabilityTransactionRunner,
} from "../../db/index";
import type { DesktopAuthorizationApplicationPort } from "../../entrypoints/ports/desktop-authorization";
import type { PublicPrincipal } from "../../entrypoints/ports/public-session";
import type { LockedDefaultWorkspaceAuthorityPort } from "../workspace/default-workspace/index";
import { readDesktopSessionAuthority } from "./desktop-session-authority";
import { DesktopStandbyGrantIssuer } from "./standby-grant-issuer";
import { DesktopAuthorizationGrantIssuer } from "./authorization-grant-issuer";
import type { ActiveDeviceLeaseVerifier } from "./active-device-lease-verifier";

import { isPostgresAuthorizationFailure, authorizesGrant, readCurrentCommercialAuthority, readCurrentIdentity, readCurrentLease, grantAuthorityStillCurrent, canonicalSecond } from "./desktop-authorization-readers";

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
    private readonly standbyIssuer: DesktopStandbyGrantIssuer,
  ) {}

  async issue(
    request: unknown,
    principal: PublicPrincipal,
  ): Promise<DesktopAuthorizationGrantRoleResponse | null> {
    desktopAuthorizationGrantRoleRequestSchema.parse(request);
    if (principal.clientKind !== "desktop") return null;
    const execute = async (transaction: AccountTransaction) => {
      // Global order: account security -> session/family -> default Workspace -> device/Lease.
      const identity = await readCurrentIdentity(transaction, principal);
      if (identity === null) return null;
      const scope = await this.workspaces.resolveLocked(transaction);
      if (scope === null || scope.accountId !== principal.accountId) return null;
      const session = await readDesktopSessionAuthority(transaction, principal, scope.workspaceId);
      if (session === null) return null;
      if (session.role === "standby") {
        const clock = await transaction.query<{ now: Date }>("SELECT clock_timestamp() AS now");
        const now = clock.rows[0]?.now;
        if (!(now instanceof Date)) return null;
        const grant = await this.standbyIssuer.issue({
          schemaVersion: 1, typ: "gd.desktop-standby-grant.v1", iss: "https://accounts.gooddealer.com",
          aud: "gooddealer-desktop/standby", issuedAt: canonicalSecond(now),
          expiresAt: canonicalSecond(new Date(now.getTime() + 900_000)),
          accountId: principal.accountId, deviceId: session.deviceId,
          accountSecurityEpoch: session.accountSecurityEpoch, leaseEpochFloor: session.leaseEpochFloor,
          workspace: { workspaceId: scope.workspaceId, kind: "personal_default" }, scopes: ["workspace:read"],
        });
        if (grant === null) return null;
        const current = await readDesktopSessionAuthority(transaction, principal, scope.workspaceId);
        const time = await transaction.query<{ live: boolean }>("SELECT clock_timestamp() < $1::timestamptz AS live", [grant.expiresAt]);
        if (current === null || current.role !== "standby" || current.deviceId !== session.deviceId
          || current.accountSecurityEpoch !== session.accountSecurityEpoch || current.leaseEpochFloor !== session.leaseEpochFloor
          || time.rows[0]?.live !== true) return null;
        return { schemaVersion: DESKTOP_AUTHORIZATION_GRANT_ROLE_EXCHANGE_SCHEMA_VERSION, role: "standby", grant } as const;
      }
      const lease = await readCurrentLease(transaction, principal.accountId, identity, this.leaseVerifier);
      if (lease === null) return null;
      const commercial = await readCurrentCommercialAuthority(transaction);
      // The locked snapshot may authorize local business without any Provider capability. A
      // malformed dependency (write without observation) is denied before reaching the signer.
      if (commercial === null || !authorizesGrant(commercial)) return null;
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
        || !authorizesGrant(currentCommercial)
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
      return current ? { schemaVersion: DESKTOP_AUTHORIZATION_GRANT_ROLE_EXCHANGE_SCHEMA_VERSION, role: "active", grant: result.grant } as const : null;
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
