import React from "react";
import { ensureGdCss } from "../buttons/Button.jsx";
const css=`
.gd-check{display:inline-flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:var(--gd-text);user-select:none}
.gd-check input{position:absolute;opacity:0;width:0;height:0}
.gd-check-box{width:15px;height:15px;flex:none;border-radius:var(--radius-xs);border:1px solid var(--gd-line-strong);background:var(--gd-ink);display:inline-flex;align-items:center;justify-content:center;transition:background var(--dur-fast) var(--ease-out),border-color var(--dur-fast) var(--ease-out)}
.gd-check:hover .gd-check-box{border-color:#3A4256}
.gd-check input:focus-visible+.gd-check-box{box-shadow:var(--focus-ring)}
.gd-check input:checked+.gd-check-box,.gd-check-box--ind{background:var(--gd-blue);border-color:var(--gd-blue)}
.gd-check svg{display:none}
.gd-check input:checked+.gd-check-box svg.gd-check-tick{display:block}
.gd-check-box--ind svg.gd-check-dash{display:block}
.gd-check--disabled{opacity:.45;pointer-events:none}
`;
ensureGdCss("gd-check-css",css);
export function Checkbox({checked,indeterminate,onChange,label,disabled,stop}){
  return <label className={`gd-check${disabled?" gd-check--disabled":""}`} onClick={stop?e=>e.stopPropagation():undefined}>
    <input type="checkbox" checked={!!checked} disabled={disabled} onChange={onChange||(()=>{})}/>
    <span className={`gd-check-box${indeterminate&&!checked?" gd-check-box--ind":""}`}>
      <svg className="gd-check-tick" width="9" height="9" viewBox="0 0 10 10" fill="none"><path d="M1.5 5.5L4 8L8.5 2" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
      <svg className="gd-check-dash" width="9" height="9" viewBox="0 0 10 10" fill="none"><path d="M2 5H8" stroke="#fff" strokeWidth="1.8" strokeLinecap="round"/></svg>
    </span>
    {label&&<span>{label}</span>}
  </label>;
}
