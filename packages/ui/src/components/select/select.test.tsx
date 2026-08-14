import { describe, expect, it, vi } from "vitest";

import { Select } from "./select";

describe("Select", () => {
  it("renders a bare wrapper without a field label when label is omitted", () => {
    const el = Select({ options: ["a", "b"] });
    expect(el.type).toBe("span");
    expect(el.props.className).toBe("gd-select-wrap");
  });

  it("wraps the select in a labeled field when label is provided", () => {
    const el = Select({ label: "Registrar", options: [] });
    expect(el.type).toBe("label");
    expect(el.props.className).toBe("gd-field");
    const [labelEl, wrapEl] = el.props.children as [any, any];
    expect(labelEl.props.children).toBe("Registrar");
    expect(wrapEl.type).toBe("span");
    expect(wrapEl.props.className).toBe("gd-select-wrap");
  });

  it("normalizes string and {value,label} options into <option> elements", () => {
    const el = Select({ options: ["spaceship", { value: "cf", label: "Cloudflare" }], size: "lg" });
    const selectEl = el.props.children;
    expect(selectEl.type).toBe("select");
    expect(selectEl.props.className).toBe("gd-select gd-select--lg");
    const [optA, optB] = selectEl.props.children as [any, any];
    expect(optA.props.value).toBe("spaceship");
    expect(optA.props.children).toBe("spaceship");
    expect(optB.props.value).toBe("cf");
    expect(optB.props.children).toBe("Cloudflare");
  });

  it("forwards value/onChange to the native select", () => {
    const onChange = vi.fn();
    const el = Select({ options: ["a"], value: "a", onChange });
    const selectEl = el.props.children;
    expect(selectEl.props.value).toBe("a");
    expect(selectEl.props.onChange).toBe(onChange);
  });
});
