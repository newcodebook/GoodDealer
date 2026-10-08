import { z } from "zod";

import { csvImportPreviewSchema } from "./csv-import";
import {
  assetLibraryWindowRequestSchema,
  parseAssetLibraryViewModel,
  parseDomainDetailViewModel,
} from "./view-models";
import { canonicalDomainNameSchema } from "./domain-name";

export function parseAssetLibraryQuery(input: unknown): string {
  if (typeof input !== "string" || new TextEncoder().encode(input).length > 64 || !/^[\x20-\x7e]*$/u.test(input)) throw new TypeError("asset query is invalid");
  const normalized = input.replace(/^ +| +$/gu, "").toLowerCase();
  if (!/^[a-z0-9.-]*$/u.test(normalized)) throw new TypeError("asset query is invalid");
  return normalized;
}

export interface PortfolioPresentationPort {
  loadAssetLibrary(request: { readonly startIndex: number; readonly size: number; readonly query: string }): Promise<unknown>;
  loadDomainDetail(assetId: string): Promise<unknown>;
}

export interface ValidatedPortfolioPresentationPort {
  loadAssetLibrary(request: { readonly startIndex: number; readonly size: number; readonly query: string }): Promise<ReturnType<typeof parseAssetLibraryViewModel>>;
  loadDomainDetail(assetId: string): Promise<ReturnType<typeof parseDomainDetailViewModel>>;
}

const mutationIdSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/u);
const editableAssetSchema = z.object({
  entityId: z.string().min(3).max(253),
  note: z.string().max(10_000).nullable(),
  portfolioId: z.string().max(128).nullable(),
  tags: z.array(z.string().min(1).max(64)).max(128),
  targetPrice: z.object({ currency: z.string().regex(/^[A-Z]{3}$/u), amount: z.string() }).strict().nullable(),
}).strict();
export const localDomainAssetEditRequestSchema = z.object({ mutationId: mutationIdSchema, expectedReadGeneration: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), expectedAssetVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), asset: editableAssetSchema }).strict();
export const localDomainAssetDeleteRequestSchema = z.object({ mutationId: mutationIdSchema, expectedReadGeneration: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), expectedAssetVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), entityId: z.string().min(3).max(253) }).strict();
export const localDomainAssetProviderBindingRequestSchema = z.object({ schemaVersion: z.literal(1), expectedReadGeneration: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), entityId: canonicalDomainNameSchema }).strict();
export const localDomainAssetMutationReceiptSchema = z.object({ schemaVersion: z.literal(1), disposition: z.enum(["committed", "replayed"]), operation: z.enum(["edit", "delete"]), mutationId: mutationIdSchema, entityId: z.string().min(3).max(253), localCommitSequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), deviceMutationSequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), baseServerRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), activeLeaseEpoch: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), committedAt: z.iso.datetime(), readGeneration: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }).strict();
export const localDomainAssetProviderBindingReceiptSchema = z.object({ schemaVersion: z.literal(1), disposition: z.enum(["committed", "replayed"]), entityId: canonicalDomainNameSchema, providerKind: z.literal("cloudflare"), resourceKind: z.literal("zone"), resourceBindingDigest: z.string().regex(/^[0-9a-f]{64}$/u), resourceLabel: canonicalDomainNameSchema, bindingGeneration: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), validationStatus: z.literal("verified"), verifiedAt: z.iso.datetime(), lastObservedAt: z.iso.datetime(), localCommitSequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), readGeneration: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }).strict();
export type LocalDomainAssetEditRequest = z.infer<typeof localDomainAssetEditRequestSchema>;
export type LocalDomainAssetDeleteRequest = z.infer<typeof localDomainAssetDeleteRequestSchema>;
export type LocalDomainAssetProviderBindingRequest = z.infer<typeof localDomainAssetProviderBindingRequestSchema>;
export type LocalDomainAssetMutationReceipt = z.infer<typeof localDomainAssetMutationReceiptSchema>;
export type LocalDomainAssetProviderBindingReceipt = z.infer<typeof localDomainAssetProviderBindingReceiptSchema>;

/**
 * Narrow local capability for associating an existing asset with Host-verified Provider
 * evidence. This deliberately is separate from the read-only presentation/query ports.
 */
export interface PortfolioProviderBindingPort {
  bindDomainAssetProvider(request: LocalDomainAssetProviderBindingRequest): Promise<LocalDomainAssetProviderBindingReceipt>;
}

export interface PortfolioProviderBindingBoundary {
  bindDomainAssetProvider(request: LocalDomainAssetProviderBindingRequest): Promise<unknown>;
}

/** Validates both sides of the local binding boundary before the result reaches the UI. */
export class ValidatingPortfolioProviderBindingPort implements PortfolioProviderBindingPort {
  readonly #boundary: PortfolioProviderBindingBoundary;

  constructor(boundary: PortfolioProviderBindingBoundary) {
    this.#boundary = boundary;
  }

  async bindDomainAssetProvider(request: LocalDomainAssetProviderBindingRequest) {
    const parsedRequest = localDomainAssetProviderBindingRequestSchema.parse(request);
    const receipt = localDomainAssetProviderBindingReceiptSchema.parse(
      await this.#boundary.bindDomainAssetProvider(parsedRequest),
    );
    if (receipt.entityId !== parsedRequest.entityId || receipt.resourceLabel !== parsedRequest.entityId) {
      throw new TypeError("provider binding receipt entity does not match the request");
    }
    if (receipt.disposition === "committed" && receipt.readGeneration !== parsedRequest.expectedReadGeneration + 1) {
      throw new TypeError("provider binding receipt generation does not advance exactly once");
    }
    if (receipt.disposition === "replayed" && receipt.readGeneration < parsedRequest.expectedReadGeneration) {
      throw new TypeError("provider binding replay regressed the read generation");
    }
    return receipt;
  }
}

export class ValidatingPortfolioPresentationPort implements ValidatedPortfolioPresentationPort {
  readonly #boundary: PortfolioPresentationPort;

  constructor(boundary: PortfolioPresentationPort) {
    this.#boundary = boundary;
  }

  async loadAssetLibrary(request: { readonly startIndex: number; readonly size: number; readonly query: string }) {
    const parsedRequest = assetLibraryWindowRequestSchema.parse({ ...request, query: parseAssetLibraryQuery(request.query) });
    const boundaryRequest = { startIndex: parsedRequest.startIndex, size: parsedRequest.size, query: parsedRequest.query };
    const result = parseAssetLibraryViewModel(await this.#boundary.loadAssetLibrary(boundaryRequest));
    if (result.window.startIndex !== parsedRequest.startIndex || result.window.size !== parsedRequest.size || result.window.rows.length > parsedRequest.size) {
      throw new TypeError("portfolio boundary returned a different visible window");
    }
    return result;
  }

  async loadDomainDetail(assetId: string) {
    if (!/^(?=.{3,253}$)(?=.*\.)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(assetId)) throw new TypeError("asset id is invalid");
    return parseDomainDetailViewModel(await this.#boundary.loadDomainDetail(assetId));
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
