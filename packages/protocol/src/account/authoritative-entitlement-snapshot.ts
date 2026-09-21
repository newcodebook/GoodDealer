import { z } from "zod";

import {
  canonicalUtcTimestamp,
  encodeDomainSeparatedWireValue,
  identifier,
  safePositiveInteger,
} from "../wire/index";
import { entitlementStateSchema, versionEntitlementSchema } from "./entitlement-projection";

export const AUTHORITATIVE_ENTITLEMENT_SNAPSHOT_DIGEST_DOMAIN =
  "GOODDEALER-COMMERCIAL-AUTHORITY-SNAPSHOT-V1" as const;

/** Provider-neutral input accepted only after a payment adapter authenticates its source event. */
export const authoritativeEntitlementSnapshotSchema = z
  .object({
    sourceEventId: identifier,
    sourceRevision: safePositiveInteger,
    occurredAt: canonicalUtcTimestamp,
    state: entitlementStateSchema,
    licenseId: identifier,
    plan: identifier,
    entitlementKind: z.enum(["subscription", "fixed_term"]),
    commercialExpiresAt: canonicalUtcTimestamp.nullable(),
    offlineGraceUntil: canonicalUtcTimestamp,
    credentialRefreshDueAt: canonicalUtcTimestamp,
    featureEntitlements: z.array(identifier).max(128),
    versionEntitlement: versionEntitlementSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.commercialExpiresAt === null) {
      context.addIssue({ code: "custom", path: ["commercialExpiresAt"], message: "commercial term requires an expiry" });
    }
    if (value.commercialExpiresAt !== null && value.commercialExpiresAt > value.offlineGraceUntil) {
      context.addIssue({ code: "custom", path: ["commercialExpiresAt"], message: "commercial expiry exceeds grace" });
    }
    if (value.credentialRefreshDueAt > value.offlineGraceUntil) {
      context.addIssue({ code: "custom", path: ["credentialRefreshDueAt"], message: "credential refresh exceeds grace" });
    }
    for (let index = 1; index < value.featureEntitlements.length; index += 1) {
      if (value.featureEntitlements[index - 1]! >= value.featureEntitlements[index]!) {
        context.addIssue({ code: "custom", path: ["featureEntitlements"], message: "features must be strictly ascending" });
        break;
      }
    }
  });

export type AuthoritativeEntitlementSnapshot = z.infer<typeof authoritativeEntitlementSnapshotSchema>;

/** Canonical bytes covered by the commercial authority projection digest. */
export function encodeAuthoritativeEntitlementSnapshotDigestInput(
  snapshot: AuthoritativeEntitlementSnapshot,
): Uint8Array {
  const parsed = authoritativeEntitlementSnapshotSchema.parse(snapshot);
  return encodeDomainSeparatedWireValue(
    AUTHORITATIVE_ENTITLEMENT_SNAPSHOT_DIGEST_DOMAIN,
    parsed,
  );
}

/**
 * Derives the lowercase SHA-256 digest used by DesktopAuthorizationGrant V3. The hash primitive
 * is injected so this protocol package remains runtime-neutral (Cloud uses node:crypto and
 * browser consumers can use SubtleCrypto).
 */
export function authoritativeEntitlementSnapshotDigest(
  snapshot: AuthoritativeEntitlementSnapshot,
  sha256: (bytes: Uint8Array) => Uint8Array,
): string {
  const digest = sha256(encodeAuthoritativeEntitlementSnapshotDigestInput(snapshot));
  if (digest.byteLength !== 32) throw new TypeError("SHA-256 must produce 32 bytes");
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
