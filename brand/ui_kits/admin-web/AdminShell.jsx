// admin-web Shell — operator console. Web-native full-bleed: grouped sidebar + topbar (env pill,
// global search) + full-width system-health status bar. Same ink/gold/blue terminal language, operator density.
const {StatusBar:AStatusBar,IconButton:AIconButton,Badge:ABadge2}=window.GoodDealerDesignSystem_b5b0b6;
const ADot=({tone,hollow,size=7})=><span style={{width:size,height:size,borderRadius:"50%",flex:"none",display:"inline-block",background:hollow?"transparent":`var(--gd-${tone})`,border:hollow?`1.5px solid var(--gd-${tone})`:"none"}}></span>;

const ANAV=[
  {sec:"运营",items:[
    {k:"dashboard",label:"概览",icon:"LayoutDashboard"},
    {k:"customers",label:"客户",icon:"Users"},
    {k:"licenses",label:"许可与订阅",icon:"KeyRound"},
    {k:"revenue",label:"计费与营收",icon:"DollarSign"},
  ]},
  {sec:"系统",items:[
    {k:"fleet",label:"设备舰队",icon:"Cpu"},
    {k:"infra",label:"同步与基础设施",icon:"Activity"},
    {k:"audit",label:"审计日志",icon:"ScrollText"},
  ]},
  {sec:"支持",items:[
    {k:"support",label:"支持工单",icon:"LifeBuoy",count:23,tone:"warning"},
    {k:"announcements",label:"公告",icon:"Megaphone"},
  ]},
];
const AFOOT=[{k:"config",label:"系统配置",icon:"SlidersHorizontal"}];

const asx={
  side:{width:224,flex:"none",background:"var(--gd-panel)",borderRight:"1px solid var(--gd-line)",display:"flex",flexDirection:"column",minHeight:0},
  brand:{display:"flex",alignItems:"center",gap:10,padding:"15px 16px 14px",borderBottom:"1px solid var(--gd-line)"},
  navSec:{padding:"14px 16px 5px",fontSize:10,letterSpacing:"0.08em",textTransform:"uppercase",color:"var(--text-3)",fontWeight:500},
  item:(on)=>({display:"flex",alignItems:"center",gap:10,margin:"1px 8px",padding:"0 9px",height:30,borderRadius:5,cursor:"pointer",fontSize:13,color:on?"var(--text-1)":"var(--text-2)",background:on?"var(--gd-panel-raised)":"transparent",border:"none",width:"calc(100% - 16px)",fontFamily:"var(--font-sans)",textAlign:"left",transition:"background 120ms,color 120ms",fontWeight:on?500:400,position:"relative"}),
  bar:{position:"absolute",left:0,top:6,bottom:6,width:2,borderRadius:1,background:"var(--gd-gold)"},
  count:(tone)=>({marginLeft:"auto",fontFamily:"var(--font-mono)",fontSize:10,color:tone?`var(--gd-${tone})`:"var(--text-3)",lineHeight:"15px"}),
  topbar:{height:52,flex:"none",display:"flex",alignItems:"center",gap:12,padding:"0 18px",borderBottom:"1px solid var(--gd-line)",background:"var(--gd-chrome)"},
  cmd:{display:"flex",alignItems:"center",gap:8,height:30,padding:"0 8px 0 11px",width:300,background:"var(--gd-ink)",border:"1px solid var(--gd-line-strong)",borderRadius:5,color:"var(--text-3)",fontSize:12,cursor:"text"},
  kbd:{marginLeft:"auto",fontFamily:"var(--font-mono)",fontSize:10,color:"var(--text-3)",border:"1px solid var(--gd-line-strong)",borderRadius:3,padding:"0 4px",lineHeight:"15px"},
  env:{display:"flex",alignItems:"center",gap:6,height:24,padding:"0 9px",borderRadius:999,border:"1px solid rgba(92,174,125,0.35)",background:"var(--gd-success-tint)",color:"var(--gd-success)",fontSize:11,fontFamily:"var(--font-mono)",whiteSpace:"nowrap"},
};

function ANavItem({item,active,onGo}){
  const on=active===item.k;const Ic=window.GDI[item.icon];
  return <button style={asx.item(on)} onClick={()=>onGo(item.k)}
    onMouseEnter={e=>{if(!on)e.currentTarget.style.background="var(--gd-panel-raised)";}}
    onMouseLeave={e=>{if(!on)e.currentTarget.style.background="transparent";}}>
    {on&&<span style={asx.bar}></span>}
    <Ic size={16} style={{flex:"none",opacity:on?1:.72,color:on?"var(--text-1)":undefined}}/>{item.label}
    {item.count!=null&&<span style={asx.count(item.tone)}>{item.count}</span>}
  </button>;
}

function AdminShell({active,onGo,title,crumb,children,syncing,onSync}){
  const I=window.GDI;
  const footer=<AStatusBar
    left={[
      <><ADot tone="success"/>系统正常</>,
      <span style={{color:"var(--text-3)"}}>同步队列 <span style={{fontFamily:"var(--font-mono)",color:"var(--gd-text)"}}>128</span></span>,
      <span style={{color:"var(--text-3)"}}>API p95 <span style={{fontFamily:"var(--font-mono)",color:"var(--gd-text)"}}>42ms</span></span>,
      <span style={{color:"var(--text-3)"}}>12 region</span>,
    ]}
    right={[
      <span style={{color:"var(--text-3)"}}>在线设备 <span style={{fontFamily:"var(--font-mono)",color:"var(--gd-text)"}}>1,842</span> / 4,106</span>,
      <>MRR <span style={{fontFamily:"var(--font-mono)",color:"var(--gd-gold)"}}>$48.2k</span> <ADot tone="gold"/></>,
      <span style={{color:"var(--text-3)"}}>ops@gooddealer.com</span>,
      <span style={{color:"var(--text-3)"}}>admin v0.9.0</span>,
    ]}/>;
  return <div style={{height:"100%",width:"100%",display:"flex",flexDirection:"column",minHeight:0}}>
    <div style={{flex:1,display:"flex",minHeight:0}}>
      <aside style={asx.side}>
        <div style={asx.brand}>
          <img src="../../assets/logo/mark-flat.svg" width="22" height="22" alt=""/>
          <div style={{display:"flex",flexDirection:"column",gap:1,minWidth:0}}>
            <span style={{fontSize:14,fontWeight:600,color:"var(--text-1)",letterSpacing:"-0.01em"}}>GoodDealer</span>
            <span style={{fontSize:10,color:"var(--text-3)",fontFamily:"var(--font-mono)",letterSpacing:"0.04em"}}>运营控制台 · Admin</span>
          </div>
        </div>
        <div style={{flex:1,overflow:"auto",minHeight:0}}>
          {ANAV.map(g=><div key={g.sec}><div style={asx.navSec}>{g.sec}</div>{g.items.map(it=><ANavItem key={it.k} item={it} active={active} onGo={onGo}/>)}</div>)}
        </div>
        <div style={{borderTop:"1px solid var(--gd-line)",paddingTop:6}}>
          {AFOOT.map(it=><ANavItem key={it.k} item={it} active={active} onGo={onGo}/>)}
          <div style={{display:"flex",alignItems:"center",gap:10,padding:"11px 14px 12px",margin:"6px 0 0",borderTop:"1px solid var(--gd-line)"}}>
            <span style={{width:28,height:28,flex:"none",borderRadius:"50%",background:"linear-gradient(135deg,var(--gd-panel-raised),var(--gd-line))",border:"1px solid var(--gd-line-strong)",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"var(--font-mono)",fontSize:11,color:"var(--gd-gold)"}}>王</span>
            <div style={{display:"flex",flexDirection:"column",gap:2,minWidth:0,flex:1}}>
              <span style={{fontSize:12,color:"var(--text-1)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",display:"flex",alignItems:"center",gap:6}}>王运维 <span style={{fontSize:9,color:"var(--gd-gold)",border:"1px solid rgba(212,164,55,0.4)",borderRadius:3,padding:"0 4px",lineHeight:"13px",fontFamily:"var(--font-mono)"}}>ADMIN</span></span>
              <span style={{fontSize:10,color:"var(--text-3)",fontFamily:"var(--font-mono)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>运营管理员</span>
            </div>
            <AIconButton size="sm" label="退出登录"><I.LogOut size={14}/></AIconButton>
          </div>
        </div>
      </aside>
      <div style={{flex:1,display:"flex",flexDirection:"column",minWidth:0,minHeight:0}}>
        <div style={asx.topbar}>
          <span style={{fontSize:15,fontWeight:600,color:"var(--text-1)"}}>{title}</span>
          {crumb&&<span style={{fontSize:12,color:"var(--text-3)"}}>{crumb}</span>}
          <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:10}}>
            <span style={asx.env}><ADot tone="success" size={6}/>Production</span>
            <div style={asx.cmd}><I.Search size={13}/><span>搜索客户、设备、发票…</span><span style={asx.kbd}>⌘K</span></div>
            <AIconButton size="sm" label="告警"><span style={{position:"relative",display:"inline-flex"}}><I.Bell size={15}/><span style={{position:"absolute",top:-1,right:-1,width:5,height:5,borderRadius:"50%",background:"var(--gd-danger)"}}></span></span></AIconButton>
            <AIconButton size="sm" label="刷新" onClick={onSync}><I.RefreshCw size={14} style={syncing?{animation:"gd-spinner 1s linear infinite"}:undefined}/></AIconButton>
          </div>
        </div>
        <main style={{flex:1,minWidth:0,minHeight:0,overflow:"auto",display:"flex",flexDirection:"column"}}>{children}</main>
      </div>
    </div>
    {footer}
  </div>;
}
window.GDAdminShell=AdminShell;
window.GDADot=ADot;
