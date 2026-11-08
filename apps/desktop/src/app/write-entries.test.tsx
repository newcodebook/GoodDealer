// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  parseConflictCenterViewModel,
  parseDnsHealthRead,
  parseDomainDetailViewModel,
  parseSettingsRead,
  type AssetLibraryViewModel,
  type SyncSnapshotViewModel,
} from "@gooddealer/client-core";

import type { CloudflareConnectionStatus } from "../adapters/tauri";
import { adjudicateDesktopPresentation } from "./desktop-presentation";
import { Onboarding } from "./onboarding";
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

const cloudflareStatus: CloudflareConnectionStatus = { schemaVersion: 1, state: "ready", connectionRef: "opaque", displayLabel: "Cloudflare", qualified: false, capturable: true, lastOperation: null, readGeneration: generation };
const settingsRead = parseSettingsRead({
  schemaVersion: 2, kind: "settings", readGeneration: generation, freshness,
  connections: [{ providerKind: "cloudflare", connectionLabel: "Cloudflare", lifecycleStatus: "active", validationStatus: "valid", credentialUseState: "active", lastValidatedAt: null, roles: [{ role: "dns", availability: "unavailable", unavailableReason: "qualification_pending" }] }],
  storageIntegrity: { malformedExpiries: 0, invalidRegistrarObservations: 0, rejectedDnsRows: 0, rejectedListings: 0, malformedOutboxRows: 0 },
});

function ports(cloudflare: () => Promise<CloudflareConnectionStatus> = async () => cloudflareStatus): AuthoritativeWorkspacePorts {
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
      window: { startIndex: 0, size: 50, rows: [{ entityId: "vault.io", bindable: true, zoneBinding: null, observation }] },
    })) },
    business: { bindDomainAssetProvider: vi.fn() },
    settings: { loadSettings: vi.fn(async () => settingsRead) },
    cloudflare: { status: vi.fn(cloudflare), create: vi.fn(), activate: vi.fn(), revoke: vi.fn() },
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

async function render(state: BusinessStatus["state"], capabilities: BusinessStatus["capabilities"], workspacePorts: AuthoritativeWorkspacePorts = ports(), onRunOnboarding = vi.fn()) {
  const publication: AuthoritativeWorkspacePublication = {
    status: { schemaVersion: 2, state, capabilities, readGeneration: generation } as BusinessStatus,
    portfolio, conflicts, sync,
  };
  const presentation = adjudicateDesktopPresentation(false, publication, "authenticated");
  if (presentation.view !== "workspace") throw new Error("expected a workspace");
  await act(async () => {
    root.render(
      <WorkspaceView locale="en-US" presentation={presentation} ports={workspacePorts} windowFrame={{ platform: "linux", framed: false }}
        onPublication={vi.fn()} onRefresh={vi.fn()} onLocaleChange={vi.fn()} onRunOnboarding={onRunOnboarding} />,
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

  it.each([
    ["active", ["local:read", "workspace:mutate"], true],
    ["active", ["local:read"], false],
    ["standby_read_only", ["local:read"], false],
    ["commercial_read_only", ["local:read"], false],
  ] as const)("settings shows the Host's Cloudflare reason, no row action, and setup again only when writable for %s %j", async (state, capabilities, writable) => {
    const onRunOnboarding = vi.fn();
    await render(state, [...capabilities], ports(), onRunOnboarding);
    await clickButton("Settings");
    for (let index = 0; index < 3; index += 1) await act(async () => { await Promise.resolve(); });
    expect(container.textContent).toContain("Cloudflare DNS is not qualified yet; connecting, observing, and revoking are unavailable.");
    for (const action of ["Connect", "Reauthorize", "Manage"]) expect(buttons().includes(action)).toBe(false);
    // Connecting and revoking go through setup, which applies its own Host gates on the card.
    expect(buttons().includes("Run setup again")).toBe(writable);
    if (writable) {
      await clickButton("Run setup again");
      expect(onRunOnboarding).toHaveBeenCalledOnce();
    }
  });

  it("settings keeps the revoke hint and reports an unreadable status as only that", async () => {
    await render("active", ["local:read", "workspace:mutate"], ports(async () => ({ ...cloudflareStatus, lastOperation: { kind: "revoke", outcome: "confirmed" } })));
    await clickButton("Settings");
    for (let index = 0; index < 3; index += 1) await act(async () => { await Promise.resolve(); });
    expect(container.textContent).toContain("Also delete or roll the API token in Cloudflare.");

    await render("active", ["local:read", "workspace:mutate"], ports(async () => { throw new TypeError("invalid Cloudflare status"); }));
    await clickButton("Settings");
    for (let index = 0; index < 3; index += 1) await act(async () => { await Promise.resolve(); });
    expect(container.textContent).toContain("Cloudflare status could not be read from the Host.");
    expect(container.textContent).not.toContain("not qualified yet");
  });

  // Onboarding is offered only to a writable workspace, but its Cloudflare card is gated on its own:
  // a publication that stops being writable while the step is open takes the action away.
  it.each([
    ["active", ["local:read", "workspace:mutate"], true],
    ["active", ["local:read"], false],
    ["standby_read_only", ["local:read"], false],
    ["commercial_read_only", ["local:read"], false],
  ] as const)("offers the onboarding Cloudflare connect for %s %j only when writable and qualified", async (state, capabilities, writable) => {
    for (const qualified of [true, false]) {
      const workspacePorts = ports(async () => ({ ...cloudflareStatus, state: "not-configured", connectionRef: null, qualified }));
      const publication: AuthoritativeWorkspacePublication = {
        status: { schemaVersion: 2, state, capabilities: [...capabilities], readGeneration: generation } as BusinessStatus,
        portfolio: { ...portfolio, totalRows: 0, window: { ...portfolio.window, rows: [] } }, conflicts, sync,
      };
      await act(async () => {
        root.render(
          <Onboarding locale="en-US" windowFrame={{ platform: "linux", framed: false }} lease={{ schemaVersion: 1, deviceId: "device-01HZX", leaseEpoch: 3 }}
            publication={publication} ports={workspacePorts} onPublication={vi.fn()} onFinish={vi.fn()} />,
        );
      });
      await clickButton("Get started");
      await clickButton("Continue");
      for (let index = 0; index < 3; index += 1) await act(async () => { await Promise.resolve(); });
      const card = [...container.querySelectorAll("button")].find((candidate) => candidate.textContent?.includes("Cloudflare"));
      expect(card?.disabled).toBe(!(writable && qualified));
      await act(async () => { card?.click(); });
      expect(vi.mocked(workspacePorts.cloudflare.create).mock.calls.length).toBe(writable && qualified ? 1 : 0);
      act(() => root.render(<></>));
    }
  });
});
