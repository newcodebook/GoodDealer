// 账单与发票 Billing — payment method, invoice ledger (real DS Table), download receipts.
const {Panel:BPanel,Badge:BBadge,Button:BBtn,Money:BMoney,Table:BTable,Dialog:BDlg,Input:BInput,IconButton:BIcon}=window.GoodDealerDesignSystem_b5b0b6;

function Billing(){
  const D=window.GD_ACCOUNT;const I=window.GDI;const MetricStrip=window.GDMetricStrip;
  const [dlg,setDlg]=React.useState(null); // pay | invoice
  const [inv,setInv]=React.useState(null);
  const total=D.invoices.reduce((s,i)=>s+i.amount,0);
  const thisYear=D.invoices.filter(i=>i.date>="2025-12-01").reduce((s,i)=>s+i.amount,0);
  return <div data-screen-label="账单与发票" style={{display:"flex",flexDirection:"column",minHeight:0}}>
    <MetricStrip metrics={[
      {label:"本账期支出",value:"$"+thisYear.toFixed(2),tone:"gold",meta:"2026 年付 License"},
      {label:"累计支出",value:"$"+total.toFixed(2),tone:"gold",meta:D.invoices.length+" 张发票"},
      {label:"下次扣款",value:"2026-12-31",mono:true,meta:"$299.00 · 自动续费"},
      {label:"支付方式",value:"Visa · 4242",meta:"有效期 12/28"},
      {label:"账单状态",value:"正常",tone:"success",meta:"无欠费"},
    ]}/>
    <div style={{padding:18,display:"flex",flexDirection:"column",gap:14}}>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
        <BPanel title="支付方式" actions={<BBtn size="sm" onClick={()=>setDlg("pay")}>更换</BBtn>}>
          <div style={{display:"flex",alignItems:"center",gap:14}}>
            <div style={{width:56,height:36,flex:"none",borderRadius:6,background:"linear-gradient(135deg,var(--gd-panel-raised),var(--gd-ink))",border:"1px solid var(--gd-line-strong)",display:"flex",alignItems:"center",justifyContent:"center"}}><I.CreditCard size={20} style={{color:"var(--gd-gold)"}}/></div>
            <div style={{flex:1,display:"flex",flexDirection:"column",gap:3}}>
              <span style={{fontFamily:"var(--font-mono)",fontSize:14,color:"var(--text-1)",letterSpacing:"0.06em"}}>···· ···· ···· 4242</span>
              <span style={{fontSize:11,color:"var(--text-3)"}}>Visa · 有效期 12/28 · LI XINGHANG</span>
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
    <BDlg open={dlg==="pay"} onClose={()=>setDlg(null)} title="更换支付方式" width={440}
      footer={<><BBtn onClick={()=>setDlg(null)}>取消</BBtn><BBtn variant="primary" onClick={()=>setDlg(null)}>保存支付方式</BBtn></>}>
      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        <BInput label="卡号" mono placeholder="4242 4242 4242 4242"/>
        <div style={{display:"flex",gap:10}}><BInput label="有效期" mono placeholder="12 / 28"/><BInput label="CVC" mono placeholder="···"/></div>
        <BInput label="持卡人" placeholder="LI XINGHANG"/>
        <span style={{fontSize:11,color:"var(--text-3)"}}>支付由第三方处理，GoodDealer 不存储完整卡号。</span>
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
