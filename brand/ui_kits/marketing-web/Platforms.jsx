// Platforms — SEO-critical section: every platform name is a long-tail keyword anchor (e.g. "Afternic 批量上架",
// "Spaceship 域名管理"). Three groups: registrars (gold), sales platforms (gold), DNS (blue). v1 items show a
// gold marker; later targets show a subtle future-target tag. Layout: eyebrow + h2 + three category rows.
const {}={};
function Platforms(){
  const P=window.MK_DATA.platforms;const U=window.MK_DATA.ui.platforms;
  const cats=[P.registrars,P.sales,P.dns];
  return <div>
    <div className="mk-sec">
      <div style={{maxWidth:660,display:"flex",flexDirection:"column",gap:14,marginBottom:36}}>
        <div className="mk-eyebrow2"><b>{U.tag}</b><span className="mk-rule"></span><span>{U.tagSub}</span></div>
        <h2 className="mk-h2">{U.h2}</h2>
        <p className="mk-lead">{U.lead}</p>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:32}}>
        {cats.map(cat=><div key={cat.title}>
          <div style={{display:"flex",alignItems:"baseline",gap:12,marginBottom:6}}>
            <span style={{fontSize:16,fontWeight:600,color:"var(--text-1)"}}>{cat.title}</span>
            <span style={{fontSize:12,color:"var(--text-3)"}}>{cat.sub}</span>
          </div>
          <div style={{borderTop:"1px solid var(--gd-line-strong)",paddingTop:16,display:"flex",flexWrap:"wrap",gap:10}}>
            {cat.items.map(p=><span key={p.name} style={{
              display:"inline-flex",alignItems:"center",gap:7,
              fontSize:13,fontFamily:"var(--font-mono)",
              padding:"6px 14px",borderRadius:6,
              border:"1px solid "+(p.releaseTarget?"var(--gd-gold)":"var(--gd-line)"),
              color:p.releaseTarget?"var(--text-1)":"var(--text-3)",
              background:"transparent",
            }}>
              {p.releaseTarget&&<span style={{width:5,height:5,background:"var(--gd-gold)",flex:"none"}}></span>}
              {p.name}
              {!p.releaseTarget&&<span style={{fontSize:10,color:"var(--text-3)",marginLeft:2}}>{U.soon}</span>}
            </span>)}
          </div>
        </div>)}
      </div>
      <div style={{marginTop:28,fontSize:12,color:"var(--text-3)",fontFamily:"var(--font-mono)"}}>
        {U.footerNote}
      </div>
    </div>
    <div className="mk-sec" style={{paddingTop:0,paddingBottom:0}}><div className="mk-seam"></div></div>
  </div>;
}
window.MKPlatforms=Platforms;
