// 订阅与许可 License — plan, billing cycle, ownership/license certificate, tier upgrade.
const {Panel:LPanel,Badge:LBadge,Button:LBtn,Money:LMoney,ProgressBar:LProg,Switch:LSwitch,Dialog:LDlg,Input:LInput,StatusDot:LDot}=window.GoodDealerDesignSystem_b5b0b6;

const TIERS=[
  {k:"Starter",price:99,domains:"至 200 域名",devices:"1 台设备",feats:["单注册商连接","基础同步","操作历史"]},
  {k:"Professional",price:299,domains:"无限域名",devices:"2 台设备 · 单活动",feats:["全部平台连接","批量执行 · 差异预览","冲突中心 · 回滚","议价交割闭环"]},
  {k:"Portfolio",price:899,domains:"无限域名 · 多 Workspace",devices:"5 台设备",feats:["Professional 全部","多 Workspace 隔离","团队席位","优先支持 · SLA"]},
];

function Feat({on,children}){
  const I=window.GDI;
  return <div style={{display:"flex",alignItems:"center",gap:8,fontSize:12,color:on?"var(--text-2)":"var(--text-3)"}}>
    <I.Check size={13} style={{color:on?"var(--gd-success)":"var(--text-3)",flex:"none"}}/>{children}</div>;
}

function License(){
  const D=window.GD_ACCOUNT;const I=window.GDI;const MetricStrip=window.GDMetricStrip;
  const [autoRenew,setAutoRenew]=React.useState(D.plan.autoRenew);
  const [dlg,setDlg]=React.useState(null); // pay | upgrade | cancel
  const [target,setTarget]=React.useState(null);
  return <div data-screen-label="订阅与许可" style={{display:"flex",flexDirection:"column",minHeight:0}}>
    <MetricStrip metrics={[
      {label:"当前方案",value:"Professional",tone:"gold",meta:"年付 License"},
      {label:"年费",value:"$299.00",tone:"gold",meta:"下次扣款 2026-12-31"},
      {label:"本期剩余",value:"136 天",tone:"warning",meta:"已用 63%"},
      {label:"所有权验证",value:"已验证",tone:"success",meta:"本地密钥签发"},
      {label:"设备额度",value:"2 台",meta:"单活动执行权"},
    ]}/>
    <div style={{padding:18,display:"grid",gridTemplateColumns:"1fr 320px",gap:14,alignItems:"start"}}>
      <div style={{display:"flex",flexDirection:"column",gap:14,minWidth:0}}>
        <LPanel title="当前方案" actions={<span style={{display:"flex",alignItems:"center",gap:7,fontSize:12,color:"var(--text-2)"}}>自动续费 <LSwitch checked={autoRenew} onChange={()=>setAutoRenew(v=>!v)}/></span>}>
          <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:14}}>
            <span style={{fontSize:20,fontWeight:600,color:"var(--text-1)"}}>年付 License</span>
            <LBadge tone="gold">PROFESSIONAL</LBadge>
            <LMoney amount={299} size={15}/><span style={{fontSize:12,color:"var(--text-3)"}}>/ 年</span>
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
            <LBtn size="sm" variant="primary" onClick={()=>{setTarget(TIERS[2]);setDlg("upgrade");}}>升级到 Portfolio</LBtn>
            <LBtn size="sm" onClick={()=>setDlg("pay")}>更换支付方式</LBtn>
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
                <span style={{color:"var(--gd-gold)",letterSpacing:"0.02em"}}>GD-PRO-8F2A-C91D-··· ·-4E7B</span>
                <LBtn size="sm" variant="ghost" icon={<I.Copy size={13}/>} style={{marginLeft:"auto"}}>复制</LBtn>
              </div>
              <div style={{display:"flex",gap:9,marginTop:12}}><LBtn size="sm" variant="ghost" icon={<I.Download size={13}/>}>下载证书</LBtn><LBtn size="sm" variant="ghost" icon={<I.RefreshCw size={13}/>}>轮换密钥</LBtn></div>
            </div>
          </div>
        </LPanel>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:14,minWidth:0}}>
        <LPanel flush title="方案对比">
          {TIERS.map(t=>{const cur=t.k==="Professional";return <div key={t.k} style={{padding:"13px 16px",borderBottom:"1px solid var(--gd-line)",background:cur?"linear-gradient(90deg,rgba(212,164,55,0.05),transparent 60%)":"transparent"}}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
              <span style={{fontSize:13,fontWeight:600,color:"var(--text-1)"}}>{t.k}</span>
              {cur&&<LBadge tone="gold">当前</LBadge>}
              <span style={{marginLeft:"auto",display:"flex",alignItems:"baseline",gap:3}}><LMoney amount={t.price} size={13} tone={cur?"gold":"body"}/><span style={{fontSize:10,color:"var(--text-3)"}}>/年</span></span>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:5}}>
              <Feat on>{t.domains}</Feat><Feat on>{t.devices}</Feat>
              {t.feats.slice(0,2).map(f=><Feat key={f} on>{f}</Feat>)}
            </div>
            {!cur&&<LBtn size="sm" variant={t.price>299?"primary":"ghost"} style={{width:"100%",marginTop:10}} onClick={()=>{setTarget(t);setDlg("upgrade");}}>{t.price>299?"升级":"降级"}到 {t.k}</LBtn>}
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
    <LDlg open={dlg==="pay"} onClose={()=>setDlg(null)} title="更换支付方式" width={440}
      footer={<><LBtn onClick={()=>setDlg(null)}>取消</LBtn><LBtn variant="primary" onClick={()=>setDlg(null)}>保存支付方式</LBtn></>}>
      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        <LInput label="卡号" mono placeholder="4242 4242 4242 4242"/>
        <div style={{display:"flex",gap:10}}><LInput label="有效期" mono placeholder="12 / 28"/><LInput label="CVC" mono placeholder="···"/></div>
        <LInput label="持卡人" placeholder="LI XINGHANG"/>
        <span style={{fontSize:11,color:"var(--text-3)"}}>支付由第三方处理，GoodDealer 不存储完整卡号。</span>
      </div>
    </LDlg>
    <LDlg open={dlg==="upgrade"} onClose={()=>setDlg(null)} title={target?`切换到 ${target.k}`:""} width={460}
      footer={<><LBtn onClick={()=>setDlg(null)}>取消</LBtn><LBtn variant="primary" onClick={()=>setDlg(null)}>{target&&target.price>299?"升级":"确认切换"}到 {target&&target.k} · ${target&&target.price}/年</LBtn></>}>
      {target&&<div style={{display:"flex",flexDirection:"column",gap:12}}>
        <span style={{fontSize:13}}>从 <b>Professional · $299/年</b> 切换到 <b style={{color:"var(--gd-gold)"}}>{target.k} · ${target.price}/年</b>。</span>
        <div style={{border:"1px solid var(--gd-line-strong)",borderRadius:7,background:"var(--gd-panel)",padding:"12px 14px",display:"flex",flexDirection:"column",gap:7,fontSize:12,color:"var(--text-2)"}}>
          {target.feats.map(f=><Feat key={f} on>{f}</Feat>)}
        </div>
        <span style={{fontSize:11,color:"var(--text-3)"}}>{target.price>299?"立即生效，按剩余天数补差价 $"+Math.round((target.price-299)*136/365)+"。":"下个账单周期生效，本期不退款。"}</span>
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
