// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SellerHubCreateDetail, SellerHubCreatePort, SellerHubPort } from "@gooddealer/client-core";
import { SellerHubCreatePanel } from "./sellerhub-create-panel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const connectionId = "bb000000-0000-4000-8000-000000000001";
const planId = "bb000000-0000-4000-8000-000000000002";
const planHash = "b".repeat(64);
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

function fixture() {
  let saved: SellerHubCreateDetail | null = null;
  const port: SellerHubCreatePort = {
    preview: vi.fn<SellerHubCreatePort["preview"]>(async request => {
      const preview = {
        schemaVersion: 1 as const,
        connectionId,
        planId,
        planHash,
        expiresAt: "2026-11-20T01:15:00Z",
        items: request.items.map(item => ({
          ...item, currency: "USD" as const, binPriceEnabled: true as const, minPriceEnabled: false as const,
        })),
      };
      saved = { preview, phase: "awaiting_approval", items: preview.items.map(({ domain }) => ({ domain, state: "planned" })) };
      return preview;
    }),
    approve: vi.fn(async () => {
      if (!saved) throw new Error("no saved plan");
      saved = { ...saved, phase: "executing", items: saved.items.map(({ domain }) => ({ domain, state: "ownership_pending" })) };
      throw new Error("receipt lost");
    }),
    status: vi.fn<SellerHubCreatePort["status"]>(async request => ({
      schemaVersion: 1,
      writeQualified: true,
      writeEntitled: true,
      executionAvailable: true,
      recent: saved ? [{ planId, phase: saved.phase, count: saved.items.length }] : [],
      plan: request.planId === planId ? saved : null,
    })),
  };
  const connectionsPort: SellerHubPort = {
    status: vi.fn<SellerHubPort["status"]>(async () => ({
      schemaVersion: 1, observeQualified: true, observeEntitled: true, capturable: true,
      laneState: "ready", lastOperation: null, connections: [{ connectionId, state: "active", scanPending: false, lastScan: null }],
    })),
    submit: vi.fn(),
  };
  return { port, connectionsPort };
}

async function mount(ports: ReturnType<typeof fixture>, readOnly = false) {
  await act(async () => root.render(<SellerHubCreatePanel locale="en-US" {...ports} readOnly={readOnly} onChanged={vi.fn()} />));
}

async function preview() {
  const select = container.querySelector<HTMLSelectElement>('select[name="connection"]')!;
  const rows = container.querySelector<HTMLTextAreaElement>("textarea")!;
  await act(async () => {
    select.value = connectionId;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(rows, "example.test,1250.50");
    rows.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => rows.form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
}

function confirmButton() {
  return [...container.querySelectorAll("button")].find(button => button.textContent === "Confirm batch listing");
}

it("confirms a saved preview once and recovers an interrupted receipt and a reopened view", async () => {
  const ports = fixture();
  await mount(ports);
  await preview();
  expect(ports.port.preview).toHaveBeenCalledExactlyOnceWith({
    schemaVersion: 1, connectionId, items: [{ domain: "example.test", priceCents: 125_050 }],
  });
  expect(ports.port.approve).not.toHaveBeenCalled();
  expect(container.textContent).toContain("$1,250.50");
  expect(document.activeElement?.textContent).toBe("Review fixed-price listings");
  const confirm = confirmButton()!;
  await act(async () => { confirm.click(); confirm.click(); });
  expect(ports.port.approve).toHaveBeenCalledExactlyOnceWith({ schemaVersion: 1, planId, planHash });
  expect(container.textContent).toContain("The confirmation outcome is unknown");
  expect(container.textContent).toContain("Waiting for ownership verification");
  expect(confirmButton()).toBeUndefined();

  await act(async () => root.unmount());
  root = createRoot(container);
  await mount(ports);
  expect(ports.port.status).toHaveBeenCalledWith({ schemaVersion: 1, planId: null });
  expect(ports.port.status).toHaveBeenLastCalledWith({ schemaVersion: 1, planId });
  expect(container.textContent).toContain("Waiting for ownership verification");
  expect(ports.port.approve).toHaveBeenCalledTimes(1);
});

it("keeps saved plans readable when current authority no longer allows confirmation", async () => {
  const ports = fixture();
  await mount(ports);
  await preview();
  expect(confirmButton()).toBeDefined();
  await mount(ports, true);
  expect(container.querySelector("textarea")).toBeNull();
  expect(container.textContent).toContain("example.test");
  expect(confirmButton()).toBeUndefined();
  expect(ports.port.approve).not.toHaveBeenCalled();
});
