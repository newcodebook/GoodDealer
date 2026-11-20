-- Only new observations with both complete reads can carry positive Standard evidence.
ALTER TABLE marketplace_listing_observations ADD COLUMN atom_standard_asset_generation INTEGER
    CHECK (atom_standard_asset_generation IS NULL OR (
        marketplace_kind='atom' AND binding_connection_id IS NOT NULL
        AND atom_standard_asset_generation BETWEEN 1 AND 9007199254740991
    ));

-- NULL means the optional Standard review was unavailable; zero means it ran successfully
-- and found no positives for assets tracked by this import.
ALTER TABLE atom_marketplace_scans ADD COLUMN standard_observed_count INTEGER
    CHECK (standard_observed_count IS NULL OR standard_observed_count BETWEEN 0 AND observed_count - skipped_count);

CREATE INDEX atom_standard_observation_run
ON marketplace_listing_observations(workspace_id,observation_run_id,entity_id)
WHERE atom_standard_asset_generation IS NOT NULL;

CREATE TRIGGER atom_standard_observation_scope
BEFORE INSERT ON marketplace_listing_observations
WHEN NEW.atom_standard_asset_generation IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM atom_marketplace_pending_scans p
    JOIN provider_observation_runs r ON r.workspace_id=p.workspace_id AND r.observation_run_id=p.request_id
      AND r.connection_id=p.connection_id AND r.connector_version='atom-seller-v1' AND r.status='running'
    JOIN domain_assets a ON a.workspace_id=p.workspace_id AND a.entity_id=NEW.entity_id
      AND a.entity_generation=NEW.atom_standard_asset_generation AND a.deleted_at IS NULL
    JOIN domain_asset_provider_bindings b ON b.workspace_id=a.workspace_id AND b.entity_id=a.entity_id
      AND b.connection_id=p.connection_id AND b.provider_kind='atom' AND b.resource_kind='listing'
      AND b.resource_binding_digest=NEW.binding_resource_digest AND b.binding_generation=NEW.binding_generation
      AND b.validation_status IN ('verified','unverified')
    WHERE p.workspace_id=NEW.workspace_id AND p.connection_id=NEW.binding_connection_id
      AND p.request_id=NEW.observation_run_id
)
BEGIN SELECT RAISE(ABORT, 'Standard observation requires the current Atom scan and listing'); END;

CREATE TRIGGER atom_standard_observation_immutable
BEFORE UPDATE ON marketplace_listing_observations
WHEN NEW.atom_standard_asset_generation IS NOT OLD.atom_standard_asset_generation
    OR (OLD.atom_standard_asset_generation IS NOT NULL AND (
        NEW.workspace_id IS NOT OLD.workspace_id OR NEW.entity_id IS NOT OLD.entity_id
        OR NEW.listing_observation_id IS NOT OLD.listing_observation_id
        OR NEW.observation_run_id IS NOT OLD.observation_run_id OR NEW.marketplace_kind IS NOT OLD.marketplace_kind
        OR NEW.binding_connection_id IS NOT OLD.binding_connection_id
        OR NEW.binding_resource_digest IS NOT OLD.binding_resource_digest
        OR NEW.binding_generation IS NOT OLD.binding_generation
        OR NEW.observed_at IS NOT OLD.observed_at OR NEW.provider_version_token IS NOT OLD.provider_version_token
        OR NEW.listing_status IS NOT OLD.listing_status OR NEW.observation_availability IS NOT OLD.observation_availability
        OR NEW.evidence_status IS NOT OLD.evidence_status
    ))
BEGIN SELECT RAISE(ABORT, 'Standard observation scope is immutable'); END;

CREATE TRIGGER atom_standard_scan_matches_observations
BEFORE INSERT ON atom_marketplace_scans
WHEN coalesce(NEW.standard_observed_count,0) != (
    SELECT count(*) FROM marketplace_listing_observations m
    WHERE m.workspace_id=NEW.workspace_id AND m.observation_run_id=NEW.observation_run_id
      AND m.binding_connection_id=NEW.connection_id AND m.atom_standard_asset_generation IS NOT NULL
      AND m.confirmed=1
)
BEGIN SELECT RAISE(ABORT, 'Standard receipt must match its confirmed observations'); END;
