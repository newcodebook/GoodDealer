import type { CloudMigration } from "../../../db/index";

/** A fixed-purpose projection of the already consumed M019 credential, with live deadline checks. */
export const executionContextDeviceMigration: CloudMigration = {
  id: "202611190003-execution-context-device", owner: "identity",
  sql: `
SET LOCAL ROLE gd_identity_owner;
GRANT CREATE ON SCHEMA identity_private TO gd_identity_definer;
GRANT USAGE ON TYPE identity_private.transaction_capability_purpose TO gd_identity_definer;
RESET ROLE;
SET LOCAL ROLE gd_identity_definer;
CREATE FUNCTION identity_private.current_execution_context_device()
 RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on
 RETURN (
  SELECT s.device_id FROM identity_private.account_transaction_capabilities c
  JOIN public.identity_auth_sessions s ON s.account_id=c.account_id AND s.session_id=c.identity_session_id
  JOIN public.identity_credential_jtis j ON j.account_id=c.account_id AND j.session_id=c.identity_session_id
    AND j.jti=encode(c.credential_digest,'hex') AND j.kind='access'
  JOIN public.identity_refresh_families f ON f.account_id=j.account_id AND f.session_id=j.session_id AND f.family_id=j.family_id
  WHERE c.account_id=identity_private.current_transaction_account('devices_account'::identity_private.transaction_capability_purpose)
    AND c.purpose='devices_account' AND c.state='consumed' AND c.audience='account_api' AND c.credential_kind='access'
    AND c.target_backend_pid=pg_backend_pid() AND c.target_transaction_id=pg_current_xact_id()
    AND c.expires_at>clock_timestamp() AND s.client_kind='desktop' AND s.device_id IS NOT NULL
    AND s.revoked_at IS NULL AND (s.expires_at IS NULL OR s.expires_at>clock_timestamp())
    AND j.state='active' AND j.expires_at>clock_timestamp() AND f.state='active'
 );
REVOKE ALL ON FUNCTION identity_private.current_execution_context_device() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION identity_private.current_execution_context_device() TO gooddealer_cloud_owner;
RESET ROLE;
SET LOCAL ROLE gd_identity_owner;
REVOKE CREATE ON SCHEMA identity_private FROM gd_identity_definer;
RESET ROLE;
`,
};
