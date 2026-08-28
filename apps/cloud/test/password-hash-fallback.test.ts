import { describe, expect, it } from "vitest";

import { InternalPasswordLoginCommandService } from "../src/modules/identity/login-command";
import {
  ARGON2ID_V1_DECOY_PHC,
  Argon2idPasswordHashVerifier,
  ConsumeOncePassword,
  DenyingPasswordHashPort,
  hashFixturePassword,
  isArgon2idV1Phc,
  type PasswordHashPort,
  type StoredPasswordHash,
} from "../src/modules/identity/password-hash-port";

const command = (emailNormalized: string, secret: string) => ({
  schemaVersion: 1,
  method: "password",
  deviceId: "fixture-device-active",
  rememberDevice: true,
  emailNormalized,
  secret,
});

describe("P0-19 Argon2id password boundary", () => {
  it("freezes Argon2id v19 m=65536 t=3 p=1 salt16 hash32 and rejects parameter drift", async () => {
    const stored = await hashFixturePassword("known-password");
    expect(isArgon2idV1Phc(stored.phc)).toBe(true);
    expect(isArgon2idV1Phc(stored.phc.replace("m=65536", "m=32768"))).toBe(false);
    expect(isArgon2idV1Phc(stored.phc.replace("argon2id", "argon2i"))).toBe(false);
    expect(isArgon2idV1Phc(stored.phc.replace("v=19", "v=16"))).toBe(false);

    const verifier = new Argon2idPasswordHashVerifier();
    const correct = ConsumeOncePassword.fromUnknown("known-password");
    const wrong = ConsumeOncePassword.fromUnknown("wrong-password");
    if (correct === null || wrong === null) throw new Error("test password parse failed");
    await expect(verifier.checkPasswordHash(correct, stored.phc)).resolves.toEqual({ verified: true });
    await expect(verifier.checkPasswordHash(wrong, stored.phc)).resolves.toEqual({
      verified: false,
      reason: "invalid_credentials",
    });
    expect(correct.consumedBytesAreZeroed()).toBe(true);
    expect(wrong.consumedBytesAreZeroed()).toBe(true);
  });

  it("consumes and zeroes owned bytes on verifier failure while redacting serialization", async () => {
    const candidate = ConsumeOncePassword.fromUnknown("unique-password-canary");
    if (candidate === null) throw new Error("test password parse failed");
    const verifier: PasswordHashPort = {
      async checkPasswordHash(value) {
        await expect(value.consume(async () => { throw new Error("verifier-fault"); }))
          .rejects.toThrow("verifier-fault");
        return { verified: false, reason: "invalid_credentials" };
      },
    };
    await verifier.checkPasswordHash(candidate, ARGON2ID_V1_DECOY_PHC);
    expect(candidate.consumedBytesAreZeroed()).toBe(true);
    expect(JSON.stringify(candidate)).toBe('"[REDACTED]"');
  });

  it("runs known, unknown, and malformed hashes through one policy-matching verification", async () => {
    const stored: StoredPasswordHash = await hashFixturePassword("correct-password");
    const calls: string[] = [];
    const hashPort: PasswordHashPort = {
      async checkPasswordHash(candidate, phc) {
        calls.push(phc);
        await candidate.consume(async () => undefined);
        return { verified: false, reason: "invalid_credentials" };
      },
    };
    const services = [
      new InternalPasswordLoginCommandService(
        [{ emailNormalized: "known@example.com", storedPasswordHash: stored, emailVerified: true }], hashPort),
      new InternalPasswordLoginCommandService([], hashPort),
      new InternalPasswordLoginCommandService(
        [{ emailNormalized: "broken@example.com", storedPasswordHash: { ...stored, phc: "malformed" }, emailVerified: true }], hashPort),
    ];
    const results = await Promise.all([
      services[0]?.execute(command("known@example.com", "wrong-secret-canary")),
      services[1]?.execute(command("unknown@example.com", "wrong-secret-canary")),
      services[2]?.execute(command("broken@example.com", "wrong-secret-canary")),
    ]);
    expect(calls).toHaveLength(3);
    expect(calls.every(isArgon2idV1Phc)).toBe(true);
    expect(calls.slice(1)).toEqual([ARGON2ID_V1_DECOY_PHC, ARGON2ID_V1_DECOY_PHC]);
    expect(new Set(results.map((result) => JSON.stringify(result))).size).toBe(1);
    expect(JSON.stringify(results)).not.toContain("secret-canary");
  });

  it("keeps the Denying implementation as the default and rejects invalid secret boundaries", async () => {
    const candidate = ConsumeOncePassword.fromUnknown("candidate");
    if (candidate === null) throw new Error("test password parse failed");
    await expect(new DenyingPasswordHashPort().checkPasswordHash(candidate, ARGON2ID_V1_DECOY_PHC))
      .resolves.toEqual({ verified: false, reason: "password_verification_disabled" });
    expect(candidate.consumedBytesAreZeroed()).toBe(true);
    expect(ConsumeOncePassword.fromUnknown("x".repeat(1_025))).toBeNull();
    expect(ConsumeOncePassword.fromUnknown("\ud800")).toBeNull();
  });

  it("rejects inherited, accessor, missing-own, symbol, and custom-prototype fields before verification", async () => {
    let calls = 0;
    let accessorReads = 0;
    const verifier: PasswordHashPort = {
      async checkPasswordHash(candidate) {
        calls += 1;
        await candidate.consume(async () => undefined);
        return { verified: false, reason: "invalid_credentials" };
      },
    };
    const service = new InternalPasswordLoginCommandService([], verifier);
    const valid = command("unknown@example.com", "prototype-secret-canary");
    const inherited = Object.create(valid) as Record<string, unknown>;
    const missingOwn = { ...valid } as Record<string, unknown>;
    delete missingOwn.secret;
    Object.setPrototypeOf(missingOwn, { secret: valid.secret });
    const accessor = { ...valid } as Record<string, unknown>;
    Object.defineProperty(accessor, "secret", {
      enumerable: true,
      get() {
        accessorReads += 1;
        return valid.secret;
      },
    });
    const symbolField = { ...valid, [Symbol("secret")]: valid.secret };
    const customPrototype = Object.assign(Object.create({ polluted: true }), valid) as unknown;

    for (const input of [inherited, missingOwn, accessor, symbolField, customPrototype]) {
      await expect(service.execute(input)).resolves.toEqual({ code: "SCHEMA_INVALID" });
    }
    expect(accessorReads).toBe(0);
    expect(calls).toBe(0);
  });
});
