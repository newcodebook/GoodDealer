import type { AccountTransaction, DatabaseQuery } from "../../db/index";

export type CommercialProvider = "stripe" | "paypal";
export type CommercialPurchaseKind = "subscription" | "fixed_term";
export type CommercialOffer = "monthly" | "annual" | "ten_year";
export type ProviderOperationKind = "subscription_create" | "fixed_term_checkout_create"
  | "fixed_term_order_create" | "fixed_term_order_capture" | "subscription_cancel"
  | "subscription_refund_terminate" | "first_purchase_refund";
export type ProviderOperationState = "planned" | "permit_issued" | "dispatch_consumed"
  | "confirmed" | "rejected" | "outcome_unknown" | "manual_resolution";
export type CommercialJobKind = "provider_operation" | "receipt" | "reconciliation" | "due_authority" | "release";
export type CommercialJobState = "ready" | "leased" | "retry_wait" | "succeeded"
  | "ignored" | "quarantined" | "dead_letter";
export type CommercialFailureClass = "transient_network" | "provider_rate_limited"
  | "provider_unavailable" | "identity_conflict" | "digest_conflict"
  | "unsupported_state" | "manual_resolution";

/** Raw tokens are returned once by the database and must never enter JSON, logs, or persistence. */
export interface BoundCommercialWork {
  readonly workId: string;
  readonly kind: CommercialJobKind;
  readonly leaseEpoch: number;
  readonly leaseExpiresAt: string;
  readonly rawToken: Uint8Array;
}

export interface BoundProviderOperationWork extends BoundCommercialWork {
  readonly kind: "provider_operation";
  readonly purchaseAttemptId: string;
  readonly purchaseKind: CommercialPurchaseKind;
  readonly offer: CommercialOffer;
  readonly providerCatalogItem: string;
  readonly campaignCode: string | null;
  readonly expectedGrossMinor?: number;
  readonly expectedCurrency?: "USD";
  readonly provider: CommercialProvider;
  readonly providerOperationId: string;
  readonly operationRevision: number;
  readonly operationKind: ProviderOperationKind;
  readonly providerIdempotencyKey: string;
  readonly requestDigest: Uint8Array;
  readonly providerResourceKind: string | null;
  readonly providerResourceId: string | null;
}

export interface BoundReceiptWork extends BoundCommercialWork {
  readonly kind: "receipt";
  readonly provider: CommercialProvider;
  readonly providerEventId: string;
  readonly payloadDigest: Uint8Array;
  readonly eventType: string;
  readonly receiptKind: "actionable";
  readonly triggerResourceKind: string;
  readonly triggerResourceId: string;
  readonly occurredAt: string;
  readonly authenticatedEvidenceRef: string;
}

export interface BoundReconciliationWork extends BoundCommercialWork {
  readonly kind: "reconciliation";
  readonly requestedGeneration: number;
  readonly provider: CommercialProvider;
  readonly providerResourceKind: string;
  readonly providerResourceId: string;
  readonly purchaseKind: CommercialPurchaseKind;
  readonly expectedBindingDigest: Uint8Array;
  readonly expectedSlotEpoch: number;
  readonly expectedAgreementRevision: number;
  readonly expectedAuthorityRevision: number;
  readonly receiptEventType: string | null;
  readonly receiptProviderEventId: string | null;
  readonly receiptTriggerResourceKind: string | null;
  readonly receiptTriggerResourceId: string | null;
}

export interface BoundDueAuthorityWork extends BoundCommercialWork {
  readonly kind: "due_authority";
  readonly expectedSlotEpoch: number;
  readonly expectedAgreementRevision: number;
  readonly expectedAuthorityRevision: number;
  readonly expectedRightId: string;
}
export interface BoundReleaseWork extends BoundCommercialWork { readonly kind: "release"; }
export interface RedrivenProviderOperationWork extends BoundProviderOperationWork { readonly parentWorkId: string; }
export interface RedrivenCommercialWork extends BoundCommercialWork { readonly parentJobId: string; }

export interface CommercialOperationPlan {
  readonly purchaseAttemptId: string;
  readonly slotOwnershipId: string;
  readonly slotEpoch: number;
  readonly provider: CommercialProvider;
  readonly providerOperationId: string;
  readonly operationRevision: number;
  readonly operationKind: ProviderOperationKind;
  readonly providerIdempotencyKey: string;
  readonly requestDigest: Uint8Array;
  readonly replay: "created" | "same_request";
  readonly work: BoundProviderOperationWork;
}

export interface ReservePurchaseCommand {
  readonly requestId: string;
  readonly provider: CommercialProvider;
  readonly purchaseKind: CommercialPurchaseKind;
  readonly offer: CommercialOffer;
  readonly providerCatalogItem: string;
  readonly campaignCode: string | null;
  readonly expectedGrossMinor: number;
  readonly expectedCurrency: "USD";
  readonly requestDigest: Uint8Array;
}

export interface RequestCancellationCommand {
  readonly requestId: string;
  readonly expectedAgreementId: string;
  readonly requestDigest: Uint8Array;
}

export interface ConfirmFixedTermCaptureCommand {
  readonly requestId: string;
  readonly expectedOrderOperationId: string;
  readonly requestDigest: Uint8Array;
}
export interface RequestFirstPurchaseRefundCommand {
  readonly requestId: string;
  readonly expectedPurchaseAttemptId: string;
  readonly requestDigest: Uint8Array;
}
export type FirstPurchaseRefundState = "termination_pending" | "termination_unknown" | "refund_pending"
  | "refund_unknown" | "refunded" | "retry_wait" | "manual_resolution";
export interface FirstPurchaseRefundAcceptance {
  readonly refundRequestId: string;
  readonly state: FirstPurchaseRefundState;
  readonly acceptedAt: string;
  readonly remainingMinorAtAcceptance: number;
  readonly expectedPurchaseAttemptId: string;
  readonly providerAgreementId: string;
  readonly replay: "created" | "same_request";
  /** Refund execution is worker-owned; an account command never receives a work capability. */
  readonly operation: null;
}
export type FirstPurchaseRefundRejectionReason = "not_first_paid_purchase" | "window_elapsed" | "not_paid"
  | "already_claimed" | "already_fully_reversed" | "purchase_mismatch";
export type FirstPurchaseRefundDecision =
  | { readonly disposition: "accepted"; readonly acceptance: FirstPurchaseRefundAcceptance }
  | { readonly disposition: "rejected"; readonly reason: FirstPurchaseRefundRejectionReason };
export interface FirstPurchaseRefundStatus {
  readonly refundRequestId: string;
  readonly expectedPurchaseAttemptId: string;
  readonly state: FirstPurchaseRefundState;
  readonly acceptedAt: string;
  readonly remainingMinorAtAcceptance: number;
  readonly retryAt: string | null;
  readonly completedAt: string | null;
}

export interface CancellationPlan extends CommercialOperationPlan {
  readonly operationKind: "subscription_cancel";
  readonly providerAgreementId: string;
  readonly providerAgreementResourceKind: string;
  readonly providerAgreementResourceId: string;
  readonly protectedPaidThrough: string | null;
  readonly intentRevision: number;
}

export interface FixedTermCapturePlan extends CommercialOperationPlan {
  readonly operationKind: "fixed_term_order_capture";
  readonly providerOrderResourceKind: string;
  readonly providerOrderResourceId: string;
}

export interface CommercialBillingStatus {
  readonly purchaseAttemptId: string;
  /** Internal server correlation only; never included in the public billing schema. */
  readonly providerAgreementId: string | null;
  readonly currentProviderOperationId: string | null;
  readonly requestId: string;
  readonly provider: CommercialProvider;
  readonly offer: CommercialOffer;
  readonly campaignCode: string | null;
  readonly state: "creating" | "creation_unknown" | "approval_pending" | "active" | "grace"
    | "cancellation_pending" | "cancellation_unknown" | "cancel_at_period_end"
    | "commercial_read_only" | "failed" | "refunded";
  readonly paidThrough: string | null;
  readonly refundEligibleUntil: string | null;
}

export interface ApprovalRedirectHandle { readonly handle: Uint8Array; readonly expiresAt: string; }
export interface ClaimedApprovalRedirect {
  readonly claimId: string;
  readonly provider: CommercialProvider;
  readonly providerResourceKind: string;
  readonly providerResourceId: string;
  readonly expectedPurchaseAttemptId: string;
  readonly expectedPurchaseKind: CommercialPurchaseKind;
  readonly expectedOffer: CommercialOffer;
  readonly expectedProviderCatalogItem: string;
  /** Immutable pricing snapshot persisted with the purchase attempt. */
  readonly expectedAmountMinor: number;
  readonly expectedCurrency: "USD";
}

/** Account façades rely on the literal purpose embedded in their database routine. */
export interface CommercialAccountRepositoryPort {
  readBillingStatus(transaction: AccountTransaction): Promise<CommercialBillingStatus | null>;
  reservePurchase(transaction: AccountTransaction, command: ReservePurchaseCommand): Promise<CommercialOperationPlan>;
  requestCancellation(transaction: AccountTransaction, command: RequestCancellationCommand): Promise<CancellationPlan>;
  confirmFixedTermCapture(transaction: AccountTransaction, command: ConfirmFixedTermCaptureCommand): Promise<FixedTermCapturePlan>;
  requestFirstPurchaseRefund(transaction: AccountTransaction,
    command: RequestFirstPurchaseRefundCommand): Promise<FirstPurchaseRefundDecision>;
  readFirstPurchaseRefundStatus(transaction: AccountTransaction,
    expectedRefundRequestId: string): Promise<FirstPurchaseRefundStatus | null>;
  issueApprovalRedirect(transaction: AccountTransaction, expectedHolderId: string): Promise<ApprovalRedirectHandle>;
  claimApprovalRedirect(transaction: AccountTransaction, rawHandle: Uint8Array): Promise<ClaimedApprovalRedirect>;
  completeApprovalRedirect(transaction: AccountTransaction, claimId: string,
    outcome: "consumed" | "expired" | "manual_resolution"): Promise<void>;
}

export interface ProviderDispatchPermit {
  readonly dispatchPermitId: string;
  readonly providerOperationId: string;
  readonly operationRevision: number;
  readonly operationKind: ProviderOperationKind;
  readonly dispatchAttempt: number;
  readonly expiresAt: string;
}
export interface ConsumedProviderDispatch extends ProviderDispatchPermit {
  readonly consumedAt: string;
  readonly provider: CommercialProvider;
  readonly providerIdempotencyKey: string;
}

export interface ProviderResourceFact {
  readonly resourceKind: string;
  readonly resourceId: string;
  readonly bindingDigest: Uint8Array;
  readonly role: "created" | "target" | "canonical_agreement" | "checkout_origin"
    | "order_origin" | "capture_evidence";
}

export interface RecordProviderOperationResultCommand {
  readonly outcome: "confirmed" | "rejected" | "outcome_unknown" | "manual_resolution";
  readonly responseDigest: Uint8Array;
  readonly resources: readonly ProviderResourceFact[];
}
export interface ProviderOperationReplay {
  readonly state: ProviderOperationState;
  readonly responseDigest: Uint8Array | null;
  readonly resources: readonly ProviderResourceFact[];
  readonly disposition: "current" | "stale" | "quarantined";
}

export type ProviderAgreementHandoff =
  | { readonly kind: "stripe_subscription"; readonly checkoutSession: ProviderResourceFact; readonly subscription: ProviderResourceFact }
  | { readonly kind: "paypal_subscription"; readonly subscription: ProviderResourceFact }
  | { readonly kind: "stripe_fixed_term"; readonly checkoutSession: ProviderResourceFact; readonly capturedAt: string }
  | { readonly kind: "paypal_fixed_term"; readonly order: ProviderResourceFact; readonly capture: ProviderResourceFact; readonly capturedAt: string };
export interface HandoffProviderAgreementCommand {
  readonly observationDigest: Uint8Array;
  readonly handoff: ProviderAgreementHandoff;
  readonly paymentResources: readonly InitialPaymentResourceFact[];
}
export interface InitialPaymentResourceFact {
  readonly resourceKind: "invoice" | "payment_intent" | "charge" | "subscription_transaction" | "sale" | "capture";
  readonly resourceId: string;
  readonly bindingDigest: Uint8Array;
}
export interface HandoffProviderAgreementResult {
  readonly providerAgreementId: string;
  readonly slotEpoch: number;
  readonly replay: "created" | "same_handoff";
}
/** Initial checkout completion may be proven by its receipt/reconciliation lease, not only O1. */
export type ProviderAgreementHandoffWork = BoundProviderOperationWork | BoundReceiptWork | BoundReconciliationWork;

export type AuthenticatedProviderReceipt =
  | { readonly kind: "actionable"; readonly provider: CommercialProvider; readonly providerEventId: string;
      readonly payloadDigest: Uint8Array; readonly eventType: string; readonly triggerResourceKind: string;
      readonly triggerResourceId: string; readonly ignoredReason: null; readonly occurredAt: string;
      readonly authenticatedEvidenceRef: string }
  | { readonly kind: "ignored"; readonly provider: CommercialProvider; readonly providerEventId: string;
      readonly payloadDigest: Uint8Array; readonly eventType: string; readonly triggerResourceKind: null;
      readonly triggerResourceId: null; readonly ignoredReason: "unsupported_event" | "unrelated_object" | "test_event";
      readonly occurredAt: string; readonly authenticatedEvidenceRef: string };
export type ProviderReceiptDisposition = "scheduled" | "ignored" | "duplicate" | "conflict" | "quarantined";

export interface NormalizedAgreementObservation {
  readonly providerAccess: "pending" | "active" | "delinquent" | "suspended" | "ended" | "refunded";
  readonly renewalDisposition: "renewing" | "nonrenewing" | "terminated" | "unknown";
  readonly observedPaidThrough: string | null;
  readonly observedAt: string;
  readonly plan: string;
  readonly featureEntitlements: readonly string[];
  readonly reversal: "none" | "refund" | "fraud";
}
export type NormalizedRefundFact = "none" | "refund_pending" | "refund_succeeded" | "refund_failed"
  | "partial_refund" | "dispute_pending" | "full_reversal_settled" | "partial_reversal" | "fraud_signal";
export interface NormalizedPaymentEvidence {
  readonly purpose: "acquisition_initial" | "renewal" | "adjustment";
  readonly resourceKind: "invoice" | "payment_intent" | "charge" | "subscription_transaction" | "sale" | "capture";
  readonly resourceId: string;
  readonly bindingDigest: Uint8Array;
  readonly settledAt: string;
  readonly grossMinor: number;
  readonly currency: "USD";
  readonly cumulativeRefundedMinor: number;
  readonly sourceDigest: Uint8Array;
}
export interface ApplyAgreementObservationCommand {
  readonly observation: NormalizedAgreementObservation;
  readonly observationDigest: Uint8Array;
  readonly paymentEvidence: NormalizedPaymentEvidence | null;
  readonly refundFact: NormalizedRefundFact;
}
export interface ApplyAgreementObservationResult {
  readonly disposition: "applied" | "stale_generation" | "stale_binding" | "stale_slot"
    | "stale_agreement" | "stale_authority" | "conflict";
  readonly authorityRevision: number | null;
  readonly rightId: string | null;
}

export interface SupplementalAgreementResourceFact {
  readonly resourceKind: "invoice" | "payment_intent" | "charge" | "subscription_transaction" | "sale" | "capture" | "refund" | "dispute";
  readonly resourceId: string;
  readonly bindingDigest: Uint8Array;
  readonly linkRole: "capture_evidence" | "initial_payment" | "refund_evidence" | "reversal_evidence";
}
export interface LinkReceiptResourcesCommand {
  readonly anchorResourceKind: string;
  readonly anchorResourceId: string;
  readonly anchorBindingDigest: Uint8Array;
  readonly resources: readonly SupplementalAgreementResourceFact[];
}

export interface CommercialIngressRepositoryPort {
  receiveAuthenticatedReceipt(query: DatabaseQuery, receipt: AuthenticatedProviderReceipt): Promise<ProviderReceiptDisposition>;
}

/** Every mutation derives its target from a current DB-issued work capability. */
export interface CommercialWorkerRepositoryPort {
  leaseProviderOperationWork(query: DatabaseQuery, workerInstanceId: string): Promise<BoundProviderOperationWork | null>;
  redriveDeadLetterOperation(query: DatabaseQuery, workerInstanceId: string,
    auditReason: string): Promise<RedrivenProviderOperationWork | null>;
  redriveDeadLetterJob(query: DatabaseQuery, workerInstanceId: string,
    auditReason: string): Promise<RedrivenCommercialWork | null>;
  issueDispatchPermit(query: DatabaseQuery, work: BoundProviderOperationWork,
    requestedTtlSeconds: number): Promise<ProviderDispatchPermit>;
  consumeDispatchPermit(query: DatabaseQuery, work: BoundProviderOperationWork,
    permit: ProviderDispatchPermit): Promise<ConsumedProviderDispatch>;
  recordOperationResult(query: DatabaseQuery, work: BoundProviderOperationWork,
    permit: ProviderDispatchPermit, command: RecordProviderOperationResultCommand): Promise<ProviderOperationReplay>;
  readOperationReplay(query: DatabaseQuery, work: BoundProviderOperationWork): Promise<ProviderOperationReplay>;
  handoffProviderAgreement(query: DatabaseQuery, work: ProviderAgreementHandoffWork,
    command: HandoffProviderAgreementCommand): Promise<HandoffProviderAgreementResult>;
  leaseReceiptWork(query: DatabaseQuery, workerInstanceId: string): Promise<BoundReceiptWork | null>;
  bindReceiptWork(query: DatabaseQuery, work: BoundReceiptWork): Promise<
    | { readonly disposition: "reconciliation_scheduled"; readonly reconciliationJobId: string;
        readonly requestedGeneration: number }
    | { readonly disposition: "handoff_required"; readonly reconciliationJobId: null;
        readonly requestedGeneration: null }>;
  linkReceiptResourcesToAgreement(query: DatabaseQuery, work: BoundReceiptWork,
    command: LinkReceiptResourcesCommand): Promise<string>;
  leaseReconciliationWork(query: DatabaseQuery, workerInstanceId: string): Promise<BoundReconciliationWork | null>;
  leaseDueAuthorityWork(query: DatabaseQuery, workerInstanceId: string): Promise<BoundDueAuthorityWork | null>;
  leaseReleaseWork(query: DatabaseQuery, workerInstanceId: string): Promise<BoundReleaseWork | null>;
  heartbeatBoundWork(query: DatabaseQuery, work: BoundCommercialWork): Promise<string>;
  failBoundWork(query: DatabaseQuery, work: BoundCommercialWork, failureClass: CommercialFailureClass,
    retryAfterSeconds?: number): Promise<CommercialJobState>;
  applyAgreementObservationAndAuthority(query: DatabaseQuery, work: BoundReconciliationWork,
    command: ApplyAgreementObservationCommand): Promise<ApplyAgreementObservationResult>;
  applyDueAuthority(query: DatabaseQuery, work: BoundDueAuthorityWork): Promise<ApplyAgreementObservationResult>;
  releaseProviderSlot(query: DatabaseQuery, work: BoundReleaseWork): Promise<{
    readonly released: boolean; readonly slotEpoch: number }>;
}

export interface CommercialAggregateRepositoryPort extends CommercialAccountRepositoryPort,
  CommercialIngressRepositoryPort, CommercialWorkerRepositoryPort {}
