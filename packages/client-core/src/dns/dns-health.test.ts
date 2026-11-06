import { describe, expect, it } from "vitest";

import { parseDnsHealthRead, projectDnsHealthViewModel, type DnsHealthRead } from "./dns-health";

const freshness = {
  source: "active_local",
  readOnlyReason: null,
  serverRevision: 4,
  lastReplicationActivityAt: null,
  lastSuccessfulProviderObservationAt: "2026-08-28T00:00:00Z",
  canEdit: true,
} as const;

const observation = {
  providerKind: "cloudflare",
  observedAt: "2026-08-28T00:00:00Z",
  availability: "available",
  evidenceStatus: "confirmed",
  zoneLabel: "observed.test",
  zoneStatus: "active",
  authoritativeNameservers: ["ada.ns.cloudflare.com"],
  dnssecStatus: "unknown",
  recordCounts: { a: 1, aaaa: 0, cname: 0, txt: 1, other: 0 },
} as const;

function read(overrides: Record<string, unknown> = {}): unknown {
  return {
    schemaVersion: 1,
    kind: "dns_health",
    readGeneration: 7,
    freshness,
    totalRows: 2,
    assetCount: 3,
    observedCount: 1,
    warningCount: 0,
    window: {
      startIndex: 0,
      size: 50,
      rows: [
        {
          entityId: "observed.test",
          zoneBinding: { providerKind: "cloudflare", connectionLabel: "Cloudflare", zoneLabel: "observed.test", validationStatus: "verified" },
          observation,
        },
        { entityId: "plain.test", zoneBinding: null, observation: null },
      ],
    },
    ...overrides,
  };
}

describe("DNS health Host read", () => {
  it("projects observed facts without ownership, delegation or record verdicts", () => {
    const view = projectDnsHealthViewModel([parseDnsHealthRead(read())], 50);
    expect(view.ownershipAvailability).toBe("unavailable");
    // Metrics are the Host's workspace-wide counts, not a count of this page's rows.
    expect(view.metrics).toMatchObject({ observed: 1, unobserved: 2, verified: 0, nameserverIssues: 0, recordIssues: 0 });
    expect(view.page).toEqual({ startIndex: 0, size: 50, totalItems: 2 });
    const [observed, plain] = view.rows;
    expect(observed).toMatchObject({
      ownershipStatus: "unavailable",
      delegationStatus: "unknown",
      // Zone nameservers are the platform's assignment, never reported as registrar delegation.
      delegatedNameservers: [],
      zoneNameservers: ["ada.ns.cloudflare.com"],
      dnssecStatus: "unknown",
      recordHealth: "observed",
      recordCount: 2,
      providerDisplayName: "Cloudflare",
      providerResolved: true,
      propagationStatus: "current",
      availableActions: [],
    });
    expect(plain).toMatchObject({ recordHealth: "unobserved", recordCount: null, propagationStatus: "unobserved", providerDisplayName: "—" });
  });

  it("offers binding only for an unbound asset with confirmed Cloudflare evidence of its own Zone", () => {
    const project = (row: Record<string, unknown>) => projectDnsHealthViewModel([parseDnsHealthRead(read({ totalRows: 1, window: { startIndex: 0, size: 50, rows: [row] } }))], 50).rows[0]!.availableActions;
    expect(project({ entityId: "observed.test", zoneBinding: null, observation })).toEqual(["bind_zone"]);
    const detached = { providerKind: "cloudflare", connectionLabel: "Cloudflare", zoneLabel: "observed.test", validationStatus: "detached" };
    expect(project({ entityId: "observed.test", zoneBinding: detached, observation })).toEqual(["bind_zone"]);
    // Already bound, unconfirmed, unavailable, or a Zone with another name: nothing to bind.
    expect(project({ entityId: "observed.test", zoneBinding: { ...detached, validationStatus: "verified" }, observation })).toEqual([]);
    for (const changed of [{ evidenceStatus: "stale" }, { evidenceStatus: "unknown" }, { availability: "unavailable" }, { zoneLabel: "other.test" }]) {
      expect(project({ entityId: "observed.test", zoneBinding: null, observation: { ...observation, ...changed } }), JSON.stringify(changed)).toEqual([]);
    }
    expect(project({ entityId: "plain.test", zoneBinding: null, observation: null })).toEqual([]);
  });

  it("treats stale or unavailable evidence as needing attention, never as current", () => {
    const rows = [{ entityId: "observed.test", zoneBinding: null, observation: { ...observation, evidenceStatus: "stale" } }];
    const view = projectDnsHealthViewModel([parseDnsHealthRead(read({ totalRows: 1, warningCount: 1, window: { startIndex: 0, size: 50, rows } }))], 50);
    // The page state follows the Host's workspace-wide warning count.
    expect(view.state).toBe("warning");
    expect(projectDnsHealthViewModel([parseDnsHealthRead(read({ totalRows: 1, window: { startIndex: 0, size: 50, rows } }))], 50).state).toBe("normal");
    expect(view.rows[0]?.propagationStatus).toBe("warning");
  });

  it("flags a confirmed but pending or unknown Zone, because delegation has not been observed", () => {
    for (const zoneStatus of ["pending", "unknown"] as const) {
      const rows = [{ entityId: "observed.test", zoneBinding: null, observation: { ...observation, zoneStatus } }];
      const view = projectDnsHealthViewModel([parseDnsHealthRead(read({ totalRows: 1, window: { startIndex: 0, size: 50, rows } }))], 50);
      expect(view.rows[0]?.propagationStatus).toBe("warning");
    }
  });

  it("shows a Zone bound on another launch platform without borrowing a Cloudflare observation", () => {
    const rows = [{
      entityId: "observed.test",
      zoneBinding: { providerKind: "spaceship", connectionLabel: "Spaceship main", zoneLabel: "observed.test", validationStatus: "verified" },
      observation,
    }];
    const view = projectDnsHealthViewModel([parseDnsHealthRead(read({ totalRows: 1, window: { startIndex: 0, size: 50, rows } }))], 50);
    expect(view.rows[0]).toMatchObject({
      providerDisplayName: "Spaceship main",
      providerResolved: true,
      propagationStatus: "unobserved",
      recordHealth: "unobserved",
      recordCount: null,
      delegatedNameservers: [],
      zoneNameservers: [],
      dnssecStatus: null,
      lastCheckedAt: null,
    });
    // A detached binding no longer claims the Zone, so the Cloudflare observation stands on its own.
    const detached = [{ ...rows[0], zoneBinding: { ...rows[0]!.zoneBinding, validationStatus: "detached" } }];
    const unbound = projectDnsHealthViewModel([parseDnsHealthRead(read({ totalRows: 1, window: { startIndex: 0, size: 50, rows: detached } }))], 50);
    expect(unbound.rows[0]).toMatchObject({ providerDisplayName: "Cloudflare", providerResolved: false, propagationStatus: "current" });
  });

  it("rejects a Zone bound on a platform outside ADR-0027", () => {
    for (const providerKind of ["registrar_dns", "custom", "route53"]) {
      const rows = [{ entityId: "plain.test", zoneBinding: { providerKind, connectionLabel: "Other", zoneLabel: "plain.test", validationStatus: "verified" }, observation: null }];
      expect(() => parseDnsHealthRead(read({ totalRows: 1, window: { startIndex: 0, size: 50, rows } }))).toThrow();
    }
    const observed = [{ entityId: "plain.test", zoneBinding: null, observation: { ...observation, providerKind: "spaceship" } }];
    expect(() => parseDnsHealthRead(read({ totalRows: 1, window: { startIndex: 0, size: 50, rows: observed } }))).toThrow();
  });

  it("rejects unknown fields, unordered rows and smuggled Provider identifiers", () => {
    expect(() => parseDnsHealthRead({ ...(read() as object), extra: true })).toThrow();
    const base = read() as { window: { rows: unknown[] } };
    expect(() => parseDnsHealthRead(read({ window: { startIndex: 0, size: 50, rows: [...base.window.rows].reverse() } }))).toThrow();
    const smuggled = [{ entityId: "plain.test", zoneBinding: null, observation: { ...observation, zoneId: "0".repeat(32) } }];
    expect(() => parseDnsHealthRead(read({ totalRows: 1, window: { startIndex: 0, size: 50, rows: smuggled } }))).toThrow();
    const control = [{ entityId: "plain.test", zoneBinding: { providerKind: "cloudflare", connectionLabel: "Cloud\u0007flare", zoneLabel: "plain.test", validationStatus: "verified" }, observation: null }];
    expect(() => parseDnsHealthRead(read({ totalRows: 1, window: { startIndex: 0, size: 50, rows: control } }))).toThrow();
    expect(() => parseDnsHealthRead(read({ totalRows: 1 }))).toThrow();
  });

  it("rejects counts beyond the workspace", () => {
    for (const counts of [{ assetCount: 1 }, { observedCount: 4 }, { warningCount: 2 }]) {
      expect(() => parseDnsHealthRead(read(counts)), JSON.stringify(counts)).toThrow();
    }
  });

  it("projects one whole page and refuses short pages, gaps or mixed Host generations", () => {
    const first = parseDnsHealthRead(read({ totalRows: 3 }));
    const second = parseDnsHealthRead(read({
      readGeneration: 8,
      totalRows: 3,
      window: { startIndex: 2, size: 50, rows: [{ entityId: "zeta.test", zoneBinding: null, observation: null }] },
    })) as DnsHealthRead;
    expect(() => projectDnsHealthViewModel([first, second], 3)).toThrow();
    expect(() => projectDnsHealthViewModel([first], 3)).toThrow();
    expect(() => projectDnsHealthViewModel([], 3)).toThrow();
    expect(() => projectDnsHealthViewModel([first, { ...second, observedCount: 0 }], 3)).toThrow();
    expect(projectDnsHealthViewModel([first, { ...second, readGeneration: 7 }], 3).rows).toHaveLength(3);
    // The last page alone may be short; its metrics still describe the whole workspace.
    const last = projectDnsHealthViewModel([{ ...second, readGeneration: 7 }], 2);
    expect(last.rows.map((row) => row.domain)).toEqual(["zeta.test"]);
    expect(last.page).toEqual({ startIndex: 2, size: 2, totalItems: 3 });
    expect(last.metrics).toMatchObject({ observed: 1, unobserved: 2 });
  });
});
