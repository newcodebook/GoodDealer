CREATE TABLE domain_asset_provider_bindings (
    workspace_id TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    connection_id TEXT NOT NULL,
    provider_kind TEXT NOT NULL CHECK (length(provider_kind) BETWEEN 1 AND 64),
    resource_kind TEXT NOT NULL CHECK (resource_kind IN ('zone', 'registration')),
    resource_binding_digest TEXT NOT NULL CHECK (
      length(resource_binding_digest) = 64
      AND resource_binding_digest NOT GLOB '*[^0-9a-f]*'
    ),
    observation_digest TEXT NOT NULL CHECK (
      length(observation_digest) = 64
      AND observation_digest NOT GLOB '*[^0-9a-f]*'
    ),
    resource_label TEXT NOT NULL CHECK (
      length(resource_label) BETWEEN 1 AND 253
      AND resource_label = lower(resource_label)
      AND resource_label NOT GLOB '*[[:cntrl:]]'
    ),
    binding_generation INTEGER NOT NULL CHECK (binding_generation BETWEEN 1 AND 9007199254740991),
    local_commit_sequence INTEGER NOT NULL CHECK (local_commit_sequence BETWEEN 1 AND 9007199254740991),
    validation_status TEXT NOT NULL CHECK (
      validation_status IN ('unverified', 'verified', 'stale', 'conflicted', 'detached')
    ),
    verified_at TEXT,
    last_observed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (workspace_id, entity_id, resource_kind),
    FOREIGN KEY (workspace_id, entity_id)
      REFERENCES domain_assets(workspace_id, entity_id) ON DELETE CASCADE,
    FOREIGN KEY (workspace_id, connection_id)
      REFERENCES local_provider_connections(workspace_id, connection_id) ON DELETE RESTRICT,
    CHECK ((validation_status = 'verified') = (verified_at IS NOT NULL)),
    CHECK (validation_status = 'detached' OR updated_at >= created_at)
  ) STRICT;

CREATE INDEX domain_asset_provider_bindings_by_connection
  ON domain_asset_provider_bindings(workspace_id, connection_id, resource_kind, entity_id);

CREATE INDEX domain_asset_provider_bindings_by_resource
  ON domain_asset_provider_bindings(
    workspace_id, connection_id, resource_kind, resource_binding_digest, entity_id
  );

CREATE TRIGGER domain_asset_provider_bindings_identity_immutable
BEFORE UPDATE ON domain_asset_provider_bindings
WHEN NEW.workspace_id IS NOT OLD.workspace_id
  OR NEW.entity_id IS NOT OLD.entity_id
  OR NEW.connection_id IS NOT OLD.connection_id
  OR NEW.provider_kind IS NOT OLD.provider_kind
  OR NEW.resource_kind IS NOT OLD.resource_kind
  OR NEW.resource_binding_digest IS NOT OLD.resource_binding_digest
  OR NEW.resource_label IS NOT OLD.resource_label
BEGIN
  SELECT RAISE(ABORT, 'provider binding identity is immutable');
END;

CREATE TRIGGER domain_asset_provider_bindings_no_delete
BEFORE DELETE ON domain_asset_provider_bindings
BEGIN
  SELECT RAISE(ABORT, 'provider binding deletion is unavailable');
END;
