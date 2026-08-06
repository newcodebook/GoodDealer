// 浏览器交接 / BrowserHandoff — J-02/03/04 (UX_FLOWS §5, PRD 3.5).
// Two DELIBERATELY separate authorizations:
//  · BrowserSessionConsent — establishing a connection (login / fetch API Key). States only the
//    ProviderConnection, official Host, purpose, session mode and expiry; it does NOT select domains or
//    generate an Operation Plan. The software only observes Origin + login-completed + non-secret health;
//    it may not fill, upload, submit, or read secrets, and may never scrape/return API Key / password /
//    2FA / recovery code / CAPTCHA / Challenge.
//  · BrowserAutomationGrant — executing a confirmed Operation Plan. Only here may the software click,
//    fill, upload CSV and read results, within allowed Hosts; password/2FA/CAPTCHA pages auto-switch to
//    user operation; the final submit returns to local confirmation per risk policy.
// The API Key is never taken by the browser: the user pastes it into a Rust-Host NATIVE secret pane that
// the software cannot read; it is stored encrypted by a local key and never uploaded.
const {Dialog:HDlg,Button:HBtn,Badge:HBadge,Checkbox:HCheck,StatusDot:HDot,Input:HInput}=window.GoodDealerDesignSystem_b5b0b6;

const KV=({k,children})=><div style={{display:"flex",alignItems:"baseline",gap:10,fontSize:12,padding:"4px 0"}}>
  <span style={{width:96,flex:"none",color:"var(--gd-text-faint)"}}>{k}</span>
  <span style={{flex:1,minWidth:0,color:"var(--text-1)"}}>{children}</span>
</div>;

// ——— connection establishment: consent → login observe → native secret pane ———
function ConnectFlow({platform="SellerHub",account="主账户",host,onClose,onConnected}){
  const I=window.GDI;
  const h=host||`*.${platform.toLowerCase()}.com`;
  const pa=`${platform} · ${account}`;
  const [stage,setStage]=React.useState("consent"); // consent | login | secret
  const [key,setKey]=React.useState("");

  return <>
    {/* BrowserSessionConsent — connection only */}
    <HDlg open={stage==="consent"} onClose={onClose} title="连接会话授权 · BrowserSessionConsent" width={520}
      footer={<><HBtn onClick={onClose}>取消</HBtn><HBtn variant="primary" onClick={()=>setStage("login")} icon={<I.ExternalLink size={13}/>}>打开官方登录页</HBtn></>}>
      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        <span style={{fontSize:13}}>将在隔离浏览器窗口打开 <b>{platform}</b> 官方登录页，为账户 <b>{account}</b> 建立 ProviderConnection。</span>
        <div style={{border:"1px solid var(--gd-line-strong)",borderRadius:7,background:"var(--gd-panel)",padding:"8px 13px"}}>
          <KV k="ProviderConnection">{pa}</KV>
          <KV k="官方 Host"><span style={{fontFamily:"var(--font-mono)"}}>{h}</span></KV>
          <KV k="用途">登录 / 获取 API Key</KV>
          <KV k="会话模式">隔离 · 只读检测</KV>
          <KV k="浏览器 Profile">按此账户独立隔离</KV>
          <KV k="到期">30 分钟</KV>
        </div>
        <div style={{display:"flex",gap:12}}>
          <div style={{flex:1,border:"1px solid var(--gd-line)",borderRadius:6,padding:"9px 11px"}}>
            <div style={{fontSize:11,color:"var(--gd-success)",marginBottom:6,letterSpacing:"0.04em"}}>软件只检测</div>
            {["Origin 与登录完成状态","非秘密连接健康信号"].map(x=><div key={x} style={{display:"flex",alignItems:"center",gap:7,fontSize:12,padding:"2px 0",color:"var(--gd-text-muted)"}}><I.Check size={12} style={{color:"var(--gd-success)"}}/>{x}</div>)}
          </div>
          <div style={{flex:1,border:"1px solid var(--gd-line)",borderRadius:6,padding:"9px 11px"}}>
            <div style={{fontSize:11,color:"var(--gd-danger)",marginBottom:6,letterSpacing:"0.04em"}}>软件不会</div>
            {["读取 / 回传 Key·密码·2FA·CAPTCHA","填写 · 上传 · 提交"].map(x=><div key={x} style={{display:"flex",alignItems:"center",gap:7,fontSize:12,padding:"2px 0",color:"var(--gd-text-muted)"}}><I.X size={12} style={{color:"var(--gd-danger)"}}/>{x}</div>)}
          </div>
        </div>
        <span style={{fontSize:11,color:"var(--gd-text-faint)",lineHeight:1.5}}>此授权不选择域名、不生成操作计划；真正执行平台操作时另行创建 BrowserAutomationGrant。</span>
      </div>
    </HDlg>

    {/* Remote login — user operates; software only observes origin+login */}
    <HDlg open={stage==="login"} onClose={onClose} title={`Remote Browser · ${pa} 登录`} width={520}
      footer={<><HBtn onClick={onClose}>取消</HBtn><HBtn variant="primary" onClick={()=>setStage("secret")}>登录完成 · 录入 API Key</HBtn></>}>
      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        <div style={{display:"flex",alignItems:"center",gap:12,fontSize:12,color:"var(--gd-text-muted)"}}>
          <span style={{display:"flex",alignItems:"center",gap:6}}><I.Monitor size={14}/>{pa}</span>
          <span style={{fontFamily:"var(--font-mono)",fontSize:11}}>允许 Host: {h}</span>
          <span style={{marginLeft:"auto"}}><HDot kind="neutral" label="用户操作（密码 / 2FA / CAPTCHA）"/></span>
        </div>
        <div style={{background:"var(--gd-ink)",border:"1px solid var(--gd-line)",borderRadius:5,padding:"10px 12px",fontSize:12,color:"var(--gd-text-muted)",lineHeight:1.6}}>
          请在窗口内自行完成登录。软件仅检测 Origin 与登录完成状态，不读取任何输入内容。密码、2FA、CAPTCHA 页面保持用户操作。
        </div>
      </div>
    </HDlg>

    {/* Rust-Host NATIVE secret pane — the software cannot read this input */}
    {stage==="secret"&&<div style={{position:"fixed",inset:0,zIndex:80,background:"rgba(3,4,7,0.62)",display:"flex",alignItems:"center",justifyContent:"center"}} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{width:460,background:"var(--gd-raised)",border:"1px solid var(--gd-line-strong)",borderRadius:11,boxShadow:"var(--shadow-overlay)",overflow:"hidden"}}>
        <div style={{display:"flex",alignItems:"center",gap:9,padding:"11px 15px",background:"var(--gd-chrome)",borderBottom:"1px solid var(--gd-line)"}}>
          <img src="../../assets/icons/keyhole.svg" width="15" height="15" alt="" style={{opacity:.9}}/>
          <span style={{fontSize:12,fontWeight:600,color:"var(--text-1)"}}>GoodDealer 安全宿主 · 原生秘密输入</span>
          <HBadge tone="gold" mono={false} style={{marginLeft:"auto"}}>Rust Host</HBadge>
        </div>
        <div style={{padding:"16px 18px",display:"flex",flexDirection:"column",gap:13}}>
          <span style={{fontSize:12.5,color:"var(--text-1)",lineHeight:1.55}}>请将从 <b>{platform}</b> 控制台（账户 <b>{account}</b>）复制的 API Key 粘贴到此处。</span>
          <HInput label="API Key" size="lg" mono type="password" placeholder="粘贴 API Key" value={key} onChange={e=>setKey(e.target.value)}/>
          <div style={{display:"flex",alignItems:"flex-start",gap:9,padding:"9px 11px",background:"var(--gd-ink)",border:"1px solid var(--gd-line)",borderRadius:6}}>
            <I.Shield size={14} style={{color:"var(--gd-gold)",flex:"none",marginTop:1}}/>
            <span style={{fontSize:11,color:"var(--gd-text-muted)",lineHeight:1.55}}>此输入面由 Rust 安全宿主创建，<b style={{color:"var(--gd-text)",fontWeight:500}}>浏览器与自动化软件无法读取其内容</b>；提交后仅以本地密钥加密保存，永不上云。</span>
          </div>
          <div style={{display:"flex",justifyContent:"flex-end",gap:8,marginTop:2}}>
            <HBtn onClick={onClose}>取消</HBtn>
            <HBtn variant="gold" disabled={!key} onClick={()=>{onConnected&&onConnected();onClose();}}>保存到本地密钥库</HBtn>
          </div>
        </div>
      </div>
    </div>}
  </>;
}
window.GDConnectFlow=ConnectFlow;

// ——— execution authorization: BrowserAutomationGrant (only here may the software act) ———
function BrowserAutomationGrant({open,platform="Afternic",account="主账户",host,planCount=823,planAction="上传价格 CSV",onClose,onGrant}){
  const I=window.GDI;const [ack,setAck]=React.useState(false);
  const h=host||`*.${platform.toLowerCase()}.com`;
  React.useEffect(()=>{if(!open)setAck(false);},[open]);
  return <HDlg open={open} onClose={onClose} title="执行授权 · BrowserAutomationGrant" width={520}
    footer={<><HBtn onClick={onClose}>取消</HBtn><HBtn variant="gold" disabled={!ack} onClick={onGrant}>授权执行 · {planCount} 项</HBtn></>}>
    <div style={{display:"flex",flexDirection:"column",gap:12}}>
      <span style={{fontSize:13}}>授权软件在 <b>{platform}</b> 隔离窗口执行已确认的操作计划。</span>
      <div style={{border:"1px solid var(--gd-line-strong)",borderRadius:7,background:"var(--gd-panel)",padding:"8px 13px"}}>
        <KV k="操作计划"><span style={{fontFamily:"var(--font-mono)",color:"var(--gd-gold)"}}>{planCount}</span> 项 · {planAction}</KV>
        <KV k="平台 / 账户">{platform} · {account}</KV>
        <KV k="允许 Host"><span style={{fontFamily:"var(--font-mono)"}}>{h}</span></KV>
      </div>
      <div style={{border:"1px solid var(--gd-line)",borderRadius:6,padding:"9px 11px"}}>
        <div style={{fontSize:11,color:"var(--gd-blue)",marginBottom:6,letterSpacing:"0.04em"}}>本授权允许软件</div>
        {["在允许 Host 内点击、填写","上传 CSV、读取处理结果"].map(x=><div key={x} style={{display:"flex",alignItems:"center",gap:7,fontSize:12,padding:"2px 0",color:"var(--gd-text-muted)"}}><I.Check size={12} style={{color:"var(--gd-blue)"}}/>{x}</div>)}
      </div>
      <span style={{fontSize:11,color:"var(--gd-text-faint)",lineHeight:1.55}}>密码 / 2FA / CAPTCHA 页面自动切换为用户操作；最终提交前按风险策略回本地计划确认；可随时暂停并接管。</span>
      <div style={{borderTop:"1px solid var(--gd-line)",paddingTop:10}}><HCheck checked={ack} onChange={()=>setAck(a=>!a)} label={`我确认授权软件执行此 ${planCount} 项计划`}/></div>
    </div>
  </HDlg>;
}
window.GDBrowserAutomationGrant=BrowserAutomationGrant;
