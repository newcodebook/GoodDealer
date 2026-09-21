import type { CloudMigration } from "../../../../db/index";

/** Global per-device sequence authority and durable pull delivery state for sync wire v2. */
export const syncV2LedgerMigration: CloudMigration = {
  id: "202609140001-sync-v2-ledger",
  owner: "workspace/mutations",
  sql: `
    CREATE TABLE workspace_device_mutation_sequence_ledger (
      account_id text NOT NULL,
      workspace_id text NOT NULL,
      source_device_id text NOT NULL CHECK (source_device_id ~ '^[!-~]{1,160}$'),
      device_mutation_sequence bigint NOT NULL
        CHECK (device_mutation_sequence BETWEEN 1 AND 9007199254740991),
      mutation_id text NOT NULL CHECK (mutation_id ~ '^[!-~]{1,160}$'),
      active_lease_epoch bigint NOT NULL CHECK (active_lease_epoch BETWEEN 1 AND 9007199254740991),
      wire_schema_version smallint NOT NULL CHECK (wire_schema_version IN (1, 2)),
      wire_mutation_digest bytea NOT NULL CHECK (octet_length(wire_mutation_digest) = 32),
      server_revision bigint NOT NULL CHECK (server_revision BETWEEN 1 AND 9007199254740991),
      accepted_at timestamptz NOT NULL,
      PRIMARY KEY (account_id, workspace_id, source_device_id, device_mutation_sequence),
      UNIQUE (account_id, workspace_id, mutation_id),
      UNIQUE (account_id, workspace_id, server_revision),
      FOREIGN KEY (account_id, workspace_id, mutation_id, server_revision)
        REFERENCES workspace_mutation_receipts (account_id, workspace_id, mutation_id, server_revision)
        ON DELETE RESTRICT
    );

    CREATE TABLE workspace_device_mutation_heads (
      account_id text NOT NULL,
      workspace_id text NOT NULL,
      source_device_id text NOT NULL CHECK (source_device_id ~ '^[!-~]{1,160}$'),
      contiguous_received_through bigint NOT NULL
        CHECK (contiguous_received_through BETWEEN 0 AND 9007199254740991),
      highest_received_sequence bigint NOT NULL
        CHECK (highest_received_sequence BETWEEN contiguous_received_through AND 9007199254740991),
      row_version bigint NOT NULL CHECK (row_version BETWEEN 1 AND 9007199254740991),
      updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
      PRIMARY KEY (account_id, workspace_id, source_device_id),
      FOREIGN KEY (account_id, workspace_id)
        REFERENCES workspace_revisions (account_id, workspace_id) ON DELETE CASCADE
    );

    /* A conflicting epoch-scoped history has no safe winner. Raise before either backfill writes. */
    DO $backfill$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM workspace_mutation_receipts
        GROUP BY account_id, workspace_id, source_device_id, device_mutation_sequence
        HAVING count(*) > 1
          AND (count(DISTINCT active_lease_epoch) > 1
            OR count(DISTINCT mutation_id) > 1
            OR count(DISTINCT encode(submitted_envelope_digest, 'hex')) > 1
            OR count(DISTINCT server_revision) > 1)
      ) THEN
        RAISE EXCEPTION 'conflicting global device mutation history' USING ERRCODE = '23505';
      END IF;
    END;
    $backfill$;

    INSERT INTO workspace_device_mutation_sequence_ledger (
      account_id, workspace_id, source_device_id, device_mutation_sequence,
      mutation_id, active_lease_epoch, wire_schema_version, wire_mutation_digest,
      server_revision, accepted_at
    )
    SELECT account_id, workspace_id, source_device_id, device_mutation_sequence,
      mutation_id, active_lease_epoch, 1, submitted_envelope_digest,
      server_revision, accepted_at
    FROM workspace_mutation_receipts;

    WITH numbered_sequences AS (
      SELECT account_id, workspace_id, source_device_id, device_mutation_sequence,
        row_number() OVER (
          PARTITION BY account_id, workspace_id, source_device_id
          ORDER BY device_mutation_sequence
        ) AS expected_sequence
      FROM workspace_device_mutation_sequence_ledger
    )
    INSERT INTO workspace_device_mutation_heads (
      account_id, workspace_id, source_device_id,
      contiguous_received_through, highest_received_sequence, row_version
    )
    SELECT account_id, workspace_id, source_device_id,
      COALESCE(
        min(expected_sequence - 1) FILTER (
          WHERE device_mutation_sequence <> expected_sequence
        ),
        max(device_mutation_sequence)
      ),
      max(device_mutation_sequence), 1
    FROM numbered_sequences
    GROUP BY account_id, workspace_id, source_device_id;

    CREATE TABLE workspace_reader_pending_deliveries (
      account_id text NOT NULL,
      workspace_id text NOT NULL,
      device_id text NOT NULL CHECK (device_id ~ '^[!-~]{1,160}$'),
      cursor_generation bigint NOT NULL CHECK (cursor_generation BETWEEN 1 AND 9007199254740991),
      from_server_revision_exclusive bigint NOT NULL
        CHECK (from_server_revision_exclusive BETWEEN 0 AND 9007199254740991),
      through_server_revision_inclusive bigint NOT NULL
        CHECK (through_server_revision_inclusive BETWEEN 0 AND 9007199254740991),
      target_server_revision bigint NOT NULL
        CHECK (target_server_revision BETWEEN through_server_revision_inclusive AND 9007199254740991),
      page_limit smallint NOT NULL CHECK (page_limit BETWEEN 1 AND 256),
      page_digest bytea NOT NULL CHECK (octet_length(page_digest) = 32),
      next_cursor_digest bytea CHECK (next_cursor_digest IS NULL OR octet_length(next_cursor_digest) = 32),
      predecessor_confirmation_digest bytea
        CHECK (predecessor_confirmation_digest IS NULL OR octet_length(predecessor_confirmation_digest) = 32),
      confirmation_token_digest bytea NOT NULL CHECK (octet_length(confirmation_token_digest) = 32),
      expires_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
      PRIMARY KEY (account_id, workspace_id, device_id),
      FOREIGN KEY (account_id, workspace_id, device_id)
        REFERENCES workspace_reader_cursors (account_id, workspace_id, device_id)
        ON DELETE CASCADE,
      CHECK (from_server_revision_exclusive <= through_server_revision_inclusive)
    );

    ALTER TABLE workspace_device_mutation_sequence_ledger ENABLE ROW LEVEL SECURITY;
    ALTER TABLE workspace_device_mutation_sequence_ledger FORCE ROW LEVEL SECURITY;
    ALTER TABLE workspace_device_mutation_heads ENABLE ROW LEVEL SECURITY;
    ALTER TABLE workspace_device_mutation_heads FORCE ROW LEVEL SECURITY;
    ALTER TABLE workspace_reader_pending_deliveries ENABLE ROW LEVEL SECURITY;
    ALTER TABLE workspace_reader_pending_deliveries FORCE ROW LEVEL SECURITY;

    CREATE POLICY workspace_device_mutation_sequence_ledger_tenant_scope
      ON workspace_device_mutation_sequence_ledger
      USING (current_user = 'gooddealer_cloud_owner' OR (account_id = current_setting('gooddealer.account_id', true)
        AND workspace_id = current_setting('gooddealer.workspace_id', true)))
      WITH CHECK (current_user = 'gooddealer_cloud_owner' OR (account_id = current_setting('gooddealer.account_id', true)
        AND workspace_id = current_setting('gooddealer.workspace_id', true)));
    CREATE POLICY workspace_device_mutation_heads_tenant_scope
      ON workspace_device_mutation_heads
      USING (current_user = 'gooddealer_cloud_owner' OR (account_id = current_setting('gooddealer.account_id', true)
        AND workspace_id = current_setting('gooddealer.workspace_id', true)))
      WITH CHECK (current_user = 'gooddealer_cloud_owner' OR (account_id = current_setting('gooddealer.account_id', true)
        AND workspace_id = current_setting('gooddealer.workspace_id', true)));
    CREATE POLICY workspace_reader_pending_deliveries_tenant_scope
      ON workspace_reader_pending_deliveries
      USING (current_user = 'gooddealer_cloud_owner' OR (account_id = current_setting('gooddealer.account_id', true)
        AND workspace_id = current_setting('gooddealer.workspace_id', true)))
      WITH CHECK (current_user = 'gooddealer_cloud_owner' OR (account_id = current_setting('gooddealer.account_id', true)
        AND workspace_id = current_setting('gooddealer.workspace_id', true)));

    ALTER TABLE workspace_device_mutation_sequence_ledger OWNER TO gooddealer_cloud_owner;
    ALTER TABLE workspace_device_mutation_heads OWNER TO gooddealer_cloud_owner;
    ALTER TABLE workspace_reader_pending_deliveries OWNER TO gooddealer_cloud_owner;
    REVOKE ALL ON TABLE workspace_device_mutation_sequence_ledger,
      workspace_device_mutation_heads, workspace_reader_pending_deliveries
      FROM PUBLIC, gooddealer_cloud_app;
    GRANT SELECT, INSERT ON TABLE workspace_device_mutation_sequence_ledger TO gooddealer_cloud_app;
    GRANT SELECT, INSERT, UPDATE ON TABLE workspace_device_mutation_heads TO gooddealer_cloud_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE workspace_reader_pending_deliveries TO gooddealer_cloud_app;

    CREATE FUNCTION workspace_sync_v2_reject_immutable_ledger()
    RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = pg_catalog
    AS $function$
    BEGIN
      RAISE EXCEPTION 'sync sequence ledger is immutable' USING ERRCODE = '55000';
    END;
    $function$;
    REVOKE ALL ON FUNCTION workspace_sync_v2_reject_immutable_ledger() FROM PUBLIC, gooddealer_cloud_app;
    CREATE TRIGGER workspace_device_mutation_sequence_ledger_immutable
      BEFORE UPDATE OR DELETE ON workspace_device_mutation_sequence_ledger
      FOR EACH ROW EXECUTE FUNCTION workspace_sync_v2_reject_immutable_ledger();
  `,
};
