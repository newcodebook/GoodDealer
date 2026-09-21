import { z } from "zod";

import { base64Url, canonicalUtcTimestamp, identifier } from "../wire/index";

export const BILLING_SCHEMA_VERSION = 1 as const;
export const BILLING_CHECKOUT_CREATE_OPERATION_ID = "account.billing.checkout.create" as const;
export const BILLING_STATUS_READ_OPERATION_ID = "account.billing.status.read" as const;
export const BILLING_SUBSCRIPTION_CANCEL_OPERATION_ID = "account.billing.subscription.cancel" as const;
export const BILLING_FIXED_TERM_CONFIRM_OPERATION_ID = "account.billing.fixedTerm.confirm" as const;
export const BILLING_FIRST_PURCHASE_REFUND_REQUEST_OPERATION_ID =
  "account.billing.firstPurchaseRefund.request" as const;
export const BILLING_FIRST_PURCHASE_REFUND_STATUS_READ_OPERATION_ID =
  "account.billing.firstPurchaseRefund.status.read" as const;

export const billingProviderSchema = z.enum(["stripe", "paypal"]);
export const commercialOfferSchema = z.enum(["monthly", "annual", "ten_year"]);
const billingRequestIdSchema = z.string().min(1).max(80).regex(/^[A-Za-z0-9_-]+$/u);
const campaignCodeSchema = z.string().min(1).max(64).regex(/^[A-Z0-9_-]+$/u);

export const billingApprovalSchema = z.object({
  kind: z.literal("gooddealer_redirect"),
  handle: base64Url.length(43),
  expiresAt: canonicalUtcTimestamp,
}).strict();

export const billingCheckoutCreateRequestSchema = z
  .object({
    schemaVersion: z.literal(BILLING_SCHEMA_VERSION),
    requestId: billingRequestIdSchema,
    provider: billingProviderSchema,
    offer: commercialOfferSchema,
    campaignCode: campaignCodeSchema.nullable(),
  })
  .strict();

export const billingCheckoutCreateResponseSchema = z
  .object({
    schemaVersion: z.literal(BILLING_SCHEMA_VERSION),
    requestId: billingRequestIdSchema,
    checkoutId: identifier,
    provider: billingProviderSchema,
    offer: commercialOfferSchema,
    approval: billingApprovalSchema,
  })
  .strict();

export const billingStatusReadRequestSchema = z.object({}).strict();

const billingStatusIdentitySchema = z.object({
  schemaVersion: z.literal(BILLING_SCHEMA_VERSION),
  provider: billingProviderSchema,
  offer: commercialOfferSchema,
});

const billingRecoverableCheckoutStatusSchema = billingStatusIdentitySchema.extend({
  checkoutId: identifier,
  requestId: billingRequestIdSchema,
  campaignCode: campaignCodeSchema.nullable(),
  retryMode: z.literal("same_request"),
  paidThrough: z.null(),
  refundEligibleUntil: z.null(),
});

const billingSubscriptionStatusSchema = billingStatusIdentitySchema.extend({
  /** Opaque GoodDealer purchase identity used to correlate a first-purchase refund. */
  purchaseId: identifier,
  paidThrough: canonicalUtcTimestamp,
  refundEligibleUntil: canonicalUtcTimestamp.nullable(),
});

const billingCancellationStatusSchema = billingSubscriptionStatusSchema.extend({
  requestId: billingRequestIdSchema,
});

export const billingStatusReadResponseSchema = z.discriminatedUnion("state", [
  z.object({
    schemaVersion: z.literal(BILLING_SCHEMA_VERSION),
    state: z.literal("none"),
    provider: z.null(),
    offer: z.null(),
    paidThrough: z.null(),
    refundEligibleUntil: z.null(),
  }).strict(),
  billingRecoverableCheckoutStatusSchema.extend({
    state: z.literal("creation_unknown"),
  }).strict(),
  billingRecoverableCheckoutStatusSchema.extend({
    state: z.literal("approval_pending"),
  }).strict(),
  billingSubscriptionStatusSchema.extend({
    state: z.literal("active"),
  }).strict(),
  billingCancellationStatusSchema.extend({
    state: z.literal("cancellation_pending"),
  }).strict(),
  billingCancellationStatusSchema.extend({
    state: z.literal("cancellation_unknown"),
  }).strict(),
  billingCancellationStatusSchema.extend({
    state: z.literal("cancel_at_period_end"),
  }).strict(),
  billingStatusIdentitySchema.extend({
    state: z.literal("commercial_read_only"),
    paidThrough: canonicalUtcTimestamp.nullable(),
    refundEligibleUntil: z.null(),
  }).strict(),
]);

export const billingSubscriptionCancelRequestSchema = z
  .object({
    schemaVersion: z.literal(BILLING_SCHEMA_VERSION),
    requestId: billingRequestIdSchema,
  })
  .strict();

const billingSubscriptionCancelResultSchema = z.object({
  schemaVersion: z.literal(BILLING_SCHEMA_VERSION),
  requestId: billingRequestIdSchema,
  paidThrough: canonicalUtcTimestamp,
});

export const billingSubscriptionCancelResponseSchema = z.discriminatedUnion("state", [
  billingSubscriptionCancelResultSchema.extend({
    state: z.literal("cancellation_pending"),
  }).strict(),
  billingSubscriptionCancelResultSchema.extend({
    state: z.literal("cancellation_unknown"),
  }).strict(),
  billingSubscriptionCancelResultSchema.extend({
    state: z.literal("cancel_at_period_end"),
  }).strict(),
]);

export const billingFixedTermConfirmRequestSchema = z
  .object({
    schemaVersion: z.literal(BILLING_SCHEMA_VERSION),
    requestId: billingRequestIdSchema,
    checkoutId: identifier,
  })
  .strict();

export const billingFixedTermConfirmResponseSchema = z
  .object({
    schemaVersion: z.literal(BILLING_SCHEMA_VERSION),
    state: z.literal("processing"),
    requestId: billingRequestIdSchema,
    checkoutId: identifier,
  })
  .strict();

export const billingFirstPurchaseRefundRequestSchema = z
  .object({
    schemaVersion: z.literal(BILLING_SCHEMA_VERSION),
    requestId: billingRequestIdSchema,
    purchaseId: identifier,
  })
  .strict();

export const billingFirstPurchaseRefundStatusReadRequestSchema = z
  .object({
    schemaVersion: z.literal(BILLING_SCHEMA_VERSION),
    refundRequestId: identifier,
  })
  .strict();

export const billingFirstPurchaseRefundRejectionReasonSchema = z.enum([
  "not_first_paid_purchase",
  "window_elapsed",
  "not_paid",
  "already_claimed",
  "already_fully_reversed",
  "purchase_mismatch",
]);

const billingRefundAcceptedIdentitySchema = z.object({
  schemaVersion: z.literal(BILLING_SCHEMA_VERSION),
  refundRequestId: identifier,
  purchaseId: identifier,
  commercialAccess: z.literal("read_only"),
  requestedAmount: z.object({
    minor: z.number().int().safe().positive(),
    currency: z.literal("USD"),
  }).strict(),
});

const billingRefundAcceptedUnscheduledSchema = billingRefundAcceptedIdentitySchema.extend({
  retryable: z.literal(false),
  retryAfter: z.null(),
});

export const billingFirstPurchaseRefundAcceptedResponseSchema = z.discriminatedUnion("state", [
  billingRefundAcceptedUnscheduledSchema.extend({ state: z.literal("termination_pending") }).strict(),
  billingRefundAcceptedUnscheduledSchema.extend({ state: z.literal("termination_unknown") }).strict(),
  billingRefundAcceptedUnscheduledSchema.extend({ state: z.literal("refund_pending") }).strict(),
  billingRefundAcceptedUnscheduledSchema.extend({ state: z.literal("refund_unknown") }).strict(),
  billingRefundAcceptedIdentitySchema.extend({
    state: z.literal("retry_wait"),
    retryable: z.literal(true),
    retryAfter: canonicalUtcTimestamp,
  }).strict(),
  billingRefundAcceptedUnscheduledSchema.extend({ state: z.literal("manual_resolution") }).strict(),
  billingRefundAcceptedUnscheduledSchema.extend({
    state: z.literal("refunded"),
    retryable: z.literal(false),
    retryAfter: z.null(),
    completedAt: canonicalUtcTimestamp,
  }).strict(),
]);

export const billingFirstPurchaseRefundRequestResponseSchema = z.union([
  billingFirstPurchaseRefundAcceptedResponseSchema,
  z.object({
    schemaVersion: z.literal(BILLING_SCHEMA_VERSION),
    state: z.literal("rejected"),
    reason: billingFirstPurchaseRefundRejectionReasonSchema,
  }).strict(),
]);

export const billingFirstPurchaseRefundStatusReadResponseSchema =
  billingFirstPurchaseRefundAcceptedResponseSchema;

export type BillingProvider = z.infer<typeof billingProviderSchema>;
export type CommercialOffer = z.infer<typeof commercialOfferSchema>;
export type BillingApproval = z.infer<typeof billingApprovalSchema>;
export type BillingCheckoutCreateRequest = z.infer<typeof billingCheckoutCreateRequestSchema>;
export type BillingCheckoutCreateResponse = z.infer<typeof billingCheckoutCreateResponseSchema>;
export type BillingStatusReadResponse = z.infer<typeof billingStatusReadResponseSchema>;
export type BillingSubscriptionCancelRequest = z.infer<typeof billingSubscriptionCancelRequestSchema>;
export type BillingSubscriptionCancelResponse = z.infer<typeof billingSubscriptionCancelResponseSchema>;
export type BillingFixedTermConfirmRequest = z.infer<typeof billingFixedTermConfirmRequestSchema>;
export type BillingFixedTermConfirmResponse = z.infer<typeof billingFixedTermConfirmResponseSchema>;
export type BillingFirstPurchaseRefundRequest = z.infer<typeof billingFirstPurchaseRefundRequestSchema>;
export type BillingFirstPurchaseRefundStatusReadRequest = z.infer<
  typeof billingFirstPurchaseRefundStatusReadRequestSchema
>;
export type BillingFirstPurchaseRefundRejectionReason = z.infer<
  typeof billingFirstPurchaseRefundRejectionReasonSchema
>;
export type BillingFirstPurchaseRefundAcceptedResponse = z.infer<
  typeof billingFirstPurchaseRefundAcceptedResponseSchema
>;
export type BillingFirstPurchaseRefundRequestResponse = z.infer<
  typeof billingFirstPurchaseRefundRequestResponseSchema
>;
export type BillingFirstPurchaseRefundStatusReadResponse = z.infer<
  typeof billingFirstPurchaseRefundStatusReadResponseSchema
>;
