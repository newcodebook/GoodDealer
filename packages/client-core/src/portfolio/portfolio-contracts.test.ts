import { describe, expect, expectTypeOf, it, vi } from "vitest";

import {
  ValidatingPortfolioPresentationPort,
  ValidatingPortfolioPlanPort,
  ValidatingPortfolioProviderBindingPort,
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
  localDomainAssetEditRequestSchema,
  localDomainAssetMutationReceiptSchema,
  type PortfolioProviderBindingPort,
} from "./index";

const timestamp = "2026-08-17T05:00:00Z";

function freshness(source: "active_local" | "standby_cloud") {
  return {
    source,
    readOnlyReason: source === "active_local" ? null : "standby",
    serverRevision: 12,
    lastReplicationActivityAt: timestamp,
    lastSuccessfulProviderObservationAt: timestamp,
    canEdit: source === "active_local",
  } as const;
}

function row(index: number): AssetLibraryRow {
  return {
    id: `domain-${index}.com`,
    domain: `domain-${index}.com`,
    tags: ["portfolio-main"],
    registrar: "Spaceship",
    lifecycleStatus: "active",
    syncStatus: "clean",
    targetPrice: { currency: "USD", amount: "1200" },
    expiresOn: "2027-03-14",
    assetVersion: index + 1,
  };
}

function library(source: "active_local" | "standby_cloud", rows: readonly AssetLibraryRow[], totalRows = rows.length) {
  return {
    schemaVersion: 3,
    kind: "asset_library",
    readGeneration: 1,
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
  const bindingRequest = { schemaVersion: 1 as const, expectedReadGeneration: 4, entityId: "example.test" };
  const bindingReceipt = {
    schemaVersion: 1, disposition: "committed", entityId: "example.test",
    providerKind: "cloudflare", resourceKind: "zone", resourceBindingDigest: "a".repeat(64),
    resourceLabel: "example.test", bindingGeneration: 2, validationStatus: "verified",
    verifiedAt: timestamp, lastObservedAt: timestamp, localCommitSequence: 8, readGeneration: 5,
  } as const;

  it("keeps provider binding as a narrow validated write capability", async () => {
    const boundary = vi.fn(async () => bindingReceipt);
    const port = new ValidatingPortfolioProviderBindingPort({ bindDomainAssetProvider: boundary });
    await expect(port.bindDomainAssetProvider(bindingRequest)).resolves.toEqual(bindingReceipt);
    expect(boundary).toHaveBeenCalledWith(bindingRequest);
    expectTypeOf<keyof PortfolioProviderBindingPort>().toEqualTypeOf<"bindDomainAssetProvider">();
  });

  it("rejects authority selectors before invoking the binding boundary", async () => {
    const boundary = vi.fn(async () => bindingReceipt);
    const port = new ValidatingPortfolioProviderBindingPort({ bindDomainAssetProvider: boundary });
    for (const field of ["workspaceId", "connectionId", "credentialRef", "resourceId", "providerToken", "extra"]) {
      await expect(port.bindDomainAssetProvider({ ...bindingRequest, [field]: "canary" } as never)).rejects.toThrow();
    }
    for (const invalid of [
      { ...bindingRequest, schemaVersion: 2 }, { ...bindingRequest, expectedReadGeneration: -1 },
      { ...bindingRequest, expectedReadGeneration: Number.MAX_SAFE_INTEGER + 1 },
    ]) await expect(port.bindDomainAssetProvider(invalid as never)).rejects.toThrow();
    expect(boundary).not.toHaveBeenCalled();
  });

  it("rejects malformed, uncorrelated and incorrectly advancing binding receipts", async () => {
    for (const invalid of [
      { ...bindingReceipt, deviceSecret: "canary" }, { ...bindingReceipt, providerToken: "canary" },
      { ...bindingReceipt, entityId: "other.test" }, { ...bindingReceipt, resourceLabel: "other.test" },
      { ...bindingReceipt, readGeneration: 4 }, { ...bindingReceipt, readGeneration: 6 },
      { ...bindingReceipt, disposition: "replayed", readGeneration: 3 },
      { ...bindingReceipt, schemaVersion: 2 }, { ...bindingReceipt, bindingGeneration: 0 },
    ]) {
      const port = new ValidatingPortfolioProviderBindingPort({ bindDomainAssetProvider: async () => invalid });
      await expect(port.bindDomainAssetProvider(bindingRequest)).rejects.toThrow();
    }
  });

  it("accepts replay at the expected generation and after intervening Host commits", async () => {
    for (const readGeneration of [4, 5, 9]) {
      const receipt = { ...bindingReceipt, disposition: "replayed", readGeneration };
      const port = new ValidatingPortfolioProviderBindingPort({ bindDomainAssetProvider: async () => receipt });
      await expect(port.bindDomainAssetProvider(bindingRequest)).resolves.toEqual(receipt);
    }
  });

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
  it("strictly validates local edit requests and durable receipts", () => {
    const request = { mutationId: "m-1", expectedReadGeneration: 4, expectedAssetVersion: 2, asset: { entityId: "example.test", note: null, portfolioId: null, tags: [], targetPrice: null } };
    expect(localDomainAssetEditRequestSchema.safeParse(request).success).toBe(true);
    expect(localDomainAssetEditRequestSchema.safeParse({ ...request, createdAt: timestamp }).success).toBe(false);
    const receipt = { schemaVersion: 1, disposition: "replayed", operation: "edit", mutationId: "m-1", entityId: "example.test", localCommitSequence: 3, deviceMutationSequence: 2, baseServerRevision: 0, activeLeaseEpoch: 7, committedAt: timestamp, readGeneration: 5 };
    expect(localDomainAssetMutationReceiptSchema.safeParse(receipt).success).toBe(true);
    expect(localDomainAssetMutationReceiptSchema.safeParse({ ...receipt, databasePath: "/private" }).success).toBe(false);
  });

  it("makes Active/Standby provenance and canEdit inseparable", () => {
    expect(dataFreshnessSchema.parse(freshness("active_local"))).toMatchObject({ canEdit: true });
    expect(dataFreshnessSchema.parse(freshness("standby_cloud"))).toMatchObject({ canEdit: false });
    expect(dataFreshnessSchema.safeParse({ ...freshness("standby_cloud"), canEdit: true }).success).toBe(false);
  });

  it("exposes at most 200 visible rows for a 10,000-asset library", () => {
    const rows = Array.from({ length: 10_000 }, (_, index) => row(index));
    const window = createAssetLibraryWindow(rows, { startIndex: 4_950, size: 100, query: "" });
    const parsed = assetLibraryViewModelSchema.parse({ ...library("active_local", window.rows, 10_000), window });
    expect(parsed.totalRows).toBe(10_000);
    expect(parsed.window).toMatchObject({ startIndex: 4_950 });
    expect(parsed.window.rows).toHaveLength(100);
    expect(() => createAssetLibraryWindow(rows, { startIndex: 0, size: 201, query: "" })).toThrow();
  });

  it("accepts active, standby, and empty states but rejects leaked fields and duplicate visible domains", () => {
    expect(assetLibraryViewModelSchema.safeParse(library("active_local", [row(1)])).success).toBe(true);
    expect(assetLibraryViewModelSchema.safeParse(library("standby_cloud", [row(1)])).success).toBe(true);
    expect(assetLibraryViewModelSchema.safeParse(library("active_local", [], 0)).success).toBe(true);
    expect(assetLibraryViewModelSchema.safeParse({ ...library("active_local", [row(1)]), credentialRef: "secret" }).success).toBe(false);
    expect(assetLibraryViewModelSchema.safeParse(library("active_local", [row(1), { ...row(2), domain: row(1).domain }])).success).toBe(false);
    expect(assetLibraryViewModelSchema.safeParse({ ...library("active_local", [row(1)]), freshness: { ...freshness("active_local"), readOnlyReason: undefined } }).success).toBe(false);
    const { lifecycleStatus: _lifecycleStatus, ...missingLifecycle } = row(2);
    expect(assetLibraryViewModelSchema.safeParse(library("active_local", [missingLifecycle as AssetLibraryRow])).success).toBe(false);
  });

  it.each(["normal", "conflict", "sold"] as const)("supports DomainDetail %s state", (state) => {
    const asset = {
      ...row(1),
      lifecycleStatus: state === "sold" ? "sold" as const : "active" as const,
      syncStatus: state === "conflict" ? "conflicted" as const : "clean" as const,
      acquiredOn: "2024-03-14",
      portfolioId: null,
      acquisitionCost: { currency: "USD", amount: "800" },
      autoRenew: false,
      registrarLock: true,
      note: null,
    };
    expect(domainDetailViewModelSchema.safeParse({
      schemaVersion: 3,
      kind: "domain_detail",
      readGeneration: 1,
      freshness: freshness("active_local"),
      state,
      asset,
      conflictFields: state === "conflict" ? ["targetPrice"] : [],
    }).success).toBe(true);
  });

  it("validates unknown boundary output before it reaches a presentation", async () => {
    const validLibrary = { ...library("active_local", [row(1)]), window: { startIndex: 0, size: 50, rows: [row(1)] } };
    const validDetail = {
      schemaVersion: 3,
      kind: "domain_detail",
      readGeneration: 1,
      freshness: freshness("active_local"),
      state: "normal",
      asset: { ...row(1), portfolioId: null, acquiredOn: null, acquisitionCost: null, autoRenew: false, registrarLock: true, note: null },
      conflictFields: [],
    };
    const port = new ValidatingPortfolioPresentationPort({
      loadAssetLibrary: async () => structuredClone(validLibrary),
      loadDomainDetail: async () => structuredClone(validDetail),
    });
    await expect(port.loadAssetLibrary({ startIndex: 0, size: 50, query: "" })).resolves.toEqual(validLibrary);
    await expect(port.loadDomainDetail("example.test")).resolves.toEqual(validDetail);

    const rejecting = new ValidatingPortfolioPresentationPort({
      loadAssetLibrary: async () => ({ ...validLibrary, unknown: true }),
      loadDomainDetail: async () => ({ ...validDetail, unknown: true }),
    });
    await expect(rejecting.loadAssetLibrary({ startIndex: 0, size: 50, query: "" })).rejects.toThrow();
    await expect(rejecting.loadDomainDetail("example.test")).rejects.toThrow();
  });

  it("rejects invalid query/window input before invoking the boundary", async () => {
    const loadAssetLibrary = vi.fn(async () => library("active_local", [], 0));
    const port = new ValidatingPortfolioPresentationPort({
      loadAssetLibrary,
      loadDomainDetail: vi.fn(),
    });

    await expect(port.loadAssetLibrary({ startIndex: 0, size: 25, query: "bad/query" })).rejects.toThrow();
    await expect(port.loadAssetLibrary({ startIndex: 0, size: 201, query: "valid" })).rejects.toThrow();
    expect(loadAssetLibrary).not.toHaveBeenCalled();
  });

  it("copies hostile wire records without invoking accessors", async () => {
    const getter = vi.fn(() => library("active_local", [], 0).kind);
    const hostile = Object.defineProperty(
      { ...library("active_local", [], 0) },
      "kind",
      { enumerable: true, get: getter },
    );
    const port = new ValidatingPortfolioPresentationPort({
      loadAssetLibrary: async () => hostile,
      loadDomainDetail: vi.fn(),
    });

    await expect(port.loadAssetLibrary({ startIndex: 0, size: 25, query: "" })).rejects.toThrow();
    expect(getter).not.toHaveBeenCalled();
  });

  it("rejects prototype, symbol, and sparse-array wire payloads", async () => {
    const valid = library("active_local", [row(1)]);
    const inherited = Object.assign(Object.create({ credentialRef: "canary" }), valid);
    const symbolic = Object.assign(structuredClone(valid), { [Symbol("secret")]: "canary" });
    const sparseRows = new Array<AssetLibraryRow>(2);
    sparseRows[1] = row(1);
    const sparse = { ...valid, window: { ...valid.window, rows: sparseRows } };

    for (const hostile of [inherited, symbolic, sparse]) {
      const port = new ValidatingPortfolioPresentationPort({
        loadAssetLibrary: async () => hostile,
        loadDomainDetail: vi.fn(),
      });
      await expect(port.loadAssetLibrary({ startIndex: 0, size: 25, query: "" })).rejects.toThrow();
    }
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
