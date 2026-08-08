// Owner 门禁 / AdminGate — the admin console is Passkey-only for a separate StaffIdentity; it NEVER reuses
// a user account session. First version issues a single Owner identity (Role/Scope structure retained).
// Losing the Owner Passkey fails closed (no email recovery / implicit break-glass).
const {Button:GBtn,Badge:GBadge}=window.GoodDealerDesignSystem_b5b0b6;

function AdminGate({onAuthed}){
  const [busy,setBusy]=React.useState(false);
  const auth=()=>{setBusy(true);setTimeout(()=>onAuthed&&onAuthed(),700);};
  return <div style={{minHeight:"100vh",display:"flex",flexDirection:"column",background:"var(--gd-ink)"}}>
    <div style={{height:52,flex:"none",display:"flex",alignItems:"center",gap:9,padding:"0 20px",borderBottom:"1px solid var(--gd-line)",background:"var(--gd-chrome)",boxShadow:"inset 0 2px 0 var(--gd-gold)"}}>
      <img src="../../assets/logo/mark-flat.svg" width="18" height="18" alt=""/><span style={{fontSize:14,fontWeight:600}}>GoodDealer</span>
      <span style={{fontSize:10,fontFamily:"var(--font-mono)",letterSpacing:"0.08em",color:"var(--gd-gold)",border:"1px solid var(--gd-gold)",borderRadius:4,padding:"1px 6px"}}>ADMIN · STAFF</span>
    </div>
    <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",padding:24}}>
      <div style={{width:400,maxWidth:"100%",display:"flex",flexDirection:"column",gap:16}}>
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:12}}>
          <span style={{width:56,height:56,borderRadius:"50%",background:"var(--gd-gold-tint)",border:"1px solid var(--gd-gold)",display:"inline-flex",alignItems:"center",justifyContent:"center"}}>
            <img src="../../assets/icons/keyhole.svg" width="26" height="26" alt=""/></span>
          <div style={{textAlign:"center"}}>
            <div style={{fontSize:19,fontWeight:600}}>运营后台 · Owner 登录</div>
            <div style={{fontSize:13,color:"var(--text-2)",marginTop:4}}>独立 Staff 身份 · 强制 Passkey · 不复用用户账户会话</div>
          </div>
        </div>
        <div style={{border:"1px solid var(--gd-line)",background:"var(--gd-panel)",borderRadius:9,padding:"20px",display:"flex",flexDirection:"column",gap:14}}>
          <button onClick={auth} disabled={busy} className="gd-btn gd-btn--lg gd-btn--gold" style={{width:"100%",justifyContent:"center",gap:9}}>
            {busy?<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{animation:"gd-spinner 1s linear infinite"}}><path d="M21 12a9 9 0 1 1-6.2-8.5"/></svg>:<img src="../../assets/icons/keyhole.svg" width="18" height="18" alt=""/>}
            {busy?"正在验证 Passkey…":"使用 Passkey 登录"}</button>
          <div style={{display:"flex",alignItems:"center",gap:8,fontSize:11,color:"var(--text-3)",lineHeight:1.5}}>
            <GBadge tone="gold" mono={false}>Owner</GBadge>首版仅签发 Owner 身份；Role/Scope 结构保留，未来增加 Staff 时再启用角色细分与职责分离。
          </div>
        </div>
        <div style={{fontSize:11,color:"var(--text-3)",textAlign:"center",lineHeight:1.6}}>Owner Passkey 丢失时失败关闭——不提供邮箱找回或隐式 Break Glass。跨账号明细读取与高风险动作仍需逐次新鲜 Passkey 重认证。</div>
      </div>
    </div>
  </div>;
}
window.ADMGate=AdminGate;
