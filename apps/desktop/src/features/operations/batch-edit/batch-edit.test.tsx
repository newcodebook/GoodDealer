import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  applyPriceRule,
  BatchPriceDialog,
  isNameserverHost,
  isRecordHost,
  NameserverDialog,
  parsePercentInput,
  recordRoutingImpact,
  type BatchEditTarget,
} from "./index";

const targets: readonly BatchEditTarget[] = [
  { id: "a.com", domain: "a.com", targetPrice: { currency: "USD", amount: "1000" } },
  { id: "b.com", domain: "b.com", targetPrice: null },
];

describe("Batch edit rules", () => {
  it("applies uniform, percent, and per-domain price rules", () => {
    const [priced, unpriced] = targets;
    if (priced === undefined || unpriced === undefined) throw new Error("fixture");
    expect(applyPriceRule(priced, { mode: "uniform", amount: "800" })).toBe("800");
    expect(applyPriceRule(priced, { mode: "percent", direction: "decrease", percent: 8 })).toBe("920");
    expect(applyPriceRule(priced, { mode: "percent", direction: "increase", percent: 12.5 })).toBe("1125");
    expect(applyPriceRule(unpriced, { mode: "percent", direction: "decrease", percent: 8 })).toBeNull();
    expect(applyPriceRule(priced, { mode: "each", amounts: {} })).toBe("1000");
    // Exact decimal arithmetic: a half cent rounds up, and amounts past a double's precision survive.
    // 33.30 + 5 % is exactly 34.965; a double computes 34.9649999… and rounds down to 34.96.
    const cents = { id: "c.com", domain: "c.com", targetPrice: { currency: "USD", amount: "33.3" } };
    expect(applyPriceRule(cents, { mode: "percent", direction: "increase", percent: 5 })).toBe("34.97");
    const huge = { id: "d.com", domain: "d.com", targetPrice: { currency: "USD", amount: "9007199254740993" } };
    expect(applyPriceRule(huge, { mode: "percent", direction: "increase", percent: 10 })).toBe("9907919180215092.3");
  });

  it("accepts only bounded percentages", () => {
    expect(parsePercentInput("8")).toBe(8);
    expect(parsePercentInput("12.5%")).toBe(12.5);
    for (const input of ["0", "91", "-5", "1e2", "8.25", "abc", ""]) expect(parsePercentInput(input), input).toBeNull();
  });

  it("validates Nameserver hosts and record hosts", () => {
    expect(isNameserverHost("ns1.example.com")).toBe(true);
    expect(isNameserverHost("ada.ns.cloudflare.com.")).toBe(true);
    for (const host of ["localhost", "-ns.example.com", "ns..example.com", "ns1.example.com/path", "ns_1.example.com"]) {
      expect(isNameserverHost(host), host).toBe(false);
    }
    expect(isRecordHost("@")).toBe(true);
    expect(isRecordHost("_atomverify")).toBe(true);
    for (const host of ["", "a b", "www/", "-www"]) expect(isRecordHost(host), host).toBe(false);
  });

  it("puts routing and mail records in the caution tier but not TXT", () => {
    expect(recordRoutingImpact("A")).toBe("routing");
    expect(recordRoutingImpact("MX")).toBe("mail");
    expect(recordRoutingImpact("TXT")).toBeNull();
  });
});

describe("Batch edit dialogs", () => {
  it("gates the Nameserver submission behind the high-risk acknowledgement", () => {
    const html = renderToStaticMarkup(<NameserverDialog locale="zh-CN" open targets={targets} onClose={() => undefined} onSubmit={() => undefined} />);

    expect(html).toContain("高风险 · Nameserver 变更");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>提交 · 2 项/u);
  });

  it("produces a batch plan rather than a direct write and renders nothing while closed", () => {
    const html = renderToStaticMarkup(<BatchPriceDialog locale="zh-CN" open targets={targets} onClose={() => undefined} onSubmit={() => undefined} />);
    const closed = renderToStaticMarkup(<BatchPriceDialog locale="zh-CN" open={false} targets={targets} onClose={() => undefined} onSubmit={() => undefined} />);

    expect(html).toContain("生成批量计划 · 2 项");
    expect(closed).toBe("");
  });

  it("totals near-maximum prices past 16 whole digits without failing", () => {
    // Each price is the largest a contract allows; their total has 17 whole digits.
    const near = (domain: string) => ({ id: domain, domain, targetPrice: { currency: "USD", amount: "9999999999999999.99" } });
    const html = renderToStaticMarkup(<BatchPriceDialog locale="zh-CN" open targets={[near("a.com"), near("b.com")]} onClose={() => undefined} onSubmit={() => undefined} />);
    expect(html).toContain("19,999,999,999,999,999.98");
  });
});
