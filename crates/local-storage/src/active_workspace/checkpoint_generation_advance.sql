/* ADR-0029 C3b2: a rebootstrap checkpoint can carry a later generation of an entity than this
   replica confirmed. Cloud deleted and re-added it, possibly more than once, in history that
   compaction has since folded away. Decision 5 refuses only older data, and the checkpoint is
   Cloud's state, so the installation takes it.

   A checkpoint names no re-add mutation, so the replicated re-add record cannot describe this
   step. Each advance is recorded once and immutably instead: the generation left, the generation
   reached, and the checkpoint revision that showed it. The triggers below then admit exactly that
   transition, in the order the installation performs it:
   1. record the advance; it requires settled local state (no provisional re-add, no unfinished
      Outbox row, a tombstone only if Cloud already confirmed it and it is not contested);
   2. remove the superseded tombstone, if any;
   3. move the row to the later generation as a clean live row.
   The checkpoint's own asset values, or its tombstone, are then installed as for any entity of
   that generation. */
CREATE TABLE sync_domain_asset_checkpoint_advances (
    workspace_id TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    from_generation INTEGER NOT NULL CHECK (from_generation BETWEEN 1 AND 9007199254740990),
    to_generation INTEGER NOT NULL CHECK (to_generation BETWEEN 2 AND 9007199254740991),
    checkpoint_server_revision INTEGER NOT NULL
      CHECK (checkpoint_server_revision BETWEEN 1 AND 9007199254740991),
    local_commit_sequence INTEGER NOT NULL
      CHECK (local_commit_sequence BETWEEN 1 AND 9007199254740991),
    PRIMARY KEY (workspace_id, entity_id, from_generation),
    FOREIGN KEY (workspace_id) REFERENCES active_workspace_metadata(workspace_id) ON DELETE CASCADE,
    CHECK (to_generation > from_generation)
  ) STRICT;

CREATE TRIGGER sync_domain_asset_checkpoint_advances_immutable_update
BEFORE UPDATE ON sync_domain_asset_checkpoint_advances
BEGIN
  SELECT RAISE(ABORT, 'a checkpoint generation advance is immutable');
END;

CREATE TRIGGER sync_domain_asset_checkpoint_advances_immutable_delete
BEFORE DELETE ON sync_domain_asset_checkpoint_advances
BEGIN
  SELECT RAISE(ABORT, 'a checkpoint generation advance is immutable');
END;

/* The advance leaves the confirmed local generation, and only settled state. */
CREATE TRIGGER sync_domain_asset_checkpoint_advances_preconditions
BEFORE INSERT ON sync_domain_asset_checkpoint_advances
WHEN NOT (
  (
    EXISTS (
      SELECT 1 FROM domain_assets
      WHERE workspace_id = NEW.workspace_id AND entity_id = NEW.entity_id
        AND entity_generation = NEW.from_generation
    )
    OR (
      NOT EXISTS (
        SELECT 1 FROM domain_assets
        WHERE workspace_id = NEW.workspace_id AND entity_id = NEW.entity_id
      )
      AND EXISTS (
        SELECT 1 FROM sync_tombstones
        WHERE workspace_id = NEW.workspace_id AND entity_kind = 'domain_asset'
          AND entity_id = NEW.entity_id AND entity_generation = NEW.from_generation
      )
    )
  )
  AND NOT EXISTS (
    SELECT 1 FROM sync_tombstones
    WHERE workspace_id = NEW.workspace_id AND entity_kind = 'domain_asset'
      AND entity_id = NEW.entity_id
      AND (entity_generation != NEW.from_generation
           OR state NOT IN ('acknowledged', 'replicated') OR barrier_state = 'contested'
           OR deleted_server_revision IS NULL)
  )
  AND NOT EXISTS (
    SELECT 1 FROM sync_domain_asset_provisional_re_adds
    WHERE workspace_id = NEW.workspace_id AND entity_id = NEW.entity_id
  )
  AND NOT EXISTS (
    SELECT 1 FROM sync_outbox
    WHERE workspace_id = NEW.workspace_id AND entity_kind = 'domain_asset'
      AND entity_id = NEW.entity_id AND state IN ('pending', 'sending')
  )
)
BEGIN
  SELECT RAISE(ABORT, 'a checkpoint generation advance requires settled local state');
END;

DROP TRIGGER sync_tombstones_removed_only_by_re_add;
CREATE TRIGGER sync_tombstones_removed_only_by_re_add
BEFORE DELETE ON sync_tombstones
WHEN OLD.entity_kind != 'domain_asset' OR NOT (
  EXISTS (
    SELECT 1 FROM sync_domain_asset_re_adds
    WHERE workspace_id = OLD.workspace_id AND entity_id = OLD.entity_id
      AND deleted_generation = OLD.entity_generation
      AND deleted_server_revision IS OLD.deleted_server_revision
  )
  OR (
    OLD.state = 'pending' AND OLD.barrier_state = 'pending'
    AND OLD.deleted_server_revision IS NULL
    AND EXISTS (
      SELECT 1 FROM sync_outbox AS outbox
      JOIN domain_assets AS asset
        ON asset.workspace_id = outbox.workspace_id AND asset.entity_id = outbox.entity_id
      WHERE outbox.workspace_id = OLD.workspace_id
        AND outbox.entity_kind = 'domain_asset' AND outbox.entity_id = OLD.entity_id
        AND outbox.operation_kind = 'delete'
        AND outbox.local_commit_sequence = OLD.deleted_local_commit_sequence
        AND outbox.entity_generation = OLD.entity_generation
        AND outbox.state IN ('rejected', 'conflicted')
        AND outbox.last_error_code IN ('sync_deterministic_rejection', 'sync_mutation_conflict')
        AND asset.entity_generation = OLD.entity_generation AND asset.deleted_at = OLD.deleted_at
    )
  )
  OR (
    OLD.state IN ('acknowledged', 'replicated') AND OLD.barrier_state != 'contested'
    AND EXISTS (
      SELECT 1 FROM sync_domain_asset_checkpoint_advances
      WHERE workspace_id = OLD.workspace_id AND entity_id = OLD.entity_id
        AND from_generation = OLD.entity_generation
    )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'a tombstone is removed only by a confirmed re-add, a rejected local delete or a checkpoint advance');
END;

DROP TRIGGER domain_assets_entity_generation_changes_only_by_re_add;
CREATE TRIGGER domain_assets_entity_generation_changes_only_by_re_add
BEFORE UPDATE OF entity_generation ON domain_assets
WHEN NEW.entity_generation != OLD.entity_generation AND NOT (
  (
    OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL AND NEW.lifecycle_status = 'active'
    AND NEW.entity_generation = OLD.entity_generation + 1
    AND EXISTS (
      SELECT 1 FROM sync_domain_asset_re_adds
      WHERE workspace_id = OLD.workspace_id AND entity_id = OLD.entity_id
        AND deleted_generation = OLD.entity_generation
    )
    AND NOT EXISTS (
      SELECT 1 FROM sync_tombstones
      WHERE workspace_id = OLD.workspace_id AND entity_kind = 'domain_asset'
        AND entity_id = OLD.entity_id
    )
  )
  OR (
    OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL AND NEW.lifecycle_status = 'active'
    AND NEW.entity_generation = OLD.entity_generation + 1
    AND EXISTS (
      SELECT 1 FROM sync_domain_asset_provisional_re_adds AS provisional
      JOIN sync_tombstones AS tombstone
        ON tombstone.workspace_id = provisional.workspace_id
       AND tombstone.entity_kind = 'domain_asset'
       AND tombstone.entity_id = provisional.entity_id
       AND tombstone.entity_generation = provisional.deleted_generation
       AND tombstone.deleted_server_revision = provisional.deleted_server_revision
      WHERE provisional.workspace_id = OLD.workspace_id AND provisional.entity_id = OLD.entity_id
        AND provisional.deleted_generation = OLD.entity_generation
    )
  )
  OR (
    OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL AND NEW.lifecycle_status = 'archived'
    AND NEW.entity_generation = OLD.entity_generation - 1
    AND EXISTS (
      SELECT 1 FROM sync_domain_asset_provisional_re_adds AS provisional
      JOIN sync_outbox AS outbox
        ON outbox.workspace_id = provisional.workspace_id
       AND outbox.mutation_id = provisional.mutation_id
      JOIN sync_tombstones AS tombstone
        ON tombstone.workspace_id = provisional.workspace_id
       AND tombstone.entity_kind = 'domain_asset'
       AND tombstone.entity_id = provisional.entity_id
       AND tombstone.entity_generation = provisional.deleted_generation
      WHERE provisional.workspace_id = OLD.workspace_id AND provisional.entity_id = OLD.entity_id
        AND provisional.deleted_generation = NEW.entity_generation
        AND outbox.state IN ('conflicted', 'rejected')
    )
  )
  OR (
    NEW.deleted_at IS NULL AND NEW.lifecycle_status = 'active'
    AND EXISTS (
      SELECT 1 FROM sync_domain_asset_checkpoint_advances
      WHERE workspace_id = OLD.workspace_id AND entity_id = OLD.entity_id
        AND from_generation = OLD.entity_generation AND to_generation = NEW.entity_generation
    )
    AND NOT EXISTS (
      SELECT 1 FROM sync_tombstones
      WHERE workspace_id = OLD.workspace_id AND entity_kind = 'domain_asset'
        AND entity_id = OLD.entity_id
    )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'entity generation changes only through re-adding');
END;
