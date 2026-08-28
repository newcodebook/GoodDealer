import { getPresentationCopy, type Locale } from "@gooddealer/i18n";
import { Panel } from "@gooddealer/ui";
import type { ReactElement } from "react";

import type { ZoneDnsObservationState } from "./presentation-contract";
import { ZoneDnsObservationReadSection } from "./zone-dns-observation";

export interface DomainDetailDnsSectionProps {
  readonly locale: Locale;
  readonly presentation: ZoneDnsObservationState;
  readonly onRetryRead?: () => void;
}

export function DomainDetailDnsSection({
  locale,
  presentation,
  onRetryRead,
}: DomainDetailDnsSectionProps): ReactElement {
  const detail = getPresentationCopy(locale, "domainDetail");
  return (
    <Panel title={detail.dnsRecords} flush>
      <ZoneDnsObservationReadSection
        locale={locale}
        presentation={presentation}
        actions={onRetryRead ? { onRetryRead } : {}}
        showControls={false}
      />
    </Panel>
  );
}
