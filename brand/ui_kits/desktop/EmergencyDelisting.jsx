// 资产保护 · 紧急下架 / Emergency Delisting — the J-04 surface (Priority-0 Asset Protection).
// An Active device, during a USER-initiated refresh or an already-approved platform read,
// forms a SaleSignal → EmergencyDelistingIncident. This screen enumerates every known Listing
// of the sold domain and drives a Priority-0 delisting plan under SEQUENTIAL user approval
// (逐次批准, never one bulk approve). Close only when every Listing is confirmed removed, OR the
// user explicitly accepts residual risk (a danger ceremony that records the unconfirmed impact).
// First version: no background polling, no OS wakeup, no unattended discovery/execution.
// Priority-0 describes scheduling AFTER the signal forms — it does NOT promise a discovery latency.
const {Badge,Button,Panel,StatusDot,Money,Dialog,Checkbox,Tag}=window.GoodDealerDesignSystem_b5b0b6;
const emoney=n=>Number(n).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});

// per-listing operation state → visual (mirrors the Operation/Attempt commit-boundary states)
const LSTATE={
  prepared:{dot:"warning",badge:["warning","待批准"]},
  executing:{dot:"sync",badge:["sync","下架中…"],pulse:true},
  remote_pending:{dot:"sync",badge:["sync","远端已接受 · 等待确认"]},
  manual_open:{dot:"warning",badge:["warning","已打开官网 · 待手工下架"]},
  checking:{dot:"sync",badge:["sync","检查平台状态…"],pulse:true},
  outcome_unknown:{dot:"danger",badge:["danger","结果未知"]},
  failed_retryable:{dot:"warning",badge:["warning","可重试"]},
  confirmed:{dot:"success",badge:["success","已下架"]},
};

function ListingRow({l,busy,onApprove,onOpenManual,onCheck,onRetry}){
  const I=window.GDI;
  const s=LSTATE[l.state];
  const source=l.role==="source";
  const lock=busy&&busy!==l.id; // sequential: only one op runs at a time
  const act=()=>{
    if(source||l.state==="confirmed")return null;
    if(l.state==="prepared")return l.method==="manual"
      ? <Button size="sm" variant="secondary" disabled={lock} icon={<I.ExternalLink size={13}/>} onClick={()=>onOpenManual(l.id)}>打开平台官网</Button>
      : <Button size="sm" variant="danger" disabled={lock} onClick={()=>onApprove(l.id)}>批准并下架</Button>;
    if(l.state==="manual_open")return <Button size="sm" variant="primary" disabled={lock} icon={<I.RefreshCw size={13}/>} onClick={()=>onCheck(l.id)}>我已下架 · 重新检查</Button>;
    if(l.state==="remote_pending"||l.state==="outcome_unknown")return <Button size="sm" disabled={lock} icon={<I.RefreshCw size={13}/>} onClick={()=>onCheck(l.id)}>检查平台状态</Button>;
    if(l.state==="failed_retryable")return <Button size="sm" variant="danger" disabled={lock} onClick={()=>onRetry(l.id)}>重试下架</Button>;
    if(l.state==="executing"||l.state==="checking")return <I.RefreshCw size={14} style={{color:"var(--gd-text-muted)",animation:"gd-spinner 1s linear infinite"}}/>;
    return null;
  };
  const note=l.note||(l.state==="outcome_unknown"||l.state==="failed_retryable"?l.why:l.state==="prepared"&&l.method==="manual"?l.why:null);
  return <div style={{display:"flex",alignItems:"center",gap:13,padding:"12px 14px",borderBottom:"1px solid var(--gd-line)",opacity:source?.72:1,
    background:l.state==="confirmed"?"transparent":l.state==="outcome_unknown"?"var(--gd-danger-tint)":"transparent"}}>
    <StatusDot kind={s.dot} pulse={s.pulse} size={8}/>
    <div style={{width:150,flex:"none",display:"flex",flexDirection:"column",gap:2,minWidth:0}}>
      <span style={{fontSize:13,color:"var(--text-1)",whiteSpace:"nowrap",display:"flex",alignItems:"center",gap:6}}>{l.platform}{source&&<span style={{fontSize:10,color:"var(--gd-gold)",border:"1px solid var(--gd-line-strong)",borderRadius:3,padding:"0 5px",lineHeight:"15px"}}>售出来源</span>}</span>
      <span style={{fontSize:11,color:"var(--gd-text-faint)",whiteSpace:"nowrap"}}>{l.account}</span>
    </div>
    <span style={{width:64,flex:"none"}}><Tag>{l.method==="manual"?"手工":"API"}</Tag></span>
    <span style={{flex:1,minWidth:0,fontSize:11,color:"var(--gd-text-muted)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{note||""}</span>
    <span style={{flex:"none"}}><Badge tone={s.badge[0]} mono={false}>{s.badge[1]}</Badge></span>
    <span style={{width:176,flex:"none",display:"flex",justifyContent:"flex-end"}}>{act()}</span>
  </div>;
}

function EmergencyDelisting({addUnsynced}){
  const I=window.GDI;
  const inc=window.GD_DATA.incidents[0];
  const [listings,setListings]=React.useState(()=>inc.listings.map(l=>({...l})));
  const [busy,setBusy]=React.useState(null);
  const [closed,setClosed]=React.useState(false);
  const [closedAt,setClosedAt]=React.useState(null);
  const [closeMode,setCloseMode]=React.useState(null); // 'risk' dialog
  const [ack,setAck]=React.useState(false);

  const set=(id,state)=>setListings(ls=>ls.map(l=>l.id===id?{...l,state}:l));
  const run=(id,to,ms=1400)=>{setBusy(id);set(id,to==="check"?"checking":"executing");
    setTimeout(()=>{set(id,"confirmed");setBusy(null);addUnsynced&&addUnsynced(1);},ms);};
  const onApprove=id=>run(id,"exec");
  const onRetry=id=>run(id,"exec");
  const onCheck=id=>run(id,"check",1200);
  const onOpenManual=id=>set(id,"manual_open");

  const delist=listings.filter(l=>l.role==="delist");
  const done=delist.filter(l=>l.state==="confirmed").length;
  const total=delist.length;
  const unresolved=delist.filter(l=>l.state!=="confirmed");
  const unknownN=listings.filter(l=>l.state==="outcome_unknown").length;
  const allDone=unresolved.length===0;

  const closeClean=()=>{setClosed(true);setClosedAt("14:20");};
  const closeRisk=()=>{setCloseMode(null);setAck(false);setClosed(true);setClosedAt("14:22");};

  const copyList=()=>{try{navigator.clipboard&&navigator.clipboard.writeText(inc.domain);}catch(e){}};

  const kpis=[
    {label:"紧急事件",value:closed?"已关闭":"1 未关闭",tone:closed?"success":"danger",meta:inc.id},
    {label:"涉及 Listing",value:total+" 平台",meta:"售出来源 1"},
    {label:"已确认下架",value:done+" / "+total,tone:allDone?"success":"warning"},
    {label:"结果未知",value:String(unknownN),tone:unknownN?"danger":"muted",meta:unknownN?"只能检查 · 不重试":null},
    {label:"售出金额",value:"$"+emoney(inc.soldPrice),tone:"gold",mono:true,meta:inc.soldOn+" · SOLD"},
  ];
  const MetricStrip=window.GDMetricStrip;

  return <div data-screen-label="资产保护 · 紧急下架" style={{display:"flex",flexDirection:"column",height:"100%",minHeight:0}}>
    <MetricStrip metrics={kpis}/>
    <div style={{flex:1,minHeight:0,overflow:"auto",padding:16}}>
      <div style={{maxWidth:860,margin:"0 auto",display:"flex",flexDirection:"column",gap:14}}>

        {/* incident header — SaleSignal provenance + non-promise disclaimer */}
        <div style={{border:`1px solid var(--gd-${closed?"success":"danger"})`,background:`var(--gd-${closed?"success":"danger"}-tint)`,borderRadius:9,padding:"14px 16px",display:"flex",flexDirection:"column",gap:12}}>
          <div style={{display:"flex",alignItems:"center",gap:11}}>
            {closed?<I.Check size={18} style={{color:"var(--gd-success)",flex:"none"}}/>:<I.ShieldAlert size={18} style={{color:"var(--gd-danger)",flex:"none"}}/>}
            <span style={{fontSize:15,fontWeight:600,color:"var(--text-1)",display:"flex",alignItems:"center",gap:9}}>
              <span style={{fontFamily:"var(--font-mono)"}}>{inc.domain}</span>
              <Badge tone="gold">SOLD</Badge>
              {closed
                ?<Badge tone="success" mono={false}>事件已关闭</Badge>
                :<Badge tone="danger" mono={false}>Priority-0 资产保护</Badge>}
            </span>
            <span style={{marginLeft:"auto",fontFamily:"var(--font-mono)",fontSize:11,color:"var(--gd-text-muted)"}}>{inc.id}</span>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"110px 1fr",rowGap:7,columnGap:12,fontSize:12}}>
            <span style={{color:"var(--gd-text-faint)"}}>售出发现来源</span>
            <span>{inc.source} <span style={{color:"var(--gd-text-faint)",fontFamily:"var(--font-mono)"}}>· {inc.detectedAt}</span></span>
            <span style={{color:"var(--gd-text-faint)"}}>事件建立</span>
            <span style={{fontFamily:"var(--font-mono)"}}>{inc.createdAt}{closed&&<span style={{color:"var(--gd-success)"}}> → 关闭 {closedAt}</span>}</span>
            <span style={{color:"var(--gd-text-faint)"}}>售出金额</span>
            <span><Money amount={inc.soldPrice} size={13}/> <span style={{color:"var(--gd-text-faint)"}}>· 于 {inc.soldOn} 成交</span></span>
          </div>
          {!closed&&<div style={{fontSize:11,color:"var(--gd-text-muted)",lineHeight:1.6,borderTop:"1px solid rgba(229,115,95,0.22)",paddingTop:10}}>
            Priority-0 仅表示 SaleSignal 形成后的调度优先级。首版<b style={{color:"var(--gd-text)",fontWeight:500}}>不后台轮询、不 OS 唤醒、不无人值守发现或执行</b>——本事件由当前 Active 设备在用户主动刷新中发现，售出发现时延不作承诺。
          </div>}
        </div>

        {!closed&&<>
        {/* Priority-0 delisting plan — enumerated Listings under sequential approval */}
        <Panel flush title="Priority-0 下架计划" actions={
          <span style={{display:"flex",alignItems:"center",gap:12,fontSize:11}}>
            <span style={{color:"var(--gd-text-faint)"}}>逐次批准 · 一次执行一项</span>
            <span style={{fontFamily:"var(--font-mono)",color:allDone?"var(--gd-success)":"var(--gd-warning)"}}>已确认 {done} / {total}</span>
          </span>}>
          {listings.map(l=><ListingRow key={l.id} l={l} busy={busy} onApprove={onApprove} onOpenManual={onOpenManual} onCheck={onCheck} onRetry={onRetry}/>)}
          <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px"}}>
            <Button size="sm" variant="ghost" icon={<I.Copy size={13}/>} onClick={copyList}>复制域名清单</Button>
            <span style={{fontSize:11,color:"var(--gd-text-faint)"}}>无自动化的平台可打开官网手工处理；手工下架不会被冲突合并策略自动重新上架。</span>
          </div>
        </Panel>

        {/* close ceremony */}
        <div style={{display:"flex",alignItems:"center",gap:12,padding:"12px 14px",border:"1px solid var(--gd-line)",borderRadius:7,background:"var(--gd-panel)"}}>
          {allDone
            ?<>
              <I.Check size={16} style={{color:"var(--gd-success)",flex:"none"}}/>
              <span style={{fontSize:12,color:"var(--gd-text-muted)"}}>所有 Listing 已确认下架，可关闭事件。</span>
              <Button style={{marginLeft:"auto"}} variant="primary" onClick={closeClean}>确认关闭事件 · {done}/{total} 已下架</Button>
            </>
            :<>
              <I.AlertTriangle size={16} style={{color:"var(--gd-warning)",flex:"none"}}/>
              <span style={{fontSize:12,color:"var(--gd-text-muted)"}}>仍有 <b style={{color:"var(--gd-warning)",fontWeight:500}}>{unresolved.length} 项</b>未确认下架；取消或跳过某项不等于关闭事件。</span>
              <Button style={{marginLeft:"auto"}} variant="danger" onClick={()=>{setCloseMode("risk");setAck(false);}}>接受残余风险并关闭</Button>
            </>}
        </div>
        </>}

        {closed&&<Panel title="下架结果 · 审计">
          <div style={{display:"flex",flexDirection:"column",gap:9,fontSize:12}}>
            {listings.filter(l=>l.role==="delist").map(l=><div key={l.id} style={{display:"flex",alignItems:"center",gap:10,borderBottom:"1px solid var(--gd-line)",paddingBottom:8}}>
              <StatusDot kind={l.state==="confirmed"?"success":"danger"} size={8}/>
              <span style={{width:150}}>{l.platform} · {l.account}</span>
              <Badge tone={l.state==="confirmed"?"success":"danger"} mono={false}>{l.state==="confirmed"?"已下架":"未确认 · 已接受风险"}</Badge>
            </div>)}
            <span style={{fontSize:11,color:"var(--gd-text-faint)",paddingTop:2}}>结果与残余风险接受已写入操作历史（追加不可篡改）。旧手工变更将在下次平台读取中作为外部修改被识别并对账。</span>
          </div>
        </Panel>}

      </div>
    </div>

    {/* residual-risk close ceremony — states the unconfirmed impact, records reason + audit */}
    <Dialog open={closeMode==="risk"} onClose={()=>{setCloseMode(null);setAck(false);}} title="接受残余风险并关闭事件" width={520} danger
      footer={<><Button onClick={()=>{setCloseMode(null);setAck(false);}}>取消</Button><Button variant="danger" disabled={!ack} onClick={closeRisk}>接受风险并关闭 · {unresolved.length} 项未确认</Button></>}>
      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        <span style={{fontSize:13}}>关闭 <b style={{fontFamily:"var(--font-mono)"}}>{inc.domain}</b> 的紧急下架事件，但以下 Listing 尚未确认下架，存在二次销售风险：</span>
        <div style={{border:"1px solid var(--gd-danger)",background:"var(--gd-danger-tint)",borderRadius:7,padding:"11px 13px",display:"flex",flexDirection:"column",gap:8}}>
          {unresolved.map(l=><div key={l.id} style={{display:"flex",alignItems:"center",gap:9,fontSize:12}}>
            <StatusDot kind={LSTATE[l.state].dot} size={7}/>
            <span style={{width:150,flex:"none"}}>{l.platform} · {l.account}</span>
            <Badge tone={LSTATE[l.state].badge[0]} mono={false}>{LSTATE[l.state].badge[1]}</Badge>
          </div>)}
        </div>
        <span style={{fontSize:11,color:"var(--gd-text-muted)",lineHeight:1.6}}>接受风险不等于平台已确认成功；未确认影响与理由将记录到审计。若之后在平台读取中发现仍在售，需重新建立事件处置。</span>
        <div style={{borderTop:"1px solid var(--gd-line)",paddingTop:10}}><Checkbox checked={ack} onChange={()=>setAck(a=>!a)} label={`我已知悉 ${unresolved.length} 项未确认下架的二次销售风险，仍选择关闭事件`}/></div>
      </div>
    </Dialog>
  </div>;
}
window.GDEmergencyDelisting=EmergencyDelisting;
