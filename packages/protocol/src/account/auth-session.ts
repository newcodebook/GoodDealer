import { z } from "zod";

import {
  canonicalUtcTimestamp,
  identifier,
  safePositiveInteger,
  safeUnsignedInteger,
} from "../wire/index";

export const AUTH_SESSION_SCHEMA_VERSION = 1 as const;

export const authSessionStateSchema = z.enum([
  "signed_out",
  "authenticated",
  "refresh_required",
  "reauth_required",
  "revoked",
]);

export const authRevocationReasonSchema = z.enum([
  "user_signed_out",
  "remote_sign_out",
  "refresh_reuse_detected",
  "account_security_epoch_advanced",
  "device_removed",
  "account_recovery_pending",
]);

export const authSessionStatusSchema = z
  .object({
    schemaVersion: z.literal(AUTH_SESSION_SCHEMA_VERSION),
    state: authSessionStateSchema,
    accountId: identifier.nullable(),
    deviceId: identifier.nullable(),
    accountSecurityEpoch: safePositiveInteger.nullable(),
    sessionId: identifier.nullable(),
    accessTokenExpiresAt: canonicalUtcTimestamp.nullable(),
    refreshRotationGeneration: safeUnsignedInteger.nullable(),
    lastTrustedTimeAt: canonicalUtcTimestamp.nullable(),
    revocationReason: authRevocationReasonSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    const nullableFields = [
      "accountId",
      "deviceId",
      "accountSecurityEpoch",
      "sessionId",
      "accessTokenExpiresAt",
      "refreshRotationGeneration",
      "lastTrustedTimeAt",
      "revocationReason",
    ] as const;
    if (value.state === "signed_out") {
      for (const field of nullableFields) {
        if (value[field] !== null) {
          context.addIssue({ code: "custom", path: [field], message: "signed-out fields must be null" });
        }
      }
    } else {
      for (const field of ["accountId", "deviceId", "accountSecurityEpoch", "sessionId", "lastTrustedTimeAt"] as const) {
        if (value[field] === null) {
          context.addIssue({ code: "custom", path: [field], message: "signed-in states require identity metadata" });
        }
      }
    }
    if ((value.revocationReason !== null) !== (value.state === "revoked")) {
      context.addIssue({ code: "custom", path: ["revocationReason"], message: "revocation reason must agree with state" });
    }
    if ((value.state === "authenticated" || value.state === "refresh_required") && value.accessTokenExpiresAt === null) {
      context.addIssue({ code: "custom", path: ["accessTokenExpiresAt"], message: "token expiry metadata is required" });
    }
  });

export const authLoginRequestSchema = z
  .object({
    schemaVersion: z.literal(AUTH_SESSION_SCHEMA_VERSION),
    method: z.enum(["password", "passkey"]),
    deviceId: identifier,
    rememberDevice: z.boolean(),
  })
  .strict();

export const authRefreshRequestSchema = z
  .object({
    schemaVersion: z.literal(AUTH_SESSION_SCHEMA_VERSION),
    deviceId: identifier,
    reason: z.enum(["startup", "scheduled", "expiry_window", "manual"]),
  })
  .strict();

export const authSignOutRequestSchema = z.discriminatedUnion("scope", [
  z.object({
    schemaVersion: z.literal(AUTH_SESSION_SCHEMA_VERSION),
    scope: z.literal("this_device"),
  }).strict(),
  z.object({
    schemaVersion: z.literal(AUTH_SESSION_SCHEMA_VERSION),
    scope: z.literal("all_devices"),
    reauthProofId: identifier,
  }).strict(),
]);

export const reauthProofRefSchema = z
  .object({
    schemaVersion: z.literal(AUTH_SESSION_SCHEMA_VERSION),
    reauthProofId: identifier,
    method: z.enum(["password", "passkey"]),
    verifiedAt: canonicalUtcTimestamp,
    expiresAt: canonicalUtcTimestamp,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.verifiedAt >= value.expiresAt) {
      context.addIssue({ code: "custom", path: ["expiresAt"], message: "expiresAt must follow verifiedAt" });
    }
  });

export type AuthSessionState = z.infer<typeof authSessionStateSchema>;
export type AuthRevocationReason = z.infer<typeof authRevocationReasonSchema>;
export type AuthSessionStatus = z.infer<typeof authSessionStatusSchema>;
export type AuthLoginRequest = z.infer<typeof authLoginRequestSchema>;
export type AuthRefreshRequest = z.infer<typeof authRefreshRequestSchema>;
export type AuthSignOutRequest = z.infer<typeof authSignOutRequestSchema>;
export type ReauthProofRef = z.infer<typeof reauthProofRefSchema>;
