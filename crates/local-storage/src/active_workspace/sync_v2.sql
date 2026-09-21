ALTER TABLE sync_outbox ADD COLUMN delivery_owner TEXT;
ALTER TABLE sync_outbox ADD COLUMN delivery_lease_expires_at TEXT;
ALTER TABLE sync_outbox ADD COLUMN delivery_attempt_fence INTEGER
  CHECK (delivery_attempt_fence IS NULL OR delivery_attempt_fence BETWEEN 1 AND 9007199254740991);
ALTER TABLE sync_outbox ADD COLUMN wire_schema_version INTEGER
  CHECK (wire_schema_version IS NULL OR wire_schema_version = 2);
ALTER TABLE sync_outbox ADD COLUMN wire_mutation_digest TEXT
  CHECK (
    wire_mutation_digest IS NULL OR (
      length(wire_mutation_digest) = 43
      AND wire_mutation_digest NOT GLOB '*[^A-Za-z0-9_-]*'
    )
  );

/* A pre-v2 sending marker has no durable owner/fence and is outcome-unknown. */
UPDATE sync_outbox
SET state = 'pending', next_attempt_at = NULL, last_error_code = NULL
WHERE state = 'sending';

CREATE TRIGGER sync_outbox_v2_delivery_insert
BEFORE INSERT ON sync_outbox
BEGIN
  SELECT CASE WHEN NOT (
    (NEW.state = 'sending'
      AND NEW.delivery_owner IS NOT NULL
      AND NEW.delivery_lease_expires_at IS NOT NULL
      AND NEW.delivery_attempt_fence IS NOT NULL
      AND NEW.wire_schema_version = 2
      AND NEW.wire_mutation_digest IS NOT NULL)
    OR
    (NEW.state != 'sending'
      AND NEW.delivery_owner IS NULL
      AND NEW.delivery_lease_expires_at IS NULL
      AND NEW.delivery_attempt_fence IS NULL)
  ) THEN RAISE(ABORT, 'invalid sync outbox delivery ownership') END;
  SELECT CASE WHEN NOT (
    (NEW.wire_schema_version IS NULL AND NEW.wire_mutation_digest IS NULL)
    OR (NEW.wire_schema_version = 2 AND NEW.wire_mutation_digest IS NOT NULL)
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
      AND NEW.wire_schema_version = 2
      AND NEW.wire_mutation_digest IS NOT NULL)
    OR
    (NEW.state != 'sending'
      AND NEW.delivery_owner IS NULL
      AND NEW.delivery_lease_expires_at IS NULL
      AND NEW.delivery_attempt_fence IS NULL)
  ) THEN RAISE(ABORT, 'invalid sync outbox delivery ownership') END;
  SELECT CASE WHEN NOT (
    (NEW.wire_schema_version IS NULL AND NEW.wire_mutation_digest IS NULL)
    OR (NEW.wire_schema_version = 2 AND NEW.wire_mutation_digest IS NOT NULL)
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

CREATE INDEX sync_outbox_v2_reclaim
  ON sync_outbox (
    workspace_id, state, delivery_lease_expires_at,
    device_mutation_sequence, created_at, mutation_id
  );

ALTER TABLE sync_inbox ADD COLUMN wire_schema_version INTEGER
  CHECK (wire_schema_version IS NULL OR wire_schema_version = 2);
ALTER TABLE sync_inbox ADD COLUMN wire_mutation_digest TEXT
  CHECK (
    wire_mutation_digest IS NULL OR (
      length(wire_mutation_digest) = 43
      AND wire_mutation_digest NOT GLOB '*[^A-Za-z0-9_-]*'
    )
  );
CREATE UNIQUE INDEX sync_inbox_v2_digest
  ON sync_inbox (workspace_id, server_revision, wire_mutation_digest)
  WHERE wire_schema_version = 2;

ALTER TABLE sync_reader_state ADD COLUMN confirmation_token TEXT;
ALTER TABLE sync_reader_state ADD COLUMN last_page_digest TEXT
  CHECK (
    last_page_digest IS NULL OR (
      length(last_page_digest) = 43
      AND last_page_digest NOT GLOB '*[^A-Za-z0-9_-]*'
    )
  );
