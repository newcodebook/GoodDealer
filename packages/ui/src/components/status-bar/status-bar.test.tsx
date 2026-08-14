import { describe, expect, it } from "vitest";

import { StatusBar } from "./status-bar";

describe("StatusBar", () => {
  it("renders an empty footer with just a spacer when no segments are given", () => {
    const el = StatusBar({});
    expect(el.type).toBe("footer");
    expect(el.props.className).toBe("gd-statusbar");
    const [leftGroup, spacer, rightGroup] = el.props.children as [unknown[], any, unknown[]];
    expect(leftGroup).toEqual([]);
    expect(spacer.props.className).toBe("gd-statusbar-spacer");
    expect(rightGroup).toEqual([]);
  });

  it("wraps each left segment in a seg span and does not divide a single segment", () => {
    const el = StatusBar({ left: ["SYNCED"] });
    const [leftGroup] = el.props.children as [any[]];
    expect(leftGroup).toHaveLength(1);
    expect(leftGroup[0].props.className).toBe("gd-statusbar-seg");
    expect(leftGroup[0].props.children).toBe("SYNCED");
  });

  it("inserts a hairline divider between segments, not before the first", () => {
    const el = StatusBar({ left: ["SYNCED", "Rev 42", "Active: MBP"] });
    const [leftGroup] = el.props.children as [any[]];
    // seg, div, seg, div, seg
    expect(leftGroup).toHaveLength(5);
    expect(leftGroup[0].props.className).toBe("gd-statusbar-seg");
    expect(leftGroup[1].props.className).toBe("gd-statusbar-div");
    expect(leftGroup[2].props.className).toBe("gd-statusbar-seg");
    expect(leftGroup[3].props.className).toBe("gd-statusbar-div");
    expect(leftGroup[4].props.className).toBe("gd-statusbar-seg");
  });

  it("dividers left and right groups independently", () => {
    const el = StatusBar({ left: ["a", "b"], right: ["x", "y", "z"] });
    const [leftGroup, , rightGroup] = el.props.children as [any[], unknown, any[]];
    expect(leftGroup).toHaveLength(3);
    expect(rightGroup).toHaveLength(5);
  });
});
