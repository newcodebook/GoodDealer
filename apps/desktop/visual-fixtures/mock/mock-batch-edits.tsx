import type { Locale } from "@gooddealer/i18n";

import {
  BatchPriceDialog,
  DelistDialog,
  DnsRecordDialog,
  ListingDialog,
  NameserverDialog,
  type BatchEditTarget,
  type BatchPriceRule,
  type ListingChange,
  type NameserverChange,
} from "../../src/features/operations/batch-edit";
import type { AssetBatchAction } from "../../src/features/portfolio";

export const mockListingPlatforms = ["Atom", "Afternic", "SellerHub"] as const;

export interface MockBatchEditsProps {
  readonly locale: Locale;
  readonly action: AssetBatchAction | null;
  readonly targets: readonly BatchEditTarget[];
  readonly onClose: () => void;
  /** Reprice and Nameserver changes become a reviewable batch plan. */
  readonly onPlan: (rule: BatchPriceRule | NameserverChange) => void;
  /** Records, listing, and delisting are applied locally as unsynced changes. */
  readonly onRecords: () => void;
  readonly onList: (change: ListingChange) => void;
  readonly onDelist: () => void;
}

/** Opens the batch edit dialog for one asset batch action against mock targets. */
export function MockBatchEdits({ locale, action, targets, onClose, onPlan, onRecords, onList, onDelist }: MockBatchEditsProps) {
  // Each dialog keeps its own form state, so it remounts whenever a different action opens it.
  const key = `${action ?? "none"}:${targets.map((target) => target.id).join(",")}`;
  return (
    <>
      <BatchPriceDialog key={`price:${key}`} locale={locale} open={action === "price"} targets={targets} onClose={onClose} onSubmit={onPlan} />
      <NameserverDialog key={`ns:${key}`} locale={locale} open={action === "nameserver"} targets={targets} onClose={onClose} onSubmit={onPlan} />
      <DnsRecordDialog key={`records:${key}`} locale={locale} open={action === "records"} targets={targets} onClose={onClose} onSubmit={onRecords} />
      <ListingDialog key={`list:${key}`} locale={locale} open={action === "list"} targets={targets} platforms={mockListingPlatforms} onClose={onClose} onSubmit={onList} />
      <DelistDialog key={`delist:${key}`} locale={locale} open={action === "delist"} targets={targets} onClose={onClose} onSubmit={onDelist} />
    </>
  );
}
