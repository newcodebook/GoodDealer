import type { CloudMigration } from "../../../../db/index";

/** Desktop login allocates at account scope; only its exact default workspace may drain it. */
export const mutationDrainLoginAllocationMigration: CloudMigration = {
  id: "202611190021-mutation-drain-login-allocation",
  owner: "workspace/mutations",
  sql: `
    CREATE OR REPLACE FUNCTION public.workspace_mutation_drain_assert_active_domain(
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
        AND (allocation.workspace_id = v_workspace_id OR (
          allocation.allocation_source = 'desktop_login'
          AND allocation.workspace_id IS NULL AND allocation.workflow_id IS NULL
          AND EXISTS (SELECT 1 FROM public.workspace_account_bindings AS workspace_binding
            WHERE workspace_binding.account_id = v_account_id
              AND workspace_binding.workspace_id = v_workspace_id
              AND workspace_binding.owner_kind = 'account'
              AND workspace_binding.role = 'default_owner' AND workspace_binding.is_default)
        ))
        AND allocation.status = 'activated'
      FOR UPDATE OF lease;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'mutation drain domain authority is unresolved' USING ERRCODE = '42501';
      END IF;
    END;
    $function$;

    ALTER FUNCTION public.workspace_mutation_drain_assert_active_domain(text, bigint) OWNER TO gooddealer_cloud_owner;
    REVOKE ALL ON FUNCTION public.workspace_mutation_drain_assert_active_domain(text, bigint) FROM PUBLIC;
  `,
};
