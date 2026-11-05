import { describe, expect, it } from "vitest";

import { parseManualTasksRead, projectManualTaskInbox, type ManualTaskRow, type ManualTasksRead } from "./manual-tasks-read";

const freshness = { source: "active_local", readOnlyReason: null, serverRevision: 7, lastReplicationActivityAt: null, lastSuccessfulProviderObservationAt: null, canEdit: true } as const;

const waiting: ManualTaskRow = {
  title: "Nameserver change",
  operationKind: "dns_change",
  capability: "dns_write",
  providerKind: "cloudflare",
  connectionLabel: "DNS",
  highRisk: true,
  itemCount: 2,
  waitingSince: "2026-11-01T10:00:00Z",
  lastObservedAt: "2026-11-02T10:00:00Z",
  domainCount: 2,
  domains: ["alpha.test", "bravo.test"],
};
const unbound: ManualTaskRow = {
  ...waiting,
  title: "Account step",
  providerKind: null,
  connectionLabel: null,
  highRisk: false,
  itemCount: 1,
  waitingSince: "2026-11-02T10:00:00Z",
  lastObservedAt: null,
  domainCount: 0,
  domains: [],
};

function read(rows: readonly ManualTaskRow[] = [waiting, unbound], overrides: Partial<ManualTasksRead> = {}): ManualTasksRead {
  return { schemaVersion: 1, kind: "manual_tasks", readGeneration: 3, freshness, totalRows: rows.length, window: { startIndex: 0, size: 200, rows }, ...overrides };
}

const labels = {
  reason: (platform: string | null, capability: string) => platform === null ? `unbound ${capability}` : `${platform} needs ${capability} in its console`,
  completionCondition: "Completes once the Host observes the platform state",
  noPlatform: "No platform",
  noAccount: "—",
};

describe("manual tasks read", () => {
  it("accepts Host tasks and rejects identifiers, browser or authorization fields and bad shapes", () => {
    expect(parseManualTasksRead(read())).toEqual(read());
    for (const extra of ["planId", "operationId", "connectionId", "remoteBrowserSession", "automation", "authorizationUrl", "credential"]) {
      expect(() => parseManualTasksRead(read([{ ...waiting, [extra]: "canary" } as ManualTaskRow])), extra).toThrow();
    }
    expect(() => parseManualTasksRead(read([{ ...waiting, providerKind: "sedo" } as unknown as ManualTaskRow]))).toThrow();
    expect(() => parseManualTasksRead(read([{ ...waiting, connectionLabel: null }]))).toThrow();
    expect(() => parseManualTasksRead(read([{ ...waiting, connectionLabel: "Bad\nlabel" }]))).toThrow();
    expect(() => parseManualTasksRead(read([{ ...waiting, domainCount: 3 }]))).toThrow();
    // A task carries only the sample the inbox names: exactly three of its five domains.
    const large = { ...waiting, itemCount: 5, domainCount: 5, domains: ["a.test", "b.test", "c.test"] };
    expect(parseManualTasksRead(read([large])).window.rows[0]?.domains).toHaveLength(3);
    expect(() => parseManualTasksRead(read([{ ...large, domains: ["a.test", "b.test", "c.test", "d.test"] }]))).toThrow();
    expect(() => parseManualTasksRead(read([{ ...large, domains: ["a.test", "b.test"] }]))).toThrow();
    expect(() => parseManualTasksRead(read([{ ...waiting, domains: ["bravo.test", "alpha.test"] }]))).toThrow();
    expect(() => parseManualTasksRead(read([{ ...waiting, capability: "Dns Write" }]))).toThrow();
    expect(() => parseManualTasksRead(read([unbound, waiting]))).toThrow();
    expect(() => parseManualTasksRead(read([waiting], { totalRows: 0 }))).toThrow();
  });

  it("projects read-only tasks with no actions or risk acceptance", () => {
    const view = projectManualTaskInbox([read()], labels, "task-1");
    expect(view).toMatchObject({ commandAdmission: "unavailable", selectedTaskId: "task-1" });
    expect(view.tasks[0]).toMatchObject({
      title: "Nameserver change", priority: "high", status: "awaiting_user", platform: "Cloudflare", account: "DNS",
      reason: "Cloudflare needs dns_write in its console", affectedDomains: ["alpha.test", "bravo.test"], affectedDomainCount: 2,
      lastCheckedAt: "2026-11-02T10:00:00Z", checklist: [], riskAcceptancePolicy: "forbidden", availableActions: [],
    });
    expect(view.tasks[1]).toMatchObject({ platform: "No platform", account: "—", reason: "unbound dns_write", priority: "normal", affectedDomains: [], affectedDomainCount: 0 });
    expect(projectManualTaskInbox([read()], labels, "task-9").selectedTaskId).toBeNull();
  });

  it("requires complete contiguous windows of one generation", () => {
    const halves = [
      read([waiting], { totalRows: 2, window: { startIndex: 0, size: 1, rows: [waiting] } }),
      read([unbound], { totalRows: 2, window: { startIndex: 1, size: 1, rows: [unbound] } }),
    ];
    expect(projectManualTaskInbox(halves, labels, null).tasks).toHaveLength(2);
    expect(() => projectManualTaskInbox(halves.slice(0, 1), labels, null)).toThrow();
    expect(() => projectManualTaskInbox([halves[0]!, { ...halves[1]!, readGeneration: 4 }], labels, null)).toThrow();
    expect(() => projectManualTaskInbox([], labels, null)).toThrow();
  });
});
