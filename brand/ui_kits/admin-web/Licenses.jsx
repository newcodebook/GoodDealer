// 许可与订阅 Licenses — one feature tier across three billing terms, with renewal and fixed-term expiry kept distinct.
const {Panel:LPanel,Table:LTable,Badge:LBadge,Button:LBtn,Money:LMoney,Select:LSel,Input:LInput,Toolbar:LToolbar,Dialog:LDlg}=window.GoodDealerDesignSystem_b5b0b6;

const LTERM_COL={"月付":"var(--gd-gold)","年付":"var(--gd-blue)","10 年固定期":"var(--gd-viz-drawdown)"};
function deadline(date){
  const days=Math.round((new Date(date)-new Date("2026-08-17"))/864e5);
  return {date,days};
}

function Licenses(){
  const D=window.GD_ADMIN;const I=window.GDI;const MetricStrip=window.GDMetricStrip;const Pagination=window.GDPagination;
  const [term,setTerm]=React.useState("全部期限");const [q,setQ]=React.useState("");
  const [page,setPage]=React.useState(1);const [pageSize,setPageSize]=React.useState(10);
  const [issue,setIssue]=React.useState(false);
  React.useEffect(()=>{setPage(1);},[term,q,pageSize]);
  const totalMrr=D.termMix.reduce((s,p)=>s+p.mrr,0);
  let rows=D.customers.filter(c=>c.status!=="churned"&&(term==="全部期限"||c.term===term)&&(q===""||c.name.toLowerCase().includes(q.toLowerCase())||c.id.toLowerCase().includes(q.toLowerCase())));
  const pages=Math.max(1,Math.ceil(rows.length/pageSize));const cur=Math.min(page,pages);
  const pageRows=rows.slice((cur-1)*pageSize,cur*pageSize);
  return <div data-screen-label="许可与订阅" style={{display:"flex",flexDirection:"column",height:"100%",minHeight:0}}>
    <MetricStrip metrics={[
      {label:"活跃许可",value:"2,413",meta:"同一功能档位"},
      {label:"月经常性收入",value:"$19,927",tone:"gold",meta:"固定期收入另计"},
      {label:"首次购买退款期内",value:"92",tone:"body",meta:"14 天全额退款"},
      {label:"本月续费",value:"312",meta:"自动 297 · 手动 15"},
      {label:"逾期订阅",value:"48",tone:"warning",meta:"扣款失败"},
      {label:"固定期 90 天内到期",value:"7",tone:"warning",meta:"不会自动续费"},
    ]}/>
    <div style={{padding:"14px 18px 0"}}>
      <LPanel title="付费期限分布" actions={<span style={{fontFamily:"var(--font-mono)",fontSize:13,color:"var(--gd-gold)"}}>${(totalMrr/1000).toFixed(1)}k MRR</span>}>
        <div style={{display:"flex",height:10,borderRadius:3,overflow:"hidden",marginBottom:14}}>
          {D.termMix.filter(p=>p.mrr>0).map(p=><div key={p.term} title={p.term} style={{width:(p.mrr/totalMrr*100)+"%",background:p.color}}></div>)}
        </div>
        <div style={{display:"flex",gap:0}}>
          {D.termMix.map((p,i)=><div key={p.term} style={{flex:1,display:"flex",flexDirection:"column",gap:4,padding:"0 16px",borderRight:i<2?"1px solid var(--gd-line)":"none"}}>
            <span style={{display:"flex",alignItems:"center",gap:7,fontSize:12,color:"var(--text-1)"}}><span style={{width:8,height:8,borderRadius:2,background:p.color,flex:"none"}}></span>{p.term}</span>
            <div style={{display:"flex",alignItems:"baseline",gap:8}}><span style={{fontFamily:"var(--font-mono)",fontSize:18,color:"var(--text-1)"}}>{p.count.toLocaleString()}</span><span style={{fontSize:11,color:"var(--text-3)"}}>许可</span></div>
            <span style={{fontSize:11,color:"var(--text-3)",fontFamily:"var(--font-mono)"}}>{p.mrr?"$"+(p.mrr/1000).toFixed(1)+"k MRR":"$498 · 非经常性"}</span>
          </div>)}
        </div>
      </LPanel>
    </div>
    <LToolbar region
      left={<><LInput size="sm" prefix={<I.Search size={13}/>} placeholder="搜索客户、许可…" value={q} onChange={e=>setQ(e.target.value)} style={{width:220}}/><LSel size="sm" options={["全部期限","月付","年付","10 年固定期"]} value={term} onChange={e=>setTerm(e.target.value)}/></>}
      right={<LBtn size="sm" variant="primary" icon={<I.Plus size={14}/>} onClick={()=>setIssue(true)}>创建托管结账</LBtn>}/>
    <div style={{flex:1,minHeight:0,display:"flex"}}>
      <LTable density="regular" rowKey="id" maxHeight="100%" style={{flex:1,minHeight:0,border:"none",borderRadius:0}}
        columns={[
          {key:"name",label:"客户",render:c=><div style={{display:"flex",flexDirection:"column",gap:1}}><span style={{fontSize:12.5,color:"var(--text-1)"}}>{c.name}</span><span style={{fontSize:11,color:"var(--text-3)",fontFamily:"var(--font-mono)"}}>{c.id}</span></div>},
          {key:"term",label:"付费期限",render:c=><span style={{display:"inline-flex",alignItems:"center",gap:6,fontSize:12,color:"var(--text-1)"}}><span style={{width:6,height:6,borderRadius:2,background:LTERM_COL[c.term],flex:"none"}}></span>{c.term}</span>},
          {key:"provider",label:"付款渠道",render:c=><span style={{fontSize:12,color:"var(--text-2)"}}>{c.provider} 托管</span>},
          {key:"seats",label:"设备额度",render:c=><span style={{fontFamily:"var(--font-mono)",fontSize:12,color:"var(--text-1)"}}>{c.devices} <span style={{color:"var(--text-3)"}}>/ 2</span></span>},
          {key:"mrr",label:"MRR",numeric:true,render:c=>c.mrr?<LMoney amount={c.mrr} size={12}/>:<span style={{fontFamily:"var(--font-mono)",color:"var(--text-3)"}}>—</span>},
          {key:"renew",label:"续费 / 到期",numeric:true,render:c=>{const fixed=c.term==="10 年固定期";const r=deadline(fixed?c.termEnds:c.nextBillingDate);const soon=r.days<=30;return <span style={{display:"inline-flex",flexDirection:"column",alignItems:"flex-end",gap:1}}><span style={{fontFamily:"var(--font-mono)",fontSize:12,color:c.status==="past_due"?"var(--gd-warning)":"var(--text-2)"}}>{r.date}</span><span style={{fontSize:10,color:soon?"var(--gd-warning)":"var(--text-3)"}}>{fixed?"固定期到期 · 不自动续费":r.days+" 天后续费"}</span></span>;}},
          {key:"status",label:"状态",render:c=><span style={{display:"inline-flex",alignItems:"center",gap:6}}>{c.status==="past_due"?<LBadge tone="warning" mono={false}>逾期</LBadge>:<LBadge tone="success">活跃</LBadge>}{c.refundUntil&&<LBadge tone="sync" mono={false}>退款期内</LBadge>}</span>},
          {key:"act",label:"",align:"right",render:c=><LBtn size="sm" variant="ghost">管理</LBtn>},
        ]}
        rows={pageRows}
        footer={<Pagination page={cur} pageSize={pageSize} total={rows.length} onPage={setPage} onPageSize={setPageSize} note={<>活跃许可 · MRR <span style={{color:"var(--gd-gold)"}}>${(totalMrr/1000).toFixed(1)}k</span> · 固定期收入另计</>}/>}/>
    </div>
    <LDlg open={issue} onClose={()=>setIssue(false)} title="创建 Provider 托管结账" width={480}
      footer={<><LBtn onClick={()=>setIssue(false)}>取消</LBtn><LBtn variant="primary" onClick={()=>setIssue(false)}>创建安全结账链接</LBtn></>}>
      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        <LInput label="客户邮箱" mono placeholder="name@company.com"/>
        <div style={{display:"flex",gap:10}}>
          <div style={{flex:1}}><LSel label="付费期限" size="md" options={["月付 · USD 9.80","年付 · USD 98","10 年固定期 · USD 498"]} value="年付 · USD 98" onChange={()=>{}}/></div>
          <div style={{flex:1}}><LSel label="Provider" size="md" options={["Stripe"]} value="Stripe" onChange={()=>{}}/></div>
        </div>
        <LInput label="优惠码（可选）" mono placeholder="PROMO2026"/>
        <span style={{fontSize:11,color:"var(--text-3)",lineHeight:1.6}}>三种期限共享同一功能档位与 2 台设备额度。无免费体验；10 年固定期不自动续费且并非永久许可。首发付款由 Stripe 托管，首次购买享 14 天全额退款，续费不会重置该窗口。</span>
      </div>
    </LDlg>
  </div>;
}
window.GDLicenses=Licenses;
