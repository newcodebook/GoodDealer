import type { ConnectionSettingsItemViewModel } from "@gooddealer/client-core";

export type SettingsSection = "connections" | "devices" | "license" | "sync" | "about";
export const settingsSections: readonly SettingsSection[] = ["connections", "devices", "license", "sync", "about"];

/**
 * Execution devices as the Host reports them. There is no composed settings contract yet, so
 * these shapes are Desktop-local and supplied by the design host. Sunset/LocalContinuation
 * artifacts are deliberately absent: they never appear in the everyday device list.
 */
export interface DeviceRuntimeEntry {
  readonly id: string;
  readonly name: string;
  readonly self: boolean;
  readonly state: "active" | "standby" | "activating" | "draining";
  readonly lastSeenLabel: string;
}

export interface DeviceRuntimeView {
  /** Epoch of the lease currently held, or null while no device holds one. */
  readonly leaseEpoch: number | null;
  readonly devices: readonly DeviceRuntimeEntry[];
  /** Standby devices the Host admits as handoff targets; empty whenever a handoff is not allowed. */
  readonly handoffTargetIds: readonly string[];
}

export interface LicenseView {
  readonly planLabel: string;
  readonly validUntil: string;
  readonly ownershipVerified: boolean;
  readonly workspaceSummary: string;
}

export interface AboutView {
  readonly version: string;
  readonly dataDirectory: string;
  readonly revisionBase: number;
}

/** The device that holds, or is releasing, the current lease. */
export function leaseHolder(view: DeviceRuntimeView): DeviceRuntimeEntry | null {
  return view.devices.find((device) => device.state === "active" || device.state === "draining") ?? null;
}

/**
 * A handoff target must be a Standby device the Host admitted while a lease holder exists;
 * anything else fails closed so a stale or forged target id never opens the confirmation.
 */
export function canHandoffTo(view: DeviceRuntimeView, deviceId: string): boolean {
  const target = view.devices.find((device) => device.id === deviceId);
  return target !== undefined && target.state === "standby" && leaseHolder(view)?.state === "active" && view.handoffTargetIds.includes(deviceId);
}

export type ConnectionTone = "success" | "warning" | "sync" | "neutral";

/** Badge tone and copy key for one redacted connection; Standby never claims a verified state. */
export function connectionStatus(connection: ConnectionSettingsItemViewModel): { readonly tone: ConnectionTone; readonly copyKey: ConnectionCopyKey } {
  if (connection.view === "standby") {
    return connection.candidateState === "configured_candidate" ? { tone: "neutral", copyKey: "configuredCandidate" }
      : connection.candidateState === "never_configured" ? { tone: "neutral", copyKey: "neverConfiguredOnDevice" }
        : { tone: "neutral", copyKey: "unknown" };
  }
  switch (connection.credentialHealth) {
    case "healthy": return { tone: "success", copyKey: "connected" };
    case "unconfigured": return { tone: "neutral", copyKey: "notConnected" };
    case "capturing":
    case "authenticating": return { tone: "sync", copyKey: "authorizing" };
    case "verifying": return { tone: "sync", copyKey: "verifying" };
    case "retained_unverified": return { tone: "warning", copyKey: "retainedNotVerified" };
    case "invalid":
    case "action_required":
    case "revoked": return { tone: "warning", copyKey: "reauthorizationRequired" };
  }
}

export type ConnectionCopyKey =
  | "configuredCandidate"
  | "neverConfiguredOnDevice"
  | "unknown"
  | "connected"
  | "notConnected"
  | "authorizing"
  | "verifying"
  | "retainedNotVerified"
  | "reauthorizationRequired";
