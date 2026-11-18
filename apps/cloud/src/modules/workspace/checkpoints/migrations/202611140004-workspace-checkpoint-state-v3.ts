import type { CloudMigration } from "../../../../db/index";

/**
 * ADR-0029 decision 1: a checkpoint is the whole replicated DomainAsset state, so version 3 stores
 * each live asset's generation and every tombstone. Version 1 and 2 checkpoints recorded neither;
 * one built after deletes landed would silently forget them, and no upgrade can recover what it
 * dropped. No deployed composition has ever built a checkpoint (build and compaction are wired to
 * no entrypoint; only the reader is), so this migration refuses to run if any such row exists
 * rather than serving or reinterpreting one. A database that holds one needs an explicit decision.
 *
 * Tombstone partitions are named `t0000…` so partition ids stay unique per checkpoint alongside the
 * live-asset `p0000…`/`empty` partitions, and each stored tombstone references its digest partition
 * exactly as each stored asset does. Disjointness of live and deleted ids is checked by the
 * protocol schema on every write and read and covered by the recomputed checkpoint digest.
 */
export const workspaceCheckpointStateV3Migration: CloudMigration = {
  id: "202611140004-workspace-checkpoint-state-v3",
  owner: "workspace/checkpoints",
  sql: `
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM workspace_checkpoints WHERE schema_version <> 3) THEN
        RAISE EXCEPTION 'version 1 or 2 workspace checkpoints exist and cannot carry tombstones'
          USING ERRCODE = 'check_violation';
      END IF;
    END $$;

    ALTER TABLE workspace_checkpoints
      DROP CONSTRAINT workspace_checkpoints_schema_version_check,
      DROP CONSTRAINT workspace_checkpoints_capture_codec_check,
      DROP CONSTRAINT workspace_checkpoints_capture_schema_version_check;
    ALTER TABLE workspace_checkpoints
      ADD CONSTRAINT workspace_checkpoints_schema_version_check CHECK (schema_version = 3),
      ADD CONSTRAINT workspace_checkpoints_capture_codec_check
        CHECK (capture_codec = 'workspace-checkpoint-state-v3'),
      ADD CONSTRAINT workspace_checkpoints_capture_schema_version_check CHECK (capture_schema_version = 3);

    ALTER TABLE workspace_checkpoint_entity_digests
      DROP CONSTRAINT workspace_checkpoint_entity_digests_entity_type_check,
      DROP CONSTRAINT workspace_checkpoint_entity_digests_partition_key_check,
      DROP CONSTRAINT workspace_checkpoint_entity_digests_partition_id_check;
    ALTER TABLE workspace_checkpoint_entity_digests
      ADD CONSTRAINT workspace_checkpoint_entity_digests_partition_shape_check CHECK (
        (entity_type = 'domain_asset' AND partition_id ~ '^(p[0-9]{4}|empty)$')
        OR (entity_type = 'domain_asset_tombstone' AND partition_id ~ '^t[0-9]{4}$')
      );

    ALTER TABLE workspace_checkpoint_domain_assets
      ADD COLUMN entity_generation bigint NOT NULL
        CONSTRAINT workspace_checkpoint_domain_assets_entity_generation_check
        CHECK (entity_generation BETWEEN 1 AND 9007199254740991);

    CREATE TABLE workspace_checkpoint_domain_asset_tombstones (
      account_id text NOT NULL,
      workspace_id text NOT NULL,
      checkpoint_id text NOT NULL,
      entity_id text NOT NULL CHECK (
        octet_length(entity_id) BETWEEN 3 AND 253
        AND entity_id ~ '^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'
      ),
      partition_id text NOT NULL CHECK (partition_id ~ '^t[0-9]{4}$'),
      entity_generation bigint NOT NULL CHECK (entity_generation BETWEEN 1 AND 9007199254740991),
      deleted_server_revision bigint NOT NULL CHECK (deleted_server_revision BETWEEN 1 AND 9007199254740991),
      deleted_at timestamptz NOT NULL,
      PRIMARY KEY (account_id, workspace_id, checkpoint_id, entity_id),
      FOREIGN KEY (account_id, workspace_id, checkpoint_id)
        REFERENCES workspace_checkpoints (account_id, workspace_id, checkpoint_id) ON DELETE CASCADE,
      FOREIGN KEY (account_id, workspace_id, checkpoint_id, partition_id)
        REFERENCES workspace_checkpoint_entity_digests (
          account_id, workspace_id, checkpoint_id, partition_id
        ) ON DELETE RESTRICT
    );
    ALTER TABLE workspace_checkpoint_domain_asset_tombstones ENABLE ROW LEVEL SECURITY;
    ALTER TABLE workspace_checkpoint_domain_asset_tombstones FORCE ROW LEVEL SECURITY;
    CREATE POLICY workspace_checkpoint_domain_asset_tombstones_tenant_scope
      ON workspace_checkpoint_domain_asset_tombstones
      USING (CURRENT_USER = 'gooddealer_cloud_owner' OR (
        account_id = current_setting('gooddealer.account_id', true)
        AND workspace_id = current_setting('gooddealer.workspace_id', true)))
      WITH CHECK (CURRENT_USER = 'gooddealer_cloud_owner' OR (
        account_id = current_setting('gooddealer.account_id', true)
        AND workspace_id = current_setting('gooddealer.workspace_id', true)));
    GRANT SELECT, INSERT ON workspace_checkpoint_domain_asset_tombstones TO gooddealer_cloud_app;
  `,
};
