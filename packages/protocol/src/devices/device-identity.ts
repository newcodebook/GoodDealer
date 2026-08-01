import { z } from "zod";

export const DEVICE_IDENTITY_SCHEMA_VERSION = 1 as const;

const identifier = z.string().min(1).max(160);
const base64Url = z.string().regex(/^[A-Za-z0-9_-]+$/);

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
    expectedKeyVersion: z.number().int().nonnegative(),
    expiresAt: z.string().min(1),
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
    keyVersion: z.number().int().positive(),
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
  jti: identifier,
  issuedAt: z.string().min(1),
  expiresAt: z.string().min(1),
  signature: base64Url,
} as const;

export const activeDeviceLeaseEnvelopeSchema = z
  .object({
    ...commonCredentialFields,
    typ: z.literal("gd.active-device-lease.v1"),
    aud: z.literal("gooddealer-desktop/active-device-lease"),
    payload: z
      .object({
        leaseEpoch: z.number().int().positive(),
        offlineExecuteUntil: z.string().min(1),
      })
      .strict(),
  })
  .strict();

export const offlineDeviceLeaseEnvelopeSchema = z
  .object({
    ...commonCredentialFields,
    typ: z.literal("gd.offline-device-lease.v1"),
    aud: z.literal("gooddealer-desktop/offline-device-lease"),
    payload: z.object({ credentialEpoch: z.number().int().positive() }).strict(),
  })
  .strict();

export const entitlementEnvelopeSchema = z
  .object({
    ...commonCredentialFields,
    typ: z.literal("gd.entitlement.v1"),
    aud: z.literal("gooddealer-desktop/entitlement"),
    payload: z.object({ plan: identifier }).strict(),
  })
  .strict();

export const bootstrapCapabilityEnvelopeSchema = z
  .object({
    ...commonCredentialFields,
    typ: z.literal("gd.bootstrap-capability.v1"),
    aud: z.literal("gooddealer-desktop/bootstrap"),
    payload: z.object({ deviceSwitchRequestId: identifier }).strict(),
  })
  .strict();

export const signedCredentialEnvelopeSchema = z.discriminatedUnion("typ", [
  activeDeviceLeaseEnvelopeSchema,
  offlineDeviceLeaseEnvelopeSchema,
  entitlementEnvelopeSchema,
  bootstrapCapabilityEnvelopeSchema,
]);

export type DeviceBindingChallenge = z.infer<typeof deviceBindingChallengeSchema>;
export type DeviceProof = z.infer<typeof deviceProofSchema>;
export type SignedCredentialEnvelope = z.infer<typeof signedCredentialEnvelopeSchema>;
