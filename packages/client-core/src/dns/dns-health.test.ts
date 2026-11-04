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
    const view = projectDnsHealthViewModel([parseDnsHealthRead(read())]);
    expect(view.ownershipAvailability).toBe("unavailable");
    expect(view.metrics).toMatchObject({ observed: 1, unobserved: 1, verified: 0, nameserverIssues: 0, recordIssues: 0 });
    const [observed, plain] = view.rows;
    expect(observed).toMatchObject({
      ownershipStatus: "unavailable",
      delegationStatus: "unknown",
      delegatedNameservers: ["ada.ns.cloudflare.com"],
      recordHealth: "observed",
      recordCount: 2,
      providerDisplayName: "Cloudflare",
      providerResolved: true,
      propagationStatus: "current",
      availableActions: [],
    });
    expect(plain).toMatchObject({ recordHealth: "unobserved", recordCount: null, propagationStatus: "unobserved", providerDisplayName: "—" });
  });

  it("treats stale or unavailable evidence as needing attention, never as current", () => {
    const rows = [{ entityId: "observed.test", zoneBinding: null, observation: { ...observation, evidenceStatus: "stale" } }];
    const view = projectDnsHealthViewModel([parseDnsHealthRead(read({ totalRows: 1, window: { startIndex: 0, size: 50, rows } }))]);
    expect(view.state).toBe("warning");
    expect(view.rows[0]?.propagationStatus).toBe("warning");
  });

  it("flags a confirmed but pending or unknown Zone, because delegation has not been observed", () => {
    for (const zoneStatus of ["pending", "unknown"] as const) {
      const rows = [{ entityId: "observed.test", zoneBinding: null, observation: { ...observation, zoneStatus } }];
      const view = projectDnsHealthViewModel([parseDnsHealthRead(read({ totalRows: 1, window: { startIndex: 0, size: 50, rows } }))]);
      expect(view.rows[0]?.propagationStatus).toBe("warning");
    }
  });

  it("shows a Zone bound on another launch platform without borrowing a Cloudflare observation", () => {
    const rows = [{
      entityId: "observed.test",
      zoneBinding: { providerKind: "spaceship", connectionLabel: "Spaceship main", zoneLabel: "observed.test", validationStatus: "verified" },
      observation,
    }];
    const view = projectDnsHealthViewModel([parseDnsHealthRead(read({ totalRows: 1, window: { startIndex: 0, size: 50, rows } }))]);
    expect(view.rows[0]).toMatchObject({
      providerDisplayName: "Spaceship main",
      providerResolved: true,
      propagationStatus: "unobserved",
      recordHealth: "unobserved",
      recordCount: null,
      delegatedNameservers: [],
      lastCheckedAt: null,
    });
    expect(view.metrics).toMatchObject({ observed: 0, unobserved: 1 });
    // A detached binding no longer claims the Zone, so the Cloudflare observation stands on its own.
    const detached = [{ ...rows[0], zoneBinding: { ...rows[0]!.zoneBinding, validationStatus: "detached" } }];
    const unbound = projectDnsHealthViewModel([parseDnsHealthRead(read({ totalRows: 1, window: { startIndex: 0, size: 50, rows: detached } }))]);
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

  it("refuses to stitch windows from different Host generations or with gaps", () => {
    const first = parseDnsHealthRead(read({ totalRows: 3 }));
    const second = parseDnsHealthRead(read({
      readGeneration: 8,
      totalRows: 3,
      window: { startIndex: 2, size: 50, rows: [{ entityId: "zeta.test", zoneBinding: null, observation: null }] },
    })) as DnsHealthRead;
    expect(() => projectDnsHealthViewModel([first, second])).toThrow();
    expect(() => projectDnsHealthViewModel([first])).toThrow();
    expect(() => projectDnsHealthViewModel([])).toThrow();
    expect(projectDnsHealthViewModel([first, { ...second, readGeneration: 7 }]).rows).toHaveLength(3);
  });
});
