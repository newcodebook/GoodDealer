import type { CloudMigration } from "../../../db/index";

/** Authenticated evidence appends reuse the existing immutable stream and its seal lock. */
export const auditExecutionEvidenceMigration: CloudMigration = {
 id:"202611190009-audit-execution-evidence",owner:"audit",sql:`
ALTER TABLE public.workspace_device_audit_drain_records ADD COLUMN event_id text, ADD COLUMN signed_event jsonb;
ALTER TABLE public.workspace_device_audit_drain_records ADD COLUMN classification text CHECK(classification IN ('current','late'));

CREATE UNIQUE INDEX audit_execution_evidence_event_identity ON public.workspace_device_audit_drain_records(account_id,workspace_id,source_device_id,active_lease_epoch,event_id) WHERE event_id IS NOT NULL;
CREATE TABLE public.audit_execution_evidence_quarantines(
 account_id text NOT NULL,workspace_id text NOT NULL,source_device_id text NOT NULL,active_lease_epoch bigint NOT NULL,
 sequence bigint NOT NULL,event_id text NOT NULL,envelope_digest bytea NOT NULL CHECK(octet_length(envelope_digest)=32),
 reason text NOT NULL CHECK(reason IN ('signature','epoch_unknown','time_unprovable','authorization','sequence_replay','drain_seal_violation','removal_boundary','audit_chain')),
 domain_blocking boolean NOT NULL,received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(account_id,workspace_id,source_device_id,active_lease_epoch,sequence,event_id,envelope_digest)
);
ALTER TABLE public.audit_execution_evidence_quarantines OWNER TO gooddealer_cloud_owner;
ALTER TABLE public.audit_execution_evidence_quarantines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_execution_evidence_quarantines FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_execution_evidence_quarantine_owner ON public.audit_execution_evidence_quarantines TO gooddealer_cloud_owner USING(true) WITH CHECK(true);
CREATE TRIGGER audit_execution_evidence_quarantine_immutable BEFORE UPDATE OR DELETE ON public.audit_execution_evidence_quarantines
 FOR EACH ROW EXECUTE FUNCTION public.device_execution_context_immutable();
REVOKE ALL ON public.audit_execution_evidence_quarantines FROM PUBLIC,gooddealer_cloud_app,gd_account_api;
REVOKE SELECT ON public.workspace_device_audit_drain_records FROM gooddealer_cloud_app;
GRANT SELECT ON public.workspace_device_audit_drain_records TO gd_account_api;
CREATE POLICY audit_execution_evidence_account ON public.workspace_device_audit_drain_records AS RESTRICTIVE TO gd_account_api
 USING(current_setting('gooddealer.capability_purpose',true)='devices_account' AND account_id=identity_private.current_transaction_account());
CREATE FUNCTION public.audit_execution_evidence_frame(p_tag text,p_bytes bytea)
 RETURNS bytea LANGUAGE sql IMMUTABLE SET search_path=pg_catalog
 RETURN convert_to(p_tag || octet_length(p_bytes)::text || ':','UTF8') || p_bytes;
CREATE FUNCTION public.audit_execution_evidence_value(p_value jsonb,p_depth integer)
 RETURNS bytea LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $function$
DECLARE v_kind text:=jsonb_typeof(p_value); v_bytes bytea:=''::bytea; v_entry record; v_number numeric; v_string text;
BEGIN
 IF p_depth NOT BETWEEN 0 AND 8 OR p_value IS NULL OR octet_length(p_value::text)>32768 THEN
  RAISE EXCEPTION 'execution evidence canonical value rejected' USING ERRCODE='42501';
 END IF;
 IF v_kind='null' THEN RETURN convert_to('z0:','UTF8');
 ELSIF v_kind='string' THEN
  v_string:=p_value#>>'{}';
  IF octet_length(v_string)>8192 THEN RAISE EXCEPTION 'execution evidence string rejected' USING ERRCODE='42501'; END IF;
  RETURN public.audit_execution_evidence_frame('s',convert_to(v_string,'UTF8'));
 ELSIF v_kind='number' THEN
  v_number:=(p_value#>>'{}')::numeric;
  IF v_number<>trunc(v_number) OR v_number<0 OR v_number>9007199254740991 THEN
   RAISE EXCEPTION 'execution evidence integer rejected' USING ERRCODE='42501';
  END IF;
  RETURN public.audit_execution_evidence_frame('n',convert_to(v_number::bigint::text,'UTF8'));
 ELSIF v_kind='array' THEN
  IF jsonb_array_length(p_value)>32 THEN RAISE EXCEPTION 'execution evidence array rejected' USING ERRCODE='42501'; END IF;
  FOR v_entry IN SELECT value FROM jsonb_array_elements(p_value) WITH ORDINALITY ORDER BY ordinality LOOP
   v_bytes:=v_bytes || public.audit_execution_evidence_frame('e',public.audit_execution_evidence_value(v_entry.value,p_depth+1));
  END LOOP;
  RETURN public.audit_execution_evidence_frame('a',v_bytes);
 ELSIF v_kind='object' THEN
  IF (SELECT count(*) FROM jsonb_object_keys(p_value))>32 THEN RAISE EXCEPTION 'execution evidence object rejected' USING ERRCODE='42501'; END IF;
  FOR v_entry IN SELECT key,value FROM jsonb_each(p_value) ORDER BY key COLLATE "C" LOOP
   IF v_entry.key !~ '^[A-Za-z][A-Za-z0-9]{0,159}$' THEN RAISE EXCEPTION 'execution evidence key rejected' USING ERRCODE='42501'; END IF;
   v_bytes:=v_bytes || public.audit_execution_evidence_frame('e',
     public.audit_execution_evidence_frame('k',convert_to(v_entry.key,'UTF8')) || public.audit_execution_evidence_frame('v',public.audit_execution_evidence_value(v_entry.value,p_depth+1)));
  END LOOP;
  RETURN public.audit_execution_evidence_frame('o',v_bytes);
 END IF;
 RAISE EXCEPTION 'execution evidence type rejected' USING ERRCODE='42501';
END;
$function$;
ALTER FUNCTION public.audit_execution_evidence_frame(text,bytea) OWNER TO gooddealer_cloud_owner;
ALTER FUNCTION public.audit_execution_evidence_value(jsonb,integer) OWNER TO gooddealer_cloud_owner;
REVOKE ALL ON FUNCTION public.audit_execution_evidence_frame(text,bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.audit_execution_evidence_value(jsonb,integer) FROM PUBLIC;

-- Fixed-purpose source projection; selectors never grant authority and imported devices cannot upload.
CREATE FUNCTION public.audit_execution_evidence_source() RETURNS TABLE(account_id text,workspace_id text,device_id text,current_epoch bigint)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $function$
DECLARE a text:=identity_private.current_transaction_account('devices_account'::identity_private.transaction_capability_purpose);
 d text:=identity_private.current_execution_context_device(); w text:=current_setting('gooddealer.workspace_id',true);
BEGIN
 IF a IS NULL OR d IS NULL OR a IS DISTINCT FROM current_setting('gooddealer.account_id',true) THEN RAISE EXCEPTION 'execution evidence authority rejected' USING ERRCODE='42501';END IF;
 RETURN QUERY SELECT a,w,d,l.lease_epoch FROM public.workspace_account_bindings b
 JOIN public.device_active_leases l ON l.account_id=b.account_id AND l.device_id=d
 JOIN public.device_account_states s ON s.account_id=l.account_id AND s.current_lease_epoch=l.lease_epoch
 JOIN public.device_bindings db ON db.account_id=l.account_id AND db.device_id=l.device_id
 JOIN public.identity_account_security_states sec ON sec.account_id=l.account_id
 WHERE b.account_id=a AND b.workspace_id=w AND b.owner_kind='account' AND b.role='default_owner' AND b.is_default
 AND db.status='bound' AND sec.status='normal' AND l.released_at IS NULL AND l.wire_envelope IS NOT NULL
 AND clock_timestamp()>=l.issued_at AND clock_timestamp()<l.online_expires_at FOR SHARE OF b,l,s,db,sec;
 IF NOT FOUND THEN RAISE EXCEPTION 'execution evidence source is not Active' USING ERRCODE='42501';END IF;
END;
$function$;
ALTER FUNCTION public.audit_execution_evidence_source() OWNER TO gooddealer_cloud_owner;
REVOKE ALL ON FUNCTION public.audit_execution_evidence_source() FROM PUBLIC;

CREATE FUNCTION public.audit_execution_evidence_receipt(p_epoch bigint,p_sequence bigint,p_event text,p_digest bytea) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $function$
DECLARE s record;r record;base jsonb;
BEGIN
 SELECT * INTO STRICT s FROM public.audit_execution_evidence_source();
 base:=jsonb_build_object('schemaVersion',1,'stream','device_audit','workspaceId',s.workspace_id,'sourceDeviceId',s.device_id,
 'activeLeaseEpoch',p_epoch,'sequence',p_sequence,'eventId',p_event,'envelopeDigest',rtrim(translate(encode(p_digest,'base64'),'+/','-_'),'='));
 SELECT * INTO r FROM public.workspace_device_audit_drain_records x WHERE x.account_id=s.account_id AND x.workspace_id=s.workspace_id AND x.source_device_id=s.device_id
 AND x.active_lease_epoch=p_epoch AND x.audit_sequence=p_sequence AND x.event_id=p_event AND x.envelope_digest=p_digest AND x.signed_event IS NOT NULL AND x.quarantine_reason IS NULL;
 IF FOUND THEN RETURN base||jsonb_build_object('outcome','accepted','classification',r.classification,'receivedAt',to_char(r.received_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'));END IF;
 SELECT * INTO r FROM public.audit_execution_evidence_quarantines x WHERE x.account_id=s.account_id AND x.workspace_id=s.workspace_id AND x.source_device_id=s.device_id
 AND x.active_lease_epoch=p_epoch AND x.sequence=p_sequence AND x.event_id=p_event AND x.envelope_digest=p_digest;
 IF FOUND THEN RETURN base||jsonb_build_object('outcome','quarantined','reason',r.reason,'receivedAt',to_char(r.received_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'));END IF;
 RETURN NULL;
END;
$function$;
ALTER FUNCTION public.audit_execution_evidence_receipt(bigint,bigint,text,bytea) OWNER TO gooddealer_cloud_owner;
REVOKE ALL ON FUNCTION public.audit_execution_evidence_receipt(bigint,bigint,text,bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.audit_execution_evidence_receipt(bigint,bigint,text,bytea) TO gd_account_api;

CREATE FUNCTION public.audit_execution_evidence_append(p_event jsonb,p_bytes bytea,p_reason text,p_signature_verified boolean,p_pending text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $function$
DECLARE s record;r record;h record;receipt jsonb;sealed boolean;why text:=p_reason;
 epoch bigint:=(p_event->>'activeLeaseEpoch')::bigint; sequence bigint:=(p_event->>'auditSequence')::bigint;
 event_id text:=p_event->>'auditEventId';digest bytea:=sha256(p_bytes);canonical bytea;
BEGIN
 SELECT * INTO STRICT s FROM public.audit_execution_evidence_source();
 canonical:=public.audit_execution_evidence_frame('d',convert_to('GOODDEALER-DEVICE-AUDIT-EVENT-V1','UTF8'))||public.audit_execution_evidence_frame('v',public.audit_execution_evidence_value(p_event-'deviceSignature',0))
 ||int4send(octet_length(convert_to(p_event->>'deviceSignature','UTF8')))||convert_to(p_event->>'deviceSignature','UTF8');
 IF p_event->>'schemaVersion' IS DISTINCT FROM '1' OR p_event->>'workspaceId' IS DISTINCT FROM s.workspace_id OR p_event->>'sourceDeviceId' IS DISTINCT FROM s.device_id
 OR epoch IS NULL OR epoch NOT BETWEEN 1 AND 9007199254740991 OR sequence IS NULL OR sequence NOT BETWEEN 1 AND 9007199254740991
 OR event_id IS NULL OR event_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
 OR p_bytes IS NULL OR octet_length(p_bytes) NOT BETWEEN 1 AND 32768 OR canonical IS DISTINCT FROM p_bytes
 OR p_signature_verified IS NULL OR (p_reason IS NULL AND NOT p_signature_verified)
 OR (p_pending IS NOT NULL AND p_pending NOT IN ('PREDECESSOR_MISSING','PAIRED_AUDIT_MISSING','APPROVAL_AUDIT_MISSING','ORIGINAL_FACT_MISSING')) THEN
 RAISE EXCEPTION 'execution evidence envelope rejected' USING ERRCODE='42501';END IF;
 SELECT * INTO h FROM public.audit_recompute_workspace_device_drain_head(s.device_id,epoch);
 receipt:=public.audit_execution_evidence_receipt(epoch,sequence,event_id,digest);
 IF receipt->>'outcome'='accepted' THEN RETURN jsonb_build_object('schemaVersion',1,'outcome','accepted','receipt',receipt);END IF;
 SELECT EXISTS(SELECT 1 FROM public.workspace_device_audit_drain_seals x WHERE x.account_id=s.account_id AND x.workspace_id=s.workspace_id AND x.source_device_id=s.device_id AND x.active_lease_epoch=epoch) INTO sealed;
 IF receipt IS NOT NULL THEN RETURN jsonb_build_object('schemaVersion',1,'outcome','quarantined','receipt',receipt);END IF;
 IF EXISTS(SELECT 1 FROM public.workspace_device_audit_drain_records x WHERE x.account_id=s.account_id AND x.workspace_id=s.workspace_id AND x.source_device_id=s.device_id AND x.active_lease_epoch=epoch AND (x.audit_sequence=sequence OR x.event_id=event_id)) THEN why:='sequence_replay';
 ELSIF sealed THEN why:='drain_seal_violation';END IF;
 IF why IS NULL AND sequence>h.contiguous_received_through+1 THEN RETURN jsonb_build_object('schemaVersion',1,'outcome','pending','code','PREDECESSOR_MISSING');END IF;
 IF why IS NULL AND p_pending IS NOT NULL THEN RETURN jsonb_build_object('schemaVersion',1,'outcome','pending','code',p_pending);END IF;

 IF why IS NULL AND (p_event->>'accountId' IS DISTINCT FROM s.account_id OR p_event->>'scopeKind' IS DISTINCT FROM 'workspace') THEN why:='authorization';END IF;
 IF why IS NULL THEN
   IF sequence=1 THEN
    IF p_event->>'previousHash'<>'qNhif0AJWgKL2IWy5ylAUyTNimMebPbmmrUrz0U-NA8' THEN why:='audit_chain';END IF;
   ELSE
    SELECT signed_event INTO r FROM public.workspace_device_audit_drain_records x WHERE x.account_id=s.account_id AND x.workspace_id=s.workspace_id AND x.source_device_id=s.device_id AND x.active_lease_epoch=epoch AND x.audit_sequence=sequence-1;
    IF r.signed_event IS NULL OR p_event->>'previousHash' IS DISTINCT FROM r.signed_event->>'eventHash' OR p_event->>'chainId' IS DISTINCT FROM r.signed_event->>'chainId' THEN why:='audit_chain';END IF;
   END IF;
   IF p_event->'payloadRedacted'->>'stage'='approved' AND EXISTS(SELECT 1 FROM public.workspace_device_audit_drain_records x WHERE x.account_id=s.account_id AND x.workspace_id=s.workspace_id AND x.source_device_id=s.device_id AND x.active_lease_epoch=epoch AND x.signed_event->'payloadRedacted'->>'stage'='approved' AND x.signed_event->'payloadRedacted'->>'approvedOperationId'=p_event->'payloadRedacted'->>'approvedOperationId') THEN why:='authorization';END IF;
 END IF;

 IF why IS NOT NULL THEN
 INSERT INTO public.audit_execution_evidence_quarantines(account_id,workspace_id,source_device_id,active_lease_epoch,sequence,event_id,envelope_digest,reason,domain_blocking)
 VALUES(s.account_id,s.workspace_id,s.device_id,epoch,sequence,event_id,digest,why,p_signature_verified AND NOT sealed) ON CONFLICT DO NOTHING;
 ELSE
 INSERT INTO public.workspace_device_audit_drain_records(account_id,workspace_id,source_device_id,active_lease_epoch,audit_sequence,canonical_envelope,envelope_digest,classification,event_id,signed_event,received_at,chain_id,event_hash)
 VALUES(s.account_id,s.workspace_id,s.device_id,epoch,sequence,p_bytes,digest,CASE WHEN epoch=s.current_epoch THEN 'current' ELSE 'late' END,event_id,p_event,clock_timestamp(),p_event->>'chainId',decode(translate(p_event->>'eventHash','-_','+/')||'=','base64'));
 PERFORM * FROM public.audit_recompute_workspace_device_drain_head(s.device_id,epoch);
 END IF;
 receipt:=public.audit_execution_evidence_receipt(epoch,sequence,event_id,digest);
 RETURN jsonb_build_object('schemaVersion',1,'outcome',receipt->>'outcome','receipt',receipt);
END;
$function$;
ALTER FUNCTION public.audit_execution_evidence_append(jsonb,bytea,text,boolean,text) OWNER TO gooddealer_cloud_owner;
REVOKE ALL ON FUNCTION public.audit_execution_evidence_append(jsonb,bytea,text,boolean,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.audit_execution_evidence_append(jsonb,bytea,text,boolean,text) TO gd_account_api;

ALTER FUNCTION public.audit_install_workspace_device_drain_seal(text) RENAME TO audit_install_workspace_device_drain_seal_before_evidence;
REVOKE ALL ON FUNCTION public.audit_install_workspace_device_drain_seal_before_evidence(text) FROM PUBLIC,gooddealer_cloud_app,gd_account_api;
CREATE FUNCTION public.audit_install_workspace_device_drain_seal(p_proof_id text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $function$
DECLARE proof record;
BEGIN
 SELECT * INTO proof FROM public.device_read_just_consumed_drain_proof(p_proof_id);
 IF NOT FOUND THEN RETURN false;END IF;
 PERFORM * FROM public.audit_recompute_workspace_device_drain_head(proof.source_device_id,proof.active_lease_epoch);
 -- An accepted seal is immutable. New rejections cannot roll it back; prior verified violations block a first seal.
 IF NOT EXISTS(SELECT 1 FROM public.workspace_device_audit_drain_seals x WHERE x.account_id=current_setting('gooddealer.account_id',true) AND x.workspace_id=current_setting('gooddealer.workspace_id',true) AND x.source_device_id=proof.source_device_id AND x.active_lease_epoch=proof.active_lease_epoch)
 AND EXISTS(SELECT 1 FROM public.audit_execution_evidence_quarantines x WHERE x.account_id=current_setting('gooddealer.account_id',true) AND x.workspace_id=current_setting('gooddealer.workspace_id',true) AND x.source_device_id=proof.source_device_id AND x.active_lease_epoch=proof.active_lease_epoch AND x.domain_blocking) THEN RETURN false;END IF;
 RETURN public.audit_install_workspace_device_drain_seal_before_evidence(p_proof_id);
END;
$function$;
ALTER FUNCTION public.audit_install_workspace_device_drain_seal(text) OWNER TO gooddealer_cloud_owner;
REVOKE ALL ON FUNCTION public.audit_install_workspace_device_drain_seal(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.audit_install_workspace_device_drain_seal(text) TO gooddealer_cloud_app,gd_account_api;
`};
