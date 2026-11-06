// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  parseConflictCenterViewModel,
  parseDnsHealthRead,
  parseDomainDetailViewModel,
  type AssetLibraryViewModel,
  type SyncSnapshotViewModel,
} from "@gooddealer/client-core";

import { adjudicateDesktopPresentation } from "./desktop-presentation";
import type { AuthoritativeWorkspacePorts, AuthoritativeWorkspacePublication } from "./workspace-publication";
import { WorkspaceView } from "./workspace-view";

// Every write entry in the composed workspace is handed its write only when the adjudicated
// presentation is writable (`readOnly === null`, i.e. Active with workspace:mutate). The data in
// these fixtures always admits the write (the detail can edit, the conflict has an available
// admission, the Zone is observed), so the presentation gate is the only thing that can hide it.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type BusinessStatus = AuthoritativeWorkspacePublication["status"];

const generation = 4;
const hash = "c".repeat(64);
const freshness = { source: "active_local", readOnlyReason: null, serverRevision: 8, lastReplicationActivityAt: null, lastSuccessfulProviderObservationAt: null, canEdit: true } as const;
const portfolio: AssetLibraryViewModel = {
  schemaVersion: 3, kind: "asset_library", readGeneration: generation, freshness,
  totalRows: 1, totalValue: null, expiringWithin60Days: 0, conflictCount: 1, listingCount: 0,
  window: { startIndex: 0, size: 25, rows: [{
    id: "vault.io", domain: "vault.io", tags: [], registrar: null, lifecycleStatus: "active", syncStatus: "conflicted",
    targetPrice: { currency: "USD", amount: "4500" }, expiresOn: "2027-09-01", expiring: false, assetVersion: 2,
  }] },
};
const conflicts = parseConflictCenterViewModel({
  schemaVersion: 1, kind: "conflict_center", readGeneration: generation, candidateSetVersion: 8,
  freshness: { source: "active_local", serverRevision: 8, observedAt: "2026-09-20T00:00:00Z" },
  conflicts: [{
    candidateId: "c1", candidateKind: "field_conflict", entityDisplay: "vault.io", fieldDisplay: "BIN", group: "price", risk: "normal",
    note: "remote edit", baseValue: "4,000.00", localValue: "4,500.00", remoteValue: "4,200.00",
    comparisonServerRevision: 8, currentValueHash: hash, status: "pending",
    resolutionAdmission: { state: "available", candidateId: "c1", expectedRevision: 8, expectedCandidateVersion: 1, expectedCurrentValueHash: hash, choices: ["keep_local", "accept_remote"] },
  }],
});
const sync: SyncSnapshotViewModel = {
  schemaVersion: 1, source: "active_local", readGeneration: generation, transport: "reachable", blockedReason: null,
  activity: "idle", pendingMutationCount: 0, openConflictCount: 1, rejectedMutationCount: 0, recoveryRequired: false,
  appliedThroughServerRevision: 8, lastReplicationActivityAt: null, transportObservedAt: "2026-09-20T00:00:00Z",
};

function ports(): AuthoritativeWorkspacePorts {
  const detail = parseDomainDetailViewModel({
    schemaVersion: 3, kind: "domain_detail", readGeneration: generation, freshness, state: "conflict",
    asset: {
      id: "vault.io", domain: "vault.io", tags: [], registrar: null, lifecycleStatus: "active", syncStatus: "conflicted",
      targetPrice: { currency: "USD", amount: "4500" }, expiresOn: "2027-09-01", expiring: false, assetVersion: 2,
      acquiredOn: null, acquisitionCost: null, autoRenew: null, registrarLock: null, note: null, portfolioId: null,
    },
    conflictFields: ["BIN"],
  });
  const observation = { providerKind: "cloudflare", observedAt: "2026-09-20T00:00:00Z", availability: "available", evidenceStatus: "confirmed", zoneLabel: "vault.io", zoneStatus: "active", authoritativeNameservers: ["ada.ns.cloudflare.com"], dnssecStatus: "unknown", recordCounts: { a: 1, aaaa: 0, cname: 0, txt: 0, other: 0 } };
  return {
    portfolio: { loadDomainDetail: vi.fn(async () => detail) },
    dns: { loadDnsHealth: vi.fn(async () => parseDnsHealthRead({
      schemaVersion: 1, kind: "dns_health", readGeneration: generation, freshness,
      totalRows: 1, assetCount: 1, observedCount: 1, warningCount: 0,
      window: { startIndex: 0, size: 50, rows: [{ entityId: "vault.io", zoneBinding: null, observation }] },
    })) },
    business: { bindDomainAssetProvider: vi.fn() },
  } as unknown as AuthoritativeWorkspacePorts;
}

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(state: BusinessStatus["state"], capabilities: BusinessStatus["capabilities"]) {
  const publication: AuthoritativeWorkspacePublication = {
    status: { schemaVersion: 2, state, capabilities, readGeneration: generation } as BusinessStatus,
    portfolio, conflicts, sync,
  };
  const presentation = adjudicateDesktopPresentation(false, publication, "authenticated");
  if (presentation.view !== "workspace") throw new Error("expected a workspace");
  await act(async () => {
    root.render(
      <WorkspaceView locale="en-US" presentation={presentation} ports={ports()} windowFrame={{ platform: "linux", framed: false }}
        onPublication={vi.fn()} onRefresh={vi.fn()} onLocaleChange={vi.fn()} />,
    );
  });
}

const buttons = () => [...container.querySelectorAll("button")].map((button) => button.textContent?.trim() ?? "");

async function clickButton(name: string) {
  const button = [...container.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === name || candidate.getAttribute("aria-label") === name);
  if (button === undefined) throw new Error(`button not found: ${name}`);
  await act(async () => { button.click(); });
}

async function openDetail() {
  const row = [...container.querySelectorAll("tr")].find((candidate) => candidate.textContent?.includes("vault.io"));
  if (row === undefined) throw new Error("asset row not found");
  await act(async () => { row.click(); });
  for (let index = 0; index < 3; index += 1) await act(async () => { await Promise.resolve(); });
}

describe("write entries follow the presentation gate", () => {
  it.each([
    ["active", ["local:read", "workspace:mutate"], true],
    ["active", ["local:read"], false],
    ["standby_read_only", ["local:read"], false],
    ["commercial_read_only", ["local:read"], false],
  ] as const)("offers the detail price edit and conflict resolution for %s %j only when writable", async (state, capabilities, writable) => {
    await render(state, [...capabilities]);
    await openDetail();
    // The detail rendered from the Host read in every state, so a missing edit is the gate.
    expect(container.textContent).toContain("Open Conflict Center");
    expect(buttons().includes("Edit price")).toBe(writable);

    await clickButton("Open Conflict Center");
    expect(container.textContent).toContain("4,200.00");
    expect(buttons().includes("Keep local")).toBe(writable);
    expect(buttons().includes("Accept platform")).toBe(writable);
  });

  it.each([
    ["active", ["local:read", "workspace:mutate"], true],
    ["active", ["local:read"], false],
    ["standby_read_only", ["local:read"], false],
    ["commercial_read_only", ["local:read"], false],
  ] as const)("offers Bind Zone for %s %j only when writable", async (state, capabilities, writable) => {
    await render(state, [...capabilities]);
    await clickButton("DNS & verification");
    for (let index = 0; index < 3; index += 1) await act(async () => { await Promise.resolve(); });
    expect(container.textContent).toContain("vault.io");
    expect(buttons().includes("Bind Zone")).toBe(writable);
  });
});
