import { describe, expect, it } from "vitest";
import { deviceSelfNameIntentSchema, parseDeviceDirectoryView } from "./device-directory";

const own = { deviceId: "device-1", displayName: "Desk", platform: "macos", status: "bound", role: "active", currentDevice: true, lastSeenAt: "2026-11-18T15:00:00Z" };
const view = { schemaVersion: 1, listRevision: 2, devices: [own] };

describe("redacted device directory", () => {
  it("admits only the closed display contract", () => {
    expect(parseDeviceDirectoryView(view)).toEqual(view);
    for (const bad of [null, { ...view, accountId: "secret" }, { ...view, devices: [{ ...own, signingKeyId: "secret" }] }, { ...view, devices: [] },
      { ...view, devices: [own, own] }, { ...view, listRevision: Number.MAX_SAFE_INTEGER + 1 },
      ...[{ currentDevice: false }, { role: "none" }, { status: "removed" }, { lastSeenAt: "2026-02-30T15:00:00Z" }, { lastSeenAt: "2026-11-18T15:01:00Z" }, { displayName: "a\u200bb" }].map((change) => ({ ...view, devices: [{ ...own, ...change }] })),
    ]) expect(() => parseDeviceDirectoryView(bad)).toThrow();
  });
  it("rejects selectors and hidden characters in name intents", () => {
    for (const displayName of ["", "a ", " a", "a\nb", "a\u200bb", "😀".repeat(65)]) {
      expect(deviceSelfNameIntentSchema.safeParse({ schemaVersion: 1, displayName }).success).toBe(false);
    }
    expect(deviceSelfNameIntentSchema.safeParse({ schemaVersion: 1, displayName: "办公室" }).success).toBe(true);
    expect(deviceSelfNameIntentSchema.safeParse({ schemaVersion: 1, displayName: "Desk", platform: "windows" }).success).toBe(false);
  });
});
