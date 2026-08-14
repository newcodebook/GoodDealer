import { describe, expect, it, vi } from "vitest";

import { Checkbox } from "./checkbox";

describe("Checkbox", () => {
  it("renders unchecked by default with the base box class", () => {
    const el = Checkbox({});
    expect(el.type).toBe("label");
    expect(el.props.className).toBe("gd-check");
    const [inputEl, boxEl] = el.props.children as [any, any];
    expect(inputEl.props.checked).toBe(false);
    expect(boxEl.props.className).toBe("gd-check-box");
  });

  it("shows the indeterminate modifier only while unchecked", () => {
    const indeterminateUnchecked = Checkbox({ indeterminate: true, checked: false });
    const [, boxA] = indeterminateUnchecked.props.children as [any, any];
    expect(boxA.props.className).toBe("gd-check-box gd-check-box--ind");

    const indeterminateChecked = Checkbox({ indeterminate: true, checked: true });
    const [, boxB] = indeterminateChecked.props.children as [any, any];
    expect(boxB.props.className).toBe("gd-check-box");
  });

  it("applies the disabled modifier and passes disabled to the native input", () => {
    const el = Checkbox({ disabled: true });
    expect(el.props.className).toBe("gd-check gd-check--disabled");
    const [inputEl] = el.props.children as [any];
    expect(inputEl.props.disabled).toBe(true);
  });

  it("renders the label span only when a label is given", () => {
    const withLabel = Checkbox({ label: "Select all" });
    const [, , labelEl] = withLabel.props.children as [unknown, unknown, any];
    expect(labelEl.props.children).toBe("Select all");

    const withoutLabel = Checkbox({});
    const [, , labelEl2] = withoutLabel.props.children as [unknown, unknown, unknown];
    expect(labelEl2).toBeFalsy();
  });

  it("stops click propagation only when stop is true", () => {
    const withStop = Checkbox({ stop: true });
    const stopPropagation = vi.fn();
    (withStop.props.onClick as (e: unknown) => void)({ stopPropagation });
    expect(stopPropagation).toHaveBeenCalledOnce();

    const withoutStop = Checkbox({});
    expect(withoutStop.props.onClick).toBeUndefined();
  });

  it("forwards onChange to the native input", () => {
    const onChange = vi.fn();
    const el = Checkbox({ onChange });
    const [inputEl] = el.props.children as [any];
    expect(inputEl.props.onChange).toBe(onChange);
  });
});
