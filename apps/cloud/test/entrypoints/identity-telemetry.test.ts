import { describe, expect, it, vi } from "vitest";

import { IdentityBoundaryTelemetry } from "../../src/entrypoints/identity-telemetry";

describe("Identity boundary telemetry", () => {
  it("emits and counts only closed redacted labels", async () => {
    const write = vi.fn(async () => undefined);
    const telemetry = new IdentityBoundaryTelemetry(write, () => new Date("2026-09-21T09:00:00.123Z"));
    await telemetry.observe({ operation: "login", outcome: "invalid" });
    await telemetry.observe({ operation: "login", outcome: "invalid" });
    expect(telemetry.count("login", "invalid")).toBe(2);
    expect(write).toHaveBeenLastCalledWith({
      event: "identity_boundary", operation: "login", outcome: "invalid", observedAt: "2026-09-21T09:00:00Z",
    });
    expect(JSON.stringify(write.mock.calls)).not.toMatch(/email|password|session|account|address/iu);
  });
});
