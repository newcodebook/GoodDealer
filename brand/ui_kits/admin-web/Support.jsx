// 支持工单 Support — ticket inbox: tabs by status, table, detail drawer with reply/assign/resolve.
const {Panel:TPanel,Table:TTable,Badge:TBadge,Button:TBtn,Tabs:TTabs,Input:TInput,Select:TSel,Toolbar:TToolbar,Dialog:TDlg}=window.GoodDealerDesignSystem_b5b0b6;

const PRIO={high:<TBadge tone="danger" mono={false}>高</TBadge>,normal:<TBadge tone="sync" mono={false}>普通</TBadge>,low:<TBadge tone="neutral" mono={false}>低</TBadge>};
const CHAN={email:"邮件","in-app":"应用内",billing:"账单"};

function Support(){
  const D=window.GD_ADMIN;const I=window.GDI;const MetricStrip=window.GDMetricStrip;
  const [tickets,setTickets]=React.useState(()=>D.tickets.map(t=>({...t})));
  const [tab,setTab]=React.useState("open");const [q,setQ]=React.useState("");
  const [sel,setSel]=React.useState(null);
  const counts={open:tickets.filter(t=>t.status==="open").length,pending:tickets.filter(t=>t.status==="pending").length,resolved:tickets.filter(t=>t.status==="resolved").length};
  let rows=tickets.filter(t=>(tab==="all"||t.status===tab)&&(q===""||t.subject.includes(q)||t.customer.includes(q)||t.id.toLowerCase().includes(q.toLowerCase())));
  const resolve=t=>{setTickets(ts=>ts.map(x=>x.id===t.id?{...x,status:"resolved"}:x));setSel(null);};
  const assign=t=>{setTickets(ts=>ts.map(x=>x.id===t.id?{...x,assignee:"王运维",status:x.status==="open"?"pending":x.status}:x));setSel(s=>s&&s.id===t.id?{...s,assignee:"王运维"}:s);};
  return <div data-screen-label="支持工单" style={{display:"flex",flexDirection:"column",height:"100%",minHeight:0}}>
    <MetricStrip metrics={[
      {label:"待处理",value:counts.open+counts.pending,tone:"warning",meta:"open + pending"},
      {label:"高优先级",value:tickets.filter(t=>t.priority==="high"&&t.status!=="resolved").length,tone:"danger",meta:"需优先响应"},
      {label:"平均首响",value:"1.8h",tone:"success",meta:"SLA 4h"},
      {label:"今日解决",value:"14",tone:"success",meta:"解决率 91%"},
      {label:"未分配",value:tickets.filter(t=>t.assignee==="—"&&t.status!=="resolved").length,tone:"warning",meta:"待认领"},
      {label:"CSAT 满意度",value:"4.7",tone:"gold",meta:"近 30 天 · 5 分制"},
    ]}/>
    <div style={{display:"flex",alignItems:"center",gap:12,padding:"0 18px",borderBottom:"1px solid var(--gd-line)",background:"var(--gd-panel)"}}>
      <TTabs items={[{key:"open",label:"待认领",count:counts.open},{key:"pending",label:"处理中",count:counts.pending},{key:"resolved",label:"已解决",count:counts.resolved},{key:"all",label:"全部"}]} active={tab} onChange={setTab}/>
    </div>
    <TToolbar region
      left={<TInput size="sm" prefix={<I.Search size={13}/>} placeholder="搜索主题、客户、工单号…" value={q} onChange={e=>setQ(e.target.value)} style={{width:260}}/>}
      right={<TBtn size="sm" variant="primary" icon={<I.Plus size={14}/>}>新建工单</TBtn>}/>
    <div style={{flex:1,minHeight:0,display:"flex"}}>
      <TTable density="regular" rowKey="id" maxHeight="100%" onRowClick={setSel} style={{flex:1,minHeight:0,border:"none",borderRadius:0}}
        columns={[
          {key:"id",label:"工单",render:t=><span style={{fontFamily:"var(--font-mono)",fontSize:11,color:"var(--text-3)"}}>{t.id}</span>},
          {key:"subject",label:"主题",render:t=><span style={{fontSize:12.5,color:"var(--text-1)"}}>{t.subject}</span>},
          {key:"customer",label:"客户",muted:true},
          {key:"priority",label:"优先级",render:t=>PRIO[t.priority]},
          {key:"channel",label:"渠道",render:t=><span style={{fontSize:12,color:"var(--text-2)"}}>{CHAN[t.channel]}</span>},
          {key:"assignee",label:"处理人",render:t=><span style={{fontSize:12,color:t.assignee==="—"?"var(--text-3)":"var(--text-1)"}}>{t.assignee==="—"?"未分配":t.assignee}</span>},
          {key:"status",label:"状态",render:t=>t.status==="resolved"?<TBadge tone="success">已解决</TBadge>:t.status==="pending"?<TBadge tone="sync" mono={false}>处理中</TBadge>:<TBadge tone="warning" mono={false}>待认领</TBadge>},
          {key:"updated",label:"更新",numeric:true,render:t=><span style={{fontFamily:"var(--font-mono)",fontSize:11,color:"var(--text-3)"}}>{t.updated}</span>},
        ]}
        rows={rows} emptyText="此分类下暂无工单"/>
    </div>
    <TDlg open={!!sel} onClose={()=>setSel(null)} title={sel?sel.id:""} width={560}
      footer={sel&&<><TBtn onClick={()=>setSel(null)}>关闭</TBtn>{sel.assignee==="—"&&<TBtn onClick={()=>assign(sel)}>认领</TBtn>}{sel.status!=="resolved"&&<TBtn variant="primary" onClick={()=>resolve(sel)}>标记已解决</TBtn>}</>}>
      {sel&&<div style={{display:"flex",flexDirection:"column",gap:13}}>
        <div>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>{PRIO[sel.priority]}{sel.status==="resolved"?<TBadge tone="success">已解决</TBadge>:sel.status==="pending"?<TBadge tone="sync" mono={false}>处理中</TBadge>:<TBadge tone="warning" mono={false}>待认领</TBadge>}<span style={{fontSize:11,color:"var(--text-3)",marginLeft:"auto"}}>{CHAN[sel.channel]} · {sel.updated}</span></div>
          <div style={{fontSize:15,fontWeight:600,color:"var(--text-1)"}}>{sel.subject}</div>
          <div style={{fontSize:12,color:"var(--text-3)",marginTop:3}}>{sel.customer} · 处理人 {sel.assignee==="—"?"未分配":sel.assignee}</div>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:10,padding:"13px 14px",background:"var(--gd-panel)",border:"1px solid var(--gd-line)",borderRadius:7}}>
          <div style={{display:"flex",gap:10}}><span style={{width:24,height:24,flex:"none",borderRadius:"50%",background:"var(--gd-panel-raised)",border:"1px solid var(--gd-line-strong)",fontSize:10,display:"flex",alignItems:"center",justifyContent:"center",color:"var(--text-2)"}}>客</span><div style={{fontSize:12.5,color:"var(--text-2)",lineHeight:1.6}}>移交执行权后新设备一直停留在「正在安全激活」，超过一天仍未完成，旧设备已排空。请协助排查。</div></div>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:6}}>
          <span className="gd-t-label">回复</span>
          <textarea placeholder="输入回复…" style={{width:"100%",minHeight:70,resize:"vertical",background:"var(--gd-ink)",border:"1px solid var(--gd-line-strong)",borderRadius:5,color:"var(--gd-text)",fontFamily:"var(--font-sans)",fontSize:13,padding:"9px 11px",outline:"none",boxSizing:"border-box"}}></textarea>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <TSel size="sm" options={["未分配","王运维","李工","张工"]} value={sel.assignee==="—"?"未分配":sel.assignee} onChange={()=>{}}/>
          <TSel size="sm" options={["高","普通","低"]} value={sel.priority==="high"?"高":sel.priority==="low"?"低":"普通"} onChange={()=>{}}/>
          <TBtn size="sm" variant="primary" style={{marginLeft:"auto"}}>发送回复</TBtn>
        </div>
      </div>}
    </TDlg>
  </div>;
}
window.GDSupport=Support;
