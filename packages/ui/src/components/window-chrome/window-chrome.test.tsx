import { describe, expect, it, vi } from "vitest";

import { WindowChrome } from "./window-chrome";

describe("WindowChrome", () => {
  it("renders the reference titlebar controls and body structure", () => {
    const el = WindowChrome({ mark: "mark", context: "账户", children: "body" });
    const [titlebar, body] = el.props.children;
    const [brand, context, controls] = titlebar.props.children;
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

  it("keeps minimize and maximize inert and forwards only the close callback", () => {
    const onClose = vi.fn();
    const el = WindowChrome({ onClose });
    const controls = el.props.children[0].props.children[2];
    const [minimize, maximize, close] = controls.props.children;

    expect(minimize.props.onClick).toBeUndefined();
    expect(maximize.props.onClick).toBeUndefined();
    expect(close.props.onClick).toBe(onClose);
  });

  it("forwards style and renders optional footer after the body", () => {
    const footer = "footer";
    const el = WindowChrome({ appName: "Desk", footer, style: { width: 520 } });

    expect(el.props.style).toEqual({ width: 520 });
    expect(el.props.children[2]).toBe(footer);
    expect(el.props.children[0].props.children[0].props.children[1]).toBe("Desk");
  });
});
