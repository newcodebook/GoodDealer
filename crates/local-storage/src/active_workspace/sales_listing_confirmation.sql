-- A listing observation counts for sales only when its marketplace run completed (`succeeded` or
-- `partial`) and its own target in that run succeeded. The sales merge used to join both tables for
-- every listing row, which at 100k assets on 8 markets cost most of a full merge. `confirmed`
-- carries that fact on the row instead. It is derived, never chosen: the guards below refuse any
-- value other than the one the run and target imply, and the maintenance triggers recompute it
-- whenever a run or target status changes, so it cannot drift from its sources.
--
-- Run, target and listing identities are frozen by the base schema, runs are never deleted and a
-- target is deleted only with its asset, so a status change is the only way the derived value can
-- move. A new listing always starts unconfirmed: it may only be written while its run is running and
-- its target is still requested.
ALTER TABLE marketplace_listing_observations
  ADD COLUMN confirmed INTEGER NOT NULL DEFAULT 0 CHECK (confirmed IN (0, 1));

-- Listing observations stay append-only; the derived flag is the one column the maintenance
-- triggers below may rewrite.
DROP TRIGGER marketplace_observations_no_update;
CREATE TRIGGER marketplace_observations_no_update
BEFORE UPDATE ON marketplace_listing_observations
WHEN NEW.workspace_id IS NOT OLD.workspace_id
  OR NEW.listing_observation_id IS NOT OLD.listing_observation_id
  OR NEW.observation_run_id IS NOT OLD.observation_run_id
  OR NEW.entity_id IS NOT OLD.entity_id
  OR NEW.marketplace_kind IS NOT OLD.marketplace_kind
  OR NEW.listing_status IS NOT OLD.listing_status
  OR NEW.asking_price_currency IS NOT OLD.asking_price_currency
  OR NEW.asking_price_amount IS NOT OLD.asking_price_amount
  OR NEW.observed_at IS NOT OLD.observed_at
  OR NEW.provider_version_token IS NOT OLD.provider_version_token
  OR NEW.observation_availability IS NOT OLD.observation_availability
  OR NEW.evidence_status IS NOT OLD.evidence_status
BEGIN SELECT RAISE(ABORT, 'marketplace observations are append-only'); END;

-- The backfill runs under the relaxed rule above, before the guards exist.
UPDATE marketplace_listing_observations
SET confirmed = (
  EXISTS (
    SELECT 1 FROM provider_observation_targets t
    WHERE t.workspace_id = marketplace_listing_observations.workspace_id AND t.observation_run_id = marketplace_listing_observations.observation_run_id
      AND t.entity_id = marketplace_listing_observations.entity_id AND t.status = 'succeeded'
  )
  AND EXISTS (
    SELECT 1 FROM provider_observation_runs r
    WHERE r.workspace_id = marketplace_listing_observations.workspace_id AND r.observation_run_id = marketplace_listing_observations.observation_run_id
      AND r.status IN ('succeeded', 'partial')
  )
);

-- The run or target status change that moves `confirmed` already advances the sales listing
-- generation once; counting each recomputed row again would only add work to a run's completion.
DROP TRIGGER sales_listing_generation_listing_update;
CREATE TRIGGER sales_listing_generation_listing_update
AFTER UPDATE ON marketplace_listing_observations
WHEN NEW.workspace_id IS NOT OLD.workspace_id
  OR NEW.listing_observation_id IS NOT OLD.listing_observation_id
  OR NEW.observation_run_id IS NOT OLD.observation_run_id
  OR NEW.entity_id IS NOT OLD.entity_id
  OR NEW.marketplace_kind IS NOT OLD.marketplace_kind
  OR NEW.listing_status IS NOT OLD.listing_status
  OR NEW.asking_price_currency IS NOT OLD.asking_price_currency
  OR NEW.asking_price_amount IS NOT OLD.asking_price_amount
  OR NEW.observed_at IS NOT OLD.observed_at
  OR NEW.provider_version_token IS NOT OLD.provider_version_token
  OR NEW.observation_availability IS NOT OLD.observation_availability
  OR NEW.evidence_status IS NOT OLD.evidence_status
BEGIN UPDATE sales_listing_generation SET generation = generation + 1 WHERE singleton = 1; END;

CREATE TRIGGER marketplace_listing_confirmed_insert_is_derived
BEFORE INSERT ON marketplace_listing_observations
WHEN NEW.confirmed IS NOT (
  EXISTS (
    SELECT 1 FROM provider_observation_targets t
    WHERE t.workspace_id = NEW.workspace_id AND t.observation_run_id = NEW.observation_run_id
      AND t.entity_id = NEW.entity_id AND t.status = 'succeeded'
  )
  AND EXISTS (
    SELECT 1 FROM provider_observation_runs r
    WHERE r.workspace_id = NEW.workspace_id AND r.observation_run_id = NEW.observation_run_id
      AND r.status IN ('succeeded', 'partial')
  )
)
BEGIN SELECT RAISE(ABORT, 'listing confirmation is derived from its run and target'); END;

CREATE TRIGGER marketplace_listing_confirmed_update_is_derived
BEFORE UPDATE OF confirmed ON marketplace_listing_observations
WHEN NEW.confirmed IS NOT (
  EXISTS (
    SELECT 1 FROM provider_observation_targets t
    WHERE t.workspace_id = NEW.workspace_id AND t.observation_run_id = NEW.observation_run_id
      AND t.entity_id = NEW.entity_id AND t.status = 'succeeded'
  )
  AND EXISTS (
    SELECT 1 FROM provider_observation_runs r
    WHERE r.workspace_id = NEW.workspace_id AND r.observation_run_id = NEW.observation_run_id
      AND r.status IN ('succeeded', 'partial')
  )
)
BEGIN SELECT RAISE(ABORT, 'listing confirmation is derived from its run and target'); END;

-- A run's completion confirms (or leaves unconfirmed) every listing it wrote at once.
CREATE TRIGGER marketplace_listing_confirmed_follows_run_status
AFTER UPDATE OF status ON provider_observation_runs
WHEN NEW.status IS NOT OLD.status
BEGIN
  UPDATE marketplace_listing_observations
  SET confirmed = (
    NEW.status IN ('succeeded', 'partial')
    AND EXISTS (
      SELECT 1 FROM provider_observation_targets t
      WHERE t.workspace_id = marketplace_listing_observations.workspace_id AND t.observation_run_id = marketplace_listing_observations.observation_run_id
        AND t.entity_id = marketplace_listing_observations.entity_id AND t.status = 'succeeded'
    )
  )
  WHERE marketplace_listing_observations.workspace_id = NEW.workspace_id AND marketplace_listing_observations.observation_run_id = NEW.observation_run_id;
END;

-- A target settles while its run is still running, so this normally leaves the flag at 0; it keeps
-- the flag right should a target ever settle after its run.
CREATE TRIGGER marketplace_listing_confirmed_follows_target_status
AFTER UPDATE OF status ON provider_observation_targets
WHEN NEW.status IS NOT OLD.status
BEGIN
  UPDATE marketplace_listing_observations
  SET confirmed = (
    NEW.status = 'succeeded'
    AND EXISTS (
      SELECT 1 FROM provider_observation_runs r
      WHERE r.workspace_id = marketplace_listing_observations.workspace_id AND r.observation_run_id = marketplace_listing_observations.observation_run_id
        AND r.status IN ('succeeded', 'partial')
    )
  )
  WHERE marketplace_listing_observations.workspace_id = NEW.workspace_id AND marketplace_listing_observations.observation_run_id = NEW.observation_run_id
    AND marketplace_listing_observations.entity_id = NEW.entity_id;
END;
