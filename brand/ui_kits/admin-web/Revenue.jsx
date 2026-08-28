// 计费与营收 Revenue — MRR/ARR, plan contribution, transactions ledger, past-due recovery.
const {Panel:RPanel,Table:RTable,Badge:RBadge,Button:RBtn,Money:RMoney,Select:RSel,Toolbar:RToolbar,Dialog:RDlg}=window.GoodDealerDesignSystem_b5b0b6;

function Revenue(){
  const D=window.GD_ADMIN;const I=window.GDI;const MetricStrip=window.GDMetricStrip;
  const [type,setType]=React.useState("全部类型");const [status,setStatus]=React.useState("全部状态");
  const [refund,setRefund]=React.useState(null);
  const totalMrr=D.planMix.reduce((s,p)=>s+p.mrr,0);
  const TMAP={"全部类型":null,"扣款":"charge","退款":"refund"};const SMAP={"全部状态":null,"成功":"succeeded","失败":"failed"};
  let tx=D.transactions.filter(t=>(TMAP[type]==null||t.type===TMAP[type])&&(SMAP[status]==null||t.status===SMAP[status]));
  const pastDue=[{customer:"Sana Qureshi",id:"C-11733",amount:24.9,method:"Mastercard · 8890",tries:2,next:"今日 20:00"},{customer:"Halcyon Group",id:"C-11988",amount:74.9,method:"—",tries:1,next:"明日 09:00"}];
  return <div data-screen-label="计费与营收" style={{display:"flex",flexDirection:"column",height:"100%",minHeight:0}}>
    <MetricStrip metrics={[
      {label:"MRR",value:"$48,210",tone:"gold",meta:"环比 +0.6%"},
      {label:"ARR",value:"$578,520",tone:"gold",meta:"年化"},
      {label:"本月净新增",value:"+$1,840",tone:"success",meta:"扩张 -流失"},
      {label:"本月退款",value:"$149.40",tone:"danger",meta:"6 笔"},
      {label:"逾期待收",value:"$4,120",tone:"warning",meta:"48 笔重试中"},
      {label:"扣款回收率",value:"92%",tone:"success",meta:"失败重试成功"},
    ]}/>
    <div style={{padding:"14px 18px 0",display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
      <RPanel title="MRR 构成" actions={<span style={{fontFamily:"var(--font-mono)",fontSize:13,color:"var(--gd-gold)"}}>${(totalMrr/1000).toFixed(1)}k</span>}>
        <div style={{display:"flex",height:10,borderRadius:3,overflow:"hidden",marginBottom:12}}>
          {D.planMix.map(p=><div key={p.plan} style={{width:(p.mrr/totalMrr*100)+"%",background:p.color}}></div>)}
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {D.planMix.map(p=><div key={p.plan} style={{display:"flex",alignItems:"center",gap:8,fontSize:12}}>
            <span style={{width:8,height:8,borderRadius:2,background:p.color,flex:"none"}}></span>
            <span style={{color:"var(--text-1)",flex:1,whiteSpace:"nowrap"}}>{p.plan}</span>
            <span style={{color:"var(--text-3)",fontFamily:"var(--font-mono)",fontSize:11,whiteSpace:"nowrap"}}>{p.count.toLocaleString()} 订阅</span>
            <span style={{fontFamily:"var(--font-mono)",color:"var(--gd-gold)",width:64,textAlign:"right"}}>${(p.mrr/1000).toFixed(1)}k</span>
          </div>)}
        </div>
      </RPanel>
      <RPanel flush title="逾期待收" actions={<RBadge tone="warning">{pastDue.length} 需处理</RBadge>}>
        {pastDue.map(p=><div key={p.id} style={{display:"flex",alignItems:"center",gap:12,padding:"12px 16px",borderBottom:"1px solid var(--gd-line)"}}>
          <I.CircleAlert size={17} style={{color:"var(--gd-warning)",flex:"none"}}/>
          <div style={{flex:1,minWidth:0}}><div style={{fontSize:12.5,color:"var(--text-1)"}}>{p.customer}</div><div style={{fontSize:11,color:"var(--text-3)",fontFamily:"var(--font-mono)"}}>{p.method} · 重试 {p.tries} 次 · 下次 {p.next}</div></div>
          <RMoney amount={p.amount} size={13} tone="gold"/>
          <RBtn size="sm" variant="ghost" onClick={()=>setRefund(null)}>重试扣款</RBtn>
        </div>)}
      </RPanel>
    </div>
    <RToolbar region
      left={<><span style={{fontSize:13,fontWeight:500,color:"var(--text-1)"}}>交易流水</span><RSel size="sm" options={["全部类型","扣款","退款"]} value={type} onChange={e=>setType(e.target.value)}/><RSel size="sm" options={["全部状态","成功","失败"]} value={status} onChange={e=>setStatus(e.target.value)}/></>}
      right={<RBtn size="sm" icon={<I.Download size={14}/>}>导出对账单</RBtn>}/>
    <div style={{flex:1,minHeight:0,display:"flex"}}>
      <RTable density="regular" rowKey="id" maxHeight="100%" style={{flex:1,minHeight:0,border:"none",borderRadius:0}}
        columns={[
          {key:"id",label:"交易号",render:t=><span style={{fontFamily:"var(--font-mono)",fontSize:11,color:"var(--text-3)"}}>{t.id}</span>},
          {key:"customer",label:"客户",render:t=><span style={{fontSize:12.5,color:"var(--text-1)"}}>{t.customer}</span>},
          {key:"type",label:"类型",render:t=>t.type==="refund"?<RBadge tone="neutral" mono={false}>退款</RBadge>:<RBadge tone="sync" mono={false}>扣款</RBadge>},
          {key:"method",label:"支付方式",muted:true,render:t=><span style={{fontFamily:"var(--font-mono)",fontSize:11.5,color:"var(--text-2)"}}>{t.method}</span>},
          {key:"amount",label:"金额",numeric:true,render:t=><RMoney amount={t.amount} size={12} tone={t.type==="refund"?"danger":"gold"} sign={t.type==="refund"}/>},
          {key:"status",label:"状态",render:t=>t.status==="failed"?<RBadge tone="danger" mono={false}>失败</RBadge>:<RBadge tone="success">成功</RBadge>},
          {key:"date",label:"时间",numeric:true,render:t=><span style={{fontFamily:"var(--font-mono)",fontSize:11,color:"var(--text-3)"}}>{t.date}</span>},
          {key:"act",label:"",align:"right",render:t=>t.type==="charge"&&t.status==="succeeded"?<RBtn size="sm" variant="ghost" onClick={()=>setRefund(t)}>退款</RBtn>:t.status==="failed"?<RBtn size="sm" variant="ghost">重试</RBtn>:<span style={{fontSize:11,color:"var(--text-3)"}}>—</span>},
        ]}
        rows={tx}
        footer={<div style={{display:"flex",alignItems:"center",width:"100%",fontSize:11,color:"var(--text-3)"}}><span>{tx.length} 笔交易 · 计费由 Stripe 处理</span><span style={{marginLeft:"auto",fontFamily:"var(--font-mono)"}}>今日净额 <span style={{color:"var(--gd-gold)"}}>+$224.60</span></span></div>}/>
    </div>
    <RDlg open={!!refund} onClose={()=>setRefund(null)} title="退款" width={440} danger
      footer={<><RBtn onClick={()=>setRefund(null)}>取消</RBtn><RBtn variant="danger" onClick={()=>setRefund(null)}>退款 {refund&&"$"+refund.amount.toFixed(2)}</RBtn></>}>
      {refund&&<div style={{display:"flex",flexDirection:"column",gap:12,fontSize:13,color:"var(--text-2)",lineHeight:1.6}}>
        <span>向 <b style={{color:"var(--text-1)"}}>{refund.customer}</b> 退款 <b style={{color:"var(--gd-gold)",fontFamily:"var(--font-mono)"}}>${refund.amount.toFixed(2)}</b>（{refund.id}）。</span>
        <span style={{fontSize:11,color:"var(--text-3)"}}>退款经原支付方式（{refund.method}）返还，3–5 个工作日到账，并记入审计日志。是否同时降级/暂停订阅需另行操作。</span>
      </div>}
    </RDlg>
  </div>;
}
window.GDRevenue=Revenue;
