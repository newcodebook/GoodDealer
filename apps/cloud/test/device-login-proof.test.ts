import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
} from "node:crypto";

import { describe, expect, it } from "vitest";

import type { AccountTransaction } from "../src/db/index";
import {
  PostgresDeviceLoginProof,
  desktopDeviceProofTranscript,
} from "../src/modules/devices/postgres-device-login-proof";

const seed = Buffer.alloc(32, 0x41);
const privateKey = createPrivateKey({
  key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]),
  format: "der",
  type: "pkcs8",
});
const publicKey = (createPublicKey(privateKey).export({ format: "der", type: "spki" }) as Buffer)
  .subarray(-32);
const accountSessionDigest = createHash("sha256").update("web-session").digest("base64url");

describe("Desktop device login proof", () => {
  it("refuses new challenge state when the account already has four pending attempts", async () => {
    const transaction = accountTransaction(async (text) => {
      if (text.includes("FROM device_account_states")) return rows([{ present: true }]);
      if (text.includes("DELETE FROM device_login_challenges")) {
        return { ...rows([]), command: "DELETE", rowCount: 0 };
      }
      if (text.includes("SELECT count(*) < 4 AS allowed")) return rows([{ allowed: false }]);
      throw new Error(`challenge limit should reject before query: ${text}`);
    });
    const service = new PostgresDeviceLoginProof({
      withAccount: async () => {
        throw new Error("exchange-time eligibility was not requested");
      },
    });
    await expect(service.issueLoginChallenge(transaction, {
      accountId: "account-a",
      deviceId: "device-a",
      keyId: "device-key-a",
      publicKey: publicKey.toString("base64url"),
      codeChallenge: "C".repeat(43),
      clientId: "gooddealer-desktop",
      redirectUri: "gooddealer://oauth/callback",
      accountSecurityEpoch: 4,
      accountSessionDigest,
      enrollmentAuthorizedUntil: null,
      evaluatedAt: new Date("2026-09-01T00:00:00Z"),
    })).resolves.toEqual({ issued: false });
  });

  it("stores only a nonce digest and consumes only an exact Ed25519 transcript", async () => {
    let challengeInsert: readonly unknown[] | undefined;
    let consumed = false;
    const transaction = accountTransaction(async (text, values) => {
      if (text.includes("FROM device_account_states")) return rows([{ present: true }]);
      if (text.includes("DELETE FROM device_login_challenges")) {
        return { ...rows([]), command: "DELETE", rowCount: 0 };
      }
      if (text.includes("SELECT count(*) < 4 AS allowed")) return rows([{ allowed: true }]);
      if (text.includes("FROM device_bindings b") && text.includes("LEFT JOIN device_signing_keys")) {
        return rows([{
          binding_status: "bound",
          key_id: "device-key-a",
          public_key: publicKey,
        }]);
      }
      if (text.includes("INSERT INTO device_login_challenges")) {
        challengeInsert = values;
        return rows([]);
      }
      if (text.includes("FROM device_login_challenges")) {
        if (!Buffer.from(accountSessionDigest, "base64url").equals(values?.[9] as Buffer)) {
          return rows([]);
        }
        return rows([{
          purpose: "login",
          key_id: "device-key-a",
          proposed_public_key: publicKey,
          nonce_digest: challengeInsert?.[6] as Buffer,
          expires_at: challengeInsert?.[13] as Date,
        }]);
      }
      if (text.includes("JOIN device_signing_keys k")) return rows([{ active: true }]);
      if (text.includes("UPDATE device_login_challenges")) {
        consumed = true;
        return { ...rows([]), command: "UPDATE", rowCount: 1 };
      }
      throw new Error(`unexpected query: ${text}`);
    });
    const service = new PostgresDeviceLoginProof({
      withAccount: async () => {
        throw new Error("exchange-time eligibility was not requested");
      },
    });
    const issued = await service.issueLoginChallenge(transaction, {
      accountId: "account-a",
      deviceId: "device-a",
      keyId: "device-key-a",
      publicKey: publicKey.toString("base64url"),
      codeChallenge: "C".repeat(43),
      clientId: "gooddealer-desktop",
      redirectUri: "gooddealer://oauth/callback",
      accountSecurityEpoch: 4,
      accountSessionDigest,
      enrollmentAuthorizedUntil: null,
      evaluatedAt: new Date("2026-09-01T00:00:00Z"),
    });
    expect(issued.issued).toBe(true);
    if (!issued.issued) throw new Error("challenge issuance failed");
    expect(challengeInsert?.[6]).toBeInstanceOf(Buffer);
    expect(challengeInsert?.[6]).not.toEqual(Buffer.from(issued.challenge.nonceDigest, "utf8"));
    expect(challengeInsert?.[7]).toEqual(Buffer.from(accountSessionDigest, "base64url"));

    const transcript = desktopDeviceProofTranscript({
      accountId: issued.challenge.accountId,
      deviceId: issued.challenge.deviceId,
      keyId: issued.challenge.keyId,
      challengeId: issued.challenge.challengeId,
      codeChallenge: "C".repeat(43),
      clientId: "gooddealer-desktop",
      redirectUri: "gooddealer://oauth/callback",
      nonceDigest: issued.challenge.nonceDigest,
      expiresAt: issued.challenge.expiresAt,
    });
    const base = {
      accountId: "account-a",
      deviceId: "device-a",
      keyId: "device-key-a",
      publicKey: publicKey.toString("base64url"),
      challengeId: issued.challenge.challengeId,
      codeChallenge: "C".repeat(43),
      clientId: "gooddealer-desktop",
      redirectUri: "gooddealer://oauth/callback",
      accountSecurityEpoch: 4,
      accountSessionDigest,
    } as const;
    await expect(service.verifyAndConsumeLoginProof(transaction, {
      ...base,
      accountSessionDigest: createHash("sha256").update("substituted-session").digest("base64url"),
      signature: sign(null, transcript, privateKey).toString("base64url"),
    })).resolves.toEqual({ verified: false });
    expect(consumed).toBe(false);
    await expect(service.verifyAndConsumeLoginProof(transaction, {
      ...base,
      signature: sign(null, Buffer.from("substituted"), privateKey).toString("base64url"),
    })).resolves.toEqual({ verified: false });
    expect(consumed).toBe(false);
    await expect(service.verifyAndConsumeLoginProof(transaction, {
      ...base,
      signature: sign(null, transcript, privateKey).toString("base64url"),
    })).resolves.toEqual({ verified: true });
    expect(consumed).toBe(true);
    expect(createHash("sha256").update(publicKey).digest()).toHaveLength(32);
  });

  it("requires recent Account Web authentication before enrolling an unbound device", async () => {
    const transaction = accountTransaction(async (text) => {
      if (text.includes("FROM device_account_states")) return rows([{ present: true }]);
      if (text.includes("DELETE FROM device_login_challenges")) {
        return { ...rows([]), command: "DELETE", rowCount: 0 };
      }
      if (text.includes("SELECT count(*) < 4 AS allowed")) return rows([{ allowed: true }]);
      if (text.includes("FROM device_bindings b") && text.includes("LEFT JOIN device_signing_keys")) {
        return rows([]);
      }
      throw new Error(`enrollment should fail before slot allocation: ${text}`);
    });
    const service = new PostgresDeviceLoginProof({
      withAccount: async () => {
        throw new Error("exchange-time eligibility was not requested");
      },
    });
    await expect(service.issueLoginChallenge(transaction, {
      accountId: "account-a",
      deviceId: "device-new",
      keyId: "device-key-new",
      publicKey: publicKey.toString("base64url"),
      codeChallenge: "C".repeat(43),
      clientId: "gooddealer-desktop",
      redirectUri: "gooddealer://oauth/callback",
      accountSecurityEpoch: 4,
      accountSessionDigest,
      enrollmentAuthorizedUntil: null,
      evaluatedAt: new Date("2026-09-01T00:00:00Z"),
    })).resolves.toEqual({ issued: false });
  });
});

function accountTransaction(
  query: (text: string, values?: readonly unknown[]) => Promise<unknown>,
): AccountTransaction {
  return { accountId: "account-a", query: query as AccountTransaction["query"] };
}

function rows<Row>(values: readonly Row[]) {
  return { command: "SELECT", rowCount: values.length, oid: 0, fields: [], rows: [...values] };
}
