CREATE TABLE active_workspace_metadata (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    storage_domain TEXT NOT NULL CHECK (storage_domain = 'active_workspace'),
    workspace_id TEXT NOT NULL UNIQUE CHECK (length(workspace_id) BETWEEN 1 AND 160),
    workspace_schema_version INTEGER NOT NULL CHECK (workspace_schema_version = 1),
    applied_through_server_revision INTEGER NOT NULL CHECK (
      applied_through_server_revision BETWEEN 0 AND 9007199254740991
    ),
    last_replication_activity_at TEXT,
    last_successful_provider_observation_at TEXT
  , local_commit_sequence INTEGER NOT NULL DEFAULT 0
      CHECK (local_commit_sequence BETWEEN 0 AND 9007199254740991), next_device_mutation_sequence INTEGER NOT NULL DEFAULT 1
      CHECK (next_device_mutation_sequence BETWEEN 1 AND 9007199254740991), created_at TEXT, updated_at TEXT, last_backup_at TEXT) STRICT;
CREATE TABLE asset_valuation_observations (
    workspace_id TEXT NOT NULL,
    valuation_id TEXT NOT NULL,
    observation_run_id TEXT,
    entity_id TEXT NOT NULL,
    valuation_kind TEXT NOT NULL CHECK (valuation_kind IN ('manual', 'provider', 'sale_comparable')),
    amount_currency TEXT NOT NULL CHECK (amount_currency GLOB '[A-Z][A-Z][A-Z]'),
    amount_value TEXT NOT NULL,
    confidence_basis TEXT,
    observed_at TEXT NOT NULL,
    PRIMARY KEY (workspace_id, valuation_id),
    UNIQUE (workspace_id, observation_run_id, entity_id),
    FOREIGN KEY (workspace_id, observation_run_id)
      REFERENCES provider_observation_runs(workspace_id, observation_run_id) ON DELETE RESTRICT,
    FOREIGN KEY (workspace_id, entity_id)
      REFERENCES domain_assets(workspace_id, entity_id) ON DELETE CASCADE
    , CHECK ((valuation_kind = 'provider') = (observation_run_id IS NOT NULL))
  ) STRICT;
CREATE TABLE business_history_events (
    workspace_id TEXT NOT NULL,
    event_sequence INTEGER NOT NULL CHECK (event_sequence BETWEEN 1 AND 9007199254740991),
    event_id TEXT NOT NULL,
    aggregate_kind TEXT NOT NULL,
    aggregate_id TEXT NOT NULL,
    event_kind TEXT NOT NULL,
    actor_kind TEXT NOT NULL CHECK (actor_kind IN ('user', 'system', 'provider', 'sync', 'recovery')),
    event_payload_json TEXT NOT NULL CHECK (
      json_valid(event_payload_json) AND json_type(event_payload_json) = 'object'
      AND length(CAST(event_payload_json AS BLOB)) <= 1048576
    ),
    event_payload_sha256 TEXT NOT NULL CHECK (length(event_payload_sha256) = 64),
    occurred_at TEXT NOT NULL,
    local_commit_sequence INTEGER NOT NULL CHECK (local_commit_sequence BETWEEN 1 AND 9007199254740991),
    PRIMARY KEY (workspace_id, event_sequence),
    UNIQUE (workspace_id, event_id),
    FOREIGN KEY (workspace_id) REFERENCES active_workspace_metadata(workspace_id)
  ) STRICT;
CREATE TABLE dns_record_observations (
    workspace_id TEXT NOT NULL,
    zone_observation_id TEXT NOT NULL,
    record_key TEXT NOT NULL,
    record_type TEXT NOT NULL,
    owner_name_ascii TEXT NOT NULL,
    ttl_seconds INTEGER CHECK (ttl_seconds IS NULL OR ttl_seconds BETWEEN 1 AND 2147483647),
    priority INTEGER,
    canonical_value TEXT NOT NULL,
    proxied INTEGER CHECK (proxied IS NULL OR proxied IN (0, 1)),
    PRIMARY KEY (workspace_id, zone_observation_id, record_key),
    FOREIGN KEY (workspace_id, zone_observation_id)
      REFERENCES dns_zone_observations(workspace_id, zone_observation_id) ON DELETE CASCADE
  ) STRICT;
CREATE TABLE dns_zone_observations (
    workspace_id TEXT NOT NULL,
    zone_observation_id TEXT NOT NULL,
    observation_run_id TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    zone_name_ascii TEXT NOT NULL,
    authoritative_nameservers_json TEXT NOT NULL CHECK (json_valid(authoritative_nameservers_json) AND json_type(authoritative_nameservers_json) = 'array' AND length(CAST(authoritative_nameservers_json AS BLOB)) <= 65536),
    dnssec_status TEXT NOT NULL CHECK (dnssec_status IN ('active', 'inactive', 'unknown', 'unsupported')),
    observation_availability TEXT NOT NULL CHECK (observation_availability IN ('available', 'unavailable')),
    evidence_status TEXT NOT NULL CHECK (evidence_status IN ('confirmed', 'stale', 'conflicted', 'unknown')),
    observed_at TEXT NOT NULL,
    provider_version_token TEXT NOT NULL CHECK (length(provider_version_token) BETWEEN 1 AND 256),
    normalized_evidence_sha256 TEXT CHECK (
      normalized_evidence_sha256 IS NULL OR length(normalized_evidence_sha256) = 64
    ),
    PRIMARY KEY (workspace_id, zone_observation_id),
    UNIQUE (workspace_id, observation_run_id, entity_id),
    FOREIGN KEY (workspace_id, observation_run_id)
      REFERENCES provider_observation_runs(workspace_id, observation_run_id) ON DELETE RESTRICT,
    FOREIGN KEY (workspace_id, entity_id)
      REFERENCES domain_assets(workspace_id, entity_id) ON DELETE CASCADE
  ) STRICT;
CREATE TABLE domain_asset_desired_state (
    workspace_id TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    portfolio_id TEXT,
    note TEXT CHECK (note IS NULL OR length(note) <= 10000),
    target_price_currency TEXT,
    target_price_amount TEXT,
    desired_sale_status TEXT NOT NULL CHECK (
      desired_sale_status IN ('hold', 'available', 'listed', 'reserved', 'sold')
    ),
    desired_nameservers_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(desired_nameservers_json) AND json_type(desired_nameservers_json) = 'array' AND length(CAST(desired_nameservers_json AS BLOB)) <= 65536),
    local_commit_sequence INTEGER NOT NULL CHECK (local_commit_sequence BETWEEN 1 AND 9007199254740991),
    updated_at TEXT NOT NULL,
    PRIMARY KEY (workspace_id, entity_id),
    FOREIGN KEY (workspace_id, entity_id)
      REFERENCES domain_assets(workspace_id, entity_id) ON DELETE CASCADE,
    FOREIGN KEY (workspace_id, portfolio_id)
      REFERENCES portfolios(workspace_id, portfolio_id) ON DELETE SET NULL,
    CHECK ((target_price_currency IS NULL) = (target_price_amount IS NULL)),
    CHECK (target_price_currency IS NULL OR target_price_currency GLOB '[A-Z][A-Z][A-Z]')
  ) STRICT;
CREATE TABLE domain_asset_field_versions (
    workspace_id TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    field_path TEXT NOT NULL CHECK (field_path IN (
      'note', 'portfolioId', 'tags', 'targetPrice', 'lifecycleStatus',
      'acquiredOn', 'expiresOn', 'acquisitionCost', 'autoRenew', 'registrarLock',
      'desiredSaleStatus', 'desiredNameservers'
    )),
    server_revision INTEGER NOT NULL CHECK (server_revision BETWEEN 0 AND 9007199254740991),
    local_commit_sequence INTEGER NOT NULL CHECK (local_commit_sequence BETWEEN 0 AND 9007199254740991),
    sync_state TEXT NOT NULL CHECK (sync_state IN ('clean', 'pending', 'conflicted', 'local_only')),
    updated_at TEXT NOT NULL,
    PRIMARY KEY (workspace_id, entity_id, field_path),
    FOREIGN KEY (workspace_id, entity_id)
      REFERENCES domain_assets(workspace_id, entity_id) ON DELETE CASCADE
  ) STRICT;
CREATE TABLE domain_asset_tags (
    workspace_id TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    tag TEXT NOT NULL CHECK (length(tag) BETWEEN 1 AND 64 AND tag = trim(tag)),
    local_commit_sequence INTEGER NOT NULL CHECK (local_commit_sequence BETWEEN 1 AND 9007199254740991),
    PRIMARY KEY (workspace_id, entity_id, tag),
    FOREIGN KEY (workspace_id, entity_id)
      REFERENCES domain_assets(workspace_id, entity_id) ON DELETE CASCADE
  ) STRICT;
CREATE TABLE domain_assets (
    workspace_id TEXT NOT NULL,
    entity_id TEXT NOT NULL CHECK (
      length(entity_id) BETWEEN 3 AND 253
      AND entity_id = lower(entity_id)
      AND substr(entity_id, 1, 1) GLOB '[a-z0-9]'
      AND substr(entity_id, -1, 1) GLOB '[a-z0-9]'
      AND instr(entity_id, '.') > 1
      AND instr(entity_id, ' ') = 0
      AND entity_id NOT GLOB '*[^a-z0-9.-]*'
      AND entity_id NOT LIKE '%.%.'
      AND entity_id NOT LIKE '%..%'
      AND entity_id NOT LIKE '%.-%'
      AND entity_id NOT LIKE '%-.%'
    ),
    lifecycle_status TEXT NOT NULL CHECK (
      lifecycle_status IN ('active', 'expired', 'sold', 'dropped', 'archived')
    ),
    acquired_on TEXT,
    expires_on TEXT,
    acquisition_cost_currency TEXT,
    acquisition_cost_amount TEXT,
    auto_renew INTEGER CHECK (auto_renew IN (0, 1)),
    registrar_lock INTEGER CHECK (registrar_lock IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    local_commit_sequence INTEGER NOT NULL CHECK (local_commit_sequence BETWEEN 1 AND 9007199254740991),
    PRIMARY KEY (workspace_id, entity_id),
    FOREIGN KEY (workspace_id) REFERENCES active_workspace_metadata(workspace_id),
    CHECK ((acquisition_cost_currency IS NULL) = (acquisition_cost_amount IS NULL)),
    CHECK (acquisition_cost_currency IS NULL OR acquisition_cost_currency GLOB '[A-Z][A-Z][A-Z]'),
    CHECK (deleted_at IS NULL OR lifecycle_status = 'archived')
  ) STRICT;
CREATE TABLE local_backup_catalog (
    workspace_id TEXT NOT NULL,
    backup_id TEXT NOT NULL,
    backup_class TEXT NOT NULL CHECK (backup_class IN ('local_full', 'synchronized')),
    workspace_schema_version INTEGER NOT NULL CHECK (workspace_schema_version = 1),
    through_local_commit_sequence INTEGER NOT NULL CHECK (
      through_local_commit_sequence BETWEEN 0 AND 9007199254740991
    ),
    through_server_revision INTEGER NOT NULL CHECK (
      through_server_revision BETWEEN 0 AND 9007199254740991
    ),
    manifest_digest TEXT NOT NULL CHECK (
      length(manifest_digest) = 43
      AND manifest_digest NOT GLOB '*[^A-Za-z0-9_-]*'
    ),
    crypto_profile TEXT NOT NULL,
    storage_locator_digest TEXT NOT NULL CHECK (length(storage_locator_digest) = 64),
    status TEXT NOT NULL CHECK (status IN ('creating', 'available', 'invalid', 'superseded', 'deleted')),
    created_at TEXT NOT NULL,
    verified_at TEXT,
    deleted_at TEXT,
    retention_until TEXT,
    purge_after TEXT,
    PRIMARY KEY (workspace_id, backup_id),
    FOREIGN KEY (workspace_id) REFERENCES active_workspace_metadata(workspace_id),
    CHECK (
      (status = 'creating' AND verified_at IS NULL AND deleted_at IS NULL)
      OR (status = 'available' AND verified_at IS NOT NULL AND deleted_at IS NULL)
      OR (status = 'invalid' AND deleted_at IS NULL)
      OR (status = 'superseded' AND verified_at IS NOT NULL AND deleted_at IS NULL)
      OR (status = 'deleted' AND deleted_at IS NOT NULL)
    ),
    CHECK (purge_after IS NULL OR (retention_until IS NOT NULL AND purge_after >= retention_until))
  ) STRICT;
CREATE TABLE local_provider_connections (
    workspace_id TEXT NOT NULL,
    connection_id TEXT NOT NULL,
    provider_kind TEXT NOT NULL,
    display_label TEXT NOT NULL,
    provider_account_id TEXT,
    active_credential_changed_at TEXT NOT NULL, lifecycle_status TEXT NOT NULL DEFAULT 'active'
    CHECK (lifecycle_status IN ('active', 'invalid', 'revoked', 'deleted')), capabilities_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(capabilities_json) AND json_type(capabilities_json) = 'array' AND length(CAST(capabilities_json AS BLOB)) <= 16384), created_at TEXT, last_validated_at TEXT, validation_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (validation_status IN ('unknown', 'valid', 'invalid', 'insufficient_scope', 'unreachable')), revoked_at TEXT, deleted_at TEXT,
    PRIMARY KEY (workspace_id, connection_id),
    FOREIGN KEY (workspace_id) REFERENCES active_workspace_metadata(workspace_id)
  ) STRICT;
CREATE TABLE marketplace_listing_observations (
    workspace_id TEXT NOT NULL,
    listing_observation_id TEXT NOT NULL,
    observation_run_id TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    marketplace_kind TEXT NOT NULL,
    listing_status TEXT NOT NULL CHECK (listing_status IN (
      'unlisted', 'draft', 'active', 'reserved', 'sold', 'suspended', 'unknown'
    )),
    asking_price_currency TEXT,
    asking_price_amount TEXT,
    observed_at TEXT NOT NULL,
    provider_version_token TEXT NOT NULL CHECK (length(provider_version_token) BETWEEN 1 AND 256),
    observation_availability TEXT NOT NULL CHECK (observation_availability IN ('available', 'unavailable')),
    evidence_status TEXT NOT NULL CHECK (evidence_status IN ('confirmed', 'stale', 'conflicted', 'unknown')),
    PRIMARY KEY (workspace_id, listing_observation_id),
    UNIQUE (workspace_id, observation_run_id, entity_id),
    FOREIGN KEY (workspace_id, observation_run_id)
      REFERENCES provider_observation_runs(workspace_id, observation_run_id) ON DELETE RESTRICT,
    FOREIGN KEY (workspace_id, entity_id)
      REFERENCES domain_assets(workspace_id, entity_id) ON DELETE CASCADE,
    CHECK ((asking_price_currency IS NULL) = (asking_price_amount IS NULL))
  ) STRICT;
CREATE TABLE operation_attempts (
    workspace_id TEXT NOT NULL,
    operation_id TEXT NOT NULL,
    plan_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    attempt_number INTEGER NOT NULL CHECK (attempt_number BETWEEN 1 AND 1000),
    status TEXT NOT NULL CHECK (status IN (
      'queued', 'running', 'succeeded', 'waiting_remote', 'manual_action_required',
      'failed_retryable', 'outcome_unknown', 'failed_final', 'cancelled', 'rolled_back'
    )),
    request_digest TEXT NOT NULL CHECK (length(request_digest) = 64),
    started_at TEXT,
    completed_at TEXT,
    provider_request_id TEXT,
    error_code TEXT,
    retry_after TEXT,
    PRIMARY KEY (workspace_id, operation_id, item_id, attempt_number),
    UNIQUE (workspace_id, operation_id, plan_id, item_id, attempt_number),
    FOREIGN KEY (workspace_id, operation_id, plan_id)
      REFERENCES operations(workspace_id, operation_id, plan_id) ON DELETE CASCADE,
    FOREIGN KEY (workspace_id, plan_id, item_id)
      REFERENCES operation_plan_items(workspace_id, plan_id, item_id) ON DELETE RESTRICT,
    CHECK ((status = 'queued') = (started_at IS NULL)),
    CHECK (
      (status IN ('queued', 'running', 'waiting_remote', 'manual_action_required'))
      = (completed_at IS NULL)
    ),
    CHECK (completed_at IS NULL OR completed_at >= started_at)
  ) STRICT;
CREATE TABLE operation_plan_items (
    workspace_id TEXT NOT NULL,
    plan_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    ordinal INTEGER NOT NULL CHECK (ordinal BETWEEN 0 AND 99999),
    entity_id TEXT,
    connection_id TEXT,
    capability TEXT NOT NULL,
    field_path TEXT,
    old_value_json TEXT CHECK (old_value_json IS NULL OR (json_valid(old_value_json) AND length(CAST(old_value_json AS BLOB)) <= 1048576)),
    new_value_json TEXT CHECK (new_value_json IS NULL OR (json_valid(new_value_json) AND length(CAST(new_value_json AS BLOB)) <= 1048576)),
    precondition_json TEXT NOT NULL CHECK (json_valid(precondition_json) AND length(CAST(precondition_json AS BLOB)) <= 1048576),
    risk_level TEXT NOT NULL CHECK (risk_level IN ('standard', 'high')),
    execution_mode TEXT NOT NULL CHECK (execution_mode IN ('automatic', 'manual', 'unsupported')),
    inclusion_status TEXT NOT NULL CHECK (inclusion_status IN ('included', 'excluded', 'conflict')),
    PRIMARY KEY (workspace_id, plan_id, item_id),
    UNIQUE (workspace_id, plan_id, ordinal),
    FOREIGN KEY (workspace_id, plan_id)
      REFERENCES operation_plans(workspace_id, plan_id) ON DELETE CASCADE,
    FOREIGN KEY (workspace_id, entity_id)
      REFERENCES domain_assets(workspace_id, entity_id) ON DELETE RESTRICT,
    FOREIGN KEY (workspace_id, connection_id)
      REFERENCES local_provider_connections(workspace_id, connection_id) ON DELETE RESTRICT
  ) STRICT;
CREATE TABLE operation_plans (
    workspace_id TEXT NOT NULL,
    plan_id TEXT NOT NULL,
    operation_kind TEXT NOT NULL,
    plan_hash TEXT NOT NULL CHECK (length(plan_hash) = 64),
    title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 500),
    phase TEXT NOT NULL CHECK (phase IN (
      'planned', 'awaiting_approval', 'approved', 'cancelled', 'expired', 'executing', 'completed'
    )),
    risk_level TEXT NOT NULL CHECK (risk_level IN ('standard', 'high')),
    item_count INTEGER NOT NULL CHECK (item_count BETWEEN 1 AND 100000),
    created_at TEXT NOT NULL,
    expires_at TEXT,
    approved_at TEXT,
    cancelled_at TEXT,
    local_commit_sequence INTEGER NOT NULL CHECK (local_commit_sequence BETWEEN 1 AND 9007199254740991),
    PRIMARY KEY (workspace_id, plan_id),
    FOREIGN KEY (workspace_id) REFERENCES active_workspace_metadata(workspace_id),
    CHECK ((phase IN ('approved', 'executing', 'completed')) = (approved_at IS NOT NULL)),
    CHECK ((phase = 'cancelled') = (cancelled_at IS NOT NULL))
  ) STRICT;
CREATE TABLE operation_results (
    workspace_id TEXT NOT NULL,
    operation_id TEXT NOT NULL,
    plan_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    attempt_number INTEGER NOT NULL CHECK (attempt_number BETWEEN 1 AND 1000),
    result_version INTEGER NOT NULL CHECK (result_version BETWEEN 1 AND 9007199254740991),
    outcome TEXT NOT NULL CHECK (outcome IN (
      'succeeded', 'waiting_remote', 'manual_action_required', 'failed_retryable',
      'outcome_unknown', 'failed_final', 'cancelled', 'rolled_back'
    )),
    result_json TEXT NOT NULL CHECK (json_valid(result_json) AND length(CAST(result_json AS BLOB)) <= 1048576),
    evidence_digest TEXT,
    observed_at TEXT NOT NULL,
    PRIMARY KEY (workspace_id, operation_id, item_id, result_version),
    FOREIGN KEY (workspace_id, operation_id, plan_id, item_id, attempt_number)
      REFERENCES operation_attempts(workspace_id, operation_id, plan_id, item_id, attempt_number)
      ON DELETE RESTRICT
  ) STRICT;
CREATE TABLE operations (
    workspace_id TEXT NOT NULL,
    operation_id TEXT NOT NULL,
    plan_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    phase TEXT NOT NULL CHECK (phase IN (
      'queued', 'running', 'completed', 'partially_failed', 'cancelled', 'rolled_back'
    )),
    requested_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    local_commit_sequence INTEGER NOT NULL CHECK (local_commit_sequence BETWEEN 1 AND 9007199254740991),
    PRIMARY KEY (workspace_id, operation_id),
    UNIQUE (workspace_id, operation_id, plan_id),
    UNIQUE (workspace_id, idempotency_key),
    FOREIGN KEY (workspace_id, plan_id)
      REFERENCES operation_plans(workspace_id, plan_id) ON DELETE RESTRICT,
    CHECK ((phase = 'queued') = (started_at IS NULL)),
    CHECK ((phase IN ('completed', 'partially_failed', 'cancelled', 'rolled_back')) = (completed_at IS NOT NULL))
  ) STRICT;
CREATE TABLE portfolio_domain_assets (
    workspace_id TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    note TEXT,
    portfolio_id TEXT,
    tags_json TEXT NOT NULL CHECK (json_valid(tags_json) AND json_type(tags_json) = 'array' AND length(CAST(tags_json AS BLOB)) <= 65536),
    target_price_currency TEXT,
    target_price_amount TEXT,
    note_server_revision INTEGER NOT NULL CHECK (note_server_revision BETWEEN 0 AND 9007199254740991),
    portfolio_id_server_revision INTEGER NOT NULL CHECK (portfolio_id_server_revision BETWEEN 0 AND 9007199254740991),
    tags_server_revision INTEGER NOT NULL CHECK (tags_server_revision BETWEEN 0 AND 9007199254740991),
    target_price_server_revision INTEGER NOT NULL CHECK (target_price_server_revision BETWEEN 0 AND 9007199254740991),
    PRIMARY KEY (workspace_id, entity_id),
    CHECK ((target_price_currency IS NULL) = (target_price_amount IS NULL)),
    FOREIGN KEY (workspace_id, entity_id)
      REFERENCES domain_assets(workspace_id, entity_id) ON DELETE CASCADE
  ) STRICT;
CREATE TABLE portfolios (
    workspace_id TEXT NOT NULL,
    portfolio_id TEXT NOT NULL,
    name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
    color_token TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    local_commit_sequence INTEGER NOT NULL CHECK (local_commit_sequence BETWEEN 1 AND 9007199254740991),
    PRIMARY KEY (workspace_id, portfolio_id),
    FOREIGN KEY (workspace_id) REFERENCES active_workspace_metadata(workspace_id)
  ) STRICT;
CREATE TABLE provider_credential_versions (
    workspace_id TEXT NOT NULL,
    connection_id TEXT NOT NULL,
    credential_version INTEGER NOT NULL CHECK (credential_version BETWEEN 1 AND 9007199254740991),
    credential_kind TEXT NOT NULL,
    seal_format TEXT NOT NULL,
    key_version INTEGER NOT NULL CHECK (key_version BETWEEN 1 AND 9007199254740991),
    sealed_credential BLOB NOT NULL CHECK (length(sealed_credential) BETWEEN 1 AND 65536),
    state TEXT NOT NULL CHECK (state IN ('active', 'rotated', 'revoked', 'invalid')),
    created_at TEXT NOT NULL,
    last_validated_at TEXT,
    validation_status TEXT NOT NULL CHECK (
      validation_status IN ('unknown', 'valid', 'invalid', 'insufficient_scope', 'unreachable')
    ),
    retired_at TEXT,
    PRIMARY KEY (workspace_id, connection_id, credential_version),
    FOREIGN KEY (workspace_id, connection_id)
      REFERENCES local_provider_connections(workspace_id, connection_id) ON DELETE CASCADE,
    CHECK ((state = 'active') = (retired_at IS NULL))
  ) STRICT;
CREATE TABLE provider_observation_runs (
    workspace_id TEXT NOT NULL,
    observation_run_id TEXT NOT NULL,
    connection_id TEXT NOT NULL,
    observation_capability TEXT NOT NULL CHECK (observation_capability IN (
      'registrar', 'dns', 'marketplace', 'valuation'
    )),
    started_at TEXT NOT NULL,
    completed_at TEXT,
    status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'partial', 'failed')),
    connector_version TEXT,
    error_code TEXT,
    PRIMARY KEY (workspace_id, observation_run_id),
    FOREIGN KEY (workspace_id, connection_id)
      REFERENCES local_provider_connections(workspace_id, connection_id) ON DELETE RESTRICT,
    CHECK ((status = 'running') = (completed_at IS NULL)),
    CHECK (completed_at IS NULL OR completed_at >= started_at),
    CHECK (status != 'failed' OR error_code IS NOT NULL),
    CHECK (status != 'succeeded' OR error_code IS NULL)
  ) STRICT;
CREATE TABLE provider_observation_targets (
    workspace_id TEXT NOT NULL,
    observation_run_id TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    ordinal INTEGER NOT NULL CHECK (ordinal BETWEEN 0 AND 999999),
    status TEXT NOT NULL CHECK (status IN ('requested', 'succeeded', 'failed', 'missing')),
    error_code TEXT CHECK (error_code IS NULL OR length(error_code) BETWEEN 1 AND 160),
    requested_at TEXT NOT NULL,
    completed_at TEXT,
    PRIMARY KEY (workspace_id, observation_run_id, entity_id),
    UNIQUE (workspace_id, observation_run_id, ordinal),
    FOREIGN KEY (workspace_id, observation_run_id)
      REFERENCES provider_observation_runs(workspace_id, observation_run_id) ON DELETE RESTRICT,
    FOREIGN KEY (workspace_id, entity_id)
      REFERENCES domain_assets(workspace_id, entity_id) ON DELETE CASCADE,
    CHECK ((status = 'requested') = (completed_at IS NULL)),
    CHECK ((status = 'failed') = (error_code IS NOT NULL)),
    CHECK (completed_at IS NULL OR completed_at >= requested_at)
  ) STRICT;
CREATE TABLE registrar_observations (
    workspace_id TEXT NOT NULL,
    observation_id TEXT NOT NULL,
    observation_run_id TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    registrar_name TEXT,
    registered_on TEXT,
    expires_on TEXT,
    auto_renew INTEGER CHECK (auto_renew IN (0, 1)),
    registrar_lock INTEGER CHECK (registrar_lock IN (0, 1)),
    observation_availability TEXT NOT NULL CHECK (observation_availability IN ('available', 'unavailable')),
    evidence_status TEXT NOT NULL CHECK (evidence_status IN ('confirmed', 'stale', 'conflicted', 'unknown')),
    observed_at TEXT NOT NULL,
    provider_version_token TEXT NOT NULL CHECK (length(provider_version_token) BETWEEN 1 AND 256),
    normalized_evidence_sha256 TEXT CHECK (
      normalized_evidence_sha256 IS NULL OR length(normalized_evidence_sha256) = 64
    ),
    PRIMARY KEY (workspace_id, observation_id),
    UNIQUE (workspace_id, observation_run_id, entity_id),
    FOREIGN KEY (workspace_id, observation_run_id)
      REFERENCES provider_observation_runs(workspace_id, observation_run_id) ON DELETE RESTRICT,
    FOREIGN KEY (workspace_id, entity_id)
      REFERENCES domain_assets(workspace_id, entity_id) ON DELETE CASCADE
  ) STRICT;
CREATE TABLE sync_conflicts (
    workspace_id TEXT NOT NULL,
    conflict_id TEXT NOT NULL,
    entity_kind TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    field_path TEXT NOT NULL,
    local_value_json TEXT NOT NULL CHECK (json_valid(local_value_json) AND length(CAST(local_value_json AS BLOB)) <= 1048576),
    remote_value_json TEXT NOT NULL CHECK (json_valid(remote_value_json) AND length(CAST(remote_value_json AS BLOB)) <= 1048576),
    local_commit_sequence INTEGER NOT NULL CHECK (local_commit_sequence BETWEEN 1 AND 9007199254740991),
    remote_server_revision INTEGER NOT NULL CHECK (remote_server_revision BETWEEN 1 AND 9007199254740991),
    status TEXT NOT NULL CHECK (status IN ('open', 'resolved_local', 'resolved_remote', 'resolved_custom', 'discarded')),
    created_at TEXT NOT NULL,
    resolved_at TEXT,
    resolution_value_json TEXT CHECK (resolution_value_json IS NULL OR (json_valid(resolution_value_json) AND length(CAST(resolution_value_json AS BLOB)) <= 1048576)),
    PRIMARY KEY (workspace_id, conflict_id),
    UNIQUE (workspace_id, entity_kind, entity_id, field_path, remote_server_revision),
    CHECK ((status = 'open') = (resolved_at IS NULL)),
    CHECK ((status = 'resolved_custom') = (resolution_value_json IS NOT NULL)),
    FOREIGN KEY (workspace_id) REFERENCES active_workspace_metadata(workspace_id)
  ) STRICT;
CREATE TABLE sync_inbox (
    workspace_id TEXT NOT NULL,
    server_revision INTEGER NOT NULL CHECK (server_revision BETWEEN 1 AND 9007199254740991),
    mutation_id TEXT NOT NULL,
    workspace_schema_version INTEGER NOT NULL CHECK (workspace_schema_version BETWEEN 1 AND 9007199254740991),
    entity_kind TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    operation_kind TEXT NOT NULL CHECK (operation_kind IN ('upsert', 'delete')),
    source_device_id TEXT NOT NULL,
    base_server_revision INTEGER NOT NULL CHECK (base_server_revision BETWEEN 0 AND 9007199254740991),
    mutation_payload_json TEXT NOT NULL CHECK (
      json_valid(mutation_payload_json) AND json_type(mutation_payload_json) = 'object'
      AND length(CAST(mutation_payload_json AS BLOB)) <= 1048576
    ),
    mutation_payload_sha256 TEXT NOT NULL CHECK (length(mutation_payload_sha256) = 64),
    state TEXT NOT NULL CHECK (state IN ('received', 'validated', 'applied', 'conflicted', 'rejected')),
    received_at TEXT NOT NULL,
    applied_at TEXT,
    rejection_code TEXT,
    PRIMARY KEY (workspace_id, server_revision),
    UNIQUE (workspace_id, mutation_id),
    FOREIGN KEY (workspace_id) REFERENCES active_workspace_metadata(workspace_id),
    CHECK ((state = 'applied') = (applied_at IS NOT NULL)),
    CHECK ((state = 'rejected') = (rejection_code IS NOT NULL))
  ) STRICT;
CREATE TABLE sync_outbox (
    workspace_id TEXT NOT NULL,
    mutation_id TEXT NOT NULL,
    entity_kind TEXT NOT NULL CHECK (entity_kind IN ('domain_asset')),
    entity_id TEXT NOT NULL,
    mutation_payload_json TEXT NOT NULL CHECK (
      json_valid(mutation_payload_json) AND json_type(mutation_payload_json) = 'object'
      AND length(CAST(mutation_payload_json AS BLOB)) <= 1048576
    ),
    created_at TEXT NOT NULL,
    acknowledged_at TEXT, workspace_schema_version INTEGER NOT NULL DEFAULT 1
    CHECK (workspace_schema_version BETWEEN 1 AND 9007199254740991), operation_kind TEXT NOT NULL DEFAULT 'upsert'
    CHECK (operation_kind IN ('upsert', 'delete')), base_server_revision INTEGER NOT NULL DEFAULT 0
    CHECK (base_server_revision BETWEEN 0 AND 9007199254740991), local_commit_sequence INTEGER NOT NULL DEFAULT 0
    CHECK (local_commit_sequence BETWEEN 0 AND 9007199254740991), source_device_id TEXT, active_lease_epoch INTEGER
    CHECK (active_lease_epoch IS NULL OR active_lease_epoch BETWEEN 1 AND 9007199254740991), device_mutation_sequence INTEGER
    CHECK (device_mutation_sequence IS NULL OR device_mutation_sequence BETWEEN 1 AND 9007199254740991), payload_schema_version INTEGER NOT NULL DEFAULT 1
    CHECK (payload_schema_version BETWEEN 1 AND 9007199254740991), mutation_payload_sha256 TEXT
    CHECK (mutation_payload_sha256 IS NULL OR length(mutation_payload_sha256) = 64), state TEXT NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'sending', 'acknowledged', 'conflicted', 'rejected')), attempt_count INTEGER NOT NULL DEFAULT 0
    CHECK (attempt_count BETWEEN 0 AND 1000000), next_attempt_at TEXT, last_error_code TEXT, server_revision INTEGER
    CHECK (server_revision IS NULL OR server_revision BETWEEN 1 AND 9007199254740991),
    PRIMARY KEY (workspace_id, mutation_id),
    FOREIGN KEY (workspace_id) REFERENCES active_workspace_metadata(workspace_id),
    CHECK ((state = 'acknowledged') = (acknowledged_at IS NOT NULL)),
    CHECK ((state = 'acknowledged') = (server_revision IS NOT NULL))
  ) STRICT;
CREATE TABLE sync_outbox_fields (
    workspace_id TEXT NOT NULL,
    mutation_id TEXT NOT NULL,
    ordinal INTEGER NOT NULL CHECK (ordinal BETWEEN 0 AND 255),
    field_path TEXT NOT NULL CHECK (field_path IN ('note', 'portfolioId', 'tags', 'targetPrice')),
    field_value_json TEXT NOT NULL CHECK (json_valid(field_value_json) AND length(CAST(field_value_json AS BLOB)) <= 1048576),
    field_value_sha256 TEXT NOT NULL CHECK (length(field_value_sha256) = 64),
    PRIMARY KEY (workspace_id, mutation_id, ordinal),
    UNIQUE (workspace_id, mutation_id, field_path),
    FOREIGN KEY (workspace_id, mutation_id)
      REFERENCES sync_outbox(workspace_id, mutation_id) ON DELETE CASCADE
  ) STRICT;
CREATE TABLE sync_reader_state (
    workspace_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    cursor_generation INTEGER NOT NULL CHECK (cursor_generation BETWEEN 1 AND 9007199254740991),
    read_through_server_revision INTEGER NOT NULL CHECK (read_through_server_revision BETWEEN 0 AND 9007199254740991),
    pinned_target_server_revision INTEGER,
    continuation_token TEXT,
    checkpoint_id TEXT,
    checkpoint_through_server_revision INTEGER,
    status TEXT NOT NULL CHECK (status IN ('active', 'rebootstrap_required', 'retired')),
    updated_at TEXT NOT NULL,
    PRIMARY KEY (workspace_id, device_id),
    FOREIGN KEY (workspace_id) REFERENCES active_workspace_metadata(workspace_id),
    CHECK ((checkpoint_id IS NULL) = (checkpoint_through_server_revision IS NULL)),
    CHECK (status = 'active' OR continuation_token IS NULL)
  ) STRICT;
CREATE TABLE sync_tombstones (
    workspace_id TEXT NOT NULL,
    entity_kind TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    deleted_local_commit_sequence INTEGER NOT NULL CHECK (
      deleted_local_commit_sequence BETWEEN 1 AND 9007199254740991
    ),
    deleted_server_revision INTEGER CHECK (
      deleted_server_revision IS NULL OR deleted_server_revision BETWEEN 1 AND 9007199254740991
    ),
    deleted_at TEXT NOT NULL,
    purge_after TEXT,
    state TEXT NOT NULL CHECK (state IN ('pending', 'acknowledged', 'replicated', 'purge_eligible')),
    PRIMARY KEY (workspace_id, entity_kind, entity_id),
    FOREIGN KEY (workspace_id) REFERENCES active_workspace_metadata(workspace_id),
    CHECK (
      state != 'purge_eligible'
      OR (deleted_server_revision IS NOT NULL AND purge_after IS NOT NULL)
    )
  ) STRICT;
CREATE TRIGGER business_history_events_no_update
BEFORE UPDATE ON business_history_events
BEGIN
  SELECT RAISE(ABORT, 'business history is append-only');
END;
CREATE TRIGGER domain_assets_validate_labels_insert
BEFORE INSERT ON domain_assets
WHEN EXISTS (
  WITH RECURSIVE labels(label, rest) AS (
    SELECT '', NEW.entity_id || '.'
    UNION ALL
    SELECT substr(rest, 1, instr(rest, '.') - 1), substr(rest, instr(rest, '.') + 1)
    FROM labels WHERE rest != ''
  )
  SELECT 1 FROM labels WHERE label != '' AND length(label) > 63
)
BEGIN SELECT RAISE(ABORT, 'domain label exceeds 63 bytes'); END;
CREATE TRIGGER domain_assets_validate_labels_update
BEFORE UPDATE OF entity_id ON domain_assets
WHEN EXISTS (
  WITH RECURSIVE labels(label, rest) AS (
    SELECT '', NEW.entity_id || '.'
    UNION ALL
    SELECT substr(rest, 1, instr(rest, '.') - 1), substr(rest, instr(rest, '.') + 1)
    FROM labels WHERE rest != ''
  )
  SELECT 1 FROM labels WHERE label != '' AND length(label) > 63
)
BEGIN SELECT RAISE(ABORT, 'domain label exceeds 63 bytes'); END;
CREATE TRIGGER business_history_events_no_delete
BEFORE DELETE ON business_history_events
BEGIN
  SELECT RAISE(ABORT, 'business history is append-only');
END;
CREATE TRIGGER active_workspace_metadata_identity_immutable
BEFORE UPDATE OF singleton, storage_domain, workspace_id, workspace_schema_version
ON active_workspace_metadata
BEGIN
  SELECT RAISE(ABORT, 'active workspace identity is immutable');
END;
CREATE TRIGGER active_workspace_metadata_no_delete
BEFORE DELETE ON active_workspace_metadata
BEGIN
  SELECT RAISE(ABORT, 'active workspace identity is permanent');
END;
CREATE TRIGGER dns_zone_observations_require_dns_observation_capability_insert
BEFORE INSERT ON dns_zone_observations
WHEN NOT EXISTS (
  SELECT 1 FROM provider_observation_runs
  WHERE workspace_id = NEW.workspace_id AND observation_run_id = NEW.observation_run_id
    AND observation_capability = 'dns' AND status = 'running'
    AND EXISTS (
      SELECT 1 FROM provider_observation_targets
      WHERE workspace_id = NEW.workspace_id
        AND observation_run_id = NEW.observation_run_id
        AND entity_id = NEW.entity_id AND status = 'requested'
    )
)
BEGIN SELECT RAISE(ABORT, 'DNS observation requires a DNS run'); END;
CREATE TRIGGER dns_zone_observations_require_dns_observation_capability_update
BEFORE UPDATE OF observation_run_id ON dns_zone_observations
WHEN NOT EXISTS (
  SELECT 1 FROM provider_observation_runs
  WHERE workspace_id = NEW.workspace_id AND observation_run_id = NEW.observation_run_id
    AND observation_capability = 'dns'
)
BEGIN SELECT RAISE(ABORT, 'DNS observation requires a DNS run'); END;
CREATE TRIGGER registrar_observations_require_registrar_observation_capability_insert
BEFORE INSERT ON registrar_observations
WHEN NOT EXISTS (
  SELECT 1 FROM provider_observation_runs
  WHERE workspace_id = NEW.workspace_id AND observation_run_id = NEW.observation_run_id
    AND observation_capability = 'registrar' AND status = 'running'
    AND EXISTS (
      SELECT 1 FROM provider_observation_targets
      WHERE workspace_id = NEW.workspace_id
        AND observation_run_id = NEW.observation_run_id
        AND entity_id = NEW.entity_id AND status = 'requested'
    )
)
BEGIN SELECT RAISE(ABORT, 'registrar observation requires a registrar run'); END;
CREATE TRIGGER registrar_observations_require_registrar_observation_capability_update
BEFORE UPDATE OF observation_run_id ON registrar_observations
WHEN NOT EXISTS (
  SELECT 1 FROM provider_observation_runs
  WHERE workspace_id = NEW.workspace_id AND observation_run_id = NEW.observation_run_id
    AND observation_capability = 'registrar'
)
BEGIN SELECT RAISE(ABORT, 'registrar observation requires a registrar run'); END;
CREATE TRIGGER marketplace_observations_require_marketplace_observation_capability_insert
BEFORE INSERT ON marketplace_listing_observations
WHEN NOT EXISTS (
  SELECT 1 FROM provider_observation_runs
  WHERE workspace_id = NEW.workspace_id AND observation_run_id = NEW.observation_run_id
    AND observation_capability = 'marketplace' AND status = 'running'
    AND EXISTS (
      SELECT 1 FROM provider_observation_targets
      WHERE workspace_id = NEW.workspace_id
        AND observation_run_id = NEW.observation_run_id
        AND entity_id = NEW.entity_id AND status = 'requested'
    )
)
BEGIN SELECT RAISE(ABORT, 'marketplace observation requires a marketplace run'); END;
CREATE TRIGGER marketplace_observations_require_marketplace_observation_capability_update
BEFORE UPDATE OF observation_run_id ON marketplace_listing_observations
WHEN NOT EXISTS (
  SELECT 1 FROM provider_observation_runs
  WHERE workspace_id = NEW.workspace_id AND observation_run_id = NEW.observation_run_id
    AND observation_capability = 'marketplace'
)
BEGIN SELECT RAISE(ABORT, 'marketplace observation requires a marketplace run'); END;
CREATE TRIGGER valuation_observations_require_valuation_observation_capability_insert
BEFORE INSERT ON asset_valuation_observations
WHEN NEW.valuation_kind = 'provider' AND NOT EXISTS (
  SELECT 1 FROM provider_observation_runs
  WHERE workspace_id = NEW.workspace_id AND observation_run_id = NEW.observation_run_id
    AND observation_capability = 'valuation' AND status = 'running'
    AND EXISTS (
      SELECT 1 FROM provider_observation_targets
      WHERE workspace_id = NEW.workspace_id
        AND observation_run_id = NEW.observation_run_id
        AND entity_id = NEW.entity_id AND status = 'requested'
    )
)
BEGIN SELECT RAISE(ABORT, 'provider valuation requires a valuation run'); END;
CREATE TRIGGER valuation_observations_require_valuation_observation_capability_update
BEFORE UPDATE OF observation_run_id ON asset_valuation_observations
WHEN NEW.observation_run_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM provider_observation_runs
  WHERE workspace_id = NEW.workspace_id AND observation_run_id = NEW.observation_run_id
    AND observation_capability = 'valuation'
)
BEGIN SELECT RAISE(ABORT, 'provider valuation requires a valuation run'); END;
CREATE TRIGGER provider_observation_runs_start_running
BEFORE INSERT ON provider_observation_runs
WHEN NEW.status != 'running'
BEGIN SELECT RAISE(ABORT, 'provider observation run must start running'); END;
CREATE TRIGGER provider_observation_runs_require_declared_observation_capability
BEFORE INSERT ON provider_observation_runs
WHEN NOT EXISTS (
  SELECT 1
  FROM local_provider_connections AS account, json_each(account.capabilities_json) AS declared
  WHERE account.workspace_id = NEW.workspace_id
    AND account.connection_id = NEW.connection_id
    AND account.lifecycle_status = 'active'
    AND declared.type = 'text' AND declared.value = NEW.observation_capability
)
BEGIN SELECT RAISE(ABORT, 'provider observation capability is not declared by the connection'); END;
CREATE TRIGGER provider_observation_runs_freeze_identity
BEFORE UPDATE ON provider_observation_runs
WHEN NEW.workspace_id IS NOT OLD.workspace_id
  OR NEW.observation_run_id IS NOT OLD.observation_run_id
  OR NEW.connection_id IS NOT OLD.connection_id
  OR NEW.observation_capability IS NOT OLD.observation_capability
  OR NEW.started_at IS NOT OLD.started_at
  OR NEW.connector_version IS NOT OLD.connector_version
BEGIN SELECT RAISE(ABORT, 'provider observation run identity is immutable'); END;
CREATE TRIGGER provider_observation_runs_no_update_after_completion
BEFORE UPDATE ON provider_observation_runs
WHEN OLD.status != 'running'
BEGIN SELECT RAISE(ABORT, 'completed provider observation run is immutable'); END;
CREATE TRIGGER provider_observation_runs_validate_completion
BEFORE UPDATE ON provider_observation_runs
WHEN OLD.status = 'running' AND NEW.status != 'running' AND (
  NEW.completed_at IS NULL
  OR NOT EXISTS (
    SELECT 1 FROM provider_observation_targets
    WHERE workspace_id = OLD.workspace_id
      AND observation_run_id = OLD.observation_run_id
  )
  OR EXISTS (
    SELECT 1 FROM provider_observation_targets
    WHERE workspace_id = OLD.workspace_id
      AND observation_run_id = OLD.observation_run_id
      AND status = 'requested'
  )
  OR (NEW.status = 'succeeded' AND EXISTS (
    SELECT 1 FROM provider_observation_targets
    WHERE workspace_id = OLD.workspace_id
      AND observation_run_id = OLD.observation_run_id
      AND status != 'succeeded'
  ))
  OR (NEW.status = 'failed' AND EXISTS (
    SELECT 1 FROM provider_observation_targets
    WHERE workspace_id = OLD.workspace_id
      AND observation_run_id = OLD.observation_run_id
      AND status = 'succeeded'
  ))
  OR (NEW.status = 'partial' AND (
    NOT EXISTS (
      SELECT 1 FROM provider_observation_targets
      WHERE workspace_id = OLD.workspace_id
        AND observation_run_id = OLD.observation_run_id
        AND status = 'succeeded'
    )
    OR NOT EXISTS (
      SELECT 1 FROM provider_observation_targets
      WHERE workspace_id = OLD.workspace_id
        AND observation_run_id = OLD.observation_run_id
        AND status IN ('failed', 'missing')
    )
  ))
)
BEGIN SELECT RAISE(ABORT, 'provider observation run outcome conflicts with targets'); END;
CREATE TRIGGER provider_observation_runs_no_delete
BEFORE DELETE ON provider_observation_runs
BEGIN SELECT RAISE(ABORT, 'provider observation run history is append-only'); END;
CREATE TRIGGER provider_observation_targets_start_requested
BEFORE INSERT ON provider_observation_targets
WHEN NEW.status != 'requested'
BEGIN SELECT RAISE(ABORT, 'provider observation target must start requested'); END;
CREATE TRIGGER provider_observation_targets_require_running_run
BEFORE INSERT ON provider_observation_targets
WHEN NOT EXISTS (
  SELECT 1 FROM provider_observation_runs
  WHERE workspace_id = NEW.workspace_id
    AND observation_run_id = NEW.observation_run_id
    AND status = 'running'
)
BEGIN SELECT RAISE(ABORT, 'provider observation target requires a running run'); END;
CREATE TRIGGER provider_observation_targets_freeze_identity
BEFORE UPDATE ON provider_observation_targets
WHEN NEW.workspace_id IS NOT OLD.workspace_id
  OR NEW.observation_run_id IS NOT OLD.observation_run_id
  OR NEW.entity_id IS NOT OLD.entity_id
  OR NEW.ordinal IS NOT OLD.ordinal
  OR NEW.requested_at IS NOT OLD.requested_at
BEGIN SELECT RAISE(ABORT, 'provider observation target identity is immutable'); END;
CREATE TRIGGER provider_observation_targets_validate_completion
BEFORE UPDATE ON provider_observation_targets
WHEN OLD.status = 'requested' AND NEW.status != 'requested' AND (
  (NEW.status = 'succeeded' AND NOT EXISTS (
    SELECT 1
    FROM provider_observation_runs AS run
    WHERE run.workspace_id = OLD.workspace_id
      AND run.observation_run_id = OLD.observation_run_id
      AND (
        (run.observation_capability = 'dns' AND EXISTS (
          SELECT 1 FROM dns_zone_observations
          WHERE workspace_id = OLD.workspace_id
            AND observation_run_id = OLD.observation_run_id
            AND entity_id = OLD.entity_id
        ))
        OR (run.observation_capability = 'registrar' AND EXISTS (
          SELECT 1 FROM registrar_observations
          WHERE workspace_id = OLD.workspace_id
            AND observation_run_id = OLD.observation_run_id
            AND entity_id = OLD.entity_id
        ))
        OR (run.observation_capability = 'marketplace' AND EXISTS (
          SELECT 1 FROM marketplace_listing_observations
          WHERE workspace_id = OLD.workspace_id
            AND observation_run_id = OLD.observation_run_id
            AND entity_id = OLD.entity_id
        ))
        OR (run.observation_capability = 'valuation' AND EXISTS (
          SELECT 1 FROM asset_valuation_observations
          WHERE workspace_id = OLD.workspace_id
            AND observation_run_id = OLD.observation_run_id
            AND entity_id = OLD.entity_id
        ))
      )
  ))
  OR (NEW.status IN ('failed', 'missing') AND (
    EXISTS (
      SELECT 1 FROM dns_zone_observations
      WHERE workspace_id = OLD.workspace_id
        AND observation_run_id = OLD.observation_run_id AND entity_id = OLD.entity_id
    )
    OR EXISTS (
      SELECT 1 FROM registrar_observations
      WHERE workspace_id = OLD.workspace_id
        AND observation_run_id = OLD.observation_run_id AND entity_id = OLD.entity_id
    )
    OR EXISTS (
      SELECT 1 FROM marketplace_listing_observations
      WHERE workspace_id = OLD.workspace_id
        AND observation_run_id = OLD.observation_run_id AND entity_id = OLD.entity_id
    )
    OR EXISTS (
      SELECT 1 FROM asset_valuation_observations
      WHERE workspace_id = OLD.workspace_id
        AND observation_run_id = OLD.observation_run_id AND entity_id = OLD.entity_id
    )
  ))
)
BEGIN SELECT RAISE(ABORT, 'provider observation target outcome conflicts with evidence'); END;
CREATE TRIGGER provider_observation_targets_no_update_after_completion
BEFORE UPDATE ON provider_observation_targets
WHEN OLD.status != 'requested'
BEGIN SELECT RAISE(ABORT, 'completed provider observation target is immutable'); END;
CREATE TRIGGER provider_observation_targets_no_delete
BEFORE DELETE ON provider_observation_targets
WHEN EXISTS (SELECT 1 FROM domain_assets
  WHERE workspace_id = OLD.workspace_id AND entity_id = OLD.entity_id)
BEGIN SELECT RAISE(ABORT, 'provider observation target history is append-only'); END;
CREATE TRIGGER dns_zone_observations_no_update
BEFORE UPDATE ON dns_zone_observations
BEGIN SELECT RAISE(ABORT, 'DNS observations are append-only'); END;
CREATE TRIGGER dns_zone_observations_no_delete
BEFORE DELETE ON dns_zone_observations
WHEN EXISTS (SELECT 1 FROM domain_assets
  WHERE workspace_id = OLD.workspace_id AND entity_id = OLD.entity_id)
BEGIN SELECT RAISE(ABORT, 'DNS observations are append-only'); END;
CREATE TRIGGER registrar_observations_no_update
BEFORE UPDATE ON registrar_observations
BEGIN SELECT RAISE(ABORT, 'registrar observations are append-only'); END;
CREATE TRIGGER registrar_observations_no_delete
BEFORE DELETE ON registrar_observations
WHEN EXISTS (SELECT 1 FROM domain_assets
  WHERE workspace_id = OLD.workspace_id AND entity_id = OLD.entity_id)
BEGIN SELECT RAISE(ABORT, 'registrar observations are append-only'); END;
CREATE TRIGGER marketplace_observations_no_update
BEFORE UPDATE ON marketplace_listing_observations
BEGIN SELECT RAISE(ABORT, 'marketplace observations are append-only'); END;
CREATE TRIGGER marketplace_observations_no_delete
BEFORE DELETE ON marketplace_listing_observations
WHEN EXISTS (SELECT 1 FROM domain_assets
  WHERE workspace_id = OLD.workspace_id AND entity_id = OLD.entity_id)
BEGIN SELECT RAISE(ABORT, 'marketplace observations are append-only'); END;
CREATE TRIGGER valuation_observations_no_update
BEFORE UPDATE ON asset_valuation_observations
BEGIN SELECT RAISE(ABORT, 'valuation observations are append-only'); END;
CREATE TRIGGER valuation_observations_no_delete
BEFORE DELETE ON asset_valuation_observations
WHEN EXISTS (SELECT 1 FROM domain_assets
  WHERE workspace_id = OLD.workspace_id AND entity_id = OLD.entity_id)
BEGIN SELECT RAISE(ABORT, 'valuation observations are append-only'); END;
CREATE TRIGGER operation_plans_freeze_approved_fields
BEFORE UPDATE ON operation_plans
WHEN OLD.phase IN ('approved', 'executing', 'completed') AND (
  NEW.workspace_id IS NOT OLD.workspace_id OR NEW.plan_id IS NOT OLD.plan_id
  OR NEW.operation_kind IS NOT OLD.operation_kind OR NEW.plan_hash IS NOT OLD.plan_hash
  OR NEW.title IS NOT OLD.title OR NEW.risk_level IS NOT OLD.risk_level
  OR NEW.item_count IS NOT OLD.item_count OR NEW.created_at IS NOT OLD.created_at
  OR NEW.expires_at IS NOT OLD.expires_at OR NEW.approved_at IS NOT OLD.approved_at
)
BEGIN
  SELECT RAISE(ABORT, 'approved operation plan is immutable');
END;
CREATE TRIGGER operation_plans_require_approval_transition
BEFORE INSERT ON operation_plans
WHEN NEW.phase IN ('approved', 'executing', 'completed')
BEGIN
  SELECT RAISE(ABORT, 'operation plan approval requires a validated transition');
END;
CREATE TRIGGER operation_plans_reject_skipped_approval
BEFORE UPDATE OF phase ON operation_plans
WHEN OLD.phase NOT IN ('approved', 'executing', 'completed')
  AND NEW.phase IN ('executing', 'completed')
BEGIN
  SELECT RAISE(ABORT, 'operation plan cannot skip the approved phase');
END;
CREATE TRIGGER operation_plan_items_no_update_after_approval
BEFORE UPDATE ON operation_plan_items
WHEN EXISTS (
  SELECT 1 FROM operation_plans
  WHERE workspace_id = OLD.workspace_id AND plan_id = OLD.plan_id
    AND phase IN ('approved', 'executing', 'completed')
)
BEGIN
  SELECT RAISE(ABORT, 'approved operation plan items are immutable');
END;
CREATE TRIGGER operation_plan_items_no_insert_after_approval
BEFORE INSERT ON operation_plan_items
WHEN EXISTS (
  SELECT 1 FROM operation_plans
  WHERE workspace_id = NEW.workspace_id AND plan_id = NEW.plan_id
    AND phase IN ('approved', 'executing', 'completed')
)
BEGIN
  SELECT RAISE(ABORT, 'approved operation plan items are immutable');
END;
CREATE TRIGGER operation_plan_items_no_delete_after_approval
BEFORE DELETE ON operation_plan_items
WHEN EXISTS (
  SELECT 1 FROM operation_plans
  WHERE workspace_id = OLD.workspace_id AND plan_id = OLD.plan_id
    AND phase IN ('approved', 'executing', 'completed')
)
BEGIN
  SELECT RAISE(ABORT, 'approved operation plan items are immutable');
END;
CREATE TRIGGER operation_plans_no_delete_after_approval
BEFORE DELETE ON operation_plans
WHEN OLD.phase IN ('approved', 'executing', 'completed')
BEGIN
  SELECT RAISE(ABORT, 'approved operation plan is immutable');
END;
CREATE TRIGGER operation_plans_validate_approval_set
BEFORE UPDATE ON operation_plans
WHEN NEW.phase = 'approved' AND OLD.phase NOT IN ('approved', 'executing', 'completed') AND (
  (SELECT count(*) FROM operation_plan_items WHERE workspace_id = NEW.workspace_id AND plan_id = NEW.plan_id) != NEW.item_count
  OR (SELECT min(ordinal) FROM operation_plan_items WHERE workspace_id = NEW.workspace_id AND plan_id = NEW.plan_id) != 0
  OR (SELECT max(ordinal) FROM operation_plan_items WHERE workspace_id = NEW.workspace_id AND plan_id = NEW.plan_id) != NEW.item_count - 1
  OR EXISTS (
    SELECT 1 FROM operation_plan_items
    WHERE workspace_id = NEW.workspace_id AND plan_id = NEW.plan_id
      AND inclusion_status = 'included' AND execution_mode = 'automatic'
      AND (entity_id IS NULL OR connection_id IS NULL)
  )
)
BEGIN
  SELECT RAISE(ABORT, 'operation plan approval set is incomplete');
END;
CREATE TRIGGER operations_require_approved_plan
BEFORE INSERT ON operations
WHEN NOT EXISTS (
  SELECT 1 FROM operation_plans
  WHERE workspace_id = NEW.workspace_id AND plan_id = NEW.plan_id
    AND phase = 'approved' AND approved_at IS NOT NULL
    AND (expires_at IS NULL OR expires_at > NEW.requested_at)
)
BEGIN
  SELECT RAISE(ABORT, 'operation requires an approved unexpired plan');
END;
CREATE TRIGGER operations_require_complete_approval_set
BEFORE INSERT ON operations
WHEN
  (SELECT count(*) FROM operation_plan_items
   WHERE workspace_id = NEW.workspace_id AND plan_id = NEW.plan_id)
    != (SELECT item_count FROM operation_plans
        WHERE workspace_id = NEW.workspace_id AND plan_id = NEW.plan_id)
  OR (SELECT min(ordinal) FROM operation_plan_items
      WHERE workspace_id = NEW.workspace_id AND plan_id = NEW.plan_id) != 0
  OR (SELECT max(ordinal) FROM operation_plan_items
      WHERE workspace_id = NEW.workspace_id AND plan_id = NEW.plan_id)
    != (SELECT item_count - 1 FROM operation_plans
        WHERE workspace_id = NEW.workspace_id AND plan_id = NEW.plan_id)
  OR EXISTS (
    SELECT 1 FROM operation_plan_items
    WHERE workspace_id = NEW.workspace_id AND plan_id = NEW.plan_id
      AND inclusion_status = 'included' AND execution_mode = 'automatic'
      AND (entity_id IS NULL OR connection_id IS NULL)
  )
BEGIN
  SELECT RAISE(ABORT, 'operation requires the complete approved item set');
END;
CREATE TRIGGER operations_freeze_plan
BEFORE UPDATE OF plan_id ON operations
WHEN NEW.plan_id IS NOT OLD.plan_id
BEGIN
  SELECT RAISE(ABORT, 'operation plan binding is immutable');
END;
CREATE TRIGGER operation_attempts_require_contiguous_retry
BEFORE INSERT ON operation_attempts
WHEN
  (NEW.attempt_number = 1 AND EXISTS (
    SELECT 1 FROM operation_attempts
    WHERE workspace_id = NEW.workspace_id AND operation_id = NEW.operation_id
      AND item_id = NEW.item_id
  ))
  OR (NEW.attempt_number > 1 AND NOT EXISTS (
    SELECT 1 FROM operation_attempts
    WHERE workspace_id = NEW.workspace_id AND operation_id = NEW.operation_id
      AND item_id = NEW.item_id AND attempt_number = NEW.attempt_number - 1
      AND status = 'failed_retryable'
  ))
  OR (NEW.attempt_number > 1 AND NOT EXISTS (
    SELECT 1 FROM operation_results
    WHERE workspace_id = NEW.workspace_id AND operation_id = NEW.operation_id
      AND item_id = NEW.item_id AND attempt_number = NEW.attempt_number - 1
      AND outcome = 'failed_retryable'
  ))
  OR EXISTS (
    SELECT 1 FROM operation_attempts
    WHERE workspace_id = NEW.workspace_id AND operation_id = NEW.operation_id
      AND item_id = NEW.item_id AND status = 'outcome_unknown'
  )
BEGIN
  SELECT RAISE(ABORT, 'operation retry requires the immediately prior retryable failure');
END;
CREATE TRIGGER operation_attempts_freeze_identity_and_request
BEFORE UPDATE ON operation_attempts
WHEN NEW.workspace_id IS NOT OLD.workspace_id
  OR NEW.operation_id IS NOT OLD.operation_id
  OR NEW.plan_id IS NOT OLD.plan_id
  OR NEW.item_id IS NOT OLD.item_id
  OR NEW.attempt_number IS NOT OLD.attempt_number
  OR NEW.request_digest IS NOT OLD.request_digest
BEGIN SELECT RAISE(ABORT, 'operation attempt request identity is immutable'); END;
CREATE TRIGGER operation_attempts_no_update_after_completion
BEFORE UPDATE ON operation_attempts
WHEN OLD.completed_at IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'completed operation attempt is immutable'); END;
CREATE TRIGGER operation_attempts_no_delete
BEFORE DELETE ON operation_attempts
BEGIN SELECT RAISE(ABORT, 'operation attempts are append-only'); END;
CREATE TRIGGER operation_results_no_update
BEFORE UPDATE ON operation_results
BEGIN SELECT RAISE(ABORT, 'operation results are append-only'); END;
CREATE TRIGGER operation_results_no_delete
BEFORE DELETE ON operation_results
BEGIN SELECT RAISE(ABORT, 'operation results are append-only'); END;
CREATE TRIGGER operation_results_match_attempt_outcome
BEFORE INSERT ON operation_results
WHEN NOT EXISTS (
  SELECT 1 FROM operation_attempts
  WHERE workspace_id = NEW.workspace_id AND operation_id = NEW.operation_id
    AND plan_id = NEW.plan_id AND item_id = NEW.item_id
    AND attempt_number = NEW.attempt_number AND status = NEW.outcome
)
BEGIN SELECT RAISE(ABORT, 'operation result must match its attempt outcome'); END;
CREATE TRIGGER sync_inbox_delete_requires_tombstone_insert
BEFORE INSERT ON sync_inbox
WHEN NEW.operation_kind = 'delete' AND NEW.state = 'applied' AND NOT EXISTS (
  SELECT 1 FROM sync_tombstones
  WHERE workspace_id = NEW.workspace_id AND entity_kind = NEW.entity_kind
    AND entity_id = NEW.entity_id AND deleted_server_revision = NEW.server_revision
)
BEGIN SELECT RAISE(ABORT, 'applied deletion requires an explicit tombstone'); END;
CREATE TRIGGER sync_inbox_delete_requires_tombstone_update
BEFORE UPDATE OF state, applied_at ON sync_inbox
WHEN NEW.operation_kind = 'delete' AND NEW.state = 'applied' AND NOT EXISTS (
  SELECT 1 FROM sync_tombstones
  WHERE workspace_id = NEW.workspace_id AND entity_kind = NEW.entity_kind
    AND entity_id = NEW.entity_id AND deleted_server_revision = NEW.server_revision
)
BEGIN SELECT RAISE(ABORT, 'applied deletion requires an explicit tombstone'); END;
CREATE TRIGGER domain_assets_require_tombstone_before_delete
BEFORE DELETE ON domain_assets
WHEN NOT EXISTS (
  SELECT 1 FROM sync_tombstones
  WHERE workspace_id = OLD.workspace_id AND entity_kind = 'domain_asset'
    AND entity_id = OLD.entity_id
    AND state = 'purge_eligible' AND deleted_server_revision IS NOT NULL
    AND purge_after IS NOT NULL AND purge_after <= strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'domain asset deletion requires a tombstone');
END;
CREATE INDEX business_history_by_aggregate
    ON business_history_events(workspace_id, aggregate_kind, aggregate_id, event_sequence DESC);
CREATE INDEX dns_zone_observations_latest
    ON dns_zone_observations(workspace_id, entity_id, observed_at DESC);
CREATE INDEX domain_asset_tags_by_tag
    ON domain_asset_tags(workspace_id, tag, entity_id);
CREATE INDEX domain_assets_by_status_expiry
    ON domain_assets(workspace_id, lifecycle_status, expires_on, entity_id)
    WHERE deleted_at IS NULL;
CREATE INDEX domain_assets_by_updated
    ON domain_assets(workspace_id, updated_at, entity_id);
CREATE INDEX local_backup_catalog_available
    ON local_backup_catalog(workspace_id, status, created_at DESC, backup_id DESC);
CREATE INDEX local_backup_catalog_retention
    ON local_backup_catalog(workspace_id, status, retention_until, backup_id);
CREATE INDEX local_backup_catalog_purge_keyset
    ON local_backup_catalog(workspace_id, status, purge_after, backup_id)
    WHERE purge_after IS NOT NULL;
CREATE INDEX local_provider_connections_by_provider
    ON local_provider_connections(workspace_id, provider_kind, lifecycle_status, connection_id);
CREATE INDEX provider_observation_runs_by_connection_time
    ON provider_observation_runs(workspace_id, connection_id, started_at DESC, observation_run_id);
CREATE INDEX provider_observation_targets_by_status
    ON provider_observation_targets(workspace_id, observation_run_id, status, ordinal);
CREATE INDEX marketplace_listing_observations_latest
    ON marketplace_listing_observations(workspace_id, entity_id, marketplace_kind, observed_at DESC);
CREATE INDEX operation_attempts_retryable
    ON operation_attempts(workspace_id, status, retry_after, operation_id)
    WHERE status = 'failed_retryable';
CREATE INDEX operation_plans_by_phase
    ON operation_plans(workspace_id, phase, created_at, plan_id);
CREATE INDEX operations_by_phase
    ON operations(workspace_id, phase, requested_at, operation_id);
CREATE UNIQUE INDEX provider_credential_versions_one_active
    ON provider_credential_versions(workspace_id, connection_id)
    WHERE state = 'active';
CREATE INDEX registrar_observations_latest
    ON registrar_observations(workspace_id, entity_id, observed_at DESC);
CREATE INDEX asset_valuation_observations_latest
    ON asset_valuation_observations(workspace_id, entity_id, observed_at DESC, valuation_id);
CREATE INDEX sync_conflicts_open
    ON sync_conflicts(workspace_id, status, entity_kind, entity_id)
    WHERE status = 'open';
CREATE INDEX sync_inbox_application
    ON sync_inbox(workspace_id, state, server_revision);
CREATE INDEX sync_outbox_delivery
    ON sync_outbox(workspace_id, state, next_attempt_at, created_at, mutation_id);
CREATE INDEX sync_outbox_pending
    ON sync_outbox (workspace_id, acknowledged_at, created_at, mutation_id);
CREATE INDEX sync_tombstones_purge
    ON sync_tombstones(workspace_id, state, purge_after);
