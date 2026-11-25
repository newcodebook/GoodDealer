import {
  deviceSwitchRequestResolutionRequestSchema,
  type DeviceSwitchRequestResolutionResponse,
} from "@gooddealer/protocol/devices";
import type { IdentityCapabilityTransactionRunner } from "../../db/index";
import type { PublicPrincipal } from "../../entrypoints/ports/public-session";
import type { LockedDefaultWorkspaceAuthorityPort } from "../workspace/default-workspace/index";
import { readCurrentIdentity, isPostgresAuthorizationFailure } from "./desktop-authorization-readers";
import { readDesktopSessionAuthority } from "./desktop-session-authority";
import { readSwitchRequestResolution } from "./postgres-switch-requests";
/** This query never renews a Lease, resends a request or infers absence from an epoch change. */
export class PostgresDeviceSwitchRequestResolution {
  constructor(
    private readonly transactions: Pick<IdentityCapabilityTransactionRunner, "withAccountCredential">,
    private readonly workspaces: LockedDefaultWorkspaceAuthorityPort,
  ) {}
  async resolve(
    value: unknown,
    principal: PublicPrincipal,
  ): Promise<DeviceSwitchRequestResolutionResponse | null> {
    const request = deviceSwitchRequestResolutionRequestSchema.parse(value);
    if (principal.clientKind !== "desktop" || principal.transactionCredential === undefined) return null;
    try {
      return await this.transactions.withAccountCredential(
        principal.transactionCredential,
        "devices_account",
        async (tx) => {
          const identity = await readCurrentIdentity(tx, principal);
          if (identity === null) return null;
          const workspace = await this.workspaces.resolveLocked(tx);
          if (workspace === null || workspace.accountId !== principal.accountId) return null;
          const session = await readDesktopSessionAuthority(tx, principal, workspace.workspaceId);
          if (session === null || session.deviceId !== identity.deviceId) return null;
          // The session reader shares the account-state lock used FOR UPDATE by first-request creation.
          // Therefore not_found is a serialized database result, never a guess from the current epoch.
          const result = await readSwitchRequestResolution(
            tx,
            { accountId: tx.accountId, workspaceId: workspace.workspaceId, deviceId: session.deviceId },
            request.idempotencyKey,
          );
          const after = await readDesktopSessionAuthority(tx, principal, workspace.workspaceId);
          const live = await tx.query<{ device: string | null }>(
            "SELECT identity_private.current_execution_context_device() AS device",
          );
          if (
            after === null ||
            after.deviceId !== session.deviceId ||
            after.accountSecurityEpoch !== session.accountSecurityEpoch ||
            live.rows[0]?.device !== session.deviceId
          )
            return null;
          return result;
        },
      );
    } catch (error) {
      if (isPostgresAuthorizationFailure(error)) return null;
      throw error;
    }
  }
}
