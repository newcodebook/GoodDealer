import type { CloudMigration } from "../../../db/index";

/**
 * ADR-0032 S1c: a device switch workflow binds the target device's signing key, the key that
 * bootstrap steps and activation verify. The original drain consumption compared it with the
 * source's proof key instead, so no workflow could pass both drain and bootstrap. Consumption now
 * requires the bound key to be the target's active key and keeps the separate check that the
 * proof's key is the source's active key. Signature and grants are unchanged.
 */
export const drainHandoffTargetKeyMigration: CloudMigration = {
  id: "202611170001-drain-handoff-target-key",
  owner: "devices",
  sql: `
    CREATE OR REPLACE FUNCTION public.device_consume_drain_proof(
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
        OR v_to_device_id <> p_target_device_id THEN
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

      -- The workflow binds the TARGET's key: bootstrap steps and activation verify the target
      -- with it. The proof is signed by the source's own active key, checked just above.
      PERFORM 1
      FROM public.device_signing_keys AS k
      WHERE k.account_id = v_account_id
        AND k.device_id = p_target_device_id
        AND k.key_id = v_bound_key_id
        AND k.key_version = v_bound_key_version
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

    ALTER FUNCTION public.device_consume_drain_proof(text, bytea, text, bigint, text)
      OWNER TO gooddealer_cloud_owner;
    REVOKE ALL PRIVILEGES ON FUNCTION public.device_consume_drain_proof(text, bytea, text, bigint, text)
      FROM PUBLIC, gooddealer_cloud_app;
    GRANT EXECUTE ON FUNCTION public.device_consume_drain_proof(text, bytea, text, bigint, text)
      TO gooddealer_cloud_app;
  `,
};
