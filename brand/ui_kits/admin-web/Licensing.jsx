// License 与订单 / Licensing — global billing + entitlement ledger. Read-only reconciliation surface:
// Paddle (Merchant of Record) payment events, chargebacks/refunds, and the append-only
// ManualEntitlementAdjustment audit. GoodDealer never touches card data. Per-account entitlement CHANGES
// are not done here — they happen in the account detail under an AdminActionAuthorization; this page only
// records and reconciles what happened.
const {Badge:LBadge,Button:LBtn}=window.GoodDealerDesignSystem_b5b0b6;
const PAY_KIND={purchase:["success","购买"],renewal:["sync","续费"],refund:["warning","退款"],chargeback:["danger","拒付"]};

function LStat({label,value,tone,meta}){
  const c={gold:"var(--gd-gold)",danger:"var(--gd-danger)",warning:"var(--gd-warning)",success:"var(--gd-success)"}[tone]||"var(--text-1)";
  return <div style={{flex:"1 1 140px",minWidth:0,padding:"0 16px",borderRight:"1px solid var(--gd-line)"}}>
    <div style={{fontSize:11,letterSpacing:"0.06em",textTransform:"uppercase",color:"var(--text-3)"}}>{label}</div>
    <div style={{fontFamily:"var(--font-mono)",fontVariantNumeric:"tabular-nums",fontSize:22,color:c,marginTop:3}}>{value}</div>
    <div style={{fontSize:11,color:"var(--text-3)",minHeight:14,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{meta||" "}</div>
  </div>;
}

function Licensing({onOpenAccount}){
  const L=window.ADM_DATA.licensing;const S=L.stats;
  return <div style={{display:"flex",flexDirection:"column",gap:20}}>
    <div><h1 className="adm-h1">License 与订单</h1><p className="adm-sub" style={{margin:0}}>账务与 Entitlement 台账（只读对账）。Paddle 为 Merchant of Record，GoodDealer 不接触卡号。调整具体账号请在账号详情走 AdminActionAuthorization。</p></div>

    <div className="adm-card" style={{display:"flex",padding:"14px 0"}}>
      <LStat label="本月入账" value={S.monthInflow} tone="success" meta="Paddle 结算"/>
      <LStat label="退款" value={S.refunds} tone="warning" meta="过去 30 天"/>
      <LStat label="拒付" value={S.chargebacks} tone={S.chargebacks?"danger":"success"} meta="Chargeback"/>
      <LStat label="手动调整" value={S.adjustments} meta="手动 Entitlement 条目"/>
      <LStat label="待对账" value={S.pendingRecon} tone={S.pendingRecon?"warning":"success"} meta="需人工核对"/>
    </div>

    {/* Payment ledger */}
    <div className="adm-card" style={{padding:0,overflow:"hidden"}}>
      <div style={{padding:"13px 18px 10px",fontSize:11,letterSpacing:"0.08em",textTransform:"uppercase",color:"var(--text-3)"}}>账务事件 · ProviderPaymentEvent</div>
      <div style={{display:"flex",padding:"8px 18px",borderTop:"1px solid var(--gd-line-strong)",fontSize:10,letterSpacing:"0.05em",textTransform:"uppercase",color:"var(--text-3)"}}>
        <span style={{width:140,flex:"none"}}>时间</span><span style={{width:96,flex:"none"}}>账号</span><span style={{width:70,flex:"none"}}>类型</span><span style={{flex:1}}>说明</span><span style={{width:96,flex:"none"}}>Paddle</span><span style={{width:80,flex:"none",textAlign:"right"}}>Revision</span><span style={{width:80,flex:"none",textAlign:"right"}}>金额</span>
      </div>
      {L.payments.map((p,i)=>{const k=PAY_KIND[p.type];const neg=p.amount<0;
        return <div key={i} style={{display:"flex",alignItems:"center",padding:"10px 18px",borderTop:"1px solid var(--gd-line)",fontSize:12}}>
          <span style={{width:140,flex:"none",fontFamily:"var(--font-mono)",fontSize:11,color:"var(--text-3)"}}>{p.at}</span>
          <button onClick={()=>onOpenAccount&&onOpenAccount(p.acct)} style={{width:96,flex:"none",textAlign:"left",fontFamily:"var(--font-mono)",fontSize:11,color:"var(--text-link)",background:"none",border:"none",cursor:"pointer",padding:0}}>{p.acct}</button>
          <span style={{width:70,flex:"none"}}><LBadge tone={k[0]} mono={false}>{k[1]}</LBadge></span>
          <span style={{flex:1,minWidth:0,color:"var(--text-2)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{p.note}</span>
          <span style={{width:96,flex:"none",fontFamily:"var(--font-mono)",fontSize:11,color:"var(--text-3)"}}>{p.paddle}</span>
          <span style={{width:80,flex:"none",textAlign:"right",fontFamily:"var(--font-mono)",fontSize:11,color:"var(--text-3)"}}>{p.revision}</span>
          <span style={{width:80,flex:"none",textAlign:"right",fontFamily:"var(--font-mono)",color:neg?"var(--gd-danger)":"var(--text-1)"}}>{neg?"-$"+Math.abs(p.amount):"$"+p.amount}</span>
        </div>;})}
    </div>

    {/* Manual adjustment audit */}
    <div className="adm-card" style={{padding:0,overflow:"hidden"}}>
      <div style={{padding:"13px 18px 10px",display:"flex",alignItems:"center",gap:8}}>
        <span style={{fontSize:11,letterSpacing:"0.08em",textTransform:"uppercase",color:"var(--text-3)"}}>手动调整审计 · ManualEntitlementAdjustment</span>
        <LBadge tone="neutral" mono={false}>追加不可改</LBadge>
      </div>
      {L.adjustments.map((a,i)=>
        <div key={i} style={{display:"flex",alignItems:"center",gap:12,padding:"11px 18px",borderTop:"1px solid var(--gd-line)",fontSize:12,flexWrap:"wrap"}}>
          <span style={{fontFamily:"var(--font-mono)",fontSize:11,color:"var(--text-3)",width:130,flex:"none"}}>{a.at}</span>
          <button onClick={()=>onOpenAccount&&onOpenAccount(a.acct)} style={{fontFamily:"var(--font-mono)",fontSize:11,color:"var(--text-link)",background:"none",border:"none",cursor:"pointer",padding:0}}>{a.acct}</button>
          <span style={{flex:"1 1 200px",minWidth:0,color:"var(--text-1)"}}>{a.change}</span>
          <span style={{fontSize:11,color:"var(--text-3)"}}>{a.reason}</span>
          <span style={{fontSize:11,color:"var(--text-3)"}}>· {a.by} · {a.purpose} · rev {a.revision}</span>
        </div>)}
    </div>

    <div style={{border:"1px solid var(--gd-line)",borderRadius:8,padding:"12px 16px",fontSize:11,color:"var(--text-3)",lineHeight:1.6}}>
      拒付/退款自动记入账务并影响 Entitlement 状态；手动调整只能在账号详情逐次授权执行，绝不在此页批量改动。管理员不接触卡号或平台凭据。
    </div>
  </div>;
}
window.ADMLicensing=Licensing;
