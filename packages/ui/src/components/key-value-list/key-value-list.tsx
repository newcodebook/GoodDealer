import type { CSSProperties, ReactNode } from "react";
import "./key-value-list.css";
export interface KeyValueListProps { children?: ReactNode; style?: CSSProperties }
export interface KeyValueRowProps { label: ReactNode; value?: ReactNode; actions?: ReactNode; mono?: boolean; tone?: "body" | "muted" | "gold" | "danger"; style?: CSSProperties }
export function KeyValueList({ children, style }: KeyValueListProps) { return <dl className="gd-key-values" style={style}>{children}</dl>; }
export function KeyValueRow({ label, value, actions, mono, tone = "body", style }: KeyValueRowProps) { return <div className="gd-key-value-row" style={style}><dt>{label}</dt><dd className={`${mono ? "gd-key-value--mono " : ""}gd-key-value--${tone}`}>{value}</dd>{actions ? <span className="gd-key-value-actions">{actions}</span> : null}</div>; }
