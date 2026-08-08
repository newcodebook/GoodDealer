// 支持 / Support (account-web · D) — first version uses an EXTERNAL Helpdesk. The account page keeps only
// a trusted SupportCaseReference + account link + external revision/sync watermark + a MAPPED status
// (open | pending | closed | unknown); it never syncs full messages/attachments/platform secrets. Closing
// a SupportCase does NOT close independent compliance (DataRights) or security (Incident) obligations.
const {Button:SBtn,Badge:SBadge}=window.GoodDealerDesignSystem_b5b0b6;
const CASE_STATE={open:["warning","待处理"],pending:["sync","处理中"],closed:["neutral","已关闭"],unknown:["danger","状态未知"]};
const CASES=[
  {ref:"GD-4821",subj:"同步排空卡在待验收",status:"pending",synced:"2 小时前"},
  {ref:"GD-4677",subj:"年付退款咨询",status:"closed",synced:"3 天前"},
  {ref:"GD-4590",subj:"设备切换隔离时长",status:"unknown",synced:"Helpdesk 暂时失联"},
];
const HELP=["快速上手 · 接入首个平台","设备与执行权 · Active/Standby","批量操作与冲突裁决","账单、退款与发票"];

function Support(){
  return <div style={{display:"flex",flexDirection:"column",gap:18}}>
    <div><h1 className="aw-h1">支持</h1><p className="aw-sub" style={{margin:0}}>工单在外部帮助中心处理；此处显示工单状态引用，完整对话在帮助中心。</p></div>

    <div className="aw-card">
      <div style={{fontSize:11,letterSpacing:"0.08em",textTransform:"uppercase",color:"var(--text-3)",marginBottom:12}}>联系支持</div>
      <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"center"}}>
        <SBtn variant="primary" icon={<Ext/>}>打开帮助中心</SBtn>
        <SBtn variant="secondary" icon={<Ext/>}>提交新工单</SBtn>
        <span style={{fontSize:11,color:"var(--text-3)"}}>· 平均首次响应 &lt; 1 个工作日</span>
      </div>
    </div>

    <div className="aw-card" style={{padding:0}}>
      <div style={{fontSize:11,letterSpacing:"0.08em",textTransform:"uppercase",color:"var(--text-3)",padding:"16px 20px 4px"}}>我的工单</div>
      {CASES.map((c,i)=>{const st=CASE_STATE[c.status];
        return <div key={c.ref} style={{display:"flex",alignItems:"center",gap:12,padding:"12px 20px",borderTop:i===0?"none":"1px solid var(--gd-line)"}}>
          <span style={{width:88,flex:"none",fontFamily:"var(--font-mono)",fontSize:12,color:"var(--text-2)"}}>#{c.ref}</span>
          <span style={{flex:1,minWidth:0,fontSize:13,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{c.subj}</span>
          <SBadge tone={st[0]} mono={false}>{st[1]}</SBadge>
          <span style={{width:120,flex:"none",textAlign:"right",fontSize:11,color:"var(--text-3)",fontFamily:"var(--font-mono)"}}>{c.synced}</span>
          <SBtn size="sm" variant="ghost" icon={<Ext size={12}/>}>在帮助中心查看</SBtn>
        </div>;})}
      <div style={{padding:"11px 20px",borderTop:"1px solid var(--gd-line)",fontSize:11,color:"var(--text-3)",lineHeight:1.6}}>状态为帮助中心状态的映射；「状态未知」表示暂时无法与帮助中心对账。关闭工单不影响独立的数据权利或安全事件处理。</div>
    </div>

    <div className="aw-card">
      <div style={{fontSize:11,letterSpacing:"0.08em",textTransform:"uppercase",color:"var(--text-3)",marginBottom:12}}>常见帮助</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))",gap:"8px 20px"}}>
        {HELP.map(hp=><a key={hp} href="#" onClick={e=>e.preventDefault()} style={{display:"flex",alignItems:"center",gap:8,fontSize:13,color:"var(--text-link)"}}><Ext size={13}/>{hp}</a>)}
      </div>
    </div>
  </div>;
}
function Ext({size=13}){return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>;}
window.AWSupport=Support;
