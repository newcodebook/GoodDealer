import type { CSSProperties, ReactNode } from "react";

import "./window-chrome.css";

export interface WindowChromeControlLabels {
  readonly minimize: string;
  readonly maximize: string;
  readonly close: string;
}

export interface WindowChromeProps {
  /** @default "GoodDealer" */
  appName?: string;
  mark?: ReactNode;
  context?: ReactNode;
  footer?: ReactNode;
  /**
   * `true` draws the rounded, shadowed window used for mock and marketing surfaces. A real native
   * window passes `false`: the operating system owns the outer frame and shadow.
   */
  framed?: boolean;
  /** Content before the brand, e.g. the inset reserved for macOS traffic lights. */
  leading?: ReactNode;
  /** "trailing" renders minimize / maximize / close at the right; "none" leaves them to the OS. */
  controls?: "trailing" | "none";
  controlLabels?: WindowChromeControlLabels;
  onMinimize?: (() => void) | undefined;
  onToggleMaximize?: (() => void) | undefined;
  onClose?: (() => void) | undefined;
  /** Host-specific attributes for the title bar, such as a native drag-region marker. */
  titlebarAttributes?: Readonly<Record<`data-${string}`, string>>;
  children?: ReactNode;
  style?: CSSProperties;
}

const defaultControlLabels: WindowChromeControlLabels = { minimize: "最小化", maximize: "最大化", close: "关闭" };

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
  framed = true,
  leading,
  controls = "trailing",
  controlLabels = defaultControlLabels,
  onMinimize,
  onToggleMaximize,
  onClose,
  titlebarAttributes,
  children,
  style,
}: WindowChromeProps) {
  return (
    <div className={framed ? "gd-window" : "gd-window gd-window--native"} style={style}>
      <div className="gd-titlebar" {...titlebarAttributes}>
        {leading}
        <span className="gd-tb-brand">
          {mark}
          {appName}
        </span>
        {context ? <span className="gd-tb-context">{context}</span> : null}
        {controls === "trailing" ? (
          <span className="gd-tb-ctl">
            <button type="button" tabIndex={-1} aria-label={controlLabels.minimize} onClick={onMinimize}>
              <ChromeGlyph>
                <path d="M1 5h8" />
              </ChromeGlyph>
            </button>
            <button type="button" tabIndex={-1} aria-label={controlLabels.maximize} onClick={onToggleMaximize}>
              <ChromeGlyph>
                <rect x="1.4" y="1.4" width="7.2" height="7.2" rx="1" />
              </ChromeGlyph>
            </button>
            <button type="button" tabIndex={-1} className="gd-tb-close" aria-label={controlLabels.close} onClick={onClose}>
              <ChromeGlyph>
                <path d="M1.5 1.5l7 7" />
                <path d="M8.5 1.5l-7 7" />
              </ChromeGlyph>
            </button>
          </span>
        ) : null}
      </div>
      <div className="gd-window-body">{children}</div>
      {footer}
    </div>
  );
}
