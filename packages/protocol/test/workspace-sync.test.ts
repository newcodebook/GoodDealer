import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  checkpointDescriptorSchema,
  encodeMutationPageDigestInput,
  mutationPageSchema,
  syncMutationSchema,
  workspaceFieldMetadata,
} from "../src/workspace/index";

const vectors = resolve(import.meta.dirname, "../test-vectors/workspace-sync");

function vector(path: string): unknown {
  return JSON.parse(readFileSync(resolve(vectors, path), "utf8"));
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
    expect(digest).toMatchInlineSnapshot(`"OUmtP4KHs4AT8qfiBmAN-qc1bRO3sjd2vaocM3vh4fg"`);
  });
});
