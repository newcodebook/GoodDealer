import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { identityTransactionCapabilityMigration } from "../src/modules/identity/migrations/202608200019-transaction-capability";
import { accountDefaultWorkspaceCapabilityPolicyMigration } from "../src/modules/workspace/default-workspace/migrations/202609220002-account-default-workspace-capability-policy";

describe("Identity transaction capability migration", () => {
  const sql = `${identityTransactionCapabilityMigration.sql}\n${accountDefaultWorkspaceCapabilityPolicyMigration.sql}`;
  const provisioning = readFileSync(
    new URL("../scripts/provision-identity-capability-roles.sql", import.meta.url),
    "utf8",
  );

  it("derives authority from an opaque credential without an account or session selector argument", () => {
    const issue = sql.slice(
      sql.indexOf("CREATE FUNCTION identity_private.issue_transaction_capability("),
      sql.indexOf(") RETURNS bytea", sql.indexOf("CREATE FUNCTION identity_private.issue_transaction_capability(")),
    );
    expect(issue).toContain("p_session_credential bytea");
    expect(issue).toContain("p_target_backend_pid integer");
    expect(issue).toContain("p_target_transaction_id xid8");
    expect(issue).not.toMatch(/p_(?:account|principal|session_id|workspace|tenant)_/u);
    expect(sql).toContain("session.session_credential_digest = pg_catalog.sha256(");
    expect(sql).toContain("credential.jti = pg_catalog.encode(pg_catalog.sha256(p_session_credential), 'hex')");
    expect(sql).toContain("credential.kind = 'refresh' AND credential.state = 'current'");
    expect(sql).toContain("family.current_refresh_jti = credential.jti");
    expect(sql).toContain("current_family.current_refresh_jti = credential.jti");
    expect(sql).not.toContain("credential.kind = 'refresh' AND credential.state = 'rotated'");
  });

  it("binds one-use authority to PID, xid8, nonce, purpose, live session, and security epoch", () => {
    expect(sql).toContain("UNIQUE (target_backend_pid, target_transaction_id, audience)");
    expect(sql).toContain("v_capability.target_backend_pid <> pg_catalog.pg_backend_pid()");
    expect(sql).toContain("v_capability.target_transaction_id <> pg_catalog.pg_current_xact_id()");
    expect(sql).toContain("v_capability.request_nonce_digest <> pg_catalog.sha256(p_request_nonce)");
    expect(sql).toContain("v_capability.purpose <> p_purpose");
    expect(sql).toContain("security.account_security_epoch = capability.issued_session_security_epoch");
    expect(sql).toContain("SET state = 'consumed', consumed_at = pg_catalog.transaction_timestamp()");
  });

  it("requires externally provisioned least-privilege roles and exposes only narrow routines", () => {
    expect(sql).not.toMatch(/CREATE ROLE/u);
    expect(sql).toContain("required externally provisioned role is missing");
    expect(sql).toContain("runtime role crosses an Identity or provider trust boundary");
    expect(sql).toContain("migration role must not inherit Identity owner privileges");
    expect(sql).toContain("ALTER TABLE identity_private.account_transaction_capabilities FORCE ROW LEVEL SECURITY");
    expect(sql).toContain("REVOKE ALL ON FUNCTION identity_private.issue_transaction_capability(");
    expect(sql).toContain("TO gd_identity_capability_issuer");
    expect(sql).toContain("TO gd_account_api");
    expect(sql).toContain("TO gd_licensing_command_definer");
    expect(sql).not.toMatch(/GRANT[^;]+TO gooddealer_cloud_app/gu);
    expect(sql).toContain("'gd_provider_ingress'");
    expect(sql).toContain("'gd_provider_worker'");
    expect(sql).toContain("AS RESTRICTIVE TO gd_account_api");
    expect(sql).toContain("workspace_account_bindings_default_owner_capability_select");
    expect(sql).toContain("TO gd_account_api");
    expect(sql).toContain("IN ('devices_account', 'workspace_tenant')");
    expect(sql).toContain("role = 'default_owner'");
    expect(sql).toContain(
      "GRANT TRUNCATE ON identity_private.account_transaction_capabilities TO gooddealer_cloud_owner",
    );
    expect(sql).toContain("gooddealer_cloud_owner;");
    const createSchema = sql.indexOf("CREATE SCHEMA identity_private;");
    const transferSchema = sql.indexOf("ALTER SCHEMA identity_private OWNER TO gd_identity_owner;");
    expect(createSchema).toBeGreaterThan(-1);
    expect(transferSchema).toBeGreaterThan(createSchema);
    expect(sql).not.toContain("CREATE SCHEMA identity_private AUTHORIZATION gd_identity_owner");
    expect(sql).toContain("REVOKE CREATE ON DATABASE %I FROM gd_identity_owner");
  });

  it("keeps commercial purposes closed and exports only the exact typed helper", () => {
    for (const purpose of [
      "billing_read",
      "purchase_reserve",
      "cancellation_request",
      "refund_request",
      "fixed_term_capture",
      "billing_approval_redirect",
    ]) {
      expect(sql).toContain(`'${purpose}'`);
    }
    expect(sql).toContain(
      `GRANT EXECUTE ON FUNCTION identity_private.current_transaction_account(
      identity_private.transaction_capability_purpose
    ) TO gd_licensing_command_definer`,
    );
    expect(sql).toContain("REVOKE ALL ON TYPE identity_private.transaction_capability_purpose FROM PUBLIC");
    expect(sql).toContain(
      "TO gd_identity_capability_issuer, gd_account_api, gd_licensing_command_definer",
    );
    expect(sql).not.toContain(
      `GRANT EXECUTE ON FUNCTION identity_private.current_transaction_account(
      identity_private.transaction_capability_purpose
    ) TO gd_account_api`,
    );
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION identity_private.current_transaction_account() TO gd_account_api");
  });

  it("provisions isolated runtime logins and non-login owners without repository passwords", () => {
    for (const role of [
      "gd_identity_owner",
      "gd_identity_definer",
      "gd_licensing_owner",
      "gd_licensing_command_definer",
      "gd_licensing_worker_definer",
      "gd_licensing_ingress_definer",
    ]) {
      expect(provisioning).toContain(`ALTER ROLE ${role} NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION`);
    }
    for (const role of [
      "gd_identity_capability_issuer",
      "gd_account_api",
      "gd_provider_ingress",
      "gd_provider_worker",
    ]) {
      expect(provisioning).toContain(`ALTER ROLE ${role} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION`);
    }
    expect(provisioning).toContain("WITH INHERIT FALSE, SET TRUE");
    expect(provisioning).not.toMatch(/ALTER ROLE[^;]*PASSWORD/iu);
  });
});
