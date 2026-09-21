import { z } from "zod";

import {
  base64Url,
  canonicalUtcTimestamp,
  encodeDomainSeparatedWireValue,
  identifier,
  safePositiveInteger,
} from "../wire/index";
import { activeDeviceLeaseEnvelopeSchema } from "./device-identity";

export const DESKTOP_AUTHORIZATION_GRANT_SCHEMA_VERSION = 3 as const;
export const DESKTOP_AUTHORIZATION_GRANT_SIGNATURE_DOMAIN =
  "GOODDEALER-DESKTOP-AUTHORIZATION-GRANT-V3" as const;
export const DESKTOP_AUTHORIZATION_GRANT_OPERATION_ID =
  "devices.authorizationGrant.issue" as const;

/** The authenticated session and bound device are the only request authority sources. */
export const desktopAuthorizationGrantRequestSchema = z
  .object({ schemaVersion: z.literal(DESKTOP_AUTHORIZATION_GRANT_SCHEMA_VERSION) })
  .strict();

/**
 * Cloud-issued authorization input for the local business runtime. Every authority-bearing outer
 * field is covered by its own purpose-specific signature; the nested Lease is verified separately.
 */
export const desktopAuthorizationGrantSchema = z
  .object({
    schemaVersion: z.literal(DESKTOP_AUTHORIZATION_GRANT_SCHEMA_VERSION),
    typ: z.literal("gd.desktop-authorization-grant.v3"),
    iss: z.literal("https://accounts.gooddealer.com"),
    aud: z.literal("gooddealer-desktop/local-business"),
    kid: identifier,
    issuedAt: canonicalUtcTimestamp,
    expiresAt: canonicalUtcTimestamp,
    workspace: z
      .object({
        workspaceId: identifier,
        kind: z.literal("personal_default"),
      })
      .strict(),
    activeDeviceLease: activeDeviceLeaseEnvelopeSchema,
    scopes: z.tuple([z.literal("workspace:mutate"), z.literal("workspace:read")]),
    commercialAuthority: z.object({
      schemaVersion: z.literal(1),
      entitlementRevision: safePositiveInteger,
      entitlementProjectionDigest: z.string().regex(/^[0-9a-f]{64}$/u),
      state: z.literal("active"),
      commercialExpiresAt: canonicalUtcTimestamp,
      capability: z.literal("cloudflare:dns:observe"),
    }).strict(),
    signature: base64Url,
  })
  .strict()
  .superRefine((grant, context) => {
    if (grant.issuedAt !== grant.activeDeviceLease.issuedAt || grant.expiresAt !== grant.activeDeviceLease.expiresAt) {
      context.addIssue({ code: "custom", message: "grant and active Lease windows must agree" });
    }
  });

export function encodeDesktopAuthorizationGrantSignatureTranscript(value: unknown): Uint8Array {
  const parsed = desktopAuthorizationGrantSchema.parse(value);
  const { signature: _signature, ...grantWithoutSignature } = parsed;
  return encodeDomainSeparatedWireValue(
    DESKTOP_AUTHORIZATION_GRANT_SIGNATURE_DOMAIN,
    grantWithoutSignature,
  );
}

export type DesktopAuthorizationGrantRequest = z.infer<
  typeof desktopAuthorizationGrantRequestSchema
>;
export type DesktopAuthorizationGrant = z.infer<typeof desktopAuthorizationGrantSchema>;

export type DesktopCommercialAuthority = DesktopAuthorizationGrant["commercialAuthority"];
