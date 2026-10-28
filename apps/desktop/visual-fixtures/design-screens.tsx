import { plannedScreens, type DesignScreen } from "./screen-registry";
import { BatchScreen, batchVariants, type BatchVariant } from "./screens/batch-screen";
import { AssetLibraryScreen, assetLibraryVariants, type AssetLibraryVariant } from "./screens/asset-library-screen";
import { DomainDetailScreen, domainDetailVariants, type DomainDetailVariant } from "./screens/domain-detail-screen";
import { FoundationScreen } from "./screens/foundation-screen";

const designed: Readonly<Record<string, Pick<DesignScreen, "layout" | "variants" | "render">>> = {
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
