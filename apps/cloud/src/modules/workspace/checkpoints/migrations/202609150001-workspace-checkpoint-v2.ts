import type { CloudMigration } from "../../../../db/index";

/** Forward-only checkpoint wire-version compatibility; existing v1 rows remain readable. */
export const workspaceCheckpointV2Migration: CloudMigration = {
  id: "202609150001-workspace-checkpoint-v2",
  owner: "workspace/checkpoints",
  sql: `
    ALTER TABLE workspace_checkpoints
      DROP CONSTRAINT workspace_checkpoints_schema_version_check;
    ALTER TABLE workspace_checkpoints
      ADD CONSTRAINT workspace_checkpoints_schema_version_check
      CHECK (schema_version IN (1, 2));
  `,
};
