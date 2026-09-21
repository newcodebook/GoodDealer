import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  workspaceCheckpointReadResponseSchema,
  workspaceMutationPullResponseSchema,
  workspaceMutationPushResponseSchema,
} from "@gooddealer/protocol/workspace";
import { cloudflareDnsProjectionAckSchema } from "@gooddealer/protocol/workspace-observations/cloudflare-dns";

const corpus = JSON.parse(readFileSync(new URL("../test-vectors/native-cloud/wire-corpus.json", import.meta.url), "utf8")) as {
  valid: { name: string; kind: string; wire: string }[];
  invalid: { name: string; kind: string; wire: string; schemaAccepted?: boolean }[];
};

function accepts(kind: string, wire: string): boolean {
  let value: unknown;
  try {
    value = JSON.parse(wire);
  } catch {
    return false;
  }
  const schema = kind === "push-response"
    ? workspaceMutationPushResponseSchema
    : kind === "pull-response"
      ? workspaceMutationPullResponseSchema
      : kind === "checkpoint-response"
        ? workspaceCheckpointReadResponseSchema
        : cloudflareDnsProjectionAckSchema;
  return schema.safeParse(value).success;
}

describe("Native Cloud checked-in wire corpus", () => {
  it("accepts every generated valid response", () => {
    for (const testCase of corpus.valid) expect(accepts(testCase.kind, testCase.wire), testCase.name).toBe(true);
  });

  it("records public-schema behavior for every native-invalid response", () => {
    for (const testCase of corpus.invalid) {
      expect(accepts(testCase.kind, testCase.wire), testCase.name).toBe(testCase.schemaAccepted ?? false);
    }
  });
});
