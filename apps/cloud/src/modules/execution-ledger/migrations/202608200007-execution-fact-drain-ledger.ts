import type { CloudMigration } from "../../../db/index";

export const executionFactDrainLedgerMigration: CloudMigration = {
  id: "202608200007-execution-fact-drain-ledger",
  owner: "execution-ledger",
  sql: `
    CREATE TABLE execution_fact_drain_records (
      account_id text NOT NULL, workspace_id text NOT NULL, source_device_id text NOT NULL,
      active_lease_epoch bigint NOT NULL CHECK (active_lease_epoch BETWEEN 1 AND 9007199254740991),
      execution_fact_sequence bigint NOT NULL CHECK (execution_fact_sequence BETWEEN 1 AND 9007199254740991), canonical_envelope bytea NOT NULL,
      envelope_digest bytea NOT NULL CHECK (octet_length(envelope_digest) = 32), classification text CHECK (classification IN ('current', 'late')),
      received_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
      quarantine_reason text CHECK (quarantine_reason IN ('signature','epoch_unknown','time_unprovable','authorization','sequence_replay','drain_seal_violation','removal_boundary')),
      PRIMARY KEY (account_id, workspace_id, source_device_id, active_lease_epoch, execution_fact_sequence)
    );
    CREATE TABLE execution_fact_drain_heads (
      account_id text NOT NULL, workspace_id text NOT NULL, source_device_id text NOT NULL,
      active_lease_epoch bigint NOT NULL CHECK (active_lease_epoch BETWEEN 1 AND 9007199254740991),
      contiguous_received_through bigint NOT NULL DEFAULT 0 CHECK (contiguous_received_through >= 0),
      highest_received_sequence bigint NOT NULL DEFAULT 0 CHECK (highest_received_sequence >= contiguous_received_through),
      rolling_digest bytea NOT NULL CHECK (octet_length(rolling_digest) = 32),
      PRIMARY KEY (account_id, workspace_id, source_device_id, active_lease_epoch)
    );
    CREATE TABLE execution_fact_drain_seals (
      account_id text NOT NULL, workspace_id text NOT NULL, source_device_id text NOT NULL, active_lease_epoch bigint NOT NULL,
      last_assigned_execution_fact_sequence bigint NOT NULL CHECK (last_assigned_execution_fact_sequence >= 0), rolling_digest bytea NOT NULL CHECK (octet_length(rolling_digest) = 32),
      proof_id text NOT NULL, accepted_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
      PRIMARY KEY (account_id, workspace_id, source_device_id, active_lease_epoch), UNIQUE (account_id, workspace_id, proof_id),
      FOREIGN KEY (account_id, workspace_id, source_device_id, active_lease_epoch)
        REFERENCES execution_fact_drain_heads(account_id, workspace_id, source_device_id, active_lease_epoch)
    );
    DO $$ DECLARE table_name text; BEGIN FOREACH table_name IN ARRAY ARRAY['execution_fact_drain_records','execution_fact_drain_heads','execution_fact_drain_seals'] LOOP
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name); EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
      EXECUTE format('CREATE POLICY %I ON %I USING (CURRENT_USER = ''gooddealer_cloud_owner'' OR (account_id = current_setting(''gooddealer.account_id'', true) AND workspace_id = current_setting(''gooddealer.workspace_id'', true))) WITH CHECK (CURRENT_USER = ''gooddealer_cloud_owner'' OR (account_id = current_setting(''gooddealer.account_id'', true) AND workspace_id = current_setting(''gooddealer.workspace_id'', true)))', table_name || '_tenant_scope', table_name);
    END LOOP; END $$;
    GRANT SELECT, INSERT, UPDATE ON execution_fact_drain_records, execution_fact_drain_heads, execution_fact_drain_seals TO gooddealer_cloud_app;

    ALTER TABLE public.execution_fact_drain_records OWNER TO gooddealer_cloud_owner;
    ALTER TABLE public.execution_fact_drain_heads OWNER TO gooddealer_cloud_owner;
    ALTER TABLE public.execution_fact_drain_seals OWNER TO gooddealer_cloud_owner;

    ALTER TABLE public.execution_fact_drain_records ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.execution_fact_drain_records FORCE ROW LEVEL SECURITY;
    ALTER TABLE public.execution_fact_drain_heads ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.execution_fact_drain_heads FORCE ROW LEVEL SECURITY;
    ALTER TABLE public.execution_fact_drain_seals ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.execution_fact_drain_seals FORCE ROW LEVEL SECURITY;

    ALTER POLICY execution_fact_drain_records_tenant_scope ON public.execution_fact_drain_records
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
    ALTER POLICY execution_fact_drain_heads_tenant_scope ON public.execution_fact_drain_heads
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
    ALTER POLICY execution_fact_drain_seals_tenant_scope ON public.execution_fact_drain_seals
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

    CREATE POLICY execution_fact_drain_records_owner_maintenance ON public.execution_fact_drain_records
      TO gooddealer_cloud_owner USING (true) WITH CHECK (true);
    CREATE POLICY execution_fact_drain_heads_owner_maintenance ON public.execution_fact_drain_heads
      TO gooddealer_cloud_owner USING (true) WITH CHECK (true);
    CREATE POLICY execution_fact_drain_seals_owner_maintenance ON public.execution_fact_drain_seals
      TO gooddealer_cloud_owner USING (true) WITH CHECK (true);

    REVOKE ALL PRIVILEGES ON TABLE public.execution_fact_drain_records,
      public.execution_fact_drain_heads, public.execution_fact_drain_seals
      FROM PUBLIC, gooddealer_cloud_app;
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
      ON TABLE public.execution_fact_drain_records,
        public.execution_fact_drain_heads, public.execution_fact_drain_seals
      FROM gooddealer_cloud_app;
    GRANT SELECT ON TABLE public.execution_fact_drain_records,
      public.execution_fact_drain_heads, public.execution_fact_drain_seals
      TO gooddealer_cloud_app;

    CREATE FUNCTION public.execution_fact_drain_reject_immutable_change()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $function$
    BEGIN
      RAISE EXCEPTION 'execution fact drain evidence is immutable' USING ERRCODE = '55000';
    END;
    $function$;

    CREATE TRIGGER execution_fact_drain_records_immutable
      BEFORE UPDATE OR DELETE ON public.execution_fact_drain_records
      FOR EACH ROW EXECUTE FUNCTION public.execution_fact_drain_reject_immutable_change();
    CREATE TRIGGER execution_fact_drain_seals_immutable
      BEFORE UPDATE OR DELETE ON public.execution_fact_drain_seals
      FOR EACH ROW EXECUTE FUNCTION public.execution_fact_drain_reject_immutable_change();

    /* This owner-only routine is the sole derived-head writer. */
    CREATE FUNCTION public.execution_fact_drain_recompute_head(
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
        OR p_source_device_id IS NULL
        OR p_source_device_id !~ '^[!-~]{1,160}$'
        OR p_active_lease_epoch IS NULL
        OR p_active_lease_epoch < 1
        OR p_active_lease_epoch > 9007199254740991 THEN
        RAISE EXCEPTION 'execution fact drain selectors are unresolved' USING ERRCODE = '42501';
      END IF;

      v_digest := pg_catalog.sha256(
        pg_catalog.convert_to('GOODDEALER-DRAIN-SHA256-V1', 'UTF8')
      );
      IF pg_catalog.octet_length(v_digest) <> 32 THEN
        RAISE EXCEPTION 'execution fact drain genesis digest is unavailable' USING ERRCODE = '55000';
      END IF;

      INSERT INTO public.execution_fact_drain_heads (
        account_id, workspace_id, source_device_id, active_lease_epoch,
        contiguous_received_through, highest_received_sequence, rolling_digest
      ) VALUES (
        v_account_id, v_workspace_id, p_source_device_id, p_active_lease_epoch,
        0, 0, v_digest
      ) ON CONFLICT (account_id, workspace_id, source_device_id, active_lease_epoch) DO NOTHING;

      PERFORM 1
      FROM public.execution_fact_drain_heads AS h
      WHERE h.account_id = v_account_id
        AND h.workspace_id = v_workspace_id
        AND h.source_device_id = p_source_device_id
        AND h.active_lease_epoch = p_active_lease_epoch
      FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'execution fact drain head is unavailable' USING ERRCODE = '42501';
      END IF;

      SELECT COALESCE(pg_catalog.max(r.execution_fact_sequence), 0)
      INTO v_highest
      FROM public.execution_fact_drain_records AS r
      WHERE r.account_id = v_account_id
        AND r.workspace_id = v_workspace_id
        AND r.source_device_id = p_source_device_id
        AND r.active_lease_epoch = p_active_lease_epoch;

      FOR v_record IN
        SELECT r.execution_fact_sequence, r.canonical_envelope, r.envelope_digest
        FROM public.execution_fact_drain_records AS r
        WHERE r.account_id = v_account_id
          AND r.workspace_id = v_workspace_id
          AND r.source_device_id = p_source_device_id
          AND r.active_lease_epoch = p_active_lease_epoch
        ORDER BY r.execution_fact_sequence
      LOOP
        IF v_record.execution_fact_sequence < 1
          OR v_record.execution_fact_sequence > 9007199254740991
          OR pg_catalog.octet_length(v_record.canonical_envelope) NOT BETWEEN 1 AND 65536
          OR pg_catalog.octet_length(v_record.envelope_digest) <> 32
          OR v_record.envelope_digest IS DISTINCT FROM pg_catalog.sha256(v_record.canonical_envelope) THEN
          RAISE EXCEPTION 'immutable execution fact drain record is malformed' USING ERRCODE = '22000';
        END IF;
        IF v_record.execution_fact_sequence = v_contiguous + 1 THEN
          v_digest := pg_catalog.sha256(
            v_digest || pg_catalog.int4send(pg_catalog.octet_length(v_record.canonical_envelope))
            || v_record.canonical_envelope
          );
          v_contiguous := v_record.execution_fact_sequence;
        END IF;
      END LOOP;

      UPDATE public.execution_fact_drain_heads AS h
      SET contiguous_received_through = v_contiguous,
          highest_received_sequence = v_highest,
          rolling_digest = v_digest
      WHERE h.account_id = v_account_id
        AND h.workspace_id = v_workspace_id
        AND h.source_device_id = p_source_device_id
        AND h.active_lease_epoch = p_active_lease_epoch;

      RETURN QUERY SELECT v_contiguous, v_highest, v_digest;
    END;
    $function$;

    CREATE FUNCTION public.execution_fact_drain_append_record(
      p_source_device_id text,
      p_active_lease_epoch bigint,
      p_execution_fact_sequence bigint,
      p_canonical_envelope bytea,
      p_envelope_digest bytea,
      p_classification text,
      p_quarantine_reason text
    )
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $function$
    DECLARE
      v_account_id text;
      v_workspace_id text;
      v_existing record;
    BEGIN
      v_account_id := pg_catalog.current_setting('gooddealer.account_id', true);
      v_workspace_id := pg_catalog.current_setting('gooddealer.workspace_id', true);
      IF v_account_id IS NULL OR v_workspace_id IS NULL
        OR v_account_id !~ '^[!-~]{1,160}$'
        OR v_workspace_id !~ '^[!-~]{1,160}$' THEN
        RAISE EXCEPTION 'execution fact drain selectors are unresolved' USING ERRCODE = '42501';
      END IF;
      IF p_source_device_id IS NULL OR p_source_device_id !~ '^[!-~]{1,160}$'
        OR p_active_lease_epoch IS NULL OR p_active_lease_epoch < 1 OR p_active_lease_epoch > 9007199254740991
        OR p_execution_fact_sequence IS NULL OR p_execution_fact_sequence < 1 OR p_execution_fact_sequence > 9007199254740991
        OR p_canonical_envelope IS NULL
        OR pg_catalog.octet_length(p_canonical_envelope) NOT BETWEEN 1 AND 65536
        OR p_envelope_digest IS NULL
        OR pg_catalog.octet_length(p_envelope_digest) <> 32
        OR p_envelope_digest <> pg_catalog.sha256(p_canonical_envelope)
        OR (p_classification IS NOT NULL AND p_classification NOT IN ('current', 'late'))
        OR (p_quarantine_reason IS NOT NULL AND p_quarantine_reason NOT IN (
          'signature', 'epoch_unknown', 'time_unprovable', 'authorization', 'sequence_replay',
          'drain_seal_violation', 'removal_boundary'
        )) THEN
        RETURN false;
      END IF;

      PERFORM 1
      FROM public.execution_fact_drain_recompute_head(p_source_device_id, p_active_lease_epoch);
      PERFORM 1
      FROM public.execution_fact_drain_seals AS s
      WHERE s.account_id = v_account_id
        AND s.workspace_id = v_workspace_id
        AND s.source_device_id = p_source_device_id
        AND s.active_lease_epoch = p_active_lease_epoch;
      IF FOUND THEN
        RETURN false;
      END IF;

      INSERT INTO public.execution_fact_drain_records (
        account_id, workspace_id, source_device_id, active_lease_epoch, execution_fact_sequence,
        canonical_envelope, envelope_digest, classification, quarantine_reason
      ) VALUES (
        v_account_id, v_workspace_id, p_source_device_id, p_active_lease_epoch, p_execution_fact_sequence,
        p_canonical_envelope, p_envelope_digest, p_classification, p_quarantine_reason
      ) ON CONFLICT (account_id, workspace_id, source_device_id, active_lease_epoch, execution_fact_sequence) DO NOTHING;
      SELECT r.account_id, r.workspace_id, r.source_device_id, r.active_lease_epoch, r.execution_fact_sequence,
             r.canonical_envelope, r.envelope_digest, r.classification, r.quarantine_reason
      INTO v_existing
      FROM public.execution_fact_drain_records AS r
      WHERE r.account_id = v_account_id
        AND r.workspace_id = v_workspace_id
        AND r.source_device_id = p_source_device_id
        AND r.active_lease_epoch = p_active_lease_epoch
        AND r.execution_fact_sequence = p_execution_fact_sequence
      FOR UPDATE;
      IF NOT FOUND
        OR v_existing.account_id IS DISTINCT FROM v_account_id
        OR v_existing.workspace_id IS DISTINCT FROM v_workspace_id
        OR v_existing.source_device_id IS DISTINCT FROM p_source_device_id
        OR v_existing.active_lease_epoch IS DISTINCT FROM p_active_lease_epoch
        OR v_existing.execution_fact_sequence IS DISTINCT FROM p_execution_fact_sequence
        OR v_existing.canonical_envelope IS DISTINCT FROM p_canonical_envelope
        OR v_existing.envelope_digest IS DISTINCT FROM p_envelope_digest
        OR v_existing.classification IS DISTINCT FROM p_classification
        OR v_existing.quarantine_reason IS DISTINCT FROM p_quarantine_reason THEN
        RETURN false;
      END IF;

      PERFORM 1
      FROM public.execution_fact_drain_recompute_head(p_source_device_id, p_active_lease_epoch);
      RETURN true;
    END;
    $function$;

    CREATE FUNCTION public.execution_fact_drain_install_accepted_seal(p_proof_id text)
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
      v_sequence bigint;
      v_digest bytea;
      v_contiguous bigint;
      v_highest bigint;
      v_head_digest bytea;
      v_existing record;
    BEGIN
      v_account_id := pg_catalog.current_setting('gooddealer.account_id', true);
      v_workspace_id := pg_catalog.current_setting('gooddealer.workspace_id', true);
      IF v_account_id IS NULL OR v_workspace_id IS NULL
        OR v_account_id !~ '^[!-~]{1,160}$'
        OR v_workspace_id !~ '^[!-~]{1,160}$'
        OR p_proof_id IS NULL
        OR p_proof_id !~ '^[!-~]{1,200}$' THEN
        RAISE EXCEPTION 'execution fact drain selectors or proof identity are unresolved' USING ERRCODE = '42501';
      END IF;

      SELECT p.source_device_id, p.active_lease_epoch, p.execution_fact_sequence,
             p.execution_fact_digest
      INTO v_source_device_id, v_active_lease_epoch, v_sequence, v_digest
      FROM public.device_read_just_consumed_drain_proof(p_proof_id) AS p;
      IF NOT FOUND
        OR v_source_device_id IS NULL
        OR v_source_device_id !~ '^[!-~]{1,160}$'
        OR v_active_lease_epoch IS NULL
        OR v_active_lease_epoch < 1
        OR v_active_lease_epoch > 9007199254740991
        OR v_sequence IS NULL
        OR v_sequence < 0
        OR v_sequence > 9007199254740991
        OR v_digest IS NULL
        OR pg_catalog.octet_length(v_digest) <> 32 THEN
        RETURN false;
      END IF;

      -- Recomputing a previously unseen domain materializes its derived head. A rejected proof
      -- must not leave that placeholder behind, so mismatch detection is a nested transaction:
      -- GD001 is private to this block and rolls back the recomputation while preserving the
      -- caller's outer proof-consumption transaction.
      BEGIN
        SELECT h.contiguous_received_through, h.highest_received_sequence, h.rolling_digest
        INTO v_contiguous, v_highest, v_head_digest
        FROM public.execution_fact_drain_recompute_head(v_source_device_id, v_active_lease_epoch) AS h;
        IF NOT FOUND
          OR v_contiguous IS DISTINCT FROM v_sequence
          OR v_highest IS DISTINCT FROM v_sequence
          OR v_head_digest IS DISTINCT FROM v_digest THEN
          RAISE EXCEPTION 'execution fact drain proof does not match the immutable head'
            USING ERRCODE = 'GD001';
        END IF;
      EXCEPTION
        WHEN SQLSTATE 'GD001' THEN
          RETURN false;
      END;

      INSERT INTO public.execution_fact_drain_seals (
        account_id, workspace_id, source_device_id, active_lease_epoch,
        last_assigned_execution_fact_sequence, rolling_digest, proof_id
      ) VALUES (
        v_account_id, v_workspace_id, v_source_device_id, v_active_lease_epoch,
        v_sequence, v_digest, p_proof_id
      ) ON CONFLICT (account_id, workspace_id, source_device_id, active_lease_epoch) DO NOTHING;
      SELECT s.account_id, s.workspace_id, s.source_device_id, s.active_lease_epoch,
             s.proof_id, s.last_assigned_execution_fact_sequence, s.rolling_digest
      INTO v_existing
      FROM public.execution_fact_drain_seals AS s
      WHERE s.account_id = v_account_id
        AND s.workspace_id = v_workspace_id
        AND (
          (s.source_device_id = v_source_device_id AND s.active_lease_epoch = v_active_lease_epoch)
          OR s.proof_id = p_proof_id
        )
      FOR UPDATE;
      RETURN FOUND
        AND v_existing.account_id = v_account_id
        AND v_existing.workspace_id = v_workspace_id
        AND v_existing.source_device_id = v_source_device_id
        AND v_existing.active_lease_epoch = v_active_lease_epoch
        AND v_existing.proof_id = p_proof_id
        AND v_existing.last_assigned_execution_fact_sequence = v_sequence
        AND v_existing.rolling_digest = v_digest;
    END;
    $function$;

    ALTER FUNCTION public.execution_fact_drain_reject_immutable_change()
      OWNER TO gooddealer_cloud_owner;
    ALTER FUNCTION public.execution_fact_drain_recompute_head(text, bigint)
      OWNER TO gooddealer_cloud_owner;
    ALTER FUNCTION public.execution_fact_drain_append_record(text, bigint, bigint, bytea, bytea, text, text)
      OWNER TO gooddealer_cloud_owner;
    ALTER FUNCTION public.execution_fact_drain_install_accepted_seal(text)
      OWNER TO gooddealer_cloud_owner;

    REVOKE ALL PRIVILEGES ON FUNCTION public.execution_fact_drain_reject_immutable_change()
      FROM PUBLIC, gooddealer_cloud_app;
    REVOKE ALL PRIVILEGES ON FUNCTION public.execution_fact_drain_recompute_head(text, bigint)
      FROM PUBLIC, gooddealer_cloud_app;
    REVOKE ALL PRIVILEGES ON FUNCTION public.execution_fact_drain_append_record(text, bigint, bigint, bytea, bytea, text, text)
      FROM PUBLIC, gooddealer_cloud_app;
    REVOKE ALL PRIVILEGES ON FUNCTION public.execution_fact_drain_install_accepted_seal(text)
      FROM PUBLIC, gooddealer_cloud_app;
    GRANT EXECUTE ON FUNCTION public.execution_fact_drain_append_record(text, bigint, bigint, bytea, bytea, text, text)
      TO gooddealer_cloud_app;
    GRANT EXECUTE ON FUNCTION public.execution_fact_drain_install_accepted_seal(text)
      TO gooddealer_cloud_app;
  `,
};
