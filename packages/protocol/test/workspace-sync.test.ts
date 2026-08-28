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
  mutationPageSchema,
  syncMutationSchema,
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

  it("freezes the mutation page digest transcript", () => {
    const digest = createHash("sha256")
      .update(encodeMutationPageDigestInput(vector("valid/mutation-page.json")))
      .digest("base64url");
    expect(digest).toMatchInlineSnapshot(`"wc41T-gboDM2AV9_dx8CTNi23X6NDS0cHUn1iWvc1vE"`);
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
