// 系统配置 Config — feature flags (grouped, toggle + rollout), global defaults, maintenance, environment.
const {Panel:CoPanel,Badge:CoBadge,Button:CoBtn,Switch:CoSwitch,Select:CoSel,Input:CoInput,Dialog:CoDlg}=window.GoodDealerDesignSystem_b5b0b6;

function FlagRow({f,onToggle}){
  return <div style={{display:"flex",alignItems:"center",gap:14,padding:"12px 16px",borderBottom:"1px solid var(--gd-line)"}}>
    <div style={{flex:1,minWidth:0}}>
      <div style={{display:"flex",alignItems:"center",gap:8,minWidth:0}}><span style={{fontSize:12.5,color:"var(--text-1)",whiteSpace:"nowrap"}}>{f.name}</span><span style={{fontFamily:"var(--font-mono)",fontSize:10,color:"var(--text-3)",border:"1px solid var(--gd-line-strong)",borderRadius:3,padding:"0 5px",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",minWidth:0}}>{f.key}</span></div>
      <div style={{fontSize:11,color:"var(--text-3)",marginTop:3,lineHeight:1.5}}>{f.desc}</div>
    </div>
    <div style={{width:96,flex:"none",display:"flex",flexDirection:"column",gap:4}}>
      <div style={{display:"flex",justifyContent:"space-between",fontSize:10}}><span style={{color:"var(--text-3)"}}>灰度</span><span style={{fontFamily:"var(--font-mono)",color:f.rollout===100?"var(--gd-success)":f.enabled?"var(--gd-gold)":"var(--text-3)"}}>{f.rollout}%</span></div>
      <div style={{height:4,borderRadius:2,background:"var(--gd-line)",overflow:"hidden"}}><div style={{width:f.rollout+"%",height:"100%",background:f.enabled?(f.rollout===100?"var(--gd-success)":"var(--gd-gold)"):"var(--gd-line-strong)"}}></div></div>
    </div>
    <CoSwitch checked={f.enabled} onChange={()=>onToggle(f.key)}/>
  </div>;
}

function Config(){
  const D=window.GD_ADMIN;const I=window.GDI;
  const [flags,setFlags]=React.useState(()=>D.flags.map(f=>({...f})));
  const [maint,setMaint]=React.useState(false);
  const [dlg,setDlg]=React.useState(false);
  const toggle=key=>setFlags(fs=>fs.map(f=>f.key===key?{...f,enabled:!f.enabled,rollout:!f.enabled&&f.rollout===0?100:f.enabled?f.rollout:f.rollout}:f));
  const sections=Array.from(new Set(flags.map(f=>f.section)));
  return <div data-screen-label="系统配置" style={{padding:18,display:"grid",gridTemplateColumns:"1fr 340px",gap:14,alignItems:"start"}}>
    <div style={{display:"flex",flexDirection:"column",gap:14,minWidth:0}}>
      {sections.map(sec=><CoPanel key={sec} flush title={"功能开关 · "+sec} actions={<span style={{fontSize:11,color:"var(--text-3)"}}>{flags.filter(f=>f.section===sec&&f.enabled).length}/{flags.filter(f=>f.section===sec).length} 启用</span>}>
        {flags.filter(f=>f.section===sec).map(f=><FlagRow key={f.key} f={f} onToggle={toggle}/>)}
      </CoPanel>)}
    </div>
    <div style={{display:"flex",flexDirection:"column",gap:14,minWidth:0}}>
      <CoPanel title="全局默认" actions={<CoBtn size="sm" variant="primary">保存</CoBtn>}>
        <div style={{display:"flex",flexDirection:"column"}}>
          {[["默认试用时长",<CoSel size="sm" options={["7 天","14 天","30 天"]} value="14 天" onChange={()=>{}}/>],["默认同步间隔",<CoSel size="sm" options={["实时","每 5 分钟","每 15 分钟"]} value="每 5 分钟" onChange={()=>{}}/>],["新客户默认方案",<CoSel size="sm" options={["Starter","Professional"]} value="Professional" onChange={()=>{}}/>],["设备额度上限",<CoInput size="sm" mono value="2" onChange={()=>{}} style={{width:70}}/>]].map(([k,ctrl],i)=>
            <div key={i} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 0",borderBottom:"1px solid var(--gd-line)"}}><span style={{flex:1,fontSize:12.5,color:"var(--text-2)"}}>{k}</span>{ctrl}</div>)}
        </div>
      </CoPanel>
      <CoPanel title="维护模式">
        <div style={{display:"flex",alignItems:"flex-start",gap:12}}>
          <I.AlertTriangle size={18} style={{color:maint?"var(--gd-danger)":"var(--text-3)",flex:"none",marginTop:1}}/>
          <div style={{flex:1}}><div style={{fontSize:12.5,color:"var(--text-1)"}}>Cloud 维护模式</div><div style={{fontSize:11,color:"var(--text-3)",marginTop:3,lineHeight:1.5}}>暂停 Cloud 控制面写入与同步接收；已授权客户端继续提交本地业务并排队等待恢复。用于计划维护窗口。</div></div>
          <CoSwitch checked={maint} onChange={()=>setMaint(v=>!v)}/>
        </div>
        {maint&&<div style={{marginTop:12,padding:"9px 12px",background:"var(--gd-danger-tint)",border:"1px solid rgba(229,115,95,0.35)",borderRadius:6,fontSize:11.5,color:"var(--gd-danger)"}}>维护模式已启用 · 同步暂缓，本地提交不受 Cloud 传输阻塞</div>}
      </CoPanel>
      <CoPanel title="环境">
        <div style={{display:"flex",flexDirection:"column"}}>
          {[["环境","Production"],["区域","12 · 全球"],["构建","admin 0.9.0 · 2026-08-12"],["Sync API","v3.2.1"]].map(([k,v])=>
            <div key={k} style={{display:"flex",gap:12,padding:"7px 0",borderBottom:"1px solid var(--gd-line)",fontSize:12}}><span style={{width:70,flex:"none",color:"var(--text-3)"}}>{k}</span><span style={{color:"var(--text-1)",fontFamily:"var(--font-mono)",fontSize:11.5}}>{v}</span></div>)}
        </div>
      </CoPanel>
    </div>
  </div>;
}
window.GDConfig=Config;
