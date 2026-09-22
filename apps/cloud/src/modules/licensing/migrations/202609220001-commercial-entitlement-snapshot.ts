import type { CloudMigration } from "../../../db/index";

/** Adds the entitlement read façade without rewriting the already-applied commercial migration. */
export const commercialEntitlementSnapshotMigration: CloudMigration = {
  id: "202609220001-commercial-entitlement-snapshot",
  owner: "licensing",
  sql: `
    SET LOCAL ROLE gd_licensing_owner;
    GRANT CREATE ON SCHEMA licensing_api TO gd_licensing_command_definer;
    SET LOCAL ROLE gd_licensing_command_definer;
    CREATE FUNCTION licensing_api.read_authoritative_entitlement_snapshot()
      RETURNS TABLE(source_event_id text,source_revision bigint,occurred_at timestamptz,state text,
        license_id text,plan text,entitlement_kind text,commercial_expires_at timestamptz,
        offline_grace_until timestamptz,credential_refresh_due_at timestamptz,
        feature_entitlements text[],trusted_now timestamptz)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,licensing_private SET row_security=on AS $f$
    DECLARE a text; BEGIN a:=coalesce(identity_private.current_transaction_account('devices_account'),
      identity_private.current_transaction_account('identity_account'));
      IF a IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='account transaction capability is unavailable'; END IF;
      RETURN QUERY SELECT p.right_id::text,p.authority_revision,p.updated_at,p.state,p.right_id::text,
        p.plan,p.purchase_kind,p.commercial_expires_at,p.commercial_expires_at,p.commercial_expires_at,
        p.feature_entitlements,clock_timestamp()
        FROM licensing_private.account_entitlement_projections p WHERE p.account_id=a FOR UPDATE;
    END $f$;
    ALTER FUNCTION licensing_api.read_authoritative_entitlement_snapshot() OWNER TO gd_licensing_command_definer;
    SET LOCAL ROLE gd_licensing_owner;
    REVOKE CREATE ON SCHEMA licensing_api FROM gd_licensing_command_definer;
    RESET ROLE;
  `,
};
