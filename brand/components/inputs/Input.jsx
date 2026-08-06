import React from "react";
import { ensureGdCss } from "../buttons/Button.jsx";
const css=`
.gd-field{display:flex;flex-direction:column;gap:5px;min-width:0}
.gd-field-label{font-size:11px;letter-spacing:var(--tracking-caps);text-transform:uppercase;font-weight:500;color:var(--gd-text-muted)}
.gd-input-wrap{display:flex;align-items:center;gap:7px;background:var(--gd-ink);border:1px solid var(--gd-line-strong);border-radius:var(--radius-sm);padding:0 9px;transition:border-color var(--dur-fast) var(--ease-out),box-shadow var(--dur-fast) var(--ease-out)}
.gd-input-wrap:focus-within{border-color:var(--gd-blue);box-shadow:var(--focus-ring)}
.gd-input-wrap--error{border-color:var(--gd-danger)}
.gd-input-wrap--sm{height:var(--control-sm)}.gd-input-wrap--md{height:var(--control-md)}.gd-input-wrap--lg{height:var(--control-lg)}
.gd-input{flex:1;min-width:0;background:none;border:none;outline:none;color:var(--gd-text);font-family:var(--font-sans);font-size:13px}
.gd-input--mono{font-family:var(--font-mono);font-variant-numeric:tabular-nums}
.gd-input::placeholder{color:var(--gd-text-faint)}
.gd-input-affix{display:flex;align-items:center;color:var(--gd-text-faint);font-size:12px}
.gd-field-hint{font-size:11px;color:var(--gd-text-faint)}.gd-field-hint--error{color:var(--gd-danger)}
`;
ensureGdCss("gd-input-css",css);
export function Input({label,size="md",mono,prefix,suffix,error,hint,style,...rest}){
  return <label className="gd-field" style={style}>
    {label&&<span className="gd-field-label">{label}</span>}
    <span className={`gd-input-wrap gd-input-wrap--${size}${error?" gd-input-wrap--error":""}`}>
      {prefix&&<span className="gd-input-affix">{prefix}</span>}
      <input className={`gd-input${mono?" gd-input--mono":""}`} {...rest}/>
      {suffix&&<span className="gd-input-affix">{suffix}</span>}
    </span>
    {(error||hint)&&<span className={`gd-field-hint${error?" gd-field-hint--error":""}`}>{error||hint}</span>}
  </label>;
}
