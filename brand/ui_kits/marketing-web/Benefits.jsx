// 好处盘点 / Benefits — outcomes (what you GET), each a before→after transform with a gold metric. A 2×2 tile
// grid — deliberately different from the Pillars ledger (capabilities) that follows.
const {}={};
function Benefits(){
  const D=window.MK_DATA.benefits;const U=window.MK_DATA.ui.benefits;
  return <div>
    <div className="mk-sec">
      <div style={{maxWidth:640,display:"flex",flexDirection:"column",gap:14,marginBottom:38}}>
        <div className="mk-eyebrow2"><b>{U.tag}</b><span className="mk-rule"></span><span>{U.tagSub}</span></div>
        <h2 className="mk-h2">{U.h2}</h2>
        <p className="mk-lead">{U.lead}</p>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(248px,1fr))",gap:"1px",background:"var(--gd-line)",border:"1px solid var(--gd-line)",borderRadius:10,overflow:"hidden"}}>
        {D.map((b,i)=><div key={i} style={{background:"var(--gd-panel)",padding:"22px 24px",display:"flex",flexDirection:"column",gap:12}}>
          <span style={{fontFamily:"var(--font-mono)",fontSize:20,color:"var(--gd-gold)",letterSpacing:"-0.01em"}}>{b.metric}</span>
          <div style={{fontSize:16,fontWeight:600,color:"var(--text-1)",letterSpacing:"-0.01em"}}>{b.title}</div>
          <div style={{display:"flex",flexDirection:"column",gap:7,marginTop:2}}>
            <div style={{fontSize:12.5,color:"var(--text-3)",display:"flex",gap:8}}><span style={{color:"var(--gd-text-faint)",flex:"none"}}>{U.from}</span>{b.from}</div>
            <div style={{fontSize:12.5,color:"var(--text-2)",display:"flex",gap:8,alignItems:"baseline"}}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--gd-gold)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{flex:"none",transform:"translateY(1px)"}}><path d="M12 5v14M6 13l6 6 6-6"/></svg>
              <span><span style={{color:"var(--gd-gold)"}}>{U.to}</span> {b.to}</span>
            </div>
          </div>
        </div>)}
      </div>
    </div>
    <div className="mk-sec" style={{paddingTop:0,paddingBottom:0}}><div className="mk-seam"></div></div>
  </div>;
}
window.MKBenefits=Benefits;
