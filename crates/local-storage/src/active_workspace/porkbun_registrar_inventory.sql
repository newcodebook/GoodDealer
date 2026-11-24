-- Porkbun API key pairs are replaced by a new connection incarnation and immutable Native slot.
-- These tables contain only Host-issued identities and complete, sanitized scan receipts.
CREATE TABLE porkbun_registrar_connections (
    workspace_id TEXT NOT NULL,
    connection_id TEXT NOT NULL,
    incarnation_id TEXT NOT NULL,
    credential_proof TEXT NOT NULL CHECK (
      length(credential_proof) = 64 AND credential_proof NOT GLOB '*[^0-9a-f]*'
    ),
    state TEXT NOT NULL CHECK (state IN ('prepared','active','revoked')),
    scan_pending INTEGER NOT NULL CHECK (
      scan_pending IN (0,1)
      AND (state!='prepared' OR scan_pending=1)
      AND (state!='revoked' OR scan_pending=0)
    ),
    created_at TEXT NOT NULL,
    purged_at TEXT CHECK (purged_at IS NULL OR (state='revoked' AND purged_at >= created_at)),
    PRIMARY KEY (workspace_id, connection_id),
    UNIQUE (workspace_id, incarnation_id),
    FOREIGN KEY (workspace_id, connection_id)
      REFERENCES local_provider_connections(workspace_id, connection_id) ON DELETE RESTRICT
) STRICT;

CREATE TRIGGER porkbun_registrar_connection_insert_shape
BEFORE INSERT ON porkbun_registrar_connections
WHEN NEW.state != 'prepared' OR NEW.purged_at IS NOT NULL OR NOT EXISTS (
  SELECT 1 FROM local_provider_connections c
  WHERE c.workspace_id=NEW.workspace_id AND c.connection_id=NEW.connection_id
    AND c.provider_kind='porkbun' AND c.connection_incarnation_id=NEW.incarnation_id
    AND json(c.capabilities_json)='["registrar"]' AND c.credential_use_state='inactive'
    AND c.lifecycle_status='invalid' AND c.deleted_at IS NULL AND c.revoked_at IS NULL
)
BEGIN SELECT RAISE(ABORT, 'Porkbun slot must start prepared'); END;

CREATE TRIGGER porkbun_registrar_connection_immutable
BEFORE UPDATE ON porkbun_registrar_connections
WHEN NEW.workspace_id IS NOT OLD.workspace_id OR NEW.connection_id IS NOT OLD.connection_id
  OR NEW.incarnation_id IS NOT OLD.incarnation_id OR NEW.credential_proof IS NOT OLD.credential_proof
  OR NEW.created_at IS NOT OLD.created_at
  OR (OLD.purged_at IS NOT NULL AND NEW.purged_at IS NOT OLD.purged_at)
  OR NOT (NEW.state=OLD.state OR NEW.state='revoked' OR (OLD.state='prepared' AND NEW.state='active'))
BEGIN SELECT RAISE(ABORT, 'Porkbun slot identity and retirement are permanent'); END;

CREATE TRIGGER porkbun_registrar_connection_no_delete
BEFORE DELETE ON porkbun_registrar_connections
BEGIN SELECT RAISE(ABORT, 'Porkbun slot history is permanent'); END;

CREATE TRIGGER porkbun_registrar_connection_deny_revoked
AFTER UPDATE OF state ON porkbun_registrar_connections
WHEN NEW.state='revoked' AND OLD.state!='revoked'
BEGIN
  UPDATE local_provider_connections SET credential_use_state='revoked'
   WHERE workspace_id=NEW.workspace_id AND connection_id=NEW.connection_id;
END;

CREATE TRIGGER porkbun_registrar_connection_identity_immutable
BEFORE UPDATE ON local_provider_connections
WHEN EXISTS (
  SELECT 1 FROM porkbun_registrar_connections s
  WHERE s.workspace_id=OLD.workspace_id AND s.connection_id=OLD.connection_id
) AND (
  NEW.workspace_id IS NOT OLD.workspace_id OR NEW.connection_id IS NOT OLD.connection_id
  OR NEW.provider_kind IS NOT OLD.provider_kind OR NEW.connection_incarnation_id IS NOT OLD.connection_incarnation_id
  OR NEW.capabilities_json IS NOT OLD.capabilities_json
)
BEGIN SELECT RAISE(ABORT, 'Porkbun slot owns its connection identity'); END;

CREATE TRIGGER porkbun_registrar_connection_publication_insert
BEFORE INSERT ON local_provider_connections
WHEN NEW.provider_kind='porkbun' AND NEW.credential_use_state='active'
BEGIN SELECT RAISE(ABORT, 'Porkbun must prepare a Native slot first'); END;

CREATE TRIGGER porkbun_registrar_connection_publication_update
BEFORE UPDATE ON local_provider_connections
WHEN NEW.provider_kind='porkbun' AND NEW.credential_use_state='active' AND NOT EXISTS (
  SELECT 1 FROM porkbun_registrar_connections s
  WHERE s.workspace_id=NEW.workspace_id AND s.connection_id=NEW.connection_id
    AND s.incarnation_id=NEW.connection_incarnation_id AND s.state='active'
    AND s.purged_at IS NULL AND NEW.revoked_at IS NULL AND NEW.deleted_at IS NULL
    AND NEW.lifecycle_status='active' AND NEW.validation_status='valid'
)
BEGIN SELECT RAISE(ABORT, 'Porkbun requires a published Native slot'); END;

CREATE TABLE porkbun_registrar_scans (
    workspace_id TEXT NOT NULL,
    scan_id TEXT NOT NULL,
    connection_id TEXT NOT NULL,
    observation_run_id TEXT,
    observed_count INTEGER NOT NULL CHECK (observed_count BETWEEN 0 AND 10000),
    imported_count INTEGER NOT NULL CHECK (imported_count >= 0),
    skipped_count INTEGER NOT NULL CHECK (skipped_count >= 0),
    completed_at TEXT NOT NULL,
    PRIMARY KEY (workspace_id, scan_id),
    UNIQUE (workspace_id, observation_run_id),
    FOREIGN KEY (workspace_id, connection_id)
      REFERENCES porkbun_registrar_connections(workspace_id, connection_id) ON DELETE RESTRICT,
    FOREIGN KEY (workspace_id, observation_run_id)
      REFERENCES provider_observation_runs(workspace_id, observation_run_id) ON DELETE RESTRICT,
    CHECK (imported_count + skipped_count <= observed_count),
    CHECK ((observation_run_id IS NULL) = (observed_count = skipped_count))
) STRICT;
CREATE INDEX porkbun_registrar_scan_connection
ON porkbun_registrar_scans(workspace_id, connection_id);

CREATE TRIGGER porkbun_registrar_scan_insert_shape
BEFORE INSERT ON porkbun_registrar_scans
WHEN NOT EXISTS (
  SELECT 1 FROM porkbun_registrar_connections s JOIN local_provider_connections c USING(workspace_id, connection_id)
  WHERE s.workspace_id=NEW.workspace_id AND s.connection_id=NEW.connection_id
    AND s.state='active' AND s.scan_pending=1 AND s.purged_at IS NULL AND c.credential_use_state='active'
    AND c.lifecycle_status='active' AND c.validation_status='valid'
) OR (NEW.observation_run_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM provider_observation_runs r
  WHERE r.workspace_id=NEW.workspace_id AND r.observation_run_id=NEW.observation_run_id
    AND r.connection_id=NEW.connection_id AND r.status='succeeded' AND r.completed_at=NEW.completed_at
    AND r.observation_capability='registrar' AND r.connector_version='porkbun-registrar-v3'
)) OR NEW.observed_count - NEW.skipped_count != (
  SELECT count(*) FROM registrar_observations o
  WHERE o.workspace_id=NEW.workspace_id AND o.observation_run_id=NEW.observation_run_id
    AND o.registrar_name='Porkbun'
)
BEGIN SELECT RAISE(ABORT, 'Porkbun requires an active slot and complete observation'); END;

CREATE TRIGGER porkbun_registrar_scan_no_update BEFORE UPDATE ON porkbun_registrar_scans
BEGIN SELECT RAISE(ABORT, 'Porkbun scan receipts are append-only'); END;

CREATE TRIGGER porkbun_registrar_scan_no_delete BEFORE DELETE ON porkbun_registrar_scans
BEGIN SELECT RAISE(ABORT, 'Porkbun scan receipts are append-only'); END;


-- Existing scan_pending bits did not retain execution authority. Only these new,
-- exactly scoped requests can be recovered automatically.
CREATE TABLE porkbun_registrar_pending_scans (
    workspace_id TEXT NOT NULL,
    connection_id TEXT NOT NULL,
    incarnation_id TEXT NOT NULL,
    device_id TEXT NOT NULL CHECK (
      length(device_id) BETWEEN 1 AND 160 AND device_id NOT GLOB '*[^!-~]*'
    ),
    lease_epoch INTEGER NOT NULL CHECK (lease_epoch BETWEEN 1 AND 9007199254740991),
    request_id TEXT NOT NULL,
    PRIMARY KEY (workspace_id, connection_id),
    UNIQUE (workspace_id, request_id),
    FOREIGN KEY (workspace_id, connection_id)
      REFERENCES porkbun_registrar_connections(workspace_id, connection_id) ON DELETE RESTRICT
) STRICT;

CREATE TRIGGER porkbun_registrar_pending_requires_slot
BEFORE INSERT ON porkbun_registrar_pending_scans
WHEN NOT EXISTS (
  SELECT 1 FROM porkbun_registrar_connections s JOIN local_provider_connections c USING(workspace_id,connection_id)
  WHERE s.workspace_id=NEW.workspace_id AND s.connection_id=NEW.connection_id
    AND s.incarnation_id=NEW.incarnation_id AND c.connection_incarnation_id=s.incarnation_id
    AND c.provider_kind='porkbun' AND c.deleted_at IS NULL AND c.revoked_at IS NULL
    AND s.purged_at IS NULL AND s.scan_pending=1 AND (
      (s.state='prepared' AND c.credential_use_state='inactive' AND c.lifecycle_status='invalid')
      OR (s.state='active' AND c.credential_use_state='active'
          AND c.lifecycle_status='active' AND c.validation_status='valid')
    )
) OR EXISTS (
  SELECT 1 FROM device_handoff_barriers WHERE workspace_id=NEW.workspace_id
) OR EXISTS (
  SELECT 1 FROM porkbun_registrar_scans WHERE workspace_id=NEW.workspace_id AND scan_id=NEW.request_id
)
BEGIN SELECT RAISE(ABORT, 'Porkbun scan requires a current slot and fresh request'); END;

CREATE TRIGGER porkbun_registrar_pending_immutable
BEFORE UPDATE ON porkbun_registrar_pending_scans
BEGIN SELECT RAISE(ABORT, 'Porkbun scan scope is immutable'); END;

CREATE TRIGGER porkbun_registrar_pending_withdraw
AFTER UPDATE OF state ON porkbun_registrar_connections WHEN NEW.state='revoked'
BEGIN
  DELETE FROM porkbun_registrar_pending_scans
  WHERE workspace_id=OLD.workspace_id AND connection_id=OLD.connection_id;
END;

CREATE TRIGGER porkbun_registrar_scan_requires_request
BEFORE INSERT ON porkbun_registrar_scans
WHEN NOT EXISTS (
  SELECT 1 FROM porkbun_registrar_pending_scans p JOIN porkbun_registrar_connections s
    USING(workspace_id,connection_id,incarnation_id)
  WHERE p.workspace_id=NEW.workspace_id AND p.connection_id=NEW.connection_id AND p.request_id=NEW.scan_id
) OR EXISTS (
  SELECT 1 FROM device_handoff_barriers WHERE workspace_id=NEW.workspace_id
)
BEGIN SELECT RAISE(ABORT, 'Porkbun completion requires the durable request'); END;

CREATE TRIGGER porkbun_registrar_scan_consumes_request
AFTER INSERT ON porkbun_registrar_scans
BEGIN
  DELETE FROM porkbun_registrar_pending_scans
  WHERE workspace_id=NEW.workspace_id AND connection_id=NEW.connection_id AND request_id=NEW.scan_id;
END;


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
    UNION ALL
    SELECT s.workspace_id,s.connection_id,s.observation_run_id
    FROM local_provider_connections c JOIN godaddy_registrar_scans s
      ON s.rowid=(
        SELECT max(previous.rowid) FROM godaddy_registrar_scans previous
        WHERE previous.workspace_id=c.workspace_id AND previous.connection_id=c.connection_id
      )
    WHERE c.provider_kind='godaddy' AND c.lifecycle_status='active'
      AND c.credential_use_state='active' AND c.validation_status='valid' AND c.deleted_at IS NULL
    UNION ALL
    SELECT s.workspace_id,s.connection_id,s.observation_run_id
    FROM local_provider_connections c JOIN porkbun_registrar_scans s
      ON s.rowid=(
        SELECT max(previous.rowid) FROM porkbun_registrar_scans previous
        WHERE previous.workspace_id=c.workspace_id AND previous.connection_id=c.connection_id
      )
    WHERE c.provider_kind='porkbun' AND c.lifecycle_status='active'
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
          AND r.connector_version IN ('cloudflare-registrar-v4','spaceship-registrar-v1','aliyun-registrar-v1','godaddy-registrar-v3','porkbun-registrar-v3')
    )
)
SELECT m.workspace_id,m.entity_id,r.registrar_name,r.expires_on,r.auto_renew,r.registrar_lock
FROM managed m LEFT JOIN resolved r USING(workspace_id,entity_id);
