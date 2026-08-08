const {Badge,StatusDot,IconButton,WindowChrome,StatusBar,Toolbar}=window.GoodDealerDesignSystem_b5b0b6;
const Dot=({tone,hollow})=><span style={{width:7,height:7,borderRadius:"50%",flex:"none",display:"inline-block",background:hollow?"transparent":`var(--gd-${tone})`,border:hollow?`1.5px solid var(--gd-${tone})`:"none"}}></span>;
const shellStyles={
side:{width:210,flex:"none",background:"var(--gd-panel)",borderRight:"1px solid var(--gd-line)",display:"flex",flexDirection:"column"},
navSec:{padding:"12px 16px 4px",fontSize:10,letterSpacing:"0.08em",textTransform:"uppercase",color:"var(--text-3)",fontWeight:500},
item:(act)=>({display:"flex",alignItems:"center",gap:9,margin:"1px 8px",padding:"0 8px",height:29,borderRadius:5,cursor:"pointer",fontSize:13,color:act?"var(--text-1)":"var(--text-2)",background:act?"var(--gd-panel-raised)":"transparent",border:"none",width:"calc(100% - 16px)",fontFamily:"var(--font-sans)",textAlign:"left",transition:"background 120ms,color 120ms",fontWeight:act?500:400}),
itemActiveBar:{position:"absolute",left:0,top:5,bottom:5,width:2,borderRadius:1,background:"var(--gd-gold)"},
count:{marginLeft:"auto",fontFamily:"var(--font-mono)",fontSize:10,color:"var(--text-3)",lineHeight:"15px"},
cmd:{display:"flex",alignItems:"center",gap:8,height:28,padding:"0 8px 0 10px",width:300,background:"var(--gd-ink)",border:"1px solid var(--gd-line-strong)",borderRadius:5,color:"var(--text-3)",fontSize:12,cursor:"text"},
kbd:{marginLeft:"auto",fontFamily:"var(--font-mono)",fontSize:10,color:"var(--text-3)",border:"1px solid var(--gd-line-strong)",borderRadius:3,padding:"0 4px",lineHeight:"15px"},
};
// Standby Cloud Read-Only View banner — always visible while this device is Standby.
// States data provenance (源自 Cloud, 截至 Rev/时间, 最后平台读取), never implies a fresh platform pull,
// shows the Active device's unsynced count, and carries the only allowed mutation path: 发起切换.
function ReadOnlyBanner({unsynced=0,onSwitch}){
  const I=window.GDI;
  return <div style={{flex:"none",borderBottom:"1px solid var(--gd-blue)",background:"var(--gd-blue-tint)",padding:"9px 16px",display:"flex",alignItems:"center",gap:12}}>
    <img src="../../assets/icons/active-lease.svg" width="18" height="18" alt="" style={{flex:"none"}}/>
    <div style={{flex:1,minWidth:0,display:"flex",flexDirection:"column",gap:3}}>
      <span style={{fontSize:12.5,color:"var(--text-1)",fontWeight:500}}>只读视图 · 数据来自 GoodDealer Cloud
        <span style={{fontFamily:"var(--font-mono)",fontWeight:400,color:"var(--gd-text-muted)",marginLeft:8}}>截至 rev 8,241 · 14:02 · 最后平台读取 14:01</span>
      </span>
      <span style={{fontSize:11,color:"var(--gd-text-muted)"}}>此设备为 Standby，无执行权。只读缓存不作修改基线，不读取平台、不产生 Outbox / 批准 / 执行。{unsynced>0&&<span style={{color:"var(--gd-blue)"}}> · 活动设备有 {unsynced} 项未同步修改</span>}</span>
    </div>
    <button onClick={onSwitch} className="gd-btn gd-btn--md gd-btn--primary" style={{flex:"none"}}><I.RefreshCw size={13}/><span style={{marginLeft:6}}>切换为此设备执行</span></button>
  </div>;
}
// Nav item. In the compact breakpoint the sidebar collapses to a 56px icon rail (labels hidden,
// counts become a corner dot, native title tooltip); this reclaims ~150px exactly where the
// double-sidebar (Settings) screens run out of room.
function NavItem({icon:Ic,label,k,active,onGo,count,tone,railed}){
  const on=active===k;
  const [tip,setTip]=React.useState(false);
  // Collapsed rail: hover/focus shows a styled tooltip to the RIGHT (faster + on-brand vs native title;
  // also surfaces the count that's otherwise just a dot). aria-label keeps the hidden label accessible.
  return <button aria-label={railed?(count!=null?`${label} · ${count}`:label):undefined} onClick={()=>onGo(k)}
    style={{...shellStyles.item(on),position:"relative",justifyContent:railed?"center":"flex-start",padding:railed?0:"0 8px",gap:railed?0:9,width:railed?"calc(100% - 12px)":"calc(100% - 16px)",margin:railed?"1px 6px":"1px 8px"}}
    onMouseEnter={e=>{setTip(true);if(!on)e.currentTarget.style.background="var(--gd-panel-raised)";}}
    onMouseLeave={e=>{setTip(false);if(!on)e.currentTarget.style.background="transparent";}}
    onFocus={()=>setTip(true)} onBlur={()=>setTip(false)}>
    {on&&<span style={shellStyles.itemActiveBar}></span>}
    <Ic size={railed?17:15} style={{flex:"none",opacity:on?1:.7}}/>
    {!railed&&label}
    {!railed&&count!=null&&<span style={{...shellStyles.count,...(tone?{color:`var(--gd-${tone})`}:{})}}>{count}</span>}
    {railed&&count!=null&&<span style={{position:"absolute",top:3,right:5,width:6,height:6,borderRadius:"50%",background:`var(--gd-${tone||"blue"})`}}></span>}
    {railed&&tip&&<span role="tooltip" style={{position:"absolute",left:"calc(100% + 9px)",top:"50%",transform:"translateY(-50%)",background:"var(--gd-panel-raised)",border:"1px solid var(--gd-line-strong)",borderRadius:"var(--radius-sm)",boxShadow:"var(--shadow-raised)",color:"var(--gd-text)",fontSize:11,fontWeight:400,lineHeight:1.4,padding:"4px 8px",whiteSpace:"nowrap",pointerEvents:"none",zIndex:60,display:"flex",alignItems:"center",gap:7}}>
      {label}{count!=null&&<span style={{fontFamily:"var(--font-mono)",fontSize:10,color:`var(--gd-${tone||"blue"})`}}>{count}</span>}
    </span>}
  </button>;
}
function Shell({active,onGo,title,crumb,syncing,onSync,unsynced=0,device={name:"MacBook Pro",epoch:41},net="healthy",onNet,role="active",onRole,onOpenDomain,children}){
  const [shellW,setShellW]=React.useState(1280);
  React.useEffect(()=>{const el=document.getElementById("root");if(!el)return;const ro=new ResizeObserver(es=>setShellW(es[0].contentRect.width));ro.observe(el);return ()=>ro.disconnect();},[]);
  const [cmdOpen,setCmdOpen]=React.useState(false);
  React.useEffect(()=>{const onKey=e=>{if((e.metaKey||e.ctrlKey)&&(e.key==="k"||e.key==="K")){e.preventDefault();setCmdOpen(o=>!o);}};window.addEventListener("keydown",onKey);return ()=>window.removeEventListener("keydown",onKey);},[]);
  // Named breakpoints on shell (window) width — compact <1080 · regular 1080–1320 · wide ≥1320.
  // Judged on window width because the 210px nav eats into content; the rail collapse gives it back.
  const bp=shellW<1080?"compact":shellW<1320?"regular":"wide";
  const railed=bp==="compact", showP2=bp!=="compact", showP3=bp==="wide";
  const I=window.GDI;
  const standby=role==="standby";
  const other=device.name==="MacBook Pro"?"iPhone 17":"MacBook Pro";
  const mark=<img src="../../assets/logo/mark-flat.svg" width="18" height="18" alt=""/>;
  const cmd=railed
    ?<div onClick={()=>setCmdOpen(true)} style={{...shellStyles.cmd,width:"auto",padding:"0 8px",cursor:"pointer"}} title="搜索域名或输入命令 (⌘K)"><I.Search size={13}/><span style={{...shellStyles.kbd,marginLeft:6}}>⌘K</span></div>
    :<div onClick={()=>setCmdOpen(true)} style={{...shellStyles.cmd,cursor:"pointer"}}><I.Search size={13}/><span>搜索域名或输入命令</span><span style={shellStyles.kbd}>⌘K</span></div>;
  const roleSeg=<button onClick={()=>onRole&&onRole(standby?"active":"standby")} title="切换本机角色（演示）" style={{background:"none",border:"none",padding:0,cursor:"pointer",font:"inherit",color:"inherit",display:"inline-flex",alignItems:"center",gap:6}}>
    {device.name} <Dot tone={standby?"blue":"gold"} hollow={standby}/> <span style={{color:standby?"var(--gd-blue)":"var(--gd-gold)"}}>{standby?"Standby":"Active"}</span></button>;
  const otherSeg=<>{other} <Dot tone={standby?"gold":"blue"} hollow={!standby}/> <span style={standby?{color:"var(--gd-gold)"}:undefined}>{standby?"Active":"Standby"}</span></>;
  const footer=<StatusBar
    left={[
      <window.GDNetworkStatus net={net} onNet={onNet}/>,
      standby
        ?<><Dot tone="blue" hollow/>只读缓存</>
        :<><Dot tone="blue"/>{syncing?"SYNCING":"SYNCED"}</>,
      <>未同步 <span style={{fontFamily:"var(--font-mono)",color:unsynced>0?"var(--gd-blue)":"var(--text-3)"}}>{unsynced}</span></>,
      ...(showP2?[<span style={{color:"var(--text-3)"}}>{standby?"云端截至 14:02":"最后同步 "+(syncing?"…":"14:02")}</span>]:[]),
      ...(showP3?[<span style={{color:"var(--text-3)"}}>rev 8,241</span>]:[]),
    ]}
    right={[
      ...(showP2?[<span style={{color:"var(--text-3)"}}>4 平台 · 5 账户</span>]:[]),
      roleSeg,
      ...(showP2?[otherSeg]:[]),
      ...(showP3?[<span style={{color:"var(--text-3)"}}>Epoch {device.epoch}</span>]:[]),
      ...(showP3?[<span style={{color:"var(--text-3)"}}>年付 License</span>]:[]),
    ]}/>;
  const navSec=(t)=>railed
    ?<div style={{height:1,background:"var(--gd-line)",margin:"8px 12px 4px"}}></div>
    :<div style={shellStyles.navSec}>{t}</div>;
  return <WindowChrome appName="GoodDealer" mark={mark} context={railed?title:`个人 Workspace · ${title}`} footer={footer} style={{minWidth:960}}>
    <aside style={{...shellStyles.side,width:railed?56:210}}>
      {navSec("资产")}
      <NavItem icon={I.Globe} label="资产库" k="assets" active={active} onGo={onGo} railed={railed}/>
      <NavItem icon={I.Coins} label="销售管理" k="sales" active={active} onGo={onGo} railed={railed}/>
      <NavItem icon={I.Shield} label="DNS 与验证" k="dns" active={active} onGo={onGo} railed={railed}/>
      {navSec("执行")}
      <NavItem icon={I.ShieldAlert} label="资产保护" k="protect" active={active} onGo={onGo} count={1} tone="danger" railed={railed}/>
      <NavItem icon={I.ListChecks} label="批量任务" k="batch" active={active} onGo={onGo} railed={railed}/>
      <NavItem icon={I.AlertTriangle} label="冲突中心" k="conflicts" active={active} onGo={onGo} count={6} tone="danger" railed={railed}/>
      <NavItem icon={I.LifeBuoy} label="恢复中心" k="recovery" active={active} onGo={onGo} count={6} tone="warning" railed={railed}/>
      <NavItem icon={I.Inbox} label="人工任务" k="inbox" active={active} onGo={onGo} count={4} tone="warning" railed={railed}/>
      <NavItem icon={I.History} label="操作历史" k="history" active={active} onGo={onGo} railed={railed}/>
      {/* Nav is navigation only. The "凭据永不上云" trust promise is made once at the decision point
          (SignIn); a permanent slogan in the chrome reads as over-reassurance, not reassurance. */}
      <div style={{marginTop:"auto",paddingBottom:8}}>
        <NavItem icon={I.Settings} label="设置" k="settings" active={active} onGo={onGo} railed={railed}/>
      </div>
    </aside>
    <div style={{flex:1,display:"flex",flexDirection:"column",minWidth:0,minHeight:0}}>
      <Toolbar
        left={<><span style={{fontSize:14,fontWeight:600,color:"var(--text-1)"}}>{title}</span>{crumb&&<span style={{fontSize:12,color:"var(--text-3)"}}>{crumb}</span>}</>}
        right={<>{cmd}<IconButton size="sm" label={standby?"只读视图不刷新平台":"刷新平台数据"} disabled={standby} onClick={standby?undefined:onSync}><I.RefreshCw size={14} style={syncing?{animation:"gd-spinner 1s linear infinite"}:(standby?{opacity:.4}:undefined)}/></IconButton></>}/>
      {standby&&<ReadOnlyBanner unsynced={unsynced} onSwitch={()=>onRole&&onRole("active")}/>}
      <window.GDNetworkBanner net={net}/>
      <main style={{flex:1,minWidth:0,minHeight:0,overflow:"auto",display:"flex",flexDirection:"column"}}>
        {standby
          ?<div className="gd-readonly" style={{pointerEvents:"none",flex:1,minWidth:0,minHeight:0,display:"flex",flexDirection:"column"}}>{children}</div>
          :children}
      </main>
    </div>
    <window.GDCommandPalette open={cmdOpen} onClose={()=>setCmdOpen(false)} onGo={k=>onGo&&onGo(k)} onOpenDomain={onOpenDomain}/>
  </WindowChrome>;
}
window.GDShell=Shell;
