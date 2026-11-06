import { describe, expect, it } from "vitest";

import { connectionLabelMaxLength, connectionLabelSchema } from "./connection-label";

describe("connection label", () => {
  it("bounds labels in UTF-16 units, the same unit the Host counts", () => {
    expect(connectionLabelMaxLength).toBe(120);
    expect(connectionLabelSchema.parse("Cloudflare 主账户")).toBe("Cloudflare 主账户");
    expect(connectionLabelSchema.safeParse("a".repeat(120)).success).toBe(true);
    expect(connectionLabelSchema.safeParse("\u{1F310}".repeat(60)).success).toBe(true);
    expect(connectionLabelSchema.safeParse("a".repeat(121)).success).toBe(false);
    expect(connectionLabelSchema.safeParse("\u{1F310}".repeat(61)).success).toBe(false);
  });

  it("rejects empty labels and hidden control or format characters", () => {
    for (const label of ["", "Cloud\u0007flare", "Cloud​flare", "Cloud‮flare", "Cloud﻿flare", "Cloud\u{E0041}flare", "Cloud\u0600flare"]) {
      expect(connectionLabelSchema.safeParse(label).success, JSON.stringify(label)).toBe(false);
    }
  });
});
