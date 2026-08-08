// 核心流程 / Workflow — the core loop (筛选 → 预览改动 → 确认执行 → 同步/撤回) as a horizontal stepper that
// auto-advances a highlight (dynamic walkthrough). A gold progress rail fills to the active step; steps are
// clickable. Reduced-motion / hover pauses the auto-cycle. Layout differs from every other section.
const {}={};
function Workflow(){
  const steps=window.MK_DATA.workflow;
  const [active,setActive]=React.useState(0);
  const [hover,setHover]=React.useState(false);
  const reduce=typeof window.matchMedia==="function"&&window.matchMedia("(prefers-reduced-motion:reduce)").matches;
  React.useEffect(()=>{
    if(reduce||hover) return;
    const id=setInterval(()=>setActive(a=>(a+1)%steps.length),2400);
    return ()=>clearInterval(id);
  },[reduce,hover,steps.length]);
  return <div>
    <div className="mk-sec" onMouseEnter={()=>setHover(true)} onMouseLeave={()=>setHover(false)}>
      <div style={{maxWidth:640,display:"flex",flexDirection:"column",gap:14,marginBottom:34}}>
        <div className="mk-eyebrow2"><b>核心流程</b><span className="mk-rule"></span><span>一次批量操作的四步</span></div>
        <h2 className="mk-h2">筛选 · 预览 · 确认 · 同步</h2>
        <p className="mk-lead">每一次批量操作都走同一条路径——先看清即将发生的变化，再由你确认执行。</p>
      </div>
      {/* progress rail */}
      <div style={{height:2,background:"var(--gd-line)",borderRadius:2,overflow:"hidden",marginBottom:26}}>
        <div style={{height:"100%",width:((active+1)/steps.length*100)+"%",background:"var(--gd-gold)",borderRadius:2,transition:"width .6s cubic-bezier(.16,.84,.44,1)"}}></div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(210px,1fr))",gap:20}}>
        {steps.map((s,i)=>{const on=i===active;
          return <button key={s.k} onClick={()=>setActive(i)} style={{textAlign:"left",background:"none",border:"none",cursor:"pointer",padding:0,font:"inherit",opacity:on?1:.45,transition:"opacity .4s ease"}}>
            <div style={{display:"flex",alignItems:"center",gap:9,marginBottom:9}}>
              <span style={{fontFamily:"var(--font-mono)",fontSize:19,color:on?"var(--gd-gold)":"var(--text-3)",transition:"color .4s ease"}}>{s.k}</span>
              <span style={{flex:1,height:1,background:on?"var(--gd-gold)":"var(--gd-line)",transition:"background .4s ease"}}></span>
            </div>
            <div style={{fontSize:15.5,fontWeight:600,color:"var(--text-1)"}}>{s.title}</div>
            <p style={{fontSize:12.5,color:"var(--text-2)",lineHeight:1.6,margin:"7px 0 0"}}>{s.desc}</p>
          </button>;})}
      </div>
    </div>
    <div className="mk-sec" style={{paddingTop:0,paddingBottom:0}}><div className="mk-seam"></div></div>
  </div>;
}
window.MKWorkflow=Workflow;
