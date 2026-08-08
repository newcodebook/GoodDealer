// 账号 / Accounts (admin-web) — search/list, then a detail whose top carries a FIXED context header
// (目标账号 · Tenant · 当前 Scope · typed AdminPurposeRef) to prevent multi-tab misoperation. Reading
// cross-account business detail is gated by an AdminReadAuthorization ceremony (Scope + reason +
// AdminPurposeRef + fresh Passkey reauth); the grant is re-verified per read and can NEVER be exchanged
// for an AdminActionAuthorization. Admins never see platform credentials / cookies / keys / backup secrets.
const {Badge:ABadge,Button:ABtn,Dialog:ADlg,Input:AInput,Select:ASel,Checkbox:ACheck,Tag:ATag}=window.GoodDealerDesignSystem_b5b0b6;
const STATE={active:["success","有效"],grace:["warning","宽限期"],suspended:["danger","已暂停"],revoked:["neutral","已撤销"]};
const PLAN={monthly:"月付",annual:"年付",lifetime:"终身"};
const SCOPES=[["entitlement","Entitlement / License"],["devices","设备与 Lease"],["sessions","会话"],["security","安全状态"]];
const PURPOSE=[["support","SupportCaseReference"],["datarights","DataRightsRequestId"],["incident","SecurityIncidentId"]];
const PURPOSE_LABEL={support:"支持工单",datarights:"数据权利",incident:"安全事件"};

function Row({k,children}){return <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",padding:"9px 0",borderBottom:"1px solid var(--gd-line)",fontSize:13}}>
  <span style={{color:"var(--text-3)",fontSize:12}}>{k}</span><span style={{textAlign:"right"}}>{children}</span></div>;}

function Accounts({openId,onClearOpen}){
  const D=window.ADM_DATA;
  const [q,setQ]=React.useState("");
  const [sel,setSel]=React.useState(openId||null);
  React.useEffect(()=>{if(openId)setSel(openId);},[openId]);
  const [grant,setGrant]=React.useState(null); // {scope:[], purposeType, purposeId} after ceremony
  const [dlg,setDlg]=React.useState(false);
  // ceremony fields
  const [scope,setScope]=React.useState(SCOPES.map(s=>s[0]));
  const [reason,setReason]=React.useState("");
  const [ptype,setPtype]=React.useState("support");
  const [pid,setPid]=React.useState("");
  const [passkey,setPasskey]=React.useState(false);
  const openCeremony=()=>{setScope(SCOPES.map(s=>s[0]));setReason("");setPtype("support");setPid("");setPasskey(false);setDlg(true);};
  const grantAuth=()=>{setGrant({scope:[...scope],purposeType:ptype,purposeId:pid});setDlg(false);};
  const [act,setAct]=React.useState(null); // {kind,title} for AdminActionAuthorization
  const back=()=>{setSel(null);setGrant(null);setAct(null);onClearOpen&&onClearOpen();};

  const acct=sel?D.accounts.find(a=>a.id===sel):null;
  const list=D.accounts.filter(a=>!q||a.id.toLowerCase().includes(q.toLowerCase())||a.email.toLowerCase().includes(q.toLowerCase()));
  const dt=D.detail;

  if(!acct) return <div style={{display:"flex",flexDirection:"column",gap:16}}>
    <div><h1 className="adm-h1">账号</h1><p className="adm-sub" style={{margin:0}}>按账号 ID 或邮箱查找。打开明细需 AdminReadAuthorization 授权。</p></div>
    <div style={{position:"relative"}}><input value={q} onChange={e=>setQ(e.target.value)} placeholder="搜索 acc_ID 或邮箱…" style={{width:"100%",height:38,padding:"0 12px",background:"var(--gd-ink)",border:"1px solid var(--gd-line-strong)",borderRadius:6,color:"var(--text-1)",fontSize:13,outline:"none"}}/></div>
    <div className="adm-card" style={{padding:0,overflow:"hidden"}}>
      <div style={{display:"flex",padding:"9px 16px",borderBottom:"1px solid var(--gd-line-strong)",fontSize:10,letterSpacing:"0.06em",textTransform:"uppercase",color:"var(--text-3)"}}>
        <span style={{width:110,flex:"none"}}>账号 ID</span><span style={{flex:1}}>邮箱</span><span style={{width:70,flex:"none"}}>计划</span><span style={{width:80,flex:"none"}}>状态</span><span style={{width:56,flex:"none",textAlign:"right"}}>设备</span><span style={{width:130,flex:"none"}}></span>
      </div>
      {list.map(a=><div key={a.id} onClick={()=>setSel(a.id)} style={{display:"flex",alignItems:"center",padding:"11px 16px",borderTop:"1px solid var(--gd-line)",cursor:"pointer",fontSize:13}}>
        <span style={{width:110,flex:"none",fontFamily:"var(--font-mono)",fontSize:12,color:"var(--text-link)"}}>{a.id}</span>
        <span style={{flex:1,minWidth:0,color:"var(--text-2)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{a.email}</span>
        <span style={{width:70,flex:"none",color:"var(--text-3)"}}>{PLAN[a.plan]}</span>
        <span style={{width:80,flex:"none"}}><ABadge tone={STATE[a.state][0]} mono={false}>{STATE[a.state][1]}</ABadge></span>
        <span style={{width:56,flex:"none",textAlign:"right",fontFamily:"var(--font-mono)",color:"var(--text-2)"}}>{a.devices}/2</span>
        <span style={{width:130,flex:"none",display:"flex",gap:4,justifyContent:"flex-end"}}>{a.flags.map(f=><ATag key={f}>{f}</ATag>)}</span>
      </div>)}
    </div>
  </div>;

  return <div style={{display:"flex",flexDirection:"column",gap:16}}>
    <button onClick={back} style={{alignSelf:"flex-start",background:"none",border:"none",color:"var(--text-2)",cursor:"pointer",font:"inherit",fontSize:13,display:"inline-flex",alignItems:"center",gap:5}}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>账号列表</button>

    {/* FIXED context header — prevents multi-tab misoperation */}
    <div style={{border:"1px solid var(--gd-gold)",background:"var(--gd-gold-tint)",borderRadius:8,padding:"11px 16px",display:"flex",alignItems:"center",gap:16,flexWrap:"wrap"}}>
      <span style={{display:"flex",flexDirection:"column"}}><span style={{fontSize:10,color:"var(--gd-text-faint)"}}>目标账号</span><span style={{fontFamily:"var(--font-mono)",fontSize:14,color:"var(--text-1)"}}>{acct.id}</span></span>
      <span style={{display:"flex",flexDirection:"column"}}><span style={{fontSize:10,color:"var(--gd-text-faint)"}}>Tenant</span><span style={{fontFamily:"var(--font-mono)",fontSize:12}}>t_personal</span></span>
      <span style={{display:"flex",flexDirection:"column"}}><span style={{fontSize:10,color:"var(--gd-text-faint)"}}>当前 Scope</span><span style={{fontSize:12}}>{grant?grant.scope.length+" 项明细读":<span style={{color:"var(--gd-text-faint)"}}>无（未授权）</span>}</span></span>
      <span style={{display:"flex",flexDirection:"column"}}><span style={{fontSize:10,color:"var(--gd-text-faint)"}}>AdminPurposeRef</span>{grant?<span style={{display:"flex",alignItems:"center",gap:6,fontSize:12}}><ABadge tone="sync" mono={false}>{PURPOSE_LABEL[grant.purposeType]}</ABadge><span style={{fontFamily:"var(--font-mono)"}}>{grant.purposeId}</span></span>:<span style={{fontSize:12,color:"var(--gd-text-faint)"}}>未绑定</span>}</span>
      <span style={{marginLeft:"auto",fontSize:11,color:"var(--gd-text-muted)"}}>{acct.email}</span>
    </div>

    {!grant?
      /* read gate */
      <div className="adm-card" style={{padding:"22px 20px",display:"flex",flexDirection:"column",alignItems:"center",gap:12,textAlign:"center"}}>
        <img src="../../assets/icons/keyhole.svg" width="30" height="30" alt="" style={{opacity:.8}}/>
        <div style={{fontSize:15,fontWeight:500}}>读取业务明细需 AdminReadAuthorization</div>
        <div style={{fontSize:12,color:"var(--text-2)",maxWidth:440,lineHeight:1.6}}>跨账号明细不要求用户逐次授权，但没有 Scope、理由、有效 AdminPurposeRef 或新鲜 Passkey 重认证时拒绝访问。授权每次读取复验，且不能兑换为修改授权。</div>
        <ABtn variant="primary" onClick={openCeremony}>请求读取授权</ABtn>
      </div>
    :
      /* detail (read-only) */
      <>
        <div className="adm-card" style={{padding:"16px 20px"}}>
          <div style={{fontSize:11,letterSpacing:"0.08em",textTransform:"uppercase",color:"var(--text-3)",marginBottom:8}}>Entitlement / License</div>
          <Row k="计划 / 状态"><span>{dt.entitlement.plan} · <ABadge tone="success" mono={false}>{dt.entitlement.state}</ABadge></span></Row>
          <Row k="Entitlement Revision"><span style={{fontFamily:"var(--font-mono)"}}>{dt.entitlement.revision}</span></Row>
          <Row k="商业到期"><span style={{fontFamily:"var(--font-mono)"}}>{dt.entitlement.commercialExpires}</span></Row>
          <Row k="设备名额">{dt.entitlement.deviceLimit}</Row>
          <Row k="payment_watermark"><span style={{fontFamily:"var(--font-mono)",fontSize:11,color:"var(--text-3)"}}>{dt.entitlement.paymentWatermark}</span></Row>
        </div>

        <div className="adm-card" style={{padding:"16px 20px"}}>
          <div style={{fontSize:11,letterSpacing:"0.08em",textTransform:"uppercase",color:"var(--text-3)",marginBottom:10}}>设备与 ActiveDeviceLease</div>
          {dt.devices.map(d=><div key={d.name} style={{display:"flex",alignItems:"center",gap:12,padding:"8px 0",borderBottom:"1px solid var(--gd-line)"}}>
            <span style={{width:7,height:7,borderRadius:"50%",background:d.role==="active"?"var(--gd-gold)":"transparent",border:d.role==="active"?"none":"1.5px solid var(--gd-blue)"}}></span>
            <span style={{flex:1,fontSize:13}}>{d.name}<ABadge tone={d.role==="active"?"gold":"sync"} mono={false} style={{marginLeft:8}}>{d.role==="active"?"Active":"Standby"}</ABadge></span>
            <span style={{fontFamily:"var(--font-mono)",fontSize:11,color:"var(--text-3)"}}>lease_epoch {d.epoch} · cred_epoch {d.credEpoch} · {d.last}</span>
          </div>)}
        </div>

        <div style={{display:"flex",gap:14,flexWrap:"wrap"}}>
          <div className="adm-card" style={{flex:"1 1 260px",padding:"16px 20px"}}>
            <div style={{fontSize:11,letterSpacing:"0.08em",textTransform:"uppercase",color:"var(--text-3)",marginBottom:8}}>安全</div>
            <Row k="AccountSecurityState">{dt.security.state}</Row>
            <Row k="account_security_epoch"><span style={{fontFamily:"var(--font-mono)"}}>{dt.security.secEpoch}</span></Row>
            <Row k="上次改密"><span style={{fontFamily:"var(--font-mono)"}}>{dt.security.lastPwChange}</span></Row>
          </div>
          <div className="adm-card" style={{flex:"1 1 260px",padding:"16px 20px"}}>
            <div style={{fontSize:11,letterSpacing:"0.08em",textTransform:"uppercase",color:"var(--text-3)",marginBottom:8}}>Entitlement 事件（追加）</div>
            {dt.entitlementEvents.map((e,i)=><div key={i} style={{display:"flex",justifyContent:"space-between",fontSize:12,padding:"5px 0",color:"var(--text-2)"}}><span>{e.at} · {e.note}</span><span style={{fontFamily:"var(--font-mono)"}}>${e.amount}</span></div>)}
          </div>
        </div>

        {/* 管理动作 — each opens an independent AdminActionAuthorization (dry-run + high-risk Passkey) */}
        <div className="adm-card" style={{padding:"16px 20px",display:"flex",flexDirection:"column",gap:12}}>
          <div>
            <div style={{fontSize:11,letterSpacing:"0.08em",textTransform:"uppercase",color:"var(--text-3)"}}>管理动作</div>
            <div style={{fontSize:12,color:"var(--text-3)",marginTop:3}}>读明细≠可修改。每个动作需独立 AdminActionAuthorization：Repair dry-run + 理由 + PurposeRef + 高风险 Passkey。</div>
          </div>
          <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
            <ABtn variant="secondary" onClick={()=>setAct({kind:"entitlement",title:"手动调整 Entitlement · ManualEntitlementAdjustment"})}>手动调整 Entitlement</ABtn>
            <ABtn variant="danger" onClick={()=>setAct({kind:"device",title:"强制移除设备 · Forced Device Removal"})}>强制移除设备</ABtn>
          </div>
        </div>

        <div style={{border:"1px solid var(--gd-line)",borderRadius:8,padding:"12px 16px",fontSize:11,color:"var(--text-3)",lineHeight:1.6,display:"flex",flexDirection:"column",gap:4}}>
          <span>· 管理员不可读平台 API 凭据、Cookie、Browser Profile、数据库密钥或备份秘密——这些字段不在后台内。</span>
          <span>· 修改经受控 Repair 执行、逐次授权、追加审计；账号 epoch 变更不是对交易平台的即时封禁。</span>
        </div>
      </>}

    {/* AdminActionAuthorization ceremony (write) */}
    {act&&<window.ADMActionAuth open={!!act} onClose={()=>setAct(null)} onCommitted={()=>setAct(null)}
      target={acct.id} kind={act.kind} title={act.title} entitlement={dt.entitlement} devices={dt.devices}/>}

    {/* AdminReadAuthorization ceremony */}
    <ADlg open={dlg} onClose={()=>setDlg(false)} title="读取业务明细授权 · AdminReadAuthorization" width={520}
      footer={<><ABtn onClick={()=>setDlg(false)}>取消</ABtn><ABtn variant="primary" disabled={!reason.trim()||!pid.trim()||!passkey||scope.length===0} onClick={grantAuth}>授权并读取</ABtn></>}>
      <div style={{display:"flex",flexDirection:"column",gap:13}}>
        <div style={{fontSize:12,color:"var(--text-3)"}}>目标账号 <span style={{fontFamily:"var(--font-mono)",color:"var(--text-1)"}}>{acct.id}</span> · 授权每次读取复验，不能兑换为修改授权。</div>
        <div>
          <div style={{fontSize:11,color:"var(--text-3)",marginBottom:6}}>Scope · 字段/实体范围</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:"6px 16px"}}>{SCOPES.map(([k,l])=><label key={k} style={{display:"flex",alignItems:"center",gap:7,fontSize:12,cursor:"pointer"}}>
            <ACheck checked={scope.includes(k)} onChange={()=>setScope(s=>s.includes(k)?s.filter(x=>x!==k):[...s,k])}/>{l}</label>)}</div>
        </div>
        <AInput label="理由" size="md" placeholder="记录本次读取的目的" value={reason} onChange={e=>setReason(e.target.value)}/>
        <div style={{display:"flex",gap:10}}>
          <div style={{flex:"1 1 180px"}}><div style={{fontSize:11,color:"var(--text-3)",marginBottom:6}}>AdminPurposeRef 类型</div>
            <ASel size="md" options={PURPOSE.map(p=>PURPOSE_LABEL[p[0]])} value={PURPOSE_LABEL[ptype]} onChange={e=>{const v=e&&e.target?e.target.value:e;const key=(PURPOSE.find(p=>PURPOSE_LABEL[p[0]]===v)||[])[0]||"support";setPtype(key);}}/></div>
          <div style={{flex:"1 1 180px"}}><AInput label="Ref ID" size="md" mono placeholder="如 DR-2026-014" value={pid} onChange={e=>setPid(e.target.value)}/></div>
        </div>
        <div style={{borderTop:"1px solid var(--gd-line)",paddingTop:11,display:"flex",alignItems:"center",gap:10}}>
          {passkey?<ABadge tone="success" mono={false}>Passkey 已确认</ABadge>:<ABtn size="sm" variant="gold" icon={<img src="../../assets/icons/keyhole.svg" width="14" height="14" alt=""/>} onClick={()=>setPasskey(true)}>Passkey 重新认证</ABtn>}
          <span style={{fontSize:11,color:"var(--text-3)"}}>高风险动作与每类新授权都要求新鲜 Passkey。</span>
        </div>
      </div>
    </ADlg>
  </div>;
}
window.ADMAccounts=Accounts;
