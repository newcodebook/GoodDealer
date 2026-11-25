-- Ownership review extends the original plan; it never grants execution authority itself.
CREATE TABLE afternic_ownership_review_items (
 workspace_id TEXT NOT NULL, plan_id TEXT NOT NULL, item_id TEXT NOT NULL,
 domain TEXT NOT NULL, connection_id TEXT NOT NULL,
 connection_incarnation_id TEXT NOT NULL, credential_generation INTEGER NOT NULL CHECK(credential_generation BETWEEN 1 AND 9007199254740991),
 credential_public_proof TEXT NOT NULL CHECK(length(credential_public_proof)=64 AND credential_public_proof NOT GLOB '*[^0-9a-f]*'),
 entity_generation INTEGER NOT NULL CHECK(entity_generation BETWEEN 1 AND 9007199254740991),
 parent_item_id TEXT, parent_request_digest TEXT,
 binding_digest TEXT, binding_generation INTEGER,
 PRIMARY KEY(workspace_id,plan_id,item_id), UNIQUE(workspace_id,plan_id,domain),
 FOREIGN KEY(workspace_id,plan_id,item_id) REFERENCES operation_plan_items(workspace_id,plan_id,item_id) ON DELETE RESTRICT,
 FOREIGN KEY(workspace_id,plan_id,parent_item_id) REFERENCES operation_plan_items(workspace_id,plan_id,item_id) ON DELETE RESTRICT,
 FOREIGN KEY(workspace_id,connection_id,credential_generation) REFERENCES afternic_connection_publications(workspace_id,connection_id,credential_generation) ON DELETE RESTRICT,
 CHECK((parent_item_id IS NULL)=(parent_request_digest IS NULL)),
 CHECK(parent_item_id IS NULL OR parent_item_id!=item_id),
 CHECK(parent_request_digest IS NULL OR (length(parent_request_digest)=64 AND parent_request_digest NOT GLOB '*[^0-9a-f]*')),
 CHECK((binding_digest IS NULL)=(binding_generation IS NULL)),
 CHECK(binding_digest IS NULL OR (length(binding_digest)=64 AND binding_digest NOT GLOB '*[^0-9a-f]*')),
 CHECK(binding_generation IS NULL OR binding_generation=credential_generation),
 CHECK(parent_item_id IS NOT NULL OR binding_digest IS NOT NULL)
) STRICT;
CREATE TRIGGER afternic_ownership_item_scope BEFORE INSERT ON afternic_ownership_review_items
WHEN NOT EXISTS(SELECT 1 FROM operation_plan_items i JOIN operation_plans p USING(workspace_id,plan_id)
 JOIN domain_assets a ON a.workspace_id=i.workspace_id AND a.entity_id=i.entity_id
 JOIN afternic_connection_publications c ON c.workspace_id=i.workspace_id AND c.connection_id=i.connection_id
 WHERE i.workspace_id=NEW.workspace_id AND i.plan_id=NEW.plan_id AND i.item_id=NEW.item_id
 AND p.operation_kind='afternic_listing_write' AND p.phase='awaiting_approval'
 AND i.entity_id=NEW.domain AND i.connection_id=NEW.connection_id
 AND i.capability='afternic:marketplace:write' AND i.risk_level='standard' AND i.execution_mode='automatic' AND i.inclusion_status='included'
 AND a.entity_generation=NEW.entity_generation AND a.lifecycle_status='active'
 AND c.credential_generation=NEW.credential_generation AND c.connection_incarnation_id=NEW.connection_incarnation_id
 AND c.credential_public_proof=NEW.credential_public_proof AND c.publication_state='active'
 AND json_extract(i.precondition_json,'$.schemaVersion')=2
 AND json_extract(i.precondition_json,'$.action')='reactivate_ownership_review'
 AND json_extract(i.new_value_json,'$.action')='reactivate_ownership_review'
 AND json_extract(i.precondition_json,'$.domain')=NEW.domain
 AND json_extract(i.precondition_json,'$.connectionId')=NEW.connection_id
 AND json_extract(i.precondition_json,'$.connectionIncarnationId')=NEW.connection_incarnation_id
 AND json_extract(i.precondition_json,'$.credentialGeneration')=NEW.credential_generation
 AND json_extract(i.precondition_json,'$.credentialPublicProof')=NEW.credential_public_proof
 AND json_extract(i.precondition_json,'$.entityGeneration')=NEW.entity_generation
 AND json_extract(i.precondition_json,'$.parentItemId') IS NEW.parent_item_id
 AND json_extract(i.precondition_json,'$.parentRequestDigest') IS NEW.parent_request_digest
 AND json_type(i.precondition_json,'$.parentItemId') IN ('null','text')
 AND json_type(i.precondition_json,'$.parentRequestDigest') IN ('null','text')
 AND json_extract(i.precondition_json,'$.bindingDigest') IS NEW.binding_digest
 AND json_extract(i.precondition_json,'$.bindingGeneration') IS NEW.binding_generation
 AND json_type(i.precondition_json,'$.bindingDigest') IN ('null','text')
 AND json_type(i.precondition_json,'$.bindingGeneration') IN ('null','integer')
 AND json_extract(i.precondition_json,'$.triggerStatus')='OWNERSHIP_REVIEW'
 AND json_extract(i.precondition_json,'$.maxDispatches')=1
 AND json_extract(i.precondition_json,'$.minimumIntervalSeconds')=86400)
 OR (NEW.parent_item_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM operation_plan_items i
 WHERE i.workspace_id=NEW.workspace_id AND i.plan_id=NEW.plan_id AND i.item_id=NEW.parent_item_id
 AND i.entity_id=NEW.domain AND i.connection_id=NEW.connection_id
 AND json_extract(i.precondition_json,'$.schemaVersion')=2
 AND json_extract(i.precondition_json,'$.action') IN ('create','update')
 AND json_extract(i.precondition_json,'$.connectionIncarnationId')=NEW.connection_incarnation_id
 AND json_extract(i.precondition_json,'$.credentialGeneration')=NEW.credential_generation
 AND json_extract(i.precondition_json,'$.entityGeneration')=NEW.entity_generation))
 OR EXISTS(SELECT 1 FROM device_handoff_barriers b WHERE b.workspace_id=NEW.workspace_id)
BEGIN SELECT RAISE(ABORT,'ownership review requires exact frozen parent scope'); END;
CREATE TRIGGER afternic_ownership_item_no_update BEFORE UPDATE ON afternic_ownership_review_items
BEGIN SELECT RAISE(ABORT,'ownership review scope is immutable'); END;
CREATE TRIGGER afternic_ownership_item_no_delete BEFORE DELETE ON afternic_ownership_review_items
BEGIN SELECT RAISE(ABORT,'ownership review scope is retained'); END;

CREATE TABLE afternic_ownership_review_claims (
 workspace_id TEXT NOT NULL, operation_id TEXT NOT NULL, plan_id TEXT NOT NULL, item_id TEXT NOT NULL,
 attempt_number INTEGER NOT NULL CHECK(attempt_number=1), attempt_id TEXT NOT NULL,
 domain TEXT NOT NULL, connection_id TEXT NOT NULL,
 resource_binding_digest TEXT NOT NULL CHECK(length(resource_binding_digest)=64 AND resource_binding_digest NOT GLOB '*[^0-9a-f]*'),
 binding_generation INTEGER NOT NULL CHECK(binding_generation BETWEEN 1 AND 9007199254740991),
 resource_binding_evidence_digest TEXT NOT NULL CHECK(length(resource_binding_evidence_digest)=43),
 preflight_observation_evidence_digest TEXT NOT NULL CHECK(length(preflight_observation_evidence_digest)=43),
 listing_observation_id TEXT NOT NULL,
 preflight_observation_digest TEXT NOT NULL CHECK(length(preflight_observation_digest)=64 AND preflight_observation_digest NOT GLOB '*[^0-9a-f]*'),
 preflight_observed_at TEXT NOT NULL,
 claimed_at TEXT NOT NULL CHECK(claimed_at IS strftime('%Y-%m-%dT%H:%M:%SZ',claimed_at)),
 retry_not_before TEXT NOT NULL CHECK(retry_not_before IS strftime('%Y-%m-%dT%H:%M:%SZ',claimed_at,'+86400 seconds')),
 execution_fact_id TEXT NOT NULL, audit_event_id TEXT NOT NULL,
 PRIMARY KEY(workspace_id,operation_id,item_id), UNIQUE(workspace_id,attempt_id),
 FOREIGN KEY(workspace_id,plan_id,item_id) REFERENCES afternic_ownership_review_items(workspace_id,plan_id,item_id) ON DELETE RESTRICT,
 FOREIGN KEY(workspace_id,operation_id,plan_id,item_id,attempt_number) REFERENCES operation_attempts(workspace_id,operation_id,plan_id,item_id,attempt_number) ON DELETE RESTRICT,
 FOREIGN KEY(workspace_id,execution_fact_id) REFERENCES device_execution_fact_outbox(workspace_id,execution_fact_id) ON DELETE RESTRICT,
 FOREIGN KEY(workspace_id,audit_event_id) REFERENCES workspace_device_audit_outbox(workspace_id,audit_event_id) ON DELETE RESTRICT,
 FOREIGN KEY(workspace_id,listing_observation_id) REFERENCES marketplace_listing_observations(workspace_id,listing_observation_id) ON DELETE RESTRICT,
 CHECK(preflight_observed_at IS strftime('%Y-%m-%dT%H:%M:%SZ',preflight_observed_at)),
 CHECK(preflight_observed_at<=claimed_at AND claimed_at<=strftime('%Y-%m-%dT%H:%M:%SZ',preflight_observed_at,'+30 seconds'))
) STRICT;
CREATE INDEX afternic_ownership_claims_by_domain ON afternic_ownership_review_claims(workspace_id,domain,claimed_at);

CREATE TABLE afternic_ownership_review_reconciliations (
 workspace_id TEXT NOT NULL, operation_id TEXT NOT NULL, plan_id TEXT NOT NULL, item_id TEXT NOT NULL,
 attempt_number INTEGER NOT NULL CHECK(attempt_number=1), sequence INTEGER NOT NULL CHECK(sequence BETWEEN 1 AND 9007199254740991),
 outcome TEXT NOT NULL CHECK(outcome IN ('confirmed','still_review','read_failed','conflict')),
 reason TEXT CHECK(reason IN ('postcondition_pending','read_failed','precondition_changed','connection_changed','provider_state_blocked')),
 observed_at TEXT NOT NULL CHECK(observed_at IS strftime('%Y-%m-%dT%H:%M:%SZ',observed_at)), next_read_at TEXT,
 listing_observation_id TEXT, audit_event_id TEXT NOT NULL,
 PRIMARY KEY(workspace_id,operation_id,item_id,sequence),
 FOREIGN KEY(workspace_id,operation_id,item_id) REFERENCES afternic_ownership_review_claims(workspace_id,operation_id,item_id) ON DELETE RESTRICT,
 FOREIGN KEY(workspace_id,operation_id,plan_id,item_id,attempt_number) REFERENCES operation_attempts(workspace_id,operation_id,plan_id,item_id,attempt_number) ON DELETE RESTRICT,
 FOREIGN KEY(workspace_id,listing_observation_id) REFERENCES marketplace_listing_observations(workspace_id,listing_observation_id) ON DELETE RESTRICT,
 FOREIGN KEY(workspace_id,audit_event_id) REFERENCES workspace_device_audit_outbox(workspace_id,audit_event_id) ON DELETE RESTRICT,
 CHECK((outcome='confirmed' AND reason IS NULL AND listing_observation_id IS NOT NULL)
 OR (outcome='still_review' AND reason='postcondition_pending' AND listing_observation_id IS NOT NULL)
 OR (outcome='read_failed' AND reason='read_failed' AND listing_observation_id IS NULL)
 OR (outcome='conflict' AND reason IN ('precondition_changed','connection_changed','provider_state_blocked'))),
 CHECK((outcome IN ('confirmed','conflict'))=(next_read_at IS NULL)),
 CHECK(next_read_at IS NULL OR (next_read_at IS strftime('%Y-%m-%dT%H:%M:%SZ',next_read_at) AND next_read_at>observed_at))
) STRICT;

CREATE TRIGGER afternic_ownership_claim_scope BEFORE INSERT ON afternic_ownership_review_claims
WHEN NOT EXISTS(SELECT 1 FROM afternic_ownership_review_items i
 JOIN operation_attempts a ON a.workspace_id=i.workspace_id AND a.plan_id=i.plan_id AND a.item_id=i.item_id
 JOIN operation_plans p ON p.workspace_id=i.workspace_id AND p.plan_id=i.plan_id
 JOIN operations o ON o.workspace_id=a.workspace_id AND o.operation_id=a.operation_id AND o.plan_id=a.plan_id
 JOIN domain_assets d ON d.workspace_id=i.workspace_id AND d.entity_id=i.domain
 JOIN local_provider_connections c ON c.workspace_id=i.workspace_id AND c.connection_id=i.connection_id
 JOIN afternic_connection_publications k ON k.workspace_id=i.workspace_id AND k.connection_id=i.connection_id AND k.credential_generation=i.credential_generation
 JOIN domain_asset_provider_bindings b ON b.workspace_id=i.workspace_id AND b.entity_id=i.domain AND b.connection_id=i.connection_id
 JOIN marketplace_listing_observations m ON m.workspace_id=b.workspace_id AND m.entity_id=b.entity_id AND m.binding_connection_id=b.connection_id AND m.binding_resource_digest=b.resource_binding_digest AND m.binding_generation=b.binding_generation
 JOIN afternic_listing_details l ON l.workspace_id=m.workspace_id AND l.listing_observation_id=m.listing_observation_id
 JOIN provider_observation_runs r ON r.workspace_id=m.workspace_id AND r.observation_run_id=m.observation_run_id
 WHERE i.workspace_id=NEW.workspace_id AND i.plan_id=NEW.plan_id AND i.item_id=NEW.item_id
 AND i.domain=NEW.domain AND i.connection_id=NEW.connection_id
 AND a.operation_id=NEW.operation_id AND a.attempt_number=1 AND a.status='queued' AND p.phase='executing' AND o.phase='running'
 AND d.entity_generation=i.entity_generation AND d.lifecycle_status='active'
 AND c.connection_incarnation_id=i.connection_incarnation_id AND c.lifecycle_status='active' AND c.credential_use_state='active' AND c.validation_status='valid' AND c.revoked_at IS NULL AND c.deleted_at IS NULL
 AND k.connection_incarnation_id=i.connection_incarnation_id AND k.credential_public_proof=i.credential_public_proof AND k.publication_state='active'
 AND b.resource_kind='listing' AND b.resource_binding_digest=NEW.resource_binding_digest AND b.binding_generation=NEW.binding_generation
 AND b.binding_generation=i.credential_generation AND b.validation_status IN ('verified','unverified')
 AND (i.binding_digest IS NULL OR i.binding_digest=b.resource_binding_digest)
 AND m.listing_observation_id=NEW.listing_observation_id AND m.observed_at=NEW.preflight_observed_at
 AND m.provider_version_token=NEW.preflight_observation_digest AND m.provider_version_token=b.observation_digest
 AND m.confirmed=1 AND m.observation_availability='available' AND m.evidence_status='confirmed'
 AND l.provider_status='OWNERSHIP_REVIEW' AND r.connection_id=i.connection_id AND r.status='succeeded'
 AND NOT EXISTS(SELECT 1 FROM sync_domain_asset_provisional_re_adds x WHERE x.workspace_id=i.workspace_id AND x.entity_id=i.domain)
 AND (i.parent_item_id IS NULL OR EXISTS(SELECT 1 FROM operation_attempts parent
 JOIN afternic_listing_write_reconciliations pr ON pr.workspace_id=parent.workspace_id AND pr.operation_id=parent.operation_id AND pr.item_id=parent.item_id
 JOIN marketplace_listing_observations pm ON pm.workspace_id=pr.workspace_id AND pm.listing_observation_id=pr.listing_observation_id
 JOIN afternic_listing_details pd ON pd.workspace_id=pm.workspace_id AND pd.listing_observation_id=pm.listing_observation_id
 WHERE parent.workspace_id=i.workspace_id AND parent.plan_id=i.plan_id AND parent.operation_id=a.operation_id AND parent.item_id=i.parent_item_id
 AND parent.request_digest=i.parent_request_digest AND pr.stage='reconcile' AND pr.fields_matched=1
 AND pr.sequence=(SELECT max(n.sequence) FROM afternic_listing_write_reconciliations n WHERE n.workspace_id=pr.workspace_id AND n.operation_id=pr.operation_id AND n.item_id=pr.item_id)
 AND pm.entity_id=i.domain AND pm.binding_connection_id=i.connection_id AND pm.binding_resource_digest=b.resource_binding_digest AND pm.binding_generation=b.binding_generation
 AND pd.provider_created_at=l.provider_created_at)))
 OR EXISTS(SELECT 1 FROM device_handoff_barriers b WHERE b.workspace_id=NEW.workspace_id)
 OR EXISTS(SELECT 1 FROM afternic_controlled_acceptance_runs r JOIN afternic_ownership_review_items i ON i.workspace_id=r.workspace_id AND i.connection_id=r.connection_id AND i.connection_incarnation_id=r.connection_incarnation_id AND i.credential_generation=r.credential_generation WHERE r.workspace_id=NEW.workspace_id AND i.plan_id=NEW.plan_id AND i.item_id=NEW.item_id)
BEGIN SELECT RAISE(ABORT,'ownership review claim requires fresh exact binding and parent'); END;

CREATE TRIGGER afternic_ownership_claim_evidence BEFORE INSERT ON afternic_ownership_review_claims
WHEN NOT EXISTS(SELECT 1 FROM device_execution_fact_outbox f JOIN workspace_device_audit_outbox a USING(workspace_id,audit_event_id)
 JOIN afternic_listing_item_authorizations i ON i.workspace_id=f.workspace_id AND i.operation_id=f.operation_id AND i.item_id=f.item_id AND i.attempt_id=f.attempt_id
 WHERE f.workspace_id=NEW.workspace_id AND f.execution_fact_id=NEW.execution_fact_id AND f.operation_id=NEW.operation_id AND f.item_id=NEW.item_id
 AND f.attempt_id=NEW.attempt_id AND f.audit_event_id=NEW.audit_event_id AND i.plan_id=NEW.plan_id
 AND json_extract(i.envelope_json,'$.typ')='gd.afternic-ownership-review-item-approval.v1'
 AND json_extract(i.envelope_json,'$.action')='reactivate_ownership_review'
 AND json_extract(f.envelope_json,'$.eventType')='afternic_ownership_review_dispatch_claimed'
 AND json_extract(f.envelope_json,'$.occurredAt')=NEW.claimed_at
 AND json_extract(f.envelope_json,'$.payloadRedacted.action')='reactivate_ownership_review'
 AND json_extract(f.envelope_json,'$.payloadRedacted.resourceBindingDigest')=NEW.resource_binding_evidence_digest
 AND json_extract(a.envelope_json,'$.payloadRedacted.resourceBindingDigest')=NEW.resource_binding_evidence_digest
 AND json_extract(f.envelope_json,'$.payloadRedacted.preflightObservationDigest')=NEW.preflight_observation_evidence_digest
 AND json_extract(a.envelope_json,'$.payloadRedacted.preflightObservationDigest')=NEW.preflight_observation_evidence_digest
 AND json_extract(a.envelope_json,'$.targetType')='afternic_ownership_review_attempt'
 AND json_extract(a.envelope_json,'$.targetRef')=NEW.attempt_id
 AND json_extract(a.envelope_json,'$.payloadRedacted.stage')='dispatch_claimed'
 AND json_extract(a.envelope_json,'$.payloadRedacted.action')='reactivate_ownership_review')
BEGIN SELECT RAISE(ABORT,'ownership review requires its purpose-separated paired claim'); END;
CREATE TRIGGER afternic_ownership_claim_cooldown BEFORE INSERT ON afternic_ownership_review_claims
WHEN EXISTS(SELECT 1 FROM afternic_ownership_review_claims old WHERE old.workspace_id=NEW.workspace_id AND old.domain=NEW.domain
 AND (NEW.claimed_at<old.retry_not_before OR NOT EXISTS(SELECT 1 FROM afternic_ownership_review_reconciliations r
 WHERE r.workspace_id=old.workspace_id AND r.operation_id=old.operation_id AND r.item_id=old.item_id AND r.outcome='confirmed')))
BEGIN SELECT RAISE(ABORT,'ownership review cooldown or unresolved claim blocks another submission'); END;
CREATE TRIGGER afternic_ownership_claim_no_update BEFORE UPDATE ON afternic_ownership_review_claims
BEGIN SELECT RAISE(ABORT,'ownership review claim is immutable'); END;
CREATE TRIGGER afternic_ownership_claim_no_delete BEFORE DELETE ON afternic_ownership_review_claims
BEGIN SELECT RAISE(ABORT,'ownership review claim is retained'); END;
CREATE TRIGGER afternic_ownership_dispatch_requires_claim BEFORE UPDATE OF status ON operation_attempts
WHEN OLD.status='queued' AND NEW.status='running' AND EXISTS(SELECT 1 FROM afternic_ownership_review_items i WHERE i.workspace_id=OLD.workspace_id AND i.plan_id=OLD.plan_id AND i.item_id=OLD.item_id)
 AND NOT EXISTS(SELECT 1 FROM afternic_ownership_review_claims c WHERE c.workspace_id=OLD.workspace_id AND c.operation_id=OLD.operation_id AND c.item_id=OLD.item_id)
BEGIN SELECT RAISE(ABORT,'ownership review dispatch requires its retained claim'); END;

CREATE TRIGGER afternic_ownership_reconciliation_scope BEFORE INSERT ON afternic_ownership_review_reconciliations
WHEN NOT EXISTS(SELECT 1 FROM afternic_ownership_review_claims c JOIN operation_attempts a USING(workspace_id,operation_id,item_id)
 JOIN operation_plans p ON p.workspace_id=c.workspace_id AND p.plan_id=c.plan_id
 JOIN workspace_device_audit_outbox d ON d.workspace_id=c.workspace_id AND d.audit_event_id=NEW.audit_event_id
 JOIN device_execution_fact_outbox f ON f.workspace_id=c.workspace_id AND f.execution_fact_id=c.execution_fact_id
 WHERE c.workspace_id=NEW.workspace_id AND c.operation_id=NEW.operation_id AND c.plan_id=NEW.plan_id AND c.item_id=NEW.item_id
 AND a.status IN ('running','outcome_unknown','succeeded') AND p.phase='executing' AND NEW.observed_at>=c.claimed_at
 AND json_extract(d.envelope_json,'$.targetType')='afternic_ownership_review_attempt'
 AND json_extract(d.envelope_json,'$.targetRef')=c.attempt_id
 AND json_extract(d.envelope_json,'$.payloadRedacted.action')='reactivate_ownership_review'
 AND json_extract(d.envelope_json,'$.payloadRedacted.stage')='reconciled'
 AND json_extract(d.envelope_json,'$.payloadRedacted.operationId')=c.operation_id
 AND json_extract(d.envelope_json,'$.payloadRedacted.operationItemId')=c.item_id
 AND json_extract(d.envelope_json,'$.payloadRedacted.originalExecutionFactId')=c.execution_fact_id
 AND json_extract(d.envelope_json,'$.payloadRedacted.originalExecutionFactDigest')=f.envelope_digest
 AND json_extract(d.envelope_json,'$.payloadRedacted.outcome')=NEW.outcome
 AND json_extract(d.envelope_json,'$.payloadRedacted.reason') IS NEW.reason)
 OR NEW.sequence!=(SELECT count(*)+1 FROM afternic_ownership_review_reconciliations r WHERE r.workspace_id=NEW.workspace_id AND r.operation_id=NEW.operation_id AND r.item_id=NEW.item_id)
 OR EXISTS(SELECT 1 FROM afternic_ownership_review_reconciliations r WHERE r.workspace_id=NEW.workspace_id AND r.operation_id=NEW.operation_id AND r.item_id=NEW.item_id AND r.outcome IN ('confirmed','conflict'))
 OR EXISTS(SELECT 1 FROM device_handoff_barriers b WHERE b.workspace_id=NEW.workspace_id)
BEGIN SELECT RAISE(ABORT,'ownership review reconciliation requires exact retained claim and signed audit'); END;
CREATE TRIGGER afternic_ownership_reconciliation_observation BEFORE INSERT ON afternic_ownership_review_reconciliations
WHEN NEW.listing_observation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM afternic_ownership_review_claims c
 JOIN marketplace_listing_observations m ON m.workspace_id=c.workspace_id AND m.listing_observation_id=NEW.listing_observation_id
 JOIN afternic_listing_details d ON d.workspace_id=m.workspace_id AND d.listing_observation_id=m.listing_observation_id
 JOIN provider_observation_runs r ON r.workspace_id=m.workspace_id AND r.observation_run_id=m.observation_run_id
 WHERE c.workspace_id=NEW.workspace_id AND c.operation_id=NEW.operation_id AND c.item_id=NEW.item_id
 AND m.entity_id=c.domain AND m.binding_connection_id=c.connection_id AND m.binding_resource_digest=c.resource_binding_digest AND m.binding_generation=c.binding_generation
 AND m.observed_at=NEW.observed_at AND m.confirmed=1 AND m.observation_availability='available' AND m.evidence_status='confirmed'
 AND r.connection_id=c.connection_id AND r.status='succeeded'
 AND ((NEW.outcome='confirmed' AND d.provider_status IN ('ACTIVE','HIDDEN')) OR (NEW.outcome='still_review' AND d.provider_status='OWNERSHIP_REVIEW') OR NEW.outcome='conflict'))
BEGIN SELECT RAISE(ABORT,'ownership review observation must match its original resource'); END;
CREATE TRIGGER afternic_ownership_reconciliation_no_update BEFORE UPDATE ON afternic_ownership_review_reconciliations
BEGIN SELECT RAISE(ABORT,'ownership review results are immutable'); END;
CREATE TRIGGER afternic_ownership_reconciliation_no_delete BEFORE DELETE ON afternic_ownership_review_reconciliations
BEGIN SELECT RAISE(ABORT,'ownership review results are retained'); END;

-- No-action and refusal observations have an approved item, but no dispatch claim to invent.
CREATE TABLE afternic_ownership_review_preflights (
 workspace_id TEXT NOT NULL, operation_id TEXT NOT NULL, plan_id TEXT NOT NULL, item_id TEXT NOT NULL,
 attempt_number INTEGER NOT NULL CHECK(attempt_number=1), sequence INTEGER NOT NULL CHECK(sequence BETWEEN 1 AND 9007199254740991),
 outcome TEXT NOT NULL CHECK(outcome IN ('satisfied','refused','read_failed')),
 reason TEXT CHECK(reason IN ('precondition_changed','connection_changed','listing_absent','provider_state_blocked','cooldown','prior_outcome_unknown','read_failed')),
 observed_at TEXT NOT NULL CHECK(observed_at IS strftime('%Y-%m-%dT%H:%M:%SZ',observed_at)), next_read_at TEXT,
 listing_observation_id TEXT, audit_event_id TEXT,
 PRIMARY KEY(workspace_id,operation_id,item_id,sequence),
 FOREIGN KEY(workspace_id,plan_id,item_id) REFERENCES afternic_ownership_review_items(workspace_id,plan_id,item_id) ON DELETE RESTRICT,
 FOREIGN KEY(workspace_id,operation_id,plan_id,item_id,attempt_number) REFERENCES operation_attempts(workspace_id,operation_id,plan_id,item_id,attempt_number) ON DELETE RESTRICT,
 FOREIGN KEY(workspace_id,listing_observation_id) REFERENCES marketplace_listing_observations(workspace_id,listing_observation_id) ON DELETE RESTRICT,
 FOREIGN KEY(workspace_id,audit_event_id) REFERENCES workspace_device_audit_outbox(workspace_id,audit_event_id) ON DELETE RESTRICT,
 CHECK((outcome='satisfied' AND reason IS NULL AND listing_observation_id IS NOT NULL AND audit_event_id IS NOT NULL)
 OR (outcome='refused' AND reason IN ('precondition_changed','connection_changed','listing_absent','provider_state_blocked','cooldown','prior_outcome_unknown') AND audit_event_id IS NOT NULL)
 OR (outcome='read_failed' AND reason='read_failed' AND listing_observation_id IS NULL AND audit_event_id IS NULL)),
 CHECK((outcome='read_failed')=(next_read_at IS NOT NULL)),
 CHECK(next_read_at IS NULL OR (next_read_at IS strftime('%Y-%m-%dT%H:%M:%SZ',next_read_at) AND next_read_at>observed_at))
) STRICT;
CREATE TRIGGER afternic_ownership_preflight_scope BEFORE INSERT ON afternic_ownership_review_preflights
WHEN NOT EXISTS(SELECT 1 FROM operation_attempts a JOIN operation_plans p USING(workspace_id,plan_id)
 JOIN afternic_listing_item_authorizations i ON i.workspace_id=a.workspace_id AND i.operation_id=a.operation_id AND i.item_id=a.item_id
 WHERE a.workspace_id=NEW.workspace_id AND a.operation_id=NEW.operation_id AND a.plan_id=NEW.plan_id AND a.item_id=NEW.item_id AND a.attempt_number=1
 AND p.phase='executing' AND a.status IN ('queued','failed_final','succeeded')
 AND json_extract(i.envelope_json,'$.typ')='gd.afternic-ownership-review-item-approval.v1'
 AND (NEW.outcome='read_failed' OR EXISTS(SELECT 1 FROM workspace_device_audit_outbox d
 WHERE d.workspace_id=i.workspace_id AND d.audit_event_id=NEW.audit_event_id
 AND json_extract(d.envelope_json,'$.targetType')='afternic_ownership_review_attempt'
 AND json_extract(d.envelope_json,'$.targetRef')=i.attempt_id
 AND json_extract(d.envelope_json,'$.payloadRedacted.action')='reactivate_ownership_review'
 AND json_extract(d.envelope_json,'$.payloadRedacted.operationId')=NEW.operation_id
 AND json_extract(d.envelope_json,'$.payloadRedacted.operationItemId')=NEW.item_id
 AND json_extract(d.envelope_json,'$.payloadRedacted.approvalEnvelopeDigest')=i.envelope_digest
 AND ((NEW.outcome='satisfied' AND json_extract(d.envelope_json,'$.payloadRedacted.stage')='preflight_satisfied' AND json_type(d.envelope_json,'$.payloadRedacted.reason') IS NULL)
 OR (NEW.outcome='refused' AND json_extract(d.envelope_json,'$.payloadRedacted.stage')='preflight_refused' AND json_extract(d.envelope_json,'$.payloadRedacted.reason')=NEW.reason)))))
 OR EXISTS(SELECT 1 FROM device_execution_fact_outbox f WHERE f.workspace_id=NEW.workspace_id AND f.operation_id=NEW.operation_id AND f.item_id=NEW.item_id)
 OR EXISTS(SELECT 1 FROM afternic_ownership_review_preflights r WHERE r.workspace_id=NEW.workspace_id AND r.operation_id=NEW.operation_id AND r.item_id=NEW.item_id AND r.outcome IN ('satisfied','refused'))
 OR NEW.sequence!=(SELECT count(*)+1 FROM afternic_ownership_review_preflights r WHERE r.workspace_id=NEW.workspace_id AND r.operation_id=NEW.operation_id AND r.item_id=NEW.item_id)
 OR EXISTS(SELECT 1 FROM device_handoff_barriers b WHERE b.workspace_id=NEW.workspace_id)
BEGIN SELECT RAISE(ABORT,'ownership review preflight requires unclaimed exact approved scope'); END;
CREATE TRIGGER afternic_ownership_preflight_observation BEFORE INSERT ON afternic_ownership_review_preflights
WHEN NEW.listing_observation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM afternic_ownership_review_items i
 JOIN marketplace_listing_observations m ON m.workspace_id=i.workspace_id AND m.entity_id=i.domain AND m.binding_connection_id=i.connection_id
 JOIN afternic_listing_details d ON d.workspace_id=m.workspace_id AND d.listing_observation_id=m.listing_observation_id
 JOIN provider_observation_runs r ON r.workspace_id=m.workspace_id AND r.observation_run_id=m.observation_run_id
 WHERE i.workspace_id=NEW.workspace_id AND i.plan_id=NEW.plan_id AND i.item_id=NEW.item_id
 AND m.listing_observation_id=NEW.listing_observation_id AND m.observed_at=NEW.observed_at AND m.binding_generation=i.credential_generation
 AND (i.binding_digest IS NULL OR i.binding_digest=m.binding_resource_digest)
 AND m.confirmed=1 AND m.observation_availability='available' AND m.evidence_status='confirmed'
 AND r.connection_id=i.connection_id AND r.status='succeeded'
 AND (NEW.outcome!='satisfied' OR (d.provider_status IN ('ACTIVE','HIDDEN') AND (d.provider_status!='HIDDEN' OR d.hidden=1))))
BEGIN SELECT RAISE(ABORT,'ownership preflight requires its own authenticated observation'); END;
CREATE TRIGGER afternic_ownership_preflight_no_update BEFORE UPDATE ON afternic_ownership_review_preflights
BEGIN SELECT RAISE(ABORT,'ownership review preflights are immutable'); END;
CREATE TRIGGER afternic_ownership_preflight_no_delete BEFORE DELETE ON afternic_ownership_review_preflights
BEGIN SELECT RAISE(ABORT,'ownership review preflights are retained'); END;
CREATE TRIGGER afternic_ownership_claim_after_preflight BEFORE INSERT ON afternic_ownership_review_claims
WHEN EXISTS(SELECT 1 FROM afternic_ownership_review_preflights r WHERE r.workspace_id=NEW.workspace_id AND r.operation_id=NEW.operation_id AND r.item_id=NEW.item_id AND r.outcome IN ('satisfied','refused'))
BEGIN SELECT RAISE(ABORT,'resolved ownership preflight cannot dispatch'); END;
CREATE TRIGGER afternic_ownership_plan_item_identity BEFORE UPDATE ON operation_plan_items
WHEN EXISTS(SELECT 1 FROM afternic_ownership_review_items r WHERE r.workspace_id=OLD.workspace_id AND r.plan_id=OLD.plan_id AND (r.item_id=OLD.item_id OR r.parent_item_id=OLD.item_id))
 AND (NEW.workspace_id IS NOT OLD.workspace_id OR NEW.plan_id IS NOT OLD.plan_id OR NEW.item_id IS NOT OLD.item_id
 OR NEW.entity_id IS NOT OLD.entity_id OR NEW.connection_id IS NOT OLD.connection_id OR NEW.precondition_json IS NOT OLD.precondition_json
 OR NEW.new_value_json IS NOT OLD.new_value_json OR NEW.old_value_json IS NOT OLD.old_value_json OR NEW.capability IS NOT OLD.capability
 OR NEW.execution_mode IS NOT OLD.execution_mode OR NEW.inclusion_status IS NOT OLD.inclusion_status OR NEW.risk_level IS NOT OLD.risk_level)
BEGIN SELECT RAISE(ABORT,'ownership parent and child are frozen together'); END;

-- Preserve old approval bytes while extending only the v2 parent batch discriminator.
DROP TRIGGER afternic_listing_approval_action;
DROP TRIGGER afternic_listing_authorization_action;
DROP TRIGGER afternic_listing_fact_action;
DROP TRIGGER afternic_listing_write_reconciliation_audit;
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
 action TEXT NOT NULL CHECK(action IN ('remove','create','update','listing_plan_v2')),
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

CREATE TRIGGER afternic_listing_approval_action BEFORE INSERT ON afternic_listing_approvals
WHEN NOT EXISTS(SELECT 1 FROM operation_plans p JOIN workspace_device_audit_outbox a ON a.workspace_id=p.workspace_id AND a.audit_event_id=NEW.audit_event_id
 WHERE p.workspace_id=NEW.workspace_id AND p.plan_id=NEW.plan_id
 AND json_extract(a.envelope_json,'$.payloadRedacted.action')=NEW.action
 AND ((NEW.action='remove' AND p.operation_kind='afternic_delist') OR (NEW.action IN ('create','update') AND p.operation_kind='afternic_listing_write')
 OR (NEW.action='listing_plan_v2' AND p.operation_kind='afternic_listing_write' AND p.item_count=NEW.target_count
 AND json_extract(a.envelope_json,'$.targetType')='afternic_listing_plan_v2_approval'
 AND json_extract(a.envelope_json,'$.payloadRedacted.schemaVersion')=2)))
 OR (NEW.action!='listing_plan_v2' AND EXISTS(SELECT 1 FROM operation_plan_items i WHERE i.workspace_id=NEW.workspace_id AND i.plan_id=NEW.plan_id AND json_extract(i.new_value_json,'$.action') IS NOT NEW.action))
 OR (NEW.action='listing_plan_v2' AND (EXISTS(SELECT 1 FROM operation_plan_items i WHERE i.workspace_id=NEW.workspace_id AND i.plan_id=NEW.plan_id AND
 (json_extract(i.precondition_json,'$.schemaVersion') IS NOT 2 OR (json_extract(i.new_value_json,'$.action') IN ('create','update','reactivate_ownership_review')) IS NOT TRUE
 OR i.entity_id IS NULL OR i.connection_id IS NULL))
 OR (SELECT count(DISTINCT entity_id) FROM operation_plan_items WHERE workspace_id=NEW.workspace_id AND plan_id=NEW.plan_id)>500
 OR (SELECT count(DISTINCT connection_id) FROM operation_plan_items WHERE workspace_id=NEW.workspace_id AND plan_id=NEW.plan_id)!=1))
 OR (NEW.action='listing_plan_v2' AND EXISTS(SELECT 1 FROM afternic_controlled_acceptance_runs r JOIN operation_plan_items i ON i.workspace_id=r.workspace_id AND i.connection_id=r.connection_id WHERE i.workspace_id=NEW.workspace_id AND i.plan_id=NEW.plan_id AND json_extract(i.precondition_json,'$.connectionIncarnationId')=r.connection_incarnation_id AND json_extract(i.precondition_json,'$.credentialGeneration')=r.credential_generation))
BEGIN SELECT RAISE(ABORT,'Afternic approval action must match its exact targets and audit'); END;
CREATE TRIGGER afternic_listing_authorization_action BEFORE INSERT ON afternic_listing_item_authorizations
WHEN NOT EXISTS(SELECT 1 FROM afternic_listing_approvals a JOIN operation_plan_items p ON p.workspace_id=a.workspace_id AND p.plan_id=a.plan_id AND p.item_id=NEW.item_id
 WHERE a.workspace_id=NEW.workspace_id AND a.approved_operation_id=NEW.approved_operation_id AND a.operation_id=NEW.operation_id AND a.plan_id=NEW.plan_id
 AND ((a.action!='listing_plan_v2' AND json_extract(NEW.envelope_json,'$.action')=a.action
 AND json_extract(NEW.envelope_json,'$.typ')=CASE a.action WHEN 'remove' THEN 'gd.afternic-delist-item-approval.v1' ELSE 'gd.afternic-listing-write-item-approval.v1' END)
 OR (a.action='listing_plan_v2' AND json_extract(NEW.envelope_json,'$.action')=json_extract(p.new_value_json,'$.action')
 AND json_extract(NEW.envelope_json,'$.targetCount')=a.target_count AND json_extract(NEW.envelope_json,'$.targetSetDigest')=a.target_set_digest
 AND ((json_extract(NEW.envelope_json,'$.action') IN ('create','update') AND json_extract(NEW.envelope_json,'$.typ')='gd.afternic-listing-plan-item-approval.v2' AND json_extract(NEW.envelope_json,'$.schemaVersion')=2
 AND json_type(NEW.envelope_json,'$.parentItemId')='null' AND json_type(NEW.envelope_json,'$.parentRequestDigest')='null')
 OR (json_extract(NEW.envelope_json,'$.action')='reactivate_ownership_review' AND json_extract(NEW.envelope_json,'$.typ')='gd.afternic-ownership-review-item-approval.v1' AND json_extract(NEW.envelope_json,'$.schemaVersion')=1
 AND EXISTS(SELECT 1 FROM afternic_ownership_review_items r WHERE r.workspace_id=NEW.workspace_id AND r.plan_id=NEW.plan_id AND r.item_id=NEW.item_id
 AND json_extract(NEW.envelope_json,'$.parentItemId') IS r.parent_item_id
 AND json_type(NEW.envelope_json,'$.parentItemId') IN ('null','text') AND json_type(NEW.envelope_json,'$.parentRequestDigest') IN ('null','text')
 AND ((r.parent_item_id IS NULL AND json_type(NEW.envelope_json,'$.parentRequestDigest')='null') OR EXISTS(SELECT 1 FROM afternic_listing_item_authorizations parent JOIN operation_attempts pa ON pa.workspace_id=parent.workspace_id AND pa.operation_id=parent.operation_id AND pa.item_id=parent.item_id WHERE parent.workspace_id=NEW.workspace_id AND parent.operation_id=NEW.operation_id AND parent.plan_id=NEW.plan_id AND parent.item_id=r.parent_item_id AND parent.request_digest=json_extract(NEW.envelope_json,'$.parentRequestDigest') AND pa.request_digest=r.parent_request_digest AND json_extract(parent.envelope_json,'$.action') IN ('create','update')))))))))
BEGIN SELECT RAISE(ABORT,'Afternic authorization must match the exact typed item'); END;
CREATE TRIGGER afternic_listing_fact_action BEFORE INSERT ON device_execution_fact_outbox
WHEN NOT EXISTS(SELECT 1 FROM afternic_listing_item_authorizations i JOIN afternic_listing_approvals a USING(workspace_id,approved_operation_id)
 JOIN workspace_device_audit_outbox d ON d.workspace_id=a.workspace_id AND d.audit_event_id=NEW.audit_event_id
 WHERE i.workspace_id=NEW.workspace_id AND i.operation_id=NEW.operation_id AND i.item_id=NEW.item_id AND i.attempt_id=NEW.attempt_id
 AND json_extract(NEW.envelope_json,'$.payloadRedacted.action')=json_extract(i.envelope_json,'$.action')
 AND json_extract(d.envelope_json,'$.payloadRedacted.action')=json_extract(i.envelope_json,'$.action')
 AND json_extract(d.envelope_json,'$.payloadRedacted.stage')='dispatch_claimed'
 AND json_extract(d.envelope_json,'$.payloadRedacted.attemptId')=NEW.attempt_id
 AND json_extract(NEW.envelope_json,'$.eventType')=CASE WHEN a.action='remove' THEN 'afternic_delist_dispatch_claimed'
 WHEN a.action IN ('create','update') THEN 'afternic_listing_write_dispatch_claimed'
 WHEN json_extract(i.envelope_json,'$.action')='reactivate_ownership_review' THEN 'afternic_ownership_review_dispatch_claimed' ELSE 'afternic_listing_plan_v2_dispatch_claimed' END)
BEGIN SELECT RAISE(ABORT,'Afternic fact must match its typed approval and paired audit'); END;
DROP TRIGGER afternic_listing_write_attempt_scope;
CREATE TRIGGER afternic_listing_write_attempt_scope BEFORE INSERT ON operation_attempts
WHEN EXISTS(SELECT 1 FROM operation_plans p WHERE p.workspace_id=NEW.workspace_id AND p.plan_id=NEW.plan_id AND p.operation_kind='afternic_listing_write')
 AND (NEW.attempt_number!=1 OR NEW.status!='queued' OR NOT EXISTS(SELECT 1 FROM operation_plan_items i WHERE i.workspace_id=NEW.workspace_id AND i.plan_id=NEW.plan_id AND i.item_id=NEW.item_id
 AND i.capability='afternic:marketplace:write' AND i.execution_mode='automatic' AND i.inclusion_status='included'
 AND i.risk_level='standard' AND i.entity_id IS NOT NULL AND i.connection_id IS NOT NULL
 AND (json_extract(i.new_value_json,'$.action') IN ('create','update') OR (json_extract(i.new_value_json,'$.action')='reactivate_ownership_review'
 AND EXISTS(SELECT 1 FROM afternic_ownership_review_items r WHERE r.workspace_id=i.workspace_id AND r.plan_id=i.plan_id AND r.item_id=i.item_id)))))
BEGIN SELECT RAISE(ABORT,'Afternic attempt must be the approved single typed action'); END;

DROP VIEW afternic_listing_write_effective_attempts;
CREATE VIEW afternic_listing_write_effective_attempts AS SELECT a.*,CASE
 WHEN EXISTS(SELECT 1 FROM afternic_ownership_review_items i WHERE i.workspace_id=a.workspace_id AND i.plan_id=a.plan_id AND i.item_id=a.item_id)
 THEN CASE coalesce((SELECT r.outcome FROM afternic_ownership_review_reconciliations r WHERE r.workspace_id=a.workspace_id AND r.operation_id=a.operation_id AND r.item_id=a.item_id ORDER BY r.sequence DESC LIMIT 1),(SELECT f.outcome FROM afternic_ownership_review_preflights f WHERE f.workspace_id=a.workspace_id AND f.operation_id=a.operation_id AND f.item_id=a.item_id ORDER BY f.sequence DESC LIMIT 1)) WHEN 'confirmed' THEN 'succeeded' WHEN 'satisfied' THEN 'succeeded' WHEN 'conflict' THEN 'failed_final' WHEN 'refused' THEN 'failed_final' ELSE a.status END
 ELSE CASE (SELECT r.item_state FROM afternic_listing_write_reconciliations r WHERE r.workspace_id=a.workspace_id AND r.operation_id=a.operation_id AND r.item_id=a.item_id ORDER BY r.sequence DESC LIMIT 1) WHEN 'applied' THEN 'succeeded' WHEN 'conflict' THEN 'failed_final' ELSE a.status END
 END AS effective_status FROM operation_attempts a JOIN operation_plans p USING(workspace_id,plan_id) WHERE p.operation_kind='afternic_listing_write';

-- Missing predecessor history is not evidence that no request was sent. Activation
-- must persist a verified closure before a subsequent lease can open this gate.
CREATE TRIGGER afternic_ownership_claim_initial_source BEFORE INSERT ON afternic_ownership_review_claims
WHEN EXISTS(SELECT 1 FROM initial_replica_installation_receipts WHERE workspace_id=NEW.workspace_id)
 OR NOT EXISTS(SELECT 1 FROM device_execution_fact_outbox f WHERE f.workspace_id=NEW.workspace_id AND f.execution_fact_id=NEW.execution_fact_id AND f.active_lease_epoch=1
 AND NOT EXISTS(SELECT 1 FROM execution_evidence_stream_heads h WHERE h.workspace_id=f.workspace_id AND (h.source_device_id!=f.source_device_id OR h.active_lease_epoch!=f.active_lease_epoch OR h.source_installation_digest!=f.source_installation_digest)))
BEGIN SELECT RAISE(ABORT,'ownership claim requires complete initial source history'); END;
