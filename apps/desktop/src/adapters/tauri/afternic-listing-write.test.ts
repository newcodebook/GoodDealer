import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AfternicListingWritePreviewRequest } from "@gooddealer/client-core";
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
import { createAfternicListingWritePort } from "./afternic-listing-write";
const planRef = "aa000000-0000-4000-8000-000000000001";
const planHash = "a".repeat(64);
const createdAt = "2026-11-19T00:00:00Z";
const values = { buynowPriceMicroUsd: 0, floorPriceMicroUsd: 0, minbidPriceMicroUsd: 20_000_000, hidden: false };
const request = (): AfternicListingWritePreviewRequest => ({ schemaVersion: 1, connectionId: planRef, action: "create", items: [{ domain: "example.com", values }] });
const plan = () => ({ schemaVersion: 1, planRef, planHash, action: "create", connectionLabel: "Market", createdAt,
  expiresAt: "2026-11-19T00:15:00Z", approvedAt: null, state: "awaiting_approval",
  items: [{ domain: "example.com", before: null, changes: { ...values }, latest: null, fieldsMatched: false, state: "preview", reason: null, retryAt: null }] });
const approved = () => ({ ...plan(), approvedAt: createdAt, state: "executing", items: plan().items.map(item => ({ ...item, state: "queued" })) });
const body = () => JSON.parse(new TextDecoder().decode(invoke.mock.calls.at(-1)?.[1]));
beforeEach(() => { invoke.mockReset(); });
describe("Afternic listing write raw adapter", () => {
  it("preserves explicit zero and false, and binds create to the exact returned fields and action", async () => {
    invoke.mockResolvedValue(plan());
    await createAfternicListingWritePort().preview(request());
    expect(invoke.mock.calls[0]?.[0]).toBe("afternic_listing_write_preview");
    expect(invoke.mock.calls[0]?.[1]).toBeInstanceOf(Uint8Array);
    expect(body()).toEqual(request());
    for (const substitute of [
      { ...plan(), items: [{ ...plan().items[0], changes: { ...values, hidden: true } }] },
      { ...plan(), items: [{ ...plan().items[0], domain: "other.com" }] }, approved(),
    ]) { invoke.mockResolvedValue(substitute); await expect(createAfternicListingWritePort().preview(request())).rejects.toThrow(); }
  });
  it("updates only the selected keys and rejects added fields or action substitution", async () => {
    const before = { ...values, providerStatus: "ACTIVE", observedAt: createdAt };
    const update = { ...plan(), action: "update", items: [{ ...plan().items[0], before, changes: { hidden: false, buynowPriceMicroUsd: 0 } }] };
    const intent: AfternicListingWritePreviewRequest = { schemaVersion: 1, connectionId: planRef, action: "update", items: [{ domain: "example.com", patch: { hidden: false, buynowPriceMicroUsd: 0 } }] };
    invoke.mockResolvedValue(update); await createAfternicListingWritePort().preview(intent);
    expect(body()).toEqual(intent);
    for (const value of [plan(), { ...update, items: [{ ...update.items[0], changes: { ...update.items[0]!.changes, floorPriceMicroUsd: 0 } }] }]) {
      invoke.mockResolvedValue(value); await expect(createAfternicListingWritePort().preview(intent)).rejects.toThrow();
    }
  });
  it("rejects hostile intents before IPC and keeps error messages free of injected secrets", async () => {
    for (const value of [{ ...request(), cookie: "canary" }, { ...request(), connectionId: "bad" },
      { ...request(), action: "update", items: [{ domain: "example.com", patch: {} }] },
      { ...request(), items: [{ domain: "example.com", values: { ...values, minbidPriceMicroUsd: 20.1 } }] }]) {
      await expect(createAfternicListingWritePort().preview(value as AfternicListingWritePreviewRequest)).rejects.toThrow("invalid Afternic listing write preview intent");
    }
    expect(invoke).not.toHaveBeenCalled();
    invoke.mockResolvedValue({ ...plan(), cookie: "canary" });
    await expect(createAfternicListingWritePort().preview(request())).rejects.toThrow("invalid Afternic listing write plan");
  });
  it("requires exact approval identity and never retries an unknown result", async () => {
    invoke.mockResolvedValue(approved()); await createAfternicListingWritePort().approve({ schemaVersion: 1, planRef, planHash });
    expect(invoke.mock.calls.at(-1)?.[0]).toBe("afternic_listing_write_approve");
    expect(body()).toEqual({ schemaVersion: 1, planRef, planHash });
    for (const value of [plan(), { ...approved(), planHash: "b".repeat(64) }]) {
      invoke.mockResolvedValue(value); await expect(createAfternicListingWritePort().approve({ schemaVersion: 1, planRef, planHash })).rejects.toThrow();
    }
    invoke.mockReset().mockRejectedValue(new Error("closed failure"));
    await expect(createAfternicListingWritePort().approve({ schemaVersion: 1, planRef, planHash })).rejects.toThrow();
    expect(invoke).toHaveBeenCalledTimes(1);
  });
  it("correlates explicit history selection and refuses unsolicited detail", async () => {
    const status = { schemaVersion: 1, controlledAcceptance: null, writeQualified: false, writeEntitled: false, executionAvailable: false, plans: [], detail: null };
    invoke.mockResolvedValue(status); await createAfternicListingWritePort().status({ schemaVersion: 1, planRef: null });
    expect(body()).toEqual({ schemaVersion: 1, planRef: null });
    invoke.mockResolvedValue({ ...status, detail: plan() });
    await expect(createAfternicListingWritePort().status({ schemaVersion: 1, planRef: null })).rejects.toThrow();
    await createAfternicListingWritePort().status({ schemaVersion: 1, planRef });
  });
});
