import type { CloudMigration } from "../../../db/index";

export const accountAccessMigration: CloudMigration = {
  id: "202609040001-account-access",
  owner: "identity",
  sql: `
    CREATE TABLE identity_registration_challenges (
      account_id text PRIMARY KEY REFERENCES identity_accounts(account_id) ON DELETE CASCADE,
      workspace_id text NOT NULL UNIQUE CHECK (workspace_id ~ '^[!-~]{1,160}$'),
      email_normalized text NOT NULL UNIQUE,
      challenge_digest bytea NOT NULL CHECK (octet_length(challenge_digest) = 32),
      expires_at timestamptz NOT NULL,
      resend_available_at timestamptz NOT NULL,
      failed_attempts smallint NOT NULL DEFAULT 0 CHECK (failed_attempts BETWEEN 0 AND 6),
      consumed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
      updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
      CHECK (expires_at > created_at),
      CHECK (resend_available_at > created_at)
    );

    CREATE TABLE identity_email_outbox (
      outbox_id text PRIMARY KEY CHECK (outbox_id ~ '^[!-~]{1,160}$'),
      account_id text NOT NULL REFERENCES identity_accounts(account_id) ON DELETE CASCADE,
      key_id text NOT NULL CHECK (key_id ~ '^[A-Za-z0-9._-]{1,80}$'),
      nonce bytea NOT NULL CHECK (octet_length(nonce) = 12),
      ciphertext bytea NOT NULL CHECK (octet_length(ciphertext) BETWEEN 1 AND 20000),
      authentication_tag bytea NOT NULL CHECK (octet_length(authentication_tag) = 16),
      state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'sending', 'sent')),
      attempts smallint NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 20),
      available_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
      locked_until timestamptz,
      sent_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
      CHECK ((state = 'sent') = (sent_at IS NOT NULL))
    );
    CREATE INDEX identity_email_outbox_pending
      ON identity_email_outbox (available_at, created_at) WHERE state <> 'sent';

    ALTER TABLE identity_registration_challenges ENABLE ROW LEVEL SECURITY;
    ALTER TABLE identity_registration_challenges FORCE ROW LEVEL SECURITY;
    CREATE POLICY identity_registration_account ON identity_registration_challenges
      USING (CURRENT_USER = 'gooddealer_cloud_owner' OR account_id = current_setting('gooddealer.account_id', true))
      WITH CHECK (CURRENT_USER = 'gooddealer_cloud_owner' OR account_id = current_setting('gooddealer.account_id', true));
    ALTER TABLE identity_email_outbox ENABLE ROW LEVEL SECURITY;
    ALTER TABLE identity_email_outbox FORCE ROW LEVEL SECURITY;
    CREATE POLICY identity_email_outbox_account ON identity_email_outbox
      USING (CURRENT_USER = 'gooddealer_cloud_owner' OR account_id = current_setting('gooddealer.account_id', true))
      WITH CHECK (CURRENT_USER = 'gooddealer_cloud_owner' OR account_id = current_setting('gooddealer.account_id', true));
    CREATE POLICY identity_email_outbox_worker ON identity_email_outbox
      TO gd_identity_definer USING (true) WITH CHECK (true);

    GRANT SELECT, INSERT, UPDATE ON identity_registration_challenges TO gooddealer_cloud_app;
    GRANT SELECT, INSERT, UPDATE ON identity_email_outbox TO gooddealer_cloud_app;
    GRANT SELECT, UPDATE ON identity_email_outbox TO gd_identity_definer;

    GRANT CREATE ON SCHEMA public TO gd_identity_definer;
    CREATE FUNCTION identity_claim_email_outbox()
      RETURNS TABLE (
        outbox_id text, account_id text, key_id text, nonce bytea,
        ciphertext bytea, authentication_tag bytea
      )
      LANGUAGE plpgsql SECURITY DEFINER
      SET search_path = pg_catalog, public
      SET row_security = on
      AS $function$
    BEGIN
      RETURN QUERY
      WITH selected AS (
        SELECT candidate.outbox_id
          FROM public.identity_email_outbox AS candidate
         WHERE candidate.state <> 'sent'
           AND candidate.available_at <= pg_catalog.transaction_timestamp()
           AND (candidate.state = 'pending' OR candidate.locked_until <= pg_catalog.transaction_timestamp())
           AND candidate.attempts < 20
         ORDER BY candidate.created_at, candidate.outbox_id COLLATE "C"
         FOR UPDATE SKIP LOCKED LIMIT 1
      ), claimed AS (
        UPDATE public.identity_email_outbox AS item
           SET state = 'sending', attempts = attempts + 1,
               locked_until = pg_catalog.transaction_timestamp() + interval '1 minute'
          FROM selected
         WHERE item.outbox_id = selected.outbox_id
         RETURNING item.outbox_id, item.account_id, item.key_id, item.nonce,
                   item.ciphertext, item.authentication_tag
      )
      SELECT * FROM claimed;
    END;
    $function$;
    REVOKE ALL ON FUNCTION identity_claim_email_outbox() FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION identity_claim_email_outbox() TO gooddealer_cloud_app;
    ALTER FUNCTION identity_claim_email_outbox() OWNER TO gd_identity_definer;
    REVOKE CREATE ON SCHEMA public FROM gd_identity_definer;
  `,
};
