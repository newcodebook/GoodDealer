// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SellerHubBinPricePlan, SellerHubBinPricePort, SellerHubPort } from "@gooddealer/client-core";
import { SellerHubBinPricePanel } from "./sellerhub-bin-price-panel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const connectionId = "aa000000-0000-4000-8000-000000000001";
const planId = "aa000000-0000-4000-8000-000000000002";
const planHash = "a".repeat(64);
const createdAt = "2026-11-20T01:00:00Z";
const expiresAt = "2026-11-20T01:15:00Z";
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
  vi.restoreAllMocks();
});

function fixture() {
  let saved: SellerHubBinPricePlan | null = null;
  const port: SellerHubBinPricePort = {
    preview: vi.fn<SellerHubBinPricePort["preview"]>(async request => {
      saved = { schemaVersion: 1, connectionId, connectionLabel: "SellerHub", planId, planHash, expiresAt,
        state: "awaiting_approval",
        items: request.items.map(item => ({ ...item, previousPriceCents: 120_000, state: "preview", reason: null, retryAt: null })),
      };
      return saved;
    }),
    approve: vi.fn(async () => {
      if (!saved) throw new Error("invalid fixture");
      saved = { ...saved, state: "executing", items: saved.items.map(item => ({ ...item, state: "reconciling" })) };
      throw new Error("receipt lost");
    }),
    status: vi.fn<SellerHubBinPricePort["status"]>(async () => ({ schemaVersion: 1, writeQualified: true, writeEntitled: true, executionAvailable: true,
      recent: saved ? [{ planId, state: saved.state, connectionLabel: "SellerHub", createdAt }] : [], plan: saved,
    })),
  };
  const connectionsPort: SellerHubPort = {
    status: vi.fn<SellerHubPort["status"]>(async () => ({ schemaVersion: 1, observeQualified: true, observeEntitled: true, capturable: true,
      laneState: "ready", lastOperation: null, connections: [{ connectionId, state: "active", scanPending: false, lastScan: null }],
    })),
    submit: vi.fn(),
  };
  return { port, connectionsPort };
}

async function mount(ports: ReturnType<typeof fixture>, readOnly = false) {
  await act(async () => root.render(<SellerHubBinPricePanel locale="en-US" {...ports} readOnly={readOnly} onChanged={vi.fn()} />));
}

async function enterRows(value: string) {
  const select = container.querySelector<HTMLSelectElement>('select[name="connection"]')!;
  const rows = container.querySelector<HTMLTextAreaElement>("textarea")!;
  await act(async () => {
    select.value = connectionId; select.dispatchEvent(new Event("change", { bubbles: true }));
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(rows, value);
    rows.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => rows.form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
}

it("previews exact cents, confirms the frozen batch once and recovers a lost reply from status", async () => {
  const ports = fixture();
  await mount(ports);
  await enterRows("first.test,1250.50\nsecond.test,1301");
  expect(ports.port.preview).toHaveBeenCalledWith({
    schemaVersion: 1, connectionId, items: [{ domain: "first.test", priceCents: 125_050 }, { domain: "second.test", priceCents: 130_100 }],
  });
  expect(ports.port.approve).not.toHaveBeenCalled();
  const dialog = container.querySelector("dialog")!;
  expect(dialog.open).toBe(true);
  expect(dialog.textContent).toContain("$1,250.50");
  await act(async () => {
    dialog.close("approve");
  });
  expect(ports.port.approve).toHaveBeenCalledExactlyOnceWith({ schemaVersion: 1, planId, planHash });
  expect(container.textContent).toContain("Checking the account price");
  expect(container.textContent).toContain("The confirmation outcome is unknown");
  expect(container.querySelector("dialog")?.open).toBe(false);
});

it("rejects duplicate targets and keeps the action out of the standby view", async () => {
  const ports = fixture();
  await mount(ports);
  await enterRows("first.test,10\nfirst.test,11");
  expect(ports.port.preview).not.toHaveBeenCalled();
  expect(container.querySelector("textarea")?.getAttribute("aria-invalid")).toBe("true");
  await mount(ports, true);
  expect(container.querySelector("textarea")).toBeNull();
  expect(ports.port.approve).not.toHaveBeenCalled();
});
