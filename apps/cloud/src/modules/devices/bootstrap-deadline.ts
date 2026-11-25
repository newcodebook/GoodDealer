import type { TenantTransaction } from "../../db/index";

/** Locks protect identity and revisions, but cannot stop a deadline passing during signer/port I/O. */
export async function bootstrapDeadlineIsLive(transaction: TenantTransaction, workflowId: string): Promise<boolean> {
  const result = await transaction.query<{ live: boolean }>(
    `SELECT clock_timestamp() >= c.issued_at
        AND clock_timestamp() < c.expires_at
        AND clock_timestamp() < w.state_deadline
        AND (a.pinned_checkpoint_id IS NULL OR clock_timestamp() < a.pin_expires_at) AS live
     FROM device_switch_workflows w JOIN device_bootstrap_capabilities c
       USING (account_id, workspace_id, workflow_id)
     JOIN device_bootstrap_authorities a USING (account_id, workspace_id, workflow_id)
     WHERE w.account_id = $1 AND w.workspace_id = $2 AND w.workflow_id = $3`,
    [transaction.scope.accountId, transaction.scope.workspaceId, workflowId],
  );
  return result.rows.length === 1 && result.rows[0]?.live === true;
}
