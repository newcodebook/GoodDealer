import { formatDate, formatNumber, getPresentationCopy, type Locale } from "@gooddealer/i18n";
import {
  AppShell,
  CommandMenu,
  IconButton,
  NavigationRail,
  RefreshCwIcon,
  SearchIcon,
  StatusBar,
  StatusDot,
  Toolbar,
  WindowChrome,
  type CommandMenuItem,
  type NavigationRailSection,
} from "@gooddealer/ui";
import keyholeUrl from "@gooddealer/ui/assets/icons/keyhole.svg";
import markUrl from "@gooddealer/ui/assets/logo/mark-16.svg";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";

import type { DesktopShellStatus, ShellCommand, ShellDevice, ShellNavigationSection, ShellWindowFrame } from "./shell-contract";
import "./desktop-shell.css";

export interface DesktopShellProps {
  readonly locale: Locale;
  readonly title: string;
  readonly crumb?: string;
  readonly navigation: readonly ShellNavigationSection[];
  readonly activeNavigationId?: string;
  readonly onNavigate?: (id: string) => void;
  readonly status: DesktopShellStatus;
  readonly windowFrame: ShellWindowFrame;
  readonly commands?: readonly ShellCommand[];
  readonly onCommand?: (id: string) => void;
  readonly onRefresh?: () => void;
  readonly banner?: ReactNode;
  readonly children?: ReactNode;
}

/** Status-bar segments the kit drops first as the window narrows (≥980 / ≥1180). */
const secondaryWidth = 980;
const tertiaryWidth = 1180;

function useElementWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(1280);
  useEffect(() => {
    const element = ref.current;
    if (element === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry !== undefined) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/** Native desktop shell: title bar, rail, command toolbar, and the terminal-style status ledger. */
export function DesktopShell({
  locale,
  title,
  crumb,
  navigation,
  activeNavigationId,
  onNavigate,
  status,
  windowFrame,
  commands = [],
  onCommand,
  onRefresh,
  banner,
  children,
}: DesktopShellProps) {
  const copy = getPresentationCopy(locale, "shell");
  const [rootRef, width] = useElementWidth<HTMLDivElement>();
  const [commandOpen, setCommandOpen] = useState(false);
  const shortcut = windowFrame.platform === "macos" ? copy.commandShortcut : "Ctrl K";

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const railSections: NavigationRailSection[] = navigation.map((section) => ({
    key: section.id,
    ...(section.label === undefined ? {} : { label: section.label }),
    ...(section.placement === undefined ? {} : { placement: section.placement }),
    items: section.items.map((item) => ({
      key: item.id,
      label: item.label,
      textLabel: item.label,
      icon: item.icon,
      ...(item.count === undefined ? {} : { count: item.count }),
      ...(item.tone === undefined ? {} : { tone: item.tone }),
    })),
  }));

  const commandItems: CommandMenuItem[] = commands.map((command) => ({
    key: command.id,
    label: command.label,
    textValue: command.label,
    ...(command.icon === undefined ? {} : { icon: command.icon }),
    ...(command.group === undefined ? {} : { group: command.group }),
  }));

  return (
    <div ref={rootRef} className="gd-desktop-shell">
      <WindowChrome
        appName="GoodDealer"
        mark={<img src={markUrl} width="16" height="16" alt="" />}
        context={`${copy.personalWorkspace} · ${title}`}
        framed={windowFrame.framed}
        controls={windowFrame.platform === "macos" ? "none" : "trailing"}
        controlLabels={{ minimize: copy.minimizeWindow, maximize: copy.maximizeWindow, close: copy.closeWindow }}
        onMinimize={windowFrame.onMinimize}
        onToggleMaximize={windowFrame.onToggleMaximize}
        onClose={windowFrame.onClose}
        // Tauri starts a native window drag from elements carrying this marker.
        titlebarAttributes={{ "data-tauri-drag-region": "" }}
        {...(windowFrame.platform === "macos" ? {
          leading: (
            <span className="gd-desktop-shell-traffic" aria-hidden="true">
              {windowFrame.framed ? <><i /><i /><i /></> : null}
            </span>
          ),
        } : {})}
        footer={<ShellStatusBar locale={locale} status={status} width={width} />}
      >
        <AppShell
          navigation={(
            <NavigationRail
              sections={railSections}
              {...(activeNavigationId === undefined ? {} : { activeKey: activeNavigationId })}
              {...(onNavigate === undefined ? {} : { onSelect: onNavigate })}
              label={copy.mainNavigationLabel}
              footer={(
                <div className="gd-desktop-shell-trust">
                  <img src={keyholeUrl} width="14" height="14" alt="" />
                  <span>{copy.credentialEncryptedLocally}<br />{copy.credentialNeverUploaded}</span>
                </div>
              )}
            />
          )}
          toolbar={(
            <Toolbar
              label={copy.workspaceToolbarLabel}
              left={(
                <>
                  <span className="gd-desktop-shell-title">{title}</span>
                  {crumb === undefined ? null : <span className="gd-desktop-shell-crumb">{crumb}</span>}
                </>
              )}
              right={(
                <>
                  <button type="button" className="gd-desktop-shell-command" onClick={() => setCommandOpen(true)}>
                    <SearchIcon size={13} />
                    <span>{copy.searchPlaceholder}</span>
                    <kbd>{shortcut}</kbd>
                  </button>
                  {onRefresh === undefined ? null : (
                    <IconButton size="sm" label={copy.refreshProvider} onClick={onRefresh}>
                      <RefreshCwIcon size={14} className={status.sync.activity === "syncing" ? "gd-desktop-shell-spin" : undefined} />
                    </IconButton>
                  )}
                </>
              )}
            />
          )}
          banner={banner}
          commandMenu={(
            <CommandMenu
              open={commandOpen}
              onClose={() => setCommandOpen(false)}
              items={commandItems}
              placeholder={copy.searchPlaceholder}
              emptyText={copy.noMatchingCommands}
              label={copy.commandMenuLabel}
              onSelect={(item) => {
                setCommandOpen(false);
                onCommand?.(item.key);
              }}
            />
          )}
        >
          {children}
        </AppShell>
      </WindowChrome>
    </div>
  );
}

function ShellStatusBar({ locale, status, width }: { readonly locale: Locale; readonly status: DesktopShellStatus; readonly width: number }) {
  const copy = getPresentationCopy(locale, "shell");
  const { sync } = status;
  const showSecondary = width >= secondaryWidth;
  const showTertiary = width >= tertiaryWidth;
  const syncing = sync.activity === "syncing" || sync.transport === "checking";
  const syncLabel = sync.transport === "offline"
    ? copy.deviceOffline
    : sync.transport === "blocked" ? copy.degraded : syncing ? copy.syncing : copy.synced;
  const syncDot = sync.transport === "offline" ? "warning" : sync.transport === "blocked" ? "danger" : "sync";
  const lastSync = sync.lastReplicationActivityAt === null
    ? "—"
    : formatDate(locale, Date.parse(sync.lastReplicationActivityAt), {
      timeStyle: "short",
      hour12: false,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });

  const left: ReactNode[] = [
    <StatusDot key="sync" kind={syncDot} pulse={syncing} size={7} label={syncLabel} />,
    <span key="unsynced">
      {copy.unsynced} <span className={sync.pendingMutationCount > 0 ? "gd-desktop-shell-pending" : "gd-desktop-shell-faint"}>{formatNumber(locale, sync.pendingMutationCount)}</span>
    </span>,
  ];
  if (showSecondary) left.push(<span key="last" className="gd-desktop-shell-faint">{copy.lastSync}{syncing ? "…" : lastSync}</span>);
  if (showTertiary) left.push(<span key="rev" className="gd-desktop-shell-faint">{copy.revisionShort} {formatNumber(locale, sync.appliedThroughServerRevision)}</span>);

  const right: ReactNode[] = [];
  if (showSecondary && status.providerSummary !== null) {
    right.push(
      <span key="providers" className="gd-desktop-shell-faint">
        {status.providerSummary.providers} {copy.providers} · {status.providerSummary.accounts} {copy.accountsUnit}
      </span>,
    );
  }
  right.push(<DeviceSegment key="device" locale={locale} device={status.device} />);
  if (showSecondary && status.peerDevice !== null) right.push(<DeviceSegment key="peer" locale={locale} device={status.peerDevice} />);
  if (showTertiary && status.leaseEpoch !== null) right.push(<span key="epoch" className="gd-desktop-shell-faint">{copy.epoch} {status.leaseEpoch}</span>);
  if (showTertiary && status.license === "annual") right.push(<span key="license" className="gd-desktop-shell-faint">{copy.annualLicense}</span>);

  return <StatusBar left={left} right={right} />;
}

function DeviceSegment({ locale, device }: { readonly locale: Locale; readonly device: ShellDevice }) {
  const copy = getPresentationCopy(locale, "shell");
  const active = device.role === "active";
  return (
    <span className="gd-desktop-shell-device">
      {device.name}
      <StatusDot kind={active ? "active" : "standby"} size={7} />
      <span className={active ? "gd-desktop-shell-active" : undefined}>{active ? copy.active : copy.standby}</span>
    </span>
  );
}
