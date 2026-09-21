import { getPresentationCopy, type Locale } from "@gooddealer/i18n";
import { Badge, Input, Pagination, SearchIcon, Table, Tag, Toolbar, type TableColumn } from "@gooddealer/ui";

import type { PortfolioAssetRow, PortfolioListData, PortfolioReadState, PortfolioWindowRequest } from "../portfolio-presentation-contract";
import "./asset-library.css";

export interface AssetLibraryProps {
  readonly locale: Locale;
  readonly presentation: PortfolioReadState<PortfolioListData>;
  readonly query?: string;
  readonly onOpenAsset?: (entityId: string) => void;
  readonly onQueryChange?: (query: string) => void;
  readonly onWindowChange?: (request: PortfolioWindowRequest) => void;
}

export function AssetLibrary({ locale, presentation, query = "", onOpenAsset, onQueryChange, onWindowChange }: AssetLibraryProps) {
  const copy = getPresentationCopy(locale, "assetLibrary");
  const data = presentation.state === "ready" ? presentation.data : presentation.state === "invalid-query" ? presentation.data : null;
  const columns: readonly TableColumn<PortfolioAssetRow>[] = [
    { key: "domain", label: copy.domain, priority: "essential", render: (row) => <code>{row.domain}</code> },
    { key: "tags", label: copy.tags, priority: "supplementary", render: (row) => <span className="portfolio-tags">{row.tags.map((tag) => <Tag key={`${row.id}-${tag}`}>{tag}</Tag>)}</span> },
    { key: "registrar", label: copy.registrar, priority: "secondary", muted: true, render: (row) => row.registrar ?? "—" },
    { key: "lifecycleStatus", label: copy.status, priority: "essential", render: (row) => <Badge mono={false}>{row.lifecycleStatus ?? "active"}</Badge> },
    { key: "expiresOn", label: copy.expiry, priority: "secondary", muted: true, render: (row) => row.expiresOn ?? "—" },
  ];
  const showTable = presentation.state !== "loading" && presentation.state !== "unavailable" && presentation.state !== "error" && presentation.state !== "invalid-window";
  const stateText = presentation.state === "error" ? presentation.code : presentation.state;
  const pageSize = data?.window.size ?? 25;
  const page = data === null ? 1 : Math.floor(data.window.startIndex / pageSize) + 1;
  return (
    <section className="asset-library" data-presentation="asset-library" data-state={presentation.state} aria-busy={presentation.state === "loading" || undefined}>
      {presentation.state !== "ready" && <p role="status">{stateText}</p>}
      {showTable && <>
        <Toolbar region label={copy.title} left={<Input size="sm" prefix={<SearchIcon size={13} />} placeholder={copy.filterPlaceholder} aria-label={copy.filterPlaceholder} value={query} onChange={(event) => onQueryChange?.(event.currentTarget.value)} />} right={data === null ? null : <Badge mono={false}>{data.freshness.readOnlyReason ?? "local"}</Badge>} />
        <div className="asset-library-table"><Table label={copy.title} columns={columns} rows={data?.window.rows ?? []} rowKey="id" density="compact" {...(onOpenAsset === undefined ? {} : { onRowClick: (row: PortfolioAssetRow) => onOpenAsset(row.id) })} emptyText={<span>{copy.title} · 0</span>} maxHeight="100%" {...(data === null ? {} : { footer: <Pagination page={page} pageSize={pageSize} total={data.totalRows} {...(onWindowChange === undefined ? {} : { onPageChange: (nextPage: number) => onWindowChange({ startIndex: (nextPage - 1) * pageSize, size: pageSize, query }), onPageSizeChange: (size: number) => onWindowChange({ startIndex: 0, size, query }) })} /> })} /></div>
      </>}
    </section>
  );
}
