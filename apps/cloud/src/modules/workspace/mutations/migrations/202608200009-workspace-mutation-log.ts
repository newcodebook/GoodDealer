import type { CloudMigration } from "../../../../db/index";

export const workspaceMutationLogMigration: CloudMigration = {
  id: "202608200009-workspace-mutation-log",
  owner: "workspace/mutations",
  sql: `
    CREATE TABLE workspace_mutation_receipts (
      account_id text NOT NULL,
      workspace_id text NOT NULL,
      mutation_id text NOT NULL CHECK (mutation_id ~ '^[!-~]{1,160}$'),
      source_device_id text NOT NULL CHECK (source_device_id ~ '^[!-~]{1,160}$'),
      active_lease_epoch bigint NOT NULL CHECK (active_lease_epoch BETWEEN 1 AND 9007199254740991),
      device_mutation_sequence bigint NOT NULL CHECK (device_mutation_sequence BETWEEN 1 AND 9007199254740991),
      server_revision bigint NOT NULL CHECK (server_revision BETWEEN 1 AND 9007199254740991),
      submitted_envelope_digest bytea NOT NULL CHECK (octet_length(submitted_envelope_digest) = 32),
      accepted_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
      PRIMARY KEY (account_id, workspace_id, mutation_id),
      UNIQUE (account_id, workspace_id, source_device_id, active_lease_epoch, device_mutation_sequence),
      UNIQUE (account_id, workspace_id, server_revision),
      UNIQUE (account_id, workspace_id, mutation_id, server_revision),
      FOREIGN KEY (account_id, workspace_id)
        REFERENCES workspace_revisions (account_id, workspace_id) ON DELETE CASCADE
    );

    CREATE TABLE workspace_mutations (
      account_id text NOT NULL,
      workspace_id text NOT NULL,
      server_revision bigint NOT NULL CHECK (server_revision BETWEEN 1 AND 9007199254740991),
      mutation_id text NOT NULL CHECK (mutation_id ~ '^[!-~]{1,160}$'),
      workspace_schema_version bigint NOT NULL CHECK (workspace_schema_version BETWEEN 1 AND 9007199254740991),
      entity_type text NOT NULL CHECK (entity_type = 'domain_asset'),
      entity_id text NOT NULL CHECK (
        octet_length(entity_id) BETWEEN 3 AND 253
        AND entity_id ~ '^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'
      ),
      operation_kind text NOT NULL DEFAULT 'upsert' CHECK (operation_kind IN ('upsert', 'delete')),
      deleted_at timestamptz,
      base_server_revision bigint NOT NULL CHECK (
        base_server_revision BETWEEN 0 AND 9007199254740991 AND base_server_revision < server_revision
      ),
      source_device_id text NOT NULL CHECK (source_device_id ~ '^[!-~]{1,160}$'),
      active_lease_epoch bigint NOT NULL CHECK (active_lease_epoch BETWEEN 1 AND 9007199254740991),
      device_mutation_sequence bigint NOT NULL CHECK (device_mutation_sequence BETWEEN 1 AND 9007199254740991),
      canonical_submitted_envelope bytea NOT NULL CHECK (
        octet_length(canonical_submitted_envelope) BETWEEN 1 AND 65536
      ),
      submitted_envelope_digest bytea NOT NULL CHECK (octet_length(submitted_envelope_digest) = 32),
      accepted_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
      PRIMARY KEY (account_id, workspace_id, server_revision),
      UNIQUE (account_id, workspace_id, mutation_id),
      UNIQUE (account_id, workspace_id, source_device_id, active_lease_epoch, device_mutation_sequence),
      FOREIGN KEY (account_id, workspace_id, mutation_id, server_revision)
        REFERENCES workspace_mutation_receipts (account_id, workspace_id, mutation_id, server_revision)
        ON DELETE RESTRICT,
      CHECK (
        (operation_kind = 'upsert' AND deleted_at IS NULL)
        OR (operation_kind = 'delete' AND deleted_at IS NOT NULL)
      )
    );

    CREATE TABLE workspace_mutation_fields (
      account_id text NOT NULL,
      workspace_id text NOT NULL,
      server_revision bigint NOT NULL CHECK (server_revision BETWEEN 1 AND 9007199254740991),
      ordinal smallint NOT NULL CHECK (ordinal BETWEEN 0 AND 3),
      field_path text NOT NULL CHECK (field_path IN ('note', 'portfolioId', 'tags', 'targetPrice')),
      value_is_null boolean NOT NULL,
      text_value text,
      tags_value text[],
      target_price_currency text,
      target_price_amount text,
      PRIMARY KEY (account_id, workspace_id, server_revision, ordinal),
      UNIQUE (account_id, workspace_id, server_revision, field_path),
      FOREIGN KEY (account_id, workspace_id, server_revision)
        REFERENCES workspace_mutations (account_id, workspace_id, server_revision) ON DELETE CASCADE,
      CHECK (
        (field_path = 'note'
          AND tags_value IS NULL AND target_price_currency IS NULL AND target_price_amount IS NULL
          AND ((value_is_null AND text_value IS NULL)
            OR (NOT value_is_null AND text_value IS NOT NULL AND octet_length(text_value) <= 40000)))
        OR
        (field_path = 'portfolioId'
          AND tags_value IS NULL AND target_price_currency IS NULL AND target_price_amount IS NULL
          AND ((value_is_null AND text_value IS NULL)
            OR (NOT value_is_null AND text_value ~ '^[!-~]{1,160}$')))
        OR
        (field_path = 'tags'
          AND NOT value_is_null AND text_value IS NULL
          AND tags_value IS NOT NULL AND cardinality(tags_value) <= 128
          AND target_price_currency IS NULL AND target_price_amount IS NULL)
        OR
        (field_path = 'targetPrice'
          AND text_value IS NULL AND tags_value IS NULL
          AND ((value_is_null AND target_price_currency IS NULL AND target_price_amount IS NULL)
            OR (NOT value_is_null
              AND target_price_currency ~ '^[A-Z]{3}$'
              AND target_price_amount ~ '^(0|[1-9][0-9]{0,15})(\\.[0-9]{0,7}[1-9])?$')))
      )
    );

    CREATE FUNCTION workspace_revisions_require_dense_mutation_prefix()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    DECLARE mutation_count bigint;
    BEGIN
      IF NEW.server_revision = OLD.server_revision THEN
        RETURN NEW;
      END IF;
      IF NEW.server_revision <= OLD.server_revision THEN
        RAISE EXCEPTION 'workspace revision must advance';
      END IF;
      SELECT count(*) INTO mutation_count
      FROM workspace_mutations
      WHERE account_id = OLD.account_id AND workspace_id = OLD.workspace_id
        AND server_revision > OLD.server_revision
        AND server_revision <= NEW.server_revision;
      IF mutation_count != NEW.server_revision - OLD.server_revision THEN
        RAISE EXCEPTION 'workspace revision advance requires a dense mutation prefix';
      END IF;
      RETURN NEW;
    END;
    $$;
    CREATE TRIGGER workspace_revisions_dense_mutation_guard
      BEFORE UPDATE OF server_revision ON workspace_revisions
      FOR EACH ROW EXECUTE FUNCTION workspace_revisions_require_dense_mutation_prefix();

    CREATE FUNCTION workspace_mutations_require_committed_head()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    DECLARE committed_head bigint;
    BEGIN
      SELECT server_revision INTO committed_head
      FROM workspace_revisions
      WHERE account_id = NEW.account_id AND workspace_id = NEW.workspace_id;
      IF committed_head IS NULL OR NEW.server_revision > committed_head THEN
        RAISE EXCEPTION 'workspace mutation cannot remain ahead of the committed head';
      END IF;
      RETURN NULL;
    END;
    $$;
    CREATE CONSTRAINT TRIGGER workspace_mutations_committed_head_guard
      AFTER INSERT ON workspace_mutations
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION workspace_mutations_require_committed_head();

    CREATE FUNCTION workspace_mutation_receipts_require_active_replay_or_compaction()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM workspace_mutations
        WHERE account_id = NEW.account_id AND workspace_id = NEW.workspace_id
          AND mutation_id = NEW.mutation_id AND server_revision = NEW.server_revision
      ) AND NOT EXISTS (
        SELECT 1 FROM workspace_revisions
        WHERE account_id = NEW.account_id AND workspace_id = NEW.workspace_id
          AND compacted_through_server_revision >= NEW.server_revision
      ) THEN
        RAISE EXCEPTION 'workspace mutation receipt requires active replay or committed compaction';
      END IF;
      RETURN NULL;
    END;
    $$;
    CREATE CONSTRAINT TRIGGER workspace_mutation_receipts_replay_guard
      AFTER INSERT ON workspace_mutation_receipts
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION workspace_mutation_receipts_require_active_replay_or_compaction();

    CREATE FUNCTION workspace_mutations_reject_uncompacted_delete()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM workspace_revisions
        WHERE account_id = OLD.account_id AND workspace_id = OLD.workspace_id
          AND compacted_through_server_revision >= OLD.server_revision
      ) THEN
        RAISE EXCEPTION 'active workspace mutations are immutable';
      END IF;
      RETURN OLD;
    END;
    $$;
    CREATE TRIGGER workspace_mutations_compaction_delete_guard
      BEFORE DELETE ON workspace_mutations
      FOR EACH ROW EXECUTE FUNCTION workspace_mutations_reject_uncompacted_delete();

    DO $$
    DECLARE table_name text;
    BEGIN
      FOREACH table_name IN ARRAY ARRAY[
        'workspace_mutation_receipts',
        'workspace_mutations',
        'workspace_mutation_fields'
      ] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
        EXECUTE format(
          'CREATE POLICY %I ON %I USING (CURRENT_USER = ''gooddealer_cloud_owner'' OR (account_id = current_setting(''gooddealer.account_id'', true) AND workspace_id = current_setting(''gooddealer.workspace_id'', true))) WITH CHECK (CURRENT_USER = ''gooddealer_cloud_owner'' OR (account_id = current_setting(''gooddealer.account_id'', true) AND workspace_id = current_setting(''gooddealer.workspace_id'', true)))',
          table_name || '_tenant_scope', table_name
        );
      END LOOP;
    END $$;

    GRANT SELECT, INSERT ON workspace_mutation_receipts TO gooddealer_cloud_app;
    GRANT SELECT, INSERT ON workspace_mutations TO gooddealer_cloud_app;
    GRANT SELECT, INSERT ON workspace_mutation_fields TO gooddealer_cloud_app;
  `,
};
