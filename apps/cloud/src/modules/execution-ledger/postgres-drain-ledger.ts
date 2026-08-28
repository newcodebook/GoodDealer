import type { TenantTransaction } from "../../db/index";
import type { TransactionalDrainLedgerPort } from "../devices/ports";

export class PostgresExecutionFactDrainLedger implements TransactionalDrainLedgerPort<"execution_fact"> {
  readonly stream = "execution_fact" as const;

  async installAcceptedSeal(transaction: TenantTransaction, input: { readonly proofId: string }): Promise<boolean> {
    const result = await transaction.query<{ installed: boolean }>(
      "SELECT public.execution_fact_drain_install_accepted_seal($1) AS installed",
      [input.proofId],
    );
    return result.rows[0]?.installed === true;
  }
}
