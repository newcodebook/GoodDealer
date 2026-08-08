// 恢复中心 / RecoveryCenter — J-05 + J-07 (UX_FLOWS §6 恢复中心).
// Three distinct sources, deliberately NOT merged:
//  · StaleDeviceCandidate — edits from an old device / old Epoch that couldn't auto-merge.
//  · RestoreCandidate — field diffs surfaced by a backup restore (backup time + Revision).
//  · LateExecutionEvent — execution FACTS from an old Epoch that arrived late. These are append-only
//    audit facts (source device, old Epoch, occurred/received time, evidence level), NOT discardable
//    candidates; they also appear in Operation history & the audit timeline.
// Candidates show 原始基线 Base / 候选值 Candidate / 当前云端 Cloud. Picking a candidate generates a NEW
// modification at the CURRENT Revision (never a silent overwrite). High-risk fields are excluded from
// batch apply. When Cloud is unreachable, a backup can only be viewed in an isolated read-only area.
const {Badge:RBadge,Button:RBtn,Panel:RPanel,Tabs:RTabs,StatusDot:RDot}=window.GoodDealerDesignSystem_b5b0b6;

function TriCell({label,value,tone,chosen,pickable,onPick}){
  return <div onClick={pickable?onPick:undefined} style={{flex:1,minWidth:0,display:"flex",flexDirection:"column",gap:5,background:"var(--gd-ink)",border:`1px solid ${chosen?"var(--gd-blue)":"var(--gd-line)"}`,borderRadius:5,padding:"8px 10px",cursor:pickable?"pointer":"default",transition:"border-color 120ms"}}>
    <span style={{fontSize:10,letterSpacing:"0.08em",textTransform:"uppercase",color:tone||"var(--gd-text-faint)",fontWeight:500}}>{label}</span>
    <span style={{fontFamily:"var(--font-mono)",fontVariantNumeric:"tabular-nums",fontSize:13,color:"var(--gd-text)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{value}</span>
  </div>;
}

function CandidateRow({c,kind,done,onApply,onKeep,onUndo}){
  const highRisk=c.risk==="high";
  const src=kind==="device"
    ?<>来自 {c.device} · <span style={{fontFamily:"var(--font-mono)"}}>Epoch {c.epoch}</span></>
    :<>备份 {c.backupAt} · <span style={{fontFamily:"var(--font-mono)"}}>rev {c.backupRev}</span></>;
  return <RPanel>
    <div style={{display:"flex",flexDirection:"column",gap:10,opacity:done?.55:1}}>
      <div style={{display:"flex",alignItems:"center",gap:10}}>
        <span style={{fontFamily:"var(--font-mono)",fontSize:13}}>{c.domain}</span>
        <span style={{fontSize:12,color:"var(--gd-text-muted)"}}>{c.field}</span>
        {highRisk&&<RBadge tone="danger" mono={false}>高风险</RBadge>}
        <span style={{marginLeft:"auto",fontSize:11,color:"var(--gd-text-faint)"}}>{src}</span>
      </div>
      <div style={{display:"flex",gap:10}}>
        <TriCell label="原始基线 Base" value={c.base}/>
        <TriCell label="候选值 Candidate" value={c.cand} tone="var(--gd-gold)" chosen={done==="apply"} pickable={!done} onPick={()=>onApply(c)}/>
        <TriCell label="当前云端 Cloud" value={c.cloud} tone="var(--gd-blue)" chosen={done==="keep"} pickable={!done} onPick={()=>onKeep(c)}/>
      </div>
      <div style={{display:"flex",gap:8,alignItems:"center"}}>
        {!done&&<>
          <RBtn size="sm" variant={highRisk?"danger":"primary"} onClick={()=>onApply(c)}>应用候选值</RBtn>
          <RBtn size="sm" onClick={()=>onKeep(c)}>保留云端</RBtn>
          <RBtn size="sm" variant="ghost">编辑新值</RBtn>
          {highRisk&&<span style={{fontSize:11,color:"var(--gd-danger)"}}>高风险字段不参与批量恢复，需逐项确认</span>}
        </>}
        {done&&<>
          <RBadge tone="success" mono={false}>{done==="apply"?"已生成新修改":"已保留云端"}</RBadge>
          <RBtn size="sm" variant="ghost" onClick={()=>onUndo(c)}>撤销</RBtn>
        </>}
        <span style={{marginLeft:"auto",fontSize:11,color:"var(--gd-text-faint)",fontFamily:"var(--font-mono)"}}>应用后生成 rev 8,241+ 新修改</span>
      </div>
    </div>
  </RPanel>;
}

function RecoveryCenter({addUnsynced}){
  const I=window.GDI;
  const data=window.GD_DATA.recovery;
  const [tab,setTab]=React.useState("device");
  const [done,setDone]=React.useState({}); // id -> 'apply' | 'keep'
  const apply=(c)=>{setDone(d=>({...d,[c.id]:"apply"}));addUnsynced&&addUnsynced(1);};
  const keep=(c)=>setDone(d=>({...d,[c.id]:"keep"}));
  const undo=(c)=>setDone(d=>{const n={...d};delete n[c.id];return n;});
  const batchLowRisk=(list)=>list.filter(c=>c.risk!=="high").forEach(apply);

  const devPending=data.device.filter(c=>!done[c.id]).length;
  const bkPending=data.backup.filter(c=>!done[c.id]).length;
  const highRiskN=[...data.device,...data.backup].filter(c=>c.risk==="high"&&!done[c.id]).length;
  const appliedN=Object.values(done).filter(v=>v==="apply").length;

  const kpis=[
    {label:"设备候选",value:String(devPending),tone:devPending?"warning":"muted",meta:"StaleDeviceCandidate"},
    {label:"备份候选",value:String(bkPending),tone:bkPending?"warning":"muted",meta:"RestoreCandidate"},
    {label:"迟到执行事实",value:String(data.late.length),tone:"muted",meta:"审计 · 不可丢弃"},
    {label:"高风险字段",value:String(highRiskN),tone:highRiskN?"danger":"muted",meta:"逐项确认"},
    {label:"已生成修改",value:String(appliedN),tone:appliedN?"blue":"muted",meta:"当前 Revision"},
  ];
  const MetricStrip=window.GDMetricStrip;
  const list=tab==="device"?data.device:data.backup;

  return <div data-screen-label="恢复中心" style={{display:"flex",flexDirection:"column",height:"100%",minHeight:0}}>
    <MetricStrip metrics={kpis}/>
    <div style={{flex:1,minHeight:0,overflow:"auto",padding:16}}>
      <div style={{maxWidth:920,margin:"0 auto",display:"flex",flexDirection:"column",gap:14}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <RTabs active={tab} onChange={setTab} items={[
            {key:"device",label:"设备候选",count:devPending},
            {key:"backup",label:"备份候选",count:bkPending},
            {key:"late",label:"迟到执行事实",count:data.late.length},
          ]}/>
          <span style={{marginLeft:"auto",fontSize:11,color:"var(--gd-text-faint)"}}>选择字段后在当前 Revision 生成新修改，高风险字段不批量静默恢复</span>
        </div>

        {tab!=="late"&&<>
          <div style={{display:"flex",alignItems:"center",gap:10,padding:"9px 12px",border:"1px solid var(--gd-line)",borderRadius:7,background:"var(--gd-panel)"}}>
            <RDot kind="warning" size={8}/>
            <span style={{fontSize:12,color:"var(--gd-text-muted)"}}>{tab==="device"
              ?<>旧设备（旧 Epoch）未能合并的编辑进入候选，不静默覆盖当前云端值。</>
              :<>备份恢复的字段差异以当前云端为基线；云端不可用时备份只能在隔离只读区查看。</>}</span>
            <RBtn size="sm" style={{marginLeft:"auto"}} onClick={()=>batchLowRisk(list)}>批量应用低风险候选</RBtn>
          </div>
          {list.map(c=><CandidateRow key={c.id} c={c} kind={tab} done={done[c.id]} onApply={apply} onKeep={keep} onUndo={undo}/>)}
        </>}

        {tab==="late"&&<>
          <div style={{display:"flex",alignItems:"flex-start",gap:10,padding:"10px 13px",border:"1px solid var(--gd-line-strong)",borderRadius:7,background:"var(--gd-panel)"}}>
            <I.History size={15} style={{color:"var(--gd-text-muted)",flex:"none",marginTop:1}}/>
            <span style={{fontSize:12,color:"var(--gd-text-muted)",lineHeight:1.6}}>迟到执行事实（LateExecutionEvent）是旧 Epoch 已发生的执行结果，<b style={{color:"var(--gd-text)",fontWeight:500}}>追加不可篡改</b>——只读展示，不进入可丢弃候选列表，同时出现在操作历史与审计时间线。</span>
          </div>
          <RPanel flush title="迟到执行事实 · 只读">
            {data.late.map(e=><div key={e.id} style={{display:"flex",alignItems:"center",gap:12,padding:"12px 14px",borderBottom:"1px solid var(--gd-line)"}}>
              <RDot kind={e.evidenceTone} size={8}/>
              <span style={{width:130,flex:"none",fontFamily:"var(--font-mono)",fontSize:13,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{e.domain}</span>
              <span style={{flex:1,minWidth:0,fontSize:12,color:"var(--gd-text-muted)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{e.op}</span>
              <span style={{fontSize:11,color:"var(--gd-text-faint)",whiteSpace:"nowrap"}}>{e.device} · <span style={{fontFamily:"var(--font-mono)"}}>Epoch {e.epoch}</span></span>
              <span style={{width:150,flex:"none",textAlign:"right",fontFamily:"var(--font-mono)",fontSize:11,color:"var(--gd-text-faint)",whiteSpace:"nowrap"}}>{e.occurredAt} → {e.receivedAt}</span>
              <span style={{width:130,flex:"none",display:"flex",justifyContent:"flex-end"}}><RBadge tone={e.evidenceTone} mono={false}>{e.evidence}</RBadge></span>
            </div>)}
            <div style={{padding:"9px 14px"}}><RBtn size="sm" variant="ghost" icon={<I.History size={13}/>}>在操作历史中查看</RBtn></div>
          </RPanel>
        </>}
      </div>
    </div>
  </div>;
}
window.GDRecoveryCenter=RecoveryCenter;
