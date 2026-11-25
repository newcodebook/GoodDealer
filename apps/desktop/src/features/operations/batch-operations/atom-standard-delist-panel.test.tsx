// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { AtomMarketplacePort, AtomStandardDelistPort, AtomStandardDelistStatus } from "@gooddealer/client-core";
import { AtomStandardDelistPanel } from "./atom-standard-delist-panel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("confirms the closed preview once and shows an unknown result after a lost confirmation reply", async () => {
  const connectionId = "aa000000-0000-4000-8000-000000000001";
  const planId = "aa000000-0000-4000-8000-000000000002";
  const planHash = "a".repeat(64);
  const createdAt = "2026-11-20T01:00:00Z";
  const expiresAt = "2026-11-20T01:15:00Z";
  let plan: AtomStandardDelistStatus["plan"] = null;
  const port: AtomStandardDelistPort = {
    preview: vi.fn<AtomStandardDelistPort["preview"]>(async request => {
      plan = { planId, planHash, connectionId, expiresAt, state: "awaiting_approval",
        items: request.domains.map(domain => ({ domain, state: "awaiting_approval", reason: null, retryAt: null })) };
      return { schemaVersion: 1, planId, planHash, connectionId, expiresAt, domains: request.domains };
    }),
    approve: vi.fn(async () => {
      if (!plan) throw new Error("fixture must preview first");
      plan = { ...plan, state: "executing", items: plan.items.map(({ domain }) => ({
        domain, state: "outcome_unknown", reason: "read_failed", retryAt: expiresAt,
      })) };
      throw new Error("reply lost");
    }),
    status: vi.fn<AtomStandardDelistPort["status"]>(async () => ({
      schemaVersion: 1, executionAvailable: true, recent: plan === null ? [] : [{ planId, connectionLabel: "Atom", createdAt }], plan,
    })),
  };
  const connectionsPort: AtomMarketplacePort = {
    status: async () => ({ schemaVersion: 1, laneState: "ready", capturable: true, observeEntitled: true, observeQualified: true,
      lastOperation: null, connections: [{ connectionId, state: "active", scanPending: false, lastScan: {
        observed: 2, imported: 2, skipped: 0, completedAt: createdAt, standardReview: { observed: 2, sample: ["first.test", "second.test"] },
      } }] }),
    submit: vi.fn(),
  };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<AtomStandardDelistPanel locale="en-US" port={port} connectionsPort={connectionsPort} readOnly={false} />));
    const connection = container.querySelector("select")!;
    const domains = container.querySelector("textarea")!;
    await act(async () => {
      connection.value = connectionId;
      connection.dispatchEvent(new Event("change", { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(domains, "first.test\nsecond.test");
      domains.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => domains.form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(port.preview).toHaveBeenCalledExactlyOnceWith({ schemaVersion: 1, connectionId, domains: ["first.test", "second.test"] });
    const dialog = container.querySelector("dialog")!;
    expect(dialog.open).toBe(true);
    expect(port.approve).not.toHaveBeenCalled();
    await act(async () => dialog.close("approve"));
    expect(port.approve).toHaveBeenCalledExactlyOnceWith({ schemaVersion: 1, planId, planHash });
    expect(container.textContent).toContain("Removal unverified");
    expect(container.textContent).toContain("The latest read could not verify removal.");
    await act(async () => root.render(<AtomStandardDelistPanel locale="en-US" port={port} connectionsPort={connectionsPort} readOnly />));
    expect(container.querySelector("textarea")).toBeNull();
    expect(container.textContent).toContain("Removal unverified");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
