import { describe, expect, it } from "vitest";

import { formatDate, formatMoney, formatNumber } from "./formatters";

describe("deterministic Intl formatters", () => {
  it("formats dates in UTC by default", () => {
    const value = Date.UTC(2026, 7, 17, 23, 30, 0);
    expect(formatDate("zh-CN", value)).toBe("2026/08/17");
    expect(formatDate("en-US", value)).toBe("08/17/2026");
    expect(formatDate("en-US", value, { timeZone: "Asia/Shanghai" })).toBe(
      "08/18/2026",
    );
    expect(formatDate("en-US", value, { dateStyle: "full" })).toBe(
      "Monday, August 17, 2026",
    );
  });

  it("formats numbers without business-specific transformations", () => {
    expect(formatNumber("zh-CN", 1_234_567.891)).toBe("1,234,567.89");
    expect(formatNumber("en-US", 12n)).toBe("12");
    expect(formatNumber("en-US", 0.125, { style: "percent" })).toBe("12.5%");
  });

  it("formats money using an explicit ISO currency", () => {
    expect(formatMoney("zh-CN", 1_234.5, "USD")).toBe("US$1,234.50");
    expect(formatMoney("en-US", 1_234.5, "USD")).toBe("$1,234.50");
    expect(formatMoney("zh-CN", 1_234.5, "CNY")).toBe("¥1,234.50");
  });

  it("rejects invalid values rather than rendering misleading output", () => {
    expect(() => formatDate("zh-CN", Number.NaN)).toThrow(
      "Date value must be valid",
    );
    expect(() => formatNumber("zh-CN", Number.POSITIVE_INFINITY)).toThrow(
      "Numeric value must be finite",
    );
    expect(() => formatMoney("en-US", 1, "usd")).toThrow(
      "Currency must be a three-letter uppercase ISO 4217 code",
    );
  });
});
