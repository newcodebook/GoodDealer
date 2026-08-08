// 服务延续 / Sunset (account-web · D) — shown only if GoodDealer permanently winds down its daily cloud
// service. Lifetime users and users with an active subscription at sunset are eligible for a FINAL
// LocalContinuation build + a permanent offline Sunset Credential, letting them access/export local data
// and keep device-local platform operations that the last compatible build still supports. No promise of
// perpetual compatibility with future OS / third-party APIs / web structure / platform policy. Platform
// credentials must still be re-entered on the device; account-web compliance export/delete is provided
// separately per the sunset plan.
const {Button:UBtn,Badge:UBadge}=window.GoodDealerDesignSystem_b5b0b6;

function DownloadRow({icon,name,meta,cta}){
  return <div style={{display:"flex",alignItems:"center",gap:13,padding:"13px 15px",border:"1px solid var(--gd-line)",borderRadius:8,background:"var(--gd-panel)"}}>
    <span style={{width:34,height:34,flex:"none",borderRadius:7,background:"var(--gd-panel-raised)",border:"1px solid var(--gd-line-strong)",display:"flex",alignItems:"center",justifyContent:"center"}}>{icon}</span>
    <div style={{flex:1,minWidth:0}}><div style={{fontSize:14,color:"var(--text-1)"}}>{name}</div><div style={{fontSize:11,color:"var(--text-3)",fontFamily:"var(--font-mono)"}}>{meta}</div></div>
    <UBtn variant="secondary">{cta}</UBtn>
  </div>;
}
const Dl=()=><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--gd-text-muted)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>;

function Sunset(){
  return <div style={{display:"flex",flexDirection:"column",gap:22,maxWidth:640,margin:"0 auto"}}>
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",textAlign:"center",gap:12}}>
      <img src="../../assets/logo/mark.svg" width="60" height="60" alt=""/>
      <h1 style={{fontSize:26,fontWeight:600,letterSpacing:"-0.02em",margin:0}}>服务延续 · Sunset</h1>
      <p style={{fontSize:14,color:"var(--text-2)",margin:0,lineHeight:1.55}}>GoodDealer 将于 <b style={{color:"var(--text-1)"}}>2027-06-30</b> 停止日常云服务（账号 · License · 云同步）。你符合本地延续资格。</p>
    </div>

    <div style={{border:"1px solid var(--gd-gold)",background:"var(--gd-gold-tint)",borderRadius:9,padding:"13px 16px",display:"flex",alignItems:"center",gap:12}}>
      <UBadge tone="gold" mono={false}>符合资格</UBadge>
      <span style={{fontSize:13,color:"var(--text-1)"}}>年付 License · 停服时有效</span>
      <span style={{marginLeft:"auto",fontSize:11,color:"var(--gd-text-muted)"}}>终身用户与停服时订阅有效的用户均符合</span>
    </div>

    <div style={{display:"flex",flexDirection:"column",gap:10}}>
      <div style={{fontSize:11,letterSpacing:"0.08em",textTransform:"uppercase",color:"var(--text-3)"}}>下载本地延续</div>
      <DownloadRow icon={<Dl/>} name="最终本地延续版本 · macOS" meta="LocalContinuation v1 · 0.9.x · 92 MB" cta="下载"/>
      <DownloadRow icon={<Dl/>} name="最终本地延续版本 · Windows" meta="LocalContinuation v1 · 0.9.x · 104 MB" cta="下载"/>
      <DownloadRow icon={<Dl/>} name="永久离线 Sunset Credential" meta="离线凭证 · 导入后绑定新安装" cta="下载凭证"/>
    </div>

    <div style={{border:"1px solid var(--gd-line-strong)",borderRadius:8,background:"var(--gd-panel)",padding:"14px 16px",display:"flex",flexDirection:"column",gap:9,fontSize:12,color:"var(--text-2)",lineHeight:1.6}}>
      <div style={{fontSize:11,letterSpacing:"0.06em",textTransform:"uppercase",color:"var(--text-3)"}}>说明</div>
      <span>· 导入后进入<b style={{color:"var(--text-1)"}}>本地只读延续 Workspace</b>，可访问、导出本地数据，并继续<b style={{color:"var(--text-1)"}}>最后可用版本当时仍兼容</b>的设备本地平台操作。</span>
      <span>· <b style={{color:"var(--gd-warning)"}}>不承诺</b>永久兼容未来 OS、第三方 API、网页结构或平台政策。</span>
      <span>· 平台凭据仍需在该设备重新录入或按封闭来源复验；离线凭证不含平台密钥。</span>
      <span>· 账号网页端的合规导出 / 删除在停服后按预案另行提供。</span>
    </div>

    <div style={{textAlign:"center",fontSize:11,color:"var(--text-3)"}}>请在停服前完成下载并妥善保管文件；离线凭证丢失后无法从服务端补发。</div>
  </div>;
}
window.AWSunset=Sunset;
