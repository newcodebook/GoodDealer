// 数据与隐私 / DataPrivacy (account-web · C) — the compliance capability that stays available even when
// the desktop client is Locked (License expired). Data export = machine-readable JSON/CSV/ZIP of
// server-held BUSINESS data only (platform credentials/keys never leave the device, so never in scope);
// async prepare → download kept 7 days. Account deletion = 7-day cooling-off, then freeze → business
// purge (deletion_epoch), while legally-required records are retained (Support 180d / security audit 365d
// / tax facts 7y / Legal Hold). Both require re-auth (password or Passkey) and email a notice.
const {Button:DBtn,Badge:DBadge,Dialog:DDlg,Input:DInput,Select:DSel,Checkbox:DCheck,Tag:DTag}=window.GoodDealerDesignSystem_b5b0b6;

const SCOPE=["域名 · Portfolio","价格 · Listing · 目标状态","标签 · 购入成本 · 备注","脱敏操作记录（ExecutionFact 摘要）"];
const RETAINED=[["Support 记录","180 天"],["安全审计事实","365 天"],["财税事实","7 年"],["Legal Hold","显式登记时另计"]];

function DataPrivacy(){
  const [fmt,setFmt]=React.useState("JSON");
  const [exports,setExports]=React.useState([{id:1,at:"2026-08-05",fmt:"JSON",state:"ready",until:"2026-08-12"}]);
  const [exDlg,setExDlg]=React.useState(false);
  const [delDlg,setDelDlg]=React.useState(false);
  const [delAck,setDelAck]=React.useState(false);
  const [deletion,setDeletion]=React.useState(null); // null | {until}

  const requestExport=()=>{setExDlg(false);setExports(x=>[{id:Date.now(),at:"现在",fmt,state:"preparing"},...x]);};
  const requestDelete=()=>{setDelDlg(false);setDelAck(false);setDeletion({until:"2026-08-15"});};

  return <div style={{display:"flex",flexDirection:"column",gap:18}}>
    <div><h1 className="aw-h1">数据与隐私</h1><p className="aw-sub" style={{margin:0}}>无论订阅是否有效，你都可以导出数据或删除账号——合规入口在客户端锁定后仍然保留。</p></div>

    {/* deletion pending banner */}
    {deletion&&<div style={{border:"1px solid var(--gd-warning)",background:"var(--gd-warning-tint)",borderRadius:8,padding:"12px 14px",display:"flex",alignItems:"center",gap:12}}>
      <div style={{flex:1,fontSize:13}}><b style={{color:"var(--gd-warning)"}}>账号删除处理中 · 7 天冷静期</b><div style={{fontSize:12,color:"var(--text-2)",marginTop:2}}>冷静期至 <span style={{fontFamily:"var(--font-mono)"}}>{deletion.until}</span>；此前可随时取消。冷静期结束后冻结账号并开始业务清除。</div></div>
      <DBtn onClick={()=>setDeletion(null)}>取消删除</DBtn>
    </div>}

    {/* export */}
    <div className="aw-card">
      <div style={{display:"flex",alignItems:"center",marginBottom:12}}>
        <span style={{fontSize:11,letterSpacing:"0.08em",textTransform:"uppercase",color:"var(--text-3)"}}>数据导出</span>
        <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:8}}>
          <DSel size="sm" options={["JSON","CSV","ZIP"]} value={fmt} onChange={e=>setFmt(e&&e.target?e.target.value:e)}/>
          <DBtn size="sm" variant="primary" onClick={()=>setExDlg(true)}>请求导出</DBtn>
        </div>
      </div>
      <div style={{display:"flex",flexWrap:"wrap",gap:5,marginBottom:12}}>{SCOPE.map(s=><DTag key={s}>{s}</DTag>)}</div>
      <div style={{border:"1px solid var(--gd-line)",borderRadius:7,overflow:"hidden"}}>
        {exports.map((e,i)=><div key={e.id} style={{display:"flex",alignItems:"center",gap:12,padding:"11px 14px",borderTop:i===0?"none":"1px solid var(--gd-line)"}}>
          <span style={{width:96,flex:"none",fontFamily:"var(--font-mono)",fontSize:12}}>{e.at}</span>
          <DTag>{e.fmt}</DTag>
          <span style={{flex:1,minWidth:0,fontSize:12,color:"var(--text-3)"}}>{e.state==="ready"?`就绪 · 下载保留至 ${e.until}（7 天）`:"身份核验完成 · 正在打包…"}</span>
          {e.state==="ready"?<DBtn size="sm">下载</DBtn>:<span style={{display:"inline-flex",alignItems:"center",gap:6,fontSize:12,color:"var(--gd-blue)"}}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{animation:"gd-spinner 1s linear infinite"}}><path d="M21 12a9 9 0 1 1-6.2-8.5"/></svg>准备中</span>}
        </div>)}
      </div>
      <div style={{fontSize:11,color:"var(--text-3)",marginTop:10,lineHeight:1.6}}>导出仅含服务端持有的业务数据；平台 API 凭据、Cookie、密钥永不上云，本就不在导出范围。请求导出需重新认证，就绪后邮件通知。</div>
    </div>

    {/* deletion */}
    <div style={{border:"1px solid var(--gd-danger)",borderRadius:9,background:"var(--gd-panel)",padding:"18px 20px"}}>
      <div style={{fontSize:11,letterSpacing:"0.08em",textTransform:"uppercase",color:"var(--gd-danger)",marginBottom:12}}>删除账号与云端数据</div>
      <div style={{display:"flex",gap:20,flexWrap:"wrap"}}>
        <div style={{flex:"1 1 240px",minWidth:0}}>
          <div style={{fontSize:12,color:"var(--text-3)",marginBottom:6}}>将删除</div>
          <div style={{fontSize:13,color:"var(--text-2)",lineHeight:1.7}}>服务端业务数据（域名 · 价格 · Listing · 目标状态 · 脱敏记录）与云端账号。7 天冷静期后冻结并开始清除，35 天内 PITR 可恢复。</div>
        </div>
        <div style={{flex:"1 1 240px",minWidth:0}}>
          <div style={{fontSize:12,color:"var(--text-3)",marginBottom:6}}>依法保留（不随删除清除）</div>
          {RETAINED.map(([k,v])=><div key={k} style={{display:"flex",justifyContent:"space-between",fontSize:12,padding:"3px 0",color:"var(--text-2)"}}><span>{k}</span><span style={{fontFamily:"var(--font-mono)",color:"var(--text-3)"}}>{v}</span></div>)}
        </div>
      </div>
      <div style={{marginTop:14}}><DBtn variant="danger" disabled={!!deletion} onClick={()=>{setDelDlg(true);setDelAck(false);}}>请求删除账号</DBtn></div>
    </div>

    {/* export reauth */}
    <DDlg open={exDlg} onClose={()=>setExDlg(false)} title={`请求导出 · ${fmt}`} width={440}
      footer={<><DBtn onClick={()=>setExDlg(false)}>取消</DBtn><DBtn variant="primary" onClick={requestExport}>确认并开始导出</DBtn></>}>
      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        <span style={{fontSize:13}}>将打包服务端业务数据为 <b>{fmt}</b>。准备完成后邮件通知，下载链接保留 7 天。此操作需要重新认证。</span>
        <DInput label="当前密码（或用 Passkey 确认）" size="md" type="password" placeholder="重新认证"/>
      </div>
    </DDlg>

    {/* delete reauth + ceremony */}
    <DDlg open={delDlg} onClose={()=>{setDelDlg(false);setDelAck(false);}} title="删除账号与云端数据" width={500} danger
      footer={<><DBtn onClick={()=>{setDelDlg(false);setDelAck(false);}}>取消</DBtn><DBtn variant="danger" disabled={!delAck} onClick={requestDelete}>请求删除 · 进入 7 天冷静期</DBtn></>}>
      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        <span style={{fontSize:13}}>请求删除账号与服务端业务数据。请求后进入 <b>7 天冷静期</b>，冷静期内可取消；冷静期结束才冻结并清除。</span>
        <div style={{border:"1px solid var(--gd-danger)",background:"var(--gd-danger-tint)",borderRadius:7,padding:"11px 13px",fontSize:12,color:"var(--text-2)",lineHeight:1.55}}>
          清除后<b style={{color:"var(--text-1)"}}>不可恢复</b>（35 天 PITR 窗口除外）。Support / 安全审计 / 财税等依法保留记录不随此删除清除。本地设备上的数据由你自行删除。
        </div>
        <DInput label="当前密码（或用 Passkey 确认）" size="md" type="password" placeholder="重新认证"/>
        <div style={{borderTop:"1px solid var(--gd-line)",paddingTop:10}}><DCheck checked={delAck} onChange={()=>setDelAck(a=>!a)} label="我理解 7 天冷静期后账号与云端业务数据将被清除"/></div>
      </div>
    </DDlg>
  </div>;
}
window.AWDataPrivacy=DataPrivacy;
