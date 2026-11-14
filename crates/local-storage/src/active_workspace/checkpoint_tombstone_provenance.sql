/* ADR-0029 C1c2a: a rebootstrap installs the tombstones a version-3 checkpoint carries. A tombstone
   that came from a replicated mutation keeps (revision, source device, mutation id) as its order
   evidence; a checkpoint names only the deletion revision and generation. Cloud assigns every
   accepted mutation its own revision, so the revision alone orders a checkpoint tombstone against
   any later replicated mutation; the device and mutation ids only break ties within one revision.

   `order_provenance` records which evidence a tombstone carries. A checkpoint tombstone is
   replicated, carries its deletion revision as its order revision, and never gains mutation ids
   it was not given. */
ALTER TABLE sync_tombstones ADD COLUMN order_provenance TEXT NOT NULL DEFAULT 'mutation'
  CHECK (order_provenance IN ('mutation', 'checkpoint'));

DROP TRIGGER sync_tombstones_v3_complete_insert;
CREATE TRIGGER sync_tombstones_v3_complete_insert
BEFORE INSERT ON sync_tombstones
BEGIN
  SELECT CASE WHEN NEW.state != 'pending' AND NEW.barrier_state IS NULL THEN RAISE(ABORT, 'missing tombstone barrier') END;
  SELECT CASE WHEN NEW.order_provenance = 'mutation'
    AND NEW.barrier_state IN ('contested','replicated','acknowledged','purge_eligible')
    AND (NEW.order_server_revision IS NULL OR NEW.order_source_device_id IS NULL
         OR NEW.order_mutation_id IS NULL)
    THEN RAISE(ABORT, 'missing tombstone order evidence') END;
  SELECT CASE WHEN NEW.order_provenance = 'checkpoint'
    AND (NEW.state != 'replicated' OR NEW.barrier_state IS NOT 'replicated'
         OR NEW.deleted_server_revision IS NULL
         OR NEW.order_server_revision IS NOT NEW.deleted_server_revision
         OR NEW.order_source_device_id IS NOT NULL OR NEW.order_mutation_id IS NOT NULL)
    THEN RAISE(ABORT, 'checkpoint tombstone carries only its deletion revision') END;
END;

CREATE TRIGGER sync_tombstones_order_provenance_update
BEFORE UPDATE ON sync_tombstones
WHEN NEW.order_provenance != OLD.order_provenance
  OR (NEW.order_provenance = 'checkpoint'
      AND (NEW.order_source_device_id IS NOT NULL OR NEW.order_mutation_id IS NOT NULL))
BEGIN
  SELECT RAISE(ABORT, 'tombstone order provenance is immutable');
END;
