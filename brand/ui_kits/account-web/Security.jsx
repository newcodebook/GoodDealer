// 安全 Security — 2FA, recovery codes, password, active sessions. Reinforces: platform
// credentials are encrypted locally and never appear here (they never go to cloud).
const {Panel:SPanel,Badge:SBadge,Button:SBtn,Switch:SSwitch,Dialog:SDlg,Input:SInput,StatusDot:SDot,IconButton:SIcon}=window.GoodDealerDesignSystem_b5b0b6;

function SessionRow({s,onRevoke}){
  const I=window.GDI;const Ic={desktop:I.Monitor,web:I.Globe,mobile:I.Smartphone}[s.kind]||I.Globe;
  return <div style={{display:"flex",alignItems:"center",gap:12,padding:"12px 16px",borderBottom:"1px solid var(--gd-line)",background:s.flag?"var(--gd-warning-tint)":"transparent"}}>
    <Ic size={17} style={{color:s.flag?"var(--gd-warning)":"var(--gd-text-muted)",flex:"none"}}/>
    <div style={{flex:1,minWidth:0,display:"flex",flexDirection:"column",gap:3}}>
      <span style={{fontSize:12.5,color:"var(--text-1)",display:"flex",alignItems:"center",gap:8}}>{s.device}{s.current&&<SBadge tone="success">本次会话</SBadge>}{s.flag&&<SBadge tone="warning" mono={false}>异常位置</SBadge>}</span>
      <span style={{fontSize:11,color:"var(--text-3)",fontFamily:"var(--font-mono)"}}>{s.location} · {s.ip}</span>
    </div>
    <span style={{fontFamily:"var(--font-mono)",fontSize:11,color:"var(--text-3)",flex:"none"}}>{s.last}</span>
    <span style={{width:64,flex:"none",display:"flex",justifyContent:"flex-end"}}>{s.current?<span style={{fontSize:11,color:"var(--text-3)"}}>当前</span>:<SBtn size="sm" variant="ghost" onClick={()=>onRevoke(s)}>终止</SBtn>}</span>
  </div>;
}

function Security(){
  const D=window.GD_ACCOUNT;const I=window.GDI;const MetricStrip=window.GDMetricStrip;
  const [sessions,setSessions]=React.useState(()=>D.sessions.map(s=>({...s})));
  const [totp,setTotp]=React.useState(true);
  const [sms,setSms]=React.useState(false);
  const [dlg,setDlg]=React.useState(null); // pw | codes | revokeAll
  const flagged=sessions.filter(s=>s.flag).length;
  return <div data-screen-label="安全" style={{display:"flex",flexDirection:"column",minHeight:0}}>
    <MetricStrip metrics={[
      {label:"双重验证",value:totp?"已启用":"未启用",tone:totp?"success":"danger",meta:"Authenticator app"},
      {label:"活跃会话",value:sessions.length+" 个",meta:"1 桌面 · 1 移动 · 网页"},
      {label:"异常登录",value:flagged+" 处",tone:flagged?"warning":"success",meta:flagged?"东京 · 建议核实":"无"},
      {label:"恢复码",value:"8 个",meta:"剩余可用"},
      {label:"上次改密",value:"92 天前",mono:true,meta:"2026-05-17"},
    ]}/>
    <div style={{padding:18,display:"grid",gridTemplateColumns:"1fr 340px",gap:14,alignItems:"start"}}>
      <div style={{display:"flex",flexDirection:"column",gap:14,minWidth:0}}>
        <SPanel flush title="活跃会话" actions={<SBtn size="sm" variant="ghost" onClick={()=>setDlg("revokeAll")}>终止其它全部会话</SBtn>}>
          {sessions.map(s=><SessionRow key={s.id} s={s} onRevoke={rs=>setSessions(ss=>ss.filter(x=>x.id!==rs.id))}/>)}
        </SPanel>
        <div style={{display:"flex",gap:12,padding:"13px 15px",border:"1px solid var(--gd-line)",borderRadius:7,background:"var(--gd-panel)"}}>
          <img src="../../assets/icons/keyhole.svg" width="26" height="26" alt="" style={{flex:"none",marginTop:1,opacity:.9}}/>
          <span style={{fontSize:12,color:"var(--text-2)",lineHeight:1.6}}>注册商、DNS、交易平台的 <b style={{color:"var(--text-1)",fontWeight:500}}>平台凭据经本地密钥加密保存，永不上云</b>，因此不会出现在本页面或任何云端。此处仅管理 GoodDealer 账户本身的登录与验证。</span>
        </div>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:14,minWidth:0}}>
        <SPanel title="双重验证 2FA">
          <div style={{display:"flex",flexDirection:"column"}}>
            <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 0",borderBottom:"1px solid var(--gd-line)"}}>
              <I.Lock size={16} style={{color:totp?"var(--gd-success)":"var(--text-3)",flex:"none"}}/>
              <div style={{flex:1,minWidth:0}}><div style={{fontSize:12.5,color:"var(--text-1)"}}>Authenticator App</div><div style={{fontSize:11,color:"var(--text-3)"}}>TOTP · 每 30 秒</div></div>
              <SSwitch checked={totp} onChange={()=>setTotp(v=>!v)}/>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 0",borderBottom:"1px solid var(--gd-line)"}}>
              <I.Smartphone size={16} style={{color:sms?"var(--gd-success)":"var(--text-3)",flex:"none"}}/>
              <div style={{flex:1,minWidth:0}}><div style={{fontSize:12.5,color:"var(--text-1)"}}>短信验证码</div><div style={{fontSize:11,color:"var(--text-3)"}}>+86 ··· ··· 8821</div></div>
              <SSwitch checked={sms} onChange={()=>setSms(v=>!v)}/>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 0"}}>
              <I.ShieldCheck size={16} style={{color:"var(--text-3)",flex:"none"}}/>
              <div style={{flex:1,minWidth:0}}><div style={{fontSize:12.5,color:"var(--text-1)"}}>硬件安全密钥</div><div style={{fontSize:11,color:"var(--text-3)"}}>WebAuthn · 未添加</div></div>
              <SBtn size="sm" variant="ghost">添加</SBtn>
            </div>
          </div>
        </SPanel>
        <SPanel title="恢复码" actions={<SBadge tone="success">8 剩余</SBadge>}>
          <p style={{fontSize:12,color:"var(--text-2)",lineHeight:1.6,margin:"0 0 10px"}}>丢失验证设备时用于登录。请离线保存，每个仅可使用一次。</p>
          <div style={{display:"flex",gap:9}}><SBtn size="sm" onClick={()=>setDlg("codes")}>查看恢复码</SBtn><SBtn size="sm" variant="ghost" icon={<I.RefreshCw size={13}/>} onClick={()=>setDlg("codes")}>重新生成</SBtn></div>
        </SPanel>
        <SPanel title="密码">
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <span style={{fontFamily:"var(--font-mono)",fontSize:14,color:"var(--text-2)",letterSpacing:"0.1em"}}>············</span>
            <SBtn size="sm" style={{marginLeft:"auto"}} onClick={()=>setDlg("pw")}>更改密码</SBtn>
          </div>
        </SPanel>
      </div>
    </div>
    <SDlg open={dlg==="pw"} onClose={()=>setDlg(null)} title="更改密码" width={420}
      footer={<><SBtn onClick={()=>setDlg(null)}>取消</SBtn><SBtn variant="primary" onClick={()=>setDlg(null)}>更新密码</SBtn></>}>
      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        <SInput label="当前密码" placeholder="••••••••"/><SInput label="新密码" placeholder="至少 12 位"/><SInput label="确认新密码" placeholder="再次输入"/>
        <span style={{fontSize:11,color:"var(--text-3)"}}>更改密码会终止其它全部会话。</span>
      </div>
    </SDlg>
    <SDlg open={dlg==="codes"} onClose={()=>setDlg(null)} title="恢复码" width={420}
      footer={<><SBtn onClick={()=>setDlg(null)}>关闭</SBtn><SBtn variant="primary" icon={<I.Download size={13}/>} onClick={()=>setDlg(null)}>下载 .txt</SBtn></>}>
      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          {["8F2A-C91D","4E7B-2AD0","91C3-7FE1","B0D4-3A88","6C2E-91FA","D74B-0C15","3E9A-B72D","F10C-8E44"].map(c=><span key={c} style={{fontFamily:"var(--font-mono)",fontSize:13,color:"var(--gd-gold)",padding:"7px 10px",background:"var(--gd-ink)",border:"1px solid var(--gd-line-strong)",borderRadius:5,textAlign:"center",letterSpacing:"0.04em"}}>{c}</span>)}
        </div>
        <span style={{fontSize:11,color:"var(--text-3)"}}>每个恢复码仅可使用一次。重新生成会使旧码全部失效。</span>
      </div>
    </SDlg>
    <SDlg open={dlg==="revokeAll"} onClose={()=>setDlg(null)} title="终止其它全部会话" width={420} danger
      footer={<><SBtn onClick={()=>setDlg(null)}>取消</SBtn><SBtn variant="danger" onClick={()=>{setSessions(ss=>ss.filter(s=>s.current));setDlg(null);}}>终止 {sessions.filter(s=>!s.current).length} 个会话</SBtn></>}>
      <span style={{fontSize:13,color:"var(--text-2)",lineHeight:1.6}}>将登出除本次会话外的全部设备与网页会话（含桌面客户端）。桌面客户端需重新登录，但不影响已绑定设备的执行权与本地数据。</span>
    </SDlg>
  </div>;
}
window.GDSecurity=Security;
