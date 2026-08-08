import React from "react";
import { ensureGdCss } from "../buttons/Button.jsx";
const css=`
.gd-tag{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--gd-line-strong);background:var(--gd-panel-raised);border-radius:var(--radius-xs);padding:1px 7px;font-size:11px;color:var(--gd-text-muted);white-space:nowrap}
.gd-tag-x{background:none;border:none;padding:0;margin-left:1px;cursor:pointer;color:var(--gd-text-faint);font-size:12px;line-height:1;font-family:var(--font-sans)}
.gd-tag-x:hover{color:var(--gd-text)}
`;
ensureGdCss("gd-tag-css",css);
export function Tag({color,children,onRemove,style}){
  return <span className="gd-tag" style={style}>
    {color&&<span style={{width:6,height:6,borderRadius:"50%",background:color,flex:"none"}}></span>}
    {children}
    {onRemove&&<button className="gd-tag-x" onClick={onRemove} aria-label="移除">×</button>}
  </span>;
}
