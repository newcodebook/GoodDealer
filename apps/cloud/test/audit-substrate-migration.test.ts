import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { serverAuditSubstrateMigration } from "../src/modules/audit/migrations/202608200013-server-audit-substrate";

describe("catalog-integrated M013 server audit substrate", () => {
  it("is module-owned, append-only, RLS-forced, and unavailable to direct app-role DML", () => {
    const { sql } = serverAuditSubstrateMigration;
    expect(serverAuditSubstrateMigration).toMatchObject({
      id: "202608200013-server-audit-substrate",
      owner: "audit",
    });
    for (const relation of ["server_audit_entries", "server_audit_heads", "server_audit_quarantines", "server_audit_transition_edges"]) {
      expect(sql).toContain(`ALTER TABLE public.${relation} ENABLE ROW LEVEL SECURITY`);
      expect(sql).toContain(`ALTER TABLE public.${relation} FORCE ROW LEVEL SECURITY`);
    }
    expect(sql).toContain("CREATE TRIGGER server_audit_entries_immutable");
    expect(sql).toContain("CREATE TRIGGER server_audit_quarantines_immutable");
    expect(sql).toContain("REVOKE ALL PRIVILEGES ON TABLE public.server_audit_entries");
    expect(sql).toContain("gooddealer_cloud_app");
    expect(sql).toContain("SECURITY DEFINER");
    expect(sql).toContain("SET search_path = pg_catalog, public");
    expect(sql).toContain("audit_append_server_user_entry");
    expect(sql).toContain("audit_append_server_staff_entry");
    expect(sql).toContain("audit_append_server_service_entry");
    expect(sql).toContain("CREATE FUNCTION public.audit_prepare_server_audit_append");
    expect(sql).toContain("v_occurred_at := pg_catalog.date_trunc('second', pg_catalog.transaction_timestamp())");
    expect(sql).toContain("p_entry->>'occurredAt' IS DISTINCT FROM v_occurred_at_canonical");
    expect(sql).not.toContain("v_occurred_at := (p_entry->>'occurredAt')");
    expect(sql).not.toMatch(/GRANT\s+(?:ALL|INSERT|UPDATE|DELETE)\s+ON\s+TABLE[\s\S]*gooddealer_cloud_app/iu);
    expect(sql).not.toMatch(/ON\s+CONFLICT[\s\S]{0,80}DO\s+UPDATE/iu);
  });

  it("keeps quarantine digest-only and refuses raw body, key, or secret retention", () => {
    const { sql } = serverAuditSubstrateMigration;
    const quarantineDefinition = sql.slice(
      sql.indexOf("CREATE TABLE public.server_audit_quarantines"),
      sql.indexOf("CREATE TABLE public.server_audit_transition_edges"),
    );
    expect(sql).toContain("CREATE TABLE public.server_audit_quarantines");
    expect(sql).toContain("candidate_digest bytea NOT NULL");
    expect(sql).toContain("rejection_code text NOT NULL");
    expect(sql).toContain("CREATE FUNCTION public.audit_quarantine_server_entry");
    expect(quarantineDefinition).not.toMatch(/(?:payload|body|secret|public_key|private_key)/iu);
  });

  it("binds an existing chain head to the signed entry domain before advancing it", () => {
    const { sql } = serverAuditSubstrateMigration;
    const appendRoutine = sql.slice(
      sql.indexOf("CREATE FUNCTION public.audit_append_server_entry_verified"),
      sql.indexOf("ALTER FUNCTION public.audit_append_server_entry_verified"),
    );

    expect(appendRoutine).toContain(
      "SELECT audit_sequence, event_hash, tenant_scope, account_id, workspace_id, actor_id, audit_event_kind",
    );
    for (const [stored, signed] of [
      ["v_head_tenant_scope", "tenantScope"],
      ["v_head_account_id", "accountId"],
      ["v_head_workspace_id", "workspaceId"],
      ["v_head_actor_id", "actorId"],
      ["v_head_audit_event_kind", "auditEventKind"],
    ] as const) {
      expect(appendRoutine).toContain(`${stored} IS DISTINCT FROM p_entry->>'${signed}'`);
    }
    expect(appendRoutine).toContain("server audit head domain or compare-and-set conflict");
  });

  it("does not publish a signer, verifier, journal, head, or transition lookup from the audit entrypoint", () => {
    const source = readFileSync(new URL("../src/modules/audit/index.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/DenyingProductionAuditSigner|ServerAuditSigningAuthority|ServerAuditAppendJournal|AuditChainHead|TransitionLookup/u);
    expect(source).toContain("SecurityAuditPort");
    expect(source).not.toContain("SecurityAuditEvent");
  });

  it("makes no hosted-PostgreSQL, signer-custody, release, or Gate qualification claim", () => {
    expect(serverAuditSubstrateMigration.sql).not.toMatch(/PostgreSQL\s*18\.6|production ready|release approval|Gate closure/iu);
  });
});
