ALTER TABLE registrar_observations ADD COLUMN observed_asset_generation INTEGER
    CHECK (observed_asset_generation IS NULL OR observed_asset_generation BETWEEN 1 AND 9007199254740991);

CREATE TRIGGER registrar_observations_asset_generation_insert
BEFORE INSERT ON registrar_observations
WHEN NEW.observed_asset_generation IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM domain_assets a
    WHERE a.workspace_id=NEW.workspace_id AND a.entity_id=NEW.entity_id
      AND a.entity_generation=NEW.observed_asset_generation AND a.deleted_at IS NULL
)
BEGIN SELECT RAISE(ABORT, 'registrar observation must match the current asset generation'); END;

CREATE INDEX registrar_observations_by_inventory_run
ON registrar_observations(workspace_id,observation_run_id);

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
