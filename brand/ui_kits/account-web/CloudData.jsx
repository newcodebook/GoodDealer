// 云端数据 CloudData — read-only mirror of the portfolio + append-only revision ledger.
// Editing/execution happen in the desktop client; this is the "数据来自 GoodDealer Cloud" view.
const {Panel:CPanel,Badge:CBadge,Money:CMoney,Tabs:CTabs,Input:CInput,Select:CSel,Table:CTable,StatusDot:CDot,Button:CBtn}=window.GoodDealerDesignSystem_b5b0b6;

function CloudData(){
  const D=window.GD_ACCOUNT;const I=window.GDI;const MetricStrip=window.GDMetricStrip;
  const Pagination=window.GDPagination;
  const [tab,setTab]=React.useState("assets");
  const [q,setQ]=React.useState("");
  const [reg,setReg]=React.useState("全部");
  const [page,setPage]=React.useState(1);const [pageSize,setPageSize]=React.useState(10);
  React.useEffect(()=>{setPage(1);},[q,reg,pageSize,tab]);
  const STB={synced:<CBadge tone="sync">SYNCED</CBadge>,sold:<CBadge tone="gold">SOLD</CBadge>,pending:<CBadge tone="warning" mono={false}>等待平台</CBadge>,conflict:<CBadge tone="danger" mono={false}>冲突</CBadge>};
  let rows=D.portfolio.filter(r=>(reg==="全部"||r.registrar===reg)&&(q===""||r.domain.includes(q.toLowerCase())));
  const pages=Math.max(1,Math.ceil(rows.length/pageSize));const cur=Math.min(page,pages);
  const pageRows=rows.slice((cur-1)*pageSize,cur*pageSize);
  return <div data-screen-label="云端数据" style={{display:"flex",flexDirection:"column",height:"100%",minHeight:0}}>
    <MetricStrip metrics={[
      {label:"组合估值",value:"$284,120.00",tone:"gold",meta:"云端快照 · 截至 14:02"},
      {label:"域名总数",value:"1,024",meta:"只读镜像"},
      {label:"当前 Revision",value:"rev 8,241",mono:true,meta:"追加不可篡改"},
      {label:"待裁决冲突",value:"1",tone:"danger",meta:"在桌面客户端裁决"},
      {label:"最后同步",value:"14:02",mono:true,meta:"MacBook Pro · Active"},
    ]}/>
    <div style={{display:"flex",alignItems:"center",gap:12,padding:"0 18px",borderBottom:"1px solid var(--gd-line)",background:"var(--gd-panel)"}}>
      <CTabs items={[{key:"assets",label:"资产快照",count:1024},{key:"ledger",label:"操作账本"}]} active={tab} onChange={setTab}/>
      <span style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:7,fontSize:11,color:"var(--gd-blue)"}}><I.Cloud size={13}/>数据来自 GoodDealer Cloud · 只读</span>
    </div>
    {tab==="assets"?<>
      <div style={{display:"flex",alignItems:"center",gap:9,padding:"10px 18px",borderBottom:"1px solid var(--gd-line)"}}>
        <CInput size="sm" prefix={<I.Search size={13}/>} placeholder="筛选域名…" value={q} onChange={e=>setQ(e.target.value)} style={{width:220}}/>
        <CSel size="sm" options={["全部","Spaceship","Namecheap","Dynadot"]} value={reg} onChange={e=>setReg(e.target.value)}/>
        <span style={{marginLeft:"auto",fontSize:11,color:"var(--text-3)"}}>编辑与执行请在桌面客户端进行</span>
      </div>
      <div style={{flex:1,minHeight:0,display:"flex"}}>
        <CTable density="regular" rowKey="domain" maxHeight="100%" style={{flex:1,minHeight:0,border:"none",borderRadius:0}}
          columns={[
            {key:"domain",label:"域名",render:r=><span style={{fontFamily:"var(--font-mono)",fontSize:12,color:"var(--text-1)"}}>{r.domain}</span>},
            {key:"registrar",label:"注册商",muted:true},
            {key:"status",label:"状态",render:r=>STB[r.status]},
            {key:"bin",label:"估值 BIN",numeric:true,render:r=><CMoney amount={r.bin} size={12}/>},
            {key:"expiry",label:"到期",numeric:true,render:r=><span style={{fontFamily:"var(--font-mono)",fontSize:12,color:r.expiry<"2026-10-01"?"var(--gd-warning)":"var(--text-2)"}}>{r.expiry}</span>},
          ]}
          rows={pageRows}
          footer={<Pagination page={cur} pageSize={pageSize} total={rows.length} onPage={setPage} onPageSize={setPageSize} note={<>组合估值 <span style={{color:"var(--gd-gold)"}}>$284,120.00</span></>}/>}/>
      </div>
    </>:<div style={{flex:1,minHeight:0,display:"flex"}}>
      <CTable density="regular" rowKey="rev" maxHeight="100%" style={{flex:1,minHeight:0,border:"none",borderRadius:0}}
        columns={[
          {key:"rev",label:"Revision",render:r=><span style={{fontFamily:"var(--font-mono)",fontSize:12,color:"var(--gd-gold)"}}>rev {r.rev}</span>},
          {key:"op",label:"操作",render:r=><span style={{display:"flex",alignItems:"center",gap:7,color:"var(--text-1)"}}>{r.risk&&<I.AlertTriangle size={13} style={{color:"var(--gd-danger)"}}/>}{r.op}</span>},
          {key:"platform",label:"平台",muted:true},
          {key:"source",label:"来源设备",muted:true},
          {key:"items",label:"条目",numeric:true,render:r=><span style={{fontFamily:"var(--font-mono)",fontSize:12,color:"var(--text-1)"}}>{r.items.toLocaleString()}</span>},
          {key:"status",label:"状态",render:r=>r.status==="rolledback"?<CBadge tone="neutral" mono={false}>已回滚</CBadge>:<CBadge tone="success">已应用</CBadge>},
          {key:"time",label:"时间",numeric:true,render:r=><span style={{fontFamily:"var(--font-mono)",fontSize:12,color:"var(--text-3)"}}>{r.time}</span>},
        ]}
        rows={D.ledger}
        footer={<div style={{display:"flex",alignItems:"center",width:"100%",fontSize:11,color:"var(--text-3)"}}><span>账本追加不可篡改 · 回滚会生成新的反向 Revision</span><span style={{marginLeft:"auto",fontFamily:"var(--font-mono)"}}>基线 rev 8,241</span></div>}/>
    </div>}
  </div>;
}
window.GDCloudData=CloudData;
