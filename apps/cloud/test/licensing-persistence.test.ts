import { describe, expect, it } from "vitest";

import type { AccountTransaction } from "../src/db/index";
import {
  PostgresEntitlementDeadlineReader,
  authoritativeEntitlementSnapshotSchema,
} from "../src/modules/licensing/index";

describe("authority-derived licensing projection reader", () => {
  it("accepts only the strict provider-neutral snapshot shape", () => {
    const snapshot = {
      sourceEventId: "payment-event-2", sourceRevision: 2, occurredAt: "2026-08-29T00:00:00Z",
      state: "active", licenseId: "license-pro", plan: "pro", entitlementKind: "subscription",
      commercialExpiresAt: "2026-09-30T00:00:00Z", offlineGraceUntil: "2026-10-03T00:00:00Z",
      credentialRefreshDueAt: "2026-09-01T00:00:00Z",
      featureEntitlements: ["feature:portfolio", "feature:provider-read"],
      versionEntitlement: { kind: "subscription_supported" },
    } as const;
    expect(authoritativeEntitlementSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(authoritativeEntitlementSnapshotSchema.safeParse({ ...snapshot, accountId: "account-b" }).success).toBe(false);
    expect(authoritativeEntitlementSnapshotSchema.safeParse({ ...snapshot, paymentToken: "secret" }).success).toBe(false);
  });

  it("uses paid or grace time and requires a revision-consistent derived projection", async () => {
    let query = "";
    const transaction = {
      accountId: "account-a",
      async query(text: string) {
        query = text;
        return { rows: [{ entitlement_deadline: "2026-09-30T00:00:00Z", currently_active: true }], rowCount: 1 };
      },
    } as unknown as AccountTransaction;
    await expect(readerFor(transaction).readCurrent({
      transactionCredential: new TextEncoder().encode("opaque-session-credential"),
      expectedAccountId: "account-a",
    })).resolves.toEqual({
      active: true, entitlementDeadline: "2026-09-30T00:00:00Z",
    });
    expect(query).toContain("licensing_api.read_entitlement_deadline()");
    expect(query).not.toContain("FOR UPDATE");
    expect(query).not.toContain("FROM licensing_account_entitlements");
    expect(query).not.toContain("licensing_entitlement_events");
  });

  it("returns no active deadline for absent or commercially expired projection", async () => {
    const absent = { accountId: "account-a", async query() { return { rows: [], rowCount: 0 }; } } as unknown as AccountTransaction;
    await expect(readerFor(absent).readCurrent({
      transactionCredential: new TextEncoder().encode("opaque-session-credential"),
      expectedAccountId: "account-a",
    })).resolves.toBeNull();
    const expired = { accountId: "account-a", async query() {
      return { rows: [{ entitlement_deadline: "2026-09-30T00:00:00Z", currently_active: false }], rowCount: 1 };
    } } as unknown as AccountTransaction;
    await expect(readerFor(expired).readCurrent({
      transactionCredential: new TextEncoder().encode("opaque-session-credential"),
      expectedAccountId: "account-a",
    })).resolves.toBeNull();
  });

  it("fails closed when the credential-derived account differs from the expected account", async () => {
    const transaction = {
      accountId: "account-b",
      async query() { throw new Error("Licensing facade must not run for the wrong account"); },
    } as unknown as AccountTransaction;
    await expect(readerFor(transaction).readCurrent({
      transactionCredential: new TextEncoder().encode("opaque-session-credential"),
      expectedAccountId: "account-a",
    })).resolves.toBeNull();
  });
});

function readerFor(transaction: AccountTransaction): PostgresEntitlementDeadlineReader {
  return new PostgresEntitlementDeadlineReader({
    withAccountCredential: async <Result>(
      _credential: Uint8Array,
      purpose: "identity_account",
      operation: (account: AccountTransaction) => Promise<Result>,
    ) => {
      expect(purpose).toBe("identity_account");
      return operation(transaction);
    },
  });
}
