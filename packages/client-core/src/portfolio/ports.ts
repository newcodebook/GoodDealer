import { z } from "zod";

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
/** Adds a domain the workspace does not hold; the domain is the deduplication key. */
export const localDomainAssetCreateRequestSchema = z.object({ mutationId: mutationIdSchema, expectedReadGeneration: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), asset: editableAssetSchema.extend({
  // As the Host requires: an all-numeric last label would be an IP literal, not a domain.
  entityId: canonicalDomainNameSchema.refine((domain) => /[a-z]/u.test(domain.split(".").at(-1) ?? ""), "domain name requires a non-numeric public suffix"),
}) }).strict();
export const localDomainAssetDeleteRequestSchema = z.object({ mutationId: mutationIdSchema, expectedReadGeneration: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), expectedAssetVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), entityId: z.string().min(3).max(253) }).strict();
export const localDomainAssetProviderBindingRequestSchema = z.object({ schemaVersion: z.literal(1), expectedReadGeneration: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), entityId: canonicalDomainNameSchema }).strict();
export const localDomainAssetMutationReceiptSchema = z.object({ schemaVersion: z.literal(1), disposition: z.enum(["committed", "replayed"]), operation: z.enum(["create", "edit", "delete"]), mutationId: mutationIdSchema, entityId: z.string().min(3).max(253), localCommitSequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), deviceMutationSequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), baseServerRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), activeLeaseEpoch: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), committedAt: z.iso.datetime(), readGeneration: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }).strict();
export const localDomainAssetProviderBindingReceiptSchema = z.object({ schemaVersion: z.literal(1), disposition: z.enum(["committed", "replayed"]), entityId: canonicalDomainNameSchema, providerKind: z.literal("cloudflare"), resourceKind: z.literal("zone"), resourceBindingDigest: z.string().regex(/^[0-9a-f]{64}$/u), resourceLabel: canonicalDomainNameSchema, bindingGeneration: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), validationStatus: z.literal("verified"), verifiedAt: z.iso.datetime(), lastObservedAt: z.iso.datetime(), localCommitSequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), readGeneration: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }).strict();
export type LocalDomainAssetEditRequest = z.infer<typeof localDomainAssetEditRequestSchema>;
export type LocalDomainAssetCreateRequest = z.infer<typeof localDomainAssetCreateRequestSchema>;
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
