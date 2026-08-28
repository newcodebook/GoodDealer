import type { CloudMigration } from "../../../../db/index";

export const workspaceCheckpointsMigration: CloudMigration = {
  id: "202608200010-workspace-checkpoints",
  owner: "workspace/checkpoints",
  sql: `
    CREATE TABLE workspace_checkpoints (
      account_id text NOT NULL,
      workspace_id text NOT NULL,
      checkpoint_id text NOT NULL CHECK (checkpoint_id ~ '^[!-~]{1,160}$'),
      schema_version integer NOT NULL CHECK (schema_version = 1),
      workspace_schema_version bigint NOT NULL CHECK (workspace_schema_version BETWEEN 1 AND 9007199254740991),
      through_server_revision bigint NOT NULL CHECK (through_server_revision BETWEEN 0 AND 9007199254740991),
      checkpoint_digest bytea NOT NULL CHECK (octet_length(checkpoint_digest) = 32),
      capture_codec text NOT NULL CHECK (capture_codec = 'domain-asset-projection-v1'),
      capture_schema_version integer NOT NULL CHECK (capture_schema_version = 1),
      status text NOT NULL CHECK (status IN ('building', 'verified', 'available', 'superseded', 'invalid')),
      row_version bigint NOT NULL DEFAULT 1 CHECK (row_version BETWEEN 1 AND 9007199254740991),
      built_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
      verified_at timestamptz,
      published_at timestamptz,
      superseded_at timestamptz,
      invalidated_at timestamptz,
      PRIMARY KEY (account_id, workspace_id, checkpoint_id),
      UNIQUE (account_id, workspace_id, checkpoint_id, through_server_revision, checkpoint_digest),
      FOREIGN KEY (account_id, workspace_id)
        REFERENCES workspace_revisions (account_id, workspace_id) ON DELETE CASCADE,
      CHECK (
        (status = 'building' AND verified_at IS NULL AND published_at IS NULL AND superseded_at IS NULL AND invalidated_at IS NULL)
        OR (status = 'verified' AND verified_at IS NOT NULL AND published_at IS NULL AND superseded_at IS NULL AND invalidated_at IS NULL)
        OR (status = 'available' AND verified_at IS NOT NULL AND published_at IS NOT NULL AND superseded_at IS NULL AND invalidated_at IS NULL)
        OR (status = 'superseded' AND verified_at IS NOT NULL AND published_at IS NOT NULL AND superseded_at IS NOT NULL AND invalidated_at IS NULL)
        OR (status = 'invalid' AND published_at IS NULL AND superseded_at IS NULL AND invalidated_at IS NOT NULL)
      )
    );

    CREATE TABLE workspace_checkpoint_entity_digests (
      account_id text NOT NULL,
      workspace_id text NOT NULL,
      checkpoint_id text NOT NULL,
      ordinal integer NOT NULL CHECK (ordinal BETWEEN 0 AND 4095),
      entity_type text NOT NULL CHECK (entity_type = 'domain_asset'),
      partition_key text NOT NULL CHECK (partition_key ~ '^(p[0-9]{4}|empty)$'),
      partition_id text NOT NULL CHECK (partition_id ~ '^(p[0-9]{4}|empty)$'),
      digest bytea NOT NULL CHECK (octet_length(digest) = 32),
      PRIMARY KEY (account_id, workspace_id, checkpoint_id, ordinal),
      UNIQUE (account_id, workspace_id, checkpoint_id, entity_type, partition_key),
      UNIQUE (account_id, workspace_id, checkpoint_id, partition_id),
      FOREIGN KEY (account_id, workspace_id, checkpoint_id)
        REFERENCES workspace_checkpoints (account_id, workspace_id, checkpoint_id) ON DELETE CASCADE,
      CHECK (partition_id = partition_key)
    );

    CREATE FUNCTION workspace_checkpoint_tags_are_canonical(value text[])
    RETURNS boolean
    LANGUAGE sql
    IMMUTABLE
    STRICT
    AS $$
      SELECT cardinality(value) <= 128 AND COALESCE(bool_and(
        octet_length(tag) BETWEEN 1 AND 64
        AND tag = btrim(tag)
        AND tag !~ '[[:cntrl:]]'
        AND (previous_tag IS NULL OR convert_to(tag, 'UTF8') > previous_tag)
      ), true)
      FROM (
        SELECT tag, lag(convert_to(tag, 'UTF8')) OVER (ORDER BY ordinal) AS previous_tag
        FROM unnest(value) WITH ORDINALITY AS item(tag, ordinal)
      ) AS ordered_tags;
    $$;

    CREATE TABLE workspace_checkpoint_domain_assets (
      account_id text NOT NULL,
      workspace_id text NOT NULL,
      checkpoint_id text NOT NULL,
      entity_id text NOT NULL CHECK (
        octet_length(entity_id) BETWEEN 3 AND 253
        AND entity_id ~ '^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'
      ),
      partition_id text NOT NULL CHECK (partition_id ~ '^p[0-9]{4}$'),
      note text CHECK (note IS NULL OR octet_length(note) <= 40000),
      portfolio_id text CHECK (portfolio_id IS NULL OR portfolio_id ~ '^[!-~]{1,160}$'),
      tags text[] NOT NULL CHECK (workspace_checkpoint_tags_are_canonical(tags)),
      target_price_currency text CHECK (target_price_currency IS NULL OR target_price_currency ~ '^[A-Z]{3}$'),
      target_price_amount text CHECK (
        target_price_amount IS NULL OR target_price_amount ~ '^(0|[1-9][0-9]{0,15})(\\.[0-9]{0,7}[1-9])?$'
      ),
      PRIMARY KEY (account_id, workspace_id, checkpoint_id, entity_id),
      FOREIGN KEY (account_id, workspace_id, checkpoint_id)
        REFERENCES workspace_checkpoints (account_id, workspace_id, checkpoint_id) ON DELETE CASCADE,
      FOREIGN KEY (account_id, workspace_id, checkpoint_id, partition_id)
        REFERENCES workspace_checkpoint_entity_digests (
          account_id, workspace_id, checkpoint_id, partition_id
        ) ON DELETE RESTRICT,
      CHECK ((target_price_currency IS NULL) = (target_price_amount IS NULL))
    );

    CREATE TABLE workspace_checkpoint_pins (
      account_id text NOT NULL,
      workspace_id text NOT NULL,
      checkpoint_id text NOT NULL,
      consumer_kind text NOT NULL CHECK (consumer_kind IN ('bootstrap', 'recovery')),
      consumer_id text NOT NULL CHECK (consumer_id ~ '^[!-~]{1,160}$'),
      expected_through_server_revision bigint NOT NULL CHECK (expected_through_server_revision BETWEEN 0 AND 9007199254740991),
      expected_checkpoint_digest bytea NOT NULL CHECK (octet_length(expected_checkpoint_digest) = 32),
      expires_at timestamptz NOT NULL,
      released_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
      PRIMARY KEY (account_id, workspace_id, checkpoint_id, consumer_kind, consumer_id),
      FOREIGN KEY (
        account_id, workspace_id, checkpoint_id, expected_through_server_revision, expected_checkpoint_digest
      ) REFERENCES workspace_checkpoints (
        account_id, workspace_id, checkpoint_id, through_server_revision, checkpoint_digest
      ) ON DELETE CASCADE,
      CHECK (expires_at > created_at),
      CHECK (released_at IS NULL OR released_at >= created_at)
    );

    CREATE UNIQUE INDEX workspace_checkpoint_one_active_consumer
      ON workspace_checkpoint_pins (account_id, workspace_id, consumer_kind, consumer_id)
      WHERE released_at IS NULL;
    CREATE INDEX workspace_checkpoints_available_revision_keyset
      ON workspace_checkpoints (account_id, workspace_id, through_server_revision DESC, checkpoint_id)
      WHERE status = 'available';
    CREATE INDEX workspace_checkpoint_pins_expiry_keyset
      ON workspace_checkpoint_pins (account_id, workspace_id, expires_at, checkpoint_id, consumer_kind, consumer_id)
      WHERE released_at IS NULL;
    CREATE INDEX workspace_checkpoint_pins_revision_floor
      ON workspace_checkpoint_pins (
        account_id, workspace_id, expected_through_server_revision, expires_at,
        checkpoint_id, consumer_kind, consumer_id
      ) WHERE released_at IS NULL;

    CREATE TABLE workspace_checkpoint_diagnostics (
      account_id text NOT NULL,
      workspace_id text NOT NULL,
      checkpoint_id text NOT NULL,
      diagnostic_code text NOT NULL CHECK (diagnostic_code IN ('checkpoint_digest_mismatch', 'checkpoint_storage_malformed')),
      observed_digest bytea CHECK (observed_digest IS NULL OR octet_length(observed_digest) = 32),
      recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
      PRIMARY KEY (account_id, workspace_id, checkpoint_id, diagnostic_code),
      FOREIGN KEY (account_id, workspace_id, checkpoint_id)
        REFERENCES workspace_checkpoints (account_id, workspace_id, checkpoint_id) ON DELETE CASCADE
    );

    CREATE FUNCTION workspace_checkpoints_enforce_lifecycle_cas()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF NEW.row_version != OLD.row_version + 1 THEN
        RAISE EXCEPTION 'checkpoint lifecycle requires the next row version';
      END IF;
      IF NOT (
        (OLD.status = 'building' AND NEW.status IN ('verified', 'invalid'))
        OR (OLD.status = 'verified' AND NEW.status IN ('available', 'invalid'))
        OR (OLD.status = 'available' AND NEW.status = 'superseded')
      ) THEN
        RAISE EXCEPTION 'checkpoint lifecycle transition is invalid';
      END IF;
      RETURN NEW;
    END;
    $$;
    CREATE TRIGGER workspace_checkpoints_lifecycle_cas_guard
      BEFORE UPDATE ON workspace_checkpoints
      FOR EACH ROW EXECUTE FUNCTION workspace_checkpoints_enforce_lifecycle_cas();

    CREATE FUNCTION workspace_compaction_advance(
      expected_watermark bigint,
      next_watermark bigint
    ) RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $$
    DECLARE
      tenant_account_id text := current_setting('gooddealer.account_id', true);
      tenant_workspace_id text := current_setting('gooddealer.workspace_id', true);
      current_head bigint;
      current_watermark bigint;
      replay_count bigint;
      safe_bound bigint;
    BEGIN
      IF tenant_account_id IS NULL OR tenant_account_id = ''
        OR tenant_workspace_id IS NULL OR tenant_workspace_id = '' THEN
        RAISE EXCEPTION 'workspace compaction requires tenant scope';
      END IF;
      SELECT server_revision, compacted_through_server_revision
      INTO current_head, current_watermark
      FROM public.workspace_revisions
      WHERE account_id = tenant_account_id AND workspace_id = tenant_workspace_id
      FOR UPDATE;
      IF NOT FOUND OR current_watermark != expected_watermark
        OR next_watermark <= current_watermark OR next_watermark > current_head THEN
        RAISE EXCEPTION 'workspace compaction watermark compare-and-set lost';
      END IF;

      SELECT count(*) INTO replay_count
      FROM public.workspace_mutations
      WHERE account_id = tenant_account_id AND workspace_id = tenant_workspace_id
        AND server_revision > current_watermark AND server_revision <= current_head;
      IF replay_count != current_head - current_watermark THEN
        RAISE EXCEPTION 'workspace compaction requires a complete replay chain';
      END IF;

      SELECT max(through_server_revision) INTO safe_bound
      FROM public.workspace_checkpoints
      WHERE account_id = tenant_account_id AND workspace_id = tenant_workspace_id
        AND status = 'available';
      IF safe_bound IS NULL OR next_watermark > safe_bound THEN
        RAISE EXCEPTION 'workspace compaction requires an available checkpoint';
      END IF;

      SELECT min(acknowledged_through_server_revision) INTO safe_bound
      FROM public.workspace_device_cursors
      WHERE account_id = tenant_account_id AND workspace_id = tenant_workspace_id
        AND status = 'active';
      IF safe_bound IS NOT NULL AND next_watermark > safe_bound THEN
        RAISE EXCEPTION 'workspace compaction exceeds an active device cursor';
      END IF;

      SELECT min(read_through_server_revision) INTO safe_bound
      FROM public.workspace_reader_cursors
      WHERE account_id = tenant_account_id AND workspace_id = tenant_workspace_id
        AND status = 'active' AND lease_expires_at > transaction_timestamp();
      IF safe_bound IS NOT NULL AND next_watermark > safe_bound THEN
        RAISE EXCEPTION 'workspace compaction exceeds an active reader cursor';
      END IF;

      SELECT min(expected_through_server_revision) INTO safe_bound
      FROM public.workspace_checkpoint_pins
      WHERE account_id = tenant_account_id AND workspace_id = tenant_workspace_id
        AND released_at IS NULL AND expires_at > transaction_timestamp();
      IF safe_bound IS NOT NULL AND next_watermark > safe_bound THEN
        RAISE EXCEPTION 'workspace compaction exceeds an active checkpoint pin';
      END IF;

      SELECT min(comparison_server_revision) INTO safe_bound
      FROM public.restore_candidates
      WHERE account_id = tenant_account_id AND workspace_id = tenant_workspace_id
        AND status IN ('open', 'rebase_required') AND expires_at > transaction_timestamp();
      IF safe_bound IS NOT NULL AND next_watermark > safe_bound THEN
        RAISE EXCEPTION 'workspace compaction exceeds an unresolved recovery comparison';
      END IF;

      UPDATE public.workspace_revisions
      SET compacted_through_server_revision = next_watermark
      WHERE account_id = tenant_account_id AND workspace_id = tenant_workspace_id
        AND compacted_through_server_revision = expected_watermark;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'workspace compaction watermark compare-and-set lost';
      END IF;
    END;
    $$;

    CREATE FUNCTION workspace_compaction_delete_prefix(
      through_server_revision bigint
    ) RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $$
    DECLARE
      tenant_account_id text := current_setting('gooddealer.account_id', true);
      tenant_workspace_id text := current_setting('gooddealer.workspace_id', true);
      committed_watermark bigint;
      deleted_count bigint;
    BEGIN
      IF tenant_account_id IS NULL OR tenant_account_id = ''
        OR tenant_workspace_id IS NULL OR tenant_workspace_id = '' THEN
        RAISE EXCEPTION 'workspace compaction requires tenant scope';
      END IF;
      SELECT compacted_through_server_revision INTO committed_watermark
      FROM public.workspace_revisions
      WHERE account_id = tenant_account_id AND workspace_id = tenant_workspace_id
      FOR UPDATE;
      IF committed_watermark IS NULL OR through_server_revision > committed_watermark THEN
        RAISE EXCEPTION 'workspace replay deletion exceeds the committed compaction watermark';
      END IF;
      DELETE FROM public.workspace_mutations
      WHERE account_id = tenant_account_id AND workspace_id = tenant_workspace_id
        AND server_revision <= through_server_revision;
      GET DIAGNOSTICS deleted_count = ROW_COUNT;
      RETURN deleted_count;
    END;
    $$;

    REVOKE ALL ON FUNCTION workspace_compaction_advance(bigint, bigint) FROM PUBLIC;
    REVOKE ALL ON FUNCTION workspace_compaction_delete_prefix(bigint) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION workspace_compaction_advance(bigint, bigint) TO gooddealer_cloud_app;
    GRANT EXECUTE ON FUNCTION workspace_compaction_delete_prefix(bigint) TO gooddealer_cloud_app;

    DO $$ DECLARE table_name text; BEGIN
      FOREACH table_name IN ARRAY ARRAY[
        'workspace_checkpoints',
        'workspace_checkpoint_entity_digests',
        'workspace_checkpoint_domain_assets',
        'workspace_checkpoint_pins',
        'workspace_checkpoint_diagnostics'
      ] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
        EXECUTE format(
          'CREATE POLICY %I ON %I USING (CURRENT_USER = ''gooddealer_cloud_owner'' OR (account_id = current_setting(''gooddealer.account_id'', true) AND workspace_id = current_setting(''gooddealer.workspace_id'', true))) WITH CHECK (CURRENT_USER = ''gooddealer_cloud_owner'' OR (account_id = current_setting(''gooddealer.account_id'', true) AND workspace_id = current_setting(''gooddealer.workspace_id'', true)))',
          table_name || '_tenant_scope', table_name
        );
      END LOOP;
    END $$;

    GRANT SELECT, INSERT ON workspace_checkpoints TO gooddealer_cloud_app;
    GRANT UPDATE (status, row_version, verified_at, published_at, superseded_at, invalidated_at)
      ON workspace_checkpoints TO gooddealer_cloud_app;
    GRANT SELECT, INSERT ON workspace_checkpoint_entity_digests, workspace_checkpoint_domain_assets TO gooddealer_cloud_app;
    GRANT SELECT, INSERT ON workspace_checkpoint_pins TO gooddealer_cloud_app;
    GRANT UPDATE (expires_at, released_at) ON workspace_checkpoint_pins TO gooddealer_cloud_app;
    GRANT SELECT, INSERT ON workspace_checkpoint_diagnostics TO gooddealer_cloud_app;
  `,
};
