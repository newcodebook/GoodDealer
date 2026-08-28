import type { CSSProperties, ReactNode } from "react";

import "./badge.css";

export type BadgeTone = "sync" | "gold" | "success" | "warning" | "danger" | "neutral";

export interface BadgeProps {
  /** @default "neutral" */
  tone?: BadgeTone;
  /** Render a 5px status dot before the label. */
  dot?: boolean;
  /** Use uppercase monospace status styling. @default true */
  mono?: boolean;
  children?: ReactNode;
  style?: CSSProperties;
}

const badgeToneStyles = {
  sync: { color: "var(--gd-blue)", background: "var(--gd-blue-tint)" },
  gold: { color: "var(--gd-gold)", background: "var(--gd-gold-tint)" },
  success: { color: "var(--gd-success)", background: "var(--gd-success-tint)" },
  warning: { color: "var(--gd-warning)", background: "var(--gd-warning-tint)" },
  danger: { color: "var(--gd-danger)", background: "var(--gd-danger-tint)" },
  neutral: {
    color: "var(--gd-text-muted)",
    background: "color-mix(in srgb, var(--gd-text-muted) 12%, transparent)",
  },
} as const satisfies Record<BadgeTone, CSSProperties>;

export function Badge({ tone = "neutral", dot, mono = true, children, style }: BadgeProps) {
  return (
    <span className={`gd-badge${mono ? "" : " gd-badge--sans"}`} style={{ ...badgeToneStyles[tone], ...style }}>
      {dot ? <span className="gd-badge-dot"></span> : null}
      {children}
    </span>
  );
}
