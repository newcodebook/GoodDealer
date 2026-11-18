import type { CloudMigration } from "../../../../db/index";

/**
 * ADR-0029 C1a: the mutation wire moves to schema version 3, which carries the entity generation.
 * Ledger rows accepted or rejected under version 2 keep their version and digest as immutable
 * evidence; replay of such a row is compared against its re-derived v2 form. Only the version
 * whitelist widens; no existing row changes. The constraint name is the one PostgreSQL derived
 * (truncated to 63 bytes) when the column CHECK was first declared, and the replacement keeps it.
 */
export const mutationWireV3Migration: CloudMigration = {
  id: "202611130005-mutation-wire-v3",
  owner: "workspace/mutations",
  sql: `
    ALTER TABLE public.workspace_device_mutation_sequence_ledger
      DROP CONSTRAINT workspace_device_mutation_sequence_le_wire_schema_version_check,
      ADD CONSTRAINT workspace_device_mutation_sequence_le_wire_schema_version_check
        CHECK (wire_schema_version IN (1, 2, 3));
  `,
};
