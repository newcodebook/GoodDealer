import { z } from "zod";

import { csvImportPreviewSchema } from "./csv-import";
import { assetLibraryViewModelSchema, assetLibraryWindowRequestSchema, domainDetailViewModelSchema } from "./view-models";

export interface PortfolioPresentationPort {
  loadAssetLibrary(request: { readonly startIndex: number; readonly size: number }): Promise<unknown>;
  loadDomainDetail(assetId: string): Promise<unknown>;
}

export interface ValidatedPortfolioPresentationPort {
  loadAssetLibrary(request: { readonly startIndex: number; readonly size: number }): Promise<z.infer<typeof assetLibraryViewModelSchema>>;
  loadDomainDetail(assetId: string): Promise<z.infer<typeof domainDetailViewModelSchema>>;
}

export class ValidatingPortfolioPresentationPort implements ValidatedPortfolioPresentationPort {
  readonly #boundary: PortfolioPresentationPort;

  constructor(boundary: PortfolioPresentationPort) {
    this.#boundary = boundary;
  }

  async loadAssetLibrary(request: { readonly startIndex: number; readonly size: number }) {
    const parsedRequest = assetLibraryWindowRequestSchema.parse(request);
    const result = assetLibraryViewModelSchema.parse(await this.#boundary.loadAssetLibrary(parsedRequest));
    if (result.window.startIndex !== parsedRequest.startIndex || result.window.size !== parsedRequest.size || result.window.rows.length > parsedRequest.size) {
      throw new TypeError("portfolio boundary returned a different visible window");
    }
    return result;
  }

  async loadDomainDetail(assetId: string) {
    if (assetId.length === 0 || assetId.length > 128) throw new TypeError("asset id is invalid");
    return domainDetailViewModelSchema.parse(await this.#boundary.loadDomainDetail(assetId));
  }
}

export const csvImportPlanRequestSchema = z.object({
  expectedNewCount: z.number().int().positive(),
  preview: csvImportPreviewSchema,
}).strict().superRefine((request, context) => {
  if (request.expectedNewCount !== request.preview.newCount) {
    context.addIssue({ code: "custom", path: ["expectedNewCount"], message: "import count must match preview" });
  }
});

export const portfolioPlanReceiptSchema = z.object({
  planId: z.string().min(1).max(128),
  status: z.literal("planned"),
  itemCount: z.number().int().positive(),
}).strict();

export type CsvImportPlanRequest = z.infer<typeof csvImportPlanRequestSchema>;
export type PortfolioPlanReceipt = z.infer<typeof portfolioPlanReceiptSchema>;

/** Creates an inspectable plan only; execution remains in the operations capability. */
export interface PortfolioPlanPort {
  planCsvImport(request: CsvImportPlanRequest): Promise<PortfolioPlanReceipt>;
}

export interface PortfolioPlanBoundary {
  planCsvImport(request: CsvImportPlanRequest): Promise<unknown>;
}

export class ValidatingPortfolioPlanPort implements PortfolioPlanPort {
  readonly #boundary: PortfolioPlanBoundary;

  constructor(boundary: PortfolioPlanBoundary) {
    this.#boundary = boundary;
  }

  async planCsvImport(request: CsvImportPlanRequest): Promise<PortfolioPlanReceipt> {
    const parsedRequest = csvImportPlanRequestSchema.parse(request);
    const receipt = portfolioPlanReceiptSchema.parse(await this.#boundary.planCsvImport(parsedRequest));
    if (receipt.itemCount !== parsedRequest.expectedNewCount) {
      throw new TypeError("portfolio plan receipt count does not match the reviewed preview");
    }
    return receipt;
  }
}
