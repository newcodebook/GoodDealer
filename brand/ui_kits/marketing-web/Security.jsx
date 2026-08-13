// Security — the differentiator, where "密码不上云" is EXPLAINED, not sloganized. A small diagram shows the
// split: the device (gold) holds passwords/login info and never syncs them; the Cloud (blue) holds only
// business data (no passwords) for the second device to view. Then the four model points. Gold=asset/local,
// blue=system/cloud, per the brand's data-viz semantics.
const {}={};
function Node({title,tone,sub,items,seal}){
  const c=tone==="gold"?"var(--gd-gold)":"var(--gd-blue)";
  return <div style={{flex:"1 1 240px",border:"1px solid "+c,borderRadius:10,padding:"16px 18px",background:"var(--gd-panel)"}}>
    <div style={{display:"flex",alignItems:"center",gap:8}}>
      <span style={{width:8,height:8,borderRadius:"50%",background:tone==="gold"?c:"transparent",border:tone==="gold"?"none":"1.5px solid "+c}}></span>
      <span style={{fontSize:14,fontWeight:600,color:"var(--text-1)"}}>{title}</span>
    </div>
    <div style={{fontSize:11,color:"var(--text-3)",marginTop:3}}>{sub}</div>
    <div style={{marginTop:12,display:"flex",flexDirection:"column",gap:6}}>
      {items.map((it,i)=><div key={i} style={{display:"flex",alignItems:"center",gap:8,fontSize:12,fontFamily:"var(--font-mono)",color:"var(--text-2)"}}>
        <span style={{fontSize:11,color:c}}>{seal?"◆":"○"}</span>{it}</div>)}
    </div>
    {seal&&<div style={{marginTop:12,fontSize:11,color:"var(--gd-gold)",display:"flex",alignItems:"center",gap:6}}>
      <img src={window.MK_DATA.assetBase+"assets/icons/keyhole.svg"} width="12" height="12" alt=""/>{window.MK_DATA.ui.security.neverLeaves}</div>}
  </div>;
}
function Security(){
  const S=window.MK_DATA.security;const U=window.MK_DATA.ui.security;const UH=window.MK_DATA.ui.security;
  return <div><div className="mk-sec">
    <div style={{maxWidth:660,marginBottom:32}}>
      <div className="mk-eyebrow2"><b>{U.tag}</b><span className="mk-rule"></span><span>{U.tagSub}</span></div>
      <h2 className="mk-h2" style={{marginTop:10}}>{S.title}</h2>
      <p className="mk-lead" style={{marginTop:12}}>{S.sub}</p>
    </div>

    {/* local vs cloud diagram */}
    <div style={{display:"flex",alignItems:"stretch",gap:14,flexWrap:"wrap",marginBottom:36}}>
      <Node title={UH.localNode.title} tone="gold" sub={UH.localNode.sub} seal items={UH.localNode.items}/>
      <div style={{flex:"0 0 auto",alignSelf:"center",display:"flex",flexDirection:"column",alignItems:"center",gap:4,minWidth:120,padding:"0 4px"}}>
        <span style={{fontSize:11,color:"var(--text-3)"}}>{UH.arrow.label}</span>
        <svg width="88" height="16" viewBox="0 0 88 16" fill="none"><path d="M2 8h74M70 3l7 5-7 5" stroke="var(--gd-blue)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
        <span style={{fontSize:11,color:"var(--text-3)",fontFamily:"var(--font-mono)"}}>{UH.arrow.sub}</span>
      </div>
      <Node title={UH.cloudNode.title} tone="blue" sub={UH.cloudNode.sub} items={UH.cloudNode.items}/>
    </div>

    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:16}}>
      {S.points.map((p,i)=>{const c=p.tone==="gold"?"var(--gd-gold)":"var(--gd-blue)";
        return <div key={i} className="mk-card" style={{padding:"18px 20px"}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <span style={{width:7,height:7,borderRadius:"50%",background:p.tone==="gold"?c:"transparent",border:p.tone==="gold"?"none":"1.5px solid "+c}}></span>
            <span style={{fontSize:14.5,fontWeight:600,color:"var(--text-1)"}}>{p.t}</span>
          </div>
          <p style={{fontSize:13,color:"var(--text-2)",lineHeight:1.65,margin:"9px 0 0"}}>{p.d}</p>
        </div>;})}
    </div>
  </div>
    <div className="mk-sec" style={{paddingTop:0,paddingBottom:0}}><div className="mk-seam"></div></div>
  </div>;
}
window.MKSecurity=Security;
