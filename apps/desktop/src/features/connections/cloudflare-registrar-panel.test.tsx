// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { CloudflareConnectionStatus } from "../../adapters/tauri";
import { CloudflareRegistrarPanel } from "./cloudflare-registrar-panel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("submits once and displays the durable import from the background lane", async () => {
  vi.useFakeTimers();
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  const initial: CloudflareConnectionStatus = { schemaVersion: 1, state: "ready", connectionRef: "cloudflare-ref",
    displayLabel: "Cloudflare", qualified: true, capturable: true, lastOperation: null, readGeneration: 1,
    registrar: { lastScan: null, lastOutcome: null } };
  const saved: CloudflareConnectionStatus = { ...initial, readGeneration: 2,
    registrar: { lastOutcome: "confirmed", lastScan: { observed: 4, imported: 3, skipped: 1, completedAt: "2026-11-20T00:00:00Z" } } };
  const status = vi.fn<() => Promise<CloudflareConnectionStatus>>().mockRejectedValueOnce(new Error("status unavailable")).mockResolvedValueOnce(initial)
    .mockResolvedValueOnce({ ...initial, state: "busy" }).mockResolvedValue(saved);
  const refreshRegistrar = vi.fn(async () => undefined);
  const changed = vi.fn();
  const port = { status, refreshRegistrar };
  try {
    await act(async () => root.render(<CloudflareRegistrarPanel locale="zh-CN" port={port} writable onChanged={changed} />));
    expect(container.querySelector('[role="status"]')?.textContent).toContain("暂时无法读取");
    await act(async () => container.querySelector("button")?.click());
    expect(refreshRegistrar).not.toHaveBeenCalled();
    const button = container.querySelector("button")!;
    expect(button.disabled).toBe(false);
    await act(async () => button.click());
    expect(button.disabled).toBe(true);
    expect(refreshRegistrar).toHaveBeenCalledExactlyOnceWith("cloudflare-ref");
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(container.querySelector('[role="status"]')?.textContent).toBe("读取 4 个，新增 3 个，跳过 1 个。");
    expect(changed).toHaveBeenCalledTimes(1);
    expect(refreshRegistrar).toHaveBeenCalledTimes(1);
    await act(async () => root.render(<CloudflareRegistrarPanel locale="zh-CN" port={port} writable={false} onChanged={changed} />));
    expect(button.disabled).toBe(true);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
  }
});
