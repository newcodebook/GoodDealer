import { accountRejectionSchema, entitlementProjectionSchema } from "@gooddealer/protocol/account";
import { describe, expect, it } from "vitest";

import { LicensingFixtureService, type AccountEntitlementFixture } from "../src/modules/licensing/index";

const subscription = (state: AccountEntitlementFixture["state"]): AccountEntitlementFixture => ({
  state,
  licenseId: "fixture-license-subscription",
  plan: "fixture-plan",
  entitlementKind: "subscription",
  entitlementRevision: 2,
  commercialExpiresAt: "2026-02-01T00:00:00Z",
  offlineGraceUntil: "2026-02-02T00:00:00Z",
  credentialRefreshDueAt: "2026-01-02T00:00:00Z",
  featureEntitlements: ["workspace.read", "platform.read"],
});

describe("LicensingFixtureService", () => {
  it.each(["active", "grace"] as const)("projects the %s subscription path", (state) => {
    const projection = entitlementProjectionSchema.parse(
      new LicensingFixtureService(subscription(state)).getProjection("2026-01-01T00:00:00Z"),
    );
    expect(projection).toMatchObject({ state, entitlementKind: "subscription", deviceLimit: 2, activeDeviceLimit: 1 });
    expect(projection.featureEntitlements).toEqual(["platform.read", "workspace.read"]);
  });

  it("projects the lifetime path without a commercial expiry", () => {
    const service = new LicensingFixtureService({
      ...subscription("active"),
      licenseId: "fixture-license-lifetime",
      entitlementKind: "lifetime",
      commercialExpiresAt: null,
    });
    expect(entitlementProjectionSchema.parse(service.getProjection("2026-01-01T00:00:00Z"))).toMatchObject({
      entitlementKind: "lifetime",
      commercialExpiresAt: null,
      allMajorVersions: true,
    });
  });

  it.each(["pending", "suspended", "revoked"] as const)("rejects the %s issuance path", (state) => {
    const rejection = accountRejectionSchema.parse(
      new LicensingFixtureService(subscription(state)).getProjection("2026-01-01T00:00:00Z"),
    );
    expect(rejection.code).toBe("ENTITLEMENT_INACTIVE");
  });
});
