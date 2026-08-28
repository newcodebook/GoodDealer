// 公告 Announcements — compose/schedule/publish product & maintenance notices to customer segments.
const {Panel:AnPanel,Badge:AnBadge,Button:AnBtn,Select:AnSel,Input:AnInput,Dialog:AnDlg,Toolbar:AnToolbar}=window.GoodDealerDesignSystem_b5b0b6;

const AN_STAT={published:<AnBadge tone="success">已发布</AnBadge>,scheduled:<AnBadge tone="sync" mono={false}>已排期</AnBadge>,draft:<AnBadge tone="neutral" mono={false}>草稿</AnBadge>};

function Announcements(){
  const D=window.GD_ADMIN;const I=window.GDI;const MetricStrip=window.GDMetricStrip;
  const [items,setItems]=React.useState(()=>D.announcements.map(a=>({...a})));
  const [compose,setCompose]=React.useState(false);
  const counts={published:items.filter(a=>a.status==="published").length,scheduled:items.filter(a=>a.status==="scheduled").length,draft:items.filter(a=>a.status==="draft").length};
  return <div data-screen-label="公告" style={{display:"flex",flexDirection:"column",minHeight:0}}>
    <MetricStrip metrics={[
      {label:"已发布",value:counts.published,tone:"success",meta:"当前生效"},
      {label:"已排期",value:counts.scheduled,tone:"body",meta:"待自动发布"},
      {label:"草稿",value:counts.draft,meta:"未发布"},
      {label:"本月触达",value:"2,847",meta:"全部客户"},
      {label:"平均阅读率",value:"68%",tone:"gold",meta:"应用内公告"},
    ]}/>
    <AnToolbar region
      left={<span style={{fontSize:13,fontWeight:500,color:"var(--text-1)"}}>全部公告</span>}
      right={<AnBtn size="sm" variant="primary" icon={<I.Plus size={14}/>} onClick={()=>setCompose(true)}>撰写公告</AnBtn>}/>
    <div style={{padding:18,display:"flex",flexDirection:"column",gap:10,maxWidth:960}}>
      {items.map(a=><div key={a.id} style={{display:"flex",alignItems:"center",gap:14,padding:"14px 16px",border:"1px solid var(--gd-line)",borderRadius:8,background:"var(--gd-panel)"}}>
        <span style={{width:34,height:34,flex:"none",borderRadius:7,background:"var(--gd-panel-raised)",border:"1px solid var(--gd-line)",display:"flex",alignItems:"center",justifyContent:"center",color:a.status==="published"?"var(--gd-gold)":"var(--text-3)"}}><I.Megaphone size={16}/></span>
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:"flex",alignItems:"center",gap:9}}><span style={{fontSize:13.5,color:"var(--text-1)",fontWeight:500}}>{a.title}</span>{AN_STAT[a.status]}</div>
          <div style={{fontSize:11,color:"var(--text-3)",marginTop:3,fontFamily:"var(--font-mono)"}}>{a.id} · 受众 {a.audience} · {a.author}</div>
        </div>
        <span style={{fontFamily:"var(--font-mono)",fontSize:11,color:a.status==="scheduled"?"var(--gd-blue)":"var(--text-3)",flex:"none"}}>{a.date}</span>
        <div style={{display:"flex",gap:6,flex:"none"}}>
          {a.status==="draft"&&<AnBtn size="sm" variant="primary">发布</AnBtn>}
          {a.status==="scheduled"&&<AnBtn size="sm" variant="ghost">改期</AnBtn>}
          <AnBtn size="sm" variant="ghost">{a.status==="published"?"查看":"编辑"}</AnBtn>
        </div>
      </div>)}
    </div>
    <AnDlg open={compose} onClose={()=>setCompose(false)} title="撰写公告" width={560}
      footer={<><AnBtn onClick={()=>setCompose(false)}>存草稿</AnBtn><AnBtn variant="primary" onClick={()=>setCompose(false)}>发布 · 全部客户</AnBtn></>}>
      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        <AnInput label="标题" placeholder="如：0.9.1 发布说明"/>
        <div style={{display:"flex",gap:10}}>
          <div style={{flex:1}}><AnSel label="受众" size="md" options={["全部客户","Professional · Portfolio","仅 Portfolio","按区域","仅试用客户"]} value="全部客户" onChange={()=>{}}/></div>
          <div style={{flex:1}}><AnSel label="发布" size="md" options={["立即发布","定时发布"]} value="立即发布" onChange={()=>{}}/></div>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:6}}>
          <span className="gd-t-label">正文</span>
          <textarea placeholder="支持 Markdown。语气克制、陈述事实——与产品文案一致。" style={{width:"100%",minHeight:120,resize:"vertical",background:"var(--gd-ink)",border:"1px solid var(--gd-line-strong)",borderRadius:5,color:"var(--gd-text)",fontFamily:"var(--font-sans)",fontSize:13,lineHeight:1.6,padding:"10px 12px",outline:"none",boxSizing:"border-box"}}></textarea>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8,fontSize:11,color:"var(--text-3)"}}><I.Users size={13}/>预计触达 2,847 位客户 · 同时显示于应用内与邮件</div>
      </div>
    </AnDlg>
  </div>;
}
window.GDAnnouncements=Announcements;
