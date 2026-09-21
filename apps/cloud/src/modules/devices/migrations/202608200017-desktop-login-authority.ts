import type { CloudMigration } from "../../../db/index";

/**
 * Forward-only Desktop login authority schema. M004 is already part of a durable migration
 * prefix, so OAuth challenge and account-wide login Lease changes must remain additive here.
 */
export const desktopLoginAuthorityMigration: CloudMigration = {
  id: "202608200017-desktop-login-authority",
  owner: "devices",
  sql: `
    CREATE TABLE device_login_challenges (
      account_id text NOT NULL REFERENCES device_account_states(account_id) ON DELETE CASCADE,
      challenge_id text NOT NULL CHECK (challenge_id ~ '^[!-~]{1,200}$'),
      device_id text NOT NULL CHECK (device_id ~ '^[!-~]{1,160}$'),
      purpose text NOT NULL CHECK (purpose IN ('login', 'enroll')),
      key_id text NOT NULL CHECK (key_id ~ '^[!-~]{1,200}$'),
      proposed_public_key bytea NOT NULL CHECK (octet_length(proposed_public_key) = 32),
      nonce_digest bytea NOT NULL UNIQUE CHECK (octet_length(nonce_digest) = 32),
      account_session_digest bytea NOT NULL CHECK (octet_length(account_session_digest) = 32),
      code_challenge text NOT NULL CHECK (code_challenge ~ '^[A-Za-z0-9_-]{43}$'),
      client_id text NOT NULL CHECK (client_id = 'gooddealer-desktop'),
      redirect_uri text NOT NULL CHECK (redirect_uri = 'gooddealer://oauth/callback'),
      account_security_epoch bigint NOT NULL CHECK (account_security_epoch BETWEEN 1 AND 9007199254740991),
      issued_at timestamptz NOT NULL,
      expires_at timestamptz NOT NULL,
      consumed_at timestamptz,
      verdict text CHECK (verdict = 'accepted'),
      PRIMARY KEY (account_id, challenge_id),
      CHECK (expires_at > issued_at),
      CHECK ((consumed_at IS NULL) = (verdict IS NULL))
    );
    CREATE UNIQUE INDEX device_login_challenges_one_pending_per_device
      ON device_login_challenges(account_id, device_id) WHERE consumed_at IS NULL;

    ALTER TABLE device_login_challenges ENABLE ROW LEVEL SECURITY;
    ALTER TABLE device_login_challenges FORCE ROW LEVEL SECURITY;
    CREATE POLICY device_login_challenges_account_scope ON device_login_challenges
      USING (CURRENT_USER = 'gooddealer_cloud_owner'
        OR account_id = current_setting('gooddealer.account_id', true))
      WITH CHECK (CURRENT_USER = 'gooddealer_cloud_owner'
        OR account_id = current_setting('gooddealer.account_id', true));

    ALTER TABLE device_lease_epoch_allocations
      ADD COLUMN allocation_source text NOT NULL DEFAULT 'device_switch'
        CHECK (allocation_source IN ('desktop_login', 'device_switch')),
      ALTER COLUMN workspace_id DROP NOT NULL,
      ALTER COLUMN workflow_id DROP NOT NULL,
      ADD CONSTRAINT device_lease_epoch_allocations_source_shape CHECK (
        (allocation_source = 'device_switch' AND workspace_id IS NOT NULL AND workflow_id IS NOT NULL)
        OR (allocation_source = 'desktop_login' AND workspace_id IS NULL AND workflow_id IS NULL)
      );

    DROP POLICY device_lease_epoch_allocations_tenant_scope ON device_lease_epoch_allocations;
    CREATE POLICY device_lease_epoch_allocations_account_scope ON device_lease_epoch_allocations
      USING (CURRENT_USER = 'gooddealer_cloud_owner'
        OR account_id = current_setting('gooddealer.account_id', true))
      WITH CHECK (CURRENT_USER = 'gooddealer_cloud_owner'
        OR account_id = current_setting('gooddealer.account_id', true));

    ALTER TABLE device_active_leases
      ADD COLUMN wire_envelope jsonb
        CHECK (wire_envelope IS NULL OR jsonb_typeof(wire_envelope) = 'object'),
      ADD COLUMN signer_receipt_digest bytea
        CHECK (signer_receipt_digest IS NULL OR octet_length(signer_receipt_digest) = 32);

    UPDATE device_active_leases
       SET released_at = transaction_timestamp(), release_reason = 'lease_verifier_upgrade'
     WHERE released_at IS NULL AND (wire_envelope IS NULL OR signer_receipt_digest IS NULL);
    ALTER TABLE device_active_leases
      ADD CONSTRAINT device_active_leases_held_verified_wire CHECK (
        released_at IS NOT NULL OR (wire_envelope IS NOT NULL AND signer_receipt_digest IS NOT NULL)
      );

    GRANT SELECT, INSERT, UPDATE, DELETE ON device_login_challenges TO gooddealer_cloud_app;
  `,
};
