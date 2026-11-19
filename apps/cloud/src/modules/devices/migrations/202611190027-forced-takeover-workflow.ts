import type { CloudMigration } from "../../../db/index";

export const forcedTakeoverWorkflowMigration: CloudMigration = {
 id: "202611190027-forced-takeover-workflow", owner: "devices", sql: `
ALTER TABLE public.device_switch_workflows ADD COLUMN earliest_takeover_at timestamptz;
-- No production forced writer existed. Unknown legacy forced rows are terminal history and
-- cannot be treated as a fresh approval or guessed source epoch.
UPDATE public.device_switch_workflows SET status='failed',pending_lease_epoch=NULL,
 workflow_revision=workflow_revision+1 WHERE mode='forced' AND status IN ('requested','draining','waiting_expiry');
CREATE OR REPLACE FUNCTION public.device_switch_source_epoch_guard() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,public AS $function$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.source_lease_epoch IS DISTINCT FROM OLD.source_lease_epoch OR NEW.from_device_id IS DISTINCT FROM OLD.from_device_id
   OR NEW.to_device_id IS DISTINCT FROM OLD.to_device_id OR NEW.mode IS DISTINCT FROM OLD.mode THEN
   RAISE EXCEPTION 'original switch identity is immutable' USING ERRCODE='55000'; END IF;
  IF OLD.mode='forced' AND OLD.earliest_takeover_at IS NOT NULL AND
    (NEW.earliest_takeover_at IS NULL OR NEW.earliest_takeover_at<OLD.earliest_takeover_at) THEN
   RAISE EXCEPTION 'forced deadline cannot regress' USING ERRCODE='55000'; END IF;
  RETURN NEW;
 END IF;
 IF NEW.purpose='device_switch' AND NEW.mode IN ('normal','forced') THEN
  IF NEW.source_lease_epoch IS NULL THEN
   IF CURRENT_USER<>'gooddealer_cloud_owner' THEN RAISE EXCEPTION 'switch source epoch is required' USING ERRCODE='42501';END IF;
  ELSE
   PERFORM 1 FROM public.device_account_states s JOIN public.device_active_leases l
    ON l.account_id=s.account_id AND l.lease_epoch=s.current_lease_epoch
   WHERE s.account_id=NEW.account_id AND s.current_lease_epoch=NEW.source_lease_epoch
    AND l.device_id=NEW.from_device_id AND l.released_at IS NULL
    AND (NEW.mode='forced' OR (clock_timestamp()>=l.issued_at AND clock_timestamp()<l.online_expires_at))
   FOR SHARE OF s,l;
   IF NOT FOUND THEN RAISE EXCEPTION 'switch source epoch changed' USING ERRCODE='42501'; END IF;
  END IF;
  IF NEW.mode='forced' AND (NEW.earliest_takeover_at IS NULL OR NEW.status<>'waiting_expiry'
    OR NEW.source_lease_epoch IS NULL OR NEW.from_device_id=NEW.to_device_id
    OR NEW.state_deadline<>NEW.earliest_takeover_at+interval '24 hours') THEN
   RAISE EXCEPTION 'forced switch shape rejected' USING ERRCODE='42501'; END IF;
 ELSIF NEW.source_lease_epoch IS NOT NULL THEN
  RAISE EXCEPTION 'source epoch applies only to device switches' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END;
$function$;
` };
