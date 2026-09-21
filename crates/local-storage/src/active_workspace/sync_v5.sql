CREATE TABLE native_cloud_checkpoint_state (
    workspace_id TEXT PRIMARY KEY,
    checkpoint_due INTEGER NOT NULL DEFAULT 1 CHECK (checkpoint_due IN (0, 1)),
    checkpoint_id TEXT,
    checkpoint_schema_version INTEGER CHECK (
      checkpoint_schema_version IS NULL OR checkpoint_schema_version BETWEEN 1 AND 9007199254740991
    ),
    through_server_revision INTEGER CHECK (
      through_server_revision IS NULL OR through_server_revision BETWEEN 0 AND 9007199254740991
    ),
    workspace_schema_version INTEGER CHECK (
      workspace_schema_version IS NULL OR workspace_schema_version BETWEEN 1 AND 9007199254740991
    ),
    checkpoint_digest TEXT CHECK (
      checkpoint_digest IS NULL OR (
        length(checkpoint_digest) = 43
        AND checkpoint_digest NOT GLOB '*[^A-Za-z0-9_-]*'
      )
    ),
    checked_at TEXT,
    FOREIGN KEY (workspace_id) REFERENCES active_workspace_metadata(workspace_id) ON DELETE CASCADE,
    CHECK (
      (checkpoint_id IS NULL AND checkpoint_schema_version IS NULL
        AND through_server_revision IS NULL AND workspace_schema_version IS NULL
        AND checkpoint_digest IS NULL)
      OR (checkpoint_id IS NOT NULL AND checkpoint_schema_version IS NOT NULL
        AND through_server_revision IS NOT NULL AND workspace_schema_version IS NOT NULL
        AND checkpoint_digest IS NOT NULL)
    )
  ) STRICT;
