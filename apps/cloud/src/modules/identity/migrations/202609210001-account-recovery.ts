import type { CloudMigration } from "../../../db/index";

export const accountRecoveryMigration: CloudMigration = {
  id: "202609210001-account-recovery",
  owner: "identity",
  sql: `
    CREATE TABLE identity_password_reset_challenges (
      account_id text PRIMARY KEY REFERENCES identity_accounts(account_id) ON DELETE CASCADE,
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
    ALTER TABLE identity_password_reset_challenges ENABLE ROW LEVEL SECURITY;
    ALTER TABLE identity_password_reset_challenges FORCE ROW LEVEL SECURITY;
    CREATE POLICY identity_password_reset_account ON identity_password_reset_challenges
      USING (CURRENT_USER = 'gooddealer_cloud_owner' OR account_id = current_setting('gooddealer.account_id', true))
      WITH CHECK (CURRENT_USER = 'gooddealer_cloud_owner' OR account_id = current_setting('gooddealer.account_id', true));
    CREATE POLICY identity_password_reset_worker ON identity_password_reset_challenges
      FOR SELECT TO gd_identity_definer USING (true);
    GRANT SELECT, INSERT, UPDATE ON identity_password_reset_challenges TO gooddealer_cloud_app;
    GRANT SELECT ON identity_password_reset_challenges TO gd_identity_definer;
    CREATE POLICY identity_registration_worker ON identity_registration_challenges
      FOR SELECT TO gd_identity_definer USING (true);
    GRANT SELECT ON identity_registration_challenges TO gd_identity_definer;

    ALTER TABLE identity_email_outbox
      ADD COLUMN purpose text,
      ADD COLUMN challenge_digest bytea,
      ADD COLUMN last_failure_at timestamptz,
      ADD COLUMN failed_at timestamptz;
    UPDATE identity_email_outbox AS item
       SET purpose = 'registration', challenge_digest = challenge.challenge_digest
      FROM identity_registration_challenges AS challenge
     WHERE challenge.account_id = item.account_id;
    ALTER TABLE identity_email_outbox
      ALTER COLUMN purpose SET NOT NULL,
      ALTER COLUMN challenge_digest SET NOT NULL,
      ADD CONSTRAINT identity_email_outbox_purpose
        CHECK (purpose IN ('registration', 'password_reset')),
      ADD CONSTRAINT identity_email_outbox_challenge_digest
        CHECK (octet_length(challenge_digest) = 32),
      DROP CONSTRAINT identity_email_outbox_state_check,
      ADD CONSTRAINT identity_email_outbox_state
        CHECK (state IN ('pending', 'sending', 'sent', 'failed', 'superseded')),
      DROP CONSTRAINT identity_email_outbox_check,
      ADD CONSTRAINT identity_email_outbox_sent_state
        CHECK ((state = 'sent') = (sent_at IS NOT NULL)),
      ADD CONSTRAINT identity_email_outbox_failed_state
        CHECK ((state = 'failed') = (failed_at IS NOT NULL));
    DROP INDEX identity_email_outbox_pending;
    CREATE INDEX identity_email_outbox_pending
      ON identity_email_outbox (available_at, created_at)
      WHERE state IN ('pending', 'sending');

    GRANT CREATE ON SCHEMA public TO gd_identity_definer;
    SET ROLE gd_identity_definer;
    DROP FUNCTION public.identity_claim_email_outbox();
    CREATE FUNCTION public.identity_claim_email_outbox(evaluation_time timestamptz)
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
         WHERE candidate.state IN ('pending', 'sending')
           AND candidate.available_at <= pg_catalog.transaction_timestamp()
           AND (candidate.state = 'pending' OR candidate.locked_until <= pg_catalog.transaction_timestamp())
           AND candidate.attempts < 20
           AND (
             (candidate.purpose = 'registration' AND EXISTS (
               SELECT 1 FROM public.identity_registration_challenges AS challenge
                WHERE challenge.account_id = candidate.account_id
                  AND challenge.challenge_digest = candidate.challenge_digest
                  AND challenge.consumed_at IS NULL
                  AND challenge.expires_at > evaluation_time
                  AND challenge.failed_attempts < 6
             ))
             OR
             (candidate.purpose = 'password_reset' AND EXISTS (
               SELECT 1 FROM public.identity_password_reset_challenges AS challenge
                WHERE challenge.account_id = candidate.account_id
                  AND challenge.challenge_digest = candidate.challenge_digest
                  AND challenge.consumed_at IS NULL
                  AND challenge.expires_at > evaluation_time
                  AND challenge.failed_attempts < 6
             ))
           )
         ORDER BY candidate.created_at, candidate.outbox_id COLLATE "C"
         FOR UPDATE OF candidate SKIP LOCKED LIMIT 1
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
    REVOKE ALL ON FUNCTION public.identity_claim_email_outbox(timestamptz) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.identity_claim_email_outbox(timestamptz) TO gooddealer_cloud_app;
    RESET ROLE;
    REVOKE CREATE ON SCHEMA public FROM gd_identity_definer;
  `,
};
