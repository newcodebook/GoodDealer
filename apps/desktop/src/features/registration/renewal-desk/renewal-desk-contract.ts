import type { CanonicalMoneyView, RenewalDeskViewModel, RenewalTermYears } from "@gooddealer/client-core";

export type RenewalListView = Extract<RenewalDeskViewModel, { readonly state: "list" }>;
export type RenewalPlanView = Extract<RenewalDeskViewModel, { readonly state: "confirm" }>;

/**
 * One renewal quote awaiting its own payment confirmation (ADR-0024: every paid operation is
 * confirmed singly, bound to asset, registrar, term, amount, and quote validity). The Host quote
 * flow is not composed yet, so this shape is Desktop-local and supplied by the mock design host.
 */
export interface RenewalQuote {
  readonly itemId: string;
  readonly domain: string;
  readonly registrar: string;
  readonly termYears: RenewalTermYears;
  readonly amount: CanonicalMoneyView;
  readonly validUntilLabel: string;
  readonly state: "pending" | "confirmed" | "skipped";
}

export const renewalTerms: readonly RenewalTermYears[] = [1, 2, 3];

export function isRenewalTerm(value: number): value is RenewalTermYears {
  return value === 1 || value === 2 || value === 3;
}

/** Remaining-days urgency: under 14 days is danger, under 30 is warning. */
export function renewalUrgency(daysRemaining: number): "danger" | "warning" | null {
  if (daysRemaining < 14) return "danger";
  return daysRemaining < 30 ? "warning" : null;
}
