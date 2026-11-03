import type { SyncSnapshotViewModel } from "@gooddealer/client-core";
import type { ReactNode } from "react";

export type ShellNavigationTone = "sync" | "gold" | "success" | "warning" | "danger";

export interface ShellNavigationItem {
  readonly id: string;
  readonly label: string;
  readonly icon: ReactNode;
  readonly count?: number;
  readonly tone?: ShellNavigationTone;
}

export interface ShellNavigationSection {
  readonly id: string;
  readonly label?: string;
  readonly items: readonly ShellNavigationItem[];
  /** "end" pins the section to the bottom of the rail. */
  readonly placement?: "start" | "end";
}

export type ShellDeviceRole = "active" | "standby";

export interface ShellDevice {
  readonly name: string;
  readonly role: ShellDeviceRole;
}

/**
 * Everything the status bar shows. It is a projection of Host facts (sync snapshot, lease, license);
 * the shell only renders it and never derives authority from it.
 */
export interface DesktopShellStatus {
  readonly sync: Pick<
    SyncSnapshotViewModel,
    "transport" | "activity" | "pendingMutationCount" | "appliedThroughServerRevision" | "lastReplicationActivityAt"
  >;
  readonly device: ShellDevice;
  readonly peerDevice: ShellDevice | null;
  readonly leaseEpoch: number | null;
  readonly license: "annual" | null;
  readonly providerSummary: { readonly providers: number; readonly accounts: number } | null;
}

export interface ShellCommand {
  readonly id: string;
  readonly label: string;
  readonly group?: string;
  readonly icon?: ReactNode;
}

export type ShellWindowPlatform = "macos" | "windows" | "linux";

/**
 * How the shell meets the native window. macOS keeps the OS traffic lights over an overlay title
 * bar; Windows and Linux run undecorated, so the shell draws controls and marks the drag region.
 * `framed` draws the rounded mock window used by the design host instead of filling a real window.
 */
export interface ShellWindowFrame {
  readonly platform: ShellWindowPlatform;
  readonly framed: boolean;
  readonly onMinimize?: () => void;
  readonly onToggleMaximize?: () => void;
  readonly onClose?: () => void;
}
