// Download — the closing band, sealed like the foot of a certificate: the engraved Seal medallion (not a soft
// glow), a quiet statement, stamp/quiet CTAs. Honest note that login + device binding + auth checks precede
// the main interface (cloud sync is baseline).
const {}={};
function Download(){
  const D=window.MK_DATA.download;const U=window.MK_DATA.ui.download;
  return <div className="mk-sec" style={{display:"flex",flexDirection:"column",alignItems:"center",textAlign:"center",gap:20,paddingTop:72,paddingBottom:80}}>
    <window.MKSeal size={132}/>
    <div className="mk-eyebrow2" style={{justifyContent:"center"}}><b>{U.tag}</b><span className="mk-rule"></span><span>{U.tagSub}</span></div>
    <h2 style={{fontSize:"clamp(26px,3.4vw,34px)",fontWeight:600,letterSpacing:"-0.02em",margin:0,color:"var(--text-1)"}}>{D.title}</h2>
    <p style={{fontSize:15,color:"var(--text-2)",lineHeight:1.6,margin:0,maxWidth:520}}>{D.sub}</p>
    <div style={{display:"flex",gap:14,flexWrap:"wrap",justifyContent:"center",marginTop:4}}>
      {D.platforms.map(([k,label],i)=>i===0
        ?<a key={k} href="#" className="mk-stamp"><i></i>{label}</a>
        :<a key={k} href="#" className="mk-quiet">{label}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a>)}
    </div>
    <div style={{fontSize:11.5,color:"var(--text-3)",maxWidth:500,lineHeight:1.6,marginTop:6}}>{D.note}</div>
  </div>;
}
window.MKDownload=Download;
