// Batch-task input windows. All composed from DS primitives (Dialog, Input, Select, Checkbox, Button…).
const {Dialog:GDDialog,Input:GDInput,Select:GDSel,Checkbox:GDCheck,Button:GDBtn,Money:GDMoney,Badge:GDBadge}=window.GoodDealerDesignSystem_b5b0b6;
const fmt=n=>n==null||n===""?"—":Number(n).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
const num=v=>{const n=Number(String(v).replace(/[^0-9.]/g,""));return isFinite(n)?n:0;};

function Seg({value,onChange,items}){
  return <div style={{display:"inline-flex",background:"var(--gd-ink)",border:"1px solid var(--gd-line-strong)",borderRadius:6,padding:2,gap:2}}>
    {items.map(it=><button key={it.k} onClick={()=>onChange(it.k)} style={{height:26,padding:"0 12px",borderRadius:4,border:"none",cursor:"pointer",fontFamily:"var(--font-sans)",fontSize:12,transition:"background 120ms,color 120ms",
      background:value===it.k?"var(--gd-panel-raised)":"transparent",color:value===it.k?"var(--text-1)":"var(--text-2)",fontWeight:value===it.k?500:400}}>{it.label}</button>)}
  </div>;
}
const rowLine={display:"flex",alignItems:"center",gap:10,padding:"7px 0",borderBottom:"1px solid var(--gd-line)"};
const label={fontSize:11,letterSpacing:"0.08em",textTransform:"uppercase",color:"var(--gd-text-muted)",fontWeight:500};

// ---- Batch price ---------------------------------------------------------
function BatchPriceDialog({open,domains,onClose,onSubmit}){
  const [mode,setMode]=React.useState("uniform");
  const [uniform,setUniform]=React.useState("");
  const [dir,setDir]=React.useState("down");
  const [pct,setPct]=React.useState("8");
  const [each,setEach]=React.useState({});
  const [master,setMaster]=React.useState("");
  React.useEffect(()=>{if(open){setMode("uniform");setUniform("");setDir("down");setPct("8");setMaster("");
    const m={};domains.forEach(d=>m[d.id]=d.bin!=null?String(d.bin):"");setEach(m);}},[open]);
  if(!open)return null;
  const newPrice=d=>{
    if(mode==="uniform")return uniform===""?d.bin:num(uniform);
    if(mode==="percent"){const p=num(pct)/100;return d.bin==null?null:Math.round(d.bin*(dir==="down"?1-p:1+p));}
    return each[d.id]===""||each[d.id]==null?d.bin:num(each[d.id]);
  };
  const oldSum=domains.reduce((s,d)=>s+(d.bin||0),0);
  const newSum=domains.reduce((s,d)=>s+(newPrice(d)||0),0);
  const delta=newSum-oldSum;
  return <GDDialog open onClose={onClose} title={`批量改价 · ${domains.length} 个域名`} width={mode==="each"?600:480}
    footer={<><GDBtn onClick={onClose}>取消</GDBtn><GDBtn variant="primary" onClick={()=>onSubmit(domains.length)}>生成批量计划 · {domains.length} 项</GDBtn></>}>
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      <Seg value={mode} onChange={setMode} items={[{k:"uniform",label:"统一价格"},{k:"percent",label:"按比例调整"},{k:"each",label:"逐个设置"}]}/>
      {mode==="uniform"&&<div style={{display:"flex",alignItems:"center",gap:12}}>
        <GDInput size="md" mono prefix="$" placeholder="0.00" value={uniform} onChange={e=>setUniform(e.target.value)} style={{width:180}}/>
        <span style={{fontSize:12,color:"var(--gd-text-muted)"}}>应用到全部 <b style={{fontFamily:"var(--font-mono)"}}>{domains.length}</b> 个域名的 BIN</span>
      </div>}
      {mode==="percent"&&<div style={{display:"flex",alignItems:"center",gap:12}}>
        <Seg value={dir} onChange={setDir} items={[{k:"down",label:"下调"},{k:"up",label:"上调"}]}/>
        <GDInput size="md" mono suffix="%" value={pct} onChange={e=>setPct(e.target.value)} style={{width:110}}/>
        <span style={{fontSize:12,color:"var(--gd-text-muted)"}}>示例 {fmt(domains[0]&&domains[0].bin)} → <span style={{color:"var(--gd-gold)",fontFamily:"var(--font-mono)"}}>{fmt(domains[0]&&newPrice(domains[0]))}</span></span>
      </div>}
      {mode==="each"&&<div style={{display:"flex",flexDirection:"column",gap:8}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <span style={{fontSize:12,color:"var(--gd-text-muted)"}}>统一填入</span>
          <GDInput size="sm" mono prefix="$" placeholder="0.00" value={master} onChange={e=>setMaster(e.target.value)} style={{width:140}}/>
          <GDBtn size="sm" onClick={()=>{const m={};domains.forEach(d=>m[d.id]=master);setEach(m);}}>应用到全部</GDBtn>
        </div>
        <div style={{maxHeight:250,overflow:"auto",border:"1px solid var(--gd-line)",borderRadius:7}}>
          <div style={{...rowLine,padding:"8px 12px",position:"sticky",top:0,background:"var(--gd-panel)"}}>
            <span style={{...label,flex:1}}>域名</span><span style={{...label,width:120,textAlign:"right"}}>当前</span><span style={{...label,width:150,textAlign:"right"}}>新 BIN</span>
          </div>
          {domains.map(d=><div key={d.id} style={{...rowLine,padding:"7px 12px"}}>
            <span style={{flex:1,fontFamily:"var(--font-mono)",fontSize:12}}>{d.domain}</span>
            <span style={{width:120,textAlign:"right",fontFamily:"var(--font-mono)",fontSize:12,color:"var(--gd-text-faint)"}}>{fmt(d.bin)}</span>
            <span style={{width:150,display:"flex",justifyContent:"flex-end"}}><GDInput size="sm" mono prefix="$" value={each[d.id]??""} onChange={e=>setEach(x=>({...x,[d.id]:e.target.value}))} style={{width:140}}/></span>
          </div>)}
        </div>
      </div>}
      <div style={{display:"flex",alignItems:"center",gap:8,borderTop:"1px solid var(--gd-line)",paddingTop:11,fontSize:12}}>
        <span style={{color:"var(--gd-text-muted)"}}>选中组合估值</span>
        <span style={{fontFamily:"var(--font-mono)",color:"var(--gd-text-faint)"}}>${fmt(oldSum)}</span>
        <span style={{color:"var(--gd-text-faint)"}}>→</span>
        <span style={{fontFamily:"var(--font-mono)",color:"var(--gd-gold)"}}>${fmt(newSum)}</span>
        <span style={{marginLeft:"auto",fontFamily:"var(--font-mono)",color:delta<0?"var(--gd-danger)":delta>0?"var(--gd-success)":"var(--gd-text-faint)"}}>{delta===0?"±0":`${delta<0?"−":"+"}$${fmt(Math.abs(delta))}`}</span>
      </div>
      <span style={{fontSize:11,color:"var(--gd-text-faint)"}}>生成计划后进入批量差异预览：逐项确认执行方式、风险与冲突，再提交。</span>
    </div>
  </GDDialog>;
}

// ---- Nameserver change (handled by the REGISTRAR; high risk) -------------
function BatchNsDialog({open,domains,onClose,onApply}){
  const [mode,setMode]=React.useState("platform");
  const [target,setTarget]=React.useState("销售平台托管 NS");
  const [ns1,setNs1]=React.useState("");
  const [ns2,setNs2]=React.useState("");
  const [ack,setAck]=React.useState(false);
  const I=window.GDI;
  React.useEffect(()=>{if(open){setMode("platform");setTarget("销售平台托管 NS");setNs1("");setNs2("");setAck(false);}},[open]);
  if(!open)return null;
  const applied=mode==="platform"?target:"自定义 NS";
  return <GDDialog open onClose={onClose} title={`变更 Nameserver · ${domains.length} 个域名`} width={520} danger
    footer={<><GDBtn onClick={onClose}>取消</GDBtn><GDBtn variant="danger" disabled={!ack||(mode==="custom"&&!ns1)} onClick={()=>onApply({mode,applied})}>提交 · {domains.length} 项</GDBtn></>}>
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      <div style={{display:"flex",alignItems:"center",gap:8,fontSize:12,color:"var(--gd-text-muted)"}}>
        <span style={{...label,color:"var(--gd-text-faint)"}}>处理平台</span><span>注册商 · 变更域名的 Nameserver 委派</span>
      </div>
      <Seg value={mode} onChange={setMode} items={[{k:"platform",label:"指向销售平台 NS · 推荐"},{k:"custom",label:"自定义 Nameserver"}]}/>
      {mode==="platform"?<div style={{display:"flex",flexDirection:"column",gap:9}}>
        <span style={{fontSize:12,color:"var(--gd-text-muted)"}}>在注册商处将 Nameserver 统一指向所选目标（改变的是 NS 委派，而非具体记录）。</span>
        <label className="gd-field" style={{maxWidth:280}}><span style={label}>目标 Nameserver</span>
          <GDSel size="md" options={["销售平台托管 NS","Cloudflare NS","注册商默认 NS"]} value={target} onChange={e=>setTarget(e.target.value)}/></label>
      </div>:<div style={{display:"flex",gap:10}}>
        <GDInput label="NS 1" size="md" mono placeholder="ns1.example.com" value={ns1} onChange={e=>setNs1(e.target.value)} style={{flex:1}}/>
        <GDInput label="NS 2" size="md" mono placeholder="ns2.example.com" value={ns2} onChange={e=>setNs2(e.target.value)} style={{flex:1}}/>
      </div>}
      <div style={{border:"1px solid var(--gd-danger)",background:"var(--gd-danger-tint)",borderRadius:7,padding:"11px 13px",display:"flex",flexDirection:"column",gap:9}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <I.AlertTriangle size={15} style={{color:"var(--gd-danger)",flex:"none"}}/>
          <b style={{color:"var(--gd-danger)",fontSize:13}}>高风险 · Nameserver 变更</b>
          <span style={{marginLeft:"auto",fontSize:11,color:"var(--gd-text-muted)"}}>可回滚</span>
        </div>
        <span style={{fontSize:12,color:"var(--gd-text)",lineHeight:1.5}}>切换 Nameserver 会将 DNS 权威整体移交给新 NS：旧提供商的全部记录（A/MX/TXT）立即失效，解析与邮件在传播完成前可能中断（约 5–30 分钟）。回滚同样需要传播时间。</span>
        <div style={{borderTop:"1px solid rgba(229,115,95,0.24)",paddingTop:9}}><GDCheck checked={ack} onChange={()=>setAck(a=>!a)} label={`我已理解后果，确认在注册商处对这 ${domains.length} 个域名变更 Nameserver`}/></div>
      </div>
    </div>
  </GDDialog>;
}

// ---- DNS records (handled by the DNS PROVIDER; per-record) ---------------
function BatchRecordsDialog({open,domains,onClose,onApply}){
  const I=window.GDI;
  const TYPES=["A","AAAA","CNAME","TXT","MX"];
  const [rtype,setRtype]=React.useState("TXT");
  const [host,setHost]=React.useState("@");
  const [value,setValue]=React.useState("");
  const [ttl,setTtl]=React.useState("Auto");
  React.useEffect(()=>{if(open){setRtype("TXT");setHost("@");setValue("");setTtl("Auto");}},[open]);
  if(!open)return null;
  const ph={A:"185.199.108.153",AAAA:"2606:50c0:8000::153",CNAME:"target.example.com",TXT:"atom-verify=8f2a…",MX:"10 mail.example.com"}[rtype]||"";
  const routing=["A","AAAA","CNAME","MX"].includes(rtype);
  return <GDDialog open onClose={onClose} title={`修改 DNS 记录 · ${domains.length} 个域名`} width={560}
    footer={<><GDBtn onClick={onClose}>取消</GDBtn><GDBtn variant="primary" disabled={!value} onClick={()=>onApply({rtype,host,value,ttl})}>提交 · {domains.length} 项</GDBtn></>}>
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      <div style={{display:"flex",alignItems:"center",gap:8,fontSize:12,color:"var(--gd-text-muted)"}}>
        <span style={{...label,color:"var(--gd-text-faint)"}}>处理平台</span><span>DNS 提供商 · 按各域名当前提供商分别下发（Nameserver 不变）</span>
      </div>
      <div style={{display:"flex",gap:10,alignItems:"flex-end"}}>
        <label className="gd-field" style={{width:110}}><span style={label}>类型</span><GDSel size="md" options={TYPES} value={rtype} onChange={e=>setRtype(e.target.value)}/></label>
        <GDInput label="主机" size="md" mono placeholder="@ 或 www" value={host} onChange={e=>setHost(e.target.value)} style={{width:160}}/>
        <label className="gd-field" style={{width:110}}><span style={label}>TTL</span><GDSel size="md" options={["Auto","300","3600","86400"]} value={ttl} onChange={e=>setTtl(e.target.value)}/></label>
      </div>
      <GDInput label={`值（${rtype}）`} size="md" mono placeholder={ph} value={value} onChange={e=>setValue(e.target.value)}/>
      {routing&&<div style={{border:"1px solid var(--gd-warning)",background:"var(--gd-warning-tint)",borderRadius:7,padding:"9px 12px",display:"flex",alignItems:"center",gap:8,fontSize:12,color:"var(--gd-text)"}}>
        <I.AlertTriangle size={14} style={{color:"var(--gd-warning)",flex:"none"}}/>需留意 · 修改 {rtype} 记录会影响解析{rtype==="MX"?"与邮件收发":""}；DNS 提供商即时下发，无 Nameserver 传播等待。
      </div>}
      <span style={{fontSize:11,color:"var(--gd-text-faint)"}}>与 Nameserver 变更不同：记录由 DNS 提供商即时生效，不改变域名的 NS 委派；可安全重试。</span>
    </div>
  </GDDialog>;
}

// ---- List (上架) ---------------------------------------------------------
function ListDialog({open,domains,onClose,onApply}){
  const ALL=["Atom","Afternic","SellerHub"];
  const [plats,setPlats]=React.useState(["Atom"]);
  const [price,setPrice]=React.useState("");
  React.useEffect(()=>{if(open){setPlats(["Atom"]);setPrice("");}},[open]);
  if(!open)return null;
  const toggle=p=>setPlats(x=>x.includes(p)?x.filter(i=>i!==p):[...x,p]);
  return <GDDialog open onClose={onClose} title={`上架 · ${domains.length} 个域名`} width={480}
    footer={<><GDBtn onClick={onClose}>取消</GDBtn><GDBtn variant="primary" disabled={plats.length===0} onClick={()=>onApply({platforms:plats,price:price===""?null:num(price)})}>上架 · {domains.length} 项</GDBtn></>}>
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        <span style={label}>上架平台</span>
        <div style={{display:"flex",gap:8}}>{ALL.map(p=>{const on=plats.includes(p);
          return <button key={p} onClick={()=>toggle(p)} style={{height:32,padding:"0 14px",borderRadius:6,cursor:"pointer",fontFamily:"var(--font-sans)",fontSize:13,transition:"all 120ms",
            border:`1px solid ${on?"var(--gd-blue)":"var(--gd-line-strong)"}`,background:on?"var(--gd-blue-tint)":"var(--gd-ink)",color:on?"var(--gd-blue)":"var(--gd-text-muted)"}}>{p}</button>;})}</div>
      </div>
      <div style={{display:"flex",alignItems:"center",gap:12}}>
        <GDInput label="统一 BIN（可选）" size="md" mono prefix="$" placeholder="0.00" value={price} onChange={e=>setPrice(e.target.value)} style={{width:200}}/>
        <span style={{fontSize:12,color:"var(--gd-text-muted)",alignSelf:"flex-end",paddingBottom:7}}>留空则沿用各域名当前 BIN，可上架后单独调整</span>
      </div>
      <span style={{fontSize:11,color:"var(--gd-text-faint)"}}>上架为可安全重试操作；结果以平台 Listing 状态为准，写入未同步修改并在下次同步提交。</span>
    </div>
  </GDDialog>;
}

window.GDDialogs={BatchPriceDialog,BatchNsDialog,BatchRecordsDialog,ListDialog};
