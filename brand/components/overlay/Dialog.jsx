import React from "react";
import { ensureGdCss } from "../buttons/Button.jsx";
const css=`
.gd-dialog-scrim{position:fixed;inset:0;background:var(--surface-overlay);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;z-index:100;animation:gd-fade var(--dur-base) var(--ease-out)}
.gd-dialog{background:var(--gd-panel);border:1px solid var(--gd-line-strong);border-radius:var(--radius-lg);box-shadow:var(--shadow-overlay);display:flex;flex-direction:column;max-height:82vh;animation:gd-rise var(--dur-base) var(--ease-out)}
@keyframes gd-fade{from{opacity:0}to{opacity:1}}
@keyframes gd-rise{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
.gd-dialog-head{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid var(--gd-line)}
.gd-dialog-title{font-size:15px;font-weight:600;flex:1}
.gd-dialog-x{background:none;border:none;color:var(--gd-text-faint);cursor:pointer;font-size:16px;line-height:1;padding:4px;border-radius:4px;font-family:var(--font-sans)}
.gd-dialog-x:hover{color:var(--gd-text);background:var(--gd-panel-raised)}
.gd-dialog-body{padding:16px;overflow:auto;font-size:13px;color:var(--gd-text)}
.gd-dialog-foot{display:flex;justify-content:flex-end;gap:8px;padding:12px 16px;border-top:1px solid var(--gd-line)}
.gd-dialog--danger .gd-dialog-title{color:var(--gd-danger)}
`;
ensureGdCss("gd-dialog-css",css);
export function Dialog({open,onClose,title,children,footer,width=440,danger}){
  React.useEffect(()=>{
    if(!open)return;
    const h=e=>{if(e.key==="Escape"&&onClose)onClose();};
    window.addEventListener("keydown",h);return()=>window.removeEventListener("keydown",h);
  },[open,onClose]);
  if(!open)return null;
  return <div className="gd-dialog-scrim" onMouseDown={e=>{if(e.target===e.currentTarget&&onClose)onClose();}}>
    <div className={`gd-dialog${danger?" gd-dialog--danger":""}`} style={{width}} role="dialog" aria-modal="true">
      <div className="gd-dialog-head"><span className="gd-dialog-title">{title}</span>
        {onClose&&<button className="gd-dialog-x" onClick={onClose} aria-label="关闭">✕</button>}</div>
      <div className="gd-dialog-body">{children}</div>
      {footer&&<div className="gd-dialog-foot">{footer}</div>}
    </div>
  </div>;
}
