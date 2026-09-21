import { Pool, type PoolClient, type QueryResult } from "pg";
import { describe, expect, it, vi, type Mock } from "vitest";

import {
  createCloudCapabilityDatabasePools,
  IdentityCapabilityTransactionRunner,
  identityTransactionCapabilityPurposes,
} from "../src/db/index";

interface Event {
  readonly side: "account" | "issuer";
  readonly sql: string;
  readonly values?: readonly unknown[];
}

describe("IdentityCapabilityTransactionRunner", () => {
  it("commits Identity issuance before consuming authority in the exact target transaction", async () => {
    const events: Event[] = [];
    const account = client("account", events, (sql) => {
      if (sql.includes("role_clean")) return rows([{ account_id: null, workspace_id: null, capability_purpose: null, role_clean: true }]);
      if (sql.includes("pg_current_xact_id")) return rows([{ pid: 41, xid: "9201" }]);
      if (sql.includes("current_transaction_account")) return rows([{ account_id: "derived-account" }]);
      if (sql === "SELECT protected") return rows([{ value: "ok" }]);
      return rows([]);
    });
    const issuer = client("issuer", events, (sql) => {
      if (sql.includes("role_clean")) return rows([{ account_id: null, workspace_id: null, capability_purpose: null, role_clean: true }]);
      return sql.includes("issue_transaction_capability")
        ? rows([{ token: Buffer.alloc(32, 7) }])
        : rows([]);
    });
    const runner = new IdentityCapabilityTransactionRunner(pool(account), pool(issuer));

    const result = await runner.withAccountCredential(
      new TextEncoder().encode("opaque-session-credential-a"),
      "devices_account",
      async (transaction) => {
        expect(transaction.accountId).toBe("derived-account");
        return (await transaction.query<{ value: string }>("SELECT protected")).rows[0]?.value;
      },
    );

    expect(result).toBe("ok");
    const issuerCommit = events.findIndex((event) => event.side === "issuer" && event.sql === "COMMIT");
    const consume = events.findIndex((event) => event.side === "account" && event.sql.includes("consume_transaction_capability"));
    const business = events.findIndex((event) => event.side === "account" && event.sql === "SELECT protected");
    expect(issuerCommit).toBeGreaterThan(-1);
    expect(consume).toBeGreaterThan(issuerCommit);
    expect(business).toBeGreaterThan(consume);
    const issue = events.find((event) => event.sql.includes("issue_transaction_capability"));
    expect(issue?.values?.slice(1)).toEqual([41, "9201", expect.any(Buffer), "devices_account"]);
    expect(issue?.values).toHaveLength(5);
    expect(events.some((event) => event.side === "account"
      && event.sql === "SELECT identity_private.current_transaction_account() AS account_id")).toBe(true);
    expect(events.some((event) => event.side === "issuer" && event.sql === "RESET ALL")).toBe(true);
  });

  it("rolls back, discards transaction-local state, and rethrows callback failures", async () => {
    const events: Event[] = [];
    const account = client("account", events, (sql) => {
      if (sql.includes("role_clean")) return rows([{ account_id: null, workspace_id: null, capability_purpose: null, role_clean: true }]);
      if (sql.includes("pg_current_xact_id")) return rows([{ pid: 42, xid: "9202" }]);
      if (sql.includes("current_transaction_account")) return rows([{ account_id: "derived-account" }]);
      return rows([]);
    });
    const issuer = client("issuer", events, (sql) => {
      if (sql.includes("role_clean")) return rows([{ account_id: null, workspace_id: null, capability_purpose: null, role_clean: true }]);
      return sql.includes("issue_transaction_capability")
        ? rows([{ token: Buffer.alloc(32, 8) }])
        : rows([]);
    });
    const runner = new IdentityCapabilityTransactionRunner(pool(account), pool(issuer));

    await expect(runner.withAccountCredential(
      new TextEncoder().encode("opaque-session-credential-b"),
      "identity_account",
      async () => { throw new Error("business failed"); },
    )).rejects.toThrow("business failed");

    expect(events.some((event) => event.side === "account" && event.sql === "ROLLBACK")).toBe(true);
    expect(events.some((event) => event.side === "account" && event.sql === "DISCARD ALL")).toBe(true);
    expect(account.release).toHaveBeenCalledWith();
  });

  it("destroys a client whose rollback fails", async () => {
    const events: Event[] = [];
    const account = client("account", events, (sql) => {
      if (sql.includes("role_clean")) return rows([{ account_id: null, workspace_id: null, capability_purpose: null, role_clean: true }]);
      if (sql.includes("pg_current_xact_id")) return rows([{ pid: 43, xid: "9203" }]);
      if (sql.includes("current_transaction_account")) return rows([{ account_id: "derived-account" }]);
      if (sql === "ROLLBACK") throw new Error("rollback failed");
      return rows([]);
    });
    const issuer = client("issuer", events, (sql) => {
      if (sql.includes("role_clean")) return rows([{ account_id: null, workspace_id: null, capability_purpose: null, role_clean: true }]);
      return sql.includes("issue_transaction_capability")
        ? rows([{ token: Buffer.alloc(32, 9) }])
        : rows([]);
    });
    const runner = new IdentityCapabilityTransactionRunner(pool(account), pool(issuer));

    await expect(runner.withAccountCredential(
      new TextEncoder().encode("opaque-session-credential-c"),
      "identity_account",
      async () => { throw new Error("callback failed"); },
    )).rejects.toThrow("callback failed");
    expect(account.release).toHaveBeenCalledWith(expect.any(Error));
  });

  it("destroys a contaminated issuer client when fail-closed cleanup also fails", async () => {
    const events: Event[] = [];
    const account = client("account", events, (sql) => {
      if (sql.includes("role_clean")) return rows([{ account_id: null, workspace_id: null, capability_purpose: null, role_clean: true }]);
      if (sql.includes("pg_current_xact_id")) return rows([{ pid: 44, xid: "9204" }]);
      return rows([]);
    });
    const issuer = client("issuer", events, (sql) => {
      if (sql.includes("role_clean")) {
        return rows([{ account_id: "residue", workspace_id: null, capability_purpose: null, role_clean: true }]);
      }
      if (sql === "DISCARD ALL") throw new Error("issuer cleanup failed");
      return rows([]);
    });
    const runner = new IdentityCapabilityTransactionRunner(pool(account), pool(issuer));

    await expect(runner.withAccountCredential(
      new TextEncoder().encode("opaque-session-credential-d"),
      "billing_read",
      async () => "unreachable",
    )).rejects.toThrow("database client checkout state is not clean");
    expect(issuer.release).toHaveBeenCalledWith(expect.any(Error));
    expect(events.some((event) => event.side === "account" && event.sql === "ROLLBACK")).toBe(true);
  });

  it("keeps the public purpose set closed and materializes four distinct role pools", async () => {
    expect(identityTransactionCapabilityPurposes).toEqual([
      "identity_account",
      "devices_account",
      "workspace_tenant",
      "billing_read",
      "purchase_reserve",
      "cancellation_request",
      "refund_request",
      "fixed_term_capture",
      "billing_approval_redirect",
    ]);
    const pools = createCloudCapabilityDatabasePools({
      identityCapabilityIssuer: {},
      accountApi: {},
      providerIngress: {},
      providerWorker: {},
    });
    expect(new Set(Object.values(pools)).size).toBe(4);
    expect("withAccount" in pools.providerWorker).toBe(false);
    await Promise.all(Object.values(pools).map((value) => value.end()));
  });
});

function client(
  side: Event["side"],
  events: Event[],
  respond: (sql: string, values?: readonly unknown[]) => QueryResult,
): Pick<PoolClient, "query" | "release"> & { release: Mock } {
  return {
    query: vi.fn(async (sql: string, values?: readonly unknown[]) => {
      events.push({ side, sql, ...(values === undefined ? {} : { values }) });
      return respond(sql, values);
    }) as unknown as PoolClient["query"],
    release: vi.fn(),
  };
}

function pool(value: Pick<PoolClient, "query" | "release">): Pool {
  return { connect: async () => value } as unknown as Pool;
}

function rows<Row extends Record<string, unknown>>(value: Row[]): QueryResult<Row> {
  return { command: "SELECT", rowCount: value.length, oid: 0, fields: [], rows: value };
}
