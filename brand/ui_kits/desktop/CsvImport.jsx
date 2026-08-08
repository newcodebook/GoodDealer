// CSV 导入 / CsvImport — bring assets from not-yet-connected registrars (PRD 3.1).
// Three steps: 选文件 → 列映射 → 预览。Domains are normalized (lowercased, protocol-stripped, Punycode)
// and deduped against the existing library by normalized name; duplicates skip, invalids are dropped.
const {Dialog:CDlg,Button:CBtn,Select:CSel,Badge:CBadge,Tag:CTag}=window.GoodDealerDesignSystem_b5b0b6;

const CSV_COLS=[
  {csv:"Domain",sample:"vault.io",map:"domain"},
  {csv:"Registrar",sample:"Spaceship",map:"registrar"},
  {csv:"Expiry",sample:"2027-03-14",map:"expiry"},
  {csv:"Cost (USD)",sample:"1200.00",map:"cost"},
  {csv:"Tags",sample:"三字母;金融",map:"tags"},
  {csv:"Nameservers",sample:"ns.cloudflare.com",map:"ns"},
];
const FIELDS=[["domain","域名 *"],["registrar","注册商"],["expiry","到期日"],["cost","购入成本"],["tags","标签"],["ns","Nameserver"],["ignore","忽略此列"]];
const FIELD_LABEL=Object.fromEntries(FIELDS);
const PREVIEW=[
  {raw:"vault.io",norm:"vault.io",reg:"Spaceship",state:"dup"},
  {raw:"KANBAN.AI",norm:"kanban.ai",reg:"Namecheap",state:"new"},
  {raw:"münchen.de",norm:"xn--mnchen-3ya.de",reg:"Dynadot",state:"new"},
  {raw:"quanta.trade",norm:"quanta.trade",reg:"Spaceship",state:"dup"},
  {raw:"http://bad_domain",norm:"—",reg:"—",state:"invalid"},
  {raw:"forge.dev",norm:"forge.dev",reg:"Namecheap",state:"new"},
];
const COUNTS={total:847,new:812,dup:30,invalid:5};
const STATE_BADGE={new:["success","新增"],dup:["neutral","重复 · 跳过"],invalid:["danger","无效"]};

function Stepper({step}){
  const steps=[["file","选文件"],["map","列映射"],["preview","预览"]];
  const idx=steps.findIndex(s=>s[0]===step);
  return <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
    {steps.map(([k,l],i)=><React.Fragment key={k}>
      <span style={{display:"inline-flex",alignItems:"center",gap:6,fontSize:12,color:i<=idx?"var(--text-1)":"var(--gd-text-faint)"}}>
        <span style={{width:18,height:18,borderRadius:"50%",display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:10,fontFamily:"var(--font-mono)",
          background:i<idx?"var(--gd-blue)":i===idx?"var(--gd-blue-tint)":"transparent",color:i<idx?"#fff":i===idx?"var(--gd-blue)":"var(--gd-text-faint)",border:`1px solid ${i<=idx?"var(--gd-blue)":"var(--gd-line-strong)"}`}}>{i<idx?"✓":i+1}</span>
        {l}</span>
      {i<steps.length-1&&<span style={{flex:"none",width:20,height:1,background:i<idx?"var(--gd-blue)":"var(--gd-line)"}}></span>}
    </React.Fragment>)}
  </div>;
}

function CsvImport({open,onClose,onImport}){
  const I=window.GDI;
  const [step,setStep]=React.useState("file");
  const [maps,setMaps]=React.useState(()=>CSV_COLS.map(c=>c.map));
  React.useEffect(()=>{if(open){setStep("file");setMaps(CSV_COLS.map(c=>c.map));}},[open]);
  const domainMapped=maps.includes("domain");

  const foot={
    file:<><CBtn onClick={onClose}>取消</CBtn><CBtn variant="primary" onClick={()=>setStep("map")}>下一步 · 列映射</CBtn></>,
    map:<><CBtn onClick={()=>setStep("file")}>上一步</CBtn><CBtn variant="primary" disabled={!domainMapped} onClick={()=>setStep("preview")}>预览导入</CBtn></>,
    preview:<><CBtn onClick={()=>setStep("map")}>上一步</CBtn><CBtn variant="primary" onClick={()=>{onImport&&onImport(COUNTS.new);onClose&&onClose();}}>导入 {COUNTS.new} 个新域名</CBtn></>,
  }[step];

  return <CDlg open={open} onClose={onClose} title="导入 CSV · 未接入注册商资产" width={640} footer={foot}>
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      <Stepper step={step}/>

      {step==="file"&&<div style={{display:"flex",flexDirection:"column",gap:12}}>
        <div style={{border:"1px dashed var(--gd-line-strong)",borderRadius:9,padding:"26px 16px",display:"flex",flexDirection:"column",alignItems:"center",gap:8,background:"var(--gd-panel)"}}>
          <I.Upload size={24} style={{color:"var(--gd-text-muted)"}}/>
          <span style={{fontSize:13,color:"var(--text-1)"}}>拖入 CSV 文件，或点击选择</span>
          <span style={{fontSize:11,color:"var(--gd-text-faint)"}}>首行为列名 · UTF-8 · 支持标准化与 Punycode 域名</span>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:11,padding:"11px 13px",border:"1px solid var(--gd-line)",borderRadius:7,background:"var(--gd-panel)"}}>
          <I.FileText size={16} style={{color:"var(--gd-text-muted)",flex:"none"}}/>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:13,fontFamily:"var(--font-mono)"}}>spaceship-export-0807.csv</div>
            <div style={{fontSize:11,color:"var(--gd-text-faint)"}}>{COUNTS.total} 行 · {CSV_COLS.length} 列 · 已识别列名</div>
          </div>
          <CBadge tone="success" mono={false}>已解析</CBadge>
        </div>
      </div>}

      {step==="map"&&<div style={{display:"flex",flexDirection:"column",gap:10}}>
        <span style={{fontSize:12,color:"var(--gd-text-muted)"}}>把 CSV 列映射到资产字段。<b style={{color:"var(--gd-text)",fontWeight:500}}>域名</b>为必填；域名将标准化（小写、去协议、Punycode）后用于去重。</span>
        <div style={{border:"1px solid var(--gd-line)",borderRadius:7,overflow:"hidden"}}>
          {CSV_COLS.map((c,i)=><div key={c.csv} style={{display:"flex",alignItems:"center",gap:12,padding:"9px 13px",borderBottom:i<CSV_COLS.length-1?"1px solid var(--gd-line)":"none"}}>
            <div style={{width:180,flex:"none",minWidth:0}}>
              <div style={{fontSize:12.5,color:"var(--text-1)",fontFamily:"var(--font-mono)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{c.csv}</div>
              <div style={{fontSize:10,color:"var(--gd-text-faint)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>例：{c.sample}</div>
            </div>
            <I.ChevronRight size={14} style={{color:"var(--gd-text-faint)",flex:"none"}}/>
            <div style={{flex:1,minWidth:0}}>
              <CSel size="sm" options={FIELDS.map(f=>f[1])} value={FIELD_LABEL[maps[i]]}
                onChange={e=>{const v=(e&&e.target)?e.target.value:e;const key=(FIELDS.find(f=>f[1]===v)||[])[0]||"ignore";setMaps(m=>m.map((x,j)=>j===i?key:x));}}/>
            </div>
          </div>)}
        </div>
        {!domainMapped&&<span style={{fontSize:11,color:"var(--gd-danger)"}}>请至少把一列映射为「域名」。</span>}
      </div>}

      {step==="preview"&&<div style={{display:"flex",flexDirection:"column",gap:12}}>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          <CBadge mono={false}>{COUNTS.total} 行</CBadge>
          <CBadge tone="success" mono={false}>{COUNTS.new} 新增</CBadge>
          <CBadge tone="neutral" mono={false}>{COUNTS.dup} 重复 · 跳过</CBadge>
          <CBadge tone="danger" mono={false}>{COUNTS.invalid} 无效</CBadge>
        </div>
        <div style={{border:"1px solid var(--gd-line)",borderRadius:7,overflow:"hidden"}}>
          <div style={{display:"flex",padding:"7px 13px",borderBottom:"1px solid var(--gd-line-strong)",fontSize:10,letterSpacing:"0.06em",textTransform:"uppercase",color:"var(--gd-text-faint)"}}>
            <span style={{flex:1}}>原始</span><span style={{width:20}}></span><span style={{flex:1}}>标准化域名（Punycode）</span><span style={{width:96,flex:"none"}}>注册商</span><span style={{width:92,flex:"none",textAlign:"right"}}>状态</span>
          </div>
          {PREVIEW.map((r,i)=><div key={i} style={{display:"flex",alignItems:"center",padding:"8px 13px",borderBottom:i<PREVIEW.length-1?"1px solid var(--gd-line)":"none",fontSize:12,opacity:r.state==="invalid"?.6:1}}>
            <span style={{flex:1,minWidth:0,fontFamily:"var(--font-mono)",color:"var(--gd-text-muted)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{r.raw}</span>
            <span style={{width:20,flex:"none",textAlign:"center",color:"var(--gd-text-faint)"}}>→</span>
            <span style={{flex:1,minWidth:0,fontFamily:"var(--font-mono)",color:r.state==="invalid"?"var(--gd-text-faint)":"var(--text-1)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{r.norm}</span>
            <span style={{width:96,flex:"none",color:"var(--gd-text-muted)",whiteSpace:"nowrap"}}>{r.reg}</span>
            <span style={{width:92,flex:"none",display:"flex",justifyContent:"flex-end"}}><CBadge tone={STATE_BADGE[r.state][0]} mono={false}>{STATE_BADGE[r.state][1]}</CBadge></span>
          </div>)}
        </div>
        <span style={{fontSize:11,color:"var(--gd-text-faint)",lineHeight:1.6}}>重复项按标准化域名比对已存在于资产库，默认跳过（不覆盖现有成本/标签）；无效项（非法域名/空值）不导入。导入后可在资产库按注册商筛选核对。</span>
      </div>}
    </div>
  </CDlg>;
}
window.GDCsvImport=CsvImport;
