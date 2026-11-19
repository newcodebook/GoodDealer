import type { CloudMigration } from "../../../db/index";

/** Legacy requests retain an unknown epoch; new normal requests bind a real current source Lease. */
export const switchRequestSourceEpochMigration: CloudMigration = {
 id:"202611190019-switch-request-source-epoch",owner:"devices",sql:`
ALTER TABLE public.device_switch_workflows ADD COLUMN source_lease_epoch bigint CHECK(source_lease_epoch BETWEEN 1 AND 9007199254740991);
CREATE FUNCTION public.device_switch_source_epoch_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $function$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.source_lease_epoch IS DISTINCT FROM OLD.source_lease_epoch THEN RAISE EXCEPTION 'original switch epoch is immutable' USING ERRCODE='55000';END IF;
  RETURN NEW;
 END IF;
 IF NEW.mode='normal' THEN
  -- Only owner maintenance/legacy fixtures may insert unknown history. The runtime has no old
  -- request writer and cannot turn a delayed first POST into a new-epoch intent.
  IF NEW.source_lease_epoch IS NULL THEN
   IF CURRENT_USER<>'gooddealer_cloud_owner' THEN RAISE EXCEPTION 'switch source epoch is required' USING ERRCODE='42501';END IF;
  ELSE
   PERFORM 1 FROM public.device_account_states s JOIN public.device_active_leases l ON l.account_id=s.account_id AND l.lease_epoch=s.current_lease_epoch
   WHERE s.account_id=NEW.account_id AND s.current_lease_epoch=NEW.source_lease_epoch AND l.device_id=NEW.from_device_id
    AND l.released_at IS NULL AND clock_timestamp()>=l.issued_at AND clock_timestamp()<l.online_expires_at FOR SHARE OF s,l;
   IF NOT FOUND THEN RAISE EXCEPTION 'switch source epoch changed' USING ERRCODE='42501';END IF;
  END IF;
 END IF;
 RETURN NEW;
END;
$function$;
ALTER FUNCTION public.device_switch_source_epoch_guard() OWNER TO gooddealer_cloud_owner;
REVOKE ALL ON FUNCTION public.device_switch_source_epoch_guard() FROM PUBLIC;
CREATE TRIGGER device_switch_source_epoch_guard BEFORE INSERT OR UPDATE ON public.device_switch_workflows FOR EACH ROW EXECUTE FUNCTION public.device_switch_source_epoch_guard();
`};
