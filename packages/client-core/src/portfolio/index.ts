import { domainAssetProjectionSchema } from "@gooddealer/protocol/workspace";
import { z } from "zod";

import { dataFreshnessSchema } from "./data-freshness";
import type { DataFreshness, PortfolioQuerySource } from "./data-freshness";

export const portfolioQueryResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    workspaceId: z.string().min(1).max(128),
    domains: domainAssetProjectionSchema,
    freshness: dataFreshnessSchema,
  })
  .strict();

export type PortfolioQueryResult = z.infer<typeof portfolioQueryResultSchema>;

/** The UI owns only this read capability; neither adapter exposes mutation methods. */
export interface PortfolioQueryPort {
  listDomains(): Promise<PortfolioQueryResult>;
}

export interface PortfolioQueryBoundary {
  listDomains(): Promise<unknown>;
}

abstract class ValidatingPortfolioQueryAdapter implements PortfolioQueryPort {
  readonly #boundary: PortfolioQueryBoundary;
  readonly #expectedSource: PortfolioQuerySource;

  protected constructor(boundary: PortfolioQueryBoundary, expectedSource: PortfolioQuerySource) {
    this.#boundary = boundary;
    this.#expectedSource = expectedSource;
  }

  async listDomains(): Promise<PortfolioQueryResult> {
    const result = portfolioQueryResultSchema.parse(await this.#boundary.listDomains());
    if (result.freshness.source !== this.#expectedSource) {
      throw new TypeError(`portfolio adapter expected ${this.#expectedSource} freshness`);
    }
    return cloneQueryResult(result);
  }
}

/** Active boundary validator; production Tauri/local-storage wiring is intentionally absent. */
export class ActiveLocalPortfolioAdapter extends ValidatingPortfolioQueryAdapter {
  constructor(boundary: PortfolioQueryBoundary) {
    super(boundary, "active_local");
  }
}

/** Standby boundary validator; production cloud-client/workspace-read wiring is intentionally absent. */
export class StandbyCloudPortfolioAdapter extends ValidatingPortfolioQueryAdapter {
  constructor(boundary: PortfolioQueryBoundary) {
    super(boundary, "standby_cloud");
  }
}

function cloneQueryResult(result: PortfolioQueryResult): PortfolioQueryResult {
  return {
    ...result,
    domains: result.domains.map((domain) => ({
      ...domain,
      tags: [...domain.tags],
      targetPrice: domain.targetPrice === null ? null : { ...domain.targetPrice },
    })),
    freshness: { ...result.freshness },
  };
}

export { canonicalDomainNameSchema, canonicalizeDomainName } from "./domain-name";
export type { CanonicalDomainName } from "./domain-name";

export { dataFreshnessSchema, portfolioQuerySourceSchema } from "./data-freshness";
export type { DataFreshness, PortfolioQuerySource } from "./data-freshness";

export {
  buildCsvImportPreview,
  csvColumnMappingSchema,
  csvImportFieldSchema,
  csvImportPreviewRowSchema,
  csvImportPreviewSchema,
  csvImportViewModelSchema,
} from "./csv-import";
export type {
  CsvColumnMapping,
  CsvImportField,
  CsvImportPreview,
  CsvImportPreviewRow,
  CsvImportViewModel,
} from "./csv-import";

export {
  ValidatingPortfolioPresentationPort,
  ValidatingPortfolioPlanPort,
  csvImportPlanRequestSchema,
  portfolioPlanReceiptSchema,
} from "./ports";
export type {
  CsvImportPlanRequest,
  PortfolioPlanPort,
  PortfolioPlanBoundary,
  PortfolioPlanReceipt,
  PortfolioPresentationPort,
  ValidatedPortfolioPresentationPort,
} from "./ports";

export {
  assetLibraryRowSchema,
  assetLibraryViewModelSchema,
  assetLibraryWindowRequestSchema,
  assetStatusSchema,
  canonicalMoneyViewSchema,
  createAssetLibraryWindow,
  domainDetailStateSchema,
  domainDetailViewModelSchema,
  parseAssetLibraryViewModel,
  parseDomainDetailViewModel,
} from "./view-models";
export type {
  AssetLibraryRow,
  AssetLibraryViewModel,
  AssetLibraryWindowRequest,
  AssetStatus,
  CanonicalMoneyView,
  DomainDetailState,
  DomainDetailViewModel,
} from "./view-models";
