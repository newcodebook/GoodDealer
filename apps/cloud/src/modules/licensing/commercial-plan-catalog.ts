import {
  authoritativeEntitlementSnapshotSchema,
  type AuthoritativeEntitlementSnapshot,
} from "@gooddealer/protocol/account";

export type PaymentProvider = "stripe" | "paypal";

export interface SubscriptionPlanDefinition {
  readonly provider: PaymentProvider;
  readonly providerPlanId: string;
  readonly plan: string;
  readonly featureEntitlements: readonly string[];
  readonly offlineGraceSeconds: number;
  readonly credentialRefreshSeconds: number;
}

export interface ReconciledSubscription {
  readonly provider: PaymentProvider;
  readonly accountId: string;
  readonly subscriptionId: string;
  /** Local checkout identity when the Provider can preserve GoodDealer metadata. */
  readonly checkoutId: string | null;
  /** Provider creation identity when it is also the resulting subscription identity. */
  readonly providerCheckoutId: string | null;
  readonly providerPlanId: string;
  readonly state: "pending" | "active" | "grace" | "suspended" | "revoked";
  readonly commercialExpiresAt: string;
}

export interface ProviderEventEvidence {
  readonly provider: PaymentProvider;
  readonly eventId: string;
  readonly sourceRevision: number;
  readonly occurredAt: string;
  readonly evaluatedAt: string;
}

export interface CommercialPlanAuthority {
  readonly plan: string;
  readonly commercialExpiresAt: string;
  readonly offlineGraceUntil: string;
  readonly credentialRefreshDueAt: string;
  readonly featureEntitlements: readonly string[];
}

/** Owns the explicit commercial product-to-rights allowlist shared by payment adapters. */
export class CommercialSubscriptionPlanCatalog {
  readonly #plans: ReadonlyMap<string, SubscriptionPlanDefinition>;

  constructor(definitions: readonly SubscriptionPlanDefinition[]) {
    const plans = new Map<string, SubscriptionPlanDefinition>();
    for (const definition of definitions) {
      assertIdentifier(definition.providerPlanId, "provider plan id");
      assertIdentifier(definition.plan, "commercial plan");
      assertPositiveSeconds(definition.offlineGraceSeconds, "offline grace");
      assertPositiveSeconds(definition.credentialRefreshSeconds, "credential refresh");
      const features = [...definition.featureEntitlements];
      for (const feature of features) assertIdentifier(feature, "feature entitlement");
      for (let index = 1; index < features.length; index += 1) {
        if (features[index - 1]! >= features[index]!) {
          throw new TypeError("feature entitlements must be strictly ascending");
        }
      }
      const key = catalogKey(definition.provider, definition.providerPlanId);
      if (plans.has(key)) throw new TypeError("commercial provider plan is duplicated");
      plans.set(key, { ...definition, featureEntitlements: features });
    }
    this.#plans = plans;
  }

  has(provider: PaymentProvider, providerPlanId: string): boolean {
    return this.#plans.has(catalogKey(provider, providerPlanId));
  }

  /** Maps a trusted current Provider resource to rights without accepting any tenant hint. */
  authority(
    provider: PaymentProvider,
    providerPlanId: string,
    commercialExpiresAt: string,
    evaluatedAt: string,
  ): CommercialPlanAuthority {
    const definition = this.#plans.get(catalogKey(provider, providerPlanId));
    if (definition === undefined) throw new TypeError("commercial provider plan is not configured");
    const expiry = canonicalSecond(commercialExpiresAt, "commercial expiry");
    const evaluation = canonicalSecond(evaluatedAt, "provider evaluation time");
    const grace = addSeconds(expiry, definition.offlineGraceSeconds);
    return {
      plan: definition.plan,
      commercialExpiresAt: expiry,
      offlineGraceUntil: grace,
      credentialRefreshDueAt: earlier(addSeconds(evaluation, definition.credentialRefreshSeconds), grace),
      featureEntitlements: [...definition.featureEntitlements],
    };
  }

  snapshot(
    event: ProviderEventEvidence,
    subscription: ReconciledSubscription,
  ): {
    readonly kind: "subscription";
    readonly accountId: string;
    readonly provider: PaymentProvider;
    readonly providerCommercialId: string;
    readonly providerItemId: string;
    readonly checkoutId: string | null;
    readonly providerCheckoutId: string | null;
    readonly commercialState: ReconciledSubscription["state"];
    readonly commercialExpiresAt: string;
    readonly evaluatedAt: string;
    readonly snapshot: AuthoritativeEntitlementSnapshot;
  } {
    if (event.provider !== subscription.provider) throw new TypeError("payment provider identity disagrees");
    assertIdentifier(subscription.accountId, "GoodDealer account binding");
    assertIdentifier(subscription.subscriptionId, "provider subscription id");
    const definition = this.#plans.get(catalogKey(subscription.provider, subscription.providerPlanId));
    if (definition === undefined) throw new TypeError("commercial provider plan is not configured");

    const expiry = canonicalSecond(subscription.commercialExpiresAt, "commercial expiry");
    const occurredAt = canonicalSecond(event.occurredAt, "provider event time");
    const evaluatedAt = canonicalSecond(event.evaluatedAt, "webhook evaluation time");
    const grace = addSeconds(expiry, definition.offlineGraceSeconds);
    const refresh = earlier(addSeconds(evaluatedAt, definition.credentialRefreshSeconds), grace);
    const snapshot = authoritativeEntitlementSnapshotSchema.parse({
      sourceEventId: `${event.provider}:${event.eventId}`,
      sourceRevision: event.sourceRevision,
      occurredAt,
      state: subscription.state,
      licenseId: `${subscription.provider}:${subscription.subscriptionId}`,
      plan: definition.plan,
      entitlementKind: "subscription",
      commercialExpiresAt: expiry,
      offlineGraceUntil: grace,
      credentialRefreshDueAt: refresh,
      featureEntitlements: [...definition.featureEntitlements],
      versionEntitlement: { kind: "subscription_supported" },
    });
    return {
      kind: "subscription" as const,
      accountId: subscription.accountId,
      provider: subscription.provider,
      providerCommercialId: subscription.subscriptionId,
      providerItemId: subscription.providerPlanId,
      checkoutId: subscription.checkoutId,
      providerCheckoutId: subscription.providerCheckoutId,
      commercialState: subscription.state,
      commercialExpiresAt: expiry,
      evaluatedAt,
      snapshot,
    };
  }
}

function catalogKey(provider: PaymentProvider, providerPlanId: string): string {
  return `${provider}\u0000${providerPlanId}`;
}

function assertIdentifier(value: string, label: string): void {
  if (value.length < 1 || value.length > 160 || !/^[!-~]+$/u.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
}

function assertPositiveSeconds(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > 31_536_000) {
    throw new TypeError(`${label} interval is invalid`);
  }
}

export function canonicalSecond(value: string, label: string): string {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw new TypeError(`${label} is invalid`);
  return new Date(Math.floor(milliseconds / 1_000) * 1_000).toISOString().replace(".000Z", "Z");
}

function addSeconds(value: string, seconds: number): string {
  const milliseconds = Date.parse(value) + seconds * 1_000;
  if (!Number.isSafeInteger(milliseconds)) throw new TypeError("commercial deadline is invalid");
  return new Date(milliseconds).toISOString().replace(".000Z", "Z");
}

function earlier(left: string, right: string): string {
  return left <= right ? left : right;
}
