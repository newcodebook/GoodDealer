import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { AccountTransaction } from "../src/db/index";
import {
  DESKTOP_OAUTH_CLIENT_ID,
  DESKTOP_OAUTH_REDIRECT_URI,
  PostgresDesktopOAuthAuthorizationService,
} from "../src/modules/identity/postgres-desktop-oauth";
import type { PostgresIdentityAuthenticationRepository } from "../src/modules/identity/postgres-authentication-repository";

type InitialIssuance = Parameters<PostgresIdentityAuthenticationRepository["issueInitial"]>[0];
type InitialIssuer = (input: InitialIssuance) => Promise<"issued" | "epoch_conflict" | "credential_jti_conflict">;

const verifier = "A".repeat(64);
const challenge = createHash("sha256").update(verifier, "ascii").digest("base64url");
const publicKey = Buffer.alloc(32, 7).toString("base64url");
const signature = Buffer.alloc(64, 9).toString("base64url");
const principal = {
  accountId: "account-a",
  sessionId: "web-session",
  clientKind: "account_web" as const,
  transactionCredential: new TextEncoder().encode("web-session"),
};

describe("Desktop OAuth Authorization Code with PKCE", () => {
  it("issues a five-minute single-purpose code only for an eligible bound device", async () => {
    const inserts: readonly unknown[][] = [];
    const service = serviceFor(async (text, values) => {
      if (text.includes("SELECT account_security_epoch")) {
        return rows([{ account_security_epoch: "4", status: "normal" }]);
      }
      if (text.includes("FROM identity_auth_sessions")) {
        return rows([{ enrollment_authorized_until: new Date("2026-09-01T00:05:00Z") }]);
      }
      (inserts as unknown[][]).push([...(values ?? [])]);
      return rows([]);
    });
    const result = await authorizeWithProof(service);
    expect(result).toMatchObject({ authorized: true });
    if (!result.authorized) throw new Error("authorization unexpectedly denied");
    expect(result.code).toMatch(/^gd_ac1\./u);
    expect(inserts.flat()).not.toContain(result.code);
    expect(inserts.flat()).toContain(challenge);
    expect(inserts.flat()).toContain("device-a");
  });

  it("exchanges the code only with the exact S256 verifier and stores token digests", async () => {
    let issuedCode = "";
    let storedCodeDigest = "";
    const issueInitial = vi.fn<InitialIssuer>(async () => "issued");
    const service = serviceFor(async (text, values) => {
      if (text.includes("SELECT account_security_epoch")) {
        return rows([{ account_security_epoch: "4", status: "normal" }]);
      }
      if (text.includes("FROM identity_auth_sessions")) {
        return rows([{ enrollment_authorized_until: new Date("2026-09-01T00:05:00Z") }]);
      }
      if (text.includes("INSERT INTO identity_desktop_authorization_codes")) {
        storedCodeDigest = String(values?.[1]);
        return rows([]);
      }
      const suppliedChallenge = values?.[2];
      return suppliedChallenge === challenge
        ? rows([{ device_id: "device-a", account_security_epoch: "4" }])
        : rows([]);
    }, issueInitial);
    const authorized = await authorizeWithProof(service);
    if (!authorized.authorized) throw new Error("authorization unexpectedly denied");
    issuedCode = authorized.code;

    await expect(service.exchange({
      code: issuedCode,
      codeVerifier: "B".repeat(64),
      clientId: DESKTOP_OAUTH_CLIENT_ID,
      redirectUri: DESKTOP_OAUTH_REDIRECT_URI,
      evaluatedAt: new Date("2026-09-01T00:01:00Z"),
    })).resolves.toEqual({ exchanged: false });
    expect(issueInitial).not.toHaveBeenCalled();

    const exchanged = await service.exchange({
      code: issuedCode,
      codeVerifier: verifier,
      clientId: DESKTOP_OAUTH_CLIENT_ID,
      redirectUri: DESKTOP_OAUTH_REDIRECT_URI,
      evaluatedAt: new Date("2026-09-01T00:01:00Z"),
    });
    expect(exchanged.exchanged).toBe(true);
    expect(issueInitial).toHaveBeenCalledTimes(1);
    const issuance = issueInitial.mock.calls[0]?.[0];
    expect(issuance?.accessJti).toMatch(/^[a-f0-9]{64}$/u);
    expect(issuance?.refreshJti).toMatch(/^[a-f0-9]{64}$/u);
    expect(issuance?.authMethod).toBe("oauth_pkce");
    expect(issuance?.accessJti).not.toBe(storedCodeDigest);
    if (!exchanged.exchanged) throw new Error("exchange unexpectedly denied");
    const raw = exchanged.credentials.consume((value) => value);
    expect(JSON.stringify(issuance)).not.toContain(raw.accessToken);
    expect(JSON.stringify(issuance)).not.toContain(raw.refreshToken);
  });

  it("rejects redirect, client, method, device and principal substitution", async () => {
    const service = serviceFor(async () => rows([{ account_security_epoch: "4", status: "normal" }]));
    const base = {
      principal,
      deviceId: "device-a",
      clientId: DESKTOP_OAUTH_CLIENT_ID,
      redirectUri: DESKTOP_OAUTH_REDIRECT_URI,
      codeChallenge: challenge,
      codeChallengeMethod: "S256",
      keyId: "device-key-a",
      publicKey,
      evaluatedAt: new Date("2026-09-01T00:00:00Z"),
    };
    for (const override of [
      { clientId: "attacker" },
      { redirectUri: "https://attacker.example/callback" },
      { codeChallengeMethod: "plain" },
      { codeChallenge: "short" },
      { deviceId: "contains space" },
      { principal: { ...principal, clientKind: "desktop" as const } },
    ]) {
      await expect(service.authorize({ ...base, ...override })).resolves.toEqual({ authorized: false });
    }
  });
});

function serviceFor(
  query: (text: string, values?: readonly unknown[]) => Promise<unknown>,
  issueInitial = vi.fn<InitialIssuer>(async () => "issued"),
) {
  return new PostgresDesktopOAuthAuthorizationService(
    {
      withAccount: async <Result>(accountId: unknown, operation: (transaction: AccountTransaction) => Promise<Result>) => {
        expect(accountId).toBe("account-a");
        return operation({ accountId: "account-a", query: query as AccountTransaction["query"] });
      },
    },
    { issueInitial },
    {
      issueLoginChallenge: async () => ({
        issued: true,
        challenge: {
          challengeId: "login-challenge-a",
          accountId: "account-a",
          deviceId: "device-a",
          keyId: "device-key-a",
          nonceDigest: "N".repeat(43),
          expiresAt: "2026-09-01T00:02:00Z",
        },
      }),
      verifyAndConsumeLoginProof: async () => ({ verified: true }),
      checkLoginEligibility: async ({ deviceId }) => ({ eligible: deviceId === "device-a" }),
    },
    {
      ensureCurrentLease: async ({ deviceId }) => deviceId === "device-a"
        ? { ensured: true as const, lease: {} as never }
        : { ensured: false as const },
      requireCurrentLease: async ({ deviceId }) => deviceId === "device-a"
        ? { ensured: true as const, lease: {} as never }
        : { ensured: false as const },
    },
  );
}

async function authorizeWithProof(service: PostgresDesktopOAuthAuthorizationService) {
  const base = {
    principal,
    deviceId: "device-a",
    clientId: DESKTOP_OAUTH_CLIENT_ID,
    redirectUri: DESKTOP_OAUTH_REDIRECT_URI,
    codeChallenge: challenge,
    codeChallengeMethod: "S256",
    keyId: "device-key-a",
    publicKey,
    evaluatedAt: new Date("2026-09-01T00:00:00Z"),
  } as const;
  const challenged = await service.authorize(base);
  expect(challenged).toMatchObject({ authorized: false, challengeRequired: true });
  return service.authorize({
    ...base,
    proof: { challengeId: "login-challenge-a", signature },
  });
}

function rows<Row>(values: readonly Row[]) {
  return { command: "SELECT", rowCount: values.length, oid: 0, fields: [], rows: [...values] };
}
