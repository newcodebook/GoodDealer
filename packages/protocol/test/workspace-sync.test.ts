import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { encodeDomainSeparatedWireValue } from "../src/wire/index";

import {
  checkpointDescriptorSchema,
  compareUtf8,
  computeDomainAssetEntityDigests,
  domainAssetProjectionSchema,
  encodeDomainAssetProjectionDigestInput,
  encodeMutationPageDigestInput,
  checkpointEntityDigestsSchema,
  computeWorkspaceCheckpointDigest,
  computeWorkspaceCheckpointEntityDigests,
  encodeCheckpointEntityDigestsInput,
  mutationPageSchema,
  rebootstrapPlanSchema,
  syncMutationSchema,
  workspaceCheckpointReadRequestSchema,
  workspaceCheckpointStateSchema,
  workspaceFieldMetadata,
} from "../src/workspace/index";

const vectors = resolve(import.meta.dirname, "../test-vectors/workspace-sync");
const projectionVectors = resolve(import.meta.dirname, "../test-vectors/domain-asset-projection");

function vector(path: string): unknown {
  return JSON.parse(readFileSync(resolve(vectors, path), "utf8"));
}

function projectionVector(): { readonly rows: unknown; readonly digest: string } {
  const value = JSON.parse(
    readFileSync(resolve(projectionVectors, "valid/utf8-order.json"), "utf8"),
  ) as unknown;
  if (typeof value !== "object" || value === null || !("rows" in value) || !("digest" in value)) {
    throw new TypeError("domain asset projection vector must carry rows and digest");
  }
  if (typeof value.digest !== "string") throw new TypeError("domain asset projection digest must be a string");
  return { rows: value.rows, digest: value.digest };
}

describe("workspace sync golden corpus", () => {
  for (const path of ["mutation.json", "checkpoint.json", "mutation-page.json"] as const) {
    const schema = path === "mutation.json" ? syncMutationSchema : path === "checkpoint.json" ? checkpointDescriptorSchema : mutationPageSchema;
    it(`accepts valid/${path}`, () => {
      expect(schema.safeParse(vector(`valid/${path}`)).success).toBe(true);
    });
  }

  for (const path of [
    "mutation-unknown-field.json",
    "mutation-device-secret.json",
    "mutation-duplicate-field.json",
    "mutation-unsorted-fields.json",
    "mutation-unsorted-tags.json",
    "mutation-noncanonical-money.json",
    "mutation-note-control-character.json",
    "mutation-unsafe-revision.json",
    "mutation-base-not-before-server.json",
  ] as const) {
    it(`rejects invalid/${path}`, () => {
      expect(syncMutationSchema.safeParse(vector(`invalid/${path}`)).success).toBe(false);
    });
  }

  for (const path of [
    "page-cross-workspace.json",
    "page-revision-gap.json",
    "page-returned-revision-mismatch.json",
    "page-terminal-before-target.json",
    "page-cursor-at-target.json",
  ] as const) {
    it(`rejects invalid/${path}`, () => {
      expect(mutationPageSchema.safeParse(vector(`invalid/${path}`)).success).toBe(false);
    });
  }

  it("keeps privacy and merge policy in the protocol registry", () => {
    expect(workspaceFieldMetadata).toEqual({
      "domain_asset.note": { privacyClass: "SENSITIVE_BUSINESS", mergeClass: "manual" },
      "domain_asset.portfolioId": { privacyClass: "PUBLIC_BUSINESS", mergeClass: "auto" },
      "domain_asset.tags": { privacyClass: "PUBLIC_BUSINESS", mergeClass: "auto" },
      "domain_asset.targetPrice": { privacyClass: "PUBLIC_BUSINESS", mergeClass: "manual" },
    });
  });

  it("requires an entity generation and constrains a re-add (ADR-0029)", () => {
    const valid = vector("valid/mutation.json") as Record<string, unknown>;
    const parse = (override: Record<string, unknown>) => syncMutationSchema.safeParse({ ...valid, ...override }).success;
    expect(parse({})).toBe(true);
    const { entityGeneration: _entityGeneration, ...withoutGeneration } = valid;
    expect(syncMutationSchema.safeParse(withoutGeneration).success).toBe(false);
    expect(parse({ entityGeneration: 0 })).toBe(false);
    expect(parse({ schemaVersion: 2 })).toBe(false);
    // A re-add names a later generation and builds on the deletion it supersedes (R <= base).
    expect(parse({ entityGeneration: 2, reAddsDeletedRevision: 4 })).toBe(true);
    expect(parse({ entityGeneration: 1, reAddsDeletedRevision: 4 })).toBe(false);
    expect(parse({ entityGeneration: 2, reAddsDeletedRevision: 5 })).toBe(false);
    expect(parse({ entityGeneration: 2, reAddsDeletedRevision: 0 })).toBe(false);
    expect(parse({
      entityGeneration: 2, reAddsDeletedRevision: 4, operationKind: "delete",
      deletedAt: "2026-08-28T00:00:00Z", changedFields: [],
    })).toBe(false);
  });

  it("freezes the mutation page digest transcript", () => {
    const digest = createHash("sha256")
      .update(encodeMutationPageDigestInput(vector("valid/mutation-page.json")))
      .digest("base64url");
    expect(digest).toMatchInlineSnapshot(`"Xl3ettkqfTzpWKe49RIyCXEpL7sHFO3mh5RduHEbu4k"`);
  });

  it("orders canonical domain asset identities by UTF-8 bytes", () => {
    const parsed = domainAssetProjectionSchema.parse(projectionVector().rows);
    const entityIds = parsed.map(({ entityId }) => entityId);

    expect(entityIds).toEqual(["a-asset.test", "z-asset.test"]);
    expect([...entityIds].sort(compareUtf8)).toEqual(entityIds);
    expect(domainAssetProjectionSchema.safeParse(
      JSON.parse(readFileSync(resolve(projectionVectors, "invalid/locale-order.json"), "utf8")),
    ).success).toBe(false);
  });

  it("freezes the shared domain asset digest encoder and injected SHA-256 helper", async () => {
    const golden = projectionVector();
    const rows = domainAssetProjectionSchema.parse(golden.rows);
    const digest = createHash("sha256")
      .update(encodeDomainAssetProjectionDigestInput(rows))
      .digest("base64url");

    expect(digest).toBe(golden.digest);
    await expect(computeDomainAssetEntityDigests(
      rows,
      async (bytes) => createHash("sha256").update(bytes).digest(),
    )).resolves.toEqual([{
      entityType: "domain_asset",
      partitionId: "p0000",
      digest: golden.digest,
    }]);
    await expect(computeDomainAssetEntityDigests(rows, async () => new Uint8Array(31)))
      .rejects.toThrow("SHA-256 digest must be exactly 32 bytes");
  });

  it("preserves the pre-lift domain and canonical row layout for locale-equal inputs", () => {
    const rows = domainAssetProjectionSchema.parse([{
      entityId: "asset-1.test",
      note: null,
      portfolioId: "portfolio-1",
      tags: ["brandable", "premium"],
      targetPrice: { currency: "USD", amount: "1200" },
    }]);

    expect(encodeDomainAssetProjectionDigestInput(rows)).toEqual(
      encodeDomainSeparatedWireValue("GOODDEALER-WORKSPACE-DOMAIN-ASSET-V1", rows),
    );
  });

  it("rejects storage metadata and secret fields from domain asset digest rows", () => {
    for (const path of [
      "revision-metadata.json",
      "secret-field.json",
    ] as const) {
      const input = JSON.parse(readFileSync(resolve(projectionVectors, `invalid/${path}`), "utf8"));
      expect(domainAssetProjectionSchema.safeParse(input).success).toBe(false);
    }
  });
});

describe("workspace checkpoint state v3 (ADR-0029)", () => {
  const sha256 = async (bytes: Uint8Array) => createHash("sha256").update(bytes).digest();
  const asset = (entityId: string, entityGeneration = 1) => ({
    entityId, note: null, portfolioId: null, tags: [], targetPrice: null, entityGeneration,
  });
  const tombstone = (entityId: string, deletedServerRevision = 3) => ({
    entityId, entityGeneration: 1, deletedServerRevision, deletedAt: "2026-08-28T00:00:00Z",
  });

  it("refuses version 2 checkpoint requests and descriptors", () => {
    expect(checkpointDescriptorSchema.safeParse({ ...(vector("valid/checkpoint.json") as object), schemaVersion: 2 }).success)
      .toBe(false);
    expect(workspaceCheckpointReadRequestSchema.safeParse({ schemaVersion: 2 }).success).toBe(false);
    expect(workspaceCheckpointReadRequestSchema.safeParse({ schemaVersion: 3 }).success).toBe(true);
  });

  it("requires ordered, disjoint, generation-bearing entities", () => {
    const parse = (value: unknown) => workspaceCheckpointStateSchema.safeParse(value).success;
    expect(parse({ assets: [asset("a.test")], tombstones: [tombstone("b.test")] })).toBe(true);
    expect(parse({ assets: [asset("a.test")], tombstones: [tombstone("a.test")] })).toBe(false);
    expect(parse({ assets: [asset("b.test"), asset("a.test")], tombstones: [] })).toBe(false);
    expect(parse({ assets: [], tombstones: [tombstone("b.test"), tombstone("a.test")] })).toBe(false);
    expect(parse({ assets: [{ ...asset("a.test"), entityGeneration: 0 }], tombstones: [] })).toBe(false);
    const { entityGeneration: _generation, ...ungenerated } = asset("a.test");
    expect(parse({ assets: [ungenerated], tombstones: [] })).toBe(false);
    expect(parse({ assets: [], tombstones: [tombstone("a.test", 0)] })).toBe(false);
    expect(parse({ assets: [], tombstones: [{ ...tombstone("a.test"), deletedAt: "2026-08-28" }] })).toBe(false);
    expect(parse({ assets: [], tombstones: [{ ...tombstone("a.test"), extra: true }] })).toBe(false);
    expect(parse({ assets: [] })).toBe(false);
  });

  it("partitions live assets and tombstones under separate types and domains", async () => {
    const digests = await computeWorkspaceCheckpointEntityDigests(
      { assets: [], tombstones: [tombstone("a.test")] },
      sha256,
    );
    expect(digests.map(({ entityType, partitionId }) => [entityType, partitionId])).toEqual([
      ["domain_asset", "empty"],
      ["domain_asset_tombstone", "t0000"],
    ]);
    const live = await computeWorkspaceCheckpointEntityDigests({ assets: [asset("a.test")], tombstones: [] }, sha256);
    expect(live.map(({ partitionId }) => partitionId)).toEqual(["p0000"]);
    // The same id live and deleted digests differently, and generation is covered.
    const regenerated = await computeWorkspaceCheckpointEntityDigests({ assets: [asset("a.test", 2)], tombstones: [] }, sha256);
    expect(regenerated[0]!.digest).not.toBe(live[0]!.digest);
    const many = await computeWorkspaceCheckpointEntityDigests({
      assets: [],
      tombstones: Array.from({ length: 513 }, (_, index) => tombstone(`t${index.toString().padStart(4, "0")}.test`)),
    }, sha256);
    expect(many.map(({ partitionId }) => partitionId)).toEqual(["empty", "t0000", "t0001"]);
  });

  it("binds every tombstone into the aggregate checkpoint digest", async () => {
    const withTombstone = await computeWorkspaceCheckpointDigest({ assets: [asset("a.test")], tombstones: [tombstone("b.test")] }, sha256);
    const without = await computeWorkspaceCheckpointDigest({ assets: [asset("a.test")], tombstones: [] }, sha256);
    expect(withTombstone).not.toBe(without);
    const moved = await computeWorkspaceCheckpointDigest({ assets: [asset("a.test"), asset("b.test")], tombstones: [] }, sha256);
    expect(moved).not.toBe(withTombstone);
    expect(withTombstone).toMatchInlineSnapshot(`"xkQ6BnsKFdJ5BE4VhCUPukv8DV-GyfUYZQXVpKQKvdk"`);
  });

  it("refuses entity digest lists whose partition shape contradicts their type", () => {
    const digest = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const parse = (value: unknown) => checkpointEntityDigestsSchema.safeParse(value).success;
    expect(parse([{ entityType: "domain_asset", partitionId: "empty", digest }])).toBe(true);
    expect(parse([{ entityType: "domain_asset", partitionId: "t0000", digest }])).toBe(false);
    expect(parse([{ entityType: "domain_asset_tombstone", partitionId: "p0000", digest }])).toBe(false);
    expect(parse([{ entityType: "domain_asset_tombstone", partitionId: "empty", digest }])).toBe(false);
    expect(parse([
      { entityType: "domain_asset_tombstone", partitionId: "t0000", digest },
      { entityType: "domain_asset", partitionId: "empty", digest },
    ])).toBe(false);
    expect(() => encodeCheckpointEntityDigestsInput([])).toThrow();
  });

  it("refuses a rebootstrap plan whose checkpoint holds a later deletion", () => {
    const descriptor = { ...(vector("valid/checkpoint.json") as Record<string, unknown>), throughServerRevision: 2 };
    const plan = (deletedServerRevision: number) => ({
      schemaVersion: 3,
      checkpoint: descriptor,
      snapshot: { assets: [], tombstones: [tombstone("a.test", deletedServerRevision)] },
      requiredMutationRange: { fromServerRevisionExclusive: 2, throughServerRevisionInclusive: 2 },
      mutations: [],
      pinnedHeadRevision: 2,
      pinnedHeadDigest: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    });
    expect(rebootstrapPlanSchema.safeParse(plan(2)).success).toBe(true);
    expect(rebootstrapPlanSchema.safeParse(plan(3)).success).toBe(false);
    expect(rebootstrapPlanSchema.safeParse({ ...plan(2), schemaVersion: 2 }).success).toBe(false);
  });
});
