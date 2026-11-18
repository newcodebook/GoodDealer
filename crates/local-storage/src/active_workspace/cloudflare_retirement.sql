-- ADR-0028: requests deny custody forever; completion follows verified slot absence.
ALTER TABLE cloudflare_credential_roots ADD COLUMN retirement_requested_at TEXT;
UPDATE cloudflare_credential_roots SET retirement_requested_at=retired_at WHERE retired_at IS NOT NULL;

-- Extend the column-local CHECK without rebuilding the referenced connection table.
DROP TRIGGER cloudflare_connection_publication_insert_shape;
DROP TRIGGER cloudflare_connection_publication_update_shape;
ALTER TABLE local_provider_connections RENAME COLUMN credential_use_state TO previous_credential_use_state;
ALTER TABLE local_provider_connections ADD COLUMN credential_use_state TEXT NOT NULL DEFAULT 'inactive'
  CHECK (credential_use_state IN (
    'inactive','active','transition_pending','revocation_pending','remediation_required','revoked','retired'
  ));
UPDATE local_provider_connections SET credential_use_state=previous_credential_use_state;
ALTER TABLE local_provider_connections DROP COLUMN previous_credential_use_state;

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
      'consumed', 'cancelled', 'recovery_required', 'abandoned_for_retirement'
    )),
    terminal_reason TEXT CHECK (terminal_reason IN (
      'cancelled_before_inspection', 'keychain_base_mismatch', 'keychain_missing_other',
      'keychain_malformed', 'keychain_unreadable', 'prewrite_orphaned', 'retired'
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
        AND phase IN ('keychain_write_started', 'consumed', 'recovery_required', 'abandoned_for_retirement'))
      OR
      (marker_base_recorded = 1
        AND marker_base_envelope_kind IN ('active', 'tombstone')
        AND marker_base_generation IS NOT NULL
        AND marker_base_scope_digest IS NOT NULL
        AND marker_base_zone_digest IS NOT NULL
        AND marker_base_public_proof IS NOT NULL
        AND phase IN ('keychain_write_started', 'consumed', 'recovery_required', 'abandoned_for_retirement'))
    ),
    CHECK (
      (phase = 'cancelled' AND terminal_reason IS NOT NULL AND terminal_reason != 'retired')
      OR (phase = 'abandoned_for_retirement' AND terminal_reason IS NOT NULL AND terminal_reason = 'retired')
      OR (phase NOT IN ('cancelled','abandoned_for_retirement') AND terminal_reason IS NULL)
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
  OR (OLD.phase = 'recovery_required' AND NEW.phase IN ('consumed', 'abandoned_for_retirement'))
)
BEGIN SELECT RAISE(ABORT, 'invalid Cloudflare credential intent transition'); END;


CREATE TRIGGER cloudflare_credential_retirement_insert_shape
BEFORE INSERT ON cloudflare_credential_roots
WHEN NEW.retired_at IS NOT NULL AND NEW.retirement_requested_at IS NULL
BEGIN SELECT RAISE(ABORT, 'Cloudflare retirement completion requires a request'); END;

CREATE TRIGGER cloudflare_credential_retirement_monotonic
BEFORE UPDATE ON cloudflare_credential_roots
WHEN (OLD.retirement_requested_at IS NOT NULL
      AND NEW.retirement_requested_at IS NOT OLD.retirement_requested_at)
  OR (OLD.retired_at IS NOT NULL AND NEW.retired_at IS NOT OLD.retired_at)
  OR (NEW.retired_at IS NOT NULL AND NEW.retirement_requested_at IS NULL)
  OR (OLD.retirement_requested_at IS NOT NULL AND (
      NEW.workspace_id IS NOT OLD.workspace_id
      OR NEW.connection_incarnation_id IS NOT OLD.connection_incarnation_id
      OR NEW.logical_connection_id IS NOT OLD.logical_connection_id
      OR NEW.highest_resolved_generation IS NOT OLD.highest_resolved_generation
      OR NEW.head_ledger_generation IS NOT OLD.head_ledger_generation
      OR NEW.known_envelope_kind IS NOT OLD.known_envelope_kind
      OR NEW.known_envelope_generation IS NOT OLD.known_envelope_generation
      OR NEW.known_scope_digest IS NOT OLD.known_scope_digest
      OR NEW.known_zone_digest IS NOT OLD.known_zone_digest
      OR NEW.known_public_proof IS NOT OLD.known_public_proof))
BEGIN SELECT RAISE(ABORT, 'Cloudflare retirement is irreversible'); END;

CREATE TRIGGER cloudflare_credential_retirement_no_delete
BEFORE DELETE ON cloudflare_credential_roots
WHEN OLD.retirement_requested_at IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'Cloudflare retirement evidence is retained'); END;

CREATE TRIGGER cloudflare_credential_retirement_no_live_intent
BEFORE UPDATE OF retirement_requested_at ON cloudflare_credential_roots
WHEN NEW.retirement_requested_at IS NOT NULL AND EXISTS (
  SELECT 1 FROM cloudflare_credential_intents i
   WHERE i.workspace_id=OLD.workspace_id
     AND i.connection_incarnation_id=OLD.connection_incarnation_id
     AND i.phase IN ('prepared','prewrite_inspection_started','keychain_write_started','recovery_required'))
BEGIN SELECT RAISE(ABORT, 'Cloudflare retirement requires no live intent'); END;

CREATE TRIGGER cloudflare_credential_retirement_blocks_intent_insert
BEFORE INSERT ON cloudflare_credential_intents
WHEN EXISTS (SELECT 1 FROM cloudflare_credential_roots r
  WHERE r.workspace_id=NEW.workspace_id AND r.connection_incarnation_id=NEW.connection_incarnation_id
    AND (r.retirement_requested_at IS NOT NULL OR r.retired_at IS NOT NULL))
BEGIN SELECT RAISE(ABORT, 'Cloudflare custody is retired'); END;

CREATE TRIGGER cloudflare_credential_retirement_blocks_intent_update
BEFORE UPDATE ON cloudflare_credential_intents
WHEN EXISTS (SELECT 1 FROM cloudflare_credential_roots r
  WHERE r.workspace_id=OLD.workspace_id AND r.connection_incarnation_id=OLD.connection_incarnation_id
    AND (r.retirement_requested_at IS NOT NULL OR r.retired_at IS NOT NULL))
BEGIN SELECT RAISE(ABORT, 'Cloudflare custody is retired'); END;

CREATE TRIGGER cloudflare_connection_retirement_update_shape
BEFORE UPDATE ON local_provider_connections
WHEN (NEW.credential_use_state='retired' AND NOT EXISTS (
  SELECT 1 FROM cloudflare_credential_roots r
   WHERE r.workspace_id=NEW.workspace_id AND r.logical_connection_id=NEW.connection_id
     AND r.connection_incarnation_id=NEW.connection_incarnation_id
     AND r.retirement_requested_at IS NOT NULL AND r.retired_at IS NOT NULL))
  OR EXISTS (SELECT 1 FROM cloudflare_credential_roots r
   WHERE r.workspace_id=OLD.workspace_id AND r.logical_connection_id=OLD.connection_id
     AND r.retirement_requested_at IS NOT NULL AND (
       NEW.workspace_id IS NOT OLD.workspace_id OR NEW.connection_id IS NOT OLD.connection_id
       OR NEW.connection_incarnation_id IS NOT OLD.connection_incarnation_id
       OR NEW.credential_use_state NOT IN ('remediation_required','retired')
       OR NEW.active_credential_generation IS NOT NULL))
BEGIN SELECT RAISE(ABORT, 'invalid Cloudflare retirement publication'); END;

DROP TABLE cloudflare_credential_schema_guard;
CREATE TABLE cloudflare_credential_schema_guard (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    schema_epoch TEXT NOT NULL CHECK (schema_epoch = 'P0_07_CREDENTIAL_SCHEMA_V4'),
    schema_fingerprint TEXT NOT NULL CHECK (
      schema_fingerprint = '933492cff345e017590e8f52fd421ecf27048fcf51561db65a061469ed0829ed'
    )
  ) STRICT;

INSERT INTO cloudflare_credential_schema_guard
  (singleton, schema_epoch, schema_fingerprint)
VALUES
  (1, 'P0_07_CREDENTIAL_SCHEMA_V4', '933492cff345e017590e8f52fd421ecf27048fcf51561db65a061469ed0829ed');

