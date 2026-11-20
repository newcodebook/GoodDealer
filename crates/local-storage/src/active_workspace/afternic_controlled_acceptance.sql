-- Local development acceptance binds once to a real authorized device and exact Native slot.
-- It is neither a Provider qualification nor a transferable authorization capability.
CREATE TABLE afternic_controlled_acceptance_runs (
 run_id TEXT PRIMARY KEY CHECK(run_id='afternic-wecin-linux-20261119'),
 workspace_id TEXT NOT NULL CHECK(length(workspace_id) BETWEEN 1 AND 160),
 account_id TEXT NOT NULL CHECK(length(account_id) BETWEEN 1 AND 160),
 device_id TEXT NOT NULL CHECK(length(device_id) BETWEEN 1 AND 160),
 active_lease_epoch INTEGER NOT NULL CHECK(active_lease_epoch BETWEEN 1 AND 9007199254740991),
 credential_epoch INTEGER NOT NULL CHECK(credential_epoch BETWEEN 1 AND 9007199254740991),
 connection_id TEXT NOT NULL,
 connection_incarnation_id TEXT NOT NULL,
 credential_generation INTEGER NOT NULL CHECK(credential_generation BETWEEN 1 AND 9007199254740991),
 credential_public_proof TEXT NOT NULL CHECK(length(credential_public_proof)=64 AND credential_public_proof NOT GLOB '*[^0-9a-f]*'),
 expires_at TEXT NOT NULL CHECK(expires_at='2026-11-26T23:59:59Z'),
 bound_at TEXT NOT NULL CHECK(bound_at >= '2026-11-19T00:00:00Z' AND bound_at < expires_at AND bound_at IS strftime('%Y-%m-%dT%H:%M:%SZ',bound_at)),
 FOREIGN KEY(workspace_id,connection_id) REFERENCES local_provider_connections(workspace_id,connection_id) ON DELETE RESTRICT
) STRICT;
CREATE TRIGGER afternic_controlled_acceptance_no_update BEFORE UPDATE ON afternic_controlled_acceptance_runs
BEGIN SELECT RAISE(ABORT,'controlled acceptance binding is immutable'); END;
CREATE TRIGGER afternic_controlled_acceptance_no_delete BEFORE DELETE ON afternic_controlled_acceptance_runs
BEGIN SELECT RAISE(ABORT,'controlled acceptance binding is retained'); END;
CREATE TRIGGER afternic_controlled_acceptance_exact_slot BEFORE INSERT ON afternic_controlled_acceptance_runs
WHEN NOT EXISTS(SELECT 1 FROM local_provider_connections c JOIN afternic_connection_publications p USING(workspace_id,connection_id)
 WHERE c.workspace_id=NEW.workspace_id AND c.connection_id=NEW.connection_id AND c.provider_kind='afternic'
 AND c.connection_incarnation_id=NEW.connection_incarnation_id AND p.connection_incarnation_id=NEW.connection_incarnation_id
 AND p.credential_generation=NEW.credential_generation AND p.credential_public_proof=NEW.credential_public_proof
 AND p.publication_state='prepared' AND c.lifecycle_status='invalid' AND c.credential_use_state='inactive'
 AND c.revoked_at IS NULL AND c.deleted_at IS NULL)
BEGIN SELECT RAISE(ABORT,'controlled acceptance requires its exact prepared slot'); END;
