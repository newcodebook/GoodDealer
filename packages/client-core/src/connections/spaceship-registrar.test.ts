import { expect, it } from "vitest";
import { parseSpaceshipRegistrarStatus, spaceshipRegistrarIntentSchema } from "./spaceship-registrar";

const id = "11111111-1111-4111-a111-111111111111";

it("admits only bounded revision-one local intents", () => {
  expect(spaceshipRegistrarIntentSchema.parse({ schemaVersion: 1, action: "refresh", connectionId: id })).toEqual({
    schemaVersion: 1, action: "refresh", connectionId: id,
  });
  for (const input of [
    { schemaVersion: 1, action: "connect", secret: "refuse" },
    { schemaVersion: 1, action: "refresh", connectionId: id.toUpperCase() },
    { schemaVersion: 2, action: "connect" },
    { schemaVersion: 1, action: "get", url: "https://example.test" },
  ]) {
    expect(spaceshipRegistrarIntentSchema.safeParse(input).success).toBe(false);
  }
});

it("requires a complete saved scan to report an active connection", () => {
  const row = { connectionId: id, state: "active", scanPending: false,
    lastScan: { observed: 3, imported: 2, skipped: 1, completedAt: "2026-11-20T00:00:00Z" } };
  const status = { schemaVersion: 1, laneState: "ready", observeEntitled: true,
    observeQualified: true, capturable: true, lastOperation: null, connections: [row] };
  expect(parseSpaceshipRegistrarStatus(status).connections).toHaveLength(1);
  for (const connections of [
    [row, row],
    [{ ...row, lastScan: null }],
    [{ ...row, lastScan: { ...row.lastScan, imported: 3 } }],
    [{ ...row, state: "revoked", scanPending: true }],
    [{ ...row, accountId: "native only" }],
  ]) {
    expect(() => parseSpaceshipRegistrarStatus({ ...status, connections })).toThrow(TypeError);
  }
});
