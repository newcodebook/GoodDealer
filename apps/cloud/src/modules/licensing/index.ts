import {
  ACCOUNT_REJECTION_SCHEMA_VERSION,
  ENTITLEMENT_PROJECTION_SCHEMA_VERSION,
  accountRejectionSchema,
  entitlementProjectionSchema,
  type AccountRejection,
  type EntitlementProjection,
  type EntitlementState,
} from "@gooddealer/protocol/account";

export {
  CommercialCheckoutApplicationService,
  CommercialCheckoutCatalog,
  CommercialCheckoutCreationRejectedError,
  CommercialCheckoutCreationUnknownError,
  CommercialCheckoutUnavailableError,
  CommercialPurchaseConflictError,
  CommercialSubscriptionCancellationUnknownError,
} from "./commercial-checkout";
export type {
  CommercialCheckoutApplicationPort,
  CommercialCheckoutDefinition,
  CommercialPurchaseKind,
  CommercialPurchaseState,
  FixedTermEntitlementPolicy,
  ResolvedCommercialCheckout,
} from "./commercial-checkout";
export {
  PostgresEntitlementDeadlineReader,
  authoritativeEntitlementSnapshotSchema,
} from "./postgres-repository";
export type { AuthoritativeEntitlementSnapshot } from "./postgres-repository";
export { PostgresCommercialAggregateRepository } from "./postgres-commercial-repository";
export type {
  ApplyAgreementObservationCommand,
  ApplyAgreementObservationResult,
  ApprovalRedirectHandle,
  AuthenticatedProviderReceipt,
  BoundCommercialWork,
  BoundDueAuthorityWork,
  BoundProviderOperationWork,
  BoundReceiptWork,
  BoundReconciliationWork,
  BoundReleaseWork,
  CancellationPlan,
  ClaimedApprovalRedirect,
  CommercialAccountRepositoryPort,
  CommercialAggregateRepositoryPort,
  CommercialBillingStatus,
  CommercialFailureClass,
  CommercialIngressRepositoryPort,
  CommercialJobKind,
  CommercialJobState,
  CommercialOffer,
  CommercialOperationPlan,
  CommercialProvider,
  CommercialWorkerRepositoryPort,
  ConfirmFixedTermCaptureCommand,
  ConsumedProviderDispatch,
  FixedTermCapturePlan,
  HandoffProviderAgreementCommand,
  HandoffProviderAgreementResult,
  NormalizedAgreementObservation,
  ProviderAgreementHandoff,
  ProviderAgreementHandoffWork,
  ProviderDispatchPermit,
  ProviderOperationKind,
  ProviderOperationReplay,
  ProviderOperationState,
  ProviderReceiptDisposition,
  ProviderResourceFact,
  RecordProviderOperationResultCommand,
  RequestCancellationCommand,
  ReservePurchaseCommand,
} from "./commercial-domain";
export { ProviderDispatchExecutor, ProviderDispatchOutcomeUnknownError, ProviderDispatchRejectedError,
  ProviderOperationRecoveryService,
  consumeProviderSdkAuthorization } from "./provider-dispatch-executor";
export type { CommercialCheckoutGateway, CommercialProviderMutationGateway, ProviderDispatchExecution,
  ProviderMutationResult, ProviderOperationWorkResult, ProviderSdkAuthorization } from "./provider-dispatch-executor";
export {
  CommercialSubscriptionPlanCatalog,
  canonicalSecond,
} from "./commercial-plan-catalog";
export type {
  PaymentProvider,
  ProviderEventEvidence,
  ReconciledSubscription,
  SubscriptionPlanDefinition,
} from "./commercial-plan-catalog";
export {
  PaymentWebhookApplicationService,
  PaymentWebhookAuthenticationError,
  PaymentWebhookConflictError,
  PaymentWebhookReconciliationService,
} from "./payment-webhook-service";
export type {
  AuthenticatedProviderEvent,
  CommercialProviderReader,
  PaymentWebhookApplicationPort,
  PaymentWebhookAuthenticator,
  ProviderInboxWorkResult,
  ProviderReconciliationWorkResult,
  ReconciledCommercialObservation,
} from "./payment-webhook-service";
export {
  createStripeSdk,
  StripeCommercialProviderReader,
  StripePaymentWebhookAdapter,
} from "./providers/stripe";
export {
  PayPalCommercialCheckoutGateway,
  StripeCommercialCheckoutGateway,
} from "./providers/commercial-checkout";
export type {
  CommercialReturnUrls,
  PayPalCommercialSdk,
} from "./providers/commercial-checkout";
export {
  createPayPalCommercialSdk,
  createPayPalSubscriptionReader,
  PayPalCommercialProviderReader,
  PayPalPaymentWebhookAdapter,
} from "./providers/paypal";
export type {
  PayPalCertificateResolver,
  PayPalCaptureReader,
  PayPalPaymentAdapterDependencies,
  PayPalOrderReader,
  PayPalSdkConfiguration,
  PayPalSubscriptionReader,
} from "./providers/paypal";
export type {
  FixedTermCommercialPolicy,
  StripeCommercialReaderDependencies,
  StripeWebhookAuthenticatorDependencies,
} from "./providers/stripe";

export interface AccountEntitlementFixture {
  readonly state: EntitlementState;
  readonly licenseId: string;
  readonly plan: string;
  readonly entitlementKind: "subscription" | "fixed_term";
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
      versionEntitlement: { kind: "subscription_supported" },
      evaluatedAt,
    });
  }
}
