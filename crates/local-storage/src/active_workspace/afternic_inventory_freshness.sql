-- An offset-paginated scan that no longer reports a previous listing invalidates its
-- current display state. Only an authenticated exact observation can settle absence.
-- Retain the last committed run even for an empty complete scan. Empty text is a known
-- zero baseline, distinct from NULL on receipts written before this migration.
ALTER TABLE afternic_inventory_scans ADD COLUMN freshness_anchor_run_id TEXT;
CREATE INDEX afternic_inventory_freshness_scan
ON afternic_inventory_scans(workspace_id,connection_id,credential_generation);
CREATE TRIGGER afternic_inventory_freshness_anchor
BEFORE INSERT ON afternic_inventory_scans
WHEN NEW.freshness_anchor_run_id IS NOT coalesce((
  SELECT r.observation_run_id FROM provider_observation_runs r
  WHERE r.workspace_id=NEW.workspace_id AND r.connection_id=NEW.connection_id
  ORDER BY r.rowid DESC LIMIT 1
),'')
BEGIN SELECT RAISE(ABORT, 'invalid Afternic freshness anchor'); END;

DROP VIEW marketplace_listing_observations_read_facts;
CREATE VIEW marketplace_listing_observations_read_facts AS
SELECT candidates.*,row_number() OVER (
 PARTITION BY workspace_id,entity_id,marketplace_kind,observation_connection_id
 ORDER BY binding_current DESC,(binding_current=0 AND binding_resource_digest IS NOT NULL AND listing_status='unlisted' AND binding_fresh=1) DESC,
          CASE WHEN marketplace_kind='afternic' THEN observation_run_order ELSE 0 END DESC, observed_at DESC,
          listing_observation_id DESC) AS connection_rank
FROM (
 SELECT m.*,r.connection_id AS observation_connection_id,r.rowid AS observation_run_order,
 CASE WHEN m.binding_connection_id IS NULL THEN m.binding_resource_digest IS NULL AND m.binding_generation IS NULL
 ELSE b.connection_id IS NOT NULL AND b.provider_kind=m.marketplace_kind AND b.resource_label=m.entity_id AND r.connection_id=m.binding_connection_id END AS binding_valid,
 coalesce(b.validation_status!='detached' AND b.binding_generation=m.binding_generation,0) AS binding_current,
 CASE WHEN m.binding_connection_id IS NULL THEN 1 ELSE coalesce(
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

-- A complete empty scan has no observation rows to invalidate the cached sales projection.
CREATE TRIGGER afternic_inventory_freshness_generation AFTER INSERT ON afternic_inventory_scans
BEGIN UPDATE sales_listing_generation SET generation=generation+1 WHERE singleton=1; END;
