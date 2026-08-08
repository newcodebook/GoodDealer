import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { runtimeStatusSchema } from "../src/devices/runtime-status";

const vectorsRoot = resolve(import.meta.dirname, "../test-vectors/runtime-status");

function vectors(kind: "valid" | "invalid") {
  const directory = resolve(vectorsRoot, kind);
  return readdirSync(directory).map((file) => ({
    file,
    value: JSON.parse(readFileSync(resolve(directory, file), "utf8")) as unknown,
  }));
}

describe("runtime status golden corpus", () => {
  for (const vector of vectors("valid")) {
    it(`accepts ${vector.file}`, () => {
      expect(runtimeStatusSchema.safeParse(vector.value).success).toBe(true);
    });
  }

  for (const vector of vectors("invalid")) {
    it(`rejects ${vector.file}`, () => {
      expect(runtimeStatusSchema.safeParse(vector.value).success).toBe(false);
    });
  }
});
