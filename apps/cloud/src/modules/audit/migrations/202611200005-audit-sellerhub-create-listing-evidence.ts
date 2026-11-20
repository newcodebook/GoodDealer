import type { CloudMigration } from "../../../db/index";

/** Extend the audit stream with closed marketplace and SellerHub creation producer purposes. */
export const auditSellerHubCreateListingEvidenceMigration: CloudMigration = {id:"202611200005-audit-sellerhub-create-listing-evidence",owner:"audit",sql:`
CREATE OR REPLACE FUNCTION public.audit_execution_evidence_append(p_event jsonb,p_bytes bytea,p_reason text,p_signature_verified boolean,p_pending text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $function$
DECLARE s record;r record;h record;receipt jsonb;sealed boolean;why text:=p_reason;
 epoch bigint:=(p_event->>'activeLeaseEpoch')::bigint; sequence bigint:=(p_event->>'auditSequence')::bigint;
 payload jsonb:=p_event->'payloadRedacted';allowed text[];uuid_keys text[];digest_keys text[];field text;
 original_event jsonb;paired_event jsonb; original_digest bytea;
 atom boolean:=coalesce(payload->>'action'='remove_standard',false);
 creation boolean:=coalesce(payload->>'action'='create_listing',false);
 bounded_market boolean:=coalesce(payload->>'action' IN ('set_bin_price','remove_standard','create_listing'),false);
 market_provider text:=CASE WHEN atom THEN 'atom' ELSE 'spaceship' END;
 market_claim_event text:=CASE WHEN atom THEN 'atom_standard_delist_dispatch_claimed' WHEN creation THEN 'sellerhub_create_listing_dispatch_claimed' ELSE 'sellerhub_bin_price_dispatch_claimed' END;
 market_lock_prefix text:=CASE WHEN atom THEN 'gooddealer:atom-standard-delist:' WHEN creation THEN 'gooddealer:sellerhub-create-listing:' ELSE 'gooddealer:sellerhub-bin-price:' END;
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
 IF bounded_market THEN
  IF payload->>'provider' IS DISTINCT FROM market_provider OR payload->'schemaVersion' IS DISTINCT FROM '1'::jsonb
    THEN RAISE EXCEPTION 'SellerHub audit purpose rejected' USING ERRCODE='42501';END IF;
  allowed:=ARRAY['schemaVersion','provider','action','stage','operationId'];
  uuid_keys:=ARRAY['operationId'];digest_keys:=ARRAY[]::text[];
  IF payload->>'stage'='approved' THEN
   allowed:=allowed||ARRAY['approvedOperationId','planId','planHash','targetCount','targetSetDigest'];
   uuid_keys:=uuid_keys||ARRAY['approvedOperationId','planId'];digest_keys:=ARRAY['planHash','targetSetDigest'];
   IF jsonb_typeof(payload->'targetCount') IS DISTINCT FROM 'number'
    OR (payload->>'targetCount' ~ '^([1-9][0-9]?|[1-4][0-9]{2}|500)$') IS NOT TRUE
    THEN RAISE EXCEPTION 'SellerHub approval count rejected' USING ERRCODE='42501';END IF;
  ELSIF payload->>'stage' IN ('dispatch_claimed','preflight_refused') THEN
   allowed:=allowed||ARRAY['approvedOperationId','operationItemId','attemptId','planHash','requestDigest','approvalEnvelopeDigest'];
   uuid_keys:=uuid_keys||ARRAY['approvedOperationId','operationItemId','attemptId'];digest_keys:=ARRAY['planHash','requestDigest','approvalEnvelopeDigest'];
   IF payload->>'stage'='dispatch_claimed' THEN
    allowed:=allowed||ARRAY['attemptNo'];
    IF payload->'attemptNo' IS DISTINCT FROM '1'::jsonb THEN RAISE EXCEPTION 'SellerHub claim number rejected' USING ERRCODE='42501';END IF;
   ELSE
    allowed:=allowed||ARRAY['reason'];
    IF (payload->>'reason' IN ('precondition_changed','connection_changed','provider_state_blocked')) IS NOT TRUE
     THEN RAISE EXCEPTION 'SellerHub refusal reason rejected' USING ERRCODE='42501';END IF;
   END IF;
  ELSIF payload->>'stage'='reconciled' THEN
   allowed:=allowed||ARRAY['operationItemId','attemptId','originalExecutionFactId','originalExecutionFactDigest','originalSourceDeviceId','originalActiveLeaseEpoch','outcome','reason'];
   uuid_keys:=uuid_keys||ARRAY['operationItemId','attemptId','originalExecutionFactId'];digest_keys:=ARRAY['originalExecutionFactDigest'];
   IF jsonb_typeof(payload->'originalSourceDeviceId') IS DISTINCT FROM 'string'
    OR (payload->>'originalSourceDeviceId' ~ '^[!-~]{1,160}$') IS NOT TRUE
    OR jsonb_typeof(payload->'originalActiveLeaseEpoch') IS DISTINCT FROM 'number'
    OR (payload->>'originalActiveLeaseEpoch' ~ '^[1-9][0-9]{0,15}$') IS NOT TRUE
    THEN RAISE EXCEPTION 'SellerHub original source rejected' USING ERRCODE='42501';END IF;
   IF (payload->>'originalActiveLeaseEpoch')::numeric>epoch OR
    ((creation AND (
          (payload->>'outcome'='published' AND payload->'reason'='null'::jsonb)
       OR (payload->>'outcome'='ownership_pending' AND payload->>'reason'='ownership_verifying')
       OR (payload->>'outcome'='terms_unconfirmed' AND payload->>'reason'='postcondition_pending')
       OR (payload->>'outcome'='state_blocked' AND payload->>'reason'='not_on_sale')))
      OR (NOT creation AND ((NOT atom AND payload->>'outcome'='matched' AND payload->'reason'='null'::jsonb)
       OR (payload->>'outcome'='different' AND payload->>'reason'='postcondition_pending')))
      OR (payload->>'outcome'='read_failed' AND payload->>'reason'='read_failed')) IS NOT TRUE
    THEN RAISE EXCEPTION 'SellerHub reconciliation outcome rejected' USING ERRCODE='42501';END IF;
  ELSE
   RAISE EXCEPTION 'SellerHub audit stage rejected' USING ERRCODE='42501';
  END IF;
  IF NOT payload ?& allowed OR (payload-allowed)<>'{}'::jsonb
   THEN RAISE EXCEPTION 'SellerHub audit payload shape rejected' USING ERRCODE='42501';END IF;
  FOREACH field IN ARRAY uuid_keys LOOP
   IF jsonb_typeof(payload->field) IS DISTINCT FROM 'string' OR (payload->>field ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') IS NOT TRUE
    THEN RAISE EXCEPTION 'SellerHub audit identifier rejected' USING ERRCODE='42501';END IF;
  END LOOP;
  FOREACH field IN ARRAY digest_keys LOOP
   IF jsonb_typeof(payload->field) IS DISTINCT FROM 'string' OR (payload->>field ~ '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$') IS NOT TRUE
    THEN RAISE EXCEPTION 'SellerHub audit digest rejected' USING ERRCODE='42501';END IF;
  END LOOP;
  IF p_event->>'targetType' IS DISTINCT FROM (CASE WHEN atom THEN CASE WHEN payload->>'stage'='approved' THEN 'atom_standard_delist_approval' ELSE 'atom_standard_delist_attempt' END
        WHEN creation THEN CASE WHEN payload->>'stage'='approved' THEN 'sellerhub_create_listing_approval' ELSE 'sellerhub_create_listing_attempt' END
        WHEN payload->>'stage'='approved' THEN 'sellerhub_bin_price_approval' ELSE 'sellerhub_bin_price_attempt' END)
   OR p_event->>'targetRef' IS DISTINCT FROM (CASE WHEN payload->>'stage'='approved' THEN payload->>'approvedOperationId' ELSE payload->>'attemptId' END)
   OR p_event->>'eventType' IS DISTINCT FROM (CASE WHEN payload->>'stage' IN ('approved','dispatch_claimed') THEN 'approved_operation_execution' ELSE 'runtime_security_lifecycle' END)
   OR p_event->>'authorizationSource' IS DISTINCT FROM (CASE WHEN payload->>'stage' IN ('approved','dispatch_claimed') THEN 'approved_operation' ELSE 'runtime_security_context' END)
   OR p_event->>'actorKind' IS DISTINCT FROM (CASE WHEN payload->>'stage'='approved' THEN 'user' ELSE 'device_service' END)
   THEN RAISE EXCEPTION 'SellerHub audit target rejected' USING ERRCODE='42501';END IF;
 ELSIF payload->>'schemaVersion'='2' OR payload->>'action'='reactivate_ownership_review' THEN
  IF (payload->>'provider'='afternic' AND jsonb_typeof(payload->'schemaVersion')='number' AND
    ((payload->>'schemaVersion'='2' AND payload->>'action' IN ('listing_plan_v2','create','update')) OR
     (payload->>'schemaVersion'='1' AND payload->>'action'='reactivate_ownership_review'))) IS NOT TRUE
   THEN RAISE EXCEPTION 'listing plan payload purpose rejected' USING ERRCODE='42501';END IF;
  allowed:=ARRAY['schemaVersion','provider','action','stage'];
  uuid_keys:=ARRAY['operationId'];digest_keys:=ARRAY[]::text[];
  IF payload->>'stage'='approved' THEN
   IF payload->>'action' IS DISTINCT FROM 'listing_plan_v2' THEN RAISE EXCEPTION 'listing plan batch purpose rejected' USING ERRCODE='42501';END IF;
   allowed:=allowed||ARRAY['approvedOperationId','operationId','planId','planHash','targetCount','targetSetDigest'];
   uuid_keys:=uuid_keys||ARRAY['approvedOperationId','planId'];digest_keys:=ARRAY['planHash','targetSetDigest'];
   IF jsonb_typeof(payload->'targetCount') IS DISTINCT FROM 'number' OR (payload->>'targetCount' ~ '^([1-9][0-9]{0,2}|1000)$') IS NOT TRUE
    THEN RAISE EXCEPTION 'listing plan count rejected' USING ERRCODE='42501';END IF;
  ELSIF payload->>'stage' IN ('dispatch_claimed','preflight_refused','preflight_satisfied') THEN
   IF payload->>'action'='listing_plan_v2' OR (payload->>'stage'='preflight_satisfied' AND payload->>'action'<>'reactivate_ownership_review')
    THEN RAISE EXCEPTION 'listing item purpose rejected' USING ERRCODE='42501';END IF;
   allowed:=allowed||ARRAY['approvedOperationId','operationId','operationItemId','attemptId','planHash','requestDigest','approvalEnvelopeDigest'];
   uuid_keys:=uuid_keys||ARRAY['approvedOperationId','operationItemId','attemptId'];digest_keys:=ARRAY['planHash','requestDigest','approvalEnvelopeDigest'];
   IF payload->>'stage'='dispatch_claimed' THEN
    allowed:=allowed||ARRAY['attemptNo'];
    IF payload->'attemptNo' IS DISTINCT FROM '1'::jsonb THEN RAISE EXCEPTION 'listing claim number rejected' USING ERRCODE='42501';END IF;
    IF payload->>'action'='reactivate_ownership_review' THEN
     allowed:=allowed||ARRAY['resourceBindingDigest','preflightObservationDigest'];digest_keys:=digest_keys||ARRAY['resourceBindingDigest','preflightObservationDigest'];
    END IF;
   ELSIF payload->>'stage'='preflight_refused' THEN
    allowed:=allowed||ARRAY['reason'];
    IF ((payload->>'action'='reactivate_ownership_review' AND payload->>'reason' IN ('precondition_changed','connection_changed','listing_absent','provider_state_blocked','cooldown','prior_outcome_unknown'))
      OR (payload->>'action' IN ('create','update') AND payload->>'reason' IN ('precondition_changed','connection_changed','already_present','listing_absent','provider_state_blocked'))) IS NOT TRUE
     THEN RAISE EXCEPTION 'listing refusal reason rejected' USING ERRCODE='42501';END IF;
   END IF;
  ELSIF payload->>'stage'='reconciled' THEN
   IF payload->>'action'='listing_plan_v2' THEN RAISE EXCEPTION 'listing reconciliation purpose rejected' USING ERRCODE='42501';END IF;
   allowed:=allowed||ARRAY['operationId','operationItemId','attemptId','originalExecutionFactId','originalExecutionFactDigest','outcome','reason'];
   uuid_keys:=uuid_keys||ARRAY['operationItemId','attemptId','originalExecutionFactId'];digest_keys:=ARRAY['originalExecutionFactDigest'];
   IF ((payload->>'action'='reactivate_ownership_review' AND
      ((payload->>'outcome'='confirmed' AND payload->'reason'='null'::jsonb) OR (payload->>'outcome'='still_review' AND payload->>'reason'='postcondition_pending')))
     OR (payload->>'action' IN ('create','update') AND
      ((payload->>'outcome'='matched' AND payload->'reason'='null'::jsonb) OR (payload->>'outcome' IN ('absent','different') AND payload->>'reason'='postcondition_pending')))
     OR (payload->>'outcome'='read_failed' AND payload->>'reason'='read_failed')
     OR (payload->>'outcome'='conflict' AND payload->>'reason' IN ('precondition_changed','connection_changed','provider_state_blocked'))) IS NOT TRUE
    THEN RAISE EXCEPTION 'listing reconciliation outcome rejected' USING ERRCODE='42501';END IF;
  ELSE RAISE EXCEPTION 'listing plan stage rejected' USING ERRCODE='42501';END IF;
  IF NOT payload ?& allowed OR (payload-allowed)<>'{}'::jsonb THEN RAISE EXCEPTION 'listing plan payload shape rejected' USING ERRCODE='42501';END IF;
  FOREACH field IN ARRAY uuid_keys LOOP
   IF jsonb_typeof(payload->field) IS DISTINCT FROM 'string' OR (payload->>field ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') IS NOT TRUE
    THEN RAISE EXCEPTION 'listing plan identifier rejected' USING ERRCODE='42501';END IF;
  END LOOP;
  FOREACH field IN ARRAY digest_keys LOOP
   IF jsonb_typeof(payload->field) IS DISTINCT FROM 'string' OR (payload->>field ~ '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$') IS NOT TRUE
    THEN RAISE EXCEPTION 'listing plan digest rejected' USING ERRCODE='42501';END IF;
  END LOOP;
  IF p_event->>'targetType' IS DISTINCT FROM (CASE WHEN payload->>'stage'='approved' THEN 'afternic_listing_plan_v2_approval'
    WHEN payload->>'action'='reactivate_ownership_review' THEN 'afternic_ownership_review_attempt' ELSE 'afternic_listing_plan_v2_attempt' END)
   OR p_event->>'targetRef' IS DISTINCT FROM (CASE WHEN payload->>'stage'='approved' THEN payload->>'approvedOperationId' ELSE payload->>'attemptId' END)
   OR p_event->>'eventType' IS DISTINCT FROM (CASE WHEN payload->>'stage' IN ('approved','dispatch_claimed') THEN 'approved_operation_execution' ELSE 'runtime_security_lifecycle' END)
   OR p_event->>'authorizationSource' IS DISTINCT FROM (CASE WHEN payload->>'stage' IN ('approved','dispatch_claimed') THEN 'approved_operation' ELSE 'runtime_security_context' END)
   OR p_event->>'actorKind' IS DISTINCT FROM (CASE WHEN payload->>'stage'='approved' THEN 'user' ELSE 'device_service' END)
   THEN RAISE EXCEPTION 'listing plan audit purpose rejected' USING ERRCODE='42501';END IF;
 ELSE
 IF p_event->'payloadRedacted'->>'stage'='approved' THEN
  IF ((p_event->'payloadRedacted')-ARRAY['schemaVersion','provider','action','stage','approvedOperationId','operationId','planId','planHash','targetCount','targetSetDigest'])<>'{}'::jsonb THEN RAISE EXCEPTION 'execution payload shape rejected' USING ERRCODE='42501';END IF;
 ELSIF p_event->'payloadRedacted'->>'stage'='dispatch_claimed' THEN
  IF ((p_event->'payloadRedacted')-ARRAY['schemaVersion','provider','action','stage','approvedOperationId','operationId','operationItemId','attemptId','attemptNo','planHash','requestDigest','approvalEnvelopeDigest'])<>'{}'::jsonb THEN RAISE EXCEPTION 'execution payload shape rejected' USING ERRCODE='42501';END IF;
 ELSIF p_event->'payloadRedacted'->>'stage'='preflight_refused' THEN
  IF ((p_event->'payloadRedacted')-ARRAY['schemaVersion','provider','action','stage','approvedOperationId','operationId','operationItemId','attemptId','planHash','requestDigest','approvalEnvelopeDigest','reason'])<>'{}'::jsonb THEN RAISE EXCEPTION 'execution payload shape rejected' USING ERRCODE='42501';END IF;
 ELSIF p_event->'payloadRedacted'->>'stage'='reconciled' THEN
  IF ((p_event->'payloadRedacted')-ARRAY['schemaVersion','provider','action','stage','operationId','operationItemId','attemptId','originalExecutionFactId','originalExecutionFactDigest','outcome','reason'])<>'{}'::jsonb THEN RAISE EXCEPTION 'execution payload shape rejected' USING ERRCODE='42501';END IF;
 ELSE RAISE EXCEPTION 'execution payload stage rejected' USING ERRCODE='42501';END IF;
 IF p_event->'payloadRedacted'->>'provider' IS DISTINCT FROM 'afternic' OR (p_event->'payloadRedacted'->>'action') IS NULL OR (p_event->'payloadRedacted'->>'action') NOT IN ('remove','create','update') OR p_event->'payloadRedacted'->>'schemaVersion' IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'execution payload purpose rejected' USING ERRCODE='42501';END IF;

 -- Closed producer purposes remain mandatory even for direct production-role calls.
 IF p_event->>'targetType' IS DISTINCT FROM (CASE WHEN p_event->'payloadRedacted'->>'stage'='approved' THEN
   CASE WHEN p_event->'payloadRedacted'->>'action'='remove' THEN 'afternic_delist_approval' ELSE 'afternic_listing_write_approval' END
 ELSE CASE WHEN p_event->'payloadRedacted'->>'action'='remove' THEN 'afternic_delist_attempt' ELSE 'afternic_listing_write_attempt' END END)
 OR p_event->>'targetRef' IS DISTINCT FROM (CASE WHEN p_event->'payloadRedacted'->>'stage'='approved' THEN p_event->'payloadRedacted'->>'approvedOperationId' ELSE p_event->'payloadRedacted'->>'attemptId' END)
 OR p_event->>'eventType' IS DISTINCT FROM (CASE WHEN p_event->'payloadRedacted'->>'stage' IN ('approved','dispatch_claimed') THEN 'approved_operation_execution' ELSE 'runtime_security_lifecycle' END)
 OR p_event->>'authorizationSource' IS DISTINCT FROM (CASE WHEN p_event->'payloadRedacted'->>'stage' IN ('approved','dispatch_claimed') THEN 'approved_operation' ELSE 'runtime_security_context' END)
 OR p_event->>'actorKind' IS DISTINCT FROM (CASE WHEN p_event->'payloadRedacted'->>'stage'='approved' THEN 'user' ELSE 'device_service' END)
 THEN RAISE EXCEPTION 'execution audit purpose rejected' USING ERRCODE='42501';END IF;
 IF p_event->'payloadRedacted'->>'action' IN ('create','update') THEN
  IF p_event->'payloadRedacted'->>'stage'='preflight_refused' AND
   ((p_event->'payloadRedacted'->>'reason') IN ('precondition_changed','connection_changed','already_present','listing_absent','provider_state_blocked')) IS NOT TRUE
  THEN RAISE EXCEPTION 'listing preflight reason rejected' USING ERRCODE='42501';END IF;
  IF p_event->'payloadRedacted'->>'stage'='reconciled' AND (
   (p_event->'payloadRedacted'->>'outcome'='matched' AND p_event->'payloadRedacted'->'reason'='null'::jsonb)
   OR (p_event->'payloadRedacted'->>'outcome' IN ('absent','different') AND p_event->'payloadRedacted'->>'reason'='postcondition_pending')
   OR (p_event->'payloadRedacted'->>'outcome'='read_failed' AND p_event->'payloadRedacted'->>'reason'='read_failed')
   OR (p_event->'payloadRedacted'->>'outcome'='conflict' AND p_event->'payloadRedacted'->>'reason' IN ('precondition_changed','connection_changed','provider_state_blocked'))
  ) IS NOT TRUE THEN RAISE EXCEPTION 'listing reconciliation outcome rejected' USING ERRCODE='42501';END IF;
 END IF;
 END IF;
 -- The two owned append functions serialize contradictory no-dispatch/claimed evidence
 -- on the same workspace item. This uses the existing ledgers, never a second writer.
 IF bounded_market AND payload->>'stage' IN ('dispatch_claimed','preflight_refused') THEN
  PERFORM pg_advisory_xact_lock(hashtextextended(market_lock_prefix||s.account_id||':'||s.workspace_id||':'||(payload->>'operationId')||':'||(payload->>'operationItemId'),0));
 ELSIF payload->>'action'='reactivate_ownership_review' AND payload->>'stage' IN ('dispatch_claimed','preflight_satisfied') THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('gooddealer:ownership-evidence:'||s.account_id||':'||s.workspace_id||':'||(payload->>'operationId')||':'||(payload->>'operationItemId'),0));
 END IF;
 SELECT * INTO h FROM public.audit_recompute_workspace_device_drain_head(s.device_id,epoch);
 receipt:=public.audit_execution_evidence_receipt(epoch,sequence,event_id,digest);
 IF receipt->>'outcome'='accepted' THEN RETURN jsonb_build_object('schemaVersion',1,'outcome','accepted','receipt',receipt);END IF;
 SELECT EXISTS(SELECT 1 FROM public.workspace_device_audit_drain_seals x WHERE x.account_id=s.account_id AND x.workspace_id=s.workspace_id AND x.source_device_id=s.device_id AND x.active_lease_epoch=epoch) INTO sealed;
 IF receipt IS NOT NULL THEN RETURN jsonb_build_object('schemaVersion',1,'outcome','quarantined','receipt',receipt);END IF;
 IF EXISTS(SELECT 1 FROM public.workspace_device_audit_drain_records x WHERE x.account_id=s.account_id AND x.workspace_id=s.workspace_id AND x.source_device_id=s.device_id AND x.active_lease_epoch=epoch AND (x.audit_sequence=sequence OR x.event_id=(p_event->>'auditEventId'))) THEN why:='sequence_replay';
 ELSIF sealed THEN why:='drain_seal_violation';END IF;
 IF why IS NULL AND payload->>'action'='reactivate_ownership_review' THEN
  IF payload->>'stage'='preflight_satisfied' AND (
   EXISTS(SELECT 1 FROM public.workspace_device_audit_drain_records x WHERE x.account_id=s.account_id AND x.workspace_id=s.workspace_id AND x.quarantine_reason IS NULL
    AND x.signed_event->'payloadRedacted'->>'operationId'=payload->>'operationId' AND x.signed_event->'payloadRedacted'->>'operationItemId'=payload->>'operationItemId' AND x.signed_event->'payloadRedacted'->>'stage'='dispatch_claimed')
   OR EXISTS(SELECT 1 FROM public.execution_fact_drain_records x WHERE x.account_id=s.account_id AND x.workspace_id=s.workspace_id AND x.quarantine_reason IS NULL
    AND x.signed_event->>'operationId'=payload->>'operationId' AND x.signed_event->>'operationItemId'=payload->>'operationItemId')) THEN why:='authorization';
  ELSIF payload->>'stage'='dispatch_claimed' AND EXISTS(SELECT 1 FROM public.workspace_device_audit_drain_records x WHERE x.account_id=s.account_id AND x.workspace_id=s.workspace_id AND x.quarantine_reason IS NULL
    AND x.signed_event->'payloadRedacted'->>'operationId'=payload->>'operationId' AND x.signed_event->'payloadRedacted'->>'operationItemId'=payload->>'operationItemId' AND x.signed_event->'payloadRedacted'->>'stage'='preflight_satisfied') THEN why:='authorization';END IF;
 END IF;
 IF why IS NULL AND bounded_market AND payload->>'stage'<>'approved' THEN
  IF payload->>'stage'='reconciled' THEN
   SELECT x.signed_event,x.envelope_digest INTO original_event,original_digest FROM public.execution_fact_drain_records x
    WHERE x.account_id=s.account_id AND x.workspace_id=s.workspace_id
     AND x.source_device_id=payload->>'originalSourceDeviceId' AND x.active_lease_epoch=(payload->>'originalActiveLeaseEpoch')::bigint
     AND x.event_id=payload->>'originalExecutionFactId' AND x.quarantine_reason IS NULL;
   IF original_event IS NULL THEN p_pending:='ORIGINAL_FACT_MISSING';
   ELSIF original_event->>'eventType' IS DISTINCT FROM market_claim_event
    OR original_event->'payloadRedacted'->'schemaVersion' IS DISTINCT FROM '1'::jsonb
    OR original_event->'payloadRedacted'->>'action' IS DISTINCT FROM payload->>'action'
    OR original_event->'payloadRedacted'->>'provider' IS DISTINCT FROM market_provider
    OR original_event->'operationId' IS DISTINCT FROM payload->'operationId'
    OR original_event->'operationItemId' IS DISTINCT FROM payload->'operationItemId'
    OR original_event->'attemptId' IS DISTINCT FROM payload->'attemptId'
    OR original_event->>'occurredAt'>p_event->>'occurredAt'
    OR rtrim(translate(encode(original_digest,'base64'),E'+/
','-_'),'=') IS DISTINCT FROM payload->>'originalExecutionFactDigest'
    THEN why:='authorization';END IF;
  ELSE
   SELECT x.signed_event INTO original_event FROM public.workspace_device_audit_drain_records x
    WHERE x.account_id=s.account_id AND x.workspace_id=s.workspace_id AND x.source_device_id=s.device_id AND x.active_lease_epoch=epoch
     AND x.quarantine_reason IS NULL
     AND x.signed_event->'payloadRedacted'->>'stage'='approved'
     AND x.signed_event->'payloadRedacted'->>'approvedOperationId'=payload->>'approvedOperationId';
   IF original_event IS NULL THEN p_pending:='APPROVAL_AUDIT_MISSING';
   ELSIF original_event->'payloadRedacted'->'schemaVersion' IS DISTINCT FROM '1'::jsonb
    OR original_event->'payloadRedacted'->>'action' IS DISTINCT FROM payload->>'action'
    OR original_event->'payloadRedacted'->'operationId' IS DISTINCT FROM payload->'operationId'
    OR original_event->'payloadRedacted'->'planHash' IS DISTINCT FROM payload->'planHash'
    OR original_event->>'occurredAt'>p_event->>'occurredAt'
    OR original_event->'credentialEpoch' IS DISTINCT FROM p_event->'credentialEpoch'
    OR original_event->'signingKeyId' IS DISTINCT FROM p_event->'signingKeyId'
    OR original_event->'signingKeyVersion' IS DISTINCT FROM p_event->'signingKeyVersion' THEN why:='authorization';END IF;
   IF EXISTS(SELECT 1 FROM public.workspace_device_audit_drain_records x
     WHERE x.account_id=s.account_id AND x.workspace_id=s.workspace_id AND x.quarantine_reason IS NULL
      AND x.signed_event->'payloadRedacted'->>'operationId'=payload->>'operationId'
      AND x.signed_event->'payloadRedacted'->>'operationItemId'=payload->>'operationItemId'
      AND x.signed_event->'payloadRedacted'->>'stage' IN ('dispatch_claimed','preflight_refused'))
    OR EXISTS(SELECT 1 FROM public.execution_fact_drain_records x
     WHERE x.account_id=s.account_id AND x.workspace_id=s.workspace_id AND x.quarantine_reason IS NULL
      AND x.signed_event->>'operationId'=payload->>'operationId'
      AND x.signed_event->>'operationItemId'=payload->>'operationItemId') THEN why:='authorization';END IF;
  END IF;
 ELSIF why IS NULL AND (payload->>'schemaVersion'='2' OR payload->>'action'='reactivate_ownership_review') AND payload->>'stage'<>'approved' THEN
  IF payload->>'stage' IN ('dispatch_claimed','preflight_refused','preflight_satisfied') THEN
   SELECT x.signed_event INTO original_event FROM public.workspace_device_audit_drain_records x
    WHERE x.account_id=s.account_id AND x.workspace_id=s.workspace_id AND x.source_device_id=s.device_id AND x.active_lease_epoch=epoch AND x.quarantine_reason IS NULL
     AND x.signed_event->'payloadRedacted'->>'stage'='approved' AND x.signed_event->'payloadRedacted'->>'approvedOperationId'=payload->>'approvedOperationId';
   IF original_event IS NULL THEN p_pending:='APPROVAL_AUDIT_MISSING';
   ELSIF original_event->'payloadRedacted'->'schemaVersion' IS DISTINCT FROM '2'::jsonb
    OR original_event->'payloadRedacted'->>'action' IS DISTINCT FROM 'listing_plan_v2'
    OR original_event->'payloadRedacted'->'operationId' IS DISTINCT FROM payload->'operationId'
    OR original_event->'payloadRedacted'->'planHash' IS DISTINCT FROM payload->'planHash'
    OR original_event->>'occurredAt'>p_event->>'occurredAt'
    OR original_event->'credentialEpoch' IS DISTINCT FROM p_event->'credentialEpoch'
    OR original_event->'signingKeyId' IS DISTINCT FROM p_event->'signingKeyId'
    OR original_event->'signingKeyVersion' IS DISTINCT FROM p_event->'signingKeyVersion' THEN why:='authorization';END IF;
   -- Preflight summaries carry no item envelope/target set. Membership is checked by Host;
   -- Cloud authenticates the batch linkage and cannot turn this summary into a claim.
  ELSE
   SELECT x.signed_event INTO original_event FROM public.execution_fact_drain_records x
    WHERE x.account_id=s.account_id AND x.workspace_id=s.workspace_id AND x.source_device_id=s.device_id AND x.quarantine_reason IS NULL
     AND x.event_id=payload->>'originalExecutionFactId';
   IF original_event IS NULL THEN p_pending:='ORIGINAL_FACT_MISSING';
   ELSIF original_event->'payloadRedacted'->'schemaVersion' IS DISTINCT FROM payload->'schemaVersion'
    OR original_event->'payloadRedacted'->'action' IS DISTINCT FROM payload->'action'
    OR original_event->'operationId' IS DISTINCT FROM payload->'operationId'
    OR original_event->'operationItemId' IS DISTINCT FROM payload->'operationItemId'
    OR original_event->'attemptId' IS DISTINCT FROM payload->'attemptId'
    OR original_event->>'occurredAt'>p_event->>'occurredAt'
    OR NOT EXISTS(SELECT 1 FROM public.execution_fact_drain_records x WHERE x.account_id=s.account_id AND x.workspace_id=s.workspace_id AND x.source_device_id=s.device_id
      AND x.event_id=payload->>'originalExecutionFactId' AND rtrim(translate(encode(x.envelope_digest,'base64'),E'+/\n','-_'),'=')=payload->>'originalExecutionFactDigest') THEN why:='authorization';END IF;
  END IF;
 END IF;
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
