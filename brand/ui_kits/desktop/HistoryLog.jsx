// 操作历史 / Audit & Rollback — the append-only Revision ledger.
// Every change is a Revision; the ledger is read-only except 回滚, which creates a NEW
// forward revision that reverts (history is never deleted) and enqueues to Outbox.
// Rollback of Nameserver entries is high-risk → confirmation ceremony with ack gate.
const {Table:HTable,Badge:HBadge,Button:HBtn,DiffValue:HDiff,Tag:HTag,Dialog:HDlg,Checkbox:HCheck,Select:HSel,Input:HInput,Panel:HPanel,Toolbar:HToolbar}=window.GoodDealerDesignSystem_b5b0b6;

const H_STATE={applied:{tone:null,label:"本地"},synced:{tone:"success",label:"已同步"},rolled_back:{tone:"warning",label:"已回滚"},pull:{tone:"sync",label:"云端拉取"},device:{tone:"gold",label:"设备"}};
function hseed(){
  const d=(rev,ts,actor,scope,action,platform,count,state,risk,diffs)=>({rev,ts,actor,scope,action,platform,count,state,risk,diffs});
  return [
    d("8,241","今日 14:02","MacBook Pro","批量","批量改价 −8%","交易平台 · Atom",799,"synced",false,[["vault.io","BIN","3,000.00","2,760.00"],["oxide.dev","BIN","5,800.00","5,336.00"],["arc.exchange","BIN","12,000.00","11,040.00"]]),
    d("8,240","今日 14:02","MacBook Pro","批量","变更 Nameserver","注册商 · Spaceship·Dynadot",3,"synced",true,[["goldrail.com","NS","ns.spaceship.com","cloudflare.com"],["quanta.trade","NS","ns.dynadot.com","cloudflare.com"]]),
    d("8,239","今日 14:01","MacBook Pro","批量","新增 TXT 记录","DNS 提供商 · Cloudflare",17,"synced",false,[["crest.capital","TXT","—","_atom=8f2a…"],["mint.money","TXT","—","_atom=1c90…"]]),
    d("8,238","今日 13:58","MacBook Pro","批量","上架 · Atom","交易平台 · Atom",12,"synced",false,[["north.capital","Listing","未上架","Atom · $8,900"]]),
    d("8,237","昨日 18:22","MacBook Pro","单域","手动改价","交易平台 · Atom",1,"applied",false,[["kanban.ai","BIN","45,000.00","99,999.00"]]),
    d("8,231","07-30 09:11","云端同步","同步","拉取远端变更","GoodDealer Cloud",41,"pull",false,[]),
    d("8,220","07-28 11:03","MacBook Pro","批量","下架","交易平台 · Afternic",6,"synced",false,[["legacy.io","Listing","Afternic","已下架"]]),
    d("8,180","07-14 16:40","MacBook Pro","单域","编辑标签","本地",1,"applied",false,[["vault.io","标签","三字母","三字母 · portfolio-a"]]),
    d("8,150","07-02 08:15","系统","设备","移交执行权 · Epoch 40→41","设备门禁",1,"device",false,[]),
    d("8,102","06-20 10:30","MacBook Pro","批量","回滚 → rev 8,098","交易平台 · Atom",23,"rolled_back",false,[["misfire.co","BIN","900.00","1,200.00"]]),
  ];
}

function DetailPane({e,onRollback}){
  const I=window.GDI;
  if(!e)return <div style={{flex:"none",width:344,borderLeft:"1px solid var(--gd-line)",display:"flex",alignItems:"center",justifyContent:"center",color:"var(--gd-text-faint)",fontSize:12}}>选择一条 Revision 查看明细</div>;
  const st=H_STATE[e.state];
  const rollbackable=!["pull","device","rolled_back"].includes(e.state);
  const M=({k,children})=><div style={{display:"flex",justifyContent:"space-between",gap:12,padding:"7px 0",borderBottom:"1px solid var(--gd-line)",fontSize:12}}><span style={{color:"var(--gd-text-faint)"}}>{k}</span><span style={{fontFamily:k==="Revision"||k==="Epoch"?"var(--font-mono)":undefined,color:"var(--gd-text-muted)",textAlign:"right"}}>{children}</span></div>;
  return <div style={{flex:"none",width:344,borderLeft:"1px solid var(--gd-line)",display:"flex",flexDirection:"column",minHeight:0}}>
    <div style={{padding:"13px 15px",borderBottom:"1px solid var(--gd-line)",display:"flex",flexDirection:"column",gap:8,flex:"none"}}>
      <div style={{display:"flex",alignItems:"center",gap:8}}>
        <span style={{fontFamily:"var(--font-mono)",fontSize:15,color:"var(--text-1)"}}>rev {e.rev}</span>
        <HBadge tone={st.tone} mono={false}>{st.label}</HBadge>
        {e.risk&&<HBadge tone="danger" mono={false}>高风险</HBadge>}
      </div>
      <span style={{fontSize:13,color:"var(--text-1)"}}>{e.action}</span>
    </div>
    <div style={{padding:"4px 15px",flex:"none"}}>
      <M k="Revision">{e.rev}</M><M k="时间">{e.ts}</M><M k="来源">{e.actor}</M><M k="处理平台">{e.platform}</M><M k="影响条目">{e.count} 项</M>
    </div>
    <div style={{flex:1,minHeight:0,overflow:"auto",padding:"6px 15px"}}>
      {e.diffs.length>0?<>
        <div className="gd-t-label" style={{margin:"4px 0 8px"}}>字段变更 · 示例 {e.diffs.length} / {e.count}</div>
        <div style={{display:"flex",flexDirection:"column",gap:9}}>{e.diffs.map((df,i)=><div key={i} style={{display:"flex",flexDirection:"column",gap:3,paddingBottom:9,borderBottom:"1px solid var(--gd-line)"}}>
          <span style={{fontFamily:"var(--font-mono)",fontSize:12,color:"var(--text-1)"}}>{df[0]} <span style={{color:"var(--gd-text-faint)"}}>· {df[1]}</span></span>
          <HDiff oldValue={df[2]} newValue={df[3]} size={11}/>
        </div>)}</div>
      </>:<div style={{fontSize:12,color:"var(--gd-text-faint)",padding:"12px 0"}}>{e.state==="pull"?"同步拉取，无本地字段变更明细。":e.state==="device"?"设备门禁事件，见设置 · 设备与运行态。":"无字段变更。"}</div>}
    </div>
    <div style={{padding:"11px 15px",borderTop:"1px solid var(--gd-line)",display:"flex",gap:8,flex:"none"}}>
      <HBtn size="sm" variant="ghost" icon={<I.FileText size={13}/>}>导出</HBtn>
      <span style={{flex:1}}></span>
      {rollbackable
        ?<HBtn size="sm" variant={e.risk?"danger":"primary"} onClick={()=>onRollback(e)} icon={<I.History size={13}/>}>回滚此 Revision</HBtn>
        :<span style={{fontSize:11,color:"var(--gd-text-faint)",alignSelf:"center"}}>{e.state==="rolled_back"?"已回滚":"不可回滚"}</span>}
    </div>
  </div>;
}

function HistoryLog({addUnsynced}){
  const I=window.GDI;
  const [entries,setEntries]=React.useState(hseed);
  const [selRev,setSelRev]=React.useState("8,241");
  const [q,setQ]=React.useState("");
  const [typeF,setTypeF]=React.useState("全部类型");
  const [rb,setRb]=React.useState(null);
  const [ack,setAck]=React.useState(false);
  const TYPES={全部类型:null,改价:"改价",DNS:"记录",NS:"Nameserver",上架下架:"架",同步:"拉取",回滚:"回滚"};
  const rows=entries.filter(e=>(TYPES[typeF]==null||e.action.includes(TYPES[typeF]))&&(q===""||e.action.includes(q)||e.rev.includes(q)||e.platform.includes(q)));
  const sel=entries.find(e=>e.rev===selRev)||rows[0];
  const nextRev=()=>{const top=parseInt(entries[0].rev.replace(/,/g,""),10)+1;return top.toLocaleString("en-US");};
  const doRollback=()=>{
    const t=rb;const nr=nextRev();setRb(null);setAck(false);
    setEntries(es=>[{rev:nr,ts:"现在",actor:"MacBook Pro",scope:t.scope,action:`回滚 → rev ${t.rev}`,platform:t.platform,count:t.count,state:"applied",risk:t.risk,diffs:t.diffs.map(d=>[d[0],d[1],d[3],d[2]])},
      ...es.map(e=>e.rev===t.rev?{...e,state:"rolled_back"}:e)]);
    setSelRev(nr);addUnsynced&&addUnsynced(Math.min(t.count,12));
  };
  const kpis=[["总 Revision","8,241",null],["今日变更","4 批 · 831 项",null],["待同步 Revision","2","blue"],["已回滚","1","warning"]];
  const kcolor=t=>t==="blue"?"var(--gd-blue)":t==="warning"?"var(--gd-warning)":"var(--text-1)";
  const MetricStrip=window.GDMetricStrip;
  return <div data-screen-label="操作历史" style={{display:"flex",flexDirection:"column",height:"100%",minHeight:0}}>
    <MetricStrip metrics={kpis.map((k,i)=>({label:k[0],value:k[1],tone:k[2],mono:k[0].includes("Revision")&&i===0}))}/>
    <HToolbar region
      left={<>
        <HInput size="sm" prefix={<I.Search size={13}/>} placeholder="搜索 Revision / 操作 / 平台" value={q} onChange={e=>setQ(e.target.value)} style={{width:230}}/>
        <HSel size="sm" options={Object.keys(TYPES)} value={typeF} onChange={e=>setTypeF(e.target.value)}/>
      </>}
      right={<span style={{fontSize:12,color:"var(--gd-text-faint)",whiteSpace:"nowrap"}}>只读账本 · 追加不可篡改 · 回滚生成新 Revision</span>}/>
    <div style={{flex:1,minHeight:0,display:"flex"}}>
      <div style={{flex:1,minWidth:0}}>
        <HTable density="regular" rowKey="rev" maxHeight="100%" onRowClick={r=>setSelRev(r.rev)} style={{border:"none",borderRadius:0}}
          columns={[
            {key:"rev",label:"Revision",render:r=><span style={{fontFamily:"var(--font-mono)",fontSize:12,color:r.rev===(sel&&sel.rev)?"var(--gd-blue)":"var(--text-1)"}}>rev {r.rev}</span>,width:96},
            {key:"action",label:"操作",render:r=><span style={{display:"inline-flex",alignItems:"center",gap:7}}>{r.action}{r.risk&&<I.AlertTriangle size={12} style={{color:"var(--gd-danger)"}}/>}</span>},
            {key:"platform",label:"处理平台",muted:true},
            {key:"actor",label:"来源",muted:true,width:104},
            {key:"count",label:"条目",numeric:true,width:64,render:r=><span style={{fontFamily:"var(--font-mono)"}}>{r.count}</span>},
            {key:"state",label:"状态",width:96,render:r=><HBadge tone={H_STATE[r.state].tone} mono={false}>{H_STATE[r.state].label}</HBadge>},
            {key:"ts",label:"时间",numeric:true,muted:true,width:104},
          ]}
          rows={rows}/>
      </div>
      <DetailPane e={sel} onRollback={e=>{setRb(e);setAck(false);}}/>
    </div>
    <HDlg open={!!rb} onClose={()=>{setRb(null);setAck(false);}} title={`回滚 Revision ${rb&&rb.rev}`} width={rb&&rb.risk?528:460} danger={rb&&rb.risk}
      footer={<><HBtn onClick={()=>{setRb(null);setAck(false);}}>取消</HBtn><HBtn variant={rb&&rb.risk?"danger":"primary"} disabled={rb&&rb.risk&&!ack} onClick={doRollback}>生成回滚 Revision · {rb&&rb.count} 项</HBtn></>}>
      {rb&&<div style={{display:"flex",flexDirection:"column",gap:12}}>
        <span style={{fontSize:13}}>回滚 <b style={{fontFamily:"var(--font-mono)"}}>rev {rb.rev}</b>（{rb.action}）。将生成新 Revision <b style={{fontFamily:"var(--font-mono)"}}>{nextRev()}</b> 反向应用其 {rb.count} 项变更并自动同步云端——<b>历史不会被删除</b>，原 Revision 标记为已回滚。</span>
        {rb.risk&&<div style={{border:"1px solid var(--gd-danger)",background:"var(--gd-danger-tint)",borderRadius:7,padding:"11px 13px",display:"flex",flexDirection:"column",gap:9}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}><I.AlertTriangle size={15} style={{color:"var(--gd-danger)",flex:"none"}}/><b style={{color:"var(--gd-danger)",fontSize:13}}>高风险 · 含 Nameserver 变更</b><span style={{marginLeft:"auto",fontSize:11,color:"var(--gd-text-muted)"}}>可回滚</span></div>
          <span style={{fontSize:12,color:"var(--gd-text)",lineHeight:1.5}}>回滚会将 Nameserver 改回原值，解析与邮件在传播完成前可能中断（约 5–30 分钟）。</span>
          <div style={{borderTop:"1px solid rgba(229,115,95,0.24)",paddingTop:9}}><HCheck checked={ack} onChange={()=>setAck(a=>!a)} label={`我已理解后果，确认回滚这 ${rb.count} 项`}/></div>
        </div>}
        <span style={{fontSize:11,color:"var(--gd-text-faint)"}}>回滚生成的新 Revision 将自动同步至云端。</span>
      </div>}
    </HDlg>
  </div>;
}
window.GDHistoryLog=HistoryLog;
