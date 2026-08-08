// Kit-local reusable controls: Pagination + EditableCell (inline double-click edit).
// Composed from DS primitives; loaded via Babel so they work without a bundle recompile.
const {Select:GDSelect,IconButton:GDIconButton}=window.GoodDealerDesignSystem_b5b0b6;

function pageWindow(cur,total){
  if(total<=7)return Array.from({length:total},(_,i)=>i+1);
  const s=new Set([1,2,total-1,total,cur-1,cur,cur+1]);
  const arr=[...s].filter(n=>n>=1&&n<=total).sort((a,b)=>a-b);
  const out=[];let prev=0;
  for(const n of arr){if(n-prev>1)out.push("gap"+n);out.push(n);prev=n;}
  return out;
}
function PageNum({n,active,onClick}){
  return <button onClick={onClick}
    onMouseEnter={e=>{if(!active)e.currentTarget.style.background="var(--gd-panel-raised)";}}
    onMouseLeave={e=>{if(!active)e.currentTarget.style.background="transparent";}}
    style={{minWidth:24,height:24,padding:"0 6px",borderRadius:5,cursor:"pointer",fontFamily:"var(--font-mono)",fontVariantNumeric:"tabular-nums",fontSize:12,
      border:active?"1px solid var(--gd-line-strong)":"1px solid transparent",
      background:active?"var(--gd-panel-raised)":"transparent",
      color:active?"var(--text-1)":"var(--text-2)"}}>{n}</button>;
}
function Pagination({page,pageSize,total,onPage,onPageSize,pageSizes=[10,25,50],note}){
  const I=window.GDI;
  const pages=Math.max(1,Math.ceil(total/pageSize));
  const cur=Math.min(page,pages);
  const from=total===0?0:(cur-1)*pageSize+1;
  const to=Math.min(total,cur*pageSize);
  return <div style={{display:"flex",alignItems:"center",gap:12,width:"100%",fontSize:12,color:"var(--gd-text-muted)"}}>
    <span style={{fontFamily:"var(--font-mono)",fontVariantNumeric:"tabular-nums"}}>{from.toLocaleString()}–{to.toLocaleString()} <span style={{color:"var(--text-3)"}}>/ {total.toLocaleString()}</span></span>
    <span style={{display:"flex",alignItems:"center",gap:6}}>每页<GDSelect size="sm" options={pageSizes.map(String)} value={String(pageSize)} onChange={e=>onPageSize(+e.target.value)}/></span>
    {note&&<span style={{marginLeft:"auto",fontFamily:"var(--font-mono)",fontSize:11}}>{note}</span>}
    <span style={{marginLeft:note?16:"auto",display:"flex",alignItems:"center",gap:3}}>
      <GDIconButton size="sm" label="上一页" disabled={cur<=1} onClick={()=>onPage(cur-1)}><I.ChevronLeft size={14}/></GDIconButton>
      {pageWindow(cur,pages).map((n,i)=>typeof n==="number"
        ?<PageNum key={i} n={n} active={n===cur} onClick={()=>onPage(n)}/>
        :<span key={i} style={{padding:"0 2px",color:"var(--gd-text-faint)"}}>…</span>)}
      <GDIconButton size="sm" label="下一页" disabled={cur>=pages} onClick={()=>onPage(cur+1)}><I.ChevronRight size={14}/></GDIconButton>
    </span>
  </div>;
}
window.GDPagination=Pagination;

// EditableCell — double-click to edit in place (uncontrolled input read via ref on
// commit, so it is race-free); Enter/blur reports the pending value to onCommit
// (parent shows the "save & sync?" prompt); Escape cancels.
function EditableCell({value,display,onCommit,width=94,prefix}){
  const [editing,setEditing]=React.useState(false);
  const ref=React.useRef(null);
  const doneRef=React.useRef(false);
  React.useEffect(()=>{if(editing&&ref.current){ref.current.value=value==null?"":String(value);ref.current.focus();ref.current.select();}},[editing]);
  const start=()=>{doneRef.current=false;setEditing(true);};
  const commit=()=>{if(doneRef.current)return;doneRef.current=true;const raw=ref.current?ref.current.value:"";setEditing(false);const clean=String(raw).trim();if(clean!==""&&clean!==String(value))onCommit(clean);};
  const cancel=()=>{doneRef.current=true;setEditing(false);};
  if(editing){
    return <span style={{display:"inline-flex",alignItems:"center",gap:2,justifyContent:"flex-end"}} onClick={e=>e.stopPropagation()}>
      {prefix&&<span style={{color:"var(--gd-text-faint)",fontSize:11,fontFamily:"var(--font-mono)"}}>{prefix}</span>}
      <input ref={ref} inputMode="decimal"
        onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();commit();}else if(e.key==="Escape")cancel();}}
        onBlur={commit}
        style={{width,height:24,background:"var(--gd-ink)",border:"1px solid var(--gd-blue)",boxShadow:"0 0 0 2px rgba(77,141,255,0.25)",borderRadius:5,color:"var(--gd-text)",fontFamily:"var(--font-mono)",fontVariantNumeric:"tabular-nums",fontSize:12,textAlign:"right",padding:"0 7px",outline:"none"}}/>
    </span>;
  }
  return <span onDoubleClick={e=>{e.stopPropagation();start();}} onClick={e=>e.stopPropagation()}
    title="双击编辑 · 回车确认" style={{cursor:"text",display:"inline-block",borderBottom:"1px dashed transparent",paddingBottom:1,transition:"border-color 120ms"}}
    onMouseEnter={e=>e.currentTarget.style.borderBottomColor="var(--gd-line-strong)"}
    onMouseLeave={e=>e.currentTarget.style.borderBottomColor="transparent"}>{display!=null?display:value}</span>;
}
window.GDEditableCell=EditableCell;

// MetricStrip — the anti-jitter KPI band. Fixed height on EVERY screen (the meta line
// is always reserved, so 2-line and 3-line screens are the same height); equal-flex
// cells; optional per-cell drill-in (pointer + hover). Because the height is constant,
// the content baseline never shifts when you switch screens — the frame stays put.
function MetricStrip({metrics=[]}){
  const tone=t=>({gold:"var(--gd-gold)",danger:"var(--gd-danger)",warning:"var(--gd-warning)",blue:"var(--gd-blue)",success:"var(--gd-success)",muted:"var(--text-3)"}[t]||"var(--text-1)");
  return <div style={{display:"flex",height:72,flex:"none",background:"var(--surface-region)",borderBottom:"1px solid var(--gd-line)"}}>
    {metrics.map((m,i)=>{
      const click=m.onClick;
      return <div key={i} onClick={click||undefined}
        onMouseEnter={click?e=>{e.currentTarget.style.background="var(--gd-panel-raised)";}:undefined}
        onMouseLeave={click?e=>{e.currentTarget.style.background="transparent";}:undefined}
        style={{flex:1,minWidth:0,padding:"0 16px",display:"flex",flexDirection:"column",justifyContent:"center",gap:3,transition:"background 120ms",
          borderRight:i<metrics.length-1?"1px solid var(--gd-line)":"none",cursor:click?"pointer":"default"}}>
        <span className="gd-t-label" style={{whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{m.label}</span>
        <span className="gd-t-metric-sm" style={{color:m.tone==="muted"?"var(--text-3)":tone(m.tone),fontFamily:m.mono?"var(--font-mono)":undefined,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{m.value}</span>
        <span className="gd-t-meta" style={{whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",minHeight:14}}>{m.meta!=null?m.meta:"\u00A0"}</span>
      </div>;
    })}
  </div>;
}
window.GDMetricStrip=MetricStrip;

// Column priority — narrow tables DROP low-priority columns instead of squeezing them unreadable.
// column.priority: "essential"(default, always) | "secondary"(hide < bpSecondary) | "supplementary"(hide < bpSupplementary).
// Judged on the TABLE's own width (ResizeObserver), so a table in a narrow panel sheds regardless of window size.
// Mirrors the canonical mechanism in components/table/Table.jsx (this kit uses the prebuilt bundle, so the shim
// bridges until the bundle is rebuilt). forceWidth overrides measurement for testing.
function GDColumnsForWidth(columns,w,bpSec=640,bpSup=900){
  if(w==null)return columns;
  return columns.filter(c=>{const p=c.priority||"essential";
    if(p==="secondary")return w>=bpSec;
    if(p==="supplementary")return w>=bpSup;
    return true;});
}
function GDResponsiveTable({columns=[],footer,forceWidth=null,bpSecondary=640,bpSupplementary=900,maxHeight,...rest}){
  const {Table:GDBundledTable}=window.GoodDealerDesignSystem_b5b0b6;
  const ref=React.useRef(null);
  const [w,setW]=React.useState(null);
  React.useEffect(()=>{if(forceWidth!=null)return;const el=ref.current;if(!el||typeof ResizeObserver==="undefined")return;
    const ro=new ResizeObserver(es=>setW(es[0].contentRect.width));ro.observe(el);return ()=>ro.disconnect();},[forceWidth]);
  const eff=forceWidth!=null?forceWidth:w;
  const shown=GDColumnsForWidth(columns,eff,bpSecondary,bpSupplementary);
  const hidden=columns.length-shown.length;
  const foot=(footer||hidden>0)?<>{footer}{hidden>0&&<span style={{marginLeft:"auto",color:"var(--gd-text-faint)"}}>{hidden} 列已折叠 · 加宽以显示</span>}</>:undefined;
  const fill=maxHeight==="100%";
  return <div ref={ref} style={{minWidth:0,...(fill?{flex:1,minHeight:0,display:"flex",flexDirection:"column"}:{})}}>
    <GDBundledTable columns={shown} footer={foot} maxHeight={maxHeight} {...rest}/>
  </div>;
}
window.GDColumnsForWidth=GDColumnsForWidth;
window.GDResponsiveTable=GDResponsiveTable;
