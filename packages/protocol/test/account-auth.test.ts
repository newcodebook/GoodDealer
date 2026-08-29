import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  accountSessionListSchema,
  accountSessionRevokeRequestSchema,
  authLoginRequestSchema,
  authRefreshRequestSchema,
  authSessionStatusSchema,
  authSignOutRequestSchema,
  accountOperationSchema,
  reauthProofRefSchema,
} from "../src/account/index";
import { displayLabel } from "../src/wire/index";

const vectors = resolve(import.meta.dirname, "../test-vectors/account");

function vector(path: string): unknown {
  return JSON.parse(readFileSync(resolve(vectors, path), "utf8"));
}

const validCases = [
  ["auth-session-authenticated.json", authSessionStatusSchema],
  ["auth-session-signed-out.json", authSessionStatusSchema],
  ["auth-session-revoked.json", authSessionStatusSchema],
  ["auth-session-refresh-required.json", authSessionStatusSchema],
  ["login-request.json", authLoginRequestSchema],
  ["refresh-request.json", authRefreshRequestSchema],
  ["sign-out-this-device.json", authSignOutRequestSchema],
  ["sign-out-all-devices.json", authSignOutRequestSchema],
  ["reauth-proof-ref.json", reauthProofRefSchema],
  ["session-list.json", accountSessionListSchema],
  ["session-revoke-single.json", accountSessionRevokeRequestSchema],
  ["session-revoke-all-other.json", accountSessionRevokeRequestSchema],
] as const;

const invalidCases = [
  ["auth-session-signed-out-with-account.json", authSessionStatusSchema],
  ["auth-session-authenticated-missing-epoch.json", authSessionStatusSchema],
  ["auth-session-revocation-reason-without-revoked.json", authSessionStatusSchema],
  ["auth-session-authenticated-without-expiry.json", authSessionStatusSchema],
  ["auth-session-unknown-field.json", authSessionStatusSchema],
  ["auth-session-unknown-version.json", authSessionStatusSchema],
  ["auth-session-snake-case-wire.json", authSessionStatusSchema],
  ["auth-session-unsafe-epoch.json", authSessionStatusSchema],
  ["reauth-proof-inverted-window.json", reauthProofRefSchema],
  ["sign-out-this-device-with-reauth-proof.json", authSignOutRequestSchema],
  ["sign-out-all-devices-missing-reauth-proof.json", authSignOutRequestSchema],
  ["session-summary-web-with-device-id.json", accountSessionListSchema],
  ["session-summary-desktop-without-device-id.json", accountSessionListSchema],
  ["session-summary-revoked-without-timestamp.json", accountSessionListSchema],
  ["session-summary-revoked-current.json", accountSessionListSchema],
  ["session-list-duplicate-session-id.json", accountSessionListSchema],
  ["session-list-two-current.json", accountSessionListSchema],
  ["session-display-name-control-character.json", accountSessionListSchema],
] as const;

describe("account auth and session contracts", () => {
  for (const [path, schema] of validCases) {
    it(`accepts valid/${path}`, () => {
      expect(schema.safeParse(vector(`valid/${path}`)).success).toBe(true);
    });
  }

  for (const [path, schema] of invalidCases) {
    it(`rejects invalid/${path}`, () => {
      expect(schema.safeParse(vector(`invalid/${path}`)).success).toBe(false);
    });
  }

  it("rejects untrimmed display labels (INV-1)", () => {
    expect(displayLabel.safeParse(" untrimmed").success).toBe(false);
    expect(displayLabel.safeParse("untrimmed ").success).toBe(false);
  });

  it("freezes the nine account operation names", () => {
    expect(accountOperationSchema.options).toEqual([
      "account.activation.activate",
      "account.session.login",
      "account.session.refresh",
      "account.session.signOut",
      "account.session.status",
      "account.sessions.list",
      "account.sessions.revoke",
      "account.entitlement.status",
      "account.gate.status",
    ]);
  });
});
