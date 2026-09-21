import { createHash, createHmac, randomBytes } from "node:crypto";

import { identifier } from "@gooddealer/protocol/wire";

export type DesktopBearerTokenKind = "access" | "refresh" | "authorization_code";

const PREFIX = { access: "gd_at1", refresh: "gd_rt1", authorization_code: "gd_ac1" } as const;
const SECRET_BYTES = 32;

export interface IssuedDesktopBearerToken {
  readonly token: string;
  /** Stored in the credential JTI column; the bearer secret itself is never persisted. */
  readonly credentialDigest: string;
}

export function issueDesktopBearerToken(
  kind: DesktopBearerTokenKind,
  accountIdValue: unknown,
): IssuedDesktopBearerToken {
  const accountId = identifier.parse(accountIdValue);
  const accountSelector = Buffer.from(accountId, "utf8").toString("base64url");
  const secret = randomBytes(SECRET_BYTES).toString("base64url");
  const token = `${PREFIX[kind]}.${accountSelector}.${secret}`;
  return { token, credentialDigest: digest(token) };
}

/**
 * Refresh results are derived from the presented 256-bit bearer secret so an outcome-unknown retry
 * can reconstruct the exact response while Cloud continues to persist credential digests only.
 */
export function deriveDesktopRefreshResultToken(
  kind: "access" | "refresh",
  accountIdValue: unknown,
  presentedRefreshToken: unknown,
  requestIdValue: unknown,
  generation: unknown,
): IssuedDesktopBearerToken {
  const accountId = identifier.parse(accountIdValue);
  const requestId = identifier.parse(requestIdValue);
  const inspected = inspectDesktopBearerToken("refresh", presentedRefreshToken);
  if (inspected === null || inspected.accountId !== accountId) {
    throw new TypeError("presented refresh token is invalid");
  }
  if (!Number.isSafeInteger(generation) || Number(generation) < 1) {
    throw new TypeError("refresh generation is invalid");
  }
  const accountSelector = Buffer.from(accountId, "utf8").toString("base64url");
  const secret = createHmac("sha256", presentedRefreshToken as string)
    .update("GOODDEALER-DESKTOP-REFRESH-RESULT-V1\0", "utf8")
    .update(kind, "utf8")
    .update("\0", "utf8")
    .update(requestId, "utf8")
    .update("\0", "utf8")
    .update(String(generation), "ascii")
    .digest("base64url");
  const token = `${PREFIX[kind]}.${accountSelector}.${secret}`;
  return { token, credentialDigest: digest(token) };
}

export function inspectDesktopBearerToken(
  kind: DesktopBearerTokenKind,
  token: unknown,
): { readonly accountId: string; readonly credentialDigest: string } | null {
  if (typeof token !== "string" || token.length > 512) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== PREFIX[kind]) return null;
  const accountSelector = parts[1];
  const secret = parts[2];
  if (accountSelector === undefined || secret === undefined || secret.length !== 43 || !base64Url(secret)) return null;
  let accountBytes: Buffer;
  try {
    accountBytes = Buffer.from(accountSelector, "base64url");
  } catch {
    return null;
  }
  if (accountBytes.toString("base64url") !== accountSelector) return null;
  const accountId = accountBytes.toString("utf8");
  if (Buffer.from(accountId, "utf8").toString("base64url") !== accountSelector) return null;
  const parsedAccountId = identifier.safeParse(accountId);
  return parsedAccountId.success
    ? { accountId: parsedAccountId.data, credentialDigest: digest(token) }
    : null;
}

function digest(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function base64Url(value: string): boolean {
  return /^[A-Za-z0-9_-]+$/u.test(value);
}
