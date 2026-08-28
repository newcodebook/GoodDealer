import type { CSSProperties, ReactNode } from "react";

import "./diff-value.css";

export interface DiffValueProps { oldValue?: ReactNode; newValue?: ReactNode; mono?: boolean; size?: number; style?: CSSProperties }

export function DiffValue({ oldValue, newValue, mono = true, size = 12, style }: DiffValueProps) {
  return <span className={`gd-diff${mono ? " gd-diff--mono" : ""}`} style={{ fontSize: size, ...style }}><span className="gd-diff-old">{oldValue ?? "—"}</span><svg aria-hidden="true" width="11" height="8" viewBox="0 0 12 8" fill="none"><path d="M1 4H10M10 4L7 1M10 4L7 7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /></svg><span className="gd-diff-new">{newValue ?? "—"}</span></span>;
}
