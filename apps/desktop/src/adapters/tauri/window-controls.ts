import { getCurrentWindow } from "@tauri-apps/api/window";

export type DesktopWindowPlatform = "macos" | "windows" | "linux";

/**
 * Title-bar controls for the undecorated Windows/Linux window. They reach only the current window
 * through the reviewed `core:window` minimize / toggle-maximize / close / start-dragging permissions.
 */
export interface DesktopWindowControlsPort {
  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  close(): Promise<void>;
}

export function createDesktopWindowControlsPort(): DesktopWindowControlsPort {
  return {
    minimize: async () => getCurrentWindow().minimize(),
    toggleMaximize: async () => getCurrentWindow().toggleMaximize(),
    close: async () => getCurrentWindow().close(),
  };
}

/**
 * Chooses title-bar presentation only. macOS keeps native traffic lights over an overlay title bar
 * (tauri.macos.conf.json); every other platform runs undecorated and draws its own controls.
 */
export function detectDesktopWindowPlatform(userAgent: string): DesktopWindowPlatform {
  if (/Mac OS X|Macintosh/u.test(userAgent)) return "macos";
  if (/Windows/u.test(userAgent)) return "windows";
  return "linux";
}
