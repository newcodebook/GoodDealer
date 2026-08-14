import { describe, expect, it, vi } from "vitest";

import { Input } from "./input";

describe("Input", () => {
  it("renders a bare field wrapper with no label, error, or hint", () => {
    const el = Input({});
    expect(el.type).toBe("label");
    expect(el.props.className).toBe("gd-field");
    const [labelEl, wrapEl, hintEl] = el.props.children as [unknown, any, unknown];
    expect(labelEl).toBeFalsy();
    expect(hintEl).toBeFalsy();
    expect(wrapEl.props.className).toBe("gd-input-wrap gd-input-wrap--md");
  });

  it("renders the uppercase field label when provided", () => {
    const el = Input({ label: "Domain" });
    const [labelEl] = el.props.children as [any];
    expect(labelEl.type).toBe("span");
    expect(labelEl.props.className).toBe("gd-field-label");
    expect(labelEl.props.children).toBe("Domain");
  });

  it("switches to the error border and shows the error message over the hint", () => {
    const el = Input({ error: "Required", hint: "Ignored while error is set", size: "lg" });
    const [, wrapEl, hintEl] = el.props.children as [unknown, any, any];
    expect(wrapEl.props.className).toBe("gd-input-wrap gd-input-wrap--lg gd-input-wrap--error");
    expect(hintEl.props.className).toBe("gd-field-hint gd-field-hint--error");
    expect(hintEl.props.children).toBe("Required");
  });

  it("applies the mono modifier and forwards prefix/suffix/value/onChange to the native input", () => {
    const onChange = vi.fn();
    const el = Input({ mono: true, prefix: "$", suffix: "USD", value: "42", onChange });
    const [, wrapEl] = el.props.children as [unknown, any];
    const [prefixEl, inputEl, suffixEl] = wrapEl.props.children as [any, any, any];
    expect(prefixEl.props.children).toBe("$");
    expect(suffixEl.props.children).toBe("USD");
    expect(inputEl.type).toBe("input");
    expect(inputEl.props.className).toBe("gd-input gd-input--mono");
    expect(inputEl.props.value).toBe("42");
    expect(inputEl.props.onChange).toBe(onChange);
  });
});
