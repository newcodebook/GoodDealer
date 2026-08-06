import React from "react";
import { ensureGdCss } from "../buttons/Button.jsx";
const css=`
.gd-tabs{display:flex;gap:2px;border-bottom:1px solid var(--gd-line);align-items:flex-end}
.gd-tab{background:none;border:none;cursor:pointer;font-family:var(--font-sans);font-size:13px;color:var(--gd-text-muted);padding:7px 10px 9px;position:relative;transition:color var(--dur-fast) var(--ease-out);display:inline-flex;align-items:center;gap:6px}
.gd-tab:hover{color:var(--gd-text)}
.gd-tab:focus-visible{outline:none;box-shadow:var(--focus-ring);border-radius:4px}
.gd-tab--active{color:var(--gd-text);font-weight:500}
.gd-tab--active:after{content:"";position:absolute;left:8px;right:8px;bottom:-1px;height:2px;background:var(--gd-gold)}
.gd-tab-count{font-family:var(--font-mono);font-size:10px;color:var(--gd-text-faint);background:var(--gd-panel-raised);border:1px solid var(--gd-line);border-radius:999px;padding:0 6px;line-height:15px}
.gd-tab--active .gd-tab-count{color:var(--gd-text-muted)}
`;
ensureGdCss("gd-tabs-css",css);
export function Tabs({items=[],active,onChange,style}){
  return <div className="gd-tabs" style={style} role="tablist">
    {items.map(it=><button key={it.key} role="tab" aria-selected={active===it.key} className={`gd-tab${active===it.key?" gd-tab--active":""}`} onClick={()=>onChange&&onChange(it.key)}>
      {it.label}{it.count!=null&&<span className="gd-tab-count">{it.count}</span>}
    </button>)}
  </div>;
}
