// Pricing — the term plans with the price as a large GOLD tabular numeral, tying pricing to the brand's core
// "valuation number" identity. Restrained mono tags (no colored fills), stamp CTAs, certificate hairline
// framing; the recommended plan carries a 骑缝 ticket-perforation. License = term, not a feature tier.
const {}={};
function Pricing(){
  const D=window.MK_DATA;
  return <div>
    <div className="mk-sec">
      <div style={{maxWidth:640,display:"flex",flexDirection:"column",gap:14,marginBottom:40}}>
        <div className="mk-eyebrow2"><b>定价</b><span className="mk-rule"></span><span>月付 · 年付 · 买断</span></div>
        <h2 className="mk-h2">选一个时长，功能完全一样</h2>
        <p className="mk-lead">{D.planNote}</p>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(240px,1fr))",gap:18,maxWidth:920}}>
        {D.plans.map(p=><div key={p.key} style={{position:"relative",border:"1px solid "+(p.gold?"var(--gd-gold)":"var(--gd-line)"),borderRadius:9,padding:"26px 22px 22px",display:"flex",flexDirection:"column",gap:16,background:"var(--gd-panel)"}}>
          {p.popular&&<div className="mk-seam" style={{position:"absolute",top:0,left:14,right:14,width:"auto"}}></div>}
          <div style={{display:"flex",alignItems:"center",gap:10,minHeight:20}}>
            <span style={{fontFamily:"var(--font-mono)",fontSize:12,letterSpacing:"0.04em",color:"var(--text-2)"}}>{p.name}</span>
            {p.popular&&<span className="mk-tag">最受欢迎</span>}
            {p.gold&&<span className="mk-tag mk-tag--gold">一次买断</span>}
          </div>
          <div>
            <div style={{display:"flex",alignItems:"baseline",gap:5}}>
              <span style={{fontSize:22,color:p.gold?"var(--gd-gold)":"var(--text-2)",fontFamily:"var(--font-mono)"}}>$</span>
              <span style={{fontSize:44,fontWeight:600,fontFamily:"var(--font-mono)",fontVariantNumeric:"tabular-nums",letterSpacing:"-0.02em",color:p.gold?"var(--gd-gold)":"var(--text-1)",lineHeight:1}}>{p.price}</span>
              <span style={{fontSize:13,color:"var(--text-3)"}}>{p.unit}</span>
            </div>
            <div style={{fontSize:11.5,color:"var(--text-3)",marginTop:7,minHeight:15}}>{p.sub||" "}</div>
          </div>
          <div style={{borderTop:"1px solid var(--gd-line)",paddingTop:16,display:"flex",flexDirection:"column",gap:11}}>
            <a href="../account-web/index.html" className="mk-stamp" style={{height:42,justifyContent:"center"}}><i></i>{p.cta}</a>
            <div style={{fontSize:11,color:"var(--text-3)",fontFamily:"var(--font-mono)",textAlign:"center"}}>{p.period}</div>
          </div>
        </div>)}
      </div>
      <div style={{display:"flex",gap:"10px 24px",flexWrap:"wrap",marginTop:30,fontSize:12.5,color:"var(--text-2)"}}>
        {D.planFeatures.map((f,i)=><span key={i} style={{display:"flex",alignItems:"center",gap:8}}><span style={{width:5,height:5,background:"var(--gd-gold)",flex:"none"}}></span>{f}</span>)}
      </div>
    </div>
    <div className="mk-sec" style={{paddingTop:0,paddingBottom:0}}><div className="mk-seam"></div></div>
  </div>;
}
window.MKPricing=Pricing;
