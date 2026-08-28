import type { CSSProperties, ReactNode } from "react";
import "./toolbar.css";
export interface ToolbarProps { left?: ReactNode; right?: ReactNode; region?: boolean; style?: CSSProperties; label?: string }
export function Toolbar({ left, right, region, style, label }: ToolbarProps) { return <div className={`gd-toolbar${region ? " gd-toolbar--region" : ""}`} style={style} role="toolbar" aria-label={label}><div className="gd-toolbar-side">{left}</div><span className="gd-toolbar-spacer" /><div className="gd-toolbar-side">{right}</div></div>; }
