import React from "react";
import { ensureGdCss } from "../buttons/Button.jsx";
const css=`
.gd-panel{background:var(--gd-panel);border:1px solid var(--gd-line);border-radius:var(--radius-md)}
.gd-panel--seamed{border-radius:0;border-left:none;border-right:none}
.gd-panel-head{display:flex;align-items:center;gap:10px;padding:11px 14px;border-bottom:1px solid var(--gd-line)}
.gd-panel-title{font-size:14px;font-weight:600;flex:1}
.gd-panel-body{padding:14px}
.gd-panel--flush .gd-panel-body{padding:0}
`;
ensureGdCss("gd-panel-css",css);
export function Panel({title,actions,flush,seamed,children,style}){
  return <section className={`gd-panel${flush?" gd-panel--flush":""}${seamed?" gd-panel--seamed":""}`} style={style}>
    {(title||actions)&&<header className="gd-panel-head"><span className="gd-panel-title">{title}</span>{actions}</header>}
    <div className="gd-panel-body">{children}</div>
  </section>;
}
