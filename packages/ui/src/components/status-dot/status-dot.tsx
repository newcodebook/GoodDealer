import type { CSSProperties, ReactNode } from "react";

import "./status-dot.css";

export type StatusDotKind = "active" | "standby" | "sync" | "success" | "warning" | "danger" | "neutral";
export interface StatusDotProps { kind?: StatusDotKind; label?: ReactNode; size?: number; pulse?: boolean | undefined; style?: CSSProperties }
export function StatusDot({ kind = "neutral", label, size = 8, pulse, style }: StatusDotProps) { return <span className={`gd-statusdot${pulse ? " gd-statusdot--pulse" : ""}`} style={style}><span className={`gd-statusdot-i gd-statusdot-i--${kind}`} style={{ width: size, height: size }} />{label ? <span>{label}</span> : null}</span>; }
