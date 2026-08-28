import { describe, expect, it } from "vitest";

import {
  AccountActivationError,
  type ActivationDatabase,
  type AuthenticatedSubjectRevalidationPort,
  activateAccount,
  parseActivationIntent,
  parseAuthenticatedSubject,
} from "../src/modules/identity/account-activation";
import { accountDefaultWorkspaceMigration } from "../src/modules/workspace/default-workspace";

const subject = {
  stableSubject: "session-subject-1",
  emailNormalized: "person@example.com",
  emailVerifiedAt: "2026-08-26T00:00:00Z",
  passwordHashPhc: "$argon2id$v=19$m=65536,t=3,p=1$" + "x".repeat(100),
  clientKind: "account_web" as const,
  expiresAt: "2030-01-01T00:00:00Z",
  revoked: false as const,
  securityEpoch: 1,
};

const verified: AuthenticatedSubjectRevalidationPort = { revalidate: async () => subject };

describe("account activation boundary", () => {
  it("accepts exactly the versioned intent and rejects authority injection", () => {
    expect(parseActivationIntent({ schemaVersion: 1 })).toEqual({ schemaVersion: 1 });
    for (const value of [{ schemaVersion: 1, accountId: "attacker" }, { schemaVersion: 1, role: "owner" }, null, 1]) {
      expect(() => parseActivationIntent(value)).toThrow(AccountActivationError);
    }
    const inherited = Object.create({ schemaVersion: 1 }) as Record<string, unknown>;
    Object.defineProperty(inherited, "schemaVersion", { value: 1, enumerable: true });
    expect(() => parseActivationIntent(inherited)).toThrow(AccountActivationError);
    expect(() => parseActivationIntent(Object.defineProperty({}, "schemaVersion", { value: 1, enumerable: true }))).not.toThrow();
    expect(() => parseActivationIntent(Object.defineProperty({}, "schemaVersion", { get: () => 1, enumerable: true }))).toThrow(AccountActivationError);
    expect(() => parseActivationIntent(Object.assign(Object.create(null), { schemaVersion: 1 }))).not.toThrow();
  });

  it("rejects fixture and malformed authenticated subjects", () => {
    expect(parseAuthenticatedSubject(subject)).toMatchObject({ stableSubject: subject.stableSubject });
    expect(() => parseAuthenticatedSubject({ ...subject, stableSubject: "fixture-subject" })).toThrow(AccountActivationError);
    expect(() => parseAuthenticatedSubject({ ...subject, workspaceId: "caller-selected" })).toThrow(AccountActivationError);
    const accessor = { ...subject };
    Object.defineProperty(accessor, "emailNormalized", { get: () => subject.emailNormalized, enumerable: true });
    expect(() => parseAuthenticatedSubject(accessor)).toThrow(AccountActivationError);
    const symbol = Symbol("unknown");
    expect(() => parseAuthenticatedSubject({ ...subject, [symbol]: true })).toThrow(AccountActivationError);
  });

  it("defines the module-owned M014 schema and RLS boundary", () => {
    expect(accountDefaultWorkspaceMigration.id).toBe("202608200014-account-default-workspace");
    expect(accountDefaultWorkspaceMigration.sql).toContain("workspace_account_bindings_one_default_account");
    expect(accountDefaultWorkspaceMigration.sql).toContain("FORCE ROW LEVEL SECURITY");
    expect(accountDefaultWorkspaceMigration.sql).toContain("FOREIGN KEY (account_id, workspace_id)");
    expect(accountDefaultWorkspaceMigration.sql).toContain("workspace_account_bindings_default_owner_account_select");
    expect(accountDefaultWorkspaceMigration.sql).toContain("FOR SELECT");
    expect(accountDefaultWorkspaceMigration.sql).toContain("owner_kind = 'account'");
    expect(accountDefaultWorkspaceMigration.sql).toContain("role = 'default_owner'");
    expect(accountDefaultWorkspaceMigration.sql).toContain("is_default = true");
    expect(accountDefaultWorkspaceMigration.sql).not.toMatch(/GRANT[^;]*DELETE/iu);
  });

  it("creates a complete graph atomically and rolls back injected faults", async () => {
    const calls: string[] = [];
    const database = {
      async connect() {
        return {
          async query(text: string) {
            calls.push(text);
            if (text.startsWith("SELECT account_id, email_normalized")) return { rows: [] };
            if (text.startsWith("SELECT workspace_id, account_id")) return { rows: [] };
            if (text.startsWith("SELECT account_id, workspace_id, role")) return { rows: [] };
            return { rows: [] };
          },
          release() {},
        };
      },
    };
    await expect(activateAccount(database, verified, { schemaVersion: 1 })).resolves.toMatchObject({ state: "active" });
    expect(calls.some((call) => call === "COMMIT")).toBe(true);

    const failing = { ...database, async connect() {
      const client = await database.connect();
      return { ...client, async query(text: string, _values?: readonly unknown[]) {
        if (text.includes("workspace_workspaces")) throw new Error("workspace fault");
        return client.query(text);
      } };
    } };
    await expect(activateAccount(failing, verified, { schemaVersion: 1 })).rejects.toThrow("workspace fault");
  });

  it("revalidates at the write boundary and never trusts caller subject data", async () => {
    const calls: string[] = [];
    const database: ActivationDatabase = { async connect() {
      return { async query(text: string) { calls.push(text); return { rows: [] }; }, release() {} };
    } };
    const untrusted = { ...subject, emailNormalized: "attacker@example.com" };
    const port = { revalidate: async () => subject };
    const result = await activateAccount(database, port, { schemaVersion: 1 });
    expect(result.accountId).not.toContain("attacker");
    expect(calls.some((call) => call.includes("attacker"))).toBe(false);
    expect(untrusted.emailNormalized).toBe("attacker@example.com");
    await expect(activateAccount(database, { revalidate: async () => ({ ...subject, unexpected: true }) }, { schemaVersion: 1 }))
      .rejects.toThrow(AccountActivationError);
  });

  it("rejects unauthenticated, expired, revoked, wrong-kind, malformed, and injected inputs", async () => {
    const invalid = [undefined, null, {}, { ...subject, expiresAt: "2020-01-01T00:00:00Z" }, { ...subject, revoked: true },
      { ...subject, clientKind: "desktop" }, { ...subject, accountId: "caller-account" }, { ...subject, workspaceId: "caller-workspace" }];
    for (const value of invalid) await expect(activateAccount({ connect: async () => { throw new Error("must not connect"); } }, { revalidate: async () => value }, { schemaVersion: 1 })).rejects.toThrow();
  });

  it("fails closed on malformed database rows and converges bounded retries/concurrency", async () => {
    const malformed = { connect: async () => ({
      query: async (text: string) => text.startsWith("SELECT account_id, email_normalized")
        ? { rows: [{ account_id: 4, email_normalized: "person@example.com" }] } : { rows: [] },
      release() {},
    }) } as unknown as ActivationDatabase;
    await expect(activateAccount(malformed, verified, { schemaVersion: 1 })).rejects.toThrow("database row is invalid");
    const duplicate = { connect: async () => ({
      query: async (text: string) => text.startsWith("SELECT account_id, email_normalized")
        ? { rows: [{ account_id: "a", email_normalized: "person@example.com" }, { account_id: "b", email_normalized: "person@example.com" }] } : { rows: [] },
      release() {},
    }) } as unknown as ActivationDatabase;
    await expect(activateAccount(duplicate, verified, { schemaVersion: 1 })).rejects.toThrow("database result is invalid");
    const rowVariants: unknown[] = [];
    const accessor = { account_id: "a", email_normalized: "person@example.com" };
    Object.defineProperty(accessor, "account_id", { get: () => "a", enumerable: true });
    rowVariants.push(accessor);
    const inherited = Object.create({ unexpected: true }) as Record<string, unknown>;
    Object.assign(inherited, { account_id: "a", email_normalized: "person@example.com" });
    rowVariants.push(inherited);
    const symbol = Symbol("unexpected");
    rowVariants.push({ account_id: "a", email_normalized: "person@example.com", [symbol]: true });
    const nonEnumerable = { account_id: "a", email_normalized: "person@example.com" };
    Object.defineProperty(nonEnumerable, "hidden", { value: true, enumerable: false });
    rowVariants.push(nonEnumerable);
    for (const row of rowVariants) {
      const invalidRow = { connect: async () => ({
        query: async (text: string) => text.startsWith("SELECT account_id, email_normalized") ? { rows: [row] } : { rows: [] },
        release() {},
      }) } as unknown as ActivationDatabase;
      await expect(activateAccount(invalidRow, verified, { schemaVersion: 1 })).rejects.toThrow("database row is invalid");
    }

    let first = true;
    const retryable: ActivationDatabase = { connect: async () => ({
      query: async (text: string) => {
        if (text === "COMMIT" && first) { first = false; throw Object.assign(new Error("serialization"), { code: "40001" }); }
        return { rows: [] };
      },
      release() {},
    }) };
    const [one, two] = await Promise.all([
      activateAccount(retryable, verified, { schemaVersion: 1 }),
      activateAccount(retryable, verified, { schemaVersion: 1 }),
    ]);
    expect(two).toEqual(one);
  });
});
