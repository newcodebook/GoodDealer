import { describe, expect, it, vi } from "vitest";

import type {
  AssetLibraryViewModel,
  ConflictCenterViewModel,
  SyncSnapshotViewModel,
} from "@gooddealer/client-core";

import {
  eligibleWorkspaceRouteIds,
  readAuthoritativeWorkspacePublication,
  resolveConflictAndReadWorkspace,
} from "../app";

const HASH = "a".repeat(64);

function status(readGeneration: number) {
  return {
    schemaVersion: 2 as const,
    state: "active" as const,
    capabilities: ["local:read", "workspace:mutate"] as const,
    readGeneration,
  };
}

function portfolio(readGeneration: number): AssetLibraryViewModel {
  return {
    schemaVersion: 3,
    kind: "asset_library",
    readGeneration,
    freshness: { source: "active_local", readOnlyReason: null, serverRevision: 8, lastReplicationActivityAt: null, lastSuccessfulProviderObservationAt: null, canEdit: true },
    totalRows: 0,
    totalValue: null,
    expiringWithin60Days: 0,
    conflictCount: 1,
    listingCount: 0,
    window: { startIndex: 0, size: 25, rows: [] },
  };
}

function conflicts(readGeneration: number): ConflictCenterViewModel {
  return {
    schemaVersion: 1,
    kind: "conflict_center",
    readGeneration,
    candidateSetVersion: 8,
    freshness: { source: "active_local", serverRevision: 8, observedAt: "2026-09-20T00:00:00Z" },
    conflicts: [{
      candidateId: "candidate-1",
      candidateKind: "field_conflict",
      entityDisplay: "example.test",
      fieldDisplay: "Note",
      group: "sales_status",
      risk: "normal",
      note: "Concurrent change",
      baseValue: "before",
      localValue: "local",
      remoteValue: "remote",
      comparisonServerRevision: 8,
      currentValueHash: HASH,
      status: "pending",
      resolutionAdmission: {
        state: "available",
        candidateId: "candidate-1",
        expectedRevision: 8,
        expectedCandidateVersion: 1,
        expectedCurrentValueHash: HASH,
        choices: ["keep_local", "accept_remote"],
      },
    }],
  };
}

function sync(readGeneration: number): SyncSnapshotViewModel {
  return {
    schemaVersion: 1,
    source: "active_local",
    readGeneration,
    transport: "reachable",
    blockedReason: null,
    activity: "idle",
    pendingMutationCount: 0,
    openConflictCount: 1,
    rejectedMutationCount: 0,
    recoveryRequired: false,
    appliedThroughServerRevision: 8,
    lastReplicationActivityAt: null,
    transportObservedAt: "2026-09-20T00:00:00Z",
  };
}

function ports(readGeneration: number) {
  return {
    business: {
      status: vi.fn(async () => status(readGeneration)),
      editDomainAsset: vi.fn(),
      deleteDomainAsset: vi.fn(),
    },
    portfolio: {
      loadAssetLibrary: vi.fn(async () => portfolio(readGeneration)),
      loadDomainDetail: vi.fn(),
    },
    conflicts: {
      conflictCenter: vi.fn(async () => conflicts(readGeneration)),
      resolveConflict: vi.fn(async () => ({ schemaVersion: 1 as const, readGeneration: readGeneration, enqueuedForSync: true })),
    },
    sync: { status: vi.fn(async () => sync(readGeneration)) },
  };
}

describe("authoritative workspace publication", () => {
  it("restarts a torn read and publishes only one stable Host generation", async () => {
    const value = ports(2);
    value.business.status
      .mockResolvedValueOnce(status(1))
      .mockResolvedValueOnce(status(2))
      .mockResolvedValueOnce(status(2))
      .mockResolvedValueOnce(status(2));
    value.portfolio.loadAssetLibrary
      .mockResolvedValueOnce(portfolio(1))
      .mockResolvedValueOnce(portfolio(2));
    value.conflicts.conflictCenter
      .mockResolvedValueOnce(conflicts(1))
      .mockResolvedValueOnce(conflicts(2));
    value.sync.status
      .mockResolvedValueOnce(sync(1))
      .mockResolvedValueOnce(sync(2));

    const publication = await readAuthoritativeWorkspacePublication(value);

    expect(publication.status.readGeneration).toBe(2);
    expect(publication.portfolio?.readGeneration).toBe(2);
    expect(publication.conflicts?.readGeneration).toBe(2);
    expect(publication.sync?.readGeneration).toBe(2);
  });

  it("rejects a resolution receipt that is not exactly expected generation plus one", async () => {
    const value = ports(4);
    value.conflicts.resolveConflict.mockResolvedValue({ schemaVersion: 1, readGeneration: 5, enqueuedForSync: true });

    await expect(resolveConflictAndReadWorkspace(conflicts(3), "candidate-1", "keep_local", value))
      .rejects.toThrow("generation mismatch");
    expect(value.business.status).not.toHaveBeenCalled();
  });

  it("returns the complete stable reread after a valid local-only receipt", async () => {
    const value = ports(4);

    const publication = await resolveConflictAndReadWorkspace(
      conflicts(3),
      "candidate-1",
      "keep_local",
      value,
    );

    expect(value.conflicts.resolveConflict).toHaveBeenCalledOnce();
    expect(value.business.status).toHaveBeenCalledTimes(2);
    expect(value.portfolio.loadAssetLibrary).toHaveBeenCalledOnce();
    expect(value.conflicts.conflictCenter).toHaveBeenCalledOnce();
    expect(value.sync.status).toHaveBeenCalledOnce();
    expect(publication.status.readGeneration).toBe(4);
  });
});

describe("workspace route eligibility", () => {
  it("offers Conflict Center for reachable and commercial read-only snapshots", () => {
    expect(eligibleWorkspaceRouteIds(sync(1))).toContain("sync.conflicts");
    expect(eligibleWorkspaceRouteIds({
      ...sync(1),
      source: "local_continuation",
      transport: "blocked",
      blockedReason: "authorization",
    })).toContain("sync.conflicts");
  });

  it("withholds Conflict Center while synchronization is unavailable or unsafe", () => {
    expect(eligibleWorkspaceRouteIds(null)).not.toContain("sync.conflicts");
    expect(eligibleWorkspaceRouteIds({
      ...sync(1),
      source: "local_continuation",
      transport: "blocked",
      blockedReason: "recovery_required",
      recoveryRequired: true,
    })).not.toContain("sync.conflicts");
    expect(eligibleWorkspaceRouteIds({
      ...sync(1),
      transport: "blocked",
      blockedReason: "security",
    })).not.toContain("sync.conflicts");
  });
});
