import { describe, expect, it, vi } from "vitest";

import { createCloudflareJourney } from "./cloudflare-coordinator";
import type { CloudflareConnectionStatus, CloudflarePort } from "../../adapters/tauri";

const status = { schemaVersion: 1 as const, state: "ready" as const, connectionRef: "opaque", displayLabel: "Cloudflare", readGeneration: 1 };
const observation = {
  schemaVersion: 1 as const, readGeneration: 1, entityId: "example.com", observedAt: "2026-01-01T00:00:00Z", version: 1,
  availability: "available" as const, uncertainty: "confirmed" as const, zoneLabel: "example.com", zoneStatus: "active" as const, records: [],
};

function port(overrides: Partial<CloudflarePort> = {}): CloudflarePort {
  return { status: vi.fn(async () => status), activate: vi.fn(async () => undefined), observe: vi.fn(async () => undefined), readObservation: vi.fn(async () => observation), ...overrides };
}

describe("CloudflareJourney", () => {
  it("does not invoke observation without a ready Native status", async () => {
    const native = port({ status: vi.fn(async () => ({ ...status, state: "recovering" as const })) });
    const journey = createCloudflareJourney(native, vi.fn());
    await journey.start();
    await journey.observe("opaque", "example.com");
    expect(native.observe).not.toHaveBeenCalled();
  });

  it("reads local observation only after Native observe accepts", async () => {
    const order: string[] = [];
    const native = port({
      observe: vi.fn(async () => { order.push("commit"); }),
      readObservation: vi.fn(async () => { order.push("read"); return observation; }),
    });
    const journey = createCloudflareJourney(native, vi.fn());
    await journey.start();
    await journey.observe("opaque", "example.com");
    expect(order).toEqual(["commit", "read"]);
  });

  it("drops stale completion after invalidation", async () => {
    let resolve!: () => void;
    const native = port({ status: vi.fn(() => new Promise<CloudflareConnectionStatus>((done) => { resolve = done as () => void; })) });
    const accept = vi.fn();
    const journey = createCloudflareJourney(native, accept);
    const pending = journey.start();
    journey.invalidate();
    accept.mockClear();
    resolve();
    await pending;
    expect(accept).not.toHaveBeenCalled();
  });

  it("converges accepted activation by status polling without recapturing credentials", async () => {
    const statusRead = vi.fn()
      .mockResolvedValueOnce({ ...status, state: "not-configured" })
      .mockResolvedValueOnce({ ...status, state: "busy" })
      .mockResolvedValueOnce({ ...status, state: "recovering" })
      .mockResolvedValueOnce(status);
    const native = port({ status: statusRead });
    const journey = createCloudflareJourney(native, vi.fn(), async () => undefined);
    await journey.start();
    expect((await journey.activate("opaque")).state).toBe("ready");
    expect(native.activate).toHaveBeenCalledTimes(1);
    expect(statusRead).toHaveBeenCalledTimes(4);
  });

  it("coalesces a rapid duplicate activation into one Native capture", async () => {
    let finish!: () => void;
    const activate = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const native = port({ activate, status: vi.fn()
      .mockResolvedValueOnce({ ...status, state: "not-configured" as const })
      .mockResolvedValue(status) });
    const journey = createCloudflareJourney(native, vi.fn(), async () => undefined);
    await journey.start();
    const first = journey.activate("opaque");
    const second = journey.activate("opaque");
    expect(activate).toHaveBeenCalledTimes(1);
    finish();
    await Promise.all([first, second]);
    expect(activate).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{ ...observation, readGeneration: 2 }, "unavailable"],
    [{ ...observation, entityId: "other.example" }, "unavailable"],
    [{ ...observation, availability: "unavailable" as const }, "unavailable"],
    [{ ...observation, uncertainty: "stale" as const }, "stale"],
    [{ ...observation, uncertainty: "conflicted" as const }, "uncertain"],
    [{ ...observation, uncertainty: "unknown" as const }, "uncertain"],
  ] as const)("maps non-current or uncertain local evidence closed", async (result, expected) => {
    const journey = createCloudflareJourney(port({ readObservation: vi.fn(async () => result) }), vi.fn());
    await journey.start();
    expect((await journey.observe("opaque", "example.com")).state).toBe(expected);
  });
});
