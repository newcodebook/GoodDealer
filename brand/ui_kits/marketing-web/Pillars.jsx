// Pillars — the four value pillars (PRD §3) as a LEDGER, not a card grid: hairline-ruled rows, a gold mono
// index per row, title + body, and the two concrete capabilities set right like a statement's detail column.
// Kraken density + certificate ruling. Registration eyebrow + closing 骑缝 seam.
const {}={};
function Pillars(){
  const D=window.MK_DATA;
  return <div>
    <div className="mk-sec" style={{paddingBottom:40}}>
      <div style={{maxWidth:620,display:"flex",flexDirection:"column",gap:14}}>
        <div className="mk-eyebrow2"><b>能力</b><span className="mk-rule"></span><span>四项核心场景</span></div>
        <h2 className="mk-h2">从资产库到批量操作</h2>
        <p className="mk-lead">注册商、DNS、销售平台各管各的；GoodDealer 把它们统一成一张可以批量操作、先看后改的域名总表。</p>
      </div>
      <div style={{marginTop:40,borderTop:"1px solid var(--gd-line-strong)"}}>
        {D.pillars.map((p,i)=><div key={p.k} style={{display:"flex",gap:28,padding:"26px 0",borderBottom:"1px solid var(--gd-line)",flexWrap:"wrap"}}>
          <div style={{flex:"0 0 auto",width:52,fontFamily:"var(--font-mono)",fontSize:22,color:"var(--gd-gold)",fontVariantNumeric:"tabular-nums",lineHeight:1}}>{String(i+1).padStart(2,"0")}</div>
          <div style={{flex:"1 1 340px",minWidth:260}}>
            <div style={{fontSize:18,fontWeight:600,color:"var(--text-1)",letterSpacing:"-0.01em"}}>{p.title}</div>
            <p style={{fontSize:13.5,color:"var(--text-2)",lineHeight:1.65,margin:"8px 0 0",maxWidth:460}}>{p.body}</p>
          </div>
          <div style={{flex:"1 1 240px",minWidth:200,display:"flex",flexDirection:"column",gap:9,paddingTop:2}}>
            {p.items.map((it,j)=><div key={j} style={{display:"flex",gap:10,fontSize:12.5,color:"var(--text-2)",lineHeight:1.5}}>
              <span style={{width:5,height:5,background:"var(--gd-gold)",flex:"none",transform:"translateY(6px)"}}></span>{it}</div>)}
          </div>
        </div>)}
      </div>
    </div>
    <div className="mk-sec" style={{paddingTop:0,paddingBottom:0}}><div className="mk-seam"></div></div>
  </div>;
}
window.MKPillars=Pillars;
