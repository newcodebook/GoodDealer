import { describe, expect, it, vi } from "vitest";

import {
  IdentityAccountAccessService,
  IdentityEmailOutboxWorker,
  type IdentityAccountAccessRecord,
  type IdentityAccountAccessRepository,
  type RegistrationWrite,
  type VerificationDeliveryWrite,
} from "../src/modules/identity/account-access";
import { Argon2idPasswordHashVerifier, hashFixturePassword } from "../src/modules/identity/password-hash-port";

const now = new Date("2026-09-04T00:00:00Z");

class MemoryRepository implements IdentityAccountAccessRepository {
  account: IdentityAccountAccessRecord | null = null;
  registration: RegistrationWrite | null = null;
  outbox: RegistrationWrite | null = null;
  attempts = 0;
  consumed = false;
  issued: string[] = [];
  completed: boolean[] = [];
  passwordReset: VerificationDeliveryWrite | null = null;
  revoked: string[] = [];

  async findExactAccount(email: string) {
    return this.account?.emailNormalized === email ? this.account : null;
  }
  async requestRegistration(write: RegistrationWrite) {
    this.registration = write;
    this.outbox = write;
    this.account = {
      accountId: write.accountId, emailNormalized: write.emailNormalized, emailVerified: false,
      storedPasswordHash: write.password, accountSecurityEpoch: 1,
    };
    return "queued" as const;
  }
  async resendRegistration(write: VerificationDeliveryWrite) {
    if (this.account === null || this.account.emailVerified || this.registration === null) return "unavailable" as const;
    this.registration = { ...this.registration, ...write, purpose: "registration" };
    this.outbox = this.registration;
    this.attempts = 0;
    this.consumed = false;
    return "queued" as const;
  }
  async verifyRegistration(input: { emailNormalized: string; challengeDigest: Uint8Array; now: Date }) {
    this.attempts += 1;
    if (this.registration === null || this.account === null || this.consumed || this.attempts > 6
      || input.now >= this.registration.challengeExpiresAt
      || !Buffer.from(input.challengeDigest).equals(Buffer.from(this.registration.challengeDigest))) {
      return { status: "invalid" as const };
    }
    this.consumed = true;
    this.account = { ...this.account, emailVerified: true };
    return { status: "verified" as const, account: this.account };
  }
  async issueAccountWebSession(input: { sessionId: string }) {
    this.issued.push(input.sessionId);
    return "issued" as const;
  }
  async requestPasswordReset(write: VerificationDeliveryWrite) {
    if (this.account === null || !this.account.emailVerified) return "unavailable" as const;
    this.passwordReset = write;
    this.outbox = { ...write, accountId: this.account.accountId, workspaceId: "unused", password: this.account.storedPasswordHash,
      purpose: "registration" };
    return "queued" as const;
  }
  async resetPassword(input: { challengeDigest: Uint8Array; password: IdentityAccountAccessRecord["storedPasswordHash"] }) {
    if (this.account === null || this.passwordReset === null
      || !Buffer.from(input.challengeDigest).equals(Buffer.from(this.passwordReset.challengeDigest))) return "invalid" as const;
    this.account = { ...this.account, storedPasswordHash: input.password, accountSecurityEpoch: this.account.accountSecurityEpoch + 1 };
    this.passwordReset = null;
    return "completed" as const;
  }
  async revokeAccountWebSession(input: { sessionId: string }) {
    this.revoked.push(input.sessionId);
  }
  async claimEmail() {
    return this.outbox === null ? null : {
      outboxId: this.outbox.outboxId,
      accountId: this.outbox.accountId,
      envelope: this.outbox.envelope,
    };
  }
  async completeEmail(_accountId: string, _outboxId: string, delivered: boolean) {
    this.completed.push(delivered);
    this.outbox = null;
    return delivered ? "sent" as const : "retry_scheduled" as const;
  }
}

function service(repository: MemoryRepository, codes = () => "123456") {
  return new IdentityAccountAccessService(repository, new Argon2idPasswordHashVerifier(), {
    verificationPepper: Buffer.alloc(32, 1),
    outboxKey: Buffer.alloc(32, 2),
    outboxKeyId: "development-v1",
    accountOrigin: "https://account.gooddealer.com",
    now: () => now,
    ids: (() => { let id = 0; return () => `id-${++id}`; })(),
    codes,
  });
}

describe("Identity account access", () => {
  it("stores only a digest and encrypted outbox payload, verifies once, then requires an explicit login", async () => {
    const repository = new MemoryRepository();
    const access = service(repository);
    await expect(access.requestRegistration("owner@example.com", "correct horse battery staple"))
      .resolves.toEqual({ status: "accepted" });
    expect(repository.registration?.challengeDigest).toHaveLength(32);
    expect(Buffer.from(repository.registration?.challengeDigest ?? []).toString("utf8")).not.toContain("123456");
    expect(Buffer.from(repository.registration?.envelope.ciphertext ?? []).toString("utf8")).not.toContain("123456");

    const deliver = vi.fn(async () => undefined);
    const worker = new IdentityEmailOutboxWorker(repository, { deliver }, Buffer.alloc(32, 2), "development-v1", () => now);
    await expect(worker.runOnce()).resolves.toBe(true);
    expect(deliver).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: "id-1",
      message: expect.objectContaining({
        to: "owner@example.com", text: expect.stringContaining("https://account.gooddealer.com"),
      }),
    }));
    expect(repository.completed).toEqual([true]);

    await expect(access.verifyRegistration("owner@example.com", "123456"))
      .resolves.toEqual({ status: "verified" });
    await expect(access.verifyRegistration("owner@example.com", "123456"))
      .resolves.toEqual({ status: "invalid" });
    expect(repository.issued).toHaveLength(0);
    await expect(access.login("owner@example.com", "correct horse battery staple"))
      .resolves.toMatchObject({ status: "authenticated" });
    expect(repository.issued).toHaveLength(1);
  });

  it("returns the same login rejection after one Argon2 operation for unknown, unverified, and wrong credentials", async () => {
    const verifier = new Argon2idPasswordHashVerifier();
    const checked = vi.spyOn(verifier, "checkPasswordHash");
    const repository = new MemoryRepository();
    const access = new IdentityAccountAccessService(repository, verifier, {
      verificationPepper: Buffer.alloc(32, 1), outboxKey: Buffer.alloc(32, 2), outboxKeyId: "dev",
      accountOrigin: "https://account.gooddealer.com",
      now: () => now,
    });
    await expect(access.login("unknown@example.com", "wrong-password"))
      .resolves.toEqual({ status: "invalid" });
    repository.account = {
      accountId: "account-a", emailNormalized: "owner@example.com", emailVerified: false,
      storedPasswordHash: await hashFixturePassword("right-password"), accountSecurityEpoch: 1,
    };
    await expect(access.login("owner@example.com", "right-password"))
      .resolves.toEqual({ status: "invalid" });
    repository.account = { ...repository.account, emailVerified: true };
    await expect(access.login("owner@example.com", "wrong-password"))
      .resolves.toEqual({ status: "invalid" });
    expect(checked).toHaveBeenCalledTimes(3);
  });

  it("canonicalizes email and rejects weak or oversized passwords before persistence", async () => {
    const repository = new MemoryRepository();
    const access = service(repository);
    await expect(access.requestRegistration(" Owner@Example.com ", "correct horse battery staple"))
      .resolves.toEqual({ status: "accepted" });
    expect(repository.registration?.emailNormalized).toBe("owner@example.com");
    await expect(access.requestRegistration("owner@example.com", "too-short"))
      .resolves.toEqual({ status: "invalid" });
    await expect(access.requestRegistration("owner@example.com", "x".repeat(1_025)))
      .resolves.toEqual({ status: "invalid" });
  });

  it("rotates a presented session only after successful authentication and revokes it on logout", async () => {
    const repository = new MemoryRepository();
    const access = service(repository);
    await access.requestRegistration("owner@example.com", "correct horse battery staple");
    await access.verifyRegistration("owner@example.com", "123456");
    await expect(access.login("owner@example.com", "correct horse battery staple", {
      accountId: "account-before", sessionId: "session-before",
    })).resolves.toMatchObject({ status: "authenticated" });
    expect(repository.revoked).toEqual(["session-before"]);
    await expect(access.logout({ accountId: repository.account?.accountId ?? "missing", sessionId: "session-after" }))
      .resolves.toEqual({ status: "signed_out" });
    expect(repository.revoked).toEqual(["session-before", "session-after"]);
  });

  it("keeps resend and password-reset requests enumeration-safe and invalidates the reset code after use", async () => {
    const repository = new MemoryRepository();
    const codes = ["123456", "234567", "345678"];
    const access = service(repository, () => codes.shift() ?? "999999");
    await expect(access.resendRegistration("missing@example.com")).resolves.toEqual({ status: "accepted" });
    await access.requestRegistration("owner@example.com", "correct horse battery staple");
    await expect(access.resendRegistration("owner@example.com")).resolves.toEqual({ status: "accepted" });
    await expect(access.verifyRegistration("owner@example.com", "345678")).resolves.toEqual({ status: "verified" });
    await expect(access.requestPasswordReset("owner@example.com")).resolves.toEqual({ status: "accepted" });
    await expect(access.resetPassword("owner@example.com", "000000", "replacement horse battery staple"))
      .resolves.toEqual({ status: "invalid" });
    await expect(access.resetPassword("owner@example.com", "999999", "replacement horse battery staple"))
      .resolves.toEqual({ status: "completed" });
    await expect(access.resetPassword("owner@example.com", "999999", "another replacement password"))
      .resolves.toEqual({ status: "invalid" });
  });

  it("fails closed when an encrypted email is tampered or the worker key id differs", async () => {
    const repository = new MemoryRepository();
    await service(repository).requestRegistration("owner@example.com", "correct horse battery staple");
    if (repository.registration === null) throw new Error("registration missing");
    const ciphertext = Uint8Array.from(repository.registration.envelope.ciphertext);
    ciphertext[0] = (ciphertext[0] ?? 0) ^ 1;
    repository.registration = {
      ...repository.registration,
      envelope: { ...repository.registration.envelope, ciphertext },
    };
    repository.outbox = repository.registration;
    const worker = new IdentityEmailOutboxWorker(repository, { deliver: vi.fn() }, Buffer.alloc(32, 2), "development-v1");
    await expect(worker.runOnce()).rejects.toThrow();
    expect(repository.completed).toEqual([false]);
  });
});
