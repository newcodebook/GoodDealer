import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  BOOTSTRAP_STEP_SCHEMA_VERSION,
  bootstrapStepRequestSchema,
  bootstrapStepResultSchema,
  encodeBootstrapStepRequestDigestInput,
  encodeBootstrapStepResultDigestInput,
} from "../src/devices/index";

const vectors = resolve(import.meta.dirname, "../test-vectors/bootstrap-steps");

function vector(path: string): unknown {
  return JSON.parse(readFileSync(resolve(vectors, path), "utf8"));
}

describe("bootstrap strict-step golden corpus", () => {
  it("freezes the amended bootstrap step schema version", () => {
    expect(BOOTSTRAP_STEP_SCHEMA_VERSION).toBe(2);
  });

  for (const path of [
    "request-pin-checkpoint.json",
    "request-fetch-mutations.json",
    "request-submit-rebuild-digest.json",
  ] as const) {
    it(`accepts valid/${path}`, () => {
      expect(bootstrapStepRequestSchema.safeParse(vector(`valid/${path}`)).success).toBe(true);
    });
  }

  for (const path of [
    "result-pin-checkpoint.json",
    "result-fetch-mutations.json",
    "result-submit-rebuild-digest.json",
  ] as const) {
    it(`accepts valid/${path}`, () => {
      expect(bootstrapStepResultSchema.safeParse(vector(`valid/${path}`)).success).toBe(true);
    });
  }

  for (const path of [
    "request-unknown-field.json",
    "request-snake-case.json",
    "request-payload-kind-mismatch.json",
    "request-fetch-before-checkpoint.json",
    "request-fetch-inverted-range.json",
    "request-page-limit-too-large.json",
    "request-unsorted-entity-digests.json",
    "request-unsafe-workflow-revision.json",
  ] as const) {
    it(`rejects invalid/${path}`, () => {
      expect(bootstrapStepRequestSchema.safeParse(vector(`invalid/${path}`)).success).toBe(false);
    });
  }

  for (const path of [
    "result-unknown-field.json",
    "result-payload-kind-mismatch.json",
    "result-mutation-page-gap.json",
    "result-missing-next-step-nonce.json",
    "result-nonterminal-null-next-step-nonce.json",
    "result-terminal-nonnull-next-step-nonce.json",
    "result-invalid-next-step-nonce-encoding.json",
  ] as const) {
    it(`rejects invalid/${path}`, () => {
      expect(bootstrapStepResultSchema.safeParse(vector(`invalid/${path}`)).success).toBe(false);
    });
  }

  it("freezes request and result digest transcripts", () => {
    const digest = (value: Uint8Array) => createHash("sha256").update(value).digest("base64url");
    expect(
      digest(encodeBootstrapStepRequestDigestInput(vector("valid/request-pin-checkpoint.json"))),
    ).toMatchInlineSnapshot(`"V-cW12Ult7-RIRDTTu7eMeU3s5lQSNJFhXJL-1pTKEI"`);
    expect(
      digest(encodeBootstrapStepResultDigestInput(vector("valid/result-pin-checkpoint.json"))),
    ).toMatchInlineSnapshot(`"vfJqIXA8Ya_SVko_6HLyRZ-Xe8m1UZkrMwpDJ5UriH0"`);
  });
});
