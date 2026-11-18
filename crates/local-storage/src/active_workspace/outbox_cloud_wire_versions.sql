/* ADR-0032 S2c: an Outbox row recorded locally under wire version 2 (claimed before ADR-0029
   C1c2b) may have been recorded by Cloud as a v2 or a v3 mutation, and the drain chain must link
   the submitted envelope of the version Cloud recorded. Before signing a drain proof, the Host reads
   Cloud's own receipt for each such row and keeps here the version and the wire digest (of the
   tenant-neutral mutation) Cloud returned, after checking that digest is one of the two this device
   computes from the row. The chain envelope itself is rebuilt locally under that version. The record
   is immutable, admitted only for a version-2 row of the same workspace that already holds a
   durable Cloud result, and the Outbox row itself is never rewritten. */
CREATE TABLE sync_outbox_cloud_wire_versions (
    workspace_id TEXT NOT NULL,
    mutation_id TEXT NOT NULL,
    wire_schema_version INTEGER NOT NULL CHECK (wire_schema_version IN (2, 3)),
    wire_mutation_digest TEXT NOT NULL CHECK (
      length(wire_mutation_digest) = 43
      AND wire_mutation_digest NOT GLOB '*[^A-Za-z0-9_-]*'
    ),
    recorded_at TEXT NOT NULL CHECK (recorded_at = strftime('%Y-%m-%dT%H:%M:%SZ', recorded_at)),
    PRIMARY KEY (workspace_id, mutation_id),
    FOREIGN KEY (workspace_id) REFERENCES active_workspace_metadata(workspace_id) ON DELETE CASCADE
  ) STRICT;

CREATE TRIGGER sync_outbox_cloud_wire_versions_immutable_update
BEFORE UPDATE ON sync_outbox_cloud_wire_versions
BEGIN
  SELECT RAISE(ABORT, 'a Cloud wire version record is immutable');
END;

CREATE TRIGGER sync_outbox_cloud_wire_versions_immutable_delete
BEFORE DELETE ON sync_outbox_cloud_wire_versions
BEGIN
  SELECT RAISE(ABORT, 'a Cloud wire version record is immutable');
END;

CREATE TRIGGER sync_outbox_cloud_wire_versions_name_a_resulted_v2_row
BEFORE INSERT ON sync_outbox_cloud_wire_versions
WHEN NOT EXISTS (
  SELECT 1 FROM sync_outbox
  WHERE workspace_id = NEW.workspace_id AND mutation_id = NEW.mutation_id
    AND wire_schema_version = 2
    AND (state = 'acknowledged'
         OR (state = 'conflicted' AND last_error_code = 'sync_mutation_conflict'))
)
BEGIN
  SELECT RAISE(ABORT, 'a Cloud wire version record must name a resulted version-2 Outbox row');
END;
