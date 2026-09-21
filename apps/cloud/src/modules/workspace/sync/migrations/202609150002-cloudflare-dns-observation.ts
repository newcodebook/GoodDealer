import type { CloudMigration } from "../../../../db/index";

/** Receipt-first Cloudflare count projection ledger. Full DNS observations never enter Cloud. */
export const cloudflareDnsObservationMigration: CloudMigration = {
  id: "202609150002-cloudflare-dns-observation",
  owner: "workspace/sync",
  sql: `
    DO $roles$
    DECLARE role_row record;
    BEGIN
      SELECT rolsuper, rolbypassrls INTO role_row FROM pg_catalog.pg_roles
       WHERE rolname = 'gd_account_api';
      IF NOT FOUND OR role_row.rolsuper OR role_row.rolbypassrls THEN
        RAISE EXCEPTION 'Cloud application role must be NOSUPERUSER and NOBYPASSRLS';
      END IF;
      IF pg_catalog.pg_has_role('gd_account_api', 'gooddealer_cloud_owner', 'MEMBER') THEN
        RAISE EXCEPTION 'Cloud application role must not own or inherit observation storage';
      END IF;
    END $roles$;

    CREATE TABLE cloudflare_dns_observation_sequence_heads (
      account_id text NOT NULL,
      workspace_id text NOT NULL,
      observation_sequence bigint NOT NULL CHECK (observation_sequence BETWEEN 1 AND 9007199254740991),
      PRIMARY KEY (account_id, workspace_id),
      FOREIGN KEY (account_id, workspace_id) REFERENCES workspace_revisions(account_id, workspace_id) ON DELETE CASCADE
    );

    CREATE TABLE cloudflare_dns_observation_receipts (
      account_id text NOT NULL,
      workspace_id text NOT NULL,
      observation_id uuid NOT NULL,
      device_id text NOT NULL CHECK (device_id ~ '^[!-~]{1,160}$'),
      lease_epoch bigint NOT NULL CHECK (lease_epoch BETWEEN 1 AND 9007199254740991),
      source_sequence bigint NOT NULL CHECK (source_sequence BETWEEN 1 AND 9007199254740991),
      entity_id text NOT NULL CHECK (entity_id ~ '^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'),
      canonical_request_digest bytea NOT NULL CHECK (octet_length(canonical_request_digest) = 32),
      observed_at timestamptz NOT NULL,
      received_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
      observation_sequence bigint NOT NULL CHECK (observation_sequence BETWEEN 1 AND 9007199254740991),
      disposition text NOT NULL CHECK (disposition IN ('current', 'stale')),
      PRIMARY KEY (account_id, workspace_id, observation_id),
      UNIQUE (account_id, workspace_id, observation_sequence),
      UNIQUE (account_id, workspace_id, entity_id, observation_id),
      FOREIGN KEY (account_id, workspace_id) REFERENCES workspace_revisions(account_id, workspace_id) ON DELETE CASCADE,
      FOREIGN KEY (account_id, workspace_id, entity_id)
        REFERENCES workspace_replica_domain_assets(account_id, workspace_id, entity_id) ON DELETE RESTRICT
    );

    CREATE TABLE cloudflare_dns_observation_projections (
      account_id text NOT NULL,
      workspace_id text NOT NULL,
      entity_id text NOT NULL CHECK (entity_id ~ '^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'),
      observation_id uuid NOT NULL,
      device_id text NOT NULL CHECK (device_id ~ '^[!-~]{1,160}$'),
      lease_epoch bigint NOT NULL CHECK (lease_epoch BETWEEN 1 AND 9007199254740991),
      source_sequence bigint NOT NULL CHECK (source_sequence BETWEEN 1 AND 9007199254740991),
      canonical_request_digest bytea NOT NULL CHECK (octet_length(canonical_request_digest) = 32),
      observed_at timestamptz NOT NULL,
      availability text NOT NULL CHECK (availability IN ('available', 'unavailable')),
      zone_status text NOT NULL CHECK (zone_status IN ('active', 'pending', 'unknown')),
      a_count integer CHECK (a_count IS NULL OR a_count BETWEEN 0 AND 1024),
      aaaa_count integer CHECK (aaaa_count IS NULL OR aaaa_count BETWEEN 0 AND 1024),
      cname_count integer CHECK (cname_count IS NULL OR cname_count BETWEEN 0 AND 1024),
      txt_count integer CHECK (txt_count IS NULL OR txt_count BETWEEN 0 AND 1024),
      proxied_count integer CHECK (proxied_count IS NULL OR proxied_count BETWEEN 0 AND 1024),
      observation_sequence bigint NOT NULL CHECK (observation_sequence BETWEEN 1 AND 9007199254740991),
      PRIMARY KEY (account_id, workspace_id, entity_id),
      FOREIGN KEY (account_id, workspace_id) REFERENCES workspace_revisions(account_id, workspace_id) ON DELETE CASCADE,
      FOREIGN KEY (account_id, workspace_id, entity_id)
        REFERENCES workspace_replica_domain_assets(account_id, workspace_id, entity_id) ON DELETE RESTRICT,
      FOREIGN KEY (account_id, workspace_id, entity_id, observation_id)
        REFERENCES cloudflare_dns_observation_receipts(account_id, workspace_id, entity_id, observation_id) ON DELETE RESTRICT,
      CHECK ((availability = 'unavailable' AND zone_status = 'unknown'
        AND a_count IS NULL AND aaaa_count IS NULL AND cname_count IS NULL AND txt_count IS NULL AND proxied_count IS NULL)
        OR (availability = 'available' AND zone_status IN ('active', 'pending')
        AND a_count IS NOT NULL AND aaaa_count IS NOT NULL AND cname_count IS NOT NULL AND txt_count IS NOT NULL
        AND proxied_count IS NOT NULL AND a_count + aaaa_count + cname_count + txt_count <= 1024
        AND proxied_count <= a_count + aaaa_count + cname_count))
    );

    ALTER TABLE cloudflare_dns_observation_sequence_heads ENABLE ROW LEVEL SECURITY;
    ALTER TABLE cloudflare_dns_observation_sequence_heads FORCE ROW LEVEL SECURITY;
    ALTER TABLE cloudflare_dns_observation_receipts ENABLE ROW LEVEL SECURITY;
    ALTER TABLE cloudflare_dns_observation_receipts FORCE ROW LEVEL SECURITY;
    ALTER TABLE cloudflare_dns_observation_projections ENABLE ROW LEVEL SECURITY;
    ALTER TABLE cloudflare_dns_observation_projections FORCE ROW LEVEL SECURITY;

    CREATE POLICY cloudflare_dns_observation_sequence_heads_tenant ON cloudflare_dns_observation_sequence_heads
      USING (CURRENT_USER = 'gooddealer_cloud_owner' OR (account_id = current_setting('gooddealer.account_id', true)
        AND workspace_id = current_setting('gooddealer.workspace_id', true)))
      WITH CHECK (CURRENT_USER = 'gooddealer_cloud_owner' OR (account_id = current_setting('gooddealer.account_id', true)
        AND workspace_id = current_setting('gooddealer.workspace_id', true)));
    CREATE POLICY cloudflare_dns_observation_receipts_tenant ON cloudflare_dns_observation_receipts
      USING (CURRENT_USER = 'gooddealer_cloud_owner' OR (account_id = current_setting('gooddealer.account_id', true)
        AND workspace_id = current_setting('gooddealer.workspace_id', true)))
      WITH CHECK (CURRENT_USER = 'gooddealer_cloud_owner' OR (account_id = current_setting('gooddealer.account_id', true)
        AND workspace_id = current_setting('gooddealer.workspace_id', true)));
    CREATE POLICY cloudflare_dns_observation_projections_tenant ON cloudflare_dns_observation_projections
      USING (CURRENT_USER = 'gooddealer_cloud_owner' OR (account_id = current_setting('gooddealer.account_id', true)
        AND workspace_id = current_setting('gooddealer.workspace_id', true)))
      WITH CHECK (CURRENT_USER = 'gooddealer_cloud_owner' OR (account_id = current_setting('gooddealer.account_id', true)
        AND workspace_id = current_setting('gooddealer.workspace_id', true)));
    CREATE POLICY cloudflare_dns_observation_sequence_heads_identity ON cloudflare_dns_observation_sequence_heads
      AS RESTRICTIVE TO gd_account_api
      USING (account_id = identity_private.current_transaction_account())
      WITH CHECK (account_id = identity_private.current_transaction_account());
    CREATE POLICY cloudflare_dns_observation_receipts_identity ON cloudflare_dns_observation_receipts
      AS RESTRICTIVE TO gd_account_api
      USING (account_id = identity_private.current_transaction_account())
      WITH CHECK (account_id = identity_private.current_transaction_account());
    CREATE POLICY cloudflare_dns_observation_projections_identity ON cloudflare_dns_observation_projections
      AS RESTRICTIVE TO gd_account_api
      USING (account_id = identity_private.current_transaction_account())
      WITH CHECK (account_id = identity_private.current_transaction_account());

    CREATE FUNCTION cloudflare_dns_observation_receipts_reject_mutation()
    RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog
    AS $$ BEGIN RAISE EXCEPTION 'Cloudflare observation receipts are immutable' USING ERRCODE = '55000'; END; $$;
    CREATE TRIGGER cloudflare_dns_observation_receipts_immutable
      BEFORE UPDATE OR DELETE ON cloudflare_dns_observation_receipts
      FOR EACH ROW EXECUTE FUNCTION cloudflare_dns_observation_receipts_reject_mutation();

    ALTER TABLE cloudflare_dns_observation_sequence_heads OWNER TO gooddealer_cloud_owner;
    ALTER TABLE cloudflare_dns_observation_receipts OWNER TO gooddealer_cloud_owner;
    ALTER TABLE cloudflare_dns_observation_projections OWNER TO gooddealer_cloud_owner;
    ALTER FUNCTION cloudflare_dns_observation_receipts_reject_mutation() OWNER TO gooddealer_cloud_owner;
    REVOKE ALL ON FUNCTION cloudflare_dns_observation_receipts_reject_mutation() FROM PUBLIC, gooddealer_cloud_app;

    REVOKE ALL ON TABLE cloudflare_dns_observation_sequence_heads,
      cloudflare_dns_observation_receipts, cloudflare_dns_observation_projections
      FROM PUBLIC, gooddealer_cloud_app, gd_account_api;
    GRANT SELECT, INSERT, UPDATE ON cloudflare_dns_observation_sequence_heads TO gd_account_api;
    GRANT SELECT, INSERT ON cloudflare_dns_observation_receipts TO gd_account_api;
    GRANT SELECT, INSERT, UPDATE ON cloudflare_dns_observation_projections TO gd_account_api;
  `,
};
