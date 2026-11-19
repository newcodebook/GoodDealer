-- Historical reconciliations remain explicit unsigned history; new evidence uses the existing result owner.
ALTER TABLE afternic_delist_reconciliations ADD COLUMN audit_event_id TEXT;
ALTER TABLE execution_evidence_stream_heads ADD COLUMN admission_generation INTEGER NOT NULL DEFAULT 0
 CHECK(admission_generation BETWEEN 0 AND 9007199254740991);
ALTER TABLE device_handoff_barriers ADD COLUMN source_device_id TEXT;
ALTER TABLE device_handoff_barriers ADD COLUMN frozen_unresolved_count INTEGER NOT NULL DEFAULT 0
 CHECK(frozen_unresolved_count>=0);
CREATE TRIGGER execution_evidence_head_barrier_insert BEFORE INSERT ON execution_evidence_stream_heads
WHEN EXISTS(SELECT 1 FROM device_handoff_barriers b WHERE b.workspace_id=NEW.workspace_id)
BEGIN SELECT RAISE(ABORT,'handoff closes execution evidence producer creation'); END;
CREATE TRIGGER execution_evidence_head_barrier_update BEFORE UPDATE ON execution_evidence_stream_heads
WHEN NEW.producer_state='open' AND EXISTS(SELECT 1 FROM device_handoff_barriers b WHERE b.workspace_id=NEW.workspace_id)
BEGIN SELECT RAISE(ABORT,'handoff closes execution evidence producers'); END;
CREATE TRIGGER execution_evidence_audit_barrier BEFORE INSERT ON workspace_device_audit_outbox
WHEN EXISTS(SELECT 1 FROM device_handoff_barriers b WHERE b.workspace_id=NEW.workspace_id)
BEGIN SELECT RAISE(ABORT,'handoff closes execution evidence audit append'); END;
CREATE TRIGGER execution_evidence_fact_barrier BEFORE INSERT ON device_execution_fact_outbox
WHEN EXISTS(SELECT 1 FROM device_handoff_barriers b WHERE b.workspace_id=NEW.workspace_id)
BEGIN SELECT RAISE(ABORT,'handoff closes execution evidence fact append'); END;
CREATE TRIGGER execution_evidence_admission_generation BEFORE UPDATE ON execution_evidence_stream_heads
WHEN NEW.admission_generation<OLD.admission_generation OR NEW.admission_generation>OLD.admission_generation+1
 OR (OLD.producer_state='frozen' AND NEW.producer_state='open' AND NEW.admission_generation!=OLD.admission_generation+1)
BEGIN SELECT RAISE(ABORT,'execution evidence admission cannot reuse a frozen read'); END;
CREATE TRIGGER afternic_reconciliation_requires_exact_audit BEFORE INSERT ON afternic_delist_reconciliations
WHEN (NEW.audit_event_id IS NOT NULL AND NOT EXISTS(
 SELECT 1 FROM workspace_device_audit_outbox a WHERE a.workspace_id=NEW.workspace_id AND a.audit_event_id=NEW.audit_event_id
 AND json_extract(a.envelope_json,'$.payloadRedacted.operationId')=NEW.operation_id
 AND json_extract(a.envelope_json,'$.payloadRedacted.operationItemId')=NEW.item_id
 AND ((NEW.stage='preflight' AND json_extract(a.envelope_json,'$.payloadRedacted.stage')='preflight_refused')
 OR (NEW.stage='reconcile' AND json_extract(a.envelope_json,'$.payloadRedacted.stage')='reconciled'
 AND json_extract(a.envelope_json,'$.payloadRedacted.outcome')=NEW.outcome
 AND json_extract(a.envelope_json,'$.payloadRedacted.reason') IS NEW.reason))))
 OR (NEW.audit_event_id IS NULL AND (NEW.stage='reconcile' OR NEW.outcome!='read_failed') AND EXISTS(
 SELECT 1 FROM afternic_delist_item_authorizations i WHERE i.workspace_id=NEW.workspace_id
 AND i.operation_id=NEW.operation_id AND i.item_id=NEW.item_id AND i.attempt_number=NEW.attempt_number))
BEGIN SELECT RAISE(ABORT,'signed Afternic result requires its exact audit'); END;
CREATE TRIGGER afternic_reconciliation_barrier BEFORE INSERT ON afternic_delist_reconciliations
WHEN EXISTS(SELECT 1 FROM device_handoff_barriers b WHERE b.workspace_id=NEW.workspace_id)
BEGIN SELECT RAISE(ABORT,'handoff freezes Afternic observations'); END;
