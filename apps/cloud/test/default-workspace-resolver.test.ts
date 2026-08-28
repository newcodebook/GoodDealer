import { describe, expect, it } from "vitest";

import type { PublicPrincipal } from "../src/entrypoints/ports/public-session";
import {
  PostgresDefaultWorkspaceTenantResolver,
} from "../src/modules/workspace/default-workspace";

const principal: PublicPrincipal = {
  accountId: "account-a",
  sessionId: "session-a",
  clientKind: "desktop",
};

function resolverWithRows(rows: readonly unknown[]) {
  const calls: Array<{ readonly accountId: unknown; readonly sql: string; readonly values: readonly unknown[] | undefined }> = [];
  const resolver = new PostgresDefaultWorkspaceTenantResolver({
    async withAccount(accountId, operation) {
      return operation({
        accountId: String(accountId),
        async query(sql: string, values?: readonly unknown[]) {
          calls.push({ accountId, sql, values });
          return { rows } as never;
        },
      });
    },
  });
  return { calls, resolver };
}

describe("PostgresDefaultWorkspaceTenantResolver", () => {
  it("uses only verified account authority and the bounded semantic query", async () => {
    const { calls, resolver } = resolverWithRows([{ account_id: "account-a", workspace_id: "workspace-a" }]);
    await expect(resolver.resolve(principal)).resolves.toEqual({ accountId: "account-a", workspaceId: "workspace-a" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.accountId).toBe("account-a");
    expect(calls[0]?.values).toEqual(["account-a"]);
    expect(calls[0]?.sql).toMatch(/WHERE account_id = \$1/u);
    expect(calls[0]?.sql).toMatch(/owner_kind = 'account'/u);
    expect(calls[0]?.sql).toMatch(/role = 'default_owner'/u);
    expect(calls[0]?.sql).toMatch(/is_default = true/u);
    expect(calls[0]?.sql).toMatch(/LIMIT 2/u);
  });

  it.each([
    ["missing", []],
    ["duplicate", [
      { account_id: "account-a", workspace_id: "workspace-a" },
      { account_id: "account-a", workspace_id: "workspace-b" },
    ]],
    ["malformed", [{ account_id: "account-a", workspace_id: 7 }]],
    ["extra field", [{ account_id: "account-a", workspace_id: "workspace-a", owner_kind: "account" }]],
    ["wrong account", [{ account_id: "account-b", workspace_id: "workspace-a" }]],
    ["invalid account", [{ account_id: "contains space", workspace_id: "workspace-a" }]],
    ["invalid workspace", [{ account_id: "account-a", workspace_id: "contains space" }]],
  ])("fails closed for a %s result", async (_name, rows) => {
    const { resolver } = resolverWithRows(rows);
    await expect(resolver.resolve(principal)).resolves.toBeNull();
  });

  it("rejects caller-built authority objects before account transaction access", async () => {
    let entered = false;
    const resolver = new PostgresDefaultWorkspaceTenantResolver({
      async withAccount() {
        entered = true;
        throw new Error("must not enter account transaction");
      },
    });
    for (const key of ["workspaceId", "account", "query", "path", "header", "cookie", "desktopCache"]) {
      await expect(resolver.resolve({ ...principal, [key]: "foreign-authority" } as PublicPrincipal)).resolves.toBeNull();
    }
    expect(entered).toBe(false);
  });

  it("propagates the resolved exact scope explicitly across an awaited capability boundary", async () => {
    const { resolver } = resolverWithRows([{ account_id: "account-a", workspace_id: "workspace-a" }]);
    const resolved = await resolver.resolve(principal);
    expect(resolved).not.toBeNull();
    await Promise.resolve();
    const observed = await {
      async withTenant(scope: unknown, operation: (scopeValue: unknown) => Promise<unknown>) {
        expect(scope).toEqual({ accountId: "account-a", workspaceId: "workspace-a" });
        return operation(scope);
      },
    }.withTenant(resolved, async (scope) => scope);
    expect(observed).toEqual({ accountId: "account-a", workspaceId: "workspace-a" });
  });
});
