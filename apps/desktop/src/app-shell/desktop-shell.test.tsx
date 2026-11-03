import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DesktopShell, type DesktopShellStatus, type ShellWindowFrame } from "./index";

function status(overrides: Partial<DesktopShellStatus> = {}, sync: Partial<DesktopShellStatus["sync"]> = {}): DesktopShellStatus {
  return {
    sync: {
      transport: "reachable",
      activity: "idle",
      pendingMutationCount: 3,
      appliedThroughServerRevision: 8241,
      lastReplicationActivityAt: null,
      ...sync,
    },
    device: { name: "MacBook Pro", role: "active" },
    peerDevice: { name: "Mac mini", role: "standby" },
    leaseEpoch: 41,
    license: "annual",
    providerSummary: { providers: 4, accounts: 3 },
    ...overrides,
  };
}

function render(shellStatus: DesktopShellStatus, frame: ShellWindowFrame = { platform: "windows", framed: false }): string {
  return renderToStaticMarkup(
    <DesktopShell
      locale="zh-CN"
      title="资产库"
      navigation={[
        { id: "assets", label: "资产", items: [{ id: "assets", label: "资产库", icon: null }] },
        { id: "settings", placement: "end", items: [{ id: "settings", label: "设置", icon: null }] },
      ]}
      activeNavigationId="assets"
      status={shellStatus}
      windowFrame={frame}
    >
      <p>content</p>
    </DesktopShell>,
  );
}

describe("DesktopShell", () => {
  it("renders the native window, rail, command trigger, and composed content", () => {
    const html = render(status());

    expect(html).toContain("个人 Workspace · 资产库");
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("gd-navrail-section--end");
    expect(html).toContain("搜索域名或输入命令");
    expect(html).toContain("凭据本地加密");
    expect(html).toContain("<p>content</p>");
  });

  it("shows the sync ledger, unsynced count, and the Active device in the status bar", () => {
    const html = render(status());

    expect(html).toContain("SYNCED");
    expect(html).toContain("未同步");
    expect(html).toContain("gd-desktop-shell-pending");
    expect(html).toContain("MacBook Pro");
    expect(html).toContain("gd-desktop-shell-active");
  });

  it("labels Standby without the Active gold treatment", () => {
    const html = render(status({ device: { name: "MacBook Pro", role: "standby" }, peerDevice: null }));

    expect(html).toContain("Standby");
    expect(html).not.toContain("gd-desktop-shell-active");
  });

  it("draws window controls and a drag region on Windows and Linux", () => {
    const html = render(status());

    expect(html).toContain("data-tauri-drag-region");
    expect(html).toContain('aria-label="最小化"');
    expect(html).toContain("gd-window--native");
  });

  it("leaves the controls to macOS traffic lights and reserves their inset", () => {
    const html = render(status(), { platform: "macos", framed: false });

    expect(html).not.toContain('aria-label="最小化"');
    expect(html).toContain("gd-desktop-shell-traffic");
    expect(html).not.toContain("<i>");
    expect(html).toContain("⌘K");
    expect(render(status())).toContain("Ctrl K");
  });

  it("reports transport problems instead of a healthy sync label", () => {
    expect(render(status({}, { transport: "offline" }))).toContain("设备断网");
    expect(render(status({}, { transport: "checking" }))).toContain("SYNCING");
  });
});
