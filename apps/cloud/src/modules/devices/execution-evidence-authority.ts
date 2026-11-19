import type { AccountTransaction, IdentityCapabilityTransactionRunner } from "../../db/index";
import type { PublicPrincipal } from "../../entrypoints/ports/public-session";
import type { LockedDefaultWorkspaceAuthorityPort } from "../workspace/default-workspace/index";
import { readDesktopSessionAuthority } from "./desktop-session-authority";
import { isPostgresAuthorizationFailure, readCurrentIdentity } from "./desktop-authorization-readers";
export interface ExecutionEvidenceSource {
  readonly transaction: AccountTransaction;
  readonly workspaceId: string;
  readonly sourceDeviceId: string;
  readonly currentLeaseEpoch: number;
}
export interface ExecutionEvidenceAuthorityPort {
  withActiveSource<T>(
    principal: PublicPrincipal,
    work: (source: ExecutionEvidenceSource) => Promise<T>,
  ): Promise<T | null>;
}
class ExecutionEvidenceAuthorityExpired extends Error {}
/** Admission and final fence share the consumed credential transaction; an expired fence rolls back writes. */
export class PostgresExecutionEvidenceAuthority implements ExecutionEvidenceAuthorityPort {
  constructor(
    private readonly transactions: Pick<IdentityCapabilityTransactionRunner, "withAccountCredential">,
    private readonly workspaces: LockedDefaultWorkspaceAuthorityPort,
  ) {}
  async withActiveSource<T>(
    principal: PublicPrincipal,
    work: (source: ExecutionEvidenceSource) => Promise<T>,
  ): Promise<T | null> {
    if (principal.clientKind !== "desktop" || principal.transactionCredential === undefined) return null;
    try {
      return await this.transactions.withAccountCredential(
        principal.transactionCredential,
        "devices_account",
        async (transaction) => {
          if ((await readCurrentIdentity(transaction, principal)) === null) return null;
          const workspace = await this.workspaces.resolveLocked(transaction);
          if (workspace === null || workspace.accountId !== principal.accountId) return null;
          const session = await readDesktopSessionAuthority(transaction, principal, workspace.workspaceId);
          if (session?.role !== "active") return null;
          const epoch = await transaction.query<{ current_lease_epoch: string }>(
            "SELECT current_lease_epoch FROM device_account_states WHERE account_id=$1 FOR SHARE",
            [principal.accountId],
          );
          const currentLeaseEpoch = Number(epoch.rows[0]?.current_lease_epoch);
          if (!Number.isSafeInteger(currentLeaseEpoch) || currentLeaseEpoch < 1) return null;
          const result = await work({
            transaction,
            workspaceId: workspace.workspaceId,
            sourceDeviceId: session.deviceId,
            currentLeaseEpoch,
          });
          const after = await readDesktopSessionAuthority(transaction, principal, workspace.workspaceId);
          const live = await transaction.query<{ device: string | null }>(
            "SELECT identity_private.current_execution_context_device() AS device",
          );
          if (
            after?.role !== "active" ||
            after.deviceId !== session.deviceId ||
            after.accountSecurityEpoch !== session.accountSecurityEpoch ||
            live.rows[0]?.device !== session.deviceId
          )
            throw new ExecutionEvidenceAuthorityExpired();
          return result;
        },
      );
    } catch (error) {
      if (error instanceof ExecutionEvidenceAuthorityExpired || isPostgresAuthorizationFailure(error))
        return null;
      throw error;
    }
  }
}
