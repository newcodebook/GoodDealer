// @vitest-environment happy-dom
import type { SpaceshipRegistrarStatus } from "@gooddealer/client-core";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { SpaceshipRegistrarPanel } from "./spaceship-registrar-panel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("connects once, reads the saved scan and preserves it after a later failed refresh", async () => {
  vi.useFakeTimers();
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  const initial: SpaceshipRegistrarStatus = {
    schemaVersion: 1, laneState: "ready", observeEntitled: true, observeQualified: true, capturable: true,
    lastOperation: null, connections: [],
  };
  const id = "11111111-1111-4111-a111-111111111111";
  const saved: SpaceshipRegistrarStatus = {
    ...initial,
    lastOperation: { kind: "spaceship_connect", outcome: "confirmed" },
    connections: [{ connectionId: id, state: "active", scanPending: false,
      lastScan: { observed: 4, imported: 3, skipped: 1, completedAt: "2026-11-20T00:00:00Z" } }],
  };
  const failed: SpaceshipRegistrarStatus = {
    ...saved,
    lastOperation: { kind: "spaceship_refresh", outcome: "provider_response_rejected" },
  };
  const port = {
    submit: vi.fn(async () => undefined),
    status: vi.fn<() => Promise<SpaceshipRegistrarStatus>>().mockResolvedValueOnce(initial)
      .mockResolvedValueOnce({ ...initial, laneState: "busy" })
      .mockResolvedValueOnce(saved)
      .mockResolvedValue(failed),
  };
  const onChanged = vi.fn();
  const render = (writable: boolean) => root.render(<SpaceshipRegistrarPanel locale="zh-CN" port={port} writable={writable} onChanged={onChanged} />);
  const button = (text: string) => [...container.querySelectorAll("button")].find((node) => node.textContent === text)!;
  try {
    await act(async () => render(true));
    expect(container.querySelector("input")).toBeNull();
    await act(async () => { button("连接 Spaceship").click(); button("连接 Spaceship").click(); });
    expect(port.submit).toHaveBeenCalledExactlyOnceWith({ action: "connect", schemaVersion: 1 });
    expect(button("连接 Spaceship").disabled).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(container.textContent).toContain("读取 4 个，新增 3 个，跳过 1 个。");
    expect(onChanged).toHaveBeenCalledTimes(1);
    await act(async () => button("刷新注册域名").click());
    expect(port.submit).toHaveBeenLastCalledWith({ action: "refresh", schemaVersion: 1, connectionId: id });
    expect(container.querySelector('[role="status"]')?.textContent).toContain("未通过校验");
    expect(container.textContent).toContain("读取 4 个，新增 3 个，跳过 1 个。");
    await act(async () => render(false));
    expect(button("连接 Spaceship")).toBeUndefined();
    expect(button("断开连接")).toBeUndefined();
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
  }
});
