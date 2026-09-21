import type { CloudMigration } from "../../../db/index";

export const desktopRefreshIdempotencyMigration: CloudMigration = {
  id: "202608200016-desktop-refresh-idempotency",
  owner: "identity",
  sql: `
    ALTER TABLE identity_auth_sessions
      DROP CONSTRAINT identity_auth_sessions_auth_method_check;
    ALTER TABLE identity_auth_sessions
      ADD CONSTRAINT identity_auth_sessions_auth_method_check
      CHECK (auth_method IN ('password', 'passkey', 'oauth_pkce'));

    CREATE TABLE identity_desktop_authorization_codes (
      account_id text NOT NULL REFERENCES identity_account_security_states(account_id) ON DELETE CASCADE,
      code_digest text NOT NULL CHECK (code_digest ~ '^[0-9a-f]{64}$'),
      device_id text NOT NULL CHECK (device_id ~ '^[!-~]{1,160}$'),
      client_id text NOT NULL CHECK (client_id = 'gooddealer-desktop'),
      redirect_uri text NOT NULL CHECK (redirect_uri = 'gooddealer://oauth/callback'),
      code_challenge text NOT NULL CHECK (code_challenge ~ '^[A-Za-z0-9_-]{43}$'),
      account_security_epoch bigint NOT NULL CHECK (account_security_epoch BETWEEN 1 AND 9007199254740991),
      issued_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
      expires_at timestamptz NOT NULL,
      consumed_at timestamptz,
      PRIMARY KEY (account_id, code_digest),
      CHECK (expires_at > issued_at)
    );
    ALTER TABLE identity_desktop_authorization_codes ENABLE ROW LEVEL SECURITY;
    ALTER TABLE identity_desktop_authorization_codes FORCE ROW LEVEL SECURITY;
    CREATE POLICY identity_desktop_codes_account ON identity_desktop_authorization_codes
      USING (CURRENT_USER = 'gooddealer_cloud_owner' OR account_id = current_setting('gooddealer.account_id', true))
      WITH CHECK (CURRENT_USER = 'gooddealer_cloud_owner' OR account_id = current_setting('gooddealer.account_id', true));
    GRANT SELECT, INSERT, UPDATE ON identity_desktop_authorization_codes TO gooddealer_cloud_app;

    ALTER TABLE identity_credential_jtis
      ADD COLUMN rotation_request_id text,
      ADD COLUMN resulting_generation bigint;
    ALTER TABLE identity_credential_jtis
      ADD CONSTRAINT identity_credential_rotation_result_check CHECK (
        (rotation_request_id IS NULL AND resulting_generation IS NULL)
        OR (
          kind = 'refresh' AND state IN ('rotated', 'revoked')
          AND rotation_request_id ~ '^[!-~]{1,160}$'
          AND resulting_generation BETWEEN 1 AND 9007199254740991
        )
      );

    CREATE FUNCTION identity_read_session_verification(candidate_session_id text)
      RETURNS TABLE (
        session_id text,
        account_id text,
        client_kind text,
        expires_at timestamptz,
        session_account_security_epoch bigint,
        current_account_security_epoch bigint,
        family_state text
      )
      LANGUAGE sql
      SECURITY DEFINER
      SET search_path = pg_catalog, public
      AS $$
        SELECT a.session_id, a.account_id, a.client_kind, a.expires_at,
               a.epoch_at_issue, s.account_security_epoch,
               CASE WHEN a.revoked_at IS NULL THEN f.state ELSE 'revoked' END
          FROM public.identity_auth_sessions a
          JOIN public.identity_account_security_states s ON s.account_id = a.account_id
          LEFT JOIN public.identity_refresh_families f
            ON f.account_id = a.account_id AND f.session_id = a.session_id
         WHERE candidate_session_id ~ '^[!-~]{1,160}$'
           AND a.session_id = candidate_session_id
      $$;
    ALTER FUNCTION identity_read_session_verification(text) OWNER TO gooddealer_cloud_owner;
    REVOKE ALL ON FUNCTION identity_read_session_verification(text) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION identity_read_session_verification(text) TO gooddealer_cloud_app;
  `,
};
