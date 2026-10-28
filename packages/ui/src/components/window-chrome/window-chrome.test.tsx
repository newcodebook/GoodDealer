import { describe, expect, it, vi } from "vitest";

import { WindowChrome } from "./window-chrome";

describe("WindowChrome", () => {
  it("renders the reference titlebar controls and body structure", () => {
    const el = WindowChrome({ mark: "mark", context: "账户", children: "body" });
    const [titlebar, body] = el.props.children;
    const [, brand, context, controls] = titlebar.props.children;
    const [minimize, maximize, close] = controls.props.children;

    expect(el.type).toBe("div");
    expect(el.props.className).toBe("gd-window");
    expect(titlebar.props.className).toBe("gd-titlebar");
    expect(brand.props.children).toEqual(["mark", "GoodDealer"]);
    expect(context.props.children).toBe("账户");
    expect([minimize.props["aria-label"], maximize.props["aria-label"], close.props["aria-label"]]).toEqual([
      "最小化",
      "最大化",
      "关闭",
    ]);
    expect([minimize.props.tabIndex, maximize.props.tabIndex, close.props.tabIndex]).toEqual([-1, -1, -1]);
    expect([minimize.props.type, maximize.props.type, close.props.type]).toEqual(["button", "button", "button"]);
    expect(body.props.className).toBe("gd-window-body");
    expect(body.props.children).toBe("body");
  });

  it("forwards each window control callback only to its own button", () => {
    const onMinimize = vi.fn();
    const onToggleMaximize = vi.fn();
    const onClose = vi.fn();
    const el = WindowChrome({ onMinimize, onToggleMaximize, onClose });
    const controls = el.props.children[0].props.children[3];
    const [minimize, maximize, close] = controls.props.children;

    expect(minimize.props.onClick).toBe(onMinimize);
    expect(maximize.props.onClick).toBe(onToggleMaximize);
    expect(close.props.onClick).toBe(onClose);
  });

  it("leaves controls to the OS and drops the mock frame for a native window", () => {
    const el = WindowChrome({ framed: false, controls: "none", leading: "inset", titlebarAttributes: { "data-drag": "" } });
    const titlebar = el.props.children[0];

    expect(el.props.className).toBe("gd-window gd-window--native");
    expect(titlebar.props["data-drag"]).toBe("");
    expect(titlebar.props.children[0]).toBe("inset");
    expect(titlebar.props.children[3]).toBeNull();
  });

  it("forwards style and renders optional footer after the body", () => {
    const footer = "footer";
    const el = WindowChrome({ appName: "Desk", footer, style: { width: 520 } });

    expect(el.props.style).toEqual({ width: 520 });
    expect(el.props.children[2]).toBe(footer);
    expect(el.props.children[0].props.children[1].props.children[1]).toBe("Desk");
  });
});
