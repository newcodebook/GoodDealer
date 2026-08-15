import { describe, expect, it } from "vitest";

import { InternalPasswordLoginCommandService } from "../src/modules/identity/login-command";
import {
  DenyingPasswordHashPort,
  type PasswordHashPort,
  type StoredPasswordHash,
} from "../src/modules/identity/password-hash-port";

type PasswordHashResult = Awaited<ReturnType<PasswordHashPort["checkPasswordHash"]>>;
type Assert<T extends true> = T;
type PasswordSuccessIsUnrepresentable = Assert<
  Extract<PasswordHashResult, { readonly verified: true }> extends never ? true : false
>;
const passwordSuccessIsUnrepresentable: PasswordSuccessIsUnrepresentable = true;

const storedPasswordHash: StoredPasswordHash = {
  algorithm: "argon2id",
  params: { memoryKiB: 65_536, iterations: 3, parallelism: 1 },
  salt: "c2FsdA",
  hash: "aGFzaA",
};

const command = (emailNormalized: string, secret: string) => ({
  schemaVersion: 1,
  method: "password",
  deviceId: "fixture-device-active",
  rememberDevice: true,
  emailNormalized,
  secret,
});

describe("P0-19 password hashing fallback", () => {
  it("makes a successful DenyingPasswordHashPort verdict structurally unrepresentable", async () => {
    expect(passwordSuccessIsUnrepresentable).toBe(true);
    expect(await new DenyingPasswordHashPort().checkPasswordHash("candidate", storedPasswordHash)).toEqual({
      verified: false,
      reason: "password_verification_disabled",
    });
  });

  it("runs known and unknown accounts through the same hash boundary and returns byte-identical failures", async () => {
    const calls: StoredPasswordHash[] = [];
    const hashPort: PasswordHashPort = {
      async checkPasswordHash(_candidate, stored) {
        calls.push(stored);
        return { verified: false, reason: "password_verification_disabled" };
      },
    };
    const service = new InternalPasswordLoginCommandService(
      [{ emailNormalized: "known@example.com", storedPasswordHash, emailVerified: true }],
      hashPort,
    );

    const known = await service.execute(command("known@example.com", "wrong-secret-canary"));
    const unknown = await service.execute(command("unknown@example.com", "unknown-secret-canary"));

    expect(JSON.stringify(known)).toBe(JSON.stringify(unknown));
    expect(calls).toHaveLength(2);
    expect(calls[0]).toBe(storedPasswordHash);
    expect(calls[1]).not.toBe(storedPasswordHash);
    expect(JSON.stringify([known, unknown])).not.toContain("secret-canary");
  });

  it("rejects non-normalized or extra-field commands before hashing without reflecting credential input", async () => {
    let calls = 0;
    const hashPort: PasswordHashPort = {
      async checkPasswordHash() {
        calls += 1;
        return { verified: false, reason: "password_verification_disabled" };
      },
    };
    const service = new InternalPasswordLoginCommandService([], hashPort);
    const secret = "schema-secret-canary";

    const nonNormalized = await service.execute(command(" User@Example.com ", secret));
    const extraField = await service.execute({ ...command("user@example.com", secret), debug: true });

    expect(nonNormalized).toMatchObject({ code: "SCHEMA_INVALID" });
    expect(extraField).toMatchObject({ code: "SCHEMA_INVALID" });
    expect(JSON.stringify([nonNormalized, extraField])).not.toContain(secret);
    expect(calls).toBe(0);
  });
});
