import { connectionSettingsViewModelSchema, syncSettingsViewModelSchema, type ConnectionSettingsViewModel, type SyncSettingsViewModel } from "@gooddealer/client-core";

import type { AboutView, DeviceRuntimeEntry, DeviceRuntimeView, LicenseView } from "../../src/features/settings";

/** Mock connections adapted from brand/ui_kits/desktop/SettingsPanel.jsx. */
const connectionRows = [
  { id: "spaceship-main", provider: "Spaceship", alias: "main", category: "registrar", method: "oauth", summary: "812 域名 · 主注册商", health: "healthy", checked: "2026-08-20T06:02:00Z" },
  { id: "namecheap-main", provider: "Namecheap", alias: "main", category: "registrar", method: "api", summary: "142 域名", health: "healthy", checked: "2026-08-20T05:58:00Z" },
  { id: "dynadot-main", provider: "Dynadot", alias: "main", category: "registrar", method: "api", summary: "69 域名 · Token 过期", health: "action_required", checked: null },
  { id: "cloudflare-main", provider: "Cloudflare", alias: "main", category: "dns", method: "api", summary: "601 区域 · A/CNAME/TXT/MX", health: "healthy", checked: "2026-08-20T06:02:00Z" },
  { id: "atom-main", provider: "Atom", alias: "main", category: "marketplace", method: "api", summary: "511 Listing", health: "healthy", checked: "2026-08-20T06:01:00Z" },
  { id: "afternic-main", provider: "Afternic", alias: "main", category: "marketplace", method: "csv", summary: "601 Listing · 需 CSV 人工", health: "retained_unverified", checked: "2026-07-28T03:00:00Z" },
  { id: "sellerhub-main", provider: "SellerHub", alias: "main", category: "marketplace", method: null, summary: "尚未授权账户", health: "unconfigured", checked: null },
] as const;

const actionFor = { healthy: "manage", action_required: "reauthorize", unconfigured: "connect" } as const;

export function mockConnectionSettings(standby: boolean): ConnectionSettingsViewModel {
  const categories = ["registrar", "dns", "marketplace"] as const;
  return connectionSettingsViewModelSchema.parse({
    schemaVersion: 1,
    surface: standby ? "standby" : "active",
    groups: categories.map((category) => ({
      category,
      connections: connectionRows.filter((row) => row.category === category).map((row) => {
        const common = { providerConnectionId: row.id, provider: row.provider, accountAlias: row.alias, remoteAccountId: null, category, method: row.method, summary: row.summary };
        if (standby) {
          return { ...common, view: "standby", candidateState: row.health === "unconfigured" ? "never_configured" : "configured_candidate", admission: { actionAvailability: "unavailable" } };
        }
        const action = row.health in actionFor ? actionFor[row.health as keyof typeof actionFor] : null;
        return {
          ...common,
          view: "active",
          credentialHealth: row.health,
          quotaSummary: null,
          lastCheckedAt: row.checked,
          admission: action === null ? { actionAvailability: "unavailable" } : { actionAvailability: "available", action },
        };
      }),
    })),
  });
}

export function initialMockDevices(standby: boolean): DeviceRuntimeView {
  const devices: readonly DeviceRuntimeEntry[] = [
    { id: "macbook", name: "MacBook Pro", self: true, state: standby ? "standby" : "active", lastSeenLabel: "现在" },
    { id: "mini", name: "Mac mini", self: false, state: standby ? "active" : "standby", lastSeenLabel: "08:30" },
  ];
  // Standby cannot hand the lease to itself from here; only the holder admits handoff targets.
  return { leaseEpoch: 42, devices, handoffTargetIds: standby ? [] : ["mini"] };
}

/** The two-phase handoff the Host would run: drain the holder, activate the target, bump the epoch. */
export function mockHandoffPhase(view: DeviceRuntimeView, targetId: string, phase: "draining" | "complete"): DeviceRuntimeView {
  return {
    leaseEpoch: phase === "complete" && view.leaseEpoch !== null ? view.leaseEpoch + 1 : view.leaseEpoch,
    // After the handoff this device is Standby, so it no longer admits any target.
    handoffTargetIds: [],
    devices: view.devices.map((device) => {
      if (device.id === targetId) return { ...device, state: phase === "draining" ? "activating" : "active", lastSeenLabel: "现在" };
      if (device.state === "active" || device.state === "draining") return { ...device, state: phase === "draining" ? "draining" : "standby", lastSeenLabel: "现在" };
      return device;
    }),
  };
}

export const mockLicense: LicenseView = { planLabel: "年付 License", validUntil: "2026-12-31", ownershipVerified: true, workspaceSummary: "个人 · 4 平台 · 3 账户" };

export function mockSyncSettings(cadence: SyncSettingsViewModel["pullRefreshCadence"]): SyncSettingsViewModel {
  return syncSettingsViewModelSchema.parse({ schemaVersion: 1, kind: "sync_settings", businessSynchronization: "mandatory", pullRefreshCadence: cadence, conflictResolution: "manual_review" });
}

export const mockAbout: AboutView = { version: "0.9.0 · Tauri", dataDirectory: "~/Library/Application Support/GoodDealer", revisionBase: 8241 };
