import { beforeEach, describe, expect, it } from "vitest";

import {
  createNamespacedRecoveryStore,
  createAccountNamespaceFence,
  parseAuthenticatedIdentitySession,
  recoveryStorageKey,
  supersedeGeneration,
  type RecoveryStorage,
} from "../src/browser-storage";

const accountA = "A".repeat(43);
const accountB = "B".repeat(43);

describe("namespaced Account Web recovery storage", () => {
  let storage: RecoveryStorage & { readonly values: Map<string, string> };
  beforeEach(() => {
    const values = new Map<string, string>();
    storage = {
      values,
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => { values.set(key, value); },
      removeItem: (key) => { values.delete(key); },
    };
  });

  it("does not read or write custody before an authenticated namespace is selected", async () => {
    expect(() => createNamespacedRecoveryStore<{ value: string }>(
      "gooddealer.billing.checkout", "unauthenticated", storage,
    )).toThrow(/namespace/u);
    expect(storage.values.size).toBe(0);
  });

  it("isolates account custody and restores it after the same account logs in again", async () => {
    const storeA = createNamespacedRecoveryStore<{ value: string }>("gooddealer.billing.checkout", accountA, storage);
    await storeA.save({ value: "account-a" });
    const storeB = createNamespacedRecoveryStore<{ value: string }>("gooddealer.billing.checkout", accountB, storage);
    await expect(storeB.load()).resolves.toBeNull();
    await storeB.save({ value: "account-b" });
    await expect(storeA.load()).resolves.toEqual({ value: "account-a" });
    expect(storage.getItem(`gooddealer.billing.checkout.v2.${accountB}`)).toContain("account-b");
  });

  it("rejects malformed namespaces rather than creating attacker-controlled buckets", () => {
    expect(() => createNamespacedRecoveryStore("gooddealer.billing.refund", "account-a", storage)).toThrow(/namespace/u);
  });

  it("strictly parses only the authenticated session namespace contract", () => {
    expect(parseAuthenticatedIdentitySession({ status: "authenticated", namespace: accountA }))
      .toEqual({ namespace: accountA });
    for (const value of [
      null,
      { status: "authenticated" },
      { status: "signed_out", namespace: accountA },
      { status: "authenticated", namespace: "account-a" },
      { status: "authenticated", namespace: accountA, accountId: "internal-account" },
      Object.assign(Object.create({ status: "authenticated" }), { namespace: accountA }),
    ]) expect(parseAuthenticatedIdentitySession(value)).toBeNull();

    const accessor = { status: "authenticated", namespace: accountA };
    Object.defineProperty(accessor, "namespace", { enumerable: true, get: () => accountA });
    expect(parseAuthenticatedIdentitySession(accessor)).toBeNull();
  });

  it("never adopts an unscoped legacy recovery record", async () => {
    storage.setItem("gooddealer.billing.checkout.v1", JSON.stringify({ value: "legacy-account-unknown" }));
    const scoped = createNamespacedRecoveryStore("gooddealer.billing.checkout", accountA, storage);
    await expect(scoped.load()).resolves.toBeNull();
  });

  it("derives the exact current-account refund key used for cross-tab recovery events", () => {
    expect(recoveryStorageKey("gooddealer.billing.refund", accountA))
      .toBe(`gooddealer.billing.refund.v2.${accountA}`);
    expect(() => recoveryStorageKey("gooddealer.billing.refund", "account-a")).toThrow();
  });

  it("supersedes a delayed session response before login or storage invalidation can replace identity", async () => {
    let generation = 0;
    generation = supersedeGeneration(generation);
    const delayedSessionGeneration = generation;
    let release!: () => void;
    const delayedSession = new Promise<void>((resolve) => { release = resolve; })
      .then(() => delayedSessionGeneration === generation);
    generation = supersedeGeneration(generation);
    release();
    await expect(delayedSession).resolves.toBe(false);
  });

  it("invalidates an older tab when another authenticated account becomes current", () => {
    const firstTab = createAccountNamespaceFence(storage);
    const secondTab = createAccountNamespaceFence(storage);
    firstTab.activate(accountA);
    expect(firstTab.isCurrent(accountA)).toBe(true);
    secondTab.activate(accountB);
    expect(firstTab.isCurrent(accountA)).toBe(false);
    expect(secondTab.isCurrent(accountB)).toBe(true);
    secondTab.clear();
    expect(secondTab.isCurrent(accountB)).toBe(false);
  });
});
