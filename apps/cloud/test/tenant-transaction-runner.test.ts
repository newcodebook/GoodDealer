import { describe, expect, it } from "vitest";

import { TenantTransactionRunner } from "../src/db/index";
import { parseWorkspaceTenantScope } from "../src/modules/workspace/tenant-scope";

function runner(options: { readonly failRollback?: boolean } = {}) {
  const queries: Array<{ readonly text: string; readonly values: readonly unknown[] | undefined }> = [];
  const releases: Array<Error | undefined> = [];
  const client = {
    async query(text: string, values?: readonly unknown[]) {
      queries.push({ text, values });
      if (text === "ROLLBACK" && options.failRollback === true) throw new Error("rollback-cleanup-failed");
      return { rows: [], rowCount: 0 };
    },
    release(error?: Error) { releases.push(error); },
  };
  return {
    queries,
    releases,
    transactions: new TenantTransactionRunner({ async connect() { return client; } } as never),
  };
}

describe("TenantTransactionRunner selector lifecycle", () => {
  it("establishes both exact selectors and commits before releasing the client", async () => {
    const subject = runner();
    const input = { accountId: "account-a", workspaceId: "workspace-a" };
    await expect(subject.transactions.withTenant(
      input,
      async (transaction) => {
        expect(transaction.scope).toEqual({ accountId: "account-a", workspaceId: "workspace-a" });
        expect(transaction.scope).not.toBe(input);
        await Promise.resolve();
        return "done";
      },
    )).resolves.toBe("done");
    expect(subject.queries).toEqual([
      { text: "BEGIN", values: undefined },
      { text: "SELECT set_config('gooddealer.account_id', $1, true)", values: ["account-a"] },
      { text: "SELECT set_config('gooddealer.workspace_id', $1, true)", values: ["workspace-a"] },
      { text: "COMMIT", values: undefined },
    ]);
    expect(subject.releases).toEqual([undefined]);
  });

  it("rolls back transaction-local selectors before release when the operation fails", async () => {
    const subject = runner();
    await expect(subject.transactions.withTenant(
      { accountId: "account-a", workspaceId: "workspace-a" },
      async () => { throw new Error("operation-failed"); },
    )).rejects.toThrow("operation-failed");
    expect(subject.queries.at(-1)?.text).toBe("ROLLBACK");
    expect(subject.releases).toEqual([undefined]);
  });

  it("destroys the pooled client when rollback cleanup fails", async () => {
    const subject = runner({ failRollback: true });
    await expect(subject.transactions.withTenant(
      { accountId: "account-a", workspaceId: "workspace-a" },
      async () => { throw new Error("operation-failed"); },
    )).rejects.toThrow("operation-failed");
    expect(subject.releases).toHaveLength(1);
    expect(subject.releases[0]).toBeInstanceOf(Error);
  });

  it("rejects hostile scope shapes without reading accessors or acquiring a client", async () => {
    let getterReads = 0;
    let acquired = 0;
    let operationCalls = 0;
    const transactions = new TenantTransactionRunner({
      async connect() { acquired += 1; throw new Error("must not connect"); },
    } as never);

    const accountAccessor = { workspaceId: "workspace-a" };
    Object.defineProperty(accountAccessor, "accountId", {
      enumerable: true,
      get() { getterReads += 1; return "account-a"; },
    });
    const workspaceAccessor = { accountId: "account-a" };
    Object.defineProperty(workspaceAccessor, "workspaceId", {
      enumerable: true,
      get() { getterReads += 1; return "workspace-a"; },
    });
    const accessorExtra = { accountId: "account-a", workspaceId: "workspace-a" };
    Object.defineProperty(accessorExtra, "authority", {
      enumerable: true,
      get() { getterReads += 1; return true; },
    });
    const symbolExtra = {
      accountId: "account-a",
      workspaceId: "workspace-a",
      [Symbol("authority")]: true,
    };
    const hiddenExtra = { accountId: "account-a", workspaceId: "workspace-a" };
    Object.defineProperty(hiddenExtra, "authority", { enumerable: false, value: true });
    const hiddenRequired = { accountId: "account-a" };
    Object.defineProperty(hiddenRequired, "workspaceId", { enumerable: false, value: "workspace-a" });
    const inheritedSelector = Object.create({ accountId: "account-a" }) as Record<string, unknown>;
    inheritedSelector.workspaceId = "workspace-a";
    const customPrototype = Object.create({ authority: true }) as Record<string, unknown>;
    customPrototype.accountId = "account-a";
    customPrototype.workspaceId = "workspace-a";

    const hostileScopes: readonly unknown[] = [
      { accountId: "account-a" },
      { workspaceId: "workspace-a" },
      { accountId: "account-a", workspaceId: "workspace-a", extra: true },
      { accountId: "invalid account", workspaceId: "workspace-a" },
      accountAccessor,
      workspaceAccessor,
      accessorExtra,
      symbolExtra,
      hiddenExtra,
      hiddenRequired,
      inheritedSelector,
      customPrototype,
    ];

    for (const scope of hostileScopes) {
      expect(parseWorkspaceTenantScope(scope)).toBeNull();
      await expect(transactions.withTenant(scope, async () => {
        operationCalls += 1;
      })).rejects.toThrow("scope is unresolved");
    }
    expect(getterReads).toBe(0);
    expect(acquired).toBe(0);
    expect(operationCalls).toBe(0);
  });
});
