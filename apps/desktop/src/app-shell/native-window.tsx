import { getPresentationCopy, type Locale } from "@gooddealer/i18n";
import { WindowChrome } from "@gooddealer/ui";
import markUrl from "@gooddealer/ui/assets/logo/mark-16.svg";
import type { CSSProperties, ReactNode } from "react";

import type { ShellWindowFrame } from "./shell-contract";

export interface NativeWindowProps {
  readonly locale: Locale;
  readonly windowFrame: ShellWindowFrame;
  readonly context: ReactNode;
  readonly footer?: ReactNode;
  readonly style?: CSSProperties;
  readonly children?: ReactNode;
}

/**
 * The per-platform window frame shared by the workspace shell and the gate screens: macOS keeps
 * native traffic lights over an overlay title bar, Windows/Linux draw controls and a drag region.
 */
export function NativeWindow({ locale, windowFrame, context, footer, style, children }: NativeWindowProps) {
  const copy = getPresentationCopy(locale, "shell");
  return (
    <WindowChrome
      appName="GoodDealer"
      mark={<img src={markUrl} width="16" height="16" alt="" />}
      context={context}
      framed={windowFrame.framed}
      controls={windowFrame.platform === "macos" ? "none" : "trailing"}
      controlLabels={{ minimize: copy.minimizeWindow, maximize: copy.maximizeWindow, close: copy.closeWindow }}
      onMinimize={windowFrame.onMinimize}
      onToggleMaximize={windowFrame.onToggleMaximize}
      onClose={windowFrame.onClose}
      // Tauri starts a native window drag from elements carrying this marker.
      titlebarAttributes={{ "data-tauri-drag-region": "" }}
      {...(windowFrame.platform === "macos" ? {
        leading: (
          <span className="gd-desktop-shell-traffic" aria-hidden="true">
            {windowFrame.framed ? <><i /><i /><i /></> : null}
          </span>
        ),
      } : {})}
      {...(footer === undefined ? {} : { footer })}
      {...(style === undefined ? {} : { style })}
    >
      {children}
    </WindowChrome>
  );
}
