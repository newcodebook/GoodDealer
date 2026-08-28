// 设备管理 Devices — ActiveDeviceLease from the web side: view lease state + Epoch, rename,
// remotely deauthorize a lost/standby device (danger ceremony), free a slot to bind a new device.
// Handoff of执行权 itself happens on the desktop client (needs the device present) — shown as a hint.
const {Panel:DPanel,Badge:DBadge,Button:DBtn,StatusDot:DDot,Dialog:DDlg,Checkbox:DCheck,IconButton:DIcon}=window.GoodDealerDesignSystem_b5b0b6;

function DeviceRow({d,onDeauth,onRemove,onRename}){
  const I=window.GDI;
  const m={
    active:{dot:"active",badge:<DBadge tone="gold">ACTIVE</DBadge>,meta:"持有 ActiveDeviceLease · 执行权在此设备"},
    standby:{dot:"standby",badge:<DBadge mono={false}>Standby</DBadge>,meta:"待命 · 可在桌面客户端申请移交执行权"},
    sunset:{dot:"neutral",badge:<span style={{fontSize:10,color:"var(--text-3)",fontFamily:"var(--font-mono)",border:"1px solid var(--gd-line-strong)",borderRadius:3,padding:"1px 6px"}}>RETAINED</span>,meta:"Sunset · LocalContinuation 本地只读延续 · 无执行权"},
  }[d.state];
  const dim=d.state==="sunset";
  return <div style={{display:"flex",alignItems:"center",gap:13,padding:"14px 16px",borderBottom:"1px solid var(--gd-line)",opacity:dim?.6:1,background:d.state==="active"?"linear-gradient(90deg,rgba(212,164,55,0.05),transparent 42%)":"transparent"}}>
    <I.Monitor size={19} style={{color:d.state==="active"?"var(--gd-gold)":"var(--gd-text-muted)",flex:"none"}}/>
    <div style={{width:190,flex:"none",display:"flex",flexDirection:"column",gap:4,minWidth:0}}>
      <span style={{fontSize:13,color:"var(--text-1)",display:"flex",alignItems:"center",gap:7,whiteSpace:"nowrap"}}>{d.name}{d.self&&<span style={{fontSize:10,color:"var(--text-3)",border:"1px solid var(--gd-line-strong)",borderRadius:3,padding:"0 5px",lineHeight:"15px",flex:"none"}}>本机 · 网页</span>}</span>
      <span style={{display:"flex",alignItems:"center",gap:7}}><DDot kind={m.dot}/>{m.badge}{d.state==="active"&&<span style={{fontFamily:"var(--font-mono)",fontSize:11,color:"var(--gd-gold)"}}>Epoch {d.epoch}</span>}</span>
    </div>
    <div style={{flex:1,minWidth:0,display:"flex",flexDirection:"column",gap:4}}>
      <span style={{fontSize:12,color:"var(--text-2)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{m.meta}</span>
      <span style={{fontSize:11,color:"var(--text-3)",fontFamily:"var(--font-mono)"}}>{d.os} · {d.location} · 绑定于 {d.added}</span>
    </div>
    <span style={{fontFamily:"var(--font-mono)",fontSize:11,color:"var(--text-3)",width:64,flex:"none",textAlign:"right"}}>{d.last}</span>
    <span style={{width:150,flex:"none",display:"flex",justifyContent:"flex-end",gap:7}}>
      <DBtn size="sm" variant="ghost" onClick={()=>onRename(d)}>重命名</DBtn>
      {d.state==="active"&&<DBtn size="sm" variant="ghost" disabled title="需在桌面客户端先移交执行权">解绑</DBtn>}
      {d.state==="standby"&&<DBtn size="sm" variant="ghost" onClick={()=>onDeauth(d)}>远程解绑</DBtn>}
      {d.state==="sunset"&&<DBtn size="sm" variant="ghost" onClick={()=>onRemove(d)}>移除</DBtn>}
    </span>
  </div>;
}

function Devices(){
  const I=window.GDI;const MetricStrip=window.GDMetricStrip;
  const [devices,setDevices]=React.useState(()=>window.GD_ACCOUNT.devices.map(d=>({...d})));
  const [deauth,setDeauth]=React.useState(null);
  const [ack,setAck]=React.useState(false);
  const bound=devices.filter(d=>d.state==="active"||d.state==="standby").length;
  const active=devices.find(d=>d.state==="active");
  const runDeauth=()=>{const t=deauth;setDeauth(null);setAck(false);setDevices(ds=>ds.filter(d=>d.id!==t.id));};
  return <div data-screen-label="设备管理" style={{display:"flex",flexDirection:"column",minHeight:0}}>
    <MetricStrip metrics={[
      {label:"已绑定设备",value:bound+" / 2",meta:"单活动执行权"},
      {label:"活动设备 Active",value:active?active.name:"—",tone:"gold",meta:active?"持有执行权":"无"},
      {label:"当前 Epoch",value:active?"Epoch "+active.epoch:"—",tone:"gold",mono:true,meta:"每次移交 +1"},
      {label:"待命 Standby",value:devices.some(d=>d.state==="standby")?"1 台":"0 台",meta:"蓝空心 · 无执行权"},
      {label:"License 额度",value:"2 台",meta:"Professional"},
    ]}/>
    <div style={{padding:18,display:"flex",flexDirection:"column",gap:14,maxWidth:1040}}>
      <DPanel flush title="设备与执行权（ActiveDeviceLease）" actions={active&&<span style={{fontFamily:"var(--font-mono)",fontSize:11,color:"var(--gd-gold)"}}>Epoch {active.epoch}</span>}>
        {devices.map(d=><DeviceRow key={d.id} d={d} onDeauth={setDeauth} onRemove={rd=>setDevices(ds=>ds.filter(x=>x.id!==rd.id))} onRename={()=>{}}/>)}
      </DPanel>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
        <div style={{display:"flex",gap:13,padding:"14px 16px",border:"1px solid var(--gd-line)",borderRadius:7,background:"var(--gd-panel)"}}>
          <img src="../../assets/icons/active-lease.svg" width="30" height="30" alt="" style={{flex:"none",marginTop:1}}/>
          <span style={{fontSize:12,color:"var(--text-2)",lineHeight:1.6}}>同一时刻只有一台设备持有执行权（<b style={{color:"var(--gd-gold)",fontWeight:500}}>金实心 = Active</b>，蓝空心 = Standby）。<b style={{color:"var(--text-1)",fontWeight:500}}>移交执行权在桌面客户端完成</b>——旧设备排空未同步项后释放，新设备安全激活并由服务端签发新 Lease，Epoch 递增。网页可查看状态、重命名、以及远程解绑丢失的设备。</span>
        </div>
        <div style={{padding:"14px 16px",border:"1px dashed var(--gd-line-strong)",borderRadius:7,background:"var(--gd-ink)",display:"flex",flexDirection:"column",gap:8}}>
          <span style={{display:"flex",alignItems:"center",gap:8,fontSize:13,fontWeight:500,color:"var(--text-1)"}}><I.Smartphone size={15}/>绑定新设备</span>
          {bound>=2
            ?<><span style={{fontSize:12,color:"var(--gd-warning)"}}>设备额度已满（{bound}/2）。绑定新设备前，请先远程解绑一台 Standby 设备。</span>
               <span style={{fontSize:11,color:"var(--text-3)",lineHeight:1.5}}>解绑不会删除该设备的本地数据；重新绑定需在设备上完成门禁校验。</span></>
            :<><span style={{fontSize:12,color:"var(--text-2)"}}>在新设备的桌面客户端选择「绑定到此账户」，输入下方配对码：</span>
               <div style={{display:"flex",alignItems:"center",gap:10,padding:"9px 12px",background:"var(--gd-panel)",border:"1px solid var(--gd-line-strong)",borderRadius:5}}>
                 <span style={{fontFamily:"var(--font-mono)",fontSize:16,letterSpacing:"0.18em",color:"var(--gd-gold)"}}>7F2A-C91D</span>
                 <DBtn size="sm" variant="ghost" icon={<I.Copy size={13}/>} style={{marginLeft:"auto"}}>复制</DBtn>
                 <span style={{fontFamily:"var(--font-mono)",fontSize:11,color:"var(--text-3)"}}>04:58 后失效</span>
               </div></>}
        </div>
      </div>
    </div>
    <DDlg open={!!deauth} onClose={()=>{setDeauth(null);setAck(false);}} title="远程解绑设备" width={480} danger
      footer={<><DBtn onClick={()=>{setDeauth(null);setAck(false);}}>取消</DBtn><DBtn variant="danger" disabled={!ack} onClick={runDeauth}>远程解绑 {deauth&&deauth.name}</DBtn></>}>
      {deauth&&<div style={{display:"flex",flexDirection:"column",gap:12}}>
        <span style={{fontSize:13}}>将 <b>{deauth.name}</b> 从账户中移除。</span>
        <div style={{border:"1px solid var(--gd-line-strong)",borderRadius:7,background:"var(--gd-panel)",padding:"12px 14px",display:"flex",flexDirection:"column",gap:8,fontSize:12,color:"var(--text-2)",lineHeight:1.55}}>
          <span><b style={{color:"var(--text-1)",fontWeight:500}}>后果</b>：该设备将失去云端同步与执行权，下次联网时被强制登出；本地已缓存数据保留为只读。</span>
          <span><b style={{color:"var(--text-1)",fontWeight:500}}>额度</b>：解绑后释放一个设备名额（{bound}/2 → {bound-1}/2），可绑定新设备。</span>
          <span>此操作不影响当前 Active 设备的执行权与 Epoch。</span>
        </div>
        <div style={{borderTop:"1px solid var(--gd-line)",paddingTop:10}}><DCheck checked={ack} onChange={()=>setAck(a=>!a)} label={`我确认远程解绑 ${deauth.name}`}/></div>
      </div>}
    </DDlg>
  </div>;
}
window.GDDevices=Devices;
