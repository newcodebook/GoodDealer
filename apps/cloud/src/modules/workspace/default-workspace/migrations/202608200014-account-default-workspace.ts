import type { CloudMigration } from "../../../../db/index";

const immutable = (table: string, columns: readonly string[]) => `
    CREATE OR REPLACE FUNCTION ${table}_immutable_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF ${columns.map((column) => `NEW.${column} IS DISTINCT FROM OLD.${column}`).join(" OR ")} THEN
        RAISE EXCEPTION 'immutable ${table} identity changed' USING ERRCODE = '23000';
      END IF;
      RETURN NEW;
    END; $$;
    CREATE TRIGGER ${table}_immutable_guard BEFORE UPDATE ON ${table}
      FOR EACH ROW EXECUTE FUNCTION ${table}_immutable_guard();`;

const rls = (table: string) => `
    ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
    ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;
    CREATE POLICY ${table}_tenant_scope ON ${table}
      USING (CURRENT_USER = 'gooddealer_cloud_owner' OR (account_id = current_setting('gooddealer.account_id', true)
        AND workspace_id = current_setting('gooddealer.workspace_id', true)))
      WITH CHECK (CURRENT_USER = 'gooddealer_cloud_owner' OR (account_id = current_setting('gooddealer.account_id', true)
        AND workspace_id = current_setting('gooddealer.workspace_id', true)));`;

export const accountDefaultWorkspaceMigration: CloudMigration = {
  id: "202608200014-account-default-workspace",
  owner: "workspace/default-workspace",
  sql: `
    CREATE TABLE workspace_workspaces (
      workspace_id text PRIMARY KEY CHECK (workspace_id ~ '^[!-~]{1,160}$'),
      account_id text NOT NULL CHECK (account_id ~ '^[!-~]{1,160}$'),
      kind text NOT NULL CHECK (kind = 'personal'),
      name text NOT NULL CHECK (octet_length(name) BETWEEN 1 AND 160 AND name !~ '[[:cntrl:]]'),
      created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
      updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
      UNIQUE (account_id, workspace_id),
      FOREIGN KEY (account_id) REFERENCES identity_accounts(account_id) ON DELETE RESTRICT
    );
    CREATE TABLE workspace_account_bindings (
      account_id text NOT NULL CHECK (account_id ~ '^[!-~]{1,160}$'),
      workspace_id text NOT NULL CHECK (workspace_id ~ '^[!-~]{1,160}$'),
      owner_kind text NOT NULL CHECK (owner_kind = 'account'),
      role text NOT NULL CHECK (role = 'default_owner'),
      is_default boolean NOT NULL CHECK (is_default),
      created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
      updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
      PRIMARY KEY (account_id, workspace_id),
      FOREIGN KEY (account_id) REFERENCES identity_accounts(account_id) ON DELETE RESTRICT,
      FOREIGN KEY (account_id, workspace_id) REFERENCES workspace_workspaces(account_id, workspace_id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX workspace_account_bindings_one_default_account
      ON workspace_account_bindings (account_id) WHERE is_default AND role = 'default_owner';
    CREATE UNIQUE INDEX workspace_account_bindings_one_default_workspace
      ON workspace_account_bindings (workspace_id) WHERE is_default AND role = 'default_owner';
    ${immutable("workspace_workspaces", ["workspace_id", "account_id", "kind", "name", "created_at"])}
    ${immutable("workspace_account_bindings", ["account_id", "workspace_id", "owner_kind", "role", "is_default", "created_at"])}
    ${rls("workspace_workspaces")}
    ${rls("workspace_account_bindings")}
    CREATE POLICY workspace_account_bindings_default_owner_account_select
      ON workspace_account_bindings
      FOR SELECT
      TO gooddealer_cloud_app
      USING (
        current_setting('gooddealer.account_id', true) ~ '^[!-~]{1,160}$'
        AND account_id = current_setting('gooddealer.account_id', true)
        AND owner_kind = 'account'
        AND role = 'default_owner'
        AND is_default = true
      );
    GRANT SELECT, INSERT, UPDATE ON workspace_workspaces TO gooddealer_cloud_app;
    GRANT SELECT, INSERT, UPDATE ON workspace_account_bindings TO gooddealer_cloud_app;
  `,
};
