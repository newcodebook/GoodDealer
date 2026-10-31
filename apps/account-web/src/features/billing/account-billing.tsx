import { formatDate, formatMoney, getAccountCopy, type Locale } from "@gooddealer/i18n";
import type { CommercialOffer } from "@gooddealer/protocol/account";
import {
  Badge,
  Button,
  Dialog,
  IconButton,
  KeyValueList,
  KeyValueRow,
  MetricStrip,
  Money,
  Panel,
  ReceiptIcon,
  ShieldCheckIcon,
  Table,
  type TableColumn,
} from "@gooddealer/ui";
import markUrl from "@gooddealer/ui/assets/logo/mark-flat.svg";
import { useState } from "react";

import { offerCopyKey } from "../license/license-view";
import "./account-billing.css";

/** A settled purchase as the invoice ledger shows it; amounts stay in integer USD minor units. */
export interface AccountInvoiceView {
  readonly invoiceId: string;
  readonly issuedAt: string;
  readonly offer: CommercialOffer;
  readonly amountMinor: number;
  readonly status: "paid" | "refunded";
}

export interface AccountBillingProps {
  readonly locale: Locale;
  readonly timeZone: string;
  readonly invoices: readonly AccountInvoiceView[];
  /** The next automatic renewal; null for fixed terms, cancelled renewals, and no purchase. */
  readonly nextCharge: { readonly at: string; readonly amountMinor: number } | null;
}

/**
 * Billing and invoices. Payment details live only on Stripe-hosted checkout, so this screen shows the
 * provider, the custody rules, and the invoice ledger; it never renders a card or billing form. There
 * is no customer portal, receipt link, or arrears state yet: Account Web never receives a Provider
 * URL, so those stay out until Cloud offers a same-origin redirect contract for them.
 */
export function AccountBilling(props: AccountBillingProps) {
  const { locale, timeZone, invoices, nextCharge } = props;
  const copy = getAccountCopy(locale, "accountBilling");
  const licenseCopy = getAccountCopy(locale, "accountLicense");
  const shellCopy = getAccountCopy(locale, "accountShell");
  const [receipt, setReceipt] = useState<AccountInvoiceView | null>(null);
  const date = (value: string) => formatDate(locale, Date.parse(value), { year: "numeric", month: "2-digit", day: "2-digit", timeZone });
  const usd = (minor: number) => formatMoney(locale, minor / 100, "USD");
  const description = (invoice: AccountInvoiceView) => licenseCopy.termLicense.replace("{term}", licenseCopy[offerCopyKey[invoice.offer]]);
  // Refunded invoices are not spend: the total, its count, and "latest payment" all read paid rows only,
  // so a refunded first purchase never shows up as money the account still paid.
  const paid = invoices.filter((invoice) => invoice.status === "paid");
  const totalMinor = paid.reduce((sum, invoice) => sum + invoice.amountMinor, 0);
  const latest = [...paid].sort((a, b) => Date.parse(b.issuedAt) - Date.parse(a.issuedAt))[0] ?? null;

  const columns: readonly TableColumn<AccountInvoiceView>[] = [
    { key: "invoiceId", label: copy.colInvoice, render: (row) => <span className="billing-mono billing-strong">{row.invoiceId}</span> },
    { key: "issuedAt", label: copy.colDate, numeric: true, priority: "secondary", render: (row) => <span className="billing-mono">{date(row.issuedAt)}</span> },
    { key: "description", label: copy.colDescription, render: (row) => <span className="billing-strong">{description(row)}</span> },
    { key: "amount", label: copy.colAmount, numeric: true, render: (row) => <Money amount={row.amountMinor / 100} size={12} tone={row.status === "refunded" ? "muted" : "gold"} /> },
    { key: "status", label: copy.colStatus, render: (row) => row.status === "paid" ? <Badge tone="success">{copy.statusPaid}</Badge> : <Badge tone="neutral">{copy.statusRefunded}</Badge> },
    {
      key: "actions",
      align: "right",
      render: (row) => <IconButton size="sm" label={copy.viewReceipt} onClick={(event) => { event.stopPropagation(); setReceipt(row); }}><ReceiptIcon size={14} /></IconButton>,
    },
  ];

  return (
    <div className="billing">
      {/* The provider is stated once, in its panel; the ribbon keeps the three money facts. */}
      <MetricStrip
        wrap
        metrics={[
          { key: "total", label: copy.metricTotal, value: usd(totalMinor), tone: paid.length === 0 ? "muted" : "gold", meta: copy.metricTotalMeta.replace("{count}", String(paid.length)) },
          { key: "latest", label: copy.metricLatest, value: latest === null ? "—" : usd(latest.amountMinor), tone: latest === null ? "muted" : "gold", meta: latest === null ? undefined : date(latest.issuedAt) },
          nextCharge === null
            ? { key: "next", label: copy.metricNext, value: copy.nextNone, tone: "muted", mono: false, meta: copy.nextNoneMeta }
            : { key: "next", label: copy.metricNext, value: date(nextCharge.at), meta: usd(nextCharge.amountMinor) },
        ]}
      />
      <div className="billing-body">
        {/* The ledger is the work surface (page zoning ④) and leads; provider and custody facts are
            static reference and follow it. */}
        <Panel flush title={copy.invoicesTitle}>
          <Table
            columns={columns}
            rows={invoices}
            rowKey="invoiceId"
            density="regular"
            onRowClick={setReceipt}
            emptyText={copy.emptyInvoices}
            label={copy.invoicesTitle}
            hiddenColumnsLabel={(count) => copy.hiddenColumns.replace("{count}", String(count))}
            style={{ border: "none", borderRadius: 0 }}
          />
        </Panel>
        <div className="billing-cards">
          <Panel title={copy.providerTitle}>
            <div className="billing-provider">
              <span className="billing-provider-glyph"><ShieldCheckIcon size={20} /></span>
              <div className="billing-provider-copy">
                <span className="billing-provider-name">{copy.providerName}</span>
                <span className="billing-provider-detail">{copy.providerDetail}</span>
              </div>
            </div>
          </Panel>
          <Panel title={copy.custodyTitle}>
            <KeyValueList>
              <KeyValueRow label={copy.custodyCards} value={copy.custodyCardsValue} />
              <KeyValueRow label={copy.custodyTax} value={copy.custodyTaxValue} />
              <KeyValueRow label={copy.custodyRefund} value={copy.custodyRefundValue} />
            </KeyValueList>
          </Panel>
        </div>
      </div>

      <Dialog
        open={receipt !== null}
        onClose={() => setReceipt(null)}
        title={receipt?.invoiceId}
        width={480}
        closeLabel={shellCopy.close}
        footer={<Button onClick={() => setReceipt(null)}>{copy.close}</Button>}
      >
        {receipt === null ? null : (
          <div className="billing-receipt">
            <div className="billing-receipt-head">
              <img src={markUrl} width="24" height="24" alt="" />
              <div className="billing-receipt-brand">
                <span>{shellCopy.productName}</span>
                <span className="billing-receipt-sub">{copy.receiptSubtitle}</span>
              </div>
              {receipt.status === "paid" ? <Badge tone="success">{copy.statusPaid}</Badge> : <Badge tone="neutral">{copy.statusRefunded}</Badge>}
            </div>
            <KeyValueList>
              <KeyValueRow label={copy.colInvoice} value={receipt.invoiceId} mono />
              <KeyValueRow label={copy.receiptIssued} value={date(receipt.issuedAt)} mono />
              <KeyValueRow label={copy.colDescription} value={description(receipt)} />
              <KeyValueRow label={copy.receiptMethod} value={copy.receiptMethodValue} />
            </KeyValueList>
            <div className="billing-receipt-total">
              <span>{copy.receiptTotal}</span>
              <Money amount={receipt.amountMinor / 100} size={18} showCurrency />
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
