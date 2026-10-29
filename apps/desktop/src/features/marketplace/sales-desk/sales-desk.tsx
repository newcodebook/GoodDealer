import {
  hasMarketplaceActionGrant,
  type CommerceMoney,
  type DealView,
  type ListingView,
  type MarketplaceAction,
  type OfferView,
  type SalesDeskViewModel,
  type TransferConfirmation,
} from "@gooddealer/client-core";
import { formatNumber, getPresentationCopy, type Locale } from "@gooddealer/i18n";
import {
  AlertTriangleIcon,
  Badge,
  Button,
  Checkbox,
  Dialog,
  ExternalLinkIcon,
  Input,
  MetricStrip,
  ProgressBar,
  Table,
  Tabs,
  Toolbar,
  UploadIcon,
  type TableColumn,
} from "@gooddealer/ui";
import { useState } from "react";

import { shellTableLabels } from "../../../app-shell";
import { formatAssetMoney } from "../../portfolio";
import { commissionPercent, dealStageProgress, offerBinDelta, parseCounterInput, transferConfirmationFor } from "./sales-desk-contract";
import "./sales-desk.css";

export type SalesDeskTab = "listings" | "offers" | "deals";
export type ListingRowAction = Extract<MarketplaceAction, "publish_listing" | "change_price" | "pause_listing" | "resume_listing" | "delist_listing">;

export interface SalesDeskProps {
  readonly locale: Locale;
  readonly view: SalesDeskViewModel;
  readonly initialTab?: SalesDeskTab;
  readonly onCreateListing?: () => void;
  readonly onListingAction?: (listing: ListingView, action: ListingRowAction) => void;
  /** Fires only after the binding acknowledgement; the Host builds the accept plan from this exact offer. */
  readonly onAcceptOffer?: (offer: OfferView) => void;
  readonly onCounterOffer?: (offer: OfferView, counter: CommerceMoney) => void;
  readonly onDeclineOffer?: (offer: OfferView) => void;
  /** Fires only after the irreversible-transfer acknowledgement, with a confirmation bound to the deal's target. */
  readonly onPushTransfer?: (deal: DealView, confirmation: TransferConfirmation) => void;
  readonly onConfirmPayout?: (deal: DealView) => void;
}

function fill(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/gu, (match, key: string) => values[key] ?? match);
}

/**
 * Sales desk: listings, offers, and deals. Accepting an offer is binding and transferring a
 * domain is irreversible, so each opens its own acknowledged confirmation. Gold marks value
 * results only (listed value, deal amount, net income, SOLD), never amounts still in negotiation.
 */
export function SalesDesk({
  locale,
  view,
  initialTab = "offers",
  onCreateListing,
  onListingAction,
  onAcceptOffer,
  onCounterOffer,
  onDeclineOffer,
  onPushTransfer,
  onConfirmPayout,
}: SalesDeskProps) {
  const copy = getPresentationCopy(locale, "salesDesk");
  const [tab, setTab] = useState<SalesDeskTab>(initialTab);
  const [accepting, setAccepting] = useState<OfferView | null>(null);
  const [acceptAck, setAcceptAck] = useState(false);
  const [countering, setCountering] = useState<OfferView | null>(null);
  const [counterText, setCounterText] = useState("");
  const [transferring, setTransferring] = useState<DealView | null>(null);
  const [transferAck, setTransferAck] = useState(false);
  const readOnly = view.freshness.source === "standby_cloud";
  const can = (action: MarketplaceAction) => hasMarketplaceActionGrant(view, action);
  const money = (value: CommerceMoney) => formatAssetMoney(locale, value.amount, value.currency);
  const mono = (text: string, className = "") => <span className={`sales-mono ${className}`}>{text}</span>;
  const tableLabels = shellTableLabels(locale);

  const listingStatus = (listing: ListingView) => {
    switch (listing.status) {
      case "active": return <Badge tone="success" mono={false}>{copy.listed}</Badge>;
      case "paused": return <Badge tone="warning" mono={false}>{copy.paused}</Badge>;
      case "draft": return <Badge mono={false}>{copy.draft}</Badge>;
      case "pending": return <Badge tone="sync" mono={false}>{copy.listingPending}</Badge>;
      case "conflict": return <Badge tone="danger" mono={false}>{copy.listingConflict}</Badge>;
      case "sold": return <Badge tone="gold">{copy.sold}</Badge>;
    }
  };
  const listingActions = (listing: ListingView) => {
    if (onListingAction === undefined) return null;
    const action = (kind: ListingRowAction, label: string, variant: "primary" | "ghost" = "ghost") =>
      can(kind) ? <Button key={kind} size="sm" variant={variant} onClick={() => onListingAction(listing, kind)}>{label}</Button> : null;
    const buttons = listing.status === "draft" ? [action("publish_listing", copy.list, "primary")]
      : listing.status === "active" ? [action("change_price", copy.changePrice), action("pause_listing", copy.pause), action("delist_listing", copy.delist)]
        : listing.status === "paused" ? [action("change_price", copy.changePrice), action("resume_listing", copy.resume), action("delist_listing", copy.delist)]
          : [];
    return <span className="sales-actions">{buttons}</span>;
  };

  const listingColumns: TableColumn<ListingView>[] = [
    { key: "domain", label: copy.domain, render: (listing) => mono(listing.domain, "sales-strong") },
    { key: "platforms", label: copy.platform, muted: true, priority: "secondary", render: (listing) => listing.platforms.length === 0 ? "—" : listing.platforms.join(" · ") },
    // A published or sold BIN is a value result; a draft's BIN is still only a proposal.
    { key: "bin", label: copy.bin, numeric: true, render: (listing) => mono(money(listing.bin), listing.status === "draft" ? "sales-strong" : "sales-gold") },
    { key: "views", label: copy.browse, numeric: true, muted: true, width: 72, priority: "supplementary", render: (listing) => mono(formatNumber(locale, listing.views)) },
    { key: "offers", label: copy.inquiry, numeric: true, width: 64, render: (listing) => mono(formatNumber(locale, listing.offerCount), listing.offerCount > 0 ? "sales-blue" : "sales-faint") },
    { key: "status", label: copy.status, width: 88, render: listingStatus },
    { key: "listed", label: copy.list, numeric: true, muted: true, width: 80, priority: "supplementary", render: (listing) => mono(listing.listedAtLabel) },
    { key: "actions", label: "", width: 196, render: listingActions },
  ];

  const offerState = (offer: OfferView) => {
    switch (offer.state) {
      case "pending": return <Badge tone="warning" mono={false}>{copy.pendingResponse}</Badge>;
      case "countered": return <Badge tone="sync" mono={false}>{copy.countered}</Badge>;
      case "accepted": return <Badge tone="gold" mono={false}>{copy.accepted}</Badge>;
      case "declined": return <Badge mono={false}>{copy.rejected}</Badge>;
      case "expired": return <Badge mono={false}>{copy.expired}</Badge>;
    }
  };
  const offerActions = (offer: OfferView) => {
    if (offer.state !== "pending" && offer.state !== "countered") {
      return <span className="sales-faint sales-note">{offer.state === "accepted" ? copy.convertedToDeal : "—"}</span>;
    }
    return (
      <span className="sales-actions">
        {can("accept_offer") && onAcceptOffer !== undefined ? <Button size="sm" variant="primary" onClick={() => { setAcceptAck(false); setAccepting(offer); }}>{copy.accept}</Button> : null}
        {can("counter_offer") && onCounterOffer !== undefined ? (
          <Button size="sm" onClick={() => { setCounterText(offer.counter?.amount ?? midpoint(offer)); setCountering(offer); }}>{copy.counter}</Button>
        ) : null}
        {can("decline_offer") && onDeclineOffer !== undefined ? <Button size="sm" variant="ghost" onClick={() => onDeclineOffer(offer)}>{copy.decline}</Button> : null}
      </span>
    );
  };
  const offerColumns: TableColumn<OfferView>[] = [
    { key: "domain", label: copy.domain, render: (offer) => mono(offer.domain, "sales-strong") },
    { key: "buyer", label: copy.buyer, width: 104, priority: "secondary", render: (offer) => mono(offer.buyerDisplay, "sales-muted") },
    {
      key: "offer",
      label: copy.offer,
      numeric: true,
      render: (offer) => {
        const delta = offerBinDelta(offer);
        return (
          <span className="sales-stack sales-stack--end">
            {mono(money(offer.offer), "sales-strong")}
            <span className="sales-mono sales-faint sales-micro">
              {fill(copy.binDelta, { bin: money(offer.bin), delta: delta === null ? "—" : `${delta > 0 ? "+" : ""}${delta}%` })}
            </span>
          </span>
        );
      },
    },
    { key: "counter", label: copy.counterOffer, numeric: true, width: 112, render: (offer) => offer.counter === null ? <span className="sales-faint">—</span> : mono(money(offer.counter), "sales-strong") },
    { key: "platform", label: copy.platform, muted: true, width: 88, priority: "supplementary", render: (offer) => offer.platform },
    { key: "state", label: copy.status, width: 88, render: offerState },
    { key: "age", label: copy.time, numeric: true, muted: true, width: 92, priority: "supplementary", render: (offer) => offer.ageLabel },
    { key: "actions", label: "", width: 196, render: offerActions },
  ];

  const dealStage = (deal: DealView) => {
    const progress = dealStageProgress[deal.stage];
    const label = deal.stage === "escrow" ? copy.escrow : deal.stage === "transfer_pending" ? copy.transferPending
      : deal.stage === "transferred" ? copy.transferredAwaitingPayout : copy.payoutComplete;
    return (
      <span className="sales-stack">
        <Badge tone={deal.stage === "paid" ? "gold" : progress.tone} mono={false}>{label}</Badge>
        <ProgressBar segments={[{ value: progress.value, tone: progress.tone }]} height={4} label={label} />
      </span>
    );
  };
  const dealAction = (deal: DealView) => {
    if (deal.stage === "transfer_pending") {
      return can("push_transfer") && onPushTransfer !== undefined
        ? <Button size="sm" variant="primary" icon={<ExternalLinkIcon size={13} />} onClick={() => { setTransferAck(false); setTransferring(deal); }}>{copy.transferAction}</Button>
        : <span className="sales-faint sales-note">{copy.transferPending}</span>;
    }
    if (deal.stage === "escrow") return <span className="sales-faint sales-note">{copy.awaitingBuyerPayment}</span>;
    if (deal.stage === "transferred") {
      return can("confirm_payout") && onConfirmPayout !== undefined
        ? <Button size="sm" variant="ghost" onClick={() => onConfirmPayout(deal)}>{copy.confirmPayout}</Button>
        : <span className="sales-faint sales-note">{copy.transferredAwaitingPayout}</span>;
    }
    return <Badge tone="gold">{copy.sold}</Badge>;
  };
  const dealColumns: TableColumn<DealView>[] = [
    { key: "domain", label: copy.domain, render: (deal) => mono(deal.domain, "sales-strong") },
    { key: "amount", label: copy.dealAmount, numeric: true, render: (deal) => mono(money(deal.amount), "sales-gold") },
    { key: "net", label: copy.netIncome, numeric: true, width: 120, render: (deal) => mono(money(deal.net), "sales-gold") },
    { key: "platform", label: copy.platform, muted: true, width: 84, priority: "supplementary", render: (deal) => deal.platform },
    { key: "buyer", label: copy.buyer, muted: true, width: 104, priority: "secondary", render: (deal) => mono(deal.buyerDisplay) },
    { key: "stage", label: copy.dealProgress, width: 190, render: dealStage },
    { key: "actions", label: "", width: 140, align: "right", render: dealAction },
  ];

  const counterValue = countering === null ? null : parseCounterInput(counterText, countering.offer.currency);
  const closeAccept = () => { setAccepting(null); setAcceptAck(false); };
  const closeCounter = () => { setCountering(null); setCounterText(""); };
  const closeTransfer = () => { setTransferring(null); setTransferAck(false); };

  return (
    <section className="sales-desk" aria-label={copy.title}>
      <MetricStrip
        label={copy.title}
        metrics={[
          { key: "listings", label: copy.listings, value: formatNumber(locale, view.metrics.activeListingCount) },
          { key: "value", label: copy.listedValue, value: money(view.metrics.listedValue), tone: "gold" },
          { key: "offers", label: copy.pendingOffers, value: formatNumber(locale, view.metrics.pendingOfferCount), tone: "warning" },
          { key: "gmv", label: copy.dealValueThisMonth, value: money(view.metrics.monthGmv), tone: "gold" },
          { key: "settling", label: copy.settling, value: formatNumber(locale, view.metrics.settlingDealCount), tone: "blue" },
        ]}
      />
      <Toolbar
        region
        label={copy.title}
        left={(
          <Tabs
            active={tab}
            onChange={(key) => setTab(key === "listings" || key === "deals" ? key : "offers")}
            items={[
              { key: "listings", label: copy.listings, count: view.metrics.activeListingCount },
              { key: "offers", label: copy.offers, count: view.metrics.pendingOfferCount },
              { key: "deals", label: copy.deals, count: view.metrics.settlingDealCount },
            ]}
          />
        )}
        right={can("create_listing") && onCreateListing !== undefined
          ? <Button size="sm" variant="primary" icon={<UploadIcon size={14} />} onClick={onCreateListing}>{copy.createListing}</Button>
          : readOnly ? <Badge mono={false}>{copy.readOnly}</Badge> : null}
      />
      {readOnly ? <p className="sales-readonly gd-t-meta">{copy.readOnlyNotice}</p> : null}
      <div className="sales-body">
        {tab === "listings" ? <Table<ListingView> {...tableLabels} label={copy.listings} rowKey="id" columns={listingColumns} rows={view.listings} emptyText={copy.noRows} maxHeight="100%" /> : null}
        {tab === "offers" ? <Table<OfferView> {...tableLabels} label={copy.offers} rowKey="id" columns={offerColumns} rows={view.offers} emptyText={copy.noRows} maxHeight="100%" /> : null}
        {tab === "deals" ? <Table<DealView> {...tableLabels} label={copy.deals} rowKey="id" columns={dealColumns} rows={view.deals} emptyText={copy.noRows} maxHeight="100%" /> : null}
      </div>

      <Dialog
        open={accepting !== null}
        onClose={closeAccept}
        title={copy.acceptOfferTitle}
        width={464}
        footer={accepting === null ? null : (
          <>
            <Button onClick={closeAccept}>{copy.cancel}</Button>
            <Button
              variant="primary"
              disabled={!acceptAck}
              onClick={() => { onAcceptOffer?.(accepting); closeAccept(); setTab("deals"); }}
            >
              {fill(copy.acceptWithNet, { amount: money(accepting.commission.net) })}
            </Button>
          </>
        )}
      >
        {accepting === null ? null : (
          <div className="sales-dialog">
            <span className="gd-t-body">{fill(copy.bindingDescription, { buyer: accepting.buyerDisplay, domain: accepting.domain })}</span>
            <div className="sales-ledger">
              <div><span>{copy.offer}</span>{mono(money(accepting.offer), "sales-strong")}</div>
              <div>
                <span>{fill(copy.platformFeeRate, { platform: accepting.platform, rate: commissionPercent(accepting.commission.rateBasisPoints) })}</span>
                {mono(`−${money(accepting.commission.fee)}`, "sales-danger")}
              </div>
              <div className="sales-ledger-total"><span>{copy.estimatedNet}</span>{mono(money(accepting.commission.net), "sales-gold sales-amount")}</div>
            </div>
            <div className="sales-ack">
              <Checkbox checked={acceptAck} onChange={() => setAcceptAck((value) => !value)} label={copy.acceptOfferAck} />
            </div>
          </div>
        )}
      </Dialog>

      <Dialog
        open={countering !== null}
        onClose={closeCounter}
        title={copy.counter}
        width={420}
        footer={countering === null ? null : (
          <>
            <Button onClick={closeCounter}>{copy.cancel}</Button>
            <Button variant="primary" disabled={counterValue === null} onClick={() => { if (counterValue !== null) onCounterOffer?.(countering, counterValue); closeCounter(); }}>{copy.sendCounter}</Button>
          </>
        )}
      >
        {countering === null ? null : (
          <div className="sales-dialog">
            <span className="sales-row">
              {mono(countering.domain, "sales-strong")}
              <span className="sales-faint gd-t-meta">{fill(copy.counterContext, { offer: money(countering.offer), bin: money(countering.bin) })}</span>
            </span>
            <Input
              label={copy.counterOffer}
              mono
              inputMode="decimal"
              prefix={countering.offer.currency}
              value={counterText}
              onChange={(event) => setCounterText(event.currentTarget.value)}
              style={{ width: 220 }}
              {...(counterValue === null && counterText !== "" ? { error: copy.counterInvalid } : {})}
            />
            <span className="gd-t-meta">{copy.counterHint}</span>
          </div>
        )}
      </Dialog>

      <Dialog
        open={transferring !== null}
        onClose={closeTransfer}
        title={copy.transferTitle}
        width={484}
        danger
        footer={transferring === null ? null : (
          <>
            <Button onClick={closeTransfer}>{copy.cancel}</Button>
            <Button
              variant="danger"
              disabled={!transferAck}
              onClick={() => { onPushTransfer?.(transferring, transferConfirmationFor(transferring)); closeTransfer(); }}
            >
              {copy.pushToBuyer}
            </Button>
          </>
        )}
      >
        {transferring === null ? null : (
          <div className="sales-dialog">
            <div className="sales-danger-box">
              <div className="sales-row">
                <AlertTriangleIcon size={15} className="sales-danger" />
                <strong className="sales-danger">{copy.irreversibleTransfer}</strong>
                <span className="sales-spacer" />
                <span className="gd-t-meta">{copy.registrarExecuted}</span>
              </div>
              <span className="sales-danger-text">{fill(copy.transferDescription, { domain: transferring.domain, buyer: transferring.buyerDisplay, amount: money(transferring.amount) })}</span>
              <div className="sales-danger-ack">
                <Checkbox checked={transferAck} onChange={() => setTransferAck((value) => !value)} label={copy.transferAck} />
              </div>
            </div>
          </div>
        )}
      </Dialog>
    </section>
  );
}

/** Suggested counter halfway between the offer and BIN, rounded to whole units. */
function midpoint(offer: OfferView): string {
  return String(Math.round((Number(offer.offer.amount) + Number(offer.bin.amount)) / 2));
}
