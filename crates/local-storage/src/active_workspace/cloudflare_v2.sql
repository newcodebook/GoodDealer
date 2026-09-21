ALTER TABLE dns_zone_observations ADD COLUMN cloudflare_zone_status TEXT
  CHECK (cloudflare_zone_status IS NULL OR cloudflare_zone_status IN ('active', 'pending', 'unknown'));

CREATE TABLE cloudflare_dns_source_heads (
    workspace_id TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    lease_epoch INTEGER NOT NULL CHECK (lease_epoch BETWEEN 1 AND 9007199254740991),
    source_sequence INTEGER NOT NULL CHECK (source_sequence BETWEEN 0 AND 9007199254740991),
    updated_at TEXT NOT NULL,
    PRIMARY KEY (workspace_id, entity_id),
    FOREIGN KEY (workspace_id, entity_id)
      REFERENCES domain_assets(workspace_id, entity_id) ON DELETE CASCADE
) STRICT;

CREATE TABLE cloudflare_dns_projection_outbox (
    workspace_id TEXT NOT NULL,
    observation_id TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    lease_epoch INTEGER NOT NULL CHECK (lease_epoch BETWEEN 1 AND 9007199254740991),
    source_sequence INTEGER NOT NULL CHECK (source_sequence BETWEEN 1 AND 9007199254740991),
    observed_at TEXT NOT NULL,
    projection_json TEXT NOT NULL CHECK (json_valid(projection_json) AND json_type(projection_json) = 'object' AND length(CAST(projection_json AS BLOB)) <= 65536),
    canonical_request_digest TEXT NOT NULL CHECK (length(canonical_request_digest) = 64 AND canonical_request_digest NOT GLOB '*[^0-9a-f]*'),
    state TEXT NOT NULL CHECK (state IN ('pending', 'sending', 'acknowledged', 'rejected')),
    delivery_owner TEXT,
    delivery_lease_expires_at TEXT,
    delivery_attempt_fence INTEGER NOT NULL DEFAULT 0 CHECK (delivery_attempt_fence BETWEEN 0 AND 9007199254740991),
    next_attempt_at TEXT,
    last_error_code TEXT,
    observation_sequence INTEGER CHECK (observation_sequence IS NULL OR observation_sequence BETWEEN 1 AND 9007199254740991),
    disposition TEXT CHECK (disposition IS NULL OR disposition IN ('current', 'stale')),
    acknowledged_at TEXT,
    PRIMARY KEY (workspace_id, observation_id),
    FOREIGN KEY (workspace_id, entity_id) REFERENCES domain_assets(workspace_id, entity_id) ON DELETE RESTRICT,
    CHECK ((state = 'acknowledged') = (acknowledged_at IS NOT NULL AND observation_sequence IS NOT NULL AND disposition IS NOT NULL)),
    CHECK ((delivery_owner IS NULL) = (delivery_lease_expires_at IS NULL))
) STRICT;

CREATE INDEX cloudflare_dns_projection_outbox_pending
  ON cloudflare_dns_projection_outbox(workspace_id, state, observed_at, observation_id);

CREATE INDEX cloudflare_dns_projection_outbox_delivery
  ON cloudflare_dns_projection_outbox(
    workspace_id,
    state,
    next_attempt_at,
    delivery_lease_expires_at,
    lease_epoch,
    source_sequence
  );

CREATE TABLE cloudflare_dns_projection_heads (
    workspace_id TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    lease_epoch INTEGER NOT NULL CHECK (lease_epoch BETWEEN 1 AND 9007199254740991),
    source_sequence INTEGER NOT NULL CHECK (source_sequence BETWEEN 1 AND 9007199254740991),
    observation_id TEXT NOT NULL,
    observed_at TEXT NOT NULL,
    projection_digest TEXT NOT NULL CHECK (length(projection_digest) = 64 AND projection_digest NOT GLOB '*[^0-9a-f]*'),
    updated_at TEXT NOT NULL,
    PRIMARY KEY (workspace_id, entity_id),
    FOREIGN KEY (workspace_id, entity_id) REFERENCES domain_assets(workspace_id, entity_id) ON DELETE CASCADE
) STRICT;

CREATE TRIGGER cloudflare_dns_source_heads_monotonic
BEFORE UPDATE ON cloudflare_dns_source_heads
WHEN NOT (
  (NEW.lease_epoch = OLD.lease_epoch AND NEW.source_sequence = OLD.source_sequence + 1)
  OR (NEW.lease_epoch > OLD.lease_epoch AND NEW.source_sequence = 1)
)
BEGIN SELECT RAISE(ABORT, 'invalid Cloudflare DNS source transition'); END;

CREATE TRIGGER cloudflare_dns_projection_outbox_identity_immutable
BEFORE UPDATE ON cloudflare_dns_projection_outbox
WHEN NEW.workspace_id IS NOT OLD.workspace_id
  OR NEW.observation_id IS NOT OLD.observation_id
  OR NEW.entity_id IS NOT OLD.entity_id
  OR NEW.lease_epoch IS NOT OLD.lease_epoch
  OR NEW.source_sequence IS NOT OLD.source_sequence
  OR NEW.observed_at IS NOT OLD.observed_at
  OR NEW.projection_json IS NOT OLD.projection_json
  OR NEW.canonical_request_digest IS NOT OLD.canonical_request_digest
BEGIN SELECT RAISE(ABORT, 'Cloudflare DNS projection identity is immutable'); END;

CREATE TRIGGER cloudflare_dns_projection_heads_monotonic
BEFORE UPDATE ON cloudflare_dns_projection_heads
WHEN NOT (
  NEW.lease_epoch > OLD.lease_epoch
  OR (NEW.lease_epoch = OLD.lease_epoch AND NEW.source_sequence > OLD.source_sequence)
)
BEGIN SELECT RAISE(ABORT, 'invalid Cloudflare DNS projection head transition'); END;
