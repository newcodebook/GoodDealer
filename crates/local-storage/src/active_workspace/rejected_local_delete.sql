/* A definitive Cloud rejection means the local delete did not become shared state. Permit its
   exact pending tombstone to be withdrawn, retaining the terminal Outbox row as evidence. An
   idempotency conflict is excluded because it cannot establish what the reused mutation id did. */
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
)
BEGIN
  SELECT RAISE(ABORT, 'a tombstone is removed only by a confirmed re-add or rejected local delete');
END;
