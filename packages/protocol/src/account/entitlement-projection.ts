import { z } from "zod";

import { canonicalUtcTimestamp, identifier, safePositiveInteger } from "../wire/index";

export const ENTITLEMENT_PROJECTION_SCHEMA_VERSION = 1 as const;

export const entitlementStateSchema = z.enum(["pending", "active", "grace", "suspended", "revoked"]);

export const versionEntitlementSchema = z.object({ kind: z.literal("subscription_supported") }).strict();

export const entitlementProjectionSchema = z
  .object({
    schemaVersion: z.literal(ENTITLEMENT_PROJECTION_SCHEMA_VERSION),
    state: entitlementStateSchema,
    licenseId: identifier,
    plan: identifier,
    entitlementKind: z.enum(["subscription", "fixed_term"]),
    entitlementRevision: safePositiveInteger,
    commercialExpiresAt: canonicalUtcTimestamp.nullable(),
    offlineGraceUntil: canonicalUtcTimestamp,
    credentialRefreshDueAt: canonicalUtcTimestamp,
    deviceLimit: z.literal(2),
    activeDeviceLimit: z.literal(1),
    standbyCloudRead: z.literal(true),
    featureEntitlements: z.array(identifier).max(128),
    versionEntitlement: versionEntitlementSchema,
    evaluatedAt: canonicalUtcTimestamp,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.commercialExpiresAt === null) {
      context.addIssue({
        code: "custom",
        message: "commercial term entitlements require an expiry",
      });
    }
    if (value.commercialExpiresAt !== null && value.commercialExpiresAt > value.offlineGraceUntil) {
      context.addIssue({ code: "custom", path: ["commercialExpiresAt"], message: "commercial expiry exceeds grace" });
    }
    if (value.credentialRefreshDueAt > value.offlineGraceUntil) {
      context.addIssue({ code: "custom", path: ["credentialRefreshDueAt"], message: "refresh boundary exceeds grace" });
    }
    for (let index = 1; index < value.featureEntitlements.length; index += 1) {
      if (value.featureEntitlements[index - 1]! >= value.featureEntitlements[index]!) {
        context.addIssue({ code: "custom", path: ["featureEntitlements"], message: "features must be strictly ascending" });
        break;
      }
    }
  });

export type EntitlementState = z.infer<typeof entitlementStateSchema>;
export type VersionEntitlement = z.infer<typeof versionEntitlementSchema>;
export type EntitlementProjection = z.infer<typeof entitlementProjectionSchema>;
