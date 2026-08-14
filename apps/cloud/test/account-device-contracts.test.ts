import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  accountGateStatusSchema,
  accountRejectionSchema,
  accountSessionListSchema,
  accountSessionRevokeRequestSchema,
  authLoginRequestSchema,
  authRefreshRequestSchema,
  authSessionStatusSchema,
  authSignOutRequestSchema,
  entitlementProjectionSchema,
  reauthProofRefSchema,
} from "@gooddealer/protocol/account";
import {
  activeDeviceLeaseStatusSchema,
  deviceAuthorityProjectionSchema,
  deviceBindingListSchema,
  deviceBindingSummarySchema,
  deviceRemovalRequestSchema,
  deviceSwitchRequestSchema,
  deviceSwitchRequestViewSchema,
} from "@gooddealer/protocol/devices";
import { describe, expect, it } from "vitest";

const accountVectors = resolve(import.meta.dirname, "../../../packages/protocol/test-vectors/account");
const deviceVectors = resolve(import.meta.dirname, "../../../packages/protocol/test-vectors/device-management");

function vector(root: string, path: string): unknown {
  return JSON.parse(readFileSync(resolve(root, path), "utf8"));
}

const accountValid = [
  ["auth-session-authenticated.json", authSessionStatusSchema],
  ["auth-session-signed-out.json", authSessionStatusSchema],
  ["auth-session-revoked.json", authSessionStatusSchema],
  ["auth-session-refresh-required.json", authSessionStatusSchema],
  ["login-request.json", authLoginRequestSchema],
  ["refresh-request.json", authRefreshRequestSchema],
  ["sign-out-this-device.json", authSignOutRequestSchema],
  ["sign-out-all-devices.json", authSignOutRequestSchema],
  ["reauth-proof-ref.json", reauthProofRefSchema],
  ["session-list.json", accountSessionListSchema],
  ["session-revoke-single.json", accountSessionRevokeRequestSchema],
  ["session-revoke-all-other.json", accountSessionRevokeRequestSchema],
  ["entitlement-projection-lifetime.json", entitlementProjectionSchema],
  ["entitlement-projection-subscription-active.json", entitlementProjectionSchema],
  ["entitlement-projection-subscription-grace.json", entitlementProjectionSchema],
  ["gate-active-eligible.json", accountGateStatusSchema],
  ["gate-standby-eligible.json", accountGateStatusSchema],
  ["gate-locked.json", accountGateStatusSchema],
  ["rejection-rate-limited.json", accountRejectionSchema],
  ["rejection-device-removed.json", accountRejectionSchema],
] as const;

const deviceValid = [
  ["binding-active.json", deviceBindingSummarySchema],
  ["binding-standby.json", deviceBindingSummarySchema],
  ["binding-removed.json", deviceBindingSummarySchema],
  ["binding-list-two-bound.json", deviceBindingListSchema],
  ["lease-status-held-fresh.json", activeDeviceLeaseStatusSchema],
  ["lease-status-held-renewal-window.json", activeDeviceLeaseStatusSchema],
  ["lease-status-held-offline-grace.json", activeDeviceLeaseStatusSchema],
  ["lease-status-not-held.json", activeDeviceLeaseStatusSchema],
  ["authority-active.json", deviceAuthorityProjectionSchema],
  ["authority-standby.json", deviceAuthorityProjectionSchema],
  ["authority-standby-with-ingest.json", deviceAuthorityProjectionSchema],
  ["authority-none.json", deviceAuthorityProjectionSchema],
  ["removal-request.json", deviceRemovalRequestSchema],
  ["switch-request-normal.json", deviceSwitchRequestSchema],
  ["switch-request-forced.json", deviceSwitchRequestSchema],
  ["switch-view-waiting-expiry.json", deviceSwitchRequestViewSchema],
  ["switch-view-bootstrapping.json", deviceSwitchRequestViewSchema],
  ["switch-view-completed.json", deviceSwitchRequestViewSchema],
] as const;

describe("Cloud account and device ingress", () => {
  for (const [path, schema] of accountValid) {
    it(`accepts the shared account vector ${path}`, () => {
      expect(schema.safeParse(vector(accountVectors, `valid/${path}`)).success).toBe(true);
    });
  }

  for (const [path, schema] of deviceValid) {
    it(`accepts the shared device-management vector ${path}`, () => {
      expect(schema.safeParse(vector(deviceVectors, `valid/${path}`)).success).toBe(true);
    });
  }

  it("rejects invalid shared vectors instead of maintaining a parallel Cloud contract", () => {
    expect(authSessionStatusSchema.safeParse(vector(accountVectors, "invalid/auth-session-unknown-field.json")).success).toBe(false);
    expect(entitlementProjectionSchema.safeParse(vector(accountVectors, "invalid/entitlement-projection-with-payment-watermark.json")).success).toBe(false);
    expect(deviceBindingListSchema.safeParse(vector(deviceVectors, "invalid/binding-list-three-bound.json")).success).toBe(false);
    expect(deviceSwitchRequestSchema.safeParse(vector(deviceVectors, "invalid/switch-forced-without-reauth-proof.json")).success).toBe(false);
  });
});
