import { describe, expect, it } from "vitest";

import {
  TRANSPORT_REJECTION_SCHEMA_VERSION,
  transportRejectionCodeSchema,
  transportRejectionSchema,
} from "../src/wire/index";

describe("transport rejection wire contract", () => {
  it("pins the seven-code strict three-field envelope at the protocol boundary", () => {
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

    const envelope = {
      schemaVersion: 1,
      code: "NOT_FOUND",
      correlationId: "correlation-5",
    } as const;
    expect(transportRejectionSchema.parse(envelope)).toEqual(envelope);

    const widened = transportRejectionSchema.safeParse({
      ...envelope,
      message: "private implementation detail",
    });
    expect(widened.success).toBe(false);
    if (!widened.success) {
      expect(widened.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: [], keys: ["message"] }),
        ]),
      );
    }
  });
});
