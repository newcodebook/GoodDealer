import type { CloudMigration } from "../../../db/index";

export const workspaceDeviceAuditDrainLedgerMigration: CloudMigration = {
  id: "202608200008-workspace-device-audit-drain-ledger",
  owner: "audit",
  sql: `
    CREATE TABLE workspace_device_audit_drain_records (
      account_id text NOT NULL, workspace_id text NOT NULL, source_device_id text NOT NULL,
      active_lease_epoch bigint NOT NULL CHECK (active_lease_epoch BETWEEN 1 AND 9007199254740991), audit_sequence bigint NOT NULL CHECK (audit_sequence BETWEEN 1 AND 9007199254740991),
      chain_id text NOT NULL, event_hash bytea NOT NULL CHECK (octet_length(event_hash) = 32), canonical_envelope bytea NOT NULL,
      envelope_digest bytea NOT NULL CHECK (octet_length(envelope_digest) = 32), received_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
      quarantine_reason text CHECK (quarantine_reason IN ('sequence_replay','drain_seal_violation','chain_fork')),
      PRIMARY KEY (account_id, workspace_id, source_device_id, active_lease_epoch, audit_sequence)
    );
    CREATE TABLE workspace_device_audit_drain_heads (
      account_id text NOT NULL, workspace_id text NOT NULL, source_device_id text NOT NULL,
      active_lease_epoch bigint NOT NULL CHECK (active_lease_epoch BETWEEN 1 AND 9007199254740991), chain_id text NOT NULL,
      contiguous_received_through bigint NOT NULL DEFAULT 0 CHECK (contiguous_received_through >= 0),
      highest_received_sequence bigint NOT NULL DEFAULT 0 CHECK (highest_received_sequence >= contiguous_received_through),
      rolling_digest bytea NOT NULL CHECK (octet_length(rolling_digest) = 32), head_hash bytea NOT NULL CHECK (octet_length(head_hash) = 32),
      forked boolean NOT NULL DEFAULT false,
      PRIMARY KEY (account_id, workspace_id, source_device_id, active_lease_epoch)
    );
    CREATE TABLE workspace_device_audit_drain_seals (
      account_id text NOT NULL, workspace_id text NOT NULL, source_device_id text NOT NULL, active_lease_epoch bigint NOT NULL,
      last_assigned_audit_sequence bigint NOT NULL CHECK (last_assigned_audit_sequence >= 0), rolling_digest bytea NOT NULL CHECK (octet_length(rolling_digest) = 32),
      proof_id text NOT NULL, accepted_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
      PRIMARY KEY (account_id, workspace_id, source_device_id, active_lease_epoch), UNIQUE (account_id, workspace_id, proof_id),
      FOREIGN KEY (account_id, workspace_id, source_device_id, active_lease_epoch)
        REFERENCES workspace_device_audit_drain_heads(account_id, workspace_id, source_device_id, active_lease_epoch)
    );
    DO $$ DECLARE table_name text; BEGIN FOREACH table_name IN ARRAY ARRAY['workspace_device_audit_drain_records','workspace_device_audit_drain_heads','workspace_device_audit_drain_seals'] LOOP
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name); EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
      EXECUTE format('CREATE POLICY %I ON %I USING (CURRENT_USER = ''gooddealer_cloud_owner'' OR (account_id = current_setting(''gooddealer.account_id'', true) AND workspace_id = current_setting(''gooddealer.workspace_id'', true))) WITH CHECK (CURRENT_USER = ''gooddealer_cloud_owner'' OR (account_id = current_setting(''gooddealer.account_id'', true) AND workspace_id = current_setting(''gooddealer.workspace_id'', true)))', table_name || '_tenant_scope', table_name);
    END LOOP; END $$;
    GRANT SELECT, INSERT, UPDATE ON workspace_device_audit_drain_records, workspace_device_audit_drain_heads, workspace_device_audit_drain_seals TO gooddealer_cloud_app;

    REVOKE CREATE ON SCHEMA public FROM PUBLIC, gooddealer_cloud_app;
    GRANT USAGE ON SCHEMA public TO gooddealer_cloud_app;
    GRANT USAGE ON SCHEMA public TO gooddealer_cloud_owner;

    ALTER TABLE public.workspace_device_audit_drain_records ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.workspace_device_audit_drain_records FORCE ROW LEVEL SECURITY;
    ALTER TABLE public.workspace_device_audit_drain_heads ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.workspace_device_audit_drain_heads FORCE ROW LEVEL SECURITY;
    ALTER TABLE public.workspace_device_audit_drain_seals ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.workspace_device_audit_drain_seals FORCE ROW LEVEL SECURITY;
    ALTER TABLE public.workspace_device_audit_drain_records OWNER TO gooddealer_cloud_owner;
    ALTER TABLE public.workspace_device_audit_drain_heads OWNER TO gooddealer_cloud_owner;
    ALTER TABLE public.workspace_device_audit_drain_seals OWNER TO gooddealer_cloud_owner;

    REVOKE ALL PRIVILEGES ON TABLE public.workspace_device_audit_drain_records
      FROM PUBLIC, gooddealer_cloud_app;
    REVOKE ALL PRIVILEGES ON TABLE public.workspace_device_audit_drain_heads
      FROM PUBLIC, gooddealer_cloud_app;
    REVOKE ALL PRIVILEGES ON TABLE public.workspace_device_audit_drain_seals
      FROM PUBLIC, gooddealer_cloud_app;
    GRANT SELECT ON TABLE public.workspace_device_audit_drain_records,
      public.workspace_device_audit_drain_heads,
      public.workspace_device_audit_drain_seals TO gooddealer_cloud_app;

    CREATE FUNCTION public.audit_reject_workspace_device_drain_immutable_mutation()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $function$
    BEGIN
      RAISE EXCEPTION 'workspace device audit drain records and seals are immutable'
        USING ERRCODE = '55000';
    END;
    $function$;

    CREATE TRIGGER workspace_device_audit_drain_records_immutable
      BEFORE UPDATE OR DELETE ON public.workspace_device_audit_drain_records
      FOR EACH ROW EXECUTE FUNCTION public.audit_reject_workspace_device_drain_immutable_mutation();
    CREATE TRIGGER workspace_device_audit_drain_seals_immutable
      BEFORE UPDATE OR DELETE ON public.workspace_device_audit_drain_seals
      FOR EACH ROW EXECUTE FUNCTION public.audit_reject_workspace_device_drain_immutable_mutation();

    CREATE FUNCTION public.audit_recompute_workspace_device_drain_head(
      p_source_device_id text,
      p_active_lease_epoch bigint
    )
    RETURNS TABLE (
      chain_id text,
      contiguous_received_through bigint,
      highest_received_sequence bigint,
      rolling_digest bytea,
      head_hash bytea,
      forked boolean
    )
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $function$
    DECLARE
      v_account_id text;
      v_workspace_id text;
      v_genesis_digest bytea;
      v_chain_id text := '';
      v_contiguous_received_through bigint := 0;
      v_highest_received_sequence bigint := 0;
      v_rolling_digest bytea;
      v_head_hash bytea;
      v_forked boolean := false;
      v_seen_record boolean := false;
      v_record record;
    BEGIN
      v_account_id := pg_catalog.current_setting('gooddealer.account_id', true);
      v_workspace_id := pg_catalog.current_setting('gooddealer.workspace_id', true);
      IF v_account_id IS NULL OR v_workspace_id IS NULL
        OR v_account_id !~ '^[!-~]{1,160}$'
        OR v_workspace_id !~ '^[!-~]{1,160}$'
        OR p_source_device_id IS NULL OR p_source_device_id !~ '^[!-~]{1,160}$'
        OR p_active_lease_epoch IS NULL OR p_active_lease_epoch < 1 OR p_active_lease_epoch > 9007199254740991 THEN
        RAISE EXCEPTION 'audit tenant selectors or drain domain are unresolved' USING ERRCODE = '42501';
      END IF;

      -- A domain lock serializes record appends, derived-head recomputation, and proof sealing.
      PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
        v_account_id || ' ' || v_workspace_id || ' ' || p_source_device_id || ' ' || p_active_lease_epoch::text,
        0
      ));

      v_genesis_digest := pg_catalog.sha256(
        pg_catalog.convert_to('GOODDEALER-DRAIN-SHA256-V1', 'UTF8')
      );
      IF pg_catalog.octet_length(v_genesis_digest) <> 32 THEN
        RAISE EXCEPTION 'audit drain genesis digest is unavailable' USING ERRCODE = '55000';
      END IF;
      v_rolling_digest := v_genesis_digest;
      v_head_hash := v_genesis_digest;

      -- These values are placeholders only until the same owner routine derives every field
      -- below from immutable records; callers never provide a head replacement.
      INSERT INTO public.workspace_device_audit_drain_heads (
        account_id, workspace_id, source_device_id, active_lease_epoch, chain_id,
        contiguous_received_through, highest_received_sequence, rolling_digest, head_hash, forked
      ) VALUES (
        v_account_id, v_workspace_id, p_source_device_id, p_active_lease_epoch, '',
        0, 0, v_genesis_digest, v_genesis_digest, false
      ) ON CONFLICT DO NOTHING;

      PERFORM 1
      FROM public.workspace_device_audit_drain_heads AS h
      WHERE h.account_id = v_account_id
        AND h.workspace_id = v_workspace_id
        AND h.source_device_id = p_source_device_id
        AND h.active_lease_epoch = p_active_lease_epoch
      FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'audit drain head is unavailable' USING ERRCODE = '55000';
      END IF;

      FOR v_record IN
        SELECT r.audit_sequence, r.chain_id, r.event_hash, r.canonical_envelope, r.envelope_digest,
               r.quarantine_reason
        FROM public.workspace_device_audit_drain_records AS r
        WHERE r.account_id = v_account_id
          AND r.workspace_id = v_workspace_id
          AND r.source_device_id = p_source_device_id
          AND r.active_lease_epoch = p_active_lease_epoch
        ORDER BY r.audit_sequence ASC
      LOOP
        IF v_record.audit_sequence < 1 OR v_record.audit_sequence > 9007199254740991
          OR v_record.chain_id !~ '^[!-~]{1,200}$'
          OR pg_catalog.octet_length(v_record.event_hash) <> 32
          OR pg_catalog.octet_length(v_record.canonical_envelope) NOT BETWEEN 1 AND 65536
          OR pg_catalog.octet_length(v_record.envelope_digest) <> 32
          OR v_record.envelope_digest IS DISTINCT FROM pg_catalog.sha256(v_record.canonical_envelope)
          OR v_record.quarantine_reason IS NOT NULL THEN
          RAISE EXCEPTION 'immutable audit drain record is malformed or quarantined' USING ERRCODE = '22000';
        END IF;

        IF NOT v_seen_record THEN
          v_chain_id := v_record.chain_id;
          v_seen_record := true;
        ELSIF v_record.chain_id <> v_chain_id THEN
          v_forked := true;
        END IF;

        v_highest_received_sequence := v_record.audit_sequence;
        v_head_hash := v_record.event_hash;
        IF v_record.audit_sequence = v_contiguous_received_through + 1 THEN
          v_rolling_digest := pg_catalog.sha256(
            v_rolling_digest
            || pg_catalog.int4send(pg_catalog.octet_length(v_record.canonical_envelope))
            || v_record.canonical_envelope
          );
          v_contiguous_received_through := v_record.audit_sequence;
        END IF;
      END LOOP;

      UPDATE public.workspace_device_audit_drain_heads AS h
      SET chain_id = v_chain_id,
          contiguous_received_through = v_contiguous_received_through,
          highest_received_sequence = v_highest_received_sequence,
          rolling_digest = v_rolling_digest,
          head_hash = v_head_hash,
          forked = v_forked
      WHERE h.account_id = v_account_id
        AND h.workspace_id = v_workspace_id
        AND h.source_device_id = p_source_device_id
        AND h.active_lease_epoch = p_active_lease_epoch;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'audit drain head disappeared during recomputation' USING ERRCODE = '55000';
      END IF;

      RETURN QUERY SELECT
        v_chain_id,
        v_contiguous_received_through,
        v_highest_received_sequence,
        v_rolling_digest,
        v_head_hash,
        v_forked;
    END;
    $function$;

    CREATE FUNCTION public.audit_append_workspace_device_drain_record(
      p_source_device_id text,
      p_active_lease_epoch bigint,
      p_audit_sequence bigint,
      p_chain_id text,
      p_event_hash bytea,
      p_canonical_envelope bytea,
      p_envelope_digest bytea
    )
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $function$
    DECLARE
      v_account_id text;
      v_workspace_id text;
      v_landed_chain_id text;
      v_landed_event_hash bytea;
      v_landed_canonical_envelope bytea;
      v_landed_envelope_digest bytea;
      v_landed_quarantine_reason text;
    BEGIN
      v_account_id := pg_catalog.current_setting('gooddealer.account_id', true);
      v_workspace_id := pg_catalog.current_setting('gooddealer.workspace_id', true);
      IF v_account_id IS NULL OR v_workspace_id IS NULL
        OR v_account_id !~ '^[!-~]{1,160}$'
        OR v_workspace_id !~ '^[!-~]{1,160}$' THEN
        RAISE EXCEPTION 'audit tenant selectors are unresolved' USING ERRCODE = '42501';
      END IF;
      IF p_source_device_id IS NULL OR p_source_device_id !~ '^[!-~]{1,160}$'
        OR p_active_lease_epoch IS NULL OR p_active_lease_epoch < 1 OR p_active_lease_epoch > 9007199254740991
        OR p_audit_sequence IS NULL OR p_audit_sequence < 1 OR p_audit_sequence > 9007199254740991
        OR p_chain_id IS NULL OR p_chain_id !~ '^[!-~]{1,200}$'
        OR p_event_hash IS NULL OR pg_catalog.octet_length(p_event_hash) <> 32
        OR p_canonical_envelope IS NULL OR pg_catalog.octet_length(p_canonical_envelope) NOT BETWEEN 1 AND 65536
        OR p_envelope_digest IS NULL OR pg_catalog.octet_length(p_envelope_digest) <> 32
        OR p_envelope_digest IS DISTINCT FROM pg_catalog.sha256(p_canonical_envelope) THEN
        RAISE EXCEPTION 'audit drain record input is invalid' USING ERRCODE = '22000';
      END IF;

      PERFORM 1
      FROM public.workspace_device_audit_drain_seals AS s
      WHERE s.account_id = v_account_id
        AND s.workspace_id = v_workspace_id
        AND s.source_device_id = p_source_device_id
        AND s.active_lease_epoch = p_active_lease_epoch;
      IF FOUND THEN
        RAISE EXCEPTION 'audit drain domain is sealed' USING ERRCODE = '55000';
      END IF;

      INSERT INTO public.workspace_device_audit_drain_records (
        account_id, workspace_id, source_device_id, active_lease_epoch, audit_sequence,
        chain_id, event_hash, canonical_envelope, envelope_digest
      ) VALUES (
        v_account_id, v_workspace_id, p_source_device_id, p_active_lease_epoch, p_audit_sequence,
        p_chain_id, p_event_hash, p_canonical_envelope, p_envelope_digest
      ) ON CONFLICT DO NOTHING;

      SELECT r.chain_id, r.event_hash, r.canonical_envelope, r.envelope_digest, r.quarantine_reason
      INTO v_landed_chain_id, v_landed_event_hash, v_landed_canonical_envelope, v_landed_envelope_digest,
           v_landed_quarantine_reason
      FROM public.workspace_device_audit_drain_records AS r
      WHERE r.account_id = v_account_id
        AND r.workspace_id = v_workspace_id
        AND r.source_device_id = p_source_device_id
        AND r.active_lease_epoch = p_active_lease_epoch
        AND r.audit_sequence = p_audit_sequence
      FOR UPDATE;
      IF NOT FOUND
        OR v_landed_chain_id IS DISTINCT FROM p_chain_id
        OR v_landed_event_hash IS DISTINCT FROM p_event_hash
        OR v_landed_canonical_envelope IS DISTINCT FROM p_canonical_envelope
        OR v_landed_envelope_digest IS DISTINCT FROM p_envelope_digest
        OR v_landed_quarantine_reason IS NOT NULL THEN
        RAISE EXCEPTION 'audit drain record conflicts with immutable evidence' USING ERRCODE = '23505';
      END IF;

      PERFORM 1
      FROM public.audit_recompute_workspace_device_drain_head(p_source_device_id, p_active_lease_epoch);

      -- Recheck while the owner routine's domain lock is held so an append cannot race a seal.
      PERFORM 1
      FROM public.workspace_device_audit_drain_seals AS s
      WHERE s.account_id = v_account_id
        AND s.workspace_id = v_workspace_id
        AND s.source_device_id = p_source_device_id
        AND s.active_lease_epoch = p_active_lease_epoch;
      IF FOUND THEN
        RAISE EXCEPTION 'audit drain domain was sealed during append' USING ERRCODE = '55000';
      END IF;
      RETURN true;
    END;
    $function$;

    CREATE FUNCTION public.audit_install_workspace_device_drain_seal(p_proof_id text)
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
      v_chain_id text;
      v_contiguous_received_through bigint;
      v_highest_received_sequence bigint;
      v_rolling_digest bytea;
      v_head_hash bytea;
      v_forked boolean;
      v_landed_proof_id text;
      v_landed_sequence bigint;
      v_landed_digest bytea;
    BEGIN
      v_account_id := pg_catalog.current_setting('gooddealer.account_id', true);
      v_workspace_id := pg_catalog.current_setting('gooddealer.workspace_id', true);
      IF v_account_id IS NULL OR v_workspace_id IS NULL
        OR v_account_id !~ '^[!-~]{1,160}$'
        OR v_workspace_id !~ '^[!-~]{1,160}$' THEN
        RAISE EXCEPTION 'audit tenant selectors are unresolved' USING ERRCODE = '42501';
      END IF;
      IF p_proof_id IS NULL OR p_proof_id !~ '^[!-~]{1,200}$' THEN
        RETURN false;
      END IF;

      SELECT proof.source_device_id, proof.active_lease_epoch,
             proof.device_audit_sequence, proof.device_audit_digest
      INTO v_source_device_id, v_active_lease_epoch, v_expected_sequence, v_expected_digest
      FROM public.device_read_just_consumed_drain_proof(p_proof_id) AS proof;
      IF NOT FOUND
        OR v_source_device_id IS NULL OR v_source_device_id !~ '^[!-~]{1,160}$'
        OR v_active_lease_epoch IS NULL OR v_active_lease_epoch < 1 OR v_active_lease_epoch > 9007199254740991
        OR v_expected_sequence IS NULL OR v_expected_sequence < 0 OR v_expected_sequence > 9007199254740991
        OR v_expected_digest IS NULL OR pg_catalog.octet_length(v_expected_digest) <> 32 THEN
        RETURN false;
      END IF;

      -- Recomputing a previously unseen domain materializes its derived head. GD019 is private
      -- to this nested transaction: a rejected proof rolls back that placeholder (and any
      -- candidate seal) while preserving the caller's already-consumed proof in its outer
      -- transaction. Successful first seals and same-transaction replays leave the block intact.
      BEGIN
        SELECT head.chain_id, head.contiguous_received_through, head.highest_received_sequence,
               head.rolling_digest, head.head_hash, head.forked
        INTO v_chain_id, v_contiguous_received_through, v_highest_received_sequence,
             v_rolling_digest, v_head_hash, v_forked
        FROM public.audit_recompute_workspace_device_drain_head(v_source_device_id, v_active_lease_epoch) AS head;
        IF NOT FOUND
          OR v_forked
          OR v_contiguous_received_through IS DISTINCT FROM v_expected_sequence
          OR v_highest_received_sequence IS DISTINCT FROM v_expected_sequence
          OR v_rolling_digest IS DISTINCT FROM v_expected_digest THEN
          RAISE EXCEPTION 'audit drain proof does not match the immutable head'
            USING ERRCODE = 'GD019';
        END IF;

        INSERT INTO public.workspace_device_audit_drain_seals (
          account_id, workspace_id, source_device_id, active_lease_epoch,
          last_assigned_audit_sequence, rolling_digest, proof_id
        ) VALUES (
          v_account_id, v_workspace_id, v_source_device_id, v_active_lease_epoch,
          v_expected_sequence, v_expected_digest, p_proof_id
        ) ON CONFLICT DO NOTHING;

        SELECT s.proof_id, s.last_assigned_audit_sequence, s.rolling_digest
        INTO v_landed_proof_id, v_landed_sequence, v_landed_digest
        FROM public.workspace_device_audit_drain_seals AS s
        WHERE s.account_id = v_account_id
          AND s.workspace_id = v_workspace_id
          AND s.source_device_id = v_source_device_id
          AND s.active_lease_epoch = v_active_lease_epoch
        FOR UPDATE;
        IF NOT FOUND
          OR v_landed_proof_id IS DISTINCT FROM p_proof_id
          OR v_landed_sequence IS DISTINCT FROM v_expected_sequence
          OR v_landed_digest IS DISTINCT FROM v_expected_digest THEN
          RAISE EXCEPTION 'audit drain seal conflicts with immutable evidence'
            USING ERRCODE = 'GD019';
        END IF;
      EXCEPTION
        WHEN SQLSTATE 'GD019' THEN
          RETURN false;
      END;
      RETURN true;
    END;
    $function$;

    ALTER FUNCTION public.audit_reject_workspace_device_drain_immutable_mutation()
      OWNER TO gooddealer_cloud_owner;
    ALTER FUNCTION public.audit_recompute_workspace_device_drain_head(text, bigint)
      OWNER TO gooddealer_cloud_owner;
    ALTER FUNCTION public.audit_append_workspace_device_drain_record(text, bigint, bigint, text, bytea, bytea, bytea)
      OWNER TO gooddealer_cloud_owner;
    ALTER FUNCTION public.audit_install_workspace_device_drain_seal(text)
      OWNER TO gooddealer_cloud_owner;

    REVOKE ALL PRIVILEGES ON FUNCTION public.audit_reject_workspace_device_drain_immutable_mutation()
      FROM PUBLIC, gooddealer_cloud_app;
    REVOKE ALL PRIVILEGES ON FUNCTION public.audit_recompute_workspace_device_drain_head(text, bigint)
      FROM PUBLIC, gooddealer_cloud_app;
    REVOKE ALL PRIVILEGES ON FUNCTION public.audit_append_workspace_device_drain_record(text, bigint, bigint, text, bytea, bytea, bytea)
      FROM PUBLIC, gooddealer_cloud_app;
    REVOKE ALL PRIVILEGES ON FUNCTION public.audit_install_workspace_device_drain_seal(text)
      FROM PUBLIC, gooddealer_cloud_app;
    GRANT EXECUTE ON FUNCTION public.audit_install_workspace_device_drain_seal(text)
      TO gooddealer_cloud_app;
  `,
};
