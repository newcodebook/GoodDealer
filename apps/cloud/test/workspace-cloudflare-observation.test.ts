import { createHash } from "node:crypto";
import { cloudflareDnsProjectionDigestInput, parseCloudflareDnsProjectionRequest } from "@gooddealer/protocol/workspace-observations/cloudflare-dns";
import { describe, expect, it, vi } from "vitest";

import { PostgresCloudflareDnsObservationIngress } from "../src/modules/workspace/sync/cloudflare-observation";

const principal = {
  accountId: "account-a",
  sessionId: "session-a",
  clientKind: "desktop" as const,
  transactionCredential: new TextEncoder().encode("credential-a"),
};
const request = {
  schemaVersion: 1 as const,
  providerKind: "cloudflare" as const,
  observationCapability: "dns" as const,
  observationId: "11111111-1111-4111-8111-111111111111",
  entityId: "example.com",
  leaseEpoch: 1,
  sourceSequence: 1,
  observedAt: "2026-09-15T00:00:00Z",
  availability: "available" as const,
  zoneStatus: "active" as const,
  counts: { a: 1, aaaa: 0, cname: 0, txt: 0, proxied: 1 },
};

function transaction(options: {
  readonly receipt?: Record<string, unknown>;
  readonly latest?: Record<string, unknown>;
  readonly device?: Record<string, unknown>;
  readonly lease?: Record<string, unknown>;
  readonly authority?: Record<string, unknown>;
} = {}) {
  const digest = createHash("sha256").update("unused").digest();
  const queries: string[] = [];
  return {
    scope: { accountId: "account-a", workspaceId: "workspace-a" },
    queries,
    async query(text: string): Promise<any> {
      queries.push(text);
      if (text.includes("cloudflare_dns_observation_receipts") && text.includes("SELECT")) {
        return { rows: options.receipt === undefined ? [] : [options.receipt] };
      }
      if (text.includes("pg_advisory_xact_lock")) return { rows: [] };
      if (text.includes("identity_auth_sessions")) return { rows: [options.device ?? { device_id: "device-a" }] };
      if (text.includes("device_account_states")) return { rows: [{ status: "bound" }] };
      if (text.includes("licensing_api.read_authoritative_entitlement_snapshot")) return { rows: [options.authority ?? {
        source_revision: 1,
        state: "active",
        commercial_expires_at: new Date("2026-09-15T01:00:00Z"),
        feature_entitlements: ["cloudflare:dns:observe"],
        trusted_now: new Date("2026-09-15T00:00:00Z"),
      }] };
      if (text.includes("device_active_leases")) return { rows: [options.lease ?? { lease_epoch: 1, device_id: "device-a" }] };
      if (text.includes("clock_timestamp() AS now")) return { rows: [{ now: new Date("2026-09-15T00:00:00Z") }] };
      if (text.includes("workspace_replica_domain_assets")) return { rowCount: 1, rows: [{}] };
      if (text.includes("cloudflare_dns_observation_projections") && text.includes("SELECT")) {
        return { rows: options.latest === undefined ? [] : [options.latest] };
      }
      if (text.includes("workspace_revisions")) return { rowCount: 1, rows: [{}] };
      if (text.includes("observation_sequence_heads")) return { rows: [{ observation_sequence: 1 }] };
      if (text.includes("INSERT INTO cloudflare_dns_observation_receipts")) return { rows: [] };
      if (text.includes("INSERT INTO cloudflare_dns_observation_projections")) return { rows: [] };
      return { rows: [], rowCount: 1, digest };
    },
  };
}

describe("Cloudflare observation ingress", () => {
  it("rejects non-desktop, malformed, and selector-bearing projections before transaction", async () => {
    const withAccountCredential = vi.fn();
    const service = new PostgresCloudflareDnsObservationIngress({
      transactions: { withAccountCredential },
      workspaces: { resolveLocked: async () => ({ accountId: "account-a", workspaceId: "workspace-a" }) },
    });
    await expect(service.submit(request, { ...principal, clientKind: "account_web" })).resolves.toBeNull();
    await expect(service.submit({ ...request, workspaceId: "foreign" }, principal)).resolves.toBeNull();
    expect(withAccountCredential).not.toHaveBeenCalled();
  });

  it("derives device/tenant, persists receipt and latest head, and returns echoed digest", async () => {
    const tx = transaction();
    const resolveLocked = vi.fn(async (received) => {
      expect(received).toBe(tx);
      return { accountId: "account-a", workspaceId: "workspace-a" };
    });
    const service = new PostgresCloudflareDnsObservationIngress({
      transactions: { withAccountCredential: async (_credential, _purpose, operation) => operation(tx as any) },
      workspaces: { resolveLocked },
    });
    const ack = await service.submit(request, principal);
    expect(ack).toMatchObject({
      schemaVersion: 1,
      accepted: true,
      observationId: request.observationId,
      leaseEpoch: 1,
      sourceSequence: 1,
      observationSequence: 1,
      disposition: "current",
    });
    expect(ack?.canonicalRequestDigest).toMatch(/^[0-9a-f]{64}$/u);
    expect(resolveLocked).toHaveBeenCalledOnce();
    expect(tx.queries.findIndex((query) => query.includes("set_config('gooddealer.workspace_id'")))
      .toBeLessThan(tx.queries.findIndex((query) => query.includes("cloudflare_dns_observation_receipts")));
    expect(tx.queries.some((query) => query.includes("pg_advisory_xact_lock"))).toBe(true);
    expect(tx.queries.some((query) => query.includes("INSERT INTO cloudflare_dns_observation_receipts"))).toBe(true);
    expect(tx.queries.some((query) => query.includes("INSERT INTO cloudflare_dns_observation_projections"))).toBe(true);
  });

  it("returns a frozen old-epoch receipt before skew, current-Lease, or latest-head checks", async () => {
    const replayRequest = { ...request, observedAt: "2025-01-01T00:00:00Z" };
    const digest = createHash("sha256")
      .update(cloudflareDnsProjectionDigestInput(parseCloudflareDnsProjectionRequest(replayRequest)))
      .digest();
    const tx = transaction({ receipt: {
      observation_id: request.observationId,
      device_id: "device-a",
      lease_epoch: "1",
      source_sequence: "1",
      entity_id: request.entityId,
      canonical_request_digest: digest,
      observation_sequence: "41",
      disposition: "current",
    } });
    const service = new PostgresCloudflareDnsObservationIngress({
      transactions: { withAccountCredential: async (_credential, _purpose, operation) => operation(tx as any) },
      workspaces: { resolveLocked: async () => ({ accountId: "account-a", workspaceId: "workspace-a" }) },
    });
    const replay = await service.submit(replayRequest, principal);
    expect(replay).toMatchObject({ observationSequence: 41, leaseEpoch: 1, sourceSequence: 1, disposition: "current" });
    expect(tx.queries.some((query) => query.includes("device_active_leases"))).toBe(false);
    expect(tx.queries.some((query) => query.includes("cloudflare_dns_observation_projections"))).toBe(false);
  });

  it("requires a new epoch to start at source sequence one", async () => {
    const tx = transaction({ latest: {
      lease_epoch: 1,
      source_sequence: 9,
      canonical_request_digest: Buffer.alloc(32),
    } });
    const service = new PostgresCloudflareDnsObservationIngress({
      transactions: { withAccountCredential: async (_credential, _purpose, operation) => operation(tx as any) },
      workspaces: { resolveLocked: async () => ({ accountId: "account-a", workspaceId: "workspace-a" }) },
    });
    await expect(service.submit({ ...request, leaseEpoch: 2, sourceSequence: 2 }, principal)).resolves.toBeNull();
    expect(tx.queries.some((query) => query.includes("INSERT INTO cloudflare_dns_observation_receipts"))).toBe(false);
  });

  it.each([
    ["receipt digest", { receipt: {
      observation_id: request.observationId, device_id: "device-a", lease_epoch: 1, source_sequence: 1,
      entity_id: request.entityId, canonical_request_digest: Buffer.alloc(31), observation_sequence: 1, disposition: "current",
    } }],
    ["latest unsafe integer", { latest: {
      lease_epoch: 1, source_sequence: "9007199254740992", canonical_request_digest: Buffer.alloc(32),
    } }],
    ["session extra column", { device: { device_id: "device-a", token: "forbidden" } }],
    ["lease malformed epoch", { lease: { lease_epoch: "01", device_id: "device-a" } }],
    ["commercial invalid date", { authority: {
      source_revision: 1, state: "active", commercial_expires_at: "not-a-time",
      feature_entitlements: ["cloudflare:dns:observe"], trusted_now: new Date("2026-09-15T00:00:00Z"),
    } }],
  ])("fails closed on corrupt %s database row", async (_name, options) => {
    const tx = transaction(options);
    const service = new PostgresCloudflareDnsObservationIngress({
      transactions: { withAccountCredential: async (_credential, _purpose, operation) => operation(tx as any) },
      workspaces: { resolveLocked: async () => ({ accountId: "account-a", workspaceId: "workspace-a" }) },
    });
    await expect(service.submit(request, principal)).resolves.toBeNull();
    expect(tx.queries.some((query) => query.includes("INSERT INTO cloudflare_dns_observation_receipts"))).toBe(false);
  });
});
