import { expect, it } from "vitest";
import { parseSellerHubStatus, sellerHubIntentSchema } from "./sellerhub";

const connectionId = "4fe4d4c0-f7dc-42bd-81dd-4d3e12dd2953";
const intent = { schemaVersion: 1, action: "refresh", connectionId };

it("accepts only the named read and credential lifecycle intents", () => {
  expect(sellerHubIntentSchema.parse(intent)).toEqual(intent);
  for (const input of [
    { ...intent, apiSecret: "ignored" },
    { ...intent, connectionId: connectionId.toUpperCase() },
    { ...intent, action: "delete-listing" },
    { ...intent, schemaVersion: 2 },
  ]) expect(sellerHubIntentSchema.safeParse(input).success).toBe(false);
});

it("separates a staged slot with no pending request from a saved scan", () => {
  const prepared = { connectionId, state: "prepared", scanPending: false, lastScan: null };
  const status = {
    schemaVersion: 1, observeQualified: false, observeEntitled: false, capturable: true,
    laneState: "ready", connections: [prepared], lastOperation: null,
  };
  expect(parseSellerHubStatus(status).connections).toEqual([prepared]);
  const scan = { observed: 2, imported: 1, skipped: 1, completedAt: "2026-11-20T00:00:00Z" };
  for (const input of [
    { ...status, connections: [{ ...prepared, lastScan: scan }] },
    { ...status, connections: [{ ...prepared, state: "active" }] },
    { ...status, connections: [{ ...prepared, state: "active", lastScan: { ...scan, imported: 2 } }] },
    { ...status, connections: [prepared, prepared] },
    { ...status, lastOperation: { kind: "spaceship_refresh", outcome: "confirmed" } },
  ]) expect(() => parseSellerHubStatus(input)).toThrow(TypeError);
});
