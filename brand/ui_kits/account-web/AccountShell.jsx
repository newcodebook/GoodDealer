// account-web Shell — web-native full-bleed: left sidebar + topbar + full-width terminal status bar.
// No Tauri WindowChrome (this is a browser app), but the same ink/gold/blue terminal language.
const {StatusBar,IconButton,Badge}=window.GoodDealerDesignSystem_b5b0b6;
const Dot=({tone,hollow,size=7})=><span style={{width:size,height:size,borderRadius:"50%",flex:"none",display:"inline-block",background:hollow?"transparent":`var(--gd-${tone})`,border:hollow?`1.5px solid var(--gd-${tone})`:"none"}}></span>;

const NAV=[
  {sec:"账户",items:[
    {k:"dashboard",label:"概览",icon:"LayoutDashboard"},
    {k:"license",label:"订阅与许可",icon:"KeyRound"},
    {k:"devices",label:"设备",icon:"Monitor"},
    {k:"billing",label:"账单与发票",icon:"Receipt"},
  ]},
  {sec:"安全与数据",items:[
    {k:"security",label:"安全",icon:"ShieldCheck"},
    {k:"cloud",label:"云端数据",icon:"Database"},
  ]},
];
const FOOT=[
  {k:"settings",label:"账户设置",icon:"Settings"},
  {k:"download",label:"下载客户端",icon:"Download"},
];

const sx={
  side:{width:220,flex:"none",background:"var(--gd-panel)",borderRight:"1px solid var(--gd-line)",display:"flex",flexDirection:"column",minHeight:0},
  brand:{display:"flex",alignItems:"center",gap:10,padding:"15px 16px 14px",borderBottom:"1px solid var(--gd-line)"},
  navSec:{padding:"14px 16px 5px",fontSize:10,letterSpacing:"0.08em",textTransform:"uppercase",color:"var(--text-3)",fontWeight:500},
  item:(on)=>({display:"flex",alignItems:"center",gap:10,margin:"1px 8px",padding:"0 9px",height:30,borderRadius:5,cursor:"pointer",fontSize:13,color:on?"var(--text-1)":"var(--text-2)",background:on?"var(--gd-panel-raised)":"transparent",border:"none",width:"calc(100% - 16px)",fontFamily:"var(--font-sans)",textAlign:"left",transition:"background 120ms,color 120ms",fontWeight:on?500:400,position:"relative"}),
  bar:{position:"absolute",left:0,top:6,bottom:6,width:2,borderRadius:1,background:"var(--gd-gold)"},
  topbar:{height:52,flex:"none",display:"flex",alignItems:"center",gap:12,padding:"0 18px",borderBottom:"1px solid var(--gd-line)",background:"var(--gd-chrome)"},
  cmd:{display:"flex",alignItems:"center",gap:8,height:30,padding:"0 8px 0 11px",width:280,background:"var(--gd-ink)",border:"1px solid var(--gd-line-strong)",borderRadius:5,color:"var(--text-3)",fontSize:12,cursor:"text"},
  kbd:{marginLeft:"auto",fontFamily:"var(--font-mono)",fontSize:10,color:"var(--text-3)",border:"1px solid var(--gd-line-strong)",borderRadius:3,padding:"0 4px",lineHeight:"15px"},
};

function NavItem({item,active,onGo}){
  const on=active===item.k;const Ic=window.GDI[item.icon];
  return <button style={sx.item(on)} onClick={()=>onGo(item.k)}
    onMouseEnter={e=>{if(!on)e.currentTarget.style.background="var(--gd-panel-raised)";}}
    onMouseLeave={e=>{if(!on)e.currentTarget.style.background="transparent";}}>
    {on&&<span style={sx.bar}></span>}
    <Ic size={16} style={{flex:"none",opacity:on?1:.72,color:on?"var(--text-1)":undefined}}/>{item.label}
  </button>;
}

function Shell({active,onGo,title,crumb,children,syncing,onSync,unsynced=0}){
  const I=window.GDI;
  const footer=<StatusBar
    left={[
      <><Dot tone="blue"/>{syncing?"SYNCING":"SYNCED"}</>,
      <span style={{color:"var(--text-3)"}}>云端数据截至 {syncing?"…":"14:02"}</span>,
      <span style={{color:"var(--text-3)"}}>rev 8,241</span>,
    ]}
    right={[
      <span style={{color:"var(--text-3)"}}>4 平台 · 3 账户</span>,
      <>MacBook Pro <Dot tone="gold"/> <span style={{color:"var(--gd-gold)"}}>Active</span></>,
      <span style={{color:"var(--text-3)"}}>Epoch 41</span>,
      <span style={{color:"var(--text-3)"}}>年付 License · 至 2026-12-31</span>,
    ]}/>;
  return <div style={{height:"100%",width:"100%",display:"flex",flexDirection:"column",minHeight:0}}>
    <div style={{flex:1,display:"flex",minHeight:0}}>
      <aside style={sx.side}>
        <div style={sx.brand}>
          <img src="../../assets/logo/mark-flat.svg" width="22" height="22" alt=""/>
          <div style={{display:"flex",flexDirection:"column",gap:1,minWidth:0}}>
            <span style={{fontSize:14,fontWeight:600,color:"var(--text-1)",letterSpacing:"-0.01em"}}>GoodDealer</span>
            <span style={{fontSize:10,color:"var(--text-3)",fontFamily:"var(--font-mono)",letterSpacing:"0.04em"}}>云端账户 · Account</span>
          </div>
        </div>
        <div style={{flex:1,overflow:"auto",minHeight:0}}>
          {NAV.map(g=><div key={g.sec}><div style={sx.navSec}>{g.sec}</div>{g.items.map(it=><NavItem key={it.k} item={it} active={active} onGo={onGo}/>)}</div>)}
        </div>
        <div style={{borderTop:"1px solid var(--gd-line)",paddingTop:6}}>
          {FOOT.map(it=><NavItem key={it.k} item={it} active={active} onGo={onGo}/>)}
          <div style={{display:"flex",alignItems:"center",gap:10,padding:"11px 14px 12px",margin:"6px 0 0",borderTop:"1px solid var(--gd-line)"}}>
            <span style={{width:28,height:28,flex:"none",borderRadius:"50%",background:"linear-gradient(135deg,var(--gd-panel-raised),var(--gd-line))",border:"1px solid var(--gd-line-strong)",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"var(--font-mono)",fontSize:11,color:"var(--gd-gold)"}}>CL</span>
            <div style={{display:"flex",flexDirection:"column",gap:1,minWidth:0,flex:1}}>
              <span style={{fontSize:12,color:"var(--text-1)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>陈立行</span>
              <span style={{fontSize:10,color:"var(--text-3)",fontFamily:"var(--font-mono)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>li@quanta.trade</span>
            </div>
            <IconButton size="sm" label="退出登录"><I.LogOut size={14}/></IconButton>
          </div>
        </div>
      </aside>
      <div style={{flex:1,display:"flex",flexDirection:"column",minWidth:0,minHeight:0}}>
        <div style={sx.topbar}>
          <span style={{fontSize:15,fontWeight:600,color:"var(--text-1)"}}>{title}</span>
          {crumb&&<span style={{fontSize:12,color:"var(--text-3)"}}>{crumb}</span>}
          <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:10}}>
            <div style={sx.cmd}><I.Search size={13}/><span>搜索域名、发票或命令</span><span style={sx.kbd}>⌘K</span></div>
            <IconButton size="sm" label="通知"><span style={{position:"relative",display:"inline-flex"}}><I.Bell size={15}/><span style={{position:"absolute",top:-1,right:-1,width:5,height:5,borderRadius:"50%",background:"var(--gd-gold)"}}></span></span></IconButton>
            <IconButton size="sm" label="刷新云端数据" onClick={onSync}><I.RefreshCw size={14} style={syncing?{animation:"gd-spinner 1s linear infinite"}:undefined}/></IconButton>
          </div>
        </div>
        <main style={{flex:1,minWidth:0,minHeight:0,overflow:"auto",display:"flex",flexDirection:"column"}}>{children}</main>
      </div>
    </div>
    {footer}
  </div>;
}
window.GDShell=Shell;
window.GDDot=Dot;
