import { amountSign, multiplyAmount, subtractAmounts, type RenewalDeskItem, type RenewalTermYears } from "@gooddealer/client-core";
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
  Pagination,
  Select,
  Switch,
  Table,
  Toolbar,
  type TableColumn,
} from "@gooddealer/ui";
import { shellPaginationLabels, shellTableLabels } from "../../../app-shell";
import { useState, type Key } from "react";

import { formatAssetAmount, formatAssetMoney } from "../../portfolio";
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
  /** Requests another Host page; only a view that carries `page` is paged. */
  readonly onPageChange?: (startIndex: number, size: number) => void;
  /** The view is the last page while the Host reads another page. */
  readonly busy?: boolean;
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


/** Renewal desk: due list with per-row term and auto-renew, a budgeted plan, then one-by-one confirmation. */
export function RenewalDesk({
  locale,
  view,
  onBack,
  onPageChange,
  busy = false,
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
  // Planning needs both an editable surface and a qualified renewal capability.
  const canEdit = view.freshness.canEdit && view.planAvailability === "available";
  const money = (value: { readonly amount: string; readonly currency: string }) => formatAssetMoney(locale, value.amount, value.currency);
  const due = view.items.filter((item) => item.status === "due");
  const selectedIds = due.filter((item) => item.selected).map((item) => item.id);
  const { budget, selectedTotal } = view;
  const remaining = budget === null || selectedTotal === null ? null : amountSign(subtractAmounts(budget.amount, selectedTotal.amount));
  const overBudget = remaining !== null && remaining.sign < 0;
  // A paged view shows one Host page, so its metrics come from the Host's whole-desk counts.
  const { page } = view;
  const dueCount = page?.totalItems ?? due.length;
  const autoCovered = page?.autoRenewEnabledCount ?? due.filter((item) => item.autoRenewEnabled === true).length;
  // An unrecorded setting is neither on nor off, so it is counted apart from the switched-off ones.
  const autoOff = page?.autoRenewDisabledCount ?? due.filter((item) => item.autoRenewEnabled === false).length;
  const autoUnrecorded = dueCount - autoCovered - autoOff;
  // Unrecorded or unquoted values render as a dash so they never read as a zero or a definite fact.
  const dash = <span className="renewal-faint">—</span>;
  const unavailable = { value: copy.notAvailable, tone: "muted" as const };
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
    { key: "registrar", label: copy.registrar, muted: true, width: 104, priority: "secondary", render: (item) => item.registrar ?? dash },
    {
      key: "autoRenewEnabled",
      label: copy.autoRenew,
      width: 88,
      render: (item) => item.status === "planned" || item.autoRenewEnabled === null ? dash : (
        <Switch checked={item.autoRenewEnabled} disabled={!canEdit || onAutoRenewChange === undefined} onChange={() => onAutoRenewChange?.(item.id, item.autoRenewEnabled !== true)} />
      ),
    },
    {
      key: "termYears",
      label: copy.renewalYears,
      width: 112,
      render: (item) => item.status === "planned" || item.termYears === null ? dash : (
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
    { key: "annualPrice", label: copy.unitPricePerYear, numeric: true, width: 90, render: (item) => item.annualPrice === null ? dash : <Money amount={formatAssetAmount(locale, item.annualPrice.amount)} tone="body" /> },
    {
      key: "subtotal",
      label: copy.subtotal,
      numeric: true,
      width: 104,
      render: (item) => item.status === "planned"
        ? <Badge tone="sync" mono={false}>{copy.planned}</Badge>
        : item.annualPrice === null || item.termYears === null ? dash : <Money amount={formatAssetAmount(locale, multiplyAmount(item.annualPrice.amount, item.termYears))} />,
    },
  ];

  const pendingQuote = quotes?.find((quote) => quote.state === "pending") ?? null;
  const quoteIndex = quotes === null || pendingQuote === null ? 0 : quotes.indexOf(pendingQuote) + 1;
  const confirmedCount = quotes?.filter((quote) => quote.state === "confirmed").length ?? 0;
  const skippedCount = quotes?.filter((quote) => quote.state === "skipped").length ?? 0;

  return (
    <section className="renewal-desk" aria-label={copy.title} aria-busy={busy || undefined}>
      <MetricStrip
        label={copy.title}
        metrics={[
          { key: "due", label: copy.expiringDomains, value: formatNumber(locale, dueCount) },
          { key: "budget", label: copy.renewalBudget, ...(budget === null ? unavailable : { value: money(budget), tone: "gold" as const }) },
          { key: "selected", label: copy.selectedRenewalAmount, ...(selectedTotal === null ? unavailable : { value: money(selectedTotal), tone: overBudget ? "danger" as const : "gold" as const }) },
          { key: "remaining", label: copy.budgetRemaining, ...(remaining === null || budget === null ? unavailable : { value: `${overBudget ? "−" : ""}${formatAssetMoney(locale, remaining.magnitude, budget.currency)}`, tone: overBudget ? "danger" as const : "body" as const }) },
          { key: "auto", label: copy.autoRenewCoverage, value: `${formatNumber(locale, autoCovered)} / ${formatNumber(locale, dueCount)}`, tone: "blue", meta: `${copy.autoRenewOff} ${formatNumber(locale, autoOff)} · ${copy.autoRenewUnrecorded} ${formatNumber(locale, autoUnrecorded)}` },
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
        right={onReviewPlan === undefined || view.planAvailability === "unavailable" ? null : (
          <Button size="sm" variant="primary" disabled={!canEdit || selectedIds.length === 0} onClick={onReviewPlan}>
            {copy.renewSelected}{selectedIds.length > 0 ? ` · ${selectedIds.length}` : ""}
          </Button>
        )}
      />
      {view.planAvailability === "unavailable" ? <p className="renewal-readonly gd-t-meta">{copy.planUnavailable}</p>
        : !canEdit ? <p className="renewal-readonly gd-t-meta">{copy.readOnlyNotice}</p> : null}
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
          {...(page === undefined ? {} : {
            footer: (
              <Pagination
                page={Math.floor(page.startIndex / page.size) + 1}
                pageSize={page.size}
                total={page.totalItems}
                busy={busy}
                labels={shellPaginationLabels(locale)}
                {...(onPageChange === undefined ? {} : {
                  onPageChange: (next: number) => onPageChange((next - 1) * page.size, page.size),
                  onPageSizeChange: (size: number) => onPageChange(0, size),
                })}
              />
            ),
          })}
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
              {selectedTotal === null ? null : <span className="renewal-nowrap">{copy.total} <b className={`renewal-mono ${overBudget ? "renewal-danger" : "renewal-gold"}`}>{money(selectedTotal)}</b></span>}
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
