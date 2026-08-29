import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  activeDeviceLeaseStatusSchema,
  deviceAuthorityProjectionSchema,
  deviceBindingListSchema,
  deviceBindingSummarySchema,
  deviceOperationSchema,
  deviceRemovalRequestSchema,
  deviceSwitchRequestSchema,
  deviceSwitchRequestViewSchema,
} from "../src/devices/index";

const vectors = resolve(import.meta.dirname, "../test-vectors/device-management");

function vector(path: string): unknown {
  return JSON.parse(readFileSync(resolve(vectors, path), "utf8"));
}

const validCases = [
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

const invalidCases = [
  ["binding-removed-without-timestamp.json", deviceBindingSummarySchema],
  ["binding-removed-with-role.json", deviceBindingSummarySchema],
  ["binding-role-on-removed-status.json", deviceBindingSummarySchema],
  ["binding-removed-current-device.json", deviceBindingSummarySchema],
  ["binding-last-seen-before-bound.json", deviceBindingSummarySchema],
  ["binding-revoked-key-with-role.json", deviceBindingSummarySchema],
  ["binding-list-duplicate-device-id.json", deviceBindingListSchema],
  ["binding-list-three-bound.json", deviceBindingListSchema],
  ["binding-list-two-active.json", deviceBindingListSchema],
  ["binding-list-two-current-device.json", deviceBindingListSchema],
  ["binding-unknown-field.json", deviceBindingSummarySchema],
  ["binding-unknown-version.json", deviceBindingSummarySchema],
  ["binding-snake-case-wire.json", deviceBindingSummarySchema],
  ["binding-unsafe-credential-epoch.json", deviceBindingSummarySchema],
  ["binding-public-key-field.json", deviceBindingSummarySchema],
  ["lease-status-not-held-with-epoch.json", activeDeviceLeaseStatusSchema],
  ["lease-status-not-held-wrong-renewal-state.json", activeDeviceLeaseStatusSchema],
  ["lease-status-held-missing-epoch.json", activeDeviceLeaseStatusSchema],
  ["lease-status-inverted-window.json", activeDeviceLeaseStatusSchema],
  ["lease-status-window-inverted-only.json", activeDeviceLeaseStatusSchema],
  ["lease-status-offline-window-too-long.json", activeDeviceLeaseStatusSchema],
  ["lease-status-renewal-state-mismatch.json", activeDeviceLeaseStatusSchema],
  ["lease-status-with-signature.json", activeDeviceLeaseStatusSchema],
  ["authority-unsorted-scopes.json", deviceAuthorityProjectionSchema],
  ["authority-duplicate-scopes.json", deviceAuthorityProjectionSchema],
  ["authority-standby-with-mutate.json", deviceAuthorityProjectionSchema],
  ["authority-standby-with-platform-write.json", deviceAuthorityProjectionSchema],
  ["authority-none-with-scopes.json", deviceAuthorityProjectionSchema],
  ["switch-forced-without-earliest-takeover.json", deviceSwitchRequestViewSchema],
  ["switch-bootstrapping-without-expiry.json", deviceSwitchRequestViewSchema],
  ["switch-completed-with-bootstrap-expiry.json", deviceSwitchRequestViewSchema],
  ["switch-earliest-takeover-before-request.json", deviceSwitchRequestViewSchema],
  ["switch-normal-with-reauth-proof.json", deviceSwitchRequestSchema],
  ["switch-forced-without-reauth-proof.json", deviceSwitchRequestSchema],
] as const;

describe("device management contracts", () => {
  for (const [path, schema] of validCases) {
    it(`accepts valid/${path}`, () => {
      expect(schema.safeParse(vector(`valid/${path}`)).success).toBe(true);
    });
  }

  for (const [path, schema] of invalidCases) {
    it(`rejects invalid/${path}`, () => {
      expect(schema.safeParse(vector(`invalid/${path}`)).success).toBe(false);
    });
  }

  it("freezes the six device operation names", () => {
    expect(deviceOperationSchema.options).toEqual([
      "devices.authorizationGrant.issue",
      "devices.bindings.list",
      "devices.binding.remove",
      "devices.lease.status",
      "devices.switch.request",
      "devices.switch.status",
    ]);
  });
});
