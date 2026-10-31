import { describe, expect, it } from "vitest";

import type { AssetLibraryViewModel, ConflictCenterViewModel, SyncSnapshotViewModel } from "@gooddealer/client-core";

import { adjudicateDesktopPresentation } from "./desktop-presentation";
import type { AuthoritativeWorkspacePublication } from "./workspace-publication";

type BusinessStatus = AuthoritativeWorkspacePublication["status"];

const portfolio: AssetLibraryViewModel = {
  schemaVersion: 3,
  kind: "asset_library",
  readGeneration: 4,
  freshness: { source: "active_local", readOnlyReason: null, serverRevision: 8, lastReplicationActivityAt: null, lastSuccessfulProviderObservationAt: null, canEdit: true },
  totalRows: 0,
  totalValue: null,
  expiringWithin60Days: 0,
  conflictCount: 0,
  listingCount: 0,
  window: { startIndex: 0, size: 25, rows: [] },
};
const conflicts: ConflictCenterViewModel = {
  schemaVersion: 1,
  kind: "conflict_center",
  readGeneration: 4,
  candidateSetVersion: 8,
  freshness: { source: "active_local", serverRevision: 8, observedAt: "2026-09-20T00:00:00Z" },
  conflicts: [],
};
const sync: SyncSnapshotViewModel = {
  schemaVersion: 1,
  source: "active_local",
  readGeneration: 4,
  transport: "reachable",
  blockedReason: null,
  activity: "idle",
  pendingMutationCount: 0,
  openConflictCount: 0,
  rejectedMutationCount: 0,
  recoveryRequired: false,
  appliedThroughServerRevision: 8,
  lastReplicationActivityAt: null,
  transportObservedAt: "2026-09-20T00:00:00Z",
};

function publication(
  state: BusinessStatus["state"],
  capabilities: BusinessStatus["capabilities"],
  rows: Partial<Pick<AuthoritativeWorkspacePublication, "portfolio" | "conflicts" | "sync">> = {},
): AuthoritativeWorkspacePublication {
  return {
    status: { schemaVersion: 2, state, capabilities, readGeneration: 4 } as BusinessStatus,
    portfolio,
    conflicts,
    sync,
    ...rows,
  };
}

describe("desktop presentation adjudication", () => {
  it("fails closed before the Host has spoken or when it fails", () => {
    expect(adjudicateDesktopPresentation(false, null, "authenticated")).toEqual({ view: "opening" });
    expect(adjudicateDesktopPresentation(true, publication("active", ["local:read", "workspace:mutate"]), "authenticated"))
      .toEqual({ view: "host_unavailable" });
  });

  it("maps Native authentication to the browser sign-in steps", () => {
    const required = publication("activation_required", []);
    expect(adjudicateDesktopPresentation(false, required, null)).toEqual({ view: "opening" });
    expect(adjudicateDesktopPresentation(false, required, "signed_out")).toEqual({ view: "sign_in", signIn: "signed_out" });
    expect(adjudicateDesktopPresentation(false, required, "pending")).toEqual({ view: "sign_in", signIn: "pending" });
    expect(adjudicateDesktopPresentation(false, required, "authorization_retryable")).toEqual({ view: "sign_in", signIn: "authorization_retryable" });
    expect(adjudicateDesktopPresentation(false, required, "unavailable")).toEqual({ view: "sign_in", signIn: "host_unavailable" });
    // OAuth completed but the Host has not admitted the workspace: never a workspace yet.
    expect(adjudicateDesktopPresentation(false, required, "authenticated")).toEqual({ view: "sign_in", signIn: "establishing" });
  });

  it("keeps locked states route-free", () => {
    expect(adjudicateDesktopPresentation(false, publication("security_locked", []), "authenticated"))
      .toEqual({ view: "locked", reason: "security_locked" });
    expect(adjudicateDesktopPresentation(false, publication("retryable_locked", []), "authenticated"))
      .toEqual({ view: "locked", reason: "retryable_locked" });
  });

  it("withholds writes unless the device is Active with the mutate capability", () => {
    const readOnly = (value: AuthoritativeWorkspacePublication) => {
      const result = adjudicateDesktopPresentation(false, value, "authenticated");
      return result.view === "workspace" ? result.readOnly : result.view;
    };
    expect(readOnly(publication("active", ["local:read", "workspace:mutate"]))).toBeNull();
    expect(readOnly(publication("active", ["local:read"]))).toBe("restricted");
    expect(readOnly(publication("standby_read_only", ["local:read", "workspace:mutate"]))).toBe("standby");
    expect(readOnly(publication("commercial_read_only", ["local:read"]))).toBe("commercial");
  });

  it("rejects a workspace without read authority or with missing projections", () => {
    expect(adjudicateDesktopPresentation(false, publication("active", ["workspace:mutate"]), "authenticated"))
      .toEqual({ view: "host_unavailable" });
    expect(adjudicateDesktopPresentation(false, publication("active", ["local:read"], { sync: null }), "authenticated"))
      .toEqual({ view: "host_unavailable" });
    expect(adjudicateDesktopPresentation(false, publication("active", ["local:read"], { portfolio: null }), "authenticated"))
      .toEqual({ view: "host_unavailable" });
  });

  it("offers only composed routes the sync state allows", () => {
    const routes = (value: AuthoritativeWorkspacePublication) => {
      const result = adjudicateDesktopPresentation(false, value, "authenticated");
      return result.view === "workspace" ? result.surface.availableRouteIds : [];
    };
    // DNS health has no Host projection yet, so it is never composed.
    expect(routes(publication("active", ["local:read"]))).toEqual(["portfolio.list", "portfolio.detail", "sync.conflicts"]);
    expect(routes(publication("active", ["local:read"], { sync: { ...sync, recoveryRequired: true } })))
      .toEqual(["portfolio.list", "portfolio.detail"]);
  });
});
