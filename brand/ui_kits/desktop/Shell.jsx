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
function NavItem({icon:Ic,label,k,active,onGo,count,tone}){
  const on=active===k;
  return <button style={{...shellStyles.item(on),position:"relative"}} onClick={()=>onGo(k)}
    onMouseEnter={e=>{if(!on)e.currentTarget.style.background="var(--gd-panel-raised)";}}
    onMouseLeave={e=>{if(!on)e.currentTarget.style.background="transparent";}}>
    {on&&<span style={shellStyles.itemActiveBar}></span>}
    <Ic size={15} style={{flex:"none",opacity:on?1:.7}}/>{label}
    {count!=null&&<span style={{...shellStyles.count,...(tone?{color:`var(--gd-${tone})`}:{})}}>{count}</span>}
  </button>;
}
function Shell({active,onGo,title,crumb,syncing,onSync,unsynced=0,device={name:"MacBook Pro",epoch:41},net="healthy",onNet,role="active",onRole,children}){
  const [shellW,setShellW]=React.useState(1280);
  React.useEffect(()=>{const el=document.getElementById("root");if(!el)return;const ro=new ResizeObserver(es=>setShellW(es[0].contentRect.width));ro.observe(el);return ()=>ro.disconnect();},[]);
  const showP2=shellW>=980, showP3=shellW>=1180;
  const I=window.GDI;
  const standby=role==="standby";
  const other=device.name==="MacBook Pro"?"iPhone 17":"MacBook Pro";
  const mark=<img src="../../assets/logo/mark-flat.svg" width="18" height="18" alt=""/>;
  const cmd=<div style={shellStyles.cmd}><I.Search size={13}/><span>搜索域名或输入命令</span><span style={shellStyles.kbd}>⌘K</span></div>;
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
  return <WindowChrome appName="GoodDealer" mark={mark} context={`个人 Workspace · ${title}`} footer={footer} style={{minWidth:760}}>
    <aside style={shellStyles.side}>
      <div style={shellStyles.navSec}>资产</div>
      <NavItem icon={I.Globe} label="资产库" k="assets" active={active} onGo={onGo}/>
      <NavItem icon={I.Coins} label="销售管理" k="sales" active={active} onGo={onGo}/>
      <NavItem icon={I.Shield} label="DNS 与验证" k="dns" active={active} onGo={onGo}/>
      <div style={shellStyles.navSec}>执行</div>
      <NavItem icon={I.ShieldAlert} label="资产保护" k="protect" active={active} onGo={onGo} count={1} tone="danger"/>
      <NavItem icon={I.ListChecks} label="批量任务" k="batch" active={active} onGo={onGo}/>
      <NavItem icon={I.AlertTriangle} label="冲突中心" k="conflicts" active={active} onGo={onGo} count={6} tone="danger"/>
      <NavItem icon={I.LifeBuoy} label="恢复中心" k="recovery" active={active} onGo={onGo} count={6} tone="warning"/>
      <NavItem icon={I.Inbox} label="人工任务" k="inbox" active={active} onGo={onGo} count={4} tone="warning"/>
      <NavItem icon={I.History} label="操作历史" k="history" active={active} onGo={onGo}/>
      <div style={{marginTop:"auto"}}>
        <NavItem icon={I.Settings} label="设置" k="settings" active={active} onGo={onGo}/>
      </div>
      <div style={{padding:"8px 12px 12px",borderTop:"1px solid var(--gd-line)",margin:"4px 0 0",display:"flex",alignItems:"center",gap:7}}>
        <img src="../../assets/icons/keyhole.svg" width="14" height="14" alt="" style={{opacity:.85}}/>
        <span style={{fontSize:10,color:"var(--text-3)",fontFamily:"var(--font-mono)",lineHeight:1.3}}>凭据本地加密<br/>永不上云</span>
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
  </WindowChrome>;
}
window.GDShell=Shell;
