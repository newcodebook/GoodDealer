import React from "react";
import { ensureGdCss } from "../buttons/Button.jsx";
const css=`
.gd-tip{position:relative;display:inline-flex}
.gd-tip-bubble{position:absolute;bottom:calc(100% + 6px);left:50%;transform:translateX(-50%) translateY(2px);background:var(--gd-panel-raised);border:1px solid var(--gd-line-strong);border-radius:var(--radius-sm);box-shadow:var(--shadow-raised);color:var(--gd-text);font-size:11px;line-height:1.4;padding:5px 8px;white-space:nowrap;opacity:0;pointer-events:none;transition:opacity var(--dur-fast) var(--ease-out),transform var(--dur-fast) var(--ease-out);z-index:50}
.gd-tip:hover .gd-tip-bubble,.gd-tip:focus-within .gd-tip-bubble{opacity:1;transform:translateX(-50%) translateY(0)}
`;
ensureGdCss("gd-tip-css",css);
export function Tooltip({label,children,style}){
  return <span className="gd-tip" style={style}>{children}<span className="gd-tip-bubble" role="tooltip">{label}</span></span>;
}
