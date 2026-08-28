import { getPresentationCopy, type Locale } from "@gooddealer/i18n";
import {
  AppShell,
  Banner,
  GlobeIcon,
  NavigationRail,
  SettingsIcon,
  ShieldIcon,
  Toolbar,
  WindowChrome,
  type NavigationRailSection,
} from "@gooddealer/ui";
import markUrl from "@gooddealer/ui/assets/logo/mark-flat.svg";
import { useEffect, useState, type ReactNode } from "react";

import {
  createDefaultShellRoutes,
  isShellNavigationRouteId,
  selectEligibleShellRoute,
  type ShellNavigationRouteId,
  type ShellRouteIcon,
  type ShellRouteId,
} from "./route-contract";
import "./desktop-shell.css";

export interface DesktopShellBanner {
  readonly tone: "sync" | "gold" | "success" | "warning" | "danger" | "neutral";
  readonly title: string;
  readonly description: string;
}

export interface DesktopShellProps {
  readonly locale: Locale;
  readonly title: string;
  readonly activeRouteId?: ShellRouteId;
  readonly eligibleRouteIds: readonly ShellRouteId[];
  readonly banner?: DesktopShellBanner;
  readonly onRouteSelect?: (routeId: ShellNavigationRouteId) => void;
  readonly children?: ReactNode;
}

const iconByName = {
  globe: GlobeIcon,
  shield: ShieldIcon,
  settings: SettingsIcon,
} as const satisfies Readonly<Record<ShellRouteIcon, typeof GlobeIcon>>;

function useCompactNavigation(): boolean {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 1079px)");
    const update = () => setCompact(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return compact;
}

export function DesktopShell({
  locale,
  title,
  activeRouteId,
  eligibleRouteIds,
  banner,
  onRouteSelect,
  children,
}: DesktopShellProps) {
  const compact = useCompactNavigation();
  const shellCopy = getPresentationCopy(locale, "shell");
  const routes = createDefaultShellRoutes(locale, eligibleRouteIds);
  const sections: readonly NavigationRailSection[] = [{
    key: "read-navigation",
    label: shellCopy.assets,
    items: routes.map((route) => {
      const Icon = iconByName[route.icon];
      return {
        key: route.id,
        label: route.label,
        textLabel: route.label,
        icon: <Icon size={15} />,
      };
    }),
  }];

  return (
    <WindowChrome
      appName="GoodDealer"
      mark={<img src={markUrl} width="18" height="18" alt="" />}
      context={title}
      style={{ minWidth: 760 }}
    >
      <div className="gd-desktop-shell">
        <AppShell
          navigation={(
            <NavigationRail
              sections={sections}
              {...(isShellNavigationRouteId(activeRouteId) ? { activeKey: activeRouteId } : {})}
              collapsed={compact}
              label={shellCopy.mainNavigationLabel}
              onSelect={(routeId) => selectEligibleShellRoute(routeId, eligibleRouteIds, onRouteSelect)}
            />
          )}
          toolbar={<Toolbar left={<strong className="gd-desktop-shell-title">{title}</strong>} label={shellCopy.workspaceToolbarLabel} />}
          banner={banner === undefined ? undefined : (
            <Banner tone={banner.tone} title={banner.title}>{banner.description}</Banner>
          )}
        >
          {children}
        </AppShell>
      </div>
    </WindowChrome>
  );
}
