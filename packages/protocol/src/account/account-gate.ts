import { z } from "zod";

import { canonicalUtcTimestamp } from "../wire/index";

export const ACCOUNT_GATE_SCHEMA_VERSION = 2 as const;

export const accountSecurityStateSchema = z.enum(["normal", "recovery_pending"]);
export const accountAccessModeSchema = z.enum([
  "security_locked",
  "commercial_read_only",
  "standby_read_only",
  "active",
]);
export const accountRestrictionReasonSchema = z.enum([
  "entitlement_expired",
  "entitlement_suspended",
  "entitlement_revoked",
  "device_removed",
  "account_security_locked",
  "offline_lease_expired",
  "local_integrity_failure",
]);
export const localAccessCapabilitySchema = z.enum([
  "local:export",
  "local:read",
  "provider:execute",
  "sync:replicate",
  "workspace:mutate",
]);
export const accountGateCheckSchema = z.enum(["pass", "fail"]);

const READ_ONLY_CAPABILITIES = ["local:export", "local:read"] as const;
const ACTIVE_CAPABILITIES = [
  "local:export",
  "local:read",
  "provider:execute",
  "sync:replicate",
  "workspace:mutate",
] as const;

export const accountGateStatusSchema = z
  .object({
    schemaVersion: z.literal(ACCOUNT_GATE_SCHEMA_VERSION),
    accessMode: accountAccessModeSchema,
    restrictionReason: accountRestrictionReasonSchema.nullable(),
    capabilities: z.array(localAccessCapabilitySchema).max(ACTIVE_CAPABILITIES.length),
    accountCheck: accountGateCheckSchema,
    deviceBindingCheck: accountGateCheckSchema,
    entitlementCheck: accountGateCheckSchema,
    activeLeaseCheck: accountGateCheckSchema,
    localIntegrityCheck: accountGateCheckSchema,
    accountSecurityState: accountSecurityStateSchema,
    trustedTimeState: z.enum(["trusted", "clock_rollback_suspected"]),
    evaluatedAt: canonicalUtcTimestamp,
  })
  .strict()
  .superRefine((value, context) => {
    const exactCapabilities = (expected: readonly string[]): boolean =>
      value.capabilities.length === expected.length &&
      value.capabilities.every((capability, index) => capability === expected[index]);
    const coreSecurityPasses =
      value.accountCheck === "pass" &&
      value.deviceBindingCheck === "pass" &&
      value.localIntegrityCheck === "pass" &&
      value.accountSecurityState === "normal";

    switch (value.accessMode) {
      case "active":
        if (
          !coreSecurityPasses ||
          value.entitlementCheck !== "pass" ||
          value.activeLeaseCheck !== "pass" ||
          value.trustedTimeState !== "trusted" ||
          value.restrictionReason !== null ||
          !exactCapabilities(ACTIVE_CAPABILITIES)
        ) {
          context.addIssue({ code: "custom", path: ["accessMode"], message: "active access requires every authority" });
        }
        break;
      case "standby_read_only":
        if (
          !coreSecurityPasses ||
          value.entitlementCheck !== "pass" ||
          value.activeLeaseCheck !== "fail" ||
          value.restrictionReason !== "offline_lease_expired" ||
          !exactCapabilities(READ_ONLY_CAPABILITIES)
        ) {
          context.addIssue({ code: "custom", path: ["accessMode"], message: "standby access is lease-limited read-only" });
        }
        break;
      case "commercial_read_only":
        if (
          !coreSecurityPasses ||
          value.entitlementCheck !== "fail" ||
          value.activeLeaseCheck !== "fail" ||
          !["entitlement_expired", "entitlement_suspended", "entitlement_revoked"].includes(value.restrictionReason ?? "") ||
          !exactCapabilities(READ_ONLY_CAPABILITIES)
        ) {
          context.addIssue({ code: "custom", path: ["accessMode"], message: "commercial restriction preserves only local read and export" });
        }
        break;
      case "security_locked":
        if (value.restrictionReason === null || value.capabilities.length !== 0) {
          context.addIssue({ code: "custom", path: ["accessMode"], message: "security lock carries a reason and no capabilities" });
        }
        if (
          coreSecurityPasses &&
          value.entitlementCheck === "pass" &&
          value.activeLeaseCheck === "pass" &&
          value.trustedTimeState === "trusted"
        ) {
          context.addIssue({ code: "custom", path: ["accessMode"], message: "security lock requires an authoritative failure" });
        }
        break;
    }
  });

export type AccountSecurityState = z.infer<typeof accountSecurityStateSchema>;
export type AccountAccessMode = z.infer<typeof accountAccessModeSchema>;
export type AccountRestrictionReason = z.infer<typeof accountRestrictionReasonSchema>;
export type LocalAccessCapability = z.infer<typeof localAccessCapabilitySchema>;
export type AccountGateCheck = z.infer<typeof accountGateCheckSchema>;
export type AccountGateStatus = z.infer<typeof accountGateStatusSchema>;
