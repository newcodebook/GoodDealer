// 门禁 / Auth (account-web) — web-native register / signin / verify / forgot, reusing the desktop SignIn
// mind (email+password · OAuth · optional Passkey · 6-cell code · remember device; credentials encrypted
// by a LOCAL key, never uploaded) but as a centered card in the account-web flow layout — NOT the desktop
// WindowChrome. On success it hands off to the account area.
const {Button:UBtn,Input:UInput,Checkbox:UCheck}=window.GoodDealerDesignSystem_b5b0b6;

function Mono({ch}){return <span style={{width:20,height:20,flex:"none",display:"inline-flex",alignItems:"center",justifyContent:"center",borderRadius:5,border:"1px solid var(--gd-line-strong)",background:"var(--gd-ink)",fontFamily:"var(--font-mono)",fontSize:11,fontWeight:600,color:"var(--text-2)"}}>{ch}</span>;}
function Oauth({mono,label,onClick}){return <button onClick={onClick} className="gd-btn gd-btn--md gd-btn--secondary" style={{width:"100%",justifyContent:"flex-start",gap:10,paddingLeft:9}}><Mono ch={mono}/><span style={{flex:1,textAlign:"center",marginRight:20}}>{label}</span></button>;}
function Divider({label}){return <div style={{display:"flex",alignItems:"center",gap:12,margin:"2px 0"}}><span style={{flex:1,height:1,background:"var(--gd-line)"}}></span><span style={{fontSize:11,color:"var(--text-3)",textTransform:"uppercase",letterSpacing:"0.08em"}}>{label}</span><span style={{flex:1,height:1,background:"var(--gd-line)"}}></span></div>;}
function Link({children,onClick}){return <button onClick={onClick} style={{background:"none",border:"none",padding:0,font:"inherit",fontSize:"inherit",color:"var(--text-link)",cursor:"pointer"}}>{children}</button>;}
function CodeInput({value,onChange}){
  const refs=React.useRef([]);
  const set=(i,v)=>{const c=(value+"").padEnd(6," ").split("");c[i]=v.slice(-1)||" ";onChange(c.join("").replace(/ /g,"").slice(0,6));};
  return <div style={{display:"flex",gap:8}}>{Array.from({length:6}).map((_,i)=>{const ch=(value||"")[i]||"";
    return <input key={i} ref={el=>refs.current[i]=el} value={ch} inputMode="numeric" maxLength={1}
      onChange={e=>{const d=e.target.value.replace(/\D/g,"");set(i,d);if(d&&refs.current[i+1])refs.current[i+1].focus();}}
      onKeyDown={e=>{if(e.key==="Backspace"&&!ch&&refs.current[i-1])refs.current[i-1].focus();}}
      style={{width:44,height:52,textAlign:"center",fontFamily:"var(--font-mono)",fontSize:20,color:"var(--text-1)",caretColor:"var(--gd-blue)",background:"var(--gd-ink)",border:`1px solid ${ch?"var(--gd-line-strong)":"var(--gd-line)"}`,borderRadius:7,outline:"none"}}/>;})}</div>;
}

function Auth({onAuthed}){
  const [mode,setMode]=React.useState("signin");
  const [email,setEmail]=React.useState("");
  const [pw,setPw]=React.useState("");const [pw2,setPw2]=React.useState("");
  const [show,setShow]=React.useState(false);
  const [remember,setRemember]=React.useState(true);
  const [agree,setAgree]=React.useState(false);
  const [code,setCode]=React.useState("");
  const [busy,setBusy]=React.useState(false);const [err,setErr]=React.useState("");
  const [sent,setSent]=React.useState(false);const [cool,setCool]=React.useState(0);
  React.useEffect(()=>{if(cool<=0)return;const id=setTimeout(()=>setCool(cool-1),1000);return()=>clearTimeout(id);},[cool]);
  const go=m=>{setErr("");setBusy(false);setSent(false);setMode(m);};
  const finish=()=>{setBusy(true);setTimeout(()=>onAuthed&&onAuthed(),700);};
  const doRegister=()=>{if(pw.length<10||pw!==pw2){setErr("两次密码不一致，且至少 10 位");return;}if(!agree){setErr("请先同意服务条款与隐私政策");return;}setErr("");setBusy(true);setTimeout(()=>{setBusy(false);setCode("");setCool(45);go("verify");},600);};

  const pwSuffix=<button onClick={e=>{e.preventDefault();setShow(s=>!s);}} tabIndex={-1} style={{background:"none",border:"none",padding:0,cursor:"pointer",color:"var(--text-3)",fontSize:11}}>{show?"隐藏":"显示"}</button>;
  const HEAD={signin:["登录 GoodDealer 账户","使用账户继续管理订阅、设备与数据"],register:["创建账户","一个账户，最多绑定 2 台执行设备"],verify:["验证邮箱",null],forgot:["重置密码","输入账户邮箱，我们将发送重置链接"]}[mode];

  const body={
    signin:<>
      <UInput label="邮箱" size="lg" type="email" placeholder="you@domain.com" value={email} onChange={e=>setEmail(e.target.value)}/>
      <UInput label="密码" size="lg" type={show?"text":"password"} placeholder="输入密码" value={pw} onChange={e=>setPw(e.target.value)} suffix={pwSuffix}/>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",fontSize:12}}><UCheck checked={remember} onChange={e=>setRemember(e.target?.checked??!remember)} label="记住此设备"/><Link onClick={()=>go("forgot")}>忘记密码？</Link></div>
      {err&&<div style={{fontSize:12,color:"var(--gd-danger)"}}>{err}</div>}
      <UBtn variant="primary" size="lg" block disabled={busy||!email||!pw} onClick={finish}>{busy?"正在验证…":"登录"}</UBtn>
      <Divider label="或"/>
      <Oauth mono="G" label="使用 Google 继续" onClick={finish}/>
      <button onClick={finish} className="gd-btn gd-btn--md gd-btn--gold" style={{width:"100%",justifyContent:"flex-start",gap:10,paddingLeft:9}}><img src="../../assets/icons/keyhole.svg" width="18" height="18" alt=""/><span style={{flex:1,textAlign:"center",marginRight:20}}>使用 Passkey 登录</span></button>
      <div style={{textAlign:"center",fontSize:13,color:"var(--text-2)",paddingTop:2}}>还没有账户？<Link onClick={()=>go("register")}>创建账户</Link></div>
    </>,
    register:<>
      <UInput label="邮箱" size="lg" type="email" placeholder="you@domain.com" value={email} onChange={e=>setEmail(e.target.value)}/>
      <UInput label="密码" size="lg" type={show?"text":"password"} placeholder="输入密码" value={pw} onChange={e=>setPw(e.target.value)} suffix={pwSuffix} hint="至少 10 位，含字母与数字"/>
      <UInput label="确认密码" size="lg" type={show?"text":"password"} placeholder="再次输入密码" value={pw2} onChange={e=>setPw2(e.target.value)}/>
      <div style={{display:"flex",alignItems:"flex-start",gap:9,fontSize:12,color:"var(--text-2)",lineHeight:1.5}}><span style={{marginTop:1}}><UCheck checked={agree} onChange={e=>setAgree(e.target?.checked??!agree)}/></span><span>我已阅读并同意 <Link onClick={()=>{}}>服务条款</Link> 与 <Link onClick={()=>{}}>隐私政策</Link></span></div>
      {err&&<div style={{fontSize:12,color:"var(--gd-danger)"}}>{err}</div>}
      <UBtn variant="primary" size="lg" block disabled={busy||!email||!pw||!pw2} onClick={doRegister}>{busy?"正在创建…":"创建账户"}</UBtn>
      <div style={{textAlign:"center",fontSize:13,color:"var(--text-2)",paddingTop:2}}>已有账户？<Link onClick={()=>go("signin")}>登录</Link></div>
    </>,
    verify:<>
      <span style={{fontSize:13,color:"var(--text-2)"}}>验证码已发送至 <span style={{fontFamily:"var(--font-mono)",color:"var(--text-1)"}}>{email||"you@domain.com"}</span></span>
      <CodeInput value={code} onChange={setCode}/>
      {err&&<div style={{fontSize:12,color:"var(--gd-danger)"}}>{err}</div>}
      <UBtn variant="primary" size="lg" block disabled={busy||code.length<6} onClick={finish}>{busy?"正在验证…":"验证并继续"}</UBtn>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",fontSize:12}}><Link onClick={()=>go("register")}>返回</Link>{cool>0?<span style={{color:"var(--text-3)",fontFamily:"var(--font-mono)"}}>{cool} 秒后可重发</span>:<Link onClick={()=>setCool(45)}>重新发送验证码</Link>}</div>
    </>,
    forgot:sent?<>
      <div style={{textAlign:"center",padding:"8px 0",display:"flex",flexDirection:"column",alignItems:"center",gap:12}}>
        <span style={{width:48,height:48,borderRadius:"50%",background:"var(--gd-success-tint)",border:"1px solid var(--gd-success)",display:"inline-flex",alignItems:"center",justifyContent:"center"}}><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--gd-success)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg></span>
        <div style={{fontSize:13,color:"var(--text-2)",lineHeight:1.5}}>若该邮箱已注册，你将很快收到含重置链接的邮件。</div>
      </div>
      <UBtn variant="secondary" size="lg" block onClick={()=>go("signin")}>返回登录</UBtn>
    </>:<>
      <UInput label="邮箱" size="lg" type="email" placeholder="you@domain.com" value={email} onChange={e=>setEmail(e.target.value)}/>
      <UBtn variant="primary" size="lg" block disabled={busy||!email} onClick={()=>{setBusy(true);setTimeout(()=>{setBusy(false);setSent(true);},600);}}>{busy?"正在发送…":"发送重置链接"}</UBtn>
      <div><Link onClick={()=>go("signin")}>返回登录</Link></div>
    </>,
  }[mode];

  return <div style={{maxWidth:400,margin:"12px auto",display:"flex",flexDirection:"column",gap:16}}>
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:12,paddingTop:8}}>
      <img src="../../assets/logo/mark.svg" width="52" height="52" alt=""/>
      <div style={{textAlign:"center"}}>
        <div style={{fontSize:19,fontWeight:600,letterSpacing:"-0.01em"}}>{HEAD[0]}</div>
        {HEAD[1]&&<div style={{fontSize:13,color:"var(--text-2)",marginTop:4}}>{HEAD[1]}</div>}
      </div>
    </div>
    <div className="aw-card" style={{display:"flex",flexDirection:"column",gap:14}}>{body}</div>
    <div style={{textAlign:"center",fontSize:11,color:"var(--text-3)"}}>凭据经本地密钥加密，永不上云 · ≤ 2 台执行设备</div>
  </div>;
}
window.AWAuth=Auth;
