import { describe, expect, it } from "vitest";

import { parseAtomMarketplaceStatus } from "./atom-marketplace";

const connectionId = "11111111-1111-4111-a111-111111111111";
const scan = { observed: 4, imported: 2, skipped: 1, completedAt: "2026-11-20T00:00:00Z" };

function status(lastScan: unknown, state = "active"): unknown {
  return {
    schemaVersion: 1, observeQualified: true, observeEntitled: true, capturable: true,
    laneState: "ready", lastOperation: null,
    connections: [{ connectionId, state, scanPending: false, lastScan }],
  };
}

describe("Atom Standard inventory projection", () => {
  it("distinguishes a matched empty subset from an unavailable review", () => {
    for (const standardReview of [
      null,
      { observed: 0, sample: [] },
      { observed: 2, sample: ["a.test", "b.test"] },
    ]) {
      const read = parseAtomMarketplaceStatus(status({ ...scan, standardReview }));
      expect(read.connections[0]?.lastScan?.standardReview).toEqual(standardReview);
    }
  });

  it("rejects excess, noncanonical, duplicate, or out-of-order candidates and private fields", () => {
    for (const standardReview of [
      { observed: 4, sample: ["a.test", "b.test", "c.test", "d.test"] },
      { observed: 2, sample: ["a.test", "a.test"] },
      { observed: 2, sample: ["b.test", "a.test"] },
      { observed: 1, sample: ["UPPER.test"] },
      { observed: 2, sample: ["a.test"] },
      { observed: 1, sample: ["a.test"], sellerId: "secret-free-sentinel" },
    ]) {
      expect(() => parseAtomMarketplaceStatus(status({ ...scan, standardReview }))).toThrow(TypeError);
    }
    expect(() => parseAtomMarketplaceStatus(status(scan))).toThrow(TypeError);
    expect(() => parseAtomMarketplaceStatus(status({
      ...scan, standardReview: { observed: 0, sample: [] },
    }, "revoked"))).toThrow(TypeError);
  });
});
