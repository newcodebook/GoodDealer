import { describe, expect, it, vi } from "vitest";

import { IconButton } from "./icon-button";

describe("IconButton", () => {
  it("defaults to ghost/md and derives title + aria-label from the required label", () => {
    const el = IconButton({ label: "Refresh", children: "svg-icon" });
    expect(el.type).toBe("button");
    expect(el.props.className).toBe("gd-iconbtn gd-iconbtn--md");
    expect(el.props.title).toBe("Refresh");
    expect(el.props["aria-label"]).toBe("Refresh");
    expect(el.props.children).toBe("svg-icon");
  });

  it("adds the outline modifier class and honors size", () => {
    const el = IconButton({ label: "Close", variant: "outline", size: "sm" });
    expect(el.props.className).toBe("gd-iconbtn gd-iconbtn--sm gd-iconbtn--outline");
  });

  it("forwards native button attributes", () => {
    const onClick = vi.fn();
    const el = IconButton({ label: "Delete", onClick, disabled: true });
    expect(el.props.onClick).toBe(onClick);
    expect(el.props.disabled).toBe(true);
  });
});
