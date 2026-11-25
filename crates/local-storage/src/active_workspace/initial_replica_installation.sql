-- A first-install receipt proves the exact transaction, never execution authority.
CREATE TABLE initial_replica_installation_receipts (
    workspace_id TEXT PRIMARY KEY NOT NULL,
    workflow_id TEXT NOT NULL,
    target_device_id TEXT NOT NULL,
    target_server_revision INTEGER NOT NULL CHECK(target_server_revision >= 0),
    workspace_schema_version INTEGER NOT NULL CHECK(workspace_schema_version > 0),
    replica_digest TEXT NOT NULL CHECK(length(replica_digest)=43),
    installed_at TEXT NOT NULL
) STRICT;
CREATE TRIGGER initial_replica_receipt_immutable_update
BEFORE UPDATE ON initial_replica_installation_receipts BEGIN SELECT RAISE(ABORT,'immutable installation receipt'); END;
CREATE TRIGGER initial_replica_receipt_immutable_delete
BEFORE DELETE ON initial_replica_installation_receipts BEGIN SELECT RAISE(ABORT,'immutable installation receipt'); END;
