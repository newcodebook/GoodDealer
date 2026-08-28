import { z } from "zod";

import {
  canonicalDomainNameSchema,
  canonicalMoneyViewSchema,
  dataFreshnessSchema,
} from "../portfolio/index";

export const renewalTermYearsSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);

export const renewalDeskItemSchema = z.object({
  id: z.string().min(1).max(128),
  domain: canonicalDomainNameSchema,
  registrar: z.string().min(1).max(128),
  expiresOn: z.iso.date(),
  daysRemaining: z.number().int(),
  autoRenewEnabled: z.boolean(),
  termYears: renewalTermYearsSchema,
  annualPrice: canonicalMoneyViewSchema,
  selected: z.boolean(),
  status: z.enum(["due", "planned"]),
}).strict();

const renewalDeskListViewSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("renewal_desk"),
  state: z.literal("list"),
  freshness: dataFreshnessSchema,
  budget: canonicalMoneyViewSchema,
  items: z.array(renewalDeskItemSchema).max(100_000),
  selectedCount: z.number().int().nonnegative(),
  selectedTotal: canonicalMoneyViewSchema,
}).strict().superRefine(validateRenewalSelection);

const renewalConfirmationItemSchema = renewalDeskItemSchema.pick({
  id: true,
  domain: true,
  registrar: true,
  termYears: true,
  annualPrice: true,
});

const renewalDeskConfirmViewSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("renewal_desk"),
  state: z.literal("confirm"),
  freshness: dataFreshnessSchema,
  budget: canonicalMoneyViewSchema,
  items: z.array(renewalConfirmationItemSchema).min(1).max(10_000),
  confirmationCount: z.number().int().positive(),
  total: canonicalMoneyViewSchema,
  overBudgetBy: canonicalMoneyViewSchema.nullable(),
  budgetRemaining: canonicalMoneyViewSchema.nullable(),
}).strict().superRefine((view, context) => {
  if (view.confirmationCount !== view.items.length) {
    context.addIssue({ code: "custom", path: ["confirmationCount"], message: "confirmation count must match items" });
  }
  const ids = new Set(view.items.map((item) => item.id));
  const domains = new Set(view.items.map((item) => item.domain));
  if (ids.size !== view.items.length || domains.size !== view.items.length) {
    context.addIssue({ code: "custom", path: ["items"], message: "renewal confirmation items must be unique" });
  }
  validateSameCurrency([view.budget, view.total, ...view.items.map((item) => item.annualPrice)], context);
  const calculatedTotal = sumRenewalItems(view.items);
  if (!moneyEqual(calculatedTotal, view.total)) {
    context.addIssue({ code: "custom", path: ["total"], message: "confirmation total must equal item terms" });
  }
  const difference = subtractMoney(view.total, view.budget);
  const overBudget = !difference.startsWith("-") && difference !== "0";
  if (overBudget) {
    if (view.budgetRemaining !== null || view.overBudgetBy === null || view.overBudgetBy.amount !== difference) {
      context.addIssue({ code: "custom", path: ["overBudgetBy"], message: "over-budget amount must reconcile" });
    }
  } else {
    const remaining = subtractMoney(view.budget, view.total);
    if (view.overBudgetBy !== null || view.budgetRemaining === null || view.budgetRemaining.amount !== remaining) {
      context.addIssue({ code: "custom", path: ["budgetRemaining"], message: "budget remainder must reconcile" });
    }
  }
});

export const renewalDeskViewModelSchema = z.discriminatedUnion("state", [
  renewalDeskListViewSchema,
  renewalDeskConfirmViewSchema,
]);

export const renewalPlanRequestSchema = z.object({
  confirmationCount: z.number().int().positive(),
  items: z.array(renewalConfirmationItemSchema).min(1).max(10_000),
  total: canonicalMoneyViewSchema,
}).strict().superRefine((request, context) => {
  if (request.confirmationCount !== request.items.length) {
    context.addIssue({ code: "custom", path: ["confirmationCount"], message: "plan count must match items" });
  }
  validateSameCurrency([request.total, ...request.items.map((item) => item.annualPrice)], context);
  if (!moneyEqual(sumRenewalItems(request.items), request.total)) {
    context.addIssue({ code: "custom", path: ["total"], message: "plan total must equal item terms" });
  }
});

export const renewalPlanReceiptSchema = z.object({
  planId: z.string().min(1).max(128),
  status: z.literal("planned"),
  itemCount: z.number().int().positive(),
  total: canonicalMoneyViewSchema,
}).strict();

export type RenewalTermYears = z.infer<typeof renewalTermYearsSchema>;
export type RenewalDeskItem = z.infer<typeof renewalDeskItemSchema>;
export type RenewalDeskViewModel = z.infer<typeof renewalDeskViewModelSchema>;
export type RenewalPlanRequest = z.infer<typeof renewalPlanRequestSchema>;
export type RenewalPlanReceipt = z.infer<typeof renewalPlanReceiptSchema>;

/** Read boundary. Implementations return unknown and are validated before presentation. */
export interface RenewalDeskBoundary {
  loadRenewalDesk(): Promise<unknown>;
}

export interface RenewalDeskQueryPort {
  loadRenewalDesk(): Promise<RenewalDeskViewModel>;
}

export class ValidatingRenewalDeskQueryPort implements RenewalDeskQueryPort {
  readonly #boundary: RenewalDeskBoundary;

  constructor(boundary: RenewalDeskBoundary) {
    this.#boundary = boundary;
  }

  async loadRenewalDesk(): Promise<RenewalDeskViewModel> {
    return renewalDeskViewModelSchema.parse(await this.#boundary.loadRenewalDesk());
  }
}

/** Produces an inspectable renewal plan; this port cannot renew or charge automatically. */
export interface RenewalPlanPort {
  createRenewalPlan(request: RenewalPlanRequest): Promise<RenewalPlanReceipt>;
}

export interface RenewalPlanBoundary {
  createRenewalPlan(request: RenewalPlanRequest): Promise<unknown>;
}

export class ValidatingRenewalPlanPort implements RenewalPlanPort {
  readonly #boundary: RenewalPlanBoundary;

  constructor(boundary: RenewalPlanBoundary) {
    this.#boundary = boundary;
  }

  async createRenewalPlan(request: RenewalPlanRequest): Promise<RenewalPlanReceipt> {
    const parsedRequest = renewalPlanRequestSchema.parse(request);
    const receipt = renewalPlanReceiptSchema.parse(await this.#boundary.createRenewalPlan(parsedRequest));
    if (
      receipt.itemCount !== parsedRequest.confirmationCount
      || !moneyEqual(receipt.total, parsedRequest.total)
    ) {
      throw new TypeError("renewal plan receipt does not match the reviewed confirmation");
    }
    return receipt;
  }
}

function validateRenewalSelection(
  view: z.infer<typeof renewalDeskListViewSchema>,
  context: z.RefinementCtx,
): void {
  const selected = view.items.filter((item) => item.selected && item.status === "due");
  if (view.selectedCount !== selected.length) {
    context.addIssue({ code: "custom", path: ["selectedCount"], message: "selected count must match due rows" });
  }
  const ids = new Set(view.items.map((item) => item.id));
  const domains = new Set(view.items.map((item) => item.domain));
  if (ids.size !== view.items.length || domains.size !== view.items.length) {
    context.addIssue({ code: "custom", path: ["items"], message: "renewal items must be unique" });
  }
  validateSameCurrency([view.budget, view.selectedTotal, ...view.items.map((item) => item.annualPrice)], context);
  if (!moneyEqual(sumRenewalItems(selected), view.selectedTotal)) {
    context.addIssue({ code: "custom", path: ["selectedTotal"], message: "selected total must equal item terms" });
  }
}

function validateSameCurrency(
  values: readonly { readonly currency: string }[],
  context: z.RefinementCtx,
): void {
  if (new Set(values.map((value) => value.currency)).size !== 1) {
    context.addIssue({ code: "custom", path: [], message: "renewal money must use one currency" });
  }
}

function sumRenewalItems(
  items: readonly { readonly annualPrice: { readonly currency: string; readonly amount: string }; readonly termYears: number }[],
): { currency: string; amount: string } {
  const currency = items[0]?.annualPrice.currency ?? "USD";
  const total = items.reduce((sum, item) => sum + decimalToUnits(item.annualPrice.amount) * BigInt(item.termYears), 0n);
  return { currency, amount: unitsToDecimal(total) };
}

function moneyEqual(left: { currency: string; amount: string }, right: { currency: string; amount: string }): boolean {
  return left.currency === right.currency && decimalToUnits(left.amount) === decimalToUnits(right.amount);
}

function subtractMoney(left: { amount: string }, right: { amount: string }): string {
  return unitsToDecimal(decimalToUnits(left.amount) - decimalToUnits(right.amount));
}

function decimalToUnits(amount: string): bigint {
  const [whole = "0", fraction = ""] = amount.split(".");
  return BigInt(whole) * 100_000_000n + BigInt(fraction.padEnd(8, "0"));
}

function unitsToDecimal(units: bigint): string {
  const negative = units < 0n;
  const absolute = negative ? -units : units;
  const whole = absolute / 100_000_000n;
  const fraction = (absolute % 100_000_000n).toString().padStart(8, "0").replace(/0+$/u, "");
  return `${negative ? "-" : ""}${whole}${fraction.length > 0 ? `.${fraction}` : ""}`;
}
