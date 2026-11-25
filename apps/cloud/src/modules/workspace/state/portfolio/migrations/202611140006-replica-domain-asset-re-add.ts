import type { CloudMigration } from "../../../../../db/index";

/**
 * ADR-0029 decision 3, C2a: an accepted re-add removes the tombstone it names and turns the
 * soft-deleted row into a live row of the next generation, in the ingest transaction. Migration
 * 202611140001 made a deleted row final "until re-add relaxes it"; this is that relaxation, and it
 * admits exactly one transition:
 *
 * - a deleted row may change only by becoming live again, after its tombstone is gone in the same
 *   statement order, with the generation exactly one higher, `lifecycle_status = 'active'`, and
 *   every business field at its default with one shared revision later than the deletion (the
 *   re-add's fields are applied by later updates of the live row, which ordinary rules govern);
 * - a live row keeps its generation, so nothing but this transition can change it;
 * - a tombstone may be removed only if, by commit, it is a DomainAsset tombstone whose row has moved
 *   past the generation it deleted, or its workspace is gone (that deletion cascades to every
 *   replica row). The table-wide DELETE grant therefore removes no tombstone of any other family.
 *
 * The rules are triggers, so they bind the owner as well as the application role. The application
 * role gains only what the re-add writes: the generation column, the tombstone generation the
 * delete now copies from its row, and tombstone deletion. Physical tombstone purge stays deferred
 * and would need its own rule.
 */
export const replicaDomainAssetReAddMigration: CloudMigration = {
  id: "202611140006-replica-domain-asset-re-add",
  owner: "workspace/state/portfolio",
  sql: `
    GRANT UPDATE (entity_generation) ON workspace_replica_domain_assets TO gooddealer_cloud_app;
    GRANT INSERT (entity_generation) ON workspace_replica_tombstones TO gooddealer_cloud_app;
    GRANT DELETE ON workspace_replica_tombstones TO gooddealer_cloud_app;

    CREATE OR REPLACE FUNCTION workspace_replica_domain_asset_deleted_is_final() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, public
    AS $workspace_replica_domain_asset_deleted_is_final$
    BEGIN
      IF NEW.deleted_at IS NULL
        AND NEW.entity_generation = OLD.entity_generation + 1
        AND NEW.lifecycle_status = 'active'
        AND NEW.note IS NULL AND NEW.portfolio_id IS NULL AND NEW.tags = '{}'
        AND NEW.target_price_currency IS NULL AND NEW.target_price_amount IS NULL
        AND NEW.lifecycle_status_server_revision > OLD.lifecycle_status_server_revision
        AND NEW.note_server_revision = NEW.lifecycle_status_server_revision
        AND NEW.portfolio_id_server_revision = NEW.lifecycle_status_server_revision
        AND NEW.tags_server_revision = NEW.lifecycle_status_server_revision
        AND NEW.target_price_server_revision = NEW.lifecycle_status_server_revision
        AND (NEW.account_id, NEW.workspace_id, NEW.entity_id)
          = (OLD.account_id, OLD.workspace_id, OLD.entity_id)
        AND NOT EXISTS (
          SELECT 1 FROM workspace_replica_tombstones tombstone
          WHERE tombstone.account_id = OLD.account_id AND tombstone.workspace_id = OLD.workspace_id
            AND tombstone.entity_type = 'domain_asset' AND tombstone.entity_id = OLD.entity_id
        )
      THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'a deleted domain asset replica row changes only by its re-add'
        USING ERRCODE = 'check_violation';
    END;
    $workspace_replica_domain_asset_deleted_is_final$;

    CREATE FUNCTION workspace_replica_domain_asset_live_generation_is_fixed() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog
    AS $workspace_replica_domain_asset_live_generation_is_fixed$
    BEGIN
      RAISE EXCEPTION 'a live domain asset replica row keeps its generation'
        USING ERRCODE = 'check_violation';
    END;
    $workspace_replica_domain_asset_live_generation_is_fixed$;

    CREATE TRIGGER workspace_replica_domain_assets_live_generation_is_fixed
      BEFORE UPDATE OF entity_generation ON workspace_replica_domain_assets
      FOR EACH ROW WHEN (OLD.deleted_at IS NULL AND NEW.entity_generation IS DISTINCT FROM OLD.entity_generation)
      EXECUTE FUNCTION workspace_replica_domain_asset_live_generation_is_fixed();

    CREATE FUNCTION workspace_replica_tombstone_removal_is_superseded() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, public
    AS $workspace_replica_tombstone_removal_is_superseded$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM workspace_revisions workspace
        WHERE workspace.account_id = OLD.account_id AND workspace.workspace_id = OLD.workspace_id
      ) THEN
        RETURN NULL;
      END IF;
      IF OLD.entity_type = 'domain_asset' AND EXISTS (
        SELECT 1 FROM workspace_replica_domain_assets asset
        WHERE asset.account_id = OLD.account_id AND asset.workspace_id = OLD.workspace_id
          AND asset.entity_id = OLD.entity_id AND asset.entity_generation > OLD.entity_generation
      ) THEN
        RETURN NULL;
      END IF;
      RAISE EXCEPTION 'a tombstone is removed only by the re-add that supersedes it'
        USING ERRCODE = 'check_violation';
    END;
    $workspace_replica_tombstone_removal_is_superseded$;

    CREATE CONSTRAINT TRIGGER workspace_replica_tombstones_removal_is_superseded
      AFTER DELETE ON workspace_replica_tombstones
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW
      EXECUTE FUNCTION workspace_replica_tombstone_removal_is_superseded();
  `,
};
