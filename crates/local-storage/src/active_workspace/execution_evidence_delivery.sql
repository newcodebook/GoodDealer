CREATE TABLE execution_evidence_receipts (
 workspace_id TEXT NOT NULL, source_device_id TEXT NOT NULL,
 active_lease_epoch INTEGER NOT NULL CHECK(active_lease_epoch BETWEEN 1 AND 9007199254740991),
 stream TEXT NOT NULL CHECK(stream IN ('device_audit','execution_fact')),
 sequence INTEGER NOT NULL CHECK(sequence BETWEEN 1 AND 9007199254740991),
 event_id TEXT NOT NULL, envelope_digest TEXT NOT NULL CHECK(length(envelope_digest)=43),
 outcome TEXT NOT NULL CHECK(outcome IN ('accepted','quarantined')),
 receipt_json TEXT NOT NULL CHECK(json_valid(receipt_json) AND length(CAST(receipt_json AS BLOB))<=4096),
 PRIMARY KEY(workspace_id,source_device_id,active_lease_epoch,stream,sequence),
 CHECK(COALESCE(json_extract(receipt_json,'$.workspaceId')=workspace_id AND json_extract(receipt_json,'$.sourceDeviceId')=source_device_id
 AND json_extract(receipt_json,'$.activeLeaseEpoch')=active_lease_epoch AND json_extract(receipt_json,'$.stream')=stream
 AND json_extract(receipt_json,'$.sequence')=sequence AND json_extract(receipt_json,'$.eventId')=event_id
 AND json_extract(receipt_json,'$.envelopeDigest')=envelope_digest AND json_extract(receipt_json,'$.outcome')=outcome,0))
) STRICT;
CREATE TRIGGER execution_evidence_receipt_exact_source BEFORE INSERT ON execution_evidence_receipts
WHEN (NEW.stream='device_audit' AND NOT EXISTS(SELECT 1 FROM workspace_device_audit_outbox a WHERE a.workspace_id=NEW.workspace_id AND a.source_device_id=NEW.source_device_id AND a.active_lease_epoch=NEW.active_lease_epoch AND a.audit_sequence=NEW.sequence AND a.audit_event_id=NEW.event_id AND a.envelope_digest=NEW.envelope_digest))
 OR (NEW.stream='execution_fact' AND NOT EXISTS(SELECT 1 FROM device_execution_fact_outbox f WHERE f.workspace_id=NEW.workspace_id AND f.source_device_id=NEW.source_device_id AND f.active_lease_epoch=NEW.active_lease_epoch AND f.execution_fact_sequence=NEW.sequence AND f.execution_fact_id=NEW.event_id AND f.envelope_digest=NEW.envelope_digest))
BEGIN SELECT RAISE(ABORT,'receipt must match its exact immutable source'); END;
CREATE TRIGGER execution_evidence_receipts_no_update BEFORE UPDATE ON execution_evidence_receipts
BEGIN SELECT RAISE(ABORT,'execution evidence receipt is immutable'); END;
CREATE TRIGGER execution_evidence_receipts_no_delete BEFORE DELETE ON execution_evidence_receipts
BEGIN SELECT RAISE(ABORT,'execution evidence receipt is retained'); END;
