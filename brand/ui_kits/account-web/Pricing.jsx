// 定价 / Pricing — license is sold by TERM (月/年/终身), same full product in each. Brand-expressive
// (this is a marketing surface): gold for the value/price moment, coin seal on the hero.
const {Money:PMoney,Button:PBtn}=window.GoodDealerDesignSystem_b5b0b6;
const pfmt=n=>Number.isInteger(n)?n.toLocaleString():n.toFixed(2); // $98 / $498 clean, $9.80 with cents

function PlanCard({p,onChoose}){
  const accent=p.gold?"var(--gd-gold)":p.popular?"var(--gd-blue)":"var(--gd-line-strong)";
  return <div style={{flex:"1 1 260px",minWidth:0,position:"relative",border:`1px solid ${p.popular||p.gold?accent:"var(--gd-line)"}`,borderRadius:12,background:"var(--gd-panel)",padding:"22px 22px 24px",display:"flex",flexDirection:"column",gap:14}}>
    {p.popular&&<span style={{position:"absolute",top:-10,left:22,fontSize:10,fontWeight:600,letterSpacing:"0.06em",background:"var(--gd-blue)",color:"#fff",borderRadius:5,padding:"3px 8px"}}>最受欢迎</span>}
    {p.gold&&<span style={{position:"absolute",top:-10,left:22,fontSize:10,fontWeight:600,letterSpacing:"0.06em",background:"linear-gradient(105deg,#F2D488,#D4A437)",color:"#0A0B0F",borderRadius:5,padding:"3px 8px"}}>一次买断</span>}
    <div style={{fontSize:15,fontWeight:600}}>{p.name}</div>
    <div style={{display:"flex",alignItems:"baseline",gap:8}}>
      <span style={{fontFamily:"var(--font-mono)",fontVariantNumeric:"tabular-nums",fontSize:34,fontWeight:600,color:p.gold?"var(--gd-gold)":"var(--text-1)"}}>${pfmt(p.price)}</span>
      <span style={{fontSize:13,color:"var(--text-3)"}}>{p.unit}</span>
    </div>
    <div style={{minHeight:16,fontSize:12,color:p.gold?"var(--gd-gold)":"var(--gd-success)"}}>{p.sub||" "}</div>
    <PBtn variant={p.gold?"gold":p.popular?"primary":"secondary"} block onClick={()=>onChoose(p)}>{p.cta}</PBtn>
    <div style={{fontSize:11,color:"var(--text-3)",textAlign:"center"}}>{p.period}</div>
  </div>;
}

function Pricing({onChoose,onManage}){
  const D=window.AW_DATA;
  return <div style={{display:"flex",flexDirection:"column",gap:34}}>
    {/* hero */}
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",textAlign:"center",gap:14,paddingTop:8}}>
      <img src="../../assets/logo/mark.svg" width="72" height="72" alt=""/>
      <h1 style={{fontSize:30,fontWeight:600,letterSpacing:"-0.02em",margin:0,maxWidth:620}}>一个界面，掌控分散在多个注册商与平台的域名资产</h1>
      <p style={{fontSize:15,color:"var(--text-2)",margin:0,maxWidth:560,lineHeight:1.5}}>本地执行 · 云端同步。注册信息、DNS、价格、销售状态与所有权验证统一管理；平台凭据永不上云。</p>
      <div style={{display:"flex",gap:18,flexWrap:"wrap",justifyContent:"center",fontSize:12,color:"var(--text-3)",marginTop:2}}>
        <span>14 天全额退款</span><span>·</span><span>≤ 2 台执行设备</span><span>·</span><span>macOS · Windows</span>
      </div>
    </div>

    {/* plans */}
    <div style={{display:"flex",gap:18,flexWrap:"wrap",alignItems:"stretch"}}>
      {D.plans.map(p=><PlanCard key={p.key} p={p} onChoose={onChoose}/>)}
    </div>

    {/* shared features */}
    <div className="aw-card">
      <div style={{fontSize:11,letterSpacing:"0.08em",textTransform:"uppercase",color:"var(--text-3)",marginBottom:14}}>每种计划均包含全部功能（License 只区分授权期限，不分功能档）</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:"10px 24px"}}>
        {D.features.map(f=><div key={f} style={{display:"flex",alignItems:"flex-start",gap:9,fontSize:13,color:"var(--text-2)"}}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--gd-success)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{flex:"none",marginTop:1}}><path d="M20 6 9 17l-5-5"/></svg>{f}
        </div>)}
        <div style={{display:"flex",alignItems:"flex-start",gap:9,fontSize:13,color:"var(--gd-gold)"}}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--gd-gold)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{flex:"none",marginTop:1}}><path d="M20 6 9 17l-5-5"/></svg>终身：{D.lifetimeExtra}
        </div>
      </div>
    </div>

    <div style={{textAlign:"center",fontSize:12,color:"var(--text-3)"}}>已有账户？<button onClick={onManage} style={{background:"none",border:"none",color:"var(--text-link)",cursor:"pointer",font:"inherit"}}>管理订阅</button></div>
  </div>;
}
window.AWPricing=Pricing;
