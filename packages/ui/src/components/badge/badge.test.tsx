import { describe, expect, it } from "vitest";

import { Badge } from "./badge";

describe("Badge", () => {
  it("defaults to neutral uppercase monospace styling", () => {
    const el = Badge({ children: "Idle" });

    expect(el.type).toBe("span");
    expect(el.props.className).toBe("gd-badge");
    expect(el.props.style).toMatchObject({
      color: "var(--gd-text-muted)",
      background: "color-mix(in srgb, var(--gd-text-muted) 12%, transparent)",
    });
  });

  it("renders the exact warning tone and sans modifier used by Locked entitlement", () => {
    const el = Badge({ tone: "warning", mono: false, children: "已锁定" });

    expect(el.props.className).toBe("gd-badge gd-badge--sans");
    expect(el.props.style).toEqual({
      color: "var(--gd-warning)",
      background: "var(--gd-warning-tint)",
    });
  });

  it("renders an optional dot before children and lets caller styles override tone defaults", () => {
    const el = Badge({ tone: "success", dot: true, style: { color: "var(--text-1)" }, children: "Ready" });
    const [dot, label] = el.props.children;

    expect(dot.props.className).toBe("gd-badge-dot");
    expect(label).toBe("Ready");
    expect(el.props.style).toMatchObject({
      background: "var(--gd-success-tint)",
      color: "var(--text-1)",
    });
  });

  it("supports every documented tone", () => {
    const tones = ["sync", "gold", "success", "warning", "danger", "neutral"] as const;

    for (const tone of tones) expect(Badge({ tone }).props.style).toEqual(expect.any(Object));
  });
});
