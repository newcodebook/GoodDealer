import type { DomainDetailViewModel } from "@gooddealer/client-core";
import { formatNumber, getPresentationCopy, type Locale } from "@gooddealer/i18n";
import {
  Badge,
  Banner,
  Button,
  ChevronLeftIcon,
  Dialog,
  ExternalLinkIcon,
  Input,
  KeyValueList,
  KeyValueRow,
  MetricStrip,
  Money,
  Panel,
  Switch,
  Table,
  Tag,
} from "@gooddealer/ui";
import keyholeUrl from "@gooddealer/ui/assets/icons/keyhole.svg";
import { shellTableLabels } from "../../../app-shell";
import { useState } from "react";

import { assetRowStatus, parseTargetPriceInput } from "../asset-library/asset-library-contract";
import { AssetStatusBadge, daysUntil, formatAssetMoney, todayIso } from "../asset-presentation";
import type { DomainDetailPresentation, DomainDetailSections, DomainDnsRecord, DomainListing } from "./domain-detail-contract";
import "./domain-detail.css";

export interface DomainDetailProps {
  readonly locale: Locale;
  readonly presentation: DomainDetailPresentation;
  readonly sections?: DomainDetailSections;
  readonly onBack: () => void;
  readonly onTargetPriceCommit?: (amount: string) => void;
  readonly onAutoRenewChange?: (enabled: boolean) => void;
  readonly onTransferLockChange?: (locked: boolean) => void;
  readonly onList?: () => void;
  readonly onDelist?: () => void;
  readonly onChangeNameserver?: () => void;
  readonly onEditRecords?: () => void;
  readonly onOpenRegistrar?: () => void;
  readonly onOpenConflicts?: () => void;
  readonly referenceDate?: string;
}

type DetailDialog = "price" | "delist" | null;

/** Domain detail: identity header, value ribbon, registration and ownership, listings, DNS, history. */
export function DomainDetail({
  locale,
  presentation,
  sections = {},
  onBack,
  onTargetPriceCommit,
  onAutoRenewChange,
  onTransferLockChange,
  onList,
  onDelist,
  onChangeNameserver,
  onEditRecords,
  onOpenRegistrar,
  onOpenConflicts,
  referenceDate = todayIso(),
}: DomainDetailProps) {
  const copy = getPresentationCopy(locale, "domainDetail");
  const libraryCopy = getPresentationCopy(locale, "assetLibrary");
  const [dialog, setDialog] = useState<DetailDialog>(null);
  const [priceInput, setPriceInput] = useState("");
  const [priceError, setPriceError] = useState<string | null>(null);

  const back = (
    <Button size="sm" variant="ghost" icon={<ChevronLeftIcon size={15} />} onClick={onBack}>{libraryCopy.title}</Button>
  );
  if (presentation.state !== "ready") {
    const message = presentation.state === "loading" ? copy.loading : presentation.state === "asset-not-found" ? copy.notFound : copy.unavailable;
    return (
      <section className="domain-detail" aria-label={copy.title} data-state={presentation.state}>
        <header className="domain-detail-head">{back}</header>
        <p className="domain-detail-state gd-t-body-2" role="status">{message}</p>
      </section>
    );
  }

  const view: DomainDetailViewModel = presentation.data;
  const { asset } = view;
  const canEdit = view.freshness.canEdit;
  const listings = sections.listings;
  const status = assetRowStatus(asset, listings === undefined ? undefined : { dnsProvider: null, platforms: listings.map((listing) => listing.platform) });
  const listed = status !== "unlisted" && status !== "sold";
  // A sold asset has no price left to manage; its listing history stays visible read-only.
  const canEditPrice = canEdit && status !== "sold" && onTargetPriceCommit !== undefined;
  const expiringSoon = asset.expiresOn !== null && daysUntil(asset.expiresOn, referenceDate) <= 60;
  const money = (amount: string, currency: string) => formatAssetMoney(locale, amount, currency);
  const gain = asset.targetPrice !== null && asset.acquisitionCost !== null && asset.targetPrice.currency === asset.acquisitionCost.currency
    ? Number(asset.targetPrice.amount) - Number(asset.acquisitionCost.amount)
    : null;

  const openPriceDialog = () => {
    setPriceInput(asset.targetPrice?.amount ?? "");
    setPriceError(null);
    setDialog("price");
  };
  const submitPrice = () => {
    const amount = parseTargetPriceInput(priceInput);
    if (amount === null) { setPriceError(copy.invalidPrice); return; }
    if (amount === asset.targetPrice?.amount) { setPriceError(copy.unchangedPrice); return; }
    onTargetPriceCommit?.(amount);
    setDialog(null);
  };

  const listingBadge = (listing: DomainListing) => listing.status === "sold"
    ? <Badge tone="gold">SOLD</Badge>
    : listing.status === "pending"
      ? <Badge tone="warning" mono={false}>{copy.listingPending}</Badge>
      : <Badge tone="success" mono={false}>{copy.listingActive}</Badge>;

  return (
    <section className="domain-detail" aria-label={copy.title} data-state="ready">
      <header className="domain-detail-head">
        {back}
        <span className="domain-detail-domain">{asset.domain}</span>
        <AssetStatusBadge locale={locale} status={status} />
        <span className="domain-detail-tags">
          {asset.tags.map((tag) => <Tag key={tag} {...(tag.startsWith("portfolio") ? { color: "var(--gd-blue)" } : {})}>{tag}</Tag>)}
        </span>
        <span className="domain-detail-actions">
          {canEditPrice ? <Button size="sm" onClick={openPriceDialog}>{copy.editPrice}</Button> : null}
          {canEdit && listed && onDelist !== undefined ? <Button size="sm" onClick={() => setDialog("delist")}>{copy.delist}</Button> : null}
          {canEdit && status === "unlisted" && onList !== undefined ? <Button size="sm" variant="primary" onClick={onList}>{copy.list}</Button> : null}
          {onOpenRegistrar === undefined ? null : (
            <Button size="sm" variant="ghost" icon={<ExternalLinkIcon size={13} />} onClick={onOpenRegistrar}>{copy.openRegistrar}</Button>
          )}
        </span>
      </header>
      <MetricStrip
        label={copy.title}
        metrics={[
          {
            key: "value",
            label: copy.binValue,
            tone: "gold",
            value: asset.targetPrice === null ? "—" : money(asset.targetPrice.amount, asset.targetPrice.currency),
            ...(gain === null || asset.targetPrice === null ? {} : {
              meta: `${gain >= 0 ? copy.unrealizedGain : copy.unrealizedLoss}${money(String(Math.abs(gain)), asset.targetPrice.currency)}`,
            }),
          },
          { key: "status", label: copy.currentStatus, mono: false, value: <AssetStatusBadge locale={locale} status={status} /> },
          { key: "expiry", label: copy.expiry, tone: expiringSoon ? "warning" : "body", value: asset.expiresOn ?? "—" },
          {
            key: "listings",
            label: copy.activeListings,
            value: listings === undefined ? "—" : formatNumber(locale, listings.filter((listing) => listing.status === "active").length),
          },
        ]}
      />
      <div className="domain-detail-scroll">
        {view.state === "conflict" ? (
          <Banner
            tone="danger"
            title={copy.conflictTitle}
            {...(onOpenConflicts === undefined ? {} : { actions: <Button size="sm" onClick={onOpenConflicts}>{copy.openConflicts}</Button> })}
          >
            {copy.conflictBody} {view.conflictFields.join(" · ")}
          </Banner>
        ) : null}
        {!canEdit ? <p className="domain-detail-readonly gd-t-meta">{copy.readOnlyNotice}</p> : null}
        <div className="domain-detail-grid">
          <div className="domain-detail-column">
            <Panel title={copy.registration}>
              <KeyValueList>
                <KeyValueRow label={copy.registrar} value={asset.registrar ?? "—"} />
                <KeyValueRow label={copy.registeredOn} value={asset.acquiredOn ?? "—"} mono tone="muted" />
                <KeyValueRow label={copy.expiry} value={<span className={expiringSoon ? "domain-detail-expiring" : undefined}>{asset.expiresOn ?? "—"}</span>} mono />
                {asset.acquisitionCost === null ? null : (
                  <KeyValueRow label={copy.acquisitionCost} value={money(asset.acquisitionCost.amount, asset.acquisitionCost.currency)} mono tone="muted" />
                )}
                <KeyValueRow
                  label={copy.autoRenew}
                  value={asset.autoRenew === null ? "—" : (
                    <Switch
                      checked={asset.autoRenew}
                      disabled={!canEdit || onAutoRenewChange === undefined}
                      onChange={() => onAutoRenewChange?.(!asset.autoRenew)}
                    />
                  )}
                />
                <KeyValueRow
                  label={copy.transferLock}
                  value={asset.registrarLock === null ? "—" : (
                    <Switch
                      checked={asset.registrarLock}
                      disabled={!canEdit || onTransferLockChange === undefined}
                      onChange={() => onTransferLockChange?.(!asset.registrarLock)}
                    />
                  )}
                />
                {sections.dns === undefined ? null : (
                  <>
                    <KeyValueRow label={copy.dnsProvider} value={sections.dns.provider} tone="muted" />
                    <KeyValueRow
                      label={copy.nameserver}
                      value={<span className="domain-detail-code">{sections.dns.nameservers[0] ?? "—"}</span>}
                      {...(canEdit && onChangeNameserver !== undefined ? {
                        actions: <Button size="sm" variant="ghost" onClick={onChangeNameserver}>{copy.change}</Button>,
                      } : {})}
                    />
                  </>
                )}
              </KeyValueList>
              {sections.dns === undefined ? null : <p className="domain-detail-hint gd-t-meta">{copy.nameserverHint}</p>}
            </Panel>
            {sections.ownership === undefined ? null : (
              <Panel
                title={copy.ownershipVerification}
                actions={sections.ownership.verified
                  ? <Badge tone="success" mono={false}>{copy.verified}</Badge>
                  : <Badge tone="warning" mono={false}>{copy.unverified}</Badge>}
              >
                <div className="domain-detail-ownership">
                  <img src={keyholeUrl} width="30" height="30" alt="" />
                  <p className="gd-t-body-2">
                    {copy.ownershipVia} <span className="domain-detail-code domain-detail-code--strong">{sections.ownership.txtHost}</span>{" "}
                    {sections.ownership.lastVerifiedLabel === null ? null : <>{copy.ownershipVerifiedSuffix} {sections.ownership.lastVerifiedLabel}</>}
                    <br />
                    {copy.credentialNote}
                  </p>
                </div>
              </Panel>
            )}
          </div>
          <div className="domain-detail-column">
            {listings === undefined ? null : (
              <Panel
                flush
                title={copy.salesListings}
                {...(listed && canEditPrice ? {
                  actions: <Button size="sm" variant="ghost" onClick={openPriceDialog}>{copy.reprice}</Button>,
                } : {})}
              >
                {listings.length === 0 ? (
                  <div className="domain-detail-empty gd-t-meta">
                    {copy.noListings}
                    {canEdit && onList !== undefined ? <Button size="sm" variant="primary" onClick={onList}>{copy.list}</Button> : null}
                  </div>
                ) : (
                  <Table<DomainListing>
                    {...shellTableLabels(locale)}
                    density="compact"
                    rowKey="platform"
                    columns={[
                      { key: "platform", label: copy.platform },
                      { key: "status", label: copy.status, render: listingBadge },
                      { key: "price", label: copy.price, numeric: true, render: (row) => <Money amount={row.price === null ? null : Number(row.price.amount)} /> },
                      { key: "updatedLabel", label: copy.updated, numeric: true, muted: true },
                    ]}
                    rows={listings}
                  />
                )}
              </Panel>
            )}
            {sections.dns === undefined ? null : (
              <Panel
                flush
                title={copy.dnsRecords}
                {...(canEdit && onEditRecords !== undefined ? {
                  actions: <Button size="sm" variant="ghost" onClick={onEditRecords}>{copy.editRecords}</Button>,
                } : {})}
              >
                <Table<DomainDnsRecord>
                  {...shellTableLabels(locale)}
                  density="compact"
                  rowKey={(row) => `${row.type}:${row.host}:${row.value}`}
                  columns={[
                    { key: "type", label: copy.type, width: 64, render: (row) => <span className="domain-detail-record-type">{row.type}</span> },
                    { key: "host", label: copy.host, render: (row) => <span className="domain-detail-code">{row.host}</span> },
                    { key: "value", label: copy.value, render: (row) => <span className="domain-detail-code domain-detail-code--muted">{row.value}</span> },
                    { key: "ttl", label: copy.ttl, numeric: true, muted: true, width: 64 },
                  ]}
                  rows={sections.dns.records}
                />
              </Panel>
            )}
            {sections.history === undefined ? null : (
              <Panel flush title={copy.history}>
                <ol className="domain-detail-history">
                  {sections.history.map((entry) => (
                    <li key={entry.revision}>
                      <span className="domain-detail-code domain-detail-code--faint">rev {entry.revision}</span>
                      <span className="domain-detail-history-label">{entry.label}</span>
                      <Tag>{entry.field}</Tag>
                      <span className="domain-detail-code domain-detail-code--faint domain-detail-history-when">{entry.whenLabel}</span>
                    </li>
                  ))}
                </ol>
              </Panel>
            )}
          </div>
        </div>
      </div>
      <Dialog
        open={dialog === "price"}
        onClose={() => setDialog(null)}
        title={`${copy.editPrice} · ${asset.domain}`}
        width={420}
        footer={<><Button onClick={() => setDialog(null)}>{copy.cancel}</Button><Button variant="primary" onClick={submitPrice}>{copy.saveAndSync}</Button></>}
      >
        <div className="domain-detail-price">
          <div className="domain-detail-price-row">
            <span className="gd-t-body-2">
              {copy.currentPrice}{" "}
              <span className="domain-detail-code domain-detail-code--faint">
                {asset.targetPrice === null ? "—" : money(asset.targetPrice.amount, asset.targetPrice.currency)}
              </span>
            </span>
            <span className="domain-detail-code--faint">→</span>
            <Input
              mono
              prefix="$"
              aria-label={copy.proposedPrice}
              inputMode="decimal"
              value={priceInput}
              autoFocus
              onChange={(event) => { setPriceInput(event.currentTarget.value); setPriceError(null); }}
              onKeyDown={(event) => { if (event.key === "Enter") submitPrice(); }}
              {...(priceError === null ? {} : { error: priceError })}
            />
          </div>
          <span className="gd-t-meta">{copy.priceChangeHint}</span>
        </div>
      </Dialog>
      <Dialog
        open={dialog === "delist"}
        onClose={() => setDialog(null)}
        title={`${copy.delist} · ${asset.domain}`}
        width={420}
        danger
        footer={(
          <>
            <Button onClick={() => setDialog(null)}>{copy.cancel}</Button>
            <Button variant="danger" onClick={() => { onDelist?.(); setDialog(null); }}>{copy.delistConfirm}</Button>
          </>
        )}
      >
        <p className="gd-t-body"><span className="domain-detail-code domain-detail-code--strong">{asset.domain}</span> {copy.delistBody}</p>
      </Dialog>
    </section>
  );
}
