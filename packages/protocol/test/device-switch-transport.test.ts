import { describe, expect, it } from "vitest";

import { deviceSwitchLookupRequestSchema, deviceSwitchResponseSchema } from "../src/devices/index";

const request = {
  schemaVersion: 1, requestId: "switch-1", mode: "normal", status: "draining", fromDeviceId: "device-old",
  toDeviceId: "device-new", requestedAt: "2026-11-17T00:00:00Z", earliestTakeoverAt: null, bootstrapExpiresAt: null,
} as const;

describe("device switch transport (ADR-0032 S1b)", () => {
  it("names a switch by id only", () => {
    expect(deviceSwitchLookupRequestSchema.parse({ schemaVersion: 1, requestId: "switch-1" })).toEqual({ schemaVersion: 1, requestId: "switch-1" });
    for (const hostile of [
      { schemaVersion: 1, requestId: "switch-1", deviceId: "device-x" },
      { schemaVersion: 1, requestId: "" },
      { schemaVersion: 2, requestId: "switch-1" },
    ]) {
      expect(deviceSwitchLookupRequestSchema.safeParse(hostile).success).toBe(false);
    }
  });

  it("accepts a view or one closed rejection code, never both", () => {
    expect(deviceSwitchResponseSchema.parse({ schemaVersion: 1, accepted: true, request }).accepted).toBe(true);
    expect(deviceSwitchResponseSchema.parse({ schemaVersion: 1, accepted: false, code: "FORCED_SWITCH_UNAVAILABLE" }).accepted).toBe(false);
    for (const hostile of [
      { schemaVersion: 1, accepted: true, request, code: "SWITCH_IN_PROGRESS" },
      { schemaVersion: 1, accepted: false, code: "SWITCH_IN_PROGRESS", request },
      { schemaVersion: 1, accepted: false, code: "ACTIVE_DEVICE_CONFLICT" },
      { schemaVersion: 1, accepted: true, request: { ...request, status: "bootstrapping" } },
      { schemaVersion: 1, accepted: true, request: { ...request, mode: "forced" } },
    ]) {
      expect(deviceSwitchResponseSchema.safeParse(hostile).success).toBe(false);
    }
  });
});
