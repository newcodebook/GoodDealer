-- SellerHub authority is scoped to a separate immutable credential slot. Existing Registrar
-- connections cannot gain marketplace authority by changing their declared role.
CREATE TABLE spaceship_sellerhub_connections (
  workspace_id TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  incarnation_id TEXT NOT NULL,
  credential_proof TEXT NOT NULL CHECK (
    length(credential_proof)=64 AND credential_proof NOT GLOB '*[^0-9a-f]*'
  ),
  state TEXT NOT NULL CHECK (state IN ('prepared','active','revoked')),
  created_at TEXT NOT NULL,
  purged_at TEXT CHECK (purged_at IS NULL OR (state='revoked' AND purged_at>=created_at)),
  PRIMARY KEY (workspace_id,connection_id),
  UNIQUE (workspace_id,incarnation_id),
  FOREIGN KEY (workspace_id,connection_id)
    REFERENCES local_provider_connections(workspace_id,connection_id) ON DELETE RESTRICT
) STRICT;

CREATE TRIGGER spaceship_sellerhub_connection_insert_shape
BEFORE INSERT ON spaceship_sellerhub_connections
WHEN NEW.state!='prepared' OR NEW.purged_at IS NOT NULL OR NOT EXISTS (
  SELECT 1 FROM local_provider_connections c
  WHERE c.workspace_id=NEW.workspace_id AND c.connection_id=NEW.connection_id
    AND c.provider_kind='spaceship' AND c.connection_incarnation_id=NEW.incarnation_id
    AND json(c.capabilities_json)='["marketplace"]' AND c.credential_use_state='inactive'
    AND c.lifecycle_status='invalid' AND c.revoked_at IS NULL AND c.deleted_at IS NULL
)
BEGIN SELECT RAISE(ABORT, 'SellerHub slot must start prepared'); END;

CREATE TRIGGER spaceship_sellerhub_connection_immutable
BEFORE UPDATE ON spaceship_sellerhub_connections
WHEN NEW.workspace_id IS NOT OLD.workspace_id OR NEW.connection_id IS NOT OLD.connection_id
  OR NEW.incarnation_id IS NOT OLD.incarnation_id OR NEW.credential_proof IS NOT OLD.credential_proof
  OR NEW.created_at IS NOT OLD.created_at
  OR (OLD.purged_at IS NOT NULL AND NEW.purged_at IS NOT OLD.purged_at)
  OR NOT (NEW.state=OLD.state OR NEW.state='revoked' OR (OLD.state='prepared' AND NEW.state='active'))
BEGIN SELECT RAISE(ABORT, 'SellerHub slot identity and retirement are permanent'); END;

CREATE TRIGGER spaceship_sellerhub_connection_no_delete
BEFORE DELETE ON spaceship_sellerhub_connections
BEGIN SELECT RAISE(ABORT, 'SellerHub slot history is permanent'); END;

CREATE TRIGGER spaceship_sellerhub_connection_identity_immutable
BEFORE UPDATE ON local_provider_connections
WHEN EXISTS (
  SELECT 1 FROM spaceship_sellerhub_connections s
  WHERE s.workspace_id=OLD.workspace_id AND s.connection_id=OLD.connection_id
) AND (
  NEW.workspace_id IS NOT OLD.workspace_id OR NEW.connection_id IS NOT OLD.connection_id
  OR NEW.provider_kind IS NOT OLD.provider_kind
  OR NEW.connection_incarnation_id IS NOT OLD.connection_incarnation_id
  OR NEW.capabilities_json IS NOT OLD.capabilities_json
)
BEGIN SELECT RAISE(ABORT, 'SellerHub slot owns its connection identity'); END;

DROP TRIGGER spaceship_registrar_connection_publication_update;
CREATE TRIGGER spaceship_connection_publication_update
BEFORE UPDATE ON local_provider_connections
WHEN NEW.provider_kind='spaceship' AND NEW.credential_use_state='active' AND (
  NEW.revoked_at IS NOT NULL OR NEW.deleted_at IS NOT NULL
  OR NEW.lifecycle_status!='active' OR NEW.validation_status!='valid'
  OR NOT (
    (json(NEW.capabilities_json)='["registrar"]' AND EXISTS (
      SELECT 1 FROM spaceship_registrar_connections s
      WHERE s.workspace_id=NEW.workspace_id AND s.connection_id=NEW.connection_id
        AND s.incarnation_id=NEW.connection_incarnation_id AND s.state='active' AND s.purged_at IS NULL
    ))
    OR (json(NEW.capabilities_json)='["marketplace"]' AND EXISTS (
      SELECT 1 FROM spaceship_sellerhub_connections s
      WHERE s.workspace_id=NEW.workspace_id AND s.connection_id=NEW.connection_id
        AND s.incarnation_id=NEW.connection_incarnation_id AND s.state='active' AND s.purged_at IS NULL
    ))
  )
)
BEGIN SELECT RAISE(ABORT, 'Spaceship requires a published Native slot for the exact role'); END;

CREATE TABLE spaceship_sellerhub_pending_scans (
  workspace_id TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  incarnation_id TEXT NOT NULL,
  device_id TEXT NOT NULL CHECK (
    length(device_id) BETWEEN 1 AND 160 AND device_id NOT GLOB '*[^!-~]*'
  ),
  lease_epoch INTEGER NOT NULL CHECK (lease_epoch BETWEEN 1 AND 9007199254740991),
  request_id TEXT NOT NULL,
  PRIMARY KEY (workspace_id,connection_id),
  UNIQUE (workspace_id,request_id),
  FOREIGN KEY (workspace_id,connection_id)
    REFERENCES spaceship_sellerhub_connections(workspace_id,connection_id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE spaceship_sellerhub_scans (
  workspace_id TEXT NOT NULL,
  scan_id TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  observation_run_id TEXT,
  observed_count INTEGER NOT NULL CHECK (observed_count BETWEEN 0 AND 10000),
  imported_count INTEGER NOT NULL CHECK (imported_count>=0),
  skipped_count INTEGER NOT NULL CHECK (skipped_count>=0),
  completed_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id,scan_id),
  UNIQUE (workspace_id,observation_run_id),
  FOREIGN KEY (workspace_id,connection_id)
    REFERENCES spaceship_sellerhub_connections(workspace_id,connection_id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id,observation_run_id)
    REFERENCES provider_observation_runs(workspace_id,observation_run_id) ON DELETE RESTRICT,
  CHECK (imported_count+skipped_count<=observed_count),
  CHECK ((observation_run_id IS NULL)=(observed_count=skipped_count))
) STRICT;
CREATE INDEX spaceship_sellerhub_scans_connection
ON spaceship_sellerhub_scans(workspace_id,connection_id);

ALTER TABLE marketplace_listing_observations ADD COLUMN sellerhub_asset_generation INTEGER
  CHECK (sellerhub_asset_generation IS NULL OR (
    marketplace_kind='spaceship' AND binding_connection_id IS NOT NULL
    AND sellerhub_asset_generation BETWEEN 1 AND 9007199254740991
  ));

CREATE TRIGGER spaceship_sellerhub_observation_scope
BEFORE INSERT ON marketplace_listing_observations
WHEN (
  NEW.sellerhub_asset_generation IS NOT NULL OR EXISTS (
    SELECT 1 FROM provider_observation_runs r
    WHERE r.workspace_id=NEW.workspace_id AND r.observation_run_id=NEW.observation_run_id
      AND r.connector_version='spaceship-sellerhub-v1'
  )
) AND NOT EXISTS (
  SELECT 1 FROM spaceship_sellerhub_pending_scans p
  JOIN provider_observation_runs r ON r.workspace_id=p.workspace_id AND r.observation_run_id=p.request_id
    AND r.connection_id=p.connection_id AND r.connector_version='spaceship-sellerhub-v1' AND r.status='running'
  JOIN domain_assets a ON a.workspace_id=p.workspace_id AND a.entity_id=NEW.entity_id
    AND a.entity_generation=NEW.sellerhub_asset_generation AND a.deleted_at IS NULL
  WHERE p.workspace_id=NEW.workspace_id AND p.connection_id=NEW.binding_connection_id
    AND p.request_id=NEW.observation_run_id
)
BEGIN SELECT RAISE(ABORT, 'SellerHub observation requires the current request and asset generation'); END;

CREATE TRIGGER spaceship_sellerhub_observation_immutable
BEFORE UPDATE OF sellerhub_asset_generation ON marketplace_listing_observations
WHEN NEW.sellerhub_asset_generation IS NOT OLD.sellerhub_asset_generation
BEGIN SELECT RAISE(ABORT, 'SellerHub observation scope is immutable'); END;

CREATE TRIGGER spaceship_sellerhub_pending_scope
BEFORE INSERT ON spaceship_sellerhub_pending_scans
WHEN NOT EXISTS (
  SELECT 1 FROM spaceship_sellerhub_connections s JOIN local_provider_connections c
    USING(workspace_id,connection_id)
  WHERE s.workspace_id=NEW.workspace_id AND s.connection_id=NEW.connection_id
    AND s.incarnation_id=NEW.incarnation_id AND c.connection_incarnation_id=s.incarnation_id
    AND c.provider_kind='spaceship' AND json(c.capabilities_json)='["marketplace"]'
    AND s.purged_at IS NULL AND c.revoked_at IS NULL AND c.deleted_at IS NULL AND (
      (s.state='prepared' AND c.credential_use_state='inactive' AND c.lifecycle_status='invalid')
      OR (s.state='active' AND c.credential_use_state='active'
          AND c.lifecycle_status='active' AND c.validation_status='valid')
    )
) OR EXISTS (
  SELECT 1 FROM device_handoff_barriers WHERE workspace_id=NEW.workspace_id
) OR EXISTS (
  SELECT 1 FROM spaceship_sellerhub_scans WHERE workspace_id=NEW.workspace_id AND scan_id=NEW.request_id
)
BEGIN SELECT RAISE(ABORT, 'SellerHub requires a current slot and fresh request'); END;

CREATE TRIGGER spaceship_sellerhub_pending_immutable
BEFORE UPDATE ON spaceship_sellerhub_pending_scans
BEGIN SELECT RAISE(ABORT, 'SellerHub scan scope is immutable'); END;

CREATE TRIGGER spaceship_sellerhub_retirement
AFTER UPDATE OF state ON spaceship_sellerhub_connections
WHEN NEW.state='revoked' AND OLD.state!='revoked'
BEGIN
  DELETE FROM spaceship_sellerhub_pending_scans
  WHERE workspace_id=OLD.workspace_id AND connection_id=OLD.connection_id;
  UPDATE local_provider_connections SET credential_use_state='revoked'
  WHERE workspace_id=NEW.workspace_id AND connection_id=NEW.connection_id;
END;

CREATE TRIGGER spaceship_sellerhub_scan_requires_request
BEFORE INSERT ON spaceship_sellerhub_scans
WHEN NOT EXISTS (
  SELECT 1 FROM spaceship_sellerhub_pending_scans p
  JOIN spaceship_sellerhub_connections s USING(workspace_id,connection_id,incarnation_id)
  JOIN local_provider_connections c USING(workspace_id,connection_id)
  WHERE p.workspace_id=NEW.workspace_id AND p.connection_id=NEW.connection_id
    AND p.request_id=NEW.scan_id AND s.state='active' AND s.purged_at IS NULL
    AND c.connection_incarnation_id=s.incarnation_id AND c.deleted_at IS NULL AND c.revoked_at IS NULL
    AND c.credential_use_state='active' AND c.lifecycle_status='active' AND c.validation_status='valid'
) OR EXISTS (
  SELECT 1 FROM device_handoff_barriers WHERE workspace_id=NEW.workspace_id
) OR (NEW.observation_run_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM provider_observation_runs r
  WHERE r.workspace_id=NEW.workspace_id AND r.observation_run_id=NEW.observation_run_id
    AND r.observation_run_id=NEW.scan_id AND r.connection_id=NEW.connection_id
    AND r.status='succeeded' AND r.completed_at=NEW.completed_at
    AND r.observation_capability='marketplace' AND r.connector_version='spaceship-sellerhub-v1'
)) OR NEW.observed_count-NEW.skipped_count != (
  SELECT count(*) FROM marketplace_listing_observations m
  WHERE m.workspace_id=NEW.workspace_id AND m.observation_run_id=NEW.observation_run_id
    AND m.marketplace_kind='spaceship' AND m.binding_connection_id=NEW.connection_id AND m.confirmed=1
)
BEGIN SELECT RAISE(ABORT, 'SellerHub completion requires the exact scan request and complete observations'); END;

CREATE TRIGGER spaceship_sellerhub_scan_completed
AFTER INSERT ON spaceship_sellerhub_scans
BEGIN
  DELETE FROM spaceship_sellerhub_pending_scans
  WHERE workspace_id=NEW.workspace_id AND connection_id=NEW.connection_id AND request_id=NEW.scan_id;
  UPDATE sales_listing_generation SET generation=generation+1 WHERE singleton=1;
END;

CREATE TRIGGER spaceship_sellerhub_scan_no_update
BEFORE UPDATE ON spaceship_sellerhub_scans
BEGIN SELECT RAISE(ABORT, 'SellerHub scan receipts are append-only'); END;
CREATE TRIGGER spaceship_sellerhub_scan_no_delete
BEFORE DELETE ON spaceship_sellerhub_scans
BEGIN SELECT RAISE(ABORT, 'SellerHub scan receipts are append-only'); END;

-- Offset-scan absence makes the last observation stale. Only a positive observation
-- in the newest complete scan is fresh, including after a zero-row receipt.
DROP VIEW marketplace_listing_observations_read_facts;
CREATE VIEW marketplace_listing_observations_read_facts AS
SELECT candidates.*,row_number() OVER (
 PARTITION BY workspace_id,entity_id,marketplace_kind,observation_connection_id
 ORDER BY binding_current DESC,(binding_current=0 AND binding_resource_digest IS NOT NULL AND listing_status='unlisted' AND binding_fresh=1) DESC,
          CASE WHEN marketplace_kind='afternic' OR sellerhub_asset_generation IS NOT NULL THEN observation_run_order ELSE 0 END DESC, observed_at DESC,
          listing_observation_id DESC) AS connection_rank
FROM (
 SELECT m.*,r.connection_id AS observation_connection_id,r.rowid AS observation_run_order,
 CASE WHEN m.binding_connection_id IS NULL THEN m.binding_resource_digest IS NULL AND m.binding_generation IS NULL
 ELSE b.connection_id IS NOT NULL AND b.provider_kind=m.marketplace_kind AND b.resource_label=m.entity_id AND r.connection_id=m.binding_connection_id END AS binding_valid,
 coalesce(b.validation_status!='detached' AND b.binding_generation=m.binding_generation,0) AS binding_current,
 CASE WHEN r.connector_version='spaceship-sellerhub-v1' THEN coalesce(
   b.binding_generation=m.binding_generation AND b.validation_status IN ('verified','unverified')
   AND c.lifecycle_status='active' AND c.deleted_at IS NULL AND c.revoked_at IS NULL
   AND c.validation_status='valid' AND c.credential_use_state='active'
   AND EXISTS (
     SELECT 1 FROM domain_assets a
     WHERE a.workspace_id=m.workspace_id AND a.entity_id=m.entity_id AND a.deleted_at IS NULL
       AND a.entity_generation=m.sellerhub_asset_generation
   )
   AND m.observation_run_id=(
     SELECT scan.observation_run_id FROM spaceship_sellerhub_scans scan
     WHERE scan.workspace_id=m.workspace_id AND scan.connection_id=m.binding_connection_id
     ORDER BY scan.rowid DESC LIMIT 1
   ),0)
 WHEN m.binding_connection_id IS NULL THEN 1 ELSE coalesce(
 b.binding_generation=m.binding_generation AND c.lifecycle_status='active' AND c.deleted_at IS NULL
 AND c.validation_status='valid' AND c.credential_use_state='active' AND (
 (b.validation_status IN ('verified','unverified') AND NOT (
   m.marketplace_kind='afternic' AND m.listing_status IN ('active','reserved','draft','suspended')
   AND EXISTS (
     SELECT 1 FROM afternic_inventory_scans scan
     WHERE scan.workspace_id=m.workspace_id AND scan.connection_id=m.binding_connection_id
       AND scan.credential_generation=m.binding_generation
       AND scan.scan_id=(
         SELECT newest.scan_id FROM afternic_inventory_scans newest
         WHERE newest.workspace_id=m.workspace_id AND newest.connection_id=m.binding_connection_id
           AND newest.credential_generation=m.binding_generation
         ORDER BY newest.rowid DESC LIMIT 1
       )
       AND scan.observation_run_id IS NOT m.observation_run_id
       AND CASE WHEN scan.freshness_anchor_run_id='' THEN 0
         WHEN coalesce(scan.freshness_anchor_run_id,scan.observation_run_id) IS NULL
         THEN scan.completed_at >= m.observed_at
         ELSE EXISTS (
         SELECT 1 FROM provider_observation_runs scanned
         WHERE scanned.workspace_id=scan.workspace_id
           AND scanned.observation_run_id=coalesce(scan.freshness_anchor_run_id,scan.observation_run_id)
           AND scanned.rowid >= r.rowid
       ) END
   )
 )) OR (b.validation_status='detached' AND m.listing_status='unlisted' AND EXISTS(
 SELECT 1 FROM afternic_delist_reconciliations d JOIN operation_plan_items i
 ON i.workspace_id=d.workspace_id AND i.plan_id=d.plan_id AND i.item_id=d.item_id
 JOIN afternic_connection_publications p ON p.workspace_id=i.workspace_id AND p.connection_id=i.connection_id
 AND p.connection_incarnation_id=json_extract(i.precondition_json,'$.connectionIncarnationId')
 AND p.credential_generation=json_extract(i.precondition_json,'$.credentialGeneration') AND p.publication_state='active'
 WHERE d.workspace_id=m.workspace_id AND d.listing_observation_id=m.listing_observation_id AND d.outcome='absent'
 AND p.connection_incarnation_id=c.connection_incarnation_id
 AND b.observation_digest=m.provider_version_token
 AND NOT EXISTS(SELECT 1 FROM domain_asset_provider_bindings newer WHERE newer.workspace_id=b.workspace_id AND newer.entity_id=b.entity_id AND newer.connection_id=b.connection_id AND newer.resource_kind='listing' AND newer.resource_binding_digest!=b.resource_binding_digest AND newer.local_commit_sequence>b.local_commit_sequence)
 AND json_extract(i.precondition_json,'$.bindingDigest')=m.binding_resource_digest
 AND json_extract(i.precondition_json,'$.bindingGeneration')=m.binding_generation))),0) END AS binding_fresh
 FROM marketplace_listing_observations m JOIN provider_observation_runs r
 ON r.workspace_id=m.workspace_id AND r.observation_run_id=m.observation_run_id
 JOIN local_provider_connections c ON c.workspace_id=r.workspace_id AND c.connection_id=r.connection_id
 LEFT JOIN domain_asset_provider_bindings b ON b.workspace_id=m.workspace_id AND b.entity_id=m.entity_id AND b.resource_kind='listing'
 AND b.connection_id=m.binding_connection_id AND b.resource_binding_digest=m.binding_resource_digest
 WHERE m.confirmed=1
) candidates;
