const {Badge,Button,Panel,Tabs}=window.GoodDealerDesignSystem_b5b0b6;
function TriValue({label,value,tone,chosen,onPick,pickable}){
  return <div style={{flex:1,display:"flex",flexDirection:"column",gap:5,background:"var(--gd-ink)",border:`1px solid ${chosen?"var(--gd-blue)":"var(--gd-line)"}`,borderRadius:5,padding:"8px 10px",cursor:pickable?"pointer":"default",transition:"border-color 120ms"}} onClick={pickable?onPick:undefined}>
    <span style={{fontSize:10,letterSpacing:"0.08em",textTransform:"uppercase",color:tone||"var(--gd-text-faint)",fontWeight:500}}>{label}</span>
    <span style={{fontFamily:"var(--font-mono)",fontVariantNumeric:"tabular-nums",fontSize:13,color:"var(--gd-text)"}}>{value}</span>
  </div>;
}
function ConflictCenter(){
  const [tab,setTab]=React.useState("全部");
  const [resolved,setResolved]=React.useState({});
  const all=window.GD_DATA.conflicts;
  const tabs=["全部","价格","DNS","销售状态"];
  const list=all.filter(c=>tab==="全部"||c.group===tab);
  const openCount=all.filter(c=>!resolved[c.id]).length;
  const resolve=(id,how)=>setResolved(r=>({...r,[id]:how}));
  return <div data-screen-label="冲突中心" style={{maxWidth:920,margin:"0 auto",padding:16,width:"100%",display:"flex",flexDirection:"column",gap:14}}>
    <div style={{display:"flex",alignItems:"center",gap:10}}>
      <span style={{fontSize:16,fontWeight:600}}>冲突中心</span>
      <Badge tone={openCount>0?"danger":"success"} mono={false}>{openCount>0?`${openCount} 项待裁决`:"全部已裁决"}</Badge>
      <span style={{marginLeft:"auto",fontSize:11,color:"var(--gd-text-faint)"}}>DNS、Nameserver 和 Sold 状态不提供无预览的批量覆盖</span>
    </div>
    <Tabs active={tab} onChange={setTab} items={tabs.map(t=>({key:t,label:t,count:all.filter(c=>(t==="全部"||c.group===t)&&!resolved[c.id]).length}))}/>
    {tab==="价格"&&<div style={{display:"flex",gap:8,alignItems:"center",fontSize:12,color:"var(--gd-text-muted)"}}>
      <span>对同类冲突批量应用：</span>
      <Button size="sm" onClick={()=>all.filter(c=>c.group==="价格").forEach(c=>resolve(c.id,"local"))}>全部保留本地</Button>
      <Button size="sm" onClick={()=>all.filter(c=>c.group==="价格").forEach(c=>resolve(c.id,"remote"))}>全部接受平台</Button>
    </div>}
    {list.map(c=>{const done=resolved[c.id];
      return <Panel key={c.id}>
        <div style={{display:"flex",flexDirection:"column",gap:10,opacity:done?.55:1}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <span style={{fontFamily:"var(--font-mono)",fontSize:13}}>{c.domain}</span>
            <span style={{fontSize:12,color:"var(--gd-text-muted)"}}>{c.field}</span>
            <Badge mono={false}>{c.group}</Badge>
            <span style={{marginLeft:"auto",fontSize:11,color:"var(--gd-text-faint)"}}>{c.note}</span>
          </div>
          <div style={{display:"flex",gap:10}}>
            <TriValue label="编辑基线 Base" value={c.base}/>
            <TriValue label="本地目标 Local" value={c.local} tone="var(--gd-blue)" chosen={done==="local"} pickable={!done} onPick={()=>resolve(c.id,"local")}/>
            <TriValue label="平台当前 Remote" value={c.remote} tone="var(--gd-warning)" chosen={done==="remote"} pickable={!done} onPick={()=>resolve(c.id,"remote")}/>
          </div>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            {!done&&<><Button size="sm" variant="primary" onClick={()=>resolve(c.id,"local")}>保留本地</Button>
            <Button size="sm" onClick={()=>resolve(c.id,"remote")}>接受平台</Button>
            <Button size="sm" variant="ghost">编辑新值</Button></>}
            {done&&<><Badge tone="success" mono={false}>{done==="local"?"已保留本地":"已接受平台"}</Badge>
            <Button size="sm" variant="ghost" onClick={()=>setResolved(r=>{const n={...r};delete n[c.id];return n;})}>撤销</Button></>}
            <span style={{marginLeft:"auto",fontSize:11,color:"var(--gd-text-faint)",fontFamily:"var(--font-mono)"}}>Base rev 8,203</span>
          </div>
        </div>
      </Panel>;})}
  </div>;
}
window.GDConflictCenter=ConflictCenter;
