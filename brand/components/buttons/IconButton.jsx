import React from "react";
import { ensureGdCss } from "./Button.jsx";
const css=`
.gd-iconbtn{display:inline-flex;align-items:center;justify-content:center;border-radius:var(--radius-sm);border:1px solid transparent;background:transparent;color:var(--gd-text-muted);cursor:pointer;transition:background var(--dur-fast) var(--ease-out),color var(--dur-fast) var(--ease-out)}
.gd-iconbtn:hover{background:var(--gd-panel-raised);color:var(--gd-text)}
.gd-iconbtn:active{background:var(--gd-panel)}
.gd-iconbtn:focus-visible{outline:none;box-shadow:var(--focus-ring)}
.gd-iconbtn[disabled]{opacity:.45;pointer-events:none}
.gd-iconbtn--outline{border-color:var(--gd-line-strong);background:var(--gd-panel-raised)}
.gd-iconbtn--sm{width:var(--control-sm);height:var(--control-sm)}
.gd-iconbtn--md{width:var(--control-md);height:var(--control-md)}
`;
ensureGdCss("gd-iconbtn-css",css);
export function IconButton({variant="ghost",size="md",label,children,...rest}){
  return <button className={`gd-iconbtn gd-iconbtn--${size}${variant==="outline"?" gd-iconbtn--outline":""}`} title={label} aria-label={label} {...rest}>{children}</button>;
}
