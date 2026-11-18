/* ADR-0029 C1c1: the local replica records which generation of a DomainAsset each row, tombstone
   and outbox mutation belongs to, so a later re-add (C2) can be told apart from the entity it
   replaced. Every existing row is generation 1: generation 1 is the only one any Desktop or
   Cloud has ever written.

   Until re-adding exists, a generation never changes after it is written. The triggers below make
   that a storage invariant rather than a convention, and pair each tombstone and each outbox
   mutation with the generation of the asset row it names. C2 replaces these triggers when it adds
   the re-add transition. */
ALTER TABLE domain_assets ADD COLUMN entity_generation INTEGER NOT NULL DEFAULT 1
  CHECK (entity_generation BETWEEN 1 AND 9007199254740991);
ALTER TABLE sync_tombstones ADD COLUMN entity_generation INTEGER NOT NULL DEFAULT 1
  CHECK (entity_generation BETWEEN 1 AND 9007199254740991);
ALTER TABLE sync_outbox ADD COLUMN entity_generation INTEGER NOT NULL DEFAULT 1
  CHECK (entity_generation BETWEEN 1 AND 9007199254740991);

CREATE TRIGGER domain_assets_entity_generation_immutable
BEFORE UPDATE OF entity_generation ON domain_assets
WHEN NEW.entity_generation != OLD.entity_generation
BEGIN
  SELECT RAISE(ABORT, 'entity generation changes only through re-adding');
END;

CREATE TRIGGER domain_assets_entity_generation_matches_tombstone
BEFORE INSERT ON domain_assets
WHEN EXISTS (
  SELECT 1 FROM sync_tombstones
  WHERE workspace_id = NEW.workspace_id AND entity_kind = 'domain_asset'
    AND entity_id = NEW.entity_id AND entity_generation != NEW.entity_generation
)
BEGIN
  SELECT RAISE(ABORT, 'asset generation differs from its tombstone');
END;

CREATE TRIGGER sync_tombstones_entity_generation_immutable
BEFORE UPDATE OF entity_generation ON sync_tombstones
WHEN NEW.entity_generation != OLD.entity_generation
BEGIN
  SELECT RAISE(ABORT, 'entity generation changes only through re-adding');
END;

CREATE TRIGGER sync_tombstones_entity_generation_matches_asset
BEFORE INSERT ON sync_tombstones
WHEN NEW.entity_kind = 'domain_asset' AND EXISTS (
  SELECT 1 FROM domain_assets
  WHERE workspace_id = NEW.workspace_id AND entity_id = NEW.entity_id
    AND entity_generation != NEW.entity_generation
)
BEGIN
  SELECT RAISE(ABORT, 'tombstone generation differs from its asset');
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
