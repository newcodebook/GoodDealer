import type { CloudMigration } from "../../../db/index";

/** Historical renewals overwrote envelopes. Unknown history needs a full conservative drain window. */
export const leaseIssuedOfflineHighWaterMigration: CloudMigration = {
  id: "202611190026-lease-issued-offline-high-water", owner: "devices", sql: `
LOCK TABLE public.device_account_states, public.device_active_leases IN ACCESS EXCLUSIVE MODE;
ALTER TABLE public.device_active_leases ADD COLUMN max_issued_offline_execute_until timestamptz;
DO $backfill$
DECLARE v_cutover timestamptz := clock_timestamp();
BEGIN
 UPDATE public.device_active_leases SET max_issued_offline_execute_until=
   greatest(offline_execute_until,v_cutover+interval '24 hours');
 -- A label alone cannot prove that the old Native stopped. Require the same durable facts
 -- used for the normal-handoff receipt, including the exact consumed proof and target capability.
 UPDATE public.device_account_states s SET exclusive_execution_block_until=greatest(
   s.exclusive_execution_block_until, unsafe.maximum), updated_at=clock_timestamp()
 FROM (
  SELECT l.account_id,max(l.max_issued_offline_execute_until) AS maximum
  FROM public.device_active_leases l WHERE l.released_at IS NOT NULL AND NOT (
   l.release_reason='normal_handoff' AND (
    SELECT count(*)=1 AND bool_and(
     w.mode='normal' AND w.purpose='device_switch' AND w.from_device_id<>w.to_device_id
     AND w.from_device_id=l.device_id AND p.source_device_id=l.device_id
     AND p.purpose='handoff' AND p.accepted_at=p.consumed_at AND p.consumed_at=l.released_at
     AND p.consumed_transaction_id IS NOT NULL AND p.issued_at<=p.consumed_at
     AND p.verified_at<=p.consumed_at AND p.consumed_at<p.expires_at
     AND l.issued_at<=l.released_at AND w.created_at<=p.consumed_at
     AND c.target_device_id=w.to_device_id AND c.issued_at=p.consumed_at)
    FROM public.device_drain_proofs p
    JOIN public.device_switch_workflows w USING(account_id,workspace_id,workflow_id)
    JOIN public.device_bootstrap_capabilities c USING(account_id,workspace_id,workflow_id)
    WHERE p.account_id=l.account_id AND p.active_lease_epoch=l.lease_epoch
     AND p.consumed_at IS NOT NULL
   ) IS TRUE)
  GROUP BY l.account_id
 ) unsafe WHERE s.account_id=unsafe.account_id;
END;
$backfill$;
ALTER TABLE public.device_active_leases ALTER COLUMN max_issued_offline_execute_until SET NOT NULL;
ALTER TABLE public.device_active_leases ADD CONSTRAINT device_lease_offline_high_water
 CHECK(max_issued_offline_execute_until>=offline_execute_until);
CREATE FUNCTION public.device_lease_offline_high_water_guard() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog AS $function$
BEGIN
 IF TG_OP='INSERT' THEN
  NEW.max_issued_offline_execute_until := greatest(NEW.max_issued_offline_execute_until,NEW.offline_execute_until);
 ELSE
  NEW.max_issued_offline_execute_until := greatest(OLD.max_issued_offline_execute_until,NEW.max_issued_offline_execute_until,NEW.offline_execute_until);
 END IF;
 RETURN NEW;
END;
$function$;
ALTER FUNCTION public.device_lease_offline_high_water_guard() OWNER TO gooddealer_cloud_owner;
REVOKE ALL ON FUNCTION public.device_lease_offline_high_water_guard() FROM PUBLIC;
CREATE TRIGGER device_lease_offline_high_water_guard BEFORE INSERT OR UPDATE
 ON public.device_active_leases FOR EACH ROW EXECUTE FUNCTION public.device_lease_offline_high_water_guard();
` };
