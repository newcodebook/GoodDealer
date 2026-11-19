import type { CloudMigration } from "../../../db/index";

/** Exact receipts remain idempotent; rejected first seals roll back their derived placeholders. */
export const factEvidenceReplayAndSealMigration: CloudMigration = {id:"202611190017-fact-evidence-replay-and-seal",owner:"execution-ledger",sql:`
CREATE UNIQUE INDEX execution_fact_evidence_attempt_once ON public.execution_fact_drain_records(account_id,workspace_id,source_device_id,(signed_event->>'attemptId')) WHERE signed_event IS NOT NULL;
CREATE UNIQUE INDEX execution_fact_evidence_audit_once ON public.execution_fact_drain_records(account_id,workspace_id,source_device_id,(signed_event->>'auditEventRef')) WHERE signed_event IS NOT NULL;
CREATE UNIQUE INDEX execution_fact_evidence_event_once ON public.execution_fact_drain_records(account_id,workspace_id,source_device_id,event_id) WHERE event_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.execution_fact_evidence_append(p_event jsonb,p_bytes bytea,p_reason text,p_signature_verified boolean,p_pending text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $function$
DECLARE s record;r record;h record;receipt jsonb;sealed boolean;why text:=p_reason; violated_constraint text;
 epoch bigint:=(p_event->>'activeLeaseEpoch')::bigint; sequence bigint:=(p_event->>'executionFactSequence')::bigint;
 event_id text:=p_event->>'executionFactId';digest bytea:=sha256(p_bytes);canonical bytea;
BEGIN
 SELECT * INTO STRICT s FROM public.execution_fact_evidence_source();
 canonical:=public.execution_fact_evidence_frame('d',convert_to('GOODDEALER-EXECUTION-FACT-V1','UTF8'))||public.execution_fact_evidence_frame('v',public.execution_fact_evidence_value(p_event-'deviceSignature',0))
 ||int4send(octet_length(convert_to(p_event->>'deviceSignature','UTF8')))||convert_to(p_event->>'deviceSignature','UTF8');
 IF p_event->>'schemaVersion' IS DISTINCT FROM '1' OR p_event->>'workspaceId' IS DISTINCT FROM s.workspace_id OR p_event->>'sourceDeviceId' IS DISTINCT FROM s.device_id
 OR epoch IS NULL OR epoch NOT BETWEEN 1 AND 9007199254740991 OR sequence IS NULL OR sequence NOT BETWEEN 1 AND 9007199254740991
 OR event_id IS NULL OR event_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
 OR p_bytes IS NULL OR octet_length(p_bytes) NOT BETWEEN 1 AND 32768 OR canonical IS DISTINCT FROM p_bytes
 OR p_signature_verified IS NULL OR (p_reason IS NULL AND NOT p_signature_verified)
 OR (p_pending IS NOT NULL AND p_pending NOT IN ('PREDECESSOR_MISSING','PAIRED_AUDIT_MISSING','APPROVAL_AUDIT_MISSING','ORIGINAL_FACT_MISSING')) THEN
 RAISE EXCEPTION 'execution evidence envelope rejected' USING ERRCODE='42501';END IF;
 IF (p_event-ARRAY['schemaVersion','executionFactId','operationId','operationItemId','workflowNodeId','attemptId','attemptNo','approvedOperationId','planHash','idempotencyKeyHash','sourceDeviceId','workspaceId','activeLeaseEpoch','executionFactSequence','eventType','evidenceLevel','occurredAt','signingKeyId','signingKeyVersion','credentialEpoch','trustedTimeAnchorId','monotonicDeltaMs','requestStartBoundary','authorizationHash','executionAuthorizationEvidence','signatureTranscriptVersion','payloadRedacted','auditEventRef','auditEventHash','deviceSignature'])<>'{}'::jsonb OR p_event->>'signatureTranscriptVersion' IS DISTINCT FROM '1'
 OR p_event->>'deviceSignature' IS NULL OR p_event->>'deviceSignature' !~ '^[A-Za-z0-9_-]{85}[AQgw]$'
 OR jsonb_typeof(p_event->'payloadRedacted') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'execution evidence shape rejected' USING ERRCODE='42501';END IF;
 IF p_event->'payloadRedacted'->>'stage'='dispatch_claimed' THEN
  IF ((p_event->'payloadRedacted')-ARRAY['schemaVersion','provider','action','stage','dispatchSemantics','deduplicationScope','requestDigest','approvalEnvelopeDigest'])<>'{}'::jsonb THEN RAISE EXCEPTION 'execution payload shape rejected' USING ERRCODE='42501';END IF;
 ELSE RAISE EXCEPTION 'execution payload stage rejected' USING ERRCODE='42501';END IF;
 IF p_event->'payloadRedacted'->>'provider' IS DISTINCT FROM 'afternic' OR p_event->'payloadRedacted'->>'action' IS DISTINCT FROM 'remove' OR p_event->'payloadRedacted'->>'schemaVersion' IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'execution payload purpose rejected' USING ERRCODE='42501';END IF;
 IF jsonb_typeof(p_event->'executionAuthorizationEvidence') IS DISTINCT FROM 'object' OR ((p_event->'executionAuthorizationEvidence')-ARRAY['approvedOperationDigest','approvedOperationEnvelope','signingKeyId','signingKeyVersion','credentialEpoch','signatureTranscriptVersion'])<>'{}'::jsonb THEN RAISE EXCEPTION 'execution approval shape rejected' USING ERRCODE='42501';END IF;
 SELECT * INTO h FROM public.execution_fact_drain_recompute_head(s.device_id,epoch);
 receipt:=public.execution_fact_evidence_receipt(epoch,sequence,event_id,digest);
 IF receipt->>'outcome'='accepted' THEN RETURN jsonb_build_object('schemaVersion',1,'outcome','accepted','receipt',receipt);END IF;
 SELECT EXISTS(SELECT 1 FROM public.execution_fact_drain_seals x WHERE x.account_id=s.account_id AND x.workspace_id=s.workspace_id AND x.source_device_id=s.device_id AND x.active_lease_epoch=epoch) INTO sealed;
 IF receipt IS NOT NULL THEN RETURN jsonb_build_object('schemaVersion',1,'outcome','quarantined','receipt',receipt);END IF;
 IF EXISTS(SELECT 1 FROM public.execution_fact_drain_records x WHERE x.account_id=s.account_id AND x.workspace_id=s.workspace_id AND x.source_device_id=s.device_id AND x.active_lease_epoch=epoch AND (x.execution_fact_sequence=sequence OR x.event_id=(p_event->>'executionFactId'))) THEN why:='sequence_replay';
 ELSIF EXISTS(SELECT 1 FROM public.execution_fact_drain_records x WHERE x.account_id=s.account_id AND x.workspace_id=s.workspace_id AND x.source_device_id=s.device_id AND x.signed_event IS NOT NULL AND (x.signed_event->>'attemptId'=p_event->>'attemptId' OR x.signed_event->>'auditEventRef'=p_event->>'auditEventRef' OR x.event_id=(p_event->>'executionFactId'))) THEN why:='sequence_replay';
 ELSIF sealed THEN why:='drain_seal_violation';END IF;
 IF why IS NULL AND sequence>h.contiguous_received_through+1 THEN RETURN jsonb_build_object('schemaVersion',1,'outcome','pending','code','PREDECESSOR_MISSING');END IF;
 IF why IS NULL AND p_pending IS NOT NULL THEN RETURN jsonb_build_object('schemaVersion',1,'outcome','pending','code',p_pending);END IF;

 IF why IS NOT NULL THEN
 INSERT INTO public.execution_fact_evidence_quarantines(account_id,workspace_id,source_device_id,active_lease_epoch,sequence,event_id,envelope_digest,reason,domain_blocking)
 VALUES(s.account_id,s.workspace_id,s.device_id,epoch,sequence,event_id,digest,why,p_signature_verified AND NOT sealed) ON CONFLICT DO NOTHING;
 ELSE
 BEGIN
 INSERT INTO public.execution_fact_drain_records(account_id,workspace_id,source_device_id,active_lease_epoch,execution_fact_sequence,canonical_envelope,envelope_digest,classification,event_id,signed_event,received_at)
 VALUES(s.account_id,s.workspace_id,s.device_id,epoch,sequence,p_bytes,digest,CASE WHEN epoch=s.current_epoch THEN 'current' ELSE 'late' END,event_id,p_event,clock_timestamp());
 PERFORM * FROM public.execution_fact_drain_recompute_head(s.device_id,epoch);
 EXCEPTION WHEN unique_violation THEN
  GET STACKED DIAGNOSTICS violated_constraint = CONSTRAINT_NAME;
  IF violated_constraint NOT IN ('execution_fact_evidence_attempt_once','execution_fact_evidence_audit_once','execution_fact_evidence_event_once') THEN RAISE;END IF;
  INSERT INTO public.execution_fact_evidence_quarantines(account_id,workspace_id,source_device_id,active_lease_epoch,sequence,event_id,envelope_digest,reason,domain_blocking)
  VALUES(s.account_id,s.workspace_id,s.device_id,epoch,sequence,event_id,digest,'sequence_replay',p_signature_verified AND NOT sealed) ON CONFLICT DO NOTHING;
 END;
 END IF;
 receipt:=public.execution_fact_evidence_receipt(epoch,sequence,event_id,digest);
 RETURN jsonb_build_object('schemaVersion',1,'outcome',receipt->>'outcome','receipt',receipt);
END;
$function$;
CREATE OR REPLACE FUNCTION public.execution_fact_drain_install_accepted_seal(p_proof_id text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $function$
DECLARE proof record;
BEGIN
 SELECT * INTO proof FROM public.device_read_just_consumed_drain_proof(p_proof_id);
 IF NOT FOUND THEN RETURN false;END IF;
 BEGIN
 PERFORM * FROM public.execution_fact_drain_recompute_head(proof.source_device_id,proof.active_lease_epoch);
 -- An accepted seal is immutable. New rejections cannot roll it back; prior verified violations block a first seal.
 IF NOT EXISTS(SELECT 1 FROM public.execution_fact_drain_seals x WHERE x.account_id=current_setting('gooddealer.account_id',true) AND x.workspace_id=current_setting('gooddealer.workspace_id',true) AND x.source_device_id=proof.source_device_id AND x.active_lease_epoch=proof.active_lease_epoch)
 AND EXISTS(SELECT 1 FROM public.execution_fact_evidence_quarantines x WHERE x.account_id=current_setting('gooddealer.account_id',true) AND x.workspace_id=current_setting('gooddealer.workspace_id',true) AND x.source_device_id=proof.source_device_id AND x.active_lease_epoch=proof.active_lease_epoch AND x.domain_blocking) THEN RAISE EXCEPTION 'verified execution violation blocks seal' USING ERRCODE='GD021';END IF;
 IF NOT public.execution_fact_drain_install_accepted_seal_before_evidence(p_proof_id) THEN RAISE EXCEPTION 'execution seal rejected' USING ERRCODE='GD021';END IF;
 RETURN true;
 EXCEPTION WHEN SQLSTATE 'GD021' THEN RETURN false;
 END;
END;
$function$;
`};
