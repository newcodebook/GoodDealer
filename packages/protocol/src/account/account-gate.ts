import { z } from "zod";

import { canonicalUtcTimestamp } from "../wire/index";

export const ACCOUNT_GATE_SCHEMA_VERSION = 1 as const;

export const accountSecurityStateSchema = z.enum(["normal", "recovery_pending"]);
export const accountLockReasonSchema = z.enum([
  "entitlement_expired",
  "device_removed",
  "offline_lease_expired",
  "local_integrity_failure",
]);
export const accountGateCheckSchema = z.enum(["pass", "fail"]);

export const accountGateStatusSchema = z
  .object({
    schemaVersion: z.literal(ACCOUNT_GATE_SCHEMA_VERSION),
    outcome: z.enum(["locked", "standby_eligible", "active_eligible"]),
    lockReason: accountLockReasonSchema.nullable(),
    accountCheck: accountGateCheckSchema,
    deviceBindingCheck: accountGateCheckSchema,
    entitlementCheck: accountGateCheckSchema,
    activeLeaseCheck: accountGateCheckSchema,
    accountSecurityState: accountSecurityStateSchema,
    trustedTimeState: z.enum(["trusted", "clock_rollback_suspected"]),
    evaluatedAt: canonicalUtcTimestamp,
  })
  .strict()
  .superRefine((value, context) => {
    const primaryChecks = [value.accountCheck, value.deviceBindingCheck, value.entitlementCheck];
    if (value.outcome === "active_eligible" && [...primaryChecks, value.activeLeaseCheck].some((check) => check !== "pass")) {
      context.addIssue({ code: "custom", path: ["outcome"], message: "active eligibility requires every check" });
    }
    if (
      value.outcome === "standby_eligible" &&
      (primaryChecks.some((check) => check !== "pass") || value.activeLeaseCheck !== "fail")
    ) {
      context.addIssue({ code: "custom", path: ["outcome"], message: "standby eligibility requires only the active lease to fail" });
    }
    if ((value.lockReason !== null) !== (value.outcome === "locked")) {
      context.addIssue({ code: "custom", path: ["lockReason"], message: "lock reason must agree with outcome" });
    }
    if (
      value.outcome === "locked" &&
      primaryChecks.every((check) => check === "pass") &&
      value.lockReason !== "local_integrity_failure"
    ) {
      context.addIssue({ code: "custom", path: ["outcome"], message: "locked outcome requires an authoritative failure" });
    }
  });

export type AccountSecurityState = z.infer<typeof accountSecurityStateSchema>;
export type AccountLockReason = z.infer<typeof accountLockReasonSchema>;
export type AccountGateCheck = z.infer<typeof accountGateCheckSchema>;
export type AccountGateStatus = z.infer<typeof accountGateStatusSchema>;
