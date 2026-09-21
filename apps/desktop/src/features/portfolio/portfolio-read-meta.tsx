import { getPresentationCopy, type Locale } from "@gooddealer/i18n";
import { Badge, Banner, KeyValueList, KeyValueRow } from "@gooddealer/ui";

import type { DataFreshness } from "@gooddealer/client-core";
import "./portfolio-read-meta.css";

export function PortfolioReadMetadata({ locale, meta, layout }: {
  readonly locale: Locale;
  readonly meta: DataFreshness;
  readonly layout: "strip" | "panel";
}) {
  const historyCopy = getPresentationCopy(locale, "operationHistory");
  const settingsCopy = getPresentationCopy(locale, "settings");
  const assetCopy = getPresentationCopy(locale, "assetLibrary");

  return (
    <div className={`portfolio-read-meta portfolio-read-meta--${layout}`} data-availability="available" data-uncertainty="confirmed">
      <KeyValueList>
        <KeyValueRow label={historyCopy.source} value={<code>{meta.source}</code>} mono />
        <KeyValueRow label={historyCopy.time} value={meta.lastSuccessfulProviderObservationAt === null ? settingsCopy.unknown : <time dateTime={meta.lastSuccessfulProviderObservationAt}>{meta.lastSuccessfulProviderObservationAt}</time>} mono />
        <KeyValueRow label={settingsCopy.version} value={meta.serverRevision} mono />
        <KeyValueRow label={assetCopy.status} value={<><Badge tone="success" mono>available</Badge><Badge tone="success" mono>confirmed</Badge></>} />
      </KeyValueList>
    </div>
  );
}

export function PortfolioStateBanner({ locale, state, detail }: {
  readonly locale: Locale;
  readonly state: "loading" | "empty" | "unavailable" | "error" | "asset-not-found" | "invalid-query" | "invalid-window";
  readonly detail?: string;
}) {
  const settingsCopy = getPresentationCopy(locale, "settings");
  const assetCopy = getPresentationCopy(locale, "assetLibrary");
  const title = state === "loading" ? settingsCopy.verifying : state === "empty" ? assetCopy.title : state;
  const tone = state === "error" || state === "unavailable" ? "danger" : state === "invalid-query" || state === "invalid-window" ? "warning" : "neutral";

  return <Banner tone={tone} title={title}>{detail}</Banner>;
}
