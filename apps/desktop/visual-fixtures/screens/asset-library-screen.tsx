import { defaultLocale, getPresentationCopy } from "@gooddealer/i18n";
import { Banner } from "@gooddealer/ui";
import { useEffect, useMemo, useState } from "react";

import { AssetLibrary, type AssetBatchAction, type AssetSortKey, type AssetStatusFilter } from "../../src/features/portfolio/asset-library";
import type { AssetLibraryPresentation } from "../../src/features/portfolio/asset-library";
import { MockBatchEdits } from "../mock/mock-batch-edits";
import { MockShell, mockShellStatus } from "../mock/mock-shell";
import type { DesignWindowPlatform } from "../screen-registry";
import {
  initialMockAssets,
  mockReferenceDate,
  mockRegistrars,
  projectMockLibrary,
  type MockAssetRecord,
} from "../mock/workspace-fixtures";

export type AssetLibraryVariant = "ready" | "standby" | "empty" | "loading";

export const assetLibraryVariants: readonly { readonly id: AssetLibraryVariant; readonly label: string }[] = [
  { id: "ready", label: "Active · 可编辑" },
  { id: "standby", label: "Standby · 只读" },
  { id: "empty", label: "空资产库" },
  { id: "loading", label: "读取中" },
];

/** Mock-driven Asset Library inside the production shell; inline edits raise the unsynced count. */
export function AssetLibraryScreen({ variant, platform, onNavigateScreen }: {
  readonly variant: AssetLibraryVariant;
  readonly platform: DesignWindowPlatform;
  readonly onNavigateScreen: (id: string) => void;
}) {
  const locale = defaultLocale;
  const shellCopy = getPresentationCopy(locale, "shell");
  const [records, setRecords] = useState<readonly MockAssetRecord[]>(initialMockAssets);
  const [query, setQuery] = useState("");
  const [registrar, setRegistrar] = useState("");
  const [status, setStatus] = useState<AssetStatusFilter>("all");
  const [sort, setSort] = useState<{ key: AssetSortKey; direction: "asc" | "desc" }>({ key: "targetPrice", direction: "desc" });
  const [pageWindow, setPageWindow] = useState({ startIndex: 0, size: 10 });
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [unsynced, setUnsynced] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [batchAction, setBatchAction] = useState<AssetBatchAction | null>(null);

  // Local commits replicate asynchronously: the unsynced count rises, then drains on its own.
  useEffect(() => {
    if (unsynced <= 0) return undefined;
    setSyncing(true);
    const timer = setTimeout(() => { setUnsynced(0); setSyncing(false); }, 1600);
    return () => clearTimeout(timer);
  }, [unsynced]);

  const standby = variant === "standby";
  const presentation: AssetLibraryPresentation = useMemo(() => {
    if (variant === "loading") return { state: "loading" };
    if (variant === "empty") return { state: "empty" };
    return {
      state: "ready",
      data: projectMockLibrary(records, {
        query, registrar, status, sortKey: sort.key, sortDirection: sort.direction, ...pageWindow,
      }, standby ? "standby" : null),
    };
  }, [variant, records, query, registrar, status, sort, pageWindow, standby]);
  const listingSummaries = useMemo(() => new Map(records.map(({ row, listing }) => [row.id, listing])), [records]);
  const resetPageWindow = () => setPageWindow((current) => ({ ...current, startIndex: 0 }));
  const batchTargets = records.filter(({ row }) => selected.includes(row.id)).map(({ row }) => ({ id: row.id, domain: row.domain, targetPrice: row.targetPrice }));
  // Local batch edits mark the touched rows pending and raise the unsynced count, as a Host commit would.
  const commitSelected = (update: (record: MockAssetRecord) => MockAssetRecord) => {
    setRecords((current) => current.map((record) => selected.includes(record.row.id) ? update({ ...record, row: { ...record.row, syncStatus: "pending" } }) : record));
    setUnsynced((count) => count + selected.length);
    setSelected([]);
    setBatchAction(null);
  };

  return (
    <MockShell
      locale={locale}
      platform={platform}
      activeNavigationId="assets"
      title={getPresentationCopy(locale, "assetLibrary").title}
      status={mockShellStatus(unsynced, syncing, standby)}
      onNavigateScreen={onNavigateScreen}
      onRefresh={() => { setSyncing(true); setTimeout(() => setSyncing(false), 900); }}
      {...(standby ? { banner: <Banner tone="sync" title={shellCopy.standby}>{shellCopy.standbyNotice}</Banner> } : {})}
    >
      <AssetLibrary
        locale={locale}
        presentation={presentation}
        listingSummaries={listingSummaries}
        query={query}
        onQueryChange={(value) => { setQuery(value); resetPageWindow(); }}
        filters={{ registrar, registrarOptions: mockRegistrars, status }}
        onFiltersChange={(next) => { setRegistrar(next.registrar); setStatus(next.status); resetPageWindow(); }}
        sort={sort}
        onSortChange={(key, direction) => setSort({ key, direction })}
        selectedIds={selected}
        onSelectionChange={setSelected}
        onWindowChange={(startIndex, size) => setPageWindow({ startIndex, size })}
        onOpenAsset={() => onNavigateScreen("domain-detail")}
        onRenew={() => onNavigateScreen("renew-desk")}
        onImportCsv={() => undefined}
        onCreatePlan={() => setBatchAction("price")}
        onBatchAction={(action) => setBatchAction(action)}
        onTargetPriceCommit={(row, amount) => {
          setRecords((current) => current.map((record) => record.row.id === row.id
            ? { ...record, row: { ...record.row, targetPrice: { currency: row.targetPrice?.currency ?? "USD", amount }, syncStatus: "pending" } }
            : record));
          setUnsynced((count) => count + 1);
        }}
        referenceDate={mockReferenceDate}
      />
      <MockBatchEdits
        locale={locale}
        action={batchAction}
        targets={batchTargets}
        onClose={() => setBatchAction(null)}
        onPlan={() => { setBatchAction(null); onNavigateScreen("batch-preview"); }}
        onRecords={() => commitSelected((record) => record)}
        onList={(change) => commitSelected((record) => ({
          ...record,
          listing: { ...record.listing, platforms: change.platforms },
          row: change.price === null ? record.row : { ...record.row, targetPrice: { currency: "USD", amount: change.price } },
        }))}
        onDelist={() => commitSelected((record) => ({ ...record, listing: { ...record.listing, platforms: [] } }))}
      />
    </MockShell>
  );
}
