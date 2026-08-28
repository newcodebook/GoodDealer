import type { CloudMigration } from "../../../../../db/index";

const replicaPolicy = (table: string) => `
    ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
    ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;
    CREATE POLICY ${table}_tenant_scope ON ${table}
      USING (
        CURRENT_USER = 'gooddealer_cloud_owner'
        OR (account_id = current_setting('gooddealer.account_id', true)
          AND workspace_id = current_setting('gooddealer.workspace_id', true))
      )
      WITH CHECK (
        CURRENT_USER = 'gooddealer_cloud_owner'
        OR (account_id = current_setting('gooddealer.account_id', true)
          AND workspace_id = current_setting('gooddealer.workspace_id', true))
      );`;

/**
 * Cloud owns replication and recovery state, never the Desktop business transaction. Names in
 * the final schema make that role explicit and every table deliberately excludes connection,
 * Provider-account, credential, browser-profile, and secret identity.
 */
export const businessReplicaModelMigration: CloudMigration = {
  id: "202608200002-business-replica-model",
  owner: "workspace/state/portfolio",
  sql: `
    CREATE FUNCTION workspace_replica_text_array_is_bounded(
      value text[], max_items integer, max_element_bytes integer
    ) RETURNS boolean
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    SET search_path = pg_catalog
    RETURN cardinality(value) <= max_items
      AND array_position(value, NULL) IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM unnest(value) AS element
        WHERE octet_length(element) NOT BETWEEN 1 AND max_element_bytes
      );

    CREATE FUNCTION workspace_replica_domain_array_is_canonical(value text[])
    RETURNS boolean
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    SET search_path = pg_catalog
    RETURN NOT EXISTS (
      SELECT 1 FROM unnest(value) AS element
      WHERE octet_length(element) NOT BETWEEN 3 AND 253
        OR element !~ '^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'
    );

    CREATE TABLE workspace_replica_domain_assets (
      account_id text NOT NULL,
      workspace_id text NOT NULL,
      entity_id text NOT NULL CHECK (
        octet_length(entity_id) BETWEEN 3 AND 253
        AND entity_id ~ '^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'
      ),
      note text CHECK (note IS NULL OR octet_length(note) <= 40000),
      portfolio_id text CHECK (portfolio_id IS NULL OR portfolio_id ~ '^[!-~]{1,160}$'),
      tags text[] NOT NULL DEFAULT '{}' CHECK (
        workspace_replica_text_array_is_bounded(tags, 128, 256)
      ),
      target_price_currency text CHECK (target_price_currency IS NULL OR target_price_currency ~ '^[A-Z]{3}$'),
      target_price_amount text CHECK (
        target_price_amount IS NULL OR target_price_amount ~ '^(0|[1-9][0-9]{0,15})(\\.[0-9]{0,7}[1-9])?$'
      ),
      note_server_revision bigint NOT NULL DEFAULT 0 CHECK (note_server_revision BETWEEN 0 AND 9007199254740991),
      portfolio_id_server_revision bigint NOT NULL DEFAULT 0 CHECK (portfolio_id_server_revision BETWEEN 0 AND 9007199254740991),
      tags_server_revision bigint NOT NULL DEFAULT 0 CHECK (tags_server_revision BETWEEN 0 AND 9007199254740991),
      target_price_server_revision bigint NOT NULL DEFAULT 0 CHECK (target_price_server_revision BETWEEN 0 AND 9007199254740991),
      lifecycle_status_server_revision bigint NOT NULL DEFAULT 0 CHECK (lifecycle_status_server_revision BETWEEN 0 AND 9007199254740991),
      acquired_on_server_revision bigint NOT NULL DEFAULT 0 CHECK (acquired_on_server_revision BETWEEN 0 AND 9007199254740991),
      expires_on_server_revision bigint NOT NULL DEFAULT 0 CHECK (expires_on_server_revision BETWEEN 0 AND 9007199254740991),
      acquisition_cost_server_revision bigint NOT NULL DEFAULT 0 CHECK (acquisition_cost_server_revision BETWEEN 0 AND 9007199254740991),
      auto_renew_server_revision bigint NOT NULL DEFAULT 0 CHECK (auto_renew_server_revision BETWEEN 0 AND 9007199254740991),
      registrar_lock_server_revision bigint NOT NULL DEFAULT 0 CHECK (registrar_lock_server_revision BETWEEN 0 AND 9007199254740991),
      desired_sale_status_server_revision bigint NOT NULL DEFAULT 0 CHECK (desired_sale_status_server_revision BETWEEN 0 AND 9007199254740991),
      desired_nameservers_server_revision bigint NOT NULL DEFAULT 0 CHECK (desired_nameservers_server_revision BETWEEN 0 AND 9007199254740991),
      materialization_origin text NOT NULL DEFAULT 'workspace_sync'
        CHECK (materialization_origin IN ('workspace_sync', 'provider_observation_projection')),
      materialization_version_token text NOT NULL DEFAULT '0'
        CHECK (char_length(materialization_version_token) BETWEEN 1 AND 256),
      materialized_at timestamptz,
      projection_availability text NOT NULL DEFAULT 'unavailable'
        CHECK (projection_availability IN ('available', 'unavailable')),
      projection_evidence_status text NOT NULL DEFAULT 'unknown'
        CHECK (projection_evidence_status IN ('confirmed', 'stale', 'conflicted', 'unknown')),
      lifecycle_status text NOT NULL DEFAULT 'active'
        CHECK (lifecycle_status IN ('active', 'expired', 'sold', 'dropped', 'archived')),
      acquired_on date,
      expires_on date,
      acquisition_cost_currency text,
      acquisition_cost_amount text,
      auto_renew boolean,
      registrar_lock boolean,
      desired_sale_status text NOT NULL DEFAULT 'hold'
        CHECK (desired_sale_status IN ('hold', 'available', 'listed', 'reserved', 'sold')),
      desired_nameservers text[] NOT NULL DEFAULT '{}' CHECK (
        workspace_replica_text_array_is_bounded(desired_nameservers, 32, 253)
        AND workspace_replica_domain_array_is_canonical(desired_nameservers)
      ),
      deleted_at timestamptz,
      PRIMARY KEY (account_id, workspace_id, entity_id),
      FOREIGN KEY (account_id, workspace_id)
        REFERENCES workspace_revisions(account_id, workspace_id) ON DELETE CASCADE,
      CHECK ((target_price_currency IS NULL) = (target_price_amount IS NULL)),
      CHECK (
        materialized_at IS NOT NULL
        OR projection_availability = 'unavailable'
        OR projection_evidence_status = 'unknown'
      ),
      CHECK (
        (acquisition_cost_currency IS NULL) = (acquisition_cost_amount IS NULL)
        AND (acquisition_cost_currency IS NULL OR acquisition_cost_currency ~ '^[A-Z]{3}$')
        AND (acquisition_cost_amount IS NULL OR acquisition_cost_amount ~
          '^(0|[1-9][0-9]{0,15})(\\.[0-9]{0,7}[1-9])?$')
      ),
      CHECK (deleted_at IS NULL OR lifecycle_status = 'archived')
    );

    CREATE TABLE workspace_replica_portfolio_state (
      account_id text NOT NULL,
      workspace_id text NOT NULL,
      materialized_through_server_revision bigint NOT NULL DEFAULT 0 CHECK (
        materialized_through_server_revision BETWEEN 0 AND 9007199254740991
      ),
      materialized_at timestamptz,
      projection_availability text NOT NULL DEFAULT 'unavailable'
        CHECK (projection_availability IN ('available', 'unavailable')),
      projection_evidence_status text NOT NULL DEFAULT 'unknown'
        CHECK (projection_evidence_status IN ('confirmed', 'stale', 'conflicted', 'unknown')),
      PRIMARY KEY (account_id, workspace_id),
      FOREIGN KEY (account_id, workspace_id)
        REFERENCES workspace_revisions(account_id, workspace_id) ON DELETE CASCADE,
      CHECK (materialized_at IS NOT NULL OR projection_availability = 'unavailable'
        OR projection_evidence_status = 'unknown')
    );

    ALTER TABLE workspace_revisions NO FORCE ROW LEVEL SECURITY;
    INSERT INTO workspace_replica_portfolio_state (
      account_id, workspace_id, materialized_through_server_revision, materialized_at,
      projection_availability, projection_evidence_status
    )
    SELECT account_id, workspace_id, server_revision, NULL, 'unavailable', 'unknown'
    FROM workspace_revisions;
    ALTER TABLE workspace_revisions FORCE ROW LEVEL SECURITY;

    CREATE FUNCTION initialize_workspace_replica_portfolio_state()
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog, public
    AS $workspace_replica_portfolio_state_initializer$
    BEGIN
      INSERT INTO public.workspace_replica_portfolio_state (
        account_id, workspace_id, materialized_through_server_revision, materialized_at,
        projection_availability, projection_evidence_status
      ) VALUES (
        NEW.account_id, NEW.workspace_id, NEW.server_revision,
        NULL, 'unavailable', 'unknown'
      )
      ON CONFLICT (account_id, workspace_id) DO NOTHING;
      RETURN NEW;
    END;
    $workspace_replica_portfolio_state_initializer$;

    CREATE TRIGGER workspace_replica_portfolio_state_initialize
      AFTER INSERT ON workspace_revisions
      FOR EACH ROW EXECUTE FUNCTION initialize_workspace_replica_portfolio_state();

    ${replicaPolicy("workspace_replica_domain_assets")}
    ${replicaPolicy("workspace_replica_portfolio_state")}
    GRANT SELECT ON workspace_replica_domain_assets, workspace_replica_portfolio_state
      TO gooddealer_cloud_app;
    GRANT INSERT (account_id, workspace_id, entity_id, note, portfolio_id, tags,
      target_price_currency, target_price_amount, note_server_revision, portfolio_id_server_revision,
      tags_server_revision, target_price_server_revision) ON workspace_replica_domain_assets
      TO gooddealer_cloud_app;
    GRANT UPDATE (note, portfolio_id, tags, target_price_currency, target_price_amount,
      note_server_revision, portfolio_id_server_revision, tags_server_revision, target_price_server_revision)
      ON workspace_replica_domain_assets TO gooddealer_cloud_app;
    GRANT INSERT (account_id, workspace_id, materialized_through_server_revision, materialized_at,
      projection_availability, projection_evidence_status),
      UPDATE (materialized_through_server_revision, materialized_at,
        projection_availability, projection_evidence_status)
      ON workspace_replica_portfolio_state TO gooddealer_cloud_app;

    CREATE TABLE workspace_replica_portfolios (
      account_id text NOT NULL,
      workspace_id text NOT NULL,
      portfolio_id text NOT NULL CHECK (portfolio_id ~ '^[!-~]{1,160}$'),
      name text NOT NULL CHECK (octet_length(name) BETWEEN 1 AND 160 AND name !~ '[[:cntrl:]]'),
      color_token text,
      sort_order bigint NOT NULL DEFAULT 0,
      server_revision bigint NOT NULL CHECK (server_revision BETWEEN 1 AND 9007199254740991),
      deleted_at timestamptz,
      PRIMARY KEY (account_id, workspace_id, portfolio_id),
      FOREIGN KEY (account_id, workspace_id)
        REFERENCES workspace_revisions(account_id, workspace_id) ON DELETE CASCADE
    );

    CREATE TABLE workspace_replica_observations (
      account_id text NOT NULL,
      workspace_id text NOT NULL,
      observation_id text NOT NULL CHECK (observation_id ~ '^[!-~]{1,160}$'),
      entity_id text NOT NULL CHECK (
        octet_length(entity_id) BETWEEN 3 AND 253
        AND entity_id ~ '^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'
      ),
      observation_kind text NOT NULL CHECK (observation_kind IN (
        'registrar', 'dns_zone', 'marketplace_listing', 'valuation'
      )),
      observation_origin text NOT NULL CHECK (observation_origin IN (
        'workspace', 'provider', 'manual', 'recovery'
      )),
      observation_capability text NOT NULL CHECK (observation_capability IN (
        'registrar', 'dns', 'marketplace', 'valuation'
      )),
      provider_kind text CHECK (provider_kind IS NULL OR provider_kind ~ '^[a-z][a-z0-9_-]{0,63}$'),
      provider_version_token text NOT NULL CHECK (char_length(provider_version_token) BETWEEN 1 AND 256),
      observed_at timestamptz NOT NULL,
      observation_availability text NOT NULL CHECK (observation_availability IN ('available', 'unavailable')),
      evidence_status text NOT NULL CHECK (evidence_status IN ('confirmed', 'stale', 'conflicted', 'unknown')),
      payload_schema_version integer NOT NULL CHECK (payload_schema_version = 1),
      observation_payload jsonb NOT NULL CHECK (
        jsonb_typeof(observation_payload) = 'object'
        AND octet_length(observation_payload::text) <= 1048576
      ),
      payload_sha256 bytea NOT NULL CHECK (octet_length(payload_sha256) = 32),
      server_revision bigint NOT NULL CHECK (server_revision BETWEEN 1 AND 9007199254740991),
      PRIMARY KEY (account_id, workspace_id, observation_id),
      FOREIGN KEY (account_id, workspace_id, entity_id)
        REFERENCES workspace_replica_domain_assets(account_id, workspace_id, entity_id)
        ON DELETE CASCADE
    );

    CREATE TABLE workspace_replica_dns_records (
      account_id text NOT NULL,
      workspace_id text NOT NULL,
      observation_id text NOT NULL,
      record_key text NOT NULL CHECK (record_key ~ '^[!-~]{1,200}$'),
      record_type text NOT NULL CHECK (record_type ~ '^[A-Z][A-Z0-9]{0,15}$'),
      owner_name_ascii text NOT NULL CHECK (octet_length(owner_name_ascii) BETWEEN 1 AND 253),
      ttl_seconds bigint CHECK (ttl_seconds IS NULL OR ttl_seconds BETWEEN 1 AND 2147483647),
      priority integer,
      canonical_value text NOT NULL CHECK (octet_length(canonical_value) BETWEEN 1 AND 65536),
      proxied boolean,
      PRIMARY KEY (account_id, workspace_id, observation_id, record_key),
      FOREIGN KEY (account_id, workspace_id, observation_id)
        REFERENCES workspace_replica_observations(account_id, workspace_id, observation_id)
        ON DELETE CASCADE
    );

    CREATE TABLE workspace_replica_operation_summaries (
      account_id text NOT NULL,
      workspace_id text NOT NULL,
      operation_id text NOT NULL CHECK (operation_id ~ '^[!-~]{1,160}$'),
      operation_kind text NOT NULL,
      phase text NOT NULL CHECK (phase IN (
        'queued', 'running', 'completed', 'partially_failed', 'cancelled', 'rolled_back'
      )),
      item_count integer NOT NULL CHECK (item_count BETWEEN 1 AND 100000),
      succeeded_count integer NOT NULL CHECK (succeeded_count BETWEEN 0 AND item_count),
      failed_count integer NOT NULL CHECK (failed_count BETWEEN 0 AND item_count),
      unknown_count integer NOT NULL CHECK (unknown_count BETWEEN 0 AND item_count),
      requested_at timestamptz NOT NULL,
      completed_at timestamptz,
      summary_sha256 bytea NOT NULL CHECK (octet_length(summary_sha256) = 32),
      server_revision bigint NOT NULL CHECK (server_revision BETWEEN 1 AND 9007199254740991),
      PRIMARY KEY (account_id, workspace_id, operation_id),
      FOREIGN KEY (account_id, workspace_id)
        REFERENCES workspace_revisions(account_id, workspace_id) ON DELETE CASCADE,
      CHECK (succeeded_count + failed_count + unknown_count <= item_count)
    );

    CREATE TABLE workspace_replica_business_events (
      account_id text NOT NULL,
      workspace_id text NOT NULL,
      server_revision bigint NOT NULL CHECK (server_revision BETWEEN 1 AND 9007199254740991),
      event_id text NOT NULL CHECK (event_id ~ '^[!-~]{1,160}$'),
      aggregate_kind text NOT NULL,
      aggregate_id text NOT NULL CHECK (aggregate_id ~ '^[!-~]{1,160}$'),
      event_kind text NOT NULL,
      occurred_at timestamptz NOT NULL,
      event_payload jsonb NOT NULL CHECK (
        jsonb_typeof(event_payload) = 'object'
        AND octet_length(event_payload::text) <= 1048576
      ),
      payload_schema_version integer NOT NULL CHECK (payload_schema_version = 1),
      payload_sha256 bytea NOT NULL CHECK (octet_length(payload_sha256) = 32),
      PRIMARY KEY (account_id, workspace_id, server_revision, event_id),
      FOREIGN KEY (account_id, workspace_id)
        REFERENCES workspace_revisions(account_id, workspace_id) ON DELETE CASCADE
    );

    CREATE TABLE workspace_replica_tombstones (
      account_id text NOT NULL,
      workspace_id text NOT NULL,
      entity_type text NOT NULL CHECK (entity_type IN (
        'domain_asset', 'portfolio', 'observation', 'operation_summary'
      )),
      entity_id text NOT NULL CHECK (
        (entity_type = 'domain_asset'
          AND octet_length(entity_id) BETWEEN 3 AND 253
          AND entity_id ~ '^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$')
        OR (entity_type <> 'domain_asset' AND entity_id ~ '^[!-~]{1,160}$')
      ),
      deleted_server_revision bigint NOT NULL CHECK (deleted_server_revision BETWEEN 1 AND 9007199254740991),
      deleted_at timestamptz NOT NULL,
      purge_after timestamptz,
      PRIMARY KEY (account_id, workspace_id, entity_type, entity_id),
      FOREIGN KEY (account_id, workspace_id)
        REFERENCES workspace_revisions(account_id, workspace_id) ON DELETE CASCADE,
      CHECK (purge_after IS NULL OR purge_after > deleted_at)
    );

    ${replicaPolicy("workspace_replica_portfolios")}
    ${replicaPolicy("workspace_replica_observations")}
    ${replicaPolicy("workspace_replica_dns_records")}
    ${replicaPolicy("workspace_replica_operation_summaries")}
    ${replicaPolicy("workspace_replica_business_events")}
    ${replicaPolicy("workspace_replica_tombstones")}

    CREATE INDEX workspace_replica_domain_assets_status_expiry
      ON workspace_replica_domain_assets(account_id, workspace_id, lifecycle_status, expires_on, entity_id)
      WHERE deleted_at IS NULL;
    CREATE INDEX workspace_replica_observations_latest
      ON workspace_replica_observations(account_id, workspace_id, entity_id, observation_kind, observed_at DESC);
    CREATE INDEX workspace_replica_operation_summaries_phase
      ON workspace_replica_operation_summaries(account_id, workspace_id, phase, requested_at DESC);
    CREATE INDEX workspace_replica_business_events_aggregate
      ON workspace_replica_business_events(account_id, workspace_id, aggregate_kind, aggregate_id, server_revision DESC);
    CREATE INDEX workspace_replica_tombstones_purge
      ON workspace_replica_tombstones(account_id, workspace_id, purge_after);
    CREATE INDEX workspace_replica_portfolios_revision
      ON workspace_replica_portfolios(account_id, workspace_id, server_revision, portfolio_id);
    CREATE INDEX workspace_replica_observations_revision
      ON workspace_replica_observations(account_id, workspace_id, server_revision, observation_id);
    CREATE INDEX workspace_replica_operation_summaries_revision
      ON workspace_replica_operation_summaries(account_id, workspace_id, server_revision, operation_id);

    -- Future replica families are read-only until their strict wire schemas and owning
    -- materializers exist. Creating storage does not authorize generic JSON or tombstone DML.
    GRANT SELECT ON
      workspace_replica_portfolios,
      workspace_replica_observations,
      workspace_replica_dns_records,
      workspace_replica_operation_summaries,
      workspace_replica_business_events,
      workspace_replica_tombstones
      TO gooddealer_cloud_app;
  `,
};
