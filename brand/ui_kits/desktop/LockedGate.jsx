// 账户已锁定 / LockedGate — the entitlement gate (J-06, PRD §7 / UX_FLOWS §6).
// Shown when subscription + offline grace have BOTH ended: the app does not open the main UI.
// No client read-only / export / emergency-delist exception. Local data is never deleted; renewing
// restores access. Compliance capability (export / delete / session+device security) stays available
// on the account web, unaffected by the lock. Actions: 续费 · 切换账号 · 退出.
const {WindowChrome:LWin,Button:LBtn,Badge:LBadge}=window.GoodDealerDesignSystem_b5b0b6;

const LT={
  zh:{ctx:"账户",locked:"已锁定",title:"订阅已过期",
    sub:"离线宽限已结束，客户端已锁定，不显示业务主界面。",
    kLicense:"License",kExpiry:"到期时间",kGrace:"离线宽限",kState:"访问状态",
    vLicense:"年付 License",vGrace:"已结束（7 天）",vState:"已锁定",
    preserve:"本地数据不会删除，续费后即恢复访问。锁定期间不提供客户端只读、导出或紧急下架例外。",
    renew:"续费以恢复访问",switch:"切换账号",quit:"退出",
    webTitle:"账号网页端不受锁定影响",
    web:"你仍可在账号网页端导出服务端数据、删除账号 / 云端数据、退出会话与移除设备。",
    webLink:"打开账号网页端"},
  en:{ctx:"Account",locked:"LOCKED",title:"Subscription expired",
    sub:"The offline grace period has ended. The client is locked and the main workspace is hidden.",
    kLicense:"License",kExpiry:"Expired on",kGrace:"Offline grace",kState:"Access",
    vLicense:"Annual License",vGrace:"Ended (7 days)",vState:"Locked",
    preserve:"Local data is never deleted; renewing restores access. No client read-only, export, or emergency-delist exception applies while locked.",
    renew:"Renew to restore access",switch:"Switch account",quit:"Quit",
    webTitle:"Account web is unaffected",
    web:"You can still export server data, delete your account / cloud data, sign out sessions and remove devices from the account web.",
    webLink:"Open account web"},
};

function KV({k,children,tone}){
  return <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 0",borderBottom:"1px solid var(--gd-line)",fontSize:13}}>
    <span style={{color:"var(--gd-text-faint)",fontSize:12}}>{k}</span>
    <span style={{color:tone||"var(--text-1)",fontFamily:"var(--font-mono)",fontSize:12}}>{children}</span>
  </div>;
}

function LockedGate({onRenew,onSwitch,onQuit,email="you@domain.com"}){
  const I=window.GDI;
  const [lang,setLang]=React.useState("zh");const t=LT[lang];
  const langToggle=<div style={{display:"inline-flex",gap:1,padding:2,borderRadius:7,border:"1px solid var(--gd-line)",background:"var(--gd-ink)"}}>
    {[["zh","中"],["en","EN"]].map(([k,l])=><button key={k} onClick={()=>setLang(k)} style={{padding:"3px 9px",fontSize:11,fontWeight:500,borderRadius:5,border:"none",cursor:"pointer",fontFamily:"var(--font-mono)",
      background:lang===k?"var(--gd-panel-raised)":"transparent",color:lang===k?"var(--text-1)":"var(--text-3)"}}>{l}</button>)}
  </div>;
  return <LWin appName="GoodDealer" context={t.ctx} mark={<img src="../../assets/logo/mark-16.svg" width="16" height="16" alt=""/>}
    style={{width:520,height:600,maxWidth:"100%",maxHeight:"100%"}} onClose={onQuit}>
    <div style={{flex:1,minWidth:0,display:"flex",flexDirection:"column",background:"var(--gd-ink)"}}>
      <div style={{display:"flex",justifyContent:"flex-end",padding:"12px 16px 0"}}>{langToggle}</div>
      <div style={{flex:1,minHeight:0,overflowY:"auto",padding:"8px 40px 32px",display:"flex",flexDirection:"column",alignItems:"stretch"}}>
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",textAlign:"center",gap:14,margin:"12px 0 20px"}}>
          <div style={{position:"relative",width:66,height:66,borderRadius:"50%",background:"var(--gd-warning-tint)",border:"1px solid var(--gd-warning)",display:"flex",alignItems:"center",justifyContent:"center"}}>
            <img src="../../assets/icons/keyhole.svg" width="32" height="32" alt="" style={{opacity:.9}}/>
          </div>
          <div>
            <div style={{display:"flex",alignItems:"center",gap:9,justifyContent:"center",marginBottom:7}}>
              <span style={{fontSize:20,fontWeight:600,letterSpacing:"-0.02em",color:"var(--text-1)"}}>{t.title}</span>
              <LBadge tone="warning" mono={false}>{t.locked}</LBadge>
            </div>
            <div style={{fontSize:13,color:"var(--text-2)",lineHeight:1.5,maxWidth:360}}>{t.sub}</div>
            <div style={{fontSize:12,color:"var(--gd-text-faint)",fontFamily:"var(--font-mono)",marginTop:8}}>{email}</div>
          </div>
        </div>

        <div style={{border:"1px solid var(--gd-line)",borderRadius:9,background:"var(--gd-panel)",padding:"6px 16px 12px",marginBottom:16}}>
          <KV k={t.kLicense}>{t.vLicense}</KV>
          <KV k={t.kExpiry} tone="var(--gd-text-muted)">2026-07-30</KV>
          <KV k={t.kGrace} tone="var(--gd-warning)">{t.vGrace}</KV>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 0 2px",fontSize:13}}>
            <span style={{color:"var(--gd-text-faint)",fontSize:12}}>{t.kState}</span>
            <LBadge tone="warning" mono={false}>{t.vState}</LBadge>
          </div>
        </div>

        <div style={{fontSize:12,color:"var(--gd-text-muted)",lineHeight:1.6,marginBottom:18}}>{t.preserve}</div>

        <button onClick={onRenew} className="gd-btn gd-btn--lg gd-btn--gold" style={{width:"100%",justifyContent:"center"}}>{t.renew}</button>
        <div style={{display:"flex",gap:10,marginTop:10}}>
          <LBtn size="lg" variant="secondary" block onClick={onSwitch}>{t.switch}</LBtn>
          <LBtn size="lg" variant="ghost" block onClick={onQuit}>{t.quit}</LBtn>
        </div>

        <div style={{marginTop:"auto",paddingTop:20}}>
          <div style={{height:1,background:"var(--gd-line)",marginBottom:14}}></div>
          <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
            <I.Shield size={14} style={{color:"var(--gd-blue)",marginTop:2,flex:"none"}}/>
            <div style={{fontSize:12,color:"var(--text-2)",lineHeight:1.55}}>
              <div style={{color:"var(--text-1)",fontWeight:500,marginBottom:3}}>{t.webTitle}</div>
              {t.web} <button onClick={()=>{}} style={{background:"none",border:"none",padding:0,font:"inherit",fontSize:"inherit",color:"var(--text-link)",cursor:"pointer",display:"inline-flex",alignItems:"center",gap:3}}>{t.webLink}<I.ExternalLink size={12}/></button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </LWin>;
}
window.GDLockedGate=LockedGate;
