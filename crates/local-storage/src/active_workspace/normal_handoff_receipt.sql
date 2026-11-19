-- Local-only evidence; never part of the Cloud replica or a source of Active authority.
CREATE TABLE normal_handoff_attempts (
  workspace_id TEXT NOT NULL,
  request_id TEXT NOT NULL CHECK (length(request_id) BETWEEN 1 AND 160),
  source_device_id TEXT NOT NULL CHECK (length(source_device_id) BETWEEN 1 AND 160),
  target_device_id TEXT NOT NULL CHECK (length(target_device_id) BETWEEN 1 AND 160 AND target_device_id <> source_device_id),
  source_lease_epoch INTEGER NOT NULL CHECK (source_lease_epoch BETWEEN 1 AND 9007199254740991),
  proof_id TEXT NOT NULL CHECK (length(proof_id) BETWEEN 1 AND 160),
  proof_digest TEXT NOT NULL CHECK (length(proof_digest) = 43 AND proof_digest NOT GLOB '*[^A-Za-z0-9_-]*'),
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL CHECK (expires_at > issued_at),
  PRIMARY KEY (workspace_id, request_id),
  UNIQUE (workspace_id, proof_id)
) STRICT;
CREATE TRIGGER normal_handoff_attempt_barrier
BEFORE INSERT ON normal_handoff_attempts
WHEN NOT EXISTS (SELECT 1 FROM device_handoff_barriers b WHERE b.workspace_id = NEW.workspace_id
 AND b.device_switch_request_id = NEW.request_id AND b.active_lease_epoch = NEW.source_lease_epoch)
BEGIN SELECT RAISE(ABORT, 'handoff attempt requires its exact active barrier'); END;
CREATE TRIGGER normal_handoff_attempt_immutable_update BEFORE UPDATE ON normal_handoff_attempts
BEGIN SELECT RAISE(ABORT, 'handoff attempt is immutable'); END;
CREATE TRIGGER normal_handoff_attempt_immutable_delete BEFORE DELETE ON normal_handoff_attempts
BEGIN SELECT RAISE(ABORT, 'handoff attempt is immutable'); END;
CREATE TABLE normal_handoff_receipts (
  workspace_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  released_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, request_id),
  FOREIGN KEY (workspace_id, request_id) REFERENCES normal_handoff_attempts(workspace_id, request_id)
) STRICT;
CREATE TRIGGER normal_handoff_receipt_matches_attempt BEFORE INSERT ON normal_handoff_receipts
WHEN NOT EXISTS (SELECT 1 FROM normal_handoff_attempts a JOIN device_handoff_barriers b
 ON b.workspace_id = a.workspace_id AND b.device_switch_request_id = a.request_id
 AND b.active_lease_epoch = a.source_lease_epoch
 WHERE a.workspace_id = NEW.workspace_id AND a.request_id = NEW.request_id
 AND NEW.released_at >= a.issued_at AND NEW.released_at < a.expires_at)
BEGIN SELECT RAISE(ABORT, 'handoff receipt requires its pending attempt and barrier'); END;
CREATE TRIGGER normal_handoff_receipt_immutable_update BEFORE UPDATE ON normal_handoff_receipts
BEGIN SELECT RAISE(ABORT, 'handoff receipt is immutable'); END;
CREATE TRIGGER normal_handoff_receipt_immutable_delete BEFORE DELETE ON normal_handoff_receipts
BEGIN SELECT RAISE(ABORT, 'handoff receipt is immutable'); END;

CREATE TABLE normal_handoff_refusals (
  workspace_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  code TEXT NOT NULL CHECK (code IN ('DRAIN_PROOF_INVALID', 'DRAIN_PROOF_EXPIRED', 'DRAIN_STREAMS_INCOMPLETE')),
  PRIMARY KEY (workspace_id, request_id),
  FOREIGN KEY (workspace_id, request_id) REFERENCES normal_handoff_attempts(workspace_id, request_id)
) STRICT;
CREATE TRIGGER normal_handoff_refusal_immutable_update BEFORE UPDATE ON normal_handoff_refusals
BEGIN SELECT RAISE(ABORT, 'handoff refusal is immutable'); END;
CREATE TRIGGER normal_handoff_refusal_immutable_delete BEFORE DELETE ON normal_handoff_refusals
BEGIN SELECT RAISE(ABORT, 'handoff refusal is immutable'); END;
