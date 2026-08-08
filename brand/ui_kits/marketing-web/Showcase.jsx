// 功能动效 / Feature demos — each window panel LOOPS a demonstration of a real feature (not a static shot):
// 统一归集 / 批量上架 / 所有权验证 / 价格同步. Motion carries the meaning. Honesty: listing shows a user
// 确认执行 beat (not unattended); verify polling & sync propagation are automatic. Alternating image/text rows.
const {}={};
function Win({title,children}){
  return <div className="mk-win">
    <div className="mk-win-bar"><span className="mk-win-dots"><span></span><span></span><span></span></span><span className="mk-win-title">{title}</span></div>
    <div className="mk-win-body">{children}</div>
  </div>;
}
const check=<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--gd-gold)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>;

// 1 · 统一归集 — sources feed domains into a central ledger
// 1 · 统一归集 — JS-driven BATCH import. Domain assets come ONLY from REGISTRARS (Spaceship / Namecheap /
// Dynadot / 阿里云). Connecting a registrar pulls a WHOLE BATCH (a random-sized group) of domains: a visible
// batch PACKET (registrar · count · sample domains) flies as ONE unit along the line to the library, then its
// N rows insert at the BOTTOM together and the table steps up N rows. Rhythmic, batch by batch — not one-by-one,
// not a marquee. Reduced-motion → static filled table.
function AggregateAnim(){
  const reduce=typeof window.matchMedia==="function"&&window.matchMedia("(prefers-reduced-motion:reduce)").matches;
  const G="var(--gd-gold)",GT="var(--gd-gold-tint)",L="var(--gd-line)",LS="var(--gd-line-strong)",P="var(--gd-panel)",PR="var(--gd-panel-raised)",T1="var(--text-1)",T3="var(--text-3)";
  const mono={fontFamily:"var(--font-mono)"};
  const srcs=[["Spaceship",34],["Namecheap",82],["Dynadot",130],["阿里云",178]];
  const paths=srcs.map(([,y])=>`M116,${y} L226,206`); // straight lines to the BOTTOM entry (match packet flight)
  // each registrar delivers a VARIED-size batch (4 / 2 / 3 / 2) — loops
  const BATCHES=[
    {s:0,reg:"Spaceship",ds:[["example.com","26-11"],["coin.xyz","28-01"],["market.dev","26-10"],["nova.xyz","28-04"]]},
    {s:1,reg:"Namecheap",ds:[["deal.io","27-03"],["flip.io","26-12"]]},
    {s:2,reg:"Dynadot",ds:[["vault.co","26-09"],["hodl.co","27-06"],["get.app","27-02"]]},
    {s:3,reg:"阿里云",ds:[["alpha.io","27-08"],["beta.co","28-02"]]},
  ];
  const BASE=[["nova.xyz","Dynadot","28-04"],["deal.io","Namecheap","27-03"],["vault.co","Dynadot","26-09"],
    ["coin.xyz","Spaceship","28-01"],["market.dev","Spaceship","26-10"],["get.app","阿里云","27-02"]].map(r=>({d:r[0],reg:r[1],exp:r[2]}));
  const RH=30, top=58, VIS=6;
  const [rows,setRows]=React.useState(BASE);
  const [extra,setExtra]=React.useState(null);   // the batch rows animating in
  const [shift,setShift]=React.useState(0);       // translateY offset during the step (px)
  const [trans,setTrans]=React.useState(false);
  const [pkt,setPkt]=React.useState(null);        // flying batch packet
  React.useEffect(()=>{
    if(reduce) return; let alive=true; let idx=0; const timers=new Set();
    const wait=(ms,fn)=>{const t=setTimeout(()=>{timers.delete(t);if(alive)fn();},ms);timers.add(t);};
    function beat(){
      const b=BATCHES[idx%BATCHES.length];
      setPkt({...b,k:idx});                                          // batch packet departs registrar
      wait(1200,()=>{                                                 // arrival at library bottom
        setPkt(null);
        const nr=b.ds.map(d=>({d:d[0],reg:b.reg,exp:d[1]})); const N=nr.length;
        setExtra(nr);                                                 // render VIS+N rows (N below the fold)
        wait(40,()=>{ setTrans(true); setShift(N*RH); });             // step up by N rows (animated)
        wait(720,()=>{ setRows(r=>[...r,...nr].slice(N)); setExtra(null); setTrans(false); setShift(0); }); // commit (seamless)
        idx++; wait(1620,beat);                                       // pause, then next registrar batch
      });
    }
    wait(600,beat);
    return ()=>{alive=false;timers.forEach(clearTimeout);};
  },[reduce]);
  const disp=extra?rows.concat(extra):rows;
  const Cell=(r,i)=><g key={i}>
    <text x="242" y={top+i*RH} fill={T1} fontSize="11.5" style={mono}>{r.d}</text>
    <text x="330" y={top+i*RH} fill={T3} fontSize="10.5" style={mono}>{r.reg}</text>
    <text x="424" y={top+i*RH} fill={T3} fontSize="10.5" textAnchor="end" style={mono}>{r.exp}</text>
    {i<VIS-1&&<line x1="240" y1={top+i*RH+10} x2="422" y2={top+i*RH+10} stroke={L} opacity="0.6"/>}
  </g>;
  return <Win title="统一归集 · 资产库">
    <div style={{padding:"6px 10px 2px"}}>
      <svg viewBox="0 0 440 236" width="100%" style={{display:"block"}} aria-hidden="true">
        <defs><clipPath id="libclip"><rect x="232" y="46" width="198" height="168"/></clipPath></defs>
        {paths.map((p,i)=><path key={i} d={p} stroke={G} strokeWidth="1" opacity={pkt&&pkt.s===i?0.32:0.1} fill="none"/>)}
        {srcs.map(([name,y],i)=><g key={name}>
          <rect x="10" y={y-16} width="104" height="32" rx="6" fill={P} stroke={pkt&&pkt.s===i?G:L}/>
          <circle cx="26" cy={y} r="3.5" fill={G} opacity={pkt&&pkt.s===i?1:0.5}/>
          <text x="38" y={y+4} fill={T3} fontSize="11.5" style={mono}>{name}</text>
        </g>)}
        <text x="10" y="222" fill={T3} fontSize="10" style={mono}>域名注册商</text>
        <rect x="232" y="14" width="198" height="206" rx="8" fill={P} stroke={L}/>
        <text x="242" y="32" fill={T3} fontSize="10.5" style={mono}>域名</text>
        <text x="330" y="32" fill={T3} fontSize="10.5" style={mono}>注册商</text>
        <text x="424" y="32" fill={T3} fontSize="10.5" textAnchor="end" style={mono}>到期</text>
        <line x1="232" y1="44" x2="430" y2="44" stroke={LS}/>
        <g clipPath="url(#libclip)"><g style={{transform:`translateY(${-shift}px)`,transition:trans?"transform .64s cubic-bezier(.16,.84,.44,1)":"none"}}>{disp.map(Cell)}</g></g>
        {/* flying BATCH PACKET — one visible unit carrying a whole registrar's batch (CSS-driven so it plays on mount) */}
        {pkt&&<g key={pkt.k} className="mk-pktfly" style={{"--sx":"116px","--sy":srcs[pkt.s][1]+"px","--ex":"226px","--ey":"206px"}}>
          <rect x="-52" y="-25" width="104" height="50" rx="7" fill={PR} stroke={G}/>
          <rect x="-52" y="-25" width="104" height="50" rx="7" fill={GT}/>
          <text x="-44" y="-11" fill={G} fontSize="10" style={mono}>{pkt.reg} · {pkt.ds.length}</text>
          <line x1="-44" y1="-6" x2="44" y2="-6" stroke={G} opacity="0.4"/>
          {pkt.ds.slice(0,2).map((d,j)=><text key={j} x="-44" y={7+j*11} fill={T1} fontSize="9.5" style={mono}>{d[0]}</text>)}
          {pkt.ds.length>2&&<text x="44" y="18" textAnchor="end" fill={T3} fontSize="9" style={mono}>+{pkt.ds.length-2}</text>}
        </g>}
      </svg>
      <div style={{fontSize:10.5,color:T3,fontFamily:"var(--font-mono)",padding:"6px 4px 2px"}}>连接注册商即批量拉取 · 整批沿线汇入 · 一次插入多行</div>
    </div>
  </Win>;
}

// 2 · 批量上架 — JS-driven with a PREFATORY CONFIRM DIALOG: a "提交批量上架任务" dialog pops up (task summary +
// 确认提交 press) → dismisses → THEN the matrix cells flip — → 在售 ✓ platform by platform. Sales platforms
// (Atom / SellerHub / Afternic). Makes the operation self-explanatory. Reduced-motion → static listed matrix.
function ListAnim(){
  const G="var(--gd-gold)",L="var(--gd-line)",LS="var(--gd-line-strong)",P="var(--gd-panel)",T1="var(--text-1)",T2="var(--text-2)",T3="var(--text-3)",TF="var(--gd-text-faint)";
  const mono={fontFamily:"var(--font-mono)"};
  const doms=["market.com","flip.io","hodl.xyz","get.dev"];
  const plats=["Atom","SellerHub","Afternic"]; const colX=[212,300,384]; const rowY=[70,98,126,154];
  const reduce=typeof window.matchMedia==="function"&&window.matchMedia("(prefers-reduced-motion:reduce)").matches;
  const [phase,setPhase]=React.useState(reduce?"done":"dialog");   // dialog | exec | done
  const [pressed,setPressed]=React.useState(false);
  const [listed,setListed]=React.useState(reduce?12:0);            // # of platform cells listed (0..12)
  React.useEffect(()=>{
    if(reduce) return; let alive=true; const timers=new Set();
    const wait=(ms,fn)=>{const t=setTimeout(()=>{timers.delete(t);if(alive)fn();},ms);timers.add(t);};
    function loop(){
      setPhase("dialog"); setPressed(false); setListed(0);
      wait(1150,()=>setPressed(true));                             // confirm 提交 pressed
      wait(1800,()=>{ setPressed(false); setPhase("exec");         // dialog dismisses → execution starts
        for(let k=1;k<=12;k++) wait(k*150,()=>setListed(k));       // cells flip to 在售 one by one
        wait(12*150+400,()=>setPhase("done"));
        wait(12*150+2200,loop);                                    // hold, then loop
      });
    }
    wait(500,loop);
    return ()=>{alive=false;timers.forEach(clearTimeout);};
  },[reduce]);
  return <Win title="批量上架 · 域名 × 平台">
    <div style={{padding:"6px 10px 2px",position:"relative"}}>
      <svg viewBox="0 0 440 190" width="100%" style={{display:"block"}} aria-hidden="true">
        {plats.map((p,c)=><text key={p} x={colX[c]} y="34" textAnchor="middle" fill={T3} fontSize="10.5" style={mono}>{p}</text>)}
        <text x="16" y="34" fill={T3} fontSize="10.5" style={mono}>域名</text>
        <line x1="12" y1="44" x2="428" y2="44" stroke={LS}/>
        {doms.map((d,r)=><g key={d}>
          <text x="16" y={rowY[r]+4} fill={T1} fontSize="11.5" style={mono}>{d}</text>
          {r<3&&<line x1="12" y1={rowY[r]+16} x2="428" y2={rowY[r]+16} stroke={L} opacity="0.5"/>}
          {plats.map((p,c)=>{const on=(r*3+c)<listed;
            return on
              ? <text key={c} x={colX[c]} y={rowY[r]+4} textAnchor="middle" fill={G} fontSize="10.5" style={mono}>在售 ✓</text>
              : <text key={c} x={colX[c]} y={rowY[r]+4} textAnchor="middle" fill={TF} fontSize="11" style={mono}>—</text>;})}
        </g>)}
        {phase==="done"&&<text x="428" y="184" textAnchor="end" fill={G} fontSize="10.5" style={mono}>已上架 12 项 · 3 平台</text>}
      </svg>
      {/* prefatory confirm dialog */}
      <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(6,7,11,0.62)",borderRadius:9,opacity:phase==="dialog"?1:0,pointerEvents:"none",transition:"opacity .32s ease"}}>
        <div style={{width:242,background:"var(--gd-panel-raised)",border:"1px solid var(--gd-line-strong)",borderRadius:9,padding:"14px 16px",transform:phase==="dialog"?"scale(1)":"scale(.94)",transition:"transform .32s cubic-bezier(.16,.84,.44,1)",boxShadow:"0 22px 50px -20px rgba(0,0,0,.85)"}}>
          <div style={{fontSize:12.5,fontWeight:600,color:T1}}>提交批量上架任务</div>
          <div style={{fontSize:11.5,color:T2,marginTop:8,lineHeight:1.65}}>把选中的 <b style={{color:G,fontFamily:"var(--font-mono)"}}>4</b> 个域名上架到 Atom · SellerHub · Afternic 共 <b style={{color:G,fontFamily:"var(--font-mono)"}}>3</b> 个销售平台。</div>
          <div style={{display:"flex",justifyContent:"flex-end",alignItems:"center",gap:12,marginTop:14}}>
            <span style={{fontSize:11,color:T3}}>取消</span>
            <span style={{display:"inline-flex",alignItems:"center",gap:7,height:27,padding:"0 13px",borderRadius:6,border:"1px solid "+G,color:G,fontSize:12,fontFamily:"var(--font-sans)",background:pressed?"var(--gd-gold-tint)":"transparent",transform:pressed?"scale(.95)":"scale(1)",transition:"all .12s ease"}}><span style={{width:7,height:7,background:G}}></span>确认提交</span>
          </div>
        </div>
      </div>
      <div style={{fontSize:10.5,color:T3,fontFamily:"var(--font-mono)",padding:"4px 4px 2px"}}>提交任务后软件自动跨平台上架 · — 未上架，在售 ✓ 已上架</div>
    </div>
  </Win>;
}

// 3 · 自动执行平台验证 — DISTINCT: emphasises AUTOMATION + BATCH (not the ownership CONCEPT). The software
// AUTOMATICALLY runs each platform's verification for a whole BATCH of domains — TXT + polling + confirm —
// cascading down the list on its own (no manual clicks). A spinner + 自动执行中 marks it automatic. CSS loop.
function VerifyAnim(){
  const G="var(--gd-gold)",L="var(--gd-line)",LS="var(--gd-line-strong)",P="var(--gd-panel)",T1="var(--text-1)",T2="var(--text-2)",T3="var(--text-3)",W="var(--gd-warning)";
  const mono={fontFamily:"var(--font-mono)"};
  const items=[["example.com","Atom"],["deal.io","Afternic"],["vault.co","SellerHub"],["coin.xyz","Atom"]];
  const rowY=[82,110,138,166];
  return <Win title="自动执行平台验证">
    <div style={{padding:"6px 10px 2px"}}>
      <svg viewBox="0 0 440 200" width="100%" style={{display:"block"}} aria-hidden="true">
        {/* operation preface — a pulsing live dot (not a spinner) marks it running automatically, for a batch */}
        <circle className="mk-dotpulse" cx="20" cy="17" r="4" fill={G}/>
        <text x="32" y="22" fill={G} fontSize="11.5" style={mono}>自动执行中</text>
        <text x="108" y="22" fill={T3} fontSize="10.5" style={mono}>· 软件为一批域名自动跑平台验证</text>
        {/* header */}
        <text x="16" y="52" fill={T3} fontSize="10" style={mono}>域名</text>
        <text x="196" y="52" fill={T3} fontSize="10" style={mono}>销售平台</text>
        <text x="358" y="52" fill={T3} fontSize="10" style={mono}>验证</text>
        <line x1="12" y1="60" x2="428" y2="60" stroke={LS}/>
        {items.map(([d,plat],r)=>{const dl=(r*0.55)+"s";
          return <g key={d}>
            <text x="16" y={rowY[r]+4} fill={T1} fontSize="11.5" style={mono}>{d}</text>
            <text x="196" y={rowY[r]+4} fill={T3} fontSize="10.5" style={mono}>{plat}</text>
            {r<3&&<line x1="12" y1={rowY[r]+16} x2="428" y2={rowY[r]+16} stroke={L} opacity="0.5"/>}
            <g className="mk-vwait2" style={{animationDelay:dl}}><circle cx="360" cy={rowY[r]-1} r="3" fill={W}/><text x="370" y={rowY[r]+4} fill={W} fontSize="10.5" style={mono}>待验证</text></g>
            <g className="mk-ving2" style={{animationDelay:dl}}><text x="356" y={rowY[r]+4} fill={T2} fontSize="10" style={mono}>验证中 · 写 TXT</text>{[0,1,2].map(j=><circle key={j} className="mk-dotpulse" cx={422+j*5} cy={rowY[r]-1} r="1.6" fill={T3} style={{animationDelay:(j*0.16)+"s"}}/>)}</g>
            <g className="mk-vok2" style={{animationDelay:dl}}><path d={`M356 ${rowY[r]} l4 4 l8 -9`} stroke={G} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/><text x="372" y={rowY[r]+4} fill={G} fontSize="10.5" style={mono}>已验证</text></g>
          </g>;})}
      </svg>
      <div style={{fontSize:10.5,color:T3,fontFamily:"var(--font-mono)",padding:"4px 4px 2px"}}>软件自动写入验证记录、等待生效、确认通过 · 不用逐个手动操作</div>
    </div>
  </Win>;
}

// 4 · 价格同步 — DISTINCT: hub-and-spoke fan-OUT (opposite of aggregate's fan-in). Central BIN price changes,
// then a pulse travels OUT along each spoke to the sales platforms + 2nd device, which light SYNCED. CSS loop.
function SyncAnim(){
  const G="var(--gd-gold)",L="var(--gd-line)",LS="var(--gd-line-strong)",P="var(--gd-panel)",T1="var(--text-1)",T3="var(--text-3)",BL="var(--gd-blue)",SU="var(--gd-success)";
  const mono={fontFamily:"var(--font-mono)"};
  const nodes=[["Atom",40,SU],["Afternic",84,SU],["SellerHub",128,SU],["设备 2",172,BL]];
  const HX=118, HY=104;   // hub exit point
  return <Win title="价格同步 · 改一次价">
    <div style={{padding:"6px 10px 2px"}}>
      <svg viewBox="0 0 440 200" width="100%" style={{display:"block"}} aria-hidden="true">
        {/* spokes */}
        {nodes.map(([n,y],i)=><line key={n} x1={HX} y1={HY} x2="292" y2={y} stroke={G} strokeWidth="1" opacity="0.13"/>)}
        {/* central price hub — the domain whose price is being changed */}
        <rect x="10" y="64" width="110" height="78" rx="9" fill={P} stroke={LS}/>
        <text x="65" y="83" textAnchor="middle" fill={T1} fontSize="11" style={mono}>example.com</text>
        <text x="65" y="97" textAnchor="middle" fill={T3} fontSize="8.5" style={mono}>BIN 一口价</text>
        <text className="mk-pold2" x="65" y="127" textAnchor="middle" fill={T3} fontSize="18" style={mono}>$9,000</text>
        <text className="mk-pnew2" x="65" y="127" textAnchor="middle" fill={G} fontSize="18" style={mono}>$7,500</text>
        {/* pulses traveling out + nodes */}
        {nodes.map(([n,y,col],i)=>{const dl=(i*0.12)+"s";
          return <g key={n}>
            <circle className="mk-spoke" cx={HX} cy={HY} r="3.5" fill={G} style={{"--dx":(292-HX)+"px","--dy":(y-HY)+"px",animationDelay:dl}}/>
            <rect x="292" y={y-13} width="132" height="26" rx="6" fill={P} stroke={L}/>
            <text x="302" y={y+4} fill={T1} fontSize="11" style={mono}>{n}</text>
            <g className="mk-synced2" style={{animationDelay:dl}}><text x="416" y={y+4} textAnchor="end" fill={col} fontSize="8.5" letterSpacing="0.5" style={mono}>SYNCED ✓</text></g>
          </g>;})}
      </svg>
      <div style={{fontSize:10.5,color:T3,fontFamily:"var(--font-mono)",padding:"4px 4px 2px"}}>改一次价 · 脉冲沿辐条射向各平台与设备 · 逐个同步</div>
    </div>
  </Win>;
}
const ANIM={aggregate:AggregateAnim,list:ListAnim,verify:VerifyAnim,sync:SyncAnim};

function Showcase(){
  const D=window.MK_DATA.showcase;
  return <div>
    <div className="mk-sec">
      <div style={{maxWidth:640,display:"flex",flexDirection:"column",gap:14,marginBottom:44}}>
        <div className="mk-eyebrow2"><b>功能</b><span className="mk-rule"></span><span>动起来看</span></div>
        <h2 className="mk-h2">不是概念，是会动的功能</h2>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:56}}>
        {D.map((s,i)=>{const A=ANIM[s.anim];
          return <div key={i} style={{display:"flex",gap:48,alignItems:"center",flexWrap:"wrap",flexDirection:s.side==="right"?"row-reverse":"row"}}>
            <div style={{flex:"1 1 400px",minWidth:300}}><A/></div>
            <div style={{flex:"1 1 300px",minWidth:260,display:"flex",flexDirection:"column",gap:12}}>
              <span className="mk-tag mk-tag--gold" style={{alignSelf:"flex-start"}}>{s.tag}</span>
              <h3 style={{fontSize:21,fontWeight:600,letterSpacing:"-0.015em",margin:0,color:"var(--text-1)"}}>{s.title}</h3>
              <p style={{fontSize:14,color:"var(--text-2)",lineHeight:1.65,margin:0}}>{s.desc}</p>
            </div>
          </div>;})}
      </div>
    </div>
    <div className="mk-sec" style={{paddingTop:0,paddingBottom:0}}><div className="mk-seam"></div></div>
  </div>;
}
window.MKShowcase=Showcase;
