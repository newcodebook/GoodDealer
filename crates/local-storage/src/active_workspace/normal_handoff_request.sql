-- Initial source intent is durable before HTTP; it carries no Provider identity or execution queue.
CREATE TABLE normal_handoff_requests (
 workspace_id TEXT NOT NULL, source_device_id TEXT NOT NULL,
 source_lease_epoch INTEGER NOT NULL CHECK(source_lease_epoch BETWEEN 1 AND 9007199254740991),
 idempotency_key TEXT NOT NULL,target_device_id TEXT NOT NULL,
 request_json TEXT NOT NULL CHECK(json_valid(request_json) AND length(CAST(request_json AS BLOB))<=4096),
 created_at TEXT NOT NULL, answer_json TEXT CHECK(answer_json IS NULL OR (json_valid(answer_json) AND length(CAST(answer_json AS BLOB))<=65536)),
 answered_at TEXT,
 PRIMARY KEY(workspace_id,idempotency_key),
 CHECK(source_device_id!=target_device_id),
 CHECK((answer_json IS NULL)=(answered_at IS NULL)),
 CHECK(COALESCE(json_extract(request_json,'$.schemaVersion')=2 AND json_extract(request_json,'$.mode')='normal' AND json_extract(request_json,'$.toDeviceId')=target_device_id AND json_extract(request_json,'$.idempotencyKey')=idempotency_key AND json_extract(request_json,'$.expectedSourceLeaseEpoch')=source_lease_epoch,0))
) STRICT;
CREATE UNIQUE INDEX normal_handoff_single_pending_source ON normal_handoff_requests(workspace_id,source_device_id) WHERE answer_json IS NULL;
CREATE TRIGGER normal_handoff_request_immutable_source BEFORE UPDATE ON normal_handoff_requests
WHEN NEW.workspace_id IS NOT OLD.workspace_id OR NEW.source_device_id IS NOT OLD.source_device_id
 OR NEW.source_lease_epoch IS NOT OLD.source_lease_epoch OR NEW.idempotency_key IS NOT OLD.idempotency_key
 OR NEW.target_device_id IS NOT OLD.target_device_id OR NEW.request_json IS NOT OLD.request_json OR NEW.created_at IS NOT OLD.created_at
 OR OLD.answer_json IS NOT NULL OR NEW.answer_json IS NULL
BEGIN SELECT RAISE(ABORT,'handoff request only accepts its first exact answer'); END;
CREATE TRIGGER normal_handoff_request_no_delete BEFORE DELETE ON normal_handoff_requests
BEGIN SELECT RAISE(ABORT,'handoff request history is retained'); END;
