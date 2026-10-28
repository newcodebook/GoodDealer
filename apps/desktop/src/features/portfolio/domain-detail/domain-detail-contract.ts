import type { CanonicalMoneyView, DomainDetailViewModel, PortfolioReadState } from "@gooddealer/client-core";

export type DomainDetailPresentation = PortfolioReadState<DomainDetailViewModel>;

/**
 * Sections the Host detail projection does not carry yet. Production omits each one and its panel
 * stays hidden; the mock design host supplies them to design the complete detail page.
 */
export interface DomainListing {
  readonly platform: string;
  readonly status: "active" | "pending" | "sold";
  readonly price: CanonicalMoneyView | null;
  readonly updatedLabel: string;
}

export interface DomainDnsRecord {
  readonly type: string;
  readonly host: string;
  readonly value: string;
  readonly ttl: string;
}

export interface DomainDnsSummary {
  readonly provider: string;
  readonly nameservers: readonly string[];
  readonly records: readonly DomainDnsRecord[];
}

export interface DomainOwnership {
  readonly verified: boolean;
  readonly txtHost: string;
  readonly lastVerifiedLabel: string | null;
}

export interface DomainHistoryEntry {
  readonly revision: string;
  readonly whenLabel: string;
  readonly label: string;
  readonly field: string;
}

export interface DomainDetailSections {
  readonly listings?: readonly DomainListing[];
  readonly dns?: DomainDnsSummary;
  readonly ownership?: DomainOwnership;
  readonly history?: readonly DomainHistoryEntry[];
}
