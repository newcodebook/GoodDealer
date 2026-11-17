import { describe, expect, it } from "vitest";

import {
  DOMAIN_PROVIDER_CAPABILITY_MANIFEST_VERSION,
  domainProviderCapabilityManifest,
  domainProviderManifestEntry,
  domainProviderManifestEntrySchema,
  domainProviderRoles,
  launchPlatformKindSchema,
} from "@gooddealer/protocol/domain-providers";
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
  it("lists every ADR-0027 capability once, each Provider capability under one of the four roles", () => {
    expect(DOMAIN_PROVIDER_CAPABILITY_CATALOG_VERSION).toBe(2);
    const ids = domainProviderCapabilityCatalog.map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(domainProviderCapabilityCatalog.filter(({ role }) => role === null).map(({ id }) => id)).toEqual(["connection.manage"]);
    for (const { id, role } of domainProviderCapabilityCatalog) {
      if (role !== null) expect(domainProviderRoles).toContain(role);
      // Identifiers name their role; the three older v1 identifiers keep their names.
      if (role !== null && !["nameservers.manage", "zone.observe", "dnssec.manage"].includes(id)) expect(id.startsWith(`${role}.`)).toBe(true);
    }
    // Every role has a monitoring capability (ADR-0027 section 2).
    for (const role of domainProviderRoles) {
      expect(ids).toContain(`${role}.monitor`);
    }
    // Every charge is financial: each needs its own confirmation (ADR-0024, ADR-0027 section 7).
    expect(domainProviderCapabilityCatalog.filter(({ effect }) => effect === "financial").map(({ id }) => id).sort()).toEqual([
      "acquisition.backorder", "acquisition.bid", "acquisition.purchase",
      "registrar.auto-renew.manage", "registrar.register", "registrar.renew", "registrar.restore", "registrar.transfer.in", "registrar.transfer.out",
    ]);
    expect(Object.isFrozen(domainProviderCapabilityCatalog) && domainProviderCapabilityCatalog.every((entry) => Object.isFrozen(entry))).toBe(true);
    // Searching, viewing offers and arrival reconciliation are read-only and never charge.
    for (const id of ["acquisition.search", "acquisition.offer.observe", "acquisition.arrival.reconcile"]) {
      expect(domainProviderCapabilityCatalog.find((capability) => capability.id === id)?.effect).toBe("read");
    }
    // Proxy or automatic bidding is not a capability (ADR-0027 section 7).
    expect(ids.some((id) => /proxy|auto-bid|max-bid/u.test(id))).toBe(false);
  });

  it("states for every platform and Provider capability why it cannot run, and nothing more", () => {
    expect(DOMAIN_PROVIDER_CAPABILITY_MANIFEST_VERSION).toBe(1);
    const providerCapabilities = domainProviderCapabilityCatalog.filter(({ role }) => role !== null);
    expect(domainProviderCapabilityManifest).toHaveLength(launchPlatformKindSchema.options.length * providerCapabilities.length);
    for (const platform of launchPlatformKindSchema.options) {
      for (const { id } of providerCapabilities) {
        const entry = domainProviderManifestEntry(platform, id);
        expect(entry).not.toBeNull();
        expect(domainProviderManifestEntrySchema.parse(entry)).toEqual(entry);
        expect(entry?.execution).toBe("not_executable");
      }
      expect(domainProviderManifestEntry(platform, "connection.manage")).toBeNull();
    }
    // Only Cloudflare's implemented read-only observation awaits qualification; everything else waits on facts.
    expect(domainProviderCapabilityManifest.filter(({ reason }) => reason === "qualification_pending")
      .map(({ platform, capabilityId }) => `${platform}:${capabilityId}`)).toEqual(["cloudflare:zone.observe", "cloudflare:dns.records.observe"]);
    expect(Object.isFrozen(domainProviderCapabilityManifest)).toBe(true);
    expect(domainProviderCapabilityManifest.every((entry) => Object.isFrozen(entry))).toBe(true);
    // The schema has no executable state and no field a Renderer could read as a permission.
    for (const forged of [
      { platform: "cloudflare", capabilityId: "zone.observe", execution: "executable", reason: "qualification_pending" },
      { platform: "cloudflare", capabilityId: "zone.observe", execution: "not_executable", reason: "qualified" },
      { platform: "sedo", capabilityId: "zone.observe", execution: "not_executable", reason: "platform_facts_pending" },
      { platform: "cloudflare", capabilityId: "acquisition.proxy-bid", execution: "not_executable", reason: "platform_facts_pending" },
      { platform: "cloudflare", capabilityId: "zone.observe", execution: "not_executable", reason: "qualification_pending", scope: "Zone:Read" },
    ]) expect(domainProviderManifestEntrySchema.safeParse(forged).success).toBe(false);
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
