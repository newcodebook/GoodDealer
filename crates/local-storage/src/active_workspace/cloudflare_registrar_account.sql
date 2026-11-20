-- The direct account slot uses a user API token. Zone-derived credentials keep their own lineage.
-- These tables contain only Host-issued identities and complete, sanitized scan receipts.
CREATE TABLE cloudflare_registrar_account_slots (
    workspace_id TEXT NOT NULL,
    connection_id TEXT NOT NULL,
    incarnation_id TEXT NOT NULL,
    credential_proof TEXT NOT NULL CHECK (
      length(credential_proof) = 64 AND credential_proof NOT GLOB '*[^0-9a-f]*'
    ),
    state TEXT NOT NULL CHECK (state IN ('prepared','active','revoked')),
    request_id TEXT,
    request_device_id TEXT,
    request_lease_epoch INTEGER CHECK (request_lease_epoch BETWEEN 1 AND 9007199254740991),
    created_at TEXT NOT NULL,
    purged_at TEXT CHECK (purged_at IS NULL OR (state='revoked' AND purged_at >= created_at)),
    CHECK ((request_id IS NULL) = (request_device_id IS NULL)),
    CHECK ((request_id IS NULL) = (request_lease_epoch IS NULL)),
    CHECK (state!='prepared' OR request_id IS NOT NULL),
    CHECK (state!='revoked' OR request_id IS NULL),
    PRIMARY KEY (workspace_id, connection_id),
    UNIQUE (workspace_id, incarnation_id),
    FOREIGN KEY (workspace_id, connection_id)
      REFERENCES local_provider_connections(workspace_id, connection_id) ON DELETE RESTRICT
) STRICT;

CREATE TRIGGER cloudflare_registrar_account_connection_insert_shape
BEFORE INSERT ON cloudflare_registrar_account_slots
WHEN NEW.state != 'prepared' OR NEW.purged_at IS NOT NULL
  OR EXISTS (SELECT 1 FROM device_handoff_barriers b WHERE b.workspace_id=NEW.workspace_id)
  OR NOT EXISTS (
  SELECT 1 FROM local_provider_connections c
  WHERE c.workspace_id=NEW.workspace_id AND c.connection_id=NEW.connection_id
    AND c.provider_kind='cloudflare' AND c.connection_incarnation_id=NEW.incarnation_id
    AND json(c.capabilities_json)='["registrar"]' AND c.credential_use_state='inactive'
    AND c.lifecycle_status='invalid' AND c.deleted_at IS NULL AND c.revoked_at IS NULL
)
BEGIN SELECT RAISE(ABORT, 'Cloudflare slot must start prepared'); END;

CREATE TRIGGER cloudflare_registrar_account_connection_immutable
BEFORE UPDATE ON cloudflare_registrar_account_slots
WHEN NEW.workspace_id IS NOT OLD.workspace_id OR NEW.connection_id IS NOT OLD.connection_id
  OR NEW.incarnation_id IS NOT OLD.incarnation_id OR NEW.credential_proof IS NOT OLD.credential_proof
  OR NEW.created_at IS NOT OLD.created_at
  OR (OLD.purged_at IS NOT NULL AND NEW.purged_at IS NOT OLD.purged_at)
  OR NOT (NEW.state=OLD.state OR NEW.state='revoked' OR (OLD.state='prepared' AND NEW.state='active'))
BEGIN SELECT RAISE(ABORT, 'Cloudflare slot identity and retirement are permanent'); END;

CREATE TRIGGER cloudflare_registrar_account_connection_no_delete
BEFORE DELETE ON cloudflare_registrar_account_slots
BEGIN SELECT RAISE(ABORT, 'Cloudflare slot history is permanent'); END;

CREATE TRIGGER cloudflare_registrar_account_connection_deny_revoked
AFTER UPDATE OF state ON cloudflare_registrar_account_slots
WHEN NEW.state='revoked' AND OLD.state!='revoked'
BEGIN
  UPDATE local_provider_connections SET credential_use_state='revoked'
   WHERE workspace_id=NEW.workspace_id AND connection_id=NEW.connection_id;
END;

CREATE TRIGGER cloudflare_registrar_account_connection_identity_immutable
BEFORE UPDATE ON local_provider_connections
WHEN EXISTS (
  SELECT 1 FROM cloudflare_registrar_account_slots s
  WHERE s.workspace_id=OLD.workspace_id AND s.connection_id=OLD.connection_id
) AND (
  NEW.workspace_id IS NOT OLD.workspace_id OR NEW.connection_id IS NOT OLD.connection_id
  OR NEW.provider_kind IS NOT OLD.provider_kind OR NEW.connection_incarnation_id IS NOT OLD.connection_incarnation_id
  OR NEW.capabilities_json IS NOT OLD.capabilities_json
)
BEGIN SELECT RAISE(ABORT, 'Cloudflare slot owns its connection identity'); END;

CREATE TRIGGER cloudflare_registrar_account_connection_publication_insert
BEFORE INSERT ON local_provider_connections
WHEN NEW.provider_kind='cloudflare' AND json(NEW.capabilities_json)='["registrar"]'
  AND NEW.credential_use_state='active'
BEGIN SELECT RAISE(ABORT, 'Cloudflare must prepare a Native slot first'); END;

CREATE TRIGGER cloudflare_registrar_account_connection_publication_update
BEFORE UPDATE ON local_provider_connections
WHEN NEW.provider_kind='cloudflare' AND json(NEW.capabilities_json)='["registrar"]'
  AND NEW.credential_use_state='active' AND NOT EXISTS (
  SELECT 1 FROM cloudflare_registrar_account_slots s
  WHERE s.workspace_id=NEW.workspace_id AND s.connection_id=NEW.connection_id
    AND s.incarnation_id=NEW.connection_incarnation_id AND s.state='active'
    AND s.purged_at IS NULL AND NEW.revoked_at IS NULL AND NEW.deleted_at IS NULL
    AND NEW.lifecycle_status='active' AND NEW.validation_status='valid'
)
BEGIN SELECT RAISE(ABORT, 'Cloudflare requires a published Native slot'); END;

DROP TRIGGER cloudflare_connection_publication_update_shape;
CREATE TRIGGER cloudflare_connection_publication_update_shape
BEFORE UPDATE OF provider_kind, credential_use_state, active_credential_generation,
  active_credential_scope_digest, active_credential_zone_digest,
  active_credential_public_proof, capabilities_json ON local_provider_connections
WHEN NEW.provider_kind='cloudflare' AND NOT (
  (NEW.active_credential_generation IS NULL
    AND NEW.active_credential_scope_digest IS NULL
    AND NEW.active_credential_zone_digest IS NULL
    AND NEW.active_credential_public_proof IS NULL
    AND (NEW.credential_use_state != 'active' OR (
      json(NEW.capabilities_json)='["registrar"]' AND EXISTS (
        SELECT 1 FROM cloudflare_registrar_account_slots s
        WHERE s.workspace_id=NEW.workspace_id AND s.connection_id=NEW.connection_id
          AND s.incarnation_id=NEW.connection_incarnation_id AND s.state='active' AND s.purged_at IS NULL
      )
    )))
  OR (NEW.active_credential_generation IS NOT NULL
    AND NEW.active_credential_scope_digest IS NOT NULL
    AND NEW.active_credential_zone_digest IS NOT NULL
    AND NEW.active_credential_public_proof IS NOT NULL
    AND json(NEW.capabilities_json)<>'["registrar"]'
    AND NEW.credential_use_state IN (
      'active', 'transition_pending', 'revocation_pending', 'remediation_required'
    ))
)
BEGIN SELECT RAISE(ABORT, 'invalid Cloudflare credential publication shape'); END;

CREATE TABLE cloudflare_registrar_account_scans (
    workspace_id TEXT NOT NULL,
    scan_id TEXT NOT NULL,
    connection_id TEXT NOT NULL,
    observation_run_id TEXT,
    account_scope_digest TEXT NOT NULL CHECK (
      length(account_scope_digest)=64 AND account_scope_digest NOT GLOB '*[^0-9a-f]*'
    ),
    observed_count INTEGER NOT NULL CHECK (observed_count BETWEEN 0 AND 10000),
    imported_count INTEGER NOT NULL CHECK (imported_count >= 0),
    skipped_count INTEGER NOT NULL CHECK (skipped_count >= 0),
    completed_at TEXT NOT NULL,
    PRIMARY KEY (workspace_id, scan_id),
    UNIQUE (workspace_id, observation_run_id),
    FOREIGN KEY (workspace_id, connection_id)
      REFERENCES cloudflare_registrar_account_slots(workspace_id, connection_id) ON DELETE RESTRICT,
    FOREIGN KEY (workspace_id, observation_run_id)
      REFERENCES provider_observation_runs(workspace_id, observation_run_id) ON DELETE RESTRICT,
    CHECK (imported_count + skipped_count <= observed_count),
    CHECK ((observation_run_id IS NULL) = (observed_count = skipped_count))
) STRICT;
CREATE INDEX cloudflare_registrar_account_scan_connection
ON cloudflare_registrar_account_scans(workspace_id, connection_id);

CREATE TRIGGER cloudflare_registrar_account_scan_insert_shape
BEFORE INSERT ON cloudflare_registrar_account_scans
WHEN NOT EXISTS (
  SELECT 1 FROM cloudflare_registrar_account_slots s JOIN local_provider_connections c USING(workspace_id, connection_id)
  WHERE s.workspace_id=NEW.workspace_id AND s.connection_id=NEW.connection_id
    AND s.state='active' AND s.request_id=NEW.scan_id AND s.purged_at IS NULL AND c.credential_use_state='active'
    AND c.lifecycle_status='active' AND c.validation_status='valid'
) OR EXISTS (
  SELECT 1 FROM device_handoff_barriers b WHERE b.workspace_id=NEW.workspace_id
) OR EXISTS (
  SELECT 1 FROM cloudflare_registrar_account_scans scan WHERE scan.workspace_id=NEW.workspace_id
    AND scan.connection_id=NEW.connection_id AND scan.account_scope_digest<>NEW.account_scope_digest
) OR (NEW.observation_run_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM provider_observation_runs r
  WHERE r.workspace_id=NEW.workspace_id AND r.observation_run_id=NEW.observation_run_id
    AND r.connection_id=NEW.connection_id AND r.status='succeeded' AND r.completed_at=NEW.completed_at
    AND r.observation_capability='registrar' AND r.connector_version='cloudflare-registrar-v4'
)) OR NEW.observed_count - NEW.skipped_count != (
  SELECT count(*) FROM registrar_observations o
  WHERE o.workspace_id=NEW.workspace_id AND o.observation_run_id=NEW.observation_run_id
    AND o.registrar_name='Cloudflare'
)
BEGIN SELECT RAISE(ABORT, 'Cloudflare requires an active slot and complete observation'); END;

CREATE TRIGGER cloudflare_registrar_account_scan_no_update BEFORE UPDATE ON cloudflare_registrar_account_scans
BEGIN SELECT RAISE(ABORT, 'Cloudflare scan receipts are append-only'); END;

CREATE TRIGGER cloudflare_registrar_account_scan_no_delete BEFORE DELETE ON cloudflare_registrar_account_scans
BEGIN SELECT RAISE(ABORT, 'Cloudflare scan receipts are append-only'); END;

DROP VIEW registrar_inventory_read_facts;
CREATE VIEW registrar_inventory_read_facts AS
WITH heads AS (
    SELECT s.workspace_id,s.connection_id,s.observation_run_id
    FROM local_provider_connections c JOIN cloudflare_registrar_inventory_scans s
      ON s.rowid=(
        SELECT max(previous.rowid) FROM cloudflare_registrar_inventory_scans previous
        WHERE previous.workspace_id=c.workspace_id
          AND previous.connection_id=c.connection_id
          AND previous.connection_incarnation_id=c.connection_incarnation_id
          AND previous.credential_generation=c.active_credential_generation
      )
    WHERE c.provider_kind='cloudflare' AND c.lifecycle_status='active'
      AND c.credential_use_state='active' AND c.validation_status='valid' AND c.deleted_at IS NULL
    UNION ALL
    SELECT s.workspace_id,s.connection_id,s.observation_run_id
    FROM local_provider_connections c JOIN cloudflare_registrar_account_slots slot
      ON slot.workspace_id=c.workspace_id AND slot.connection_id=c.connection_id
    JOIN cloudflare_registrar_account_scans s ON s.rowid=(
      SELECT max(previous.rowid) FROM cloudflare_registrar_account_scans previous
      WHERE previous.workspace_id=c.workspace_id AND previous.connection_id=c.connection_id
    )
    WHERE c.provider_kind='cloudflare' AND c.lifecycle_status='active'
      AND c.credential_use_state='active' AND c.validation_status='valid' AND c.deleted_at IS NULL
      AND c.connection_incarnation_id=slot.incarnation_id AND slot.state='active' AND slot.purged_at IS NULL
    UNION ALL
    SELECT s.workspace_id,s.connection_id,s.observation_run_id
    FROM local_provider_connections c JOIN spaceship_registrar_scans s
      ON s.rowid=(
        SELECT max(previous.rowid) FROM spaceship_registrar_scans previous
        WHERE previous.workspace_id=c.workspace_id AND previous.connection_id=c.connection_id
      )
    WHERE c.provider_kind='spaceship' AND c.lifecycle_status='active'
      AND c.credential_use_state='active' AND c.validation_status='valid' AND c.deleted_at IS NULL
    UNION ALL
    SELECT s.workspace_id,s.connection_id,s.observation_run_id
    FROM local_provider_connections c JOIN aliyun_registrar_scans s
      ON s.rowid=(
        SELECT max(previous.rowid) FROM aliyun_registrar_scans previous
        WHERE previous.workspace_id=c.workspace_id AND previous.connection_id=c.connection_id
      )
    WHERE c.provider_kind='aliyun' AND c.lifecycle_status='active'
      AND c.credential_use_state='active' AND c.validation_status='valid' AND c.deleted_at IS NULL
), candidates AS (
    SELECT DISTINCT o.workspace_id,o.entity_id,o.registrar_name,o.expires_on,o.auto_renew,o.registrar_lock
    FROM heads h
    JOIN provider_observation_runs r
      ON r.workspace_id=h.workspace_id AND r.observation_run_id=h.observation_run_id
        AND r.connection_id=h.connection_id AND r.status='succeeded'
    JOIN registrar_observations o
      ON o.workspace_id=r.workspace_id AND o.observation_run_id=r.observation_run_id
    JOIN domain_assets a ON a.workspace_id=o.workspace_id AND a.entity_id=o.entity_id AND a.deleted_at IS NULL
    WHERE o.observation_availability='available' AND o.evidence_status='confirmed'
      AND o.expires_on=date(o.expires_on)
      AND a.entity_generation=coalesce(o.observed_asset_generation,1)
      AND NOT EXISTS (
        SELECT 1 FROM storage_repair_receipts x WHERE x.workspace_id=o.workspace_id
          AND x.repair_kind='registrar_observation' AND x.row_key=o.observation_id
      )
), resolved AS (
    SELECT workspace_id,entity_id,registrar_name,expires_on,auto_renew,registrar_lock
    FROM candidates GROUP BY workspace_id,entity_id HAVING count(*)=1
), managed AS (
    SELECT a.workspace_id,a.entity_id FROM domain_assets a
    WHERE a.deleted_at IS NULL AND EXISTS (
        SELECT 1 FROM registrar_observations o
        JOIN provider_observation_runs r
          ON r.workspace_id=o.workspace_id AND r.observation_run_id=o.observation_run_id
        WHERE o.workspace_id=a.workspace_id AND o.entity_id=a.entity_id
          AND a.entity_generation=coalesce(o.observed_asset_generation,1)
          AND r.connector_version IN ('cloudflare-registrar-v4','spaceship-registrar-v1','aliyun-registrar-v1')
    )
)
SELECT m.workspace_id,m.entity_id,r.registrar_name,r.expires_on,r.auto_renew,r.registrar_lock
FROM managed m LEFT JOIN resolved r USING(workspace_id,entity_id);
