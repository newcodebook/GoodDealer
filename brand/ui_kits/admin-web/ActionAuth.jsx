// AdminActionAuthorization ceremony — the WRITE gate. Distinct from AdminReadAuthorization and can NEVER
// be obtained by exchanging a read grant. Every mutation runs through: parameters → Repair dry-run
// (compute the effect WITHOUT committing, review before→after + side effects) → reason + typed
// AdminPurposeRef → fresh high-risk Passkey → commit (executed by controlled Repair, append-only audited).
// Admins never touch platform credentials; a mutation to account epoch is NOT an instant platform block.
const {Dialog:AADlg,Button:AABtn,Input:AAInput,Select:AASel,Badge:AABadge}=window.GoodDealerDesignSystem_b5b0b6;
const AA_PURPOSE=[["support","支持工单 · SupportCaseReference"],["datarights","数据权利 · DataRightsRequestId"],["incident","安全事件 · SecurityIncidentId"]];
const AA_PLABEL={support:"支持工单",datarights:"数据权利",incident:"安全事件"};

// Pure dry-run: compute the Repair effect from params + current state. No side effects, no commit.
function AA_dryRun(kind,p,cur){
  if(kind==="entitlement"){
    const rev=cur.entitlement.revision;
    if(p.adjType==="extend_expiry") return {
      changes:[{f:"商业到期",from:cur.entitlement.commercialExpires,to:p.newExpiry||"—"},{f:"Entitlement Revision",from:rev,to:rev+1}],
      side:["用户收到 Entitlement 变更邮件通知","客户端下次同步生效（Cloud 为权威源）","追加一条 ManualEntitlementAdjustment 审计条目"],
      note:"不产生 ProviderPaymentEvent（非支付）；不触碰平台凭据。",valid:!!p.newExpiry};
    if(p.adjType==="device_limit") return {
      changes:[{f:"设备名额",from:cur.entitlement.deviceLimit,to:p.newLimit},{f:"Entitlement Revision",from:rev,to:rev+1}],
      side:["用户收到 Entitlement 变更邮件通知",Number(p.newLimit)<cur.entitlement.deviceLimit?"若当前设备数超过新名额，超出设备需重新指派（不自动强移）":"名额提升即时可用","追加一条 ManualEntitlementAdjustment 审计条目"],
      note:"仅改名额上限，不移除任何设备；强移设备是独立动作。",valid:Number(p.newLimit)>=1&&Number(p.newLimit)!==cur.entitlement.deviceLimit};
    // grace_comp
    return {
      changes:[{f:"补偿性延期",from:"—",to:(p.graceDays||0)+" 天"},{f:"Entitlement Revision",from:rev,to:rev+1}],
      side:["用户收到补偿说明邮件","客户端下次同步生效","追加一条 ManualEntitlementAdjustment 审计条目"],
      note:"用于云端不可用等补偿；须绑定事件 PurposeRef。",valid:Number(p.graceDays)>0};
  }
  // device forced removal
  const d=cur.devices.find(x=>x.name===p.device);const isActive=d&&d.role==="active";
  return {
    changes:[{f:"ActiveDeviceLease",from:p.device+"（有效）",to:"已撤销"},{f:"lease_epoch",from:d?d.epoch:"—",to:d&&d.epoch!=="—"?d.epoch+1:"+1"},{f:"设备数",from:cur.devices.length,to:cur.devices.length-1}],
    side:[isActive?"移除的是 Active 设备：执行权需重新指派，进入离线保护窗口 offline_execute_until":"移除 Standby 设备：不影响当前执行权","用户收到设备被移除的安全邮件","被移除设备需重新登录 + Passkey 才能回归","不影响平台侧登录状态——账号 epoch 变更不是对平台的即时封禁"],
    note:isActive?"高风险：正在执行的任务将按提交边界冻结/核对，不重放已确认写入。":"被移除设备的本地缓存按只读处置。",valid:!!d,high:true};
}

function ActionAuth({open,onClose,onCommitted,target,kind,title,entitlement,devices}){
  const cur={entitlement,devices};
  const [p,setP]=React.useState({adjType:"extend_expiry",newExpiry:"",newLimit:entitlement?entitlement.deviceLimit:2,graceDays:"",device:devices&&devices[0]?devices[0].name:""});
  const [ran,setRan]=React.useState(false);
  const [reason,setReason]=React.useState("");
  const [ptype,setPtype]=React.useState("support");
  const [pid,setPid]=React.useState("");
  const [passkey,setPasskey]=React.useState(false);
  const [done,setDone]=React.useState(false);
  // reset the whole ceremony each time it opens
  React.useEffect(()=>{if(open){setP({adjType:"extend_expiry",newExpiry:"",newLimit:entitlement?entitlement.deviceLimit:2,graceDays:"",device:devices&&devices[0]?devices[0].name:""});setRan(false);setReason("");setPtype("support");setPid("");setPasskey(false);setDone(false);}},[open,kind]);
  const upd=(k,v)=>{setP(o=>({...o,[k]:v}));setRan(false);setPasskey(false);};
  const dr=AA_dryRun(kind,p,cur);
  const canCommit=ran&&dr.valid&&reason.trim()&&pid.trim()&&passkey;
  const commit=()=>{setDone(true);};

  const foot=done
    ?<AABtn variant="primary" onClick={()=>{onCommitted&&onCommitted();onClose&&onClose();}}>关闭</AABtn>
    :<><AABtn onClick={onClose}>取消</AABtn><AABtn variant="danger" disabled={!canCommit} onClick={commit}>确认提交（AdminActionAuthorization）</AABtn></>;

  return <AADlg open={open} onClose={onClose} title={title} width={560} footer={foot}>
    {done?
      <div style={{display:"flex",flexDirection:"column",gap:12,padding:"4px 0"}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}><AABadge tone="success" mono={false}>已提交</AABadge><span style={{fontSize:13}}>受控 Repair 已排队执行</span></div>
        <div style={{border:"1px solid var(--gd-line)",borderRadius:8,padding:"12px 14px",fontSize:12,color:"var(--text-2)",display:"flex",flexDirection:"column",gap:6}}>
          <span>目标账号 <b style={{fontFamily:"var(--font-mono)",color:"var(--text-1)"}}>{target}</b></span>
          <span>Entitlement Revision 前进一版；变更以追加事件记录，可审计、可回看。</span>
          <span>已向用户发送邮件通知。绑定 AdminPurposeRef <b style={{color:"var(--text-1)"}}>{AA_PLABEL[ptype]} · {pid}</b>。</span>
          <span style={{color:"var(--text-3)"}}>本授权仅本次动作有效，不可复用、不兑换为读授权。</span>
        </div>
      </div>
    :
      <div style={{display:"flex",flexDirection:"column",gap:14}}>
        <div style={{fontSize:12,color:"var(--text-3)"}}>目标账号 <span style={{fontFamily:"var(--font-mono)",color:"var(--text-1)"}}>{target}</span> · 这是<b style={{color:"var(--text-2)"}}> AdminActionAuthorization</b>，独立于读授权，不能由读授权兑换。</div>

        {/* Step 1 — parameters */}
        <div style={{display:"flex",flexDirection:"column",gap:9}}>
          <div style={{fontSize:11,letterSpacing:"0.06em",textTransform:"uppercase",color:"var(--text-3)"}}>① 参数</div>
          {kind==="entitlement"?<>
            <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
              <div style={{flex:"1 1 190px"}}><div style={{fontSize:11,color:"var(--text-3)",marginBottom:6}}>调整类型</div>
                <AASel size="md" options={["延长商业到期","调整设备名额","补偿性延期"]} value={{extend_expiry:"延长商业到期",device_limit:"调整设备名额",grace_comp:"补偿性延期"}[p.adjType]}
                  onChange={e=>{const v=e&&e.target?e.target.value:e;upd("adjType",{["延长商业到期"]:"extend_expiry",["调整设备名额"]:"device_limit",["补偿性延期"]:"grace_comp"}[v]);}}/></div>
              {p.adjType==="extend_expiry"&&<div style={{flex:"1 1 190px"}}><AAInput label="新商业到期" size="md" mono placeholder="2027-01-14" value={p.newExpiry} onChange={e=>upd("newExpiry",e.target.value)}/></div>}
              {p.adjType==="device_limit"&&<div style={{flex:"1 1 190px"}}><AAInput label="新设备名额" size="md" mono type="number" value={p.newLimit} onChange={e=>upd("newLimit",e.target.value)}/></div>}
              {p.adjType==="grace_comp"&&<div style={{flex:"1 1 190px"}}><AAInput label="补偿天数" size="md" mono type="number" placeholder="14" value={p.graceDays} onChange={e=>upd("graceDays",e.target.value)}/></div>}
            </div>
          </>:<>
            <div style={{fontSize:11,color:"var(--text-3)"}}>选择要强制移除的设备</div>
            <div style={{display:"flex",flexDirection:"column",gap:6}}>{(devices||[]).map(d=>
              <label key={d.name} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 10px",border:"1px solid "+(p.device===d.name?"var(--gd-danger)":"var(--gd-line)"),borderRadius:7,cursor:"pointer"}}>
                <input type="radio" name="aa-dev" checked={p.device===d.name} onChange={()=>upd("device",d.name)}/>
                <span style={{flex:1,fontSize:13}}>{d.name}<AABadge tone={d.role==="active"?"gold":"sync"} mono={false} style={{marginLeft:8}}>{d.role==="active"?"Active":"Standby"}</AABadge></span>
                <span style={{fontFamily:"var(--font-mono)",fontSize:11,color:"var(--text-3)"}}>lease_epoch {d.epoch}</span>
              </label>)}</div>
          </>}
        </div>

        {/* Step 2 — Repair dry-run */}
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <span style={{fontSize:11,letterSpacing:"0.06em",textTransform:"uppercase",color:"var(--text-3)"}}>② Repair dry-run</span>
            <AABtn size="sm" variant={ran?"ghost":"primary"} disabled={!dr.valid} onClick={()=>setRan(true)}>{ran?"重新计算":"运行 dry-run"}</AABtn>
            {!dr.valid&&<span style={{fontSize:11,color:"var(--text-3)"}}>补全参数后可运行</span>}
          </div>
          {ran&&<div style={{border:"1px solid var(--gd-line-strong)",borderRadius:8,padding:"12px 14px",background:"var(--gd-ink)",display:"flex",flexDirection:"column",gap:10}}>
            <div style={{display:"flex",alignItems:"center",gap:8}}><AABadge tone="sync" mono={false}>dry-run · 未提交</AABadge>{dr.high&&<AABadge tone="danger" mono={false}>高风险</AABadge>}</div>
            <div style={{display:"flex",flexDirection:"column",gap:5}}>{dr.changes.map((c,i)=>
              <div key={i} style={{display:"flex",alignItems:"center",gap:8,fontSize:12,fontFamily:"var(--font-mono)"}}>
                <span style={{width:120,flex:"none",color:"var(--text-3)"}}>{c.f}</span>
                <span style={{color:"var(--text-3)"}}>{c.from}</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--gd-gold)" strokeWidth="2" strokeLinecap="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
                <span style={{color:"var(--text-1)"}}>{c.to}</span>
              </div>)}</div>
            <ul style={{margin:0,paddingLeft:16,display:"flex",flexDirection:"column",gap:3}}>{dr.side.map((s,i)=><li key={i} style={{fontSize:11.5,color:"var(--text-2)"}}>{s}</li>)}</ul>
            <div style={{fontSize:11,color:"var(--text-3)",borderTop:"1px solid var(--gd-line)",paddingTop:8}}>{dr.note}</div>
          </div>}
        </div>

        {/* Step 3 — authorization */}
        <div style={{display:"flex",flexDirection:"column",gap:10,opacity:ran?1:.5,pointerEvents:ran?"auto":"none"}}>
          <div style={{fontSize:11,letterSpacing:"0.06em",textTransform:"uppercase",color:"var(--text-3)"}}>③ 授权</div>
          <AAInput label="理由" size="md" placeholder="记录本次动作的目的" value={reason} onChange={e=>setReason(e.target.value)}/>
          <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
            <div style={{flex:"1 1 200px"}}><div style={{fontSize:11,color:"var(--text-3)",marginBottom:6}}>AdminPurposeRef 类型</div>
              <AASel size="md" options={AA_PURPOSE.map(x=>x[1])} value={(AA_PURPOSE.find(x=>x[0]===ptype)||[])[1]} onChange={e=>{const v=e&&e.target?e.target.value:e;setPtype((AA_PURPOSE.find(x=>x[1]===v)||["support"])[0]);}}/></div>
            <div style={{flex:"1 1 160px"}}><AAInput label="Ref ID" size="md" mono placeholder="如 SEC-2026-003" value={pid} onChange={e=>setPid(e.target.value)}/></div>
          </div>
          <div style={{borderTop:"1px solid var(--gd-line)",paddingTop:10,display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
            {passkey?<AABadge tone="success" mono={false}>高风险 Passkey 已确认</AABadge>:<AABtn size="sm" variant="gold" icon={<img src="../../assets/icons/keyhole.svg" width="14" height="14" alt=""/>} onClick={()=>setPasskey(true)}>高风险 Passkey 重新认证</AABtn>}
            <span style={{fontSize:11,color:"var(--text-3)"}}>写动作要求独立于读授权的新鲜 Passkey。</span>
          </div>
        </div>
      </div>}
  </AADlg>;
}
window.ADMActionAuth=ActionAuth;
