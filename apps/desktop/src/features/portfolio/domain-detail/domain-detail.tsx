import { getPresentationCopy, type Locale } from "@gooddealer/i18n";
import { Badge, Button, ChevronLeftIcon, KeyValueList, KeyValueRow, Panel, Tag } from "@gooddealer/ui";

import type { PortfolioDetailData, PortfolioReadState } from "../portfolio-presentation-contract";
import "./domain-detail.css";

export interface DomainDetailProps {
  readonly locale: Locale;
  readonly presentation: PortfolioReadState<PortfolioDetailData>;
  readonly onBack: () => void;
  readonly onEdit?: ((note: string | null) => void) | undefined;
  readonly onDelete?: (() => void) | undefined;
}

export function DomainDetail({ locale, presentation, onBack, onEdit, onDelete }: DomainDetailProps) {
  const copy = getPresentationCopy(locale, "domainDetail");
  const assetCopy = getPresentationCopy(locale, "assetLibrary");
  const data = presentation.state === "ready" ? presentation.data : null;
  const asset = data?.asset ?? null;
  const stateText = presentation.state === "error" ? presentation.code : presentation.state;
  return (
    <section className="domain-detail" data-presentation="domain-detail" data-state={presentation.state} aria-busy={presentation.state === "loading" || undefined}>
      <div className="domain-detail-toolbar">
        <Button type="button" size="sm" variant="ghost" icon={<ChevronLeftIcon size={15} />} onClick={onBack}>{assetCopy.title}</Button>
        {asset === null ? <span>{copy.title}</span> : <><code>{asset.domain}</code><Badge mono={false}>{asset.lifecycleStatus ?? "active"}</Badge><span className="portfolio-tags">{asset.tags.map((tag) => <Tag key={`${asset.id}-${tag}`}>{tag}</Tag>)}</span>{onEdit && <Button type="button" size="sm" variant="ghost" onClick={() => onEdit(asset.note)}>Edit</Button>}{onDelete && <Button type="button" size="sm" variant="ghost" onClick={onDelete}>Delete</Button>}</>}
      </div>
      {presentation.state !== "ready" && <p role="status">{stateText}</p>}
      {asset !== null && <div className="domain-detail-grid"><Panel title={copy.registration}><KeyValueList>
        <KeyValueRow label={copy.title} value={<code>{asset.domain}</code>} mono />
        <KeyValueRow label={copy.currentStatus} value={asset.lifecycleStatus ?? "active"} />
        <KeyValueRow label={copy.registrar} value={asset.registrar ?? "—"} />
        <KeyValueRow label={copy.registeredOn} value={asset.acquiredOn ?? "—"} />
        <KeyValueRow label={copy.expiry} value={asset.expiresOn ?? "—"} />
        <KeyValueRow label={copy.tags} value={<span className="portfolio-tags">{asset.tags.map((tag) => <Tag key={`${asset.id}-detail-${tag}`}>{tag}</Tag>)}</span>} />
      </KeyValueList></Panel></div>}
    </section>
  );
}
