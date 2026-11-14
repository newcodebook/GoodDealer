import type { CloudMigration } from "../../../../../db/index";

/**
 * Before this migration the PostgreSQL ingest already accepted deletes but materialized them on the
 * upsert path, leaving the replica row live and writing no tombstone; an exact replay of such a
 * delete is a duplicate, so nothing would ever repair it. This forward repair soft-deletes every
 * live row whose latest retained mutation is a delete, using that mutation's revision and deletion
 * time, then writes the paired tombstone. Compaction removes only a prefix of the log, so a retained
 * latest row is the true latest; no deployed composition has ever compacted (checkpoint compaction
 * is not wired to any entrypoint), so no such delete can be hidden. The statements are separate
 * because the tombstone trigger must see the soft delete; both run as the owner inside the
 * migration transaction, and the deferred pairing check passes at commit. Re-running it is a no-op.
 */
export const legacyAcceptedDeleteRepairSql = `
    WITH latest AS (
      SELECT DISTINCT ON (account_id, workspace_id, entity_id)
        account_id, workspace_id, entity_id, server_revision, operation_kind, deleted_at
      FROM workspace_mutations
      WHERE entity_type = 'domain_asset'
      ORDER BY account_id, workspace_id, entity_id, server_revision DESC
    )
    UPDATE workspace_replica_domain_assets asset SET
      deleted_at = latest.deleted_at, lifecycle_status = 'archived',
      lifecycle_status_server_revision = latest.server_revision,
      note = NULL, note_server_revision = latest.server_revision,
      portfolio_id = NULL, portfolio_id_server_revision = latest.server_revision,
      tags = '{}', tags_server_revision = latest.server_revision,
      target_price_currency = NULL, target_price_amount = NULL,
      target_price_server_revision = latest.server_revision
    FROM latest
    WHERE latest.operation_kind = 'delete' AND asset.deleted_at IS NULL
      AND asset.account_id = latest.account_id AND asset.workspace_id = latest.workspace_id
      AND asset.entity_id = latest.entity_id;

    WITH latest AS (
      SELECT DISTINCT ON (account_id, workspace_id, entity_id)
        account_id, workspace_id, entity_id, server_revision, operation_kind, deleted_at
      FROM workspace_mutations
      WHERE entity_type = 'domain_asset'
      ORDER BY account_id, workspace_id, entity_id, server_revision DESC
    )
    INSERT INTO workspace_replica_tombstones (
      account_id, workspace_id, entity_type, entity_id, deleted_server_revision, deleted_at
    )
    SELECT latest.account_id, latest.workspace_id, 'domain_asset', latest.entity_id,
      latest.server_revision, latest.deleted_at
    FROM latest
    JOIN workspace_replica_domain_assets asset
      ON asset.account_id = latest.account_id AND asset.workspace_id = latest.workspace_id
        AND asset.entity_id = latest.entity_id AND asset.deleted_at IS NOT NULL
    WHERE latest.operation_kind = 'delete'
      AND NOT EXISTS (
        SELECT 1 FROM workspace_replica_tombstones tombstone
        WHERE tombstone.account_id = latest.account_id AND tombstone.workspace_id = latest.workspace_id
          AND tombstone.entity_type = 'domain_asset' AND tombstone.entity_id = latest.entity_id
      );
`;

/**
 * ADR-0029 C1b: an accepted DomainAsset delete soft-deletes its replica row and writes its
 * tombstone in the ingest transaction. The row stays because immutable Cloudflare DNS observation
 * receipts reference it with `ON DELETE RESTRICT`; removing it would either fail or require dropping
 * that evidence's referential integrity (ADR-0029 decision 2).
 *
 * The application role gains exactly the columns the delete writes. The triggers make the pairing a
 * database invariant rather than a repository habit: a soft-deleted row has a tombstone by commit, a
 * tombstone names a soft-deleted row, and a deleted row is final until ADR-0029's re-add relaxes it.
 * They run for every role, so an owner-side repair cannot split the pair either.
 */
export const replicaDomainAssetDeletionMigration: CloudMigration = {
  id: "202611140001-replica-domain-asset-deletion",
  owner: "workspace/state/portfolio",
  sql: `
    GRANT UPDATE (deleted_at, lifecycle_status, lifecycle_status_server_revision)
      ON workspace_replica_domain_assets TO gooddealer_cloud_app;
    GRANT INSERT (account_id, workspace_id, entity_type, entity_id, deleted_server_revision, deleted_at)
      ON workspace_replica_tombstones TO gooddealer_cloud_app;

    CREATE FUNCTION workspace_replica_domain_asset_deleted_is_final() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog
    AS $workspace_replica_domain_asset_deleted_is_final$
    BEGIN
      RAISE EXCEPTION 'a deleted domain asset replica row is final'
        USING ERRCODE = 'check_violation';
    END;
    $workspace_replica_domain_asset_deleted_is_final$;

    CREATE TRIGGER workspace_replica_domain_assets_deleted_is_final
      BEFORE UPDATE ON workspace_replica_domain_assets
      FOR EACH ROW WHEN (OLD.deleted_at IS NOT NULL)
      EXECUTE FUNCTION workspace_replica_domain_asset_deleted_is_final();

    CREATE FUNCTION workspace_replica_domain_asset_deletion_has_tombstone() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, public
    AS $workspace_replica_domain_asset_deletion_has_tombstone$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM workspace_replica_tombstones tombstone
        WHERE tombstone.account_id = NEW.account_id AND tombstone.workspace_id = NEW.workspace_id
          AND tombstone.entity_type = 'domain_asset' AND tombstone.entity_id = NEW.entity_id
      ) THEN
        RAISE EXCEPTION 'a deleted domain asset replica row requires its tombstone'
          USING ERRCODE = 'check_violation';
      END IF;
      RETURN NULL;
    END;
    $workspace_replica_domain_asset_deletion_has_tombstone$;

    CREATE CONSTRAINT TRIGGER workspace_replica_domain_assets_deletion_has_tombstone
      AFTER INSERT OR UPDATE OF deleted_at ON workspace_replica_domain_assets
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW WHEN (NEW.deleted_at IS NOT NULL)
      EXECUTE FUNCTION workspace_replica_domain_asset_deletion_has_tombstone();

    CREATE FUNCTION workspace_replica_tombstone_names_deleted_asset() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, public
    AS $workspace_replica_tombstone_names_deleted_asset$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM workspace_replica_domain_assets asset
        WHERE asset.account_id = NEW.account_id AND asset.workspace_id = NEW.workspace_id
          AND asset.entity_id = NEW.entity_id AND asset.deleted_at IS NOT NULL
      ) THEN
        RAISE EXCEPTION 'a domain asset tombstone requires its deleted replica row'
          USING ERRCODE = 'check_violation';
      END IF;
      RETURN NEW;
    END;
    $workspace_replica_tombstone_names_deleted_asset$;

    CREATE TRIGGER workspace_replica_tombstones_name_deleted_asset
      BEFORE INSERT OR UPDATE ON workspace_replica_tombstones
      FOR EACH ROW WHEN (NEW.entity_type = 'domain_asset')
      EXECUTE FUNCTION workspace_replica_tombstone_names_deleted_asset();
${legacyAcceptedDeleteRepairSql}  `,
};
