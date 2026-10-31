import { getAccountCopy, type Locale } from "@gooddealer/i18n";
import {
  AppShell,
  DatabaseIcon,
  DownloadIcon,
  IconButton,
  KeyRoundIcon,
  LogOutIcon,
  MonitorIcon,
  NavigationRail,
  ReceiptIcon,
  RefreshCwIcon,
  SettingsIcon,
  ShieldCheckIcon,
  type NavigationRailSection,
} from "@gooddealer/ui";
import markUrl from "@gooddealer/ui/assets/logo/mark-flat.svg";
import { useSyncExternalStore, type ReactNode } from "react";

import type { AccountRouteId } from "./account-route";
import "./account-shell.css";

export interface AccountShellProps {
  readonly locale: Locale;
  readonly title: string;
  readonly crumb?: string;
  /** Routes the account may open; anything else is never rendered as a link. */
  readonly availableRouteIds: readonly AccountRouteId[];
  readonly activeRouteId: AccountRouteId;
  readonly onNavigate: (routeId: AccountRouteId) => void;
  readonly onSignOut: () => void;
  readonly signingOut?: boolean;
  readonly onRefresh?: () => void;
  readonly refreshing?: boolean;
  readonly banner?: ReactNode;
  readonly status?: ReactNode;
  readonly children: ReactNode;
}

const sectionRoutes = {
  account: ["license", "devices", "billing"],
  securityData: ["security", "cloudData"],
  footer: ["settings", "download"],
} as const satisfies Record<string, readonly AccountRouteId[]>;

/** Matches the CSS breakpoint where the sidebar narrows to an icon rail. */
const compactQuery = "(max-width: 760px)";

function subscribeCompact(onChange: () => void): () => void {
  const query = window.matchMedia(compactQuery);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** Server rendering has no viewport, so it renders the full rail. */
function useCompactRail(): boolean {
  return useSyncExternalStore(subscribeCompact, () => window.matchMedia(compactQuery).matches, () => false);
}

/** Web-native account shell: brand sidebar, top bar, content, and an optional status bar. */
export function AccountShell(props: AccountShellProps) {
  const { locale, title, crumb, availableRouteIds, activeRouteId, onNavigate, onSignOut, signingOut, onRefresh, refreshing, banner, status, children } = props;
  const copy = getAccountCopy(locale, "accountShell");
  // A narrow rail collapses to icons with tooltips and aria labels instead of clipping the labels.
  const compact = useCompactRail();
  const icons: Record<AccountRouteId, ReactNode> = {
    license: <KeyRoundIcon size={16} />,
    devices: <MonitorIcon size={16} />,
    billing: <ReceiptIcon size={16} />,
    security: <ShieldCheckIcon size={16} />,
    cloudData: <DatabaseIcon size={16} />,
    settings: <SettingsIcon size={16} />,
    download: <DownloadIcon size={16} />,
  };
  const items = (ids: readonly AccountRouteId[]) => ids
    .filter((id) => availableRouteIds.includes(id))
    .map((id) => ({ key: id, label: copy[id], textLabel: copy[id], icon: icons[id] }));
  const sections: NavigationRailSection[] = [
    { key: "account", label: copy.accountSection, items: items(sectionRoutes.account) },
    { key: "security-data", label: copy.securityDataSection, items: items(sectionRoutes.securityData) },
    { key: "footer", items: items(sectionRoutes.footer), placement: "end" as const },
  ].filter((section) => section.items.length > 0);

  return (
    <div className="account-shell">
      <AppShell
        navigation={(
          <aside className="account-sidebar">
            <div className="account-brand">
              <img src={markUrl} width="22" height="22" alt="" />
              <div className="account-brand-text">
                <span className="account-brand-name">{copy.productName}</span>
                <span className="account-brand-sub">{copy.brandSubtitle}</span>
              </div>
            </div>
            <NavigationRail
              label={copy.navigationLabel}
              sections={sections}
              activeKey={activeRouteId}
              collapsed={compact}
              onSelect={(key) => {
                const target = availableRouteIds.find((id) => id === key);
                if (target !== undefined) onNavigate(target);
              }}
              footer={(
                <div className="account-identity">
                  <span className="account-identity-state">{copy.signedIn}</span>
                  <IconButton size="sm" label={copy.signOut} disabled={signingOut === true} onClick={onSignOut}><LogOutIcon size={14} /></IconButton>
                </div>
              )}
            />
          </aside>
        )}
        toolbar={(
          <header className="account-topbar">
            <h1 className="account-title">{title}</h1>
            {crumb === undefined ? null : <span className="account-crumb">{crumb}</span>}
            {onRefresh === undefined ? null : (
              <div className="account-topbar-actions">
                <IconButton size="sm" label={copy.refresh} disabled={refreshing === true} onClick={onRefresh}>
                  <RefreshCwIcon size={14} className={refreshing === true ? "account-spin" : undefined} />
                </IconButton>
              </div>
            )}
          </header>
        )}
        {...(banner === undefined ? {} : { banner })}
        {...(status === undefined ? {} : { status })}
      >
        {children}
      </AppShell>
    </div>
  );
}
