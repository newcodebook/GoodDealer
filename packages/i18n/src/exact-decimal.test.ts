import { describe, expect, it } from "vitest";

import { formatDecimalExactly, roundDecimal, supportsExactStringInput, unformattableDecimal } from "./exact-decimal";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

describe("exact decimal formatting", () => {
  it("rounds half away from zero exactly, where a double would not", () => {
    // 1.005 is the double 1.00499999999999989…, which rounds down.
    expect(roundDecimal("1.005", 2)).toBe("1.01");
    expect(roundDecimal("-1.005", 2)).toBe("-1.01");
    expect(roundDecimal("0.004", 2)).toBe("0");
    expect(roundDecimal("-0.004", 2)).toBe("0");
    expect(roundDecimal("9.995", 2)).toBe("10");
    expect(roundDecimal("12.5", 0)).toBe("13");
    expect(roundDecimal("9007199254740993.125", 2)).toBe("9007199254740993.13");
    expect(roundDecimal("3500", 2)).toBe("3500");
    for (const bad of ["", "1.", ".5", "01", "1e3", "+1", "--1"]) expect(() => roundDecimal(bad, 2), bad).toThrow(RangeError);
  });

  it("formats identically with and without NumberFormat v3 while a double holds the value", () => {
    for (const value of ["1.005", "0.1", "-36900.5", "1234567890123.45", "0"]) {
      expect(formatDecimalExactly(money, value, false), value).toBe(formatDecimalExactly(money, value, true));
    }
    expect(formatDecimalExactly(money, "1.005", false)).toBe("$1.01");
  });

  it("shows a value a double cannot hold as unavailable, never rounded, when v3 is missing", () => {
    expect(formatDecimalExactly(money, "9007199254740993", false)).toBe(unformattableDecimal);
    // Rounding to the shown digits first keeps long fractions formattable.
    expect(formatDecimalExactly(money, "12.34567891", false)).toBe("$12.35");
    expect(formatDecimalExactly(money, "9007199254740993", true)).toBe("$9,007,199,254,740,993.00");
  });

  it("refuses options that would round other than to fraction digits half away from zero", () => {
    for (const options of [
      { maximumSignificantDigits: 3 },
      { notation: "compact" },
      { notation: "scientific" },
      { notation: "engineering" },
      { roundingMode: "floor" },
      { roundingIncrement: 5, maximumFractionDigits: 2, minimumFractionDigits: 2 },
    ] as Intl.NumberFormatOptions[]) {
      expect(() => formatDecimalExactly(new Intl.NumberFormat("en-US", options), "1.25", true), JSON.stringify(options)).toThrow(RangeError);
    }
    expect(formatDecimalExactly(new Intl.NumberFormat("en-US", { roundingMode: "halfExpand", maximumFractionDigits: 1 }), "1.25", true)).toBe("1.3");
  });

  it("detects the test engine's exact string input", () => {
    expect(supportsExactStringInput()).toBe(true);
  });
});
