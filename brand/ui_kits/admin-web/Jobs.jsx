// Jobs 与隔离区 / Jobs & Quarantine — controlled execution health (lease/heartbeat/idempotency/replay) +
// poison-task quarantine. Disposition NEVER re-runs a confirmed or non-idempotent write: requeue is allowed
// only for provably safe-retry tasks; outcome_unknown is frozen for human platform-side check; discard marks
// terminal without replay. Mirrors the client crash-recovery scan. Every disposition: reason + Passkey + audit.
const {Badge:JBadge,Button:JBtn,Dialog:JDlg,Input:JInput}=window.GoodDealerDesignSystem_b5b0b6;
const CLASSIFY={safe_retry:["success","可安全重试"],outcome_unknown:["warning","结果未知"],non_idempotent:["danger","非幂等"],remote_pending:["sync","远端待定"]};
// per-disposition effect copy; `safeOnly` requeue is gated to safe_retry classification
const DISPO=[
  {k:"requeue",label:"重新入队",safeOnly:true,note:"重新入队执行——仅限幂等/可安全重试的任务。对结果未知或非幂等任务禁用，以免在平台侧重复下单/重复应答。"},
  {k:"freeze",label:"冻结人工核对",note:"冻结为只读，等待人工到交易平台核对真实结果后再决定。不产生任何执行。"},
  {k:"discard",label:"终态丢弃",note:"标记为终态、不再重放。若任务实际已在平台生效，需人工在平台侧收尾。追加审计。"},
];

function Jobs({onOpenAccount}){
  const J=window.ADM_DATA.jobs;const L=J.lease;
  const [items,setItems]=React.useState(J.quarantine.map(q=>({...q,resolved:null})));
  const [act,setAct]=React.useState(null); // task being dispositioned
  const [dispo,setDispo]=React.useState(null);
  const [reason,setReason]=React.useState("");
  const [passkey,setPasskey]=React.useState(false);
  const open=(t)=>{setAct(t);setDispo(null);setReason("");setPasskey(false);};
  const commit=()=>{setItems(xs=>xs.map(x=>x.id===act.id?{...x,resolved:dispo}:x));setAct(null);};
  const chosen=DISPO.find(d=>d.k===dispo);
  const requeueBlocked=act&&act.classify!=="safe_retry";

  const Health=({label,ok,value})=><div style={{flex:"1 1 150px",minWidth:0,padding:"0 16px",borderRight:"1px solid var(--gd-line)"}}>
    <div style={{fontSize:11,letterSpacing:"0.06em",textTransform:"uppercase",color:"var(--text-3)"}}>{label}</div>
    <div style={{display:"flex",alignItems:"center",gap:7,marginTop:5}}>
      <span style={{width:8,height:8,borderRadius:"50%",background:ok?"var(--gd-success)":"var(--gd-danger)"}}></span>
      <span style={{fontFamily:"var(--font-mono)",fontSize:15,color:"var(--text-1)"}}>{value}</span>
    </div></div>;

  return <div style={{display:"flex",flexDirection:"column",gap:20}}>
    <div><h1 className="adm-h1">Jobs 与隔离区</h1><p className="adm-sub" style={{margin:0}}>受控执行健康与毒任务处置。处置绝不重放已确认或非幂等的写入。</p></div>

    <div className="adm-card" style={{display:"flex",padding:"14px 0",flexWrap:"wrap",rowGap:14}}>
      <Health label="Active Lease" ok={true} value={L.active}/>
      <Health label="心跳" ok={L.heartbeatOk} value={L.heartbeatOk?"正常":"异常"}/>
      <Health label="幂等键" ok={L.idempotencyOk} value={L.idempotencyOk?"正常":"冲突"}/>
      <Health label="重放拦截" ok={true} value={L.replayBlocked}/>
      <Health label="陈旧 Lease" ok={L.staleLeases===0} value={L.staleLeases}/>
    </div>

    <div className="adm-card" style={{padding:0,overflow:"hidden"}}>
      <div style={{padding:"13px 18px 10px",display:"flex",alignItems:"center",gap:8}}>
        <span style={{fontSize:11,letterSpacing:"0.08em",textTransform:"uppercase",color:"var(--text-3)"}}>隔离区 · 毒任务</span>
        <JBadge tone={items.some(i=>!i.resolved)?"danger":"success"} mono={false}>{items.filter(i=>!i.resolved).length} 待处置</JBadge>
      </div>
      {items.map(t=>{const cl=CLASSIFY[t.classify];const dl=t.resolved&&DISPO.find(d=>d.k===t.resolved);
        return <div key={t.id} style={{display:"flex",alignItems:"center",gap:12,padding:"12px 18px",borderTop:"1px solid var(--gd-line)",fontSize:12,flexWrap:"wrap"}}>
          <span style={{fontFamily:"var(--font-mono)",fontSize:12,color:"var(--text-2)",width:92,flex:"none"}}>{t.id}</span>
          <span style={{width:120,flex:"none",color:"var(--text-2)"}}>{t.kind}</span>
          <button onClick={()=>onOpenAccount&&onOpenAccount(t.acct)} style={{width:80,flex:"none",textAlign:"left",fontFamily:"var(--font-mono)",fontSize:11,color:"var(--text-link)",background:"none",border:"none",cursor:"pointer",padding:0}}>{t.acct}</button>
          <span style={{flex:1,minWidth:160,color:"var(--text-3)"}}>{t.reason}</span>
          <JBadge tone={cl[0]} mono={false}>{cl[1]}</JBadge>
          <span style={{fontFamily:"var(--font-mono)",fontSize:11,color:"var(--text-3)"}}>×{t.fails} · {t.at}</span>
          {t.resolved?<JBadge tone="neutral" mono={false}>已{dl.label}</JBadge>:<JBtn size="sm" variant="secondary" onClick={()=>open(t)}>处置</JBtn>}
        </div>;})}
    </div>

    <div style={{border:"1px solid var(--gd-line)",borderRadius:8,padding:"12px 16px",fontSize:11,color:"var(--text-3)",lineHeight:1.6}}>
      毒任务处置遵循提交边界：结果未知的任务只冻结、由人工到平台核对，绝不自动重放；非幂等任务禁止重入队。任何一次处置都要求理由 + Passkey，并追加审计。
    </div>

    <JDlg open={!!act} onClose={()=>setAct(null)} title={act?("处置毒任务 · "+act.id):""} width={520}
      footer={<><JBtn onClick={()=>setAct(null)}>取消</JBtn><JBtn variant="danger" disabled={!dispo||(dispo==="requeue"&&requeueBlocked)||!reason.trim()||!passkey} onClick={commit}>确认处置</JBtn></>}>
      {act&&<div style={{display:"flex",flexDirection:"column",gap:13}}>
        <div style={{display:"flex",alignItems:"center",gap:10,fontSize:12}}>
          <span style={{color:"var(--text-3)"}}>{act.kind} · {act.acct}</span>
          <JBadge tone={CLASSIFY[act.classify][0]} mono={false}>{CLASSIFY[act.classify][1]}</JBadge>
        </div>
        <div style={{fontSize:12,color:"var(--text-2)"}}>{act.reason}</div>
        <div style={{display:"flex",flexDirection:"column",gap:7}}>
          <div style={{fontSize:11,color:"var(--text-3)"}}>处置方式</div>
          {DISPO.map(d=>{const blocked=d.safeOnly&&requeueBlocked;
            return <label key={d.k} style={{display:"flex",gap:10,padding:"9px 11px",border:"1px solid "+(dispo===d.k?"var(--gd-gold)":"var(--gd-line)"),borderRadius:7,cursor:blocked?"not-allowed":"pointer",opacity:blocked?.5:1}}>
              <input type="radio" name="dispo" disabled={blocked} checked={dispo===d.k} onChange={()=>setDispo(d.k)} style={{marginTop:2}}/>
              <span><span style={{fontSize:13,color:"var(--text-1)"}}>{d.label}{blocked&&<span style={{fontSize:11,color:"var(--gd-danger)",marginLeft:8}}>该分类禁用</span>}</span>
                <div style={{fontSize:11,color:"var(--text-3)",marginTop:2,lineHeight:1.5}}>{d.note}</div></span>
            </label>;})}
        </div>
        <JInput label="理由" size="md" placeholder="记录处置依据" value={reason} onChange={e=>setReason(e.target.value)}/>
        <div style={{borderTop:"1px solid var(--gd-line)",paddingTop:11,display:"flex",alignItems:"center",gap:10}}>
          {passkey?<JBadge tone="success" mono={false}>Passkey 已确认</JBadge>:<JBtn size="sm" variant="gold" icon={<img src="../../assets/icons/keyhole.svg" width="14" height="14" alt=""/>} onClick={()=>setPasskey(true)}>Passkey 重新认证</JBtn>}
          <span style={{fontSize:11,color:"var(--text-3)"}}>处置执行右受控，需新鲜 Passkey。</span>
        </div>
      </div>}
    </JDlg>
  </div>;
}
window.ADMJobs=Jobs;
