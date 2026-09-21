// 账单与发票 Billing — hosted-provider payment management, invoice ledger, download receipts.
const {Panel:BPanel,Badge:BBadge,Button:BBtn,Money:BMoney,Table:BTable,Dialog:BDlg,IconButton:BIcon}=window.GoodDealerDesignSystem_b5b0b6;

function Billing(){
  const D=window.GD_ACCOUNT;const I=window.GDI;const MetricStrip=window.GDMetricStrip;
  const [dlg,setDlg]=React.useState(null); // provider | invoice
  const [inv,setInv]=React.useState(null);
  const total=D.invoices.reduce((s,i)=>s+i.amount,0);
  const thisYear=D.invoices.filter(i=>i.date>="2025-12-01").reduce((s,i)=>s+i.amount,0);
  return <div data-screen-label="账单与发票" style={{display:"flex",flexDirection:"column",minHeight:0}}>
    <MetricStrip metrics={[
      {label:"本账期支出",value:"$"+thisYear.toFixed(2),tone:"gold",meta:"2026 年付 License"},
      {label:"累计支出",value:"$"+total.toFixed(2),tone:"gold",meta:D.invoices.length+" 张发票"},
      {label:"下次扣款",value:"2026-12-31",mono:true,meta:"$98.00 · 自动续费"},
      {label:"付款渠道",value:"Stripe",meta:"Provider 托管"},
      {label:"账单状态",value:"正常",tone:"success",meta:"无欠费"},
    ]}/>
    <div style={{padding:18,display:"flex",flexDirection:"column",gap:14}}>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
        <BPanel title="付款渠道" actions={<BBtn size="sm" onClick={()=>setDlg("provider")}>管理</BBtn>}>
          <div style={{display:"flex",alignItems:"center",gap:14}}>
            <div style={{width:56,height:36,flex:"none",borderRadius:6,background:"linear-gradient(135deg,var(--gd-panel-raised),var(--gd-ink))",border:"1px solid var(--gd-line-strong)",display:"flex",alignItems:"center",justifyContent:"center"}}><I.CreditCard size={20} style={{color:"var(--gd-gold)"}}/></div>
            <div style={{flex:1,display:"flex",flexDirection:"column",gap:3}}>
              <span style={{fontSize:14,color:"var(--text-1)"}}>Stripe 托管付款方式</span>
              <span style={{fontSize:11,color:"var(--text-3)"}}>付款资料只在 Stripe 托管页面中管理</span>
            </div>
            <BBadge tone="success" dot>默认</BBadge>
          </div>
        </BPanel>
        <BPanel title="账单信息" actions={<BBtn size="sm" variant="ghost">编辑</BBtn>}>
          <div style={{display:"flex",flexDirection:"column"}}>
            {[["账单主体","陈立行 · 个人"],["国家 / 地区","中国"],["税号 / VAT","—"],["发票邮箱","li@quanta.trade"]].map(([k,v])=>
              <div key={k} style={{display:"flex",padding:"7px 0",borderBottom:"1px solid var(--gd-line)",fontSize:12.5}}>
                <span style={{width:96,flex:"none",color:"var(--text-3)"}}>{k}</span><span style={{color:"var(--text-1)"}}>{v}</span></div>)}
          </div>
        </BPanel>
      </div>
      <BPanel flush title="发票" actions={<BBtn size="sm" variant="ghost" icon={<I.Download size={13}/>}>导出全部</BBtn>}>
        <BTable density="regular" rowKey="id"
          onRowClick={r=>{setInv(r);setDlg("invoice");}}
          style={{border:"none",borderRadius:0}}
          columns={[
            {key:"id",label:"发票号",render:r=><span style={{fontFamily:"var(--font-mono)",fontSize:12,color:"var(--text-1)"}}>{r.id}</span>},
            {key:"date",label:"日期",numeric:true,render:r=><span style={{fontFamily:"var(--font-mono)",fontSize:12,color:"var(--text-2)"}}>{r.date}</span>},
            {key:"desc",label:"说明",render:r=><span style={{color:"var(--text-1)"}}>{r.desc}</span>},
            {key:"method",label:"支付方式",muted:true},
            {key:"amount",label:"金额",numeric:true,render:r=>r.amount===0?<span style={{fontFamily:"var(--font-mono)",color:"var(--text-3)"}}>$0.00</span>:<BMoney amount={r.amount} size={12}/>},
            {key:"status",label:"状态",render:()=><BBadge tone="success">PAID</BBadge>},
            {key:"act",label:"",align:"right",render:r=><span style={{display:"inline-flex",gap:4}} onClick={e=>e.stopPropagation()}><BIcon size="sm" label="下载 PDF"><I.Download size={14}/></BIcon><BIcon size="sm" label="查看"><I.ExternalLink size={14}/></BIcon></span>},
          ]}
          rows={D.invoices}/>
      </BPanel>
    </div>
    <BDlg open={dlg==="provider"} onClose={()=>setDlg(null)} title="管理付款渠道" width={440}
      footer={<BBtn onClick={()=>setDlg(null)}>关闭</BBtn>}>
      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        <div style={{padding:"12px 14px",border:"1px solid var(--gd-line-strong)",borderRadius:7,background:"var(--gd-panel-raised)",fontSize:12,color:"var(--text-2)",lineHeight:1.6}}>GoodDealer 不采集卡号、安全码或付款账户资料。选择渠道后会离开本页，在 Provider 托管页面完成管理。</div>
        <BBtn variant="primary" icon={<I.ExternalLink size={13}/>}>前往 Stripe</BBtn>
        <span style={{fontSize:11,color:"var(--text-3)"}}>首发付款由 Stripe 托管；同一账号一次只能占用一个付款 Provider。</span>
      </div>
    </BDlg>
    <BDlg open={dlg==="invoice"} onClose={()=>setDlg(null)} title={inv?inv.id:""} width={480}
      footer={<><BBtn onClick={()=>setDlg(null)}>关闭</BBtn><BBtn variant="primary" icon={<I.Download size={13}/>} onClick={()=>setDlg(null)}>下载 PDF</BBtn></>}>
      {inv&&<div style={{display:"flex",flexDirection:"column",gap:12}}>
        <div style={{display:"flex",alignItems:"center",gap:10,paddingBottom:12,borderBottom:"1px solid var(--gd-line)"}}>
          <img src="../../assets/logo/mark-flat.svg" width="24" height="24" alt=""/>
          <div style={{display:"flex",flexDirection:"column"}}><span style={{fontSize:13,fontWeight:600,color:"var(--text-1)"}}>GoodDealer</span><span style={{fontSize:11,color:"var(--text-3)"}}>收据 · Receipt</span></div>
          <BBadge tone="success" style={{marginLeft:"auto"}}>PAID</BBadge>
        </div>
        {[["发票号",inv.id],["开票日期",inv.date],["说明",inv.desc],["支付方式",inv.method||"—"]].map(([k,v])=>
          <div key={k} style={{display:"flex",fontSize:12.5}}><span style={{width:88,flex:"none",color:"var(--text-3)"}}>{k}</span><span style={{color:"var(--text-1)",fontFamily:k==="发票号"||k==="开票日期"?"var(--font-mono)":undefined}}>{v}</span></div>)}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginTop:6,paddingTop:12,borderTop:"1px solid var(--gd-line)"}}>
          <span style={{fontSize:13,color:"var(--text-2)"}}>合计</span><BMoney amount={inv.amount} size={18}/>
        </div>
      </div>}
    </BDlg>
  </div>;
}
window.GDBilling=Billing;
