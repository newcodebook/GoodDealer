import React from "react";
import { ensureGdCss } from "../buttons/Button.jsx";
const css=`
.gd-toolbar{height:var(--toolbar-h);flex:none;display:flex;align-items:center;gap:10px;padding:0 12px;background:var(--gd-ink);border-bottom:1px solid var(--gd-line)}
.gd-toolbar--region{background:var(--surface-region)}
.gd-toolbar-side{display:flex;align-items:center;gap:8px;min-width:0}
.gd-toolbar-spacer{flex:1}
`;
ensureGdCss("gd-toolbar-css",css);
export function Toolbar({left,right,region,style}){
  return <div className={`gd-toolbar${region?" gd-toolbar--region":""}`} style={style}>
    <div className="gd-toolbar-side">{left}</div>
    <span className="gd-toolbar-spacer"></span>
    <div className="gd-toolbar-side">{right}</div>
  </div>;
}
