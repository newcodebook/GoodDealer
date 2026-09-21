import { describe, expect, it } from "vitest";

import {
  deriveDesktopRefreshResultToken,
  inspectDesktopBearerToken,
  issueDesktopBearerToken,
} from "../src/modules/identity/desktop-bearer-token";
import { PostgresDesktopAccessTokenVerifier } from "../src/modules/identity/postgres-desktop-access-token-verifier";
import type { AccountTransaction } from "../src/db/index";

describe("Desktop opaque bearer credentials", () => {
  it("round-trips only the account selector and stores a digest instead of the bearer secret", () => {
    const issued = issueDesktopBearerToken("access", "account-a");
    expect(issued.token).toMatch(/^gd_at1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/u);
    expect(issued.credentialDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(issued.credentialDigest).not.toContain(issued.token);
    expect(inspectDesktopBearerToken("access", issued.token)).toEqual({
      accountId: "account-a",
      credentialDigest: issued.credentialDigest,
    });
    expect(inspectDesktopBearerToken("refresh", issued.token)).toBeNull();
  });

  it.each([
    "",
    "gd_at1.bad padding.secret",
    "gd_at1.YWNjb3VudC1h.short",
    `gd_at1.YWNjb3VudC1h.${"A".repeat(44)}`,
    `gd_at1.${Buffer.from("contains space").toString("base64url")}.${"A".repeat(43)}`,
  ])("rejects malformed token %s", (token) => {
    expect(inspectDesktopBearerToken("access", token)).toBeNull();
  });

  it("derives an exact digest-only refresh result for one request and generation", () => {
    const presented = issueDesktopBearerToken("refresh", "account-a");
    const derive = (requestId: string, generation: number) =>
      deriveDesktopRefreshResultToken("refresh", "account-a", presented.token, requestId, generation);
    expect(derive("refresh-request-a", 3)).toEqual(derive("refresh-request-a", 3));
    expect(derive("refresh-request-a", 3)).not.toEqual(derive("refresh-request-b", 3));
    expect(derive("refresh-request-a", 3)).not.toEqual(derive("refresh-request-a", 4));
    expect(JSON.stringify(derive("refresh-request-a", 3))).not.toContain(presented.token);
  });

  it("admits only a live current Desktop access credential", async () => {
    const issued = issueDesktopBearerToken("access", "account-a");
    const queries: readonly unknown[][] = [];
    const verifier = verifierFor(async (_text, values) => {
      (queries as unknown[][]).push([...(values ?? [])]);
      return rows([{
        account_id: "account-a",
        session_id: "session-a",
        client_kind: "desktop",
        family_state: "active",
        credential_state: "active",
        credential_live: true,
        session_live: true,
        epoch_current: true,
      }]);
    });
    await expect(verifier.verifyAccessToken(issued.token, new Date())).resolves.toEqual({
      accountId: "account-a",
      sessionId: "session-a",
      clientKind: "desktop",
    });
    expect(queries.flat()).toContain(issued.credentialDigest);
    expect(queries.flat()).not.toContain(issued.token);
  });

  it.each(["family_state", "credential_state", "credential_live", "session_live", "epoch_current"])(
    "rejects invalid %s state",
    async (field) => {
      const issued = issueDesktopBearerToken("access", "account-a");
      const row: Record<string, unknown> = {
        account_id: "account-a",
        session_id: "session-a",
        client_kind: "desktop",
        family_state: "active",
        credential_state: "active",
        credential_live: true,
        session_live: true,
        epoch_current: true,
      };
      row[field] = field.endsWith("_state") ? "revoked" : false;
      await expect(verifierFor(async () => rows([row])).verifyAccessToken(issued.token, new Date()))
        .resolves.toBeNull();
    },
  );
});

function verifierFor(query: (text: string, values?: readonly unknown[]) => Promise<unknown>) {
  return new PostgresDesktopAccessTokenVerifier({
    withAccount: async <Result>(accountId: unknown, operation: (transaction: AccountTransaction) => Promise<Result>) => {
      expect(accountId).toBe("account-a");
      return operation({ accountId: "account-a", query: query as AccountTransaction["query"] });
    },
  });
}

function rows<Row>(values: readonly Row[]) {
  return { command: "SELECT", rowCount: values.length, oid: 0, fields: [], rows: [...values] };
}
