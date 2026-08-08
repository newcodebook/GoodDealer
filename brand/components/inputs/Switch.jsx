import React from "react";
import { ensureGdCss } from "../buttons/Button.jsx";
const css=`
.gd-switch{display:inline-flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:var(--gd-text);user-select:none}
.gd-switch input{position:absolute;opacity:0;width:0;height:0}
.gd-switch-track{width:30px;height:17px;flex:none;border-radius:999px;background:var(--gd-line-strong);position:relative;transition:background var(--dur-base) var(--ease-out)}
.gd-switch-track:after{content:"";position:absolute;left:2px;top:2px;width:13px;height:13px;border-radius:50%;background:var(--gd-text);transition:transform var(--dur-base) var(--ease-out)}
.gd-switch input:checked+.gd-switch-track{background:var(--gd-blue)}
.gd-switch input:checked+.gd-switch-track:after{transform:translateX(13px);background:#fff}
.gd-switch input:focus-visible+.gd-switch-track{box-shadow:var(--focus-ring)}
.gd-switch--disabled{opacity:.45;pointer-events:none}
`;
ensureGdCss("gd-switch-css",css);
export function Switch({checked,onChange,label,disabled}){
  return <label className={`gd-switch${disabled?" gd-switch--disabled":""}`}>
    <input type="checkbox" checked={!!checked} disabled={disabled} onChange={onChange||(()=>{})}/>
    <span className="gd-switch-track"></span>
    {label&&<span>{label}</span>}
  </label>;
}
