import type { Locale } from "@gooddealer/i18n";

import { AccountBilling, type AccountInvoiceView } from "../../src/features/billing/account-billing";
import { FixtureShell } from "./fixture-shell";

export const billingVariants = [
  { id: "renewing", label: "年付续费中" },
  { id: "refunded", label: "首购已退款" },
  { id: "empty", label: "尚无发票" },
] as const;

type BillingVariant = (typeof billingVariants)[number]["id"];

const annual2026: AccountInvoiceView = { invoiceId: "INV-2026-0012", issuedAt: "2025-12-31T00:00:00.000Z", offer: "annual", amountMinor: 9800, status: "paid" };
const annual2025: AccountInvoiceView = { invoiceId: "INV-2025-0009", issuedAt: "2024-12-31T00:00:00.000Z", offer: "annual", amountMinor: 9800, status: "paid" };
const monthly2024: AccountInvoiceView = { invoiceId: "INV-2024-0004", issuedAt: "2024-03-11T00:00:00.000Z", offer: "monthly", amountMinor: 980, status: "paid" };

const fixtures: Record<BillingVariant, { invoices: readonly AccountInvoiceView[]; nextCharge: { at: string; amountMinor: number } | null }> = {
  renewing: { invoices: [annual2026, annual2025, monthly2024], nextCharge: { at: "2026-12-31T00:00:00.000Z", amountMinor: 9800 } },
  refunded: { invoices: [{ ...monthly2024, issuedAt: "2026-10-25T00:00:00.000Z", invoiceId: "INV-2026-0031", status: "refunded" }], nextCharge: null },
  empty: { invoices: [], nextCharge: null },
};

/** Mock invoice ledger; Account Web has no invoice route yet, so every amount is a fixture. */
export function BillingScreen({ variant, locale }: { readonly variant: string; readonly locale: Locale }) {
  const fixture = fixtures[(variant in fixtures ? variant : "renewing") as BillingVariant];
  return (
    <FixtureShell locale={locale} routeId="billing">
      <AccountBilling
        locale={locale}
        timeZone="UTC"
        invoices={fixture.invoices}
        nextCharge={fixture.nextCharge}
      />
    </FixtureShell>
  );
}
