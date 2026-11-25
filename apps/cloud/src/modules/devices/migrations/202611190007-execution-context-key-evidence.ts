import type { CloudMigration } from "../../../db/index";

/** Issuance retains the keys actually verified; configuration rotation cannot erase old authority. */
export const executionContextKeyEvidenceMigration: CloudMigration = {
  id: "202611190007-execution-context-key-evidence", owner: "devices", sql: `
CREATE TABLE public.device_execution_context_key_evidence (
 account_id text NOT NULL,workspace_id text NOT NULL,context_digest bytea NOT NULL,
 lease_key_id text NOT NULL,lease_public_key bytea NOT NULL,
 grant_key_id text NOT NULL,grant_public_key bytea NOT NULL,
 context_key_id text NOT NULL,context_public_key bytea NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(account_id,workspace_id,context_digest),
 FOREIGN KEY(account_id,workspace_id,context_digest) REFERENCES public.device_execution_contexts(account_id,workspace_id,context_digest),
 CHECK(octet_length(lease_public_key)=44 AND substring(lease_public_key FROM 1 FOR 12)=decode('302a300506032b6570032100','hex')),
 CHECK(octet_length(grant_public_key)=44 AND substring(grant_public_key FROM 1 FOR 12)=decode('302a300506032b6570032100','hex')),
 CHECK(octet_length(context_public_key)=44 AND substring(context_public_key FROM 1 FOR 12)=decode('302a300506032b6570032100','hex')),
 CHECK(lease_public_key<>grant_public_key AND lease_public_key<>context_public_key AND grant_public_key<>context_public_key),
 CHECK(lease_key_id<>grant_key_id AND lease_key_id<>context_key_id AND grant_key_id<>context_key_id)
);
ALTER TABLE public.device_execution_context_key_evidence OWNER TO gooddealer_cloud_owner;
ALTER TABLE public.device_execution_context_key_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_execution_context_key_evidence FORCE ROW LEVEL SECURITY;
CREATE POLICY execution_context_key_owner ON public.device_execution_context_key_evidence TO gooddealer_cloud_owner USING(true) WITH CHECK(true);
CREATE POLICY execution_context_key_account ON public.device_execution_context_key_evidence TO gd_account_api
 USING(account_id=identity_private.current_transaction_account('devices_account'::identity_private.transaction_capability_purpose)
 AND workspace_id=current_setting('gooddealer.workspace_id',true));
REVOKE ALL ON public.device_execution_context_key_evidence FROM PUBLIC,gooddealer_cloud_app,gd_account_api;
GRANT SELECT ON public.device_execution_context_key_evidence TO gd_account_api;
CREATE TRIGGER execution_context_key_immutable BEFORE UPDATE OR DELETE ON public.device_execution_context_key_evidence
 FOR EACH ROW EXECUTE FUNCTION public.device_execution_context_immutable();
CREATE FUNCTION public.device_execution_context_append_with_key_evidence(
 p_context jsonb,p_grant jsonb,p_context_bytes bytea,p_grant_bytes bytea,p_device_key bytea,p_grant_receipt bytea,p_context_receipt bytea,
 p_lease_key bytea,p_grant_key bytea,p_context_key bytea
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $function$
BEGIN
 -- The existing owner admission binds consumed capability, device, exact JSON/bytes and live authority.
 -- Only the server composition supplies the three keys after independently verifying those signatures.
 PERFORM public.device_execution_context_append(p_context,p_grant,p_context_bytes,p_grant_bytes,p_device_key,p_grant_receipt,p_context_receipt);
 INSERT INTO public.device_execution_context_key_evidence(account_id,workspace_id,context_digest,
 lease_key_id,lease_public_key,grant_key_id,grant_public_key,context_key_id,context_public_key)
 VALUES(p_context->>'accountId',p_context->>'workspaceId',sha256(p_context_bytes),
 p_grant->'activeDeviceLease'->>'kid',p_lease_key,p_grant->>'kid',p_grant_key,p_context->>'kid',p_context_key);
END;
$function$;
ALTER FUNCTION public.device_execution_context_append_with_key_evidence(jsonb,jsonb,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea) OWNER TO gooddealer_cloud_owner;
REVOKE ALL ON FUNCTION public.device_execution_context_append_with_key_evidence(jsonb,jsonb,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.device_execution_context_append_with_key_evidence(jsonb,jsonb,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea) TO gd_account_api;
REVOKE EXECUTE ON FUNCTION public.device_execution_context_append(jsonb,jsonb,bytea,bytea,bytea,bytea,bytea) FROM gd_account_api,gooddealer_cloud_app;
`,
};
