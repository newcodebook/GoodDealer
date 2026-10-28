import { defaultLocale, getPresentationCopy } from "@gooddealer/i18n";
import { Banner } from "@gooddealer/ui";
import { useEffect, useMemo, useState } from "react";

import { DomainDetail, type DomainDetailPresentation } from "../../src/features/portfolio/domain-detail";
import { MockShell, mockShellStatus } from "../mock/mock-shell";
import {
  initialMockAssets,
  mockDomainDetail,
  mockDomainSections,
  mockReferenceDate,
  type MockAssetRecord,
} from "../mock/workspace-fixtures";
import type { DesignWindowPlatform } from "../screen-registry";

export type DomainDetailVariant = "listed" | "unlisted" | "conflict" | "sold" | "standby" | "loading";

export const domainDetailVariants: readonly { readonly id: DomainDetailVariant; readonly label: string }[] = [
  { id: "listed", label: "在售" },
  { id: "unlisted", label: "未上架" },
  { id: "conflict", label: "冲突" },
  { id: "sold", label: "已售" },
  { id: "standby", label: "Standby · 只读" },
  { id: "loading", label: "读取中" },
];

const variantDomain: Readonly<Record<DomainDetailVariant, string>> = {
  listed: "kanban.ai",
  unlisted: "tessera.xyz",
  conflict: "lumen.dev",
  sold: "vault.io",
  standby: "kanban.ai",
  loading: "kanban.ai",
};

/** Mock-driven Domain Detail inside the production shell; edits update the mock record. */
export function DomainDetailScreen({ variant, platform, onNavigateScreen }: {
  readonly variant: DomainDetailVariant;
  readonly platform: DesignWindowPlatform;
  readonly onNavigateScreen: (id: string) => void;
}) {
  const locale = defaultLocale;
  const shellCopy = getPresentationCopy(locale, "shell");
  const [record, setRecord] = useState<MockAssetRecord>(() => {
    const found = initialMockAssets().find(({ row }) => row.domain === variantDomain[variant]);
    if (found === undefined) throw new Error("mock domain is missing");
    return found;
  });
  const [unsynced, setUnsynced] = useState(0);
  const [syncing, setSyncing] = useState(false);
  useEffect(() => {
    if (unsynced <= 0) return undefined;
    setSyncing(true);
    const timer = setTimeout(() => { setUnsynced(0); setSyncing(false); }, 1600);
    return () => clearTimeout(timer);
  }, [unsynced]);

  const standby = variant === "standby";
  const presentation: DomainDetailPresentation = useMemo(
    () => variant === "loading" ? { state: "loading" } : { state: "ready", data: mockDomainDetail(record, standby ? "standby" : null) },
    [variant, record, standby],
  );
  const commit = (next: MockAssetRecord) => { setRecord(next); setUnsynced((count) => count + 1); };

  return (
    <MockShell
      locale={locale}
      platform={platform}
      activeNavigationId="assets"
      title={record.row.domain}
      crumb={getPresentationCopy(locale, "assetLibrary").title}
      status={mockShellStatus(unsynced, syncing, standby)}
      onNavigateScreen={onNavigateScreen}
      {...(standby ? { banner: <Banner tone="sync" title={shellCopy.standby}>{shellCopy.standbyNotice}</Banner> } : {})}
    >
      <DomainDetail
        locale={locale}
        presentation={presentation}
        sections={mockDomainSections(record)}
        onBack={() => onNavigateScreen("asset-library")}
        onTargetPriceCommit={(amount) => commit({
          ...record,
          row: { ...record.row, targetPrice: { currency: record.row.targetPrice?.currency ?? "USD", amount }, syncStatus: "pending" },
        })}
        onAutoRenewChange={() => setUnsynced((count) => count + 1)}
        onTransferLockChange={() => setUnsynced((count) => count + 1)}
        onList={() => onNavigateScreen("batch-preview")}
        onDelist={() => commit({ ...record, listing: { ...record.listing, platforms: [] } })}
        onChangeNameserver={() => onNavigateScreen("batch-preview")}
        onEditRecords={() => onNavigateScreen("dns-verify")}
        onOpenRegistrar={() => undefined}
        onOpenConflicts={() => onNavigateScreen("conflict-center")}
        referenceDate={mockReferenceDate}
      />
    </MockShell>
  );
}
