import {
  CommercialCheckoutCatalog,
  CommercialSubscriptionPlanCatalog,
  PayPalCommercialCheckoutGateway,
  PayPalCommercialProviderReader,
  PayPalPaymentWebhookAdapter,
  StripeCommercialCheckoutGateway,
  StripeCommercialProviderReader,
  StripePaymentWebhookAdapter,
  createPayPalCommercialSdk,
  createStripeSdk,
  type CommercialCheckoutDefinition,
  type CommercialCheckoutGateway,
  type CommercialReturnUrls,
  type CommercialProviderReader,
  type FixedTermEntitlementPolicy,
  type PayPalSdkConfiguration,
  type PaymentWebhookAuthenticator,
  type SubscriptionPlanDefinition,
} from "../modules/licensing/index";
import { createPayPalCertificateResolver } from "./payment-webhook-http";

export interface StripeTestProviderConfiguration {
  readonly apiKey: string;
  readonly webhookSecret: string;
  readonly monthlyPriceId: string;
  readonly annualPriceId: string;
  readonly tenYearPriceId: string;
  readonly campaign: {
    readonly code: string;
    readonly couponId: string;
    readonly monthlyAmountMinor: number;
    readonly annualAmountMinor: number;
    readonly tenYearAmountMinor: number;
  } | null;
  readonly returnUrls: CommercialReturnUrls;
  readonly policy: {
    readonly subscriptionPlan: string;
    readonly fixedTermPlan: string;
    readonly featureEntitlements: readonly string[];
    readonly offlineGraceSeconds: number;
    readonly credentialRefreshSeconds: number;
  };
}

export interface CommercialProviderConfiguration {
  readonly stripe: {
    readonly apiKey: string;
    readonly webhookSecret: string;
  };
  readonly paypal?: PayPalSdkConfiguration & {
    readonly webhookId: string;
  };
  readonly returnUrls: CommercialReturnUrls;
  readonly checkouts: readonly CommercialCheckoutDefinition[];
  readonly subscriptionPlans: readonly SubscriptionPlanDefinition[];
  readonly fixedTermPolicy: FixedTermEntitlementPolicy;
}

export interface CommercialProviderComposition {
  readonly checkoutCatalog: CommercialCheckoutCatalog;
  readonly checkoutGateways: readonly CommercialCheckoutGateway[];
  readonly stripeWebhook: PaymentWebhookAuthenticator;
  readonly paypalWebhook: PaymentWebhookAuthenticator;
  readonly providerReaders: readonly CommercialProviderReader[];
}

/**
 * Production composition receives secrets from the deployment secret manager and provider object
 * ids from environment-qualified configuration. It never reads process.env or persists them.
 */
export function createCommercialProviderComposition(
  config: CommercialProviderConfiguration,
): CommercialProviderComposition {
  if (config.paypal === undefined && (
    config.checkouts.some((definition) => definition.provider === "paypal")
    || config.subscriptionPlans.some((definition) => definition.provider === "paypal")
  )) {
    throw new TypeError("PayPal catalog entries require configured PayPal credentials");
  }
  const checkoutCatalog = new CommercialCheckoutCatalog(config.checkouts);
  const subscriptionPlans = new CommercialSubscriptionPlanCatalog(config.subscriptionPlans);
  checkoutCatalog.assertSubscriptionPlans(subscriptionPlans);
  const stripe = createStripeSdk(config.stripe.apiKey);
  const paypal = config.paypal === undefined ? null : createPayPalCommercialSdk(config.paypal);
  return {
    checkoutCatalog,
    checkoutGateways: [
      new StripeCommercialCheckoutGateway(stripe, config.returnUrls),
      paypal === null || config.paypal === undefined
        ? unavailableGateway("paypal")
        : new PayPalCommercialCheckoutGateway(paypal, config.returnUrls, config.paypal.environment),
    ],
    stripeWebhook: new StripePaymentWebhookAdapter({
      sdk: stripe,
      webhookSecret: config.stripe.webhookSecret,
    }),
    paypalWebhook: paypal === null || config.paypal === undefined
      ? unavailableWebhook
      : new PayPalPaymentWebhookAdapter({
        certificates: createPayPalCertificateResolver(config.paypal.environment),
        webhookId: config.paypal.webhookId,
      }),
    providerReaders: [
      new StripeCommercialProviderReader({ sdk: stripe, plans: subscriptionPlans, fixedTermPolicy: config.fixedTermPolicy }),
      paypal === null
        ? unavailableReader
        : new PayPalCommercialProviderReader({
          subscriptions: paypal.subscriptions,
          orders: paypal.orders,
          payments: paypal.payments,
          plans: subscriptionPlans,
          fixedTermPolicy: config.fixedTermPolicy,
        }),
    ],
  };
}

/**
 * Development/test composition for bringing Stripe online without inventing PayPal credentials.
 * The launch catalog contains Stripe only; every optional PayPal boundary remains closed.
 */
export function createStripeTestProviderComposition(
  config: StripeTestProviderConfiguration,
): CommercialProviderComposition {
  const checkouts: CommercialCheckoutDefinition[] = [
    checkout("monthly", config.monthlyPriceId, 980),
    checkout("annual", config.annualPriceId, 9_800),
    checkout("ten_year", config.tenYearPriceId, 49_800),
  ];
  if (config.campaign !== null) {
    checkouts.push(
      checkout("monthly", config.monthlyPriceId, config.campaign.monthlyAmountMinor,
        config.campaign.code, config.campaign.couponId),
      checkout("annual", config.annualPriceId, config.campaign.annualAmountMinor,
        config.campaign.code, config.campaign.couponId),
      checkout("ten_year", config.tenYearPriceId, config.campaign.tenYearAmountMinor,
        config.campaign.code, config.campaign.couponId),
    );
  }
  const subscriptionPlans: SubscriptionPlanDefinition[] = [config.monthlyPriceId, config.annualPriceId]
    .map((providerPlanId) => ({
      provider: "stripe" as const,
      providerPlanId,
      plan: config.policy.subscriptionPlan,
      featureEntitlements: config.policy.featureEntitlements,
      offlineGraceSeconds: config.policy.offlineGraceSeconds,
      credentialRefreshSeconds: config.policy.credentialRefreshSeconds,
    }));
  const checkoutCatalog = new CommercialCheckoutCatalog(checkouts);
  const planCatalog = new CommercialSubscriptionPlanCatalog(subscriptionPlans);
  checkoutCatalog.assertSubscriptionPlans(planCatalog);
  const stripe = createStripeSdk(config.apiKey);
  return {
    checkoutCatalog,
    checkoutGateways: [
      new StripeCommercialCheckoutGateway(stripe, config.returnUrls),
      unavailableGateway("paypal"),
    ],
    stripeWebhook: new StripePaymentWebhookAdapter({
      sdk: stripe,
      webhookSecret: config.webhookSecret,
    }),
    paypalWebhook: unavailableWebhook,
    providerReaders: [
      new StripeCommercialProviderReader({
        sdk: stripe,
        plans: planCatalog,
        fixedTermPolicy: {
          plan: config.policy.fixedTermPlan,
          featureEntitlements: config.policy.featureEntitlements,
          offlineGraceSeconds: config.policy.offlineGraceSeconds,
          credentialRefreshSeconds: config.policy.credentialRefreshSeconds,
        },
      }),
      unavailableReader,
    ],
  };
}

function checkout(
  offer: CommercialCheckoutDefinition["offer"],
  providerItemId: string,
  amountMinor: number,
  campaignCode: string | null = null,
  providerDiscountId: string | null = null,
): CommercialCheckoutDefinition {
  return {
    provider: "stripe",
    offer,
    campaignCode,
    providerItemId,
    providerDiscountId,
    currency: "USD",
    amountMinor,
  };
}

function unavailableGateway(provider: "paypal"): CommercialCheckoutGateway {
  const unavailable = async (): Promise<never> => {
    throw new TypeError(`${provider} is not configured`);
  };
  return {
    provider,
    create: unavailable,
    cancelSubscription: unavailable,
    captureFixedTerm: unavailable,
    recover: unavailable,
    readApprovalUrl: unavailable,
  };
}

const unavailableWebhook: PaymentWebhookAuthenticator = {
  async authenticate(): Promise<never> {
    throw new TypeError("PayPal webhook is not configured");
  },
};

const unavailableReader: CommercialProviderReader = {
  provider: "paypal",
  async read(): Promise<never> {
    throw new TypeError("PayPal provider reader is not configured");
  },
};
