// 订阅与账单 / Subscription — current plan + state, upgrade(即时补差价)/downgrade(下周期)/cancel(周期末,不自动退款),
// payment method, invoices, and the renew-recovery path for grace(7天)/suspended. When suspended the desktop
// client is Locked but this account web stays reachable; renewing restores access.
const {Button:SBtn,Badge:SBadge,Dialog:SDlg}=window.GoodDealerDesignSystem_b5b0b6;
const smoney=n=>Number(n).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
const STATE={active:["success","有效"],grace:["warning","宽限期"],suspended:["danger","已暂停"]};

function Row({k,children}){return <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",padding:"11px 0",borderBottom:"1px solid var(--gd-line)",fontSize:13}}>
  <span style={{color:"var(--text-3)",fontSize:12}}>{k}</span><span style={{textAlign:"right"}}>{children}</span></div>;}

function Subscription({onChangePlan}){
  const D=window.AW_DATA;const a=D.account;
  const [state,setState]=React.useState(a.state); // demo: active | grace | suspended
  const [cancel,setCancel]=React.useState(false);
  const [canceled,setCanceled]=React.useState(false);

  return <div style={{display:"flex",flexDirection:"column",gap:18}}>
    <div style={{display:"flex",alignItems:"flex-start",gap:12,flexWrap:"wrap"}}>
      <div style={{flex:1,minWidth:0}}><h1 className="aw-h1">订阅与账单</h1><p className="aw-sub" style={{margin:0}}>管理你的 License、支付方式与发票。</p></div>
      {/* demo state preview */}
      <div style={{display:"inline-flex",gap:1,padding:2,borderRadius:7,border:"1px solid var(--gd-line)",background:"var(--gd-ink)"}}>
        {["active","grace","suspended"].map(s=><button key={s} onClick={()=>setState(s)} style={{padding:"4px 9px",fontSize:11,borderRadius:5,border:"none",cursor:"pointer",fontFamily:"var(--font-sans)",
          background:state===s?"var(--gd-panel-raised)":"transparent",color:state===s?"var(--text-1)":"var(--text-3)"}}>{STATE[s][1]}</button>)}
      </div>
    </div>

    {/* renew-recovery banner for grace / suspended */}
    {state==="grace"&&<div style={{border:"1px solid var(--gd-warning)",background:"var(--gd-warning-tint)",borderRadius:8,padding:"12px 14px",display:"flex",alignItems:"center",gap:12}}>
      <div style={{flex:1,fontSize:13}}><b style={{color:"var(--gd-warning)"}}>续费失败 · 7 天宽限期</b><div style={{fontSize:12,color:"var(--text-2)",marginTop:2}}>宽限期内（至 2027-01-07）付款成功即恢复；宽限结束仍失败将暂停，客户端锁定。</div></div>
      <SBtn variant="primary">立即续费</SBtn>
    </div>}
    {state==="suspended"&&<div style={{border:"1px solid var(--gd-danger)",background:"var(--gd-danger-tint)",borderRadius:8,padding:"12px 14px",display:"flex",alignItems:"center",gap:12}}>
      <div style={{flex:1,fontSize:13}}><b style={{color:"var(--gd-danger)"}}>订阅已暂停 · 客户端已锁定</b><div style={{fontSize:12,color:"var(--text-2)",marginTop:2}}>本地数据不删除；续费成功后恢复访问。此账户页仍可导出数据、删除账号与管理设备。</div></div>
      <SBtn variant="primary">立即续费恢复</SBtn>
    </div>}

    {/* current plan */}
    <div className="aw-card">
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:6}}>
        <span style={{fontSize:15,fontWeight:600}}>年付 License</span>
        <SBadge tone={STATE[state][0]} mono={false}>{STATE[state][1]}</SBadge>
        {canceled&&<SBadge tone="neutral" mono={false}>已取消 · 周期末到期</SBadge>}
      </div>
      <Row k="价格">${smoney(a.price)} / 年</Row>
      <Row k={state==="suspended"?"已于":"下次扣费"}><span style={{fontFamily:"var(--font-mono)"}}>{canceled?"— · 到 "+a.renews+" 到期":a.renews}</span></Row>
      <Row k="订阅开始"><span style={{fontFamily:"var(--font-mono)",color:"var(--text-2)"}}>{a.since}</span></Row>
      <Row k="设备名额">2 台执行设备（1 Active · 1 Standby）</Row>
      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:14}}>
        <SBtn onClick={onChangePlan}>升级 / 更换计划</SBtn>
        <SBtn variant="secondary" disabled={canceled}>降级（下周期生效）</SBtn>
        {canceled?<SBtn variant="ghost" onClick={()=>setCanceled(false)}>恢复订阅</SBtn>:<SBtn variant="ghost" onClick={()=>setCancel(true)}>取消订阅</SBtn>}
      </div>
    </div>

    {/* payment method */}
    <div className="aw-card">
      <div style={{fontSize:11,letterSpacing:"0.08em",textTransform:"uppercase",color:"var(--text-3)",marginBottom:12}}>支付方式</div>
      <div style={{display:"flex",alignItems:"center",gap:12}}>
        <span style={{width:34,height:22,borderRadius:4,border:"1px solid var(--gd-line-strong)",display:"inline-flex",alignItems:"center",justifyContent:"center",fontFamily:"var(--font-mono)",fontSize:9,color:"var(--text-2)"}}>VISA</span>
        <span style={{fontSize:13,fontFamily:"var(--font-mono)"}}>···· 6411</span>
        <span style={{marginLeft:"auto",fontSize:11,color:"var(--text-3)"}}>由 Paddle 保管 · 本页不存卡号</span>
        <SBtn size="sm" variant="secondary">在 Paddle 更新</SBtn>
      </div>
    </div>

    {/* invoices */}
    <div className="aw-card" style={{padding:0}}>
      <div style={{fontSize:11,letterSpacing:"0.08em",textTransform:"uppercase",color:"var(--text-3)",padding:"16px 20px 4px"}}>发票历史</div>
      {D.invoices.map((iv,i)=><div key={iv.id} style={{display:"flex",alignItems:"center",gap:12,padding:"12px 20px",borderTop:i===0?"none":"1px solid var(--gd-line)"}}>
        <span style={{width:110,flex:"none",fontFamily:"var(--font-mono)",fontSize:12}}>{iv.date}</span>
        <span style={{flex:1,minWidth:0,fontSize:13,color:"var(--text-2)"}}>{iv.desc}</span>
        <SBadge tone="success" mono={false}>已支付</SBadge>
        <span style={{width:80,flex:"none",textAlign:"right",fontFamily:"var(--font-mono)",fontSize:13}}>${smoney(iv.amount)}</span>
        <SBtn size="sm" variant="ghost">下载</SBtn>
      </div>)}
    </div>

    <SDlg open={cancel} onClose={()=>setCancel(false)} title="取消订阅" width={460}
      footer={<><SBtn onClick={()=>setCancel(false)}>保留订阅</SBtn><SBtn variant="danger" onClick={()=>{setCancel(false);setCanceled(true);}}>确认取消</SBtn></>}>
      <div style={{fontSize:13,lineHeight:1.6,color:"var(--text-2)"}}>取消将在<b style={{color:"var(--text-1)"}}>当前已付周期结束（{a.renews}）</b>生效，届时不再续费；<b style={{color:"var(--text-1)"}}>不自动退款</b>。在此之前访问不受影响，可随时恢复订阅。本地数据不会删除。</div>
    </SDlg>
  </div>;
}
window.AWSubscription=Subscription;
