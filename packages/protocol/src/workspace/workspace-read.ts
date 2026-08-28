import { z } from "zod";

import { canonicalUtcTimestamp, safeUnsignedInteger } from "../wire/index";
import { compareUtf8 } from "./domain-asset-fields";
import { domainAssetProjectionRowSchema } from "./domain-asset-projection";

export const WORKSPACE_PORTFOLIO_READ_SCHEMA_VERSION = 1 as const;
export const MAX_WORKSPACE_PORTFOLIO_READ_ASSETS = 10_000 as const;

export const portfolioReadProjectionAvailabilitySchema = z.enum(["available", "unavailable"]);
export const portfolioReadEvidenceStatusSchema = z.enum(["confirmed", "stale", "conflicted", "unknown"]);

const projectionEvidenceSchema = z.object({
  projectionAvailability: portfolioReadProjectionAvailabilitySchema,
  projectionEvidenceStatus: portfolioReadEvidenceStatusSchema,
}).strict();

export const portfolioReadAssetMaterializationSchema = projectionEvidenceSchema.extend({
  origin: z.enum(["workspace_sync", "provider_observation_projection"]),
  versionToken: z.string().min(1).max(256),
  materializedAt: canonicalUtcTimestamp.nullable(),
}).strict().superRefine((value, context) => {
  if (value.materializedAt === null
    && value.projectionAvailability !== "unavailable"
    && value.projectionEvidenceStatus !== "unknown") {
    context.addIssue({
      code: "custom",
      path: ["materializedAt"],
      message: "materialization time is required for an available known projection",
    });
  }
});

export const portfolioReadAssetSchema = z.object({
  asset: domainAssetProjectionRowSchema,
  materialization: portfolioReadAssetMaterializationSchema,
}).strict();

export const portfolioReadProjectionSchema = projectionEvidenceSchema.extend({
  materializedThroughServerRevision: safeUnsignedInteger,
  materializedAt: canonicalUtcTimestamp.nullable(),
}).strict().superRefine((value, context) => {
  if (value.materializedAt === null
    && value.projectionAvailability !== "unavailable"
    && value.projectionEvidenceStatus !== "unknown") {
    context.addIssue({
      code: "custom",
      path: ["materializedAt"],
      message: "materialization time is required for an available known projection",
    });
  }
});

const portfolioReadAssetsSchema = z.array(portfolioReadAssetSchema)
  .max(MAX_WORKSPACE_PORTFOLIO_READ_ASSETS)
  .superRefine((assets, context) => {
    for (let index = 1; index < assets.length; index += 1) {
      if (compareUtf8(assets[index - 1]!.asset.entityId, assets[index]!.asset.entityId) >= 0) {
        context.addIssue({
          code: "custom",
          path: [index, "asset", "entityId"],
          message: "portfolio assets must be unique and strictly ascending by UTF-8 bytes",
        });
        break;
      }
    }
  });

/** Tenant identity is supplied by the authenticated server boundary, never by wire data. */
export const workspacePortfolioReadRequestSchema = z.object({}).strict();

export const workspacePortfolioReadResponseSchema = z.object({
  schemaVersion: z.literal(WORKSPACE_PORTFOLIO_READ_SCHEMA_VERSION),
  assets: portfolioReadAssetsSchema,
  projection: portfolioReadProjectionSchema,
}).strict();

export type WorkspacePortfolioReadRequest = z.infer<typeof workspacePortfolioReadRequestSchema>;
export type WorkspacePortfolioReadResponse = z.infer<typeof workspacePortfolioReadResponseSchema>;
export type PortfolioReadProjectionAvailability = z.infer<typeof portfolioReadProjectionAvailabilitySchema>;
export type PortfolioReadEvidenceStatus = z.infer<typeof portfolioReadEvidenceStatusSchema>;
export type PortfolioReadAssetMaterialization = z.infer<typeof portfolioReadAssetMaterializationSchema>;
export type PortfolioReadAsset = z.infer<typeof portfolioReadAssetSchema>;
export type PortfolioReadProjection = z.infer<typeof portfolioReadProjectionSchema>;
