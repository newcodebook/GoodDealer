// 审计日志 Audit — read-only append-only log of operator + system actions. Sensitive actions highlighted.
const {Table:AuTable,Badge:AuBadge,Button:AuBtn,Select:AuSel,Input:AuInput,Toolbar:AuToolbar}=window.GoodDealerDesignSystem_b5b0b6;

const SENSITIVE=["强制解绑设备","手动退款","重置客户 2FA","切换功能开关"];

function Audit(){
  const D=window.GD_ADMIN;const I=window.GDI;const MetricStrip=window.GDMetricStrip;
  const [actor,setActor]=React.useState("全部操作者");const [q,setQ]=React.useState("");
  const actors=["全部操作者",...Array.from(new Set(D.audit.map(a=>a.actor)))];
  let rows=D.audit.filter(a=>(actor==="全部操作者"||a.actor===actor)&&(q===""||a.action.includes(q)||a.target.includes(q)));
  const isSensitive=a=>SENSITIVE.some(s=>a.action.startsWith(s));
  return <div data-screen-label="审计日志" style={{display:"flex",flexDirection:"column",height:"100%",minHeight:0}}>
    <MetricStrip metrics={[
      {label:"今日操作",value:"342",meta:"运营 + 系统"},
      {label:"运营者操作",value:"38",meta:"人工"},
      {label:"系统操作",value:"304",meta:"自动"},
      {label:"高敏感操作",value:"6",tone:"warning",meta:"解绑 · 退款 · 2FA · 开关"},
      {label:"操作者",value:"5",meta:"运营团队"},
      {label:"保留期",value:"365 天",mono:true,meta:"追加不可篡改"},
    ]}/>
    <AuToolbar region
      left={<><AuInput size="sm" prefix={<I.Search size={13}/>} placeholder="搜索操作、对象…" value={q} onChange={e=>setQ(e.target.value)} style={{width:240}}/><AuSel size="sm" options={actors} value={actor} onChange={e=>setActor(e.target.value)}/><AuSel size="sm" options={["全部类型","客户","计费","设备","配置","公告"]} value="全部类型" onChange={()=>{}}/></>}
      right={<AuBtn size="sm" icon={<I.Download size={14}/>}>导出日志</AuBtn>}/>
    <div style={{flex:1,minHeight:0,display:"flex"}}>
      <AuTable density="regular" rowKey="id" maxHeight="100%" style={{flex:1,minHeight:0,border:"none",borderRadius:0}}
        columns={[
          {key:"time",label:"时间",render:a=><span style={{fontFamily:"var(--font-mono)",fontSize:11.5,color:"var(--text-2)"}}>{a.time}</span>},
          {key:"actor",label:"操作者",render:a=><span style={{display:"inline-flex",alignItems:"center",gap:7}}><span style={{width:20,height:20,flex:"none",borderRadius:"50%",background:a.actor==="系统"?"var(--gd-panel-raised)":"var(--gd-blue-tint)",border:"1px solid var(--gd-line-strong)",fontSize:9,display:"flex",alignItems:"center",justifyContent:"center",color:a.actor==="系统"?"var(--text-3)":"var(--gd-blue)",fontFamily:"var(--font-mono)"}}>{a.actor==="系统"?"S":a.actor[0]}</span><span style={{fontSize:12.5,color:a.actor==="系统"?"var(--text-3)":"var(--text-1)"}}>{a.actor}</span></span>},
          {key:"action",label:"操作",render:a=><span style={{display:"inline-flex",alignItems:"center",gap:7,fontSize:12.5,color:"var(--text-1)"}}>{isSensitive(a)&&<span style={{width:6,height:6,borderRadius:"50%",background:"var(--gd-warning)",flex:"none"}}></span>}{a.action}{isSensitive(a)&&<AuBadge tone="warning" mono={false}>敏感</AuBadge>}</span>},
          {key:"target",label:"对象",render:a=><span style={{fontFamily:"var(--font-mono)",fontSize:11.5,color:"var(--text-2)"}}>{a.target}</span>},
          {key:"ip",label:"来源 IP",numeric:true,render:a=><span style={{fontFamily:"var(--font-mono)",fontSize:11,color:"var(--text-3)"}}>{a.ip}</span>},
        ]}
        rows={rows}
        footer={<div style={{display:"flex",alignItems:"center",width:"100%",fontSize:11,color:"var(--text-3)"}}><span>{rows.length} 条 · 追加不可篡改 · 与 SIEM 实时投递</span><span style={{marginLeft:"auto",fontFamily:"var(--font-mono)"}}>保留 365 天</span></div>}/>
    </div>
  </div>;
}
window.GDAudit=Audit;
