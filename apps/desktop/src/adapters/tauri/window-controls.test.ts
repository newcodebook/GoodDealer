import { beforeEach, describe, expect, it, vi } from "vitest";

const { currentWindow } = vi.hoisted(() => ({
  currentWindow: { minimize: vi.fn(), toggleMaximize: vi.fn(), close: vi.fn() },
}));

vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => currentWindow }));

import { createDesktopWindowControlsPort, detectDesktopWindowPlatform } from "./window-controls";

describe("Desktop window controls", () => {
  beforeEach(() => {
    for (const control of Object.values(currentWindow)) control.mockReset();
  });

  it("drives only the current window's minimize, maximize toggle, and close", async () => {
    const controls = createDesktopWindowControlsPort();

    await controls.minimize();
    await controls.toggleMaximize();
    await controls.close();

    expect(currentWindow.minimize).toHaveBeenCalledOnce();
    expect(currentWindow.toggleMaximize).toHaveBeenCalledOnce();
    expect(currentWindow.close).toHaveBeenCalledOnce();
  });

  it("detects the title-bar platform from the WebView user agent", () => {
    expect(detectDesktopWindowPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 15_6) AppleWebKit/605.1.15")).toBe("macos");
    expect(detectDesktopWindowPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Edg/141.0")).toBe("windows");
    expect(detectDesktopWindowPlatform("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15")).toBe("linux");
  });
});
