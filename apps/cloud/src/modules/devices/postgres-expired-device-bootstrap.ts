import type { AccountTransaction, TenantTransaction } from "../../db/index";
import type { LockedDefaultWorkspaceAuthorityPort } from "../workspace/default-workspace/index";
import type { BootstrapCheckpointPort } from "./bootstrap-persistence-ports";
import { terminateDeviceBootstrap } from "./terminate-device-bootstrap";

/** Login already holds the account security/state locks and has checked its bound device. */
export interface ExpiredDeviceBootstrapPort {
  expireLocked(transaction: AccountTransaction): Promise<boolean>;
}

/** Expiry and target cancellation burn the same reservation through its devices-owned terminator. */
export class PostgresExpiredDeviceBootstrap implements ExpiredDeviceBootstrapPort {
  constructor(
    private readonly dependencies: {
      readonly workspaces: LockedDefaultWorkspaceAuthorityPort;
      readonly checkpoints: Pick<BootstrapCheckpointPort, "release">;
    },
  ) {}
  async expireLocked(account: AccountTransaction): Promise<boolean> {
    const scope = await this.dependencies.workspaces.resolveLocked(account);
    if (scope === null) return true;
    if (scope.accountId !== account.accountId) throw new TypeError("bootstrap expiry scope is inconsistent");
    const transaction: TenantTransaction = { scope, query: account.query.bind(account) };
    const workflow = await transaction.query<{ workflow_id: string }>(
      `SELECT workflow_id FROM device_switch_workflows
       WHERE account_id=$1 AND workspace_id=$2 AND status='bootstrapping' FOR UPDATE`,
      [scope.accountId, scope.workspaceId],
    );
    if (workflow.rows.length === 0) return true;
    if (workflow.rows.length !== 1) throw new TypeError("bootstrap expiry authority is inconsistent");
    return terminateDeviceBootstrap(
      transaction,
      this.dependencies.checkpoints,
      workflow.rows[0]!.workflow_id,
      "expired",
    );
  }
}
