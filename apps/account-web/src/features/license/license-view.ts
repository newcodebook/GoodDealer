import type { AccountCopy } from "@gooddealer/i18n";
import type {
  BillingFirstPurchaseRefundAcceptedResponse,
  BillingFirstPurchaseRefundRejectionReason,
  BillingProvider,
  BillingStatusReadResponse,
  CommercialOffer,
} from "@gooddealer/protocol/account";

import { refundablePurchase, type RefundEligibility } from "../../billing-refund-presentation";

type LicenseCopy = AccountCopy["accountLicense"];

/** Presentation phases of the Cloud billing state; several wire states share one phase. */
export type LicensePhase = "none" | "checkout_pending" | "active" | "cancelling" | "ending" | "read_only";

export interface LicenseView {
  readonly phase: LicensePhase;
  readonly provider: BillingProvider | null;
  /**
   * The term paid access is currently held under. Only active, cancelling, and ending phases hold a
   * term: a pending checkout has not paid yet, and read-only access no longer grants the term.
   */
  readonly currentOffer: CommercialOffer | null;
  /** Paid-through of the held term; null whenever `currentOffer` is null. */
  readonly paidThrough: string | null;
  /** Whole days until `paidThrough`, never negative; null when no term is held. */
  readonly daysRemaining: number | null;
  /** Only an account with no provider slot may start a checkout; Cloud enforces the same rule. */
  readonly canCheckout: boolean;
  /** Fixed terms never renew, so only an active monthly or annual subscription can be cancelled. */
  readonly canCancel: boolean;
  readonly refund: RefundEligibility | null;
  /** A refund request whose outcome is not known yet may already be accepted, so actions stay closed. */
  readonly refundOutcomePending: boolean;
}

const dayMs = 86_400_000;

/**
 * Projects the billing status and the local refund state into what the page may show and offer.
 * An accepted refund switches commercial access to read-only at once, so it overrides a billing
 * status that has not caught up yet; an unknown refund outcome fails closed the same way for actions.
 */
export function licenseView(
  status: BillingStatusReadResponse,
  evaluatedAtMs: number,
  refund: LicenseRefundState["kind"] = "none",
): LicenseView {
  const phase = refund === "progress" ? "read_only" : licensePhase(status);
  const holdsTerm = phase === "active" || phase === "cancelling" || phase === "ending";
  const refundOutcomePending = refund === "submitting" || refund === "unconfirmed";
  const paidThrough = holdsTerm ? status.paidThrough : null;
  return {
    phase,
    provider: status.provider,
    currentOffer: holdsTerm ? status.offer : null,
    paidThrough,
    daysRemaining: paidThrough === null
      ? null
      : Math.max(0, Math.ceil((Date.parse(paidThrough) - evaluatedAtMs) / dayMs)),
    canCheckout: phase === "none" && !refundOutcomePending,
    canCancel: phase === "active" && status.offer !== "ten_year" && !refundOutcomePending,
    refund: refund === "none" ? refundablePurchase(status, evaluatedAtMs) : null,
    refundOutcomePending,
  };
}

function licensePhase(status: BillingStatusReadResponse): LicensePhase {
  switch (status.state) {
    case "none": return "none";
    case "creation_unknown":
    case "approval_pending": return "checkout_pending";
    case "active": return "active";
    case "cancellation_pending":
    case "cancellation_unknown": return "cancelling";
    case "cancel_at_period_end": return "ending";
    case "commercial_read_only": return "read_only";
  }
}

export const licensePhaseCopyKey = {
  none: "stateNone",
  checkout_pending: "stateCheckoutPending",
  active: "stateActive",
  cancelling: "stateCancelling",
  ending: "stateEnding",
  read_only: "stateReadOnly",
} as const satisfies Record<LicensePhase, keyof LicenseCopy>;

export const providerCopyKey = {
  stripe: "providerStripe",
  paypal: "providerPaypal",
} as const satisfies Record<BillingProvider, keyof LicenseCopy>;

export const offerCopyKey = {
  monthly: "offerMonthly",
  annual: "offerAnnual",
  ten_year: "offerTenYear",
} as const satisfies Record<CommercialOffer, keyof LicenseCopy>;

export const offerUnitCopyKey = {
  monthly: "unitMonthly",
  annual: "unitAnnual",
  ten_year: "unitTenYear",
} as const satisfies Record<CommercialOffer, keyof LicenseCopy>;

/**
 * Published USD list prices of the single feature tier (docs/LICENSING.md). They are display copy
 * only: the Stripe-hosted checkout shows the authoritative amount, taxes, and any promo discount.
 */
export const offerListPrice = {
  monthly: 9.8,
  annual: 98,
  ten_year: 498,
} as const satisfies Record<CommercialOffer, number>;

export const commercialOffers = ["monthly", "annual", "ten_year"] as const satisfies readonly CommercialOffer[];

/** What the refund panel shows once Cloud has answered (or failed to answer) a refund request. */
export type LicenseRefundState =
  | { readonly kind: "none" }
  | { readonly kind: "submitting" }
  | { readonly kind: "progress"; readonly response: BillingFirstPurchaseRefundAcceptedResponse }
  | { readonly kind: "rejected"; readonly reason: BillingFirstPurchaseRefundRejectionReason }
  | { readonly kind: "unconfirmed" };

export interface RefundProgressView {
  readonly messageKey: keyof LicenseCopy;
  /** `retry_wait` carries the earliest retry time; the message interpolates it. */
  readonly retryAfter: string | null;
  readonly canRetry: boolean;
}

/**
 * Temporary duplicate of `src/billing-refund-presentation.ts` `refundProgressPresentation`, which
 * still serves the vanilla production page with fixed Chinese text. Remove that function when the
 * production entry is ported to these React screens.
 *
 * Every accepted refund state keeps commercial access read-only; only `refunded` means the money
 * moved, and only an elapsed `retry_wait` re-enables the same request.
 */
export function refundProgressView(
  response: BillingFirstPurchaseRefundAcceptedResponse,
  evaluatedAtMs: number,
): RefundProgressView {
  switch (response.state) {
    case "refunded": return { messageKey: "refundDone", retryAfter: null, canRetry: false };
    case "manual_resolution": return { messageKey: "refundManual", retryAfter: null, canRetry: false };
    case "retry_wait": return {
      messageKey: "refundRetryWait",
      retryAfter: response.retryAfter,
      canRetry: Date.parse(response.retryAfter) <= evaluatedAtMs,
    };
    case "termination_pending":
    case "termination_unknown": return { messageKey: "refundTerminating", retryAfter: null, canRetry: false };
    case "refund_pending":
    case "refund_unknown": return { messageKey: "refundPending", retryAfter: null, canRetry: false };
  }
}

export const refundRejectionCopyKey = {
  not_first_paid_purchase: "rejectNotFirstPaidPurchase",
  window_elapsed: "rejectWindowElapsed",
  not_paid: "rejectNotPaid",
  already_claimed: "rejectAlreadyClaimed",
  already_fully_reversed: "rejectAlreadyFullyReversed",
  purchase_mismatch: "rejectPurchaseMismatch",
} as const satisfies Record<BillingFirstPurchaseRefundRejectionReason, keyof LicenseCopy>;
