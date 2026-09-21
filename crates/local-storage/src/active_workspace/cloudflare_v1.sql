DROP TABLE provider_credential_versions;
ALTER TABLE local_provider_connections DROP COLUMN provider_account_id;

ALTER TABLE local_provider_connections ADD COLUMN connection_incarnation_id TEXT;
ALTER TABLE local_provider_connections ADD COLUMN credential_use_state TEXT NOT NULL DEFAULT 'inactive'
  CHECK (credential_use_state IN (
    'inactive', 'active', 'transition_pending', 'revocation_pending',
    'remediation_required', 'revoked'
  ));
ALTER TABLE local_provider_connections ADD COLUMN active_credential_generation INTEGER
  CHECK (active_credential_generation IS NULL OR active_credential_generation BETWEEN 1 AND 9007199254740991);
ALTER TABLE local_provider_connections ADD COLUMN active_credential_scope_digest TEXT
  CHECK (active_credential_scope_digest IS NULL OR (
    length(active_credential_scope_digest) = 64
    AND active_credential_scope_digest NOT GLOB '*[^0-9a-f]*'
  ));
ALTER TABLE local_provider_connections ADD COLUMN active_credential_zone_digest TEXT
  CHECK (active_credential_zone_digest IS NULL OR (
    length(active_credential_zone_digest) = 64
    AND active_credential_zone_digest NOT GLOB '*[^0-9a-f]*'
  ));
ALTER TABLE local_provider_connections ADD COLUMN active_credential_public_proof TEXT
  CHECK (active_credential_public_proof IS NULL OR (
    length(active_credential_public_proof) = 64
    AND active_credential_public_proof NOT GLOB '*[^0-9a-f]*'
  ));

CREATE TABLE cloudflare_credential_schema_guard (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    schema_epoch TEXT NOT NULL CHECK (schema_epoch = 'P0_07_CREDENTIAL_SCHEMA_V2'),
    schema_fingerprint TEXT NOT NULL CHECK (
      schema_fingerprint = '0ada504c017543d9cc26b9e0832e7fdcf0ac29b329c8d1895c08cf1f517fe1ec'
    )
  ) STRICT;

INSERT INTO cloudflare_credential_schema_guard
  (singleton, schema_epoch, schema_fingerprint)
VALUES
  (1, 'P0_07_CREDENTIAL_SCHEMA_V2', '0ada504c017543d9cc26b9e0832e7fdcf0ac29b329c8d1895c08cf1f517fe1ec');

CREATE TABLE cloudflare_credential_roots (
    workspace_id TEXT NOT NULL,
    connection_incarnation_id TEXT NOT NULL,
    logical_connection_id TEXT NOT NULL,
    highest_resolved_generation INTEGER NOT NULL DEFAULT 0 CHECK (
      highest_resolved_generation BETWEEN 0 AND 9007199254740991
    ),
    head_ledger_generation INTEGER CHECK (
      head_ledger_generation IS NULL
      OR head_ledger_generation BETWEEN 1 AND 9007199254740991
    ),
    known_envelope_kind TEXT NOT NULL DEFAULT 'absent' CHECK (
      known_envelope_kind IN ('absent', 'active', 'tombstone')
    ),
    known_envelope_generation INTEGER CHECK (
      known_envelope_generation IS NULL
      OR known_envelope_generation BETWEEN 1 AND 9007199254740991
    ),
    known_scope_digest TEXT CHECK (
      known_scope_digest IS NULL OR (
        length(known_scope_digest) = 64
        AND known_scope_digest NOT GLOB '*[^0-9a-f]*'
      )
    ),
    known_zone_digest TEXT CHECK (
      known_zone_digest IS NULL OR (
        length(known_zone_digest) = 64
        AND known_zone_digest NOT GLOB '*[^0-9a-f]*'
      )
    ),
    known_public_proof TEXT CHECK (
      known_public_proof IS NULL OR (
        length(known_public_proof) = 64
        AND known_public_proof NOT GLOB '*[^0-9a-f]*'
      )
    ),
    retired_at TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (workspace_id, connection_incarnation_id),
    UNIQUE (workspace_id, connection_incarnation_id, highest_resolved_generation),
    FOREIGN KEY (workspace_id, logical_connection_id)
      REFERENCES local_provider_connections(workspace_id, connection_id) ON DELETE RESTRICT,
    FOREIGN KEY (workspace_id, connection_incarnation_id, head_ledger_generation)
      REFERENCES cloudflare_credential_generation_ledger(
        workspace_id, connection_incarnation_id, generation
      ) DEFERRABLE INITIALLY DEFERRED,
    CHECK (
      (highest_resolved_generation = 0 AND head_ledger_generation IS NULL)
      OR (highest_resolved_generation > 0 AND head_ledger_generation = highest_resolved_generation)
    ),
    CHECK (
      (known_envelope_kind = 'absent'
        AND known_envelope_generation IS NULL
        AND known_scope_digest IS NULL
        AND known_zone_digest IS NULL
        AND known_public_proof IS NULL)
      OR
      (known_envelope_kind IN ('active', 'tombstone')
        AND known_envelope_generation IS NOT NULL
        AND known_scope_digest IS NOT NULL
        AND known_zone_digest IS NOT NULL
        AND known_public_proof IS NOT NULL
        AND known_envelope_generation <= highest_resolved_generation)
    )
  ) STRICT;

CREATE TABLE cloudflare_credential_generation_ledger (
    workspace_id TEXT NOT NULL,
    connection_incarnation_id TEXT NOT NULL,
    generation INTEGER NOT NULL CHECK (generation BETWEEN 1 AND 9007199254740991),
    result TEXT NOT NULL CHECK (result IN (
      'active_confirmed', 'tombstone_confirmed', 'burned'
    )),
    operation_kind TEXT NOT NULL CHECK (operation_kind IN ('provision', 'revoke')),
    target_envelope_kind TEXT NOT NULL CHECK (target_envelope_kind IN ('active', 'tombstone')),
    scope_digest TEXT NOT NULL CHECK (
      length(scope_digest) = 64 AND scope_digest NOT GLOB '*[^0-9a-f]*'
    ),
    zone_digest TEXT NOT NULL CHECK (
      length(zone_digest) = 64 AND zone_digest NOT GLOB '*[^0-9a-f]*'
    ),
    target_public_proof TEXT NOT NULL CHECK (
      length(target_public_proof) = 64 AND target_public_proof NOT GLOB '*[^0-9a-f]*'
    ),
    source_intent_id TEXT NOT NULL,
    burn_reason TEXT CHECK (burn_reason IN (
      'target_not_observed', 'target_present_authority_stale'
    )),
    created_at TEXT NOT NULL,
    PRIMARY KEY (workspace_id, connection_incarnation_id, generation),
    UNIQUE (workspace_id, connection_incarnation_id, source_intent_id),
    FOREIGN KEY (workspace_id, connection_incarnation_id)
      REFERENCES cloudflare_credential_roots(workspace_id, connection_incarnation_id) ON DELETE RESTRICT,
    CHECK (
      (result = 'active_confirmed'
        AND operation_kind = 'provision'
        AND target_envelope_kind = 'active')
      OR (result = 'tombstone_confirmed'
        AND operation_kind = 'revoke'
        AND target_envelope_kind = 'tombstone')
      OR result = 'burned'
    ),
    CHECK (
      (result IN ('active_confirmed', 'tombstone_confirmed') AND burn_reason IS NULL)
      OR (result = 'burned' AND burn_reason IS NOT NULL)
    )
  ) STRICT;

CREATE TABLE cloudflare_dns_staged_batches (
    workspace_id TEXT NOT NULL,
    connection_incarnation_id TEXT NOT NULL,
    staged_batch_id TEXT NOT NULL,
    source_intent_id TEXT NOT NULL,
    observation_id TEXT NOT NULL,
    observation_run_id TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    lease_epoch INTEGER NOT NULL CHECK (lease_epoch BETWEEN 1 AND 9007199254740991),
    scope_digest TEXT NOT NULL CHECK (
      length(scope_digest) = 64 AND scope_digest NOT GLOB '*[^0-9a-f]*'
    ),
    zone_digest TEXT NOT NULL CHECK (
      length(zone_digest) = 64 AND zone_digest NOT GLOB '*[^0-9a-f]*'
    ),
    observation_digest TEXT NOT NULL CHECK (
      length(observation_digest) = 64 AND observation_digest NOT GLOB '*[^0-9a-f]*'
    ),
    observed_at TEXT NOT NULL,
    zone_name_ascii TEXT NOT NULL CHECK (length(CAST(zone_name_ascii AS BLOB)) BETWEEN 1 AND 253),
    authoritative_nameservers_json TEXT NOT NULL CHECK (
      json_valid(authoritative_nameservers_json)
      AND json_type(authoritative_nameservers_json) = 'array'
      AND length(CAST(authoritative_nameservers_json AS BLOB)) <= 4096
    ),
    dnssec_status TEXT NOT NULL CHECK (dnssec_status IN ('active', 'inactive', 'unknown', 'unsupported')),
    observation_availability TEXT NOT NULL CHECK (observation_availability IN ('available', 'unavailable')),
    cloudflare_zone_status TEXT NOT NULL CHECK (cloudflare_zone_status IN ('active', 'pending', 'unknown')),
    provider_version_token TEXT NOT NULL CHECK (length(CAST(provider_version_token AS BLOB)) BETWEEN 1 AND 256),
    visibility TEXT NOT NULL DEFAULT 'staged' CHECK (visibility IN ('staged', 'committed', 'discarded')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (workspace_id, staged_batch_id),
    UNIQUE (workspace_id, connection_incarnation_id, staged_batch_id),
    UNIQUE (workspace_id, connection_incarnation_id, source_intent_id),
    FOREIGN KEY (workspace_id, connection_incarnation_id)
      REFERENCES cloudflare_credential_roots(workspace_id, connection_incarnation_id) ON DELETE RESTRICT,
    FOREIGN KEY (workspace_id, entity_id)
      REFERENCES domain_assets(workspace_id, entity_id) ON DELETE RESTRICT
  ) STRICT;

CREATE TABLE cloudflare_dns_staged_records (
    workspace_id TEXT NOT NULL,
    staged_batch_id TEXT NOT NULL,
    record_key TEXT NOT NULL,
    record_type TEXT NOT NULL,
    owner_name_ascii TEXT NOT NULL,
    ttl_seconds INTEGER CHECK (ttl_seconds IS NULL OR ttl_seconds BETWEEN 0 AND 2147483647),
    priority INTEGER CHECK (priority IS NULL OR priority BETWEEN 0 AND 65535),
    canonical_value TEXT NOT NULL CHECK (length(CAST(canonical_value AS BLOB)) BETWEEN 1 AND 4096),
    proxied INTEGER CHECK (proxied IS NULL OR proxied IN (0, 1)),
    PRIMARY KEY (workspace_id, staged_batch_id, record_key),
    FOREIGN KEY (workspace_id, staged_batch_id)
      REFERENCES cloudflare_dns_staged_batches(workspace_id, staged_batch_id) ON DELETE RESTRICT
  ) STRICT;

CREATE TABLE cloudflare_credential_intents (
    workspace_id TEXT NOT NULL,
    connection_incarnation_id TEXT NOT NULL,
    intent_id TEXT NOT NULL,
    operation_kind TEXT NOT NULL CHECK (operation_kind IN ('provision', 'revoke')),
    expected_head_generation INTEGER NOT NULL CHECK (
      expected_head_generation BETWEEN 0 AND 9007199254740990
    ),
    target_generation INTEGER NOT NULL CHECK (
      target_generation BETWEEN 1 AND 9007199254740991
    ),
    target_envelope_kind TEXT NOT NULL CHECK (target_envelope_kind IN ('active', 'tombstone')),
    scope_digest TEXT NOT NULL CHECK (
      length(scope_digest) = 64 AND scope_digest NOT GLOB '*[^0-9a-f]*'
    ),
    zone_digest TEXT NOT NULL CHECK (
      length(zone_digest) = 64 AND zone_digest NOT GLOB '*[^0-9a-f]*'
    ),
    target_public_proof TEXT NOT NULL CHECK (
      length(target_public_proof) = 64 AND target_public_proof NOT GLOB '*[^0-9a-f]*'
    ),
    prepared_authority_snapshot_digest TEXT NOT NULL CHECK (
      length(prepared_authority_snapshot_digest) = 64
      AND prepared_authority_snapshot_digest NOT GLOB '*[^0-9a-f]*'
    ),
    staged_batch_id TEXT,
    staged_observation_digest TEXT CHECK (
      staged_observation_digest IS NULL OR (
        length(staged_observation_digest) = 64
        AND staged_observation_digest NOT GLOB '*[^0-9a-f]*'
      )
    ),
    marker_base_recorded INTEGER NOT NULL DEFAULT 0 CHECK (marker_base_recorded IN (0, 1)),
    marker_base_envelope_kind TEXT CHECK (marker_base_envelope_kind IN ('absent', 'active', 'tombstone')),
    marker_base_generation INTEGER CHECK (
      marker_base_generation IS NULL OR marker_base_generation BETWEEN 1 AND 9007199254740991
    ),
    marker_base_scope_digest TEXT CHECK (
      marker_base_scope_digest IS NULL OR (
        length(marker_base_scope_digest) = 64
        AND marker_base_scope_digest NOT GLOB '*[^0-9a-f]*'
      )
    ),
    marker_base_zone_digest TEXT CHECK (
      marker_base_zone_digest IS NULL OR (
        length(marker_base_zone_digest) = 64
        AND marker_base_zone_digest NOT GLOB '*[^0-9a-f]*'
      )
    ),
    marker_base_public_proof TEXT CHECK (
      marker_base_public_proof IS NULL OR (
        length(marker_base_public_proof) = 64
        AND marker_base_public_proof NOT GLOB '*[^0-9a-f]*'
      )
    ),
    phase TEXT NOT NULL CHECK (phase IN (
      'prepared', 'prewrite_inspection_started', 'keychain_write_started',
      'consumed', 'cancelled', 'recovery_required'
    )),
    terminal_reason TEXT CHECK (terminal_reason IN (
      'cancelled_before_inspection', 'keychain_base_mismatch', 'keychain_missing_other',
      'keychain_malformed', 'keychain_unreadable', 'prewrite_orphaned'
    )),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (workspace_id, connection_incarnation_id, intent_id),
    UNIQUE (workspace_id, connection_incarnation_id, target_generation),
    FOREIGN KEY (workspace_id, connection_incarnation_id)
      REFERENCES cloudflare_credential_roots(workspace_id, connection_incarnation_id) ON DELETE RESTRICT,
    FOREIGN KEY (workspace_id, connection_incarnation_id, staged_batch_id)
      REFERENCES cloudflare_dns_staged_batches(
        workspace_id, connection_incarnation_id, staged_batch_id
      ) ON DELETE RESTRICT,
    CHECK (target_generation = expected_head_generation + 1),
    CHECK (
      (operation_kind = 'provision'
        AND target_envelope_kind = 'active'
        AND staged_batch_id IS NOT NULL
        AND staged_observation_digest IS NOT NULL)
      OR (operation_kind = 'revoke'
        AND target_envelope_kind = 'tombstone'
        AND staged_batch_id IS NULL
        AND staged_observation_digest IS NULL)
    ),
    CHECK (
      (marker_base_recorded = 0
        AND marker_base_envelope_kind IS NULL
        AND marker_base_generation IS NULL
        AND marker_base_scope_digest IS NULL
        AND marker_base_zone_digest IS NULL
        AND marker_base_public_proof IS NULL
        AND phase IN ('prepared', 'prewrite_inspection_started', 'cancelled'))
      OR
      (marker_base_recorded = 1
        AND marker_base_envelope_kind = 'absent'
        AND marker_base_generation IS NULL
        AND marker_base_scope_digest IS NULL
        AND marker_base_zone_digest IS NULL
        AND marker_base_public_proof IS NULL
        AND phase IN ('keychain_write_started', 'consumed', 'recovery_required'))
      OR
      (marker_base_recorded = 1
        AND marker_base_envelope_kind IN ('active', 'tombstone')
        AND marker_base_generation IS NOT NULL
        AND marker_base_scope_digest IS NOT NULL
        AND marker_base_zone_digest IS NOT NULL
        AND marker_base_public_proof IS NOT NULL
        AND phase IN ('keychain_write_started', 'consumed', 'recovery_required'))
    ),
    CHECK (
      (phase = 'cancelled' AND terminal_reason IS NOT NULL)
      OR (phase != 'cancelled' AND terminal_reason IS NULL)
    )
  ) STRICT;

CREATE UNIQUE INDEX cloudflare_credential_one_live_intent
    ON cloudflare_credential_intents(workspace_id, connection_incarnation_id)
    WHERE phase IN (
      'prepared', 'prewrite_inspection_started', 'keychain_write_started', 'recovery_required'
    );

CREATE UNIQUE INDEX cloudflare_connection_one_current_incarnation
    ON cloudflare_credential_roots(workspace_id, logical_connection_id)
    WHERE retired_at IS NULL;

CREATE TRIGGER cloudflare_connection_publication_insert_shape
BEFORE INSERT ON local_provider_connections
WHEN NOT (
  (NEW.active_credential_generation IS NULL
    AND NEW.active_credential_scope_digest IS NULL
    AND NEW.active_credential_zone_digest IS NULL
    AND NEW.active_credential_public_proof IS NULL
    AND NEW.credential_use_state != 'active')
  OR (NEW.active_credential_generation IS NOT NULL
    AND NEW.active_credential_scope_digest IS NOT NULL
    AND NEW.active_credential_zone_digest IS NOT NULL
    AND NEW.active_credential_public_proof IS NOT NULL
    AND NEW.credential_use_state IN (
      'active', 'transition_pending', 'revocation_pending', 'remediation_required'
    ))
)
BEGIN SELECT RAISE(ABORT, 'invalid Cloudflare credential publication shape'); END;

CREATE TRIGGER cloudflare_connection_publication_update_shape
BEFORE UPDATE OF credential_use_state, active_credential_generation,
  active_credential_scope_digest, active_credential_zone_digest,
  active_credential_public_proof ON local_provider_connections
WHEN NOT (
  (NEW.active_credential_generation IS NULL
    AND NEW.active_credential_scope_digest IS NULL
    AND NEW.active_credential_zone_digest IS NULL
    AND NEW.active_credential_public_proof IS NULL
    AND NEW.credential_use_state != 'active')
  OR (NEW.active_credential_generation IS NOT NULL
    AND NEW.active_credential_scope_digest IS NOT NULL
    AND NEW.active_credential_zone_digest IS NOT NULL
    AND NEW.active_credential_public_proof IS NOT NULL
    AND NEW.credential_use_state IN (
      'active', 'transition_pending', 'revocation_pending', 'remediation_required'
    ))
)
BEGIN SELECT RAISE(ABORT, 'invalid Cloudflare credential publication shape'); END;

CREATE TRIGGER cloudflare_credential_ledger_no_update
BEFORE UPDATE ON cloudflare_credential_generation_ledger
BEGIN SELECT RAISE(ABORT, 'Cloudflare credential ledger is append-only'); END;

CREATE TRIGGER cloudflare_credential_ledger_no_delete
BEFORE DELETE ON cloudflare_credential_generation_ledger
BEGIN SELECT RAISE(ABORT, 'Cloudflare credential ledger is append-only'); END;

CREATE TRIGGER cloudflare_credential_intent_immutable
BEFORE UPDATE ON cloudflare_credential_intents
WHEN NEW.workspace_id IS NOT OLD.workspace_id
  OR NEW.connection_incarnation_id IS NOT OLD.connection_incarnation_id
  OR NEW.intent_id IS NOT OLD.intent_id
  OR NEW.operation_kind IS NOT OLD.operation_kind
  OR NEW.expected_head_generation IS NOT OLD.expected_head_generation
  OR NEW.target_generation IS NOT OLD.target_generation
  OR NEW.target_envelope_kind IS NOT OLD.target_envelope_kind
  OR NEW.scope_digest IS NOT OLD.scope_digest
  OR NEW.zone_digest IS NOT OLD.zone_digest
  OR NEW.target_public_proof IS NOT OLD.target_public_proof
  OR NEW.prepared_authority_snapshot_digest IS NOT OLD.prepared_authority_snapshot_digest
  OR NEW.staged_batch_id IS NOT OLD.staged_batch_id
  OR NEW.staged_observation_digest IS NOT OLD.staged_observation_digest
  OR (OLD.marker_base_recorded = 1 AND (
    NEW.marker_base_recorded IS NOT OLD.marker_base_recorded
    OR NEW.marker_base_envelope_kind IS NOT OLD.marker_base_envelope_kind
    OR NEW.marker_base_generation IS NOT OLD.marker_base_generation
    OR NEW.marker_base_scope_digest IS NOT OLD.marker_base_scope_digest
    OR NEW.marker_base_zone_digest IS NOT OLD.marker_base_zone_digest
    OR NEW.marker_base_public_proof IS NOT OLD.marker_base_public_proof
  ))
  OR (OLD.terminal_reason IS NOT NULL AND NEW.terminal_reason IS NOT OLD.terminal_reason)
BEGIN SELECT RAISE(ABORT, 'Cloudflare credential intent identity is immutable'); END;

CREATE TRIGGER cloudflare_credential_intent_phase_edges
BEFORE UPDATE OF phase ON cloudflare_credential_intents
WHEN NOT (
  (OLD.phase = 'prepared' AND NEW.phase IN ('prewrite_inspection_started', 'cancelled'))
  OR (OLD.phase = 'prewrite_inspection_started'
    AND NEW.phase IN ('keychain_write_started', 'cancelled'))
  OR (OLD.phase = 'keychain_write_started' AND NEW.phase IN ('consumed', 'recovery_required'))
  OR (OLD.phase = 'recovery_required' AND NEW.phase = 'consumed')
)
BEGIN SELECT RAISE(ABORT, 'invalid Cloudflare credential intent transition'); END;

CREATE TRIGGER cloudflare_dns_staged_batch_immutable
BEFORE UPDATE ON cloudflare_dns_staged_batches
WHEN NEW.workspace_id IS NOT OLD.workspace_id
  OR NEW.connection_incarnation_id IS NOT OLD.connection_incarnation_id
  OR NEW.staged_batch_id IS NOT OLD.staged_batch_id
  OR NEW.source_intent_id IS NOT OLD.source_intent_id
  OR NEW.observation_id IS NOT OLD.observation_id
  OR NEW.observation_run_id IS NOT OLD.observation_run_id
  OR NEW.entity_id IS NOT OLD.entity_id
  OR NEW.lease_epoch IS NOT OLD.lease_epoch
  OR NEW.scope_digest IS NOT OLD.scope_digest
  OR NEW.zone_digest IS NOT OLD.zone_digest
  OR NEW.observation_digest IS NOT OLD.observation_digest
  OR NEW.observed_at IS NOT OLD.observed_at
  OR NEW.zone_name_ascii IS NOT OLD.zone_name_ascii
  OR NEW.authoritative_nameservers_json IS NOT OLD.authoritative_nameservers_json
  OR NEW.dnssec_status IS NOT OLD.dnssec_status
  OR NEW.observation_availability IS NOT OLD.observation_availability
  OR NEW.cloudflare_zone_status IS NOT OLD.cloudflare_zone_status
  OR NEW.provider_version_token IS NOT OLD.provider_version_token
  OR NEW.created_at IS NOT OLD.created_at
  OR NOT (OLD.visibility = 'staged' AND NEW.visibility IN ('committed', 'discarded'))
BEGIN SELECT RAISE(ABORT, 'Cloudflare staged observation is immutable'); END;

CREATE TRIGGER cloudflare_dns_staged_record_no_update
BEFORE UPDATE ON cloudflare_dns_staged_records
BEGIN SELECT RAISE(ABORT, 'Cloudflare staged observation facts are immutable'); END;

CREATE TRIGGER cloudflare_dns_staged_record_no_delete
BEFORE DELETE ON cloudflare_dns_staged_records
BEGIN SELECT RAISE(ABORT, 'Cloudflare staged observation facts are immutable'); END;
