import { getPresentationCopy, type Locale } from "@gooddealer/i18n";
import {
  AlertTriangleIcon,
  CoinsIcon,
  GlobeIcon,
  HistoryIcon,
  InboxIcon,
  ListChecksIcon,
  SettingsIcon,
  ShieldIcon,
} from "@gooddealer/ui";
import type { ReactNode } from "react";

import { DesktopShell, type DesktopShellStatus, type ShellNavigationSection } from "../../src/app-shell";
import type { DesignWindowPlatform } from "../screen-registry";
import { mockSyncSnapshot } from "./workspace-fixtures";

/** Kit navigation ids → design host screen ids, so the mock rail navigates between designed screens. */
export const navigationScreenIds: Readonly<Record<string, string>> = {
  assets: "asset-library",
  sales: "sales-desk",
  dns: "dns-verify",
  batch: "batch-preview",
  conflicts: "conflict-center",
  inbox: "task-inbox",
  history: "history-log",
  settings: "settings",
};

function mockNavigation(locale: Locale): readonly ShellNavigationSection[] {
  const copy = getPresentationCopy(locale, "shell");
  return [
    {
      id: "assets",
      label: copy.assets,
      items: [
        { id: "assets", label: copy.assetLibrary, icon: <GlobeIcon /> },
        { id: "sales", label: copy.sales, icon: <CoinsIcon /> },
        { id: "dns", label: copy.dns, icon: <ShieldIcon /> },
      ],
    },
    {
      id: "execution",
      label: copy.execution,
      items: [
        { id: "batch", label: copy.batches, icon: <ListChecksIcon /> },
        { id: "conflicts", label: copy.conflicts, icon: <AlertTriangleIcon />, count: 6, tone: "danger" },
        { id: "inbox", label: copy.manualTasks, icon: <InboxIcon />, count: 4, tone: "warning" },
        { id: "history", label: copy.history, icon: <HistoryIcon /> },
      ],
    },
    { id: "settings", placement: "end", items: [{ id: "settings", label: copy.settings, icon: <SettingsIcon /> }] },
  ];
}

export function mockShellStatus(pendingMutationCount: number, syncing: boolean, standby = false): DesktopShellStatus {
  return {
    sync: mockSyncSnapshot(pendingMutationCount, syncing),
    device: { name: "MacBook Pro", role: standby ? "standby" : "active" },
    peerDevice: { name: "Mac mini", role: standby ? "active" : "standby" },
    leaseEpoch: 41,
    license: "annual",
    providerSummary: { providers: 4, accounts: 3 },
  };
}

export interface MockShellProps {
  readonly locale: Locale;
  readonly platform: DesignWindowPlatform;
  readonly activeNavigationId: string;
  readonly title: string;
  readonly crumb?: string;
  readonly status: DesktopShellStatus;
  readonly onNavigateScreen: (screenId: string) => void;
  readonly onRefresh?: () => void;
  readonly banner?: ReactNode;
  readonly children?: ReactNode;
}

/** The production DesktopShell, fed mock navigation and status for design review. */
export function MockShell({ locale, platform, activeNavigationId, title, crumb, status, onNavigateScreen, onRefresh, banner, children }: MockShellProps) {
  const navigation = mockNavigation(locale);
  const commands = navigation.flatMap((section) => section.items.map((item) => ({
    id: item.id,
    label: item.label,
    icon: item.icon,
    group: section.label ?? getPresentationCopy(locale, "shell").settings,
  })));
  const go = (id: string) => {
    const screenId = navigationScreenIds[id];
    if (screenId !== undefined) onNavigateScreen(screenId);
  };
  return (
    <DesktopShell
      locale={locale}
      title={title}
      {...(crumb === undefined ? {} : { crumb })}
      navigation={navigation}
      activeNavigationId={activeNavigationId}
      onNavigate={go}
      status={status}
      windowFrame={{ platform, framed: true }}
      commands={commands}
      onCommand={go}
      {...(onRefresh === undefined ? {} : { onRefresh })}
      banner={banner}
    >
      {children}
    </DesktopShell>
  );
}
