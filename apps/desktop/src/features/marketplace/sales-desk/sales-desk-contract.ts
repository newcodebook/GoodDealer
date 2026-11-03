import { commerceMoneySchema, type CommerceMoney, type OfferView, type TransferConfirmation, type DealView } from "@gooddealer/client-core";

/**
 * Parses a typed counteroffer into commerce money in the offer's own currency. Money in one offer
 * must share a currency, so the field never carries a currency of its own; grouping separators
 * are tolerated, anything else (signs, exponents, more than two decimals, zero) is rejected.
 */
export function parseCounterInput(text: string, currency: string): CommerceMoney | null {
  const normalized = text.trim().replace(/[,\s]/gu, "");
  if (!/^\d+(\.\d{1,2})?$/u.test(normalized)) return null;
  const amount = normalized.replace(/^0+(?=\d)/u, "");
  if (Number(amount) <= 0) return null;
  const parsed = commerceMoneySchema.safeParse({ currency, amount });
  return parsed.success ? parsed.data : null;
}

/** Offer relative to BIN as a signed whole percent; null when the BIN is zero. */
export function offerBinDelta(offer: Pick<OfferView, "offer" | "bin">): number | null {
  const bin = Number(offer.bin.amount);
  if (bin === 0) return null;
  return Math.round((Number(offer.offer.amount) / bin - 1) * 100);
}

/** Commission rate in basis points as a display percent, keeping a single decimal only when needed. */
export function commissionPercent(rateBasisPoints: number): string {
  const percent = rateBasisPoints / 100;
  return `${Number.isInteger(percent) ? percent : percent.toFixed(1)}%`;
}

/**
 * The confirmation a transfer submission carries. It restates the plan's single target so the
 * Host can reject any confirmation that does not exactly match the plan it issued.
 */
export function transferConfirmationFor(deal: Pick<DealView, "domain" | "buyerDisplay">): TransferConfirmation {
  return {
    confirmedItemCount: 1,
    confirmedTarget: { domain: deal.domain, buyerDisplay: deal.buyerDisplay },
    irreversibleOwnershipTransferAcknowledged: true,
  };
}

export const dealStageProgress: Readonly<Record<DealView["stage"], { readonly value: number; readonly tone: "warning" | "sync" | "success" }>> = {
  escrow: { value: 25, tone: "warning" },
  transfer_pending: { value: 50, tone: "sync" },
  transferred: { value: 75, tone: "sync" },
  paid: { value: 100, tone: "success" },
};
