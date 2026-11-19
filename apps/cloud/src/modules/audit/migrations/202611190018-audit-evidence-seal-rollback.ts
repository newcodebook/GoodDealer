import type { CloudMigration } from "../../../db/index";

/** Exact receipts remain idempotent; rejected first seals roll back their derived placeholders. */
export const auditEvidenceSealRollbackMigration: CloudMigration = {id:"202611190018-audit-evidence-seal-rollback",owner:"audit",sql:`
CREATE OR REPLACE FUNCTION public.audit_install_workspace_device_drain_seal(p_proof_id text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $function$
DECLARE proof record;
BEGIN
 SELECT * INTO proof FROM public.device_read_just_consumed_drain_proof(p_proof_id);
 IF NOT FOUND THEN RETURN false;END IF;
 BEGIN
 PERFORM * FROM public.audit_recompute_workspace_device_drain_head(proof.source_device_id,proof.active_lease_epoch);
 -- An accepted seal is immutable. New rejections cannot roll it back; prior verified violations block a first seal.
 IF NOT EXISTS(SELECT 1 FROM public.workspace_device_audit_drain_seals x WHERE x.account_id=current_setting('gooddealer.account_id',true) AND x.workspace_id=current_setting('gooddealer.workspace_id',true) AND x.source_device_id=proof.source_device_id AND x.active_lease_epoch=proof.active_lease_epoch)
 AND EXISTS(SELECT 1 FROM public.audit_execution_evidence_quarantines x WHERE x.account_id=current_setting('gooddealer.account_id',true) AND x.workspace_id=current_setting('gooddealer.workspace_id',true) AND x.source_device_id=proof.source_device_id AND x.active_lease_epoch=proof.active_lease_epoch AND x.domain_blocking) THEN RAISE EXCEPTION 'verified execution violation blocks seal' USING ERRCODE='GD021';END IF;
 IF NOT public.audit_install_workspace_device_drain_seal_before_evidence(p_proof_id) THEN RAISE EXCEPTION 'execution seal rejected' USING ERRCODE='GD021';END IF;
 RETURN true;
 EXCEPTION WHEN SQLSTATE 'GD021' THEN RETURN false;
 END;
END;
$function$;
`};
