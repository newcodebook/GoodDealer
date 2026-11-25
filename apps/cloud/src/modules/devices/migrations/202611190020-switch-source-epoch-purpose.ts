import type { CloudMigration } from "../../../db/index";

/** A first-device bootstrap has no source Lease; the CAS applies only to normal handoffs. */
export const switchSourceEpochPurposeMigration: CloudMigration = {
  id: "202611190020-switch-source-epoch-purpose",
  owner: "devices",
  sql: `
CREATE OR REPLACE FUNCTION public.device_switch_source_epoch_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $function$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.source_lease_epoch IS DISTINCT FROM OLD.source_lease_epoch THEN RAISE EXCEPTION 'original switch epoch is immutable' USING ERRCODE='55000';END IF;
  RETURN NEW;
 END IF;
 IF NEW.purpose='device_switch' AND NEW.mode='normal' THEN
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
 ELSIF NEW.source_lease_epoch IS NOT NULL THEN
  RAISE EXCEPTION 'source epoch applies only to normal device switches' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END;
$function$;
ALTER FUNCTION public.device_switch_source_epoch_guard() OWNER TO gooddealer_cloud_owner;
REVOKE ALL ON FUNCTION public.device_switch_source_epoch_guard() FROM PUBLIC;
`,
};
