/* ADR-0029 C2b: a re-add another device made, which Cloud accepted, reaches this replica through
   the Inbox. Applying it replaces the generation-g tombstone and soft-deleted row with a live row
   of generation g + 1, which C1c1 made impossible ("entity generation changes only through
   re-adding").

   Each superseded generation leaves one immutable record: the deletion revision it superseded and
   the re-add mutation and revision that superseded it. The record is the evidence the two
   transitions below require, so neither can happen without it:
   - a tombstone is removed only when a record names its generation and deletion revision;
   - an asset's generation changes only from a soft-deleted row with no tombstone left, by exactly
     one, back to a live row, and only when a record names the generation it leaves.
   The Inbox writes the record, removes the tombstone, then resets the row, in one transaction.
   Only replicated re-adds exist so far; a local re-add (C2c) extends `origin`. */
CREATE TABLE sync_domain_asset_re_adds (
    workspace_id TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    deleted_generation INTEGER NOT NULL CHECK (deleted_generation BETWEEN 1 AND 9007199254740990),
    deleted_server_revision INTEGER NOT NULL
      CHECK (deleted_server_revision BETWEEN 1 AND 9007199254740991),
    re_add_mutation_id TEXT NOT NULL CHECK (length(re_add_mutation_id) BETWEEN 1 AND 160),
    re_add_server_revision INTEGER NOT NULL
      CHECK (re_add_server_revision BETWEEN 2 AND 9007199254740991),
    origin TEXT NOT NULL CHECK (origin = 'replicated'),
    local_commit_sequence INTEGER NOT NULL
      CHECK (local_commit_sequence BETWEEN 1 AND 9007199254740991),
    PRIMARY KEY (workspace_id, entity_id, deleted_generation),
    UNIQUE (workspace_id, re_add_mutation_id),
    FOREIGN KEY (workspace_id) REFERENCES active_workspace_metadata(workspace_id) ON DELETE CASCADE,
    CHECK (re_add_server_revision > deleted_server_revision)
  ) STRICT;

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

/* A record must name the tombstone it supersedes, as it stands when the record is written. */
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

DROP TRIGGER domain_assets_entity_generation_immutable;

CREATE TRIGGER domain_assets_entity_generation_changes_only_by_re_add
BEFORE UPDATE OF entity_generation ON domain_assets
WHEN NEW.entity_generation != OLD.entity_generation AND NOT (
  OLD.deleted_at IS NOT NULL
  AND NEW.deleted_at IS NULL
  AND NEW.lifecycle_status = 'active'
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
BEGIN
  SELECT RAISE(ABORT, 'entity generation changes only through re-adding');
END;

/* A deleted row stays deleted while its tombstone stands: restoring it in place would revive the
   generation the tombstone deleted. Only the re-add above, after the tombstone is gone, revives
   the entity, and it does so as the next generation. */
CREATE TRIGGER domain_assets_deleted_row_stays_deleted_under_tombstone
BEFORE UPDATE OF deleted_at ON domain_assets
WHEN OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL AND EXISTS (
  SELECT 1 FROM sync_tombstones
  WHERE workspace_id = OLD.workspace_id AND entity_kind = 'domain_asset'
    AND entity_id = OLD.entity_id
)
BEGIN
  SELECT RAISE(ABORT, 'a deleted domain asset revives only by re-adding');
END;
