-- Porkbun's official `read` scope covers both the domain list and `/dns/retrieve` (OpenAPI v3.112,
-- recorded in ADR-0027 on 2026-11-24), and the Read-only preset the connect screen recommends
-- grants exactly that scope. One Porkbun connection therefore declares both observation roles; the
-- observation-run trigger admits a DNS run only for a connection that declares `dns`.
--
-- This replaces the `["registrar"]` shape `porkbun_registrar_inventory.sql` pinned. That applied
-- migration stays byte-identical (migration checksums); its two shape triggers are recreated here.

DROP TRIGGER porkbun_registrar_connection_insert_shape;
CREATE TRIGGER porkbun_registrar_connection_insert_shape
BEFORE INSERT ON porkbun_registrar_connections
WHEN NEW.state != 'prepared' OR NEW.purged_at IS NOT NULL OR NOT EXISTS (
  SELECT 1 FROM local_provider_connections c
  WHERE c.workspace_id=NEW.workspace_id AND c.connection_id=NEW.connection_id
    AND c.provider_kind='porkbun' AND c.connection_incarnation_id=NEW.incarnation_id
    AND json(c.capabilities_json)='["dns","registrar"]' AND c.credential_use_state='inactive'
    AND c.lifecycle_status='invalid' AND c.deleted_at IS NULL AND c.revoked_at IS NULL
)
BEGIN SELECT RAISE(ABORT, 'Porkbun slot must start prepared'); END;

-- The identity trigger freezes `capabilities_json`, so it is lifted only for this one rewrite of
-- existing Porkbun slots and recreated unchanged.
DROP TRIGGER porkbun_registrar_connection_identity_immutable;
UPDATE local_provider_connections SET capabilities_json='["dns","registrar"]'
 WHERE provider_kind='porkbun' AND json(capabilities_json)='["registrar"]'
   AND EXISTS (
     SELECT 1 FROM porkbun_registrar_connections s
     WHERE s.workspace_id=local_provider_connections.workspace_id
       AND s.connection_id=local_provider_connections.connection_id
   );
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

-- One Porkbun DNS read of one Zone. A receipt is written only with complete evidence: the run,
-- its single target, the Zone observation and every record commit together or not at all.
CREATE TABLE porkbun_dns_reads (
    workspace_id TEXT NOT NULL,
    observation_run_id TEXT NOT NULL,
    connection_id TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    record_count INTEGER NOT NULL CHECK (record_count BETWEEN 0 AND 1024),
    answered_elsewhere INTEGER NOT NULL CHECK (answered_elsewhere IN (0,1)),
    completed_at TEXT NOT NULL,
    PRIMARY KEY (workspace_id, observation_run_id),
    FOREIGN KEY (workspace_id, connection_id)
      REFERENCES porkbun_registrar_connections(workspace_id, connection_id) ON DELETE RESTRICT,
    FOREIGN KEY (workspace_id, observation_run_id)
      REFERENCES provider_observation_runs(workspace_id, observation_run_id) ON DELETE RESTRICT
) STRICT;
CREATE INDEX porkbun_dns_reads_entity ON porkbun_dns_reads(workspace_id, entity_id);

CREATE TRIGGER porkbun_dns_read_insert_shape
BEFORE INSERT ON porkbun_dns_reads
WHEN NOT EXISTS (
  SELECT 1 FROM porkbun_registrar_connections s JOIN local_provider_connections c USING(workspace_id, connection_id)
  WHERE s.workspace_id=NEW.workspace_id AND s.connection_id=NEW.connection_id
    AND s.state='active' AND s.purged_at IS NULL AND c.credential_use_state='active'
    AND c.lifecycle_status='active' AND c.validation_status='valid'
    AND json(c.capabilities_json)='["dns","registrar"]'
) OR NOT EXISTS (
  SELECT 1 FROM provider_observation_runs r
  WHERE r.workspace_id=NEW.workspace_id AND r.observation_run_id=NEW.observation_run_id
    AND r.connection_id=NEW.connection_id AND r.status='succeeded' AND r.completed_at=NEW.completed_at
    AND r.observation_capability='dns' AND r.connector_version='porkbun-dns-v3'
) OR NEW.record_count != (
  SELECT count(*) FROM dns_record_observations d JOIN dns_zone_observations z USING(workspace_id, zone_observation_id)
  WHERE z.workspace_id=NEW.workspace_id AND z.observation_run_id=NEW.observation_run_id
    AND z.entity_id=NEW.entity_id
) OR NOT EXISTS (
  SELECT 1 FROM dns_zone_observations z
  WHERE z.workspace_id=NEW.workspace_id AND z.observation_run_id=NEW.observation_run_id
    AND z.entity_id=NEW.entity_id
    AND z.evidence_status=CASE NEW.answered_elsewhere WHEN 1 THEN 'conflicted' ELSE 'confirmed' END
)
BEGIN SELECT RAISE(ABORT, 'Porkbun DNS read requires an active slot and complete observation'); END;

CREATE TRIGGER porkbun_dns_read_no_update BEFORE UPDATE ON porkbun_dns_reads
BEGIN SELECT RAISE(ABORT, 'Porkbun DNS read receipts are append-only'); END;

CREATE TRIGGER porkbun_dns_read_no_delete BEFORE DELETE ON porkbun_dns_reads
BEGIN SELECT RAISE(ABORT, 'Porkbun DNS read receipts are append-only'); END;
