-- The sales read keeps the merged desk of every listed domain and must merge again only when its
-- inputs change. This counter moves on every committed change to a row the merge reads: listing
-- observations, the marketplace run and target statuses that confirm them, and the deletion of
-- their assets. Any other write leaves it alone, so editing a note, a target price or a DNS record,
-- or a registrar or DNS observation run, no longer costs a full merge. The counter rolls back with the change that moved it, and the reader pairs it with
-- `PRAGMA data_version`, so a commit from another connection still invalidates the desk.
CREATE TABLE sales_listing_generation (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    generation INTEGER NOT NULL CHECK (generation >= 0)
  ) STRICT;
INSERT INTO sales_listing_generation (singleton, generation) VALUES (1, 0);

-- The counter row is only ever advanced by the triggers below.
CREATE TRIGGER sales_listing_generation_no_delete
BEFORE DELETE ON sales_listing_generation
BEGIN SELECT RAISE(ABORT, 'the sales listing generation is permanent'); END;
CREATE TRIGGER sales_listing_generation_only_advances
BEFORE UPDATE ON sales_listing_generation
WHEN NEW.singleton IS NOT OLD.singleton OR NEW.generation IS NOT OLD.generation + 1
BEGIN SELECT RAISE(ABORT, 'the sales listing generation only advances'); END;

CREATE TRIGGER sales_listing_generation_listing_insert
AFTER INSERT ON marketplace_listing_observations
BEGIN UPDATE sales_listing_generation SET generation = generation + 1 WHERE singleton = 1; END;
-- Listing observations are append-only; these keep the counter honest if that rule ever changes.
CREATE TRIGGER sales_listing_generation_listing_update
AFTER UPDATE ON marketplace_listing_observations
BEGIN UPDATE sales_listing_generation SET generation = generation + 1 WHERE singleton = 1; END;
CREATE TRIGGER sales_listing_generation_listing_delete
AFTER DELETE ON marketplace_listing_observations
BEGIN UPDATE sales_listing_generation SET generation = generation + 1 WHERE singleton = 1; END;

-- Only marketplace runs can confirm a listing: an observation may name no other run (see the
-- `marketplace_observations_require_marketplace_observation_capability_*` triggers) and a run's
-- capability is frozen, so registrar, DNS and valuation runs leave the desk alone.
CREATE TRIGGER sales_listing_generation_run_insert
AFTER INSERT ON provider_observation_runs
WHEN NEW.observation_capability = 'marketplace'
BEGIN UPDATE sales_listing_generation SET generation = generation + 1 WHERE singleton = 1; END;
CREATE TRIGGER sales_listing_generation_run_update
AFTER UPDATE ON provider_observation_runs
WHEN (OLD.observation_capability = 'marketplace' OR NEW.observation_capability = 'marketplace')
  AND (NEW.workspace_id IS NOT OLD.workspace_id
    OR NEW.observation_run_id IS NOT OLD.observation_run_id
    OR NEW.observation_capability IS NOT OLD.observation_capability
    OR NEW.status IS NOT OLD.status)
BEGIN UPDATE sales_listing_generation SET generation = generation + 1 WHERE singleton = 1; END;
CREATE TRIGGER sales_listing_generation_run_delete
AFTER DELETE ON provider_observation_runs
WHEN OLD.observation_capability = 'marketplace'
BEGIN UPDATE sales_listing_generation SET generation = generation + 1 WHERE singleton = 1; END;

CREATE TRIGGER sales_listing_generation_target_insert
AFTER INSERT ON provider_observation_targets
WHEN EXISTS (
  SELECT 1 FROM provider_observation_runs run
  WHERE run.workspace_id = NEW.workspace_id AND run.observation_run_id = NEW.observation_run_id
    AND run.observation_capability = 'marketplace'
)
BEGIN UPDATE sales_listing_generation SET generation = generation + 1 WHERE singleton = 1; END;
CREATE TRIGGER sales_listing_generation_target_update
AFTER UPDATE ON provider_observation_targets
WHEN (NEW.workspace_id IS NOT OLD.workspace_id
    OR NEW.observation_run_id IS NOT OLD.observation_run_id
    OR NEW.entity_id IS NOT OLD.entity_id
    OR NEW.status IS NOT OLD.status)
  AND EXISTS (
    SELECT 1 FROM provider_observation_runs run
    WHERE run.observation_capability = 'marketplace'
      AND ((run.workspace_id = NEW.workspace_id AND run.observation_run_id = NEW.observation_run_id)
        OR (run.workspace_id = OLD.workspace_id AND run.observation_run_id = OLD.observation_run_id))
  )
BEGIN UPDATE sales_listing_generation SET generation = generation + 1 WHERE singleton = 1; END;
-- A target deleted with its asset is covered by the asset's own trigger; this covers the rest.
CREATE TRIGGER sales_listing_generation_target_delete
AFTER DELETE ON provider_observation_targets
WHEN EXISTS (
  SELECT 1 FROM provider_observation_runs run
  WHERE run.workspace_id = OLD.workspace_id AND run.observation_run_id = OLD.observation_run_id
    AND run.observation_capability = 'marketplace'
)
BEGIN UPDATE sales_listing_generation SET generation = generation + 1 WHERE singleton = 1; END;

-- A new asset has no listing: an observation's immediate foreign key needs the asset first, and
-- deleting an asset cascades to its observations. So adding a domain leaves the desk alone.
CREATE TRIGGER sales_listing_generation_asset_update
AFTER UPDATE ON domain_assets
WHEN NEW.workspace_id IS NOT OLD.workspace_id
  OR NEW.entity_id IS NOT OLD.entity_id
  OR NEW.deleted_at IS NOT OLD.deleted_at
BEGIN UPDATE sales_listing_generation SET generation = generation + 1 WHERE singleton = 1; END;
CREATE TRIGGER sales_listing_generation_asset_delete
AFTER DELETE ON domain_assets
BEGIN UPDATE sales_listing_generation SET generation = generation + 1 WHERE singleton = 1; END;

-- The merge walks each (asset, market) group newest first and keeps the first confirmed row; the
-- identifier breaks ties between equal times, so the index orders by it too and no sort is needed.
DROP INDEX marketplace_listing_observations_latest;
CREATE INDEX marketplace_listing_observations_latest
    ON marketplace_listing_observations(
      workspace_id, entity_id, marketplace_kind, observed_at DESC, listing_observation_id DESC
    );
