import type { CloudMigration } from "../../../db/index";

/** Historical signed evidence survives Lease renewal; it never grants execution by itself. */
export const executionContextMigration: CloudMigration = {
  id: "202611190001-execution-context", owner: "devices",
  sql: `
CREATE TABLE public.device_execution_contexts (
 account_id text NOT NULL CHECK(account_id ~ '^[!-~]{1,160}$'),
 workspace_id text NOT NULL CHECK(workspace_id ~ '^[!-~]{1,160}$'),
 source_device_id text NOT NULL CHECK(source_device_id ~ '^[!-~]{1,160}$'),
 context_digest bytea NOT NULL CHECK(octet_length(context_digest)=32),
 nonce bytea NOT NULL CHECK(octet_length(nonce)=32),
 active_lease_epoch bigint NOT NULL CHECK(active_lease_epoch BETWEEN 1 AND 9007199254740991),
 account_security_epoch bigint NOT NULL CHECK(account_security_epoch BETWEEN 1 AND 9007199254740991),
 device_credential_epoch bigint NOT NULL CHECK(device_credential_epoch BETWEEN 1 AND 9007199254740991),
 signing_key_id text NOT NULL CHECK(signing_key_id ~ '^[!-~]{1,160}$'),
 signing_key_version bigint NOT NULL CHECK(signing_key_version BETWEEN 1 AND 9007199254740991),
 device_public_key bytea NOT NULL CHECK(octet_length(device_public_key)=32),
 authorization_grant_digest bytea NOT NULL CHECK(octet_length(authorization_grant_digest)=32),
 signed_grant jsonb NOT NULL CHECK(jsonb_typeof(signed_grant)='object' AND octet_length(signed_grant::text)<=32768),
 signed_context jsonb NOT NULL CHECK(jsonb_typeof(signed_context)='object' AND octet_length(signed_context::text)<=8192),
 canonical_context_envelope bytea NOT NULL CHECK(octet_length(canonical_context_envelope) BETWEEN 1 AND 16384),
 canonical_grant_envelope bytea NOT NULL CHECK(octet_length(canonical_grant_envelope) BETWEEN 1 AND 32768),
 server_observed_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL,
 persisted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 grant_signer_receipt_digest bytea NOT NULL CHECK(octet_length(grant_signer_receipt_digest)=32),
 context_signer_receipt_digest bytea NOT NULL CHECK(octet_length(context_signer_receipt_digest)=32),
 PRIMARY KEY(account_id,workspace_id,context_digest),
 UNIQUE(account_id,source_device_id,nonce),
 CHECK(server_observed_at < expires_at AND expires_at <= server_observed_at + interval '24 hours'),
 CHECK(context_digest=sha256(canonical_context_envelope)),
 CHECK(authorization_grant_digest=sha256(canonical_grant_envelope)),
 FOREIGN KEY(account_id,source_device_id,signing_key_version) REFERENCES public.device_signing_keys(account_id,device_id,key_version) ON DELETE RESTRICT
);
ALTER TABLE public.device_execution_contexts OWNER TO gooddealer_cloud_owner;
ALTER TABLE public.device_execution_contexts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_execution_contexts FORCE ROW LEVEL SECURITY;
CREATE POLICY device_execution_contexts_tenant_scope ON public.device_execution_contexts
 USING(account_id=current_setting('gooddealer.account_id',true) AND workspace_id=current_setting('gooddealer.workspace_id',true))
 WITH CHECK(account_id=current_setting('gooddealer.account_id',true) AND workspace_id=current_setting('gooddealer.workspace_id',true));
CREATE POLICY device_execution_contexts_owner_maintenance ON public.device_execution_contexts
 USING(CURRENT_USER='gooddealer_cloud_owner') WITH CHECK(CURRENT_USER='gooddealer_cloud_owner');
REVOKE ALL ON public.device_execution_contexts FROM PUBLIC,gooddealer_cloud_app;
GRANT SELECT ON public.device_execution_contexts TO gooddealer_cloud_app;
CREATE FUNCTION public.device_execution_context_immutable() RETURNS trigger LANGUAGE plpgsql
 SET search_path=pg_catalog,public AS $function$
 BEGIN RAISE EXCEPTION 'execution context evidence is immutable' USING ERRCODE='55000'; END;
$function$;
ALTER FUNCTION public.device_execution_context_immutable() OWNER TO gooddealer_cloud_owner;
REVOKE ALL ON FUNCTION public.device_execution_context_immutable() FROM PUBLIC;
CREATE TRIGGER device_execution_context_immutable BEFORE UPDATE OR DELETE ON public.device_execution_contexts
 FOR EACH ROW EXECUTE FUNCTION public.device_execution_context_immutable();

CREATE FUNCTION public.device_execution_context_append(
 p_context jsonb,p_grant jsonb,p_context_bytes bytea,p_grant_bytes bytea,p_device_key bytea,p_grant_receipt bytea,p_context_receipt bytea
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $function$
DECLARE
 v_account text := current_setting('gooddealer.account_id',true);
 v_workspace text := current_setting('gooddealer.workspace_id',true);
 v_device text := p_context->>'deviceId';
 v_observed timestamptz := (p_context->>'serverObservedAt')::timestamptz;
 v_expires timestamptz := (p_context->>'expiresAt')::timestamptz;
 v_nonce bytea;
BEGIN
 IF CURRENT_USER <> 'gooddealer_cloud_owner' OR v_account IS NULL OR v_workspace IS NULL
   OR v_account IS DISTINCT FROM p_context->>'accountId' OR v_workspace IS DISTINCT FROM p_context->>'workspaceId'
   OR jsonb_typeof(p_context) IS DISTINCT FROM 'object' OR jsonb_typeof(p_grant) IS DISTINCT FROM 'object'
   OR p_context->>'schemaVersion' IS DISTINCT FROM '1' OR p_context->>'typ' IS DISTINCT FROM 'gd.desktop-execution-context.v1'
   OR p_context->>'iss' IS DISTINCT FROM 'https://accounts.gooddealer.com' OR p_context->>'aud' IS DISTINCT FROM 'gooddealer-desktop/execution-evidence'
   OR p_context->>'nonce' !~ '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$'
   OR p_context->>'signature' !~ '^[A-Za-z0-9_-]{85}[AQgw]$'
   OR p_grant->>'schemaVersion' IS DISTINCT FROM '4'
   OR p_grant->'workspace'->>'workspaceId' IS DISTINCT FROM v_workspace
   OR p_grant->'activeDeviceLease'->>'accountId' IS DISTINCT FROM v_account
   OR p_grant->'activeDeviceLease'->>'deviceId' IS DISTINCT FROM v_device
   OR p_grant->'activeDeviceLease'->>'accountSecurityEpoch' IS DISTINCT FROM p_context->>'accountSecurityEpoch'
   OR p_grant->'activeDeviceLease'->'payload'->>'leaseEpoch' IS DISTINCT FROM p_context->>'activeLeaseEpoch'
   OR (p_grant->>'issuedAt')::timestamptz > v_observed
   OR v_expires IS DISTINCT FROM LEAST((p_grant->>'expiresAt')::timestamptz,
     (p_grant->'activeDeviceLease'->'payload'->>'offlineExecuteUntil')::timestamptz,
     (p_grant->'commercialAuthority'->>'commercialExpiresAt')::timestamptz)
   OR p_context->>'authorizationGrantDigest' IS DISTINCT FROM rtrim(translate(encode(sha256(p_grant_bytes),'base64'),'+/','-_'),'=')
   OR v_observed IS NULL OR v_expires IS NULL OR clock_timestamp() < v_observed
   OR clock_timestamp() >= v_observed + interval '31 seconds' OR clock_timestamp() >= v_expires THEN
   RAISE EXCEPTION 'execution context rejected' USING ERRCODE='42501';
 END IF;
 -- The application performs purpose-specific cryptographic verification. The owner routine
 -- independently binds the append to the current device, key, security and exact Lease rows.
 PERFORM 1 FROM public.identity_account_security_states s
 JOIN public.device_bindings b ON b.account_id=s.account_id
 JOIN public.device_signing_keys k ON k.account_id=b.account_id AND k.device_id=b.device_id
 JOIN public.device_account_states a ON a.account_id=b.account_id
 JOIN public.device_active_leases l ON l.account_id=b.account_id AND l.device_id=b.device_id
 WHERE s.account_id=v_account AND s.status='normal' AND s.account_security_epoch=(p_context->>'accountSecurityEpoch')::bigint
 AND b.device_id=v_device AND b.status='bound' AND b.credential_epoch=(p_context->>'credentialEpoch')::bigint
 AND k.status='active' AND k.key_id=p_context->>'signingKeyId' AND k.key_version=(p_context->>'signingKeyVersion')::bigint AND k.public_key=p_device_key
 AND l.lease_epoch=(p_context->>'activeLeaseEpoch')::bigint AND a.current_lease_epoch=l.lease_epoch
 AND l.released_at IS NULL AND clock_timestamp() >= l.issued_at AND clock_timestamp() < l.online_expires_at
 AND l.wire_envelope=p_grant->'activeDeviceLease' FOR SHARE OF s,b,k,a,l;
 IF NOT FOUND THEN RAISE EXCEPTION 'execution context rejected' USING ERRCODE='42501'; END IF;
 v_nonce := decode(translate(p_context->>'nonce','-_','+/') || '=', 'base64');
 INSERT INTO public.device_execution_contexts(account_id,workspace_id,source_device_id,context_digest,nonce,
 active_lease_epoch,account_security_epoch,device_credential_epoch,signing_key_id,signing_key_version,device_public_key,
 authorization_grant_digest,signed_grant,signed_context,canonical_context_envelope,canonical_grant_envelope,
 server_observed_at,expires_at,grant_signer_receipt_digest,context_signer_receipt_digest)
 VALUES(v_account,v_workspace,v_device,sha256(p_context_bytes),v_nonce,
 (p_context->>'activeLeaseEpoch')::bigint,(p_context->>'accountSecurityEpoch')::bigint,(p_context->>'credentialEpoch')::bigint,
 p_context->>'signingKeyId',(p_context->>'signingKeyVersion')::bigint,p_device_key,sha256(p_grant_bytes),p_grant,p_context,
 p_context_bytes,p_grant_bytes,v_observed,v_expires,p_grant_receipt,p_context_receipt);
END;
$function$;
ALTER FUNCTION public.device_execution_context_append(jsonb,jsonb,bytea,bytea,bytea,bytea,bytea) OWNER TO gooddealer_cloud_owner;
REVOKE ALL ON FUNCTION public.device_execution_context_append(jsonb,jsonb,bytea,bytea,bytea,bytea,bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.device_execution_context_append(jsonb,jsonb,bytea,bytea,bytea,bytea,bytea) TO gooddealer_cloud_app;
`,
};
