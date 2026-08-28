import { z } from "zod";

/**
 * Business money stays decimal text at this boundary. It is never converted to
 * a JavaScript number, so display code cannot accidentally introduce binary
 * floating-point arithmetic into a price or offer decision.
 */
export const commerceMoneySchema = z
  .object({
    currency: z.string().regex(/^[A-Z]{3}$/),
    amount: z.string().regex(/^(0|[1-9]\d{0,15})(\.\d{1,8})?$/),
  })
  .strict();

export const commissionQuoteSchema = z
  .object({
    rateBasisPoints: z.number().int().min(0).max(10_000),
    fee: commerceMoneySchema,
    net: commerceMoneySchema,
  })
  .strict()
  .superRefine((quote, context) => {
    if (quote.fee.currency !== quote.net.currency) {
      context.addIssue({
        code: "custom",
        path: ["net", "currency"],
        message: "fee and net currencies must match",
      });
    }
  });

export const priceChangePlanSchema = z
  .object({
    kind: z.literal("change_price"),
    planId: z.string().min(1).max(160),
    listingId: z.string().min(1).max(160),
    domain: z.string().min(1).max(253),
    currentPrice: commerceMoneySchema,
    proposedPrice: commerceMoneySchema,
    affectedPlatforms: z.array(z.string().min(1).max(80)).min(1).max(32),
  })
  .strict()
  .superRefine((plan, context) => {
    if (plan.currentPrice.currency !== plan.proposedPrice.currency) {
      context.addIssue({
        code: "custom",
        path: ["proposedPrice", "currency"],
        message: "price changes cannot change currency",
      });
    }
  });

export const priceEditorViewModelSchema = z
  .object({
    domain: z.string().min(1).max(253),
    listingId: z.string().min(1).max(160),
    currentPrice: commerceMoneySchema,
    proposedAmount: z.string(),
    affectedPlatforms: z.array(z.string().min(1).max(80)).min(1).max(32),
    validation: z.enum(["empty", "invalid", "unchanged", "ready"]),
  })
  .strict();

export type CommerceMoney = z.infer<typeof commerceMoneySchema>;
export type CommissionQuote = z.infer<typeof commissionQuoteSchema>;
export type PriceChangePlan = z.infer<typeof priceChangePlanSchema>;
export type PriceEditorViewModel = z.infer<typeof priceEditorViewModelSchema>;

export interface PricingPlanPort {
  submitPriceChange(plan: PriceChangePlan): Promise<void>;
}

export interface PricingQueryPort {
  getPriceEditor(listingId: string): Promise<PriceEditorViewModel>;
}

export interface PricingQueryBoundary {
  getPriceEditor(listingId: string): Promise<unknown>;
}

/** Validates the injected query boundary and never supplies action authority. */
export class ValidatingPricingQueryAdapter implements PricingQueryPort {
  readonly #boundary: PricingQueryBoundary;

  constructor(boundary: PricingQueryBoundary) {
    this.#boundary = boundary;
  }

  async getPriceEditor(listingId: string): Promise<PriceEditorViewModel> {
    const result = priceEditorViewModelSchema.parse(await this.#boundary.getPriceEditor(listingId));
    if (result.listingId !== listingId) throw new TypeError("pricing boundary returned another listing");
    return structuredClone(result);
  }
}

/** Normalizes user text without performing business arithmetic. */
export function normalizePriceInput(input: string): string | null {
  const normalized = input.trim().replaceAll(",", "");
  if (!/^(0|[1-9]\d{0,15})(\.\d{1,8})?$/.test(normalized)) return null;
  return normalized;
}

export function projectPriceEditor(
  listingId: string,
  domain: string,
  currentPrice: CommerceMoney,
  affectedPlatforms: readonly string[],
  proposedInput: string,
): PriceEditorViewModel {
  const proposedAmount = normalizePriceInput(proposedInput);
  const validation = proposedInput.trim() === ""
    ? "empty"
    : proposedAmount === null
      ? "invalid"
      : proposedAmount === currentPrice.amount
        ? "unchanged"
        : "ready";

  return priceEditorViewModelSchema.parse({
    listingId,
    domain,
    currentPrice,
    proposedAmount: proposedAmount ?? proposedInput,
    affectedPlatforms,
    validation,
  });
}

export function createPriceChangePlan(
  planId: string,
  view: PriceEditorViewModel,
): PriceChangePlan | null {
  if (view.validation !== "ready") return null;
  return priceChangePlanSchema.parse({
    kind: "change_price",
    planId,
    listingId: view.listingId,
    domain: view.domain,
    currentPrice: view.currentPrice,
    proposedPrice: {
      currency: view.currentPrice.currency,
      amount: view.proposedAmount,
    },
    affectedPlatforms: view.affectedPlatforms,
  });
}

/** Thousands-grouping is string-only and deliberately locale-neutral. */
export function formatCommerceAmount(amount: string): string {
  const [whole = "0", fraction] = amount.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const displayedFraction = (fraction ?? "").padEnd(2, "0");
  return `${grouped}.${displayedFraction}`;
}

export function formatBasisPoints(rateBasisPoints: number): string {
  if (!Number.isSafeInteger(rateBasisPoints) || rateBasisPoints < 0 || rateBasisPoints > 10_000) {
    throw new RangeError("basis points must be an integer from 0 through 10000");
  }
  const digits = String(rateBasisPoints).padStart(3, "0");
  const whole = digits.slice(0, -2).replace(/^0+(?=\d)/, "");
  const fractional = digits.slice(-2).replace(/0+$/, "");
  return fractional === "" ? whole : `${whole}.${fractional}`;
}
