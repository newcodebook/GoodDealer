-- Native source evidence shares the original business writer and originating transaction.
CREATE TABLE execution_evidence_stream_heads (
 workspace_id TEXT NOT NULL,
 source_device_id TEXT NOT NULL,
 active_lease_epoch INTEGER NOT NULL CHECK(active_lease_epoch BETWEEN 1 AND 9007199254740991),
 stream TEXT NOT NULL CHECK(stream IN ('device_audit','execution_fact')),
 source_installation_digest TEXT NOT NULL CHECK(length(source_installation_digest)=43),
 last_sequence INTEGER NOT NULL CHECK(last_sequence BETWEEN 0 AND 9007199254740991),
 rolling_digest TEXT NOT NULL CHECK(length(rolling_digest)=43),
 audit_head_hash TEXT CHECK(audit_head_hash IS NULL OR length(audit_head_hash)=43),
 producer_state TEXT NOT NULL CHECK(producer_state IN ('open','frozen','sealed')),
 PRIMARY KEY(workspace_id,source_device_id,active_lease_epoch,stream),
 CHECK((stream='device_audit')=(audit_head_hash IS NOT NULL))
) STRICT;
CREATE TABLE workspace_device_audit_outbox (
 workspace_id TEXT NOT NULL,
 source_device_id TEXT NOT NULL,
 active_lease_epoch INTEGER NOT NULL,
 audit_sequence INTEGER NOT NULL CHECK(audit_sequence BETWEEN 1 AND 9007199254740991),
 audit_event_id TEXT NOT NULL,
 source_installation_digest TEXT NOT NULL CHECK(length(source_installation_digest)=43),
 chain_id TEXT NOT NULL CHECK(length(chain_id)=43),
 previous_hash TEXT NOT NULL CHECK(length(previous_hash)=43),
 event_hash TEXT NOT NULL CHECK(length(event_hash)=43),
 envelope_json TEXT NOT NULL CHECK(json_valid(envelope_json) AND json_type(envelope_json)='object' AND length(CAST(envelope_json AS BLOB))<=32768),
 canonical_envelope BLOB NOT NULL CHECK(length(canonical_envelope) BETWEEN 1 AND 65536),
 envelope_digest TEXT NOT NULL CHECK(length(envelope_digest)=43),
 PRIMARY KEY(workspace_id,source_device_id,active_lease_epoch,audit_sequence),
 UNIQUE(workspace_id,audit_event_id),
 CHECK(COALESCE(json_extract(envelope_json,'$.auditEventId')=audit_event_id AND json_extract(envelope_json,'$.auditSequence')=audit_sequence
 AND json_extract(envelope_json,'$.workspaceId')=workspace_id AND json_extract(envelope_json,'$.sourceDeviceId')=source_device_id
 AND json_extract(envelope_json,'$.activeLeaseEpoch')=active_lease_epoch AND json_extract(envelope_json,'$.eventHash')=event_hash,0))
) STRICT;
CREATE TABLE afternic_delist_approvals (
 workspace_id TEXT NOT NULL,
 approved_operation_id TEXT NOT NULL,
 operation_id TEXT NOT NULL,
 plan_id TEXT NOT NULL,
 plan_hash TEXT NOT NULL CHECK(length(plan_hash)=43),
 target_count INTEGER NOT NULL CHECK(target_count BETWEEN 1 AND 500),
 target_set_digest TEXT NOT NULL CHECK(length(target_set_digest)=43),
 source_device_id TEXT NOT NULL,
 active_lease_epoch INTEGER NOT NULL CHECK(active_lease_epoch BETWEEN 1 AND 9007199254740991),
 credential_epoch INTEGER NOT NULL CHECK(credential_epoch BETWEEN 1 AND 9007199254740991),
 signing_key_id TEXT NOT NULL,
 signing_key_version INTEGER NOT NULL CHECK(signing_key_version BETWEEN 1 AND 9007199254740991),
 source_installation_digest TEXT NOT NULL CHECK(length(source_installation_digest)=43),
 approved_at TEXT NOT NULL,
 audit_event_id TEXT NOT NULL,
 PRIMARY KEY(workspace_id,approved_operation_id),
 UNIQUE(workspace_id,operation_id), UNIQUE(workspace_id,plan_id),
 FOREIGN KEY(workspace_id,operation_id) REFERENCES operations(workspace_id,operation_id) ON DELETE RESTRICT,
 FOREIGN KEY(workspace_id,plan_id) REFERENCES operation_plans(workspace_id,plan_id) ON DELETE RESTRICT,
 FOREIGN KEY(workspace_id,audit_event_id) REFERENCES workspace_device_audit_outbox(workspace_id,audit_event_id) ON DELETE RESTRICT
) STRICT;
CREATE TABLE afternic_delist_item_authorizations (
 workspace_id TEXT NOT NULL,
 approved_operation_id TEXT NOT NULL,
 operation_id TEXT NOT NULL,
 plan_id TEXT NOT NULL,
 item_id TEXT NOT NULL,
 attempt_number INTEGER NOT NULL CHECK(attempt_number=1),
 attempt_id TEXT NOT NULL,
 workflow_node_id TEXT NOT NULL,
 request_digest TEXT NOT NULL CHECK(length(request_digest)=43),
 envelope_json TEXT NOT NULL CHECK(json_valid(envelope_json) AND json_type(envelope_json)='object' AND length(CAST(envelope_json AS BLOB))<=6144),
 envelope_digest TEXT NOT NULL CHECK(length(envelope_digest)=43),
 PRIMARY KEY(workspace_id,operation_id,item_id,attempt_number),
 UNIQUE(workspace_id,attempt_id),
 FOREIGN KEY(workspace_id,approved_operation_id) REFERENCES afternic_delist_approvals(workspace_id,approved_operation_id) ON DELETE RESTRICT,
 FOREIGN KEY(workspace_id,operation_id,plan_id,item_id,attempt_number) REFERENCES operation_attempts(workspace_id,operation_id,plan_id,item_id,attempt_number) ON DELETE RESTRICT,
 CHECK(COALESCE(json_extract(envelope_json,'$.approvedOperationId')=approved_operation_id AND json_extract(envelope_json,'$.operationItemId')=item_id
 AND json_extract(envelope_json,'$.operationId')=operation_id AND json_extract(envelope_json,'$.planId')=plan_id
 AND json_extract(envelope_json,'$.requestDigest')=request_digest,0))
) STRICT;
CREATE TABLE device_execution_fact_outbox (
 workspace_id TEXT NOT NULL,
 source_device_id TEXT NOT NULL,
 active_lease_epoch INTEGER NOT NULL,
 execution_fact_sequence INTEGER NOT NULL CHECK(execution_fact_sequence BETWEEN 1 AND 9007199254740991),
 execution_fact_id TEXT NOT NULL,
 source_installation_digest TEXT NOT NULL CHECK(length(source_installation_digest)=43),
 operation_id TEXT NOT NULL,
 item_id TEXT NOT NULL,
 attempt_number INTEGER NOT NULL CHECK(attempt_number=1),
 attempt_id TEXT NOT NULL,
 audit_event_id TEXT NOT NULL,
 envelope_json TEXT NOT NULL CHECK(json_valid(envelope_json) AND json_type(envelope_json)='object' AND length(CAST(envelope_json AS BLOB))<=32768),
 canonical_envelope BLOB NOT NULL CHECK(length(canonical_envelope) BETWEEN 1 AND 65536),
 envelope_digest TEXT NOT NULL CHECK(length(envelope_digest)=43),
 PRIMARY KEY(workspace_id,source_device_id,active_lease_epoch,execution_fact_sequence),
 UNIQUE(workspace_id,execution_fact_id), UNIQUE(workspace_id,operation_id,item_id,attempt_number),
 FOREIGN KEY(workspace_id,attempt_id) REFERENCES afternic_delist_item_authorizations(workspace_id,attempt_id) ON DELETE RESTRICT,
 FOREIGN KEY(workspace_id,audit_event_id) REFERENCES workspace_device_audit_outbox(workspace_id,audit_event_id) ON DELETE RESTRICT,
 CHECK(COALESCE(json_extract(envelope_json,'$.executionFactId')=execution_fact_id AND json_extract(envelope_json,'$.executionFactSequence')=execution_fact_sequence
 AND json_extract(envelope_json,'$.workspaceId')=workspace_id AND json_extract(envelope_json,'$.sourceDeviceId')=source_device_id
 AND json_extract(envelope_json,'$.activeLeaseEpoch')=active_lease_epoch AND json_extract(envelope_json,'$.attemptId')=attempt_id
 AND json_extract(envelope_json,'$.auditEventRef')=audit_event_id,0))
) STRICT;
CREATE TRIGGER execution_evidence_head_identity BEFORE UPDATE ON execution_evidence_stream_heads
WHEN NEW.workspace_id IS NOT OLD.workspace_id OR NEW.source_device_id IS NOT OLD.source_device_id
 OR NEW.active_lease_epoch IS NOT OLD.active_lease_epoch OR NEW.stream IS NOT OLD.stream
 OR NEW.source_installation_digest IS NOT OLD.source_installation_digest
 OR NEW.last_sequence<OLD.last_sequence OR NEW.last_sequence>OLD.last_sequence+1
 OR (OLD.producer_state='sealed' AND NEW.producer_state!='sealed')
BEGIN SELECT RAISE(ABORT,'execution evidence head cannot change identity or rewind'); END;
CREATE TRIGGER execution_evidence_head_no_delete BEFORE DELETE ON execution_evidence_stream_heads
BEGIN SELECT RAISE(ABORT,'execution evidence head is retained'); END;
CREATE TRIGGER execution_evidence_audit_append BEFORE INSERT ON workspace_device_audit_outbox
WHEN NOT EXISTS(SELECT 1 FROM execution_evidence_stream_heads h WHERE h.workspace_id=NEW.workspace_id
 AND h.source_device_id=NEW.source_device_id AND h.active_lease_epoch=NEW.active_lease_epoch AND h.stream='device_audit'
 AND h.source_installation_digest=NEW.source_installation_digest AND h.producer_state='open'
 AND h.last_sequence+1=NEW.audit_sequence AND h.audit_head_hash=NEW.previous_hash)
BEGIN SELECT RAISE(ABORT,'device audit must append to the exact open source head'); END;
CREATE TRIGGER execution_evidence_fact_append BEFORE INSERT ON device_execution_fact_outbox
WHEN NOT EXISTS(SELECT 1 FROM execution_evidence_stream_heads h WHERE h.workspace_id=NEW.workspace_id
 AND h.source_device_id=NEW.source_device_id AND h.active_lease_epoch=NEW.active_lease_epoch AND h.stream='execution_fact'
 AND h.source_installation_digest=NEW.source_installation_digest AND h.producer_state='open' AND h.last_sequence+1=NEW.execution_fact_sequence)
 OR NOT EXISTS(SELECT 1 FROM afternic_delist_item_authorizations i WHERE i.workspace_id=NEW.workspace_id
 AND i.operation_id=NEW.operation_id AND i.item_id=NEW.item_id AND i.attempt_number=NEW.attempt_number AND i.attempt_id=NEW.attempt_id)
BEGIN SELECT RAISE(ABORT,'execution fact must append from the exact approved attempt and open head'); END;
CREATE TRIGGER afternic_delist_requires_signed_claim BEFORE UPDATE OF status ON operation_attempts
WHEN OLD.status='queued' AND NEW.status='running' AND NOT EXISTS(SELECT 1 FROM device_handoff_barriers b WHERE b.workspace_id=OLD.workspace_id) AND EXISTS(SELECT 1 FROM operation_plans p WHERE p.workspace_id=OLD.workspace_id AND p.plan_id=OLD.plan_id AND p.operation_kind='afternic_delist')
 AND NOT EXISTS(SELECT 1 FROM device_execution_fact_outbox f WHERE f.workspace_id=OLD.workspace_id
 AND f.operation_id=OLD.operation_id AND f.item_id=OLD.item_id AND f.attempt_number=OLD.attempt_number)
BEGIN SELECT RAISE(ABORT,'Afternic dispatch requires its immutable signed claim'); END;
CREATE TRIGGER afternic_delist_approvals_no_update BEFORE UPDATE ON afternic_delist_approvals
BEGIN SELECT RAISE(ABORT,'execution source evidence is immutable'); END;
CREATE TRIGGER afternic_delist_approvals_no_delete BEFORE DELETE ON afternic_delist_approvals
BEGIN SELECT RAISE(ABORT,'execution source evidence is immutable'); END;
CREATE TRIGGER afternic_delist_item_authorizations_no_update BEFORE UPDATE ON afternic_delist_item_authorizations
BEGIN SELECT RAISE(ABORT,'execution source evidence is immutable'); END;
CREATE TRIGGER afternic_delist_item_authorizations_no_delete BEFORE DELETE ON afternic_delist_item_authorizations
BEGIN SELECT RAISE(ABORT,'execution source evidence is immutable'); END;
CREATE TRIGGER device_execution_fact_outbox_no_update BEFORE UPDATE ON device_execution_fact_outbox
BEGIN SELECT RAISE(ABORT,'execution source evidence is immutable'); END;
CREATE TRIGGER device_execution_fact_outbox_no_delete BEFORE DELETE ON device_execution_fact_outbox
BEGIN SELECT RAISE(ABORT,'execution source evidence is immutable'); END;
CREATE TRIGGER workspace_device_audit_outbox_no_update BEFORE UPDATE ON workspace_device_audit_outbox
BEGIN SELECT RAISE(ABORT,'execution source evidence is immutable'); END;
CREATE TRIGGER workspace_device_audit_outbox_no_delete BEFORE DELETE ON workspace_device_audit_outbox
BEGIN SELECT RAISE(ABORT,'execution source evidence is immutable'); END;
