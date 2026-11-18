import type { CloudMigration } from "../../../db/index";

/**
 * ADR-0030 B1: a drain proof declares which mutation chain its claim was computed over. Every
 * existing proof is schema v1 and keeps its stored bytes and digests; the version is never
 * upgraded in place. Stream owners read it only through the just-consumed binding below.
 */
export const drainProofSchemaVersionMigration: CloudMigration = {
  id: "202611130001-drain-proof-schema-version",
  owner: "devices",
  sql: `
    ALTER TABLE public.device_drain_proofs
      ADD COLUMN proof_schema_version smallint NOT NULL DEFAULT 1
        CHECK (proof_schema_version IN (1, 2));
    CREATE FUNCTION public.device_read_just_consumed_drain_proof_schema_version(p_proof_id text)
    RETURNS smallint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $function$
    DECLARE
      v_account_id text;
      v_workspace_id text;
      v_now timestamptz;
      v_version smallint;
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
      -- Same just-consumed binding as device_read_just_consumed_drain_proof.
      SELECT p.proof_schema_version INTO v_version
      FROM public.device_drain_proofs AS p
      WHERE p.account_id = v_account_id
        AND p.workspace_id = v_workspace_id
        AND p.proof_id = p_proof_id
        AND p.purpose = 'handoff'
        AND p.consumed_at = v_now
        AND p.accepted_at = v_now
        AND p.consumed_transaction_id = pg_catalog.pg_current_xact_id();
      RETURN v_version;
    END;
    $function$;

    ALTER FUNCTION public.device_read_just_consumed_drain_proof_schema_version(text)
      OWNER TO gooddealer_cloud_owner;
    REVOKE ALL PRIVILEGES ON FUNCTION public.device_read_just_consumed_drain_proof_schema_version(text)
      FROM PUBLIC, gooddealer_cloud_app;

    DO $routine_acl$
    BEGIN
      IF pg_catalog.has_function_privilege(
        'gooddealer_cloud_app',
        'public.device_read_just_consumed_drain_proof_schema_version(text)',
        'EXECUTE'
      ) THEN
        RAISE EXCEPTION 'gooddealer app role can execute the proof version reader' USING ERRCODE = '42501';
      END IF;
    END;
    $routine_acl$;
  `,
};
