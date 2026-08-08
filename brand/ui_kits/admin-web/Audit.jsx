// 审计 / Audit — append-only. Every controlled read (AdminReadAuthorization), action (AdminActionAuthorization),
// case advance, job disposition, and policy publish leaves an immutable trace here — nothing else can write to
// an account or the platform without appearing. Read-only, filterable by type. Each entry carries its
// AdminPurposeRef, so any access can be traced back to the case/reason that legitimized it.
const {Badge:AuBadge,Button:AuBtn}=window.GoodDealerDesignSystem_b5b0b6;
const AU_TYPE={read:["sync","读授权"],action:["danger","写动作"],case:["warning","案件"],job:["neutral","作业处置"],policy:["gold","政策发布"]};
const AU_OUT={granted:"已授权",committed:"已提交",advanced:"已推进",frozen:"已冻结",published:"已发布"};

function Audit({onOpenAccount}){
  const rows=window.ADM_DATA.audit;
  const [f,setF]=React.useState("all");
  const filters=[["all","全部"],["read","读授权"],["action","写动作"],["case","案件"],["job","作业处置"],["policy","政策发布"]];
  const shown=rows.filter(r=>f==="all"||r.type===f);
  return <div style={{display:"flex",flexDirection:"column",gap:18}}>
    <div><h1 className="adm-h1">审计</h1><p className="adm-sub" style={{margin:0}}>追加不可改。每一次受控读、写、案件推进、作业处置与政策发布都在此留痕，并绑定 AdminPurposeRef 可回溯。</p></div>

    <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
      {filters.map(([k,l])=><button key={k} onClick={()=>setF(k)} style={{padding:"5px 12px",borderRadius:6,fontSize:12,cursor:"pointer",
        border:"1px solid "+(f===k?"var(--gd-gold)":"var(--gd-line-strong)"),background:f===k?"var(--gd-gold-tint)":"transparent",color:f===k?"var(--text-1)":"var(--text-2)"}}>
        {l}{k!=="all"&&<span style={{marginLeft:6,color:"var(--text-3)"}}>{rows.filter(r=>r.type===k).length}</span>}</button>)}
    </div>

    <div className="adm-card" style={{padding:0,overflow:"hidden"}}>
      <div style={{display:"flex",padding:"9px 18px",borderBottom:"1px solid var(--gd-line-strong)",fontSize:10,letterSpacing:"0.05em",textTransform:"uppercase",color:"var(--text-3)"}}>
        <span style={{width:96,flex:"none"}}>时间</span><span style={{width:84,flex:"none"}}>类型</span><span style={{width:96,flex:"none"}}>对象</span><span style={{flex:1}}>明细</span><span style={{width:120,flex:"none"}}>PurposeRef</span><span style={{width:84,flex:"none",textAlign:"right"}}>结果</span>
      </div>
      {shown.map((r,i)=>{const t=AU_TYPE[r.type];const isAcct=/^acc_/.test(r.target);
        return <div key={i} style={{display:"flex",alignItems:"center",padding:"11px 18px",borderTop:"1px solid var(--gd-line)",fontSize:12}}>
          <span style={{width:96,flex:"none",fontFamily:"var(--font-mono)",fontSize:11,color:"var(--text-3)"}}>{r.at}</span>
          <span style={{width:84,flex:"none"}}><AuBadge tone={t[0]} mono={false}>{t[1]}</AuBadge></span>
          <span style={{width:96,flex:"none"}}>{isAcct?<button onClick={()=>onOpenAccount&&onOpenAccount(r.target)} style={{fontFamily:"var(--font-mono)",fontSize:11,color:"var(--text-link)",background:"none",border:"none",cursor:"pointer",padding:0}}>{r.target}</button>:<span style={{fontFamily:"var(--font-mono)",fontSize:11,color:"var(--text-2)"}}>{r.target}</span>}</span>
          <span style={{flex:1,minWidth:0,color:"var(--text-2)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{r.detail}</span>
          <span style={{width:120,flex:"none",fontFamily:"var(--font-mono)",fontSize:11,color:"var(--text-3)"}}>{r.purpose}</span>
          <span style={{width:84,flex:"none",textAlign:"right",fontSize:11,color:"var(--text-2)"}}>{AU_OUT[r.outcome]||r.outcome}</span>
        </div>;})}
      {!shown.length&&<div style={{padding:"22px",textAlign:"center",fontSize:12,color:"var(--text-3)"}}>该类型暂无记录。</div>}
    </div>

    <div style={{border:"1px solid var(--gd-line)",borderRadius:8,padding:"12px 16px",fontSize:11,color:"var(--text-3)",lineHeight:1.6}}>
      审计为追加写入、不可修改或删除；管理员亦不能读平台凭据/密钥/备份秘密，故这些从不出现在明细里。每条读/写都能经 PurposeRef 回溯到合法事由。
    </div>
  </div>;
}
window.ADMAudit=Audit;
