import { describe, expect, it, vi } from "vitest";

import type { TenantTransaction, TenantTransactionRunner } from "../src/db/index";
import type { WorkspaceRevisionQueryPort } from "../src/modules/workspace/revisions/index";
import { PostgresPortfolioProjectionQuery } from "../src/modules/workspace/state/portfolio/index";
import type { WorkspaceTenantScope } from "../src/modules/workspace/tenant-scope";

const scope = { accountId: "account-a", workspaceId: "workspace-a" } as const;
const stateRow = {
  materialized_through_server_revision: "7",
  materialized_at: "2026-08-20T06:00:00Z",
  projection_availability: "available",
  projection_evidence_status: "confirmed",
};

function assetRow(entityId: string, note: string | null = null) {
  return {
    entity_id: entityId,
    note,
    portfolio_id: null,
    tags: [],
    target_price_currency: null,
    target_price_amount: null,
    materialization_origin: "workspace_sync",
    materialization_version_token: "7",
    materialized_at: "2026-08-20T05:59:59Z",
    projection_availability: "available",
    projection_evidence_status: "confirmed",
  };
}

function harness(options: {
  readonly assets?: readonly unknown[];
  readonly states?: readonly unknown[];
  readonly resolve?: (scope: WorkspaceTenantScope, table: "assets" | "state") => readonly unknown[];
}) {
  const calls: { sql: string; values: readonly unknown[] | undefined }[] = [];
  const transactionOptions: unknown[] = [];
  let transactionCount = 0;
  const transactions = {
    async withTenant<Result>(
      tenantScope: WorkspaceTenantScope,
      operation: (transaction: TenantTransaction) => Promise<Result>,
      settings: unknown,
    ): Promise<Result> {
      transactionCount += 1;
      transactionOptions.push(settings);
      return operation({
        scope: tenantScope,
        async query(sql: string, values?: readonly unknown[]) {
          if (!/^\s*SELECT\b/u.test(sql)) throw new Error("read query attempted a write");
          calls.push({ sql, values });
          const table = sql.includes("workspace_replica_portfolio_state") ? "state" : "assets";
          const rows = options.resolve?.(tenantScope, table)
            ?? (table === "state" ? options.states ?? [stateRow] : options.assets ?? []);
          return { rows: [...rows], rowCount: rows.length, command: "SELECT", oid: 0, fields: [] };
        },
      } as TenantTransaction);
    },
  } as unknown as TenantTransactionRunner;
  const revisions = { read: vi.fn(async () => { throw new Error("revision read must not be mixed into projection"); }) };
  const query = new PostgresPortfolioProjectionQuery({
    transactions,
    revisions: revisions as unknown as WorkspaceRevisionQueryPort,
  });
  return { calls, query, revisions, transactionOptions, transactionCount: () => transactionCount };
}

describe("PostgresPortfolioProjectionQuery", () => {
  it("strictly parses and sorts the frozen response in one dual-key read-only repeatable-read transaction", async () => {
    const test = harness({ assets: [assetRow("b.test"), assetRow("a.test")] });

    await expect(test.query.readPortfolio(scope)).resolves.toEqual({
      schemaVersion: 1,
      assets: ["a.test", "b.test"].map((entityId) => ({
        asset: { entityId, note: null, portfolioId: null, tags: [], targetPrice: null },
        materialization: {
          origin: "workspace_sync",
          versionToken: "7",
          materializedAt: "2026-08-20T05:59:59Z",
          projectionAvailability: "available",
          projectionEvidenceStatus: "confirmed",
        },
      })),
      projection: {
        materializedThroughServerRevision: 7,
        materializedAt: "2026-08-20T06:00:00Z",
        projectionAvailability: "available",
        projectionEvidenceStatus: "confirmed",
      },
    });
    expect(test.transactionCount()).toBe(1);
    expect(test.transactionOptions).toEqual([{ readOnly: true, repeatableRead: true }]);
    expect(test.revisions.read).not.toHaveBeenCalled();
    expect(test.calls).toHaveLength(2);
    for (const call of test.calls) {
      expect(call.sql).toMatch(/WHERE account_id = \$1 AND workspace_id = \$2/u);
      expect(call.values).toEqual([scope.accountId, scope.workspaceId]);
    }
  });

  it("propagates both trusted coordinates and does not substitute either coordinate", async () => {
    const sameTenantAllowedControl = scope;
    const crossAccount = { accountId: "account-b", workspaceId: scope.workspaceId } as const;
    const crossWorkspace = { accountId: scope.accountId, workspaceId: "workspace-b" } as const;
    const test = harness({
      resolve: (tenantScope, table) => table === "state"
        ? [{ ...stateRow, materialized_through_server_revision: tenantScope === sameTenantAllowedControl ? "1" : "0", materialized_at: null, projection_availability: "unavailable", projection_evidence_status: "unknown" }]
        : tenantScope === sameTenantAllowedControl ? [assetRow("allowed.test", "same-tenant")] : [],
    });

    await expect(test.query.readPortfolio(sameTenantAllowedControl)).resolves.toMatchObject({
      assets: [{ asset: { note: "same-tenant" } }],
    });
    await expect(test.query.readPortfolio(crossAccount)).resolves.toMatchObject({ assets: [] });
    await expect(test.query.readPortfolio(crossWorkspace)).resolves.toMatchObject({ assets: [] });
    expect(test.calls.map(({ values }) => values)).toEqual([
      [scope.accountId, scope.workspaceId], [scope.accountId, scope.workspaceId],
      [crossAccount.accountId, crossAccount.workspaceId], [crossAccount.accountId, crossAccount.workspaceId],
      [crossWorkspace.accountId, crossWorkspace.workspaceId], [crossWorkspace.accountId, crossWorkspace.workspaceId],
    ]);
  });

  it.each([
    ["unknown asset column", [{ ...assetRow("a.test"), extra: true }], [stateRow]],
    ["partial target price", [{ ...assetRow("a.test"), target_price_currency: "USD" }], [stateRow]],
    ["invalid materialization source", [{ ...assetRow("a.test"), materialization_origin: "provider" }], [stateRow]],
    ["invalid materialization time coupling", [{ ...assetRow("a.test"), materialized_at: null }], [stateRow]],
    ["unknown projection column", [], [{ ...stateRow, extra: true }]],
    ["noncanonical timestamp", [], [{ ...stateRow, materialized_at: "2026-08-20T06:00:00.000Z" }]],
    ["negative materialized revision", [], [{ ...stateRow, materialized_through_server_revision: "-1" }]],
    ["noncanonical materialized revision", [], [{ ...stateRow, materialized_through_server_revision: "01" }]],
    ["unsafe materialized revision", [], [{ ...stateRow, materialized_through_server_revision: "9007199254740992" }]],
    ["zero projection rows", [], []],
    ["multiple projection rows", [], [stateRow, stateRow]],
  ])("fails closed for malformed untrusted database output: %s", async (_label, assets, states) => {
    await expect(harness({ assets, states }).query.readPortfolio(scope)).rejects.toThrow();
  });
});
