import type { CloudMigration } from "../../../db/index";

export const identityAuthenticationMigration: CloudMigration = {
  id: "202608200003-identity-authentication",
  owner: "identity",
  sql: `
    CREATE TABLE identity_accounts (
      account_id text PRIMARY KEY CHECK (account_id ~ '^[!-~]{1,160}$'),
      email_normalized text NOT NULL UNIQUE CHECK (
        octet_length(email_normalized) BETWEEN 3 AND 320 AND email_normalized !~ '[[:cntrl:]]'
      ),
      email_verified_at timestamptz,
      password_policy_id text NOT NULL CHECK (password_policy_id = 'argon2id-v1'),
      password_hash_phc text NOT NULL CHECK (octet_length(password_hash_phc) BETWEEN 80 AND 160),
      created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
      updated_at timestamptz NOT NULL DEFAULT transaction_timestamp()
    );
    CREATE OR REPLACE FUNCTION identity_accounts_immutable_guard()
      RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.account_id IS DISTINCT FROM OLD.account_id THEN
        RAISE EXCEPTION 'immutable identity_accounts identity changed' USING ERRCODE = '23000';
      END IF;
      RETURN NEW;
    END; $$;
    CREATE TRIGGER identity_accounts_immutable_guard
      BEFORE UPDATE ON identity_accounts
      FOR EACH ROW EXECUTE FUNCTION identity_accounts_immutable_guard();
    CREATE TABLE identity_account_security_states (
      account_id text PRIMARY KEY REFERENCES identity_accounts(account_id) ON DELETE CASCADE,
      account_security_epoch bigint NOT NULL DEFAULT 1 CHECK (account_security_epoch BETWEEN 1 AND 9007199254740991),
      status text NOT NULL DEFAULT 'normal' CHECK (status IN ('normal', 'recovery_pending')),
      session_list_revision bigint NOT NULL DEFAULT 1 CHECK (session_list_revision BETWEEN 1 AND 9007199254740991),
      updated_at timestamptz NOT NULL DEFAULT transaction_timestamp()
    );
    CREATE TABLE identity_auth_sessions (
      account_id text NOT NULL,
      session_id text NOT NULL CHECK (session_id ~ '^[!-~]{1,160}$'),
      client_kind text NOT NULL CHECK (client_kind IN ('desktop', 'account_web')),
      device_id text,
      auth_method text NOT NULL CHECK (auth_method IN ('password', 'passkey')),
      remember_device boolean NOT NULL,
      epoch_at_issue bigint NOT NULL CHECK (epoch_at_issue >= 1),
      rotation_generation bigint NOT NULL DEFAULT 0 CHECK (rotation_generation >= 0),
      created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
      last_seen_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
      expires_at timestamptz,
      revoked_at timestamptz,
      revocation_reason text,
      PRIMARY KEY (account_id, session_id),
      FOREIGN KEY (account_id) REFERENCES identity_account_security_states(account_id) ON DELETE CASCADE,
      CHECK ((client_kind = 'desktop' AND device_id IS NOT NULL) OR (client_kind = 'account_web' AND device_id IS NULL)),
      CHECK (expires_at IS NULL OR expires_at > created_at)
    );
    CREATE TABLE identity_refresh_families (
      account_id text NOT NULL,
      family_id text NOT NULL CHECK (family_id ~ '^[!-~]{1,160}$'),
      session_id text NOT NULL,
      current_refresh_jti text NOT NULL CHECK (current_refresh_jti ~ '^[!-~]{1,200}$'),
      generation bigint NOT NULL DEFAULT 0 CHECK (generation >= 0),
      state text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'revoked')),
      revoked_at timestamptz,
      revocation_reason text,
      PRIMARY KEY (account_id, family_id),
      UNIQUE (account_id, session_id),
      FOREIGN KEY (account_id, session_id) REFERENCES identity_auth_sessions(account_id, session_id) ON DELETE CASCADE
    );
    CREATE TABLE identity_credential_jtis (
      jti text PRIMARY KEY CHECK (jti ~ '^[!-~]{1,200}$'),
      account_id text NOT NULL,
      family_id text NOT NULL,
      session_id text NOT NULL,
      kind text NOT NULL CHECK (kind IN ('access', 'refresh')),
      state text NOT NULL CHECK (
        (kind = 'refresh' AND state IN ('current', 'rotated', 'revoked'))
        OR (kind = 'access' AND state IN ('active', 'revoked'))
      ),
      issued_epoch bigint NOT NULL CHECK (issued_epoch >= 1),
      issued_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
      expires_at timestamptz NOT NULL,
      FOREIGN KEY (account_id, family_id) REFERENCES identity_refresh_families(account_id, family_id) ON DELETE CASCADE,
      FOREIGN KEY (account_id, session_id) REFERENCES identity_auth_sessions(account_id, session_id) ON DELETE CASCADE,
      CHECK (expires_at > issued_at)
    );

    ALTER TABLE identity_accounts ENABLE ROW LEVEL SECURITY;
    ALTER TABLE identity_accounts FORCE ROW LEVEL SECURITY;
    CREATE POLICY identity_accounts_account ON identity_accounts
      USING (CURRENT_USER = 'gooddealer_cloud_owner' OR account_id = current_setting('gooddealer.account_id', true))
      WITH CHECK (CURRENT_USER = 'gooddealer_cloud_owner' OR account_id = current_setting('gooddealer.account_id', true));
    CREATE POLICY identity_accounts_exact_login ON identity_accounts FOR SELECT
      USING (email_normalized = current_setting('gooddealer.login_email', true));

    ALTER TABLE identity_account_security_states ENABLE ROW LEVEL SECURITY;
    ALTER TABLE identity_account_security_states FORCE ROW LEVEL SECURITY;
    CREATE POLICY identity_security_account ON identity_account_security_states
      USING (CURRENT_USER = 'gooddealer_cloud_owner' OR account_id = current_setting('gooddealer.account_id', true))
      WITH CHECK (CURRENT_USER = 'gooddealer_cloud_owner' OR account_id = current_setting('gooddealer.account_id', true));

    ALTER TABLE identity_auth_sessions ENABLE ROW LEVEL SECURITY;
    ALTER TABLE identity_auth_sessions FORCE ROW LEVEL SECURITY;
    CREATE POLICY identity_sessions_account ON identity_auth_sessions
      USING (CURRENT_USER = 'gooddealer_cloud_owner' OR account_id = current_setting('gooddealer.account_id', true))
      WITH CHECK (CURRENT_USER = 'gooddealer_cloud_owner' OR account_id = current_setting('gooddealer.account_id', true));
    ALTER TABLE identity_refresh_families ENABLE ROW LEVEL SECURITY;
    ALTER TABLE identity_refresh_families FORCE ROW LEVEL SECURITY;
    CREATE POLICY identity_families_account ON identity_refresh_families
      USING (CURRENT_USER = 'gooddealer_cloud_owner' OR account_id = current_setting('gooddealer.account_id', true))
      WITH CHECK (CURRENT_USER = 'gooddealer_cloud_owner' OR account_id = current_setting('gooddealer.account_id', true));
    ALTER TABLE identity_credential_jtis ENABLE ROW LEVEL SECURITY;
    ALTER TABLE identity_credential_jtis FORCE ROW LEVEL SECURITY;
    CREATE POLICY identity_jtis_account ON identity_credential_jtis
      USING (CURRENT_USER = 'gooddealer_cloud_owner' OR account_id = current_setting('gooddealer.account_id', true))
      WITH CHECK (CURRENT_USER = 'gooddealer_cloud_owner' OR account_id = current_setting('gooddealer.account_id', true));

    GRANT SELECT, INSERT, UPDATE ON identity_accounts TO gooddealer_cloud_app;
    GRANT SELECT, INSERT, UPDATE ON identity_account_security_states TO gooddealer_cloud_app;
    GRANT SELECT, INSERT, UPDATE ON identity_auth_sessions TO gooddealer_cloud_app;
    GRANT SELECT, INSERT, UPDATE ON identity_refresh_families TO gooddealer_cloud_app;
    GRANT SELECT, INSERT, UPDATE ON identity_credential_jtis TO gooddealer_cloud_app;
  `,
};
