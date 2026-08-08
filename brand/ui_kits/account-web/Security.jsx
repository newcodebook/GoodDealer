// 安全 / Security (account-web · B) — password, optional Passkey (NOT forced TOTP/2FA), sessions with
// remote sign-out, and account-security state. Password reset / account takeover recovery / security
// incident atomically bump account_security_epoch, revoke all online sessions, and enter recovery_pending
// (目的限定恢复 · 冻结新设备绑定/切换/删除). Destructive actions require re-auth; changes email a notice.
const {Button:SBtn,Badge:SBadge,Dialog:SDlg,Input:SInput}=window.GoodDealerDesignSystem_b5b0b6;

function Card({title,children,actions}){
  return <div className="aw-card">
    <div style={{display:"flex",alignItems:"center",marginBottom:12}}>
      <span style={{fontSize:11,letterSpacing:"0.08em",textTransform:"uppercase",color:"var(--text-3)"}}>{title}</span>
      {actions&&<span style={{marginLeft:"auto"}}>{actions}</span>}
    </div>{children}</div>;
}

function Security(){
  const [pwDlg,setPwDlg]=React.useState(false);
  const [state,setState]=React.useState("normal"); // demo: normal | recovery_pending
  const [sessions,setSessions]=React.useState([
    {id:1,device:"MacBook Pro · macOS",agent:"桌面客户端 · 本地",last:"现在",current:true},
    {id:2,device:"iPhone 17 · iOS",agent:"移动客户端 · 本地",last:"今日 08:30"},
    {id:3,device:"Windows · Edge",agent:"网页 · 上海",last:"3 天前",risk:true},
  ]);
  const passkeys=[{name:"MacBook Pro · Touch ID",added:"2025-12"},{name:"iPhone 17 · Face ID",added:"2026-03"}];
  const revoke=id=>setSessions(s=>s.filter(x=>x.id!==id));
  const revokeOthers=()=>setSessions(s=>s.filter(x=>x.current));

  return <div style={{display:"flex",flexDirection:"column",gap:18}}>
    <div style={{display:"flex",alignItems:"flex-start",gap:12,flexWrap:"wrap"}}>
      <div style={{flex:1,minWidth:0}}><h1 className="aw-h1">安全</h1><p className="aw-sub" style={{margin:0}}>密码、Passkey、登录会话与账号安全状态。</p></div>
      <div style={{display:"inline-flex",gap:1,padding:2,borderRadius:7,border:"1px solid var(--gd-line)",background:"var(--gd-ink)"}}>
        {[["normal","正常"],["recovery_pending","接管恢复"]].map(([s,l])=><button key={s} onClick={()=>setState(s)} style={{padding:"4px 9px",fontSize:11,borderRadius:5,border:"none",cursor:"pointer",fontFamily:"var(--font-sans)",background:state===s?"var(--gd-panel-raised)":"transparent",color:state===s?"var(--text-1)":"var(--text-3)"}}>{l}</button>)}
      </div>
    </div>

    {state==="recovery_pending"&&<div style={{border:"1px solid var(--gd-danger)",background:"var(--gd-danger-tint)",borderRadius:8,padding:"12px 14px",fontSize:13}}>
      <b style={{color:"var(--gd-danger)"}}>账号处于接管恢复（recovery_pending）</b>
      <div style={{fontSize:12,color:"var(--text-2)",marginTop:3,lineHeight:1.55}}>已撤销全部在线会话并递增安全代次。此期间只开放目的限定的账号恢复与安全通知；<b style={{color:"var(--text-1)"}}>冻结</b>新设备绑定、设备切换、邮箱/密码再次修改与账号删除。完成身份核验、通知与冷静期后回到正常并签发新代次凭证。</div>
    </div>}

    {/* password */}
    <Card title="密码" actions={<SBtn size="sm" disabled={state!=="normal"} onClick={()=>setPwDlg(true)}>修改密码</SBtn>}>
      <div style={{fontSize:13,color:"var(--text-2)"}}>上次修改 <span style={{fontFamily:"var(--font-mono)"}}>2025-12-31</span> · 修改密码将递增安全代次并撤销全部在线会话。</div>
    </Card>

    {/* passkey */}
    <Card title="Passkey（可选）" actions={<SBtn size="sm" variant="secondary" disabled={state!=="normal"}>添加 Passkey</SBtn>}>
      <div style={{fontSize:12,color:"var(--text-3)",marginBottom:10}}>Passkey 是可选的快捷确认方式，用于删除/导出/移除设备等重认证。不强制配置 TOTP 或短信 2FA。</div>
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {passkeys.map(k=><div key={k.name} style={{display:"flex",alignItems:"center",gap:10,fontSize:13}}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--gd-gold)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="10" cy="8" r="5"/><path d="M10 13v8l2-2 2 2v-4"/></svg>
          <span>{k.name}</span><span style={{fontSize:11,color:"var(--text-3)",fontFamily:"var(--font-mono)"}}>· 添加于 {k.added}</span>
          <SBtn size="sm" variant="ghost" style={{marginLeft:"auto"}} disabled={state!=="normal"}>移除</SBtn>
        </div>)}
      </div>
    </Card>

    {/* sessions */}
    <Card title="登录会话" actions={<SBtn size="sm" variant="ghost" disabled={sessions.filter(s=>!s.current).length===0} onClick={revokeOthers}>退出所有其他会话</SBtn>}>
      <div style={{display:"flex",flexDirection:"column",gap:2}}>
        {sessions.map(s=><div key={s.id} style={{display:"flex",alignItems:"center",gap:12,padding:"9px 0",borderBottom:"1px solid var(--gd-line)"}}>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:13,display:"flex",alignItems:"center",gap:8}}>{s.device}{s.current&&<SBadge tone="success" mono={false}>当前</SBadge>}{s.risk&&<SBadge tone="warning" mono={false}>陌生</SBadge>}</div>
            <div style={{fontSize:11,color:"var(--text-3)"}}>{s.agent} · 最后活动 {s.last}</div>
          </div>
          {!s.current&&<SBtn size="sm" onClick={()=>revoke(s.id)}>退出</SBtn>}
        </div>)}
      </div>
    </Card>

    {/* account security */}
    <Card title="账号安全">
      <div style={{fontSize:12,color:"var(--text-2)",lineHeight:1.6,marginBottom:12}}>怀疑账号或设备被盗？发起接管恢复将<b style={{color:"var(--text-1)"}}>撤销全部在线会话、递增安全代次并冻结破坏性动作</b>。注意账号代次不是即时平台阻断——仍须到各平台官网撤销设备持有的 API/OAuth/浏览器会话。</div>
      <SBtn variant="danger" disabled={state==="recovery_pending"} onClick={()=>setState("recovery_pending")}>发起账号接管恢复</SBtn>
    </Card>

    <SDlg open={pwDlg} onClose={()=>setPwDlg(false)} title="修改密码" width={440}
      footer={<><SBtn onClick={()=>setPwDlg(false)}>取消</SBtn><SBtn variant="primary" onClick={()=>setPwDlg(false)}>保存新密码</SBtn></>}>
      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        <SInput label="当前密码" size="md" type="password" placeholder="重新认证"/>
        <SInput label="新密码" size="md" type="password" hint="至少 10 位，含字母与数字"/>
        <span style={{fontSize:11,color:"var(--text-3)"}}>保存后将退出全部在线会话并发送邮件通知，需重新登录。</span>
      </div>
    </SDlg>
  </div>;
}
window.AWSecurity=Security;
