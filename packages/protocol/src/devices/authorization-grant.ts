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

export const DESKTOP_AUTHORIZATION_GRANT_SCHEMA_VERSION = 4 as const;
export const DESKTOP_AUTHORIZATION_GRANT_SIGNATURE_DOMAIN =
  "GOODDEALER-DESKTOP-AUTHORIZATION-GRANT-V4" as const;
export const DESKTOP_AUTHORIZATION_GRANT_OPERATION_ID =
  "devices.authorizationGrant.issue" as const;

export const DESKTOP_COMMERCIAL_CAPABILITIES = [
  "afternic:marketplace:observe",
  "afternic:marketplace:write",
  "aliyun:registrar:observe",
  "atom:marketplace:observe",
  "atom:marketplace:write",
  "cloudflare:dns:observe",
  "cloudflare:registrar:observe",
  "godaddy:registrar:observe",
  "sedo:marketplace:observe",
  "spaceship:marketplace:observe",
  "spaceship:marketplace:write",
  "spaceship:registrar:observe",
] as const;
export const desktopCommercialCapabilitySchema = z.enum(DESKTOP_COMMERCIAL_CAPABILITIES);
export const desktopCommercialCapabilitiesSchema = z.array(desktopCommercialCapabilitySchema)
  .max(DESKTOP_COMMERCIAL_CAPABILITIES.length)
  .superRefine((capabilities, context) => {
    if (capabilities.some((value, index) => index > 0 && capabilities[index - 1]! >= value)) {
      context.addIssue({ code: "custom", message: "commercial capabilities must be strictly ascending" });
    }
    if (capabilities.includes("afternic:marketplace:write") && !capabilities.includes("afternic:marketplace:observe")) {
      context.addIssue({ code: "custom", message: "Afternic writes require observation for reconciliation" });
    }
    if (capabilities.includes("atom:marketplace:write") && !capabilities.includes("atom:marketplace:observe")) {
      context.addIssue({ code: "custom", message: "Atom writes require observation for reconciliation" });
    }
    if (capabilities.includes("spaceship:marketplace:write") && !capabilities.includes("spaceship:marketplace:observe")) {
      context.addIssue({ code: "custom", message: "SellerHub writes require observation for reconciliation" });
    }
  });
export type DesktopCommercialCapability = z.infer<typeof desktopCommercialCapabilitySchema>;

/**
 * Cloud-issued authorization input for the local business runtime. Every authority-bearing outer
 * field is covered by its own purpose-specific signature; the nested Lease is verified separately.
 */
export const desktopAuthorizationGrantSchema = z
  .object({
    schemaVersion: z.literal(DESKTOP_AUTHORIZATION_GRANT_SCHEMA_VERSION),
    typ: z.literal("gd.desktop-authorization-grant.v4"),
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
      schemaVersion: z.literal(2),
      entitlementRevision: safePositiveInteger,
      entitlementProjectionDigest: z.string().regex(/^[0-9a-f]{64}$/u),
      state: z.literal("active"),
      commercialExpiresAt: canonicalUtcTimestamp,
      capabilities: desktopCommercialCapabilitiesSchema,
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

export type DesktopAuthorizationGrant = z.infer<typeof desktopAuthorizationGrantSchema>;

export type DesktopCommercialAuthority = DesktopAuthorizationGrant["commercialAuthority"];

/*
 * ADR-0032: a bound device that must not hold the Lease receives a Standby Grant instead. It is a
 * separate strict object with its own typ, audience, signature domain and signing key, never a v4
 * Grant with an optional Lease, so a parsing slip cannot turn read-only authority into execution
 * authority. The v5 role exchange is the only request/response path; an Active role still carries
 * the separately signed v4 execution Grant and nested Lease.
 */
export const DESKTOP_STANDBY_GRANT_SCHEMA_VERSION = 1 as const;
export const DESKTOP_STANDBY_GRANT_SIGNATURE_DOMAIN = "GOODDEALER-DESKTOP-STANDBY-GRANT-V1" as const;
/** A Standby Grant lives no longer than the access token it accompanies. */
export const DESKTOP_STANDBY_GRANT_MAX_LIFETIME_SECONDS = 900 as const;
export const DESKTOP_AUTHORIZATION_GRANT_ROLE_EXCHANGE_SCHEMA_VERSION = 5 as const;

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
     * The highest allocated epoch, including pending allocations. Only the exact valid bootstrap
     * target receives its uniquely reserved pending epoch minus one, preserving promotion into
     * that reservation (ADR-0032 S3). All other devices receive the highest epoch. The Host keeps
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
