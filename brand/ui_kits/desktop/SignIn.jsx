// 账户登录 / SignIn — the account gate that precedes 设备门禁.
// Account = GoodDealer Cloud identity (≤2 execution devices). Device Lease = execution right.
// States: signin → register → verify(email code) → hands off to Onboarding(device gate).
// Hardware-wallet mind: credentials are encrypted by a LOCAL key, never uploaded.
const {Button:SBtn,Input:SInput,Checkbox:SCheck,Badge:SBadge,StatusDot:SDot,WindowChrome:SWin}=window.GoodDealerDesignSystem_b5b0b6;

const T={
  zh:{
    ctx:"账户登录",
    // brand
    tagline:"本地执行 · 云端同步",
    trust:"凭据经本地密钥加密，永不上云",
    deviceHint:"一个账户最多绑定 2 台执行设备",
    localExec:"本地执行",cloudSync:"云端同步",
    // signin
    siTitle:"登录你的账户",siSub:"使用 GoodDealer Cloud 账户继续",
    email:"邮箱",password:"密码",emailPh:"you@domain.com",pwPh:"输入密码",
    remember:"记住此设备",forgot:"忘记密码？",signIn:"登录",signingIn:"正在验证…",
    or:"或",google:"使用 Google 继续",github:"使用 GitHub 继续",passkey:"使用 Passkey 登录",
    noAccount:"还没有账户？",createOne:"创建账户",show:"显示",hide:"隐藏",
    // register
    rgTitle:"创建你的账户",rgSub:"一个账户，最多绑定 2 台执行设备",
    confirm:"确认密码",confirmPh:"再次输入密码",pwRule:"至少 10 位，含字母与数字",
    agreePre:"我已阅读并同意",terms:"服务条款",and:"与",privacy:"隐私政策",
    create:"创建账户",creating:"正在创建…",haveAccount:"已有账户？",toSignIn:"登录",
    pwMismatch:"两次输入的密码不一致",mustAgree:"请先同意服务条款与隐私政策",
    // verify
    vfTitle:"验证你的邮箱",vfSubA:"我们已向 ",vfSubB:" 发送 6 位验证码",
    code:"验证码",verify:"验证并继续",verifying:"正在验证…",
    resend:"重新发送验证码",resendIn:"秒后可重发",back:"返回",codeErr:"验证码有误，请重试",
    // forgot
    fgTitle:"重置密码",fgSub:"输入账户邮箱，我们将发送重置链接",
    sendLink:"发送重置链接",sending:"正在发送…",sentTitle:"重置链接已发送",
    sentSub:"若该邮箱已注册，你将很快收到一封含重置链接的邮件。",backToSignIn:"返回登录",
  },
  en:{
    ctx:"Account",
    tagline:"Local execution · Cloud sync",
    trust:"Credentials are encrypted by a local key. Never uploaded.",
    deviceHint:"Up to 2 execution devices per account",
    localExec:"Local execution",cloudSync:"Cloud sync",
    siTitle:"Sign in to your account",siSub:"Continue with your GoodDealer Cloud account",
    email:"Email",password:"Password",emailPh:"you@domain.com",pwPh:"Enter your password",
    remember:"Remember this device",forgot:"Forgot password?",signIn:"Sign in",signingIn:"Verifying…",
    or:"or",google:"Continue with Google",github:"Continue with GitHub",passkey:"Sign in with a passkey",
    noAccount:"Don't have an account?",createOne:"Create one",show:"Show",hide:"Hide",
    rgTitle:"Create your account",rgSub:"One account, up to 2 execution devices",
    confirm:"Confirm password",confirmPh:"Re-enter your password",pwRule:"At least 10 chars, letters and numbers",
    agreePre:"I agree to the",terms:"Terms of Service",and:"and",privacy:"Privacy Policy",
    create:"Create account",creating:"Creating…",haveAccount:"Already have an account?",toSignIn:"Sign in",
    pwMismatch:"Passwords don't match",mustAgree:"Please accept the Terms and Privacy Policy",
    vfTitle:"Verify your email",vfSubA:"We sent a 6-digit code to ",vfSubB:"",
    code:"Verification code",verify:"Verify & continue",verifying:"Verifying…",
    resend:"Resend code",resendIn:"s to resend",back:"Back",codeErr:"Incorrect code, try again",
    fgTitle:"Reset your password",fgSub:"Enter your account email and we'll send a reset link",
    sendLink:"Send reset link",sending:"Sending…",sentTitle:"Reset link sent",
    sentSub:"If that email is registered, you'll receive a reset link shortly.",backToSignIn:"Back to sign in",
  },
};

function LinkText({children,onClick}){
  return <button onClick={onClick} style={{background:"none",border:"none",padding:0,font:"inherit",fontSize:"inherit",color:"var(--text-link)",cursor:"pointer"}}
    onMouseEnter={e=>e.currentTarget.style.textDecoration="underline"} onMouseLeave={e=>e.currentTarget.style.textDecoration="none"}>{children}</button>;
}
function LangToggle({lang,setLang}){
  const opt=(k,l)=><button onClick={()=>setLang(k)} style={{padding:"3px 9px",fontSize:11,fontWeight:500,borderRadius:5,border:"none",cursor:"pointer",fontFamily:"var(--font-mono)",letterSpacing:"0.02em",
    background:lang===k?"var(--gd-panel-raised)":"transparent",color:lang===k?"var(--text-1)":"var(--text-3)"}}>{l}</button>;
  return <div style={{display:"inline-flex",gap:1,padding:2,borderRadius:7,border:"1px solid var(--gd-line)",background:"var(--gd-ink)"}}>{opt("zh","中")}{opt("en","EN")}</div>;
}
function Divider({label}){
  return <div style={{display:"flex",alignItems:"center",gap:12,margin:"2px 0"}}>
    <span style={{flex:1,height:1,background:"var(--gd-line)"}}></span>
    <span style={{fontSize:11,color:"var(--text-3)",textTransform:"uppercase",letterSpacing:"0.08em"}}>{label}</span>
    <span style={{flex:1,height:1,background:"var(--gd-line)"}}></span>
  </div>;
}
function Mono({ch}){
  return <span style={{width:20,height:20,flex:"none",display:"inline-flex",alignItems:"center",justifyContent:"center",borderRadius:5,border:"1px solid var(--gd-line-strong)",background:"var(--gd-ink)",fontFamily:"var(--font-mono)",fontSize:11,fontWeight:600,color:"var(--text-2)"}}>{ch}</span>;
}
function Oauth({mono,label,onClick}){
  return <button onClick={onClick} className="gd-btn gd-btn--md gd-btn--secondary" style={{width:"100%",justifyContent:"flex-start",gap:10,paddingLeft:9}}>
    <Mono ch={mono}/><span style={{flex:1,textAlign:"center",marginRight:20}}>{label}</span></button>;
}

// 6-cell verification code
function CodeInput({value,onChange,error}){
  const refs=React.useRef([]);
  const set=(i,v)=>{const c=(value+"").padEnd(6," ").split("");c[i]=v.slice(-1)||" ";const nv=c.join("").replace(/ /g,"").slice(0,6);onChange(nv);};
  const cells=[];for(let i=0;i<6;i++){
    const ch=(value||"")[i]||"";
    cells.push(<input key={i} ref={el=>refs.current[i]=el} value={ch} inputMode="numeric" maxLength={1}
      onChange={e=>{const d=e.target.value.replace(/\D/g,"");set(i,d);if(d&&refs.current[i+1])refs.current[i+1].focus();}}
      onKeyDown={e=>{if(e.key==="Backspace"&&!ch&&refs.current[i-1])refs.current[i-1].focus();}}
      style={{width:42,height:50,textAlign:"center",fontFamily:"var(--font-mono)",fontSize:20,color:"var(--text-1)",caretColor:"var(--gd-blue)",
        background:"var(--gd-ink)",border:`1px solid ${error?"var(--gd-danger)":ch?"var(--gd-line-strong)":"var(--gd-line)"}`,borderRadius:7,outline:"none"}}
      onFocus={e=>e.target.style.borderColor="var(--gd-blue)"} onBlur={e=>e.target.style.borderColor=error?"var(--gd-danger)":ch?"var(--gd-line-strong)":"var(--gd-line)"}/>);
  }
  return <div style={{display:"flex",gap:8}}>{cells}</div>;
}

function SignIn({onAuthed}){
  const I=window.GDI;
  const [lang,setLang]=React.useState("zh");const t=T[lang];
  const [mode,setMode]=React.useState("signin"); // signin | register | verify | forgot
  const [email,setEmail]=React.useState("");
  const [pw,setPw]=React.useState("");const [pw2,setPw2]=React.useState("");
  const [showPw,setShowPw]=React.useState(false);
  const [remember,setRemember]=React.useState(true);
  const [agree,setAgree]=React.useState(false);
  const [code,setCode]=React.useState("");
  const [busy,setBusy]=React.useState(false);
  const [err,setErr]=React.useState("");
  const [sent,setSent]=React.useState(false);
  const [cool,setCool]=React.useState(0);
  React.useEffect(()=>{if(cool<=0)return;const id=setTimeout(()=>setCool(cool-1),1000);return()=>clearTimeout(id);},[cool]);
  const go=(m)=>{setErr("");setBusy(false);setSent(false);setMode(m);};

  const doSignIn=()=>{setErr("");setBusy(true);setTimeout(()=>onAuthed&&onAuthed(),950);};
  const doRegister=()=>{setErr("");
    if(pw.length<10||pw!==pw2){setErr(t.pwMismatch);return;}
    if(!agree){setErr(t.mustAgree);return;}
    setBusy(true);setTimeout(()=>{setBusy(false);setCode("");setCool(45);go("verify");},900);};
  const doVerify=()=>{setErr("");if(code.length<6){setErr(t.codeErr);return;}setBusy(true);setTimeout(()=>onAuthed&&onAuthed(),950);};
  const doForgot=()=>{setBusy(true);setTimeout(()=>{setBusy(false);setSent(true);},900);};

  const pwSuffix=<button onClick={e=>{e.preventDefault();setShowPw(s=>!s);}} tabIndex={-1}
    style={{background:"none",border:"none",padding:0,cursor:"pointer",color:"var(--text-3)",fontSize:11}}>{showPw?t.hide:t.show}</button>;

  // ——— right-panel bodies ———
  const signinBody=<>
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      <SInput label={t.email} size="lg" type="email" placeholder={t.emailPh} value={email} onChange={e=>setEmail(e.target.value)} autoFocus/>
      <div style={{display:"flex",flexDirection:"column",gap:6}}>
        <SInput label={t.password} size="lg" type={showPw?"text":"password"} placeholder={t.pwPh} value={pw} onChange={e=>setPw(e.target.value)} suffix={pwSuffix} onKeyDown={e=>e.key==="Enter"&&email&&pw&&doSignIn()}/>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",fontSize:12}}>
          <SCheck checked={remember} onChange={e=>setRemember(e.target?.checked??!remember)} label={t.remember}/>
          <LinkText onClick={()=>go("forgot")}>{t.forgot}</LinkText>
        </div>
      </div>
    </div>
    {err&&<div style={{fontSize:12,color:"var(--gd-danger)"}}>{err}</div>}
    <SBtn variant="primary" size="lg" block disabled={busy||!email||!pw} onClick={doSignIn}
      icon={busy?<I.RefreshCw size={15} style={{animation:"gd-spinner 1s linear infinite"}}/>:null}>{busy?t.signingIn:t.signIn}</SBtn>
    <Divider label={t.or}/>
    <div style={{display:"flex",flexDirection:"column",gap:8}}>
      <Oauth mono="G" label={t.google} onClick={doSignIn}/>
      <Oauth mono="GH" label={t.github} onClick={doSignIn}/>
      <button onClick={doSignIn} className="gd-btn gd-btn--md gd-btn--gold" style={{width:"100%",justifyContent:"flex-start",gap:10,paddingLeft:9}}>
        <img src="../../assets/icons/keyhole.svg" width="18" height="18" alt="" style={{flex:"none"}}/><span style={{flex:1,textAlign:"center",marginRight:20}}>{t.passkey}</span></button>
    </div>
    <div style={{marginTop:"auto",paddingTop:8,fontSize:13,color:"var(--text-2)",display:"flex",gap:6,justifyContent:"center"}}>
      <span>{t.noAccount}</span><LinkText onClick={()=>go("register")}>{t.createOne}</LinkText></div>
  </>;

  const registerBody=<>
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      <SInput label={t.email} size="lg" type="email" placeholder={t.emailPh} value={email} onChange={e=>setEmail(e.target.value)} autoFocus/>
      <SInput label={t.password} size="lg" type={showPw?"text":"password"} placeholder={t.pwPh} value={pw} onChange={e=>setPw(e.target.value)} suffix={pwSuffix} hint={t.pwRule}/>
      <SInput label={t.confirm} size="lg" type={showPw?"text":"password"} placeholder={t.confirmPh} value={pw2} onChange={e=>setPw2(e.target.value)}/>
      <div style={{display:"flex",alignItems:"flex-start",gap:9,fontSize:12,color:"var(--text-2)",lineHeight:1.5}}>
        <span style={{marginTop:1}}><SCheck checked={agree} onChange={e=>setAgree(e.target?.checked??!agree)}/></span>
        <span>{t.agreePre} <LinkText onClick={()=>{}}>{t.terms}</LinkText> {t.and} <LinkText onClick={()=>{}}>{t.privacy}</LinkText></span></div>
    </div>
    {err&&<div style={{fontSize:12,color:"var(--gd-danger)"}}>{err}</div>}
    <SBtn variant="primary" size="lg" block disabled={busy||!email||!pw||!pw2} onClick={doRegister}
      icon={busy?<I.RefreshCw size={15} style={{animation:"gd-spinner 1s linear infinite"}}/>:null}>{busy?t.creating:t.create}</SBtn>
    <div style={{marginTop:"auto",paddingTop:8,fontSize:13,color:"var(--text-2)",display:"flex",gap:6,justifyContent:"center"}}>
      <span>{t.haveAccount}</span><LinkText onClick={()=>go("signin")}>{t.toSignIn}</LinkText></div>
  </>;

  const verifyBody=<>
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      <span className="gd-t-label" style={{fontSize:11,letterSpacing:"var(--tracking-caps)",textTransform:"uppercase",color:"var(--text-2)"}}>{t.code}</span>
      <CodeInput value={code} onChange={setCode} error={!!err}/>
      {err&&<div style={{fontSize:12,color:"var(--gd-danger)"}}>{err}</div>}
    </div>
    <SBtn variant="primary" size="lg" block disabled={busy||code.length<6} onClick={doVerify}
      icon={busy?<I.RefreshCw size={15} style={{animation:"gd-spinner 1s linear infinite"}}/>:<I.Shield size={15}/>}>{busy?t.verifying:t.verify}</SBtn>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",fontSize:12,marginTop:2}}>
      <LinkText onClick={()=>go("register")}>{t.back}</LinkText>
      {cool>0?<span style={{color:"var(--text-3)",fontFamily:"var(--font-mono)"}}>{cool}{lang==="zh"?" ":""}{t.resendIn}</span>:<LinkText onClick={()=>setCool(45)}>{t.resend}</LinkText>}
    </div>
  </>;

  const forgotBody=sent?<>
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:14,textAlign:"center",margin:"12px 0"}}>
      <span style={{width:52,height:52,borderRadius:"50%",background:"var(--gd-success-tint)",border:"1px solid var(--gd-success)",display:"inline-flex",alignItems:"center",justifyContent:"center"}}><I.Check size={26} style={{color:"var(--gd-success)"}}/></span>
      <div><div style={{fontSize:16,fontWeight:600,color:"var(--text-1)"}}>{t.sentTitle}</div>
      <div style={{fontSize:13,color:"var(--text-2)",marginTop:6,lineHeight:1.5}}>{t.sentSub}</div></div>
    </div>
    <SBtn variant="secondary" size="lg" block onClick={()=>go("signin")}>{t.backToSignIn}</SBtn>
  </>:<>
    <SInput label={t.email} size="lg" type="email" placeholder={t.emailPh} value={email} onChange={e=>setEmail(e.target.value)} autoFocus/>
    <SBtn variant="primary" size="lg" block disabled={busy||!email} onClick={doForgot}
      icon={busy?<I.RefreshCw size={15} style={{animation:"gd-spinner 1s linear infinite"}}/>:null}>{busy?t.sending:t.sendLink}</SBtn>
    <div style={{marginTop:2}}><LinkText onClick={()=>go("signin")}>{t.backToSignIn}</LinkText></div>
  </>;

  const HEAD={signin:[t.siTitle,t.siSub],register:[t.rgTitle,t.rgSub],verify:[t.vfTitle,null],forgot:[t.fgTitle,t.fgSub]};
  const [hTitle,hSub]=HEAD[mode];
  const body={signin:signinBody,register:registerBody,verify:verifyBody,forgot:forgotBody}[mode];

  return <SWin appName="GoodDealer" context={t.ctx} mark={<img src="../../assets/logo/mark-16.svg" width="16" height="16" alt=""/>}
    style={{width:920,height:600,maxWidth:"100%",maxHeight:"100%"}} onClose={()=>{}}>
    {/* ——— brand panel ——— */}
    <div style={{width:380,flex:"none",position:"relative",overflow:"hidden",borderRight:"1px solid var(--gd-line)",background:"var(--gd-panel)",display:"flex",flexDirection:"column",padding:"40px 40px 36px"}}>
      <div style={{position:"absolute",width:440,height:440,left:"50%",top:"44%",transform:"translate(-50%,-50%)",borderRadius:"50%",background:"radial-gradient(circle,rgba(212,164,55,0.13),transparent 68%)",pointerEvents:"none"}}></div>
      <div style={{position:"relative",margin:"auto 0",display:"flex",flexDirection:"column",alignItems:"center",textAlign:"center",gap:26}}>
        <img src="../../assets/logo/mark.svg" width="132" height="132" alt="GoodDealer"/>
        <div style={{fontSize:15,color:"var(--text-2)",letterSpacing:"0.05em"}}>{t.tagline}</div>
      </div>
      <div style={{position:"relative",display:"flex",flexDirection:"column",gap:14}}>
        <div style={{height:1,background:"var(--gd-line)"}}></div>
        <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
          <I.Shield size={14} style={{color:"var(--gd-gold)",marginTop:2,flex:"none"}}/>
          <span style={{fontSize:12,color:"var(--text-3)",lineHeight:1.55}}>{t.trust}</span>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <SDot kind="active" size={7}/><span style={{fontSize:11.5,color:"var(--text-3)"}}>GoodDealer Cloud · {lang==="zh"?"≤ 2 台执行设备":"≤ 2 devices"}</span>
        </div>
      </div>
    </div>
    {/* ——— form panel ——— */}
    <div style={{flex:1,minWidth:0,display:"flex",flexDirection:"column",background:"var(--gd-ink)"}}>
      <div style={{display:"flex",justifyContent:"flex-end",padding:"12px 16px 2px"}}><LangToggle lang={lang} setLang={setLang}/></div>
      <div style={{flex:1,minHeight:0,overflowY:"auto",padding:"2px 40px 22px",display:"flex",flexDirection:"column"}}>
        <div style={{marginBottom:16}}>
          <div style={{fontSize:20,fontWeight:600,letterSpacing:"-0.02em",color:"var(--text-1)"}}>{hTitle}</div>
          {hSub&&<div style={{fontSize:13,color:"var(--text-2)",marginTop:5}}>{hSub}</div>}
          {mode==="verify"&&<div style={{fontSize:13,color:"var(--text-2)",marginTop:5}}>{t.vfSubA}<span style={{color:"var(--text-1)",fontFamily:"var(--font-mono)"}}>{email||"you@domain.com"}</span>{t.vfSubB}</div>}
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:12,flex:1}}>{body}</div>
      </div>
    </div>
  </SWin>;
}
window.GDSignIn=SignIn;
