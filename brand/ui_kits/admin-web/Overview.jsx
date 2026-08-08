// 概览 / Overview (admin-web) — platform health at a glance + open compliance/security cases + jobs.
// Read-only; opening an account still requires the AdminReadAuthorization ceremony on the Accounts detail.
const {Badge:OBadge,Button:OBtn}=window.GoodDealerDesignSystem_b5b0b6;
const CASE_KIND={deletion:["danger","数据删除"],export:["sync","数据导出"],incident:["danger","安全事件"],support:["warning","支持工单"]};

function Stat({label,value,tone,meta}){
  const c={gold:"var(--gd-gold)",danger:"var(--gd-danger)",warning:"var(--gd-warning)",success:"var(--gd-success)",blue:"var(--gd-blue)"}[tone]||"var(--text-1)";
  return <div style={{flex:"1 1 150px",minWidth:0,padding:"0 16px",borderRight:"1px solid var(--gd-line)"}}>
    <div style={{fontSize:11,letterSpacing:"0.06em",textTransform:"uppercase",color:"var(--text-3)"}}>{label}</div>
    <div style={{fontFamily:"var(--font-mono)",fontVariantNumeric:"tabular-nums",fontSize:24,color:c,marginTop:3}}>{value}</div>
    <div style={{fontSize:11,color:"var(--text-3)",minHeight:14}}>{meta||" "}</div>
  </div>;
}

function Overview({onOpenAccount,onOpenCase,onGo}){
  const D=window.ADM_DATA;const H=D.health;
  return <div style={{display:"flex",flexDirection:"column",gap:20}}>
    <div><h1 className="adm-h1">概览</h1><p className="adm-sub" style={{margin:0}}>平台健康、待处理案件与作业状态。跨账号明细读取仍需在账号详情走授权。</p></div>

    <div className="adm-card" style={{display:"flex",padding:"14px 0"}}>
      <Stat label="Cloud SLO" value={H.cloudSlo} tone="success" meta="过去 30 天"/>
      <Stat label="待处理案件" value={H.openCases} tone={H.openCases?"warning":"success"} meta="合规 / 安全 / 支持"/>
      <Stat label="隔离区" value={H.quarantine} tone={H.quarantine?"danger":"success"} meta="毒任务待处置"/>
      <Stat label="Active Lease" value={H.activeLeases} tone="blue" meta="在线活动设备"/>
      <Stat label="待同步 Mutation" value={H.pendingMutations} meta="全平台"/>
    </div>

    <div className="adm-card" style={{padding:0}}>
      <div style={{display:"flex",alignItems:"center",padding:"14px 18px 6px"}}>
        <span style={{fontSize:11,letterSpacing:"0.08em",textTransform:"uppercase",color:"var(--text-3)"}}>待处理案件</span>
        <OBtn size="sm" variant="ghost" style={{marginLeft:"auto"}} onClick={()=>onGo&&onGo("cases")}>全部案件</OBtn>
      </div>
      {D.cases.map((c,i)=>{const k=CASE_KIND[c.kind];
        return <div key={c.ref} style={{display:"flex",alignItems:"center",gap:12,padding:"11px 18px",borderTop:"1px solid var(--gd-line)"}}>
          <button onClick={()=>onOpenCase&&onOpenCase(c.ref)} style={{width:120,flex:"none",textAlign:"left",fontFamily:"var(--font-mono)",fontSize:12,color:"var(--text-link)",background:"none",border:"none",cursor:"pointer",padding:0}}>{c.ref}</button>
          <OBadge tone={k[0]} mono={false}>{k[1]}</OBadge>
          <button onClick={()=>onOpenAccount&&onOpenAccount(c.acct)} style={{fontFamily:"var(--font-mono)",fontSize:12,color:"var(--text-link)",background:"none",border:"none",cursor:"pointer"}}>{c.acct}</button>
          <span style={{flex:1,minWidth:0,fontSize:12,color:"var(--text-3)"}}>{c.state}</span>
          <span style={{fontSize:11,color:"var(--text-3)"}}>{c.at}</span>
        </div>;})}
    </div>

    <div style={{display:"flex",gap:14,flexWrap:"wrap"}}>
      <div className="adm-card" style={{flex:"1 1 240px",padding:"14px 18px",display:"flex",alignItems:"center",gap:10}}>
        <OBadge tone={H.jobsHealthy?"success":"danger"} mono={false}>{H.jobsHealthy?"作业健康":"作业异常"}</OBadge>
        <span style={{fontSize:12,color:"var(--text-2)"}}>Lease · 心跳 · 幂等 · 重放正常</span>
        <OBtn size="sm" variant="ghost" style={{marginLeft:"auto"}} onClick={()=>onGo&&onGo("jobs")}>Jobs</OBtn>
      </div>
      <div className="adm-card" style={{flex:"1 1 240px",padding:"14px 18px",display:"flex",alignItems:"center",gap:10}}>
        <span style={{fontSize:12,color:"var(--text-2)"}}>按账号 ID / 邮箱查找</span>
        <OBtn size="sm" style={{marginLeft:"auto"}} onClick={()=>onGo&&onGo("accounts")}>打开账号</OBtn>
      </div>
    </div>
  </div>;
}
window.ADMOverview=Overview;
