import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  ValidatingSyncPresentationPort,
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

describe("sync presentation contracts", () => {
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
      getSyncStatus: async () => activeStatus,
      getSyncSettings: async () => settings,
    };
    const port = new ValidatingSyncPresentationPort(boundary);
    await expect(port.getSyncStatus()).resolves.toEqual(activeStatus);
    await expect(port.getSyncSettings()).resolves.toEqual(settings);

    const source = readFileSync(new URL("./presentation-models.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/setTimeout|setInterval|Date\.now|fetch\s*\(|@tauri-apps/i);
    expect(source).not.toMatch(/manual_only|syncEnabled|autoSync/i);
  });
});
