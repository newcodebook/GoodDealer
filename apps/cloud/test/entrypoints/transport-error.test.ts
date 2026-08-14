import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  TRANSPORT_REJECTION_SCHEMA_VERSION,
  transportRejectionCodeSchema,
  transportRejectionSchema,
} from "@gooddealer/protocol/wire";

const vectorsRoot = resolve(import.meta.dirname, "../../test-vectors/transport-error");

function vectors(kind: "valid" | "invalid"): unknown[] {
  return readdirSync(resolve(vectorsRoot, kind)).map((file) =>
    JSON.parse(readFileSync(resolve(vectorsRoot, kind, file), "utf8")) as unknown,
  );
}

describe("transport rejection wire contract", () => {
  it("accepts the valid golden vectors", () => {
    for (const vector of vectors("valid")) {
      expect(transportRejectionSchema.safeParse(vector).success).toBe(true);
    }
  });

  it("rejects wrong versions, unknown codes, missing fields, and disclosure fields", () => {
    for (const vector of vectors("invalid")) {
      expect(transportRejectionSchema.safeParse(vector).success).toBe(false);
    }
  });

  it("freezes the seven-code strict three-field envelope", () => {
    expect(TRANSPORT_REJECTION_SCHEMA_VERSION).toBe(1);
    expect(transportRejectionCodeSchema.options).toEqual([
      "UNAUTHENTICATED",
      "NOT_FOUND",
      "METHOD_NOT_ALLOWED",
      "SCHEMA_INVALID",
      "UNSUPPORTED_MEDIA_TYPE",
      "PAYLOAD_TOO_LARGE",
      "INTERNAL",
    ]);
    const parsed = transportRejectionSchema.parse({
      schemaVersion: 1,
      code: "NOT_FOUND",
      correlationId: "correlation-5",
    });
    expect(Object.keys(parsed)).toEqual(["schemaVersion", "code", "correlationId"]);
    for (const field of ["message", "detail", "path", "route"]) {
      expect(transportRejectionSchema.safeParse({ ...parsed, [field]: "secret" }).success).toBe(false);
    }
  });
});
