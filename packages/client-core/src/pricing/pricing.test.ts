import { describe, expect, it } from "vitest";

import {
  commerceMoneySchema,
  createPriceChangePlan,
  formatCommerceAmount,
  formatBasisPoints,
  normalizePriceInput,
  projectPriceEditor,
  ValidatingPricingQueryAdapter,
} from "./index";

describe("pricing contracts", () => {
  it("keeps canonical business money as decimal text", () => {
    expect(commerceMoneySchema.parse({ currency: "USD", amount: "99999.95" })).toEqual({
      currency: "USD",
      amount: "99999.95",
    });
    expect(() => commerceMoneySchema.parse({ currency: "USD", amount: 99999.95 })).toThrow();
    expect(() => commerceMoneySchema.parse({ currency: "usd", amount: "1" })).toThrow();
    expect(() => commerceMoneySchema.parse({ currency: "USD", amount: "01.00" })).toThrow();
  });

  it("normalizes price input without Number or floating-point calculations", () => {
    expect(normalizePriceInput(" 99,999.95 ")).toBe("99999.95");
    expect(normalizePriceInput("0.00000001")).toBe("0.00000001");
    expect(normalizePriceInput("0.000000001")).toBeNull();
    expect(normalizePriceInput("1e6")).toBeNull();
    expect(normalizePriceInput("Infinity")).toBeNull();
  });

  it("creates a typed price plan only for a valid changed amount", () => {
    const current = { currency: "USD", amount: "42000" } as const;
    const unchanged = projectPriceEditor("listing-1", "quanta.trade", current, ["Atom"], "42,000");
    const invalid = projectPriceEditor("listing-1", "quanta.trade", current, ["Atom"], "42k");
    const ready = projectPriceEditor("listing-1", "quanta.trade", current, ["Atom"], "37,000.50");

    expect(unchanged.validation).toBe("unchanged");
    expect(invalid.validation).toBe("invalid");
    expect(createPriceChangePlan("plan-1", unchanged)).toBeNull();
    expect(createPriceChangePlan("plan-1", invalid)).toBeNull();
    expect(createPriceChangePlan("plan-1", ready)).toMatchObject({
      kind: "change_price",
      proposedPrice: { currency: "USD", amount: "37000.50" },
    });
  });

  it("validates unknown price-editor query data and rejects listing confusion", async () => {
    const editor = projectPriceEditor(
      "listing-1",
      "quanta.trade",
      { currency: "USD", amount: "42000" },
      ["Atom"],
      "37000",
    );
    const adapter = new ValidatingPricingQueryAdapter({ getPriceEditor: async () => editor });
    await expect(adapter.getPriceEditor("listing-1")).resolves.toEqual(editor);
    await expect(adapter.getPriceEditor("listing-other")).rejects.toThrow("another listing");
    await expect(new ValidatingPricingQueryAdapter({
      getPriceEditor: async () => ({ ...editor, unexpected: true }),
    }).getPriceEditor("listing-1")).rejects.toThrow();
  });

  it("formats canonical amounts by manipulating strings only", () => {
    expect(formatCommerceAmount("99999.95")).toBe("99,999.95");
    expect(formatCommerceAmount("1000000000000000")).toBe("1,000,000,000,000,000.00");
    expect(formatCommerceAmount("0.1")).toBe("0.10");
  });

  it("formats integer basis points without floating-point price arithmetic", () => {
    expect(formatBasisPoints(1000)).toBe("10");
    expect(formatBasisPoints(125)).toBe("1.25");
    expect(() => formatBasisPoints(1.5)).toThrow();
  });
});
