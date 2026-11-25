import type { CloudMigration } from "../../../db/index";

export const executionContextEnvelopeBindingMigration: CloudMigration = {
  id: "202611190004-execution-context-envelope-binding", owner: "devices",
  sql: `
REVOKE SELECT ON public.device_execution_contexts FROM gooddealer_cloud_app;
-- Private codec only for the two bounded evidence objects. No runtime role can call it directly.
CREATE FUNCTION public.device_execution_context_frame(p_tag text,p_bytes bytea)
 RETURNS bytea LANGUAGE sql IMMUTABLE SET search_path=pg_catalog
 RETURN convert_to(p_tag || octet_length(p_bytes)::text || ':','UTF8') || p_bytes;
CREATE FUNCTION public.device_execution_context_value(p_value jsonb,p_depth integer)
 RETURNS bytea LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $function$
DECLARE v_kind text:=jsonb_typeof(p_value); v_bytes bytea:=''::bytea; v_entry record; v_number numeric; v_string text;
BEGIN
 IF p_depth NOT BETWEEN 0 AND 8 OR p_value IS NULL OR octet_length(p_value::text)>32768 THEN
  RAISE EXCEPTION 'execution context canonical value rejected' USING ERRCODE='42501';
 END IF;
 IF v_kind='string' THEN
  v_string:=p_value#>>'{}';
  IF octet_length(v_string)>1024 THEN RAISE EXCEPTION 'execution context string rejected' USING ERRCODE='42501'; END IF;
  RETURN public.device_execution_context_frame('s',convert_to(v_string,'UTF8'));
 ELSIF v_kind='number' THEN
  v_number:=(p_value#>>'{}')::numeric;
  IF v_number<>trunc(v_number) OR v_number<0 OR v_number>9007199254740991 THEN
   RAISE EXCEPTION 'execution context integer rejected' USING ERRCODE='42501';
  END IF;
  RETURN public.device_execution_context_frame('n',convert_to(v_number::bigint::text,'UTF8'));
 ELSIF v_kind='array' THEN
  IF jsonb_array_length(p_value)>32 THEN RAISE EXCEPTION 'execution context array rejected' USING ERRCODE='42501'; END IF;
  FOR v_entry IN SELECT value FROM jsonb_array_elements(p_value) WITH ORDINALITY ORDER BY ordinality LOOP
   v_bytes:=v_bytes || public.device_execution_context_frame('e',public.device_execution_context_value(v_entry.value,p_depth+1));
  END LOOP;
  RETURN public.device_execution_context_frame('a',v_bytes);
 ELSIF v_kind='object' THEN
  IF (SELECT count(*) FROM jsonb_object_keys(p_value))>32 THEN RAISE EXCEPTION 'execution context object rejected' USING ERRCODE='42501'; END IF;
  FOR v_entry IN SELECT key,value FROM jsonb_each(p_value) ORDER BY key COLLATE "C" LOOP
   IF v_entry.key !~ '^[A-Za-z][A-Za-z0-9]{0,159}$' THEN RAISE EXCEPTION 'execution context key rejected' USING ERRCODE='42501'; END IF;
   v_bytes:=v_bytes || public.device_execution_context_frame('e',
     public.device_execution_context_frame('k',convert_to(v_entry.key,'UTF8')) || public.device_execution_context_frame('v',public.device_execution_context_value(v_entry.value,p_depth+1)));
  END LOOP;
  RETURN public.device_execution_context_frame('o',v_bytes);
 END IF;
 RAISE EXCEPTION 'execution context type rejected' USING ERRCODE='42501';
END;
$function$;
ALTER FUNCTION public.device_execution_context_frame(text,bytea) OWNER TO gooddealer_cloud_owner;
ALTER FUNCTION public.device_execution_context_value(jsonb,integer) OWNER TO gooddealer_cloud_owner;
REVOKE ALL ON FUNCTION public.device_execution_context_frame(text,bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.device_execution_context_value(jsonb,integer) FROM PUBLIC;
CREATE OR REPLACE FUNCTION public.device_execution_context_append(
 p_context jsonb,p_grant jsonb,p_context_bytes bytea,p_grant_bytes bytea,p_device_key bytea,p_grant_receipt bytea,p_context_receipt bytea
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $function$
DECLARE v_account text; v_device text; v_context bytea; v_grant bytea;
BEGIN
 v_account:=identity_private.current_transaction_account('devices_account'::identity_private.transaction_capability_purpose);
 v_device:=identity_private.current_execution_context_device();
 IF v_account IS NULL OR v_account IS DISTINCT FROM p_context->>'accountId' OR v_device IS NULL OR v_device IS DISTINCT FROM p_context->>'deviceId'
  OR current_setting('gooddealer.capability_purpose',true) IS DISTINCT FROM 'devices_account'
  OR current_setting('gooddealer.account_id',true) IS DISTINCT FROM v_account
  OR current_setting('gooddealer.workspace_id',true) IS DISTINCT FROM p_context->>'workspaceId'
  OR NOT EXISTS(SELECT 1 FROM public.workspace_account_bindings w WHERE w.account_id=v_account AND w.workspace_id=p_context->>'workspaceId'
    AND w.owner_kind='account' AND w.role='default_owner' AND w.is_default=true)
  OR (p_context - ARRAY['schemaVersion','typ','iss','aud','kid','nonce','accountId','workspaceId','deviceId','accountSecurityEpoch','activeLeaseEpoch','credentialEpoch','signingKeyId','signingKeyVersion','authorizationGrantDigest','serverObservedAt','expiresAt','signature']) <> '{}'::jsonb
  OR clock_timestamp() >= (p_context->>'serverObservedAt')::timestamptz + interval '30 seconds' THEN
  RAISE EXCEPTION 'execution context rejected' USING ERRCODE='42501';
 END IF;
 v_context:=public.device_execution_context_frame('d',convert_to('GOODDEALER-DESKTOP-EXECUTION-CONTEXT-ENVELOPE-V1','UTF8'))
  || public.device_execution_context_frame('v',public.device_execution_context_value(p_context,0));
 v_grant:=public.device_execution_context_frame('d',convert_to('GOODDEALER-DESKTOP-EXECUTION-AUTHORIZATION-V1','UTF8'))
  || public.device_execution_context_frame('v',public.device_execution_context_value(p_grant,0));
 IF v_context IS DISTINCT FROM p_context_bytes OR v_grant IS DISTINCT FROM p_grant_bytes THEN
  RAISE EXCEPTION 'execution context canonical evidence rejected' USING ERRCODE='42501';
 END IF;
 PERFORM public.device_execution_context_append_verified(p_context,p_grant,p_context_bytes,p_grant_bytes,p_device_key,p_grant_receipt,p_context_receipt);
END;
$function$;
`,
};
