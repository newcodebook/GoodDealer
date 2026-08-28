import { getPresentationCopy, type Locale } from "@gooddealer/i18n";
import { Badge, Input, Pagination, SearchIcon, Table, Tag, Toolbar, type TableColumn } from "@gooddealer/ui";

import type { PortfolioAssetRow, PortfolioListData, PortfolioReadState, PortfolioWindowRequest } from "../portfolio-presentation-contract";
import { PortfolioReadMetadata, PortfolioStateBanner } from "../portfolio-read-meta";
import "./asset-library.css";

export interface AssetLibraryProps {
  readonly locale: Locale;
  readonly presentation: PortfolioReadState<PortfolioListData>;
  readonly query?: string;
  readonly onOpenAsset?: (entityId: string) => void;
  readonly onQueryChange?: (query: string) => void;
  readonly onWindowChange?: (request: PortfolioWindowRequest) => void;
}

function visibleData(presentation: PortfolioReadState<PortfolioListData>): PortfolioListData | null {
  if (presentation.state === "ready" || presentation.state === "stale") return presentation.data;
  return presentation.state === "uncertain" ? presentation.data : null;
}

export function AssetLibrary({ locale, presentation, query = "", onOpenAsset, onQueryChange, onWindowChange }: AssetLibraryProps) {
  const copy = getPresentationCopy(locale, "assetLibrary");
  const detailCopy = getPresentationCopy(locale, "domainDetail");
  const historyCopy = getPresentationCopy(locale, "operationHistory");
  const settingsCopy = getPresentationCopy(locale, "settings");
  const data = visibleData(presentation);
  const columns: readonly TableColumn<PortfolioAssetRow>[] = [
    { key: "displayName", label: copy.domain, priority: "essential", render: (row) => <code>{row.displayName}</code> },
    { key: "tags", label: copy.tags, priority: "supplementary", render: (row) => <span className="portfolio-tags">{row.tags.map((tag, index) => <Tag key={`${row.entityId}-tag-${index}`}>{tag}</Tag>)}</span> },
    { key: "registrarLabel", label: copy.registrar, priority: "secondary", muted: true, render: (row) => row.registrarLabel ?? "—" },
    { key: "statusLabel", label: copy.status, priority: "essential", render: (row) => <Badge mono={false}>{row.statusLabel}</Badge> },
    { key: "expirationLabel", label: copy.expiry, priority: "secondary", muted: true, render: (row) => row.expirationLabel ?? "—" },
    { key: "source", label: historyCopy.source, priority: "secondary", muted: true, render: (row) => <code>{row.meta.source}</code> },
    { key: "observedAt", label: detailCopy.updated, priority: "supplementary", muted: true, render: (row) => row.meta.observedAt === null ? settingsCopy.unknown : <time dateTime={row.meta.observedAt}>{row.meta.observedAt}</time> },
    { key: "version", label: settingsCopy.version, priority: "supplementary", numeric: true, render: (row) => row.meta.version },
    { key: "availability", label: copy.status, priority: "supplementary", render: (row) => <span className="portfolio-row-facts"><Badge tone={row.meta.availability === "available" ? "success" : "danger"} mono>{row.meta.availability}</Badge><Badge tone={row.meta.uncertainty === "confirmed" ? "success" : "warning"} mono>{row.meta.uncertainty}</Badge></span> },
  ];

  const stateDetail = presentation.state === "error" ? presentation.code : presentation.state === "unavailable" ? presentation.reason : presentation.state === "uncertain" ? presentation.meta.uncertainty : undefined;
  const pageSize = Math.max(1, data?.window.size ?? 25);
  const page = data === null ? 1 : Math.floor(Math.max(0, data.window.startIndex) / pageSize) + 1;

  return (
    <section className="asset-library" data-presentation="asset-library" data-state={presentation.state} aria-busy={presentation.state === "loading" || undefined}>
      {presentation.state !== "ready" ? <PortfolioStateBanner locale={locale} state={presentation.state} {...(stateDetail === undefined ? {} : { detail: stateDetail })} /> : null}
      {"meta" in presentation ? <PortfolioReadMetadata locale={locale} meta={presentation.meta} layout="strip" /> : null}
      {presentation.state !== "loading" && presentation.state !== "error" && presentation.state !== "unavailable" ? (
        <>
          <Toolbar region label={copy.title} left={<Input size="sm" prefix={<SearchIcon size={13} />} placeholder={copy.filterPlaceholder} aria-label={copy.filterPlaceholder} value={query} onChange={(event) => onQueryChange?.(event.currentTarget.value)} />} right={<Badge mono={false}>{settingsCopy.readOnly}</Badge>} />
          <div className="asset-library-table">
            <Table
              label={copy.title}
              columns={columns}
              rows={data?.rows ?? []}
              rowKey="entityId"
              density="compact"
              {...(onOpenAsset === undefined ? {} : { onRowClick: (row: PortfolioAssetRow) => onOpenAsset(row.entityId) })}
              emptyText={<span>{copy.title} · 0</span>}
              maxHeight="100%"
              {...(data === null ? {} : { footer: <Pagination page={page} pageSize={pageSize} total={data.totalRows} {...(onWindowChange === undefined ? {} : { onPageChange: (nextPage: number) => onWindowChange({ startIndex: (nextPage - 1) * pageSize, size: pageSize }), onPageSizeChange: (size: number) => onWindowChange({ startIndex: 0, size }) })} /> })}
            />
          </div>
        </>
      ) : null}
    </section>
  );
}
