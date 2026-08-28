import type { CloudMigration } from "../../../../db/index";

export const mutationDrainLedgerMigration: CloudMigration = {
  id: "202608200006-mutation-drain-ledger",
  owner: "workspace/mutations",
  sql: `
    CREATE TABLE mutation_drain_records (
      account_id text NOT NULL, workspace_id text NOT NULL, source_device_id text NOT NULL,
      active_lease_epoch bigint NOT NULL CHECK (active_lease_epoch BETWEEN 1 AND 9007199254740991),
      device_mutation_sequence bigint NOT NULL CHECK (device_mutation_sequence BETWEEN 1 AND 9007199254740991),
      canonical_envelope bytea NOT NULL, envelope_digest bytea NOT NULL CHECK (octet_length(envelope_digest) = 32),
      received_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
      quarantine_reason text CHECK (quarantine_reason IN ('sequence_replay', 'drain_seal_violation')),
      PRIMARY KEY (account_id, workspace_id, source_device_id, active_lease_epoch, device_mutation_sequence)
    );
    CREATE TABLE mutation_drain_heads (
      account_id text NOT NULL, workspace_id text NOT NULL, source_device_id text NOT NULL,
      active_lease_epoch bigint NOT NULL CHECK (active_lease_epoch BETWEEN 1 AND 9007199254740991),
      contiguous_received_through bigint NOT NULL DEFAULT 0 CHECK (contiguous_received_through >= 0),
      highest_received_sequence bigint NOT NULL DEFAULT 0 CHECK (highest_received_sequence >= contiguous_received_through),
      rolling_digest bytea NOT NULL CHECK (octet_length(rolling_digest) = 32),
      PRIMARY KEY (account_id, workspace_id, source_device_id, active_lease_epoch)
    );
    CREATE TABLE mutation_drain_seals (
      account_id text NOT NULL, workspace_id text NOT NULL, source_device_id text NOT NULL,
      active_lease_epoch bigint NOT NULL, last_assigned_device_mutation_sequence bigint NOT NULL CHECK (last_assigned_device_mutation_sequence >= 0),
      rolling_digest bytea NOT NULL CHECK (octet_length(rolling_digest) = 32), proof_id text NOT NULL,
      accepted_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
      PRIMARY KEY (account_id, workspace_id, source_device_id, active_lease_epoch),
      UNIQUE (account_id, workspace_id, proof_id),
      FOREIGN KEY (account_id, workspace_id, source_device_id, active_lease_epoch)
        REFERENCES mutation_drain_heads(account_id, workspace_id, source_device_id, active_lease_epoch)
    );
    DO $$ DECLARE table_name text; BEGIN FOREACH table_name IN ARRAY ARRAY['mutation_drain_records','mutation_drain_heads','mutation_drain_seals'] LOOP
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
      EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
      EXECUTE format('CREATE POLICY %I ON %I USING (CURRENT_USER = ''gooddealer_cloud_owner'' OR (account_id = current_setting(''gooddealer.account_id'', true) AND workspace_id = current_setting(''gooddealer.workspace_id'', true))) WITH CHECK (CURRENT_USER = ''gooddealer_cloud_owner'' OR (account_id = current_setting(''gooddealer.account_id'', true) AND workspace_id = current_setting(''gooddealer.workspace_id'', true)))', table_name || '_tenant_scope', table_name);
    END LOOP; END $$;
    GRANT SELECT, INSERT, UPDATE ON mutation_drain_records, mutation_drain_heads, mutation_drain_seals TO gooddealer_cloud_app;

    ALTER TABLE public.mutation_drain_records ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.mutation_drain_records FORCE ROW LEVEL SECURITY;
    ALTER TABLE public.mutation_drain_heads ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.mutation_drain_heads FORCE ROW LEVEL SECURITY;
    ALTER TABLE public.mutation_drain_seals ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.mutation_drain_seals FORCE ROW LEVEL SECURITY;

    ALTER POLICY mutation_drain_records_tenant_scope ON public.mutation_drain_records
      USING (
        pg_catalog.current_setting('gooddealer.account_id', true) ~ '^[!-~]{1,160}$'
        AND pg_catalog.current_setting('gooddealer.workspace_id', true) ~ '^[!-~]{1,160}$'
        AND account_id = pg_catalog.current_setting('gooddealer.account_id', true)
        AND workspace_id = pg_catalog.current_setting('gooddealer.workspace_id', true)
      )
      WITH CHECK (
        pg_catalog.current_setting('gooddealer.account_id', true) ~ '^[!-~]{1,160}$'
        AND pg_catalog.current_setting('gooddealer.workspace_id', true) ~ '^[!-~]{1,160}$'
        AND account_id = pg_catalog.current_setting('gooddealer.account_id', true)
        AND workspace_id = pg_catalog.current_setting('gooddealer.workspace_id', true)
      );
    ALTER POLICY mutation_drain_heads_tenant_scope ON public.mutation_drain_heads
      USING (
        pg_catalog.current_setting('gooddealer.account_id', true) ~ '^[!-~]{1,160}$'
        AND pg_catalog.current_setting('gooddealer.workspace_id', true) ~ '^[!-~]{1,160}$'
        AND account_id = pg_catalog.current_setting('gooddealer.account_id', true)
        AND workspace_id = pg_catalog.current_setting('gooddealer.workspace_id', true)
      )
      WITH CHECK (
        pg_catalog.current_setting('gooddealer.account_id', true) ~ '^[!-~]{1,160}$'
        AND pg_catalog.current_setting('gooddealer.workspace_id', true) ~ '^[!-~]{1,160}$'
        AND account_id = pg_catalog.current_setting('gooddealer.account_id', true)
        AND workspace_id = pg_catalog.current_setting('gooddealer.workspace_id', true)
      );
    ALTER POLICY mutation_drain_seals_tenant_scope ON public.mutation_drain_seals
      USING (
        pg_catalog.current_setting('gooddealer.account_id', true) ~ '^[!-~]{1,160}$'
        AND pg_catalog.current_setting('gooddealer.workspace_id', true) ~ '^[!-~]{1,160}$'
        AND account_id = pg_catalog.current_setting('gooddealer.account_id', true)
        AND workspace_id = pg_catalog.current_setting('gooddealer.workspace_id', true)
      )
      WITH CHECK (
        pg_catalog.current_setting('gooddealer.account_id', true) ~ '^[!-~]{1,160}$'
        AND pg_catalog.current_setting('gooddealer.workspace_id', true) ~ '^[!-~]{1,160}$'
        AND account_id = pg_catalog.current_setting('gooddealer.account_id', true)
        AND workspace_id = pg_catalog.current_setting('gooddealer.workspace_id', true)
      );

    CREATE POLICY mutation_drain_records_owner_maintenance ON public.mutation_drain_records
      TO gooddealer_cloud_owner USING (true) WITH CHECK (true);
    CREATE POLICY mutation_drain_heads_owner_maintenance ON public.mutation_drain_heads
      TO gooddealer_cloud_owner USING (true) WITH CHECK (true);
    CREATE POLICY mutation_drain_seals_owner_maintenance ON public.mutation_drain_seals
      TO gooddealer_cloud_owner USING (true) WITH CHECK (true);

    ALTER TABLE public.mutation_drain_records OWNER TO gooddealer_cloud_owner;
    ALTER TABLE public.mutation_drain_heads OWNER TO gooddealer_cloud_owner;
    ALTER TABLE public.mutation_drain_seals OWNER TO gooddealer_cloud_owner;

    REVOKE ALL PRIVILEGES ON TABLE public.mutation_drain_records,
      public.mutation_drain_heads, public.mutation_drain_seals
      FROM PUBLIC, gooddealer_cloud_app;
    GRANT SELECT ON TABLE public.mutation_drain_records, public.mutation_drain_heads,
      public.mutation_drain_seals TO gooddealer_cloud_app;

    CREATE FUNCTION public.workspace_mutation_drain_reject_immutable_row()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $function$
    BEGIN
      RAISE EXCEPTION 'mutation drain evidence is immutable' USING ERRCODE = '55000';
    END;
    $function$;

    CREATE TRIGGER mutation_drain_records_immutable
      BEFORE UPDATE OR DELETE ON public.mutation_drain_records
      FOR EACH ROW EXECUTE FUNCTION public.workspace_mutation_drain_reject_immutable_row();
    CREATE TRIGGER mutation_drain_seals_immutable
      BEFORE UPDATE OR DELETE ON public.mutation_drain_seals
      FOR EACH ROW EXECUTE FUNCTION public.workspace_mutation_drain_reject_immutable_row();

    /*
     * App callers may propose a stream selector for pre-handoff ingestion, but that selector is
     * never authority. Lock the device prefix in the established account -> binding -> held-lease
     * order, then bind it to the active lease's activated workspace allocation before a derived
     * head or immutable record can exist. The proof-only seal routine below derives its selector
     * independently from the just-consumed proof.
     */
    CREATE FUNCTION public.workspace_mutation_drain_assert_active_domain(
      p_source_device_id text,
      p_active_lease_epoch bigint
    )
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $function$
    DECLARE
      v_account_id text;
      v_workspace_id text;
    BEGIN
      v_account_id := pg_catalog.current_setting('gooddealer.account_id', true);
      v_workspace_id := pg_catalog.current_setting('gooddealer.workspace_id', true);
      IF v_account_id IS NULL OR v_workspace_id IS NULL
        OR v_account_id !~ '^[!-~]{1,160}$'
        OR v_workspace_id !~ '^[!-~]{1,160}$'
        OR p_source_device_id IS NULL OR p_source_device_id !~ '^[!-~]{1,160}$'
        OR p_active_lease_epoch IS NULL OR p_active_lease_epoch < 1 OR p_active_lease_epoch > 9007199254740991 THEN
        RAISE EXCEPTION 'mutation drain selectors are unresolved' USING ERRCODE = '42501';
      END IF;

      PERFORM 1
      FROM public.device_account_states AS account_state
      WHERE account_state.account_id = v_account_id
      FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'mutation drain domain authority is unresolved' USING ERRCODE = '42501';
      END IF;

      PERFORM 1
      FROM public.device_bindings AS binding
      WHERE binding.account_id = v_account_id
        AND binding.device_id = p_source_device_id
        AND binding.status = 'bound'
      FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'mutation drain domain authority is unresolved' USING ERRCODE = '42501';
      END IF;

      PERFORM 1
      FROM public.device_active_leases AS lease
      JOIN public.device_lease_epoch_allocations AS allocation
        ON allocation.account_id = lease.account_id
        AND allocation.lease_epoch = lease.lease_epoch
      WHERE lease.account_id = v_account_id
        AND lease.device_id = p_source_device_id
        AND lease.lease_epoch = p_active_lease_epoch
        AND lease.released_at IS NULL
        AND lease.offline_execute_until > pg_catalog.transaction_timestamp()
        AND allocation.workspace_id = v_workspace_id
        AND allocation.status = 'activated'
      FOR UPDATE OF lease;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'mutation drain domain authority is unresolved' USING ERRCODE = '42501';
      END IF;
    END;
    $function$;

    CREATE FUNCTION public.workspace_mutation_drain_recompute_head(
      p_source_device_id text,
      p_active_lease_epoch bigint
    )
    RETURNS TABLE (
      contiguous_received_through bigint,
      highest_received_sequence bigint,
      rolling_digest bytea
    )
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $function$
    DECLARE
      v_account_id text;
      v_workspace_id text;
      v_contiguous bigint := 0;
      v_highest bigint := 0;
      v_digest bytea;
      v_record record;
    BEGIN
      v_account_id := pg_catalog.current_setting('gooddealer.account_id', true);
      v_workspace_id := pg_catalog.current_setting('gooddealer.workspace_id', true);
      IF v_account_id IS NULL OR v_workspace_id IS NULL
        OR v_account_id !~ '^[!-~]{1,160}$'
        OR v_workspace_id !~ '^[!-~]{1,160}$'
        OR p_source_device_id IS NULL OR p_source_device_id !~ '^[!-~]{1,160}$'
        OR p_active_lease_epoch IS NULL OR p_active_lease_epoch < 1 OR p_active_lease_epoch > 9007199254740991 THEN
        RAISE EXCEPTION 'mutation drain selectors are unresolved' USING ERRCODE = '42501';
      END IF;

      PERFORM public.workspace_mutation_drain_assert_active_domain(p_source_device_id, p_active_lease_epoch);

      v_digest := pg_catalog.sha256(pg_catalog.convert_to('GOODDEALER-DRAIN-SHA256-V1', 'UTF8'));
      INSERT INTO public.mutation_drain_heads (
        account_id, workspace_id, source_device_id, active_lease_epoch, rolling_digest
      ) VALUES (
        v_account_id, v_workspace_id, p_source_device_id, p_active_lease_epoch, v_digest
      ) ON CONFLICT (account_id, workspace_id, source_device_id, active_lease_epoch) DO NOTHING;

      PERFORM 1
      FROM public.mutation_drain_heads AS h
      WHERE h.account_id = v_account_id
        AND h.workspace_id = v_workspace_id
        AND h.source_device_id = p_source_device_id
        AND h.active_lease_epoch = p_active_lease_epoch
      FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'mutation drain head is unavailable' USING ERRCODE = '42501';
      END IF;

      FOR v_record IN
        SELECT r.device_mutation_sequence, r.canonical_envelope
        FROM public.mutation_drain_records AS r
        WHERE r.account_id = v_account_id
          AND r.workspace_id = v_workspace_id
          AND r.source_device_id = p_source_device_id
          AND r.active_lease_epoch = p_active_lease_epoch
        ORDER BY r.device_mutation_sequence
      LOOP
        IF v_record.device_mutation_sequence > v_highest THEN
          v_highest := v_record.device_mutation_sequence;
        END IF;
        IF v_record.device_mutation_sequence = v_contiguous + 1 THEN
          v_digest := pg_catalog.sha256(
            v_digest
            || pg_catalog.int4send(pg_catalog.octet_length(v_record.canonical_envelope)::integer)
            || v_record.canonical_envelope
          );
          v_contiguous := v_record.device_mutation_sequence;
        END IF;
      END LOOP;

      UPDATE public.mutation_drain_heads AS h
      SET contiguous_received_through = v_contiguous,
          highest_received_sequence = v_highest,
          rolling_digest = v_digest
      WHERE h.account_id = v_account_id
        AND h.workspace_id = v_workspace_id
        AND h.source_device_id = p_source_device_id
        AND h.active_lease_epoch = p_active_lease_epoch;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'mutation drain head disappeared' USING ERRCODE = '42501';
      END IF;

      RETURN QUERY SELECT v_contiguous, v_highest, v_digest;
    END;
    $function$;

    CREATE FUNCTION public.workspace_mutation_drain_lock_domain(
      p_source_device_id text,
      p_active_lease_epoch bigint
    )
    RETURNS TABLE (
      contiguous_received_through bigint,
      highest_received_sequence bigint,
      rolling_digest bytea,
      sealed boolean
    )
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $function$
    DECLARE
      v_account_id text;
      v_workspace_id text;
      v_contiguous bigint;
      v_highest bigint;
      v_digest bytea;
      v_sealed boolean;
    BEGIN
      v_account_id := pg_catalog.current_setting('gooddealer.account_id', true);
      v_workspace_id := pg_catalog.current_setting('gooddealer.workspace_id', true);
      IF v_account_id IS NULL OR v_workspace_id IS NULL
        OR v_account_id !~ '^[!-~]{1,160}$'
        OR v_workspace_id !~ '^[!-~]{1,160}$'
        OR p_source_device_id IS NULL OR p_source_device_id !~ '^[!-~]{1,160}$'
        OR p_active_lease_epoch IS NULL OR p_active_lease_epoch < 1 OR p_active_lease_epoch > 9007199254740991 THEN
        RAISE EXCEPTION 'mutation drain selectors are unresolved' USING ERRCODE = '42501';
      END IF;

      SELECT h.contiguous_received_through, h.highest_received_sequence, h.rolling_digest
      INTO v_contiguous, v_highest, v_digest
      FROM public.workspace_mutation_drain_recompute_head(p_source_device_id, p_active_lease_epoch) AS h;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'mutation drain head routine is unavailable' USING ERRCODE = '42501';
      END IF;

      SELECT EXISTS (
        SELECT 1
        FROM public.mutation_drain_seals AS s
        WHERE s.account_id = v_account_id
          AND s.workspace_id = v_workspace_id
          AND s.source_device_id = p_source_device_id
          AND s.active_lease_epoch = p_active_lease_epoch
      ) INTO v_sealed;
      RETURN QUERY SELECT v_contiguous, v_highest, v_digest, v_sealed;
    END;
    $function$;

    CREATE FUNCTION public.workspace_mutation_drain_append_record(
      p_source_device_id text,
      p_active_lease_epoch bigint,
      p_device_mutation_sequence bigint,
      p_canonical_envelope bytea
    )
    RETURNS bytea
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $function$
    DECLARE
      v_account_id text;
      v_workspace_id text;
      v_digest bytea;
      v_sealed boolean;
      v_existing record;
    BEGIN
      v_account_id := pg_catalog.current_setting('gooddealer.account_id', true);
      v_workspace_id := pg_catalog.current_setting('gooddealer.workspace_id', true);
      IF v_account_id IS NULL OR v_workspace_id IS NULL
        OR v_account_id !~ '^[!-~]{1,160}$'
        OR v_workspace_id !~ '^[!-~]{1,160}$'
        OR p_source_device_id IS NULL OR p_source_device_id !~ '^[!-~]{1,160}$'
        OR p_active_lease_epoch IS NULL OR p_active_lease_epoch < 1 OR p_active_lease_epoch > 9007199254740991
        OR p_device_mutation_sequence IS NULL OR p_device_mutation_sequence < 1 OR p_device_mutation_sequence > 9007199254740991
        OR p_canonical_envelope IS NULL
        OR pg_catalog.octet_length(p_canonical_envelope) NOT BETWEEN 1 AND 65536 THEN
        RAISE EXCEPTION 'mutation drain append is malformed' USING ERRCODE = '22023';
      END IF;

      SELECT d.sealed
      INTO v_sealed
      FROM public.workspace_mutation_drain_lock_domain(p_source_device_id, p_active_lease_epoch) AS d;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'mutation drain domain is unavailable' USING ERRCODE = '42501';
      END IF;
      IF v_sealed THEN
        RAISE EXCEPTION 'mutation drain domain is sealed' USING ERRCODE = '55000';
      END IF;

      v_digest := pg_catalog.sha256(p_canonical_envelope);
      INSERT INTO public.mutation_drain_records (
        account_id, workspace_id, source_device_id, active_lease_epoch, device_mutation_sequence,
        canonical_envelope, envelope_digest
      ) VALUES (
        v_account_id, v_workspace_id, p_source_device_id, p_active_lease_epoch, p_device_mutation_sequence,
        p_canonical_envelope, v_digest
      ) ON CONFLICT (account_id, workspace_id, source_device_id, active_lease_epoch, device_mutation_sequence) DO NOTHING;
      IF NOT FOUND THEN
        SELECT r.account_id, r.workspace_id, r.source_device_id, r.active_lease_epoch, r.device_mutation_sequence,
               r.canonical_envelope, r.envelope_digest, r.quarantine_reason
        INTO v_existing
        FROM public.mutation_drain_records AS r
        WHERE r.account_id = v_account_id
          AND r.workspace_id = v_workspace_id
          AND r.source_device_id = p_source_device_id
          AND r.active_lease_epoch = p_active_lease_epoch
          AND r.device_mutation_sequence = p_device_mutation_sequence
        FOR UPDATE;
        IF NOT FOUND
          OR v_existing.account_id IS DISTINCT FROM v_account_id
          OR v_existing.workspace_id IS DISTINCT FROM v_workspace_id
          OR v_existing.source_device_id IS DISTINCT FROM p_source_device_id
          OR v_existing.active_lease_epoch IS DISTINCT FROM p_active_lease_epoch
          OR v_existing.device_mutation_sequence IS DISTINCT FROM p_device_mutation_sequence
          OR v_existing.canonical_envelope IS DISTINCT FROM p_canonical_envelope
          OR v_existing.envelope_digest IS DISTINCT FROM v_digest
          OR v_existing.quarantine_reason IS NOT NULL THEN
          RAISE EXCEPTION 'mutation device_mutation_sequence conflicts with immutable drain evidence' USING ERRCODE = '23505';
        END IF;
      END IF;

      PERFORM public.workspace_mutation_drain_recompute_head(p_source_device_id, p_active_lease_epoch);
      RETURN v_digest;
    END;
    $function$;

    CREATE FUNCTION public.workspace_mutation_drain_install_accepted_seal(p_proof_id text)
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
        SELECT r.device_mutation_sequence, r.canonical_envelope
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
          v_digest := pg_catalog.sha256(
            v_digest
            || pg_catalog.int4send(pg_catalog.octet_length(v_record.canonical_envelope)::integer)
            || v_record.canonical_envelope
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
        last_assigned_device_mutation_sequence, rolling_digest, proof_id
      ) VALUES (
        v_account_id, v_workspace_id, v_source_device_id, v_active_lease_epoch,
        v_expected_sequence, v_expected_digest, p_proof_id
      ) ON CONFLICT (account_id, workspace_id, source_device_id, active_lease_epoch) DO NOTHING;
      IF FOUND THEN
        RETURN true;
      END IF;

      FOR v_existing IN
        SELECT s.account_id, s.workspace_id, s.source_device_id, s.active_lease_epoch,
               s.last_assigned_device_mutation_sequence, s.rolling_digest, s.proof_id
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
          OR v_existing.proof_id IS DISTINCT FROM p_proof_id THEN
          RETURN false;
        END IF;
      END LOOP;
      RETURN v_existing_count = 1;
    END;
    $function$;

    ALTER FUNCTION public.workspace_mutation_drain_reject_immutable_row()
      OWNER TO gooddealer_cloud_owner;
    ALTER FUNCTION public.workspace_mutation_drain_assert_active_domain(text, bigint)
      OWNER TO gooddealer_cloud_owner;
    ALTER FUNCTION public.workspace_mutation_drain_recompute_head(text, bigint)
      OWNER TO gooddealer_cloud_owner;
    ALTER FUNCTION public.workspace_mutation_drain_lock_domain(text, bigint)
      OWNER TO gooddealer_cloud_owner;
    ALTER FUNCTION public.workspace_mutation_drain_append_record(text, bigint, bigint, bytea)
      OWNER TO gooddealer_cloud_owner;
    ALTER FUNCTION public.workspace_mutation_drain_install_accepted_seal(text)
      OWNER TO gooddealer_cloud_owner;

    REVOKE ALL PRIVILEGES ON FUNCTION public.workspace_mutation_drain_reject_immutable_row()
      FROM PUBLIC, gooddealer_cloud_app;
    REVOKE ALL PRIVILEGES ON FUNCTION public.workspace_mutation_drain_assert_active_domain(text, bigint)
      FROM PUBLIC, gooddealer_cloud_app;
    REVOKE ALL PRIVILEGES ON FUNCTION public.workspace_mutation_drain_recompute_head(text, bigint)
      FROM PUBLIC, gooddealer_cloud_app;
    REVOKE ALL PRIVILEGES ON FUNCTION public.workspace_mutation_drain_lock_domain(text, bigint)
      FROM PUBLIC, gooddealer_cloud_app;
    REVOKE ALL PRIVILEGES ON FUNCTION public.workspace_mutation_drain_append_record(text, bigint, bigint, bytea)
      FROM PUBLIC, gooddealer_cloud_app;
    REVOKE ALL PRIVILEGES ON FUNCTION public.workspace_mutation_drain_install_accepted_seal(text)
      FROM PUBLIC, gooddealer_cloud_app;
    GRANT EXECUTE ON FUNCTION public.workspace_mutation_drain_lock_domain(text, bigint),
      public.workspace_mutation_drain_append_record(text, bigint, bigint, bytea),
      public.workspace_mutation_drain_install_accepted_seal(text)
      TO gooddealer_cloud_app;

    DO $routine_acl$
    BEGIN
      IF pg_catalog.has_function_privilege(
        'gooddealer_cloud_app',
        'public.workspace_mutation_drain_assert_active_domain(text, bigint)',
        'EXECUTE'
      ) THEN
        RAISE EXCEPTION 'gooddealer app role can execute mutation domain authority helper'
          USING ERRCODE = '42501';
      END IF;
    END;
    $routine_acl$;
  `,
};
