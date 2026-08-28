// 下载客户端 Download — get the Tauri desktop client; local execution + device gating live there.
const {Panel:DlPanel,Badge:DlBadge,Button:DlBtn}=window.GoodDealerDesignSystem_b5b0b6;

function ReleaseCard({r}){
  const I=window.GDI;const Ic=I[r.icon];const rec=r.note.indexOf("推荐")>=0;
  return <div style={{padding:"18px 18px 16px",border:rec?"1px solid rgba(212,164,55,0.4)":"1px solid var(--gd-line)",borderRadius:8,background:"var(--gd-panel)",display:"flex",flexDirection:"column",gap:12,position:"relative"}}>
    {rec&&<span style={{position:"absolute",top:14,right:14}}><DlBadge tone="gold">推荐</DlBadge></span>}
    <Ic size={26} style={{color:rec?"var(--gd-gold)":"var(--text-2)"}}/>
    <div><div style={{fontSize:15,fontWeight:600,color:"var(--text-1)"}}>{r.os}</div><div style={{fontSize:11,color:"var(--text-3)",marginTop:3}}>{r.variant}</div></div>
    <div style={{display:"flex",gap:12,fontSize:11,color:"var(--text-3)",fontFamily:"var(--font-mono)",marginTop:"auto"}}><span>v{r.ver}</span><span>{r.size}</span></div>
    <DlBtn size="sm" variant={rec?"primary":"secondary"} icon={<I.Download size={13}/>} block>下载 {r.os} 版</DlBtn>
  </div>;
}

function StepRow({n,t,s}){
  return <div style={{display:"flex",gap:11}}>
    <span style={{width:22,height:22,flex:"none",borderRadius:"50%",border:"1px solid var(--gd-line-strong)",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"var(--font-mono)",fontSize:11,color:"var(--gd-gold)"}}>{n}</span>
    <div><div style={{fontSize:12.5,color:"var(--text-1)"}}>{t}</div><div style={{fontSize:11,color:"var(--text-3)",marginTop:2}}>{s}</div></div>
  </div>;
}

function Download(){
  const D=window.GD_ACCOUNT;const I=window.GDI;
  const steps=[["1","打开客户端，选择「绑定到此账户」并登录","本机将作为一个绑定设备（最多 2 台）"],["2","完成设备门禁校验","本机生成设备密钥，Cloud 签发 ActiveDeviceLease"],["3","连接注册商 / DNS / 交易平台","账号身份与凭据加密保存在本地，永不上云"],["4","首次导入本地业务库","数据先写本地 SQLCipher，允许字段随后异步复制"]];
  const reqs=[["macOS","13 Ventura 及以上 · Apple Silicon / Intel"],["Windows","10 / 11 · 64-bit"],["Linux","Ubuntu 22.04+ / Fedora 38+ · AppImage · .deb"],["网络","首次登录授权需联网；授权离线窗口内可继续本地业务"]];
  const changes=["议价交割闭环：报价 → 平台费 → 净收入确认门","冲突中心三方裁决与逐项覆盖","批量执行差异预览新增高风险承认门","设备门禁 Sunset · LocalContinuation 保留态"];
  return <div data-screen-label="下载客户端" style={{padding:18,maxWidth:900,display:"flex",flexDirection:"column",gap:14}}>
    <div style={{display:"flex",alignItems:"center",gap:20,padding:"22px 24px",border:"1px solid var(--gd-line)",borderRadius:9,background:"linear-gradient(105deg,rgba(212,164,55,0.06),transparent 55%),var(--gd-panel)"}}>
      <img src="../../assets/logo/app-icon-tile.svg" width="60" height="60" alt="" style={{flex:"none"}}/>
      <div style={{flex:1,minWidth:0}}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:6}}>
          <span style={{fontSize:19,fontWeight:600,color:"var(--text-1)",letterSpacing:"-0.01em"}}>GoodDealer 桌面客户端</span>
          <DlBadge tone="gold">v0.9.0</DlBadge>
        </div>
        <p style={{fontSize:13,color:"var(--text-2)",lineHeight:1.6,margin:0,maxWidth:520}}>本地执行、云端同步的域名资产管理终端。批量执行、差异预览、议价交割、冲突裁决与设备门禁都在客户端完成——平台凭据经本地密钥加密，永不上云。</p>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:8,alignItems:"flex-end",flex:"none"}}>
        <DlBtn size="lg" variant="primary" icon={<I.Apple size={16}/>}>下载 macOS 版</DlBtn>
        <span style={{fontSize:11,color:"var(--text-3)",fontFamily:"var(--font-mono)"}}>检测到你的系统 · Apple Silicon</span>
      </div>
    </div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:14}}>
      {D.releases.map(r=><ReleaseCard key={r.os} r={r}/>)}
    </div>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
      <DlPanel title="安装后：绑定到此账户">
        <div style={{display:"flex",flexDirection:"column",gap:11}}>
          {steps.map(s=><StepRow key={s[0]} n={s[0]} t={s[1]} s={s[2]}/>)}
        </div>
      </DlPanel>
      <div style={{display:"flex",flexDirection:"column",gap:14}}>
        <DlPanel title="系统要求">
          <div style={{display:"flex",flexDirection:"column"}}>
            {reqs.map(x=><div key={x[0]} style={{display:"flex",gap:12,padding:"7px 0",borderBottom:"1px solid var(--gd-line)",fontSize:12}}><span style={{width:70,flex:"none",color:"var(--text-3)"}}>{x[0]}</span><span style={{color:"var(--text-2)",flex:1}}>{x[1]}</span></div>)}
          </div>
        </DlPanel>
        <DlPanel title="更新日志 · 0.9.0" actions={<DlBtn size="sm" variant="ghost" icon={<I.ExternalLink size={13}/>}>全部</DlBtn>}>
          <div style={{display:"flex",flexDirection:"column",gap:7,fontSize:12,color:"var(--text-2)",lineHeight:1.5}}>
            {changes.map((c,i)=><div key={i} style={{display:"flex",gap:8}}><span style={{color:"var(--gd-gold)",flex:"none"}}>·</span>{c}</div>)}
          </div>
        </DlPanel>
      </div>
    </div>
  </div>;
}
window.GDDownload=Download;
