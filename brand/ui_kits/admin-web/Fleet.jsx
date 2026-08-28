// 设备舰队监控 Fleet — cross-customer ActiveDeviceLease fleet: state, Epoch, region, lease health;
// force-deauthorize a stale/lost device (operator danger ceremony, audited).
const {Panel:FPanel,Table:FTable,Badge:FBadge,Button:FBtn,Select:FSel,Input:FInput,Toolbar:FToolbar,Dialog:FDlg,Checkbox:FCheck,StatusDot:FDot}=window.GoodDealerDesignSystem_b5b0b6;

const FSTATE={
  active:{dot:"active",badge:<FBadge tone="gold">ACTIVE</FBadge>},
  standby:{dot:"standby",badge:<FBadge mono={false}>Standby</FBadge>},
  activating:{dot:"sync",badge:<FBadge tone="sync" mono={false}>激活中</FBadge>,pulse:true},
  draining:{dot:"warning",badge:<FBadge tone="warning" mono={false}>排空中</FBadge>,pulse:true},
  sunset:{dot:"neutral",badge:<span style={{fontSize:10,color:"var(--text-3)",fontFamily:"var(--font-mono)",border:"1px solid var(--gd-line-strong)",borderRadius:3,padding:"1px 6px"}}>RETAINED</span>},
};
const FHEALTH={ok:<FBadge tone="success">正常</FBadge>,warn:<FBadge tone="warning" mono={false}>告警</FBadge>,stale:<FBadge tone="danger" mono={false}>失联</FBadge>};

function Fleet(){
  const D=window.GD_ADMIN;const I=window.GDI;const MetricStrip=window.GDMetricStrip;const Pagination=window.GDPagination;
  const [devices,setDevices]=React.useState(()=>D.fleet.map(d=>({...d})));
  const [state,setState]=React.useState("全部状态");const [region,setRegion]=React.useState("全部区域");const [q,setQ]=React.useState("");
  const [page,setPage]=React.useState(1);const [pageSize,setPageSize]=React.useState(10);
  const [deauth,setDeauth]=React.useState(null);const [ack,setAck]=React.useState(false);
  React.useEffect(()=>{setPage(1);},[state,region,q,pageSize]);
  const SMAP={"全部状态":null,"Active":"active","Standby":"standby","激活中":"activating","排空中":"draining","Sunset":"sunset"};
  const regions=["全部区域",...Array.from(new Set(D.fleet.map(d=>d.region)))];
  let rows=devices.filter(d=>(SMAP[state]==null||d.state===SMAP[state])&&(region==="全部区域"||d.region===region)&&(q===""||d.customer.toLowerCase().includes(q.toLowerCase())||d.id.toLowerCase().includes(q.toLowerCase())||d.name.toLowerCase().includes(q.toLowerCase())));
  const pages=Math.max(1,Math.ceil(rows.length/pageSize));const cur=Math.min(page,pages);
  const pageRows=rows.slice((cur-1)*pageSize,cur*pageSize);
  const runDeauth=()=>{const t=deauth;setDeauth(null);setAck(false);setDevices(ds=>ds.map(d=>d.id===t.id?{...d,state:"sunset",health:"stale"}:d));};
  return <div data-screen-label="设备舰队" style={{display:"flex",flexDirection:"column",height:"100%",minHeight:0}}>
    <MetricStrip metrics={[
      {label:"绑定设备",value:"4,106",meta:"跨 2,413 客户"},
      {label:"在线",value:"1,842",tone:"success",meta:"持权 Active 1,842"},
      {label:"待命 Standby",value:"1,903",meta:"蓝空心 · 无执行权"},
      {label:"激活 / 排空中",value:"59",tone:"body",meta:"迁移执行权中"},
      {label:"失联 / 告警",value:"37",tone:"danger",meta:"Lease 心跳超时"},
      {label:"区域",value:"12",meta:"就近同步"},
    ]}/>
    <FToolbar region
      left={<>
        <FInput size="sm" prefix={<I.Search size={13}/>} placeholder="搜索客户、设备 ID…" value={q} onChange={e=>setQ(e.target.value)} style={{width:220}}/>
        <FSel size="sm" options={["全部状态","Active","Standby","激活中","排空中","Sunset"]} value={state} onChange={e=>setState(e.target.value)}/>
        <FSel size="sm" options={regions} value={region} onChange={e=>setRegion(e.target.value)}/>
      </>}
      right={<FBtn size="sm" icon={<I.Download size={14}/>}>导出</FBtn>}/>
    <div style={{flex:1,minHeight:0,display:"flex"}}>
      <FTable density="regular" rowKey="id" maxHeight="100%" style={{flex:1,minHeight:0,border:"none",borderRadius:0}}
        columns={[
          {key:"id",label:"设备 ID",render:d=><span style={{fontFamily:"var(--font-mono)",fontSize:11,color:"var(--text-3)"}}>{d.id}</span>},
          {key:"customer",label:"客户",render:d=><span style={{fontSize:12.5,color:"var(--text-1)"}}>{d.customer}</span>},
          {key:"name",label:"设备",render:d=><div style={{display:"flex",flexDirection:"column",gap:1}}><span style={{fontSize:12.5,color:"var(--text-1)"}}>{d.name}</span><span style={{fontSize:11,color:"var(--text-3)"}}>{d.os}</span></div>},
          {key:"state",label:"执行权状态",render:d=><span style={{display:"inline-flex",alignItems:"center",gap:7}}><FDot kind={FSTATE[d.state].dot} pulse={FSTATE[d.state].pulse}/>{FSTATE[d.state].badge}</span>},
          {key:"epoch",label:"Epoch",numeric:true,render:d=><span style={{fontFamily:"var(--font-mono)",fontSize:12,color:d.state==="active"?"var(--gd-gold)":"var(--text-3)"}}>{d.epoch}</span>},
          {key:"region",label:"区域",render:d=><span style={{fontFamily:"var(--font-mono)",fontSize:11,color:"var(--text-2)"}}>{d.region}</span>},
          {key:"health",label:"Lease 健康",render:d=>FHEALTH[d.health]},
          {key:"lastSeen",label:"心跳",numeric:true,render:d=><span style={{fontFamily:"var(--font-mono)",fontSize:11,color:d.health==="stale"?"var(--gd-danger)":"var(--text-3)"}}>{d.lastSeen}</span>},
          {key:"act",label:"",align:"right",render:d=>d.state!=="sunset"?<FBtn size="sm" variant="ghost" onClick={()=>setDeauth(d)}>强制解绑</FBtn>:<span style={{fontSize:11,color:"var(--text-3)"}}>已退役</span>},
        ]}
        rows={pageRows}
        footer={<Pagination page={cur} pageSize={pageSize} total={rows.length} onPage={setPage} onPageSize={setPageSize} note={<span style={{fontFamily:"var(--font-mono)"}}>单活动执行权 · Epoch 单调递增</span>}/>}/>
    </div>
    <FDlg open={!!deauth} onClose={()=>{setDeauth(null);setAck(false);}} title="强制解绑设备（运营操作）" width={500} danger
      footer={<><FBtn onClick={()=>{setDeauth(null);setAck(false);}}>取消</FBtn><FBtn variant="danger" disabled={!ack} onClick={runDeauth}>强制解绑 {deauth&&deauth.id}</FBtn></>}>
      {deauth&&<div style={{display:"flex",flexDirection:"column",gap:12}}>
        <span style={{fontSize:13}}>对 <b>{deauth.customer}</b> 的设备 <b style={{fontFamily:"var(--font-mono)"}}>{deauth.id} · {deauth.name}</b> 执行强制解绑。</span>
        <div style={{border:"1px solid var(--gd-line-strong)",borderRadius:7,background:"var(--gd-panel)",padding:"12px 14px",display:"flex",flexDirection:"column",gap:8,fontSize:12,color:"var(--text-2)",lineHeight:1.55}}>
          <span><b style={{color:"var(--text-1)",fontWeight:500}}>后果</b>：该设备的 ActiveDeviceLease 立即吊销，下次联网被强制登出并转入 Sunset 保留态（本地只读）。</span>
          {deauth.state==="active"&&<span><b style={{color:"var(--gd-danger)",fontWeight:500}}>该设备当前持有执行权</b>：解绑后客户在另一台设备安全激活前将无法执行写操作。</span>}
          <span>操作以运营身份记入<b style={{color:"var(--text-1)",fontWeight:500}}>审计日志</b>，客户会收到安全通知。仅用于设备丢失或滥用。</span>
        </div>
        <div style={{borderTop:"1px solid var(--gd-line)",paddingTop:10}}><FCheck checked={ack} onChange={()=>setAck(a=>!a)} label="我确认此为不可逆的运营强制操作，且已核实必要性"/></div>
      </div>}
    </FDlg>
  </div>;
}
window.GDFleet=Fleet;
