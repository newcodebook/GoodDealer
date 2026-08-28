import type { TenantTransaction } from "../../../db/index";
import type { TransactionalDrainLedgerPort } from "../../devices/ports";

export class PostgresMutationDrainLedger implements TransactionalDrainLedgerPort<"mutation"> {
  readonly stream = "mutation" as const;

  async installAcceptedSeal(
    transaction: TenantTransaction,
    input: Parameters<TransactionalDrainLedgerPort<"mutation">["installAcceptedSeal"]>[1],
  ): Promise<boolean> {
    const result = await transaction.query<{ accepted: boolean }>(
      `SELECT public.workspace_mutation_drain_install_accepted_seal($1::text) AS accepted`,
      [input.proofId],
    );
    const row = result.rows[0];
    if (result.rows.length !== 1 || row === undefined || typeof row.accepted !== "boolean") {
      throw new TypeError("mutation drain seal routine returned an invalid result");
    }
    return row.accepted;
  }
}
