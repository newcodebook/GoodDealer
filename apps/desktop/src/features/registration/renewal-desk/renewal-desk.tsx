import type { RenewalDeskItem, RenewalTermYears } from "@gooddealer/client-core";
import { formatNumber, getPresentationCopy, type Locale } from "@gooddealer/i18n";
import {
  AlertTriangleIcon,
  Badge,
  BatchBar,
  Button,
  ChevronLeftIcon,
  Dialog,
  MetricStrip,
  Money,
  Select,
  Switch,
  Table,
  Toolbar,
  type TableColumn,
} from "@gooddealer/ui";
import { shellTableLabels } from "../../../app-shell";
import { useState, type Key } from "react";

import { formatAssetMoney } from "../../portfolio";
import {
  isRenewalTerm,
  renewalTerms,
  renewalUrgency,
  type RenewalListView,
  type RenewalPlanView,
  type RenewalQuote,
} from "./renewal-desk-contract";
import "./renewal-desk.css";

export interface RenewalDeskProps {
  readonly locale: Locale;
  readonly view: RenewalListView;
  readonly onBack?: () => void;
  readonly onSelectionChange?: (ids: readonly string[]) => void;
  readonly onTermChange?: (ids: readonly string[], years: RenewalTermYears) => void;
  readonly onAutoRenewChange?: (id: string, enabled: boolean) => void;
  /** Asks the Host for the plan confirmation view of the current selection. */
  readonly onReviewPlan?: () => void;
  /** The Host's plan confirmation view; open while non-null. Creating the plan charges nothing. */
  readonly plan?: RenewalPlanView | null;
  readonly onCancelPlan?: () => void;
  readonly onCreatePlan?: () => void;
  /** Per-item payment confirmations that follow a created plan; open while non-null. */
  readonly quotes?: readonly RenewalQuote[] | null;
  readonly onConfirmQuote?: (itemId: string) => void;
  readonly onSkipQuote?: (itemId: string) => void;
  readonly onCloseQuotes?: () => void;
}

function fill(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/gu, (match, key: string) => values[key] ?? match);
}

function moneyValue(amount: string): number {
  return Number(amount);
}

/** Renewal desk: due list with per-row term and auto-renew, a budgeted plan, then one-by-one confirmation. */
export function RenewalDesk({
  locale,
  view,
  onBack,
  onSelectionChange,
  onTermChange,
  onAutoRenewChange,
  onReviewPlan,
  plan = null,
  onCancelPlan,
  onCreatePlan,
  quotes = null,
  onConfirmQuote,
  onSkipQuote,
  onCloseQuotes,
}: RenewalDeskProps) {
  const copy = getPresentationCopy(locale, "renewalDesk");
  const libraryCopy = getPresentationCopy(locale, "assetLibrary");
  const [uniformTerm, setUniformTerm] = useState<RenewalTermYears>(1);
  const canEdit = view.freshness.canEdit;
  const money = (value: { readonly amount: string; readonly currency: string }) => formatAssetMoney(locale, value.amount, value.currency);
  const due = view.items.filter((item) => item.status === "due");
  const selectedIds = due.filter((item) => item.selected).map((item) => item.id);
  const remaining = moneyValue(view.budget.amount) - moneyValue(view.selectedTotal.amount);
  const overBudget = remaining < 0;
  const autoCovered = due.filter((item) => item.autoRenewEnabled).length;
  const termOptions = renewalTerms.map((years) => ({ value: String(years), label: `${years} ${copy.yearsUnit}` }));
  const parseTerm = (value: string): RenewalTermYears | null => { const years = Number(value); return isRenewalTerm(years) ? years : null; };

  const columns: TableColumn<RenewalDeskItem>[] = [
    { key: "domain", label: copy.domain, render: (item) => <span className={`renewal-mono${item.status === "planned" ? " renewal-faint" : ""}`}>{item.domain}</span> },
    {
      key: "expiresOn",
      label: copy.expiry,
      numeric: true,
      width: 108,
      render: (item) => {
        const urgency = item.status === "planned" ? null : renewalUrgency(item.daysRemaining);
        return <span className={`renewal-mono${urgency === null ? "" : ` renewal-${urgency}`}`}>{item.expiresOn}</span>;
      },
    },
    { key: "daysRemaining", label: copy.remaining, numeric: true, width: 64, render: (item) => <span className="renewal-mono renewal-muted">{item.daysRemaining}{copy.daysUnit}</span> },
    { key: "registrar", label: copy.registrar, muted: true, width: 104, priority: "secondary" },
    {
      key: "autoRenewEnabled",
      label: copy.autoRenew,
      width: 88,
      render: (item) => item.status === "planned" ? <span className="renewal-faint">—</span> : (
        <Switch checked={item.autoRenewEnabled} disabled={!canEdit || onAutoRenewChange === undefined} onChange={() => onAutoRenewChange?.(item.id, !item.autoRenewEnabled)} />
      ),
    },
    {
      key: "termYears",
      label: copy.renewalYears,
      width: 112,
      render: (item) => item.status === "planned" ? <span className="renewal-faint">—</span> : (
        <Select
          size="sm"
          aria-label={`${copy.renewalYears} · ${item.domain}`}
          options={termOptions}
          value={String(item.termYears)}
          disabled={!canEdit || onTermChange === undefined}
          onChange={(event) => { const years = parseTerm(event.currentTarget.value); if (years !== null) onTermChange?.([item.id], years); }}
        />
      ),
    },
    { key: "annualPrice", label: copy.unitPricePerYear, numeric: true, width: 90, render: (item) => <Money amount={moneyValue(item.annualPrice.amount)} tone="body" /> },
    {
      key: "subtotal",
      label: copy.subtotal,
      numeric: true,
      width: 104,
      render: (item) => item.status === "planned"
        ? <Badge tone="sync" mono={false}>{copy.planned}</Badge>
        : <Money amount={moneyValue(item.annualPrice.amount) * item.termYears} />,
    },
  ];

  const pendingQuote = quotes?.find((quote) => quote.state === "pending") ?? null;
  const quoteIndex = quotes === null || pendingQuote === null ? 0 : quotes.indexOf(pendingQuote) + 1;
  const confirmedCount = quotes?.filter((quote) => quote.state === "confirmed").length ?? 0;
  const skippedCount = quotes?.filter((quote) => quote.state === "skipped").length ?? 0;

  return (
    <section className="renewal-desk" aria-label={copy.title}>
      <MetricStrip
        label={copy.title}
        metrics={[
          { key: "due", label: copy.expiringDomains, value: formatNumber(locale, due.length) },
          { key: "budget", label: copy.renewalBudget, value: money(view.budget), tone: "gold" },
          { key: "selected", label: copy.selectedRenewalAmount, value: money(view.selectedTotal), tone: overBudget ? "danger" : "gold" },
          { key: "remaining", label: copy.budgetRemaining, value: `${overBudget ? "−" : ""}${formatAssetMoney(locale, Math.abs(remaining).toFixed(2), view.budget.currency)}`, tone: overBudget ? "danger" : "body" },
          { key: "auto", label: copy.autoRenewOverride, value: `${autoCovered} / ${due.length}`, tone: "blue" },
        ]}
      />
      <Toolbar
        region
        label={copy.title}
        left={(
          <>
            {onBack === undefined ? null : <Button size="sm" variant="ghost" icon={<ChevronLeftIcon size={15} />} onClick={onBack}>{libraryCopy.title}</Button>}
            <span className="gd-t-body-2 renewal-nowrap">{copy.scopeHint}</span>
          </>
        )}
        right={onReviewPlan === undefined ? null : (
          <Button size="sm" variant="primary" disabled={!canEdit || selectedIds.length === 0} onClick={onReviewPlan}>
            {copy.renewSelected}{selectedIds.length > 0 ? ` · ${selectedIds.length}` : ""}
          </Button>
        )}
      />
      {!canEdit ? <p className="renewal-readonly gd-t-meta">{copy.readOnlyNotice}</p> : null}
      <div className="renewal-body">
        <Table<RenewalDeskItem>
          {...shellTableLabels(locale)}
          label={copy.title}
          density="regular"
          rowKey="id"
          columns={columns}
          rows={view.items}
          selectable={canEdit && onSelectionChange !== undefined}
          selected={selectedIds}
          {...(onSelectionChange === undefined ? {} : {
            onSelectionChange: (keys: Key[]) => onSelectionChange(keys.map(String).filter((id) => due.some((item) => item.id === id))),
          })}
          maxHeight="100%"
        />
        {selectedIds.length > 0 && canEdit ? (
          <div className="renewal-batch">
            <BatchBar
              count={selectedIds.length}
              unit={copy.domainsUnit}
              label={copy.selected}
              clearLabel={copy.clearSelection}
              {...(onSelectionChange === undefined ? {} : { onClear: () => onSelectionChange([]) })}
            >
              <span className="renewal-batch-term">
                {copy.uniformTerm}
                <Select size="sm" aria-label={copy.uniformTerm} options={termOptions} value={String(uniformTerm)} onChange={(event) => { const years = parseTerm(event.currentTarget.value); if (years !== null) setUniformTerm(years); }} />
              </span>
              {onTermChange === undefined ? null : <Button size="sm" onClick={() => onTermChange(selectedIds, uniformTerm)}>{copy.applyToSelected}</Button>}
              <span className="gd-batchbar-sep" />
              <span className="renewal-nowrap">{copy.total} <b className={`renewal-mono ${overBudget ? "renewal-danger" : "renewal-gold"}`}>{money(view.selectedTotal)}</b></span>
              {onReviewPlan === undefined ? null : <Button size="sm" variant="primary" onClick={onReviewPlan}>{copy.renew}</Button>}
            </BatchBar>
          </div>
        ) : null}
      </div>
      <Dialog
        open={plan !== null}
        onClose={() => onCancelPlan?.()}
        title={plan === null ? copy.createPlan : fill(copy.planTitle, { count: formatNumber(locale, plan.confirmationCount) })}
        width={480}
        footer={(
          <>
            <Button onClick={() => onCancelPlan?.()}>{copy.cancel}</Button>
            <Button variant="primary" onClick={() => onCreatePlan?.()}>{copy.createPlan}</Button>
          </>
        )}
      >
        {plan === null ? null : (
          <div className="renewal-dialog">
            <span className="gd-t-body">{copy.planBody}</span>
            <div className="renewal-ledger">
              <div><span>{copy.renewalTotal}</span><span className="renewal-mono renewal-gold renewal-amount">{money(plan.total)}</span></div>
              <div><span>{copy.renewalBudget}</span><span className="renewal-mono renewal-muted">{money(plan.budget)}</span></div>
              <div className="renewal-ledger-total">
                <span>{copy.budgetRemaining}</span>
                <span className={`renewal-mono ${plan.overBudgetBy === null ? "renewal-success" : "renewal-danger"}`}>
                  {plan.overBudgetBy === null ? money(plan.budgetRemaining ?? plan.budget) : `−${money(plan.overBudgetBy)}`}
                </span>
              </div>
            </div>
            {plan.overBudgetBy === null ? null : (
              <div className="renewal-caution"><AlertTriangleIcon size={14} />{fill(copy.overBudget, { amount: money(plan.overBudgetBy) })}</div>
            )}
            <span className="gd-t-meta">{copy.planNote}</span>
          </div>
        )}
      </Dialog>
      <Dialog
        open={quotes !== null}
        onClose={() => onCloseQuotes?.()}
        title={copy.confirmTitle}
        width={480}
        footer={pendingQuote === null ? <Button variant="primary" onClick={() => onCloseQuotes?.()}>{copy.close}</Button> : (
          <>
            <Button onClick={() => onSkipQuote?.(pendingQuote.itemId)}>{copy.skipItem}</Button>
            <Button variant="primary" onClick={() => onConfirmQuote?.(pendingQuote.itemId)}>{fill(copy.confirmItem, { amount: money(pendingQuote.amount) })}</Button>
          </>
        )}
      >
        {quotes === null ? null : pendingQuote === null ? (
          <div className="renewal-dialog">
            <span className="gd-t-section">{copy.queueDone}</span>
            <span className="gd-t-body-2">{fill(copy.queueSummary, { confirmed: formatNumber(locale, confirmedCount), skipped: formatNumber(locale, skippedCount) })}</span>
          </div>
        ) : (
          <div className="renewal-dialog">
            <span className="gd-t-label">{fill(copy.confirmProgress, { index: formatNumber(locale, quoteIndex), total: formatNumber(locale, quotes.length) })}</span>
            <div className="renewal-ledger">
              <div><span>{copy.domain}</span><span className="renewal-mono">{pendingQuote.domain}</span></div>
              <div><span>{copy.registrar}</span><span>{pendingQuote.registrar}</span></div>
              <div><span>{copy.renewalYears}</span><span className="renewal-mono">{pendingQuote.termYears} {copy.yearsUnit}</span></div>
              <div><span>{copy.quoteValidUntil}</span><span className="renewal-mono renewal-muted">{pendingQuote.validUntilLabel}</span></div>
              <div className="renewal-ledger-total"><span>{copy.quote}</span><span className="renewal-mono renewal-gold renewal-amount">{money(pendingQuote.amount)}</span></div>
            </div>
            <div className="renewal-quote-steps" aria-hidden="true">
              {quotes.map((quote) => <i key={quote.itemId} className={`renewal-step renewal-step--${quote.state}${quote === pendingQuote ? " renewal-step--current" : ""}`} />)}
            </div>
            <span className="gd-t-meta">{copy.confirmNote}</span>
          </div>
        )}
      </Dialog>
    </section>
  );
}
