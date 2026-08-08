// 批量任务 = 作业级编排：列表（稳定主屏）+ 详情（推入）。
// 详情按状态分形态：计划中→差异预览与执行；执行中→进度；已完成/部分失败/已回滚→结果。
// 执行结果记入「操作历史」，派生人工项见「人工任务」；本地变更自动同步云端（无手动 Outbox）。
const {Table,Badge,DiffValue,Button,KpiStat,Panel,Tabs,Dialog,ProgressBar,IconButton,Checkbox,Input,Select,Toolbar}=window.GoodDealerDesignSystem_b5b0b6;

const JOB_STATUS={draft:{label:"计划中",tone:"warning"},running:{label:"执行中",tone:"sync"},done:{label:"已完成",tone:"success"},partial:{label:"部分失败",tone:"danger"},rolledback:{label:"已回滚",tone:null},canceled:{label:"已取消",tone:null}};
const jobBadge=s=>{const m=JOB_STATUS[s]||JOB_STATUS.draft;return <Badge tone={m.tone||undefined} mono={false}>{m.label}</Badge>;};
const riskBadge=r=>r==="high"?<Badge tone="danger" mono={false}>高风险</Badge>:r==="mid"?<Badge tone="warning" mono={false}>中风险</Badge>:null;

function ResultChips({res}){
  if(!res)return <span style={{color:"var(--gd-text-faint)",fontSize:12}}>—</span>;
  const items=[res.ok!=null&&["success",res.ok],res.manual&&["warning",res.manual],res.retry&&["danger",res.retry],res.conflict&&["danger",res.conflict]].filter(Boolean);
  return <span style={{display:"inline-flex",gap:12,alignItems:"center",fontFamily:"var(--font-mono)",fontVariantNumeric:"tabular-nums",fontSize:12}}>
    {items.map(([tone,n],i)=><span key={i} style={{display:"inline-flex",alignItems:"center",gap:5}}><span style={{width:6,height:6,borderRadius:"50%",background:`var(--gd-${tone})`}}></span>{n.toLocaleString()}</span>)}
  </span>;
}
function ProgCell({job}){
  if(job.status==="draft")return <span style={{fontSize:12,color:"var(--gd-warning)"}}>待确认</span>;
  if(job.status==="rolledback")return <span style={{fontSize:12,color:"var(--gd-text-faint)"}}>已回滚</span>;
  const tone=job.status==="running"?"sync":job.status==="partial"?"danger":"success";
  const col=job.status==="running"?"var(--gd-blue)":"var(--gd-text-faint)";
  return <span style={{display:"inline-flex",alignItems:"center",gap:8,width:"100%"}}>
    <span style={{flex:1,minWidth:60}}><ProgressBar segments={[{value:job.progress,tone}]} height={5}/></span>
    <span style={{fontFamily:"var(--font-mono)",fontSize:11,color:col}}>{job.progress}%</span>
  </span>;
}

// ---------- 列表 ----------
function BatchList({jobs,onOpen,onGoAssets}){
  const I=window.GDI;
  const MetricStrip=window.GDMetricStrip;
  const [q,setQ]=React.useState("");
  const [sf,setSf]=React.useState("全部状态");
  const SF={"全部状态":null,"计划中":"draft","执行中":"running","已完成":"done","部分失败":"partial","已回滚":"rolledback"};
  const c=s=>jobs.filter(j=>j.status===s).length;
  const key=SF[sf];
  const rows=jobs.filter(j=>(key==null||j.status===key)&&(q===""||j.name.includes(q)||j.rule.includes(q)));
  return <div data-screen-label="批量任务" style={{display:"flex",flexDirection:"column",height:"100%",minHeight:0}}>
    <MetricStrip metrics={[
      {label:"执行中",value:c("running"),tone:c("running")?"blue":"muted",meta:c("running")?"实时进度":null},
      {label:"计划待确认",value:c("draft"),tone:c("draft")?"warning":"muted",meta:c("draft")?"待确认执行":null},
      {label:"今日完成",value:c("done"),tone:c("done")?"success":"muted"},
      {label:"部分失败",value:c("partial"),tone:c("partial")?"danger":"muted",meta:c("partial")?"有失败项待处理":null},
      {label:"已回滚",value:c("rolledback"),tone:"muted"},
    ]}/>
    <Toolbar region
      left={<>
        <Input size="sm" prefix={<I.Search size={13}/>} placeholder="搜索批次 / 规则…" value={q} onChange={e=>setQ(e.target.value)} style={{width:220}}/>
        <Select size="sm" options={Object.keys(SF)} value={sf} onChange={e=>setSf(e.target.value)}/>
      </>}
      right={<Button size="sm" variant="primary" onClick={onGoAssets}>去资产库新建</Button>}/>
    <div style={{flex:1,minHeight:0,display:"flex"}}>
      <window.GDResponsiveTable density="regular" rowKey="id" onRowClick={r=>onOpen(r.id)} maxHeight="100%" style={{flex:1,minHeight:0,border:"none",borderRadius:0}}
        columns={[
          {priority:"essential",key:"name",label:"批次",render:r=><div style={{display:"flex",flexDirection:"column",gap:2}}><span style={{fontSize:13,color:"var(--text-1)",fontWeight:500}}>{r.name}</span><span style={{fontSize:11,color:"var(--gd-text-faint)"}}>{r.rule}</span></div>},
          {priority:"secondary",key:"target",label:"目标",numeric:true,width:76,render:r=><span style={{fontFamily:"var(--font-mono)",fontSize:12}}>{r.target.toLocaleString()}</span>},
          {priority:"secondary",key:"where",label:"平台 · 账户",render:r=><div style={{display:"flex",flexDirection:"column",gap:2}}><span style={{fontSize:12}}>{r.platform}</span><span style={{fontSize:11,color:"var(--gd-text-faint)"}}>{r.account}</span></div>},
          {priority:"supplementary",key:"created",label:"创建",width:92,render:r=><span style={{fontSize:12,color:"var(--gd-text-muted)"}}>{r.created}</span>},
          {priority:"essential",key:"status",label:"状态",width:92,render:r=>jobBadge(r.status)},
          {priority:"secondary",key:"progress",label:"进度",width:150,render:r=><ProgCell job={r}/>},
          {priority:"supplementary",key:"result",label:"结果",render:r=>r.status==="draft"?<span style={{fontSize:12,color:"var(--gd-text-faint)"}}>自动 {r.auto} · 人工 {r.manual} · 冲突 {r.conflict}</span>:<ResultChips res={r.result}/>},
          {priority:"secondary",key:"risk",label:"风险",width:72,render:r=>riskBadge(r.risk)||<span style={{color:"var(--gd-text-faint)",fontSize:12}}>—</span>},
          {priority:"essential",key:"act",label:"",width:40,align:"right",render:()=><I.ChevronRight size={14} style={{color:"var(--gd-text-faint)"}}/>},
        ]}
        rows={rows} emptyText="没有匹配的批量任务"
        footer={<span style={{fontSize:11,color:"var(--gd-text-faint)"}}>共 {rows.length} 个批次 · 点击行查看详情与执行 · 执行结果记入「操作历史」</span>}/>
    </div>
  </div>;
}

// ---------- 详情 ----------
function BatchDetail({job,onBack,onGoInbox,onGoConflicts,onGoHistory}){
  const I=window.GDI;
  const D=window.GD_DATA;
  const isDraft=job.status==="draft";
  const [tab,setTab]=React.useState("all");
  const [excluded,setExcluded]=React.useState([]);
  const [confirm,setConfirm]=React.useState(false);
  const [ack,setAck]=React.useState(false);
  const [phase,setPhase]=React.useState(job.status==="draft"?"plan":job.status==="running"?"run":"done");
  const [prog,setProg]=React.useState(job.status==="running"?job.progress:job.status==="draft"?0:100);
  const diffs=D.diffs.map(d=>excluded.includes(d.id)?{...d,state:"excluded"}:d);
  const counts={all:diffs.length,auto:diffs.filter(d=>d.state==="auto").length,manual:diffs.filter(d=>d.state==="manual").length,conflict:diffs.filter(d=>d.state==="conflict").length,excluded:diffs.filter(d=>d.state==="excluded").length};
  const submitCount=(job.auto!=null?job.auto:811)-excluded.length;
  const highRiskRows=diffs.filter(d=>String(d.risk).startsWith("高")&&d.state!=="excluded");
  const highRiskCount=highRiskRows.length;
  const rows=tab==="all"?diffs:diffs.filter(d=>d.state===tab);
  React.useEffect(()=>{
    if(phase!=="run")return;
    const t=setInterval(()=>setProg(p=>{if(p>=100){clearInterval(t);setPhase("done");return 100;}return p+4;}),120);
    return()=>clearInterval(t);
  },[phase]);
  const stateBadge=s=>s==="auto"?<Badge tone="sync" mono={false}>自动</Badge>:s==="manual"?<Badge tone="warning" mono={false}>人工</Badge>:s==="conflict"?<Badge tone="danger" mono={false}>冲突</Badge>:<Badge mono={false}>已排除</Badge>;
  const res=isDraft?{ok:789,waiting:5,retry:3,unknown:2,manual:12,failed:0}:(job.result||{ok:0});
  const isRolled=job.status==="rolledback";

  const header=<div style={{display:"flex",alignItems:"center",gap:12,padding:"14px 18px",borderBottom:"1px solid var(--gd-line)",flex:"none"}}>
    <Button size="sm" variant="ghost" icon={<I.ChevronLeft size={15}/>} onClick={onBack}>批量任务</Button>
    <span style={{fontSize:15,fontWeight:600}}>{job.name}</span>
    <span style={{fontSize:12,color:"var(--gd-text-faint)"}}>{job.rule} · {job.target.toLocaleString()} 个域名</span>
    <span style={{marginLeft:"auto",display:"flex",gap:8,alignItems:"center"}}>{riskBadge(job.risk)}{jobBadge(phase==="run"?"running":(phase==="done"&&isDraft)?((res.retry||res.unknown)?"partial":"done"):job.status)}</span>
  </div>;

  const planBody=<>
    <Panel>
      <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:10}}>
        <KpiStat label="目标域名" value={job.target} meta="2 平台 · 3 账户"/>
        <KpiStat label="可自动执行" value={job.auto}/>
        <KpiStat label="需人工" value={job.manual} tone="warning"/>
        <KpiStat label="高风险" value={highRiskCount} tone="danger" meta="Nameserver 变更"/>
        <KpiStat label="冲突" value={job.conflict} tone="danger" meta="同字段被远端修改"/>
        <KpiStat label="预计时长" value="6 分" meta="最大价格变化 −$3,000"/>
      </div>
    </Panel>
    <Panel flush title="分组">
      <div>{D.groups.map(g=><div key={g.id} style={{display:"flex",alignItems:"center",gap:12,padding:"9px 14px",borderBottom:"1px solid var(--gd-line)",fontSize:13,cursor:"pointer"}}
        onMouseEnter={e=>e.currentTarget.style.background="var(--gd-panel-raised)"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
        <span style={{width:110,fontWeight:500,color:g.platform==="冲突"?"var(--gd-danger)":undefined}}>{g.platform}</span>
        <span style={{width:90,color:"var(--gd-text-muted)"}}>{g.account}</span>
        <span style={{flex:1,display:"flex",alignItems:"center",gap:8}}>{g.action}{g.risk==="high"&&<Badge tone="danger" mono={false}>高风险</Badge>}</span>
        <span style={{color:"var(--gd-text-faint)",fontSize:12}}>{g.method}</span>
        <span style={{fontFamily:"var(--font-mono)",fontVariantNumeric:"tabular-nums",width:56,textAlign:"right"}}>{g.count.toLocaleString()}</span>
        <I.ChevronRight size={13} style={{color:"var(--gd-text-faint)"}}/>
      </div>)}</div>
    </Panel>
    <div style={{display:"flex",flexDirection:"column",gap:8}}>
      <Tabs active={tab} onChange={setTab} items={[{key:"all",label:"全部",count:counts.all},{key:"auto",label:"可自动执行",count:counts.auto},{key:"manual",label:"需人工",count:counts.manual},{key:"conflict",label:"冲突",count:counts.conflict},{key:"excluded",label:"已排除",count:counts.excluded}]}/>
      <window.GDResponsiveTable density="compact" rowKey="id"
        columns={[
          {priority:"essential",key:"domain",label:"域名",render:r=><span style={{fontFamily:"var(--font-mono)",fontSize:12}}>{r.domain}</span>},
          {priority:"essential",key:"field",label:"字段",muted:true,width:92},
          {priority:"essential",key:"diff",label:"旧值 → 新值",render:r=><DiffValue oldValue={r.oldV} newValue={r.newV}/>},
          {priority:"supplementary",key:"src",label:"来源",muted:true},
          {priority:"secondary",key:"risk",label:"风险",render:r=>String(r.risk).startsWith("高")?<span style={{color:"var(--gd-danger)",fontSize:12,display:"inline-flex",alignItems:"center",gap:4}}><I.AlertTriangle size={12}/>{r.risk}</span>:String(r.risk).startsWith("中")?<span style={{color:"var(--gd-warning)",fontSize:12}}>{r.risk}</span>:<span style={{color:"var(--gd-text-faint)",fontSize:12}}>{r.risk}</span>},
          {priority:"secondary",key:"method",label:"执行",muted:true,width:70},
          {priority:"essential",key:"state",label:"状态",render:r=>stateBadge(r.state),width:86},
          {priority:"essential",key:"act",label:"",width:60,align:"right",render:r=>r.state!=="excluded"?<Button size="sm" variant="ghost" onClick={()=>setExcluded(x=>[...x,r.id])}>排除</Button>:<Button size="sm" variant="ghost" onClick={()=>setExcluded(x=>x.filter(i=>i!==r.id))}>恢复</Button>},
        ]}
        rows={rows} emptyText="此分类下没有项目"
        footer={<span style={{fontSize:11,color:"var(--gd-text-faint)"}}>预览 {rows.length} / {job.target} 行 · 冲突项不会提交</span>}/>
    </div>
    <div style={{display:"flex",alignItems:"center",gap:12,background:"var(--gd-panel-raised)",border:"1px solid var(--gd-line-strong)",borderRadius:7,padding:"10px 14px",boxShadow:"var(--shadow-raised)"}}>
      <span style={{fontSize:13}}>将提交 <b style={{fontFamily:"var(--font-mono)",color:"var(--gd-blue)"}}>{submitCount}</b> 项{highRiskCount>0&&<> · 含 <b style={{fontFamily:"var(--font-mono)",color:"var(--gd-danger)"}}>{highRiskCount}</b> 项高风险</>} · 冲突 {job.conflict} 项已排除 · 人工 {job.manual} 项转收件箱</span>
      <span style={{marginLeft:"auto",display:"flex",gap:8}}>
        <Button onClick={onBack}>取消</Button>
        <Button variant="primary" onClick={()=>setConfirm(true)}>确认并开始执行</Button>
      </span>
    </div>
  </>;

  const runView=()=>{
    const pct=Math.min(prog,100),okN=Math.round(pct/100*789),csvN=Math.round(pct/100*12);
    return <Panel title="正在执行" actions={<Badge tone="sync">RUNNING</Badge>}>
      <div style={{display:"flex",flexDirection:"column",gap:14}}>
        <ProgressBar segments={[{value:pct,tone:"sync"}]} height={8}/>
        <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:10}}>
          <KpiStat label="成功" value={okN} tone="body"/><KpiStat label="等待确认" value={0} meta="远端已接受"/>
          <KpiStat label="可安全重试" value={0} tone="danger"/><KpiStat label="结果未知" value={0} tone="warning"/>
          <KpiStat label="人工处理" value={csvN}/><KpiStat label="最终失败" value={0}/>
        </div>
        <span style={{fontSize:12,color:"var(--gd-text-muted)"}}>{job.platform} · API 限速 2 req/s · 预计剩余 {Math.max(0,Math.round((100-pct)*2.4/10))} 秒 · 可随时暂停</span>
      </div>
    </Panel>;
  };
  const doneView=()=>{
    if(isRolled)return <Panel title="批次已回滚" actions={<Badge mono={false}>已回滚</Badge>}>
      <div style={{display:"flex",flexDirection:"column",gap:14}}>
        <div style={{border:"1px solid var(--gd-line-strong)",background:"var(--gd-panel-raised)",borderRadius:7,padding:"11px 13px",fontSize:12,color:"var(--gd-text)",lineHeight:1.5}}>此批次的 {job.target} 项修改已整体回滚至 <b style={{fontFamily:"var(--font-mono)"}}>Revision {job.rolledTo}</b>。回滚生成了新的 Revision，原修改在账本中保留可追溯。</div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <Button size="sm" variant="primary" onClick={onGoHistory}>在操作历史查看</Button>
          <Button size="sm" variant="ghost" onClick={onBack}>返回批量任务</Button>
          <span style={{marginLeft:"auto",fontSize:11,color:"var(--gd-text-faint)",fontFamily:"var(--font-mono)"}}>{job.op}</span>
        </div>
      </div>
    </Panel>;
    const T=job.target||1,hasFail=(res.retry||0)>0||(res.unknown||0)>0;
    return <>
      <Panel title="批次完成" actions={<Badge tone={hasFail?"warning":"success"} mono={false}>{hasFail?"部分失败":"已完成"}</Badge>}>
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          <ProgressBar segments={[{value:(res.ok||0)/T*100,tone:"success"},{value:(res.retry||0)/T*100,tone:"danger"},{value:(res.manual||0)/T*100,tone:"warning"}]} height={8}/>
          <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:10}}>
            <KpiStat label="成功" value={res.ok||0} tone="body"/><KpiStat label="等待确认" value={res.waiting||0} meta="远端已接受"/>
            <KpiStat label="可安全重试" value={res.retry||0} tone="danger"/><KpiStat label="结果未知" value={res.unknown||0} tone="warning" meta="只能确认"/>
            <KpiStat label="人工处理" value={res.manual||0}/><KpiStat label="最终失败" value={res.failed||0}/>
          </div>
          <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
            {hasFail&&<Button variant="primary" size="sm">重试失败项 · {res.retry||0}</Button>}
            {(res.unknown||0)>0&&<Button size="sm">检查平台状态 · {res.unknown}</Button>}
            {(res.manual||0)>0&&<Button size="sm" variant="ghost" onClick={onGoInbox}>去人工任务 · {res.manual}</Button>}
            <Button size="sm" variant="ghost" onClick={onBack}>返回批量任务</Button>
            <span style={{marginLeft:"auto",fontSize:11,color:"var(--gd-text-faint)",fontFamily:"var(--font-mono)"}}>审计已记录 · {job.op||"OP-2026-0804-11"}</span>
          </div>
        </div>
      </Panel>
      {(res.manual||0)>0&&<Panel title="人工任务已创建" actions={<Badge tone="warning" mono={false}>{res.manual} 项</Badge>}>
        <span style={{fontSize:12,color:"var(--gd-text-muted)"}}>CSV / 后台操作类修改已转「人工任务收件箱」等待处理。失败重试只选择 failed_retryable，不会重提成功项和结果未知项。</span>
      </Panel>}
    </>;
  };

  return <div data-screen-label="批量任务详情" style={{display:"flex",flexDirection:"column",height:"100%",minHeight:0}}>
    {header}
    <div style={{flex:1,minHeight:0,overflow:"auto"}}>
      {phase==="plan"
        ?<div style={{display:"flex",flexDirection:"column",gap:14,maxWidth:1080,margin:"0 auto",padding:16,width:"100%"}}>{planBody}</div>
        :<div style={{display:"flex",flexDirection:"column",gap:14,maxWidth:760,margin:"0 auto",padding:"24px 16px",width:"100%"}}>{phase==="run"?runView():doneView()}</div>}
    </div>
    <Dialog open={confirm} onClose={()=>{setConfirm(false);setAck(false);}} title="最终确认 · 批量改价" width={highRiskCount>0?544:480} danger={highRiskCount>0}
      footer={highRiskCount>0
        ?<><Button onClick={()=>{setConfirm(false);setAck(false);}}>返回修改</Button>
          <Button onClick={()=>{setConfirm(false);setAck(false);setPhase("run");setProg(0);}}>仅提交常规 · {submitCount-highRiskCount} 项</Button>
          <Button variant="danger" disabled={!ack} onClick={()=>{setConfirm(false);setAck(false);setPhase("run");setProg(0);}}>提交全部 · {submitCount} 项</Button></>
        :<><Button onClick={()=>setConfirm(false)}>返回修改</Button>
          <Button variant="primary" onClick={()=>{setConfirm(false);setPhase("run");setProg(0);}}>提交 {submitCount} 项修改</Button></>}>
      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        <span>向 <b>Atom · 主账户</b> 提交 {submitCount-12} 项 API 修改；为 <b>Afternic</b> 生成 CSV 并创建 12 项人工任务。</span>
        {highRiskCount>0&&<div style={{border:"1px solid var(--gd-danger)",background:"var(--gd-danger-tint)",borderRadius:7,padding:"11px 13px",display:"flex",flexDirection:"column",gap:9}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <I.AlertTriangle size={15} style={{color:"var(--gd-danger)",flex:"none"}}/>
            <b style={{color:"var(--gd-danger)",fontSize:13}}>高风险 · Nameserver 变更 · {highRiskCount} 个域名</b>
            <span style={{marginLeft:"auto",fontSize:11,color:"var(--gd-text-muted)"}}>可回滚</span>
          </div>
          <span style={{fontSize:12,color:"var(--gd-text)",lineHeight:1.5}}>变更后指向旧 DNS 的解析与邮件在传播完成前可能中断（约 5–30 分钟）。回滚到当前 Nameserver 同样需要传播时间。</span>
          <div style={{display:"flex",flexWrap:"wrap",gap:6}}>{highRiskRows.map(r=><span key={r.id} style={{fontFamily:"var(--font-mono)",fontSize:11,color:"var(--gd-text)",background:"var(--gd-ink)",border:"1px solid var(--gd-line)",borderRadius:4,padding:"2px 7px"}}>{r.domain}</span>)}</div>
          <div style={{borderTop:"1px solid rgba(229,115,95,0.24)",paddingTop:9}}><Checkbox checked={ack} onChange={()=>setAck(a=>!a)} label={`我已理解后果，确认对这 ${highRiskCount} 个域名执行 Nameserver 变更`}/></div>
        </div>}
        <span style={{fontSize:12,color:"var(--gd-text-muted)"}}>最大价格变化 −$3,000.00 · 预计执行 6 分钟 · 全程可暂停并接管</span>
        <span style={{fontSize:11,color:"var(--gd-text-faint)"}}>执行前基线 Revision 8,241 · 写入审计日志 · Afternic CSV 需人工上传</span>
      </div>
    </Dialog>
  </div>;
}

// ---------- 路由：列表 ↔ 详情 ----------
function BatchPreview({focus,onConsumeFocus,onBack,onGoAssets,onGoInbox,onGoConflicts,onGoHistory}){
  const jobs=window.GD_DATA.batchJobs;
  const [selId,setSelId]=React.useState(null);
  React.useEffect(()=>{if(focus){setSelId(focus==="draft"?"b-draft":focus);onConsumeFocus&&onConsumeFocus();}},[focus]);
  const job=selId?jobs.find(j=>j.id===selId):null;
  if(job)return <BatchDetail job={job} onBack={()=>setSelId(null)} onGoInbox={onGoInbox} onGoConflicts={onGoConflicts} onGoHistory={onGoHistory}/>;
  return <BatchList jobs={jobs} onOpen={setSelId} onGoAssets={onGoAssets}/>;
}
window.GDBatchPreview=BatchPreview;
