import type { ReactNode } from "react";

import "./status-bar.css";

/**
 * Terminal-style bottom status bar (Warp/Ghostty direction) — mono, tabular, hairline-divided
 * segments. The always-on ledger of app state: sync, unsynced count, last sync, revision,
 * Active device, Epoch, License. See brand/README.md "NATIVE DESKTOP FORM".
 */
export interface StatusBarProps {
  /** Left segments — each becomes a hairline-divided cell. */
  left?: ReactNode[];
  /** Right segments. */
  right?: ReactNode[];
}

function withDividers(segments: ReactNode[]): ReactNode[] {
  const out: ReactNode[] = [];
  segments.forEach((segment, index) => {
    if (index > 0) out.push(<span key={`d${index}`} className="gd-statusbar-div"></span>);
    out.push(
      <span key={index} className="gd-statusbar-seg">
        {segment}
      </span>,
    );
  });
  return out;
}

export function StatusBar({ left = [], right = [] }: StatusBarProps) {
  return (
    <footer className="gd-statusbar">
      {withDividers(left)}
      <span className="gd-statusbar-spacer"></span>
      {withDividers(right)}
    </footer>
  );
}
