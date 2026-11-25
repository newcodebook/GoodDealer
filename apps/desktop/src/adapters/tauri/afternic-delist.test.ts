import { beforeEach, describe, expect, it, vi } from "vitest";
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
import { createAfternicDelistPort } from "./afternic-delist";
const planRef = "aa000000-0000-4000-8000-000000000001";
const planHash = "a".repeat(64);
const createdAt = "2026-11-19T00:00:00Z";
const plan = () => ({ schemaVersion: 1, planRef, planHash, connectionLabel: "Market", createdAt,
  expiresAt: "2026-11-19T00:15:00Z", approvedAt: null, state: "awaiting_approval",
  items: [{ domain: "example.com", providerStatus: "ACTIVE", buynowPrice: null, floorPrice: null,
    minbidPrice: null, hidden: null, observedAt: createdAt, state: "preview", reason: null, retryAt: null }] });
const approved = () => ({ ...plan(), approvedAt: createdAt, state: "executing",
  items: plan().items.map((item) => ({ ...item, state: "queued" })) });
beforeEach(() => { invoke.mockReset(); });
const body = () => JSON.parse(new TextDecoder().decode(invoke.mock.calls[0]?.[1]));
describe("Afternic delist raw adapter", () => {
  it("sends only frozen preview intent and validates the exact returned targets", async () => {
    invoke.mockResolvedValue(plan());
    await createAfternicDelistPort().preview({ schemaVersion: 1, connectionId: planRef, domains: ["example.com"] });
    expect(invoke.mock.calls[0]?.[0]).toBe("afternic_delist_preview");
    expect(body()).toEqual({ schemaVersion: 1, connectionId: planRef, domains: ["example.com"] });
    invoke.mockResolvedValue({ ...plan(), items: [{ ...plan().items[0], domain: "other.com" }] });
    await expect(createAfternicDelistPort().preview({ schemaVersion: 1, connectionId: planRef, domains: ["example.com"] })).rejects.toThrow();
    invoke.mockResolvedValue(approved());
    await expect(createAfternicDelistPort().preview({ schemaVersion: 1, connectionId: planRef, domains: ["example.com"] })).rejects.toThrow();
  });
  it("binds approval to exact ref and hash without retrying a lost response", async () => {
    invoke.mockResolvedValue(approved());
    await createAfternicDelistPort().approve({ schemaVersion: 1, planRef, planHash });
    expect(body()).toEqual({ schemaVersion: 1, planRef, planHash });
    invoke.mockResolvedValue({ ...approved(), planHash: "b".repeat(64) });
    await expect(createAfternicDelistPort().approve({ schemaVersion: 1, planRef, planHash })).rejects.toThrow();
    for (const state of ["awaiting_approval", "expired"]) {
      invoke.mockResolvedValue({ ...plan(), state });
      await expect(createAfternicDelistPort().approve({ schemaVersion: 1, planRef, planHash })).rejects.toThrow();
    }
    invoke.mockReset().mockRejectedValue(new Error("closed failure"));
    await expect(createAfternicDelistPort().approve({ schemaVersion: 1, planRef, planHash })).rejects.toThrow();
    expect(invoke).toHaveBeenCalledTimes(1);
  });
  it("requires explicit read selection and rejects secret or substituted responses", async () => {
    const port = createAfternicDelistPort();
    invoke.mockResolvedValue({ schemaVersion: 1, controlledAcceptance: null, writeQualified: false, writeEntitled: false,
      executionAvailable: false, plans: [], detail: null });
    await port.status({ schemaVersion: 1, planRef: null });
    expect(body()).toEqual({ schemaVersion: 1, planRef: null });
    invoke.mockResolvedValue({ schemaVersion: 1, controlledAcceptance: null, writeQualified: true, writeEntitled: true,
      executionAvailable: true, plans: [], detail: plan() });
    await expect(port.status({ schemaVersion: 1, planRef: null })).rejects.toThrow();
    invoke.mockResolvedValue({ ...plan(), cookie: "canary-secret" });
    await expect(port.approve({ schemaVersion: 1, planRef, planHash })).rejects.toThrow();
    invoke.mockClear();
    await expect(port.preview({ schemaVersion: 1, connectionId: "bad", domains: ["example.com"] })).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });
});
