// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CloudflareConnectionStatus } from "../../adapters/tauri";
import type { CloudflareConnectionPort } from "./cloudflare-notice";
import { CloudflareRetirementPanel } from "./cloudflare-retirement-panel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const candidate = { connectionRef: "opaque", displayLabel: "Cloudflare DNS", pending: false };
const status: CloudflareConnectionStatus = { schemaVersion: 1 as const, state: "ready" as const, connectionRef: "opaque", displayLabel: "Cloudflare DNS", qualified: false, capturable: true, lastOperation: null, readGeneration: 1 };
function port(): CloudflareConnectionPort {
  return {
    status: vi.fn(async () => status),
    retirementCandidates: vi.fn(async () => [candidate]),
    purge: vi.fn(async () => undefined), create: vi.fn(), activate: vi.fn(), revoke: vi.fn(),
  };
}
let container: HTMLDivElement;
let root: Root;
beforeEach(() => { container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); });
async function mount(native: CloudflareConnectionPort, changed = vi.fn()) {
  await act(async () => root.render(<CloudflareRetirementPanel locale="zh-CN" port={native} onChanged={changed} />));
}
async function click(label: string) {
  const button = [...container.querySelectorAll("button")].find((item) => item.textContent === label);
  expect(button).toBeDefined();
  await act(async () => button?.click());
}

describe("Cloudflare local cleanup", () => {
  it("requires first confirmation and explains permanent local cleanup versus remote revocation", async () => {
    const native = port();
    await mount(native);
    await click("清理");
    expect(native.purge).not.toHaveBeenCalled();
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain("不会撤销 Cloudflare 上的 Token");
    expect(container.textContent).toContain("无法撤回");
    await click("取消");
    expect(native.purge).not.toHaveBeenCalled();
    await click("清理");
    vi.mocked(native.retirementCandidates).mockResolvedValueOnce([]);
    vi.mocked(native.status).mockResolvedValueOnce({ ...status, lastOperation: { kind: "purge", outcome: "confirmed" } });
    await click("确认清理");
    expect(native.purge).toHaveBeenCalledExactlyOnceWith("opaque", "confirm_retirement");
    expect(container.textContent).toContain("本机清理已完成");
  });

  it("resumes pending requests without confirmation and preserves unknown results", async () => {
    const native = port();
    vi.mocked(native.retirementCandidates).mockResolvedValue([{ ...candidate, pending: true }]);
    await mount(native);
    expect(container.textContent).toContain("清理未完成");
    await click("重试清理");
    expect(native.purge).toHaveBeenCalledExactlyOnceWith("opaque", "retry_pending");
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.textContent).toContain("无法确认清理结果");
    expect(container.textContent).not.toContain("本机清理已完成");
  });

  it("re-reads durable status after a lost response instead of repeating first confirmation", async () => {
    const native = port();
    await mount(native);
    await click("清理");
    vi.mocked(native.purge).mockRejectedValueOnce(new Error("lost response"));
    vi.mocked(native.retirementCandidates).mockResolvedValue([{ ...candidate, pending: true }]);
    await click("确认清理");
    expect(container.textContent).toContain("重试清理");
    expect(native.purge).toHaveBeenCalledTimes(1);
    await click("重试清理");
    expect(native.purge).toHaveBeenLastCalledWith("opaque", "retry_pending");
  });

  it("polls only status while the lane owns cleanup and never re-submits deletion", async () => {
    vi.useFakeTimers();
    const native = port();
    await mount(native);
    await click("清理");
    vi.mocked(native.status).mockResolvedValueOnce({ ...status, state: "busy" }).mockResolvedValueOnce({ ...status, lastOperation: { kind: "purge", outcome: "confirmed" } });
    vi.mocked(native.retirementCandidates).mockResolvedValueOnce([]);
    await click("确认清理");
    expect(container.textContent).toContain("正在清理");
    expect(native.purge).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(container.textContent).toContain("本机清理已完成");
    expect(native.purge).toHaveBeenCalledTimes(1);
  });

  it("keeps unsupported or busy hosts from reaching the confirmation action", async () => {
    const native = port();
    vi.mocked(native.status).mockResolvedValue({ ...status, capturable: false });
    await mount(native);
    expect(container.textContent).toContain("仅 macOS");
    await click("清理");
    expect(native.purge).not.toHaveBeenCalled();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
});
