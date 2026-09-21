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
const now = new Date("2026-09-04T00:00:00Z");

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

function access(code = "123456") {
  return new IdentityAccountAccessService(repository, new Argon2idPasswordHashVerifier(), {
    verificationPepper: Buffer.alloc(32, 1), outboxKey: Buffer.alloc(32, 2),
    outboxKeyId: "postgres-test-v1", now: () => now, codes: () => code,
  });
}

describe("PostgreSQL account access", () => {
  it("atomically persists a digest and encrypted email, verifies once, and issues a live account-web session", async () => {
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
    expect(deliver).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining("123456") }));

    const verified = await service.verifyRegistration("owner@example.com", "123456");
    expect(verified).toMatchObject({ status: "authenticated" });
    if (verified.status !== "authenticated") throw new Error("verification did not issue session");
    await expect(service.verifyRegistration("owner@example.com", "123456"))
      .resolves.toEqual({ status: "invalid" });
    await expect(new PostgresIdentitySessionVerificationReader(appPool)
      .readSessionVerification(verified.sessionCredential)).resolves.toMatchObject({
        clientKind: "account_web", familyState: "active", currentAccountSecurityEpoch: 1,
        expiresAt: "2026-10-04T00:00:00Z",
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
});

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) throw new Error(`${name} is required`);
  return value;
}
