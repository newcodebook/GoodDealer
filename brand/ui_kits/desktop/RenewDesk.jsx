// 续费 / Renewal — batch renew expiring domains against a budget. Registrar operation.
// Launched from the 资产库「到期」KPI. Per-domain term, budget guard, enqueues to Outbox.
const {Table:RTable,Badge:RBadge,Button:RBtn,Select:RSel,Money:RMoney,Switch:RSwitch,Toolbar:RToolbar,Dialog:RDlg,BatchBar:RBatch}=window.GoodDealerDesignSystem_b5b0b6;
const TLD={io:32,com:11,ai:75,dev:14,money:33,trade:28,systems:30,capital:30,finance:35,exchange:42,co:28,net:13};
const priceOf=d=>{const t=d.split(".").pop();return TLD[t]||20;};
const BUDGET=312;
const TODAY=new Date("2026-08-03");
const daysTo=s=>Math.round((new Date(s)-TODAY)/86400000);
const rmoney=n=>Number(n).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});

function rseed(){
  const r=(id,domain,registrar,expiry,auto)=>({id,domain,registrar,expiry,auto});
  return [
    r(1,"vault.io","Spaceship","2026-08-10",false),
    r(2,"arc.exchange","Spaceship","2026-08-14",false),
    r(3,"kanban.ai","Namecheap","2026-08-19",false),
    r(4,"quanta.trade","Dynadot","2026-08-25",true),
    r(5,"helio.systems","Dynadot","2026-09-01",false),
    r(6,"crest.capital","Spaceship","2026-09-05",false),
    r(7,"mint.money","Spaceship","2026-09-12",true),
    r(8,"north.capital","Spaceship","2026-09-18",false),
    r(9,"forge.dev","Namecheap","2026-09-22",false),
    r(10,"spark.trade","Dynadot","2026-09-28",false),
    r(11,"oxide.dev","Namecheap","2026-09-30",true),
    r(12,"goldrail.com","Spaceship","2026-10-01",false),
  ];
}

function RenewDesk({onBack,addUnsynced}){
  const I=window.GDI;
  const [rows,setRows]=React.useState(rseed);
  const [sel,setSel]=React.useState([]);
  const [term,setTerm]=React.useState({});
  const [uniform,setUniform]=React.useState("1");
  const [confirm,setConfirm]=React.useState(false);
  const yearsOf=id=>+(term[id]||uniform);
  const active=rows.filter(r=>!r.renewed);
  const selRows=active.filter(r=>sel.includes(r.id));
  const lineCost=r=>priceOf(r.domain)*yearsOf(r.id);
  const selTotal=selRows.reduce((s,r)=>s+lineCost(r),0);
  const autoCovered=active.filter(r=>r.auto).length;
  const over=selTotal>BUDGET;
  const setAuto=(id,v)=>setRows(rs=>rs.map(x=>x.id===id?{...x,auto:v}:x));
  const doRenew=()=>{const ids=[...sel];setConfirm(false);
    setRows(rs=>rs.map(x=>ids.includes(x.id)?{...x,renewed:true}:x));setSel([]);addUnsynced&&addUnsynced(ids.length);};
  const applyUniform=()=>{setTerm(t=>{const n={...t};sel.forEach(id=>n[id]=uniform);return n;});};

  const expColor=d=>{const dd=daysTo(d);return dd<14?"var(--gd-danger)":dd<30?"var(--gd-warning)":"var(--text-1)";};
  const kpis=[["到期域名",String(active.length),null],["续费预算","$"+rmoney(BUDGET),"gold"],["已选续费额","$"+rmoney(selTotal),over?"danger":"gold"],["预算余量","$"+rmoney(BUDGET-selTotal),over?"danger":null],["自动续费覆盖",`${autoCovered} / ${active.length}`,"blue"]];
  const kcolor=t=>t==="gold"?"var(--gd-gold)":t==="danger"?"var(--gd-danger)":t==="blue"?"var(--gd-blue)":"var(--text-1)";

  const MetricStrip=window.GDMetricStrip;
  return <div data-screen-label="续费" style={{display:"flex",flexDirection:"column",height:"100%",minHeight:0}}>
    <MetricStrip metrics={kpis.map(k=>({label:k[0],value:k[1],tone:k[2]}))}/>
    <RToolbar region
      left={<><RBtn size="sm" variant="ghost" icon={<I.ChevronLeft size={15}/>} onClick={onBack}>资产库</RBtn>
        <span style={{fontSize:12,color:"var(--gd-text-muted)",whiteSpace:"nowrap"}}>60 天内到期 · 按到期升序 · 续费为注册商操作</span></>}
      right={<RBtn size="sm" variant="primary" disabled={sel.length===0} onClick={()=>setConfirm(true)}>续费所选{sel.length?` · ${sel.length}`:""}</RBtn>}/>
    <div style={{flex:1,minHeight:0,position:"relative",display:"flex"}}>
      <RTable density="regular" selectable selected={sel} onSelectionChange={setSel} rowKey="id" maxHeight="100%" style={{flex:1,minHeight:0,border:"none",borderRadius:0}}
        columns={[
          {key:"domain",label:"域名",render:r=><span style={{fontFamily:"var(--font-mono)",fontSize:12,color:r.renewed?"var(--gd-text-faint)":"var(--text-1)"}}>{r.domain}</span>},
          {key:"expiry",label:"到期",numeric:true,render:r=><span style={{fontFamily:"var(--font-mono)",fontSize:12,color:r.renewed?"var(--gd-text-faint)":expColor(r.expiry)}}>{r.expiry}</span>,width:108},
          {key:"days",label:"剩余",numeric:true,width:64,render:r=><span style={{fontFamily:"var(--font-mono)",fontSize:12,color:"var(--gd-text-muted)"}}>{daysTo(r.expiry)}d</span>},
          {key:"registrar",label:"注册商",muted:true,width:104},
          {key:"auto",label:"自动续费",width:88,render:r=>r.renewed?<span style={{color:"var(--gd-text-faint)",fontSize:12}}>—</span>:<RSwitch checked={r.auto} onChange={()=>setAuto(r.id,!r.auto)}/>},
          {key:"term",label:"续费年限",width:112,render:r=>r.renewed?<span style={{color:"var(--gd-text-faint)",fontSize:12}}>—</span>:<RSel size="sm" options={["1","2","3"]} value={String(yearsOf(r.id))} onChange={e=>setTerm(t=>({...t,[r.id]:e.target.value}))}/>},
          {key:"price",label:"单价/年",numeric:true,width:90,render:r=><RMoney amount={priceOf(r.domain)} tone="body"/>},
          {key:"subtotal",label:"小计",numeric:true,width:104,render:r=>r.renewed?<RBadge tone="success" mono={false}>已续费</RBadge>:<RMoney amount={lineCost(r)}/>},
        ]}
        rows={rows}/>
      {sel.length>0&&<div style={{position:"absolute",bottom:14,left:0,right:0,display:"flex",justifyContent:"center",pointerEvents:"none",zIndex:5}}>
        <RBatch count={sel.length} onClear={()=>setSel([])} style={{pointerEvents:"auto"}}>
          <span style={{display:"inline-flex",alignItems:"center",gap:6,fontSize:12,color:"var(--gd-text-muted)"}}>统一年限<RSel size="sm" options={["1","2","3"]} value={uniform} onChange={e=>setUniform(e.target.value)}/></span>
          <RBtn size="sm" onClick={applyUniform}>应用到所选</RBtn>
          <span className="gd-batchbar-sep"></span>
          <span style={{fontSize:12,whiteSpace:"nowrap"}}>合计 <b style={{fontFamily:"var(--font-mono)",color:over?"var(--gd-danger)":"var(--gd-gold)"}}>${rmoney(selTotal)}</b></span>
          <RBtn size="sm" variant="primary" onClick={()=>setConfirm(true)}>续费</RBtn>
        </RBatch>
      </div>}
    </div>
    <RDlg open={confirm} onClose={()=>setConfirm(false)} title={`续费 · ${sel.length} 个域名`} width={470}
      footer={<><RBtn onClick={()=>setConfirm(false)}>取消</RBtn><RBtn variant="primary" onClick={doRenew}>确认续费 · ${rmoney(selTotal)}</RBtn></>}>
      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        <span style={{fontSize:13}}>向各注册商提交 <b style={{fontFamily:"var(--font-mono)"}}>{sel.length}</b> 个域名的续费，按所选年限扣费。</span>
        <div style={{border:"1px solid var(--gd-line-strong)",borderRadius:7,background:"var(--gd-panel)",padding:"11px 13px",display:"flex",flexDirection:"column",gap:7,fontSize:13}}>
          <div style={{display:"flex",justifyContent:"space-between"}}><span style={{color:"var(--gd-text-muted)"}}>续费总额</span><RMoney amount={selTotal} size={15}/></div>
          <div style={{display:"flex",justifyContent:"space-between"}}><span style={{color:"var(--gd-text-muted)"}}>续费预算</span><span style={{fontFamily:"var(--font-mono)",color:"var(--gd-text-muted)"}}>${rmoney(BUDGET)}</span></div>
          <div style={{display:"flex",justifyContent:"space-between",borderTop:"1px solid var(--gd-line)",paddingTop:7}}><span>预算余量</span><span style={{fontFamily:"var(--font-mono)",color:over?"var(--gd-danger)":"var(--gd-success)"}}>{over?"−":""}${rmoney(Math.abs(BUDGET-selTotal))}</span></div>
        </div>
        {over&&<div style={{border:"1px solid var(--gd-warning)",background:"var(--gd-warning-tint)",borderRadius:7,padding:"9px 12px",display:"flex",alignItems:"center",gap:8,fontSize:12,color:"var(--gd-text)"}}><I.AlertTriangle size={14} style={{color:"var(--gd-warning)",flex:"none"}}/>超出续费预算 ${rmoney(selTotal-BUDGET)}，仍可继续。</div>}
        <span style={{fontSize:11,color:"var(--gd-text-faint)"}}>续费为可安全重试操作，将进入同步中心 Outbox 提交至注册商。</span>
      </div>
    </RDlg>
  </div>;
}
window.GDRenewDesk=RenewDesk;
