import { describe, expect, it, vi } from "vitest";

import type { PublicPrincipal } from "../src/entrypoints/ports/public-session";
import {
  activationIdentityFor,
  type ActivationDatabase,
  type ActivationDatabaseClient,
} from "../src/modules/identity/account-activation";
import {
  AccountActivationApplicationService,
  AccountActivationConsistencyError,
} from "../src/modules/identity/account-activation-service";

const subject = {
  stableSubject: "production-subject-activation-service",
  emailNormalized: "person@example.com",
  emailVerifiedAt: "2026-08-29T00:00:00Z",
  passwordHashPhc: "$argon2id$v=19$m=65536,t=3,p=1$" + "x".repeat(100),
  clientKind: "account_web" as const,
  expiresAt: "2030-01-01T00:00:00Z",
  revoked: false as const,
  securityEpoch: 1,
};
const scope = activationIdentityFor(subject);
const webPrincipal: PublicPrincipal = {
  accountId: scope.accountId,
  sessionId: "session-activation",
  clientKind: "account_web",
};

function recordingDatabase() {
  const queries: Array<{ text: string; values?: readonly unknown[] }> = [];
  const client: ActivationDatabaseClient = {
    async query(text, values) {
      queries.push(values === undefined ? { text } : { text, values });
      return { rows: [] };
    },
    release: vi.fn(),
  };
  const connect = vi.fn(async () => client);
  const database: ActivationDatabase = { connect };
  return { database, connect, queries };
}

describe("account activation application service", () => {
  it("revalidates principal identity before writing and resolves the sole default workspace", async () => {
    const { database, connect, queries } = recordingDatabase();
    const readActivationSubject = vi.fn(async () => subject);
    const resolve = vi.fn(async () => scope);
    const service = new AccountActivationApplicationService(
      database,
      { readActivationSubject },
      { resolve },
    );

    await expect(service.activate({ schemaVersion: 1 }, webPrincipal)).resolves.toEqual({
      schemaVersion: 1,
      state: "active",
    });
    expect(readActivationSubject).toHaveBeenCalledWith(webPrincipal);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith(webPrincipal);
    expect(queries.some(({ text, values }) =>
      text.includes("gooddealer.account_id") && values?.includes(scope.accountId))).toBe(true);
    expect(queries.some(({ text, values }) =>
      text.includes("gooddealer.workspace_id") && values?.includes(scope.workspaceId))).toBe(true);
    for (const table of [
      "identity_accounts",
      "workspace_workspaces",
      "workspace_account_bindings",
      "workspace_revisions",
    ]) {
      expect(queries.some(({ text }) => text.includes(table))).toBe(true);
    }
  });

  it("fails closed before database access for missing, cross-account, and desktop authority", async () => {
    const missing = recordingDatabase();
    const missingReader = vi.fn(async () => null);
    const missingResolver = vi.fn(async () => scope);
    await expect(new AccountActivationApplicationService(
      missing.database,
      { readActivationSubject: missingReader },
      { resolve: missingResolver },
    ).activate({ schemaVersion: 1 }, webPrincipal)).resolves.toBeNull();
    expect(missing.connect).not.toHaveBeenCalled();
    expect(missingResolver).not.toHaveBeenCalled();

    const crossed = recordingDatabase();
    const crossedResolver = vi.fn(async () => scope);
    await expect(new AccountActivationApplicationService(
      crossed.database,
      { readActivationSubject: async () => subject },
      { resolve: crossedResolver },
    ).activate({ schemaVersion: 1 }, { ...webPrincipal, accountId: "account-attacker" }))
      .resolves.toBeNull();
    expect(crossed.connect).not.toHaveBeenCalled();
    expect(crossedResolver).not.toHaveBeenCalled();

    const desktop = recordingDatabase();
    const desktopReader = vi.fn(async () => subject);
    await expect(new AccountActivationApplicationService(
      desktop.database,
      { readActivationSubject: desktopReader },
      { resolve: async () => scope },
    ).activate({ schemaVersion: 1 }, { ...webPrincipal, clientKind: "desktop" }))
      .resolves.toBeNull();
    expect(desktopReader).not.toHaveBeenCalled();
    expect(desktop.connect).not.toHaveBeenCalled();
  });

  it("fails closed on malformed revalidation data and inconsistent default workspace state", async () => {
    const malformed = recordingDatabase();
    await expect(new AccountActivationApplicationService(
      malformed.database,
      { readActivationSubject: async () => ({ ...subject, workspaceId: "injected" }) },
      { resolve: async () => scope },
    ).activate({ schemaVersion: 1 }, webPrincipal)).rejects.toThrow("authenticated subject is invalid");
    expect(malformed.connect).not.toHaveBeenCalled();

    const inconsistent = recordingDatabase();
    await expect(new AccountActivationApplicationService(
      inconsistent.database,
      { readActivationSubject: async () => subject },
      { resolve: async () => ({ ...scope, workspaceId: "workspace-other" }) },
    ).activate({ schemaVersion: 1 }, webPrincipal)).rejects.toThrow(AccountActivationConsistencyError);
  });
});
