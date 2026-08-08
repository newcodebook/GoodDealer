import React from "react";
import { ensureGdCss } from "../buttons/Button.jsx";
const css=`
.gd-window{display:flex;flex-direction:column;height:100%;min-height:0;background:var(--gd-ink);border:1px solid var(--gd-line-strong);border-radius:var(--radius-lg);overflow:hidden;box-shadow:var(--shadow-overlay)}
.gd-titlebar{position:relative;height:var(--titlebar-h);flex:none;display:flex;align-items:center;gap:8px;padding:0 8px 0 12px;background:var(--gd-chrome);border-bottom:1px solid var(--gd-line);user-select:none}
.gd-tb-brand{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:600;letter-spacing:-0.01em;color:var(--text-1)}
.gd-tb-context{position:absolute;left:50%;transform:translateX(-50%);font-size:11px;color:var(--text-3);white-space:nowrap;pointer-events:none}
.gd-tb-ctl{margin-left:auto;display:flex;gap:1px}
.gd-tb-ctl button{width:28px;height:22px;display:inline-flex;align-items:center;justify-content:center;background:none;border:none;border-radius:4px;color:var(--text-2);cursor:default;transition:background var(--dur-fast) var(--ease-out),color var(--dur-fast) var(--ease-out)}
.gd-tb-ctl button:hover{background:var(--gd-panel-raised);color:var(--text-1)}
.gd-tb-ctl button.gd-tb-close:hover{background:var(--gd-danger);color:#fff}
.gd-window-body{flex:1;min-height:0;display:flex}
`;
ensureGdCss("gd-window-css",css);
const G=(d)=><svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">{d}</svg>;
export function WindowChrome({appName="GoodDealer",mark,context,footer,onClose,children,style}){
  return <div className="gd-window" style={style}>
    <div className="gd-titlebar">
      <span className="gd-tb-brand">{mark}{appName}</span>
      {context&&<span className="gd-tb-context">{context}</span>}
      <span className="gd-tb-ctl">
        <button tabIndex={-1} aria-label="最小化">{G(<path d="M1 5h8"/>)}</button>
        <button tabIndex={-1} aria-label="最大化">{G(<rect x="1.4" y="1.4" width="7.2" height="7.2" rx="1"/>)}</button>
        <button tabIndex={-1} className="gd-tb-close" aria-label="关闭" onClick={onClose}>{G(<><path d="M1.5 1.5l7 7"/><path d="M8.5 1.5l-7 7"/></>)}</button>
      </span>
    </div>
    <div className="gd-window-body">{children}</div>
    {footer}
  </div>;
}
