import type { CloudMigration } from "../../../db/index";

const accountPolicy = (table: string) => `
  ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
  ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;
  CREATE POLICY ${table}_account_scope ON ${table}
    USING (CURRENT_USER = 'gooddealer_cloud_owner' OR account_id = current_setting('gooddealer.account_id', true))
    WITH CHECK (CURRENT_USER = 'gooddealer_cloud_owner' OR account_id = current_setting('gooddealer.account_id', true));`;

const workspacePolicy = (table: string) => `
  ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
  ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;
  CREATE POLICY ${table}_tenant_scope ON ${table}
    USING (CURRENT_USER = 'gooddealer_cloud_owner' OR (account_id = current_setting('gooddealer.account_id', true)
      AND workspace_id = current_setting('gooddealer.workspace_id', true)))
    WITH CHECK (CURRENT_USER = 'gooddealer_cloud_owner' OR (account_id = current_setting('gooddealer.account_id', true)
      AND workspace_id = current_setting('gooddealer.workspace_id', true)));`;

export const deviceControlMigration: CloudMigration = {
  id: "202608200004-device-control",
  owner: "devices",
  sql: `
    CREATE TABLE device_account_states (
      account_id text PRIMARY KEY CHECK (account_id ~ '^[!-~]{1,160}$'),
      binding_list_revision bigint NOT NULL DEFAULT 1 CHECK (binding_list_revision BETWEEN 1 AND 9007199254740991),
      highest_allocated_lease_epoch bigint NOT NULL DEFAULT 0 CHECK (highest_allocated_lease_epoch BETWEEN 0 AND 9007199254740991),
      current_lease_epoch bigint NOT NULL DEFAULT 0 CHECK (current_lease_epoch BETWEEN 0 AND highest_allocated_lease_epoch),
      exclusive_execution_block_until timestamptz,
      updated_at timestamptz NOT NULL DEFAULT transaction_timestamp()
    );
    CREATE TABLE device_bindings (
      account_id text NOT NULL REFERENCES device_account_states(account_id) ON DELETE CASCADE,
      device_id text NOT NULL CHECK (device_id ~ '^[!-~]{1,160}$'),
      slot smallint CHECK (slot IN (1, 2)),
      status text NOT NULL CHECK (status IN ('bound', 'removed')),
      credential_epoch bigint NOT NULL CHECK (credential_epoch BETWEEN 1 AND 9007199254740991),
      bound_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
      removed_at timestamptz,
      removal_reason text,
      PRIMARY KEY (account_id, device_id),
      UNIQUE (account_id, slot),
      CHECK ((status = 'bound' AND slot IS NOT NULL AND removed_at IS NULL AND removal_reason IS NULL)
        OR (status = 'removed' AND slot IS NULL AND removed_at IS NOT NULL AND removal_reason IS NOT NULL))
    );
    CREATE TABLE device_signing_keys (
      account_id text NOT NULL,
      device_id text NOT NULL,
      key_version bigint NOT NULL CHECK (key_version BETWEEN 1 AND 9007199254740991),
      key_id text NOT NULL UNIQUE CHECK (key_id ~ '^[!-~]{1,200}$'),
      public_key bytea NOT NULL CHECK (octet_length(public_key) = 32),
      fingerprint bytea NOT NULL CHECK (octet_length(fingerprint) = 32),
      status text NOT NULL CHECK (status IN ('active', 'rotated', 'revoked')),
      created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
      retired_at timestamptz,
      PRIMARY KEY (account_id, device_id, key_version),
      FOREIGN KEY (account_id, device_id) REFERENCES device_bindings(account_id, device_id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX device_signing_keys_one_active
      ON device_signing_keys(account_id, device_id) WHERE status = 'active';
    CREATE TABLE device_identity_challenges (
      account_id text NOT NULL REFERENCES device_account_states(account_id) ON DELETE CASCADE,
      challenge_id text NOT NULL CHECK (challenge_id ~ '^[!-~]{1,200}$'),
      device_id text NOT NULL,
      purpose text NOT NULL CHECK (purpose IN ('bind', 'rotate', 'revoke')),
      expected_key_version bigint CHECK (expected_key_version BETWEEN 1 AND 9007199254740991),
      proposed_key_id text,
      proposed_public_key bytea CHECK (proposed_public_key IS NULL OR octet_length(proposed_public_key) = 32),
      proposed_fingerprint bytea CHECK (proposed_fingerprint IS NULL OR octet_length(proposed_fingerprint) = 32),
      nonce_digest bytea NOT NULL UNIQUE CHECK (octet_length(nonce_digest) = 32),
      expires_at timestamptz NOT NULL,
      consumed_at timestamptz,
      verdict text CHECK (verdict IN ('accepted', 'rejected')),
      PRIMARY KEY (account_id, challenge_id),
      CHECK ((consumed_at IS NULL) = (verdict IS NULL))
    );
    CREATE TABLE device_switch_workflows (
      account_id text NOT NULL REFERENCES device_account_states(account_id) ON DELETE CASCADE,
      workspace_id text NOT NULL CHECK (workspace_id ~ '^[!-~]{1,160}$'),
      workflow_id text NOT NULL CHECK (workflow_id ~ '^[!-~]{1,200}$'),
      purpose text NOT NULL CHECK (purpose IN ('first_device', 'device_switch', 'recovery_activation')),
      mode text NOT NULL CHECK (mode IN ('normal', 'forced')),
      request_digest bytea NOT NULL CHECK (octet_length(request_digest) = 32),
      idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[!-~]{1,200}$'),
      status text NOT NULL CHECK (status IN ('requested', 'draining', 'waiting_expiry', 'bootstrapping', 'completed', 'cancelled', 'failed')),
      workflow_revision bigint NOT NULL CHECK (workflow_revision BETWEEN 1 AND 9007199254740991),
      from_device_id text,
      to_device_id text NOT NULL,
      bound_key_id text NOT NULL,
      bound_key_version bigint NOT NULL CHECK (bound_key_version BETWEEN 1 AND 9007199254740991),
      bound_account_security_epoch bigint NOT NULL CHECK (bound_account_security_epoch BETWEEN 1 AND 9007199254740991),
      pending_lease_epoch bigint,
      state_deadline timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
      updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
      PRIMARY KEY (account_id, workspace_id, workflow_id),
      UNIQUE (account_id, idempotency_key),
      CHECK ((status = 'bootstrapping') = (pending_lease_epoch IS NOT NULL))
    );
    CREATE UNIQUE INDEX device_switch_workflows_one_nonterminal
      ON device_switch_workflows(account_id)
      WHERE status IN ('requested', 'draining', 'waiting_expiry', 'bootstrapping');
    CREATE TABLE device_bootstrap_capabilities (
      account_id text NOT NULL,
      workspace_id text NOT NULL,
      workflow_id text NOT NULL,
      jti text NOT NULL UNIQUE CHECK (jti ~ '^[!-~]{1,200}$'),
      target_device_id text NOT NULL,
      issued_at timestamptz NOT NULL,
      expires_at timestamptz NOT NULL,
      consumed_at timestamptz,
      consumed_reason text CHECK (consumed_reason IN ('activated', 'cancelled', 'expired', 'failed')),
      PRIMARY KEY (account_id, workspace_id, workflow_id),
      FOREIGN KEY (account_id, workspace_id, workflow_id)
        REFERENCES device_switch_workflows(account_id, workspace_id, workflow_id) ON DELETE CASCADE,
      CHECK (expires_at > issued_at),
      CHECK ((consumed_at IS NULL) = (consumed_reason IS NULL))
    );
    CREATE TABLE device_bootstrap_steps (
      account_id text NOT NULL,
      workspace_id text NOT NULL,
      workflow_id text NOT NULL,
      step_number bigint NOT NULL CHECK (step_number BETWEEN 1 AND 9007199254740991),
      nonce_digest bytea NOT NULL UNIQUE CHECK (octet_length(nonce_digest) = 32),
      request_digest bytea NOT NULL CHECK (octet_length(request_digest) = 32),
      canonical_result bytea NOT NULL,
      result_digest bytea NOT NULL CHECK (octet_length(result_digest) = 32),
      accepted_workflow_revision bigint NOT NULL CHECK (accepted_workflow_revision BETWEEN 1 AND 9007199254740991),
      accepted_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
      PRIMARY KEY (account_id, workspace_id, workflow_id, step_number),
      FOREIGN KEY (account_id, workspace_id, workflow_id)
        REFERENCES device_switch_workflows(account_id, workspace_id, workflow_id) ON DELETE CASCADE
    );
    CREATE TABLE device_lease_epoch_allocations (
      account_id text NOT NULL REFERENCES device_account_states(account_id) ON DELETE CASCADE,
      lease_epoch bigint NOT NULL CHECK (lease_epoch BETWEEN 1 AND 9007199254740991),
      workspace_id text NOT NULL,
      workflow_id text NOT NULL,
      status text NOT NULL CHECK (status IN ('pending', 'burned', 'activated')),
      allocated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
      terminal_at timestamptz,
      PRIMARY KEY (account_id, lease_epoch),
      UNIQUE (account_id, workflow_id),
      CHECK ((status = 'pending') = (terminal_at IS NULL))
    );
    CREATE TABLE device_active_leases (
      account_id text NOT NULL REFERENCES device_account_states(account_id) ON DELETE CASCADE,
      lease_epoch bigint NOT NULL,
      device_id text NOT NULL,
      jti text NOT NULL UNIQUE,
      issued_at timestamptz NOT NULL,
      renew_after timestamptz NOT NULL,
      online_expires_at timestamptz NOT NULL,
      offline_execute_until timestamptz NOT NULL,
      signed_envelope bytea NOT NULL,
      released_at timestamptz,
      release_reason text,
      PRIMARY KEY (account_id, lease_epoch),
      FOREIGN KEY (account_id, lease_epoch) REFERENCES device_lease_epoch_allocations(account_id, lease_epoch),
      CHECK (issued_at < renew_after AND renew_after < online_expires_at AND online_expires_at <= offline_execute_until),
      CHECK ((released_at IS NULL) = (release_reason IS NULL))
    );
    CREATE UNIQUE INDEX device_active_leases_one_held
      ON device_active_leases(account_id) WHERE released_at IS NULL;
    CREATE TABLE device_drain_proofs (
      account_id text NOT NULL,
      workspace_id text NOT NULL,
      proof_id text NOT NULL UNIQUE CHECK (proof_id ~ '^[!-~]{1,200}$'),
      proof_digest bytea NOT NULL CHECK (octet_length(proof_digest) = 32),
      purpose text NOT NULL CHECK (purpose = 'handoff'),
      workflow_id text NOT NULL,
      source_device_id text NOT NULL,
      active_lease_epoch bigint NOT NULL CHECK (active_lease_epoch BETWEEN 1 AND 9007199254740991),
      signing_key_id text NOT NULL,
      signing_key_version bigint NOT NULL CHECK (signing_key_version BETWEEN 1 AND 9007199254740991),
      issued_at timestamptz NOT NULL,
      expires_at timestamptz NOT NULL,
      verified_at timestamptz NOT NULL,
      device_mutation_sequence bigint NOT NULL CHECK (device_mutation_sequence BETWEEN 0 AND 9007199254740991),
      mutation_digest bytea NOT NULL CHECK (octet_length(mutation_digest) = 32),
      execution_fact_sequence bigint NOT NULL CHECK (execution_fact_sequence BETWEEN 0 AND 9007199254740991),
      execution_fact_digest bytea NOT NULL CHECK (octet_length(execution_fact_digest) = 32),
      device_audit_sequence bigint NOT NULL CHECK (device_audit_sequence BETWEEN 0 AND 9007199254740991),
      device_audit_digest bytea NOT NULL CHECK (octet_length(device_audit_digest) = 32),
      consumed_at timestamptz,
      accepted_at timestamptz,
      PRIMARY KEY (account_id, workspace_id, proof_id),
      FOREIGN KEY (account_id, workspace_id, workflow_id)
        REFERENCES device_switch_workflows(account_id, workspace_id, workflow_id),
      CHECK (issued_at < expires_at AND verified_at >= issued_at),
      CHECK ((consumed_at IS NULL AND accepted_at IS NULL) OR (consumed_at IS NOT NULL AND accepted_at IS NOT NULL))
    );

    ${accountPolicy("device_account_states")}
    ${accountPolicy("device_bindings")}
    ${accountPolicy("device_signing_keys")}
    ${accountPolicy("device_identity_challenges")}
    ${workspacePolicy("device_switch_workflows")}
    ${workspacePolicy("device_bootstrap_capabilities")}
    ${workspacePolicy("device_bootstrap_steps")}
    ${workspacePolicy("device_lease_epoch_allocations")}
    ${accountPolicy("device_active_leases")}
    ${workspacePolicy("device_drain_proofs")}

    GRANT SELECT, INSERT, UPDATE ON device_account_states, device_bindings, device_signing_keys,
      device_identity_challenges, device_switch_workflows, device_bootstrap_capabilities,
      device_bootstrap_steps, device_lease_epoch_allocations, device_active_leases, device_drain_proofs
      TO gooddealer_cloud_app;

    ALTER TABLE device_bootstrap_capabilities
      ADD COLUMN canonical_signed_envelope bytea,
      ADD COLUMN signed_envelope_digest bytea,
      ADD COLUMN signing_key_id text,
      ADD COLUMN ready_at timestamptz,
      ADD CONSTRAINT device_bootstrap_capabilities_signed_ready_check CHECK (
        (canonical_signed_envelope IS NULL AND signed_envelope_digest IS NULL
          AND signing_key_id IS NULL AND ready_at IS NULL)
        OR
        (canonical_signed_envelope IS NOT NULL AND octet_length(canonical_signed_envelope) BETWEEN 1 AND 65536
          AND signed_envelope_digest IS NOT NULL AND octet_length(signed_envelope_digest) = 32
          AND signing_key_id IS NOT NULL AND signing_key_id ~ '^[!-~]{1,200}$'
          AND ready_at IS NOT NULL)
      );
    ALTER TABLE device_bootstrap_capabilities
      ADD CONSTRAINT device_bootstrap_capabilities_authority_identity
      UNIQUE (account_id, workspace_id, workflow_id, jti);
    ALTER TABLE device_lease_epoch_allocations
      ADD CONSTRAINT device_lease_epoch_allocations_workflow_identity
      UNIQUE (account_id, workspace_id, workflow_id, lease_epoch);

    ALTER TABLE device_bootstrap_steps
      ADD COLUMN canonical_request bytea,
      ADD COLUMN step_kind text CHECK (step_kind IN ('pin_checkpoint', 'fetch_mutations', 'submit_rebuild_digest'));
    ALTER TABLE device_bootstrap_steps
      ADD CONSTRAINT device_bootstrap_steps_canonical_authority_check CHECK (
        (canonical_request IS NULL AND step_kind IS NULL)
        OR
        (canonical_request IS NOT NULL AND octet_length(canonical_request) BETWEEN 1 AND 65536
          AND step_kind IS NOT NULL)
      );

    CREATE TABLE device_bootstrap_authorities (
      account_id text NOT NULL,
      workspace_id text NOT NULL,
      workflow_id text NOT NULL,
      capability_jti text NOT NULL CHECK (capability_jti ~ '^[!-~]{1,200}$'),
      target_device_id text NOT NULL CHECK (target_device_id ~ '^[!-~]{1,160}$'),
      account_security_epoch bigint NOT NULL CHECK (account_security_epoch BETWEEN 1 AND 9007199254740991),
      pending_lease_epoch bigint NOT NULL CHECK (pending_lease_epoch BETWEEN 1 AND 9007199254740991),
      next_step_number bigint NOT NULL CHECK (next_step_number BETWEEN 1 AND 9007199254740991),
      next_step_kind text CHECK (next_step_kind IN ('pin_checkpoint', 'fetch_mutations', 'submit_rebuild_digest')),
      next_nonce_digest bytea CHECK (next_nonce_digest IS NULL OR octet_length(next_nonce_digest) = 32),
      pinned_checkpoint_id text,
      pinned_checkpoint_through_server_revision bigint CHECK (pinned_checkpoint_through_server_revision BETWEEN 0 AND 9007199254740991),
      pinned_checkpoint_digest bytea CHECK (pinned_checkpoint_digest IS NULL OR octet_length(pinned_checkpoint_digest) = 32),
      pin_expires_at timestamptz,
      target_server_revision bigint CHECK (target_server_revision BETWEEN 0 AND 9007199254740991),
      target_schema_version bigint CHECK (target_schema_version BETWEEN 1 AND 9007199254740991),
      next_from_revision bigint CHECK (next_from_revision BETWEEN 0 AND 9007199254740991),
      next_cursor_digest bytea CHECK (next_cursor_digest IS NULL OR octet_length(next_cursor_digest) = 32),
      next_cursor_presentation text,
      verified_entity_digests bytea,
      verified_rebuild_digest bytea CHECK (verified_rebuild_digest IS NULL OR octet_length(verified_rebuild_digest) = 32),
      row_version bigint NOT NULL CHECK (row_version BETWEEN 1 AND 9007199254740991),
      created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
      updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
      PRIMARY KEY (account_id, workspace_id, workflow_id),
      FOREIGN KEY (account_id, workspace_id, workflow_id)
        REFERENCES device_switch_workflows(account_id, workspace_id, workflow_id) ON DELETE CASCADE,
      FOREIGN KEY (account_id, workspace_id, workflow_id, capability_jti)
        REFERENCES device_bootstrap_capabilities(account_id, workspace_id, workflow_id, jti) ON DELETE CASCADE,
      FOREIGN KEY (account_id, workspace_id, workflow_id, pending_lease_epoch)
        REFERENCES device_lease_epoch_allocations(account_id, workspace_id, workflow_id, lease_epoch),
      CHECK ((next_step_kind IS NULL) = (next_nonce_digest IS NULL)),
      CHECK ((pinned_checkpoint_id IS NULL AND pinned_checkpoint_through_server_revision IS NULL
          AND pinned_checkpoint_digest IS NULL AND pin_expires_at IS NULL
          AND target_server_revision IS NULL AND target_schema_version IS NULL)
        OR (pinned_checkpoint_id IS NOT NULL AND pinned_checkpoint_through_server_revision IS NOT NULL
          AND pinned_checkpoint_digest IS NOT NULL AND pin_expires_at IS NOT NULL
          AND target_server_revision IS NOT NULL AND target_schema_version IS NOT NULL)),
      CHECK ((next_cursor_digest IS NULL AND next_cursor_presentation IS NULL)
        OR (next_cursor_digest IS NOT NULL AND next_cursor_presentation IS NOT NULL)),
      CHECK ((verified_entity_digests IS NULL AND verified_rebuild_digest IS NULL)
        OR (verified_entity_digests IS NOT NULL AND octet_length(verified_entity_digests) BETWEEN 1 AND 65536
          AND verified_rebuild_digest IS NOT NULL))
    );

    CREATE TABLE device_bootstrap_step_nonces (
      nonce_digest bytea PRIMARY KEY CHECK (octet_length(nonce_digest) = 32),
      account_id text NOT NULL,
      workspace_id text NOT NULL,
      workflow_id text NOT NULL,
      step_number bigint NOT NULL CHECK (step_number BETWEEN 1 AND 9007199254740991),
      state text NOT NULL CHECK (state IN ('active', 'consumed')),
      created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
      consumed_at timestamptz,
      UNIQUE (account_id, workspace_id, workflow_id, step_number),
      FOREIGN KEY (account_id, workspace_id, workflow_id)
        REFERENCES device_bootstrap_authorities(account_id, workspace_id, workflow_id) ON DELETE CASCADE,
      CHECK ((state = 'active' AND consumed_at IS NULL) OR (state = 'consumed' AND consumed_at IS NOT NULL))
    );

    CREATE TABLE device_bootstrap_activation_attempts (
      account_id text NOT NULL,
      workspace_id text NOT NULL,
      workflow_id text NOT NULL,
      attempt_id text NOT NULL CHECK (attempt_id ~ '^[!-~]{1,200}$'),
      canonical_claims bytea NOT NULL CHECK (octet_length(canonical_claims) BETWEEN 1 AND 65536),
      claims_digest bytea NOT NULL CHECK (octet_length(claims_digest) = 32),
      status text NOT NULL CHECK (status IN ('prepared', 'denied', 'installed', 'invalid')),
      signer_receipt_digest bytea CHECK (signer_receipt_digest IS NULL OR octet_length(signer_receipt_digest) = 32),
      signed_envelope_digest bytea CHECK (signed_envelope_digest IS NULL OR octet_length(signed_envelope_digest) = 32),
      created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
      completed_at timestamptz,
      PRIMARY KEY (account_id, workspace_id, workflow_id, attempt_id),
      FOREIGN KEY (account_id, workspace_id, workflow_id)
        REFERENCES device_switch_workflows(account_id, workspace_id, workflow_id) ON DELETE CASCADE,
      CHECK ((status = 'prepared' AND completed_at IS NULL)
        OR (status <> 'prepared' AND completed_at IS NOT NULL)),
      CHECK ((status = 'installed' AND signer_receipt_digest IS NOT NULL AND signed_envelope_digest IS NOT NULL)
        OR (status <> 'installed' AND signer_receipt_digest IS NULL AND signed_envelope_digest IS NULL))
    );

    ${workspacePolicy("device_bootstrap_authorities")}
    ${workspacePolicy("device_bootstrap_step_nonces")}
    ${workspacePolicy("device_bootstrap_activation_attempts")}

    GRANT SELECT, INSERT, UPDATE ON device_bootstrap_authorities,
      device_bootstrap_step_nonces, device_bootstrap_activation_attempts
      TO gooddealer_cloud_app;

    REVOKE ALL ON SCHEMA public FROM PUBLIC;
    REVOKE ALL ON SCHEMA public FROM gooddealer_cloud_app;
    GRANT USAGE ON SCHEMA public TO gooddealer_cloud_app;

    ALTER DEFAULT PRIVILEGES FOR ROLE gooddealer_cloud_owner IN SCHEMA public
      REVOKE ALL ON TABLES FROM PUBLIC, gooddealer_cloud_app;
    ALTER DEFAULT PRIVILEGES FOR ROLE gooddealer_cloud_owner IN SCHEMA public
      REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

    DO $baseline$
    DECLARE
      v_roles_present boolean;
      v_privileged_role boolean;
      v_app_role_escalation boolean;
      v_app_inherits_owner boolean;
    BEGIN
      SELECT pg_catalog.count(*) = 2
      INTO v_roles_present
      FROM pg_catalog.pg_roles AS r
      WHERE r.rolname IN ('gooddealer_cloud_owner', 'gooddealer_cloud_app');
      SELECT pg_catalog.bool_or(r.rolsuper OR r.rolbypassrls)
      INTO v_privileged_role
      FROM pg_catalog.pg_roles AS r
      WHERE r.rolname IN ('gooddealer_cloud_owner', 'gooddealer_cloud_app');
      SELECT r.rolcreaterole OR r.rolcreatedb OR r.rolreplication
      INTO v_app_role_escalation
      FROM pg_catalog.pg_roles AS r
      WHERE r.rolname = 'gooddealer_cloud_app';
      WITH RECURSIVE inherited_roles(role_id) AS (
        SELECT m.roleid
        FROM pg_catalog.pg_auth_members AS m
        JOIN pg_catalog.pg_roles AS member ON member.oid = m.member
        WHERE member.rolname = 'gooddealer_cloud_app'
        UNION
        SELECT m.roleid
        FROM pg_catalog.pg_auth_members AS m
        JOIN inherited_roles AS inherited ON inherited.role_id = m.member
      )
      SELECT EXISTS (
        SELECT 1
        FROM inherited_roles AS inherited
        JOIN pg_catalog.pg_roles AS r ON r.oid = inherited.role_id
        WHERE r.rolname = 'gooddealer_cloud_owner'
      )
      INTO v_app_inherits_owner;
      IF NOT v_roles_present OR COALESCE(v_privileged_role, true)
        OR COALESCE(v_app_role_escalation, true) OR v_app_inherits_owner THEN
        RAISE EXCEPTION 'gooddealer device role baseline is unsafe' USING ERRCODE = '42501';
      END IF;
    END;
    $baseline$;

    REVOKE ALL PRIVILEGES ON TABLE public.device_drain_proofs FROM PUBLIC;
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
      ON TABLE public.device_drain_proofs FROM gooddealer_cloud_app;
    GRANT SELECT ON TABLE public.device_drain_proofs TO gooddealer_cloud_app;

    -- xid8 is written only by the consuming SECURITY DEFINER routine. It distinguishes the
    -- current transaction from another transaction that happens to share a timestamp, so ledger
    -- owners cannot seal a proof that was consumed and committed earlier. Existing consumed rows
    -- predate this marker and cannot be backfilled truthfully, so the constraint stays NOT VALID:
    -- they remain readable history but fail closed in the just-consumed helper; all new writes
    -- must satisfy the marker invariant.
    ALTER TABLE public.device_drain_proofs
      ADD COLUMN consumed_transaction_id xid8;
    ALTER TABLE public.device_drain_proofs
      ADD CONSTRAINT device_drain_proofs_consumption_transaction_marker
      CHECK (
        (consumed_at IS NULL AND accepted_at IS NULL AND consumed_transaction_id IS NULL)
        OR (consumed_at IS NOT NULL AND accepted_at IS NOT NULL AND consumed_transaction_id IS NOT NULL)
      ) NOT VALID;

    DO $proof_acl$
    DECLARE
      v_app_owns_proof boolean;
      v_app_has_proof_dml boolean;
    BEGIN
      SELECT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_class AS relation
        JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
        JOIN pg_catalog.pg_roles AS owner_role ON owner_role.oid = relation.relowner
        WHERE namespace.nspname = 'public'
          AND relation.relname = 'device_drain_proofs'
          AND owner_role.rolname = 'gooddealer_cloud_app'
      )
      INTO v_app_owns_proof;
      SELECT pg_catalog.has_table_privilege('gooddealer_cloud_app', 'public.device_drain_proofs', 'INSERT')
        OR pg_catalog.has_table_privilege('gooddealer_cloud_app', 'public.device_drain_proofs', 'UPDATE')
        OR pg_catalog.has_table_privilege('gooddealer_cloud_app', 'public.device_drain_proofs', 'DELETE')
        OR pg_catalog.has_table_privilege('gooddealer_cloud_app', 'public.device_drain_proofs', 'TRUNCATE')
        OR pg_catalog.has_table_privilege('gooddealer_cloud_app', 'public.device_drain_proofs', 'REFERENCES')
        OR pg_catalog.has_table_privilege('gooddealer_cloud_app', 'public.device_drain_proofs', 'TRIGGER')
      INTO v_app_has_proof_dml;
      IF pg_catalog.has_schema_privilege('gooddealer_cloud_app', 'public', 'CREATE')
        OR v_app_owns_proof OR v_app_has_proof_dml THEN
        RAISE EXCEPTION 'gooddealer app role retains a device proof bypass' USING ERRCODE = '42501';
      END IF;
    END;
    $proof_acl$;

    CREATE FUNCTION public.device_consume_drain_proof(
      p_proof_id text,
      p_proof_digest bytea,
      p_workflow_id text,
      p_expected_workflow_revision bigint,
      p_target_device_id text
    )
    RETURNS TABLE (
      accepted boolean,
      rejection_reason text,
      source_device_id text,
      active_lease_epoch bigint
    )
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $function$
    DECLARE
      v_account_id text;
      v_workspace_id text;
      v_now timestamptz;
      v_proof_digest bytea;
      v_proof_purpose text;
      v_proof_workflow_id text;
      v_source_device_id text;
      v_active_lease_epoch bigint;
      v_signing_key_id text;
      v_signing_key_version bigint;
      v_issued_at timestamptz;
      v_expires_at timestamptz;
      v_consumed_at timestamptz;
      v_accepted_at timestamptz;
      v_consumed_transaction_id xid8;
      v_workflow_status text;
      v_workflow_revision bigint;
      v_from_device_id text;
      v_to_device_id text;
      v_bound_key_id text;
      v_bound_key_version bigint;
      v_bound_security_epoch bigint;
      v_deadline timestamptz;
      v_security_epoch bigint;
      v_security_status text;
      v_binding_count bigint;
      v_lease_device_id text;
      v_lease_epoch bigint;
    BEGIN
      v_account_id := pg_catalog.current_setting('gooddealer.account_id', true);
      v_workspace_id := pg_catalog.current_setting('gooddealer.workspace_id', true);
      IF v_account_id IS NULL OR v_workspace_id IS NULL
        OR v_account_id !~ '^[!-~]{1,160}$'
        OR v_workspace_id !~ '^[!-~]{1,160}$' THEN
        RAISE EXCEPTION 'device tenant selectors are unresolved' USING ERRCODE = '42501';
      END IF;
      IF p_proof_id IS NULL OR p_proof_id !~ '^[!-~]{1,200}$'
        OR p_workflow_id IS NULL OR p_workflow_id !~ '^[!-~]{1,200}$'
        OR p_target_device_id IS NULL OR p_target_device_id !~ '^[!-~]{1,160}$'
        OR p_expected_workflow_revision IS NULL
        OR p_expected_workflow_revision < 1
        OR p_expected_workflow_revision > 9007199254740991
        OR p_proof_digest IS NULL
        OR pg_catalog.octet_length(p_proof_digest) <> 32 THEN
        RETURN QUERY SELECT false, 'PROOF_CONFLICT'::text, NULL::text, NULL::bigint;
        RETURN;
      END IF;

      v_now := pg_catalog.transaction_timestamp();
      SELECT p.proof_digest, p.purpose, p.workflow_id, p.source_device_id, p.active_lease_epoch,
             p.signing_key_id, p.signing_key_version, p.issued_at, p.expires_at,
             p.consumed_at, p.accepted_at
      INTO v_proof_digest, v_proof_purpose, v_proof_workflow_id, v_source_device_id,
           v_active_lease_epoch, v_signing_key_id, v_signing_key_version, v_issued_at,
           v_expires_at, v_consumed_at, v_accepted_at
      FROM public.device_drain_proofs AS p
      WHERE p.account_id = v_account_id
        AND p.workspace_id = v_workspace_id
        AND p.proof_id = p_proof_id
      FOR UPDATE;
      IF NOT FOUND OR v_proof_digest <> p_proof_digest OR v_proof_purpose <> 'handoff'
        OR v_proof_workflow_id <> p_workflow_id THEN
        RETURN QUERY SELECT false, 'PROOF_CONFLICT'::text, NULL::text, NULL::bigint;
        RETURN;
      END IF;
      IF v_consumed_at IS NOT NULL OR v_accepted_at IS NOT NULL THEN
        RETURN QUERY SELECT false, 'PROOF_REPLAY_CONFLICT'::text, NULL::text, NULL::bigint;
        RETURN;
      END IF;
      IF v_issued_at > v_now OR v_now >= v_expires_at THEN
        RETURN QUERY SELECT false, 'PROOF_EXPIRED'::text, NULL::text, NULL::bigint;
        RETURN;
      END IF;

      SELECT w.status, w.workflow_revision, w.from_device_id, w.to_device_id,
             w.bound_key_id, w.bound_key_version, w.bound_account_security_epoch, w.state_deadline
      INTO v_workflow_status, v_workflow_revision, v_from_device_id, v_to_device_id,
           v_bound_key_id, v_bound_key_version, v_bound_security_epoch, v_deadline
      FROM public.device_switch_workflows AS w
      WHERE w.account_id = v_account_id
        AND w.workspace_id = v_workspace_id
        AND w.workflow_id = p_workflow_id;
      IF NOT FOUND OR v_workflow_status <> 'draining'
        OR v_workflow_revision <> p_expected_workflow_revision
        OR v_from_device_id <> v_source_device_id
        OR v_to_device_id <> p_target_device_id
        OR v_bound_key_id <> v_signing_key_id
        OR v_bound_key_version <> v_signing_key_version THEN
        RETURN QUERY SELECT false, 'WORKFLOW_CONFLICT'::text, NULL::text, NULL::bigint;
        RETURN;
      END IF;
      IF v_now >= v_deadline THEN
        RETURN QUERY SELECT false, 'WORKFLOW_EXPIRED'::text, NULL::text, NULL::bigint;
        RETURN;
      END IF;

      SELECT s.account_security_epoch, s.status
      INTO v_security_epoch, v_security_status
      FROM public.identity_account_security_states AS s
      WHERE s.account_id = v_account_id;
      IF NOT FOUND OR v_security_status <> 'normal' OR v_security_epoch <> v_bound_security_epoch THEN
        RETURN QUERY SELECT false, 'ACCOUNT_SECURITY_CONFLICT'::text, NULL::text, NULL::bigint;
        RETURN;
      END IF;

      SELECT pg_catalog.count(*)
      INTO v_binding_count
      FROM public.device_bindings AS b
      WHERE b.account_id = v_account_id
        AND b.device_id = ANY (ARRAY[v_source_device_id, p_target_device_id])
        AND b.status = 'bound';
      IF v_source_device_id = p_target_device_id OR v_binding_count <> 2 THEN
        RETURN QUERY SELECT false, 'BINDING_CONFLICT'::text, NULL::text, NULL::bigint;
        RETURN;
      END IF;

      PERFORM 1
      FROM public.device_signing_keys AS k
      WHERE k.account_id = v_account_id
        AND k.device_id = v_source_device_id
        AND k.key_id = v_signing_key_id
        AND k.key_version = v_signing_key_version
        AND k.status = 'active';
      IF NOT FOUND THEN
        RETURN QUERY SELECT false, 'SIGNING_KEY_CONFLICT'::text, NULL::text, NULL::bigint;
        RETURN;
      END IF;

      SELECT l.device_id, l.lease_epoch
      INTO v_lease_device_id, v_lease_epoch
      FROM public.device_active_leases AS l
      WHERE l.account_id = v_account_id
        AND l.released_at IS NULL;
      IF NOT FOUND OR v_lease_device_id <> v_source_device_id OR v_lease_epoch <> v_active_lease_epoch THEN
        RETURN QUERY SELECT false, 'LEASE_CONFLICT'::text, NULL::text, NULL::bigint;
        RETURN;
      END IF;

      v_consumed_transaction_id := pg_catalog.pg_current_xact_id();
      UPDATE public.device_drain_proofs
      SET consumed_at = v_now,
          accepted_at = v_now,
          consumed_transaction_id = v_consumed_transaction_id
      WHERE account_id = v_account_id
        AND workspace_id = v_workspace_id
        AND proof_id = p_proof_id
        AND consumed_at IS NULL
        AND accepted_at IS NULL
        AND consumed_transaction_id IS NULL;
      IF NOT FOUND THEN
        RETURN QUERY SELECT false, 'PROOF_REPLAY_CONFLICT'::text, NULL::text, NULL::bigint;
        RETURN;
      END IF;

      RETURN QUERY SELECT true, NULL::text, v_source_device_id, v_active_lease_epoch;
    END;
    $function$;

    CREATE FUNCTION public.device_read_just_consumed_drain_proof(p_proof_id text)
    RETURNS TABLE (
      source_device_id text,
      active_lease_epoch bigint,
      device_mutation_sequence bigint,
      mutation_digest bytea,
      execution_fact_sequence bigint,
      execution_fact_digest bytea,
      device_audit_sequence bigint,
      device_audit_digest bytea
    )
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $function$
    DECLARE
      v_account_id text;
      v_workspace_id text;
      v_now timestamptz;
    BEGIN
      v_account_id := pg_catalog.current_setting('gooddealer.account_id', true);
      v_workspace_id := pg_catalog.current_setting('gooddealer.workspace_id', true);
      IF v_account_id IS NULL OR v_workspace_id IS NULL
        OR v_account_id !~ '^[!-~]{1,160}$'
        OR v_workspace_id !~ '^[!-~]{1,160}$'
        OR p_proof_id IS NULL OR p_proof_id !~ '^[!-~]{1,200}$' THEN
        RAISE EXCEPTION 'device tenant selectors or proof identity are unresolved' USING ERRCODE = '42501';
      END IF;
      v_now := pg_catalog.transaction_timestamp();
      RETURN QUERY
      SELECT p.source_device_id, p.active_lease_epoch,
             p.device_mutation_sequence, p.mutation_digest,
             p.execution_fact_sequence, p.execution_fact_digest,
             p.device_audit_sequence, p.device_audit_digest
      FROM public.device_drain_proofs AS p
      WHERE p.account_id = v_account_id
        AND p.workspace_id = v_workspace_id
        AND p.proof_id = p_proof_id
        AND p.purpose = 'handoff'
        AND p.consumed_at = v_now
        AND p.accepted_at = v_now
        AND p.consumed_transaction_id = pg_catalog.pg_current_xact_id();
    END;
    $function$;

    ALTER FUNCTION public.device_consume_drain_proof(text, bytea, text, bigint, text)
      OWNER TO gooddealer_cloud_owner;
    ALTER FUNCTION public.device_read_just_consumed_drain_proof(text)
      OWNER TO gooddealer_cloud_owner;
    REVOKE ALL PRIVILEGES ON FUNCTION public.device_consume_drain_proof(text, bytea, text, bigint, text)
      FROM PUBLIC, gooddealer_cloud_app;
    REVOKE ALL PRIVILEGES ON FUNCTION public.device_read_just_consumed_drain_proof(text)
      FROM PUBLIC, gooddealer_cloud_app;
    GRANT EXECUTE ON FUNCTION public.device_consume_drain_proof(text, bytea, text, bigint, text)
      TO gooddealer_cloud_app;

    DO $routine_acl$
    BEGIN
      IF NOT pg_catalog.has_function_privilege(
        'gooddealer_cloud_app',
        'public.device_consume_drain_proof(text, bytea, text, bigint, text)',
        'EXECUTE'
      ) OR pg_catalog.has_function_privilege(
        'gooddealer_cloud_app',
        'public.device_read_just_consumed_drain_proof(text)',
        'EXECUTE'
      ) THEN
        RAISE EXCEPTION 'gooddealer app routine allowlist is unsafe' USING ERRCODE = '42501';
      END IF;
    END;
    $routine_acl$;
  `,
};
