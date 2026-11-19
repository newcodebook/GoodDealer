import { z } from "zod";

import {
  base64Url,
  canonicalUtcTimestamp,
  encodeDomainSeparatedWireValue,
  identifier,
  safePositiveInteger,
  safeUnsignedInteger,
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

/*
 * ADR-0032: a bound device that must not hold the Lease receives a Standby Grant instead. It is a
 * separate strict object with its own typ, audience, signature domain and signing key, never a v3
 * Grant with an optional Lease, so a parsing slip cannot turn read-only authority into execution
 * authority. The role exchange below wraps either Grant; the v3 request and bare v3 response are
 * removed when Cloud issuance (T2b) and Host parsing (T3) switch to it together.
 */
export const DESKTOP_STANDBY_GRANT_SCHEMA_VERSION = 1 as const;
export const DESKTOP_STANDBY_GRANT_SIGNATURE_DOMAIN = "GOODDEALER-DESKTOP-STANDBY-GRANT-V1" as const;
/** A Standby Grant lives no longer than the access token it accompanies. */
export const DESKTOP_STANDBY_GRANT_MAX_LIFETIME_SECONDS = 900 as const;
export const DESKTOP_AUTHORIZATION_GRANT_ROLE_EXCHANGE_SCHEMA_VERSION = 4 as const;

export const desktopStandbyGrantSchema = z
  .object({
    schemaVersion: z.literal(DESKTOP_STANDBY_GRANT_SCHEMA_VERSION),
    typ: z.literal("gd.desktop-standby-grant.v1"),
    iss: z.literal("https://accounts.gooddealer.com"),
    aud: z.literal("gooddealer-desktop/standby"),
    kid: identifier,
    issuedAt: canonicalUtcTimestamp,
    expiresAt: canonicalUtcTimestamp,
    accountId: identifier,
    deviceId: identifier,
    accountSecurityEpoch: safePositiveInteger,
    workspace: z
      .object({
        workspaceId: identifier,
        kind: z.literal("personal_default"),
      })
      .strict(),
    /**
     * The highest epoch Cloud had allocated, pending ones included, when it signed. The Host keeps
     * it as a monotonic floor: a replayed older Standby Grant cannot demote a device that has since
     * become Active, and no Active Grant at or below it is accepted.
     */
    leaseEpochFloor: safeUnsignedInteger,
    scopes: z.tuple([z.literal("workspace:read")]),
    signature: base64Url,
  })
  .strict()
  .superRefine((grant, context) => {
    const lifetime = (Date.parse(grant.expiresAt) - Date.parse(grant.issuedAt)) / 1000;
    if (!(lifetime > 0 && lifetime <= DESKTOP_STANDBY_GRANT_MAX_LIFETIME_SECONDS)) {
      context.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "a Standby Grant expires after it is issued and within 900 seconds",
      });
    }
  });

export function encodeDesktopStandbyGrantSignatureTranscript(value: unknown): Uint8Array {
  const parsed = desktopStandbyGrantSchema.parse(value);
  const { signature: _signature, ...grantWithoutSignature } = parsed;
  return encodeDomainSeparatedWireValue(DESKTOP_STANDBY_GRANT_SIGNATURE_DOMAIN, grantWithoutSignature);
}

/** The session and its bound device remain the only authority; the body names no role. */
export const desktopAuthorizationGrantRoleRequestSchema = z
  .object({ schemaVersion: z.literal(DESKTOP_AUTHORIZATION_GRANT_ROLE_EXCHANGE_SCHEMA_VERSION) })
  .strict();

/** Cloud derives the role from locked server state; each role carries only its own Grant shape. */
export const desktopAuthorizationGrantRoleResponseSchema = z.discriminatedUnion("role", [
  z
    .object({
      schemaVersion: z.literal(DESKTOP_AUTHORIZATION_GRANT_ROLE_EXCHANGE_SCHEMA_VERSION),
      role: z.literal("active"),
      grant: desktopAuthorizationGrantSchema,
    })
    .strict(),
  z
    .object({
      schemaVersion: z.literal(DESKTOP_AUTHORIZATION_GRANT_ROLE_EXCHANGE_SCHEMA_VERSION),
      role: z.literal("standby"),
      grant: desktopStandbyGrantSchema,
    })
    .strict(),
]);

export type DesktopStandbyGrant = z.infer<typeof desktopStandbyGrantSchema>;
export type DesktopAuthorizationGrantRoleRequest = z.infer<typeof desktopAuthorizationGrantRoleRequestSchema>;
export type DesktopAuthorizationGrantRoleResponse = z.infer<typeof desktopAuthorizationGrantRoleResponseSchema>;
