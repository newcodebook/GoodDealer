import React from "react";
import { ensureGdCss } from "../buttons/Button.jsx";
const css=`
.gd-statusdot{display:inline-flex;align-items:center;gap:7px;font-size:12px;color:var(--gd-text-muted)}
.gd-statusdot-i{border-radius:50%;flex:none;box-sizing:border-box}
@keyframes gd-dot-pulse{0%,100%{opacity:1}50%{opacity:.35}}
.gd-statusdot--pulse .gd-statusdot-i{animation:gd-dot-pulse 1.6s var(--ease-out) infinite}
`;
ensureGdCss("gd-statusdot-css",css);
const KINDS={
  active:{background:"var(--gd-gold)"},
  standby:{background:"transparent",border:"1.5px solid var(--gd-blue)"},
  sync:{background:"var(--gd-blue)"},
  success:{background:"var(--gd-success)"},
  warning:{background:"var(--gd-warning)"},
  danger:{background:"var(--gd-danger)"},
  neutral:{background:"var(--gd-viz-drawdown)"},
};
export function StatusDot({kind="neutral",label,size=8,pulse,style}){
  return <span className={`gd-statusdot${pulse?" gd-statusdot--pulse":""}`} style={style}>
    <span className="gd-statusdot-i" style={{width:size,height:size,...KINDS[kind]||KINDS.neutral}}></span>
    {label&&<span>{label}</span>}
  </span>;
}
