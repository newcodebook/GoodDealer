/* P0-04 is append-only. Legacy replicated tombstones and conflicts are rejected by the
   migration runner before this SQL executes because their missing remote identity cannot be
   reconstructed without inventing evidence. */
ALTER TABLE sync_conflicts ADD COLUMN candidate_version INTEGER
  CHECK (candidate_version IS NULL OR candidate_version BETWEEN 1 AND 9007199254740991);
ALTER TABLE sync_conflicts ADD COLUMN parent_candidate_version INTEGER
  CHECK (parent_candidate_version IS NULL OR parent_candidate_version BETWEEN 1 AND 9007199254740991);
ALTER TABLE sync_conflicts ADD COLUMN remote_source_device_id TEXT;
ALTER TABLE sync_conflicts ADD COLUMN remote_mutation_digest TEXT
  CHECK (remote_mutation_digest IS NULL OR (
    length(remote_mutation_digest) = 43
    AND remote_mutation_digest NOT GLOB '*[^A-Za-z0-9_-]*'
  ));
ALTER TABLE sync_conflicts ADD COLUMN remote_order_server_revision INTEGER
  CHECK (remote_order_server_revision IS NULL OR remote_order_server_revision BETWEEN 1 AND 9007199254740991);
ALTER TABLE sync_conflicts ADD COLUMN remote_order_source_device_id TEXT;
ALTER TABLE sync_conflicts ADD COLUMN remote_order_mutation_id TEXT;
ALTER TABLE sync_conflicts ADD COLUMN local_value_hash TEXT
  CHECK (local_value_hash IS NULL OR length(local_value_hash) = 64);
ALTER TABLE sync_conflicts ADD COLUMN remote_value_hash TEXT
  CHECK (remote_value_hash IS NULL OR length(remote_value_hash) = 64);
ALTER TABLE sync_conflicts ADD COLUMN resolution_id TEXT;
ALTER TABLE sync_conflicts ADD COLUMN choice_digest TEXT
  CHECK (choice_digest IS NULL OR length(choice_digest) = 64);
ALTER TABLE sync_conflicts ADD COLUMN gc_eligible_at TEXT;

CREATE TRIGGER sync_conflicts_v3_complete_insert
BEFORE INSERT ON sync_conflicts
BEGIN
  SELECT CASE WHEN
    NEW.candidate_version IS NULL
    OR NEW.remote_source_device_id IS NULL
    OR NEW.remote_mutation_digest IS NULL
    OR NEW.remote_order_server_revision IS NULL
    OR NEW.remote_order_source_device_id IS NULL
    OR NEW.remote_order_mutation_id IS NULL
    OR NEW.local_value_hash IS NULL
    OR NEW.remote_value_hash IS NULL
  THEN RAISE(ABORT, 'incomplete conflict evidence') END;
END;

CREATE TRIGGER sync_conflicts_v3_evidence_immutable
BEFORE UPDATE OF conflict_id, entity_kind, entity_id, field_path, local_value_json,
  remote_value_json, local_commit_sequence, remote_server_revision, candidate_version,
  parent_candidate_version, remote_source_device_id, remote_mutation_digest,
  remote_order_server_revision, remote_order_source_device_id, remote_order_mutation_id,
  local_value_hash, remote_value_hash
ON sync_conflicts
BEGIN
  SELECT RAISE(ABORT, 'conflict evidence is immutable');
END;

CREATE TRIGGER sync_conflicts_v3_no_physical_delete
BEFORE DELETE ON sync_conflicts
BEGIN
  SELECT RAISE(ABORT, 'conflict evidence cannot be deleted');
END;

CREATE TRIGGER sync_conflicts_v3_capacity_count
BEFORE INSERT ON sync_conflicts
WHEN (SELECT count(*) FROM sync_conflicts
      WHERE workspace_id=NEW.workspace_id AND status='open') >= 10000
BEGIN
  SELECT RAISE(ABORT, 'conflict capacity exceeded');
END;

CREATE TRIGGER sync_conflicts_v3_capacity_bytes
BEFORE INSERT ON sync_conflicts
WHEN (SELECT coalesce(sum(length(CAST(local_value_json AS BLOB)) +
                               length(CAST(remote_value_json AS BLOB))), 0)
      FROM sync_conflicts WHERE workspace_id=NEW.workspace_id AND status='open')
     + length(CAST(NEW.local_value_json AS BLOB))
     + length(CAST(NEW.remote_value_json AS BLOB)) > 67108864
BEGIN
  SELECT RAISE(ABORT, 'conflict capacity exceeded');
END;

CREATE INDEX sync_conflicts_v3_open_candidates
  ON sync_conflicts(workspace_id, status, remote_server_revision, conflict_id);
CREATE UNIQUE INDEX sync_conflicts_v3_remote_identity
  ON sync_conflicts(workspace_id, entity_kind, entity_id, field_path,
                    remote_server_revision, remote_mutation_digest);

ALTER TABLE sync_tombstones ADD COLUMN barrier_state TEXT
  CHECK (barrier_state IS NULL OR barrier_state IN
    ('pending','contested','replicated','acknowledged','purge_eligible'));
ALTER TABLE sync_tombstones ADD COLUMN order_server_revision INTEGER
  CHECK (order_server_revision IS NULL OR order_server_revision BETWEEN 1 AND 9007199254740991);
ALTER TABLE sync_tombstones ADD COLUMN order_source_device_id TEXT;
ALTER TABLE sync_tombstones ADD COLUMN order_mutation_id TEXT;
UPDATE sync_tombstones SET barrier_state='pending' WHERE state='pending';

CREATE TRIGGER sync_tombstones_v3_complete_insert
BEFORE INSERT ON sync_tombstones
BEGIN
  SELECT CASE WHEN NEW.state != 'pending' AND NEW.barrier_state IS NULL THEN RAISE(ABORT, 'missing tombstone barrier') END;
  SELECT CASE WHEN NEW.barrier_state IN ('contested','replicated','acknowledged','purge_eligible')
    AND (NEW.order_server_revision IS NULL OR NEW.order_source_device_id IS NULL
         OR NEW.order_mutation_id IS NULL)
    THEN RAISE(ABORT, 'missing tombstone order evidence') END;
END;

CREATE TRIGGER sync_tombstones_v3_monotonic_update
BEFORE UPDATE OF deleted_server_revision, deleted_at, barrier_state,
  order_server_revision, order_source_device_id, order_mutation_id
ON sync_tombstones
WHEN OLD.order_server_revision IS NOT NULL AND (
  NEW.order_server_revision IS NULL
  OR NEW.order_server_revision < OLD.order_server_revision
  OR (NEW.order_server_revision = OLD.order_server_revision AND (
    NEW.order_source_device_id != OLD.order_source_device_id
    OR NEW.order_mutation_id != OLD.order_mutation_id
  ))
)
BEGIN
  SELECT RAISE(ABORT, 'tombstone order regression');
END;

ALTER TABLE sync_reader_state ADD COLUMN anti_rollback_server_revision_floor INTEGER NOT NULL DEFAULT 0
  CHECK (anti_rollback_server_revision_floor BETWEEN 0 AND 9007199254740991);
ALTER TABLE sync_reader_state ADD COLUMN anti_rollback_schema_version_floor INTEGER NOT NULL DEFAULT 2
  CHECK (anti_rollback_schema_version_floor BETWEEN 2 AND 9007199254740991);
ALTER TABLE sync_reader_state ADD COLUMN row_version INTEGER NOT NULL DEFAULT 1
  CHECK (row_version BETWEEN 1 AND 9007199254740991);

CREATE TRIGGER sync_reader_state_v3_floor_monotonic
BEFORE UPDATE OF anti_rollback_server_revision_floor, anti_rollback_schema_version_floor, row_version
ON sync_reader_state
WHEN NEW.anti_rollback_server_revision_floor < OLD.anti_rollback_server_revision_floor
  OR NEW.anti_rollback_schema_version_floor < OLD.anti_rollback_schema_version_floor
  OR NEW.row_version <= OLD.row_version
BEGIN
  SELECT RAISE(ABORT, 'reader floor regression');
END;

CREATE TABLE sync_resolution_receipts (
  workspace_id TEXT NOT NULL,
  resolution_id TEXT NOT NULL,
  conflict_id TEXT NOT NULL,
  candidate_version INTEGER NOT NULL CHECK (candidate_version BETWEEN 1 AND 9007199254740991),
  choice TEXT NOT NULL CHECK (choice IN ('accept_remote','keep_local')),
  choice_digest TEXT NOT NULL CHECK (length(choice_digest)=64),
  outbox_mutation_id TEXT,
  resolved_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, resolution_id),
  UNIQUE (workspace_id, conflict_id, candidate_version, choice_digest),
  FOREIGN KEY (workspace_id, conflict_id) REFERENCES sync_conflicts(workspace_id, conflict_id),
  FOREIGN KEY (workspace_id, outbox_mutation_id) REFERENCES sync_outbox(workspace_id, mutation_id)
) STRICT;

CREATE TRIGGER sync_resolution_receipts_append_only_update
BEFORE UPDATE ON sync_resolution_receipts BEGIN
  SELECT RAISE(ABORT, 'resolution receipt is append-only');
END;
CREATE TRIGGER sync_resolution_receipts_append_only_delete
BEFORE DELETE ON sync_resolution_receipts BEGIN
  SELECT RAISE(ABORT, 'resolution receipt is append-only');
END;

CREATE TABLE sync_rebootstrap_journal (
  workspace_id TEXT NOT NULL,
  publication_sequence INTEGER NOT NULL CHECK (publication_sequence BETWEEN 1 AND 9007199254740991),
  old_slot_id TEXT NOT NULL,
  new_slot_id TEXT NOT NULL,
  old_key_digest TEXT NOT NULL CHECK (length(old_key_digest)=64),
  new_key_digest TEXT NOT NULL CHECK (length(new_key_digest)=64),
  authority_generation INTEGER NOT NULL CHECK (authority_generation BETWEEN 1 AND 9007199254740991),
  server_revision_floor INTEGER NOT NULL CHECK (server_revision_floor BETWEEN 0 AND 9007199254740991),
  schema_version_floor INTEGER NOT NULL CHECK (schema_version_floor BETWEEN 2 AND 9007199254740991),
  manifest_digest TEXT NOT NULL CHECK (length(manifest_digest)=64),
  state TEXT NOT NULL CHECK (state IN ('prepared','verified','publish_intent','published',
    'reopened_verified','retired_old','cancelled','quarantined','recovery_unavailable')),
  failure_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, publication_sequence),
  FOREIGN KEY (workspace_id) REFERENCES active_workspace_metadata(workspace_id),
  CHECK ((state IN ('cancelled','quarantined','recovery_unavailable')) = (failure_code IS NOT NULL))
) STRICT;

CREATE TRIGGER sync_rebootstrap_journal_no_delete
BEFORE DELETE ON sync_rebootstrap_journal BEGIN
  SELECT RAISE(ABORT, 'rebootstrap journal cannot be deleted');
END;

CREATE TRIGGER sync_rebootstrap_journal_no_update
BEFORE UPDATE ON sync_rebootstrap_journal BEGIN
  SELECT RAISE(ABORT, 'rebootstrap journal cannot be updated');
END;
