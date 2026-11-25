import type { CloudMigration } from "../../../db/index";

/** SQL binds the verified closed safe JSON to canonical bytes before any durable verdict. */
export const auditEvidenceClosedShapeMigration: CloudMigration = {id:"202611190013-audit-evidence-closed-shape",owner:"audit",sql:`
CREATE OR REPLACE FUNCTION public.audit_execution_evidence_append(p_event jsonb,p_bytes bytea,p_reason text,p_signature_verified boolean,p_pending text) RETURNS jsonb
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
 IF (p_event-ARRAY['schemaVersion','auditEventId','auditEventKind','eventType','accountId','actorKind','authorizationSource','targetType','targetRef','sourceDeviceId','credentialEpoch','chainId','auditSequence','previousHash','eventHash','occurredAt','signingKeyId','signingKeyVersion','signingKeyPurpose','trustedTimeAnchorId','monotonicDeltaMs','authorizationContextHash','signatureTranscriptVersion','payloadRedacted','deviceSignature','scopeKind','workspaceId','activeLeaseEpoch'])<>'{}'::jsonb OR p_event->>'signatureTranscriptVersion' IS DISTINCT FROM '1'
 OR p_event->>'deviceSignature' IS NULL OR p_event->>'deviceSignature' !~ '^[A-Za-z0-9_-]{85}[AQgw]$'
 OR jsonb_typeof(p_event->'payloadRedacted') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'execution evidence shape rejected' USING ERRCODE='42501';END IF;
 IF p_event->'payloadRedacted'->>'stage'='approved' THEN
  IF (p_event->'payloadRedacted'-ARRAY['schemaVersion','provider','action','stage','approvedOperationId','operationId','planId','planHash','targetCount','targetSetDigest'])<>'{}'::jsonb THEN RAISE EXCEPTION 'execution payload shape rejected' USING ERRCODE='42501';END IF;
 ELSIF p_event->'payloadRedacted'->>'stage'='dispatch_claimed' THEN
  IF (p_event->'payloadRedacted'-ARRAY['schemaVersion','provider','action','stage','approvedOperationId','operationId','operationItemId','attemptId','attemptNo','planHash','requestDigest','approvalEnvelopeDigest'])<>'{}'::jsonb THEN RAISE EXCEPTION 'execution payload shape rejected' USING ERRCODE='42501';END IF;
 ELSIF p_event->'payloadRedacted'->>'stage'='preflight_refused' THEN
  IF (p_event->'payloadRedacted'-ARRAY['schemaVersion','provider','action','stage','approvedOperationId','operationId','operationItemId','attemptId','planHash','requestDigest','approvalEnvelopeDigest','reason'])<>'{}'::jsonb THEN RAISE EXCEPTION 'execution payload shape rejected' USING ERRCODE='42501';END IF;
 ELSIF p_event->'payloadRedacted'->>'stage'='reconciled' THEN
  IF (p_event->'payloadRedacted'-ARRAY['schemaVersion','provider','action','stage','operationId','operationItemId','attemptId','originalExecutionFactId','originalExecutionFactDigest','outcome','reason'])<>'{}'::jsonb THEN RAISE EXCEPTION 'execution payload shape rejected' USING ERRCODE='42501';END IF;
 ELSE RAISE EXCEPTION 'execution payload stage rejected' USING ERRCODE='42501';END IF;
 IF p_event->'payloadRedacted'->>'provider' IS DISTINCT FROM 'afternic' OR p_event->'payloadRedacted'->>'action' IS DISTINCT FROM 'remove' OR p_event->'payloadRedacted'->>'schemaVersion' IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'execution payload purpose rejected' USING ERRCODE='42501';END IF;
 SELECT * INTO h FROM public.audit_recompute_workspace_device_drain_head(s.device_id,epoch);
 receipt:=public.audit_execution_evidence_receipt(epoch,sequence,event_id,digest);
 IF receipt->>'outcome'='accepted' THEN RETURN jsonb_build_object('schemaVersion',1,'outcome','accepted','receipt',receipt);END IF;
 SELECT EXISTS(SELECT 1 FROM public.workspace_device_audit_drain_seals x WHERE x.account_id=s.account_id AND x.workspace_id=s.workspace_id AND x.source_device_id=s.device_id AND x.active_lease_epoch=epoch) INTO sealed;
 IF receipt IS NOT NULL THEN RETURN jsonb_build_object('schemaVersion',1,'outcome','quarantined','receipt',receipt);END IF;
 IF EXISTS(SELECT 1 FROM public.workspace_device_audit_drain_records x WHERE x.account_id=s.account_id AND x.workspace_id=s.workspace_id AND x.source_device_id=s.device_id AND x.active_lease_epoch=epoch AND (x.audit_sequence=sequence OR x.event_id=(p_event->>'auditEventId'))) THEN why:='sequence_replay';
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
`};
