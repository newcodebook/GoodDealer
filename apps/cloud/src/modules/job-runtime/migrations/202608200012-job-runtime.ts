import type { CloudMigration } from "../../../db/index";

const tenantPolicy = (table: string) => `
  ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
  ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;
  CREATE POLICY ${table}_tenant ON ${table}
    USING (
      CURRENT_USER = 'gooddealer_cloud_owner'
      OR (account_id = current_setting('gooddealer.account_id', true)
        AND workspace_id = current_setting('gooddealer.workspace_id', true))
    )
    WITH CHECK (
      CURRENT_USER = 'gooddealer_cloud_owner'
      OR (account_id = current_setting('gooddealer.account_id', true)
        AND workspace_id = current_setting('gooddealer.workspace_id', true))
    );
  GRANT SELECT, INSERT, UPDATE ON ${table} TO gooddealer_cloud_app;
`;

export const jobRuntimeMigration: CloudMigration = {
  id: "202608200012-job-runtime",
  owner: "job-runtime",
  sql: `
    CREATE TABLE job_runtime_jobs (
      account_id text NOT NULL CHECK (account_id ~ '^[!-~]{1,160}$'),
      workspace_id text NOT NULL CHECK (workspace_id ~ '^[!-~]{1,160}$'),
      job_id text NOT NULL CHECK (job_id ~ '^[!-~]{1,160}$'),
      job_kind text NOT NULL CHECK (job_kind ~ '^[!-~]{1,160}$'),
      target_module text NOT NULL CHECK (target_module ~ '^[!-~]{1,160}$'),
      payload_version bigint NOT NULL CHECK (payload_version BETWEEN 1 AND 9007199254740991),
      partition_key text NOT NULL CHECK (partition_key ~ '^[!-~]{1,160}$'),
      idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[!-~]{1,160}$'),
      trigger_kind text NOT NULL CHECK (trigger_kind IN ('authenticated_public', 'admin_action', 'system_fan_out', 'compliance_deletion')),
      trigger_ref text NOT NULL CHECK (trigger_ref ~ '^[!-~]{1,160}$'),
      authorization_kind text NOT NULL CHECK (authorization_kind IN ('public_session', 'admin_action', 'system_policy', 'data_rights_request')),
      authorization_ref text NOT NULL CHECK (authorization_ref ~ '^[!-~]{1,160}$'),
      authorization_revision bigint NOT NULL CHECK (authorization_revision BETWEEN 1 AND 9007199254740991),
      authorization_digest bytea NOT NULL CHECK (octet_length(authorization_digest) = 32),
      canonical_payload bytea NOT NULL CHECK (octet_length(canonical_payload) BETWEEN 1 AND 65536),
      payload_digest bytea NOT NULL CHECK (octet_length(payload_digest) = 32),
      request_digest bytea NOT NULL CHECK (octet_length(request_digest) = 32),
      runtime_policy_id text NOT NULL CHECK (runtime_policy_id ~ '^[!-~]{1,160}$'),
      runtime_policy_version bigint NOT NULL CHECK (runtime_policy_version BETWEEN 1 AND 9007199254740991),
      max_attempts integer NOT NULL CHECK (max_attempts BETWEEN 1 AND 100),
      attempt_timeout_seconds integer NOT NULL CHECK (attempt_timeout_seconds BETWEEN 1 AND 86400),
      lease_seconds integer NOT NULL CHECK (lease_seconds BETWEEN 1 AND 3600 AND lease_seconds <= attempt_timeout_seconds),
      base_backoff_seconds integer NOT NULL CHECK (base_backoff_seconds BETWEEN 1 AND 86400),
      retry_mode text NOT NULL CHECK (retry_mode IN ('database_safe', 'manual_only')),
      state text NOT NULL DEFAULT 'available' CHECK (state IN ('available', 'leased', 'retry_wait', 'completed', 'quarantined')),
      available_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
      attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 100),
      lease_epoch bigint NOT NULL DEFAULT 0 CHECK (lease_epoch BETWEEN 0 AND 9007199254740991),
      current_worker text,
      lease_acquired_at timestamptz,
      lease_renewed_at timestamptz,
      lease_expires_at timestamptz,
      attempt_deadline_at timestamptz,
      replay_generation bigint NOT NULL DEFAULT 0 CHECK (replay_generation BETWEEN 0 AND 9007199254740991),
      terminal_at timestamptz,
      terminal_outcome_digest bytea CHECK (terminal_outcome_digest IS NULL OR octet_length(terminal_outcome_digest) = 32),
      enqueued_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
      PRIMARY KEY (account_id, workspace_id, job_id),
      UNIQUE (account_id, workspace_id, job_kind, idempotency_key),
      CHECK ((state = 'leased') = (current_worker IS NOT NULL)),
      CHECK ((state = 'leased') = (lease_acquired_at IS NOT NULL)),
      CHECK ((state = 'leased') = (lease_expires_at IS NOT NULL)),
      CHECK ((state = 'leased') = (attempt_deadline_at IS NOT NULL)),
      CHECK (current_worker IS NULL OR current_worker ~ '^[!-~]{1,160}$')
    );

    CREATE TABLE job_runtime_partition_leases (
      account_id text NOT NULL,
      workspace_id text NOT NULL,
      job_kind text NOT NULL,
      partition_key text NOT NULL,
      current_job_id text,
      current_worker text,
      highest_lease_epoch bigint NOT NULL DEFAULT 0 CHECK (highest_lease_epoch BETWEEN 0 AND 9007199254740991),
      current_lease_epoch bigint,
      state text NOT NULL CHECK (state IN ('held', 'renewed', 'released', 'expired')),
      acquired_at timestamptz,
      renewed_at timestamptz,
      expires_at timestamptz,
      PRIMARY KEY (account_id, workspace_id, job_kind, partition_key),
      FOREIGN KEY (account_id, workspace_id, current_job_id)
        REFERENCES job_runtime_jobs(account_id, workspace_id, job_id),
      CHECK (current_lease_epoch IS NULL OR current_lease_epoch BETWEEN 1 AND highest_lease_epoch),
      CHECK ((state IN ('held', 'renewed')) = (current_job_id IS NOT NULL)),
      CHECK ((state IN ('held', 'renewed')) = (current_worker IS NOT NULL)),
      CHECK ((state IN ('held', 'renewed')) = (expires_at IS NOT NULL))
    );

    CREATE TABLE job_runtime_attempts (
      account_id text NOT NULL,
      workspace_id text NOT NULL,
      job_id text NOT NULL,
      attempt_no integer NOT NULL CHECK (attempt_no BETWEEN 1 AND 100),
      lease_epoch bigint NOT NULL CHECK (lease_epoch BETWEEN 1 AND 9007199254740991),
      worker_id text NOT NULL CHECK (worker_id ~ '^[!-~]{1,160}$'),
      started_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
      deadline_at timestamptz NOT NULL,
      finished_at timestamptz,
      outcome text NOT NULL CHECK (outcome IN ('running', 'succeeded', 'retry_scheduled', 'lease_expired', 'quarantined')),
      error_class text CHECK (error_class IS NULL OR error_class ~ '^[a-z0-9_]{1,80}$'),
      next_retry_at timestamptz,
      PRIMARY KEY (account_id, workspace_id, job_id, attempt_no),
      UNIQUE (account_id, workspace_id, job_id, lease_epoch),
      FOREIGN KEY (account_id, workspace_id, job_id)
        REFERENCES job_runtime_jobs(account_id, workspace_id, job_id)
    );

    CREATE TABLE job_runtime_quarantine_events (
      account_id text NOT NULL,
      workspace_id text NOT NULL,
      job_id text NOT NULL,
      quarantine_id text NOT NULL CHECK (quarantine_id ~ '^[!-~]{1,160}$'),
      quarantine_revision bigint NOT NULL CHECK (quarantine_revision BETWEEN 1 AND 9007199254740991),
      reason text NOT NULL CHECK (reason IN ('unknown_envelope', 'cross_tenant_violation', 'replay_conflict', 'idempotency_conflict', 'lease_contention', 'stale_lease_epoch', 'max_attempts_exhausted', 'payload_schema_invalid')),
      captured_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
      frozen_request_digest bytea NOT NULL CHECK (octet_length(frozen_request_digest) = 32),
      frozen_payload_digest bytea NOT NULL CHECK (octet_length(frozen_payload_digest) = 32),
      frozen_authorization_digest bytea NOT NULL CHECK (octet_length(frozen_authorization_digest) = 32),
      frozen_idempotency_digest bytea NOT NULL CHECK (octet_length(frozen_idempotency_digest) = 32),
      incoming_request_digest bytea CHECK (incoming_request_digest IS NULL OR octet_length(incoming_request_digest) = 32),
      lease_epoch bigint NOT NULL CHECK (lease_epoch BETWEEN 0 AND 9007199254740991),
      attempt_no integer NOT NULL CHECK (attempt_no BETWEEN 0 AND 100),
      disposition text NOT NULL DEFAULT 'pending_human_review' CHECK (disposition = 'pending_human_review'),
      PRIMARY KEY (account_id, workspace_id, job_id, quarantine_id),
      UNIQUE (account_id, workspace_id, job_id, quarantine_revision),
      FOREIGN KEY (account_id, workspace_id, job_id)
        REFERENCES job_runtime_jobs(account_id, workspace_id, job_id)
    );

    CREATE TABLE job_runtime_replay_events (
      account_id text NOT NULL,
      workspace_id text NOT NULL,
      job_id text NOT NULL,
      quarantine_id text NOT NULL,
      replay_generation bigint NOT NULL CHECK (replay_generation BETWEEN 1 AND 9007199254740991),
      replay_authorization_kind text NOT NULL CHECK (replay_authorization_kind = 'admin_action'),
      replay_authorization_ref text NOT NULL CHECK (replay_authorization_ref ~ '^[!-~]{1,160}$'),
      replay_authorization_revision bigint NOT NULL CHECK (replay_authorization_revision BETWEEN 1 AND 9007199254740991),
      replay_authorization_digest bytea NOT NULL CHECK (octet_length(replay_authorization_digest) = 32),
      requested_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
      decided_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
      outcome text NOT NULL CHECK (outcome IN ('requeued', 'authorization_rejected', 'revision_conflict')),
      PRIMARY KEY (account_id, workspace_id, job_id, quarantine_id, replay_generation),
      FOREIGN KEY (account_id, workspace_id, job_id, quarantine_id)
        REFERENCES job_runtime_quarantine_events(account_id, workspace_id, job_id, quarantine_id)
    );

    CREATE INDEX job_runtime_due_jobs ON job_runtime_jobs
      (account_id, workspace_id, state, available_at, enqueued_at, job_id);
    CREATE INDEX job_runtime_quarantine_tenant ON job_runtime_quarantine_events
      (account_id, workspace_id, captured_at, quarantine_id);

    ${tenantPolicy("job_runtime_jobs")}
    ${tenantPolicy("job_runtime_partition_leases")}
    ${tenantPolicy("job_runtime_attempts")}
    ${tenantPolicy("job_runtime_quarantine_events")}
    ${tenantPolicy("job_runtime_replay_events")}
  `,
};
