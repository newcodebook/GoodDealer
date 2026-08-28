// 同步与基础设施健康 SyncInfra — service health, sync queue by region, incidents, connector health.
const {Panel:IPanel,Badge:IBadge,Button:IBtn,StatusDot:IDot}=window.GoodDealerDesignSystem_b5b0b6;

const SVC_TONE={ok:"success",degraded:"warning",warn:"warning",down:"danger"};
const SVC_LABEL={ok:"正常",degraded:"降级",warn:"告警",down:"故障"};

function ServiceCard({s}){
  const tone=SVC_TONE[s.status];
  return <div style={{padding:"13px 14px",border:"1px solid var(--gd-line)",borderRadius:7,background:"var(--gd-panel)",display:"flex",flexDirection:"column",gap:9}}>
    <div style={{display:"flex",alignItems:"center",gap:8}}>
      <IDot kind={tone==="success"?"success":tone==="warning"?"warning":"danger"} pulse={s.status!=="ok"}/>
      <span style={{fontSize:12.5,color:"var(--text-1)",fontWeight:500}}>{s.name}</span>
      <span style={{marginLeft:"auto"}}><IBadge tone={tone} mono={false}>{SVC_LABEL[s.status]}</IBadge></span>
    </div>
    <div style={{display:"flex",gap:16}}>
      <div style={{display:"flex",flexDirection:"column",gap:2}}><span className="gd-t-label">延迟 p95</span><span style={{fontFamily:"var(--font-mono)",fontSize:13,color:s.latency>200?"var(--gd-warning)":"var(--text-1)"}}>{s.latency?s.latency+"ms":"—"}</span></div>
      <div style={{display:"flex",flexDirection:"column",gap:2}}><span className="gd-t-label">可用性 30d</span><span style={{fontFamily:"var(--font-mono)",fontSize:13,color:s.uptime<99.5?"var(--gd-warning)":"var(--text-1)"}}>{s.uptime}%</span></div>
    </div>
    <span style={{fontSize:11,color:"var(--text-3)"}}>{s.note}</span>
  </div>;
}

function SyncInfra(){
  const D=window.GD_ADMIN;const I=window.GDI;const MetricStrip=window.GDMetricStrip;
  const queues=[["us-east-1",52,40,"ok"],["eu-west-2",31,55,"ok"],["ap-east-1",28,48,"ok"],["me-south-1",17,210,"warn"],["ap-northeast-1",12,62,"ok"]];
  const maxQ=Math.max(...queues.map(q=>q[1]));
  const connectors=[["Atom","ok","API · 511k Listing 同步"],["Afternic","warn","回调延迟 340ms · CSV 人工"],["Cloudflare","ok","DNS · 601k 区域"],["Spaceship","warn","会话过期率 8%"],["Dynadot","ok","注册商 API"],["SellerHub","ok","已启用"]];
  return <div data-screen-label="同步与基础设施" style={{display:"flex",flexDirection:"column",minHeight:0}}>
    <MetricStrip metrics={[
      {label:"系统可用性",value:"99.2%",tone:"success",meta:"30 天滚动"},
      {label:"同步队列",value:"128",meta:"跨 12 区域"},
      {label:"API 延迟 p95",value:"42ms",tone:"success",meta:"Sync API"},
      {label:"错误率",value:"0.06%",tone:"success",meta:"近 1 小时"},
      {label:"活跃事件",value:"1",tone:"warning",meta:"1 服务降级"},
      {label:"连接器健康",value:"98.1%",tone:"warning",meta:"3 平台会话过期偏高"},
    ]}/>
    <div style={{padding:18,display:"grid",gridTemplateColumns:"1fr 360px",gap:14,alignItems:"start"}}>
      <div style={{display:"flex",flexDirection:"column",gap:14,minWidth:0}}>
        <IPanel title="服务健康" actions={<span style={{fontSize:11,color:"var(--text-3)"}}>自动探针 · 60s</span>}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>{D.services.map(s=><ServiceCard key={s.name} s={s}/>)}</div>
        </IPanel>
        <IPanel flush title="活跃与近期事件">
          {D.incidents.map((inc,i)=><div key={inc.id} style={{display:"flex",alignItems:"center",gap:12,padding:"12px 16px",borderBottom:i<D.incidents.length-1?"1px solid var(--gd-line)":"none"}}>
            <IDot kind={inc.sev==="minor"?"warning":inc.sev==="major"?"danger":"neutral"}/>
            <div style={{flex:1,minWidth:0}}><div style={{fontSize:12.5,color:"var(--text-1)"}}>{inc.title}</div><div style={{fontSize:11,color:"var(--text-3)",fontFamily:"var(--font-mono)"}}>{inc.id} · {inc.svc} · 始于 {inc.started}</div></div>
            <IBadge tone={inc.status==="监控中"?"warning":inc.status==="已缓解"?"sync":"neutral"} mono={false}>{inc.status}</IBadge>
          </div>)}
        </IPanel>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:14,minWidth:0}}>
        <IPanel title="同步队列 · 按区域">
          <div style={{display:"flex",flexDirection:"column",gap:11}}>
            {queues.map(([r,q,lag,st])=><div key={r} style={{display:"flex",flexDirection:"column",gap:5}}>
              <div style={{display:"flex",alignItems:"center",fontSize:11.5}}><span style={{fontFamily:"var(--font-mono)",color:"var(--text-2)",flex:1}}>{r}</span><span style={{fontFamily:"var(--font-mono)",color:st==="warn"?"var(--gd-warning)":"var(--text-3)"}}>{q} 项 · {lag}ms</span></div>
              <div style={{height:5,borderRadius:3,background:"var(--gd-line)",overflow:"hidden"}}><div style={{width:(q/maxQ*100)+"%",height:"100%",background:st==="warn"?"var(--gd-warning)":"var(--gd-blue)"}}></div></div>
            </div>)}
          </div>
        </IPanel>
        <IPanel flush title="连接器健康" actions={<span style={{fontSize:11,color:"var(--text-3)"}}>平台侧</span>}>
          {connectors.map((c,i)=><div key={c[0]} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 16px",borderBottom:i<connectors.length-1?"1px solid var(--gd-line)":"none"}}>
            <IDot kind={c[1]==="ok"?"success":"warning"}/>
            <span style={{fontSize:12.5,color:"var(--text-1)",width:78,flex:"none"}}>{c[0]}</span>
            <span style={{fontSize:11,color:"var(--text-3)",flex:1,minWidth:0,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{c[2]}</span>
          </div>)}
        </IPanel>
      </div>
    </div>
  </div>;
}
window.GDSyncInfra=SyncInfra;
