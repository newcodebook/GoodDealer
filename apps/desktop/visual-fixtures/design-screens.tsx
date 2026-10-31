import { plannedScreens, type DesignScreen } from "./screen-registry";
import { BatchScreen, batchVariants, type BatchVariant } from "./screens/batch-screen";
import { AssetLibraryScreen, assetLibraryVariants, type AssetLibraryVariant } from "./screens/asset-library-screen";
import { DomainDetailScreen, domainDetailVariants, type DomainDetailVariant } from "./screens/domain-detail-screen";
import { ConflictScreen, DnsScreen, conflictVariants, dnsVariants } from "./screens/dns-conflict-screens";
import { FoundationScreen } from "./screens/foundation-screen";
import { ActivationScreen, RuntimeStatusScreen, SignInScreen, activationVariants, runtimeStatusVariants, signInVariants } from "./screens/gate-screens";
import { HistoryScreen, TaskScreen, readOnlyVariants } from "./screens/operations-screens";
import { RenewalScreen } from "./screens/renewal-screen";
import { SalesScreen, salesVariants } from "./screens/sales-screen";
import { SettingsScreen, settingsVariants } from "./screens/settings-screen";

const designed: Readonly<Record<string, Pick<DesignScreen, "layout" | "variants" | "render">>> = {
  signin: {
    layout: "app",
    variants: signInVariants,
    render: ({ variant, platform }) => <SignInScreen variant={variant} platform={platform} />,
  },
  "runtime-status": {
    layout: "app",
    variants: runtimeStatusVariants,
    render: ({ variant, platform }) => <RuntimeStatusScreen variant={variant} platform={platform} />,
  },
  onboarding: {
    layout: "app",
    variants: activationVariants,
    render: ({ variant, navigate }) => <ActivationScreen variant={variant} onNavigateScreen={navigate} />,
  },
  "asset-library": {
    layout: "app",
    variants: assetLibraryVariants,
    render: ({ variant, platform, navigate }) => <AssetLibraryScreen variant={variant as AssetLibraryVariant} platform={platform} onNavigateScreen={navigate} />,
  },
  "domain-detail": {
    layout: "app",
    variants: domainDetailVariants,
    render: ({ variant, platform, navigate }) => <DomainDetailScreen variant={variant as DomainDetailVariant} platform={platform} onNavigateScreen={navigate} />,
  },
  "batch-preview": {
    layout: "app",
    variants: batchVariants,
    render: ({ variant, platform, navigate }) => <BatchScreen variant={variant as BatchVariant} platform={platform} onNavigateScreen={navigate} />,
  },
  "renew-desk": {
    layout: "app",
    render: ({ platform, navigate }) => <RenewalScreen platform={platform} onNavigateScreen={navigate} />,
  },
  "dns-verify": {
    layout: "app",
    variants: dnsVariants,
    render: ({ variant, platform, navigate }) => <DnsScreen variant={variant} platform={platform} onNavigateScreen={navigate} />,
  },
  "sales-desk": {
    layout: "app",
    variants: salesVariants,
    render: ({ variant, platform, navigate }) => <SalesScreen variant={variant} platform={platform} onNavigateScreen={navigate} />,
  },
  "conflict-center": {
    layout: "app",
    variants: conflictVariants,
    render: ({ variant, platform, navigate }) => <ConflictScreen variant={variant} platform={platform} onNavigateScreen={navigate} />,
  },
  "history-log": {
    layout: "app",
    variants: readOnlyVariants,
    render: ({ variant, platform, navigate }) => <HistoryScreen variant={variant} platform={platform} onNavigateScreen={navigate} />,
  },
  "task-inbox": {
    layout: "app",
    variants: readOnlyVariants,
    render: ({ variant, platform, navigate }) => <TaskScreen variant={variant} platform={platform} onNavigateScreen={navigate} />,
  },
  settings: {
    layout: "app",
    variants: settingsVariants,
    render: ({ variant, platform, navigate }) => <SettingsScreen variant={variant} platform={platform} onNavigateScreen={navigate} />,
  },
};

/** Every screen in review order; a planned entry becomes "designed" once it has a renderer. */
export function designScreens(): readonly DesignScreen[] {
  return [
    { id: "foundation", group: "基础", title: "设计基础", kitSource: "../../README.md", backing: "host", status: "designed", layout: "page", render: () => <FoundationScreen /> },
    ...plannedScreens().map((screen) => {
      const implementation = designed[screen.id];
      return implementation === undefined ? screen : { ...screen, ...implementation, status: "designed" as const };
    }),
  ];
}
