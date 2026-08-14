import { z } from "zod";

import { identifier, safeUnsignedInteger } from "../wire/index";

export const ACCOUNT_REJECTION_SCHEMA_VERSION = 1 as const;

export const accountRejectionCodeSchema = z.enum([
  "INVALID_CREDENTIALS",
  "RATE_LIMITED",
  "EMAIL_VERIFICATION_REQUIRED",
  "REAUTHENTICATION_REQUIRED",
  "REAUTH_PROOF_EXPIRED",
  "ACCOUNT_SECURITY_EPOCH_STALE",
  "ACCOUNT_RECOVERY_PENDING",
  "SESSION_REVOKED",
  "REFRESH_REUSE_DETECTED",
  "REFRESH_ROTATION_CONFLICT",
  "DEVICE_NOT_BOUND",
  "DEVICE_REMOVED",
  "DEVICE_LIMIT_REACHED",
  "ACTIVE_DEVICE_CONFLICT",
  "EXCLUSIVE_EXECUTION_BLOCKED",
  "ENTITLEMENT_INACTIVE",
  "ENTITLEMENT_REVISION_STALE",
  "LIST_REVISION_STALE",
  "TRUSTED_TIME_ROLLBACK",
  "UNSUPPORTED_SCHEMA_VERSION",
]);

const retryableCodes = new Set([
  "RATE_LIMITED",
  "REFRESH_ROTATION_CONFLICT",
  "LIST_REVISION_STALE",
  "ENTITLEMENT_REVISION_STALE",
  "ACTIVE_DEVICE_CONFLICT",
]);

export const accountRejectionSchema = z
  .object({
    schemaVersion: z.literal(ACCOUNT_REJECTION_SCHEMA_VERSION),
    code: accountRejectionCodeSchema,
    retryable: z.boolean(),
    retryAfterSeconds: safeUnsignedInteger.nullable(),
    correlationId: identifier,
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.retryAfterSeconds !== null) !== (value.code === "RATE_LIMITED")) {
      context.addIssue({ code: "custom", path: ["retryAfterSeconds"], message: "retry delay is rate-limit-only" });
    }
    if (value.retryable !== retryableCodes.has(value.code)) {
      context.addIssue({ code: "custom", path: ["retryable"], message: "retryability must agree with rejection code" });
    }
  });

export type AccountRejectionCode = z.infer<typeof accountRejectionCodeSchema>;
export type AccountRejection = z.infer<typeof accountRejectionSchema>;
