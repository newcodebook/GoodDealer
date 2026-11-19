-- Afternic's first executable parent-plan intent: one approved removal per bound Listing.
CREATE TABLE afternic_delist_reconciliations (
 workspace_id TEXT NOT NULL,
 operation_id TEXT NOT NULL,
 plan_id TEXT NOT NULL,
 item_id TEXT NOT NULL,
 attempt_number INTEGER NOT NULL CHECK(attempt_number=1),
 sequence INTEGER NOT NULL CHECK(sequence BETWEEN 1 AND 9007199254740991),
 request_digest TEXT NOT NULL CHECK(length(request_digest)=64 AND request_digest NOT GLOB '*[^0-9a-f]*'),
 stage TEXT NOT NULL CHECK(stage IN ('preflight','reconcile')),
 outcome TEXT NOT NULL CHECK(outcome IN ('absent','present','read_failed','conflict')),
 reason TEXT CHECK(reason IN ('precondition_changed','connection_changed','read_failed','still_present')),
 observed_at TEXT NOT NULL,
 next_read_at TEXT,
 observation_json TEXT CHECK(observation_json IS NULL OR (json_valid(observation_json) AND json_type(observation_json)='object' AND length(CAST(observation_json AS BLOB))<=8192)),
 observation_digest TEXT CHECK(observation_digest IS NULL OR (length(observation_digest)=64 AND observation_digest NOT GLOB '*[^0-9a-f]*')),
 listing_observation_id TEXT,
 PRIMARY KEY(workspace_id,operation_id,item_id,sequence),
 FOREIGN KEY(workspace_id,operation_id,plan_id,item_id,attempt_number)
  REFERENCES operation_attempts(workspace_id,operation_id,plan_id,item_id,attempt_number) ON DELETE RESTRICT,
 FOREIGN KEY(workspace_id,listing_observation_id)
  REFERENCES marketplace_listing_observations(workspace_id,listing_observation_id) ON DELETE RESTRICT,
 CHECK((outcome='absent')=(listing_observation_id IS NOT NULL)),
 CHECK((outcome IN ('present','read_failed'))=(next_read_at IS NOT NULL)),
 CHECK(next_read_at IS NULL OR next_read_at>observed_at),
 CHECK((outcome='absent' AND reason IS NULL AND observation_json IS NULL AND observation_digest IS NOT NULL)
    OR (outcome='present' AND stage='reconcile' AND reason='still_present' AND observation_json IS NOT NULL AND observation_digest IS NOT NULL)
    OR (outcome='read_failed' AND reason='read_failed' AND observation_json IS NULL AND observation_digest IS NULL)
    OR (outcome='conflict' AND reason IN ('precondition_changed','connection_changed')))
) STRICT;
CREATE TRIGGER afternic_delist_reconciliation_no_update BEFORE UPDATE ON afternic_delist_reconciliations
BEGIN SELECT RAISE(ABORT,'Afternic reconciliation is immutable'); END;
CREATE TRIGGER afternic_delist_reconciliation_no_delete BEFORE DELETE ON afternic_delist_reconciliations
BEGIN SELECT RAISE(ABORT,'Afternic reconciliation is immutable'); END;
CREATE TRIGGER afternic_delist_reconciliation_scope BEFORE INSERT ON afternic_delist_reconciliations
WHEN NOT EXISTS (
 SELECT 1 FROM operation_attempts a JOIN operation_plans p USING(workspace_id,plan_id)
 WHERE a.workspace_id=NEW.workspace_id AND a.operation_id=NEW.operation_id AND a.plan_id=NEW.plan_id
 AND a.item_id=NEW.item_id AND a.attempt_number=1 AND a.request_digest=NEW.request_digest
 AND p.operation_kind='afternic_delist' AND p.phase IN ('approved','executing')
 AND ((NEW.stage='preflight' AND a.status IN ('queued','succeeded','failed_final'))
   OR (NEW.stage='reconcile' AND a.status IN ('running','outcome_unknown','succeeded'))))
 OR NEW.sequence!=(SELECT count(*)+1 FROM afternic_delist_reconciliations r
 WHERE r.workspace_id=NEW.workspace_id AND r.operation_id=NEW.operation_id AND r.item_id=NEW.item_id)
 OR EXISTS(SELECT 1 FROM afternic_delist_reconciliations r WHERE r.workspace_id=NEW.workspace_id
 AND r.operation_id=NEW.operation_id AND r.item_id=NEW.item_id AND r.outcome IN ('absent','conflict'))
 OR (NEW.outcome='absent' AND NOT EXISTS (
 SELECT 1 FROM marketplace_listing_observations m JOIN operation_plan_items i
 ON i.workspace_id=m.workspace_id AND i.plan_id=NEW.plan_id AND i.item_id=NEW.item_id
 JOIN provider_observation_runs r ON r.workspace_id=m.workspace_id AND r.observation_run_id=m.observation_run_id
 WHERE m.workspace_id=NEW.workspace_id AND m.listing_observation_id=NEW.listing_observation_id
 AND m.marketplace_kind='afternic' AND m.entity_id=i.entity_id AND m.listing_status='unlisted'
 AND m.binding_connection_id=i.connection_id
 AND m.binding_resource_digest=json_extract(i.precondition_json,'$.bindingDigest')
 AND m.binding_generation=json_extract(i.precondition_json,'$.bindingGeneration')
 AND m.observed_at=NEW.observed_at AND m.provider_version_token=NEW.observation_digest
 AND m.observation_availability='available' AND m.evidence_status='confirmed'
 AND r.connection_id=i.connection_id AND r.status='succeeded'))
BEGIN SELECT RAISE(ABORT,'Afternic reconciliation must match the exact approved attempt and observation'); END;
CREATE TRIGGER afternic_delist_single_operation BEFORE INSERT ON operations
WHEN EXISTS(SELECT 1 FROM operation_plans p WHERE p.workspace_id=NEW.workspace_id AND p.plan_id=NEW.plan_id AND p.operation_kind='afternic_delist')
 AND (NEW.phase!='queued' OR EXISTS(SELECT 1 FROM operations o WHERE o.workspace_id=NEW.workspace_id AND o.plan_id=NEW.plan_id))
BEGIN SELECT RAISE(ABORT,'Afternic plan has one execution'); END;
CREATE TRIGGER afternic_delist_operation_edges BEFORE UPDATE ON operations
WHEN EXISTS(SELECT 1 FROM operation_plans p WHERE p.workspace_id=OLD.workspace_id AND p.plan_id=OLD.plan_id AND p.operation_kind='afternic_delist')
 AND (NEW.workspace_id IS NOT OLD.workspace_id OR NEW.operation_id IS NOT OLD.operation_id
 OR NEW.idempotency_key IS NOT OLD.idempotency_key OR NEW.requested_at IS NOT OLD.requested_at
 OR NOT(NEW.phase=OLD.phase OR (OLD.phase='queued' AND NEW.phase='running')
 OR (OLD.phase='running' AND NEW.phase IN ('completed','partially_failed'))))
BEGIN SELECT RAISE(ABORT,'Afternic execution cannot replay'); END;
CREATE TRIGGER afternic_delist_plan_edges BEFORE UPDATE ON operation_plans
WHEN OLD.operation_kind='afternic_delist' AND NOT(NEW.phase=OLD.phase
 OR (OLD.phase='awaiting_approval' AND NEW.phase IN ('approved','expired','cancelled'))
 OR (OLD.phase='approved' AND NEW.phase='executing') OR (OLD.phase='executing' AND NEW.phase='completed'))
BEGIN SELECT RAISE(ABORT,'Afternic approval transition is closed'); END;
CREATE TRIGGER afternic_delist_attempt_scope BEFORE INSERT ON operation_attempts
WHEN EXISTS(SELECT 1 FROM operation_plans p WHERE p.workspace_id=NEW.workspace_id AND p.plan_id=NEW.plan_id AND p.operation_kind='afternic_delist')
 AND (NEW.attempt_number!=1 OR NEW.status!='queued' OR NOT EXISTS(
 SELECT 1 FROM operation_plan_items i WHERE i.workspace_id=NEW.workspace_id AND i.plan_id=NEW.plan_id AND i.item_id=NEW.item_id
 AND i.capability='afternic:marketplace:write' AND i.execution_mode='automatic' AND i.inclusion_status='included'
 AND i.risk_level='standard' AND i.entity_id IS NOT NULL AND i.connection_id IS NOT NULL
 AND json_extract(i.new_value_json,'$.action')='remove'))
BEGIN SELECT RAISE(ABORT,'Afternic attempt must be the approved single removal'); END;
CREATE TRIGGER afternic_delist_attempt_edges BEFORE UPDATE ON operation_attempts
WHEN EXISTS(SELECT 1 FROM operation_plans p WHERE p.workspace_id=OLD.workspace_id AND p.plan_id=OLD.plan_id AND p.operation_kind='afternic_delist')
 AND NOT(NEW.status=OLD.status OR (OLD.status='queued' AND NEW.status IN ('running','succeeded','failed_final'))
 OR (OLD.status='running' AND NEW.status IN ('succeeded','outcome_unknown')))
BEGIN SELECT RAISE(ABORT,'Afternic attempt cannot be sent again'); END;
CREATE TRIGGER afternic_delist_result_sequence BEFORE INSERT ON operation_results
WHEN EXISTS(SELECT 1 FROM operation_plans p WHERE p.workspace_id=NEW.workspace_id AND p.plan_id=NEW.plan_id AND p.operation_kind='afternic_delist')
 AND NEW.result_version!=(SELECT count(*)+1 FROM operation_results r WHERE r.workspace_id=NEW.workspace_id AND r.operation_id=NEW.operation_id AND r.item_id=NEW.item_id)
BEGIN SELECT RAISE(ABORT,'Afternic result sequence is contiguous'); END;
CREATE VIEW afternic_delist_effective_attempts AS
 SELECT a.*,CASE (SELECT r.outcome FROM afternic_delist_reconciliations r
 WHERE r.workspace_id=a.workspace_id AND r.operation_id=a.operation_id AND r.item_id=a.item_id
 ORDER BY r.sequence DESC LIMIT 1) WHEN 'absent' THEN 'succeeded' WHEN 'conflict' THEN 'failed_final' ELSE a.status END AS effective_status
 FROM operation_attempts a JOIN operation_plans p USING(workspace_id,plan_id) WHERE p.operation_kind='afternic_delist';
CREATE TRIGGER afternic_delist_absence_generation AFTER INSERT ON afternic_delist_reconciliations
WHEN NEW.outcome='absent'
BEGIN UPDATE sales_listing_generation SET generation=generation+1 WHERE singleton=1; END;

DROP VIEW marketplace_listing_observations_read_facts;
CREATE VIEW marketplace_listing_observations_read_facts AS
SELECT candidates.*,row_number() OVER (
 PARTITION BY workspace_id,entity_id,marketplace_kind,observation_connection_id
 ORDER BY binding_current DESC,(binding_current=0 AND binding_resource_digest IS NOT NULL AND listing_status='unlisted' AND binding_fresh=1) DESC,observed_at DESC,listing_observation_id DESC) AS connection_rank
FROM (
 SELECT m.*,r.connection_id AS observation_connection_id,
 CASE WHEN m.binding_connection_id IS NULL THEN m.binding_resource_digest IS NULL AND m.binding_generation IS NULL
 ELSE b.connection_id IS NOT NULL AND b.provider_kind=m.marketplace_kind AND b.resource_label=m.entity_id AND r.connection_id=m.binding_connection_id END AS binding_valid,
 coalesce(b.validation_status!='detached' AND b.binding_generation=m.binding_generation,0) AS binding_current,
 CASE WHEN m.binding_connection_id IS NULL THEN 1 ELSE coalesce(
 b.binding_generation=m.binding_generation AND c.lifecycle_status='active' AND c.deleted_at IS NULL
 AND c.validation_status='valid' AND c.credential_use_state='active' AND (
 b.validation_status IN ('verified','unverified') OR (b.validation_status='detached' AND m.listing_status='unlisted' AND EXISTS(
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

-- The handoff barrier must cover this local execution ledger as well as the sync Outbox.
-- Otherwise an empty proof could be prepared and a DELETE approved afterwards under the same Lease.
CREATE TRIGGER afternic_delist_handoff_blocks_attempt BEFORE INSERT ON operation_attempts
WHEN EXISTS(SELECT 1 FROM operation_plans p WHERE p.workspace_id=NEW.workspace_id AND p.plan_id=NEW.plan_id AND p.operation_kind='afternic_delist')
 AND EXISTS(SELECT 1 FROM device_handoff_barriers b WHERE b.workspace_id=NEW.workspace_id)
BEGIN SELECT RAISE(ABORT,'device handoff closes Afternic execution admission'); END;
CREATE TRIGGER afternic_delist_handoff_blocks_dispatch BEFORE UPDATE OF status ON operation_attempts
WHEN OLD.status='queued' AND NEW.status='running'
 AND EXISTS(SELECT 1 FROM operation_plans p WHERE p.workspace_id=OLD.workspace_id AND p.plan_id=OLD.plan_id AND p.operation_kind='afternic_delist')
 AND EXISTS(SELECT 1 FROM device_handoff_barriers b WHERE b.workspace_id=OLD.workspace_id)
BEGIN SELECT RAISE(ABORT,'device handoff closes Afternic dispatch'); END;

CREATE TRIGGER afternic_delist_handoff_blocks_preview BEFORE INSERT ON operation_plans
WHEN NEW.operation_kind='afternic_delist'
 AND EXISTS(SELECT 1 FROM device_handoff_barriers b WHERE b.workspace_id=NEW.workspace_id)
BEGIN SELECT RAISE(ABORT,'device handoff closes Afternic preview admission'); END;
