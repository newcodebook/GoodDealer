import type { CloudMigration } from "../../../db/index";

/** Preserve the original ledger while admitting separately signed listing-plan item purposes. */
export const executionListingPlanEvidenceMigration: CloudMigration = {id:"202611190033-execution-listing-plan-evidence",owner:"execution-ledger",sql:`
CREATE OR REPLACE FUNCTION public.execution_fact_evidence_append(p_event jsonb,p_bytes bytea,p_reason text,p_signature_verified boolean,p_pending text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $function$
DECLARE s record;r record;h record;receipt jsonb;sealed boolean;why text:=p_reason; violated_constraint text;
 epoch bigint:=(p_event->>'activeLeaseEpoch')::bigint; sequence bigint:=(p_event->>'executionFactSequence')::bigint;
 payload jsonb:=p_event->'payloadRedacted';allowed text[];digest_keys text[];field text;
 evidence jsonb;approval jsonb;approval_json json;approval_bytes bytea;approval_domain text;approval_digest text;
 original_event jsonb;paired_event jsonb;
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
 IF payload->>'schemaVersion'='2' OR payload->>'action'='reactivate_ownership_review' THEN
  IF (payload->>'provider'='afternic' AND payload->>'stage'='dispatch_claimed' AND
    ((payload->'schemaVersion'='2'::jsonb AND payload->>'action' IN ('create','update')) OR
     (payload->'schemaVersion'='1'::jsonb AND payload->>'action'='reactivate_ownership_review'))) IS NOT TRUE
   THEN RAISE EXCEPTION 'listing plan fact purpose rejected' USING ERRCODE='42501';END IF;
  allowed:=ARRAY['schemaVersion','provider','action','stage','dispatchSemantics','deduplicationScope','requestDigest','approvalEnvelopeDigest'];
  digest_keys:=ARRAY['requestDigest','approvalEnvelopeDigest'];
  IF payload->>'action'='reactivate_ownership_review' THEN
   allowed:=allowed||ARRAY['resourceBindingDigest','preflightObservationDigest'];digest_keys:=digest_keys||ARRAY['resourceBindingDigest','preflightObservationDigest'];
  END IF;
  IF NOT payload ?& allowed OR (payload-allowed)<>'{}'::jsonb
   OR payload->>'dispatchSemantics' IS DISTINCT FROM 'local_claim_only' OR payload->>'deduplicationScope' IS DISTINCT FROM 'local_only'
   OR p_event->>'evidenceLevel' IS DISTINCT FROM 'durable_local_claim' OR p_event->'attemptNo' IS DISTINCT FROM '1'::jsonb
   OR p_event->>'eventType' IS DISTINCT FROM (CASE WHEN payload->>'action'='reactivate_ownership_review' THEN 'afternic_ownership_review_dispatch_claimed' ELSE 'afternic_listing_plan_v2_dispatch_claimed' END)
   THEN RAISE EXCEPTION 'listing plan fact shape rejected' USING ERRCODE='42501';END IF;
  FOREACH field IN ARRAY digest_keys LOOP
   IF jsonb_typeof(payload->field) IS DISTINCT FROM 'string' OR (payload->>field ~ '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$') IS NOT TRUE
    THEN RAISE EXCEPTION 'listing plan observation digest rejected' USING ERRCODE='42501';END IF;
  END LOOP;
  evidence:=p_event->'executionAuthorizationEvidence';
  allowed:=ARRAY['approvedOperationDigest','approvedOperationEnvelope','signingKeyId','signingKeyVersion','credentialEpoch','signatureTranscriptVersion'];
  IF jsonb_typeof(evidence) IS DISTINCT FROM 'object' OR NOT evidence ?& allowed OR (evidence-allowed)<>'{}'::jsonb
   OR length(evidence->>'approvedOperationEnvelope') NOT BETWEEN 1 AND 8192
   OR (evidence->>'approvedOperationEnvelope' ~ '^[A-Za-z0-9_-]+$') IS NOT TRUE
   THEN RAISE EXCEPTION 'listing item evidence shape rejected' USING ERRCODE='42501';END IF;
  -- Invalid embedded approvals adjudicated by Cloud are quarantined without retaining their bytes.
  IF p_reason IS NULL THEN
  approval_bytes:=decode(translate(evidence->>'approvedOperationEnvelope','-_','+/')||repeat('=',(4-length(evidence->>'approvedOperationEnvelope')%4)%4),'base64');
  IF octet_length(approval_bytes) NOT BETWEEN 1 AND 6144
   OR rtrim(translate(encode(approval_bytes,'base64'),E'+/\n','-_'),'=') IS DISTINCT FROM evidence->>'approvedOperationEnvelope'
   THEN RAISE EXCEPTION 'listing item evidence encoding rejected' USING ERRCODE='42501';END IF;
  approval_json:=convert_from(approval_bytes,'UTF8')::json;
  IF json_typeof(approval_json) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'listing item approval rejected' USING ERRCODE='42501';END IF;
  IF (SELECT count(*) FROM json_each(approval_json))<>(SELECT count(DISTINCT key) FROM json_each(approval_json))
   THEN RAISE EXCEPTION 'duplicate listing item approval field' USING ERRCODE='42501';END IF;
  approval:=approval_json::jsonb;
  allowed:=ARRAY['schemaVersion','typ','aud','approvedOperationId','operationId','planId','planHash','targetCount','targetSetDigest','operationItemId','action','requestDigest','parentItemId','parentRequestDigest','capability','accountId','workspaceId','sourceDeviceId','activeLeaseEpoch','credentialEpoch','signingKeyId','signingKeyVersion','authorizationHash','trustedTimeAnchorId','monotonicDeltaMs','approvedAt','signatureTranscriptVersion','deviceSignature'];
  IF NOT approval ?& allowed OR (approval-allowed)<>'{}'::jsonb
   OR approval->'schemaVersion' IS DISTINCT FROM payload->'schemaVersion'
   OR approval->>'typ' IS DISTINCT FROM (CASE WHEN payload->>'action'='reactivate_ownership_review' THEN 'gd.afternic-ownership-review-item-approval.v1' ELSE 'gd.afternic-listing-plan-item-approval.v2' END)
   OR approval->>'aud' IS DISTINCT FROM 'gooddealer-cloud/execution-evidence' OR approval->>'capability' IS DISTINCT FROM 'afternic:marketplace:write'
   OR approval->'signatureTranscriptVersion' IS DISTINCT FROM '1'::jsonb
   OR (approval->>'deviceSignature' ~ '^[A-Za-z0-9_-]{85}[AQgw]$') IS NOT TRUE
   OR jsonb_typeof(approval->'targetCount') IS DISTINCT FROM 'number' OR (approval->>'targetCount' ~ '^([1-9][0-9]{0,2}|1000)$') IS NOT TRUE
   THEN RAISE EXCEPTION 'listing item approval purpose rejected' USING ERRCODE='42501';END IF;
  FOREACH field IN ARRAY ARRAY['approvedOperationId','operationId','planId','operationItemId'] LOOP
   IF jsonb_typeof(approval->field) IS DISTINCT FROM 'string' OR (approval->>field ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') IS NOT TRUE
    THEN RAISE EXCEPTION 'listing item approval identifier rejected' USING ERRCODE='42501';END IF;
  END LOOP;
  FOREACH field IN ARRAY ARRAY['planHash','targetSetDigest','requestDigest','authorizationHash','trustedTimeAnchorId'] LOOP
   IF jsonb_typeof(approval->field) IS DISTINCT FROM 'string' OR (approval->>field ~ '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$') IS NOT TRUE
    THEN RAISE EXCEPTION 'listing item approval digest rejected' USING ERRCODE='42501';END IF;
  END LOOP;
  FOREACH field IN ARRAY ARRAY['accountId','workspaceId','sourceDeviceId','signingKeyId'] LOOP
   IF jsonb_typeof(approval->field) IS DISTINCT FROM 'string' OR (approval->>field ~ '^[!-~]{1,160}$') IS NOT TRUE
    THEN RAISE EXCEPTION 'listing item identity rejected' USING ERRCODE='42501';END IF;
  END LOOP;
  FOREACH field IN ARRAY ARRAY['activeLeaseEpoch','credentialEpoch','signingKeyVersion','monotonicDeltaMs'] LOOP
   IF jsonb_typeof(approval->field) IS DISTINCT FROM 'number' OR (approval->>field ~ '^(0|[1-9][0-9]{0,15})$') IS NOT TRUE
    THEN RAISE EXCEPTION 'listing item number rejected' USING ERRCODE='42501';END IF;
   IF (approval->>field)::numeric>9007199254740991 OR (field<>'monotonicDeltaMs' AND (approval->>field)::numeric<1)
    THEN RAISE EXCEPTION 'listing item number rejected' USING ERRCODE='42501';END IF;
  END LOOP;
  IF jsonb_typeof(approval->'approvedAt') IS DISTINCT FROM 'string' OR (approval->>'approvedAt' ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]Z$') IS NOT TRUE
   OR to_char((approval->>'approvedAt')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') IS DISTINCT FROM approval->>'approvedAt'
   OR approval->>'approvedAt'>p_event->>'occurredAt' OR p_event->'requestStartBoundary' IS DISTINCT FROM p_event->'occurredAt'
   THEN RAISE EXCEPTION 'listing item time rejected' USING ERRCODE='42501';END IF;
  IF (approval->'parentItemId'='null'::jsonb) IS DISTINCT FROM (approval->'parentRequestDigest'='null'::jsonb)
   OR (payload->>'action'<>'reactivate_ownership_review' AND approval->'parentItemId'<>'null'::jsonb)
   OR (approval->'parentItemId'<>'null'::jsonb AND (
    (approval->>'parentItemId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') IS NOT TRUE
    OR (approval->>'parentRequestDigest' ~ '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$') IS NOT TRUE
    OR approval->>'parentItemId'=approval->>'operationItemId'))
   THEN RAISE EXCEPTION 'listing item parent rejected' USING ERRCODE='42501';END IF;
  approval_domain:=CASE WHEN payload->>'action'='reactivate_ownership_review' THEN 'GOODDEALER-AFTERNIC-OWNERSHIP-REVIEW-ITEM-APPROVAL-ENVELOPE-V1' ELSE 'GOODDEALER-AFTERNIC-LISTING-PLAN-ITEM-APPROVAL-ENVELOPE-V2' END;
  approval_digest:=rtrim(translate(encode(sha256(public.audit_execution_evidence_frame('d',convert_to(approval_domain,'UTF8'))||public.audit_execution_evidence_frame('v',public.audit_execution_evidence_value(approval,0))),'base64'),E'+/\n','-_'),'=');
  IF rtrim(translate(encode(sha256(public.audit_execution_evidence_frame('d',convert_to('GOODDEALER-AFTERNIC-LOCAL-DISPATCH-KEY-V1','UTF8'))||public.audit_execution_evidence_frame('v',public.audit_execution_evidence_value(jsonb_build_object('schemaVersion',1,'operationId',approval->'operationId','operationItemId',approval->'operationItemId','attemptNo',1,'localOperationKey',approval->'planId'),0))),'base64'),E'+/\n','-_'),'=') IS DISTINCT FROM p_event->>'idempotencyKeyHash'
   THEN RAISE EXCEPTION 'listing dispatch identity rejected' USING ERRCODE='42501';END IF;
  IF approval->>'action' IS DISTINCT FROM payload->>'action' OR approval->>'accountId' IS DISTINCT FROM s.account_id
   OR approval->>'workspaceId' IS DISTINCT FROM s.workspace_id OR approval->>'sourceDeviceId' IS DISTINCT FROM s.device_id
   OR approval->'activeLeaseEpoch' IS DISTINCT FROM p_event->'activeLeaseEpoch' OR approval->'credentialEpoch' IS DISTINCT FROM p_event->'credentialEpoch'
   OR approval->'signingKeyId' IS DISTINCT FROM p_event->'signingKeyId' OR approval->'signingKeyVersion' IS DISTINCT FROM p_event->'signingKeyVersion'
   OR approval->'operationId' IS DISTINCT FROM p_event->'operationId' OR approval->'operationItemId' IS DISTINCT FROM p_event->'operationItemId'
   OR approval->'approvedOperationId' IS DISTINCT FROM p_event->'approvedOperationId' OR approval->'planHash' IS DISTINCT FROM p_event->'planHash'
   OR approval->'requestDigest' IS DISTINCT FROM payload->'requestDigest'
   OR evidence->>'approvedOperationDigest' IS DISTINCT FROM approval_digest OR payload->>'approvalEnvelopeDigest' IS DISTINCT FROM approval_digest
   OR evidence->'signingKeyId' IS DISTINCT FROM approval->'signingKeyId' OR evidence->'signingKeyVersion' IS DISTINCT FROM approval->'signingKeyVersion'
   OR evidence->'credentialEpoch' IS DISTINCT FROM approval->'credentialEpoch' OR evidence->'signatureTranscriptVersion' IS DISTINCT FROM '1'::jsonb
   THEN RAISE EXCEPTION 'listing item scope rejected' USING ERRCODE='42501';END IF;
  END IF;
 ELSE
 IF p_event->'payloadRedacted'->>'stage'='dispatch_claimed' THEN
  IF ((p_event->'payloadRedacted')-ARRAY['schemaVersion','provider','action','stage','dispatchSemantics','deduplicationScope','requestDigest','approvalEnvelopeDigest'])<>'{}'::jsonb THEN RAISE EXCEPTION 'execution payload shape rejected' USING ERRCODE='42501';END IF;
 ELSE RAISE EXCEPTION 'execution payload stage rejected' USING ERRCODE='42501';END IF;
 IF p_event->'payloadRedacted'->>'provider' IS DISTINCT FROM 'afternic' OR (p_event->'payloadRedacted'->>'action') IS NULL OR (p_event->'payloadRedacted'->>'action') NOT IN ('remove','create','update') OR p_event->'payloadRedacted'->>'schemaVersion' IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'execution payload purpose rejected' USING ERRCODE='42501';END IF;
 IF p_event->>'eventType' IS DISTINCT FROM (CASE WHEN p_event->'payloadRedacted'->>'action'='remove' THEN 'afternic_delist_dispatch_claimed' ELSE 'afternic_listing_write_dispatch_claimed' END)
 OR p_event->>'evidenceLevel' IS DISTINCT FROM 'durable_local_claim'
 OR p_event->>'attemptNo' IS DISTINCT FROM '1'
 OR p_event->'payloadRedacted'->>'dispatchSemantics' IS DISTINCT FROM 'local_claim_only'
 OR p_event->'payloadRedacted'->>'deduplicationScope' IS DISTINCT FROM 'local_only'
 THEN RAISE EXCEPTION 'execution fact purpose rejected' USING ERRCODE='42501';END IF;
 IF jsonb_typeof(p_event->'executionAuthorizationEvidence') IS DISTINCT FROM 'object' OR ((p_event->'executionAuthorizationEvidence')-ARRAY['approvedOperationDigest','approvedOperationEnvelope','signingKeyId','signingKeyVersion','credentialEpoch','signatureTranscriptVersion'])<>'{}'::jsonb THEN RAISE EXCEPTION 'execution approval shape rejected' USING ERRCODE='42501';END IF;
 END IF;
 IF payload->>'action'='reactivate_ownership_review' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('gooddealer:ownership-evidence:'||s.account_id||':'||s.workspace_id||':'||(p_event->>'operationId')||':'||(p_event->>'operationItemId'),0));
 END IF;
 SELECT * INTO h FROM public.execution_fact_drain_recompute_head(s.device_id,epoch);
 receipt:=public.execution_fact_evidence_receipt(epoch,sequence,event_id,digest);
 IF receipt->>'outcome'='accepted' THEN RETURN jsonb_build_object('schemaVersion',1,'outcome','accepted','receipt',receipt);END IF;
 SELECT EXISTS(SELECT 1 FROM public.execution_fact_drain_seals x WHERE x.account_id=s.account_id AND x.workspace_id=s.workspace_id AND x.source_device_id=s.device_id AND x.active_lease_epoch=epoch) INTO sealed;
 IF receipt IS NOT NULL THEN RETURN jsonb_build_object('schemaVersion',1,'outcome','quarantined','receipt',receipt);END IF;
 IF EXISTS(SELECT 1 FROM public.execution_fact_drain_records x WHERE x.account_id=s.account_id AND x.workspace_id=s.workspace_id AND x.source_device_id=s.device_id AND x.active_lease_epoch=epoch AND (x.execution_fact_sequence=sequence OR x.event_id=(p_event->>'executionFactId'))) THEN why:='sequence_replay';
 ELSIF EXISTS(SELECT 1 FROM public.execution_fact_drain_records x WHERE x.account_id=s.account_id AND x.workspace_id=s.workspace_id AND x.source_device_id=s.device_id AND x.signed_event IS NOT NULL AND (x.signed_event->>'attemptId'=p_event->>'attemptId' OR x.signed_event->>'auditEventRef'=p_event->>'auditEventRef' OR x.event_id=(p_event->>'executionFactId'))) THEN why:='sequence_replay';
 ELSIF sealed THEN why:='drain_seal_violation';END IF;
 IF why IS NULL AND payload->>'action'='reactivate_ownership_review' AND EXISTS(
  SELECT 1 FROM public.workspace_device_audit_drain_records x WHERE x.account_id=s.account_id AND x.workspace_id=s.workspace_id AND x.quarantine_reason IS NULL
   AND x.signed_event->'payloadRedacted'->>'operationId'=p_event->>'operationId' AND x.signed_event->'payloadRedacted'->>'operationItemId'=p_event->>'operationItemId'
   AND x.signed_event->'payloadRedacted'->>'stage'='preflight_satisfied') THEN why:='authorization';END IF;
 IF why IS NULL AND (payload->>'schemaVersion'='2' OR payload->>'action'='reactivate_ownership_review') THEN
  SELECT x.signed_event INTO original_event FROM public.workspace_device_audit_drain_records x
   WHERE x.account_id=s.account_id AND x.workspace_id=s.workspace_id AND x.source_device_id=s.device_id AND x.active_lease_epoch=epoch AND x.quarantine_reason IS NULL
    AND x.signed_event->'payloadRedacted'->>'stage'='approved' AND x.signed_event->'payloadRedacted'->>'approvedOperationId'=p_event->>'approvedOperationId';
  IF original_event IS NULL THEN p_pending:='APPROVAL_AUDIT_MISSING';
  ELSE
   IF original_event->'payloadRedacted'->'schemaVersion' IS DISTINCT FROM '2'::jsonb OR original_event->'payloadRedacted'->>'action' IS DISTINCT FROM 'listing_plan_v2'
    OR original_event->'payloadRedacted'->'planId' IS DISTINCT FROM approval->'planId'
    OR original_event->'payloadRedacted'->'planHash' IS DISTINCT FROM approval->'planHash'
    OR original_event->'payloadRedacted'->'operationId' IS DISTINCT FROM approval->'operationId'
    OR original_event->'payloadRedacted'->'targetCount' IS DISTINCT FROM approval->'targetCount'
    OR original_event->'payloadRedacted'->'targetSetDigest' IS DISTINCT FROM approval->'targetSetDigest'
    OR original_event->'occurredAt' IS DISTINCT FROM approval->'approvedAt'
    OR original_event->'authorizationContextHash' IS DISTINCT FROM approval->'authorizationHash'
    OR original_event->'trustedTimeAnchorId' IS DISTINCT FROM approval->'trustedTimeAnchorId'
    OR original_event->'monotonicDeltaMs' IS DISTINCT FROM approval->'monotonicDeltaMs'
    OR original_event->'credentialEpoch' IS DISTINCT FROM approval->'credentialEpoch'
    OR original_event->'signingKeyId' IS DISTINCT FROM approval->'signingKeyId'
    OR original_event->'signingKeyVersion' IS DISTINCT FROM approval->'signingKeyVersion' THEN why:='authorization';END IF;
   SELECT x.signed_event INTO paired_event FROM public.workspace_device_audit_drain_records x
    WHERE x.account_id=s.account_id AND x.workspace_id=s.workspace_id AND x.source_device_id=s.device_id AND x.active_lease_epoch=epoch AND x.quarantine_reason IS NULL
     AND x.event_id=p_event->>'auditEventRef';
   IF paired_event IS NULL THEN p_pending:='PAIRED_AUDIT_MISSING';
   ELSIF paired_event->'payloadRedacted'->>'stage' IS DISTINCT FROM 'dispatch_claimed'
    OR paired_event->'payloadRedacted'->'schemaVersion' IS DISTINCT FROM payload->'schemaVersion'
    OR paired_event->'payloadRedacted'->'action' IS DISTINCT FROM payload->'action'
    OR paired_event->'eventHash' IS DISTINCT FROM p_event->'auditEventHash'
    OR paired_event->'occurredAt' IS DISTINCT FROM p_event->'occurredAt'
    OR paired_event->'monotonicDeltaMs' IS DISTINCT FROM p_event->'monotonicDeltaMs'
    OR paired_event->'trustedTimeAnchorId' IS DISTINCT FROM p_event->'trustedTimeAnchorId'
    OR paired_event->'authorizationContextHash' IS DISTINCT FROM p_event->'authorizationHash'
    OR paired_event->'signingKeyId' IS DISTINCT FROM p_event->'signingKeyId'
    OR paired_event->'signingKeyVersion' IS DISTINCT FROM p_event->'signingKeyVersion'
    OR paired_event->'credentialEpoch' IS DISTINCT FROM p_event->'credentialEpoch'
    OR paired_event->'payloadRedacted'->'approvedOperationId' IS DISTINCT FROM p_event->'approvedOperationId'
    OR paired_event->'payloadRedacted'->'operationId' IS DISTINCT FROM p_event->'operationId'
    OR paired_event->'payloadRedacted'->'operationItemId' IS DISTINCT FROM p_event->'operationItemId'
    OR paired_event->'payloadRedacted'->'attemptId' IS DISTINCT FROM p_event->'attemptId'
    OR paired_event->'payloadRedacted'->'attemptNo' IS DISTINCT FROM p_event->'attemptNo'
    OR paired_event->'payloadRedacted'->'planHash' IS DISTINCT FROM p_event->'planHash'
    OR paired_event->'payloadRedacted'->'requestDigest' IS DISTINCT FROM payload->'requestDigest'
    OR paired_event->'payloadRedacted'->'approvalEnvelopeDigest' IS DISTINCT FROM payload->'approvalEnvelopeDigest'
    OR paired_event->'payloadRedacted'->'resourceBindingDigest' IS DISTINCT FROM payload->'resourceBindingDigest'
    OR paired_event->'payloadRedacted'->'preflightObservationDigest' IS DISTINCT FROM payload->'preflightObservationDigest'
    THEN why:='authorization';END IF;
  END IF;
 END IF;
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
`};
