import type { CloudMigration } from "../../../../../db/index";

/**
 * ADR-0029 decision 1, C1b2a: every replica DomainAsset row and tombstone carries its entity
 * generation. Existing rows and tombstones are generation 1, which is also the only generation the
 * ingest admits before re-add exists, so the application role gets no write authority over the
 * column: inserts take the default and re-add (C2) will grant what it needs. A tombstone must carry
 * the generation of the deleted row it names, so the pair cannot disagree about which generation
 * was deleted; a deleted row is already final, so the equality holds for the pair's lifetime.
 */
export const replicaEntityGenerationMigration: CloudMigration = {
  id: "202611140002-replica-entity-generation",
  owner: "workspace/state/portfolio",
  sql: `
    ALTER TABLE workspace_replica_domain_assets
      ADD COLUMN entity_generation bigint NOT NULL DEFAULT 1
        CONSTRAINT workspace_replica_domain_assets_entity_generation_check
        CHECK (entity_generation BETWEEN 1 AND 9007199254740991);
    ALTER TABLE workspace_replica_tombstones
      ADD COLUMN entity_generation bigint NOT NULL DEFAULT 1
        CONSTRAINT workspace_replica_tombstones_entity_generation_check
        CHECK (entity_generation BETWEEN 1 AND 9007199254740991);

    CREATE OR REPLACE FUNCTION workspace_replica_tombstone_names_deleted_asset() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, public
    AS $workspace_replica_tombstone_names_deleted_asset$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM workspace_replica_domain_assets asset
        WHERE asset.account_id = NEW.account_id AND asset.workspace_id = NEW.workspace_id
          AND asset.entity_id = NEW.entity_id AND asset.deleted_at IS NOT NULL
          AND asset.entity_generation = NEW.entity_generation
      ) THEN
        RAISE EXCEPTION 'a domain asset tombstone requires its deleted replica row of the same generation'
          USING ERRCODE = 'check_violation';
      END IF;
      RETURN NEW;
    END;
    $workspace_replica_tombstone_names_deleted_asset$;
  `,
};
