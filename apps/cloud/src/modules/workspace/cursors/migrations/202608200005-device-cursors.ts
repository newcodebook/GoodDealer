import type { CloudMigration } from "../../../../db/index";

export const deviceCursorsMigration: CloudMigration = {
  id: "202608200005-device-cursors",
  owner: "workspace/cursors",
  sql: `
    CREATE TABLE workspace_device_cursors (
      account_id text NOT NULL,
      workspace_id text NOT NULL,
      device_id text NOT NULL,
      acknowledged_through_server_revision bigint NOT NULL CHECK (acknowledged_through_server_revision BETWEEN 0 AND 9007199254740991),
      status text NOT NULL CHECK (status IN ('active', 'retired')),
      retirement_reason text CHECK (retirement_reason IN ('replaced', 'device_removed')),
      activated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
      retired_at timestamptz,
      PRIMARY KEY (account_id, workspace_id, device_id),
      CHECK ((status = 'active' AND retired_at IS NULL AND retirement_reason IS NULL)
        OR (status = 'retired' AND retired_at IS NOT NULL AND retirement_reason IS NOT NULL))
    );
    ALTER TABLE workspace_device_cursors ENABLE ROW LEVEL SECURITY;
    ALTER TABLE workspace_device_cursors FORCE ROW LEVEL SECURITY;
    CREATE POLICY workspace_device_cursors_tenant_scope ON workspace_device_cursors
      USING (CURRENT_USER = 'gooddealer_cloud_owner' OR (account_id = current_setting('gooddealer.account_id', true)
        AND workspace_id = current_setting('gooddealer.workspace_id', true)))
      WITH CHECK (CURRENT_USER = 'gooddealer_cloud_owner' OR (account_id = current_setting('gooddealer.account_id', true)
        AND workspace_id = current_setting('gooddealer.workspace_id', true)));
    GRANT SELECT, INSERT, UPDATE ON workspace_device_cursors TO gooddealer_cloud_app;

    ALTER TABLE workspace_device_cursors
      DROP CONSTRAINT workspace_device_cursors_retirement_reason_check;
    ALTER TABLE workspace_device_cursors
      ADD CONSTRAINT workspace_device_cursors_retirement_reason_check
      CHECK (retirement_reason IN ('replaced', 'device_removed', 'workspace_left'));
    ALTER TABLE workspace_device_cursors
      ADD CONSTRAINT workspace_device_cursors_workspace_fk
      FOREIGN KEY (account_id, workspace_id)
      REFERENCES workspace_revisions (account_id, workspace_id);
    CREATE UNIQUE INDEX workspace_device_cursors_one_active_per_workspace
      ON workspace_device_cursors (account_id, workspace_id)
      WHERE status = 'active';

    CREATE TABLE workspace_reader_cursors (
      account_id text NOT NULL CHECK (account_id ~ '^[!-~]{1,160}$'),
      workspace_id text NOT NULL CHECK (workspace_id ~ '^[!-~]{1,160}$'),
      device_id text NOT NULL CHECK (device_id ~ '^[!-~]{1,160}$'),
      cursor_generation bigint NOT NULL CHECK (cursor_generation BETWEEN 1 AND 9007199254740991),
      row_version bigint NOT NULL CHECK (row_version BETWEEN 1 AND 9007199254740991),
      read_through_server_revision bigint NOT NULL CHECK (read_through_server_revision BETWEEN 0 AND 9007199254740991),
      lease_expires_at timestamptz NOT NULL,
      status text NOT NULL CHECK (status IN ('active', 'retired')),
      resume_requirement text NOT NULL CHECK (resume_requirement IN ('none', 'rebootstrap_required')),
      retired_at timestamptz,
      retirement_reason text CHECK (retirement_reason IN ('ttl_expired', 'compaction_race', 'device_removed')),
      pinned_page_target_server_revision bigint CHECK (pinned_page_target_server_revision BETWEEN 0 AND 9007199254740991),
      next_server_revision bigint CHECK (next_server_revision BETWEEN 1 AND 9007199254740991),
      continuation_token_digest bytea CHECK (
        continuation_token_digest IS NULL OR octet_length(continuation_token_digest) = 32
      ),
      PRIMARY KEY (account_id, workspace_id, device_id),
      FOREIGN KEY (account_id, workspace_id)
        REFERENCES workspace_revisions (account_id, workspace_id),
      CHECK (
        (status = 'active' AND resume_requirement = 'none'
          AND retired_at IS NULL AND retirement_reason IS NULL)
        OR
        (status = 'retired' AND retired_at IS NOT NULL
          AND retirement_reason IN ('ttl_expired', 'compaction_race')
          AND resume_requirement = 'rebootstrap_required')
        OR
        (status = 'retired' AND retired_at IS NOT NULL
          AND retirement_reason = 'device_removed'
          AND resume_requirement = 'none')
      ),
      CHECK (
        (pinned_page_target_server_revision IS NULL AND next_server_revision IS NULL AND continuation_token_digest IS NULL)
        OR
        (status = 'active' AND pinned_page_target_server_revision IS NOT NULL
          AND next_server_revision IS NOT NULL AND continuation_token_digest IS NOT NULL
          AND next_server_revision > read_through_server_revision
          AND next_server_revision <= pinned_page_target_server_revision)
      )
    );

    ALTER TABLE workspace_reader_cursors ENABLE ROW LEVEL SECURITY;
    ALTER TABLE workspace_reader_cursors FORCE ROW LEVEL SECURITY;
    CREATE POLICY workspace_reader_cursors_tenant_scope ON workspace_reader_cursors
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
    GRANT SELECT, INSERT, UPDATE ON workspace_reader_cursors TO gooddealer_cloud_app;

    ALTER TABLE workspace_device_cursors
      ADD COLUMN cursor_generation bigint NOT NULL DEFAULT 1
        CHECK (cursor_generation BETWEEN 1 AND 9007199254740991);
    ALTER TABLE workspace_device_cursors DROP CONSTRAINT workspace_device_cursors_pkey;
    ALTER TABLE workspace_device_cursors
      ADD PRIMARY KEY (account_id, workspace_id, device_id, cursor_generation);
    ALTER TABLE workspace_device_cursors ALTER COLUMN cursor_generation DROP DEFAULT;
    CREATE UNIQUE INDEX workspace_device_cursors_one_active_per_device
      ON workspace_device_cursors (account_id, workspace_id, device_id)
      WHERE status = 'active';
  `,
};
