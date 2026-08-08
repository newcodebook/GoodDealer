// 结账 / Checkout — review the order, then hand off to Paddle's hosted checkout (Merchant of Record).
// We NEVER collect card details here; payment + invoicing + tax are Paddle's. This surface only
// reviews the plan and email and links out to the secure Paddle page.
const {Button:CBtn,Input:CInput,Badge:CBadge}=window.GoodDealerDesignSystem_b5b0b6;
const cmoney=n=>Number(n).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});

function Checkout({plan,onBack,onDone}){
  const D=window.AW_DATA;
  const p=plan||D.plans.find(x=>x.key==="annual");
  const [email,setEmail]=React.useState(D.account.email);
  const taxNote="增值税/销售税按销售地在 Paddle 结账时计算";
  const termLabel={monthly:"按月续费",annual:"按年续费",lifetime:"一次性 · 永久授权"}[p.key];

  return <div style={{display:"flex",flexDirection:"column",gap:18}}>
    <button onClick={onBack} style={{alignSelf:"flex-start",background:"none",border:"none",color:"var(--text-2)",cursor:"pointer",font:"inherit",fontSize:13,display:"inline-flex",alignItems:"center",gap:5}}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>返回定价</button>
    <h1 className="aw-h1">结账</h1>

    <div style={{display:"flex",gap:20,flexWrap:"wrap",alignItems:"flex-start"}}>
      {/* order summary */}
      <div className="aw-card" style={{flex:"1 1 340px",minWidth:0,display:"flex",flexDirection:"column",gap:0}}>
        <div style={{fontSize:11,letterSpacing:"0.08em",textTransform:"uppercase",color:"var(--text-3)",marginBottom:12}}>订单</div>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",paddingBottom:12,borderBottom:"1px solid var(--gd-line)"}}>
          <div><div style={{fontSize:15,fontWeight:600}}>{p.name} License</div><div style={{fontSize:12,color:"var(--text-3)"}}>{termLabel}</div></div>
          <div style={{textAlign:"right"}}><div style={{fontFamily:"var(--font-mono)",fontSize:18,color:p.gold?"var(--gd-gold)":"var(--text-1)"}}>${cmoney(p.price)}</div><div style={{fontSize:11,color:"var(--text-3)"}}>{p.unit}</div></div>
        </div>
        <div style={{display:"flex",justifyContent:"space-between",fontSize:12,color:"var(--text-2)",padding:"11px 0",borderBottom:"1px solid var(--gd-line)"}}><span>税费</span><span style={{color:"var(--text-3)"}}>结账时计算</span></div>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",paddingTop:12}}>
          <span style={{fontSize:13}}>应付</span>
          <span style={{fontFamily:"var(--font-mono)",fontSize:20,fontWeight:600,color:p.gold?"var(--gd-gold)":"var(--text-1)"}}>${cmoney(p.price)}<span style={{fontSize:12,color:"var(--text-3)",marginLeft:6}}>+税</span></span>
        </div>
      </div>

      {/* email + pay */}
      <div style={{flex:"1 1 300px",minWidth:0,display:"flex",flexDirection:"column",gap:14}}>
        <CInput label="账户邮箱" size="lg" type="email" value={email} onChange={e=>setEmail(e.target.value)} hint="License、发票与安全通知发送到此邮箱"/>
        <div style={{border:"1px solid var(--gd-line)",borderRadius:8,padding:"12px 14px",display:"flex",flexDirection:"column",gap:8,fontSize:12,color:"var(--text-2)",lineHeight:1.55}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}><CBadge tone="sync" mono={false}>Paddle</CBadge><span style={{color:"var(--text-3)"}}>Merchant of Record</span></div>
          支付与开票由 <b style={{color:"var(--text-1)",fontWeight:500}}>Paddle</b> 安全处理，本页不收集卡号。点击继续将前往 Paddle 结账页完成付款。{taxNote}。
        </div>
        <CBtn variant={p.gold?"gold":"primary"} size="lg" block disabled={!email} onClick={onDone}>继续到 Paddle 结账 · ${cmoney(p.price)}</CBtn>
        <div style={{fontSize:11,color:"var(--text-3)",textAlign:"center",lineHeight:1.6}}>购买即同意 <span style={{color:"var(--text-link)"}}>服务条款</span> 与 <span style={{color:"var(--text-link)"}}>隐私政策</span>。首次购买含 14 天全额退款（销售地强制规则优先）。</div>
      </div>
    </div>
  </div>;
}
window.AWCheckout=Checkout;
