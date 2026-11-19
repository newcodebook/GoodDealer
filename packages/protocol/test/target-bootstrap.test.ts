import { describe, expect, it } from "vitest";
import { deviceBootstrapStatusRequestSchema, deviceBootstrapStatusResponseSchema, deviceSwitchLookupRequestSchema } from "../src/devices/index";

describe("target bootstrap control wire", () => {
  it("requires an explicit nullable discovery selector and rejects caller authority", () => {
    for (const requestId of [null, "switch-original"]) {
      expect(deviceBootstrapStatusRequestSchema.parse({ schemaVersion: 1, requestId })).toEqual({ schemaVersion: 1, requestId });
    }
    for (const value of [{ schemaVersion: 1 }, { schemaVersion: 2, requestId: null }, { schemaVersion: 1, requestId: "" }, { schemaVersion: 1, requestId: null, deviceId: "chosen" }, { schemaVersion: 1, requestId: null, workspaceId: "chosen" }]) {
      expect(deviceBootstrapStatusRequestSchema.safeParse(value).success).toBe(false);
    }
  });
  it("never turns discovery or an incomplete history into cancellation authority", () => {
    expect(deviceSwitchLookupRequestSchema.safeParse({ schemaVersion: 1, requestId: null }).success).toBe(false);
    expect(deviceBootstrapStatusResponseSchema.parse({ schemaVersion: 1, found: false })).toEqual({ schemaVersion: 1, found: false });
    for (const value of [{ schemaVersion: 1, found: false, request: null }, { schemaVersion: 1, found: true }, { schemaVersion: 1, found: true, request: { schemaVersion: 1 } }]) {
      expect(deviceBootstrapStatusResponseSchema.safeParse(value).success).toBe(false);
    }
  });
});
