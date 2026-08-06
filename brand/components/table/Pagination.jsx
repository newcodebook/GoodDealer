import React from "react";
import { ensureGdCss } from "../buttons/Button.jsx";
import { Select } from "../inputs/Select.jsx";
import { IconButton } from "../buttons/IconButton.jsx";
const css=`
.gd-pager{display:flex;align-items:center;gap:12px;width:100%;font-size:12px;color:var(--gd-text-muted)}
.gd-pager-range{font-family:var(--font-mono);font-variant-numeric:tabular-nums;white-space:nowrap}
.gd-pager-range b{color:var(--text-1);font-weight:500}
.gd-pager-size{display:flex;align-items:center;gap:6px;white-space:nowrap}
.gd-pager-note{margin-left:auto;font-family:var(--font-mono);font-size:11px;white-space:nowrap}
.gd-pager-nav{display:flex;align-items:center;gap:3px}
.gd-pager-num{min-width:24px;height:24px;padding:0 6px;border-radius:5px;cursor:pointer;font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:12px;border:1px solid transparent;background:transparent;color:var(--gd-text-muted);transition:background var(--dur-fast) var(--ease-out)}
.gd-pager-num:hover{background:var(--gd-panel-raised)}
.gd-pager-num--active{border-color:var(--gd-line-strong);background:var(--gd-panel-raised);color:var(--text-1)}
.gd-pager-gap{padding:0 2px;color:var(--gd-text-faint)}
`;
ensureGdCss("gd-pager-css",css);
const chevron=d=><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={d}/></svg>;
function pageWindow(cur,total){
  if(total<=7)return Array.from({length:total},(_,i)=>i+1);
  const s=new Set([1,2,total-1,total,cur-1,cur,cur+1]);
  const arr=[...s].filter(n=>n>=1&&n<=total).sort((a,b)=>a-b);
  const out=[];let prev=0;
  for(const n of arr){if(n-prev>1)out.push("g"+n);out.push(n);prev=n;}
  return out;
}
/** Table pagination: range + page-size + windowed page numbers. Numeric-mono, hairline, native. */
export function Pagination({page=1,pageSize=25,total=0,onPageChange,onPageSizeChange,pageSizes=[10,25,50,100],note,style}){
  const pages=Math.max(1,Math.ceil(total/pageSize));
  const cur=Math.min(Math.max(1,page),pages);
  const from=total===0?0:(cur-1)*pageSize+1;
  const to=Math.min(total,cur*pageSize);
  const go=n=>onPageChange&&onPageChange(n);
  return <div className="gd-pager" style={style}>
    <span className="gd-pager-range"><b>{from.toLocaleString()}–{to.toLocaleString()}</b> <span style={{color:"var(--gd-text-faint)"}}>/ {total.toLocaleString()}</span></span>
    <span className="gd-pager-size">每页<Select size="sm" options={pageSizes.map(String)} value={String(pageSize)} onChange={e=>onPageSizeChange&&onPageSizeChange(+e.target.value)}/></span>
    {note&&<span className="gd-pager-note">{note}</span>}
    <span className="gd-pager-nav" style={{marginLeft:note?16:"auto"}}>
      <IconButton size="sm" label="上一页" disabled={cur<=1} onClick={()=>go(cur-1)}>{chevron("m15 18-6-6 6-6")}</IconButton>
      {pageWindow(cur,pages).map((n,i)=>typeof n==="number"
        ?<button key={i} className={`gd-pager-num${n===cur?" gd-pager-num--active":""}`} onClick={()=>go(n)}>{n}</button>
        :<span key={i} className="gd-pager-gap">…</span>)}
      <IconButton size="sm" label="下一页" disabled={cur>=pages} onClick={()=>go(cur+1)}>{chevron("m9 18 6-6-6-6")}</IconButton>
    </span>
  </div>;
}
