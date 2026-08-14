import { describe, expect, it, vi } from "vitest";

import { Switch } from "./switch";

describe("Switch", () => {
  it("renders unchecked and enabled by default", () => {
    const el = Switch({});
    expect(el.type).toBe("label");
    expect(el.props.className).toBe("gd-switch");
    const [inputEl, trackEl] = el.props.children as [any, any];
    expect(inputEl.props.checked).toBe(false);
    expect(trackEl.props.className).toBe("gd-switch-track");
  });

  it("applies the disabled modifier and forwards disabled to the native input", () => {
    const el = Switch({ disabled: true });
    expect(el.props.className).toBe("gd-switch gd-switch--disabled");
    const [inputEl] = el.props.children as [any];
    expect(inputEl.props.disabled).toBe(true);
  });

  it("renders the label span only when a label is given", () => {
    const withLabel = Switch({ label: "Auto-renew" });
    const [, , labelEl] = withLabel.props.children as [unknown, unknown, any];
    expect(labelEl.props.children).toBe("Auto-renew");

    const withoutLabel = Switch({});
    const [, , labelEl2] = withoutLabel.props.children as [unknown, unknown, unknown];
    expect(labelEl2).toBeFalsy();
  });

  it("forwards checked and onChange to the native input", () => {
    const onChange = vi.fn();
    const el = Switch({ checked: true, onChange });
    const [inputEl] = el.props.children as [any];
    expect(inputEl.props.checked).toBe(true);
    expect(inputEl.props.onChange).toBe(onChange);
  });
});
