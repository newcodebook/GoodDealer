import { sumAmounts, type AssetLibraryRow, type CanonicalDomainName } from "@gooddealer/client-core";
import { formatNumber, getPresentationCopy, type Locale } from "@gooddealer/i18n";
import {
  BatchBar,
  Button,
  Dialog,
  EditableCell,
  Input,
  MetricStrip,
  Money,
  Pagination,
  SearchIcon,
  Select,
  Table,
  Tag,
  Toolbar,
  type TableColumn,
} from "@gooddealer/ui";
import { shellPaginationLabels, shellTableLabels } from "../../../app-shell";
import { useState, type Key } from "react";

import { AssetStatusBadge, formatAssetAmount, formatAssetMoney } from "../asset-presentation";
import { AddDomainDialog, type AddDomainOutcome } from "./add-domain-dialog";

import {
  assetRowStatus,
  parseTargetPriceInput,
  type AssetBatchAction,
  type AssetLibraryFilters,
  type AssetLibraryPresentation,
  type AssetListingSummary,
  type AssetSortKey,
  type AssetStatusFilter,
} from "./asset-library-contract";
import "./asset-library.css";

export interface AssetLibraryProps {
  readonly locale: Locale;
  readonly presentation: AssetLibraryPresentation;
  readonly listingSummaries?: ReadonlyMap<string, AssetListingSummary>;
  readonly query: string;
  readonly onQueryChange?: (query: string) => void;
  readonly filters?: AssetLibraryFilters;
  readonly onFiltersChange?: (filters: Pick<AssetLibraryFilters, "registrar" | "status">) => void;
  readonly sort?: { readonly key: AssetSortKey; readonly direction: "asc" | "desc" };
  readonly onSortChange?: (key: AssetSortKey, direction: "asc" | "desc") => void;
  readonly selectedIds: readonly string[];
  readonly onSelectionChange?: (ids: readonly string[]) => void;
  readonly onWindowChange?: (startIndex: number, size: number) => void;
  readonly onOpenAsset?: (id: string) => void;
  readonly onRenew?: () => void;
  readonly onCreatePlan?: (ids: readonly string[]) => void;
  /**
   * Adds one domain by hand; omitted where the workspace is not writable. An empty workspace has no
   * freshness to consult, so writability is the caller's to decide.
   */
  readonly onAddDomain?: (domain: CanonicalDomainName) => Promise<AddDomainOutcome>;
  readonly onBatchAction?: (action: AssetBatchAction, ids: readonly string[]) => void;
  /** Called after the user confirms "save and sync" for an inline BIN edit. */
  readonly onTargetPriceCommit?: (row: AssetLibraryRow, amount: string) => void;
}

const statusFilters: readonly AssetStatusFilter[] = ["all", "synced", "pending", "conflict", "unlisted", "sold"];
const sortKeys: readonly AssetSortKey[] = ["domain", "targetPrice", "expiresOn"];

function isSortKey(value: string): value is AssetSortKey {
  return (sortKeys as readonly string[]).includes(value);
}

function isStatusFilter(value: string): value is AssetStatusFilter {
  return (statusFilters as readonly string[]).includes(value);
}

/** The expiring metric's meta line: its notes, then the renewals link, joined as the kit joins them. */
function expiringMeta(
  notes: readonly string[],
  renew: { readonly label: string; readonly onClick: () => void } | null,
  label: string,
): { readonly meta?: string; readonly onClick?: () => void; readonly ariaLabel?: string } {
  const parts = renew === null ? notes : [...notes, renew.label];
  const meta = parts.length === 0 ? {} : { meta: parts.join(" · ") };
  return renew === null ? meta : { ...meta, onClick: renew.onClick, ariaLabel: [label, ...parts].join(" · ") };
}

/** Asset Library: KPI ribbon, filter region, windowed asset table, and the floating batch action layer. */
export function AssetLibrary({
  locale,
  presentation,
  listingSummaries,
  query,
  onQueryChange,
  filters,
  onFiltersChange,
  sort,
  onSortChange,
  selectedIds,
  onSelectionChange,
  onWindowChange,
  onOpenAsset,
  onRenew,
  onCreatePlan,
  onAddDomain,
  onBatchAction,
  onTargetPriceCommit,
}: AssetLibraryProps) {
  const copy = getPresentationCopy(locale, "assetLibrary");
  const [adding, setAdding] = useState(false);
  const [pendingEdit, setPendingEdit] = useState<{ readonly row: AssetLibraryRow; readonly amount: string } | null>(null);
  const data = presentation.state === "ready" ? presentation.data : presentation.state === "invalid-query" ? presentation.data : null;
  const canEdit = data?.freshness.canEdit ?? false;
  const showListing = listingSummaries !== undefined;

  const statusLabel: Record<AssetStatusFilter, string> = {
    all: copy.allStatuses,
    synced: copy.synced,
    pending: copy.waitingProvider,
    conflict: copy.conflict,
    unlisted: copy.unlisted,
    sold: copy.sold,
  };
  const money = (amount: string, currency: string) => formatAssetMoney(locale, amount, currency);

  const columns: TableColumn<AssetLibraryRow>[] = [
    { key: "domain", label: copy.domain, sortable: true, priority: "essential", render: (row) => <span className="asset-library-domain">{row.domain}</span> },
    {
      key: "tags",
      label: copy.tags,
      priority: "supplementary",
      render: (row) => (
        <span className="asset-library-tags">
          {row.tags.map((tag) => <Tag key={tag} {...(tag.startsWith("portfolio") ? { color: "var(--gd-blue)" } : {})}>{tag}</Tag>)}
        </span>
      ),
    },
    { key: "registrar", label: copy.registrar, muted: true, priority: "secondary", render: (row) => row.registrar ?? "—" },
    ...(showListing ? [
      { key: "dns", label: copy.dns, muted: true, priority: "supplementary" as const, render: (row: AssetLibraryRow) => listingSummaries.get(row.id)?.dnsProvider ?? "—" },
      {
        key: "platforms",
        label: copy.platform,
        muted: true,
        priority: "secondary" as const,
        render: (row: AssetLibraryRow) => {
          const platforms = listingSummaries.get(row.id)?.platforms ?? [];
          return platforms.length === 0 ? "—" : platforms.join(" · ");
        },
      },
    ] : []),
    { key: "status", label: copy.status, priority: "essential", render: (row) => <AssetStatusBadge locale={locale} status={assetRowStatus(row, listingSummaries?.get(row.id))} /> },
    {
      key: "targetPrice",
      label: copy.bin,
      numeric: true,
      sortable: true,
      priority: "essential",
      render: (row) => {
        const display = <Money amount={row.targetPrice === null ? null : formatAssetAmount(locale, row.targetPrice.amount)} />;
        if (!canEdit || onTargetPriceCommit === undefined) return display;
        return (
          <EditableCell
            value={row.targetPrice?.amount ?? null}
            prefix="$"
            display={display}
            editLabel={`${copy.bin} · ${row.domain}`}
            onCommit={(value) => {
              const amount = parseTargetPriceInput(value);
              if (amount !== null && amount !== row.targetPrice?.amount) setPendingEdit({ row, amount });
            }}
          />
        );
      },
    },
    {
      key: "expiresOn",
      label: copy.expiry,
      numeric: true,
      sortable: true,
      muted: true,
      priority: "secondary",
      render: (row) => {
        if (row.expiresOn === null) return "—";
        return <span className={row.expiring ? "asset-library-expiring" : undefined}>{row.expiresOn}</span>;
      },
    },
  ];

  const searching = query.trim() !== "";
  const ribbon = data === null ? null : (
    <MetricStrip
      label={copy.title}
      metrics={[
        { key: "total", label: copy.domainTotal, value: formatNumber(locale, data.totalRows) },
        {
          key: "value",
          label: copy.portfolioValue,
          tone: "gold",
          value: data.totalValue === null ? "—" : money(data.totalValue.amount, data.totalValue.currency),
        },
        {
          key: "expiring",
          label: copy.expiringSoon,
          tone: data.expiringWithin60Days > 0 ? "warning" : "body",
          value: formatNumber(locale, data.expiringWithin60Days),
          // Unlike the other metrics this one ignores the search: it is the number of rows the
          // renewals desk lists, so a search says so instead of implying it was filtered too.
          ...expiringMeta(searching ? [copy.wholeWorkspace] : [], onRenew === undefined ? null : { label: copy.goRenew, onClick: onRenew }, copy.expiringSoon),
        },
        { key: "listings", label: copy.activeListings, value: formatNumber(locale, data.listingCount) },
        {
          key: "conflicts",
          label: copy.pendingConflicts,
          tone: data.conflictCount > 0 ? "danger" : "body",
          value: formatNumber(locale, data.conflictCount),
          meta: copy.remoteFieldChanged,
        },
      ]}
    />
  );

  const pageSize = data?.window.size ?? 25;
  const page = data === null ? 1 : Math.floor(data.window.startIndex / pageSize) + 1;
  const currency = data?.totalValue?.currency ?? "USD";
  // Summed exactly, and only in one currency: a page that mixes currencies has no single value, as
  // the Host's portfolio value has none for a workspace that mixes them.
  const pagePrices = data?.window.rows.flatMap((row) => row.targetPrice === null ? [] : [row.targetPrice]) ?? [];
  const pageValue = pagePrices.every((price) => price.currency === currency) ? sumAmounts(pagePrices.map((price) => price.amount)) : null;
  const selectedCount = selectedIds.length;

  const stateMessage = presentation.state === "loading"
    ? copy.loading
    : presentation.state === "unavailable" || presentation.state === "error" || presentation.state === "invalid-window"
      ? copy.unavailable
      : null;

  return (
    <section className="asset-library" aria-label={copy.title} data-state={presentation.state} aria-busy={presentation.state === "loading" || undefined}>
      {ribbon}
      <Toolbar
        region
        label={copy.title}
        left={(
          <>
            <Input
              size="sm"
              prefix={<SearchIcon size={13} />}
              placeholder={copy.filterPlaceholder}
              aria-label={copy.filterPlaceholder}
              value={query}
              {...(onQueryChange === undefined ? { readOnly: true } : { onChange: (event) => onQueryChange(event.currentTarget.value) })}
            />
            {filters === undefined ? null : (
              <>
                <Select
                  size="sm"
                  aria-label={copy.registrar}
                  options={[{ value: "", label: copy.all }, ...filters.registrarOptions.map((option) => ({ value: option, label: option }))]}
                  value={filters.registrar}
                  onChange={(event) => onFiltersChange?.({ registrar: event.currentTarget.value, status: filters.status })}
                />
                <Select
                  size="sm"
                  aria-label={copy.status}
                  options={statusFilters.map((value) => ({ value, label: statusLabel[value] }))}
                  value={filters.status}
                  onChange={(event) => {
                    const status = event.currentTarget.value;
                    if (isStatusFilter(status)) onFiltersChange?.({ registrar: filters.registrar, status });
                  }}
                />
              </>
            )}
          </>
        )}
        right={(
          <>
            {onAddDomain === undefined ? null : (
              <Button size="sm" disabled={data !== null && !canEdit} onClick={() => setAdding(true)}>{copy.addDomain}</Button>
            )}
            {onCreatePlan === undefined ? null : (
              <Button size="sm" variant="primary" disabled={!canEdit || selectedCount === 0} onClick={() => onCreatePlan(selectedIds)}>
                {copy.createBatchPlan}{selectedCount > 0 ? ` · ${selectedCount}` : ""}
              </Button>
            )}
          </>
        )}
      />
      {!canEdit && data !== null ? <p className="asset-library-readonly gd-t-meta">{copy.readOnlyNotice}</p> : null}
      <div className="asset-library-body">
        {stateMessage !== null ? (
          <p className="asset-library-state gd-t-body-2" role="status">{stateMessage}</p>
        ) : presentation.state === "empty" ? (
          <div className="asset-library-empty">
            <p className="gd-t-section">{copy.emptyTitle}</p>
            <p className="gd-t-body-2">{copy.emptyDescription}</p>
          </div>
        ) : (
          <Table<AssetLibraryRow>
            {...shellTableLabels(locale)}
            label={copy.title}
            columns={columns}
            rows={data?.window.rows ?? []}
            rowKey="id"
            density="regular"
            selectable={canEdit && onSelectionChange !== undefined}
            selected={selectedIds}
            {...(onSelectionChange === undefined ? {} : { onSelectionChange: (keys: Key[]) => onSelectionChange(keys.map(String)) })}
            {...(sort === undefined ? {} : { sortKey: sort.key, sortDir: sort.direction })}
            {...(onSortChange === undefined ? {} : {
              onSort: (key: string, direction: "asc" | "desc") => { if (isSortKey(key)) onSortChange(key, direction); },
            })}
            {...(onOpenAsset === undefined ? {} : { onRowClick: (row: AssetLibraryRow) => onOpenAsset(row.id) })}
            maxHeight="100%"
            emptyText={copy.noMatches}
            {...(data === null ? {} : {
              footer: (
                <Pagination
                  page={page}
                  pageSize={pageSize}
                  total={data.totalRows}
                  labels={shellPaginationLabels(locale)}
                  note={<>{copy.viewValue} <span className="asset-library-gold">{pageValue === null ? "—" : money(pageValue, currency)}</span></>}
                  {...(onWindowChange === undefined ? {} : {
                    onPageChange: (next: number) => onWindowChange((next - 1) * pageSize, pageSize),
                    onPageSizeChange: (size: number) => onWindowChange(0, size),
                  })}
                />
              ),
            })}
          />
        )}
        {selectedCount > 0 && onBatchAction !== undefined ? (
          <div className="asset-library-batch">
            <BatchBar
              count={selectedCount}
              unit={copy.batchUnit}
              label={copy.selected}
              clearLabel={copy.clearSelection}
              {...(onSelectionChange === undefined ? {} : { onClear: () => onSelectionChange([]) })}
            >
              <Button size="sm" variant="primary" onClick={() => onBatchAction("price", selectedIds)}>{copy.batchPrice}</Button>
              <span className="gd-batchbar-sep" />
              <Button size="sm" onClick={() => onBatchAction("nameserver", selectedIds)}>{copy.changeNameserver}</Button>
              <Button size="sm" onClick={() => onBatchAction("records", selectedIds)}>{copy.dnsRecords}</Button>
              <span className="gd-batchbar-sep" />
              <Button size="sm" onClick={() => onBatchAction("list", selectedIds)}>{copy.list}</Button>
              <Button size="sm" onClick={() => onBatchAction("delist", selectedIds)}>{copy.delist}</Button>
            </BatchBar>
          </div>
        ) : null}
      </div>
      {onAddDomain === undefined ? null : (
        <AddDomainDialog locale={locale} open={adding} onClose={() => setAdding(false)} onSubmit={onAddDomain} />
      )}
      <Dialog
        open={pendingEdit !== null}
        onClose={() => setPendingEdit(null)}
        title={copy.saveAndSync}
        width={420}
        footer={(
          <>
            <Button onClick={() => setPendingEdit(null)}>{copy.discard}</Button>
            <Button
              variant="primary"
              onClick={() => {
                if (pendingEdit !== null) onTargetPriceCommit?.(pendingEdit.row, pendingEdit.amount);
                setPendingEdit(null);
              }}
            >
              {copy.saveAndSyncAction}
            </Button>
          </>
        )}
      >
        {pendingEdit === null ? null : (
          <div className="asset-library-edit">
            <div className="asset-library-edit-diff">
              <span className="asset-library-domain">{pendingEdit.row.domain}</span>
              <span className="asset-library-faint">{copy.bin}</span>
              <span className="asset-library-faint asset-library-mono">
                {pendingEdit.row.targetPrice === null ? "—" : money(pendingEdit.row.targetPrice.amount, pendingEdit.row.targetPrice.currency)}
              </span>
              <span className="asset-library-faint">→</span>
              <span className="asset-library-gold asset-library-mono">{money(pendingEdit.amount, pendingEdit.row.targetPrice?.currency ?? currency)}</span>
            </div>
            <span className="gd-t-meta">{copy.savedNotice}</span>
          </div>
        )}
      </Dialog>
    </section>
  );
}
