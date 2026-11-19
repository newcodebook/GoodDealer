import type { CloudMigration } from "../../../db/index";

/** The Desktop window belongs to Identity and is consumed only by its authenticated transaction. */
export const desktopForcedReauthenticationMigration: CloudMigration = {
  id: "202611190025-desktop-forced-reauth", owner: "identity", sql: `
ALTER TABLE public.identity_desktop_authorization_codes ADD COLUMN forced_reauth_until timestamptz;
ALTER TABLE public.identity_auth_sessions
 ADD COLUMN forced_reauth_until timestamptz,
 ADD COLUMN forced_reauth_consumed_at timestamptz,
 ADD CONSTRAINT identity_forced_reauth_shape CHECK (
   (forced_reauth_until IS NULL AND forced_reauth_consumed_at IS NULL)
   OR (client_kind='desktop' AND auth_method='oauth_pkce' AND forced_reauth_until IS NOT NULL
     AND (forced_reauth_consumed_at IS NULL OR forced_reauth_consumed_at < forced_reauth_until)));
GRANT SELECT (auth_method, forced_reauth_until, forced_reauth_consumed_at) ON public.identity_auth_sessions TO gd_identity_definer;
GRANT UPDATE (forced_reauth_consumed_at) ON public.identity_auth_sessions TO gd_identity_definer;
CREATE POLICY identity_forced_reauth_consumption ON public.identity_auth_sessions FOR UPDATE
 TO gd_identity_definer USING (true) WITH CHECK (true);
SET LOCAL ROLE gd_identity_owner;
GRANT CREATE ON SCHEMA identity_private TO gd_identity_definer;
RESET ROLE;
SET LOCAL ROLE gd_identity_definer;
CREATE FUNCTION identity_private.forced_takeover_reauthentication(p_consume boolean)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog SET row_security=on AS $function$
DECLARE v_account text; v_session text; v_until timestamptz;
BEGIN
 IF CURRENT_USER <> 'gd_identity_definer' THEN RAISE EXCEPTION 'identity authority denied' USING ERRCODE='42501'; END IF;
 v_account := identity_private.current_transaction_account('devices_account'::identity_private.transaction_capability_purpose);
 IF v_account IS NULL THEN RETURN NULL; END IF;
 SELECT identity_session_id INTO v_session FROM identity_private.account_transaction_capabilities
 WHERE account_id=v_account AND purpose='devices_account' AND state='consumed'
  AND target_backend_pid=pg_backend_pid() AND target_transaction_id=pg_current_xact_id();
 SELECT forced_reauth_until INTO v_until FROM public.identity_auth_sessions
 WHERE account_id=v_account AND session_id=v_session AND client_kind='desktop' AND auth_method='oauth_pkce'
  AND forced_reauth_consumed_at IS NULL AND forced_reauth_until>clock_timestamp()
 FOR UPDATE;
 IF v_until IS NULL THEN RETURN NULL; END IF;
 IF p_consume THEN
  UPDATE public.identity_auth_sessions SET forced_reauth_consumed_at=clock_timestamp()
   WHERE account_id=v_account AND session_id=v_session AND forced_reauth_until>clock_timestamp();
  IF NOT FOUND THEN RETURN NULL; END IF;
 END IF;
 RETURN v_until;
END;
$function$;
REVOKE ALL ON FUNCTION identity_private.forced_takeover_reauthentication(boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION identity_private.forced_takeover_reauthentication(boolean) TO gd_account_api;
RESET ROLE;
SET LOCAL ROLE gd_identity_owner;
REVOKE CREATE ON SCHEMA identity_private FROM gd_identity_definer;
RESET ROLE;
` };
