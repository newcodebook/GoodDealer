import { z } from "zod";

import {
  base64Url,
  canonicalUtcTimestamp,
  encodeDomainSeparatedWireValue,
  identifier,
  safePositiveInteger,
  safeUnsignedInteger,
} from "../wire/index";

export const DEVICE_IDENTITY_SCHEMA_VERSION = 1 as const;
export const AUTH_ACCESS_SIGNATURE_DOMAIN = "GOODDEALER-AUTH-ACCESS-V1" as const;
export const AUTH_REFRESH_SIGNATURE_DOMAIN = "GOODDEALER-AUTH-REFRESH-V1" as const;

function validateCredentialWindow(
  envelope: { issuedAt: string; expiresAt: string },
  context: z.RefinementCtx,
) {
  if (envelope.issuedAt >= envelope.expiresAt) {
    context.addIssue({ code: "custom", message: "issuedAt must be earlier than expiresAt" });
  }
}

export const deviceBindingChallengeSchema = z
  .object({
    schemaVersion: z.literal(DEVICE_IDENTITY_SCHEMA_VERSION),
    purpose: z.enum(["binding", "rotation"]),
    challengeId: identifier,
    accountId: identifier,
    deviceId: identifier,
    nonce: base64Url,
    algorithm: z.literal("Ed25519"),
    proposedKeyId: identifier,
    proposedPublicKeyFingerprint: base64Url,
    expectedKeyVersion: safeUnsignedInteger,
    expiresAt: canonicalUtcTimestamp,
    reauthProofId: identifier,
  })
  .strict()
  .superRefine((challenge, context) => {
    if (challenge.purpose === "binding" && challenge.expectedKeyVersion !== 0) {
      context.addIssue({ code: "custom", message: "binding must start at key version 0" });
    }
    if (challenge.purpose === "rotation" && challenge.expectedKeyVersion === 0) {
      context.addIssue({ code: "custom", message: "rotation requires a current key version" });
    }
  });

export const deviceProofSchema = z
  .object({
    schemaVersion: z.literal(DEVICE_IDENTITY_SCHEMA_VERSION),
    challengeId: identifier,
    keyId: identifier,
    keyVersion: safePositiveInteger,
    publicKey: base64Url,
    signature: base64Url,
  })
  .strict();

const commonCredentialFields = {
  schemaVersion: z.literal(DEVICE_IDENTITY_SCHEMA_VERSION),
  iss: z.literal("https://accounts.gooddealer.com"),
  kid: identifier,
  accountId: identifier,
  deviceId: identifier,
  accountSecurityEpoch: safePositiveInteger,
  jti: identifier,
  issuedAt: canonicalUtcTimestamp,
  expiresAt: canonicalUtcTimestamp,
  signature: base64Url,
} as const;

export const activeDeviceLeaseEnvelopeSchema = z
  .object({
    ...commonCredentialFields,
    typ: z.literal("gd.active-device-lease.v1"),
    aud: z.literal("gooddealer-desktop/active-device-lease"),
    payload: z
      .object({
        leaseEpoch: safePositiveInteger,
        renewAfter: canonicalUtcTimestamp,
        onlineExpiresAt: canonicalUtcTimestamp,
        offlineExecuteUntil: canonicalUtcTimestamp,
      })
      .strict(),
  })
  .strict()
  .superRefine((envelope, context) => {
    validateCredentialWindow(envelope, context);
    const { renewAfter, onlineExpiresAt, offlineExecuteUntil } = envelope.payload;
    if (
      renewAfter <= envelope.issuedAt ||
      onlineExpiresAt <= renewAfter ||
      offlineExecuteUntil < onlineExpiresAt ||
      offlineExecuteUntil !== envelope.expiresAt ||
      Date.parse(offlineExecuteUntil) - Date.parse(envelope.issuedAt) > 86_400_000
    ) {
      context.addIssue({
        code: "custom",
        message: "active lease renewal, online expiry, and 24-hour offline window are out of order",
      });
    }
  });

export const offlineDeviceLeaseEnvelopeSchema = z
  .object({
    ...commonCredentialFields,
    typ: z.literal("gd.offline-device-lease.v1"),
    aud: z.literal("gooddealer-desktop/offline-device-lease"),
    payload: z
      .object({
        credentialEpoch: safePositiveInteger,
        renewAfter: canonicalUtcTimestamp,
      })
      .strict(),
  })
  .strict()
  .superRefine((envelope, context) => {
    validateCredentialWindow(envelope, context);
    if (envelope.payload.renewAfter <= envelope.issuedAt || envelope.expiresAt <= envelope.payload.renewAfter) {
      context.addIssue({
        code: "custom",
        message: "offline lease renewal must be inside the credential access window",
      });
    }
  });

export const entitlementEnvelopeSchema = z
  .object({
    ...commonCredentialFields,
    typ: z.literal("gd.entitlement.v1"),
    aud: z.literal("gooddealer-desktop/entitlement"),
    payload: z
      .object({
        licenseId: identifier,
        entitlementRevision: safePositiveInteger,
        paymentWatermark: identifier,
        plan: identifier,
        entitlementKind: z.enum(["subscription", "lifetime"]),
        commercialExpiresAt: canonicalUtcTimestamp.nullable(),
        offlineGraceUntil: canonicalUtcTimestamp,
        deviceLimit: z.literal(2),
        activeDeviceLimit: z.literal(1),
        standbyCloudRead: z.literal(true),
        featureEntitlements: z.array(identifier).max(128),
        allMajorVersions: z.boolean(),
      })
      .strict()
      .superRefine((payload, context) => {
        const validLifetime =
          payload.entitlementKind === "lifetime" &&
          payload.commercialExpiresAt === null &&
          payload.allMajorVersions;
        const validSubscription =
          payload.entitlementKind === "subscription" &&
          payload.commercialExpiresAt !== null &&
          !payload.allMajorVersions;
        if (!validLifetime && !validSubscription) {
          context.addIssue({
            code: "custom",
            message: "entitlement kind, commercial expiry, and major-version scope must agree",
          });
        }
      }),
  })
  .strict()
  .superRefine((envelope, context) => {
    validateCredentialWindow(envelope, context);
    if (envelope.payload.offlineGraceUntil < envelope.expiresAt) {
      context.addIssue({ code: "custom", message: "credential expiry cannot exceed offline grace" });
    }
    if (
      envelope.payload.commercialExpiresAt !== null &&
      envelope.payload.offlineGraceUntil < envelope.payload.commercialExpiresAt
    ) {
      context.addIssue({
        code: "custom",
        message: "subscription commercial expiry and offline grace are out of order",
      });
    }
  });

export const bootstrapCapabilityEnvelopeSchema = z
  .object({
    ...commonCredentialFields,
    typ: z.literal("gd.bootstrap-capability.v1"),
    aud: z.literal("gooddealer-desktop/bootstrap"),
    payload: z.object({ deviceSwitchRequestId: identifier }).strict(),
  })
  .strict()
  .superRefine(validateCredentialWindow);

export const authAccessEnvelopeSchema = z
  .object({
    ...commonCredentialFields,
    typ: z.literal("gd.auth-access.v1"),
    aud: z.literal("gooddealer-cloud/account-api"),
    keyPurpose: z.literal("gooddealer.identity.auth-access.v1"),
    payload: z.object({ sessionId: identifier }).strict(),
  })
  .strict()
  .superRefine(validateCredentialWindow);

export const authRefreshEnvelopeSchema = z
  .object({
    ...commonCredentialFields,
    typ: z.literal("gd.auth-refresh.v1"),
    aud: z.literal("gooddealer-accounts/session-refresh"),
    keyPurpose: z.literal("gooddealer.identity.auth-refresh.v1"),
    payload: z
      .object({
        sessionId: identifier,
        familyId: identifier,
        rotationGeneration: safeUnsignedInteger,
        rememberDevice: z.boolean(),
      })
      .strict(),
  })
  .strict()
  .superRefine(validateCredentialWindow);

export const signedCredentialEnvelopeSchema = z.discriminatedUnion("typ", [
  activeDeviceLeaseEnvelopeSchema,
  offlineDeviceLeaseEnvelopeSchema,
  entitlementEnvelopeSchema,
  bootstrapCapabilityEnvelopeSchema,
  authAccessEnvelopeSchema,
  authRefreshEnvelopeSchema,
]);

export function encodeAuthAccessSignatureTranscript(value: unknown): Uint8Array {
  const parsed = authAccessEnvelopeSchema.parse(value);
  const { signature: _signature, ...envelopeWithoutSignature } = parsed;
  return encodeDomainSeparatedWireValue(AUTH_ACCESS_SIGNATURE_DOMAIN, envelopeWithoutSignature);
}

export function encodeAuthRefreshSignatureTranscript(value: unknown): Uint8Array {
  const parsed = authRefreshEnvelopeSchema.parse(value);
  const { signature: _signature, ...envelopeWithoutSignature } = parsed;
  return encodeDomainSeparatedWireValue(AUTH_REFRESH_SIGNATURE_DOMAIN, envelopeWithoutSignature);
}

export type DeviceBindingChallenge = z.infer<typeof deviceBindingChallengeSchema>;
export type DeviceProof = z.infer<typeof deviceProofSchema>;
export type AuthAccessEnvelope = z.infer<typeof authAccessEnvelopeSchema>;
export type AuthRefreshEnvelope = z.infer<typeof authRefreshEnvelopeSchema>;
export type SignedCredentialEnvelope = z.infer<typeof signedCredentialEnvelopeSchema>;
