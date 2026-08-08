// 同步诊断 / Diagnostics — read-only window into the sync engine: ActiveDeviceLease, Mutation/Cursor lag,
// Checkpoint, reconciliation Candidates (Stale/Restore), and append-only LateExecutionEvents. This page only
// OBSERVES. Reconciliation actions (promote a RestoreCandidate, clear a StaleDeviceCandidate) are high-risk,
// run through controlled Repair + AdminActionAuthorization, and are never batched.
const {Badge:DgBadge,Button:DgBtn}=window.GoodDealerDesignSystem_b5b0b6;

function DgStat({label,value,tone,meta}){
  const c={warning:"var(--gd-warning)",danger:"var(--gd-danger)",success:"var(--gd-success)",blue:"var(--gd-blue)"}[tone]||"var(--text-1)";
  return <div style={{flex:"1 1 140px",minWidth:0,padding:"0 16px",borderRight:"1px solid var(--gd-line)"}}>
    <div style={{fontSize:11,letterSpacing:"0.06em",textTransform:"uppercase",color:"var(--text-3)"}}>{label}</div>
    <div style={{fontFamily:"var(--font-mono)",fontVariantNumeric:"tabular-nums",fontSize:22,color:c,marginTop:3}}>{value}</div>
    <div style={{fontSize:11,color:"var(--text-3)",minHeight:14,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{meta||" "}</div>
  </div>;
}
function DRow({k,children}){return <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",padding:"8px 0",borderBottom:"1px solid var(--gd-line)",fontSize:13}}>
  <span style={{color:"var(--text-3)",fontSize:12}}>{k}</span><span style={{textAlign:"right",fontFamily:"var(--font-mono)"}}>{children}</span></div>;}

function Diagnostics({onOpenAccount}){
  const G=window.ADM_DATA.diagnostics;const S=G.summary;const s=G.sample;
  return <div style={{display:"flex",flexDirection:"column",gap:20}}>
    <div><h1 className="adm-h1">同步诊断</h1><p className="adm-sub" style={{margin:0}}>Lease / Mutation / Cursor / Checkpoint / Candidate / LateExecution 的只读观测。协调动作走受控 Repair 授权，不在此执行。</p></div>

    <div className="adm-card" style={{display:"flex",padding:"14px 0",flexWrap:"wrap",rowGap:14}}>
      <DgStat label="Active Lease" value={S.activeLeases} tone="blue" meta="在线活动设备"/>
      <DgStat label="待同步 Mutation" value={S.pendingMutations} meta="全平台"/>
      <DgStat label="Stale Candidate" value={S.staleCandidates} tone={S.staleCandidates?"warning":"success"} meta="待协调"/>
      <DgStat label="LateExecution" value={S.lateEvents} tone={S.lateEvents?"warning":"success"} meta="迟到执行(追加)"/>
      <DgStat label="Checkpoint 滞后" value={S.checkpointLag} meta="快照延迟"/>
    </div>

    <div style={{display:"flex",alignItems:"center",gap:10}}>
      <span style={{fontSize:12,color:"var(--text-3)"}}>示例账号同步内部态</span>
      <button onClick={()=>onOpenAccount&&onOpenAccount(s.acct)} style={{fontFamily:"var(--font-mono)",fontSize:12,color:"var(--text-link)",background:"none",border:"none",cursor:"pointer"}}>{s.acct} ›</button>
    </div>

    <div style={{display:"flex",gap:14,flexWrap:"wrap"}}>
      <div className="adm-card" style={{flex:"1 1 280px",padding:"16px 20px"}}>
        <div style={{fontSize:11,letterSpacing:"0.08em",textTransform:"uppercase",color:"var(--text-3)",marginBottom:8}}>ActiveDeviceLease</div>
        <DRow k="持有设备"><span style={{fontFamily:"var(--font-sans)"}}>{s.lease.holder} <DgBadge tone="gold" mono={false}>Active</DgBadge></span></DRow>
        <DRow k="lease_epoch">{s.lease.epoch}</DRow>
        <DRow k="心跳">{s.lease.heartbeat}</DRow>
        <DRow k="状态"><DgBadge tone="success" mono={false}>{s.lease.state}</DgBadge></DRow>
      </div>
      <div className="adm-card" style={{flex:"1 1 280px",padding:"16px 20px"}}>
        <div style={{fontSize:11,letterSpacing:"0.08em",textTransform:"uppercase",color:"var(--text-3)",marginBottom:8}}>Cursor / Checkpoint</div>
        {s.cursors.map(c=><div key={c.device} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"7px 0",borderBottom:"1px solid var(--gd-line)",fontSize:12}}>
          <span>{c.device}</span>
          <span style={{fontFamily:"var(--font-mono)",color:"var(--text-3)"}}>{c.cursor} · lag {c.lag}{c.lag>0&&<DgBadge tone="warning" mono={false} style={{marginLeft:6}}>落后</DgBadge>}</span>
        </div>)}
        <DRow k="Checkpoint"><span>{s.checkpoint.id} · {s.checkpoint.at}</span></DRow>
        <DRow k="自上次快照 Mutation">{s.checkpoint.mutationsSince}</DRow>
      </div>
    </div>

    <div className="adm-card" style={{padding:"16px 20px"}}>
      <div style={{fontSize:11,letterSpacing:"0.08em",textTransform:"uppercase",color:"var(--text-3)",marginBottom:10}}>协调 Candidate</div>
      {s.candidates.map((c,i)=><div key={i} style={{display:"flex",alignItems:"center",gap:12,padding:"9px 0",borderBottom:"1px solid var(--gd-line)",fontSize:12,flexWrap:"wrap"}}>
        <DgBadge tone="sync" mono={false}>{c.type}</DgBadge>
        <span style={{color:"var(--text-2)"}}>{c.device||c.source}</span>
        <span style={{flex:1,minWidth:120,color:"var(--text-3)"}}>{c.reason}</span>
        <DgBadge tone="danger" mono={false}>高风险</DgBadge>
      </div>)}
      <div style={{fontSize:11,color:"var(--text-3)",marginTop:10,lineHeight:1.6}}>提升 RestoreCandidate、清除 StaleDeviceCandidate 是高风险协调动作——三路（Base/Candidate/Cloud）人工比对、逐个执行、不可批量，经 AdminActionAuthorization + 受控 Repair。此页只读。</div>
    </div>

    <div className="adm-card" style={{padding:"16px 20px"}}>
      <div style={{fontSize:11,letterSpacing:"0.08em",textTransform:"uppercase",color:"var(--text-3)",marginBottom:6}}>LateExecutionEvent · 追加不可改</div>
      {s.lateExecutions.map(e=><div key={e.id} style={{display:"flex",gap:12,padding:"7px 0",borderBottom:"1px solid var(--gd-line)",fontSize:12}}>
        <span style={{fontFamily:"var(--font-mono)",color:"var(--text-3)",width:120,flex:"none"}}>{e.at} · {e.task}</span>
        <span style={{flex:1,color:"var(--text-2)"}}>{e.note}</span>
      </div>)}
    </div>
  </div>;
}
window.ADMDiagnostics=Diagnostics;
