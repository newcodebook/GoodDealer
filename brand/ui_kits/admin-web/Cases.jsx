// 案件 / Cases — DataRightsRequest · SecurityIncident · SupportCase. A case IS the AdminPurposeRef that
// legitimizes every read/action; its purposeType decides what is even permissible (PurposeRef matrix).
// Case-workflow transitions are recorded here (reason + Passkey); actions that touch an account's business
// data/devices are executed in the account detail citing this case ref — never batch, never here.
const {Badge:CBadge,Button:CBtn,Dialog:CDlg,Input:CInput}=window.GoodDealerDesignSystem_b5b0b6;
const CASE_META={deletion:["danger","数据删除","DataRightsRequest"],export:["sync","数据导出","DataRightsRequest"],incident:["danger","安全事件","SecurityIncident"],support:["warning","支持工单","SupportCase"]};
const PREF_LABEL={support:"支持工单",datarights:"数据权利",incident:"安全事件"};
const CELL={allow:["var(--gd-success)","✓"],limited:["var(--gd-warning)","◐"],deny:["var(--gd-text-faint)","✕"]};

function Matrix(){
  const M=window.ADM_DATA.purposeMatrix;
  return <div className="adm-card" style={{padding:0,overflow:"hidden"}}>
    <div style={{padding:"13px 18px 4px"}}>
      <div style={{fontSize:11,letterSpacing:"0.08em",textTransform:"uppercase",color:"var(--text-3)"}}>AdminPurposeRef 矩阵 · 目的限定</div>
      <div style={{fontSize:12,color:"var(--text-3)",marginTop:3}}>目的类型决定可读 Scope 与可执行动作——目的不可挪用。授权仪式里选错类型会被拒。</div>
    </div>
    <div style={{overflowX:"auto"}}><table style={{borderCollapse:"collapse",width:"100%",minWidth:640,fontSize:12}}>
      <thead><tr>
        <th style={{textAlign:"left",padding:"10px 14px",color:"var(--text-3)",fontWeight:500,borderBottom:"1px solid var(--gd-line-strong)"}}>目的类型</th>
        {M.cols.map(c=><th key={c[0]} style={{padding:"10px 8px",color:"var(--text-3)",fontWeight:500,borderBottom:"1px solid var(--gd-line-strong)",whiteSpace:"nowrap",fontSize:11}}>{c[1]}</th>)}
      </tr></thead>
      <tbody>{M.rows.map(r=><tr key={r.t}>
        <td style={{padding:"10px 14px",borderBottom:"1px solid var(--gd-line)"}}><CBadge tone={r.t==="support"?"warning":r.t==="incident"?"danger":"sync"} mono={false}>{r.label}</CBadge></td>
        {M.cols.map(c=>{const v=r.cells[c[0]];const cell=CELL[v];
          return <td key={c[0]} title={v} style={{textAlign:"center",padding:"10px 8px",borderBottom:"1px solid var(--gd-line)",color:cell[0],fontSize:14}}>{cell[1]}</td>;})}
      </tr>)}</tbody>
    </table></div>
    <div style={{padding:"10px 18px",fontSize:11,color:"var(--text-3)",borderTop:"1px solid var(--gd-line)",display:"flex",gap:16,flexWrap:"wrap"}}>
      <span style={{color:"var(--gd-success)"}}>✓ 允许</span><span style={{color:"var(--gd-warning)"}}>◐ 受限</span><span style={{color:"var(--gd-text-faint)"}}>✕ 拒绝</span>
      <span style={{flex:1,minWidth:200}}>{M.notes.limited}</span>
    </div>
  </div>;
}

function CaseDetail({c,onBack,onOpenAccount}){
  const m=CASE_META[c.kind];
  const next=c.timeline.find(t=>t[3]==="current");
  const [dlg,setDlg]=React.useState(false);
  const [reason,setReason]=React.useState("");
  const [passkey,setPasskey]=React.useState(false);
  const [advanced,setAdvanced]=React.useState(false);
  const openAct=()=>{setReason("");setPasskey(false);setDlg(true);};
  return <div style={{display:"flex",flexDirection:"column",gap:16}}>
    <button onClick={onBack} style={{alignSelf:"flex-start",background:"none",border:"none",color:"var(--text-2)",cursor:"pointer",font:"inherit",fontSize:13,display:"inline-flex",alignItems:"center",gap:5}}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>案件列表</button>

    <div style={{border:"1px solid var(--gd-line-strong)",borderRadius:8,padding:"14px 18px",display:"flex",alignItems:"center",gap:14,flexWrap:"wrap"}}>
      <CBadge tone={m[0]} mono={false}>{m[1]}</CBadge>
      <span style={{fontFamily:"var(--font-mono)",fontSize:15,color:"var(--text-1)"}}>{c.ref}</span>
      <span style={{fontSize:12,color:"var(--text-3)"}}>{m[2]} · {c.requestType}</span>
      <button onClick={()=>onOpenAccount&&onOpenAccount(c.acct)} style={{marginLeft:"auto",fontFamily:"var(--font-mono)",fontSize:12,color:"var(--text-link)",background:"none",border:"none",cursor:"pointer"}}>{c.acct} ›</button>
    </div>

    <div style={{display:"flex",gap:14,flexWrap:"wrap"}}>
      {/* timeline */}
      <div className="adm-card" style={{flex:"1 1 300px",padding:"16px 20px"}}>
        <div style={{fontSize:11,letterSpacing:"0.08em",textTransform:"uppercase",color:"var(--text-3)",marginBottom:12}}>状态机</div>
        {c.timeline.map((t,i)=>{const st=t[3];const col=st==="done"?"var(--gd-success)":st==="current"?"var(--gd-gold)":"var(--gd-text-faint)";
          return <div key={i} style={{display:"flex",gap:12,alignItems:"flex-start"}}>
            <div style={{display:"flex",flexDirection:"column",alignItems:"center"}}>
              <span style={{width:11,height:11,borderRadius:"50%",background:st==="todo"?"transparent":col,border:"1.5px solid "+col,marginTop:3}}></span>
              {i<c.timeline.length-1&&<span style={{width:1.5,flex:1,minHeight:24,background:"var(--gd-line)"}}></span>}
            </div>
            <div style={{paddingBottom:14}}>
              <div style={{fontSize:13,color:st==="todo"?"var(--text-3)":"var(--text-1)",fontWeight:st==="current"?600:400}}>{t[1]}{st==="current"&&<CBadge tone="gold" mono={false} style={{marginLeft:8}}>当前</CBadge>}</div>
              <div style={{fontSize:11,color:"var(--text-3)",marginTop:1}}>{t[2]}</div>
            </div>
          </div>;})}
      </div>
      {/* authorizes / denies */}
      <div className="adm-card" style={{flex:"1 1 300px",padding:"16px 20px"}}>
        <div style={{fontSize:11,letterSpacing:"0.08em",textTransform:"uppercase",color:"var(--text-3)",marginBottom:10}}>本案作为 PurposeRef 授权范围</div>
        <div style={{fontSize:11,color:"var(--text-3)",marginBottom:8}}>类型 <CBadge tone={c.purposeType==="support"?"warning":c.purposeType==="incident"?"danger":"sync"} mono={false}>{PREF_LABEL[c.purposeType]}</CBadge></div>
        {c.authorizes.map((a,i)=><div key={i} style={{display:"flex",gap:8,fontSize:12,padding:"4px 0",color:"var(--text-2)"}}><span style={{color:"var(--gd-success)"}}>✓</span>{a}</div>)}
        {c.denies.map((d,i)=><div key={i} style={{display:"flex",gap:8,fontSize:12,padding:"4px 0",color:"var(--text-3)"}}><span style={{color:"var(--gd-text-faint)"}}>✕</span>{d}</div>)}
        {c.coolingOffUntil&&<div style={{marginTop:10,border:"1px solid var(--gd-warning)",background:"var(--gd-warning-tint)",borderRadius:6,padding:"8px 10px",fontSize:11,color:"var(--text-2)"}}>数据删除冷静期至 <b style={{fontFamily:"var(--font-mono)"}}>{c.coolingOffUntil}</b>，届时方可执行且不可逆。</div>}
      </div>
    </div>

    {/* case workflow action + routing to account for business-data actions */}
    <div className="adm-card" style={{padding:"16px 20px",display:"flex",flexDirection:"column",gap:12}}>
      <div style={{fontSize:11,letterSpacing:"0.08em",textTransform:"uppercase",color:"var(--text-3)"}}>办理</div>
      {advanced?<div style={{display:"flex",alignItems:"center",gap:10}}><CBadge tone="success" mono={false}>已推进</CBadge><span style={{fontSize:12,color:"var(--text-2)"}}>案件状态已前进，追加审计并绑定 {c.ref}。</span></div>
      :<div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"center"}}>
        {next&&<CBtn variant="primary" onClick={openAct}>推进：{next[1]} →</CBtn>}
        <CBtn variant="secondary" onClick={()=>onOpenAccount&&onOpenAccount(c.acct)}>打开账号办理业务动作</CBtn>
      </div>}
      <div style={{fontSize:11,color:"var(--text-3)",lineHeight:1.6}}>触及账号业务数据/设备的动作（导出、删除、强移设备）在<b style={{color:"var(--text-2)"}}>账号详情</b>执行，引用本案 <span style={{fontFamily:"var(--font-mono)"}}>{c.ref}</span> 作为 AdminPurposeRef，走独立 AdminActionAuthorization——不在案件页批量执行。</div>
    </div>

    <CDlg open={dlg} onClose={()=>setDlg(false)} title={"推进案件 · "+c.ref} width={460}
      footer={<><CBtn onClick={()=>setDlg(false)}>取消</CBtn><CBtn variant="primary" disabled={!reason.trim()||!passkey} onClick={()=>{setAdvanced(true);setDlg(false);}}>确认推进</CBtn></>}>
      <div style={{display:"flex",flexDirection:"column",gap:13}}>
        <div style={{fontSize:12,color:"var(--text-2)"}}>将 <b>{c.ref}</b> 推进到 <b>{next&&next[1]}</b>。案件工作流转记录，追加审计。</div>
        <CInput label="处理说明" size="md" placeholder="记录本次推进的依据" value={reason} onChange={e=>setReason(e.target.value)}/>
        <div style={{borderTop:"1px solid var(--gd-line)",paddingTop:11,display:"flex",alignItems:"center",gap:10}}>
          {passkey?<CBadge tone="success" mono={false}>Passkey 已确认</CBadge>:<CBtn size="sm" variant="gold" icon={<img src="../../assets/icons/keyhole.svg" width="14" height="14" alt=""/>} onClick={()=>setPasskey(true)}>Passkey 重新认证</CBtn>}
          <span style={{fontSize:11,color:"var(--text-3)"}}>案件状态变更也需新鲜 Passkey。</span>
        </div>
      </div>
    </CDlg>
  </div>;
}

function Cases({openId,onOpenAccount,onClearOpen}){
  const D=window.ADM_DATA;
  const [sel,setSel]=React.useState(openId||null);
  React.useEffect(()=>{if(openId)setSel(openId);},[openId]);
  const c=sel?D.cases.find(x=>x.ref===sel):null;
  if(c) return <CaseDetail c={c} onBack={()=>{setSel(null);onClearOpen&&onClearOpen();}} onOpenAccount={onOpenAccount}/>;

  return <div style={{display:"flex",flexDirection:"column",gap:20}}>
    <div><h1 className="adm-h1">案件</h1><p className="adm-sub" style={{margin:0}}>数据权利、安全事件与支持工单。案件即 AdminPurposeRef——决定可读 Scope 与可执行动作。</p></div>
    <div className="adm-card" style={{padding:0,overflow:"hidden"}}>
      <div style={{display:"flex",padding:"9px 18px",borderBottom:"1px solid var(--gd-line-strong)",fontSize:10,letterSpacing:"0.06em",textTransform:"uppercase",color:"var(--text-3)"}}>
        <span style={{width:118,flex:"none"}}>Ref</span><span style={{width:96,flex:"none"}}>类型</span><span style={{flex:1}}>主题</span><span style={{width:96,flex:"none"}}>账号</span><span style={{width:120,flex:"none"}}>状态</span>
      </div>
      {D.cases.map(x=>{const m=CASE_META[x.kind];
        return <div key={x.ref} onClick={()=>setSel(x.ref)} style={{display:"flex",alignItems:"center",padding:"11px 18px",borderTop:"1px solid var(--gd-line)",cursor:"pointer",fontSize:12}}>
          <span style={{width:118,flex:"none",fontFamily:"var(--font-mono)",fontSize:12,color:"var(--text-link)"}}>{x.ref}</span>
          <span style={{width:96,flex:"none"}}><CBadge tone={m[0]} mono={false}>{m[1]}</CBadge></span>
          <span style={{flex:1,minWidth:0,color:"var(--text-2)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{x.requestType}</span>
          <span style={{width:96,flex:"none",fontFamily:"var(--font-mono)",fontSize:11,color:"var(--text-3)"}}>{x.acct}</span>
          <span style={{width:120,flex:"none",fontSize:11,color:"var(--text-3)"}}>{x.state} · {x.at}</span>
        </div>;})}
    </div>
    <Matrix/>
  </div>;
}
window.ADMCases=Cases;
