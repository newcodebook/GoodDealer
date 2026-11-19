import type { CloudMigration } from "../../../db/index";

/** The evidence producer uses the M019 authenticated role, not selector-only app admission. */
export const executionContextCapabilityMigration: CloudMigration = {
  id: "202611190002-execution-context-capability", owner: "devices",
  sql: `
GRANT SELECT ON public.device_execution_contexts TO gd_account_api;
CREATE POLICY device_execution_contexts_identity_capability ON public.device_execution_contexts
 AS RESTRICTIVE TO gd_account_api
 USING(current_setting('gooddealer.capability_purpose',true)='devices_account'
 AND account_id=identity_private.current_transaction_account());
SET LOCAL ROLE gd_identity_owner;
GRANT USAGE ON SCHEMA identity_private TO gooddealer_cloud_owner;
GRANT USAGE ON TYPE identity_private.transaction_capability_purpose TO gooddealer_cloud_owner;
RESET ROLE;
SET LOCAL ROLE gd_identity_definer;
GRANT EXECUTE ON FUNCTION identity_private.current_transaction_account(identity_private.transaction_capability_purpose) TO gooddealer_cloud_owner;
RESET ROLE;
-- Keep the insertion implementation unreachable except through the authenticated wrapper.
REVOKE ALL ON FUNCTION public.device_execution_context_append(jsonb,jsonb,bytea,bytea,bytea,bytea,bytea) FROM gooddealer_cloud_app;
ALTER FUNCTION public.device_execution_context_append(jsonb,jsonb,bytea,bytea,bytea,bytea,bytea) RENAME TO device_execution_context_append_verified;
CREATE FUNCTION public.device_execution_context_append(
 p_context jsonb,p_grant jsonb,p_context_bytes bytea,p_grant_bytes bytea,p_device_key bytea,p_grant_receipt bytea,p_context_receipt bytea
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $function$
DECLARE v_account text;
BEGIN
 v_account := identity_private.current_transaction_account('devices_account'::identity_private.transaction_capability_purpose);
 IF v_account IS NULL OR v_account IS DISTINCT FROM p_context->>'accountId'
  OR current_setting('gooddealer.capability_purpose',true) IS DISTINCT FROM 'devices_account'
  OR current_setting('gooddealer.account_id',true) IS DISTINCT FROM v_account
  OR current_setting('gooddealer.workspace_id',true) IS DISTINCT FROM p_context->>'workspaceId'
  OR (p_context - ARRAY['schemaVersion','typ','iss','aud','kid','nonce','accountId','workspaceId','deviceId','accountSecurityEpoch','activeLeaseEpoch','credentialEpoch','signingKeyId','signingKeyVersion','authorizationGrantDigest','serverObservedAt','expiresAt','signature']) <> '{}'::jsonb
  OR clock_timestamp() >= (p_context->>'serverObservedAt')::timestamptz + interval '30 seconds' THEN
  RAISE EXCEPTION 'execution context rejected' USING ERRCODE='42501';
 END IF;
 PERFORM public.device_execution_context_append_verified(p_context,p_grant,p_context_bytes,p_grant_bytes,p_device_key,p_grant_receipt,p_context_receipt);
END;
$function$;
ALTER FUNCTION public.device_execution_context_append(jsonb,jsonb,bytea,bytea,bytea,bytea,bytea) OWNER TO gooddealer_cloud_owner;
REVOKE ALL ON FUNCTION public.device_execution_context_append(jsonb,jsonb,bytea,bytea,bytea,bytea,bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.device_execution_context_append(jsonb,jsonb,bytea,bytea,bytea,bytea,bytea) TO gd_account_api;
`,
};
