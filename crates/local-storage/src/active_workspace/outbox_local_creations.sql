-- Marks the outbox upserts that created their asset, so operation history can show an add as an
-- add. The sync wire has only `upsert` and `delete`, and an asset pulled from the cloud also gets a
-- first local upsert when it is edited, so creation cannot be inferred from the ledger; the create
-- path records it here in the same transaction instead. The marker is Host-only and never synced.
-- Creations committed before this migration have no marker and keep reading as edits.
CREATE TABLE sync_outbox_local_creations (
    workspace_id TEXT NOT NULL,
    mutation_id TEXT NOT NULL,
    PRIMARY KEY (workspace_id, mutation_id),
    FOREIGN KEY (workspace_id, mutation_id)
      REFERENCES sync_outbox(workspace_id, mutation_id) ON DELETE CASCADE
  ) STRICT;

-- Only an upsert can create an asset, and it must be the asset's first local revision.
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

CREATE TRIGGER sync_outbox_local_creations_immutable
BEFORE UPDATE ON sync_outbox_local_creations
BEGIN
  SELECT RAISE(ABORT, 'creation markers are immutable');
END;
