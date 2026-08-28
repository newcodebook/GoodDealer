import type { CloudMigration } from "../../../../db/index";

export const workspaceRevisionsMigration: CloudMigration = {
  id: "202608200001-workspace-revisions",
  owner: "workspace/revisions",
  sql: `
    CREATE TABLE workspace_revisions (
      account_id text NOT NULL CHECK (account_id ~ '^[!-~]{1,160}$'),
      workspace_id text NOT NULL CHECK (workspace_id ~ '^[!-~]{1,160}$'),
      workspace_schema_version bigint NOT NULL CHECK (workspace_schema_version BETWEEN 1 AND 9007199254740991),
      server_revision bigint NOT NULL DEFAULT 0 CHECK (server_revision BETWEEN 0 AND 9007199254740991),
      compacted_through_server_revision bigint NOT NULL DEFAULT 0 CHECK (
        compacted_through_server_revision BETWEEN 0 AND 9007199254740991
        AND compacted_through_server_revision <= server_revision
      ),
      last_replication_activity_at timestamptz,
      last_successful_provider_observation_at timestamptz,
      PRIMARY KEY (account_id, workspace_id)
    );

    CREATE FUNCTION workspace_revisions_reject_invalid_insert()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF NEW.server_revision != 0 OR NEW.compacted_through_server_revision != 0
        OR NEW.last_replication_activity_at IS NOT NULL OR NEW.last_successful_provider_observation_at IS NOT NULL THEN
        RAISE EXCEPTION 'workspace revision binding must start at revision zero';
      END IF;
      RETURN NEW;
    END;
    $$;
    CREATE TRIGGER workspace_revisions_initial_state_guard
      BEFORE INSERT ON workspace_revisions
      FOR EACH ROW EXECUTE FUNCTION workspace_revisions_reject_invalid_insert();

    CREATE FUNCTION workspace_revisions_reject_identity_change()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF NEW.account_id IS DISTINCT FROM OLD.account_id
        OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
        OR NEW.workspace_schema_version IS DISTINCT FROM OLD.workspace_schema_version THEN
        RAISE EXCEPTION 'workspace revision binding is immutable';
      END IF;
      IF NEW.server_revision < OLD.server_revision THEN
        RAISE EXCEPTION 'workspace revision cannot regress';
      END IF;
      IF NEW.compacted_through_server_revision < OLD.compacted_through_server_revision THEN
        RAISE EXCEPTION 'workspace compaction watermark cannot regress';
      END IF;
      RETURN NEW;
    END;
    $$;
    CREATE TRIGGER workspace_revisions_identity_guard
      BEFORE UPDATE ON workspace_revisions
      FOR EACH ROW EXECUTE FUNCTION workspace_revisions_reject_identity_change();

    ALTER TABLE workspace_revisions ENABLE ROW LEVEL SECURITY;
    ALTER TABLE workspace_revisions FORCE ROW LEVEL SECURITY;
    CREATE POLICY workspace_revisions_tenant_policy ON workspace_revisions
      USING (
        CURRENT_USER = 'gooddealer_cloud_owner'
        OR (account_id = current_setting('gooddealer.account_id', true)
          AND workspace_id = current_setting('gooddealer.workspace_id', true))
      )
      WITH CHECK (
        CURRENT_USER = 'gooddealer_cloud_owner'
        OR (account_id = current_setting('gooddealer.account_id', true)
          AND workspace_id = current_setting('gooddealer.workspace_id', true))
      );
    GRANT SELECT ON workspace_revisions TO gooddealer_cloud_app;
    GRANT INSERT (account_id, workspace_id, workspace_schema_version)
      ON workspace_revisions TO gooddealer_cloud_app;
    GRANT UPDATE (
      workspace_schema_version, server_revision,
      last_replication_activity_at, last_successful_provider_observation_at
    )
      ON workspace_revisions TO gooddealer_cloud_app;
  `,
};
