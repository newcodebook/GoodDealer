import React from "react";
const css=`
.gd-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;border-radius:var(--radius-sm);border:1px solid transparent;font-family:var(--font-sans);font-weight:500;cursor:pointer;white-space:nowrap;transition:background var(--dur-fast) var(--ease-out),border-color var(--dur-fast) var(--ease-out),color var(--dur-fast) var(--ease-out)}
.gd-btn:focus-visible{outline:none;box-shadow:var(--focus-ring)}
.gd-btn[disabled]{opacity:.45;cursor:default;pointer-events:none}
.gd-btn--primary[disabled]{opacity:1;background:var(--gd-line);border-color:var(--gd-line-strong);color:var(--gd-text-faint)}
.gd-btn--danger[disabled]{opacity:1;background:rgba(201,80,60,0.20);border-color:rgba(201,80,60,0.40);color:rgba(229,115,95,0.72)}
.gd-btn--sm{height:var(--control-sm);padding:0 10px;font-size:12px}
.gd-btn--md{height:var(--control-md);padding:0 12px;font-size:13px}
.gd-btn--lg{height:var(--control-lg);padding:0 16px;font-size:14px}
.gd-btn--primary{background:var(--gd-blue);color:#fff}
.gd-btn--primary:hover{background:#6098FF}
.gd-btn--primary:active{background:var(--gd-blue-pressed)}
.gd-btn--secondary{background:var(--gd-panel-raised);border-color:var(--gd-line-strong);color:var(--gd-text)}
.gd-btn--secondary:hover{background:#1A1E28;border-color:#343B4E}
.gd-btn--secondary:active{background:var(--gd-panel)}
.gd-btn--ghost{background:transparent;color:var(--gd-text-muted)}
.gd-btn--ghost:hover{background:var(--gd-panel-raised);color:var(--gd-text)}
.gd-btn--ghost:active{background:var(--gd-panel)}
.gd-btn--danger{background:#C9503C;color:#fff}
.gd-btn--danger:hover{background:#D65A45}
.gd-btn--danger:active{background:#B04533}
.gd-btn--gold{background:transparent;border-color:rgba(212,164,55,0.5);color:var(--gd-gold)}
.gd-btn--gold:hover{background:var(--gd-gold-tint);border-color:var(--gd-gold)}
.gd-btn--gold:active{background:rgba(212,164,55,0.16)}
`;
export function ensureGdCss(id,text){if(typeof document!=="undefined"&&!document.getElementById(id)){const s=document.createElement("style");s.id=id;s.textContent=text;document.head.appendChild(s);}}
ensureGdCss("gd-btn-css",css);
export function Button({variant="secondary",size="md",icon,children,block,...rest}){
  return <button className={`gd-btn gd-btn--${size} gd-btn--${variant}`} style={block?{width:"100%"}:undefined} {...rest}>{icon}{children}</button>;
}
