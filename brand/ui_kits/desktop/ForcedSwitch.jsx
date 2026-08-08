// 强制切换 · 隔离倒计时 / ForcedSwitch — J-05 (UX_FLOWS §6 强制切换).
// Used when the current Active device is UNREACHABLE, so a normal drained handoff is impossible.
// The requesting device must wait out the old device's signed offline-execution window (≤24h): until
// `offline_execute_until` it may NOT modify business data, approve, or access platforms — only the
// Cloud Read-Only View stays available. Remote-removing the old device revokes its server Session/Scope
// immediately but does NOT shorten its remaining offline window. The wait screen estimates how large a
// batch of old edits will land in the Recovery Center after takeover, and offers a purely-manual
// emergency fallback (system browser, no automation) for urgent cases like a sold-domain delist — where
// clicking "已处理" never marks success; manual changes reconcile via platform read after takeover.
const {Panel:FPanel,Button:FBtn,Badge:FBadge,Checkbox:FCheck,StatusDot:FDot,Dialog:FDlg}=window.GoodDealerDesignSystem_b5b0b6;

function ForcedSwitch({onExit,oldDevice="MacBook Pro",lastOnline="06-12 05:44",untilAbs="明日 05:44",untilRel="23:41:08",recoveryScale=14}){
  const I=window.GDI;
  const [stage,setStage]=React.useState("request"); // request | countdown
  const [ack,setAck]=React.useState(false);

  const Row=({k,children,tone})=><div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 0",borderBottom:"1px solid var(--gd-line)",fontSize:13}}>
    <span style={{color:"var(--gd-text-faint)",fontSize:12}}>{k}</span>
    <span style={{color:tone||"var(--text-1)",fontFamily:"var(--font-mono)",fontSize:12}}>{children}</span>
  </div>;

  return <div style={{display:"flex",flexDirection:"column",gap:14}}>
    {/* stage: request (danger ceremony) */}
    <FDlg open={stage==="request"} onClose={onExit} title="申请强制切换 · 旧设备不可达" width={520} danger
      footer={<><FBtn onClick={onExit}>取消</FBtn><FBtn variant="danger" disabled={!ack} onClick={()=>setStage("countdown")}>申请强制切换</FBtn></>}>
      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        <span style={{fontSize:13}}>旧设备 <b>{oldDevice}</b> 当前不可达，无法正常排空交接。强制切换必须等待其<b>离线执行许可到期</b>，期间本设备只能云端只读。</span>
        <div style={{border:"1px solid var(--gd-danger)",background:"var(--gd-danger-tint)",borderRadius:7,padding:"11px 13px",display:"flex",flexDirection:"column",gap:9}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}><I.AlertTriangle size={15} style={{color:"var(--gd-danger)",flex:"none"}}/><b style={{color:"var(--gd-danger)",fontSize:13}}>隔离期最长 24 小时</b></div>
          <span style={{fontSize:12,color:"var(--gd-text)",lineHeight:1.5}}>在旧设备 <span style={{fontFamily:"var(--font-mono)"}}>offline_execute_until</span> 到期前，本设备不能修改业务数据、批准操作或访问平台。远程下线旧设备只会立即撤销其服务端 Session，<b>不会消除其剩余离线窗口</b>。</span>
        </div>
        <div style={{borderTop:"1px solid var(--gd-line)",paddingTop:10}}><FCheck checked={ack} onChange={()=>setAck(a=>!a)} label="我理解需等待离线窗口到期，期间本设备无执行权，仅云端只读"/></div>
      </div>
    </FDlg>

    {/* stage: countdown (isolation waiting) */}
    {stage==="countdown"&&<>
      <FPanel title="强制切换 · 隔离倒计时" actions={<FBadge tone="warning" mono={false}>隔离中</FBadge>}>
        <div style={{display:"flex",gap:20,alignItems:"center",flexWrap:"wrap",padding:"4px 0 12px"}}>
          <div style={{flex:"none",display:"flex",flexDirection:"column",alignItems:"center",gap:4,padding:"0 8px"}}>
            <span style={{fontFamily:"var(--font-mono)",fontSize:34,fontWeight:600,color:"var(--gd-warning)",letterSpacing:"0.02em"}}>{untilRel}</span>
            <span style={{fontSize:11,color:"var(--gd-text-faint)"}}>距最早接管时间</span>
          </div>
          <div style={{flex:"1 1 240px",minWidth:0}}>
            <Row k="旧设备">{oldDevice}</Row>
            <Row k="最后在线" tone="var(--gd-text-muted)">{lastOnline}</Row>
            <Row k="最早接管时间" tone="var(--gd-warning)">{untilAbs}</Row>
            <Row k="离线执行许可"><span style={{fontFamily:"var(--font-mono)"}}>offline_execute_until</span></Row>
          </div>
        </div>
      </FPanel>

      <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
        <div style={{flex:"1 1 220px",minWidth:0,border:"1px solid var(--gd-line)",borderRadius:7,background:"var(--gd-panel)",padding:"11px 13px"}}>
          <div style={{fontSize:11,letterSpacing:"0.06em",textTransform:"uppercase",color:"var(--gd-text-faint)",marginBottom:8}}>隔离期内暂停</div>
          {["修改业务数据","批准操作","访问外部平台"].map(x=><div key={x} style={{display:"flex",alignItems:"center",gap:8,fontSize:12,padding:"3px 0",color:"var(--gd-text-muted)"}}><I.X size={13} style={{color:"var(--gd-danger)"}}/>{x}</div>)}
          <div style={{display:"flex",alignItems:"center",gap:8,fontSize:12,padding:"5px 0 0",marginTop:5,borderTop:"1px solid var(--gd-line)",color:"var(--gd-text)"}}><FDot kind="sync" size={7}/>Cloud Read-Only View 保持可用</div>
        </div>
        <div style={{flex:"1 1 220px",minWidth:0,border:"1px solid var(--gd-line)",borderRadius:7,background:"var(--gd-panel)",padding:"11px 13px",display:"flex",flexDirection:"column",gap:7}}>
          <div style={{fontSize:11,letterSpacing:"0.06em",textTransform:"uppercase",color:"var(--gd-text-faint)"}}>接管后</div>
          <div style={{fontSize:13,color:"var(--text-1)"}}>预计进入恢复中心 <span style={{fontFamily:"var(--font-mono)",color:"var(--gd-gold)"}}>~{recoveryScale}</span> 项旧修改</div>
          <span style={{fontSize:11,color:"var(--gd-text-faint)",lineHeight:1.5}}>基于活动设备最后申报的同步进度预估；旧修改进入候选，不静默覆盖当前云端值。</span>
        </div>
      </div>

      {/* emergency manual fallback during wait */}
      <div style={{border:"1px solid var(--gd-warning)",background:"var(--gd-warning-tint)",borderRadius:7,padding:"11px 13px",display:"flex",flexDirection:"column",gap:9}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}><I.ShieldAlert size={15} style={{color:"var(--gd-warning)",flex:"none"}}/><b style={{color:"var(--gd-warning)",fontSize:13}}>等待期紧急人工兜底</b><span style={{marginLeft:"auto",fontSize:11,color:"var(--gd-text-muted)"}}>纯人工窗口 · 无自动化</span></div>
        <span style={{fontSize:12,color:"var(--gd-text)",lineHeight:1.5}}>若期间出现已售域名等紧急情况，可打开平台官网手工处理。受影响：<span style={{fontFamily:"var(--font-mono)"}}>vault.io</span> · SellerHub · 主账户。</span>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <FBtn size="sm" icon={<I.ExternalLink size={13}/>}>打开平台官网手工处理</FBtn>
          <FBtn size="sm" variant="ghost" icon={<I.Copy size={13}/>}>复制域名清单</FBtn>
          <span style={{marginLeft:"auto",fontSize:11,color:"var(--gd-text-faint)"}}>不自动提交；点击「已处理」不标记成功，接管后经平台读取对账</span>
        </div>
      </div>

      <div style={{display:"flex",alignItems:"center",gap:10}}>
        <FBtn variant="ghost" onClick={onExit}>取消强制切换</FBtn>
        <span style={{fontSize:11,color:"var(--gd-text-faint)"}}>到期后本设备进入「正在安全激活」，校验通过并签发新 ActiveDeviceLease 后取得执行权。</span>
      </div>
    </>}
  </div>;
}
window.GDForcedSwitch=ForcedSwitch;
