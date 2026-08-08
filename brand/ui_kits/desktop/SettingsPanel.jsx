// 设置 / Settings — connections, device lease (门禁), license, sync, about.
// Centerpiece: 设备与运行态 — Active(金) / Standby(蓝空心) / 激活中 / 排空中 / Sunset·LocalContinuation(保留态),
// the hardware-wallet lease system (Trezor device-status lesson). Handoff runs a confirmation ceremony.
const {Panel:PPanel,Switch:PSwitch,Button:PBtn,Badge:PBadge,StatusDot:PDot,Select:PSel,Tag:PTag,Dialog:PDlg,Checkbox:PCheck}=window.GoodDealerDesignSystem_b5b0b6;

const SECTIONS=[["conn","连接"],["device","设备与运行态"],["license","许可"],["sync","同步偏好"],["backup","备份"],["about","关于"]];
const KV=({k,children,muted})=><div style={{display:"flex",alignItems:"center",gap:12,padding:"9px 0",borderBottom:"1px solid var(--gd-line)",fontSize:13}}>
  <span style={{width:120,flex:"none",color:"var(--gd-text-faint)",fontSize:12}}>{k}</span>
  <span style={{flex:1,display:"flex",alignItems:"center",justifyContent:"flex-end",gap:8,textAlign:"right",color:muted?"var(--gd-text-muted)":undefined}}>{children}</span>
</div>;

// One row = one ProviderConnection (a specific platform ACCOUNT). Same platform may hold several accounts,
// each with its own credential health, isolated browser Profile and independent rate-limit bucket.
function ConnRow({name,kind,meta,method,last,standby,onConnect,account,remoteId,quota}){
  const dot={ok:"success",warn:"warning",off:"neutral"}[kind];
  const label={ok:"已连接",warn:"需重新授权",off:"未连接"}[kind];
  // Standby Cloud Read-Only View: show only the NON-SECRET local-config marker — never a live health state.
  // Never reads Keychain/Browser Profile/credential values, never runs a health check; 曾配置候选 ≠ 可用凭据.
  const cand={ok:"曾配置候选",warn:"曾配置候选",off:"从未配置"}[kind];
  const conn=account?{platform:name,account}:{platform:name};
  const sub=[remoteId,(!standby&&quota)?quota:null].filter(Boolean).join(" · ");
  return <div style={{display:"flex",alignItems:"center",gap:10,padding:"11px 14px",borderBottom:"1px solid var(--gd-line)"}}>
    <PDot kind={standby?"neutral":dot}/>
    <span style={{width:140,flex:"none",display:"flex",flexDirection:"column",gap:2,minWidth:0}}>
      <span style={{fontSize:13,color:"var(--text-1)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{name}{account&&<span style={{color:"var(--gd-text-muted)"}}> · {account}</span>}</span>
      {sub&&<span style={{fontSize:10,color:"var(--gd-text-faint)",fontFamily:"var(--font-mono)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{sub}</span>}
    </span>
    <span style={{width:80,flex:"none"}}>{standby?<PTag>{cand}</PTag>:<PBadge tone={kind==="ok"?"success":kind==="warn"?"warning":undefined} mono={false}>{label}</PBadge>}</span>
    <span style={{flex:1,minWidth:0,fontSize:12,color:"var(--gd-text-muted)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{standby?(cand==="从未配置"?"本设备从未配置":"未验证，切换为 Active 后才能检查"):meta}</span>
    {method&&<PTag>{method}</PTag>}
    <span style={{width:60,flex:"none",textAlign:"right",fontFamily:"var(--font-mono)",fontSize:11,color:"var(--gd-text-faint)",whiteSpace:"nowrap"}}>{standby?"—":last}</span>
    <span style={{width:82,flex:"none",display:"flex",justifyContent:"flex-end"}}>{standby?<span style={{fontSize:11,color:"var(--gd-text-faint)"}}>只读</span>:kind==="off"?<PBtn size="sm" variant="primary" onClick={()=>onConnect&&onConnect(conn)}>连接</PBtn>:kind==="warn"?<PBtn size="sm" onClick={()=>onConnect&&onConnect(conn)}>重新授权</PBtn>:<PBtn size="sm" variant="ghost">管理</PBtn>}</span>
  </div>;
}

function DeviceRow({d,onHandoff}){
  const map={
    active:{dot:"active",badge:<PBadge tone="gold">ACTIVE</PBadge>,meta:"持有 ActiveDeviceLease · 执行权在此设备"},
    standby:{dot:"standby",badge:<PBadge mono={false}>Standby</PBadge>,meta:"待命 · 可申请移交执行权"},
    activating:{dot:"sync",badge:<PBadge tone="sync" mono={false}>正在安全激活</PBadge>,meta:"校验中 · 等待服务端签发新 Lease"},
    draining:{dot:"warning",badge:<PBadge tone="warning" mono={false}>排空中</PBadge>,meta:"提交未同步项后释放执行权"},
    sunset:{dot:"neutral",badge:<PTag>RETAINED</PTag>,meta:"Sunset · LocalContinuation 本地只读延续 · 无执行权"},
  }[d.state];
  const dim=d.state==="sunset";
  const busy=d.state==="activating"||d.state==="draining";
  return <div style={{display:"flex",alignItems:"center",gap:13,padding:"13px 14px",borderBottom:"1px solid var(--gd-line)",opacity:dim?.55:1,background:d.state==="active"?"linear-gradient(90deg,rgba(212,164,55,0.04),transparent 40%)":"transparent"}}>
    <window.GDI.Monitor size={17} style={{color:d.state==="active"?"var(--gd-gold)":"var(--gd-text-muted)",flex:"none"}}/>
    <div style={{width:158,flex:"none",display:"flex",flexDirection:"column",gap:3,minWidth:0}}>
      <span style={{fontSize:13,color:"var(--text-1)",display:"flex",alignItems:"center",gap:7,whiteSpace:"nowrap"}}>{d.name}{d.self&&<span style={{fontSize:10,color:"var(--gd-text-faint)",border:"1px solid var(--gd-line-strong)",borderRadius:3,padding:"0 5px",lineHeight:"15px",flex:"none"}}>本机</span>}</span>
      <span style={{display:"flex",alignItems:"center",gap:6}}><PDot kind={map.dot} pulse={busy}/>{map.badge}{d.state==="active"&&<span style={{fontFamily:"var(--font-mono)",fontSize:11,color:"var(--gd-gold)"}}>Epoch {d.epoch}</span>}</span>
    </div>
    <span style={{flex:1,minWidth:0,fontSize:12,color:"var(--gd-text-muted)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{map.meta}</span>
    <span style={{fontFamily:"var(--font-mono)",fontSize:11,color:"var(--gd-text-faint)",width:80,flex:"none",textAlign:"right",whiteSpace:"nowrap"}}>{d.last}</span>
    <span style={{width:108,flex:"none",display:"flex",justifyContent:"flex-end"}}>
      {d.state==="standby"&&<PBtn size="sm" onClick={()=>onHandoff(d)}>移交执行权</PBtn>}
      {d.state==="sunset"&&<PBtn size="sm" variant="ghost">移除</PBtn>}
      {busy&&<window.GDI.RefreshCw size={14} style={{color:"var(--gd-text-muted)",animation:"gd-spinner 1s linear infinite"}}/>}
    </span>
  </div>;
}

function Settings({activeDevice,onSetActive,onRunOnboarding,role}){
  const I=window.GDI;
  const standby=role==="standby";
  const [sec,setSec]=React.useState("device");
  const [devices,setDevices]=React.useState(()=>[
    {id:"mac",name:"MacBook Pro",self:true,state:"active",epoch:activeDevice.epoch,last:"现在"},
    {id:"iph",name:"iPhone 17",self:false,state:"standby",last:"08:30"},
    {id:"air",name:"MacBook Air (2019)",self:false,state:"sunset",last:"06-12"},
  ]);
  const [handoff,setHandoff]=React.useState(null);
  const [ack,setAck]=React.useState(false);
  const [forced,setForced]=React.useState(false);
  const [connect,setConnect]=React.useState(null);
  const [autoSync,setAutoSync]=React.useState(true);
  const [readonly,setReadonly]=React.useState(true);
  const runHandoff=()=>{
    const to=handoff;setHandoff(null);setAck(false);
    const nextEpoch=(devices.find(d=>d.state==="active").epoch||41)+1;
    setDevices(ds=>ds.map(d=>d.state==="active"?{...d,state:"draining"}:d.id===to.id?{...d,state:"activating"}:d));
    setTimeout(()=>{
      setDevices(ds=>ds.map(d=>d.state==="draining"?{...d,state:"standby",last:"现在"}:d.id===to.id?{...d,state:"active",epoch:nextEpoch,self:false,last:"现在"}:d));
      onSetActive({name:to.name,epoch:nextEpoch});
    },1500);
  };
  const conns={
    registrar:[["Spaceship","ok","812 域名 · 主注册商","","14:02"],["Namecheap","ok","142 域名","","13:58"],["Dynadot","warn","69 域名 · Token 过期","","—"]],
    dns:[["Cloudflare","ok","601 区域 · A/CNAME/TXT/MX","","14:02"]],
    // 交易平台按账号连接：同平台可挂多个 ProviderConnection，各自独立凭据 / Profile / 限流桶
    platform:[
      {platform:"Atom",account:"主账户",remoteId:"atom:acc_7Q2",kind:"ok",meta:"423 Listing",method:"API",quota:"独立限流",last:"14:01"},
      {platform:"Atom",account:"子账户 B",remoteId:"atom:acc_B3F",kind:"warn",meta:"88 Listing · API Key 08-09 到期",method:"API",quota:"独立限流",last:"09:00"},
      {platform:"Afternic",account:"主账户",remoteId:"afternic:main",kind:"ok",meta:"601 Listing · 需 CSV 人工",method:"CSV",quota:"独立限流",last:"07-28"},
      {platform:"SellerHub",account:"主账户",remoteId:"—",kind:"off",meta:"未连接",method:"",quota:"",last:"—"},
    ],
  };

  const content={
    conn:<div style={{display:"flex",flexDirection:"column",gap:14}}>
      <PPanel flush title="注册商" actions={<span style={{fontSize:11,color:"var(--gd-text-faint)"}}>Nameserver 变更处理平台</span>}>
        {conns.registrar.map(c=><ConnRow key={c[0]} name={c[0]} kind={c[1]} meta={c[2]} method={c[3]} last={c[4]} standby={standby}/>)}
      </PPanel>
      <PPanel flush title="DNS 提供商" actions={<span style={{fontSize:11,color:"var(--gd-text-faint)"}}>DNS 记录处理平台</span>}>
        {conns.dns.map(c=><ConnRow key={c[0]} name={c[0]} kind={c[1]} meta={c[2]} method={c[3]} last={c[4]} standby={standby}/>)}
      </PPanel>
      <PPanel flush title="交易平台" actions={<span style={{fontSize:11,color:"var(--gd-text-faint)"}}>改价 / 上下架处理平台 · 按账号连接</span>}>
        {conns.platform.map(c=><ConnRow key={c.platform+c.account} name={c.platform} account={c.account} remoteId={c.remoteId} kind={c.kind} meta={c.meta} method={c.method} quota={c.quota} last={c.last} standby={standby} onConnect={setConnect}/>)}
        {!standby&&<div style={{display:"flex",alignItems:"center",gap:9,padding:"10px 14px"}}>
          <PBtn size="sm" variant="ghost" icon={<I.ExternalLink size={13}/>} onClick={()=>setConnect({pick:true})}>新增账户连接</PBtn>
          <span style={{fontSize:11,color:"var(--gd-text-faint)"}}>同一平台可连接多个账户，各自独立凭据、浏览器 Profile 与限流桶</span>
        </div>}
      </PPanel>
      <div style={{display:"flex",flexDirection:"column",gap:9,paddingTop:2}}>
        <span style={{fontSize:11,color:"var(--gd-text-faint)"}}>{standby?"只读视图仅显示非秘密的本机配置标记，不读取 Keychain / Browser Profile / 凭据值，也不发起健康检查；「曾配置候选」不代表凭据可用，需切换为 Active 后本机检查。":"凭据经本地密钥加密保存，永不上云。断开仅移除本地授权，不影响平台侧数据。"}</span>
        {onRunOnboarding&&<div style={{display:"flex",alignItems:"center",gap:10}}><PBtn size="sm" onClick={onRunOnboarding}>重新运行接入向导</PBtn><span style={{fontSize:11,color:"var(--gd-text-faint)"}}>设备门禁 · 连接 · 首次导入</span></div>}
      </div>
    </div>,
    device:forced?<div style={{display:"flex",flexDirection:"column",gap:14}}>
      <div style={{display:"flex",alignItems:"center",gap:10}}>
        <PBtn size="sm" variant="ghost" icon={<I.ChevronLeft size={13}/>} onClick={()=>setForced(false)}>返回设备</PBtn>
        <span style={{fontSize:12,color:"var(--gd-text-faint)"}}>强制切换 · 旧设备不可达</span>
      </div>
      <window.GDForcedSwitch onExit={()=>setForced(false)}/>
    </div>:<div style={{display:"flex",flexDirection:"column",gap:14}}>
      <PPanel flush title="设备与执行权（ActiveDeviceLease）" actions={<span style={{fontFamily:"var(--font-mono)",fontSize:11,color:"var(--gd-gold)"}}>Epoch {devices.find(d=>d.state==="active"||d.state==="draining")?.epoch||activeDevice.epoch}</span>}>
        {devices.map(d=><DeviceRow key={d.id} d={d} onHandoff={setHandoff}/>)}
      </PPanel>
      <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",border:"1px solid var(--gd-line)",borderRadius:7,background:"var(--gd-panel)"}}>
        <window.GDI.AlertTriangle size={15} style={{color:"var(--gd-warning)",flex:"none"}}/>
        <span style={{fontSize:12,color:"var(--gd-text-muted)"}}>旧设备不可达、无法正常排空交接时，可申请强制切换并等待其离线许可到期。</span>
        <PBtn size="sm" style={{marginLeft:"auto"}} onClick={()=>setForced(true)}>申请强制切换</PBtn>
      </div>
      <div style={{display:"flex",gap:12,padding:"11px 14px",border:"1px solid var(--gd-line)",borderRadius:7,background:"var(--gd-panel)"}}>
        <img src="../../assets/icons/active-lease.svg" width="26" height="26" alt="" style={{flex:"none",marginTop:1}}/>
        <span style={{fontSize:12,color:"var(--gd-text-muted)",lineHeight:1.6}}>同一时刻只有一台设备持有执行权（<b style={{color:"var(--gd-gold)",fontWeight:500}}>金实心 = Active</b>，蓝空心 = Standby）。移交时旧设备<b style={{color:"var(--gd-text)",fontWeight:500}}>排空</b>未同步项后释放，新设备<b style={{color:"var(--gd-text)",fontWeight:500}}>正在安全激活</b>并由服务端签发新 Lease，Epoch 递增。退役设备进入 <b style={{color:"var(--gd-text)",fontWeight:500}}>Sunset · LocalContinuation</b> 保留态，仅本地只读，无执行权。</span>
      </div>
    </div>,
    license:<PPanel title="许可与所有权" actions={<PBadge tone="gold">年付 License</PBadge>}>
      <div style={{display:"flex",gap:14,alignItems:"flex-start",marginBottom:6}}>
        <img src="../../assets/icons/keyhole.svg" width="30" height="30" alt="" style={{flex:"none",marginTop:4,opacity:.9}}/>
        <div style={{flex:1}}>
          <KV k="License">年付 · 有效至 <span style={{fontFamily:"var(--font-mono)"}}>2026-12-31</span></KV>
          <KV k="所有权验证">本地密钥签发 · <span style={{color:"var(--gd-success)"}}>已验证</span></KV>
          <KV k="Workspace" muted>个人 · 4 平台 · 5 账户</KV>
          <div style={{display:"flex",gap:8,marginTop:12,justifyContent:"flex-end"}}><PBtn size="sm" variant="ghost" icon={<I.ExternalLink size={13}/>}>管理订阅</PBtn><PBtn size="sm">续期</PBtn></div>
        </div>
      </div>
    </PPanel>,
    sync:<PPanel title="同步偏好">
      <div style={{display:"flex",flexDirection:"column"}}>
        <KV k="自动同步"><PSwitch checked={autoSync} onChange={()=>setAutoSync(v=>!v)}/></KV>
        <KV k="同步间隔"><PSel size="sm" options={["实时","每 5 分钟","每 15 分钟","仅手动"]} value="每 5 分钟" onChange={()=>{}}/></KV>
        <KV k="离线只读"><PSwitch checked={readonly} onChange={()=>setReadonly(v=>!v)}/></KV>
        <KV k="冲突策略"><PSel size="sm" options={["总是人工裁决","优先本地","优先云端"]} value="总是人工裁决" onChange={()=>{}}/></KV>
        <div style={{fontSize:11,color:"var(--gd-text-faint)",paddingTop:10,lineHeight:1.6}}>离线只读开启时，云端不可达即进入只读视图，常驻显示「数据来自 GoodDealer Cloud · 截至时间」。冲突项永不自动覆盖，统一入冲突中心人工裁决。</div>
      </div>
    </PPanel>,
    backup:<window.GDBackupRestore/>,
    about:<PPanel title="关于">
      <div style={{display:"flex",flexDirection:"column"}}>
        <KV k="语言 / Locale"><PSel size="sm" options={["中文（zh-CN）","English (en-US)"]} value="中文（zh-CN）" onChange={()=>{}}/></KV>
        <KV k="版本" muted><span style={{fontFamily:"var(--font-mono)"}}>0.9.0 · Tauri</span></KV>
        <KV k="本地数据目录" muted><span style={{fontFamily:"var(--font-mono)",fontSize:11}}>~/Library/GoodDealer</span></KV>
        <KV k="Revision 基线" muted><span style={{fontFamily:"var(--font-mono)"}}>8,241</span></KV>
      </div>
    </PPanel>,
  };

  return <div data-screen-label="设置" style={{display:"flex",height:"100%",minHeight:0}}>
    <aside style={{width:176,flex:"none",borderRight:"1px solid var(--gd-line)",background:"var(--gd-panel)",padding:8,display:"flex",flexDirection:"column",gap:2}}>
      {SECTIONS.map(([k,l])=><button key={k} onClick={()=>setSec(k)} style={{textAlign:"left",height:31,padding:"0 10px",borderRadius:5,border:"none",cursor:"pointer",fontSize:13,fontFamily:"var(--font-sans)",
        background:sec===k?"var(--gd-panel-raised)":"transparent",color:sec===k?"var(--text-1)":"var(--text-2)"}}>{l}</button>)}
    </aside>
    <div style={{flex:1,minWidth:0,overflow:"auto",padding:16}}><div style={{maxWidth:760}}>{content[sec]}</div></div>
    <PDlg open={!!handoff} onClose={()=>{setHandoff(null);setAck(false);}} title="移交执行权 · ActiveDeviceLease" width={512}
      footer={<><PBtn onClick={()=>{setHandoff(null);setAck(false);}}>取消</PBtn><PBtn variant="primary" disabled={!ack} onClick={runHandoff}>移交到 {handoff&&handoff.name}</PBtn></>}>
      {handoff&&<div style={{display:"flex",flexDirection:"column",gap:12}}>
        <span style={{fontSize:13}}>将执行权从 <b>MacBook Pro（本机）</b> 移交到 <b>{handoff.name}</b>。</span>
        <div style={{border:"1px solid var(--gd-line-strong)",borderRadius:7,background:"var(--gd-panel)",padding:"11px 13px",display:"flex",flexDirection:"column",gap:8,fontSize:12,color:"var(--gd-text-muted)",lineHeight:1.5}}>
          <span><b style={{color:"var(--gd-text)",fontWeight:500}}>① 排空</b>：本机先提交 Outbox 未同步项并释放当前 Lease。</span>
          <span><b style={{color:"var(--gd-text)",fontWeight:500}}>② 正在安全激活</b>：{handoff.name} 校验通过后，服务端签发新 ActiveDeviceLease。</span>
          <span><b style={{color:"var(--gd-text)",fontWeight:500}}>③ Epoch 递增</b>：{devices.find(d=>d.state==="active").epoch} → {(devices.find(d=>d.state==="active").epoch||41)+1}，本机转为 Standby。</span>
        </div>
        <div style={{borderTop:"1px solid var(--gd-line)",paddingTop:10}}><PCheck checked={ack} onChange={()=>setAck(a=>!a)} label="我确认移交执行权；期间本机将暂时无法执行写操作"/></div>
      </div>}
    </PDlg>
    {connect&&<window.GDConnectFlow pick={connect.pick} platform={connect.platform} account={connect.account} onClose={()=>setConnect(null)} onConnected={()=>{}}/>}
  </div>;
}
window.GDSettings=Settings;
