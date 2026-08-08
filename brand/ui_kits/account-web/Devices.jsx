// 设备 / Devices (account-web · B) — ≤2 execution devices (1 Active + 1 Standby). Removing a device
// requires re-auth (password or Passkey) and sends an email; removal revokes the device's server
// session/scope immediately but NOT its remaining signed offline window, so removing the Active device
// enters forced-switch isolation until offline_execute_until. Account epoch is never claimed as an instant
// platform block — a stolen device is contained by revoking sessions AND guiding the user to revoke each
// platform's API/OAuth/browser session.
const {Button:DBtn,Badge:DBadge,Dialog:DDlg,Input:DInput}=window.GoodDealerDesignSystem_b5b0b6;
const Dot=({active})=><span style={{width:8,height:8,borderRadius:"50%",flex:"none",display:"inline-block",background:active?"var(--gd-gold)":"transparent",border:active?"none":"1.5px solid var(--gd-blue)"}}></span>;
const REVOKE_PLATFORMS=["Atom · API Key","Afternic · 登录会话","SellerHub · OAuth","Cloudflare · API Token"];

function Devices(){
  const [devices,setDevices]=React.useState([
    {id:"mac",name:"MacBook Pro",os:"macOS 15",role:"active",epoch:41,last:"现在",self:true},
    {id:"iph",name:"iPhone 17",os:"iOS 19",role:"standby",last:"今日 08:30"},
  ]);
  const [remove,setRemove]=React.useState(null);
  const [pw,setPw]=React.useState("");
  const [stolen,setStolen]=React.useState(null);
  const doRemove=()=>{const d=remove;setRemove(null);setPw("");setDevices(ds=>ds.filter(x=>x.id!==d.id));};

  return <div style={{display:"flex",flexDirection:"column",gap:18}}>
    <div><h1 className="aw-h1">设备</h1><p className="aw-sub" style={{margin:0}}>一个账户最多绑定 2 台执行设备：1 台 Active 拥有执行权，1 台 Standby 只读。</p></div>

    <div className="aw-card" style={{padding:0}}>
      {devices.map((d,i)=><div key={d.id} style={{display:"flex",alignItems:"center",gap:14,padding:"14px 20px",borderTop:i===0?"none":"1px solid var(--gd-line)"}}>
        <Dot active={d.role==="active"}/>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:14,color:"var(--text-1)",display:"flex",alignItems:"center",gap:8}}>{d.name}
            {d.self&&<span style={{fontSize:10,color:"var(--text-3)",border:"1px solid var(--gd-line-strong)",borderRadius:3,padding:"0 5px",lineHeight:"15px"}}>本机</span>}
            <DBadge tone={d.role==="active"?"gold":"sync"} mono={false}>{d.role==="active"?"Active":"Standby"}</DBadge>
            {d.role==="active"&&<span style={{fontFamily:"var(--font-mono)",fontSize:11,color:"var(--gd-gold)"}}>Epoch {d.epoch}</span>}
          </div>
          <div style={{fontSize:11,color:"var(--text-3)",marginTop:2}}>{d.os} · 最后在线 {d.last}</div>
        </div>
        <DBtn size="sm" variant="ghost" onClick={()=>setStolen(d)}>报告遗失 / 被盗</DBtn>
        <DBtn size="sm" onClick={()=>{setRemove(d);setPw("");}}>移除</DBtn>
      </div>)}
      {devices.length>=2&&<div style={{padding:"12px 20px",borderTop:"1px solid var(--gd-line)",fontSize:12,color:"var(--text-3)"}}>名额已满（2/2）· 绑定新设备需先移除一台；若移除的是 Active，新设备可先绑定并只读，须等隔离窗口到期才取得执行权。</div>}
    </div>

    <div style={{fontSize:11,color:"var(--text-3)",lineHeight:1.6}}>移除设备、修改密码、导出数据等会发送邮件通知。移除会立即撤销该设备的服务端会话与 Scope，但不能消除其已签名的剩余离线执行窗口。</div>

    {/* remove — reauth */}
    <DDlg open={!!remove} onClose={()=>{setRemove(null);setPw("");}} title={`移除设备 · ${remove&&remove.name}`} width={480}
      footer={<><DBtn onClick={()=>{setRemove(null);setPw("");}}>取消</DBtn><DBtn variant="danger" disabled={!pw} onClick={doRemove}>确认移除</DBtn></>}>
      {remove&&<div style={{display:"flex",flexDirection:"column",gap:12}}>
        <span style={{fontSize:13}}>移除 <b>{remove.name}</b> 将撤销其在线会话与 Cloud Scope，并发送邮件通知。此操作需要重新认证。</span>
        {remove.role==="active"&&<div style={{border:"1px solid var(--gd-warning)",background:"var(--gd-warning-tint)",borderRadius:7,padding:"10px 13px",fontSize:12,color:"var(--text-2)",lineHeight:1.55}}>
          <b style={{color:"var(--gd-warning)"}}>移除当前 Active 进入强制切换隔离</b>：在其 <span style={{fontFamily:"var(--font-mono)"}}>offline_execute_until</span>（明日 05:44）到期前，其他设备可绑定并只读，但不能取得平台执行权。</div>}
        <DInput label="当前密码（或用 Passkey 确认）" size="md" type="password" value={pw} onChange={e=>setPw(e.target.value)} placeholder="重新认证"/>
      </div>}
    </DDlg>

    {/* stolen — containment + platform revocation guidance */}
    <DDlg open={!!stolen} onClose={()=>setStolen(null)} title={`设备遗失 / 被盗 · ${stolen&&stolen.name}`} width={520} danger
      footer={<><DBtn onClick={()=>setStolen(null)}>关闭</DBtn><DBtn variant="danger" onClick={()=>{setStolen(null);}}>撤销会话并移除设备</DBtn></>}>
      {stolen&&<div style={{display:"flex",flexDirection:"column",gap:12}}>
        <span style={{fontSize:13}}>立即遏制 <b>{stolen.name}</b>：撤销其在线会话与 Scope、递增账号安全代次、冻结破坏性账号动作。</span>
        <div style={{border:"1px solid var(--gd-danger)",background:"var(--gd-danger-tint)",borderRadius:7,padding:"11px 13px",display:"flex",flexDirection:"column",gap:8}}>
          <span style={{fontSize:12,color:"var(--gd-danger)",fontWeight:500}}>账号安全代次不是即时平台阻断</span>
          <span style={{fontSize:12,color:"var(--text-2)",lineHeight:1.55}}>该设备已取得的离线平台能力在其剩余离线窗口内仍可能有效。<b style={{color:"var(--text-1)"}}>请立即到各平台官网撤销此设备持有的凭据</b>：</span>
          <div style={{display:"flex",flexDirection:"column",gap:5}}>{REVOKE_PLATFORMS.map(p=><a key={p} href="#" onClick={e=>e.preventDefault()} style={{display:"flex",alignItems:"center",gap:7,fontSize:12,color:"var(--text-link)"}}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/></svg>{p}</a>)}</div>
        </div>
        <span style={{fontSize:11,color:"var(--text-3)"}}>完成身份核验与冷静期后，账号从 recovery_pending 回到正常并签发新代次凭证；期间冻结新设备绑定与切换。</span>
      </div>}
    </DDlg>
  </div>;
}
window.AWDevices=Devices;
