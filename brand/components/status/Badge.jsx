import React from "react";
import { ensureGdCss } from "../buttons/Button.jsx";
const css=`
.gd-badge{display:inline-flex;align-items:center;gap:5px;border-radius:var(--radius-full);padding:2px 8px;font-family:var(--font-mono);font-size:10px;font-weight:500;letter-spacing:0.06em;text-transform:uppercase;white-space:nowrap}
.gd-badge--sans{font-family:var(--font-sans);font-size:11px;letter-spacing:0;text-transform:none}
.gd-badge-dot{width:5px;height:5px;border-radius:50%;background:currentColor;flex:none}
`;
ensureGdCss("gd-badge-css",css);
const TONES={
  sync:{color:"var(--gd-blue)",background:"var(--gd-blue-tint)"},
  gold:{color:"var(--gd-gold)",background:"var(--gd-gold-tint)"},
  success:{color:"var(--gd-success)",background:"var(--gd-success-tint)"},
  warning:{color:"var(--gd-warning)",background:"var(--gd-warning-tint)"},
  danger:{color:"var(--gd-danger)",background:"var(--gd-danger-tint)"},
  neutral:{color:"var(--gd-text-muted)",background:"rgba(141,147,163,0.12)"},
};
export function Badge({tone="neutral",dot,mono=true,children,style}){
  return <span className={`gd-badge${mono?"":" gd-badge--sans"}`} style={{...TONES[tone]||TONES.neutral,...style}}>{dot&&<span className="gd-badge-dot"></span>}{children}</span>;
}
