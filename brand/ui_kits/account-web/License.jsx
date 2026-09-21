// 订阅与许可 License — one feature tier with monthly, annual, and 10-year fixed terms.
const {Panel:LPanel,Badge:LBadge,Button:LBtn,Money:LMoney,ProgressBar:LProg,Switch:LSwitch,Dialog:LDlg,Input:LInput,StatusDot:LDot}=window.GoodDealerDesignSystem_b5b0b6;

const TERMS=[
  {k:"月付",price:9.8,unit:"/月",domains:"完整功能",devices:"2 台设备 · 单活动",feats:["按月续费","随时取消"]},
  {k:"年付",price:98,unit:"/年",domains:"完整功能",devices:"2 台设备 · 单活动",feats:["按年续费","约省 17%"]},
  {k:"10 年固定期",price:498,unit:"/10 年",domains:"完整功能",devices:"2 台设备 · 单活动",feats:["一次预付 10 年","不自动续费 · 非永久"]},
];

function Feat({on,children}){
  const I=window.GDI;
  return <div style={{display:"flex",alignItems:"center",gap:8,fontSize:12,color:on?"var(--text-2)":"var(--text-3)"}}>
    <I.Check size={13} style={{color:on?"var(--gd-success)":"var(--text-3)",flex:"none"}}/>{children}</div>;
}

function License(){
  const D=window.GD_ACCOUNT;const I=window.GDI;const MetricStrip=window.GDMetricStrip;
  const [autoRenew,setAutoRenew]=React.useState(D.license.autoRenew);
  const [dlg,setDlg]=React.useState(null); // pay | upgrade | cancel
  const [target,setTarget]=React.useState(null);
  return <div data-screen-label="订阅与许可" style={{display:"flex",flexDirection:"column",minHeight:0}}>
    <MetricStrip metrics={[
      {label:"当前期限",value:"年付",tone:"gold",meta:"单一功能档位"},
      {label:"年费",value:"$98.00",tone:"gold",meta:"下次扣款 2026-12-31"},
      {label:"本期剩余",value:"136 天",tone:"warning",meta:"已用 63%"},
      {label:"所有权验证",value:"已验证",tone:"success",meta:"本地密钥签发"},
      {label:"设备额度",value:"2 台",meta:"单活动执行权"},
    ]}/>
    <div style={{padding:18,display:"grid",gridTemplateColumns:"1fr 320px",gap:14,alignItems:"start"}}>
      <div style={{display:"flex",flexDirection:"column",gap:14,minWidth:0}}>
        <LPanel title="当前付费期限" actions={<span style={{display:"flex",alignItems:"center",gap:7,fontSize:12,color:"var(--text-2)"}}>自动续费 <LSwitch checked={autoRenew} onChange={()=>setAutoRenew(v=>!v)}/></span>}>
          <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:14}}>
            <span style={{fontSize:20,fontWeight:600,color:"var(--text-1)"}}>年付 License</span>
            <LBadge tone="gold">ANNUAL</LBadge>
            <LMoney amount={98} size={15}/><span style={{fontSize:12,color:"var(--text-3)"}}>/ 年</span>
          </div>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:"var(--text-3)",marginBottom:6,fontFamily:"var(--font-mono)"}}><span>2025-12-31 开始</span><span>剩余 136 天</span><span>2026-12-31 续费</span></div>
          <LProg value={63} height={6}/>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:14,margin:"16px 0 4px"}}>
            {[["无限域名","已管理 1,024"],["2 台设备","单活动执行权"],["全部平台连接","Atom · Afternic · SellerHub"],["批量执行","差异预览 · 回滚"],["冲突中心","三方裁决"],["议价交割","托管交易闭环"]].map(([t,s])=>
              <div key={t} style={{display:"flex",flexDirection:"column",gap:3,padding:"10px 12px",background:"var(--gd-panel-raised)",border:"1px solid var(--gd-line)",borderRadius:7}}>
                <span style={{display:"flex",alignItems:"center",gap:6,fontSize:12.5,color:"var(--text-1)"}}><I.Check size={13} style={{color:"var(--gd-success)"}}/>{t}</span>
                <span style={{fontSize:11,color:"var(--text-3)",paddingLeft:19}}>{s}</span>
              </div>)}
          </div>
          <div style={{display:"flex",gap:9,marginTop:14,paddingTop:14,borderTop:"1px solid var(--gd-line)"}}>
            <LBtn size="sm" variant="primary" onClick={()=>{setTarget(TERMS[0]);setDlg("upgrade");}}>切换计费周期</LBtn>
            <LBtn size="sm" onClick={()=>setDlg("pay")}>管理支付方式</LBtn>
            <LBtn size="sm" variant="ghost" onClick={()=>setDlg("cancel")} icon={<I.Ban size={13}/>}>取消续订</LBtn>
          </div>
        </LPanel>
        <LPanel title="所有权与许可证书" actions={<LBadge tone="success" dot>已验证</LBadge>}>
          <div style={{display:"flex",gap:14,alignItems:"flex-start"}}>
            <img src="../../assets/graphics/seal.svg" width="44" height="44" alt="" style={{flex:"none",marginTop:2}}/>
            <div style={{flex:1,minWidth:0}}>
              <p style={{fontSize:12,color:"var(--text-2)",lineHeight:1.6,margin:"0 0 12px"}}>License 由本地密钥签发并绑定 Workspace 所有权，凭据永不上云。证书用于设备门禁与离线校验。</p>
              <div style={{display:"flex",alignItems:"center",gap:10,padding:"9px 12px",background:"var(--gd-ink)",border:"1px solid var(--gd-line-strong)",borderRadius:5,fontFamily:"var(--font-mono)",fontSize:12}}>
                <span style={{color:"var(--text-3)"}}>License Key</span>
                <span style={{color:"var(--gd-gold)",letterSpacing:"0.02em"}}>GD-LIC-8F2A-C91D-··· ·-4E7B</span>
                <LBtn size="sm" variant="ghost" icon={<I.Copy size={13}/>} style={{marginLeft:"auto"}}>复制</LBtn>
              </div>
              <div style={{display:"flex",gap:9,marginTop:12}}><LBtn size="sm" variant="ghost" icon={<I.Download size={13}/>}>下载证书</LBtn><LBtn size="sm" variant="ghost" icon={<I.RefreshCw size={13}/>}>轮换密钥</LBtn></div>
            </div>
          </div>
        </LPanel>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:14,minWidth:0}}>
        <LPanel flush title="付费期限对比">
          {TERMS.map(t=>{const cur=t.k==="年付";return <div key={t.k} style={{padding:"13px 16px",borderBottom:"1px solid var(--gd-line)",background:cur?"linear-gradient(90deg,rgba(212,164,55,0.05),transparent 60%)":"transparent"}}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
              <span style={{fontSize:13,fontWeight:600,color:"var(--text-1)"}}>{t.k}</span>
              {cur&&<LBadge tone="gold">当前</LBadge>}
              <span style={{marginLeft:"auto",display:"flex",alignItems:"baseline",gap:3}}><LMoney amount={t.price} size={13} tone={cur?"gold":"body"}/><span style={{fontSize:10,color:"var(--text-3)"}}>{t.unit}</span></span>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:5}}>
              <Feat on>{t.domains}</Feat><Feat on>{t.devices}</Feat>
              {t.feats.slice(0,2).map(f=><Feat key={f} on>{f}</Feat>)}
            </div>
            {!cur&&<LBtn size="sm" variant={t.k==="10 年固定期"?"primary":"ghost"} style={{width:"100%",marginTop:10}} onClick={()=>{setTarget(t);setDlg("upgrade");}}>选择 {t.k}</LBtn>}
          </div>;})}
        </LPanel>
        <LPanel title="本月用量">
          {[["域名",D.usage.domains.toLocaleString(),"无限"],["绑定设备","2","2 台"],["平台连接","4",""],["云端存储","38 MB",""]].map(([k,v,cap])=>
            <div key={k} style={{display:"flex",alignItems:"center",padding:"8px 0",borderBottom:"1px solid var(--gd-line)",fontSize:12.5}}>
              <span style={{flex:1,color:"var(--text-2)"}}>{k}</span>
              <span style={{fontFamily:"var(--font-mono)",color:"var(--text-1)"}}>{v}</span>
              {cap&&<span style={{fontFamily:"var(--font-mono)",fontSize:11,color:"var(--text-3)",marginLeft:6}}>/ {cap}</span>}
            </div>)}
        </LPanel>
      </div>
    </div>
    <LDlg open={dlg==="pay"} onClose={()=>setDlg(null)} title="Stripe 托管付款" width={440}
      footer={<LBtn onClick={()=>setDlg(null)}>关闭</LBtn>}>
      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        <LBtn variant="primary" icon={<I.ExternalLink size={13}/>}>Stripe 托管结账</LBtn>
        <LInput label="优惠码（可选）" mono placeholder="LAUNCH"/>
        <span style={{fontSize:11,color:"var(--text-3)",lineHeight:1.55}}>首发付款由 Stripe 托管；税费由托管结账显示。GoodDealer 不采集卡号或付款账户资料。无免费试用；每账号首次付费购买可在付款后 14 天内全额退款，续费不重置窗口。</span>
      </div>
    </LDlg>
    <LDlg open={dlg==="upgrade"} onClose={()=>setDlg(null)} title={target?`切换到 ${target.k}`:""} width={460}
      footer={<><LBtn onClick={()=>setDlg(null)}>取消</LBtn><LBtn variant="primary" onClick={()=>setDlg(null)}>选择 {target&&target.k} · ${target&&target.price}{target&&target.unit}</LBtn></>}>
      {target&&<div style={{display:"flex",flexDirection:"column",gap:12}}>
        <span style={{fontSize:13}}>从 <b>年付 · $98/年</b> 切换到 <b style={{color:"var(--gd-gold)"}}>{target.k} · ${target.price}{target.unit}</b>。</span>
        <div style={{border:"1px solid var(--gd-line-strong)",borderRadius:7,background:"var(--gd-panel)",padding:"12px 14px",display:"flex",flexDirection:"column",gap:7,fontSize:12,color:"var(--text-2)"}}>
          {target.feats.map(f=><Feat key={f} on>{f}</Feat>)}
        </div>
        <span style={{fontSize:11,color:"var(--text-3)"}}>当前期限先取消续费并使用到已付周期结束，之后才能通过新的付款渠道或期限购买。</span>
      </div>}
    </LDlg>
    <LDlg open={dlg==="cancel"} onClose={()=>setDlg(null)} title="取消续订" width={440} danger
      footer={<><LBtn onClick={()=>setDlg(null)}>保留订阅</LBtn><LBtn variant="danger" onClick={()=>{setAutoRenew(false);setDlg(null);}}>取消续订 · 至 2026-12-31 到期</LBtn></>}>
      <div style={{display:"flex",flexDirection:"column",gap:10,fontSize:13,color:"var(--text-2)",lineHeight:1.6}}>
        <span>取消后 License 仍有效至 <b style={{color:"var(--text-1)",fontFamily:"var(--font-mono)"}}>2026-12-31</b>，届时不再自动续费。</span>
        <span>到期后进入 <b style={{color:"var(--text-1)"}}>Sunset · LocalContinuation</b>：本地数据保留只读，云端同步与执行权停止。随时可恢复续订。</span>
      </div>
    </LDlg>
  </div>;
}
window.GDLicense=License;
