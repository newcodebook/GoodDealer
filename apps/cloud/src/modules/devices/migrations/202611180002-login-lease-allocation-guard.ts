import type { CloudMigration } from "../../../db/index";

/**
 * ADR-0033 T2a: Desktop login and refresh must never allocate a Lease while a switch is unfinished
 * or an epoch allocation is pending, or they would bypass the drain handoff, bootstrap and
 * activation. Login runs with only the account selector, but switch workflows are workspace-scoped
 * under row security and would read as absent there, so the check would silently pass. This owner
 * routine answers that one question for the caller's own account and reveals nothing else. The
 * row-security exemption is granted by role name, so the routine is owned by that role explicitly
 * and refuses to run as any other: under another owner it would read no workflows and fail open.
 */
export const loginLeaseAllocationGuardMigration: CloudMigration = {
  id: "202611180002-login-lease-allocation-guard",
  owner: "devices",
  sql: `
    CREATE FUNCTION public.device_lease_allocation_reserved()
    RETURNS boolean
    LANGUAGE plpgsql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $function$
    DECLARE
      v_account_id text;
    BEGIN
      IF CURRENT_USER <> 'gooddealer_cloud_owner' THEN
        RAISE EXCEPTION 'device lease guard runs only as the device owner' USING ERRCODE = '42501';
      END IF;
      v_account_id := pg_catalog.current_setting('gooddealer.account_id', true);
      IF v_account_id IS NULL OR v_account_id !~ '^[!-~]{1,160}$' THEN
        RAISE EXCEPTION 'device account selector is unresolved' USING ERRCODE = '42501';
      END IF;
      RETURN EXISTS (
          SELECT 1 FROM public.device_switch_workflows AS w
           WHERE w.account_id = v_account_id
             AND w.status IN ('requested', 'draining', 'waiting_expiry', 'bootstrapping')
        )
        OR EXISTS (
          SELECT 1 FROM public.device_lease_epoch_allocations AS a
           WHERE a.account_id = v_account_id AND a.status = 'pending'
        );
    END;
    $function$;
    ALTER FUNCTION public.device_lease_allocation_reserved() OWNER TO gooddealer_cloud_owner;
    REVOKE ALL PRIVILEGES ON FUNCTION public.device_lease_allocation_reserved() FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.device_lease_allocation_reserved() TO gooddealer_cloud_app;
  `,
};
