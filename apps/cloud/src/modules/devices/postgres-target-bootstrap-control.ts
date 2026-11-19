import {
  deviceBootstrapStatusRequestSchema,
  deviceBootstrapStatusResponseSchema,
  deviceSwitchLookupRequestSchema,
  deviceSwitchResponseSchema,
  type DeviceBootstrapStatusResponse,
  type DeviceSwitchResponse,
} from "@gooddealer/protocol/devices";
import type {
  AccountTransaction,
  IdentityCapabilityTransactionRunner,
  TenantTransaction,
} from "../../db/index";
import type { PublicPrincipal } from "../../entrypoints/ports/public-session";
import type { LockedDefaultWorkspaceAuthorityPort } from "../workspace/default-workspace/index";
import type { BootstrapCheckpointPort } from "./bootstrap-persistence-ports";
import { isPostgresAuthorizationFailure, readCurrentIdentity } from "./desktop-authorization-readers";
import { readDesktopSessionAuthority } from "./desktop-session-authority";
import { readTargetBootstrapRequest, type DeviceSwitchSubject } from "./postgres-switch-requests";
import { terminateDeviceBootstrap } from "./terminate-device-bootstrap";

class TargetBootstrapAuthorityExpired extends Error {}

/** Target-only control uses current session authority; it never needs or grants an execution Lease. */
export class PostgresTargetBootstrapControl {
  constructor(
    private readonly transactions: Pick<IdentityCapabilityTransactionRunner, "withAccountCredential">,
    private readonly workspaces: LockedDefaultWorkspaceAuthorityPort,
    private readonly checkpoints: Pick<BootstrapCheckpointPort, "release">,
  ) {}

  async status(value: unknown, principal: PublicPrincipal): Promise<DeviceBootstrapStatusResponse | null> {
    const request = deviceBootstrapStatusRequestSchema.parse(value);
    return this.withTarget(principal, async (transaction, target) => {
      const view = await readTargetBootstrapRequest(transaction, target, request.requestId);
      return deviceBootstrapStatusResponseSchema.parse(
        view === null ? { schemaVersion: 1, found: false } : { schemaVersion: 1, found: true, request: view },
      );
    });
  }

  async cancel(value: unknown, principal: PublicPrincipal): Promise<DeviceSwitchResponse | null> {
    const request = deviceSwitchLookupRequestSchema.parse(value);
    return this.withTarget(principal, async (transaction, target) => {
      const view = await readTargetBootstrapRequest(transaction, target, request.requestId);
      if (view === null) return { schemaVersion: 1, accepted: false, code: "SWITCH_NOT_FOUND" };
      if (view.status === "cancelled") return { schemaVersion: 1, accepted: true, request: view };
      if (view.status !== "bootstrapping")
        return { schemaVersion: 1, accepted: false, code: "SWITCH_NOT_CANCELLABLE" };
      const tenant: TenantTransaction = {
        scope: { accountId: target.accountId, workspaceId: target.workspaceId },
        query: transaction.query.bind(transaction),
      };
      if (!(await terminateDeviceBootstrap(tenant, this.checkpoints, request.requestId, "cancelled"))) {
        return { schemaVersion: 1, accepted: false, code: "SWITCH_NOT_CANCELLABLE" };
      }
      const cancelled = await readTargetBootstrapRequest(transaction, target, request.requestId);
      if (cancelled?.status !== "cancelled")
        throw new TypeError("bootstrap terminal history is inconsistent");
      return deviceSwitchResponseSchema.parse({ schemaVersion: 1, accepted: true, request: cancelled });
    });
  }

  private async withTarget<T>(
    principal: PublicPrincipal,
    work: (transaction: AccountTransaction, target: DeviceSwitchSubject) => Promise<T>,
  ): Promise<T | null> {
    if (principal.clientKind !== "desktop" || principal.transactionCredential === undefined) return null;
    try {
      return await this.transactions.withAccountCredential(
        principal.transactionCredential,
        "devices_account",
        async (transaction) => {
          const identity = await readCurrentIdentity(transaction, principal);
          if (identity === null) return null;
          const workspace = await this.workspaces.resolveLocked(transaction);
          if (workspace === null || workspace.accountId !== principal.accountId) return null;
          // Take the writer lock before the session reader's shared account lock. Two target
          // cancellations must never both acquire shared state and deadlock during an upgrade.
          const account = await transaction.query(
            "SELECT 1 FROM device_account_states WHERE account_id=$1 FOR UPDATE",
            [principal.accountId],
          );
          if (account.rows.length !== 1) return null;
          const session = await readDesktopSessionAuthority(transaction, principal, workspace.workspaceId);
          if (session === null || session.deviceId !== identity.deviceId) return null;
          const result = await work(transaction, {
            accountId: workspace.accountId,
            workspaceId: workspace.workspaceId,
            deviceId: session.deviceId,
          });
          const after = await readDesktopSessionAuthority(transaction, principal, workspace.workspaceId);
          const live = await transaction.query<{ device: string | null }>(
            "SELECT identity_private.current_execution_context_device() AS device",
          );
          // A final credential/session failure throws through the transaction, rolling back every
          // epoch, capability, nonce and pin effect before the public application hides the denial.
          if (
            after === null ||
            after.deviceId !== session.deviceId ||
            after.accountSecurityEpoch !== session.accountSecurityEpoch ||
            live.rows[0]?.device !== session.deviceId
          ) {
            throw new TargetBootstrapAuthorityExpired();
          }
          return result;
        },
      );
    } catch (error) {
      if (error instanceof TargetBootstrapAuthorityExpired || isPostgresAuthorizationFailure(error))
        return null;
      throw error;
    }
  }
}
