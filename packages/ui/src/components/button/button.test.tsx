import { describe, expect, it, vi } from "vitest";

import { Button } from "./button";

// These components are pure, hook-free presentational functions (no useState/useEffect/context),
// so calling them directly returns the React element tree without needing a DOM renderer,
// jsdom, or @testing-library — none of which are in this workspace's dependency graph.
// See packages/ui/README.md "Testing approach" for the rationale.

describe("Button", () => {
  it("defaults to the secondary variant and md size", () => {
    const el = Button({ children: "Save" });
    expect(el.type).toBe("button");
    expect(el.props.className).toBe("gd-btn gd-btn--md gd-btn--secondary");
    expect(el.props.children).toEqual([undefined, "Save"]);
  });

  it("composes variant, size, and block into the class list", () => {
    const el = Button({ variant: "primary", size: "lg", block: true, children: "Confirm" });
    expect(el.props.className).toBe("gd-btn gd-btn--lg gd-btn--primary gd-btn--block");
  });

  it("forwards the icon before children and native button attributes to the element", () => {
    const onClick = vi.fn();
    const icon = "icon-node";
    const el = Button({ variant: "danger", icon, children: "Delete", onClick, disabled: true, type: "submit" });
    expect(el.props.children).toEqual([icon, "Delete"]);
    expect(el.props.onClick).toBe(onClick);
    expect(el.props.disabled).toBe(true);
    expect(el.props.type).toBe("submit");
    expect(el.props.className).toBe("gd-btn gd-btn--md gd-btn--danger");
  });

  it("supports every documented variant", () => {
    const variants = ["primary", "secondary", "ghost", "danger", "gold"] as const;
    for (const variant of variants) {
      expect(Button({ variant }).props.className).toContain(`gd-btn--${variant}`);
    }
  });
});
