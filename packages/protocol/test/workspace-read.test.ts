import { describe, expect, it } from "vitest";

import {
  workspacePortfolioReadRequestSchema,
  workspacePortfolioReadResponseSchema,
} from "@gooddealer/protocol/workspace";

const timestamp = "2026-08-20T06:00:00Z";
const asset = (entityId: string, materializedAt: string | null = timestamp) => ({
  asset: { entityId, note: null, portfolioId: null, tags: [], targetPrice: null },
  materialization: {
    origin: "workspace_sync",
    versionToken: "12",
    materializedAt,
    projectionAvailability: materializedAt === null ? "unavailable" : "available",
    projectionEvidenceStatus: materializedAt === null ? "unknown" : "confirmed",
  },
});
const response = {
  schemaVersion: 1,
  assets: [asset("a.example"), asset("z.example", null)],
  projection: {
    materializedThroughServerRevision: 12,
    materializedAt: timestamp,
    projectionAvailability: "available",
    projectionEvidenceStatus: "confirmed",
  },
};

describe("workspace portfolio read wire contract", () => {
  it("accepts an empty tenant-neutral request and materialization-bearing response", () => {
    expect(workspacePortfolioReadRequestSchema.parse({})).toEqual({});
    expect(workspacePortfolioReadResponseSchema.parse(response)).toEqual(response);
  });

  it.each([
    { accountId: "account-01" },
    { workspaceId: "workspace-01" },
    { schemaVersion: 1 },
    { credentialRef: "must-not-cross-wire" },
  ])("rejects caller scope or authority %#", (value) => {
    expect(workspacePortfolioReadRequestSchema.safeParse(value).success).toBe(false);
  });

  it("rejects unknown fields, invalid observation state, and non-canonical order", () => {
    expect(workspacePortfolioReadResponseSchema.safeParse({ ...response, workspaceId: "workspace-01" }).success).toBe(false);
    expect(workspacePortfolioReadResponseSchema.safeParse({ ...response, accessToken: "secret" }).success).toBe(false);
    expect(workspacePortfolioReadResponseSchema.safeParse({ ...response, assets: [...response.assets].reverse() }).success).toBe(false);
    expect(workspacePortfolioReadResponseSchema.safeParse({
      ...response,
      assets: [{
        ...asset("a.example"),
        materialization: {
          ...asset("a.example").materialization,
          materializedAt: null,
          projectionAvailability: "available",
          projectionEvidenceStatus: "confirmed",
        },
      }],
    }).success).toBe(false);
    expect(workspacePortfolioReadResponseSchema.safeParse({
      ...response,
      projection: { ...response.projection, materializedThroughServerRevision: Number.MAX_SAFE_INTEGER + 1 },
    }).success).toBe(false);
    expect(workspacePortfolioReadResponseSchema.safeParse({
      ...response,
      projection: {
        ...response.projection,
        materializedAt: null,
        projectionAvailability: "available",
        projectionEvidenceStatus: "confirmed",
      },
    }).success).toBe(false);
  });

  it("accepts an unknown projection update time only for honest unavailable or unknown state", () => {
    expect(workspacePortfolioReadResponseSchema.safeParse({
      ...response,
      projection: {
        ...response.projection,
        materializedAt: null,
        projectionAvailability: "unavailable",
        projectionEvidenceStatus: "confirmed",
      },
    }).success).toBe(true);
    expect(workspacePortfolioReadResponseSchema.safeParse({
      ...response,
      projection: {
        ...response.projection,
        materializedAt: null,
        projectionAvailability: "available",
        projectionEvidenceStatus: "unknown",
      },
    }).success).toBe(true);
  });
});
