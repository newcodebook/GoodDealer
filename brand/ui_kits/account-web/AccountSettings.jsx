// 账户设置 AccountSettings — profile, preferences, notifications, danger zone.
const {Panel:APanel,Badge:ABadge,Button:ABtn,Switch:ASwitch,Select:ASel,Input:AInput,Dialog:ADlg}=window.GoodDealerDesignSystem_b5b0b6;

function Row({label,hint,children}){
  return <div style={{display:"flex",alignItems:"center",gap:14,padding:"11px 0",borderBottom:"1px solid var(--gd-line)"}}>
    <div style={{width:150,flex:"none"}}><div style={{fontSize:12.5,color:"var(--text-1)"}}>{label}</div>{hint&&<div style={{fontSize:11,color:"var(--text-3)",marginTop:2}}>{hint}</div>}</div>
    <div style={{flex:1,display:"flex",justifyContent:"flex-end"}}>{children}</div>
  </div>;
}

function AccountSettings(){
  const D=window.GD_ACCOUNT;const I=window.GDI;
  const [notif,setNotif]=React.useState({sale:true,expiry:true,security:true,billing:true,product:false});
  const [dlg,setDlg]=React.useState(null);
  const [confirm,setConfirm]=React.useState("");
  const tog=k=>setNotif(n=>({...n,[k]:!n[k]}));
  return <div data-screen-label="账户设置" style={{padding:18,maxWidth:820,display:"flex",flexDirection:"column",gap:14}}>
    <APanel title="个人资料" actions={<ABtn size="sm" variant="primary">保存更改</ABtn>}>
      <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:14,paddingBottom:14,borderBottom:"1px solid var(--gd-line)"}}>
        <span style={{width:52,height:52,flex:"none",borderRadius:"50%",background:"linear-gradient(135deg,var(--gd-panel-raised),var(--gd-line))",border:"1px solid var(--gd-line-strong)",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"var(--font-mono)",fontSize:18,color:"var(--gd-gold)"}}>CL</span>
        <div style={{display:"flex",flexDirection:"column",gap:5}}><span style={{fontSize:15,fontWeight:600,color:"var(--text-1)"}}>陈立行</span><span style={{fontSize:11,color:"var(--text-3)",fontFamily:"var(--font-mono)"}}>会员自 2024-03-11</span></div>
        <ABtn size="sm" variant="ghost" style={{marginLeft:"auto"}}>更换头像</ABtn>
      </div>
      <Row label="姓名"><AInput value="陈立行" onChange={()=>{}} style={{width:260}}/></Row>
      <Row label="邮箱" hint="用于登录与发票"><span style={{display:"flex",alignItems:"center",gap:8}}><AInput value="li@quanta.trade" onChange={()=>{}} mono style={{width:260}}/><ABadge tone="success" dot>已验证</ABadge></span></Row>
      <Row label="Workspace 名称"><AInput value="个人 Workspace" onChange={()=>{}} style={{width:260}}/></Row>
    </APanel>
    <APanel title="偏好">
      <Row label="语言 / Locale"><ASel size="sm" options={["中文（zh-CN）","English (en-US)"]} value="中文（zh-CN）" onChange={()=>{}}/></Row>
      <Row label="时区"><ASel size="sm" options={["Asia/Shanghai (UTC+8)","UTC","America/New_York (UTC-5)","Europe/London (UTC+0)"]} value="Asia/Shanghai (UTC+8)" onChange={()=>{}}/></Row>
      <Row label="货币显示" hint="估值与金额"><ASel size="sm" options={["USD ($)","CNY (¥)","EUR (€)"]} value="USD ($)" onChange={()=>{}}/></Row>
      <Row label="外观" hint="GoodDealer 为深色终端界面"><span style={{fontSize:12,color:"var(--text-3)"}}>深色 · Ink（固定）</span></Row>
    </APanel>
    <APanel title="通知" actions={<span style={{fontSize:11,color:"var(--text-3)"}}>发送至 li@quanta.trade</span>}>
      {[["sale","成交与放款","域名售出、托管交割状态变化"],["expiry","到期提醒","域名续费到期前 60 / 30 / 7 天"],["security","安全提醒","新设备登录、异常位置、改密"],["billing","账单","扣款成功、发票、续费"],["product","产品更新","新版本与功能公告"]].map(([k,t,h])=>
        <Row key={k} label={t} hint={h}><ASwitch checked={notif[k]} onChange={()=>tog(k)}/></Row>)}
    </APanel>
    <APanel title="账户数据与注销">
      <Row label="导出账户数据" hint="资产快照、发票、操作账本 (CSV / JSON)"><ABtn size="sm" variant="ghost" icon={<I.Download size={13}/>}>请求导出</ABtn></Row>
      <div style={{display:"flex",alignItems:"center",gap:14,padding:"13px 0 4px"}}>
        <div style={{width:150,flex:"none"}}><div style={{fontSize:12.5,color:"var(--gd-danger)"}}>删除账户</div><div style={{fontSize:11,color:"var(--text-3)",marginTop:2}}>永久删除云端账户与数据</div></div>
        <div style={{flex:1,display:"flex",justifyContent:"flex-end"}}><ABtn size="sm" variant="danger" icon={<I.Trash2 size={13}/>} onClick={()=>setDlg("del")}>删除账户</ABtn></div>
      </div>
    </APanel>
    <ADlg open={dlg==="del"} onClose={()=>{setDlg(null);setConfirm("");}} title="删除账户" width={460} danger
      footer={<><ABtn onClick={()=>{setDlg(null);setConfirm("");}}>取消</ABtn><ABtn variant="danger" disabled={confirm!=="DELETE"} onClick={()=>{setDlg(null);setConfirm("");}}>永久删除账户</ABtn></>}>
      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        <div style={{border:"1px solid var(--gd-line-strong)",borderRadius:7,background:"var(--gd-panel)",padding:"12px 14px",display:"flex",flexDirection:"column",gap:7,fontSize:12,color:"var(--text-2)",lineHeight:1.55}}>
          <span><b style={{color:"var(--text-1)",fontWeight:500}}>后果</b>：云端账户、订阅、发票记录与资产快照将被永久删除，无法恢复。</span>
          <span>已绑定设备将被全部解绑；本地缓存数据保留只读，需重新注册才能继续同步。</span>
          <span>如仅想停止续费，请改用<b style={{color:"var(--text-1)",fontWeight:500}}>取消续订</b>（保留至到期）。</span>
        </div>
        <div><div style={{fontSize:12,color:"var(--text-2)",marginBottom:6}}>输入 <b style={{fontFamily:"var(--font-mono)",color:"var(--gd-danger)"}}>DELETE</b> 以确认</div><AInput value={confirm} onChange={e=>setConfirm(e.target.value)} mono placeholder="DELETE"/></div>
      </div>
    </ADlg>
  </div>;
}
window.GDAccountSettings=AccountSettings;
