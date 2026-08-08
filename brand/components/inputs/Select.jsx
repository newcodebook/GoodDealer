import React from "react";
import { ensureGdCss } from "../buttons/Button.jsx";
const css=`
.gd-select{appearance:none;background:var(--gd-ink);border:1px solid var(--gd-line-strong);border-radius:var(--radius-sm);color:var(--gd-text);font-family:var(--font-sans);font-size:13px;padding:0 26px 0 9px;cursor:pointer;transition:border-color var(--dur-fast) var(--ease-out)}
.gd-select:focus-visible{outline:none;border-color:var(--gd-blue);box-shadow:0 0 0 2px rgba(77,141,255,0.25)}
.gd-select:hover{border-color:#343B4E}
.gd-select--sm{height:var(--control-sm)}.gd-select--md{height:var(--control-md)}.gd-select--lg{height:var(--control-lg)}
.gd-select-wrap{position:relative;display:inline-flex}
.gd-select-wrap:after{content:"";position:absolute;right:9px;top:50%;margin-top:-2px;width:7px;height:7px;border-right:1.5px solid var(--gd-text-muted);border-bottom:1.5px solid var(--gd-text-muted);transform:rotate(45deg) translateY(-50%);pointer-events:none}
`;
ensureGdCss("gd-select-css",css);
export function Select({label,size="md",options=[],style,...rest}){
  const sel=<span className="gd-select-wrap" style={label?undefined:style}><select className={`gd-select gd-select--${size}`} {...rest}>
    {options.map(o=>typeof o==="string"?<option key={o} value={o}>{o}</option>:<option key={o.value} value={o.value}>{o.label}</option>)}
  </select></span>;
  if(!label)return sel;
  return <label className="gd-field" style={style}><span className="gd-field-label">{label}</span>{sel}</label>;
}
