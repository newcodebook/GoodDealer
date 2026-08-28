// 概览 Dashboard — account home: license period, device lease, cloud sync, activity, portfolio snapshot.
const {Panel,Badge,Button,Money,StatusDot,ProgressBar,Switch}=window.GoodDealerDesignSystem_b5b0b6;

function ActivityRow({a}){
  const I=window.GDI;
  const map={sync:["RefreshCw","blue"],sale:["Coins","gold"],device:["Monitor","text-muted"],billing:["Receipt","text-muted"],security:["ShieldCheck",a.flag?"warning":"success"]};
  const [ic,tone]=map[a.kind]||["CircleAlert","text-muted"];const Ic=I[ic];
  const col=tone.startsWith("text")?`var(--${tone})`:`var(--gd-${tone})`;
  return <div style={{display:"flex",gap:11,padding:"11px 0",borderBottom:"1px solid var(--gd-line)"}}>
    <span style={{width:26,height:26,flex:"none",borderRadius:6,background:"var(--gd-panel-raised)",border:"1px solid var(--gd-line)",display:"flex",alignItems:"center",justifyContent:"center",color:col}}><Ic size={14}/></span>
    <div style={{flex:1,minWidth:0,display:"flex",flexDirection:"column",gap:2}}>
      <span style={{fontSize:12.5,color:"var(--text-1)"}}>{a.text}</span>
      <span style={{fontSize:11,color:"var(--text-3)",fontFamily:"var(--font-mono)"}}>{a.meta}</span>
    </div>
    {a.value!=null&&<Money amount={a.value} size={12}/>}
    <span style={{fontSize:11,color:"var(--text-3)",fontFamily:"var(--font-mono)",flex:"none",width:44,textAlign:"right"}}>{a.time}</span>
  </div>;
}

function DeviceMini({d,onManage}){
  const I=window.GDI;
  const m={active:{dot:"active",badge:<Badge tone="gold">ACTIVE</Badge>,note:"持有执行权"},standby:{dot:"standby",badge:<Badge mono={false}>Standby</Badge>,note:"待命"},sunset:{dot:"neutral",badge:<span style={{fontSize:10,color:"var(--text-3)",fontFamily:"var(--font-mono)",border:"1px solid var(--gd-line-strong)",borderRadius:3,padding:"0 5px",lineHeight:"16px"}}>RETAINED</span>,note:"本地只读延续"}}[d.state];
  return <div style={{display:"flex",alignItems:"center",gap:11,padding:"10px 0",borderBottom:"1px solid var(--gd-line)",opacity:d.state==="sunset"?.6:1}}>
    <I.Monitor size={16} style={{color:d.state==="active"?"var(--gd-gold)":"var(--gd-text-muted)",flex:"none"}}/>
    <div style={{minWidth:0,flex:1,display:"flex",flexDirection:"column",gap:2}}>
      <span style={{fontSize:12.5,color:"var(--text-1)",display:"flex",alignItems:"center",gap:6}}>{d.name}{d.self&&<span style={{fontSize:9.5,color:"var(--text-3)",border:"1px solid var(--gd-line-strong)",borderRadius:3,padding:"0 4px",lineHeight:"14px"}}>本机</span>}</span>
      <span style={{fontSize:11,color:"var(--text-3)"}}>{d.os}</span>
    </div>
    <span style={{display:"flex",alignItems:"center",gap:7}}><StatusDot kind={m.dot}/>{m.badge}{d.state==="active"&&<span style={{fontFamily:"var(--font-mono)",fontSize:11,color:"var(--gd-gold)"}}>Epoch {d.epoch}</span>}</span>
  </div>;
}

function Dashboard({go}){
  const D=window.GD_ACCOUNT;const I=window.GDI;const MetricStrip=window.GDMetricStrip;
  const P=D.portfolio.slice(0,6);
  return <div data-screen-label="概览" style={{display:"flex",flexDirection:"column",minHeight:0}}>
    <MetricStrip metrics={[
      {label:"组合估值",value:"$284,120.00",tone:"gold",meta:"较上月 +2.1% · 云端截至 14:02"},
      {label:"域名总数",value:"1,024",meta:"Spaceship 812 · 其他 212"},
      {label:"已绑定设备",value:"2 / 2",meta:"MacBook Pro Active · iPhone Standby"},
      {label:"License 剩余",value:"136 天",tone:"warning",meta:"年付 · 至 2026-12-31",onClick:()=>go("license")},
      {label:"云端同步",value:"SYNCED",tone:"success",meta:"rev 8,241 · 无未同步项"},
    ]}/>
    <div style={{padding:18,display:"flex",flexDirection:"column",gap:14}}>
      <div style={{display:"grid",gridTemplateColumns:"1fr 340px",gap:14,alignItems:"start"}}>
        <div style={{display:"flex",flexDirection:"column",gap:14,minWidth:0}}>
          <Panel title="订阅与许可" actions={<Button size="sm" onClick={()=>go("license")}>管理订阅</Button>}>
            <div style={{display:"flex",alignItems:"flex-start",gap:14}}>
              <img src="../../assets/icons/keyhole.svg" width="34" height="34" alt="" style={{flex:"none",marginTop:2,opacity:.92}}/>
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
                  <span style={{fontSize:16,fontWeight:600,color:"var(--text-1)"}}>年付 License</span>
                  <Badge tone="gold">PROFESSIONAL</Badge>
                  <span style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:7,fontSize:12,color:"var(--text-2)",whiteSpace:"nowrap"}}>自动续费 <Switch checked={true} onChange={()=>{}}/></span>
                </div>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:"var(--text-3)",marginBottom:6,fontFamily:"var(--font-mono)"}}><span>2025-12-31</span><span>本期已用 63% · 剩余 136 天</span><span>2026-12-31</span></div>
                <ProgressBar value={63} height={6}/>
                <div style={{display:"flex",flexWrap:"wrap",gap:"12px 24px",marginTop:14}}>
                  <div style={{display:"flex",flexDirection:"column",gap:3,whiteSpace:"nowrap"}}><span className="gd-t-label">年费</span><Money amount={299} size={15}/></div>
                  <div style={{display:"flex",flexDirection:"column",gap:3,whiteSpace:"nowrap"}}><span className="gd-t-label">下次扣款</span><span style={{fontFamily:"var(--font-mono)",fontSize:13,color:"var(--text-1)"}}>2026-12-31</span></div>
                  <div style={{display:"flex",flexDirection:"column",gap:3,whiteSpace:"nowrap"}}><span className="gd-t-label">支付方式</span><span style={{fontSize:13,color:"var(--text-1)"}}>Visa · 4242</span></div>
                  <div style={{display:"flex",flexDirection:"column",gap:3,whiteSpace:"nowrap"}}><span className="gd-t-label">设备额度</span><span style={{fontSize:13,color:"var(--text-1)"}}>2 台 · 单活动</span></div>
                </div>
              </div>
            </div>
          </Panel>
          <Panel flush title="设备与执行权" actions={<Button size="sm" onClick={()=>go("devices")}>管理设备</Button>}>
            <div style={{padding:"2px 16px 4px"}}>{D.devices.map(d=><DeviceMini key={d.id} d={d}/>)}</div>
            <div style={{display:"flex",gap:9,padding:"11px 16px",background:"var(--gd-panel)",borderTop:"1px solid var(--gd-line)",fontSize:11.5,color:"var(--text-2)",lineHeight:1.55}}>
              <img src="../../assets/icons/active-lease.svg" width="18" height="18" alt="" style={{flex:"none",marginTop:1}}/>
              <span>同一时刻只有一台设备持有执行权（<b style={{color:"var(--gd-gold)",fontWeight:500}}>金实心 = Active</b>，蓝空心 = Standby）。移交在桌面客户端完成，Epoch 递增。</span>
            </div>
          </Panel>
        </div>
        <Panel flush title="近期动态" actions={<span style={{fontSize:11,color:"var(--text-3)"}}>数据来自 GoodDealer Cloud</span>}>
          <div style={{padding:"2px 16px 6px"}}>{D.activity.map((a,i)=><ActivityRow key={i} a={a}/>)}</div>
          <button onClick={()=>go("cloud")} style={{width:"100%",padding:"11px 16px",background:"transparent",border:"none",borderTop:"1px solid var(--gd-line)",color:"var(--gd-blue)",fontSize:12,cursor:"pointer",fontFamily:"var(--font-sans)",textAlign:"left",display:"flex",alignItems:"center",gap:6}}>查看云端操作账本 <I.ArrowRight size={13}/></button>
        </Panel>
      </div>
      <Panel flush title="云端数据快照" actions={<><span style={{fontSize:11,color:"var(--text-3)",marginRight:10}}>只读镜像 · 截至 14:02</span><Button size="sm" variant="ghost" onClick={()=>go("cloud")}>全部 1,024 →</Button></>}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:12.5}}>
          <thead><tr style={{textAlign:"left"}}>{["域名","注册商","状态","估值 BIN","到期"].map((h,i)=><th key={h} style={{padding:"9px 16px",fontSize:10,letterSpacing:"0.08em",textTransform:"uppercase",color:"var(--text-3)",fontWeight:500,borderBottom:"1px solid var(--gd-line)",textAlign:i>2?"right":"left"}}>{h}</th>)}</tr></thead>
          <tbody>{P.map((r,i)=><tr key={r.domain} style={{borderBottom:i<P.length-1?"1px solid var(--gd-line)":"none"}}>
            <td style={{padding:"9px 16px",fontFamily:"var(--font-mono)",color:"var(--text-1)"}}>{r.domain}</td>
            <td style={{padding:"9px 16px",color:"var(--text-2)"}}>{r.registrar}</td>
            <td style={{padding:"9px 16px"}}>{r.status==="sold"?<Badge tone="gold">SOLD</Badge>:r.status==="conflict"?<Badge tone="danger" mono={false}>冲突</Badge>:r.status==="pending"?<Badge tone="warning" mono={false}>等待平台</Badge>:<Badge tone="sync">SYNCED</Badge>}</td>
            <td style={{padding:"9px 16px",textAlign:"right"}}><Money amount={r.bin} size={12}/></td>
            <td style={{padding:"9px 16px",textAlign:"right",fontFamily:"var(--font-mono)",color:r.expiry<"2026-10-01"?"var(--gd-warning)":"var(--text-2)"}}>{r.expiry}</td>
          </tr>)}</tbody>
        </table>
      </Panel>
    </div>
  </div>;
}
window.GDDashboard=Dashboard;
