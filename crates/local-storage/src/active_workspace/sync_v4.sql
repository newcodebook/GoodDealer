/* Append-only P0-04 provenance, capacity and receipt evidence migration. */
CREATE TABLE sync_asset_provenance (
  workspace_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  root_provenance TEXT NOT NULL CHECK (root_provenance IN ('replicated','local_only')),
  replicated_server_revision INTEGER NOT NULL DEFAULT 0 CHECK (replicated_server_revision BETWEEN 0 AND 9007199254740991),
  freshness TEXT NOT NULL DEFAULT 'confirmed' CHECK (freshness IN ('confirmed','stale','unknown')),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, entity_id),
  FOREIGN KEY (workspace_id, entity_id) REFERENCES domain_assets(workspace_id, entity_id) ON DELETE CASCADE
) STRICT;

INSERT INTO sync_asset_provenance(workspace_id,entity_id,root_provenance,replicated_server_revision,freshness,updated_at)
SELECT a.workspace_id,a.entity_id,
  CASE WHEN EXISTS (
    SELECT 1 FROM domain_asset_field_versions f
    WHERE f.workspace_id=a.workspace_id AND f.entity_id=a.entity_id AND f.server_revision>0
  ) THEN 'replicated' ELSE 'local_only' END,
  coalesce((SELECT max(f.server_revision) FROM domain_asset_field_versions f
    WHERE f.workspace_id=a.workspace_id AND f.entity_id=a.entity_id),0),
  'confirmed',a.updated_at FROM domain_assets a;

ALTER TABLE domain_asset_field_versions ADD COLUMN provenance TEXT NOT NULL DEFAULT 'local_only'
  CHECK (provenance IN ('replicated','local_only'));
ALTER TABLE domain_asset_field_versions ADD COLUMN freshness TEXT NOT NULL DEFAULT 'confirmed'
  CHECK (freshness IN ('confirmed','stale','unknown'));
UPDATE domain_asset_field_versions SET provenance='replicated' WHERE server_revision>0;

CREATE TRIGGER sync_asset_provenance_insert_default
AFTER INSERT ON domain_assets
BEGIN
  INSERT OR IGNORE INTO sync_asset_provenance(workspace_id,entity_id,root_provenance,replicated_server_revision,freshness,updated_at)
  VALUES (NEW.workspace_id,NEW.entity_id,'local_only',0,'confirmed',NEW.updated_at);
END;

CREATE TABLE sync_conflict_capacity (
  workspace_id TEXT PRIMARY KEY,
  open_count INTEGER NOT NULL DEFAULT 0 CHECK (open_count BETWEEN 0 AND 10000),
  open_bytes INTEGER NOT NULL DEFAULT 0 CHECK (open_bytes BETWEEN 0 AND 67108864),
  FOREIGN KEY (workspace_id) REFERENCES active_workspace_metadata(workspace_id)
) STRICT;

INSERT INTO sync_conflict_capacity(workspace_id,open_count,open_bytes)
SELECT workspace_id,count(*),coalesce(sum(length(CAST(local_value_json AS BLOB))+length(CAST(remote_value_json AS BLOB))),0)
FROM sync_conflicts WHERE status='open' GROUP BY workspace_id;

DROP TRIGGER IF EXISTS sync_conflicts_v3_capacity_count;
DROP TRIGGER IF EXISTS sync_conflicts_v3_capacity_bytes;

CREATE TRIGGER sync_conflicts_capacity_insert
BEFORE INSERT ON sync_conflicts
BEGIN
  INSERT OR IGNORE INTO sync_conflict_capacity(workspace_id) VALUES (NEW.workspace_id);
  SELECT CASE WHEN (SELECT open_count FROM sync_conflict_capacity WHERE workspace_id=NEW.workspace_id) >= 10000
    OR (SELECT open_bytes FROM sync_conflict_capacity WHERE workspace_id=NEW.workspace_id)
      + length(CAST(NEW.local_value_json AS BLOB)) + length(CAST(NEW.remote_value_json AS BLOB)) > 67108864
    THEN RAISE(ABORT,'conflict capacity exceeded') END;
END;

CREATE TRIGGER sync_conflicts_capacity_after_insert
AFTER INSERT ON sync_conflicts WHEN NEW.status='open'
BEGIN
  UPDATE sync_conflict_capacity SET open_count=open_count+1,
    open_bytes=open_bytes+length(CAST(NEW.local_value_json AS BLOB))+length(CAST(NEW.remote_value_json AS BLOB))
    WHERE workspace_id=NEW.workspace_id;
END;

CREATE TRIGGER sync_conflicts_capacity_after_resolve
AFTER UPDATE OF status ON sync_conflicts
WHEN OLD.status='open' AND NEW.status!='open'
BEGIN
  UPDATE sync_conflict_capacity SET open_count=open_count-1,
    open_bytes=open_bytes-length(CAST(OLD.local_value_json AS BLOB))-length(CAST(OLD.remote_value_json AS BLOB))
    WHERE workspace_id=OLD.workspace_id;
END;

ALTER TABLE sync_resolution_receipts ADD COLUMN candidate_set_version INTEGER NOT NULL DEFAULT 0
  CHECK (candidate_set_version BETWEEN 0 AND 9007199254740991);
ALTER TABLE sync_resolution_receipts ADD COLUMN remote_server_revision INTEGER NOT NULL DEFAULT 0
  CHECK (remote_server_revision BETWEEN 0 AND 9007199254740991);
ALTER TABLE sync_resolution_receipts ADD COLUMN current_value_hash TEXT NOT NULL DEFAULT ''
  CHECK (current_value_hash = '' OR length(current_value_hash)=64);

/* Replace the pre-P0-04 journal shape with opaque linkage only. */
CREATE TABLE sync_rebootstrap_journal_v4 (
  workspace_id TEXT NOT NULL,
  journal_id TEXT NOT NULL,
  slot_id TEXT NOT NULL CHECK (slot_id IN ('A','B')),
  publication_sequence INTEGER NOT NULL CHECK (publication_sequence BETWEEN 1 AND 9007199254740991),
  manifest_digest TEXT NOT NULL CHECK (length(manifest_digest)=64),
  authority_digest TEXT NOT NULL CHECK (length(authority_digest)=64),
  floor_digest TEXT NOT NULL CHECK (length(floor_digest)=64),
  binding_digest TEXT NOT NULL CHECK (length(binding_digest)=64),
  state TEXT NOT NULL CHECK (state IN ('prepared','verified','publish_intent','published','reopened_verified','retired_old','cancelled','quarantined','recovery_unavailable')),
  failure_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, publication_sequence),
  UNIQUE (workspace_id, journal_id),
  FOREIGN KEY (workspace_id) REFERENCES active_workspace_metadata(workspace_id),
  CHECK ((state IN ('cancelled','quarantined','recovery_unavailable')) = (failure_code IS NOT NULL))
) STRICT;

INSERT INTO sync_rebootstrap_journal_v4
 (workspace_id,journal_id,slot_id,publication_sequence,manifest_digest,authority_digest,
  floor_digest,binding_digest,state,failure_code,created_at,updated_at)
SELECT workspace_id, 'legacy-' || publication_sequence,
  CASE WHEN new_slot_id IN ('A','B') THEN new_slot_id
       WHEN lower(new_slot_id) LIKE '%slot-a%' THEN 'A' ELSE 'B' END,
  publication_sequence,manifest_digest,old_key_digest,new_key_digest,new_key_digest,
  'quarantined','legacy_journal_shape',created_at,updated_at
FROM sync_rebootstrap_journal;

DROP TABLE sync_rebootstrap_journal;
ALTER TABLE sync_rebootstrap_journal_v4 RENAME TO sync_rebootstrap_journal;

CREATE TRIGGER sync_rebootstrap_journal_no_delete
BEFORE DELETE ON sync_rebootstrap_journal BEGIN
  SELECT RAISE(ABORT, 'rebootstrap journal cannot be deleted');
END;
CREATE TRIGGER sync_rebootstrap_journal_no_update
BEFORE UPDATE ON sync_rebootstrap_journal BEGIN
  SELECT RAISE(ABORT, 'rebootstrap journal cannot be updated');
END;
