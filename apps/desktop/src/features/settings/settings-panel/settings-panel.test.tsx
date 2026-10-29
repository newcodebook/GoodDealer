import { connectionSettingsViewModelSchema, syncSettingsViewModelSchema } from "@gooddealer/client-core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SettingsPanel } from "./settings-panel";
import { canHandoffTo, connectionStatus, type DeviceRuntimeView } from "./settings-contract";

const sync = syncSettingsViewModelSchema.parse({
  schemaVersion: 1, kind: "sync_settings", businessSynchronization: "mandatory", pullRefreshCadence: "every_5_minutes", conflictResolution: "manual_review",
});
const meta = { provider: "Spaceship", accountAlias: "main", remoteAccountId: null, category: "registrar", method: "oauth" } as const;
const activeConnections = connectionSettingsViewModelSchema.parse({
  schemaVersion: 1,
  surface: "active",
  groups: [{ category: "registrar", connections: [
    { ...meta, view: "active", providerConnectionId: "c1", summary: "812 域名", credentialHealth: "healthy", quotaSummary: null, lastCheckedAt: null, admission: { actionAvailability: "available", action: "manage" } },
    { ...meta, view: "active", providerConnectionId: "c2", provider: "Dynadot", summary: "69 域名", credentialHealth: "action_required", quotaSummary: null, lastCheckedAt: null, admission: { actionAvailability: "available", action: "reauthorize" } },
  ] }],
});
const standbyConnections = connectionSettingsViewModelSchema.parse({
  schemaVersion: 1,
  surface: "standby",
  groups: [{ category: "registrar", connections: [
    { ...meta, view: "standby", providerConnectionId: "c1", summary: "812 域名", candidateState: "configured_candidate", admission: { actionAvailability: "unavailable" } },
  ] }],
});
const devices: DeviceRuntimeView = {
  leaseEpoch: 42,
  devices: [
    { id: "mac", name: "MacBook Pro", self: true, state: "active", lastSeenLabel: "现在" },
    { id: "mini", name: "Mac mini", self: false, state: "standby", lastSeenLabel: "08:30" },
    { id: "air", name: "MacBook Air", self: false, state: "standby", lastSeenLabel: "06-12" },
  ],
  handoffTargetIds: ["mini"],
};
const about = { version: "0.9.0", dataDirectory: "~/GoodDealer", revisionBase: 8241 };
const noop = () => undefined;

describe("Settings panel", () => {
  it("offers a handoff only to standby devices the Host admits", () => {
    const html = renderToStaticMarkup(
      <SettingsPanel locale="zh-CN" connections={activeConnections} devices={devices} onHandoff={noop} license={null} sync={sync} about={about} />,
    );
    expect(html.match(/>移交执行权</gu)).toHaveLength(1);
    expect(html).toContain("Epoch 42");
    expect(html).not.toContain("Sunset");
  });

  it("maps connection admission to exactly one action per row", () => {
    const html = renderToStaticMarkup(
      <SettingsPanel locale="zh-CN" initialSection="connections" connections={activeConnections} onConnectionAction={noop} devices={devices} license={null} sync={sync} about={about} />,
    );
    expect(html).toContain(">管理<");
    expect(html).toContain(">重新授权<");
    expect(html).toContain("需重新授权");
  });

  it("never claims a verified connection or offers actions on Standby", () => {
    const html = renderToStaticMarkup(
      <SettingsPanel locale="zh-CN" initialSection="connections" connections={standbyConnections} onConnectionAction={noop} devices={devices} license={null} sync={sync} about={about} />,
    );
    expect(html).toContain("曾配置候选");
    expect(html).toContain("未验证，切换为 Active 后才能检查");
    expect(html).not.toContain(">已连接<");
    expect(html).not.toMatch(/class="gd-btn[^"]*"[^>]*>(管理|重新授权|连接)</u);
  });

  it("reports mandatory synchronization without a way to turn it off", () => {
    const html = renderToStaticMarkup(
      <SettingsPanel locale="zh-CN" initialSection="sync" connections={activeConnections} devices={devices} license={null} sync={sync} about={about} />,
    );
    expect(html).toMatch(/<input type="checkbox" disabled="" checked=""\/>/u);
    expect(html).not.toContain(">仅手动<");
  });
});

describe("Settings contract", () => {
  it("fails closed on handoff targets that are not admitted standby devices", () => {
    expect(canHandoffTo(devices, "mini")).toBe(true);
    expect(canHandoffTo(devices, "air")).toBe(false);
    expect(canHandoffTo(devices, "mac")).toBe(false);
    expect(canHandoffTo(devices, "ghost")).toBe(false);
    const draining: DeviceRuntimeView = { ...devices, devices: devices.devices.map((device) => device.id === "mac" ? { ...device, state: "draining" } : device) };
    expect(canHandoffTo(draining, "mini")).toBe(false);
  });

  it("keeps Standby connection status unverified", () => {
    const [connection] = standbyConnections.groups[0]?.connections ?? [];
    expect(connection === undefined ? null : connectionStatus(connection)).toEqual({ tone: "neutral", copyKey: "configuredCandidate" });
  });
});
