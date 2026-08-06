import { z } from "zod";

export const DEVICE_IDENTITY_SCHEMA_VERSION = 1 as const;

const identifier = z.string().min(1).max(160).regex(/^[\x21-\x7E]+$/);
const base64Url = z.string().regex(/^[A-Za-z0-9_-]+$/);
const safeUnsignedInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const safePositiveInteger = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const canonicalUtcTimestamp = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:[0-5]\dZ$/)
  .refine((value) => {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) && new Date(parsed).toISOString() === value.replace(/Z$/, ".000Z");
  }, "timestamp must be a real canonical UTC second");

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

export const signedCredentialEnvelopeSchema = z.discriminatedUnion("typ", [
  activeDeviceLeaseEnvelopeSchema,
  offlineDeviceLeaseEnvelopeSchema,
  entitlementEnvelopeSchema,
  bootstrapCapabilityEnvelopeSchema,
]);

export type DeviceBindingChallenge = z.infer<typeof deviceBindingChallengeSchema>;
export type DeviceProof = z.infer<typeof deviceProofSchema>;
export type SignedCredentialEnvelope = z.infer<typeof signedCredentialEnvelopeSchema>;
