import type { CloudMigration } from "../../../../db/index";

/**
 * ADR-0030 B2: the global device sequence ledger becomes an immutable accepted/rejected result
 * union. Existing rows are accepted and keep every byte. Only accepted rows carry a server revision
 * and remain bound by the receipt foreign key (which a NULL revision leaves unenforced), so a
 * rejected row can never stand in for an accepted receipt. Rejected rows bind the digest of the
 * frozen submitted envelope for the v2 drain chain, which the mutation seal now merges in.
 */
export const mutationResultLedgerMigration: CloudMigration = {
  id: "202611130003-mutation-result-ledger",
  owner: "workspace/mutations",
  sql: `
    ALTER TABLE public.workspace_device_mutation_sequence_ledger
      ADD COLUMN outcome text NOT NULL DEFAULT 'accepted' CHECK (outcome IN ('accepted', 'rejected')),
      ADD COLUMN rejection_code text
        CHECK (rejection_code IN ('MUTATION_FIELD_STALE', 'MUTATION_ENTITY_UNKNOWN')),
      ADD COLUMN rejected_at timestamptz,
      ADD COLUMN rejected_envelope_digest bytea
        CHECK (rejected_envelope_digest IS NULL OR octet_length(rejected_envelope_digest) = 32),
      ALTER COLUMN server_revision DROP NOT NULL,
      ALTER COLUMN accepted_at DROP NOT NULL,
      ADD CONSTRAINT workspace_device_mutation_sequence_ledger_result_union CHECK (
        (outcome = 'accepted'
          AND server_revision IS NOT NULL AND accepted_at IS NOT NULL
          AND rejection_code IS NULL AND rejected_at IS NULL AND rejected_envelope_digest IS NULL)
        OR (outcome = 'rejected'
          AND server_revision IS NULL AND accepted_at IS NULL
          AND rejection_code IS NOT NULL AND rejected_at IS NOT NULL AND rejected_envelope_digest IS NOT NULL)
      );
    -- The default only labelled history; every new row states its outcome.
    ALTER TABLE public.workspace_device_mutation_sequence_ledger ALTER COLUMN outcome DROP DEFAULT;
    CREATE INDEX workspace_device_mutation_sequence_ledger_rejected_domain
      ON public.workspace_device_mutation_sequence_ledger
        (account_id, workspace_id, source_device_id, active_lease_epoch, device_mutation_sequence)
      WHERE outcome = 'rejected';

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
      v_previous_sequence bigint := 0;
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
      /*
       * ADR-0030 B2: one ordered stream of both outcomes for this lease domain. Accepted results
       * come from the immutable drain records; rejected results come from the result ledger,
       * which binds the digest of the same frozen submitted envelope. v1 cannot express a
       * rejection, so a rejected sequence stops the v1 chain and raises the highest sequence,
       * failing that seal closed. A sequence present in both sources is broken evidence.
       */
      FOR v_record IN
        SELECT r.device_mutation_sequence, 'accepted'::text AS outcome,
               r.canonical_envelope, r.envelope_digest
        FROM public.mutation_drain_records AS r
        WHERE r.account_id = v_account_id
          AND r.workspace_id = v_workspace_id
          AND r.source_device_id = v_source_device_id
          AND r.active_lease_epoch = v_active_lease_epoch
        UNION ALL
        SELECT l.device_mutation_sequence, 'rejected'::text AS outcome,
               NULL::bytea, l.rejected_envelope_digest
        FROM public.workspace_device_mutation_sequence_ledger AS l
        WHERE l.account_id = v_account_id
          AND l.workspace_id = v_workspace_id
          AND l.source_device_id = v_source_device_id
          AND l.active_lease_epoch = v_active_lease_epoch
          AND l.outcome = 'rejected'
        ORDER BY 1, 2
      LOOP
        IF v_record.device_mutation_sequence = v_previous_sequence THEN
          RETURN false;
        END IF;
        v_previous_sequence := v_record.device_mutation_sequence;
        IF v_record.device_mutation_sequence > v_highest THEN
          v_highest := v_record.device_mutation_sequence;
        END IF;
        IF v_record.device_mutation_sequence = v_contiguous + 1
          AND (v_proof_schema_version = 2 OR v_record.outcome = 'accepted') THEN
          IF v_proof_schema_version = 1 THEN
            v_step := v_record.canonical_envelope;
          ELSE
            IF v_record.outcome = 'accepted' THEN
              -- A stored digest that no longer matches its envelope fails the seal closed.
              v_submitted_digest := pg_catalog.sha256(v_record.canonical_envelope);
              IF v_record.envelope_digest IS DISTINCT FROM v_submitted_digest THEN
                RETURN false;
              END IF;
            ELSE
              v_submitted_digest := v_record.envelope_digest;
              IF v_submitted_digest IS NULL OR pg_catalog.octet_length(v_submitted_digest) <> 32 THEN
                RETURN false;
              END IF;
            END IF;
            -- Byte-identical to encodeMutationDrainResultEnvelope.
            v_step := pg_catalog.int4send(35)
              || pg_catalog.convert_to('GOODDEALER-MUTATION-DRAIN-RESULT-V1', 'UTF8')
              || pg_catalog.int4send(pg_catalog.octet_length(v_record.outcome)::integer)
              || pg_catalog.convert_to(v_record.outcome, 'UTF8')
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
