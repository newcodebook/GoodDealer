// 接入 / Onboarding — first-run wizard. The journey entrance.
// Steps: 欢迎 → 设备门禁(签发 ActiveDeviceLease) → 连接账户 → 首次导入 → 完成.
// Hardware-wallet mind: this device becomes Active, local key issues the lease (Epoch 1).
const {Button:OBtn,Input:OInput,Badge:OBadge,ProgressBar:OProg,StatusDot:ODot}=window.GoodDealerDesignSystem_b5b0b6;

const STEPS=[["welcome","欢迎"],["device","设备门禁"],["connect","连接账户"],["import","首次导入"],["done","完成"]];
function Stepper({idx}){
  return <div style={{width:180,flex:"none",borderRight:"1px solid var(--gd-line)",background:"var(--gd-panel)",padding:"20px 16px",display:"flex",flexDirection:"column",gap:3}}>
    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:18,padding:"0 4px"}}>
      <img src="../../assets/logo/mark-16.svg" width="18" height="18" alt=""/>
      <span style={{fontSize:13,fontWeight:600,letterSpacing:"-0.01em",color:"var(--text-1)"}}>GoodDealer</span>
    </div>
    {STEPS.map(([k,l],i)=>{const st=i<idx?"done":i===idx?"cur":"up";
      return <div key={k} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 4px",fontSize:13,color:st==="up"?"var(--text-3)":"var(--text-1)"}}>
        <span style={{width:20,height:20,flex:"none",borderRadius:"50%",display:"inline-flex",alignItems:"center",justifyContent:"center",fontFamily:"var(--font-mono)",fontSize:11,
          border:st==="cur"?"1px solid var(--gd-gold)":"1px solid var(--gd-line-strong)",
          background:st==="done"?"var(--gd-gold)":"transparent",color:st==="done"?"#0A0B0F":st==="cur"?"var(--gd-gold)":"var(--text-3)"}}>
          {st==="done"?<window.GDI.Check size={12}/>:i+1}</span>
        {l}
      </div>;})}
    <div style={{marginTop:"auto",fontSize:10,color:"var(--gd-text-faint)",lineHeight:1.6,padding:"0 4px"}}>本地执行 · 云端同步</div>
  </div>;
}
const Field=({label,children})=><div style={{display:"flex",flexDirection:"column",gap:6}}><span className="gd-t-label">{label}</span>{children}</div>;

function ConnCard({name,meta,connected,onToggle}){
  return <button onClick={onToggle} style={{textAlign:"left",display:"flex",alignItems:"center",gap:11,padding:"11px 13px",borderRadius:7,cursor:"pointer",width:"100%",
    border:`1px solid ${connected?"var(--gd-success)":"var(--gd-line-strong)"}`,background:connected?"rgba(92,174,125,0.08)":"var(--gd-panel)",transition:"all 120ms"}}>
    <ODot kind={connected?"success":"neutral"}/>
    <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,color:"var(--text-1)"}}>{name}</div><div style={{fontSize:11,color:"var(--gd-text-faint)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{meta}</div></div>
    {connected?<OBadge tone="success" mono={false}>已连接</OBadge>:<span style={{fontSize:12,color:"var(--gd-blue)"}}>连接</span>}
  </button>;
}

function Onboarding({onFinish,onSkip,startIdx=0}){
  const I=window.GDI;
  const [idx,setIdx]=React.useState(startIdx);
  const [dev,setDev]=React.useState("MacBook Pro");
  const [activating,setActivating]=React.useState(false);
  const [activated,setActivated]=React.useState(false);
  const [conns,setConns]=React.useState({});
  const [importing,setImporting]=React.useState(false);
  const [pct,setPct]=React.useState(0);
  const [imported,setImported]=React.useState(false);
  const toggle=k=>setConns(c=>({...c,[k]:!c[k]}));
  const connectedCount=Object.values(conns).filter(Boolean).length;
  const activate=()=>{setActivating(true);setTimeout(()=>{setActivating(false);setActivated(true);},1300);};
  const runImport=()=>{setImporting(true);setPct(0);const t=setInterval(()=>setPct(p=>{if(p>=100){clearInterval(t);setImporting(false);setImported(true);return 100;}return p+4;}),40);};

  const PROVIDERS={
    registrar:[["Spaceship","主注册商 · OAuth"],["Namecheap","OAuth"],["Dynadot","API Key"]],
    dns:[["Cloudflare","API Token"]],
    platform:[["Atom","OAuth · API"],["Afternic","CSV · 人工"]],
  };
  const foot=(back,next,nextLabel,nextDisabled,nextVariant)=><div style={{marginTop:"auto",display:"flex",alignItems:"center",gap:10,paddingTop:16}}>
    {back!=null?<OBtn variant="ghost" onClick={back}>返回</OBtn>:<OBtn variant="ghost" onClick={onSkip}>跳过接入</OBtn>}
    <span style={{flex:1}}></span>
    <span style={{fontFamily:"var(--font-mono)",fontSize:11,color:"var(--gd-text-faint)"}}>{idx+1} / {STEPS.length}</span>
    <OBtn variant={nextVariant||"primary"} disabled={nextDisabled} onClick={next}>{nextLabel}</OBtn>
  </div>;

  const panes=[
    // 0 welcome
    <div key="w" style={{display:"flex",flexDirection:"column",height:"100%"}}>
      <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:16,margin:"auto 0",textAlign:"center",paddingTop:12}}>
        <img src="../../assets/logo/mark.svg" width="76" height="76" alt=""/>
        <div><div style={{fontSize:22,fontWeight:600,letterSpacing:"-0.02em",color:"var(--text-1)"}}>GoodDealer</div>
        <div style={{fontSize:14,color:"var(--gd-text-muted)",marginTop:6}}>本地执行 · 云端同步的域名资产终端</div></div>
        <div style={{display:"flex",gap:10,marginTop:8}}>
          {[["私人银行级掌控","批量差异预览 · 精确到项的确认"],["硬件钱包式门禁","执行权绑定单台 Active 设备"],["可回滚审计","每次变更皆为 Revision"]].map(v=>
            <div key={v[0]} style={{width:150,padding:"12px 13px",border:"1px solid var(--gd-line)",borderRadius:8,background:"var(--gd-panel)",display:"flex",flexDirection:"column",gap:5}}>
              <span style={{fontSize:12,fontWeight:500,color:"var(--text-1)"}}>{v[0]}</span><span style={{fontSize:11,color:"var(--gd-text-faint)",lineHeight:1.5}}>{v[1]}</span></div>)}
        </div>
      </div>
      {foot(null,()=>setIdx(1),"开始接入",false)}
    </div>,
    // 1 device
    <div key="d" style={{display:"flex",flexDirection:"column",height:"100%"}}>
      <div style={{display:"flex",flexDirection:"column",gap:16,marginTop:6}}>
        <div><div style={{fontSize:17,fontWeight:600,color:"var(--text-1)"}}>设备门禁</div><div style={{fontSize:12,color:"var(--gd-text-muted)",marginTop:4}}>将此设备设为<b style={{color:"var(--gd-gold)",fontWeight:500}}>执行设备（Active）</b>。本地密钥签发 ActiveDeviceLease，同一时刻仅一台设备可执行写操作。</div></div>
        <div style={{display:"flex",gap:14,alignItems:"flex-start",padding:"16px",border:"1px solid var(--gd-line)",borderRadius:9,background:"var(--gd-panel)"}}>
          <img src="../../assets/icons/keyhole.svg" width="40" height="40" alt="" style={{flex:"none",opacity:activated?1:.8}}/>
          <div style={{flex:1,display:"flex",flexDirection:"column",gap:12}}>
            <Field label="设备名称"><OInput size="md" value={dev} onChange={e=>setDev(e.target.value)} disabled={activating||activated} style={{maxWidth:280}}/></Field>
            {!activated?<div style={{display:"flex",alignItems:"center",gap:10}}>
              <OBtn variant="primary" disabled={activating||!dev} onClick={activate} icon={activating?<I.RefreshCw size={14} style={{animation:"gd-spinner 1s linear infinite"}}/>:<I.Shield size={14}/>}>{activating?"正在安全激活…":"生成本地密钥并激活"}</OBtn>
              {activating&&<span style={{fontSize:12,color:"var(--gd-blue)"}}>校验设备指纹 · 签发 Lease</span>}
            </div>:<div style={{display:"flex",alignItems:"center",gap:10}}>
              <ODot kind="active"/><OBadge tone="gold">ACTIVE</OBadge>
              <span style={{fontSize:12,color:"var(--gd-text-muted)"}}>已签发 ActiveDeviceLease · <span style={{fontFamily:"var(--font-mono)",color:"var(--gd-gold)"}}>Epoch 1</span></span>
            </div>}
          </div>
        </div>
        <span style={{fontSize:11,color:"var(--gd-text-faint)",lineHeight:1.6}}>密钥仅存于本设备安全区，永不上云。日后可在设置 · 设备与运行态中移交执行权到其它设备。</span>
      </div>
      {foot(()=>setIdx(0),()=>setIdx(2),"继续",!activated)}
    </div>,
    // 2 connect
    <div key="c" style={{display:"flex",flexDirection:"column",height:"100%"}}>
      <div style={{display:"flex",flexDirection:"column",gap:14,marginTop:6}}>
        <div><div style={{fontSize:17,fontWeight:600,color:"var(--text-1)"}}>连接账户</div><div style={{fontSize:12,color:"var(--gd-text-muted)",marginTop:4}}>连接注册商、DNS 与交易平台，至少一项。凭据经本地密钥加密保存。</div></div>
        {[["注册商 · Nameserver 处理平台","registrar"],["DNS 提供商 · 记录处理平台","dns"],["交易平台 · 改价上下架处理平台","platform"]].map(([t,g])=>
          <div key={g} style={{display:"flex",flexDirection:"column",gap:7}}>
            <span className="gd-t-label">{t}</span>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8}}>{PROVIDERS[g].map(([n,m])=><ConnCard key={n} name={n} meta={m} connected={!!conns[g+":"+n]} onToggle={()=>toggle(g+":"+n)}/>)}</div>
          </div>)}
      </div>
      {foot(()=>setIdx(1),()=>setIdx(3),connectedCount>0?`继续 · 已连接 ${connectedCount}`:"继续",connectedCount===0)}
    </div>,
    // 3 import
    <div key="i" style={{display:"flex",flexDirection:"column",height:"100%"}}>
      <div style={{display:"flex",flexDirection:"column",gap:16,marginTop:6}}>
        <div><div style={{fontSize:17,fontWeight:600,color:"var(--text-1)"}}>首次导入</div><div style={{fontSize:12,color:"var(--gd-text-muted)",marginTop:4}}>从已连接的 {connectedCount} 个账户拉取域名、Listing 与 DNS 状态，建立本地基线 Revision。</div></div>
        {!imported?<div style={{padding:"18px",border:"1px solid var(--gd-line)",borderRadius:9,background:"var(--gd-panel)",display:"flex",flexDirection:"column",gap:14}}>
          {importing||pct>0?<><OProg segments={[{value:pct,tone:"sync"}]} height={8}/><span style={{fontFamily:"var(--font-mono)",fontSize:12,color:"var(--gd-text-muted)"}}>{pct}% · 正在拉取域名与 Listing…</span></>
            :<div style={{display:"flex",alignItems:"center",gap:12}}><I.RefreshCw size={16} style={{color:"var(--gd-text-muted)"}}/><span style={{fontSize:13,color:"var(--gd-text-muted)"}}>准备导入 · 预计 823 域名</span><span style={{flex:1}}></span><OBtn variant="primary" onClick={runImport}>开始导入</OBtn></div>}
        </div>:<div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10}}>
          {[["域名","823",null],["Listing","692",null],["冲突","6","danger"],["基线","rev 1","gold"]].map(k=><div key={k[0]} style={{padding:"14px",border:"1px solid var(--gd-line)",borderRadius:8,background:"var(--gd-panel)",display:"flex",flexDirection:"column",gap:5}}>
            <span className="gd-t-label">{k[0]}</span><span className="gd-t-metric-sm" style={{color:k[2]==="danger"?"var(--gd-danger)":k[2]==="gold"?"var(--gd-gold)":"var(--text-1)",fontFamily:k[0]==="基线"?"var(--font-mono)":undefined}}>{k[1]}</span></div>)}
        </div>}
        {imported&&<span style={{fontSize:12,color:"var(--gd-text-muted)"}}>导入完成 · 6 项字段冲突已标记，可在冲突中心人工裁决。</span>}
      </div>
      {foot(()=>setIdx(2),()=>setIdx(4),"继续",!imported)}
    </div>,
    // 4 done
    <div key="f" style={{display:"flex",flexDirection:"column",height:"100%"}}>
      <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:14,margin:"auto 0",textAlign:"center"}}>
        <span style={{width:60,height:60,borderRadius:"50%",background:"rgba(92,174,125,0.14)",border:"1px solid var(--gd-success)",display:"inline-flex",alignItems:"center",justifyContent:"center"}}><I.Check size={30} style={{color:"var(--gd-success)"}}/></span>
        <div><div style={{fontSize:19,fontWeight:600,color:"var(--text-1)"}}>接入完成</div><div style={{fontSize:13,color:"var(--gd-text-muted)",marginTop:6}}>{dev} 已激活为执行设备 · 823 域名已导入 · 基线 rev 1</div></div>
        <div style={{display:"flex",gap:8,alignItems:"center",fontSize:12,color:"var(--gd-text-faint)"}}><ODot kind="active"/>Active · Epoch 1<span style={{color:"var(--gd-line-strong)"}}>·</span><ODot kind="sync"/>云端同步就绪</div>
      </div>
      <div style={{marginTop:"auto",display:"flex",paddingTop:16}}><span style={{flex:1}}></span><OBtn variant="primary" onClick={()=>onFinish?onFinish():setIdx(0)}>进入 GoodDealer</OBtn></div>
    </div>,
  ];

  return <div style={{width:"100%",height:"100%",display:"flex",alignItems:"center",justifyContent:"center"}}>
    <div style={{width:860,height:560,maxWidth:"100%",maxHeight:"100%",display:"flex",background:"var(--surface-app)",border:"1px solid var(--gd-line-strong)",borderRadius:"var(--radius-lg)",boxShadow:"var(--shadow-overlay)",overflow:"hidden"}}>
      <Stepper idx={idx}/>
      <div style={{flex:1,minWidth:0,padding:"22px 26px",display:"flex",flexDirection:"column"}}>{panes[idx]}</div>
    </div>
  </div>;
}
window.GDOnboarding=Onboarding;
