import type { CSSProperties, ReactNode } from "react";

import "./tooltip.css";

export interface TooltipProps {
  label: ReactNode;
  children?: ReactNode;
  style?: CSSProperties;
  placement?: "top" | "right";
}

export function Tooltip({ label, children, style, placement = "top" }: TooltipProps) {
  return (
    <span className={`gd-tip gd-tip--${placement}`} style={style}>
      {children}
      <span className="gd-tip-bubble" role="tooltip">{label}</span>
    </span>
  );
}
