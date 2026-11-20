-- Extend the existing execution evidence owner while preserving old approval rows and signatures.
DROP TRIGGER afternic_listing_approval_action;
DROP TRIGGER afternic_listing_authorization_action;
DROP TRIGGER afternic_listing_write_reconciliation_audit;
DROP TRIGGER afternic_listing_fact_action;
CREATE TABLE afternic_listing_approvals_next (
 workspace_id TEXT NOT NULL,
 approved_operation_id TEXT NOT NULL,
 operation_id TEXT NOT NULL,
 plan_id TEXT NOT NULL,
 plan_hash TEXT NOT NULL CHECK(length(plan_hash)=43),
 target_count INTEGER NOT NULL CHECK(target_count BETWEEN 1 AND 1000),
 target_set_digest TEXT NOT NULL CHECK(length(target_set_digest)=43),
 source_device_id TEXT NOT NULL,
 active_lease_epoch INTEGER NOT NULL CHECK(active_lease_epoch BETWEEN 1 AND 9007199254740991),
 credential_epoch INTEGER NOT NULL CHECK(credential_epoch BETWEEN 1 AND 9007199254740991),
 signing_key_id TEXT NOT NULL,
 signing_key_version INTEGER NOT NULL CHECK(signing_key_version BETWEEN 1 AND 9007199254740991),
 source_installation_digest TEXT NOT NULL CHECK(length(source_installation_digest)=43),
 approved_at TEXT NOT NULL,
 audit_event_id TEXT NOT NULL,
 action TEXT NOT NULL CHECK(action IN ('remove','create','update','listing_plan_v2','set_bin_price')),
 CHECK(action='listing_plan_v2' OR target_count<=500),
 PRIMARY KEY(workspace_id,approved_operation_id),
 UNIQUE(workspace_id,operation_id), UNIQUE(workspace_id,plan_id),
 FOREIGN KEY(workspace_id,operation_id) REFERENCES operations(workspace_id,operation_id) ON DELETE RESTRICT,
 FOREIGN KEY(workspace_id,plan_id) REFERENCES operation_plans(workspace_id,plan_id) ON DELETE RESTRICT,
 FOREIGN KEY(workspace_id,audit_event_id) REFERENCES workspace_device_audit_outbox(workspace_id,audit_event_id) ON DELETE RESTRICT
) STRICT;
INSERT INTO afternic_listing_approvals_next SELECT * FROM afternic_listing_approvals;
DROP TABLE afternic_listing_approvals;
ALTER TABLE afternic_listing_approvals_next RENAME TO afternic_listing_approvals;
CREATE TRIGGER afternic_delist_approvals_no_update BEFORE UPDATE ON afternic_listing_approvals
BEGIN SELECT RAISE(ABORT,'execution source evidence is immutable'); END;
CREATE TRIGGER afternic_delist_approvals_no_delete BEFORE DELETE ON afternic_listing_approvals
BEGIN SELECT RAISE(ABORT,'execution source evidence is immutable'); END;
CREATE TRIGGER afternic_listing_approval_action BEFORE INSERT ON afternic_listing_approvals
WHEN NOT EXISTS(SELECT 1 FROM operation_plans p JOIN workspace_device_audit_outbox a ON a.workspace_id=p.workspace_id AND a.audit_event_id=NEW.audit_event_id
 WHERE p.workspace_id=NEW.workspace_id AND p.plan_id=NEW.plan_id
 AND json_extract(a.envelope_json,'$.payloadRedacted.action')=NEW.action
 AND ((NEW.action='remove' AND p.operation_kind='afternic_delist') OR (NEW.action IN ('create','update') AND p.operation_kind='afternic_listing_write')
 OR (NEW.action='set_bin_price' AND p.operation_kind='sellerhub_bin_price' AND p.item_count=NEW.target_count
 AND a.source_device_id=NEW.source_device_id AND a.active_lease_epoch=NEW.active_lease_epoch
 AND a.source_installation_digest=NEW.source_installation_digest
 AND json_extract(a.envelope_json,'$.targetType')='sellerhub_bin_price_approval'
 AND json_extract(a.envelope_json,'$.payloadRedacted.provider')='spaceship'
 AND json_extract(a.envelope_json,'$.payloadRedacted.stage')='approved'
 AND json_extract(a.envelope_json,'$.payloadRedacted.approvedOperationId')=NEW.approved_operation_id
 AND json_extract(a.envelope_json,'$.payloadRedacted.operationId')=NEW.operation_id
 AND json_extract(a.envelope_json,'$.payloadRedacted.planId')=NEW.plan_id
 AND json_extract(a.envelope_json,'$.payloadRedacted.planHash')=NEW.plan_hash
 AND json_extract(a.envelope_json,'$.payloadRedacted.targetCount')=NEW.target_count
 AND json_extract(a.envelope_json,'$.payloadRedacted.targetSetDigest')=NEW.target_set_digest)
 OR (NEW.action='listing_plan_v2' AND p.operation_kind='afternic_listing_write' AND p.item_count=NEW.target_count
 AND json_extract(a.envelope_json,'$.targetType')='afternic_listing_plan_v2_approval'
 AND json_extract(a.envelope_json,'$.payloadRedacted.schemaVersion')=2)))
 OR (NEW.action IN ('remove','create','update') AND EXISTS(SELECT 1 FROM operation_plan_items i WHERE i.workspace_id=NEW.workspace_id AND i.plan_id=NEW.plan_id AND json_extract(i.new_value_json,'$.action') IS NOT NEW.action))
 OR (NEW.action='set_bin_price' AND (
 EXISTS(SELECT 1 FROM operation_plan_items i WHERE i.workspace_id=NEW.workspace_id AND i.plan_id=NEW.plan_id
  AND (i.capability!='spaceship:marketplace:write' OR i.field_path!='binPrice' OR i.risk_level!='standard'
       OR i.execution_mode!='automatic' OR i.inclusion_status!='included' OR i.connection_id IS NULL OR i.entity_id IS NULL))
 OR (SELECT count(DISTINCT connection_id) FROM operation_plan_items WHERE workspace_id=NEW.workspace_id AND plan_id=NEW.plan_id)!=1
 OR (SELECT count(DISTINCT entity_id) FROM operation_plan_items WHERE workspace_id=NEW.workspace_id AND plan_id=NEW.plan_id)!=NEW.target_count))
 OR (NEW.action='listing_plan_v2' AND (EXISTS(SELECT 1 FROM operation_plan_items i WHERE i.workspace_id=NEW.workspace_id AND i.plan_id=NEW.plan_id AND
 (json_extract(i.precondition_json,'$.schemaVersion') IS NOT 2 OR (json_extract(i.new_value_json,'$.action') IN ('create','update','reactivate_ownership_review')) IS NOT TRUE
 OR i.entity_id IS NULL OR i.connection_id IS NULL))
 OR (SELECT count(DISTINCT entity_id) FROM operation_plan_items WHERE workspace_id=NEW.workspace_id AND plan_id=NEW.plan_id)>500
 OR (SELECT count(DISTINCT connection_id) FROM operation_plan_items WHERE workspace_id=NEW.workspace_id AND plan_id=NEW.plan_id)!=1))
 OR (NEW.action='listing_plan_v2' AND EXISTS(SELECT 1 FROM afternic_controlled_acceptance_runs r JOIN operation_plan_items i ON i.workspace_id=r.workspace_id AND i.connection_id=r.connection_id WHERE i.workspace_id=NEW.workspace_id AND i.plan_id=NEW.plan_id AND json_extract(i.precondition_json,'$.connectionIncarnationId')=r.connection_incarnation_id AND json_extract(i.precondition_json,'$.credentialGeneration')=r.credential_generation))
BEGIN SELECT RAISE(ABORT,'Marketplace approval action must match its exact targets and audit'); END;
CREATE TRIGGER afternic_listing_authorization_action BEFORE INSERT ON afternic_listing_item_authorizations
WHEN NOT EXISTS(SELECT 1 FROM afternic_listing_approvals a JOIN operation_plan_items p ON p.workspace_id=a.workspace_id AND p.plan_id=a.plan_id AND p.item_id=NEW.item_id
 WHERE a.workspace_id=NEW.workspace_id AND a.approved_operation_id=NEW.approved_operation_id AND a.operation_id=NEW.operation_id AND a.plan_id=NEW.plan_id
 AND ((a.action IN ('remove','create','update') AND json_extract(NEW.envelope_json,'$.action')=a.action
 AND json_extract(NEW.envelope_json,'$.typ')=CASE a.action WHEN 'remove' THEN 'gd.afternic-delist-item-approval.v1' ELSE 'gd.afternic-listing-write-item-approval.v1' END)
 OR (a.action='set_bin_price'
 AND json_extract(NEW.envelope_json,'$.schemaVersion')=1
 AND json_extract(NEW.envelope_json,'$.typ')='gd.sellerhub-bin-price-item-approval.v1'
 AND json_extract(NEW.envelope_json,'$.capability')=p.capability
 AND json_extract(NEW.envelope_json,'$.action')='set_bin_price'
 AND json_extract(NEW.envelope_json,'$.planHash')=a.plan_hash
 AND json_extract(NEW.envelope_json,'$.targetCount')=a.target_count
 AND json_extract(NEW.envelope_json,'$.targetSetDigest')=a.target_set_digest
 AND json_extract(NEW.envelope_json,'$.sourceDeviceId')=a.source_device_id
 AND json_extract(NEW.envelope_json,'$.activeLeaseEpoch')=a.active_lease_epoch
 AND json_extract(NEW.envelope_json,'$.credentialEpoch')=a.credential_epoch
 AND json_extract(NEW.envelope_json,'$.signingKeyId')=a.signing_key_id
 AND json_extract(NEW.envelope_json,'$.signingKeyVersion')=a.signing_key_version)
 OR (a.action='listing_plan_v2' AND json_extract(NEW.envelope_json,'$.action')=json_extract(p.new_value_json,'$.action')
 AND json_extract(NEW.envelope_json,'$.targetCount')=a.target_count AND json_extract(NEW.envelope_json,'$.targetSetDigest')=a.target_set_digest
 AND ((json_extract(NEW.envelope_json,'$.action') IN ('create','update') AND json_extract(NEW.envelope_json,'$.typ')='gd.afternic-listing-plan-item-approval.v2' AND json_extract(NEW.envelope_json,'$.schemaVersion')=2
 AND json_type(NEW.envelope_json,'$.parentItemId')='null' AND json_type(NEW.envelope_json,'$.parentRequestDigest')='null')
 OR (json_extract(NEW.envelope_json,'$.action')='reactivate_ownership_review' AND json_extract(NEW.envelope_json,'$.typ')='gd.afternic-ownership-review-item-approval.v1' AND json_extract(NEW.envelope_json,'$.schemaVersion')=1
 AND EXISTS(SELECT 1 FROM afternic_ownership_review_items r WHERE r.workspace_id=NEW.workspace_id AND r.plan_id=NEW.plan_id AND r.item_id=NEW.item_id
 AND json_extract(NEW.envelope_json,'$.parentItemId') IS r.parent_item_id
 AND json_type(NEW.envelope_json,'$.parentItemId') IN ('null','text') AND json_type(NEW.envelope_json,'$.parentRequestDigest') IN ('null','text')
 AND ((r.parent_item_id IS NULL AND json_type(NEW.envelope_json,'$.parentRequestDigest')='null') OR EXISTS(SELECT 1 FROM afternic_listing_item_authorizations parent JOIN operation_attempts pa ON pa.workspace_id=parent.workspace_id AND pa.operation_id=parent.operation_id AND pa.item_id=parent.item_id WHERE parent.workspace_id=NEW.workspace_id AND parent.operation_id=NEW.operation_id AND parent.plan_id=NEW.plan_id AND parent.item_id=r.parent_item_id AND parent.request_digest=json_extract(NEW.envelope_json,'$.parentRequestDigest') AND pa.request_digest=r.parent_request_digest AND json_extract(parent.envelope_json,'$.action') IN ('create','update')))))))))
BEGIN SELECT RAISE(ABORT,'Marketplace authorization must match the exact typed item'); END;

CREATE TRIGGER sellerhub_bin_price_attempt_scope BEFORE INSERT ON operation_attempts
WHEN EXISTS(SELECT 1 FROM operation_plans p WHERE p.workspace_id=NEW.workspace_id AND p.plan_id=NEW.plan_id
 AND p.operation_kind='sellerhub_bin_price')
 AND (NEW.attempt_number!=1 OR NEW.status!='queued' OR NOT EXISTS(
  SELECT 1 FROM operation_plan_items i WHERE i.workspace_id=NEW.workspace_id AND i.plan_id=NEW.plan_id
   AND i.item_id=NEW.item_id AND i.capability='spaceship:marketplace:write' AND i.field_path='binPrice'
   AND i.risk_level='standard' AND i.execution_mode='automatic' AND i.inclusion_status='included'
   AND i.entity_id IS NOT NULL AND i.connection_id IS NOT NULL))
BEGIN SELECT RAISE(ABORT,'SellerHub attempt requires an approved BIN price change'); END;
CREATE TRIGGER afternic_listing_write_reconciliation_audit BEFORE INSERT ON afternic_listing_write_reconciliations
WHEN (NEW.audit_event_id IS NULL AND (NEW.stage='reconcile' OR NEW.outcome!='read_failed'))
 OR (NEW.audit_event_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM workspace_device_audit_outbox d JOIN afternic_listing_approvals a ON a.workspace_id=d.workspace_id AND a.operation_id=NEW.operation_id
 WHERE d.workspace_id=NEW.workspace_id AND d.audit_event_id=NEW.audit_event_id
 AND json_extract(d.envelope_json,'$.targetType')=CASE a.action WHEN 'listing_plan_v2' THEN 'afternic_listing_plan_v2_attempt' ELSE 'afternic_listing_write_attempt' END
 AND ((a.action!='listing_plan_v2' AND json_extract(d.envelope_json,'$.payloadRedacted.action')=a.action) OR (a.action='listing_plan_v2' AND EXISTS(SELECT 1 FROM operation_plan_items i WHERE i.workspace_id=a.workspace_id AND i.plan_id=a.plan_id AND i.item_id=NEW.item_id AND json_extract(d.envelope_json,'$.payloadRedacted.action')=json_extract(i.new_value_json,'$.action'))))
 AND json_extract(d.envelope_json,'$.payloadRedacted.operationId')=NEW.operation_id
 AND json_extract(d.envelope_json,'$.payloadRedacted.operationItemId')=NEW.item_id
 AND json_extract(d.envelope_json,'$.payloadRedacted.reason') IS NEW.reason
 AND ((NEW.stage='preflight' AND json_extract(d.envelope_json,'$.payloadRedacted.stage')='preflight_refused') OR (NEW.stage='reconcile' AND json_extract(d.envelope_json,'$.payloadRedacted.stage')='reconciled' AND json_extract(d.envelope_json,'$.payloadRedacted.outcome')=NEW.outcome))))
BEGIN SELECT RAISE(ABORT,'Afternic write result requires exact signed audit'); END;

CREATE TRIGGER afternic_listing_fact_action BEFORE INSERT ON device_execution_fact_outbox
WHEN NOT EXISTS(SELECT 1 FROM afternic_listing_item_authorizations i JOIN afternic_listing_approvals a USING(workspace_id,approved_operation_id)
 JOIN workspace_device_audit_outbox d ON d.workspace_id=a.workspace_id AND d.audit_event_id=NEW.audit_event_id
 WHERE i.workspace_id=NEW.workspace_id AND i.operation_id=NEW.operation_id AND i.item_id=NEW.item_id AND i.attempt_id=NEW.attempt_id
 AND json_extract(NEW.envelope_json,'$.payloadRedacted.action')=json_extract(i.envelope_json,'$.action')
 AND json_extract(d.envelope_json,'$.payloadRedacted.action')=json_extract(i.envelope_json,'$.action')
 AND json_extract(d.envelope_json,'$.payloadRedacted.stage')='dispatch_claimed'
 AND json_extract(d.envelope_json,'$.payloadRedacted.attemptId')=NEW.attempt_id
 AND (a.action!='set_bin_price' OR (
  NEW.source_device_id=a.source_device_id AND NEW.active_lease_epoch=a.active_lease_epoch
  AND NEW.source_installation_digest=a.source_installation_digest
  AND d.source_device_id=NEW.source_device_id AND d.active_lease_epoch=NEW.active_lease_epoch
  AND d.source_installation_digest=NEW.source_installation_digest
  AND json_extract(d.envelope_json,'$.targetType')='sellerhub_bin_price_attempt'
  AND json_extract(d.envelope_json,'$.payloadRedacted.provider')='spaceship'
  AND json_extract(d.envelope_json,'$.payloadRedacted.operationId')=NEW.operation_id
  AND json_extract(d.envelope_json,'$.payloadRedacted.operationItemId')=NEW.item_id
  AND json_extract(d.envelope_json,'$.payloadRedacted.requestDigest')=i.request_digest
  AND json_extract(d.envelope_json,'$.payloadRedacted.approvalEnvelopeDigest')=i.envelope_digest
  AND json_extract(NEW.envelope_json,'$.payloadRedacted.provider')='spaceship'
  AND json_extract(NEW.envelope_json,'$.payloadRedacted.requestDigest')=i.request_digest
  AND json_extract(NEW.envelope_json,'$.payloadRedacted.approvalEnvelopeDigest')=i.envelope_digest))
 AND json_extract(NEW.envelope_json,'$.eventType')=CASE WHEN a.action='set_bin_price' THEN 'sellerhub_bin_price_dispatch_claimed'
 WHEN a.action='remove' THEN 'afternic_delist_dispatch_claimed'
 WHEN a.action IN ('create','update') THEN 'afternic_listing_write_dispatch_claimed'
 WHEN json_extract(i.envelope_json,'$.action')='reactivate_ownership_review' THEN 'afternic_ownership_review_dispatch_claimed' ELSE 'afternic_listing_plan_v2_dispatch_claimed' END)
BEGIN SELECT RAISE(ABORT,'Execution fact must match its typed approval and paired audit'); END;

CREATE TRIGGER sellerhub_bin_price_claim_guard BEFORE UPDATE OF status ON operation_attempts
WHEN OLD.status='queued' AND NEW.status='running'
 AND EXISTS(SELECT 1 FROM operation_plans p WHERE p.workspace_id=NEW.workspace_id AND p.plan_id=NEW.plan_id
   AND p.operation_kind='sellerhub_bin_price')
 AND NOT EXISTS(SELECT 1 FROM device_execution_fact_outbox f
  WHERE f.workspace_id=NEW.workspace_id AND f.operation_id=NEW.operation_id
   AND f.item_id=NEW.item_id AND f.attempt_number=NEW.attempt_number
   AND json_extract(f.envelope_json,'$.eventType')='sellerhub_bin_price_dispatch_claimed')
BEGIN SELECT RAISE(ABORT,'SellerHub running attempt requires a durable dispatch claim'); END;

CREATE TRIGGER sellerhub_bin_price_terminal_guard BEFORE UPDATE OF status ON operation_attempts
WHEN OLD.status!=NEW.status AND NEW.status!='running'
 AND EXISTS(SELECT 1 FROM operation_plans p WHERE p.workspace_id=NEW.workspace_id AND p.plan_id=NEW.plan_id
   AND p.operation_kind='sellerhub_bin_price')
 AND NOT EXISTS(
  SELECT 1 FROM workspace_device_audit_outbox d
  JOIN afternic_listing_item_authorizations i ON i.workspace_id=d.workspace_id AND i.operation_id=NEW.operation_id
    AND i.item_id=NEW.item_id AND i.attempt_number=NEW.attempt_number
  WHERE d.workspace_id=NEW.workspace_id AND json_extract(d.envelope_json,'$.targetType')='sellerhub_bin_price_attempt'
   AND json_extract(d.envelope_json,'$.payloadRedacted.action')='set_bin_price'
   AND json_extract(d.envelope_json,'$.payloadRedacted.attemptId')=i.attempt_id
   AND json_extract(d.envelope_json,'$.payloadRedacted.operationId')=i.operation_id
   AND json_extract(d.envelope_json,'$.payloadRedacted.operationItemId')=i.item_id
   AND ((OLD.status='queued' AND NEW.status='failed_final'
      AND json_extract(d.envelope_json,'$.payloadRedacted.stage')='preflight_refused'
      AND json_extract(d.envelope_json,'$.payloadRedacted.reason')=NEW.error_code)
    OR (OLD.status='running' AND NEW.status='succeeded'
      AND json_extract(d.envelope_json,'$.payloadRedacted.stage')='reconciled'
      AND json_extract(d.envelope_json,'$.payloadRedacted.outcome')='matched'
      AND EXISTS(SELECT 1 FROM device_execution_fact_outbox f
        WHERE f.workspace_id=i.workspace_id AND f.attempt_id=i.attempt_id
         AND f.execution_fact_id=json_extract(d.envelope_json,'$.payloadRedacted.originalExecutionFactId')
         AND f.envelope_digest=json_extract(d.envelope_json,'$.payloadRedacted.originalExecutionFactDigest')
         AND f.source_device_id=json_extract(d.envelope_json,'$.payloadRedacted.originalSourceDeviceId')
         AND f.active_lease_epoch=json_extract(d.envelope_json,'$.payloadRedacted.originalActiveLeaseEpoch')))))
BEGIN SELECT RAISE(ABORT,'SellerHub terminal attempt requires exact signed observation'); END;
