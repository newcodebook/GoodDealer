import type { CloudMigration } from "../../../../db/index";

/**
 * ADR-0030 B1: the mutation seal follows the chain its consumed proof declares (devices migration
 * 202611130001). History is preserved: every existing seal is schema v1 and keeps its digest. v2
 * seals rebuild the accepted result chain from the retained submitted envelopes; rejected results
 * join that chain only once the B2 result ledger exists. Execution-fact and device-audit seals are
 * unchanged because their envelopes are identical in both versions.
 */
export const mutationDrainResultChainMigration: CloudMigration = {
  id: "202611130002-mutation-drain-result-chain",
  owner: "workspace/mutations",
  sql: `
    ALTER TABLE public.mutation_drain_seals
      ADD COLUMN proof_schema_version smallint NOT NULL DEFAULT 1
        CHECK (proof_schema_version IN (1, 2));

    CREATE OR REPLACE FUNCTION public.workspace_mutation_drain_install_accepted_seal(p_proof_id text)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $function$
    DECLARE
      v_account_id text;
      v_workspace_id text;
      v_source_device_id text;
      v_active_lease_epoch bigint;
      v_expected_sequence bigint;
      v_expected_digest bytea;
      v_contiguous bigint;
      v_highest bigint;
      v_digest bytea;
      v_record record;
      v_existing record;
      v_existing_count integer := 0;
      v_proof_schema_version smallint;
      v_step bytea;
      v_submitted_digest bytea;
    BEGIN
      v_account_id := pg_catalog.current_setting('gooddealer.account_id', true);
      v_workspace_id := pg_catalog.current_setting('gooddealer.workspace_id', true);
      IF v_account_id IS NULL OR v_workspace_id IS NULL
        OR v_account_id !~ '^[!-~]{1,160}$'
        OR v_workspace_id !~ '^[!-~]{1,160}$'
        OR p_proof_id IS NULL OR p_proof_id !~ '^[!-~]{1,200}$' THEN
        RAISE EXCEPTION 'mutation drain seal selectors are unresolved' USING ERRCODE = '42501';
      END IF;

      SELECT p.source_device_id, p.active_lease_epoch, p.device_mutation_sequence, p.mutation_digest
      INTO v_source_device_id, v_active_lease_epoch, v_expected_sequence, v_expected_digest
      FROM public.device_read_just_consumed_drain_proof(p_proof_id) AS p;
      IF NOT FOUND
        OR v_source_device_id IS NULL OR v_source_device_id !~ '^[!-~]{1,160}$'
        OR v_active_lease_epoch IS NULL OR v_active_lease_epoch < 1 OR v_active_lease_epoch > 9007199254740991
        OR v_expected_sequence IS NULL OR v_expected_sequence < 0 OR v_expected_sequence > 9007199254740991
        OR v_expected_digest IS NULL OR pg_catalog.octet_length(v_expected_digest) <> 32 THEN
        RETURN false;
      END IF;

      -- ADR-0030: the proof's own schema version selects the chain; missing evidence fails closed.
      v_proof_schema_version := public.device_read_just_consumed_drain_proof_schema_version(p_proof_id);
      IF v_proof_schema_version IS NULL OR v_proof_schema_version NOT IN (1, 2) THEN
        RETURN false;
      END IF;

      /*
       * A rejected proof must not leave a derived head behind. Acquire the same active-domain
       * authority locks as app ingress, but derive the candidate state directly from immutable
       * records before calling the head-materializing routine. Those locks serialize every app
       * append path, so a matching candidate cannot change between this check and recomputation.
       */
      PERFORM public.workspace_mutation_drain_assert_active_domain(v_source_device_id, v_active_lease_epoch);
      IF NOT FOUND THEN
        RAISE EXCEPTION 'mutation drain domain authority is unavailable' USING ERRCODE = '42501';
      END IF;

      v_contiguous := 0;
      v_highest := 0;
      v_digest := pg_catalog.sha256(pg_catalog.convert_to('GOODDEALER-DRAIN-SHA256-V1', 'UTF8'));
      FOR v_record IN
        SELECT r.device_mutation_sequence, r.canonical_envelope, r.envelope_digest
        FROM public.mutation_drain_records AS r
        WHERE r.account_id = v_account_id
          AND r.workspace_id = v_workspace_id
          AND r.source_device_id = v_source_device_id
          AND r.active_lease_epoch = v_active_lease_epoch
        ORDER BY r.device_mutation_sequence
      LOOP
        IF v_record.device_mutation_sequence > v_highest THEN
          v_highest := v_record.device_mutation_sequence;
        END IF;
        IF v_record.device_mutation_sequence = v_contiguous + 1 THEN
          IF v_proof_schema_version = 1 THEN
            v_step := v_record.canonical_envelope;
          ELSE
            /*
             * v2 rebuilds the accepted result chain from retained v1 evidence without rewriting it.
             * Every row here was accepted, so each step is the result envelope
             * u32be(len) || domain || u32be(len) || 'accepted' || u32be(32) || sha256(envelope),
             * byte-identical to encodeMutationDrainResultEnvelope. A stored digest that no longer
             * matches its envelope is broken evidence and fails the seal closed.
             */
            v_submitted_digest := pg_catalog.sha256(v_record.canonical_envelope);
            IF v_record.envelope_digest IS DISTINCT FROM v_submitted_digest THEN
              RETURN false;
            END IF;
            v_step := pg_catalog.int4send(35)
              || pg_catalog.convert_to('GOODDEALER-MUTATION-DRAIN-RESULT-V1', 'UTF8')
              || pg_catalog.int4send(8)
              || pg_catalog.convert_to('accepted', 'UTF8')
              || pg_catalog.int4send(32)
              || v_submitted_digest;
          END IF;
          v_digest := pg_catalog.sha256(
            v_digest
            || pg_catalog.int4send(pg_catalog.octet_length(v_step)::integer)
            || v_step
          );
          v_contiguous := v_record.device_mutation_sequence;
        END IF;
      END LOOP;

      IF v_contiguous <> v_expected_sequence
        OR v_highest <> v_expected_sequence
        OR v_digest IS DISTINCT FROM v_expected_digest THEN
        RETURN false;
      END IF;

      PERFORM public.workspace_mutation_drain_recompute_head(v_source_device_id, v_active_lease_epoch);
      IF NOT FOUND THEN
        RAISE EXCEPTION 'mutation drain head routine is unavailable' USING ERRCODE = '42501';
      END IF;

      INSERT INTO public.mutation_drain_seals (
        account_id, workspace_id, source_device_id, active_lease_epoch,
        last_assigned_device_mutation_sequence, rolling_digest, proof_id, proof_schema_version
      ) VALUES (
        v_account_id, v_workspace_id, v_source_device_id, v_active_lease_epoch,
        v_expected_sequence, v_expected_digest, p_proof_id, v_proof_schema_version
      ) ON CONFLICT (account_id, workspace_id, source_device_id, active_lease_epoch) DO NOTHING;
      IF FOUND THEN
        RETURN true;
      END IF;

      FOR v_existing IN
        SELECT s.account_id, s.workspace_id, s.source_device_id, s.active_lease_epoch,
               s.last_assigned_device_mutation_sequence, s.rolling_digest, s.proof_id,
               s.proof_schema_version
        FROM public.mutation_drain_seals AS s
        WHERE s.account_id = v_account_id
          AND s.workspace_id = v_workspace_id
          AND (
            (s.source_device_id = v_source_device_id AND s.active_lease_epoch = v_active_lease_epoch)
            OR s.proof_id = p_proof_id
          )
        FOR UPDATE
      LOOP
        v_existing_count := v_existing_count + 1;
        IF v_existing.account_id IS DISTINCT FROM v_account_id
          OR v_existing.workspace_id IS DISTINCT FROM v_workspace_id
          OR v_existing.source_device_id IS DISTINCT FROM v_source_device_id
          OR v_existing.active_lease_epoch IS DISTINCT FROM v_active_lease_epoch
          OR v_existing.last_assigned_device_mutation_sequence IS DISTINCT FROM v_expected_sequence
          OR v_existing.rolling_digest IS DISTINCT FROM v_expected_digest
          OR v_existing.proof_id IS DISTINCT FROM p_proof_id
          OR v_existing.proof_schema_version IS DISTINCT FROM v_proof_schema_version THEN
          RETURN false;
        END IF;
      END LOOP;
      RETURN v_existing_count = 1;
    END;
    $function$;

    ALTER FUNCTION public.workspace_mutation_drain_install_accepted_seal(text)
      OWNER TO gooddealer_cloud_owner;
    REVOKE ALL PRIVILEGES ON FUNCTION public.workspace_mutation_drain_install_accepted_seal(text)
      FROM PUBLIC, gooddealer_cloud_app;
    GRANT EXECUTE ON FUNCTION public.workspace_mutation_drain_install_accepted_seal(text)
      TO gooddealer_cloud_app;

  `,
};
