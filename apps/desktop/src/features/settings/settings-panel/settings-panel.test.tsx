import { connectionSettingsViewModelSchema, parseSettingsRead, projectConnectionSettings, syncSettingsViewModelSchema } from "@gooddealer/client-core";
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

describe("Settings from the Host projection", () => {
  const connections = projectConnectionSettings(parseSettingsRead({
    schemaVersion: 1, kind: "settings", readGeneration: 1,
    freshness: { source: "active_local", readOnlyReason: null, serverRevision: 7, lastReplicationActivityAt: null, lastSuccessfulProviderObservationAt: null, canEdit: true },
    connections: [{
      providerKind: "cloudflare", connectionLabel: "Cloudflare 主账号", lifecycleStatus: "active", validationStatus: "valid",
      credentialUseState: "active", lastValidatedAt: "2026-01-02T03:04:05Z",
      roles: [{ role: "dns", availability: "unavailable", unavailableReason: "qualification_pending" }],
    }],
  }), () => "能力资格认证前不可用，暂不能执行任何操作");
  const render = (initialSection: "connections" | "devices" | "license" | "sync" | "about") => renderToStaticMarkup(
    <SettingsPanel
      locale="zh-CN"
      initialSection={initialSection}
      connections={connections}
      devices={null}
      license="unavailable"
      sync={null}
      about={{ version: null, dataDirectory: null, revisionBase: 7 }}
    />,
  );

  it("shows connections with unqualified capabilities and no connection controls", () => {
    const html = render("connections");
    expect(html).toContain("Cloudflare 主账号");
    expect(html).toContain("能力资格认证前不可用");
    // The action slot stays empty: connect, reauthorize and manage need Host capabilities not composed yet.
    expect(html).toContain('<span class="settings-conn-action"></span>');
    for (const control of ["重新授权", "新增账户连接", "重新运行接入向导", "浏览器 Profile"]) expect(html).not.toContain(control);
    // An old validation keeps its date instead of reading as a time today.
    expect(html).toMatch(/01[/-]0[12]/u);
  });

  it("lists a non-Cloudflare connection under each role it declares, unavailable and without a guessed method", () => {
    const multi = projectConnectionSettings(parseSettingsRead({
      schemaVersion: 1, kind: "settings", readGeneration: 1,
      freshness: { source: "active_local", readOnlyReason: null, serverRevision: 7, lastReplicationActivityAt: null, lastSuccessfulProviderObservationAt: null, canEdit: true },
      connections: [
        {
          providerKind: "cloudflare", connectionLabel: "CF", lifecycleStatus: "active", validationStatus: "valid",
          credentialUseState: "active", lastValidatedAt: null,
          roles: [{ role: "dns", availability: "unavailable", unavailableReason: "qualification_pending" }],
        },
        {
          providerKind: "spaceship", connectionLabel: "SellerHub", lifecycleStatus: "active", validationStatus: "valid",
          credentialUseState: "active", lastValidatedAt: null,
          roles: [
            { role: "registrar", availability: "unavailable", unavailableReason: "qualification_pending" },
            { role: "marketplace", availability: "unavailable", unavailableReason: "qualification_pending" },
          ],
        },
      ],
    }), () => "能力资格认证前不可用");
    const groups = Object.fromEntries(multi.groups.map((group) => [group.category, group.connections.map((connection) => [connection.provider, connection.method])]));
    // Spaceship's connection method is recorded in its own ADR-0027 phase, so none is shown yet.
    expect(groups).toEqual({ registrar: [["Spaceship", null]], dns: [["Cloudflare", "api"]], marketplace: [["Spaceship", null]] });
    for (const locale of ["zh-CN", "en-US"] as const) {
      const html = renderToStaticMarkup(
        <SettingsPanel locale={locale} initialSection="connections" connections={multi} devices={null} license="unavailable" sync={null} about={{ version: null, dataDirectory: null, revisionBase: 7 }} />,
      );
      expect(html.match(/>Spaceship</gu)).toHaveLength(2);
      // Only Cloudflare's row carries a method tag; no row offers an action.
      expect(html.match(/>API</gu)).toHaveLength(1);
      expect(html).not.toContain(">OAuth<");
      expect(html.match(/<span class="settings-conn-action"><\/span>/gu)).toHaveLength(3);
    }
  });

  it("says each section without a Host source is unavailable instead of inventing values", () => {
    expect(render("devices")).toContain("设备列表与执行权移交尚未接入 Host");
    expect(render("devices")).not.toContain("移交执行权<");
    expect(render("license")).toContain("许可状态尚未接入 Host");
    const sync = render("sync");
    expect(sync).toContain("总是人工裁决");
    expect(sync).not.toContain("每 5 分钟");
    const about = render("about");
    expect(about).toContain("暂不可用");
    expect(about).toContain(">7<");
  });
});
