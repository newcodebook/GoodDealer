// Hero — editorial, asymmetric, private-bank instrument. Left column: a registration eyebrow (mono, ruled),
// a left-aligned display statement, positioning, and a refined CTA row (primary = minted seal-square, NOT a
// gold fill). Right column: the engraved Seal medallion (security-printing craft, not a soft glow). Closes on
// a 骑缝 seam. The credential-local promise is stated once here; the Security section explains it.
const {}={};
function Hero(){
  const H=window.MK_DATA.hero;const U=window.MK_DATA.ui.hero;
  return <div style={{position:"relative"}}>
    <div className="mk-sec" style={{display:"flex",alignItems:"center",gap:56,flexWrap:"wrap",paddingTop:84,paddingBottom:64}}>
      {/* left — editorial content */}
      <div className="mk-rise" style={{flex:"1 1 460px",minWidth:300,display:"flex",flexDirection:"column",gap:22}}>
        <div style={{display:"flex",alignItems:"center",gap:12,fontFamily:"var(--font-mono)",fontSize:11,letterSpacing:"0.14em",textTransform:"uppercase"}}>
          <span style={{color:"var(--gd-gold)"}}>GoodDealer</span>
          <span className="mk-rule"></span>
          <span style={{color:"var(--text-3)"}}>{U.eyebrowSub}</span>
        </div>
        <h1 style={{fontSize:"clamp(30px,4.2vw,46px)",fontWeight:600,letterSpacing:"-0.025em",lineHeight:1.12,margin:0,color:"var(--text-1)",maxWidth:560}}>
          {U.titleBefore.split("\n").map((ln,i,a)=><React.Fragment key={i}>{ln}{i<a.length-1&&<br/>}</React.Fragment>)}<span style={{color:"var(--gd-gold)"}}>{U.titleGold}</span>
        </h1>
        <p style={{fontSize:15.5,color:"var(--text-2)",lineHeight:1.65,margin:0,maxWidth:500}}>{H.sub}</p>
        <div style={{display:"flex",gap:14,flexWrap:"wrap",alignItems:"center",marginTop:2}}>
          <a href="#download" className="mk-stamp"><i></i>{H.ctaPrimary}</a>
          <a href="#pricing" className="mk-quiet">{H.ctaSecondary}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a>
        </div>
        <div style={{display:"flex",alignItems:"baseline",gap:9,fontSize:12.5,color:"var(--text-3)",marginTop:8,paddingTop:16,borderTop:"1px solid var(--gd-line)",maxWidth:500,lineHeight:1.6}}>
          <span style={{width:6,height:6,background:"var(--gd-gold)",flex:"none",transform:"translateY(1px)"}}></span>{H.trust}
        </div>
      </div>
      {/* right — engraved seal medallion */}
      <div className="mk-seal-anim" style={{flex:"0 0 auto",margin:"0 auto",animationDelay:"0.12s"}}>
        <window.MKSeal size={272}/>
      </div>
    </div>
    <div className="mk-sec" style={{paddingTop:0,paddingBottom:0}}><div className="mk-seam"></div></div>
  </div>;
}
window.MKHero=Hero;
