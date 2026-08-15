import { domainAssetProjectionSchema, workspaceRevisionSchema } from "@gooddealer/protocol/workspace";
import { z } from "zod";

export const portfolioQuerySourceSchema = z.enum(["active_local", "standby_cloud"]);

export const dataFreshnessSchema = z
  .object({
    source: portfolioQuerySourceSchema,
    serverRevision: workspaceRevisionSchema,
    lastCloudSyncAt: z.iso.datetime().nullable(),
    lastPlatformReadAt: z.iso.datetime().nullable(),
    canEdit: z.boolean(),
  })
  .strict()
  .superRefine((freshness, context) => {
    const expectedCanEdit = freshness.source === "active_local";
    if (freshness.canEdit !== expectedCanEdit) {
      context.addIssue({
        code: "custom",
        path: ["canEdit"],
        message: `${freshness.source} requires canEdit=${expectedCanEdit}`,
      });
    }
  });

export const portfolioQueryResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    workspaceId: z.string().min(1).max(128),
    domains: domainAssetProjectionSchema,
    freshness: dataFreshnessSchema,
  })
  .strict();

export type PortfolioQuerySource = z.infer<typeof portfolioQuerySourceSchema>;
export type DataFreshness = z.infer<typeof dataFreshnessSchema>;
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

/** Portable Active fixture seam; production Tauri/local-storage wiring is intentionally absent. */
export class ActiveLocalPortfolioAdapter extends ValidatingPortfolioQueryAdapter {
  constructor(boundary: PortfolioQueryBoundary) {
    super(boundary, "active_local");
  }
}

/** Portable Standby fixture seam; production cloud-client/workspace-read wiring is intentionally absent. */
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
