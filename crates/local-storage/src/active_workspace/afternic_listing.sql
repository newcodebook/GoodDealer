-- Afternic custody metadata and connection-scoped Listing observations.
-- Existing migration SQL and historical unbound evidence remain unchanged.

DROP TRIGGER cloudflare_connection_publication_insert_shape;
CREATE TRIGGER cloudflare_connection_publication_insert_shape
BEFORE INSERT ON local_provider_connections
WHEN NEW.provider_kind='cloudflare' AND NOT (
  (NEW.active_credential_generation IS NULL
    AND NEW.active_credential_scope_digest IS NULL
    AND NEW.active_credential_zone_digest IS NULL
    AND NEW.active_credential_public_proof IS NULL
    AND NEW.credential_use_state != 'active')
  OR (NEW.active_credential_generation IS NOT NULL
    AND NEW.active_credential_scope_digest IS NOT NULL
    AND NEW.active_credential_zone_digest IS NOT NULL
    AND NEW.active_credential_public_proof IS NOT NULL
    AND NEW.credential_use_state IN (
      'active', 'transition_pending', 'revocation_pending', 'remediation_required'
    ))
)
BEGIN SELECT RAISE(ABORT, 'invalid Cloudflare credential publication shape'); END;

DROP TRIGGER cloudflare_connection_publication_update_shape;
CREATE TRIGGER cloudflare_connection_publication_update_shape
BEFORE UPDATE OF provider_kind, credential_use_state, active_credential_generation,
  active_credential_scope_digest, active_credential_zone_digest,
  active_credential_public_proof ON local_provider_connections
WHEN NEW.provider_kind='cloudflare' AND NOT (
  (NEW.active_credential_generation IS NULL
    AND NEW.active_credential_scope_digest IS NULL
    AND NEW.active_credential_zone_digest IS NULL
    AND NEW.active_credential_public_proof IS NULL
    AND NEW.credential_use_state != 'active')
  OR (NEW.active_credential_generation IS NOT NULL
    AND NEW.active_credential_scope_digest IS NOT NULL
    AND NEW.active_credential_zone_digest IS NOT NULL
    AND NEW.active_credential_public_proof IS NOT NULL
    AND NEW.credential_use_state IN (
      'active', 'transition_pending', 'revocation_pending', 'remediation_required'
    ))
)
BEGIN SELECT RAISE(ABORT, 'invalid Cloudflare credential publication shape'); END;

DROP TRIGGER cloudflare_connection_retirement_update_shape;
CREATE TRIGGER cloudflare_connection_retirement_update_shape
BEFORE UPDATE ON local_provider_connections
WHEN (NEW.provider_kind='cloudflare' AND NEW.credential_use_state='retired' AND NOT EXISTS (
  SELECT 1 FROM cloudflare_credential_roots r
   WHERE r.workspace_id=NEW.workspace_id AND r.logical_connection_id=NEW.connection_id
     AND r.connection_incarnation_id=NEW.connection_incarnation_id
     AND r.retirement_requested_at IS NOT NULL AND r.retired_at IS NOT NULL))
  OR EXISTS (SELECT 1 FROM cloudflare_credential_roots r
   WHERE r.workspace_id=OLD.workspace_id AND r.logical_connection_id=OLD.connection_id
     AND r.retirement_requested_at IS NOT NULL AND (
       NEW.workspace_id IS NOT OLD.workspace_id OR NEW.connection_id IS NOT OLD.connection_id
       OR NEW.connection_incarnation_id IS NOT OLD.connection_incarnation_id
       OR NEW.credential_use_state NOT IN ('remediation_required','retired')
       OR NEW.active_credential_generation IS NOT NULL))
BEGIN SELECT RAISE(ABORT, 'invalid Cloudflare retirement publication'); END;


CREATE TABLE afternic_connection_publications (
  workspace_id TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  credential_generation INTEGER NOT NULL CHECK (credential_generation BETWEEN 1 AND 9007199254740991),
  connection_incarnation_id TEXT NOT NULL CHECK (length(connection_incarnation_id) BETWEEN 1 AND 128),
  credential_public_proof TEXT NOT NULL CHECK (length(credential_public_proof)=64 AND credential_public_proof NOT GLOB '*[^0-9a-f]*'),
  authority_snapshot_digest TEXT NOT NULL CHECK (length(authority_snapshot_digest)=64 AND authority_snapshot_digest NOT GLOB '*[^0-9a-f]*'),
  publication_state TEXT NOT NULL CHECK (publication_state IN ('prepared','active','remediation_required','revoked')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL CHECK (updated_at >= created_at),
  purged_at TEXT CHECK (purged_at IS NULL OR (publication_state='revoked' AND purged_at >= created_at)),
  PRIMARY KEY (workspace_id,connection_id,credential_generation),
  FOREIGN KEY (workspace_id,connection_id) REFERENCES local_provider_connections(workspace_id,connection_id) ON DELETE RESTRICT
) STRICT;
CREATE UNIQUE INDEX afternic_connection_publications_live
  ON afternic_connection_publications(workspace_id,connection_id)
  WHERE publication_state != 'revoked';

CREATE TRIGGER afternic_publication_insert_shape
BEFORE INSERT ON afternic_connection_publications
WHEN NEW.publication_state != 'prepared' OR NEW.purged_at IS NOT NULL
  OR NEW.credential_generation != (SELECT coalesce(max(p.credential_generation),0)+1
    FROM afternic_connection_publications p WHERE p.workspace_id=NEW.workspace_id AND p.connection_id=NEW.connection_id)
  OR NOT EXISTS (SELECT 1 FROM local_provider_connections c
    WHERE c.workspace_id=NEW.workspace_id AND c.connection_id=NEW.connection_id
      AND c.provider_kind='afternic' AND c.connection_incarnation_id=NEW.connection_incarnation_id
      AND c.deleted_at IS NULL AND c.lifecycle_status NOT IN ('deleted','revoked'))
BEGIN SELECT RAISE(ABORT, 'invalid Afternic publication preparation'); END;

CREATE TRIGGER afternic_publication_immutable
BEFORE UPDATE ON afternic_connection_publications
WHEN NEW.workspace_id IS NOT OLD.workspace_id OR NEW.connection_id IS NOT OLD.connection_id
  OR NEW.credential_generation IS NOT OLD.credential_generation
  OR NEW.connection_incarnation_id IS NOT OLD.connection_incarnation_id
  OR NEW.credential_public_proof IS NOT OLD.credential_public_proof
  OR NEW.authority_snapshot_digest IS NOT OLD.authority_snapshot_digest
  OR NEW.created_at IS NOT OLD.created_at OR NEW.updated_at < OLD.updated_at
  OR (OLD.purged_at IS NOT NULL AND NEW.purged_at IS NOT OLD.purged_at)
  OR NOT (NEW.publication_state=OLD.publication_state
    OR (OLD.publication_state='prepared' AND NEW.publication_state IN ('active','remediation_required','revoked'))
    OR (OLD.publication_state='active' AND NEW.publication_state IN ('remediation_required','revoked'))
    OR (OLD.publication_state='remediation_required' AND NEW.publication_state='revoked'))
BEGIN SELECT RAISE(ABORT, 'Afternic publication identity and resolution are permanent'); END;
CREATE TRIGGER afternic_publication_no_delete
BEFORE DELETE ON afternic_connection_publications
BEGIN SELECT RAISE(ABORT, 'Afternic publication history is permanent'); END;

-- A resolved or uncertain slot stops use immediately; deletion of a Native slot happens later.
CREATE TRIGGER afternic_publication_denies_use
AFTER UPDATE OF publication_state ON afternic_connection_publications
WHEN NEW.publication_state != OLD.publication_state AND NEW.publication_state IN ('remediation_required','revoked')
BEGIN
  UPDATE local_provider_connections SET credential_use_state=NEW.publication_state
    WHERE workspace_id=NEW.workspace_id AND connection_id=NEW.connection_id;
END;

CREATE TRIGGER custody_connection_identity_immutable
BEFORE UPDATE ON local_provider_connections
WHEN (NEW.workspace_id IS NOT OLD.workspace_id OR NEW.connection_id IS NOT OLD.connection_id
    OR NEW.provider_kind IS NOT OLD.provider_kind OR NEW.connection_incarnation_id IS NOT OLD.connection_incarnation_id)
  AND (EXISTS (SELECT 1 FROM cloudflare_credential_roots r
      WHERE r.workspace_id=OLD.workspace_id AND r.logical_connection_id=OLD.connection_id)
    OR EXISTS (SELECT 1 FROM afternic_connection_publications p
      WHERE p.workspace_id=OLD.workspace_id AND p.connection_id=OLD.connection_id))
BEGIN SELECT RAISE(ABORT, 'custody-owned connection identity is immutable'); END;

CREATE TRIGGER afternic_connection_publication_insert_shape
BEFORE INSERT ON local_provider_connections
WHEN NEW.provider_kind='afternic' AND (NEW.credential_use_state='active'
  OR NEW.active_credential_generation IS NOT NULL OR NEW.active_credential_scope_digest IS NOT NULL
  OR NEW.active_credential_zone_digest IS NOT NULL OR NEW.active_credential_public_proof IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'Afternic publication requires its own metadata'); END;
CREATE TRIGGER afternic_connection_publication_update_shape
BEFORE UPDATE ON local_provider_connections
WHEN NEW.provider_kind='afternic' AND (
  NEW.active_credential_generation IS NOT NULL OR NEW.active_credential_scope_digest IS NOT NULL
  OR NEW.active_credential_zone_digest IS NOT NULL OR NEW.active_credential_public_proof IS NOT NULL
  OR (NEW.credential_use_state='active' AND NOT EXISTS (
    SELECT 1 FROM afternic_connection_publications p WHERE p.workspace_id=NEW.workspace_id
      AND p.connection_id=NEW.connection_id AND p.connection_incarnation_id=NEW.connection_incarnation_id
      AND p.publication_state='active')))
BEGIN SELECT RAISE(ABORT, 'invalid Afternic credential publication'); END;

ALTER TABLE marketplace_listing_observations ADD COLUMN binding_connection_id TEXT;
ALTER TABLE marketplace_listing_observations ADD COLUMN binding_resource_digest TEXT
  CHECK (binding_resource_digest IS NULL OR (length(binding_resource_digest)=64 AND binding_resource_digest NOT GLOB '*[^0-9a-f]*'));
ALTER TABLE marketplace_listing_observations ADD COLUMN binding_generation INTEGER
  CHECK (binding_generation IS NULL OR binding_generation BETWEEN 1 AND 9007199254740991);

-- Legacy rows keep their original provenance; they never become an executable binding.
-- Every new Afternic observation is held to the new strict admission contract.
CREATE TRIGGER marketplace_listing_binding_insert_shape
BEFORE INSERT ON marketplace_listing_observations
WHEN ((NEW.binding_connection_id IS NULL) != (NEW.binding_resource_digest IS NULL))
  OR ((NEW.binding_connection_id IS NULL) != (NEW.binding_generation IS NULL))
  OR (NEW.binding_connection_id IS NULL AND EXISTS (
    SELECT 1 FROM provider_observation_runs r JOIN local_provider_connections c
      ON c.workspace_id=r.workspace_id AND c.connection_id=r.connection_id
    WHERE r.workspace_id=NEW.workspace_id AND r.observation_run_id=NEW.observation_run_id
      AND c.provider_kind='afternic'))
  OR (NEW.binding_connection_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM domain_asset_provider_bindings b JOIN provider_observation_runs r
      ON r.workspace_id=b.workspace_id AND r.connection_id=b.connection_id
    JOIN domain_assets a ON a.workspace_id=b.workspace_id AND a.entity_id=b.entity_id
    WHERE b.workspace_id=NEW.workspace_id AND b.entity_id=NEW.entity_id
      AND b.connection_id=NEW.binding_connection_id AND b.resource_kind='listing'
      AND b.resource_binding_digest=NEW.binding_resource_digest
      AND b.binding_generation=NEW.binding_generation AND b.provider_kind=NEW.marketplace_kind
      AND b.resource_label=NEW.entity_id AND b.validation_status!='detached'
      AND a.deleted_at IS NULL AND r.observation_run_id=NEW.observation_run_id))
BEGIN SELECT RAISE(ABORT, 'listing observation requires its exact live binding'); END;
CREATE TRIGGER marketplace_listing_binding_immutable
BEFORE UPDATE ON marketplace_listing_observations
WHEN NEW.binding_connection_id IS NOT OLD.binding_connection_id
  OR NEW.binding_resource_digest IS NOT OLD.binding_resource_digest
  OR NEW.binding_generation IS NOT OLD.binding_generation
BEGIN SELECT RAISE(ABORT, 'listing observation binding is immutable'); END;
CREATE TRIGGER listing_binding_detachment_permanent
BEFORE UPDATE ON domain_asset_provider_bindings
WHEN OLD.resource_kind='listing' AND OLD.validation_status='detached'
  AND NEW.validation_status!='detached'
BEGIN SELECT RAISE(ABORT, 'detached Listing identity cannot be revived'); END;
CREATE TRIGGER listing_binding_generation_monotonic
BEFORE UPDATE OF binding_generation ON domain_asset_provider_bindings
WHEN OLD.resource_kind='listing' AND NEW.binding_generation < OLD.binding_generation
BEGIN SELECT RAISE(ABORT, 'Listing binding generation cannot regress'); END;

CREATE INDEX marketplace_listing_observations_binding
  ON marketplace_listing_observations(workspace_id,entity_id,marketplace_kind,binding_connection_id,
    binding_resource_digest,binding_generation,observed_at DESC,listing_observation_id DESC);
CREATE TRIGGER sales_listing_generation_binding_insert
AFTER INSERT ON domain_asset_provider_bindings WHEN NEW.resource_kind='listing'
BEGIN UPDATE sales_listing_generation SET generation=generation+1 WHERE singleton=1; END;
CREATE TRIGGER sales_listing_generation_binding_observation_update
AFTER UPDATE ON marketplace_listing_observations
WHEN NEW.binding_connection_id IS NOT OLD.binding_connection_id
  OR NEW.binding_resource_digest IS NOT OLD.binding_resource_digest
  OR NEW.binding_generation IS NOT OLD.binding_generation
BEGIN UPDATE sales_listing_generation SET generation=generation+1 WHERE singleton=1; END;
CREATE TRIGGER sales_listing_generation_binding_update
AFTER UPDATE ON domain_asset_provider_bindings
WHEN OLD.resource_kind='listing' AND (NEW.binding_generation IS NOT OLD.binding_generation
  OR NEW.validation_status IS NOT OLD.validation_status)
BEGIN UPDATE sales_listing_generation SET generation=generation+1 WHERE singleton=1; END;
CREATE TRIGGER sales_listing_generation_connection_update
AFTER UPDATE ON local_provider_connections
WHEN NEW.lifecycle_status IS NOT OLD.lifecycle_status OR NEW.validation_status IS NOT OLD.validation_status
  OR NEW.credential_use_state IS NOT OLD.credential_use_state OR NEW.deleted_at IS NOT OLD.deleted_at
  OR NEW.connection_incarnation_id IS NOT OLD.connection_incarnation_id
BEGIN UPDATE sales_listing_generation SET generation=generation+1 WHERE singleton=1; END;

-- One latest fact per marketplace connection. A current binding outranks its retained history;
-- disconnecting a connection makes its bound evidence stale rather than proving a remote removal.
-- Both the sales desk and the portfolio count use this same ownership selection.
CREATE VIEW marketplace_listing_observations_read_facts AS
SELECT candidates.*,
  row_number() OVER (
    PARTITION BY workspace_id,entity_id,marketplace_kind,observation_connection_id
    ORDER BY binding_current DESC,observed_at DESC,listing_observation_id DESC
  ) AS connection_rank
FROM (
  SELECT m.*, r.connection_id AS observation_connection_id,
    CASE WHEN m.binding_connection_id IS NULL THEN
      m.binding_resource_digest IS NULL AND m.binding_generation IS NULL
    ELSE b.connection_id IS NOT NULL AND b.provider_kind=m.marketplace_kind
      AND b.resource_label=m.entity_id AND r.connection_id=m.binding_connection_id END AS binding_valid,
    coalesce(b.validation_status!='detached' AND b.binding_generation=m.binding_generation,0) AS binding_current,
    CASE WHEN m.binding_connection_id IS NULL THEN 1 ELSE coalesce(
      b.validation_status IN ('verified','unverified') AND b.binding_generation=m.binding_generation
      AND c.lifecycle_status='active' AND c.deleted_at IS NULL
      AND c.validation_status='valid' AND c.credential_use_state='active',0) END AS binding_fresh
  FROM marketplace_listing_observations m
  JOIN provider_observation_runs r
    ON r.workspace_id=m.workspace_id AND r.observation_run_id=m.observation_run_id
  JOIN local_provider_connections c
    ON c.workspace_id=r.workspace_id AND c.connection_id=r.connection_id
  LEFT JOIN domain_asset_provider_bindings b
    ON b.workspace_id=m.workspace_id AND b.entity_id=m.entity_id AND b.resource_kind='listing'
      AND b.connection_id=m.binding_connection_id AND b.resource_binding_digest=m.binding_resource_digest
  WHERE m.confirmed=1
) candidates;

-- Restricted Provider facts needed by later previews stay beside their original observation.
CREATE TABLE afternic_listing_details (
  workspace_id TEXT NOT NULL,
  listing_observation_id TEXT NOT NULL,
  provider_status TEXT NOT NULL CHECK (provider_status IN (
    'PENDING','FAILED_COMPLIANCE','ACTIVE','HIDDEN','ON_HOLD','SOLD','INACTIVE',
    'OWNERSHIP_REVIEW','OWNERSHIP_UNVERIFIED','VERIFIED_OWNER_CONFLICT',
    'INVENTORY_COMPLIANCE_ISSUE','TLD_UNSUPPORTED','UNREGISTERED_DOMAIN','UNKNOWN')),
  buynow_price INTEGER CHECK (buynow_price IS NULL OR (buynow_price BETWEEN 0 AND 49999999000000 AND buynow_price % 1000000=0)),
  floor_price INTEGER CHECK (floor_price IS NULL OR (floor_price BETWEEN 0 AND 49999999000000 AND floor_price % 1000000=0)),
  minbid_price INTEGER CHECK (minbid_price IS NULL OR (minbid_price BETWEEN 20000000 AND 49999999000000 AND minbid_price % 1000000=0)),
  hidden INTEGER CHECK (hidden IS NULL OR hidden IN (0,1)),
  provider_created_at TEXT NOT NULL,
  provider_updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id,listing_observation_id),
  FOREIGN KEY (workspace_id,listing_observation_id)
    REFERENCES marketplace_listing_observations(workspace_id,listing_observation_id) ON DELETE RESTRICT
) STRICT;
CREATE TRIGGER afternic_listing_details_insert_shape
BEFORE INSERT ON afternic_listing_details
WHEN NOT EXISTS (SELECT 1 FROM marketplace_listing_observations m
  JOIN provider_observation_runs r ON r.workspace_id=m.workspace_id AND r.observation_run_id=m.observation_run_id
  WHERE m.workspace_id=NEW.workspace_id AND m.listing_observation_id=NEW.listing_observation_id
    AND m.marketplace_kind='afternic' AND m.binding_connection_id IS NOT NULL AND r.status='running')
BEGIN SELECT RAISE(ABORT, 'Afternic details require a bound running observation'); END;
CREATE TRIGGER afternic_listing_details_no_update
BEFORE UPDATE ON afternic_listing_details
BEGIN SELECT RAISE(ABORT, 'Afternic listing details are append-only'); END;
CREATE TRIGGER afternic_listing_details_no_delete
BEFORE DELETE ON afternic_listing_details
BEGIN SELECT RAISE(ABORT, 'Afternic listing details are append-only'); END;

-- A complete bounded scan can legitimately contain no admitted asset. Keep its completion
-- without weakening the observation-run rule that every run has at least one declared target.
CREATE TABLE afternic_inventory_scans (
  workspace_id TEXT NOT NULL,
  scan_id TEXT NOT NULL CHECK (length(scan_id) BETWEEN 1 AND 160),
  connection_id TEXT NOT NULL,
  credential_generation INTEGER NOT NULL,
  observation_run_id TEXT,
  observed_count INTEGER NOT NULL CHECK (observed_count BETWEEN 0 AND 10000),
  imported_count INTEGER NOT NULL CHECK (imported_count BETWEEN 0 AND observed_count),
  skipped_deleted_json TEXT NOT NULL CHECK (
    json_valid(skipped_deleted_json) AND json_type(skipped_deleted_json)='array'
    AND length(CAST(skipped_deleted_json AS BLOB)) <= 2600000
    AND json_array_length(skipped_deleted_json)+observed_count <= 10000),
  completed_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id,scan_id),
  UNIQUE (workspace_id,observation_run_id),
  FOREIGN KEY (workspace_id,connection_id,credential_generation)
    REFERENCES afternic_connection_publications(workspace_id,connection_id,credential_generation) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id,observation_run_id)
    REFERENCES provider_observation_runs(workspace_id,observation_run_id) ON DELETE RESTRICT,
  CHECK ((observation_run_id IS NULL) = (observed_count=0))
) STRICT;
CREATE TRIGGER afternic_inventory_scan_insert_shape
BEFORE INSERT ON afternic_inventory_scans
WHEN NOT EXISTS (SELECT 1 FROM afternic_connection_publications p
    WHERE p.workspace_id=NEW.workspace_id AND p.connection_id=NEW.connection_id
      AND p.credential_generation=NEW.credential_generation AND p.publication_state='active')
  OR EXISTS (SELECT 1 FROM json_each(NEW.skipped_deleted_json) d
    WHERE d.type!='text' OR length(d.value) NOT BETWEEN 3 AND 253
      OR d.value != lower(d.value) OR d.value GLOB '*[^a-z0-9.-]*'
      OR substr(d.value,1,1) NOT GLOB '[a-z0-9]' OR substr(d.value,-1,1) NOT GLOB '[a-z0-9]'
      OR instr(d.value,'.')<=1 OR d.value LIKE '%..%' OR d.value LIKE '%.-%' OR d.value LIKE '%-.%')
  OR (SELECT count(DISTINCT d.value) FROM json_each(NEW.skipped_deleted_json) d)
      != json_array_length(NEW.skipped_deleted_json)
  OR (NEW.observation_run_id IS NOT NULL AND (
    NOT EXISTS (SELECT 1 FROM provider_observation_runs r
      WHERE r.workspace_id=NEW.workspace_id AND r.observation_run_id=NEW.observation_run_id
        AND r.connection_id=NEW.connection_id AND r.observation_capability='marketplace'
        AND r.status='succeeded' AND r.completed_at=NEW.completed_at)
    OR NEW.observed_count != (SELECT count(*) FROM provider_observation_targets t
      WHERE t.workspace_id=NEW.workspace_id AND t.observation_run_id=NEW.observation_run_id AND t.status='succeeded')
    OR NEW.observed_count != (SELECT count(*) FROM marketplace_listing_observations m
      JOIN afternic_listing_details d ON d.workspace_id=m.workspace_id AND d.listing_observation_id=m.listing_observation_id
      WHERE m.workspace_id=NEW.workspace_id AND m.observation_run_id=NEW.observation_run_id
        AND m.marketplace_kind='afternic' AND m.binding_connection_id=NEW.connection_id
        AND m.binding_generation=NEW.credential_generation)))
BEGIN SELECT RAISE(ABORT, 'invalid Afternic inventory completion'); END;
CREATE TRIGGER afternic_inventory_scan_no_update
BEFORE UPDATE ON afternic_inventory_scans
BEGIN SELECT RAISE(ABORT, 'Afternic scan completions are append-only'); END;
CREATE TRIGGER afternic_inventory_scan_no_delete
BEFORE DELETE ON afternic_inventory_scans
BEGIN SELECT RAISE(ABORT, 'Afternic scan completions are append-only'); END;

-- The migration runner admits only the recognized V4 guard before this forward change.
DROP TABLE cloudflare_credential_schema_guard;
CREATE TABLE cloudflare_credential_schema_guard (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1),
  schema_epoch TEXT NOT NULL CHECK(schema_epoch='P0_07_CREDENTIAL_SCHEMA_V5'),
  schema_fingerprint TEXT NOT NULL CHECK(schema_fingerprint='d35d58df1f5f7d7de787372e88284d75ecae75a381eb02ff7d6acba13aae196a')
) STRICT;
INSERT INTO cloudflare_credential_schema_guard VALUES(1,'P0_07_CREDENTIAL_SCHEMA_V5','d35d58df1f5f7d7de787372e88284d75ecae75a381eb02ff7d6acba13aae196a');
