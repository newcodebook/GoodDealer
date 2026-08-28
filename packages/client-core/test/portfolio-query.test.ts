import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { computeDomainAssetEntityDigests } from "@gooddealer/protocol/workspace";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  ActiveLocalPortfolioAdapter,
  StandbyCloudPortfolioAdapter,
  portfolioQueryResultSchema,
  type PortfolioQueryBoundary,
  type PortfolioQueryPort,
  type PortfolioQueryResult,
} from "../src/index";

const projectionVector = JSON.parse(readFileSync(
  new URL("../../protocol/test-vectors/domain-asset-projection/valid/utf8-order.json", import.meta.url),
  "utf8",
)) as { readonly rows: unknown; readonly digest: string };

const timestamp = "2026-08-15T12:00:00Z";

function result(source: "active_local" | "standby_cloud"): PortfolioQueryResult {
  return portfolioQueryResultSchema.parse({
    schemaVersion: 1,
    workspaceId: "workspace-1",
    domains: projectionVector.rows,
    freshness: {
      source,
      serverRevision: 7,
      lastReplicationActivityAt: timestamp,
      lastSuccessfulProviderObservationAt: "2026-08-15T11:59:00Z",
      canEdit: source === "active_local",
    },
  });
}

function boundary(value: unknown): PortfolioQueryBoundary {
  return { listDomains: async () => structuredClone(value) };
}

function sharedContract(createAdapter: (input: PortfolioQueryBoundary) => PortfolioQueryPort, expected: PortfolioQueryResult) {
  it("returns the strict non-secret domain projection and DataFreshness", async () => {
    await expect(createAdapter(boundary(expected)).listDomains()).resolves.toEqual(expected);
  });

  it("rejects unknown fields, unsafe revisions, and non-canonical entity order", async () => {
    const extraField = { ...expected, credentialRef: "keychain:item-1" };
    const unsafeRevision = {
      ...expected,
      freshness: { ...expected.freshness, serverRevision: Number.MAX_SAFE_INTEGER + 1 },
    };
    const reversedRows = { ...expected, domains: [...expected.domains].reverse() };

    await expect(createAdapter(boundary(extraField)).listDomains()).rejects.toThrow();
    await expect(createAdapter(boundary(unsafeRevision)).listDomains()).rejects.toThrow();
    await expect(createAdapter(boundary(reversedRows)).listDomains()).rejects.toThrow();
  });
}

describe("ActiveLocalPortfolioAdapter contract", () => {
  sharedContract((input) => new ActiveLocalPortfolioAdapter(input), result("active_local"));

  it("rejects Standby provenance even when its payload is otherwise valid", async () => {
    await expect(new ActiveLocalPortfolioAdapter(boundary(result("standby_cloud"))).listDomains())
      .rejects.toThrow("expected active_local freshness");
  });
});

describe("StandbyCloudPortfolioAdapter contract", () => {
  sharedContract((input) => new StandbyCloudPortfolioAdapter(input), result("standby_cloud"));

  it("rejects Active provenance and cannot claim editability", async () => {
    await expect(new StandbyCloudPortfolioAdapter(boundary(result("active_local"))).listDomains())
      .rejects.toThrow("expected standby_cloud freshness");
    expect(portfolioQueryResultSchema.safeParse({
      ...result("standby_cloud"),
      freshness: { ...result("standby_cloud").freshness, canEdit: true },
    }).success).toBe(false);
  });
});

describe("P0-23 adapter equivalence", () => {
  it("exposes one read-only port shape", () => {
    expectTypeOf<keyof PortfolioQueryPort>().toEqualTypeOf<"listDomains">();
    expectTypeOf<PortfolioQueryPort["listDomains"]>().returns.resolves.toEqualTypeOf<PortfolioQueryResult>();
  });

  it("produces byte-identical business digests through Active and Standby", async () => {
    const active = await new ActiveLocalPortfolioAdapter(boundary(result("active_local"))).listDomains();
    const standby = await new StandbyCloudPortfolioAdapter(boundary(result("standby_cloud"))).listDomains();
    const digest = async (bytes: Uint8Array) => new Uint8Array(createHash("sha256").update(bytes).digest());

    const [activeDigest] = await computeDomainAssetEntityDigests(active.domains, digest);
    const [standbyDigest] = await computeDomainAssetEntityDigests(standby.domains, digest);
    expect(active.domains).toEqual(standby.domains);
    expect(activeDigest?.digest).toBe(projectionVector.digest);
    expect(standbyDigest).toEqual(activeDigest);
    expect(active.freshness).toMatchObject({ source: "active_local", canEdit: true });
    expect(standby.freshness).toMatchObject({ source: "standby_cloud", canEdit: false });
  });
});
