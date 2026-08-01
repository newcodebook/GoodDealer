import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { wireEnvelopeSchema } from "@gooddealer/protocol/workspace";

const vectorsRoot = resolve(import.meta.dirname, "../../../packages/protocol/test-vectors/wire-envelope");

function vectors(kind: "valid" | "invalid") {
  const directory = resolve(vectorsRoot, kind);
  return readdirSync(directory).map((file) =>
    JSON.parse(readFileSync(resolve(directory, file), "utf8")) as unknown,
  );
}

describe("Cloud wire envelope compatibility", () => {
  it("accepts every valid shared vector", () => {
    for (const vector of vectors("valid")) {
      expect(wireEnvelopeSchema.safeParse(vector).success).toBe(true);
    }
  });

  it("rejects every invalid shared vector", () => {
    for (const vector of vectors("invalid")) {
      expect(wireEnvelopeSchema.safeParse(vector).success).toBe(false);
    }
  });
});
