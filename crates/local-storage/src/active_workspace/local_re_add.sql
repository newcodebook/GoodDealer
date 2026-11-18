/* ADR-0029 C2c1: this device re-adds a domain asset whose deletion Cloud confirmed.

   Until Cloud acknowledges the re-add, generation g + 1 is provisional (decision 4): the
   generation-g tombstone stays, and a provisional pointer names the one Outbox row that carries
   the re-add. While the pointer exists the entity is frozen: no other Outbox row for it may be
   written, so the re-add is the only local work a rejection has to undo. The pointer ends in one
   of two ways, and the schema admits only those:
   - acknowledged: a `local` re-add record is written, the tombstone is removed, then the pointer;
   - rejected: the Outbox row is terminal, the row is withdrawn to the deleted generation g, then
     the pointer. The Outbox row, its fields and its creation marker stay as evidence, and a
     corrected attempt may name g + 1 again.

   `sync_domain_asset_re_adds` is rebuilt so its origin may be `local`; the triggers that read it
   are recreated around the rebuild. */
DROP TRIGGER sync_domain_asset_re_adds_immutable_update;
DROP TRIGGER sync_domain_asset_re_adds_immutable_delete;
DROP TRIGGER sync_domain_asset_re_adds_name_tombstone;
DROP TRIGGER sync_tombstones_removed_only_by_re_add;
DROP TRIGGER domain_assets_entity_generation_changes_only_by_re_add;
DROP TRIGGER domain_assets_deleted_row_stays_deleted_under_tombstone;

CREATE TABLE sync_domain_asset_re_adds_rebuild (
    workspace_id TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    deleted_generation INTEGER NOT NULL CHECK (deleted_generation BETWEEN 1 AND 9007199254740990),
    deleted_server_revision INTEGER NOT NULL
      CHECK (deleted_server_revision BETWEEN 1 AND 9007199254740991),
    re_add_mutation_id TEXT NOT NULL CHECK (length(re_add_mutation_id) BETWEEN 1 AND 160),
    re_add_server_revision INTEGER NOT NULL
      CHECK (re_add_server_revision BETWEEN 2 AND 9007199254740991),
    origin TEXT NOT NULL CHECK (origin IN ('replicated', 'local')),
    local_commit_sequence INTEGER NOT NULL
      CHECK (local_commit_sequence BETWEEN 1 AND 9007199254740991),
    PRIMARY KEY (workspace_id, entity_id, deleted_generation),
    UNIQUE (workspace_id, re_add_mutation_id),
    FOREIGN KEY (workspace_id) REFERENCES active_workspace_metadata(workspace_id) ON DELETE CASCADE,
    CHECK (re_add_server_revision > deleted_server_revision)
  ) STRICT;
INSERT INTO sync_domain_asset_re_adds_rebuild SELECT * FROM sync_domain_asset_re_adds;
DROP TABLE sync_domain_asset_re_adds;
ALTER TABLE sync_domain_asset_re_adds_rebuild RENAME TO sync_domain_asset_re_adds;

CREATE TRIGGER sync_domain_asset_re_adds_immutable_update
BEFORE UPDATE ON sync_domain_asset_re_adds
BEGIN
  SELECT RAISE(ABORT, 'a re-add record is immutable');
END;

CREATE TRIGGER sync_domain_asset_re_adds_immutable_delete
BEFORE DELETE ON sync_domain_asset_re_adds
BEGIN
  SELECT RAISE(ABORT, 'a re-add record is immutable');
END;

CREATE TRIGGER sync_domain_asset_re_adds_name_tombstone
BEFORE INSERT ON sync_domain_asset_re_adds
WHEN NOT EXISTS (
  SELECT 1 FROM sync_tombstones
  WHERE workspace_id = NEW.workspace_id AND entity_kind = 'domain_asset'
    AND entity_id = NEW.entity_id AND entity_generation = NEW.deleted_generation
    AND deleted_server_revision = NEW.deleted_server_revision
)
BEGIN
  SELECT RAISE(ABORT, 'a re-add record must name its tombstone');
END;

-- A local record confirms the provisional re-add Cloud acknowledged, at the acknowledged revision.
CREATE TRIGGER sync_domain_asset_re_adds_local_is_acknowledged
BEFORE INSERT ON sync_domain_asset_re_adds
WHEN NEW.origin = 'local' AND NOT EXISTS (
  SELECT 1 FROM sync_domain_asset_provisional_re_adds AS provisional
  JOIN sync_outbox AS outbox
    ON outbox.workspace_id = provisional.workspace_id
   AND outbox.mutation_id = provisional.mutation_id
  WHERE provisional.workspace_id = NEW.workspace_id AND provisional.entity_id = NEW.entity_id
    AND provisional.mutation_id = NEW.re_add_mutation_id
    AND provisional.deleted_generation = NEW.deleted_generation
    AND provisional.deleted_server_revision = NEW.deleted_server_revision
    AND outbox.state = 'acknowledged' AND outbox.server_revision = NEW.re_add_server_revision
)
BEGIN
  SELECT RAISE(ABORT, 'a local re-add record confirms an acknowledged provisional re-add');
END;

CREATE TRIGGER sync_tombstones_removed_only_by_re_add
BEFORE DELETE ON sync_tombstones
WHEN OLD.entity_kind != 'domain_asset' OR NOT EXISTS (
  SELECT 1 FROM sync_domain_asset_re_adds
  WHERE workspace_id = OLD.workspace_id AND entity_id = OLD.entity_id
    AND deleted_generation = OLD.entity_generation
    AND deleted_server_revision IS OLD.deleted_server_revision
)
BEGIN
  SELECT RAISE(ABORT, 'a tombstone is removed only by the re-add that supersedes it');
END;

ALTER TABLE sync_outbox ADD COLUMN re_adds_deleted_revision INTEGER
  CHECK (re_adds_deleted_revision IS NULL OR re_adds_deleted_revision BETWEEN 1 AND 9007199254740991);

CREATE TABLE sync_domain_asset_provisional_re_adds (
    workspace_id TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    deleted_generation INTEGER NOT NULL CHECK (deleted_generation BETWEEN 1 AND 9007199254740990),
    deleted_server_revision INTEGER NOT NULL
      CHECK (deleted_server_revision BETWEEN 1 AND 9007199254740991),
    mutation_id TEXT NOT NULL CHECK (length(mutation_id) BETWEEN 1 AND 160),
    PRIMARY KEY (workspace_id, entity_id),
    UNIQUE (workspace_id, mutation_id),
    FOREIGN KEY (workspace_id) REFERENCES active_workspace_metadata(workspace_id),
    -- The pointer is written before the Outbox row it names, in the same transaction.
    FOREIGN KEY (workspace_id, mutation_id) REFERENCES sync_outbox(workspace_id, mutation_id)
      DEFERRABLE INITIALLY DEFERRED
  ) STRICT;

/* Decision 4's preconditions, checked where the provisional state begins: the deletion is
   confirmed (acknowledged or replicated, at revision R), its barrier is settled, the asset is the
   soft-deleted row of that generation, and nothing local is owed on the entity. */
CREATE TRIGGER sync_domain_asset_provisional_re_adds_preconditions
BEFORE INSERT ON sync_domain_asset_provisional_re_adds
WHEN NOT EXISTS (
    SELECT 1 FROM sync_tombstones
    WHERE workspace_id = NEW.workspace_id AND entity_kind = 'domain_asset'
      AND entity_id = NEW.entity_id AND entity_generation = NEW.deleted_generation
      AND deleted_server_revision = NEW.deleted_server_revision
      AND state IN ('acknowledged', 'replicated') AND barrier_state IS NOT 'contested'
  )
  OR NOT EXISTS (
    SELECT 1 FROM domain_assets
    WHERE workspace_id = NEW.workspace_id AND entity_id = NEW.entity_id
      AND entity_generation = NEW.deleted_generation AND deleted_at IS NOT NULL
  )
  OR EXISTS (
    SELECT 1 FROM sync_outbox
    WHERE workspace_id = NEW.workspace_id AND entity_kind = 'domain_asset'
      AND entity_id = NEW.entity_id AND state IN ('pending', 'sending')
  )
  OR EXISTS (
    SELECT 1 FROM sync_conflicts
    WHERE workspace_id = NEW.workspace_id AND entity_kind = 'domain_asset'
      AND entity_id = NEW.entity_id AND status = 'open'
  )
BEGIN
  SELECT RAISE(ABORT, 'a local re-add needs a confirmed, settled tombstone and no owed work');
END;

CREATE TRIGGER sync_domain_asset_provisional_re_adds_immutable
BEFORE UPDATE ON sync_domain_asset_provisional_re_adds
BEGIN
  SELECT RAISE(ABORT, 'a provisional re-add is immutable');
END;

CREATE TRIGGER sync_domain_asset_provisional_re_adds_end_by_outcome
BEFORE DELETE ON sync_domain_asset_provisional_re_adds
WHEN NOT (
  (
    EXISTS (
      SELECT 1 FROM sync_domain_asset_re_adds
      WHERE workspace_id = OLD.workspace_id AND entity_id = OLD.entity_id
        AND deleted_generation = OLD.deleted_generation
        AND re_add_mutation_id = OLD.mutation_id AND origin = 'local'
    )
    AND NOT EXISTS (
      SELECT 1 FROM sync_tombstones
      WHERE workspace_id = OLD.workspace_id AND entity_kind = 'domain_asset'
        AND entity_id = OLD.entity_id
    )
  )
  OR (
    EXISTS (
      SELECT 1 FROM sync_outbox
      WHERE workspace_id = OLD.workspace_id AND mutation_id = OLD.mutation_id
        AND state IN ('conflicted', 'rejected')
    )
    AND EXISTS (
      SELECT 1 FROM domain_assets
      WHERE workspace_id = OLD.workspace_id AND entity_id = OLD.entity_id
        AND entity_generation = OLD.deleted_generation AND deleted_at IS NOT NULL
    )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'a provisional re-add ends only when acknowledged or withdrawn');
END;

CREATE TRIGGER sync_outbox_re_adds_deleted_revision_immutable
BEFORE UPDATE OF re_adds_deleted_revision ON sync_outbox
WHEN NEW.re_adds_deleted_revision IS NOT OLD.re_adds_deleted_revision
BEGIN
  SELECT RAISE(ABORT, 'an outbox re-add revision is immutable');
END;

-- An Outbox re-add is the upsert its provisional pointer names, one generation on, building on R.
CREATE TRIGGER sync_outbox_re_add_names_its_provisional_pointer
BEFORE INSERT ON sync_outbox
WHEN NEW.re_adds_deleted_revision IS NOT NULL AND (
  NEW.entity_kind != 'domain_asset' OR NEW.operation_kind != 'upsert'
  OR NEW.re_adds_deleted_revision > NEW.base_server_revision
  OR NOT EXISTS (
    SELECT 1 FROM sync_domain_asset_provisional_re_adds
    WHERE workspace_id = NEW.workspace_id AND entity_id = NEW.entity_id
      AND mutation_id = NEW.mutation_id
      AND deleted_server_revision = NEW.re_adds_deleted_revision
      AND deleted_generation + 1 = NEW.entity_generation
  )
)
BEGIN
  SELECT RAISE(ABORT, 'an outbox re-add must name its provisional pointer');
END;

CREATE TRIGGER sync_outbox_frozen_during_provisional_re_add
BEFORE INSERT ON sync_outbox
WHEN EXISTS (
  SELECT 1 FROM sync_domain_asset_provisional_re_adds
  WHERE workspace_id = NEW.workspace_id AND entity_id = NEW.entity_id
    AND mutation_id != NEW.mutation_id
)
BEGIN
  SELECT RAISE(ABORT, 'a domain asset is frozen while its re-add is provisional');
END;

/* Generation changes: a confirmed re-add (the tombstone already gone, as the Inbox applies one),
   a provisional local re-add (the tombstone stays until acknowledgement), or the withdrawal of a
   rejected provisional re-add back to the deleted generation it superseded. */
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
)
BEGIN
  SELECT RAISE(ABORT, 'entity generation changes only through re-adding');
END;

/* A deleted row stays deleted while its tombstone stands, except as the provisional local re-add
   above, which moves it to the next generation in the same statement. */
CREATE TRIGGER domain_assets_deleted_row_stays_deleted_under_tombstone
BEFORE UPDATE OF deleted_at ON domain_assets
WHEN OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL
  AND EXISTS (
    SELECT 1 FROM sync_tombstones
    WHERE workspace_id = OLD.workspace_id AND entity_kind = 'domain_asset'
      AND entity_id = OLD.entity_id
  )
  AND NOT (
    NEW.entity_generation = OLD.entity_generation + 1
    AND EXISTS (
      SELECT 1 FROM sync_domain_asset_provisional_re_adds
      WHERE workspace_id = OLD.workspace_id AND entity_id = OLD.entity_id
        AND deleted_generation = OLD.entity_generation
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'a deleted domain asset revives only by re-adding');
END;

/* A creation marker still marks an asset's first local upsert; it may also mark a local re-add,
   which starts a new generation of the asset. Each attempt is its own Outbox row and marker. */
DROP TRIGGER sync_outbox_local_creations_mark_a_first_upsert;
CREATE TRIGGER sync_outbox_local_creations_mark_a_first_upsert
BEFORE INSERT ON sync_outbox_local_creations
WHEN NOT EXISTS (
    SELECT 1 FROM sync_outbox AS created
    WHERE created.workspace_id = NEW.workspace_id AND created.mutation_id = NEW.mutation_id
      AND created.operation_kind = 'upsert'
      AND (
        created.re_adds_deleted_revision IS NOT NULL
        OR NOT EXISTS (
          SELECT 1 FROM sync_outbox AS earlier
          WHERE earlier.workspace_id = created.workspace_id
            AND earlier.entity_id = created.entity_id
            AND earlier.local_commit_sequence < created.local_commit_sequence
        )
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'a creation marks the first local upsert of its asset');
END;
