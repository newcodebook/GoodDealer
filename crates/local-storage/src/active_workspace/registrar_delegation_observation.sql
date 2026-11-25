-- Registry nameserver sets read through a registrar connection (today Porkbun `getNs`). Each row is
-- one complete read of one asset; DNS health compares the latest with the Zone's own nameservers.
-- Rows stay local and are never updated. The Host admits a read only for an asset in the
-- connection's latest inventory; the trigger below re-checks what SQLite can see on its own.
CREATE TABLE registrar_delegation_observations (
    workspace_id TEXT NOT NULL,
    delegation_observation_id TEXT NOT NULL CHECK (length(delegation_observation_id) BETWEEN 1 AND 128),
    entity_id TEXT NOT NULL,
    connection_id TEXT NOT NULL,
    -- Lowercased, sorted, duplicate-free host names; empty when the registry lists none.
    nameservers_json TEXT NOT NULL CHECK (
      json_valid(nameservers_json) AND json_type(nameservers_json) = 'array'
      AND json_array_length(nameservers_json) <= 16 AND length(CAST(nameservers_json AS BLOB)) <= 4096
    ),
    observed_at TEXT NOT NULL,
    PRIMARY KEY (workspace_id, delegation_observation_id),
    FOREIGN KEY (workspace_id, entity_id)
      REFERENCES domain_assets(workspace_id, entity_id) ON DELETE CASCADE,
    FOREIGN KEY (workspace_id, connection_id)
      REFERENCES local_provider_connections(workspace_id, connection_id) ON DELETE RESTRICT
) STRICT;

CREATE INDEX registrar_delegation_observations_entity
  ON registrar_delegation_observations(workspace_id, entity_id, observed_at);

CREATE TRIGGER registrar_delegation_observation_insert_shape
BEFORE INSERT ON registrar_delegation_observations
WHEN NOT EXISTS (
  SELECT 1 FROM porkbun_registrar_connections s JOIN local_provider_connections c USING(workspace_id, connection_id)
  WHERE s.workspace_id=NEW.workspace_id AND s.connection_id=NEW.connection_id
    AND s.state='active' AND s.purged_at IS NULL AND c.credential_use_state='active'
    AND c.lifecycle_status='active' AND c.validation_status='valid'
    AND EXISTS (SELECT 1 FROM json_each(c.capabilities_json) WHERE value='registrar')
) OR NOT EXISTS (
  SELECT 1 FROM domain_assets a
  WHERE a.workspace_id=NEW.workspace_id AND a.entity_id=NEW.entity_id AND a.deleted_at IS NULL
) OR EXISTS (
  SELECT 1 FROM json_each(NEW.nameservers_json) n
  WHERE n.type <> 'text' OR length(n.value) NOT BETWEEN 3 AND 253 OR n.value NOT LIKE '%.%'
    OR n.value GLOB '*[^a-z0-9.-]*' OR n.value GLOB '.*' OR n.value GLOB '*.'
    OR n.value GLOB '*..*' OR n.value GLOB '-*' OR n.value GLOB '*-' OR n.value GLOB '*.-*'
    OR n.value GLOB '*-.*'
) OR NEW.observed_at NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*Z' OR (
  SELECT count(DISTINCT value) FROM json_each(NEW.nameservers_json)
) <> json_array_length(NEW.nameservers_json)
BEGIN SELECT RAISE(ABORT, 'registrar delegation requires an active Porkbun slot, a live asset and host names'); END;

CREATE TRIGGER registrar_delegation_observation_no_update
BEFORE UPDATE ON registrar_delegation_observations
BEGIN SELECT RAISE(ABORT, 'registrar delegation observations are append-only'); END;
