import type { CSSProperties, ReactNode } from "react";
import "./panel.css";
export interface PanelProps { title?: ReactNode; actions?: ReactNode; flush?: boolean; seamed?: boolean; children?: ReactNode; style?: CSSProperties }
export function Panel({ title, actions, flush, seamed, children, style }: PanelProps) { return <section className={`gd-panel${flush ? " gd-panel--flush" : ""}${seamed ? " gd-panel--seamed" : ""}`} style={style}>{title || actions ? <header className="gd-panel-head"><span className="gd-panel-title">{title}</span>{actions}</header> : null}<div className="gd-panel-body">{children}</div></section>; }
