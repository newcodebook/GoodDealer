import { defaultLocale, getPresentationCopy } from "@gooddealer/i18n";
import { Banner } from "@gooddealer/ui";
import { useState } from "react";

import { applyPriceRule, type BatchEditTarget, type BatchPriceRule } from "../../src/features/operations/batch-edit";
import { SalesDesk, type SalesDeskTab } from "../../src/features/marketplace";
import type { AssetBatchAction } from "../../src/features/portfolio";
import { MockBatchEdits } from "../mock/mock-batch-edits";
import { MockShell, mockShellStatus } from "../mock/mock-shell";
import { initialMockSales, projectMockSales, type MockListing, type MockSales } from "../mock/sales-fixtures";
import type { DesignWindowPlatform } from "../screen-registry";

export const salesVariants = [
  { id: "offers", label: "报价 · 议价" },
  { id: "listings", label: "在售 Listing" },
  { id: "deals", label: "成交与交割" },
  { id: "standby", label: "Standby · 只读" },
] as const;

function target(listing: MockListing): BatchEditTarget {
  return { id: listing.id, domain: listing.domain, targetPrice: { currency: "USD", amount: String(listing.bin) } };
}

/** Sales desk over mock listings, offers, and deals; listing edits reuse the batch edit dialogs. */
export function SalesScreen({ variant, platform, onNavigateScreen }: {
  readonly variant: string;
  readonly platform: DesignWindowPlatform;
  readonly onNavigateScreen: (id: string) => void;
}) {
  const locale = defaultLocale;
  const shellCopy = getPresentationCopy(locale, "shell");
  const standby = variant === "standby";
  const [sales, setSales] = useState<MockSales>(initialMockSales);
  const [unsynced, setUnsynced] = useState(0);
  const [edit, setEdit] = useState<{ readonly action: AssetBatchAction; readonly listings: readonly MockListing[] } | null>(null);
  const change = (patch: (current: MockSales) => MockSales) => { setSales(patch); setUnsynced((count) => count + 1); };
  const updateListings = (ids: readonly string[], patch: (listing: MockListing) => MockListing | null) =>
    change((current) => ({ ...current, listings: current.listings.flatMap((listing) => ids.includes(listing.id) ? [patch(listing)].filter((next) => next !== null) : [listing]) }));
  const editedIds = edit?.listings.map((listing) => listing.id) ?? [];
  const close = () => setEdit(null);

  return (
    <MockShell
      locale={locale}
      platform={platform}
      activeNavigationId="sales"
      title={getPresentationCopy(locale, "salesDesk").title}
      status={mockShellStatus(unsynced, false, standby)}
      onNavigateScreen={onNavigateScreen}
      {...(standby ? { banner: <Banner tone="sync" title={shellCopy.standby}>{shellCopy.standbyNotice}</Banner> } : {})}
    >
      <SalesDesk
        key={variant}
        locale={locale}
        view={projectMockSales(sales, standby)}
        initialTab={(standby ? "offers" : variant) as SalesDeskTab}
        onCreateListing={() => setEdit({ action: "list", listings: sales.listings.filter((listing) => listing.status === "draft") })}
        onListingAction={(view, action) => {
          const listing = sales.listings.find((candidate) => candidate.id === view.id);
          if (listing === undefined) return;
          if (action === "change_price") setEdit({ action: "price", listings: [listing] });
          else if (action === "delist_listing") setEdit({ action: "delist", listings: [listing] });
          else if (action === "publish_listing") setEdit({ action: "list", listings: [listing] });
          else updateListings([listing.id], (current) => ({ ...current, status: action === "pause_listing" ? "paused" : "active" }));
        }}
        onAcceptOffer={(offer) => change((current) => {
          const source = current.offers.find((candidate) => candidate.id === offer.id);
          if (source === undefined) return current;
          return {
            ...current,
            offers: current.offers.map((candidate) => candidate.id === offer.id ? { ...candidate, state: "accepted" } : candidate),
            deals: [{ id: `d-${offer.id}`, domain: source.domain, amount: source.offer, platform: source.platform, buyer: source.buyer, stage: "escrow" }, ...current.deals],
          };
        })}
        onCounterOffer={(offer, counter) => change((current) => ({
          ...current,
          offers: current.offers.map((candidate) => candidate.id === offer.id ? { ...candidate, state: "countered", counter: Number(counter.amount) } : candidate),
        }))}
        onDeclineOffer={(offer) => change((current) => ({
          ...current,
          offers: current.offers.map((candidate) => candidate.id === offer.id ? { ...candidate, state: "declined" } : candidate),
        }))}
        onPushTransfer={(deal) => change((current) => ({ ...current, deals: current.deals.map((candidate) => candidate.id === deal.id ? { ...candidate, stage: "transferred" } : candidate) }))}
        onConfirmPayout={(deal) => change((current) => ({ ...current, deals: current.deals.map((candidate) => candidate.id === deal.id ? { ...candidate, stage: "paid" } : candidate) }))}
      />
      <MockBatchEdits
        locale={locale}
        action={edit?.action ?? null}
        targets={edit?.listings.map(target) ?? []}
        onClose={close}
        onPlan={(rule) => {
          // Only the price dialog opens from this screen, so every plan here is a price rule.
          if (edit?.action === "price") {
            const priced = rule as BatchPriceRule;
            updateListings(editedIds, (listing) => ({ ...listing, bin: Number(applyPriceRule(target(listing), priced) ?? listing.bin) }));
          }
          close();
        }}
        onRecords={close}
        onList={(listingChange) => {
          updateListings(editedIds, (listing) => ({
            ...listing,
            status: "active",
            platforms: listingChange.platforms,
            bin: listingChange.price === null ? listing.bin : Number(listingChange.price),
            listedAtLabel: "08-20",
          }));
          close();
        }}
        onDelist={() => { updateListings(editedIds, () => null); close(); }}
      />
    </MockShell>
  );
}
