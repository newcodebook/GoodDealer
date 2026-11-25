import type { CloudMigration } from "../../../db/index";

/**
 * ADR-0032 S1c2: records a drain proof the Cloud application has verified, so the handoff
 * transition (`device_consume_drain_proof`) can consume it. The application role keeps only SELECT
 * on `device_drain_proofs`; this owner routine is its one write path. It cannot check the Ed25519
 * signature (PostgreSQL has no primitive for it), so it trusts the application for that alone, as
 * Desktop login proofs already do, and independently re-checks everything else against locked-in
 * server state: the open `draining` workflow from this source device, the source's active signing
 * key, the held current Lease, the proof window and its 600-second bound, and a permanent binding
 * of each proof id to one digest. A replay of the same proof returns `replayed` without writing.
 */
export const drainProofAdmissionMigration: CloudMigration = {
  id: "202611170002-drain-proof-admission",
  owner: "devices",
  sql: `
    CREATE FUNCTION public.device_record_drain_proof(
      p_proof_id text,
      p_proof_digest bytea,
      p_proof_schema_version smallint,
      p_workflow_id text,
      p_source_device_id text,
      p_active_lease_epoch bigint,
      p_signing_key_id text,
      p_signing_key_version bigint,
      p_issued_at timestamptz,
      p_expires_at timestamptz,
      p_mutation_sequence bigint,
      p_mutation_digest bytea,
      p_execution_fact_sequence bigint,
      p_execution_fact_digest bytea,
      p_device_audit_sequence bigint,
      p_device_audit_digest bytea
    )
    RETURNS text
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $function$
    DECLARE
      v_account_id text;
      v_workspace_id text;
      v_now timestamptz;
      v_existing_digest bytea;
      v_existing_workflow text;
      v_inserted bigint;
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
        OR p_source_device_id IS NULL OR p_source_device_id !~ '^[!-~]{1,160}$'
        OR p_signing_key_id IS NULL OR p_signing_key_id !~ '^[!-~]{1,200}$'
        OR p_proof_schema_version IS NULL OR p_proof_schema_version NOT IN (1, 2)
        OR p_active_lease_epoch IS NULL OR p_active_lease_epoch NOT BETWEEN 1 AND 9007199254740991
        OR p_signing_key_version IS NULL OR p_signing_key_version NOT BETWEEN 1 AND 9007199254740991
        OR p_mutation_sequence IS NULL OR p_mutation_sequence NOT BETWEEN 0 AND 9007199254740991
        OR p_execution_fact_sequence IS NULL OR p_execution_fact_sequence NOT BETWEEN 0 AND 9007199254740991
        OR p_device_audit_sequence IS NULL OR p_device_audit_sequence NOT BETWEEN 0 AND 9007199254740991
        OR p_issued_at IS NULL OR p_expires_at IS NULL
        OR p_proof_digest IS NULL OR pg_catalog.octet_length(p_proof_digest) <> 32
        OR p_mutation_digest IS NULL OR pg_catalog.octet_length(p_mutation_digest) <> 32
        OR p_execution_fact_digest IS NULL OR pg_catalog.octet_length(p_execution_fact_digest) <> 32
        OR p_device_audit_digest IS NULL OR pg_catalog.octet_length(p_device_audit_digest) <> 32 THEN
        RETURN 'PROOF_MALFORMED';
      END IF;
      v_now := pg_catalog.transaction_timestamp();

      -- A proof id is bound forever to one digest, in one tenant and one workflow.
      SELECT p.proof_digest, p.workflow_id INTO v_existing_digest, v_existing_workflow
      FROM public.device_drain_proofs AS p
      WHERE p.account_id = v_account_id AND p.workspace_id = v_workspace_id AND p.proof_id = p_proof_id;
      IF FOUND THEN
        IF v_existing_digest = p_proof_digest AND v_existing_workflow = p_workflow_id THEN
          RETURN 'replayed';
        END IF;
        RETURN 'PROOF_ID_CONFLICT';
      END IF;

      IF p_issued_at > v_now OR v_now >= p_expires_at
        OR p_expires_at - p_issued_at > interval '600 seconds' THEN
        RETURN 'PROOF_EXPIRED';
      END IF;

      PERFORM 1
      FROM public.device_switch_workflows AS w
      WHERE w.account_id = v_account_id AND w.workspace_id = v_workspace_id
        AND w.workflow_id = p_workflow_id AND w.status = 'draining'
        AND w.from_device_id = p_source_device_id AND v_now < w.state_deadline;
      IF NOT FOUND THEN
        RETURN 'WORKFLOW_CONFLICT';
      END IF;

      PERFORM 1
      FROM public.device_signing_keys AS k
      JOIN public.device_bindings AS b ON b.account_id = k.account_id AND b.device_id = k.device_id
      WHERE k.account_id = v_account_id AND k.device_id = p_source_device_id
        AND k.key_id = p_signing_key_id AND k.key_version = p_signing_key_version
        AND k.status = 'active' AND b.status = 'bound';
      IF NOT FOUND THEN
        RETURN 'SIGNING_KEY_CONFLICT';
      END IF;

      PERFORM 1
      FROM public.device_active_leases AS l
      JOIN public.device_account_states AS s ON s.account_id = l.account_id
      WHERE l.account_id = v_account_id AND l.released_at IS NULL
        AND l.device_id = p_source_device_id AND l.lease_epoch = p_active_lease_epoch
        AND s.current_lease_epoch = p_active_lease_epoch;
      IF NOT FOUND THEN
        RETURN 'LEASE_CONFLICT';
      END IF;

      INSERT INTO public.device_drain_proofs (
        account_id, workspace_id, proof_id, proof_digest, purpose, workflow_id, source_device_id,
        active_lease_epoch, signing_key_id, signing_key_version, issued_at, expires_at, verified_at,
        device_mutation_sequence, mutation_digest, execution_fact_sequence, execution_fact_digest,
        device_audit_sequence, device_audit_digest, proof_schema_version
      ) VALUES (
        v_account_id, v_workspace_id, p_proof_id, p_proof_digest, 'handoff', p_workflow_id, p_source_device_id,
        p_active_lease_epoch, p_signing_key_id, p_signing_key_version, p_issued_at, p_expires_at, v_now,
        p_mutation_sequence, p_mutation_digest, p_execution_fact_sequence, p_execution_fact_digest,
        p_device_audit_sequence, p_device_audit_digest, p_proof_schema_version
      )
      ON CONFLICT DO NOTHING;
      GET DIAGNOSTICS v_inserted = ROW_COUNT;
      -- Proof ids are globally unique: losing a race, or an id spent in another tenant, conflicts.
      IF v_inserted <> 1 THEN
        RETURN 'PROOF_ID_CONFLICT';
      END IF;
      RETURN 'recorded';
    END;
    $function$;

    ALTER FUNCTION public.device_record_drain_proof(
      text, bytea, smallint, text, text, bigint, text, bigint, timestamptz, timestamptz,
      bigint, bytea, bigint, bytea, bigint, bytea
    ) OWNER TO gooddealer_cloud_owner;
    REVOKE ALL PRIVILEGES ON FUNCTION public.device_record_drain_proof(
      text, bytea, smallint, text, text, bigint, text, bigint, timestamptz, timestamptz,
      bigint, bytea, bigint, bytea, bigint, bytea
    ) FROM PUBLIC, gooddealer_cloud_app;
    GRANT EXECUTE ON FUNCTION public.device_record_drain_proof(
      text, bytea, smallint, text, text, bigint, text, bigint, timestamptz, timestamptz,
      bigint, bytea, bigint, bytea, bigint, bytea
    ) TO gooddealer_cloud_app;
  `,
};
