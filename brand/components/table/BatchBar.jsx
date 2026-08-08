import React from "react";
import { ensureGdCss } from "../buttons/Button.jsx";
const css=`
.gd-batchbar{display:flex;align-items:center;gap:8px;background:var(--gd-panel-raised);border:1px solid var(--gd-line-strong);border-radius:var(--radius-md);padding:7px 8px;box-shadow:var(--shadow-raised);font-size:13px}
.gd-batchbar-count{display:inline-flex;align-items:baseline;gap:5px;padding:5px 11px;background:var(--gd-ink);border:1px solid var(--gd-line);border-radius:var(--radius-sm);white-space:nowrap}
.gd-batchbar-count .lbl{font-size:11px;color:var(--gd-text-muted)}
.gd-batchbar-count b{font-family:var(--font-mono);font-weight:500;color:var(--gd-blue);font-size:14px;line-height:1}
.gd-batchbar-count .u{font-size:11px;color:var(--gd-text-faint)}
.gd-batchbar-actions{display:flex;align-items:center;gap:6px}
.gd-batchbar-sep{width:1px;height:20px;background:var(--gd-line);flex:none}
.gd-batchbar-clear{background:none;border:none;color:var(--gd-text-faint);font-size:12px;cursor:pointer;font-family:var(--font-sans);padding:5px 9px;border-radius:var(--radius-sm)}
.gd-batchbar-clear:hover{color:var(--gd-text);background:var(--gd-ink)}
`;
ensureGdCss("gd-batchbar-css",css);
export function BatchBar({count,unit="域名",children,onClear,style}){
  if(!count)return null;
  return <div className="gd-batchbar" style={style}>
    <span className="gd-batchbar-count"><span className="lbl">已选</span><b>{count}</b><span className="u">{unit}</span></span>
    <span className="gd-batchbar-sep"></span>
    <div className="gd-batchbar-actions">{children}</div>
    {onClear&&<><span className="gd-batchbar-sep"></span><button className="gd-batchbar-clear" onClick={onClear}>清除</button></>}
  </div>;
}
