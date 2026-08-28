import { getPresentationCopy, type Locale } from "@gooddealer/i18n";
import { Badge, Banner, KeyValueList, KeyValueRow } from "@gooddealer/ui";

import type { PortfolioReadMeta } from "./portfolio-presentation-contract";
import "./portfolio-read-meta.css";

export function PortfolioReadMetadata({ locale, meta, layout }: {
  readonly locale: Locale;
  readonly meta: PortfolioReadMeta;
  readonly layout: "strip" | "panel";
}) {
  const historyCopy = getPresentationCopy(locale, "operationHistory");
  const settingsCopy = getPresentationCopy(locale, "settings");
  const assetCopy = getPresentationCopy(locale, "assetLibrary");

  return (
    <div className={`portfolio-read-meta portfolio-read-meta--${layout}`} data-availability={meta.availability} data-uncertainty={meta.uncertainty}>
      <KeyValueList>
        <KeyValueRow label={historyCopy.source} value={<code>{meta.source}</code>} mono />
        <KeyValueRow label={historyCopy.time} value={meta.observedAt === null ? settingsCopy.unknown : <time dateTime={meta.observedAt}>{meta.observedAt}</time>} mono />
        <KeyValueRow label={settingsCopy.version} value={meta.version} mono />
        <KeyValueRow label={assetCopy.status} value={<><Badge tone={meta.availability === "available" ? "success" : "danger"} mono>{meta.availability}</Badge><Badge tone={meta.uncertainty === "confirmed" ? "success" : "warning"} mono>{meta.uncertainty}</Badge></>} />
      </KeyValueList>
    </div>
  );
}

export function PortfolioStateBanner({ locale, state, detail }: {
  readonly locale: Locale;
  readonly state: "loading" | "empty" | "unavailable" | "error" | "stale" | "uncertain";
  readonly detail?: string;
}) {
  const settingsCopy = getPresentationCopy(locale, "settings");
  const assetCopy = getPresentationCopy(locale, "assetLibrary");
  const title = state === "loading" ? settingsCopy.verifying : state === "empty" ? assetCopy.title : state === "stale" ? settingsCopy.retainedNotVerified : state === "uncertain" ? settingsCopy.unknown : state;
  const tone = state === "error" || state === "unavailable" ? "danger" : state === "stale" || state === "uncertain" ? "warning" : "neutral";

  return <Banner tone={tone} title={title}>{detail}</Banner>;
}
