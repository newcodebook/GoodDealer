import type { CloudMigration } from "../../../db/index";

export const restoreCandidateFoundationMigration: CloudMigration = {
  id: "202608200011-restore-candidate-foundation",
  owner: "recovery",
  sql: `
    CREATE TABLE restore_candidate_requests (
      account_id text NOT NULL,
      workspace_id text NOT NULL,
      candidate_request_id text NOT NULL CHECK (candidate_request_id ~ '^[!-~]{1,160}$'),
      recovery_workflow_id text NOT NULL CHECK (recovery_workflow_id ~ '^[!-~]{1,160}$'),
      source_device_id text NOT NULL CHECK (source_device_id ~ '^[!-~]{1,160}$'),
      active_lease_epoch bigint NOT NULL CHECK (active_lease_epoch BETWEEN 1 AND 9007199254740991),
      backup_id text NOT NULL CHECK (backup_id ~ '^[!-~]{1,160}$'),
      manifest_digest text NOT NULL CHECK (manifest_digest ~ '^[A-Za-z0-9_-]{43}$'),
      baseline_server_revision bigint NOT NULL CHECK (baseline_server_revision BETWEEN 0 AND 9007199254740991),
      comparison_server_revision bigint NOT NULL CHECK (comparison_server_revision BETWEEN 0 AND 9007199254740991),
      diff_digest text NOT NULL CHECK (diff_digest ~ '^[A-Za-z0-9_-]{43}$'),
      request_digest text NOT NULL CHECK (request_digest ~ '^[A-Za-z0-9_-]{43}$'),
      receipt_digest text NOT NULL CHECK (receipt_digest ~ '^[A-Za-z0-9_-]{43}$'),
      created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
      expires_at timestamptz NOT NULL,
      PRIMARY KEY (account_id, workspace_id, candidate_request_id),
      UNIQUE (account_id, workspace_id, recovery_workflow_id),
      UNIQUE (account_id, workspace_id, backup_id),
      FOREIGN KEY (account_id, workspace_id)
        REFERENCES workspace_revisions (account_id, workspace_id) ON DELETE CASCADE,
      CHECK (comparison_server_revision = baseline_server_revision),
      CHECK (expires_at > created_at)
    );

    CREATE TABLE restore_candidate_pages (
      account_id text NOT NULL,
      workspace_id text NOT NULL,
      candidate_request_id text NOT NULL,
      page_id text NOT NULL CHECK (page_id ~ '^[!-~]{1,160}$'),
      page_ordinal bigint NOT NULL CHECK (page_ordinal BETWEEN 0 AND 3999999),
      range_start text CHECK (
        range_start IS NULL OR (
          octet_length(range_start) BETWEEN 3 AND 253
          AND range_start ~ '^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'
        )
      ),
      range_end text CHECK (
        range_end IS NULL OR (
          octet_length(range_end) BETWEEN 3 AND 253
          AND range_end ~ '^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'
        )
      ),
      entry_count integer NOT NULL CHECK (entry_count BETWEEN 0 AND 1024),
      encoded_bytes integer NOT NULL CHECK (encoded_bytes BETWEEN 0 AND 4194304),
      page_digest text NOT NULL CHECK (page_digest ~ '^[A-Za-z0-9_-]{43}$'),
      next_cursor text CHECK (next_cursor IS NULL OR next_cursor ~ '^[!-~]{1,160}$'),
      created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
      PRIMARY KEY (account_id, workspace_id, candidate_request_id, page_id),
      UNIQUE (account_id, workspace_id, candidate_request_id, page_ordinal),
      FOREIGN KEY (account_id, workspace_id, candidate_request_id)
        REFERENCES restore_candidate_requests (
          account_id, workspace_id, candidate_request_id
        ) ON DELETE CASCADE,
      CHECK ((entry_count = 0) = (range_start IS NULL AND range_end IS NULL)),
      CHECK (range_start IS NULL OR range_start COLLATE "C" <= range_end COLLATE "C")
    );

    CREATE TABLE restore_candidates (
      account_id text NOT NULL,
      workspace_id text NOT NULL,
      candidate_id text NOT NULL CHECK (candidate_id ~ '^[!-~]{1,160}$'),
      candidate_request_id text NOT NULL,
      candidate_page_id text,
      recovery_workflow_id text NOT NULL,
      backup_id text NOT NULL,
      manifest_digest text NOT NULL CHECK (manifest_digest ~ '^[A-Za-z0-9_-]{43}$'),
      comparison_server_revision bigint NOT NULL CHECK (comparison_server_revision BETWEEN 0 AND 9007199254740991),
      entity_id text NOT NULL CHECK (
        octet_length(entity_id) BETWEEN 3 AND 253
        AND entity_id ~ '^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'
      ),
      field_path text NOT NULL CHECK (field_path IN ('note', 'portfolioId', 'tags', 'targetPrice')),
      backup_value jsonb NOT NULL CHECK (
        octet_length(backup_value::text) <= 1048576
        AND (
          (field_path = 'note' AND jsonb_typeof(backup_value) IN ('null', 'string'))
          OR (field_path = 'portfolioId' AND jsonb_typeof(backup_value) IN ('null', 'string'))
          OR (field_path = 'tags' AND jsonb_typeof(backup_value) = 'array'
              AND jsonb_array_length(backup_value) <= 128)
          OR (field_path = 'targetPrice' AND jsonb_typeof(backup_value) IN ('null', 'object'))
        )
      ),
      backup_value_hash text NOT NULL CHECK (backup_value_hash ~ '^[A-Za-z0-9_-]{43}$'),
      current_value_hash text NOT NULL CHECK (current_value_hash ~ '^[A-Za-z0-9_-]{43}$'),
      status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'rebase_required', 'discarded', 'expired', 'applied')),
      row_version bigint NOT NULL DEFAULT 1 CHECK (row_version BETWEEN 1 AND 9007199254740991),
      created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
      updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
      expires_at timestamptz NOT NULL,
      PRIMARY KEY (account_id, workspace_id, candidate_id),
      UNIQUE (account_id, workspace_id, candidate_request_id, entity_id, field_path),
      FOREIGN KEY (account_id, workspace_id, candidate_request_id)
        REFERENCES restore_candidate_requests (account_id, workspace_id, candidate_request_id) ON DELETE CASCADE,
      FOREIGN KEY (account_id, workspace_id, candidate_request_id, candidate_page_id)
        REFERENCES restore_candidate_pages (
          account_id, workspace_id, candidate_request_id, page_id
        ) ON DELETE RESTRICT,
      CHECK (expires_at > created_at)
    );

    CREATE INDEX restore_candidates_unresolved_watermark
      ON restore_candidates (
        account_id, workspace_id, comparison_server_revision, expires_at, candidate_id
      )
      WHERE status IN ('open', 'rebase_required');
    CREATE INDEX restore_candidate_requests_expiry_keyset
      ON restore_candidate_requests (account_id, workspace_id, expires_at, candidate_request_id);
    CREATE INDEX restore_candidate_pages_keyset
      ON restore_candidate_pages (
        account_id, workspace_id, candidate_request_id, page_ordinal, page_id
      );
    CREATE INDEX restore_candidates_lifecycle_keyset
      ON restore_candidates (account_id, workspace_id, status, expires_at, candidate_id);

    CREATE FUNCTION restore_candidates_enforce_lifecycle_cas()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF NEW.row_version != OLD.row_version + 1 OR NEW.updated_at < OLD.updated_at THEN
        RAISE EXCEPTION 'restore candidate lifecycle requires the next row version';
      END IF;
      IF NOT (
        (OLD.status = 'open' AND NEW.status IN ('rebase_required', 'discarded', 'expired'))
        OR (OLD.status = 'rebase_required' AND NEW.status IN ('rebase_required', 'discarded', 'expired'))
      ) THEN
        RAISE EXCEPTION 'restore candidate lifecycle transition is invalid';
      END IF;
      RETURN NEW;
    END;
    $$;
    CREATE TRIGGER restore_candidates_lifecycle_cas_guard
      BEFORE UPDATE ON restore_candidates
      FOR EACH ROW EXECUTE FUNCTION restore_candidates_enforce_lifecycle_cas();

    ALTER TABLE restore_candidate_requests ENABLE ROW LEVEL SECURITY;
    ALTER TABLE restore_candidate_requests FORCE ROW LEVEL SECURITY;
    CREATE POLICY restore_candidate_requests_tenant ON restore_candidate_requests
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

    ALTER TABLE restore_candidates ENABLE ROW LEVEL SECURITY;
    ALTER TABLE restore_candidates FORCE ROW LEVEL SECURITY;
    CREATE POLICY restore_candidates_tenant ON restore_candidates
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

    ALTER TABLE restore_candidate_pages ENABLE ROW LEVEL SECURITY;
    ALTER TABLE restore_candidate_pages FORCE ROW LEVEL SECURITY;
    CREATE POLICY restore_candidate_pages_tenant ON restore_candidate_pages
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

    GRANT SELECT, INSERT ON restore_candidate_requests TO gooddealer_cloud_app;
    GRANT SELECT ON restore_candidate_pages TO gooddealer_cloud_app;
    GRANT SELECT, INSERT ON restore_candidates TO gooddealer_cloud_app;
    GRANT UPDATE (status, row_version, updated_at) ON restore_candidates TO gooddealer_cloud_app;
  `,
};
