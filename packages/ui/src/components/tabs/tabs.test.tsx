import { describe, expect, it } from "vitest";

import { Tabs } from "./tabs";

describe("Tabs", () => {
  it("renders a tablist with one tab button per item", () => {
    const el = Tabs({ items: [{ key: "a", label: "Assets" }, { key: "b", label: "Sold" }], active: "a" });
    expect(el.type).toBe("div");
    expect(el.props.className).toBe("gd-tabs");
    expect(el.props.role).toBe("tablist");
    const [tabA, tabB] = el.props.children as [any, any];
    expect(tabA.props.role).toBe("tab");
    expect(tabB.props.role).toBe("tab");
  });

  it("marks the active tab via class and aria-selected, leaves others inactive", () => {
    const el = Tabs({ items: [{ key: "a", label: "Assets" }, { key: "b", label: "Sold" }], active: "b" });
    const [tabA, tabB] = el.props.children as [any, any];
    expect(tabA.props.className).toBe("gd-tab");
    expect(tabA.props["aria-selected"]).toBe(false);
    expect(tabB.props.className).toBe("gd-tab gd-tab--active");
    expect(tabB.props["aria-selected"]).toBe(true);
  });

  it("renders the mono count pill only when count is provided", () => {
    const el = Tabs({ items: [{ key: "a", label: "Assets", count: 823 }, { key: "b", label: "Draft" }], active: "a" });
    const [tabA, tabB] = el.props.children as [any, any];
    const [labelA, countA] = tabA.props.children as [unknown, any];
    expect(labelA).toBe("Assets");
    expect(countA.props.className).toBe("gd-tab-count");
    expect(countA.props.children).toBe(823);

    const [, countB] = tabB.props.children as [unknown, unknown];
    expect(countB).toBeFalsy();
  });

  it("calls onChange with the clicked tab's key", () => {
    const clicked: string[] = [];
    const el = Tabs({
      items: [{ key: "a", label: "Assets" }, { key: "b", label: "Sold" }],
      active: "a",
      onChange: (key) => clicked.push(key),
    });
    const [, tabB] = el.props.children as [unknown, any];
    tabB.props.onClick();
    expect(clicked).toEqual(["b"]);
  });
});
