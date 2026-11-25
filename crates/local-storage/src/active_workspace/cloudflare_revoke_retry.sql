-- Cancelled prewrite attempts retain their identity without consuming a custody generation.
-- Rebuild only the intent table: no table has an incoming foreign key to it.
CREATE TABLE cloudflare_credential_intents_next (
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

INSERT INTO cloudflare_credential_intents_next SELECT * FROM cloudflare_credential_intents;
DROP TABLE cloudflare_credential_intents;
ALTER TABLE cloudflare_credential_intents_next RENAME TO cloudflare_credential_intents;

CREATE UNIQUE INDEX cloudflare_credential_generation_attempt
  ON cloudflare_credential_intents(workspace_id, connection_incarnation_id, target_generation)
  WHERE NOT (phase = 'cancelled' AND operation_kind = 'revoke'
    AND terminal_reason = 'cancelled_before_inspection');

CREATE UNIQUE INDEX cloudflare_credential_one_live_intent
    ON cloudflare_credential_intents(workspace_id, connection_incarnation_id)
    WHERE phase IN (
      'prepared', 'prewrite_inspection_started', 'keychain_write_started', 'recovery_required'
    );

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

DROP TABLE cloudflare_credential_schema_guard;
CREATE TABLE cloudflare_credential_schema_guard (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    schema_epoch TEXT NOT NULL CHECK (schema_epoch = 'P0_07_CREDENTIAL_SCHEMA_V3'),
    schema_fingerprint TEXT NOT NULL CHECK (
      schema_fingerprint = '3e267e4d530572b5cb4114d164068b1b619e1dec90752f5c52111bdbc2ac63b0'
    )
  ) STRICT;

INSERT INTO cloudflare_credential_schema_guard
  (singleton, schema_epoch, schema_fingerprint)
VALUES
  (1, 'P0_07_CREDENTIAL_SCHEMA_V3', '3e267e4d530572b5cb4114d164068b1b619e1dec90752f5c52111bdbc2ac63b0');

