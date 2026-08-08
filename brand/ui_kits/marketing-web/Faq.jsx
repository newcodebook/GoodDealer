// FAQ — honest answers that hold the first-version line: no background polling / unattended auto-delist, no
// local-only mode, credentials never uploaded, 2 devices / single Active. Expandable list; first item open.
const {}={};
function Faq(){
  const items=window.MK_DATA.faq;
  const [open,setOpen]=React.useState(0);
  return <div><div className="mk-sec" style={{maxWidth:820}}>
    <div style={{marginBottom:32}}>
      <div className="mk-eyebrow2"><b>常见问题</b><span className="mk-rule"></span><span>边界与承诺</span></div>
      <h2 className="mk-h2" style={{marginTop:10}}>把边界说清楚</h2>
    </div>
    <div style={{border:"1px solid var(--gd-line)",borderRadius:10,overflow:"hidden"}}>
      {items.map((it,i)=>{const isOpen=open===i;
        return <div key={i} style={{borderTop:i?"1px solid var(--gd-line)":"none"}}>
          <button onClick={()=>setOpen(isOpen?-1:i)} style={{width:"100%",display:"flex",alignItems:"center",gap:12,padding:"16px 20px",background:isOpen?"var(--gd-panel-raised)":"var(--gd-panel)",border:"none",cursor:"pointer",textAlign:"left",font:"inherit"}}>
            <span style={{flex:1,fontSize:14.5,fontWeight:500,color:"var(--text-1)"}}>{it.q}</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{flex:"none",transform:isOpen?"rotate(180deg)":"none",transition:"transform 140ms"}}><path d="m6 9 6 6 6-6"/></svg>
          </button>
          {isOpen&&<div style={{padding:"0 20px 18px",fontSize:13.5,color:"var(--text-2)",lineHeight:1.7,maxWidth:680}}>{it.a}</div>}
        </div>;})}
    </div>
  </div>
    <div className="mk-sec" style={{paddingTop:0,paddingBottom:0}}><div className="mk-seam"></div></div>
  </div>;
}
window.MKFaq=Faq;
