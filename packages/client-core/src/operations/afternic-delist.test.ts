import { describe, expect, it } from "vitest";
import {
  afternicDelistApproveRequestSchema, afternicDelistPreviewRequestSchema,
  afternicDelistStatusRequestSchema, parseAfternicDelistPlan, parseAfternicDelistStatus,
} from "./afternic-delist";

const planRef = "aa000000-0000-4000-8000-000000000001";
const timestamp = "2026-11-19T00:00:00Z";
function plan() {
  return { schemaVersion: 1, planRef, planHash: "a".repeat(64), connectionLabel: "Market",
    createdAt: timestamp, expiresAt: "2026-11-19T00:15:00Z", approvedAt: null,
    state: "awaiting_approval", items: [{ domain: "example.com", providerStatus: "ACTIVE",
      buynowPrice: 100_000_000, floorPrice: null, minbidPrice: 20_000_000, hidden: false,
      observedAt: timestamp, state: "preview", reason: null, retryAt: null }] };
}
function status() {
  return { schemaVersion: 1, writeQualified: true, writeEntitled: true, executionAvailable: true,
    plans: [{ planRef, connectionLabel: "Market", createdAt: timestamp, state: "awaiting_approval",
      total: 1, succeeded: 0, conflicts: 0, pending: 1 }], detail: plan() };
}
describe("Afternic exact delist contracts", () => {
  it("accepts immutable observed preview and matching bounded history", () => {
    expect(parseAfternicDelistPlan(plan()).items[0]?.domain).toBe("example.com");
    expect(parseAfternicDelistStatus(status()).detail?.planRef).toBe(planRef);
  });
  it("requires explicit nullable selection and rejects extra authority or credentials", () => {
    expect(afternicDelistStatusRequestSchema.safeParse({ schemaVersion: 1, planRef: null }).success).toBe(true);
    for (const value of [{ schemaVersion: 1 }, { schemaVersion: 2, planRef: null },
      { schemaVersion: 1, planRef: null, apiKey: "secret-canary" }]) {
      expect(afternicDelistStatusRequestSchema.safeParse(value).success).toBe(false);
    }
    expect(afternicDelistApproveRequestSchema.safeParse({ schemaVersion: 1, planRef, planHash: "A".repeat(64) }).success).toBe(false);
    expect(afternicDelistApproveRequestSchema.safeParse({ schemaVersion: 1, planRef, planHash: "a".repeat(64), approved: true }).success).toBe(false);
  });
  it("refuses duplicates, excessive targets and noncanonical domain identities", () => {
    const request = (domains: string[]) => ({ schemaVersion: 1, connectionId: planRef, domains });
    expect(afternicDelistPreviewRequestSchema.safeParse(request(["example.com"])).success).toBe(true);
    for (const domains of [[], ["example.com", "example.com"], ["Example.com"], ["example.com/path"],
      Array.from({ length: 501 }, (_, index) => `d${index}.com`)]) {
      expect(afternicDelistPreviewRequestSchema.safeParse(request(domains)).success).toBe(false);
    }
  });
  it("rejects untrusted shape, money, chronology and substituted detail", () => {
    const valid = plan();
    for (const value of [
      { ...valid, cookie: "secret-canary" },
      { ...valid, items: [...valid.items, ...valid.items] },
      { ...valid, items: [{ ...valid.items[0], providerStatus: "VERIFIED" }] },
      { ...valid, items: [{ ...valid.items[0], buynowPrice: 100_000_001 }] },
      { ...valid, items: [{ ...valid.items[0], minbidPrice: 19_000_000 }] },
      { ...valid, expiresAt: valid.createdAt },
      { ...valid, state: "completed" },
      { ...valid, items: [{ ...valid.items[0], reason: "read_failed" }] },
    ]) expect(() => parseAfternicDelistPlan(value)).toThrow();
    expect(() => parseAfternicDelistStatus({ ...status(), plans: [...status().plans, ...status().plans] })).toThrow();
    expect(() => parseAfternicDelistStatus({ ...status(), plans: [{ ...status().plans[0], succeeded: 1 }] })).toThrow();
    expect(() => parseAfternicDelistStatus({ ...status(), detail: null, plans: [{ ...status().plans[0], state: "completed" }] })).toThrow();
    expect(() => parseAfternicDelistStatus({ ...status(), detail: { ...valid, connectionLabel: "Other account" } })).toThrow();
  });
  it("keeps dispatched uncertainty distinct from failure and never infers success", () => {
    const valid = plan();
    const running = { ...valid, approvedAt: timestamp, state: "executing", items: [{ ...valid.items[0],
      state: "reconciling", reason: "still_present", retryAt: "2026-11-19T00:01:00Z" }] };
    expect(parseAfternicDelistPlan(running).items[0]?.state).toBe("reconciling");
    expect(() => parseAfternicDelistPlan({ ...running, items: [{ ...running.items[0], retryAt: null }] })).toThrow();
    expect(() => parseAfternicDelistPlan({ ...running, items: [{ ...running.items[0], state: "queued" }] })).toThrow();
    const done = { ...valid, approvedAt: timestamp, state: "completed", items: [{ ...valid.items[0], state: "succeeded" }] };
    expect(parseAfternicDelistPlan(done).state).toBe("completed");
  });
  it("does not execute active properties while validating unknown inputs", () => {
    let invoked = false;
    const input = plan();
    Object.defineProperty(input, "items", { enumerable: true, get() { invoked = true; return []; } });
    expect(() => parseAfternicDelistPlan(input)).toThrow();
    expect(invoked).toBe(false);
  });
  it("rejects contradictory summary outcomes even without a selected detail", () => {
    for (const summary of [
      { state: "completed", succeeded: 0, conflicts: 0, pending: 1 },
      { state: "executing", succeeded: 1, conflicts: 0, pending: 0 },
      { state: "awaiting_approval", succeeded: 1, conflicts: 0, pending: 0 },
      { state: "expired", succeeded: 0, conflicts: 1, pending: 0 },
      { state: "partially_failed", succeeded: 1, conflicts: 0, pending: 0 },
    ]) expect(() => parseAfternicDelistStatus({ ...status(), detail: null,
      plans: [{ ...status().plans[0], ...summary }] })).toThrow();
  });
});
