import { describe, expect, expectTypeOf, it } from "vitest";

import {
  ValidatingPortfolioPresentationPort,
  ValidatingPortfolioPlanPort,
  assetLibraryViewModelSchema,
  buildCsvImportPreview,
  canonicalMoneyViewSchema,
  canonicalizeDomainName,
  createAssetLibraryWindow,
  csvImportViewModelSchema,
  dataFreshnessSchema,
  domainDetailViewModelSchema,
  type AssetLibraryRow,
  type PortfolioPlanPort,
} from "./index";

const timestamp = "2026-08-17T05:00:00Z";

function freshness(source: "active_local" | "standby_cloud") {
  return {
    source,
    serverRevision: 12,
    lastReplicationActivityAt: timestamp,
    lastSuccessfulProviderObservationAt: timestamp,
    canEdit: source === "active_local",
  } as const;
}

function row(index: number): AssetLibraryRow {
  return {
    id: `asset-${index.toString().padStart(5, "0")}`,
    domain: `domain-${index}.com`,
    tags: ["portfolio-main"],
    registrar: "Spaceship",
    dnsProvider: "Cloudflare",
    platforms: ["Atom"],
    status: "synced",
    targetPrice: { currency: "USD", amount: "1200" },
    expiresOn: "2027-03-14",
  };
}

function library(source: "active_local" | "standby_cloud", rows: readonly AssetLibraryRow[], totalRows = rows.length) {
  return {
    schemaVersion: 1,
    kind: "asset_library",
    freshness: freshness(source),
    totalRows,
    totalValue: { currency: "USD", amount: "284120" },
    expiringWithin60Days: 18,
    conflictCount: 6,
    listingCount: 692,
    window: { startIndex: 0, size: Math.max(1, rows.length || 100), rows },
  } as const;
}

describe("canonical domain names and CSV import", () => {
  it("accepts canonical money and rejects ambiguous decimal spellings", () => {
    expect(canonicalMoneyViewSchema.safeParse({ currency: "USD", amount: "11.5" }).success).toBe(true);
    expect(canonicalMoneyViewSchema.safeParse({ currency: "usd", amount: "11.5" }).success).toBe(false);
    expect(canonicalMoneyViewSchema.safeParse({ currency: "USD", amount: "11.50" }).success).toBe(false);
    expect(canonicalMoneyViewSchema.safeParse({ currency: "USD", amount: "01" }).success).toBe(false);
    expect(canonicalMoneyViewSchema.safeParse({ currency: "USD", amount: "-1" }).success).toBe(false);
  });

  it("normalizes case, an http scheme, and Unicode through IDNA/Punycode", () => {
    expect(canonicalizeDomainName("KANBAN.AI")).toBe("kanban.ai");
    expect(canonicalizeDomainName("https://MÜNCHEN.de")).toBe("xn--mnchen-3ya.de");
  });

  it.each([
    "",
    " http://vault.io",
    "http://bad_domain",
    "https://vault.io/path",
    "user@vault.io",
    "vault.io:443",
    "127.0.0.1",
    "-bad.com",
    "bad-.com",
  ])("rejects invalid or non-identity domain input %j", (input) => {
    expect(() => canonicalizeDomainName(input)).toThrow();
  });

  it("classifies existing, in-file duplicates, invalid rows, and Punycode deterministically", () => {
    const preview = buildCsvImportPreview({
      csvText: [
        "Domain,Registrar",
        "vault.io,Spaceship",
        "KANBAN.AI,Namecheap",
        "münchen.de,Dynadot",
        "xn--mnchen-3ya.de,Dynadot",
        "http://bad_domain,Unknown",
        ",Unknown",
      ].join("\n"),
      mappings: [{ columnIndex: 0, field: "domain" }, { columnIndex: 1, field: "registrar" }],
      existingDomains: new Set(["vault.io"]),
    });

    expect(preview).toMatchObject({ totalCount: 6, newCount: 2, duplicateCount: 2, invalidCount: 2 });
    expect(preview.rows.map((item) => item.status)).toEqual([
      "duplicate", "new", "new", "duplicate", "invalid", "invalid",
    ]);
    expect(preview.rows[2]).toMatchObject({ canonicalDomain: "xn--mnchen-3ya.de" });
  });

  it("rejects ambiguous domain mappings and malformed quoted CSV", () => {
    const base = { csvText: "Domain\nexample.com", existingDomains: new Set<string>() };
    expect(() => buildCsvImportPreview({ ...base, mappings: [] })).toThrow("exactly one");
    expect(() => buildCsvImportPreview({
      ...base,
      mappings: [{ columnIndex: 0, field: "domain" }, { columnIndex: 1, field: "domain" }],
    })).toThrow("exactly one");
    expect(() => buildCsvImportPreview({
      ...base,
      csvText: 'Domain\n"unterminated',
      mappings: [{ columnIndex: 0, field: "domain" }],
    })).toThrow("unterminated");
  });

  it("models file, map, and preview as a strict discriminated union", () => {
    expect(csvImportViewModelSchema.safeParse({
      schemaVersion: 1,
      step: "file",
      canEdit: true,
      acceptedMediaTypes: ["text/csv"],
      selectedFile: null,
    }).success).toBe(true);
    expect(csvImportViewModelSchema.safeParse({
      schemaVersion: 1,
      step: "map",
      canEdit: true,
      columns: [{ index: 0, header: "Domain", sample: "vault.io", mapping: "domain" }],
      hasDomainMapping: true,
    }).success).toBe(true);
    expect(csvImportViewModelSchema.safeParse({
      schemaVersion: 1,
      step: "map",
      canEdit: true,
      columns: [{ index: 0, header: "Domain", sample: "vault.io", mapping: "ignore" }],
      hasDomainMapping: true,
    }).success).toBe(false);
  });
});

describe("portfolio presentation contracts", () => {
  it("makes Active/Standby provenance and canEdit inseparable", () => {
    expect(dataFreshnessSchema.parse(freshness("active_local"))).toMatchObject({ canEdit: true });
    expect(dataFreshnessSchema.parse(freshness("standby_cloud"))).toMatchObject({ canEdit: false });
    expect(dataFreshnessSchema.safeParse({ ...freshness("standby_cloud"), canEdit: true }).success).toBe(false);
  });

  it("exposes at most 200 visible rows for a 10,000-asset library", () => {
    const rows = Array.from({ length: 10_000 }, (_, index) => row(index));
    const window = createAssetLibraryWindow(rows, { startIndex: 4_950, size: 100 });
    const parsed = assetLibraryViewModelSchema.parse({ ...library("active_local", window.rows, 10_000), window });
    expect(parsed.totalRows).toBe(10_000);
    expect(parsed.window).toMatchObject({ startIndex: 4_950 });
    expect(parsed.window.rows).toHaveLength(100);
    expect(() => createAssetLibraryWindow(rows, { startIndex: 0, size: 201 })).toThrow();
  });

  it("accepts active, standby, and empty states but rejects leaked fields and duplicate visible domains", () => {
    expect(assetLibraryViewModelSchema.safeParse(library("active_local", [row(1)])).success).toBe(true);
    expect(assetLibraryViewModelSchema.safeParse(library("standby_cloud", [row(1)])).success).toBe(true);
    expect(assetLibraryViewModelSchema.safeParse(library("active_local", [], 0)).success).toBe(true);
    expect(assetLibraryViewModelSchema.safeParse({ ...library("active_local", [row(1)]), credentialRef: "secret" }).success).toBe(false);
    expect(assetLibraryViewModelSchema.safeParse(library("active_local", [row(1), { ...row(2), domain: row(1).domain }])).success).toBe(false);
  });

  it.each(["normal", "conflict", "sold"] as const)("supports DomainDetail %s state", (state) => {
    const asset = {
      ...row(1),
      status: state === "sold" ? "sold" as const : state === "conflict" ? "conflict" as const : "synced" as const,
      acquiredOn: "2024-03-14",
      acquisitionCost: { currency: "USD", amount: "800" },
      autoRenew: false,
      registrarLock: true,
      note: null,
    };
    expect(domainDetailViewModelSchema.safeParse({
      schemaVersion: 1,
      kind: "domain_detail",
      freshness: freshness("active_local"),
      state,
      asset,
      conflictFields: state === "conflict" ? ["targetPrice"] : [],
    }).success).toBe(true);
  });

  it("validates unknown boundary output before it reaches a presentation", async () => {
    const validLibrary = { ...library("active_local", [row(1)]), window: { startIndex: 0, size: 50, rows: [row(1)] } };
    const validDetail = {
      schemaVersion: 1,
      kind: "domain_detail",
      freshness: freshness("active_local"),
      state: "normal",
      asset: { ...row(1), acquiredOn: null, acquisitionCost: null, autoRenew: false, registrarLock: true, note: null },
      conflictFields: [],
    };
    const port = new ValidatingPortfolioPresentationPort({
      loadAssetLibrary: async () => structuredClone(validLibrary),
      loadDomainDetail: async () => structuredClone(validDetail),
    });
    await expect(port.loadAssetLibrary({ startIndex: 0, size: 50 })).resolves.toEqual(validLibrary);
    await expect(port.loadDomainDetail("asset-1")).resolves.toEqual(validDetail);

    const rejecting = new ValidatingPortfolioPresentationPort({
      loadAssetLibrary: async () => ({ ...validLibrary, unknown: true }),
      loadDomainDetail: async () => ({ ...validDetail, unknown: true }),
    });
    await expect(rejecting.loadAssetLibrary({ startIndex: 0, size: 50 })).rejects.toThrow();
    await expect(rejecting.loadDomainDetail("asset-1")).rejects.toThrow();
  });

  it("exposes planning but no execution method", () => {
    expectTypeOf<keyof PortfolioPlanPort>().toEqualTypeOf<"planCsvImport">();
  });

  it("validates import plan count and unknown receipt fields", async () => {
    const preview = buildCsvImportPreview({
      csvText: "Domain\nexample.com",
      mappings: [{ columnIndex: 0, field: "domain" }],
      existingDomains: new Set(),
    });
    const request = { expectedNewCount: 1, preview };
    await expect(new ValidatingPortfolioPlanPort({
      planCsvImport: async () => ({ planId: "plan-1", status: "planned", itemCount: 1 }),
    }).planCsvImport(request)).resolves.toMatchObject({ itemCount: 1 });
    await expect(new ValidatingPortfolioPlanPort({
      planCsvImport: async () => ({ planId: "plan-1", status: "planned", itemCount: 2 }),
    }).planCsvImport(request)).rejects.toThrow("count");
    await expect(new ValidatingPortfolioPlanPort({
      planCsvImport: async () => ({ planId: "plan-1", status: "planned", itemCount: 1, executed: true }),
    }).planCsvImport(request)).rejects.toThrow();
  });
});
