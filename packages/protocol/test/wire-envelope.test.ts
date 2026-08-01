import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { wireEnvelopeSchema } from "../src/workspace/wire-envelope";

const vectorsRoot = resolve(import.meta.dirname, "../test-vectors/wire-envelope");

function vectors(kind: "valid" | "invalid") {
  const directory = resolve(vectorsRoot, kind);
  return readdirSync(directory).map((file) => ({
    file,
    value: JSON.parse(readFileSync(resolve(directory, file), "utf8")) as unknown,
  }));
}

describe("wire envelope golden corpus", () => {
  for (const vector of vectors("valid")) {
    it(`accepts ${vector.file}`, () => {
      expect(wireEnvelopeSchema.safeParse(vector.value).success).toBe(true);
    });
  }

  for (const vector of vectors("invalid")) {
    it(`rejects ${vector.file}`, () => {
      expect(wireEnvelopeSchema.safeParse(vector.value).success).toBe(false);
    });
  }
});
