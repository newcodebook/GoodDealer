/* ADR-0029 C1c2b: the local sync tables record the wire version each claimed or received
   mutation was digested under. Version 2 remains valid for rows recorded before this migration and
   only for generation 1, where its encoding carries exactly the content of version 3; every new
   claim and every newly received mutation records version 3. A column CHECK cannot be altered in
   SQLite, so both tables are rebuilt with identical columns, keys, indexes and triggers (the
   documented twelve-step procedure; the runner disables foreign keys only around this migration and
   runs `foreign_key_check` before commit). Triggers on other tables that read `sync_outbox` are
   dropped first and recreated unchanged, because a rename re-parses every trigger in the schema. */

DROP TRIGGER sync_outbox_fields_v2_immutable_update;

DROP TRIGGER sync_outbox_fields_v2_immutable_delete;

DROP TRIGGER sync_outbox_local_creations_mark_a_first_upsert;

CREATE TABLE sync_outbox_rebuild (
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
    CHECK (server_revision IS NULL OR server_revision BETWEEN 1 AND 9007199254740991), delivery_owner TEXT, delivery_lease_expires_at TEXT, delivery_attempt_fence INTEGER
  CHECK (delivery_attempt_fence IS NULL OR delivery_attempt_fence BETWEEN 1 AND 9007199254740991), wire_schema_version INTEGER
  CHECK (wire_schema_version IS NULL OR wire_schema_version IN (2, 3)), wire_mutation_digest TEXT
  CHECK (
    wire_mutation_digest IS NULL OR (
      length(wire_mutation_digest) = 43
      AND wire_mutation_digest NOT GLOB '*[^A-Za-z0-9_-]*'
    )
  ), entity_generation INTEGER NOT NULL DEFAULT 1
  CHECK (entity_generation BETWEEN 1 AND 9007199254740991),
    PRIMARY KEY (workspace_id, mutation_id),
    FOREIGN KEY (workspace_id) REFERENCES active_workspace_metadata(workspace_id),
    CHECK ((state = 'acknowledged') = (acknowledged_at IS NOT NULL)),
    CHECK ((state = 'acknowledged') = (server_revision IS NOT NULL)),
    CHECK (wire_schema_version IS NOT 2 OR entity_generation = 1)
  ) STRICT;

INSERT INTO sync_outbox_rebuild SELECT * FROM sync_outbox;
DROP TABLE sync_outbox;
ALTER TABLE sync_outbox_rebuild RENAME TO sync_outbox;

CREATE INDEX sync_outbox_delivery
    ON sync_outbox(workspace_id, state, next_attempt_at, created_at, mutation_id);

CREATE INDEX sync_outbox_pending
    ON sync_outbox (workspace_id, acknowledged_at, created_at, mutation_id);

CREATE INDEX sync_outbox_v2_reclaim
  ON sync_outbox (
    workspace_id, state, delivery_lease_expires_at,
    device_mutation_sequence, created_at, mutation_id
  );

CREATE TRIGGER sync_outbox_created_at_insert_is_canonical
BEFORE INSERT ON sync_outbox
WHEN NEW.created_at IS NOT strftime('%Y-%m-%dT%H:%M:%SZ', NEW.created_at)
  OR substr(NEW.created_at, 12, 2) > '23'
BEGIN
  SELECT RAISE(ABORT, 'created_at must be a canonical UTC instant');
END;

CREATE TRIGGER sync_outbox_created_at_update_is_canonical
BEFORE UPDATE OF created_at ON sync_outbox
WHEN NEW.created_at IS NOT strftime('%Y-%m-%dT%H:%M:%SZ', NEW.created_at)
  OR substr(NEW.created_at, 12, 2) > '23'
BEGIN
  SELECT RAISE(ABORT, 'created_at must be a canonical UTC instant');
END;

CREATE TRIGGER sync_outbox_entity_generation_immutable
BEFORE UPDATE OF entity_generation ON sync_outbox
WHEN NEW.entity_generation != OLD.entity_generation
BEGIN
  SELECT RAISE(ABORT, 'outbox mutation generation is immutable');
END;

CREATE TRIGGER sync_outbox_entity_generation_matches_asset
BEFORE INSERT ON sync_outbox
WHEN NEW.entity_kind = 'domain_asset' AND EXISTS (
  SELECT 1 FROM domain_assets
  WHERE workspace_id = NEW.workspace_id AND entity_id = NEW.entity_id
    AND entity_generation != NEW.entity_generation
)
BEGIN
  SELECT RAISE(ABORT, 'outbox mutation generation differs from its asset');
END;

CREATE TRIGGER sync_outbox_v2_delivery_insert
BEFORE INSERT ON sync_outbox
BEGIN
  SELECT CASE WHEN NOT (
    (NEW.state = 'sending'
      AND NEW.delivery_owner IS NOT NULL
      AND NEW.delivery_lease_expires_at IS NOT NULL
      AND NEW.delivery_attempt_fence IS NOT NULL
      AND NEW.wire_schema_version IN (2, 3)
      AND NEW.wire_mutation_digest IS NOT NULL)
    OR
    (NEW.state != 'sending'
      AND NEW.delivery_owner IS NULL
      AND NEW.delivery_lease_expires_at IS NULL
      AND NEW.delivery_attempt_fence IS NULL)
  ) THEN RAISE(ABORT, 'invalid sync outbox delivery ownership') END;
  SELECT CASE WHEN NOT (
    (NEW.wire_schema_version IS NULL AND NEW.wire_mutation_digest IS NULL)
    OR (NEW.wire_schema_version IN (2, 3) AND NEW.wire_mutation_digest IS NOT NULL)
  ) THEN RAISE(ABORT, 'invalid sync outbox wire digest') END;
END;

CREATE TRIGGER sync_outbox_v2_delivery_update
BEFORE UPDATE ON sync_outbox
BEGIN
  SELECT CASE WHEN NOT (
    (NEW.state = 'sending'
      AND NEW.delivery_owner IS NOT NULL
      AND NEW.delivery_lease_expires_at IS NOT NULL
      AND NEW.delivery_attempt_fence IS NOT NULL
      AND NEW.wire_schema_version IN (2, 3)
      AND NEW.wire_mutation_digest IS NOT NULL)
    OR
    (NEW.state != 'sending'
      AND NEW.delivery_owner IS NULL
      AND NEW.delivery_lease_expires_at IS NULL
      AND NEW.delivery_attempt_fence IS NULL)
  ) THEN RAISE(ABORT, 'invalid sync outbox delivery ownership') END;
  SELECT CASE WHEN NOT (
    (NEW.wire_schema_version IS NULL AND NEW.wire_mutation_digest IS NULL)
    OR (NEW.wire_schema_version IN (2, 3) AND NEW.wire_mutation_digest IS NOT NULL)
  ) THEN RAISE(ABORT, 'invalid sync outbox wire digest') END;
END;

CREATE TRIGGER sync_outbox_v2_wire_identity_immutable
BEFORE UPDATE OF mutation_id, entity_kind, entity_id, workspace_schema_version,
  operation_kind, base_server_revision, source_device_id, active_lease_epoch,
  device_mutation_sequence, wire_schema_version, wire_mutation_digest
ON sync_outbox
WHEN OLD.wire_mutation_digest IS NOT NULL AND (
  NEW.mutation_id != OLD.mutation_id
  OR NEW.entity_kind != OLD.entity_kind
  OR NEW.entity_id != OLD.entity_id
  OR NEW.workspace_schema_version != OLD.workspace_schema_version
  OR NEW.operation_kind != OLD.operation_kind
  OR NEW.base_server_revision != OLD.base_server_revision
  OR NEW.source_device_id != OLD.source_device_id
  OR NEW.active_lease_epoch != OLD.active_lease_epoch
  OR NEW.device_mutation_sequence != OLD.device_mutation_sequence
  OR NEW.wire_schema_version != OLD.wire_schema_version
  OR NEW.wire_mutation_digest != OLD.wire_mutation_digest
)
BEGIN
  SELECT RAISE(ABORT, 'sync outbox wire identity is immutable');
END;

CREATE TABLE sync_inbox_rebuild (
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
    rejection_code TEXT, wire_schema_version INTEGER
  CHECK (wire_schema_version IS NULL OR wire_schema_version IN (2, 3)), wire_mutation_digest TEXT
  CHECK (
    wire_mutation_digest IS NULL OR (
      length(wire_mutation_digest) = 43
      AND wire_mutation_digest NOT GLOB '*[^A-Za-z0-9_-]*'
    )
  ),
    PRIMARY KEY (workspace_id, server_revision),
    UNIQUE (workspace_id, mutation_id),
    FOREIGN KEY (workspace_id) REFERENCES active_workspace_metadata(workspace_id),
    CHECK ((state = 'applied') = (applied_at IS NOT NULL)),
    CHECK ((state = 'rejected') = (rejection_code IS NOT NULL))
  ) STRICT;

INSERT INTO sync_inbox_rebuild SELECT * FROM sync_inbox;
DROP TABLE sync_inbox;
ALTER TABLE sync_inbox_rebuild RENAME TO sync_inbox;

CREATE INDEX sync_inbox_application
    ON sync_inbox(workspace_id, state, server_revision);

CREATE UNIQUE INDEX sync_inbox_wire_digest
  ON sync_inbox (workspace_id, server_revision, wire_mutation_digest)
  WHERE wire_schema_version IS NOT NULL;

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

CREATE TRIGGER sync_outbox_fields_v2_immutable_update
BEFORE UPDATE ON sync_outbox_fields
WHEN EXISTS (
  SELECT 1 FROM sync_outbox
  WHERE workspace_id = OLD.workspace_id AND mutation_id = OLD.mutation_id
    AND wire_mutation_digest IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'claimed sync outbox fields are immutable');
END;

CREATE TRIGGER sync_outbox_fields_v2_immutable_delete
BEFORE DELETE ON sync_outbox_fields
WHEN EXISTS (
  SELECT 1 FROM sync_outbox
  WHERE workspace_id = OLD.workspace_id AND mutation_id = OLD.mutation_id
    AND wire_mutation_digest IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'claimed sync outbox fields are immutable');
END;

CREATE TRIGGER sync_outbox_local_creations_mark_a_first_upsert
BEFORE INSERT ON sync_outbox_local_creations
WHEN NOT EXISTS (
    SELECT 1 FROM sync_outbox AS created
    WHERE created.workspace_id = NEW.workspace_id AND created.mutation_id = NEW.mutation_id
      AND created.operation_kind = 'upsert'
      AND NOT EXISTS (
        SELECT 1 FROM sync_outbox AS earlier
        WHERE earlier.workspace_id = created.workspace_id AND earlier.entity_id = created.entity_id
          AND earlier.local_commit_sequence < created.local_commit_sequence
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'a creation marks the first local upsert of its asset');
END;
