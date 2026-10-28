import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { runCloudMigrations } from "../../src/db/index";
import { cloudMigrations } from "../../src/db/migrations";
import {
  Argon2idPasswordHashVerifier,
  IdentityAccountAccessService,
  IdentityEmailOutboxWorker,
  PostgresIdentityAccountAccessRepository,
  PostgresIdentitySessionVerificationReader,
} from "../../src/modules/identity/index";
import { clearLicensingTestData } from "../support/postgres-fixture";

const ownerPool = new Pool({ connectionString: requiredEnvironment("GOODDEALER_POSTGRES_OWNER_URL"), max: 1 });
const appPool = new Pool({ connectionString: requiredEnvironment("GOODDEALER_POSTGRES_APP_URL"), max: 4 });
const repository = new PostgresIdentityAccountAccessRepository(appPool);
const now = new Date("2099-09-04T00:00:00Z");

beforeAll(async () => { await runCloudMigrations(ownerPool, cloudMigrations); });
beforeEach(async () => {
  await clearLicensingTestData(ownerPool);
  // This suite may run after persistence suites that leave legitimate child
  // rows behind. Reset the workspace aggregate as one test-only unit so an
  // unrelated cursor cannot make account-access isolation order-dependent.
  await ownerPool.query("TRUNCATE workspace_revisions, workspace_workspaces CASCADE");
  await ownerPool.query("DELETE FROM identity_accounts");
});
afterAll(async () => Promise.all([ownerPool.end(), appPool.end()]));

function access(code = "123456", evaluatedAt = now) {
  return new IdentityAccountAccessService(repository, new Argon2idPasswordHashVerifier(), {
    verificationPepper: Buffer.alloc(32, 1), outboxKey: Buffer.alloc(32, 2),
    outboxKeyId: "postgres-test-v1", now: () => evaluatedAt, codes: () => code,
    accountOrigin: "https://account.gooddealer.com",
  });
}

describe("PostgreSQL account access", () => {
  it("atomically persists a digest and encrypted email, verifies once, then issues a live session only after login", async () => {
    const service = access();
    await expect(service.requestRegistration("owner@example.com", "correct horse battery staple"))
      .resolves.toEqual({ status: "accepted" });
    const stored = await ownerPool.query<{ digest: Buffer; ciphertext: Buffer }>(
      `SELECT challenge.challenge_digest AS digest, outbox.ciphertext
         FROM identity_registration_challenges challenge
         JOIN identity_email_outbox outbox USING (account_id)`,
    );
    expect(stored.rows[0]?.digest).toHaveLength(32);
    expect(stored.rows[0]?.ciphertext.toString("utf8")).not.toContain("123456");

    const deliver = vi.fn(async () => undefined);
    await expect(new IdentityEmailOutboxWorker(
      repository, { deliver }, Buffer.alloc(32, 2), "postgres-test-v1", () => now,
    ).runOnce()).resolves.toBe(true);
    expect(deliver).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: expect.any(String),
      message: expect.objectContaining({ text: expect.stringContaining("123456") }),
    }));

    const verified = await service.verifyRegistration("owner@example.com", "123456");
    expect(verified).toEqual({ status: "verified" });
    await expect(service.verifyRegistration("owner@example.com", "123456"))
      .resolves.toEqual({ status: "invalid" });
    const authenticated = await service.login("owner@example.com", "correct horse battery staple");
    expect(authenticated).toMatchObject({ status: "authenticated" });
    if (authenticated.status !== "authenticated") throw new Error("login did not issue session");
    await expect(new PostgresIdentitySessionVerificationReader(appPool)
      .readSessionVerification(authenticated.sessionCredential)).resolves.toMatchObject({
        clientKind: "account_web", familyState: "active", currentAccountSecurityEpoch: 1,
        expiresAt: "2099-10-04T00:00:00Z",
      });
    const workspace = await ownerPool.query<{ bindings: string; revisions: string }>(
      `SELECT
         (SELECT count(*)::text FROM workspace_account_bindings WHERE is_default) AS bindings,
         (SELECT count(*)::text FROM workspace_revisions) AS revisions`,
    );
    expect(workspace.rows[0]).toEqual({ bindings: "1", revisions: "1" });
  });

  it("enforces resend cooldown and locks a challenge after six failed attempts", async () => {
    const service = access();
    await service.requestRegistration("owner@example.com", "correct horse battery staple");
    await service.requestRegistration("owner@example.com", "different horse battery staple");
    const outbox = await ownerPool.query<{ count: string }>("SELECT count(*)::text AS count FROM identity_email_outbox");
    expect(outbox.rows[0]?.count).toBe("1");
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await expect(service.verifyRegistration("owner@example.com", "000000"))
        .resolves.toEqual({ status: "invalid" });
    }
    await expect(service.verifyRegistration("owner@example.com", "123456"))
      .resolves.toEqual({ status: "invalid" });
  });

  it("rejects expired challenges and repeated registration without exposing an existing verified email", async () => {
    await access().requestRegistration("owner@example.com", "correct horse battery staple");
    const afterExpiry = access("123456", new Date(now.getTime() + 16 * 60_000));
    await expect(afterExpiry.verifyRegistration("owner@example.com", "123456"))
      .resolves.toEqual({ status: "invalid" });
    const staleDelivery = vi.fn(async () => undefined);
    await expect(new IdentityEmailOutboxWorker(
      repository, { deliver: staleDelivery }, Buffer.alloc(32, 2), "postgres-test-v1",
      () => new Date(now.getTime() + 16 * 60_000),
    ).runOnce()).resolves.toBe(false);
    expect(staleDelivery).not.toHaveBeenCalled();
    const validResend = access("654321", new Date(now.getTime() + 17 * 60_000));
    await validResend.resendRegistration("owner@example.com");
    await validResend.verifyRegistration("owner@example.com", "654321");
    await expect(validResend.requestRegistration("owner@example.com", "another valid password value"))
      .resolves.toEqual({ status: "accepted" });
    const state = await ownerPool.query<{ accounts: string; pending: string }>(
      `SELECT (SELECT count(*)::text FROM identity_accounts WHERE email_normalized = 'owner@example.com') AS accounts,
              (SELECT count(*)::text FROM identity_email_outbox WHERE state IN ('pending', 'sending')) AS pending`,
    );
    expect(state.rows[0]).toEqual({ accounts: "1", pending: "0" });
  });

  it("authenticates a verified account and returns one indistinguishable rejection for unknown or wrong credentials", async () => {
    const service = access();
    await service.requestRegistration("owner@example.com", "correct horse battery staple");
    await service.verifyRegistration("owner@example.com", "123456");
    await expect(service.login("owner@example.com", "correct horse battery staple"))
      .resolves.toMatchObject({ status: "authenticated" });
    await expect(service.login("owner@example.com", "wrong password value"))
      .resolves.toEqual({ status: "invalid" });
    await expect(service.login("missing@example.com", "wrong password value"))
      .resolves.toEqual({ status: "invalid" });
  });

  it("rolls back verification, account activation, and default workspace creation as one transaction", async () => {
    const service = access();
    await service.requestRegistration("owner@example.com", "correct horse battery staple");
    const target = await ownerPool.query<{ account_id: string; password_policy_id: string; password_hash_phc: string }>(
      "SELECT account_id, password_policy_id, password_hash_phc FROM identity_accounts WHERE email_normalized = 'owner@example.com'",
    );
    const row = target.rows[0];
    if (row === undefined) throw new Error("registration account missing");
    await ownerPool.query(
      `INSERT INTO identity_accounts
         (account_id, email_normalized, email_verified_at, password_policy_id, password_hash_phc)
       VALUES ('account-conflict', 'conflict@example.com', transaction_timestamp(), $1, $2)`,
      [row.password_policy_id, row.password_hash_phc],
    );
    await ownerPool.query(
      "INSERT INTO workspace_workspaces (workspace_id, account_id, kind, name) VALUES ('workspace-conflict', 'account-conflict', 'personal', 'Conflict')",
    );
    await ownerPool.query(
      "UPDATE identity_registration_challenges SET workspace_id = 'workspace-conflict' WHERE account_id = $1",
      [row.account_id],
    );
    await expect(service.verifyRegistration("owner@example.com", "123456")).rejects.toMatchObject({ code: "23505" });
    const state = await ownerPool.query<{
      verified: boolean; consumed: boolean; device_count: string; binding_count: string; revision_count: string;
    }>(
      `SELECT account.email_verified_at IS NOT NULL AS verified,
              challenge.consumed_at IS NOT NULL AS consumed,
              (SELECT count(*)::text FROM device_account_states WHERE account_id = account.account_id) AS device_count,
              (SELECT count(*)::text FROM workspace_account_bindings WHERE account_id = account.account_id) AS binding_count,
              (SELECT count(*)::text FROM workspace_revisions WHERE account_id = account.account_id) AS revision_count
         FROM identity_accounts AS account
         JOIN identity_registration_challenges AS challenge USING (account_id)
        WHERE account.account_id = $1`,
      [row.account_id],
    );
    expect(state.rows[0]).toEqual({
      verified: false, consumed: false, device_count: "0", binding_count: "0", revision_count: "0",
    });
  });

  it("serializes concurrent registration and verification without duplicate accounts or workspaces", async () => {
    const service = access();
    await Promise.all([
      service.requestRegistration("Owner@Example.com", "correct horse battery staple"),
      service.requestRegistration("owner@example.com", "different horse battery staple"),
    ]);
    const registration = await ownerPool.query<{ accounts: string; challenges: string; pending_email: string }>(
      `SELECT
         (SELECT count(*)::text FROM identity_accounts WHERE email_normalized = 'owner@example.com') AS accounts,
         (SELECT count(*)::text FROM identity_registration_challenges) AS challenges,
         (SELECT count(*)::text FROM identity_email_outbox WHERE state IN ('pending', 'sending')) AS pending_email`,
    );
    expect(registration.rows[0]).toEqual({ accounts: "1", challenges: "1", pending_email: "1" });
    const attempts = await Promise.all([
      service.verifyRegistration("owner@example.com", "123456"),
      service.verifyRegistration("owner@example.com", "123456"),
    ]);
    expect(attempts.map((result) => result.status).sort()).toEqual(["invalid", "verified"]);
    const workspace = await ownerPool.query<{ workspaces: string; bindings: string; revisions: string }>(
      `SELECT (SELECT count(*)::text FROM workspace_workspaces) AS workspaces,
              (SELECT count(*)::text FROM workspace_account_bindings) AS bindings,
              (SELECT count(*)::text FROM workspace_revisions) AS revisions`,
    );
    expect(workspace.rows[0]).toEqual({ workspaces: "1", bindings: "1", revisions: "1" });
  });

  it("supersedes stale verification mail, retries temporary delivery failure, and keeps responses enumeration-safe", async () => {
    const first = access("123456");
    await first.requestRegistration("owner@example.com", "correct horse battery staple");
    const failure = new IdentityEmailOutboxWorker(
      repository, { deliver: vi.fn(async () => { throw new Error("temporary provider failure"); }) },
      Buffer.alloc(32, 2), "postgres-test-v1", () => now,
    );
    await expect(failure.runOnce()).rejects.toThrow(/temporary provider failure/u);
    const retry = await ownerPool.query<{ state: string; attempts: number; last_failure_at: Date | null }>(
      "SELECT state, attempts, last_failure_at FROM identity_email_outbox",
    );
    expect(retry.rows[0]).toMatchObject({ state: "pending", attempts: 1 });
    expect(retry.rows[0]?.last_failure_at).toBeInstanceOf(Date);

    const later = new Date(now.getTime() + 61_000);
    const second = new IdentityAccountAccessService(repository, new Argon2idPasswordHashVerifier(), {
      verificationPepper: Buffer.alloc(32, 1), outboxKey: Buffer.alloc(32, 2), outboxKeyId: "postgres-test-v1",
      now: () => later, codes: () => "654321", accountOrigin: "https://account.gooddealer.com",
    });
    await expect(second.resendRegistration("owner@example.com")).resolves.toEqual({ status: "accepted" });
    await expect(second.resendRegistration("missing@example.com")).resolves.toEqual({ status: "accepted" });
    const rows = await ownerPool.query<{ state: string; challenge: Buffer }>(
      "SELECT state, challenge_digest AS challenge FROM identity_email_outbox ORDER BY created_at, outbox_id",
    );
    expect(rows.rows.map((item) => item.state).sort()).toEqual(["pending", "superseded"]);
    await expect(second.verifyRegistration("owner@example.com", "123456")).resolves.toEqual({ status: "invalid" });
    await expect(second.verifyRegistration("owner@example.com", "654321")).resolves.toEqual({ status: "verified" });
  });

  it("dead-letters an email after the bounded twentieth provider failure", async () => {
    const service = access();
    await service.requestRegistration("owner@example.com", "correct horse battery staple");
    await ownerPool.query("UPDATE identity_email_outbox SET attempts = 19");
    const worker = new IdentityEmailOutboxWorker(
      repository, { deliver: vi.fn(async () => { throw new Error("provider unavailable"); }) },
      Buffer.alloc(32, 2), "postgres-test-v1", () => now,
    );
    await expect(worker.runOnce()).rejects.toThrow(/provider unavailable/u);
    const state = await ownerPool.query<{ state: string; attempts: number; failed_at: Date | null }>(
      "SELECT state, attempts, failed_at FROM identity_email_outbox",
    );
    expect(state.rows[0]).toMatchObject({ state: "failed", attempts: 20 });
    expect(state.rows[0]?.failed_at).toBeInstanceOf(Date);
    await expect(worker.runOnce()).resolves.toBe(false);
  });

  it("resets a password once, advances the security epoch, and immediately revokes every old session", async () => {
    const registration = access("123456");
    await registration.requestRegistration("owner@example.com", "correct horse battery staple");
    await registration.verifyRegistration("owner@example.com", "123456");
    const oldSession = await registration.login("owner@example.com", "correct horse battery staple");
    if (oldSession.status !== "authenticated") throw new Error("old session missing");
    const reset = access("654321");
    await expect(reset.requestPasswordReset("missing@example.com")).resolves.toEqual({ status: "accepted" });
    await expect(reset.requestPasswordReset("owner@example.com")).resolves.toEqual({ status: "accepted" });
    await expect(reset.resetPassword("owner@example.com", "000000", "replacement horse battery staple"))
      .resolves.toEqual({ status: "invalid" });
    await expect(reset.resetPassword("owner@example.com", "654321", "replacement horse battery staple"))
      .resolves.toEqual({ status: "completed" });
    await expect(reset.resetPassword("owner@example.com", "654321", "another replacement password"))
      .resolves.toEqual({ status: "invalid" });
    await expect(registration.login("owner@example.com", "correct horse battery staple"))
      .resolves.toEqual({ status: "invalid" });
    await expect(reset.login("owner@example.com", "replacement horse battery staple"))
      .resolves.toMatchObject({ status: "authenticated" });
    await expect(new PostgresIdentitySessionVerificationReader(appPool)
      .readSessionVerification(oldSession.sessionCredential)).resolves.toMatchObject({
        familyState: "revoked", currentAccountSecurityEpoch: 2,
      });
  });

  it("rotates a presented login session, then revokes the replacement on logout", async () => {
    const service = access();
    await service.requestRegistration("owner@example.com", "correct horse battery staple");
    await service.verifyRegistration("owner@example.com", "123456");
    const loggedIn = await service.login("owner@example.com", "correct horse battery staple");
    if (loggedIn.status !== "authenticated") throw new Error("session missing");
    const account = await repository.findExactAccount("owner@example.com");
    if (account === null) throw new Error("account missing");
    const replacement = await service.login("owner@example.com", "correct horse battery staple", {
      accountId: account.accountId,
      sessionId: loggedIn.sessionCredential,
    });
    if (replacement.status !== "authenticated") throw new Error("replacement session missing");
    await expect(new PostgresIdentitySessionVerificationReader(appPool)
      .readSessionVerification(loggedIn.sessionCredential)).resolves.toMatchObject({ familyState: "revoked" });
    await expect(new PostgresIdentitySessionVerificationReader(appPool)
      .readSessionVerification(replacement.sessionCredential)).resolves.toMatchObject({ familyState: "active" });
    await expect(service.logout({ accountId: account.accountId, sessionId: replacement.sessionCredential }))
      .resolves.toEqual({ status: "signed_out" });
    await expect(new PostgresIdentitySessionVerificationReader(appPool)
      .readSessionVerification(replacement.sessionCredential)).resolves.toMatchObject({ familyState: "revoked" });
  });
});

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) throw new Error(`${name} is required`);
  return value;
}
