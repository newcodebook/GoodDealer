// 许可与订阅 Licenses — plan mix + subscription ledger (seats, renewal, MRR), issue/comp a license.
const {Panel:LPanel,Table:LTable,Badge:LBadge,Button:LBtn,Money:LMoney,Select:LSel,Input:LInput,Toolbar:LToolbar,Dialog:LDlg}=window.GoodDealerDesignSystem_b5b0b6;

const LPLAN_COL={Professional:"var(--gd-gold)",Portfolio:"var(--gd-blue)",Starter:"var(--gd-viz-drawdown)"};
const LSEATS={Professional:2,Portfolio:5,Starter:1};
function nextRenewal(since){
  const [,mm,dd]=since.split("-");const today=new Date("2026-08-17");
  let y=2026;const anniv=new Date("2026-"+mm+"-"+dd);if(anniv<today)y=2027;
  const d=new Date(y+"-"+mm+"-"+dd);const days=Math.round((d-today)/864e5);
  return {date:y+"-"+mm+"-"+dd,days};
}

function Licenses(){
  const D=window.GD_ADMIN;const I=window.GDI;const MetricStrip=window.GDMetricStrip;const Pagination=window.GDPagination;
  const [plan,setPlan]=React.useState("全部方案");const [q,setQ]=React.useState("");
  const [page,setPage]=React.useState(1);const [pageSize,setPageSize]=React.useState(10);
  const [issue,setIssue]=React.useState(false);
  React.useEffect(()=>{setPage(1);},[plan,q,pageSize]);
  const totalMrr=D.planMix.reduce((s,p)=>s+p.mrr,0);
  let rows=D.customers.filter(c=>c.status!=="churned"&&(plan==="全部方案"||c.plan===plan)&&(q===""||c.name.toLowerCase().includes(q.toLowerCase())||c.id.toLowerCase().includes(q.toLowerCase())));
  const pages=Math.max(1,Math.ceil(rows.length/pageSize));const cur=Math.min(page,pages);
  const pageRows=rows.slice((cur-1)*pageSize,cur*pageSize);
  return <div data-screen-label="许可与订阅" style={{display:"flex",flexDirection:"column",height:"100%",minHeight:0}}>
    <MetricStrip metrics={[
      {label:"活跃订阅",value:"2,413",meta:"付费 License"},
      {label:"月经常性收入",value:"$48,210",tone:"gold",meta:"ARR $578,520"},
      {label:"试用转化",value:"64%",tone:"success",meta:"近 30 天"},
      {label:"本月续费",value:"312",meta:"自动 297 · 手动 15"},
      {label:"逾期订阅",value:"48",tone:"warning",meta:"扣款失败"},
      {label:"14 天内到期",value:"126",tone:"body",meta:"含试用 92"},
    ]}/>
    <div style={{padding:"14px 18px 0"}}>
      <LPanel title="方案分布" actions={<span style={{fontFamily:"var(--font-mono)",fontSize:13,color:"var(--gd-gold)"}}>${(totalMrr/1000).toFixed(1)}k MRR</span>}>
        <div style={{display:"flex",height:10,borderRadius:3,overflow:"hidden",marginBottom:14}}>
          {D.planMix.map(p=><div key={p.plan} title={p.plan} style={{width:(p.mrr/totalMrr*100)+"%",background:p.color}}></div>)}
        </div>
        <div style={{display:"flex",gap:0}}>
          {D.planMix.map((p,i)=><div key={p.plan} style={{flex:1,display:"flex",flexDirection:"column",gap:4,padding:"0 16px",borderRight:i<2?"1px solid var(--gd-line)":"none"}}>
            <span style={{display:"flex",alignItems:"center",gap:7,fontSize:12,color:"var(--text-1)"}}><span style={{width:8,height:8,borderRadius:2,background:p.color,flex:"none"}}></span>{p.plan}</span>
            <div style={{display:"flex",alignItems:"baseline",gap:8}}><span style={{fontFamily:"var(--font-mono)",fontSize:18,color:"var(--text-1)"}}>{p.count.toLocaleString()}</span><span style={{fontSize:11,color:"var(--text-3)"}}>订阅</span></div>
            <span style={{fontSize:11,color:"var(--text-3)",fontFamily:"var(--font-mono)"}}>${(p.mrr/1000).toFixed(1)}k · {(p.mrr/totalMrr*100).toFixed(0)}%</span>
          </div>)}
        </div>
      </LPanel>
    </div>
    <LToolbar region
      left={<><LInput size="sm" prefix={<I.Search size={13}/>} placeholder="搜索客户、订阅…" value={q} onChange={e=>setQ(e.target.value)} style={{width:220}}/><LSel size="sm" options={["全部方案","Professional","Portfolio","Starter"]} value={plan} onChange={e=>setPlan(e.target.value)}/></>}
      right={<LBtn size="sm" variant="primary" icon={<I.Plus size={14}/>} onClick={()=>setIssue(true)}>签发 License</LBtn>}/>
    <div style={{flex:1,minHeight:0,display:"flex"}}>
      <LTable density="regular" rowKey="id" maxHeight="100%" style={{flex:1,minHeight:0,border:"none",borderRadius:0}}
        columns={[
          {key:"name",label:"客户",render:c=><div style={{display:"flex",flexDirection:"column",gap:1}}><span style={{fontSize:12.5,color:"var(--text-1)"}}>{c.name}</span><span style={{fontSize:11,color:"var(--text-3)",fontFamily:"var(--font-mono)"}}>{c.id}</span></div>},
          {key:"plan",label:"方案",render:c=><span style={{display:"inline-flex",alignItems:"center",gap:6,fontSize:12,color:"var(--text-1)"}}><span style={{width:6,height:6,borderRadius:2,background:LPLAN_COL[c.plan],flex:"none"}}></span>{c.plan}</span>},
          {key:"cycle",label:"周期",render:c=><span style={{fontSize:12,color:"var(--text-2)"}}>{c.status==="trial"?"试用":"年付"}</span>},
          {key:"seats",label:"设备额度",render:c=><span style={{fontFamily:"var(--font-mono)",fontSize:12,color:"var(--text-1)"}}>{c.devices} <span style={{color:"var(--text-3)"}}>/ {LSEATS[c.plan]}</span></span>},
          {key:"mrr",label:"MRR",numeric:true,render:c=>c.mrr?<LMoney amount={c.mrr} size={12}/>:<span style={{fontFamily:"var(--font-mono)",color:"var(--text-3)"}}>—</span>},
          {key:"renew",label:"下次续费",numeric:true,render:c=>{const r=nextRenewal(c.since);const soon=r.days<=30;return c.status==="trial"?<LBadge tone="sync" mono={false}>试用中</LBadge>:<span style={{display:"inline-flex",flexDirection:"column",alignItems:"flex-end",gap:1}}><span style={{fontFamily:"var(--font-mono)",fontSize:12,color:c.status==="past_due"?"var(--gd-warning)":"var(--text-2)"}}>{r.date}</span><span style={{fontSize:10,color:soon?"var(--gd-warning)":"var(--text-3)"}}>{r.days} 天后</span></span>;}},
          {key:"status",label:"状态",render:c=>c.status==="past_due"?<LBadge tone="warning" mono={false}>逾期</LBadge>:c.status==="trial"?<LBadge tone="sync" mono={false}>试用</LBadge>:<LBadge tone="success">活跃</LBadge>},
          {key:"act",label:"",align:"right",render:c=><LBtn size="sm" variant="ghost">管理</LBtn>},
        ]}
        rows={pageRows}
        footer={<Pagination page={cur} pageSize={pageSize} total={rows.length} onPage={setPage} onPageSize={setPageSize} note={<>活跃订阅 MRR <span style={{color:"var(--gd-gold)"}}>${(totalMrr/1000).toFixed(1)}k</span></>}/>}/>
    </div>
    <LDlg open={issue} onClose={()=>setIssue(false)} title="签发 License" width={460}
      footer={<><LBtn onClick={()=>setIssue(false)}>取消</LBtn><LBtn variant="primary" onClick={()=>setIssue(false)}>签发并发送</LBtn></>}>
      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        <LInput label="客户邮箱" mono placeholder="name@company.com"/>
        <div style={{display:"flex",gap:10}}>
          <div style={{flex:1}}><LSel label="方案" size="md" options={["Professional","Portfolio","Starter"]} value="Professional" onChange={()=>{}}/></div>
          <div style={{flex:1}}><LSel label="周期" size="md" options={["年付","月付","赠送（comp）"]} value="年付" onChange={()=>{}}/></div>
        </div>
        <LInput label="备注（内部）" placeholder="如：合作方赠送 · 12 个月"/>
        <span style={{fontSize:11,color:"var(--text-3)"}}>签发将创建订阅并向客户发送激活邮件；赠送 License 不产生扣款，会记入审计日志。</span>
      </div>
    </LDlg>
  </div>;
}
window.GDLicenses=Licenses;
