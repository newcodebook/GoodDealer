-- Preserve every historical signed byte and FK while adding two closed Afternic actions.
ALTER TABLE afternic_delist_approvals RENAME TO afternic_listing_approvals;
ALTER TABLE afternic_delist_item_authorizations RENAME TO afternic_listing_item_authorizations;
ALTER TABLE afternic_listing_approvals ADD COLUMN action TEXT NOT NULL DEFAULT 'remove' CHECK(action IN ('remove','create','update'));
CREATE TRIGGER afternic_listing_approval_action BEFORE INSERT ON afternic_listing_approvals
WHEN NOT EXISTS(SELECT 1 FROM operation_plans p WHERE p.workspace_id=NEW.workspace_id AND p.plan_id=NEW.plan_id
 AND ((p.operation_kind='afternic_delist' AND NEW.action='remove') OR (p.operation_kind='afternic_listing_write' AND NEW.action IN ('create','update'))))
 OR EXISTS(SELECT 1 FROM operation_plan_items i WHERE i.workspace_id=NEW.workspace_id AND i.plan_id=NEW.plan_id AND json_extract(i.new_value_json,'$.action') IS NOT NEW.action)
 OR NOT EXISTS(SELECT 1 FROM workspace_device_audit_outbox a WHERE a.workspace_id=NEW.workspace_id AND a.audit_event_id=NEW.audit_event_id AND json_extract(a.envelope_json,'$.payloadRedacted.action')=NEW.action)
BEGIN SELECT RAISE(ABORT,'Afternic approval action must match all targets and audit'); END;
CREATE TRIGGER afternic_listing_authorization_action BEFORE INSERT ON afternic_listing_item_authorizations
WHEN NOT EXISTS(SELECT 1 FROM afternic_listing_approvals a WHERE a.workspace_id=NEW.workspace_id AND a.approved_operation_id=NEW.approved_operation_id
 AND json_extract(NEW.envelope_json,'$.action')=a.action
 AND json_extract(NEW.envelope_json,'$.typ')=CASE a.action WHEN 'remove' THEN 'gd.afternic-delist-item-approval.v1' ELSE 'gd.afternic-listing-write-item-approval.v1' END)
BEGIN SELECT RAISE(ABORT,'Afternic item authorization action must match approval'); END;
CREATE TRIGGER afternic_listing_fact_action BEFORE INSERT ON device_execution_fact_outbox
WHEN NOT EXISTS(SELECT 1 FROM afternic_listing_item_authorizations i JOIN afternic_listing_approvals a USING(workspace_id,approved_operation_id)
 JOIN workspace_device_audit_outbox d ON d.workspace_id=a.workspace_id AND d.audit_event_id=NEW.audit_event_id
 WHERE i.workspace_id=NEW.workspace_id AND i.operation_id=NEW.operation_id AND i.item_id=NEW.item_id AND i.attempt_id=NEW.attempt_id
 AND json_extract(NEW.envelope_json,'$.payloadRedacted.action')=a.action
 AND json_extract(d.envelope_json,'$.payloadRedacted.action')=a.action
 AND json_extract(d.envelope_json,'$.payloadRedacted.stage')='dispatch_claimed'
 AND json_extract(d.envelope_json,'$.payloadRedacted.attemptId')=NEW.attempt_id
 AND json_extract(NEW.envelope_json,'$.eventType')=CASE a.action WHEN 'remove' THEN 'afternic_delist_dispatch_claimed' ELSE 'afternic_listing_write_dispatch_claimed' END)
BEGIN SELECT RAISE(ABORT,'Afternic fact action must match original approval and paired audit'); END;
CREATE TABLE afternic_listing_write_reconciliations (
 workspace_id TEXT NOT NULL, operation_id TEXT NOT NULL, plan_id TEXT NOT NULL, item_id TEXT NOT NULL,
 attempt_number INTEGER NOT NULL CHECK(attempt_number=1), sequence INTEGER NOT NULL CHECK(sequence BETWEEN 1 AND 9007199254740991),
 request_digest TEXT NOT NULL CHECK(length(request_digest)=64 AND request_digest NOT GLOB '*[^0-9a-f]*'),
 stage TEXT NOT NULL CHECK(stage IN ('preflight','reconcile')),
 outcome TEXT NOT NULL CHECK(outcome IN ('matched','absent','different','read_failed','conflict')),
 reason TEXT CHECK(reason IN ('precondition_changed','connection_changed','read_failed','postcondition_pending','already_present','listing_absent','provider_state_blocked')),
 item_state TEXT NOT NULL CHECK(item_state IN ('queued','reconciling','pending_provider','pending_verification','applied','conflict')),
 fields_matched INTEGER NOT NULL CHECK(fields_matched IN (0,1)),
 observed_at TEXT NOT NULL, next_read_at TEXT,
 observation_json TEXT CHECK(observation_json IS NULL OR (json_valid(observation_json) AND json_type(observation_json)='object' AND length(CAST(observation_json AS BLOB))<=8192)),
 observation_digest TEXT CHECK(observation_digest IS NULL OR (length(observation_digest)=64 AND observation_digest NOT GLOB '*[^0-9a-f]*')),
 listing_observation_id TEXT, audit_event_id TEXT,
 PRIMARY KEY(workspace_id,operation_id,item_id,sequence),
 FOREIGN KEY(workspace_id,operation_id,plan_id,item_id,attempt_number) REFERENCES operation_attempts(workspace_id,operation_id,plan_id,item_id,attempt_number) ON DELETE RESTRICT,
 FOREIGN KEY(workspace_id,listing_observation_id) REFERENCES marketplace_listing_observations(workspace_id,listing_observation_id) ON DELETE RESTRICT,
 FOREIGN KEY(workspace_id,audit_event_id) REFERENCES workspace_device_audit_outbox(workspace_id,audit_event_id) ON DELETE RESTRICT,
 CHECK((item_state IN ('applied','conflict'))=(next_read_at IS NULL)),
 CHECK(next_read_at IS NULL OR next_read_at>observed_at),
 CHECK((outcome='matched' AND reason IS NULL AND fields_matched=1 AND observation_json IS NOT NULL)
 OR (outcome IN ('absent','different') AND reason='postcondition_pending' AND fields_matched=0)
 OR (outcome='read_failed' AND reason='read_failed' AND fields_matched=0 AND observation_json IS NULL)
 OR (outcome='conflict' AND item_state='conflict' AND reason IN ('precondition_changed','connection_changed','already_present','listing_absent','provider_state_blocked'))),
 CHECK(stage='reconcile' OR outcome IN ('read_failed','conflict')),
 CHECK(stage='preflight' OR reason IS NULL OR reason NOT IN ('already_present','listing_absent')),
 CHECK((item_state='applied')= (outcome='matched' AND next_read_at IS NULL))
) STRICT;
CREATE TRIGGER afternic_listing_write_reconciliation_no_update BEFORE UPDATE ON afternic_listing_write_reconciliations BEGIN SELECT RAISE(ABORT,'Afternic reconciliation is immutable'); END;
CREATE TRIGGER afternic_listing_write_reconciliation_no_delete BEFORE DELETE ON afternic_listing_write_reconciliations BEGIN SELECT RAISE(ABORT,'Afternic reconciliation is retained'); END;
CREATE TRIGGER afternic_listing_write_reconciliation_scope BEFORE INSERT ON afternic_listing_write_reconciliations
WHEN NOT EXISTS(SELECT 1 FROM operation_attempts a JOIN operation_plans p USING(workspace_id,plan_id)
 WHERE a.workspace_id=NEW.workspace_id AND a.operation_id=NEW.operation_id AND a.plan_id=NEW.plan_id AND a.item_id=NEW.item_id AND a.attempt_number=1 AND a.request_digest=NEW.request_digest
 AND p.operation_kind='afternic_listing_write' AND p.phase='executing'
 AND ((NEW.stage='preflight' AND a.status IN ('queued','failed_final')) OR (NEW.stage='reconcile' AND a.status IN ('running','outcome_unknown','succeeded'))))
 OR NEW.sequence!=(SELECT count(*)+1 FROM afternic_listing_write_reconciliations r WHERE r.workspace_id=NEW.workspace_id AND r.operation_id=NEW.operation_id AND r.item_id=NEW.item_id)
 OR EXISTS(SELECT 1 FROM afternic_listing_write_reconciliations r WHERE r.workspace_id=NEW.workspace_id AND r.operation_id=NEW.operation_id AND r.item_id=NEW.item_id AND r.item_state IN ('applied','conflict'))
BEGIN SELECT RAISE(ABORT,'Afternic write reconciliation must match approved attempt'); END;
CREATE TRIGGER afternic_listing_write_reconciliation_audit BEFORE INSERT ON afternic_listing_write_reconciliations
WHEN (NEW.audit_event_id IS NULL AND (NEW.stage='reconcile' OR NEW.outcome!='read_failed'))
 OR (NEW.audit_event_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM workspace_device_audit_outbox d JOIN afternic_listing_approvals a ON a.workspace_id=d.workspace_id AND a.operation_id=NEW.operation_id
 WHERE d.workspace_id=NEW.workspace_id AND d.audit_event_id=NEW.audit_event_id
 AND json_extract(d.envelope_json,'$.targetType')='afternic_listing_write_attempt'
 AND json_extract(d.envelope_json,'$.payloadRedacted.action')=a.action
 AND json_extract(d.envelope_json,'$.payloadRedacted.operationId')=NEW.operation_id
 AND json_extract(d.envelope_json,'$.payloadRedacted.operationItemId')=NEW.item_id
 AND json_extract(d.envelope_json,'$.payloadRedacted.reason') IS NEW.reason
 AND ((NEW.stage='preflight' AND json_extract(d.envelope_json,'$.payloadRedacted.stage')='preflight_refused') OR (NEW.stage='reconcile' AND json_extract(d.envelope_json,'$.payloadRedacted.stage')='reconciled' AND json_extract(d.envelope_json,'$.payloadRedacted.outcome')=NEW.outcome))))
BEGIN SELECT RAISE(ABORT,'Afternic write result requires exact signed audit'); END;
CREATE TRIGGER afternic_listing_write_reconciliation_barrier BEFORE INSERT ON afternic_listing_write_reconciliations WHEN EXISTS(SELECT 1 FROM device_handoff_barriers b WHERE b.workspace_id=NEW.workspace_id) BEGIN SELECT RAISE(ABORT,'handoff freezes Afternic observations'); END;
CREATE VIEW afternic_listing_write_effective_attempts AS SELECT a.*,CASE (SELECT r.item_state FROM afternic_listing_write_reconciliations r WHERE r.workspace_id=a.workspace_id AND r.operation_id=a.operation_id AND r.item_id=a.item_id ORDER BY r.sequence DESC LIMIT 1) WHEN 'applied' THEN 'succeeded' WHEN 'conflict' THEN 'failed_final' ELSE a.status END AS effective_status FROM operation_attempts a JOIN operation_plans p USING(workspace_id,plan_id) WHERE p.operation_kind='afternic_listing_write';
CREATE TRIGGER afternic_listing_write_single_operation BEFORE INSERT ON operations
WHEN EXISTS(SELECT 1 FROM operation_plans p WHERE p.workspace_id=NEW.workspace_id AND p.plan_id=NEW.plan_id AND p.operation_kind='afternic_listing_write')
 AND (NEW.phase!='queued' OR EXISTS(SELECT 1 FROM operations o WHERE o.workspace_id=NEW.workspace_id AND o.plan_id=NEW.plan_id))
BEGIN SELECT RAISE(ABORT,'Afternic plan has one execution'); END;
CREATE TRIGGER afternic_listing_write_operation_edges BEFORE UPDATE ON operations
WHEN EXISTS(SELECT 1 FROM operation_plans p WHERE p.workspace_id=OLD.workspace_id AND p.plan_id=OLD.plan_id AND p.operation_kind='afternic_listing_write')
 AND (NEW.workspace_id IS NOT OLD.workspace_id OR NEW.operation_id IS NOT OLD.operation_id
 OR NEW.idempotency_key IS NOT OLD.idempotency_key OR NEW.requested_at IS NOT OLD.requested_at
 OR NOT(NEW.phase=OLD.phase OR (OLD.phase='queued' AND NEW.phase='running')
 OR (OLD.phase='running' AND NEW.phase IN ('completed','partially_failed'))))
BEGIN SELECT RAISE(ABORT,'Afternic execution cannot replay'); END;
CREATE TRIGGER afternic_listing_write_plan_edges BEFORE UPDATE ON operation_plans
WHEN OLD.operation_kind='afternic_listing_write' AND NOT(NEW.phase=OLD.phase
 OR (OLD.phase='awaiting_approval' AND NEW.phase IN ('approved','expired','cancelled'))
 OR (OLD.phase='approved' AND NEW.phase='executing') OR (OLD.phase='executing' AND NEW.phase='completed'))
BEGIN SELECT RAISE(ABORT,'Afternic approval transition is closed'); END;
CREATE TRIGGER afternic_listing_write_attempt_scope BEFORE INSERT ON operation_attempts
WHEN EXISTS(SELECT 1 FROM operation_plans p WHERE p.workspace_id=NEW.workspace_id AND p.plan_id=NEW.plan_id AND p.operation_kind='afternic_listing_write')
 AND (NEW.attempt_number!=1 OR NEW.status!='queued' OR NOT EXISTS(
 SELECT 1 FROM operation_plan_items i WHERE i.workspace_id=NEW.workspace_id AND i.plan_id=NEW.plan_id AND i.item_id=NEW.item_id
 AND i.capability='afternic:marketplace:write' AND i.execution_mode='automatic' AND i.inclusion_status='included'
 AND i.risk_level='standard' AND i.entity_id IS NOT NULL AND i.connection_id IS NOT NULL
 AND json_extract(i.new_value_json,'$.action') IN ('create','update')))
BEGIN SELECT RAISE(ABORT,'Afternic attempt must be the approved single removal'); END;
CREATE TRIGGER afternic_listing_write_attempt_edges BEFORE UPDATE ON operation_attempts
WHEN EXISTS(SELECT 1 FROM operation_plans p WHERE p.workspace_id=OLD.workspace_id AND p.plan_id=OLD.plan_id AND p.operation_kind='afternic_listing_write')
 AND NOT(NEW.status=OLD.status OR (OLD.status='queued' AND NEW.status IN ('running','succeeded','failed_final'))
 OR (OLD.status='running' AND NEW.status IN ('succeeded','outcome_unknown')))
BEGIN SELECT RAISE(ABORT,'Afternic attempt cannot be sent again'); END;
CREATE TRIGGER afternic_listing_write_result_sequence BEFORE INSERT ON operation_results
WHEN EXISTS(SELECT 1 FROM operation_plans p WHERE p.workspace_id=NEW.workspace_id AND p.plan_id=NEW.plan_id AND p.operation_kind='afternic_listing_write')
 AND NEW.result_version!=(SELECT count(*)+1 FROM operation_results r WHERE r.workspace_id=NEW.workspace_id AND r.operation_id=NEW.operation_id AND r.item_id=NEW.item_id)
BEGIN SELECT RAISE(ABORT,'Afternic result sequence is contiguous'); END;
CREATE TRIGGER afternic_listing_write_handoff_blocks_attempt BEFORE INSERT ON operation_attempts
WHEN EXISTS(SELECT 1 FROM operation_plans p WHERE p.workspace_id=NEW.workspace_id AND p.plan_id=NEW.plan_id AND p.operation_kind='afternic_listing_write')
 AND EXISTS(SELECT 1 FROM device_handoff_barriers b WHERE b.workspace_id=NEW.workspace_id)
BEGIN SELECT RAISE(ABORT,'device handoff closes Afternic execution admission'); END;
CREATE TRIGGER afternic_listing_write_handoff_blocks_dispatch BEFORE UPDATE OF status ON operation_attempts
WHEN OLD.status='queued' AND NEW.status='running'
 AND EXISTS(SELECT 1 FROM operation_plans p WHERE p.workspace_id=OLD.workspace_id AND p.plan_id=OLD.plan_id AND p.operation_kind='afternic_listing_write')
 AND EXISTS(SELECT 1 FROM device_handoff_barriers b WHERE b.workspace_id=OLD.workspace_id)
BEGIN SELECT RAISE(ABORT,'device handoff closes Afternic dispatch'); END;

CREATE TRIGGER afternic_listing_write_handoff_blocks_preview BEFORE INSERT ON operation_plans
WHEN NEW.operation_kind='afternic_listing_write'
 AND EXISTS(SELECT 1 FROM device_handoff_barriers b WHERE b.workspace_id=NEW.workspace_id)
BEGIN SELECT RAISE(ABORT,'device handoff closes Afternic preview admission'); END;
CREATE TRIGGER afternic_listing_write_requires_signed_claim BEFORE UPDATE OF status ON operation_attempts
WHEN OLD.status='queued' AND NEW.status='running' AND NOT EXISTS(SELECT 1 FROM device_handoff_barriers b WHERE b.workspace_id=OLD.workspace_id) AND EXISTS(SELECT 1 FROM operation_plans p WHERE p.workspace_id=OLD.workspace_id AND p.plan_id=OLD.plan_id AND p.operation_kind='afternic_listing_write')
 AND NOT EXISTS(SELECT 1 FROM device_execution_fact_outbox f WHERE f.workspace_id=OLD.workspace_id
 AND f.operation_id=OLD.operation_id AND f.item_id=OLD.item_id AND f.attempt_number=OLD.attempt_number)
BEGIN SELECT RAISE(ABORT,'Afternic dispatch requires its immutable signed claim'); END;

CREATE TRIGGER afternic_listing_write_result_observation BEFORE INSERT ON afternic_listing_write_reconciliations
WHEN NEW.listing_observation_id IS NOT NULL AND NOT EXISTS(
 SELECT 1 FROM marketplace_listing_observations m JOIN operation_plan_items i ON i.workspace_id=m.workspace_id AND i.plan_id=NEW.plan_id AND i.item_id=NEW.item_id
 JOIN provider_observation_runs r ON r.workspace_id=m.workspace_id AND r.observation_run_id=m.observation_run_id
 JOIN afternic_listing_details d USING(workspace_id,listing_observation_id)
 WHERE m.workspace_id=NEW.workspace_id AND m.listing_observation_id=NEW.listing_observation_id AND NEW.stage='reconcile'
 AND m.marketplace_kind='afternic' AND m.entity_id=i.entity_id AND m.binding_connection_id=i.connection_id
 AND m.binding_generation=json_extract(i.precondition_json,'$.credentialGeneration')
 AND (json_extract(i.new_value_json,'$.action')='create' OR m.binding_resource_digest=json_extract(i.precondition_json,'$.bindingDigest'))
 AND m.observed_at=NEW.observed_at AND m.provider_version_token=NEW.observation_digest
 AND m.confirmed=1 AND m.observation_availability='available' AND m.evidence_status='confirmed'
 AND r.connection_id=i.connection_id AND r.status='succeeded'
 AND d.provider_status=json_extract(NEW.observation_json,'$.status')
 AND d.buynow_price IS json_extract(NEW.observation_json,'$.buynowPrice')
 AND d.floor_price IS json_extract(NEW.observation_json,'$.floorPrice')
 AND d.minbid_price IS json_extract(NEW.observation_json,'$.minbidPrice')
 AND d.hidden IS json_extract(NEW.observation_json,'$.hidden'))
BEGIN SELECT RAISE(ABORT,'Afternic result observation must match exact approved scope'); END;
