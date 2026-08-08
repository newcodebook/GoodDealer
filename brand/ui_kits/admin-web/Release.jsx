// 发布与政策 / Release & Policy — app release channels (min-version gate, rollout) + the network policy that
// IS the source of the desktop tri-axis network's Cloud axis and per-Provider axis. Pausing a provider or the
// cloud is HIGH-IMPACT: it propagates to every user's client (strictest-intersection tightens). So a change is
// published through a ceremony (impact preview + reason + typed PurposeRef + Passkey) and appended to policyLog.
const {Badge:RlBadge,Button:RlBtn,Dialog:RlDlg,Input:RlInput}=window.GoodDealerDesignSystem_b5b0b6;

function Release(){
  const R0=window.ADM_DATA.release;
  const [providers,setProviders]=React.useState(R0.providers);
  const [cloud,setCloud]=React.useState(R0.cloud);
  const [log,setLog]=React.useState(R0.policyLog);
  const [pub,setPub]=React.useState(null); // {scope:'cloud'|'provider', name, from, to}
  const [reason,setReason]=React.useState("");
  const [ref,setRef]=React.useState("");
  const [passkey,setPasskey]=React.useState(false);
  const openPub=(p)=>{setReason("");setRef("");setPasskey(false);setPub(p);};
  const impact=pub&&(pub.scope==="cloud"
    ?"影响全平台所有账户的云端调度；设备本地只读缓存与手动兜底不受影响；桌面端三轴网络的云端轴据此收紧。"
    :`影响 ${(providers.find(x=>x.name===pub.name)||{}).accounts} 个该平台账户的自动化执行；其余平台与手动兜底不受影响；桌面端三轴网络的平台轴对该平台收紧。`);
  const publish=()=>{
    if(pub.scope==="provider") setProviders(ps=>ps.map(p=>p.name===pub.name?{...p,automation:pub.to,window:pub.to==="paused"?"手动至恢复":undefined,reason:pub.to==="paused"?reason:undefined}:p));
    else setCloud({state:pub.to,note:pub.to==="paused"?"已暂停云端调度":"云端调度正常"});
    setLog(l=>[{at:"刚刚",change:pub.label,by:"Owner",reason,ref},...l]);
    setPub(null);
  };

  return <div style={{display:"flex",flexDirection:"column",gap:20}}>
    <div><h1 className="adm-h1">发布与政策</h1><p className="adm-sub" style={{margin:0}}>客户端发布通道与网络政策。此处发布的 Cloud / Provider 策略即桌面端三轴网络的云端轴与平台轴来源。</p></div>

    {/* Release channels (read-only board) */}
    <div className="adm-card" style={{padding:0,overflow:"hidden"}}>
      <div style={{padding:"13px 18px 10px",fontSize:11,letterSpacing:"0.08em",textTransform:"uppercase",color:"var(--text-3)"}}>发布通道</div>
      <div style={{display:"flex",padding:"8px 18px",borderTop:"1px solid var(--gd-line-strong)",fontSize:10,letterSpacing:"0.05em",textTransform:"uppercase",color:"var(--text-3)"}}>
        <span style={{width:110,flex:"none"}}>平台</span><span style={{flex:1}}>稳定版</span><span style={{flex:1}}>Beta</span><span style={{width:110,flex:"none"}}>最低支持</span><span style={{width:90,flex:"none",textAlign:"right"}}>灰度</span>
      </div>
      {R0.channels.map(c=><div key={c.platform} style={{display:"flex",alignItems:"center",padding:"11px 18px",borderTop:"1px solid var(--gd-line)",fontSize:12}}>
        <span style={{width:110,flex:"none",color:"var(--text-1)"}}>{c.platform}</span>
        <span style={{flex:1,fontFamily:"var(--font-mono)",color:"var(--text-2)"}}>{c.stable}</span>
        <span style={{flex:1,fontFamily:"var(--font-mono)",color:"var(--text-3)"}}>{c.beta}</span>
        <span style={{width:110,flex:"none",fontFamily:"var(--font-mono)",color:"var(--text-3)"}}>{c.min} <RlBadge tone="neutral" mono={false}>门槛</RlBadge></span>
        <span style={{width:90,flex:"none",textAlign:"right",fontFamily:"var(--font-mono)",color:"var(--text-2)"}}>{c.rollout}</span>
      </div>)}
      <div style={{padding:"10px 18px",fontSize:11,color:"var(--text-3)",borderTop:"1px solid var(--gd-line)"}}>低于最低支持版本的客户端被门槛拦截，须升级；灰度与门槛调整同样以政策发布记录，追加审计。</div>
    </div>

    {/* Network policy — Cloud axis + Provider axis */}
    <div className="adm-card" style={{padding:"16px 20px",display:"flex",flexDirection:"column",gap:14}}>
      <div style={{fontSize:11,letterSpacing:"0.08em",textTransform:"uppercase",color:"var(--text-3)"}}>网络政策 · 三轴来源</div>
      {/* cloud axis */}
      <div style={{display:"flex",alignItems:"center",gap:12,padding:"10px 12px",border:"1px solid var(--gd-line)",borderRadius:8,flexWrap:"wrap"}}>
        <span style={{width:8,height:8,borderRadius:"50%",background:cloud.state==="available"?"var(--gd-success)":"var(--gd-danger)"}}></span>
        <span style={{fontSize:13,color:"var(--text-1)"}}>云端调度（Cloud 轴）</span>
        <RlBadge tone={cloud.state==="available"?"success":"danger"} mono={false}>{cloud.state==="available"?"可用":"已暂停"}</RlBadge>
        <span style={{flex:1,minWidth:80,fontSize:11,color:"var(--text-3)"}}>{cloud.note}</span>
        {cloud.state==="available"
          ?<RlBtn size="sm" variant="danger" onClick={()=>openPub({scope:"cloud",to:"paused",from:"available",label:"暂停云端调度"})}>暂停调度</RlBtn>
          :<RlBtn size="sm" variant="secondary" onClick={()=>openPub({scope:"cloud",to:"available",from:"paused",label:"恢复云端调度"})}>恢复调度</RlBtn>}
      </div>
      {/* provider axis */}
      <div>
        <div style={{fontSize:11,color:"var(--text-3)",marginBottom:6}}>平台自动化（Provider 轴）</div>
        {providers.map(p=><div key={p.name} style={{display:"flex",alignItems:"center",gap:12,padding:"9px 12px",borderTop:"1px solid var(--gd-line)",fontSize:13,flexWrap:"wrap"}}>
          <span style={{width:90,flex:"none"}}>{p.name}</span>
          <span style={{fontSize:11,color:"var(--text-3)",width:56,flex:"none"}}>{p.accounts} 账户</span>
          <RlBadge tone={p.automation==="on"?"success":"warning"} mono={false}>{p.automation==="on"?"自动化开":"已暂停"}</RlBadge>
          <span style={{flex:1,minWidth:80,fontSize:11,color:"var(--text-3)"}}>{p.automation==="paused"?(p.window?("暂停 "+p.window):"手动至恢复")+(p.reason?" · "+p.reason:""):"—"}</span>
          {p.automation==="on"
            ?<RlBtn size="sm" variant="secondary" onClick={()=>openPub({scope:"provider",name:p.name,to:"paused",from:"on",label:p.name+" 自动化暂停"})}>暂停</RlBtn>
            :<RlBtn size="sm" variant="secondary" onClick={()=>openPub({scope:"provider",name:p.name,to:"on",from:"paused",label:p.name+" 自动化恢复"})}>恢复</RlBtn>}
        </div>)}
      </div>
      <div style={{fontSize:11,color:"var(--text-3)",lineHeight:1.6}}>桌面端按设备/Cloud/Provider 三轴取最严交集并展示每条原因。此处暂停即平台轴收紧——不改变凭据、不登出用户，仅停自动化执行。</div>
    </div>

    {/* policy log */}
    <div className="adm-card" style={{padding:0,overflow:"hidden"}}>
      <div style={{padding:"13px 18px 8px",display:"flex",alignItems:"center",gap:8}}>
        <span style={{fontSize:11,letterSpacing:"0.08em",textTransform:"uppercase",color:"var(--text-3)"}}>政策发布记录</span><RlBadge tone="neutral" mono={false}>追加不可改</RlBadge>
      </div>
      {log.map((e,i)=><div key={i} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 18px",borderTop:"1px solid var(--gd-line)",fontSize:12,flexWrap:"wrap"}}>
        <span style={{fontFamily:"var(--font-mono)",fontSize:11,color:"var(--text-3)",width:96,flex:"none"}}>{e.at}</span>
        <span style={{flex:"1 1 200px",color:"var(--text-1)"}}>{e.change}</span>
        <span style={{fontSize:11,color:"var(--text-3)"}}>{e.reason} · {e.by} · {e.ref}</span>
      </div>)}
    </div>

    {/* publish ceremony */}
    <RlDlg open={!!pub} onClose={()=>setPub(null)} title={pub?("发布政策 · "+pub.label):""} width={500}
      footer={<><RlBtn onClick={()=>setPub(null)}>取消</RlBtn><RlBtn variant="danger" disabled={!reason.trim()||!ref.trim()||!passkey} onClick={publish}>确认发布</RlBtn></>}>
      {pub&&<div style={{display:"flex",flexDirection:"column",gap:13}}>
        <div style={{border:"1px solid var(--gd-line-strong)",borderRadius:8,padding:"11px 13px",background:"var(--gd-ink)",display:"flex",flexDirection:"column",gap:6}}>
          <div style={{display:"flex",alignItems:"center",gap:8,fontSize:12,fontFamily:"var(--font-mono)"}}>
            <span style={{color:"var(--text-3)"}}>{pub.from}</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--gd-gold)" strokeWidth="2" strokeLinecap="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
            <span style={{color:"var(--text-1)"}}>{pub.to}</span>
          </div>
          <div style={{fontSize:11.5,color:"var(--text-2)",lineHeight:1.6}}>影响面：{impact}</div>
        </div>
        <RlInput label="理由" size="md" placeholder="记录发布依据" value={reason} onChange={e=>setReason(e.target.value)}/>
        <RlInput label="AdminPurposeRef（运维/事件 Ref）" size="md" mono placeholder="如 OPS-2026-102" value={ref} onChange={e=>setRef(e.target.value)}/>
        <div style={{borderTop:"1px solid var(--gd-line)",paddingTop:11,display:"flex",alignItems:"center",gap:10}}>
          {passkey?<RlBadge tone="success" mono={false}>高风险 Passkey 已确认</RlBadge>:<RlBtn size="sm" variant="gold" icon={<img src="../../assets/icons/keyhole.svg" width="14" height="14" alt=""/>} onClick={()=>setPasskey(true)}>高风险 Passkey 重新认证</RlBtn>}
          <span style={{fontSize:11,color:"var(--text-3)"}}>全局政策发布要求新鲜 Passkey。</span>
        </div>
      </div>}
    </RlDlg>
  </div>;
}
window.ADMRelease=Release;
