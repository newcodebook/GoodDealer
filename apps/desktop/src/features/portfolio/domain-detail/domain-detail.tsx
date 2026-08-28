import { getPresentationCopy, type Locale } from "@gooddealer/i18n";
import { Badge, Button, ChevronLeftIcon, KeyValueList, KeyValueRow, Panel, Tag } from "@gooddealer/ui";

import type { PortfolioDetailData, PortfolioReadState } from "../portfolio-presentation-contract";
import { PortfolioReadMetadata, PortfolioStateBanner } from "../portfolio-read-meta";
import "./domain-detail.css";

export interface DomainDetailProps {
  readonly locale: Locale;
  readonly presentation: PortfolioReadState<PortfolioDetailData>;
  readonly onBack: () => void;
}

function visibleData(presentation: PortfolioReadState<PortfolioDetailData>): PortfolioDetailData | null {
  if (presentation.state === "ready" || presentation.state === "stale") return presentation.data;
  return presentation.state === "uncertain" ? presentation.data : null;
}

export function DomainDetail({ locale, presentation, onBack }: DomainDetailProps) {
  const copy = getPresentationCopy(locale, "domainDetail");
  const assetCopy = getPresentationCopy(locale, "assetLibrary");
  const settingsCopy = getPresentationCopy(locale, "settings");
  const data = visibleData(presentation);
  const stateDetail = presentation.state === "error" ? presentation.code : presentation.state === "unavailable" ? presentation.reason : presentation.state === "uncertain" ? presentation.meta.uncertainty : undefined;

  return (
    <section className="domain-detail" data-presentation="domain-detail" data-state={presentation.state} aria-busy={presentation.state === "loading" || undefined}>
      <div className="domain-detail-toolbar">
        <Button type="button" size="sm" variant="ghost" icon={<ChevronLeftIcon size={15} />} onClick={onBack}>{assetCopy.title}</Button>
        {data === null ? <span>{copy.title}</span> : <><code>{data.displayName}</code><Badge mono={false}>{data.statusLabel}</Badge><span className="portfolio-tags">{data.tags.map((tag, index) => <Tag key={`${data.entityId}-tag-${index}`}>{tag}</Tag>)}</span></>}
        <span className="domain-detail-spacer" />
        <Badge mono={false}>{settingsCopy.readOnly}</Badge>
      </div>
      {presentation.state !== "ready" ? <PortfolioStateBanner locale={locale} state={presentation.state} {...(stateDetail === undefined ? {} : { detail: stateDetail })} /> : null}
      {"meta" in presentation ? <PortfolioReadMetadata locale={locale} meta={presentation.meta} layout="strip" /> : null}
      {data !== null ? (
        <div className="domain-detail-grid">
          <Panel title={copy.registration}>
            <KeyValueList>
              <KeyValueRow label={copy.title} value={<code>{data.displayName}</code>} mono />
              <KeyValueRow label={copy.currentStatus} value={data.statusLabel} />
              <KeyValueRow label={copy.registrar} value={data.registrarLabel ?? "—"} />
              <KeyValueRow label={copy.registeredOn} value={data.registeredOnLabel ?? "—"} />
              <KeyValueRow label={copy.expiry} value={data.expirationLabel ?? "—"} />
              <KeyValueRow label={copy.tags} value={<span className="portfolio-tags">{data.tags.map((tag, index) => <Tag key={`${data.entityId}-detail-tag-${index}`}>{tag}</Tag>)}</span>} />
            </KeyValueList>
          </Panel>
          <Panel title={settingsCopy.readOnly}><PortfolioReadMetadata locale={locale} meta={data.meta} layout="panel" /></Panel>
        </div>
      ) : null}
    </section>
  );
}
