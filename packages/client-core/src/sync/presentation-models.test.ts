import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  ValidatingSyncPresentationPort,
  parseSyncSnapshotViewModel,
  parseSyncSettingsViewModel,
  parseSyncStatusViewModel,
  type SyncPresentationBoundary,
} from "./presentation-models";

const timestamp = "2026-08-17T05:00:00Z";

const activeStatus = {
  schemaVersion: 1,
  surface: "active_local",
  phase: "uploading",
  serverRevision: 8241,
  lastSuccessfulSyncAt: timestamp,
  unsyncedCount: 3,
  streams: [
    { stream: "mutation", lastAssignedSequence: 12, contiguousReceivedThrough: 10, pendingCount: 2 },
    { stream: "execution_fact", lastAssignedSequence: 8, contiguousReceivedThrough: 7, pendingCount: 1 },
    { stream: "device_audit", lastAssignedSequence: 9, contiguousReceivedThrough: 9, pendingCount: 0 },
  ],
} as const;

const settings = {
  schemaVersion: 1,
  kind: "sync_settings",
  businessSynchronization: "mandatory",
  pullRefreshCadence: "every_5_minutes",
  conflictResolution: "manual_review",
} as const;

const snapshot = {
  schemaVersion: 1, source: "active_local", readGeneration: 4,
  transport: "offline", blockedReason: null, activity: "idle",
  pendingMutationCount: 2, openConflictCount: 1, rejectedMutationCount: 3,
  recoveryRequired: false, appliedThroughServerRevision: 8,
  lastReplicationActivityAt: timestamp, transportObservedAt: timestamp,
} as const;

describe("sync presentation contracts", () => {
  it("accepts only an exact, internally consistent durable sync snapshot", () => {
    expect(parseSyncSnapshotViewModel(snapshot)).toEqual(snapshot);
    for (const invalid of [
      { ...snapshot, blockedReason: "authorization" },
      { ...snapshot, transport: "blocked", blockedReason: "security", activity: "syncing" },
      { ...snapshot, transport: "checking", transportObservedAt: timestamp },
      { ...snapshot, recoveryRequired: true },
      { ...snapshot, cursor: "secret" },
    ]) expect(() => parseSyncSnapshotViewModel(invalid)).toThrow("invalid sync snapshot projection");
    expect(() => parseSyncSnapshotViewModel(Object.create(snapshot))).toThrow();
    const accessor = { ...snapshot } as Record<string, unknown>;
    Object.defineProperty(accessor, "readGeneration", { enumerable: true, get: () => 4 });
    expect(() => parseSyncSnapshotViewModel(accessor)).toThrow();
  });

  it("derives unsynced state from the three Cloud acknowledgement watermarks", () => {
    expect(parseSyncStatusViewModel(activeStatus)).toEqual(activeStatus);
    expect(() => parseSyncStatusViewModel({ ...activeStatus, unsyncedCount: 0 })).toThrow(
      "invalid sync status projection",
    );
    expect(() => parseSyncStatusViewModel({
      ...activeStatus,
      streams: activeStatus.streams.map((stream) =>
        stream.stream === "mutation" ? { ...stream, pendingCount: 0 } : stream),
    })).toThrow("invalid sync status projection");
    expect(() => parseSyncStatusViewModel({
      ...activeStatus,
      streams: [activeStatus.streams[0], activeStatus.streams[0], activeStatus.streams[2]],
    })).toThrow("invalid sync status projection");
  });

  it("cannot express disabled business sync, manual-only upload, or automatic conflict overwrite", () => {
    expect(parseSyncSettingsViewModel(settings)).toEqual(settings);
    for (const candidate of [
      { ...settings, businessSynchronization: "disabled" },
      { ...settings, pullRefreshCadence: "manual_only" },
      { ...settings, conflictResolution: "prefer_local" },
      { ...settings, syncEnabled: false },
    ]) {
      expect(() => parseSyncSettingsViewModel(candidate)).toThrow(
        "invalid sync settings projection",
      );
    }
  });

  it("validates unknown boundary results without owning upload, timers, or persistence", async () => {
    const boundary: SyncPresentationBoundary = {
      getSyncStatus: async () => snapshot,
      getSyncSettings: async () => settings,
    };
    const port = new ValidatingSyncPresentationPort(boundary);
    await expect(port.getSyncStatus()).resolves.toEqual(snapshot);
    await expect(port.getSyncSettings()).resolves.toEqual(settings);

    const source = readFileSync(new URL("./presentation-models.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/setTimeout|setInterval|Date\.now|fetch\s*\(|@tauri-apps/i);
    expect(source).not.toMatch(/manual_only|syncEnabled|autoSync/i);
  });
});
