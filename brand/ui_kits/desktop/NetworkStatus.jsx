// 三轴网络状态 / NetworkStatus — the cross-cutting reachability base (PRD §5, UX_FLOWS §6).
// Network capability is judged on THREE independent axes: 设备基础网络 · GoodDealer Cloud · 每个目标 Provider.
// Rules encoded here:
//  · Device fully offline → an Active with a valid cached session/signed grant may still view local
//    assets, edit desired state and PREPARE plans, but reaches NO external platform.
//  · Cloud unreachable while a Provider is reachable → the Active may keep reading/writing THAT provider
//    inside a signed offline-execution window (≤24h); Cloud sync & device switch pause.
//  · A Provider unreachable → only THAT provider's read/submit/confirm pauses.
//  · Combined faults take the STRICTEST intersection and show EVERY reason at once — a Cloud-only
//    status must never mask a device or provider fault.
// Two surfaces: GDNetworkStatus (always-on tri-axis cluster in the StatusBar + detail popover) and
// GDNetworkBanner (degradation banner above the work area, listing all active reasons + offline window).
const {StatusDot:NDot,Badge:NBadge,Button:NBtn}=window.GoodDealerDesignSystem_b5b0b6;

const NET_SCENARIOS={
  healthy:{device:"ok",cloud:"ok",providers:[["Atom","ok"],["Afternic","ok"],["SellerHub","ok"],["Cloudflare","ok"]]},
  device_offline:{device:"down",cloud:"down",providers:[["Atom","down"],["Afternic","down"],["SellerHub","down"],["Cloudflare","down"]]},
  cloud_down:{device:"ok",cloud:"down",providers:[["Atom","ok"],["Afternic","ok"],["SellerHub","ok"],["Cloudflare","ok"]],offlineWindow:"23:41"},
  provider_down:{device:"ok",cloud:"ok",providers:[["Atom","ok"],["Afternic","ok"],["SellerHub","down"],["Cloudflare","ok"]]},
  combined:{device:"ok",cloud:"down",providers:[["Atom","ok"],["Afternic","ok"],["SellerHub","down"],["Cloudflare","ok"]],offlineWindow:"21:08"},
};
const NET_PRESETS=[["healthy","正常"],["device_offline","设备断网"],["cloud_down","Cloud 不可达"],["provider_down","平台不可达"],["combined","组合故障"]];

function netModel(net){
  const s=NET_SCENARIOS[net]||NET_SCENARIOS.healthy;
  const deviceDown=s.device==="down";
  const cloudDown=s.cloud==="down";
  const provs=s.providers.map(([name,st])=>({name,st:deviceDown?"down":st}));
  const provDown=provs.filter(p=>p.st==="down");
  const reachN=provs.length-provDown.length;
  // axis dot tones
  const deviceTone=deviceDown?"danger":"success";
  const cloudTone=deviceDown?"danger":cloudDown?"warning":"success";
  const platTone=deviceDown?"danger":provDown.length?(provDown.length===provs.length?"danger":"warning"):"success";
  const worst=[deviceTone,cloudTone,platTone].includes("danger")?"danger":[deviceTone,cloudTone,platTone].includes("warning")?"warning":"success";
  // reasons — every active fault, never collapsed to one
  const reasons=[];
  if(deviceDown){reasons.push({tone:"danger",title:"设备已断网",text:"无法访问任何外部平台与 GoodDealer Cloud；可查看本地资产、编辑目标状态、准备操作计划。"});}
  else{
    if(cloudDown)reasons.push({tone:"warning",title:"GoodDealer Cloud 不可达",text:"在签名离线执行窗口内可继续可达平台读写；云端同步与设备切换暂停。"});
    provDown.forEach(p=>reasons.push({tone:"warning",title:p.name+" 不可达",text:"仅暂停该平台的读取、提交与确认，其他平台不受影响。"}));
  }
  // strictest-intersection effect
  const paused=[];
  if(deviceDown)paused.push("全部平台读取 / 提交 / 确认（设备断网）");
  else{
    if(provDown.length)paused.push(provDown.map(p=>p.name).join("、")+" 的读取 / 提交 / 确认");
    if(cloudDown)paused.push("GoodDealer Cloud 同步 / 设备切换");
  }
  return {deviceDown,cloudDown,provs,provDown,reachN,total:provs.length,deviceTone,cloudTone,platTone,worst,reasons,paused,
    offlineWindow:(cloudDown&&!deviceDown)?s.offlineWindow:null,
    degraded:deviceDown||cloudDown||provDown.length>0,
    allowed:"查看本地资产 · 编辑目标状态 · 准备操作计划"};
}

// —— always-on tri-axis cluster for the StatusBar (click → detail popover) ——
function NetworkStatus({net="healthy",onNet}){
  const [open,setOpen]=React.useState(false);
  const m=netModel(net);
  const seg=(tone,label)=><span style={{display:"inline-flex",alignItems:"center",gap:5}}><NDot kind={tone} size={7}/>{label}</span>;
  const wc={success:"var(--gd-success)",warning:"var(--gd-warning)",danger:"var(--gd-danger)"}[m.worst];
  return <>
    <button onClick={()=>setOpen(o=>!o)} style={{display:"inline-flex",alignItems:"center",gap:9,background:"none",border:"none",padding:0,cursor:"pointer",font:"inherit",color:"var(--text-2)"}}>
      {seg(m.deviceTone,"设备")}<span style={{color:"var(--text-3)"}}>·</span>
      {seg(m.cloudTone,"Cloud")}<span style={{color:"var(--text-3)"}}>·</span>
      <span style={{display:"inline-flex",alignItems:"center",gap:5}}><NDot kind={m.platTone} size={7}/>平台 <span style={{color:m.provDown.length?wc:"var(--text-3)"}}>{m.reachN}/{m.total}</span></span>
      {m.offlineWindow&&<span style={{color:"var(--gd-warning)"}}>· 离线窗 {m.offlineWindow}</span>}
    </button>
    {open&&<>
      <div onClick={()=>setOpen(false)} style={{position:"fixed",inset:0,zIndex:60}}></div>
      <div style={{position:"fixed",left:24,bottom:44,zIndex:61,width:340,background:"var(--gd-panel-raised)",border:"1px solid var(--gd-line-strong)",borderRadius:9,boxShadow:"var(--shadow-overlay)",padding:14,display:"flex",flexDirection:"column",gap:11,fontFamily:"var(--font-sans)"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <span className="gd-t-label">网络状态 · 三轴独立判定</span>
          {m.degraded?<NBadge tone={m.worst==="danger"?"danger":"warning"} mono={false}>降级</NBadge>:<NBadge tone="success" mono={false}>正常</NBadge>}
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:9,fontSize:12}}>
          <AxisRow dot={m.deviceTone} name="设备基础网络" status={m.deviceDown?"断网":"正常"}/>
          <AxisRow dot={m.cloudTone} name="GoodDealer Cloud" status={m.deviceDown?"不可达（随设备）":m.cloudDown?"不可达 · 离线窗口":"已连接"}/>
          <AxisRow dot={m.platTone} name="平台接入" status={m.deviceDown?"全部暂停":m.provDown.length?`${m.reachN}/${m.total} 可达`:"全部可达"}/>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,paddingLeft:16}}>
            {m.provs.map(p=><span key={p.name} style={{display:"flex",alignItems:"center",gap:6,fontSize:11,color:p.st==="down"?"var(--gd-danger)":"var(--gd-text-muted)"}}><NDot kind={p.st==="down"?"danger":"success"} size={6}/>{p.name}</span>)}
          </div>
        </div>
        {m.offlineWindow&&<div style={{display:"flex",alignItems:"center",gap:8,padding:"8px 10px",background:"var(--gd-warning-tint)",border:"1px solid var(--gd-warning)",borderRadius:6,fontSize:11}}>
          <span style={{color:"var(--gd-warning)"}}>签名离线执行窗口</span><span style={{marginLeft:"auto",fontFamily:"var(--font-mono)",color:"var(--gd-warning)"}}>剩 {m.offlineWindow}</span>
        </div>}
        <div style={{borderTop:"1px solid var(--gd-line)",paddingTop:9,display:"flex",flexDirection:"column",gap:5,fontSize:11}}>
          <div><span style={{color:"var(--gd-text-faint)"}}>当前可执行：</span><span style={{color:"var(--gd-text-muted)"}}>{m.allowed}</span></div>
          <div><span style={{color:"var(--gd-text-faint)"}}>已暂停：</span><span style={{color:m.paused.length?"var(--gd-warning)":"var(--gd-text-muted)"}}>{m.paused.length?m.paused.join("；"):"无"}</span></div>
          <span style={{color:"var(--gd-text-faint)",lineHeight:1.5}}>组合故障时权限取最严格交集，全部原因同时展示，不以 Cloud 状态掩盖设备或平台故障。</span>
        </div>
        {onNet&&<div style={{borderTop:"1px solid var(--gd-line)",paddingTop:9}}>
          <span className="gd-t-label" style={{fontSize:10}}>预览场景</span>
          <div style={{display:"flex",flexWrap:"wrap",gap:5,marginTop:6}}>
            {NET_PRESETS.map(([k,l])=><button key={k} onClick={()=>onNet(k)} style={{fontSize:11,padding:"3px 8px",borderRadius:5,cursor:"pointer",fontFamily:"var(--font-sans)",
              background:net===k?"var(--gd-panel)":"transparent",border:`1px solid ${net===k?"var(--gd-line-strong)":"var(--gd-line)"}`,color:net===k?"var(--text-1)":"var(--text-3)"}}>{l}</button>)}
          </div>
        </div>}
      </div>
    </>}
  </>;
}
function AxisRow({dot,name,status}){
  return <div style={{display:"flex",alignItems:"center",gap:9}}>
    <NDot kind={dot} size={8}/><span style={{color:"var(--text-1)"}}>{name}</span>
    <span style={{marginLeft:"auto",color:dot==="danger"?"var(--gd-danger)":dot==="warning"?"var(--gd-warning)":"var(--gd-text-muted)",fontFamily:"var(--font-mono)",fontSize:11}}>{status}</span>
  </div>;
}
window.GDNetworkStatus=NetworkStatus;

// —— degradation banner above the work area (all reasons + offline window) ——
function NetworkBanner({net="healthy"}){
  const m=netModel(net);
  if(!m.degraded)return null;
  const I=window.GDI;
  const bc={danger:"var(--gd-danger)",warning:"var(--gd-warning)"}[m.worst];
  const bg={danger:"var(--gd-danger-tint)",warning:"var(--gd-warning-tint)"}[m.worst];
  return <div style={{flex:"none",borderBottom:`1px solid ${bc}`,background:bg,padding:"9px 16px",display:"flex",alignItems:"flex-start",gap:11}}>
    <I.ShieldAlert size={16} style={{color:bc,flex:"none",marginTop:1}}/>
    <div style={{flex:1,minWidth:0,display:"flex",flexDirection:"column",gap:5}}>
      {m.reasons.map((r,i)=><div key={i} style={{display:"flex",alignItems:"baseline",gap:8,fontSize:12,lineHeight:1.5}}>
        <NDot kind={r.tone} size={7} style={{alignSelf:"center"}}/><b style={{color:"var(--text-1)",fontWeight:500}}>{r.title}</b><span style={{color:"var(--gd-text-muted)"}}>{r.text}</span>
      </div>)}
      <span style={{fontSize:11,color:"var(--gd-text-faint)"}}>可执行：{m.allowed}{m.paused.length?" · 已暂停："+m.paused.join("；"):""}</span>
    </div>
    {m.offlineWindow&&<div style={{flex:"none",alignSelf:"center",display:"flex",flexDirection:"column",alignItems:"flex-end",gap:2}}>
      <span style={{fontSize:10,color:"var(--gd-text-faint)"}}>离线执行窗口</span>
      <span style={{fontFamily:"var(--font-mono)",fontSize:14,color:"var(--gd-warning)"}}>剩 {m.offlineWindow}</span>
    </div>}
  </div>;
}
window.GDNetworkBanner=NetworkBanner;
