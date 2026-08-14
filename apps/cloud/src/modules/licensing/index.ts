import {
  ACCOUNT_REJECTION_SCHEMA_VERSION,
  ENTITLEMENT_PROJECTION_SCHEMA_VERSION,
  accountRejectionSchema,
  entitlementProjectionSchema,
  type AccountRejection,
  type EntitlementProjection,
  type EntitlementState,
} from "@gooddealer/protocol/account";

export interface AccountEntitlementFixture {
  readonly state: EntitlementState;
  readonly licenseId: string;
  readonly plan: string;
  readonly entitlementKind: "subscription" | "lifetime";
  readonly entitlementRevision: number;
  readonly commercialExpiresAt: string | null;
  readonly offlineGraceUntil: string;
  readonly credentialRefreshDueAt: string;
  readonly featureEntitlements: readonly string[];
}

export class LicensingFixtureService {
  #entitlement: AccountEntitlementFixture;

  constructor(entitlement: AccountEntitlementFixture) {
    this.#entitlement = entitlement;
  }

  replaceFixture(entitlement: AccountEntitlementFixture): void {
    this.#entitlement = entitlement;
  }

  getProjection(evaluatedAt: string): EntitlementProjection | AccountRejection {
    if (["pending", "suspended", "revoked"].includes(this.#entitlement.state)) {
      return accountRejectionSchema.parse({
        schemaVersion: ACCOUNT_REJECTION_SCHEMA_VERSION,
        code: "ENTITLEMENT_INACTIVE",
        retryable: false,
        retryAfterSeconds: null,
        correlationId: "fixture-licensing-entitlement-inactive",
      });
    }

    return entitlementProjectionSchema.parse({
      schemaVersion: ENTITLEMENT_PROJECTION_SCHEMA_VERSION,
      ...this.#entitlement,
      featureEntitlements: [...this.#entitlement.featureEntitlements].sort(),
      deviceLimit: 2,
      activeDeviceLimit: 1,
      standbyCloudRead: true,
      allMajorVersions: this.#entitlement.entitlementKind === "lifetime",
      evaluatedAt,
    });
  }
}
