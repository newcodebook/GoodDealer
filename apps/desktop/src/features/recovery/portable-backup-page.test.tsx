// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { runPortableBackup } from "../../adapters/tauri/portable-backup";
import { PortableBackupPage } from "./portable-backup-page";

vi.mock("../../adapters/tauri/portable-backup", () => ({ runPortableBackup: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("opens, exports and closes an independent backup from a signed-out page", async () => {
  const node = document.body.appendChild(document.createElement("div"));
  const root = createRoot(node);
  const port = vi.mocked(runPortableBackup);
  const back = vi.fn();
  const viewId = "portable-0123456789abcdef0123456789abcdef";
  port.mockResolvedValueOnce({
    state: "opened",
    viewId,
    createdAt: "2026-11-20T00:00:00Z",
    rows: [{ entityId: "example.com", note: "archived", portfolioId: null, tags: ["owned"], targetPrice: null }],
    next: null,
  }).mockResolvedValueOnce({ state: "export_saved" }).mockResolvedValueOnce({ state: "closed" });

  const click = (label: string) => {
    const button = Array.from(node.querySelectorAll("button")).find((candidate) => candidate.textContent?.trim() === label);
    if (button === undefined) throw new Error(`missing button ${label}`);
    button.click();
  };
  try {
    await act(async () => root.render(<PortableBackupPage locale="en-US" windowFrame={{ platform: "windows", framed: false }} canCreate={false} onBack={back} />));
    expect(node.textContent).not.toContain("Create encrypted backup");
    expect(node.querySelector("input")).toBeNull();
    await act(async () => click("Open offline backup"));
    expect(node.querySelector("table")?.textContent).toContain("example.com");
    expect(port).toHaveBeenNthCalledWith(1, { action: "open", locale: "en-US" });
    await act(async () => click("Export as JSON"));
    expect(port).toHaveBeenNthCalledWith(2, { action: "export", viewId, locale: "en-US" });
    expect(node.querySelector('[role="status"]')?.textContent).toBe("The domain JSON file was saved.");
    await act(async () => click("Back"));
    expect(port).toHaveBeenNthCalledWith(3, { action: "close", viewId });
    expect(back).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
    node.remove();
  }
});
