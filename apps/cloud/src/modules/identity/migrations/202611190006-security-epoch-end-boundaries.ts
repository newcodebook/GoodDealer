import type { CloudMigration } from "../../../db/index";

/** Historical execution uses actual security transitions; updated_at is never an inferred boundary. */
export const securityEpochEndBoundariesMigration: CloudMigration = {
 id:"202611190006-security-epoch-end-boundaries",owner:"identity",sql:`
GRANT USAGE ON SCHEMA public TO gd_identity_owner;
GRANT REFERENCES(account_id) ON public.identity_account_security_states TO gd_identity_owner;
SET LOCAL ROLE gd_identity_owner;
CREATE TABLE identity_private.security_epoch_end_boundaries(
 account_id text NOT NULL,account_security_epoch bigint NOT NULL CHECK(account_security_epoch BETWEEN 1 AND 9007199254740991),
 ended_at timestamptz NOT NULL,successor_epoch bigint NOT NULL,old_status text NOT NULL,new_status text NOT NULL,
 FOREIGN KEY(account_id) REFERENCES public.identity_account_security_states(account_id),
 PRIMARY KEY(account_id,account_security_epoch),CHECK(successor_epoch>=account_security_epoch)
);
ALTER TABLE identity_private.security_epoch_end_boundaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_private.security_epoch_end_boundaries FORCE ROW LEVEL SECURITY;
CREATE POLICY security_epoch_end_boundary_definer ON identity_private.security_epoch_end_boundaries TO gd_identity_definer USING(true) WITH CHECK(true);
GRANT SELECT,INSERT ON identity_private.security_epoch_end_boundaries TO gd_identity_definer;
GRANT CREATE ON SCHEMA identity_private TO gd_identity_definer;
RESET ROLE;
SET LOCAL ROLE gd_identity_definer;
CREATE FUNCTION identity_private.capture_security_epoch_end() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog SET row_security=on AS $function$
BEGIN
 IF NEW.account_security_epoch<OLD.account_security_epoch OR (OLD.status<>'normal' AND NEW.status='normal' AND NEW.account_security_epoch=OLD.account_security_epoch) THEN
  RAISE EXCEPTION 'security authority cannot reopen an ended epoch' USING ERRCODE='42501';
 END IF;
 IF NEW.account_security_epoch<>OLD.account_security_epoch OR (OLD.status='normal' AND NEW.status<>'normal') THEN
  INSERT INTO identity_private.security_epoch_end_boundaries(account_id,account_security_epoch,ended_at,successor_epoch,old_status,new_status)
  VALUES(OLD.account_id,OLD.account_security_epoch,clock_timestamp(),NEW.account_security_epoch,OLD.status,NEW.status)
  ON CONFLICT(account_id,account_security_epoch) DO NOTHING;
 END IF;
 RETURN NEW;
END;
$function$;
CREATE FUNCTION identity_private.reject_security_epoch_end_change() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $function$
BEGIN RAISE EXCEPTION 'security epoch end evidence is immutable' USING ERRCODE='55000'; END;
$function$;
CREATE FUNCTION identity_private.read_execution_security_epoch_end(p_epoch bigint)
 RETURNS TABLE(proven boolean,ended_at timestamptz) LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on
 AS $function$ SELECT (b.account_id IS NOT NULL OR (s.account_security_epoch=p_epoch AND s.status='normal')),
 b.ended_at FROM public.identity_account_security_states s LEFT JOIN identity_private.security_epoch_end_boundaries b
 ON b.account_id=s.account_id AND b.account_security_epoch=p_epoch
 WHERE s.account_id=identity_private.current_transaction_account('devices_account'::identity_private.transaction_capability_purpose)
 AND identity_private.current_execution_context_device() IS NOT NULL $function$;
REVOKE ALL ON FUNCTION identity_private.capture_security_epoch_end() FROM PUBLIC;
REVOKE ALL ON FUNCTION identity_private.reject_security_epoch_end_change() FROM PUBLIC;
REVOKE ALL ON FUNCTION identity_private.read_execution_security_epoch_end(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION identity_private.read_execution_security_epoch_end(bigint) TO gd_account_api;
GRANT EXECUTE ON FUNCTION identity_private.reject_security_epoch_end_change() TO gd_identity_owner;
GRANT EXECUTE ON FUNCTION identity_private.capture_security_epoch_end() TO gooddealer_cloud_owner;
GRANT EXECUTE ON FUNCTION identity_private.current_execution_context_device() TO gd_account_api;
RESET ROLE;
CREATE TRIGGER identity_security_epoch_end BEFORE UPDATE ON public.identity_account_security_states
 FOR EACH ROW EXECUTE FUNCTION identity_private.capture_security_epoch_end();
SET LOCAL ROLE gd_identity_owner;
CREATE TRIGGER security_epoch_end_immutable BEFORE UPDATE OR DELETE ON identity_private.security_epoch_end_boundaries
 FOR EACH ROW EXECUTE FUNCTION identity_private.reject_security_epoch_end_change();
REVOKE CREATE ON SCHEMA identity_private FROM gd_identity_definer;
GRANT TRUNCATE ON identity_private.security_epoch_end_boundaries TO gooddealer_cloud_owner;
RESET ROLE;
`};
