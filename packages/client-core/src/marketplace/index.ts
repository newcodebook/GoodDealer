import { z } from "zod";

import {
  commissionQuoteSchema,
  commerceMoneySchema,
  type CommerceMoney,
  type PriceChangePlan,
} from "../pricing/index";

const commerceDomainSchema = z.string().max(253).regex(
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i,
  "domain must be canonical ASCII/Punycode",
);
const commerceDisplayTextSchema = z.string().min(1).max(160).refine(
  (value) => !/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(value),
  "display text cannot contain control or bidirectional override characters",
);

export const marketplaceQuerySourceSchema = z.enum(["active_local", "standby_cloud"]);
export const marketplaceActionSchema = z.enum([
  "create_listing",
  "publish_listing",
  "change_price",
  "pause_listing",
  "resume_listing",
  "delist_listing",
  "accept_offer",
  "counter_offer",
  "decline_offer",
  "push_transfer",
  "confirm_payout",
]);

export const marketplaceFreshnessSchema = z
  .object({
    source: marketplaceQuerySourceSchema,
    serverRevision: z.number().int().nonnegative(),
    lastReplicationActivityAt: z.iso.datetime().nullable(),
    lastSuccessfulProviderObservationAt: z.iso.datetime().nullable(),
  })
  .strict();

export const listingViewSchema = z
  .object({
    id: z.string().min(1).max(160),
    domain: commerceDomainSchema,
    platforms: z.array(commerceDisplayTextSchema.max(80)).max(32),
    bin: commerceMoneySchema,
    views: z.number().int().nonnegative(),
    offerCount: z.number().int().nonnegative(),
    status: z.enum(["active", "paused", "draft", "pending", "conflict", "sold"]),
    listedAtLabel: z.string().min(1).max(80),
  })
  .strict();

export const offerViewSchema = z
  .object({
    id: z.string().min(1).max(160),
    domain: commerceDomainSchema,
    buyerDisplay: commerceDisplayTextSchema,
    offer: commerceMoneySchema,
    bin: commerceMoneySchema,
    counter: commerceMoneySchema.nullable(),
    platform: commerceDisplayTextSchema.max(80),
    state: z.enum(["pending", "countered", "accepted", "declined", "expired"]),
    ageLabel: z.string().min(1).max(80),
    commission: commissionQuoteSchema,
  })
  .strict()
  .superRefine((offer, context) => {
    const currencies = [
      offer.offer.currency,
      offer.bin.currency,
      offer.counter?.currency,
      offer.commission.fee.currency,
      offer.commission.net.currency,
    ].filter((currency): currency is string => currency !== undefined);
    if (new Set(currencies).size !== 1) {
      context.addIssue({ code: "custom", path: ["offer", "currency"], message: "offer values must share one currency" });
    }
  });

export const dealViewSchema = z
  .object({
    id: z.string().min(1).max(160),
    domain: commerceDomainSchema,
    amount: commerceMoneySchema,
    net: commerceMoneySchema,
    platform: commerceDisplayTextSchema.max(80),
    buyerDisplay: commerceDisplayTextSchema,
    stage: z.enum(["escrow", "transfer_pending", "transferred", "paid"]),
  })
  .strict()
  .superRefine((deal, context) => {
    if (deal.amount.currency !== deal.net.currency) {
      context.addIssue({ code: "custom", path: ["net", "currency"], message: "deal values must share one currency" });
    }
  });

export const salesDeskViewModelSchema = z
  .object({
    schemaVersion: z.literal(1),
    workspaceId: z.string().min(1).max(128),
    freshness: marketplaceFreshnessSchema,
    actionGrants: z.array(marketplaceActionSchema).max(32),
    metrics: z.object({
      activeListingCount: z.number().int().nonnegative(),
      listedValue: commerceMoneySchema,
      pendingOfferCount: z.number().int().nonnegative(),
      monthGmv: commerceMoneySchema,
      settlingDealCount: z.number().int().nonnegative(),
    }).strict(),
    listings: z.array(listingViewSchema).max(100_000),
    offers: z.array(offerViewSchema).max(100_000),
    deals: z.array(dealViewSchema).max(100_000),
  })
  .strict()
  .superRefine((view, context) => {
    if (view.freshness.source === "standby_cloud" && view.actionGrants.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["actionGrants"],
        message: "Standby marketplace reads cannot grant write actions",
      });
    }
    if (new Set(view.actionGrants).size !== view.actionGrants.length) {
      context.addIssue({ code: "custom", path: ["actionGrants"], message: "action grants must be unique" });
    }
  });

export const domainDetailCommerceViewModelSchema = z
  .object({
    schemaVersion: z.literal(1),
    domain: commerceDomainSchema,
    freshness: marketplaceFreshnessSchema,
    actionGrants: z.array(marketplaceActionSchema).max(32),
    listings: z.array(listingViewSchema).max(32),
  })
  .strict()
  .superRefine((view, context) => {
    if (view.listings.some((listing) => listing.domain !== view.domain)) {
      context.addIssue({ code: "custom", path: ["listings"], message: "detail listings must belong to the requested domain" });
    }
    if (view.freshness.source === "standby_cloud" && view.actionGrants.length > 0) {
      context.addIssue({ code: "custom", path: ["actionGrants"], message: "Standby domain detail cannot grant write actions" });
    }
  });

export const listingActionPlanSchema = z
  .object({
    kind: z.enum(["create_listing", "publish_listing", "pause_listing", "resume_listing", "delist_listing"]),
    planId: z.string().min(1).max(160),
    listingId: z.string().min(1).max(160).nullable(),
    domain: commerceDomainSchema,
    platforms: z.array(commerceDisplayTextSchema.max(80)).min(1).max(32),
    price: commerceMoneySchema.nullable(),
  })
  .strict();

export const offerActionPlanSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("accept_offer"),
    planId: z.string().min(1).max(160),
    offerId: z.string().min(1).max(160),
    domain: commerceDomainSchema,
    buyerDisplay: commerceDisplayTextSchema,
    offer: commerceMoneySchema,
    commission: commissionQuoteSchema,
    bindingAcknowledged: z.literal(true),
  }).strict(),
  z.object({
    kind: z.literal("counter_offer"),
    planId: z.string().min(1).max(160),
    offerId: z.string().min(1).max(160),
    domain: commerceDomainSchema,
    counter: commerceMoneySchema,
  }).strict(),
  z.object({
    kind: z.literal("decline_offer"),
    planId: z.string().min(1).max(160),
    offerId: z.string().min(1).max(160),
    domain: commerceDomainSchema,
  }).strict(),
]);

export const transferActionPlanSchema = z
  .object({
    kind: z.literal("push_transfer"),
    planId: z.string().min(1).max(160),
    dealId: z.string().min(1).max(160),
    itemCount: z.literal(1),
    target: z.object({
      domain: commerceDomainSchema,
      buyerDisplay: commerceDisplayTextSchema,
    }).strict(),
    amount: commerceMoneySchema,
    registrarExecuted: z.literal(true),
  })
  .strict();

export const transferConfirmationSchema = z
  .object({
    confirmedItemCount: z.number().int().positive(),
    confirmedTarget: z.object({
      domain: commerceDomainSchema,
      buyerDisplay: commerceDisplayTextSchema,
    }).strict(),
    irreversibleOwnershipTransferAcknowledged: z.boolean(),
  })
  .strict();

export const confirmedTransferSubmissionSchema = z
  .object({
    plan: transferActionPlanSchema,
    confirmation: transferConfirmationSchema,
  })
  .strict()
  .superRefine((submission, context) => {
    if (!isExactTransferConfirmation(submission.plan, submission.confirmation)) {
      context.addIssue({ code: "custom", path: ["confirmation"], message: "transfer confirmation must exactly match the plan" });
    }
  });

export type MarketplaceQuerySource = z.infer<typeof marketplaceQuerySourceSchema>;
export type MarketplaceAction = z.infer<typeof marketplaceActionSchema>;
export type ListingView = z.infer<typeof listingViewSchema>;
export type OfferView = z.infer<typeof offerViewSchema>;
export type DealView = z.infer<typeof dealViewSchema>;
export type SalesDeskViewModel = z.infer<typeof salesDeskViewModelSchema>;
export type DomainDetailCommerceViewModel = z.infer<typeof domainDetailCommerceViewModelSchema>;
export type ListingActionPlan = z.infer<typeof listingActionPlanSchema>;
export type OfferActionPlan = z.infer<typeof offerActionPlanSchema>;
export type TransferActionPlan = z.infer<typeof transferActionPlanSchema>;
export type TransferConfirmation = z.infer<typeof transferConfirmationSchema>;
export type ConfirmedTransferSubmission = z.infer<typeof confirmedTransferSubmissionSchema>;

export interface MarketplaceQueryPort {
  getSalesDesk(): Promise<SalesDeskViewModel>;
  getDomainCommerce(domain: string): Promise<DomainDetailCommerceViewModel>;
}

export interface MarketplaceQueryBoundary {
  getSalesDesk(): Promise<unknown>;
  getDomainCommerce(domain: string): Promise<unknown>;
}

export interface MarketplacePlanPort {
  submitListingPlan(plan: ListingActionPlan | PriceChangePlan): Promise<void>;
  submitOfferPlan(plan: OfferActionPlan): Promise<void>;
  submitTransferPlan(submission: ConfirmedTransferSubmission): Promise<void>;
}

abstract class ValidatingMarketplaceQueryAdapter implements MarketplaceQueryPort {
  readonly #boundary: MarketplaceQueryBoundary;
  readonly #expectedSource: MarketplaceQuerySource;

  protected constructor(boundary: MarketplaceQueryBoundary, expectedSource: MarketplaceQuerySource) {
    this.#boundary = boundary;
    this.#expectedSource = expectedSource;
  }

  async getSalesDesk(): Promise<SalesDeskViewModel> {
    const result = salesDeskViewModelSchema.parse(await this.#boundary.getSalesDesk());
    if (result.freshness.source !== this.#expectedSource) {
      throw new TypeError(`marketplace adapter expected ${this.#expectedSource} freshness`);
    }
    return structuredClone(result);
  }

  async getDomainCommerce(domain: string): Promise<DomainDetailCommerceViewModel> {
    const result = domainDetailCommerceViewModelSchema.parse(await this.#boundary.getDomainCommerce(domain));
    if (result.domain !== domain) throw new TypeError("marketplace detail boundary returned another domain");
    if (result.freshness.source !== this.#expectedSource) {
      throw new TypeError(`marketplace adapter expected ${this.#expectedSource} freshness`);
    }
    return structuredClone(result);
  }
}

/** Portable Active seam. Production Tauri/local-storage wiring is intentionally absent. */
export class ActiveLocalMarketplaceAdapter extends ValidatingMarketplaceQueryAdapter {
  constructor(boundary: MarketplaceQueryBoundary) {
    super(boundary, "active_local");
  }
}

/** Portable Standby seam. Production Cloud wiring is intentionally absent. */
export class StandbyCloudMarketplaceAdapter extends ValidatingMarketplaceQueryAdapter {
  constructor(boundary: MarketplaceQueryBoundary) {
    super(boundary, "standby_cloud");
  }
}

export function hasMarketplaceActionGrant(view: SalesDeskViewModel, action: MarketplaceAction): boolean {
  return view.freshness.source === "active_local" && view.actionGrants.includes(action);
}

export function createAcceptOfferPlan(planId: string, offer: OfferView, acknowledged: boolean): OfferActionPlan | null {
  if (!acknowledged) return null;
  return offerActionPlanSchema.parse({
    kind: "accept_offer",
    planId,
    offerId: offer.id,
    domain: offer.domain,
    buyerDisplay: offer.buyerDisplay,
    offer: offer.offer,
    commission: offer.commission,
    bindingAcknowledged: true,
  });
}

export function createCounterOfferPlan(planId: string, offer: OfferView, counter: CommerceMoney): OfferActionPlan {
  return offerActionPlanSchema.parse({
    kind: "counter_offer",
    planId,
    offerId: offer.id,
    domain: offer.domain,
    counter,
  });
}

export function createTransferActionPlan(planId: string, deal: DealView): TransferActionPlan {
  return transferActionPlanSchema.parse({
    kind: "push_transfer",
    planId,
    dealId: deal.id,
    itemCount: 1,
    target: { domain: deal.domain, buyerDisplay: deal.buyerDisplay },
    amount: deal.amount,
    registrarExecuted: true,
  });
}

export function isExactTransferConfirmation(
  plan: TransferActionPlan,
  confirmation: TransferConfirmation,
): boolean {
  return confirmation.irreversibleOwnershipTransferAcknowledged
    && confirmation.confirmedItemCount === plan.itemCount
    && confirmation.confirmedTarget.domain === plan.target.domain
    && confirmation.confirmedTarget.buyerDisplay === plan.target.buyerDisplay;
}

export function createConfirmedTransferSubmission(
  plan: TransferActionPlan,
  confirmation: TransferConfirmation,
): ConfirmedTransferSubmission | null {
  if (!isExactTransferConfirmation(plan, confirmation)) return null;
  return confirmedTransferSubmissionSchema.parse({ plan, confirmation });
}
