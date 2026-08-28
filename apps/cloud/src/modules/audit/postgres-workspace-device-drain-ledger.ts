import type { TenantTransaction } from "../../db/index";
import type { TransactionalDrainLedgerPort } from "../devices/ports";

export class PostgresWorkspaceDeviceAuditDrainLedger implements TransactionalDrainLedgerPort<"device_audit"> {
  readonly stream = "device_audit" as const;

  async installAcceptedSeal(transaction: TenantTransaction, input: { readonly proofId: string }): Promise<boolean> {
    const result = await transaction.query<{ installed: boolean }>(
      "SELECT public.audit_install_workspace_device_drain_seal($1) AS installed",
      [input.proofId],
    );
    return result.rows[0]?.installed === true;
  }
}
