import React from "react";
import { ensureGdCss } from "../buttons/Button.jsx";
const css=`
.gd-statusbar{height:var(--statusbar-h);flex:none;display:flex;align-items:center;padding:0 6px;background:var(--gd-chrome);border-top:1px solid var(--gd-line);font-family:var(--font-mono);font-size:11px;font-variant-numeric:tabular-nums;color:var(--text-2);user-select:none}
.gd-statusbar-seg{display:inline-flex;align-items:center;gap:6px;padding:0 10px;white-space:nowrap}
.gd-statusbar-div{width:1px;height:12px;background:var(--gd-line-strong);flex:none}
.gd-statusbar-spacer{flex:1}
`;
ensureGdCss("gd-statusbar-css",css);
function join(arr){
  const out=[];
  arr.forEach((n,i)=>{if(i)out.push(<span key={"d"+i} className="gd-statusbar-div"></span>);out.push(<span key={i} className="gd-statusbar-seg">{n}</span>);});
  return out;
}
export function StatusBar({left=[],right=[],style}){
  return <footer className="gd-statusbar" style={style}>{join(left)}<span className="gd-statusbar-spacer"></span>{join(right)}</footer>;
}
