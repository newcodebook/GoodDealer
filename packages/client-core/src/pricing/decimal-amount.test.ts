import { describe, expect, it } from "vitest";

import {
  adjustAmountByTenthsOfPercent,
  amountSign,
  amountUnits,
  isZeroAmount,
  midpointWholeAmount,
  multiplyAmount,
  relativeWholePercent,
  subtractAmounts,
  sumAmounts,
  unitsAmount,
} from "./decimal-amount";

describe("decimal amounts", () => {
  it("round-trips every contract amount exactly, beyond a double's precision", () => {
    for (const amount of ["0", "1", "0.00000001", "9999999999999999.99999999", "1234567890123456.7"]) {
      expect(unitsAmount(amountUnits(amount))).toBe(amount);
    }
    expect(sumAmounts(["9999999999999999.99999999", "0.00000001"])).toBe("10000000000000000");
    // A number has already lost the last digit of this amount before any arithmetic.
    expect(String(Number("9007199254740993"))).toBe("9007199254740992");
    expect(sumAmounts(["9007199254740993", "0"])).toBe("9007199254740993");
    expect(sumAmounts(["0.1", "0.2"])).toBe("0.3");
    expect(sumAmounts([])).toBe("0");
    expect(unitsAmount(amountUnits("1.50"))).toBe("1.5");
  });

  it("rejects anything but plain decimal text", () => {
    for (const bad of ["", "01", "1.", ".5", "1e3", "1.123456789", "+1", "1,000", " 1", "NaN", "-", "--1"]) {
      expect(() => amountUnits(bad), bad).toThrow(RangeError);
    }
    expect(() => multiplyAmount("1", 1.5)).toThrow(RangeError);
    expect(() => adjustAmountByTenthsOfPercent("1", 0.5)).toThrow(RangeError);
  });

  it("accepts its own results, which can exceed a contract amount's 16 whole digits", () => {
    const max = "9999999999999999.99999999";
    const total = sumAmounts([max, max]);
    expect(total).toBe("19999999999999999.99999998");
    expect(subtractAmounts(total, max)).toBe(max);
    expect(subtractAmounts(multiplyAmount(max, 3), total)).toBe(max);
    expect(sumAmounts(["9000000000000000", "9000000000000000"])).toBe("18000000000000000");
    expect(amountSign(subtractAmounts("1", total))).toEqual({ sign: -1, magnitude: "19999999999999998.99999998" });
  });

  it("splits a sign from its magnitude", () => {
    expect(amountSign("-36900")).toEqual({ sign: -1, magnitude: "36900" });
    expect(amountSign("0")).toEqual({ sign: 0, magnitude: "0" });
    expect(amountSign("0.5")).toEqual({ sign: 1, magnitude: "0.5" });
  });

  it("subtracts to signed results and multiplies by whole terms", () => {
    expect(subtractAmounts("45000", "8100")).toBe("36900");
    expect(subtractAmounts("8100", "45000")).toBe("-36900");
    expect(subtractAmounts("1", "1")).toBe("0");
    expect(multiplyAmount("10.44", 3)).toBe("31.32");
    expect(multiplyAmount("0.1", 3)).toBe("0.3");
    expect(isZeroAmount("0.00")).toBe(true);
    expect(isZeroAmount("0.01")).toBe(false);
  });

  it("adjusts by a percent to cents, half up, never below zero", () => {
    expect(adjustAmountByTenthsOfPercent("3500", -100)).toBe("3150");
    expect(adjustAmountByTenthsOfPercent("19.99", 125)).toBe("22.49");
    // 1.005 × 1 is a half cent: it rounds up exactly, where 1.005 * 100 in a double does not.
    expect(adjustAmountByTenthsOfPercent("1.005", 0)).toBe("1.01");
    expect(Math.round(1.005 * 100) / 100).toBe(1);
    expect(adjustAmountByTenthsOfPercent("10", -1000)).toBe("0");
    expect(adjustAmountByTenthsOfPercent("10", -2000)).toBe("0");
  });

  it("finds the whole-unit midpoint and a relative percent, rounding half up like Math.round", () => {
    expect(midpointWholeAmount("3000", "4000")).toBe("3500");
    expect(midpointWholeAmount("3000", "4001")).toBe("3501");
    expect(midpointWholeAmount("0.4", "0.5")).toBe("0");
    expect(relativeWholePercent("3150", "3500")).toBe(-10);
    expect(relativeWholePercent("3517.5", "3500")).toBe(1);
    // −0.5 % rounds up to 0, as Math.round does (which returns −0).
    expect(relativeWholePercent("3482.5", "3500")).toBe(0);
    expect(relativeWholePercent("1", "0")).toBeNull();
  });
});
