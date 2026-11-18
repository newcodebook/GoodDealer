import type { CloudMigration } from "../../../../db/index";

/**
 * ADR-0029 decision 3: a mutation naming a generation other than the replica's is a business
 * conflict, recorded like the other single-item business rejections (ADR-0030). Only the code
 * whitelist widens; no existing row changes. The constraint keeps the name PostgreSQL derived
 * when the column CHECK was first declared.
 */
export const mutationGenerationMismatchReceiptMigration: CloudMigration = {
  id: "202611140003-mutation-generation-mismatch-receipt",
  owner: "workspace/mutations",
  sql: `
    ALTER TABLE public.workspace_device_mutation_sequence_ledger
      DROP CONSTRAINT workspace_device_mutation_sequence_ledger_rejection_code_check,
      ADD CONSTRAINT workspace_device_mutation_sequence_ledger_rejection_code_check
        CHECK (rejection_code IN ('MUTATION_FIELD_STALE', 'MUTATION_ENTITY_UNKNOWN', 'MUTATION_GENERATION_MISMATCH'));
  `,
};
