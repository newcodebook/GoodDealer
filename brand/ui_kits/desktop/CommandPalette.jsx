// 命令面板 / CommandPalette — ⌘K (Raycast/Linear mind). Fulfils the toolbar's ⌘K promise:
// fuzzy-filter over navigation commands + domain search; ↑↓ to move, ↵ to run, Esc to close.
const {} = {};
const NAV=[
  ["assets","资产库","Globe"],["sales","销售管理","Coins"],["dns","DNS 与验证","Shield"],
  ["protect","资产保护","ShieldAlert"],["batch","批量任务","ListChecks"],["conflicts","冲突中心","AlertTriangle"],
  ["recovery","恢复中心","LifeBuoy"],["inbox","人工任务","Inbox"],["history","操作历史","History"],["settings","设置","Settings"],
];

function CommandPalette({open,onClose,onGo,onOpenDomain}){
  const I=window.GDI;
  const [q,setQ]=React.useState("");
  const [sel,setSel]=React.useState(0);
  const inputRef=React.useRef(null);
  React.useEffect(()=>{if(open){setQ("");setSel(0);const t=setTimeout(()=>inputRef.current&&inputRef.current.focus(),10);return()=>clearTimeout(t);}},[open]);

  const ql=q.trim().toLowerCase();
  const navItems=(ql?NAV.filter(n=>n[1].toLowerCase().includes(ql)):NAV).map(n=>({type:"nav",k:n[0],label:n[1],icon:n[2]}));
  const domains=(window.GD_DATA&&window.GD_DATA.domains)||[];
  const domItems=ql?domains.filter(d=>d.domain.toLowerCase().includes(ql)).slice(0,6).map(d=>({type:"domain",id:d.id,label:d.domain,meta:d.registrar})):[];
  const items=[...navItems,...domItems];
  React.useEffect(()=>{if(sel>items.length-1)setSel(items.length?items.length-1:0);},[items.length]);

  const run=(it)=>{if(!it)return;if(it.type==="nav")onGo&&onGo(it.k);else if(it.type==="domain"){onOpenDomain?onOpenDomain(it.id):onGo&&onGo("assets");}onClose&&onClose();};
  const onKey=(e)=>{
    if(e.key==="ArrowDown"){e.preventDefault();setSel(s=>Math.min(s+1,items.length-1));}
    else if(e.key==="ArrowUp"){e.preventDefault();setSel(s=>Math.max(s-1,0));}
    else if(e.key==="Enter"){e.preventDefault();run(items[sel]);}
    else if(e.key==="Escape"){e.preventDefault();onClose&&onClose();}
  };
  if(!open)return null;

  const kbd={fontFamily:"var(--font-mono)",fontSize:10,color:"var(--text-3)",border:"1px solid var(--gd-line-strong)",borderRadius:3,padding:"0 5px",lineHeight:"16px"};
  const Row=({it,i,groupFirst})=>{
    const on=i===sel;
    return <button onMouseMove={()=>setSel(i)} onClick={()=>run(it)}
      style={{display:"flex",alignItems:"center",gap:10,width:"100%",height:36,padding:"0 10px",border:"none",borderRadius:6,cursor:"pointer",textAlign:"left",fontFamily:"var(--font-sans)",
        background:on?"var(--gd-panel)":"transparent",color:on?"var(--text-1)":"var(--text-2)"}}>
      {it.type==="nav"?React.createElement(I[it.icon]||I.Globe,{size:15,style:{flex:"none",opacity:on?1:.7}}):<I.Globe size={15} style={{flex:"none",opacity:.6}}/>}
      <span style={{flex:1,minWidth:0,fontSize:13,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",fontFamily:it.type==="domain"?"var(--font-mono)":undefined}}>{it.label}</span>
      {it.meta&&<span style={{fontSize:11,color:"var(--gd-text-faint)"}}>{it.meta}</span>}
      {on&&<span style={kbd}>↵</span>}
    </button>;
  };

  const Group=({label,children})=><div><div style={{fontSize:10,letterSpacing:"0.08em",textTransform:"uppercase",color:"var(--gd-text-faint)",padding:"8px 10px 4px"}}>{label}</div>{children}</div>;

  return <div style={{position:"fixed",inset:0,zIndex:100,background:"rgba(3,4,7,0.5)",display:"flex",alignItems:"flex-start",justifyContent:"center",paddingTop:"12vh"}} onClick={onClose}>
    <div onClick={e=>e.stopPropagation()} style={{width:560,maxWidth:"90%",background:"var(--gd-panel-raised)",border:"1px solid var(--gd-line-strong)",borderRadius:"var(--radius-lg)",boxShadow:"var(--shadow-overlay)",overflow:"hidden",display:"flex",flexDirection:"column",maxHeight:"60vh"}}>
      <div style={{display:"flex",alignItems:"center",gap:10,padding:"12px 14px",borderBottom:"1px solid var(--gd-line)"}}>
        <I.Search size={16} style={{color:"var(--gd-text-muted)",flex:"none"}}/>
        <input ref={inputRef} value={q} onChange={e=>{setQ(e.target.value);setSel(0);}} onKeyDown={onKey} placeholder="搜索域名或输入命令…"
          style={{flex:1,background:"none",border:"none",outline:"none",color:"var(--text-1)",fontSize:14,fontFamily:"var(--font-sans)"}}/>
        <span style={kbd}>ESC</span>
      </div>
      <div style={{overflowY:"auto",padding:6}}>
        {items.length===0&&<div style={{padding:"28px 10px",textAlign:"center",fontSize:12,color:"var(--gd-text-faint)"}}>无匹配的命令或域名</div>}
        {navItems.length>0&&<Group label="跳转">{navItems.map((it,i)=><Row key={"n"+it.k} it={it} i={i}/>)}</Group>}
        {domItems.length>0&&<Group label="域名">{domItems.map((it,i)=><Row key={"d"+it.id} it={it} i={navItems.length+i}/>)}</Group>}
      </div>
    </div>
  </div>;
}
window.GDCommandPalette=CommandPalette;
