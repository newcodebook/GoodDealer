import type { CSSProperties, ReactNode } from "react";

import "./window-chrome.css";

export interface WindowChromeProps {
  /** @default "GoodDealer" */
  appName?: string;
  mark?: ReactNode;
  context?: ReactNode;
  footer?: ReactNode;
  onClose?: (() => void) | undefined;
  children?: ReactNode;
  style?: CSSProperties;
}

function ChromeGlyph({ children }: { readonly children: ReactNode }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
    >
      {children}
    </svg>
  );
}

export function WindowChrome({
  appName = "GoodDealer",
  mark,
  context,
  footer,
  onClose,
  children,
  style,
}: WindowChromeProps) {
  return (
    <div className="gd-window" style={style}>
      <div className="gd-titlebar">
        <span className="gd-tb-brand">
          {mark}
          {appName}
        </span>
        {context ? <span className="gd-tb-context">{context}</span> : null}
        <span className="gd-tb-ctl">
          <button type="button" tabIndex={-1} aria-label="最小化">
            <ChromeGlyph>
              <path d="M1 5h8" />
            </ChromeGlyph>
          </button>
          <button type="button" tabIndex={-1} aria-label="最大化">
            <ChromeGlyph>
              <rect x="1.4" y="1.4" width="7.2" height="7.2" rx="1" />
            </ChromeGlyph>
          </button>
          <button type="button" tabIndex={-1} className="gd-tb-close" aria-label="关闭" onClick={onClose}>
            <ChromeGlyph>
              <path d="M1.5 1.5l7 7" />
              <path d="M8.5 1.5l-7 7" />
            </ChromeGlyph>
          </button>
        </span>
      </div>
      <div className="gd-window-body">{children}</div>
      {footer}
    </div>
  );
}
