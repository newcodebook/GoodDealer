// 客户管理 Customers — cross-customer table with filters + detail drawer (plan, devices, actions).
const {Panel:CPanel,Table:CTable,Badge:CBadge,Button:CBtn,Money:CMoney,Input:CInput,Select:CSel,Toolbar:CToolbar,Dialog:CDlg,StatusDot:CDot,IconButton:CIcon}=window.GoodDealerDesignSystem_b5b0b6;

const CSTAT={active:{b:<CBadge tone="success">活跃</CBadge>},trial:{b:<CBadge tone="sync" mono={false}>试用</CBadge>},past_due:{b:<CBadge tone="warning" mono={false}>逾期</CBadge>},churned:{b:<CBadge tone="neutral" mono={false}>已流失</CBadge>}};
const PLAN_COL={Professional:"var(--gd-gold)",Portfolio:"var(--gd-blue)",Starter:"var(--gd-text-muted)"};

function Customers(){
  const D=window.GD_ADMIN;const I=window.GDI;const MetricStrip=window.GDMetricStrip;const Pagination=window.GDPagination;
  const [q,setQ]=React.useState("");const [plan,setPlan]=React.useState("全部方案");const [status,setStatus]=React.useState("全部状态");
  const [page,setPage]=React.useState(1);const [pageSize,setPageSize]=React.useState(10);
  const [sel,setSel]=React.useState(null);
  React.useEffect(()=>{setPage(1);},[q,plan,status,pageSize]);
  const SMAP={"全部状态":null,"活跃":"active","试用":"trial","逾期":"past_due","已流失":"churned"};
  let rows=D.customers.filter(c=>(plan==="全部方案"||c.plan===plan)&&(SMAP[status]==null||c.status===SMAP[status])&&(q===""||c.name.toLowerCase().includes(q.toLowerCase())||c.email.includes(q.toLowerCase())||c.id.toLowerCase().includes(q.toLowerCase())));
  const pages=Math.max(1,Math.ceil(rows.length/pageSize));const cur=Math.min(page,pages);
  const pageRows=rows.slice((cur-1)*pageSize,cur*pageSize);
  return <div data-screen-label="客户管理" style={{display:"flex",flexDirection:"column",height:"100%",minHeight:0}}>
    <MetricStrip metrics={[
      {label:"总客户",value:"2,847",meta:"含试用与流失"},
      {label:"活跃",value:"2,413",tone:"success",meta:"付费订阅"},
      {label:"试用",value:"186",tone:"body",meta:"14 天内到期 92"},
      {label:"逾期 past_due",value:"48",tone:"warning",meta:"扣款失败重试中"},
      {label:"本月新增",value:"+124",tone:"success",meta:"净增 +71"},
      {label:"本月流失",value:"53",tone:"danger",meta:"流失率 1.8%"},
    ]}/>
    <CToolbar region
      left={<>
        <CInput size="sm" prefix={<I.Search size={13}/>} placeholder="搜索姓名、邮箱、客户 ID…" value={q} onChange={e=>setQ(e.target.value)} style={{width:240}}/>
        <CSel size="sm" options={["全部方案","Professional","Portfolio","Starter"]} value={plan} onChange={e=>setPlan(e.target.value)}/>
        <CSel size="sm" options={["全部状态","活跃","试用","逾期","已流失"]} value={status} onChange={e=>setStatus(e.target.value)}/>
      </>}
      right={<><CBtn size="sm" icon={<I.Download size={14}/>}>导出 CSV</CBtn><CBtn size="sm" variant="primary" icon={<I.Plus size={14}/>}>新建客户</CBtn></>}/>
    <div style={{flex:1,minHeight:0,display:"flex"}}>
      <CTable density="regular" rowKey="id" maxHeight="100%" onRowClick={setSel} style={{flex:1,minHeight:0,border:"none",borderRadius:0}}
        columns={[
          {key:"name",label:"客户",render:c=><div style={{display:"flex",alignItems:"center",gap:10}}><span style={{width:26,height:26,flex:"none",borderRadius:"50%",background:"var(--gd-panel-raised)",border:"1px solid var(--gd-line-strong)",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"var(--font-mono)",fontSize:10,color:"var(--text-2)"}}>{c.country}</span><div style={{display:"flex",flexDirection:"column",gap:1,minWidth:0}}><span style={{fontSize:12.5,color:"var(--text-1)"}}>{c.name}</span><span style={{fontSize:11,color:"var(--text-3)",fontFamily:"var(--font-mono)"}}>{c.email}</span></div></div>},
          {key:"id",label:"ID",render:c=><span style={{fontFamily:"var(--font-mono)",fontSize:11,color:"var(--text-3)"}}>{c.id}</span>},
          {key:"plan",label:"方案",render:c=><span style={{display:"inline-flex",alignItems:"center",gap:6,fontSize:12,color:"var(--text-1)"}}><span style={{width:6,height:6,borderRadius:2,background:PLAN_COL[c.plan],flex:"none"}}></span>{c.plan}</span>},
          {key:"status",label:"状态",render:c=>CSTAT[c.status].b},
          {key:"devices",label:"设备",numeric:true,render:c=><span style={{fontFamily:"var(--font-mono)",fontSize:12,color:c.devices?"var(--text-1)":"var(--text-3)"}}>{c.devices}</span>},
          {key:"domains",label:"域名",numeric:true,render:c=><span style={{fontFamily:"var(--font-mono)",fontSize:12,color:"var(--text-2)"}}>{c.domains.toLocaleString()}</span>},
          {key:"mrr",label:"MRR",numeric:true,render:c=>c.mrr?<CMoney amount={c.mrr} size={12}/>:<span style={{fontFamily:"var(--font-mono)",color:"var(--text-3)"}}>—</span>},
          {key:"lastSeen",label:"最后活跃",numeric:true,render:c=><span style={{fontFamily:"var(--font-mono)",fontSize:11,color:"var(--text-3)"}}>{c.lastSeen}</span>},
        ]}
        rows={pageRows}
        footer={<Pagination page={cur} pageSize={pageSize} total={rows.length} onPage={setPage} onPageSize={setPageSize} note={<>{D.customers.length} 位客户 · MRR <span style={{color:"var(--gd-gold)"}}>$48.2k</span></>}/>}/>
    </div>
    <CDlg open={!!sel} onClose={()=>setSel(null)} title={sel?sel.name:""} width={520}
      footer={<><CBtn onClick={()=>setSel(null)}>关闭</CBtn><CBtn icon={<I.ExternalLink size={13}/>}>以客户身份查看</CBtn><CBtn variant="primary">管理订阅</CBtn></>}>
      {sel&&<div style={{display:"flex",flexDirection:"column",gap:14}}>
        <div style={{display:"flex",alignItems:"center",gap:12,paddingBottom:12,borderBottom:"1px solid var(--gd-line)"}}>
          <span style={{width:40,height:40,flex:"none",borderRadius:"50%",background:"var(--gd-panel-raised)",border:"1px solid var(--gd-line-strong)",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"var(--font-mono)",fontSize:12,color:"var(--gd-gold)"}}>{sel.country}</span>
          <div style={{flex:1,minWidth:0}}><div style={{fontSize:14,fontWeight:600,color:"var(--text-1)"}}>{sel.name}</div><div style={{fontSize:11,color:"var(--text-3)",fontFamily:"var(--font-mono)"}}>{sel.email} · {sel.id}</div></div>
          {CSTAT[sel.status].b}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10}}>
          {[["方案",sel.plan],["MRR",sel.mrr?"$"+sel.mrr:"—"],["设备",sel.devices+" / "+(sel.plan==="Portfolio"?5:2)],["域名",sel.domains.toLocaleString()]].map(([k,v])=>
            <div key={k} style={{padding:"9px 11px",background:"var(--gd-panel-raised)",border:"1px solid var(--gd-line)",borderRadius:6}}><div className="gd-t-label">{k}</div><div style={{fontFamily:"var(--font-mono)",fontSize:14,color:k==="MRR"?"var(--gd-gold)":"var(--text-1)",marginTop:3}}>{v}</div></div>)}
        </div>
        <div style={{display:"flex",flexDirection:"column"}}>
          {[["注册日期",sel.since],["最后活跃",sel.lastSeen],["地区",sel.country],["支付状态",sel.status==="past_due"?"扣款失败 · 重试中":"正常"]].map(([k,v])=>
            <div key={k} style={{display:"flex",padding:"8px 0",borderBottom:"1px solid var(--gd-line)",fontSize:12.5}}><span style={{width:100,flex:"none",color:"var(--text-3)"}}>{k}</span><span style={{color:v.includes("失败")?"var(--gd-warning)":"var(--text-1)",fontFamily:k==="注册日期"?"var(--font-mono)":undefined}}>{v}</span></div>)}
        </div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          <CBtn size="sm" variant="ghost">重置 2FA</CBtn>
          <CBtn size="sm" variant="ghost">发送重置邮件</CBtn>
          {sel.status==="churned"?<CBtn size="sm" variant="ghost">恢复账户</CBtn>:<CBtn size="sm" variant="ghost">暂停账户</CBtn>}
        </div>
      </div>}
    </CDlg>
  </div>;
}
window.GDCustomers=Customers;
