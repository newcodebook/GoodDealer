import { describe, expect, it } from "vitest";
import { afternicConnectIntentSchema, parseAfternicConnectionsStatus } from "./afternic";
const id = "aa000000-0000-4000-8000-000000000001";
const status = () => ({ schemaVersion: 1, controlledAcceptance: null, connections: [{ connectionId: id, displayLabel: "Afternic", state: "active", purgePending: false, lastScan: { observed: 300, imported: 12, skippedDeleted: 2, completedAt: "2026-11-19T00:00:00Z" } }], observeQualified: true, observeEntitled: true, capturable: true, laneState: "ready", lastOperation: null });
describe("Afternic bounded connection projection", () => {
  it("keeps completed empty inventory distinct from no scan", () => {
    const value=status(); value.connections[0]!.lastScan.observed=0; value.connections[0]!.lastScan.imported=0;
    expect(parseAfternicConnectionsStatus(value).connections[0]?.lastScan?.observed).toBe(0);
  });
  it("rejects secrets, duplicates, invalid counts and unbound cleanup", () => {
    for (const mutate of [
      (value: ReturnType<typeof status>) => Object.assign(value, { apiKey: "secret-canary" }),
      (value: ReturnType<typeof status>) => value.connections.push(value.connections[0]!),
      (value: ReturnType<typeof status>) => { value.connections[0]!.lastScan.imported=301; },
      (value: ReturnType<typeof status>) => { value.connections[0]!.purgePending=true; },
    ]) { const value=status(); mutate(value); expect(() => parseAfternicConnectionsStatus(value)).toThrow(); }
  });
  it("rejects active accessors without running them and does not allow credentials in intent", () => {
    let invoked=false; const value=status(); Object.defineProperty(value,"connections",{ enumerable:true,get(){invoked=true;return [];} });
    expect(() => parseAfternicConnectionsStatus(value)).toThrow(); expect(invoked).toBe(false);
    expect(afternicConnectIntentSchema.safeParse({schemaVersion:1,displayLabel:"Inventory",secret:"canary"}).success).toBe(false);
    expect(afternicConnectIntentSchema.safeParse({schemaVersion:1,displayLabel:"\u200b"}).success).toBe(false);
  });
});
