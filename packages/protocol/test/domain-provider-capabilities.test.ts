import { describe, expect, it } from "vitest";

import {
  DOMAIN_PROVIDER_CAPABILITY_CATALOG_VERSION,
  domainProviderCapabilityCatalog,
  domainProviderFinancialQuoteSchema,
  parseDomainProviderFinancialConfirmation,
  parseDomainProviderFinancialQuote,
  parseDomainProviderHandoffReturn,
} from "@gooddealer/protocol/connectors";

const confirmation = {
  schemaVersion: 1,
  planId: "plan-1",
  itemId: "item-1",
  planHash: "a".repeat(64),
  quoteDigest: "b".repeat(64),
  confirmationNonce: "nonce-1",
};

describe("domain Provider coverage and financial confirmation", () => {
  it("keeps every capability unique and refuses execution admission for unimplemented effects", () => {
    expect(DOMAIN_PROVIDER_CAPABILITY_CATALOG_VERSION).toBe(1);
    expect(new Set(domainProviderCapabilityCatalog.map(({ id }) => id)).size).toBe(domainProviderCapabilityCatalog.length);
    expect(domainProviderCapabilityCatalog.filter(({ effect }) => effect === "financial")
      .every(({ admission }) => admission === "not_executable")).toBe(true);
    expect(domainProviderCapabilityCatalog.filter(({ effect }) => effect === "write")
      .every(({ admission }) => admission === "not_executable")).toBe(true);
  });

  it("binds a displayed financial quote to exactly one plan item, amount and expiry", () => {
    const quote = {
      ...confirmation,
      entityId: "example.com",
      capabilityId: "registrar.renew",
      resourceBindingDigest: "c".repeat(64),
      termsDigest: "d".repeat(64),
      termsSummary: "Renew example.com for one year",
      currency: "USD",
      totalAmount: "12.50",
      expiresAt: "2026-09-22T10:00:00Z",
    };
    expect(domainProviderFinancialQuoteSchema.parse(quote)).toEqual(quote);
    expect(parseDomainProviderFinancialQuote(quote)).toEqual(quote);
    for (const invalid of [
      { ...quote, capabilityId: "dns.records.manage" },
      { ...quote, totalAmount: "12.5" },
      { ...quote, currency: "usd" },
      { ...quote, entityId: "Example.com" },
      { ...quote, resourceBindingDigest: "c".repeat(63) },
      { ...quote, termsDigest: "D".repeat(64) },
      { ...quote, termsSummary: "" },
      { ...quote, termsSummary: "Renew\u202eexample.com" },
      { ...quote, expiresAt: "tomorrow" },
      { ...quote, token: "secret" },
    ]) expect(domainProviderFinancialQuoteSchema.safeParse(invalid).success).toBe(false);
    let read = false;
    const hostile = { ...quote };
    Object.defineProperty(hostile, "termsSummary", { enumerable: true, get() { read = true; return "wrong"; } });
    expect(() => parseDomainProviderFinancialQuote(hostile)).toThrow();
    expect(read).toBe(false);
  });

  it("accepts only a single Host-issued confirmation reference without money or Provider authority", () => {
    expect(parseDomainProviderFinancialConfirmation(confirmation)).toEqual(confirmation);
    for (const invalid of [
      { ...confirmation, amount: "0.01" },
      { ...confirmation, itemId: "other", accountId: "account" },
      { ...confirmation, planHash: "a".repeat(63) },
      { ...confirmation, quoteDigest: "B".repeat(64) },
      { ...confirmation, confirmationNonce: "" },
      { ...confirmation, url: "https://example.com" },
    ]) expect(() => parseDomainProviderFinancialConfirmation(invalid)).toThrow();
    let read = false;
    const hostile = { ...confirmation };
    Object.defineProperty(hostile, "planId", { enumerable: true, get() { read = true; return "plan-1"; } });
    expect(() => parseDomainProviderFinancialConfirmation(hostile)).toThrow();
    expect(read).toBe(false);
  });

  it("treats Provider-page return as a pending reconciliation hint, never a result", () => {
    const returned = { schemaVersion: 1, operationId: "operation-1", returnNonce: "nonce-2" };
    expect(parseDomainProviderHandoffReturn(returned)).toEqual(returned);
    for (const invalid of [
      { ...returned, success: true },
      { ...returned, providerStatus: "completed" },
      { ...returned, price: "0.00" },
      { ...returned, returnNonce: "" },
    ]) expect(() => parseDomainProviderHandoffReturn(invalid)).toThrow();
  });
});
